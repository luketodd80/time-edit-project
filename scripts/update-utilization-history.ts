import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FullbayEditBatch } from "@/lib/fullbay-edit-queue";
import { SEED } from "@/lib/seed";
import {
  historyDaysWithData,
  mergeUtilizationHistory,
  parseUtilizationHistory,
  serializeUtilizationHistory,
  snapshotFromReports,
  type UtilShopDay,
} from "@/lib/utilization-history";

export const COMMITTED_HISTORY_PATH = join(process.cwd(), "data", "utilization-history.json");
export const QUEUE_SEED_PATH = join(process.cwd(), "data", "fullbay-edit-queue.seed.json");

function shopDayKey(row: UtilShopDay): string {
  return `${row.day}|${row.shopId}`;
}

/**
 * Merges the days currently in the app seed into data/utilization-history.json.
 * Every shop day already in the file stays. Loaded shop days are added or refreshed.
 */
export function updateUtilizationHistory(options?: { historyPath?: string; queuePath?: string }): { days: UtilShopDay[]; changed: boolean } {
  const historyPath = options?.historyPath ?? COMMITTED_HISTORY_PATH;
  const queuePath = options?.queuePath ?? QUEUE_SEED_PATH;
  const stored = parseUtilizationHistory(JSON.parse(readFileSync(historyPath, "utf8")));
  const queue = JSON.parse(readFileSync(queuePath, "utf8")) as { batches: FullbayEditBatch[] };
  const fresh = snapshotFromReports(SEED, queue.batches);
  const merged = mergeUtilizationHistory(stored, fresh);
  const dropped = stored.map(shopDayKey).filter((key) => !merged.some((row) => shopDayKey(row) === key));
  if (dropped.length > 0) {
    throw new Error(`Utilization history update would drop ${dropped.join(", ")}.`);
  }
  const next = serializeUtilizationHistory(merged);
  const previous = readFileSync(historyPath, "utf8");
  const changed = previous !== next;
  if (changed) writeFileSync(historyPath, next);
  return { days: merged, changed };
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const { changed, days } = updateUtilizationHistory();
  const count = historyDaysWithData(days).length;
  console.log(
    changed
      ? `Updated data/utilization-history.json (${count} days with timesheets).`
      : `data/utilization-history.json already matches the loaded days (${count} days with timesheets).`,
  );
}

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readStoredJson } from "@/lib/durable-file";
import {
  mergeUtilizationHistory,
  parseUtilizationHistory,
  serializeUtilizationHistory,
  type UtilShopDay,
} from "@/lib/utilization-history";

/**
 * Committed history lives at data/utilization-history.json.
 * The live file is a separate path so a request never rewrites the committed snapshot.
 * Render has no persistent disk, so a deploy comes back from the committed file.
 * Merging keeps shop days the fresh snapshot does not include.
 */
let writeChain: Promise<unknown> = Promise.resolve();

export function utilizationHistorySeedPath(): string {
  return join(process.cwd(), "data", "utilization-history.json");
}

export function utilizationHistoryLivePath(): string {
  const explicit = process.env.UTILIZATION_HISTORY_PATH?.trim() ?? "";
  if (explicit.length > 0) return explicit;
  const directory = process.env.TSC_DATA_DIR?.trim() ?? "";
  if (directory.length > 0) return join(directory, "utilization-history.json");
  return join(process.cwd(), "data", "utilization-history.live.json");
}

export async function readUtilizationHistory(): Promise<UtilShopDay[]> {
  const parsed = await readStoredJson(utilizationHistoryLivePath(), utilizationHistorySeedPath());
  return parseUtilizationHistory(parsed);
}

export async function writeUtilizationHistory(days: UtilShopDay[]): Promise<void> {
  const file = utilizationHistoryLivePath();
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temporary, serializeUtilizationHistory(days));
  await rename(temporary, file);
}

/** Merges the fresh snapshot into stored history and writes the live file when something changed. */
export async function syncUtilizationHistory(fresh: UtilShopDay[]): Promise<UtilShopDay[]> {
  const run = writeChain.then(() => mergeAndMaybeWrite(fresh), () => mergeAndMaybeWrite(fresh));
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function mergeAndMaybeWrite(fresh: UtilShopDay[]): Promise<UtilShopDay[]> {
  const stored = await readUtilizationHistory();
  const merged = mergeUtilizationHistory(stored, fresh);
  if (serializeUtilizationHistory(stored) !== serializeUtilizationHistory(merged)) {
    await writeUtilizationHistory(merged);
  }
  return merged;
}

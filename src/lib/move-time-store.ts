import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { liveDataPath, readStoredJson, seedDataPath } from "@/lib/durable-file";
import { moveTimeLeftoverFindings } from "@/lib/move-time";
import type { Finding } from "@/lib/types";

/** Live flag. Gitignored. A present file wins over the seed. */
export function moveTimeLeftoverPath(): string {
  return liveDataPath(process.env.MOVE_TIME_LEFTOVER_PATH, "move-time-leftovers.json");
}

/** Committed opened flag used only when the live file is missing. */
export function moveTimeLeftoverSeedPath(): string {
  return seedDataPath(process.env.MOVE_TIME_LEFTOVER_SEED_PATH, "move-time-leftovers.seed.json");
}

export async function readMoveTimeLeftovers(): Promise<Finding[]> {
  const stored = await readStoredJson(moveTimeLeftoverPath(), moveTimeLeftoverSeedPath());
  if (!isOpen(stored)) return [];
  return moveTimeLeftoverFindings();
}

/**
 * Marks the move-time leftovers open so Review can show them.
 * Does not write the edit queue or the sign-off file.
 * Keeps the first openedAt, including the one in the seed.
 */
export async function openMoveTimeLeftovers(now: string): Promise<{ openedAt: string; findings: Finding[] }> {
  const path = moveTimeLeftoverPath();
  const existing = await readStoredJson(path, moveTimeLeftoverSeedPath());
  const openedAt = isOpen(existing) ? existing.openedAt : now;
  if (!isOpen(existing)) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ openedAt }), "utf8");
  }
  return { openedAt, findings: moveTimeLeftoverFindings() };
}

function isOpen(value: unknown): value is { openedAt: string } {
  return Boolean(value) && typeof value === "object" && typeof (value as { openedAt?: unknown }).openedAt === "string";
}

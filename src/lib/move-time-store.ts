import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { liveDataPath, readStoredJson } from "@/lib/durable-file";
import { moveTimeLeftoverFindings } from "@/lib/move-time";
import type { Finding } from "@/lib/types";

/** Live flag only. A missing file means the leftovers have not been opened. There is no seed. */
export function moveTimeLeftoverPath(): string {
  return liveDataPath(process.env.MOVE_TIME_LEFTOVER_PATH, "move-time-leftovers.json");
}

export async function readMoveTimeLeftovers(): Promise<Finding[]> {
  const stored = await readStoredJson(moveTimeLeftoverPath(), moveTimeLeftoverPath());
  if (!isOpen(stored)) return [];
  return moveTimeLeftoverFindings();
}

/**
 * Marks the move-time leftovers open so Review can show them.
 * Does not write the edit queue or the sign-off file.
 */
export async function openMoveTimeLeftovers(now: string): Promise<{ openedAt: string; findings: Finding[] }> {
  const path = moveTimeLeftoverPath();
  const existing = await readStoredJson(path, path);
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

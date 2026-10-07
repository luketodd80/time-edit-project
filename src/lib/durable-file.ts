import { readFile } from "node:fs/promises";
import { join } from "node:path";

function setPath(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Where a live JSON file is written.
 * An explicit path wins. Otherwise TSC_DATA_DIR is the directory (a Render disk mount).
 * With neither set, the file is under data/ on the local disk, which Render replaces on deploy.
 */
export function liveDataPath(explicit: string | undefined, fileName: string): string {
  const path = setPath(explicit);
  if (path) return path;
  const directory = setPath(process.env.TSC_DATA_DIR);
  if (directory) return join(directory, fileName);
  return join(process.cwd(), "data", fileName);
}

/** Committed snapshot used only when the live file is not on disk. */
export function seedDataPath(explicit: string | undefined, fileName: string): string {
  return setPath(explicit) ?? join(process.cwd(), "data", fileName);
}

/** Live file wins. A missing live file falls back to the seed. A present live file is never replaced by the seed. */
export async function readStoredJson(livePath: string, seedPath: string): Promise<unknown | null> {
  const live = await readJson(livePath);
  if (live.status === "ok") return live.value;
  if (live.status === "error") throw live.error;
  if (livePath === seedPath) return null;
  const seed = await readJson(seedPath);
  if (seed.status === "ok") return seed.value;
  if (seed.status === "error") throw seed.error;
  return null;
}

async function readJson(path: string): Promise<{ status: "ok"; value: unknown } | { status: "missing" } | { status: "error"; error: unknown }> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ path, "utf8");
    return { status: "ok", value: JSON.parse(raw) as unknown };
  } catch (error) {
    if (isMissingFile(error)) return { status: "missing" };
    return { status: "error", error };
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

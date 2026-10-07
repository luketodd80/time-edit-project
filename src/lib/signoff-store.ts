import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { liveDataPath, readStoredJson, seedDataPath } from "@/lib/durable-file";
import type { RecordedSignoff, ShopDayRef } from "@/lib/fullbay-edit-queue";
import { SHOPS, type ShopId } from "@/lib/types";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

let writeChain: Promise<unknown> = Promise.resolve();

export function signoffFilePath(): string {
  return liveDataPath(process.env.SHOP_DAY_SIGNOFF_PATH, "shop-day-signoffs.json");
}

export function signoffSeedPath(): string {
  return seedDataPath(process.env.SHOP_DAY_SIGNOFF_SEED_PATH, "shop-day-signoffs.seed.json");
}

export async function readSignoffs(): Promise<RecordedSignoff[]> {
  const parsed = await readStoredJson(signoffFilePath(), signoffSeedPath());
  if (!parsed || typeof parsed !== "object") return [];
  const signoffs = (parsed as { signoffs?: RecordedSignoff[] }).signoffs;
  if (!Array.isArray(signoffs)) return [];
  return signoffs
    .filter(
      (signoff) =>
        signoff &&
        typeof signoff.day === "string" &&
        DAY.test(signoff.day) &&
        typeof signoff.shopId === "string" &&
        SHOPS.some((shop) => shop.id === signoff.shopId) &&
        typeof signoff.doneAt === "string",
    )
    .map((signoff) => ({
      day: signoff.day,
      shopId: signoff.shopId,
      doneAt: signoff.doneAt,
      note: storedNote(signoff.note),
    }));
}

function storedNote(note: unknown): string | null {
  return typeof note === "string" && note.trim().length > 0 ? note.trim() : null;
}

/** Records the first sign-off for a shop and day. A second call keeps the original time. */
export async function recordSignoff(day: string, shopId: ShopId, doneAt: string, note?: string | null): Promise<RecordedSignoff> {
  const run = writeChain.then(() => writeSignoff(day, shopId, doneAt, note), () => writeSignoff(day, shopId, doneAt, note));
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Writes each shop day that is not already signed off. Returns only the new rows. */
export async function recordAutoSignoffs(pairs: ShopDayRef[], doneAt: string, note: string): Promise<RecordedSignoff[]> {
  const run = writeChain.then(() => writeAutoSignoffs(pairs, doneAt, note), () => writeAutoSignoffs(pairs, doneAt, note));
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeSignoff(day: string, shopId: ShopId, doneAt: string, note?: string | null): Promise<RecordedSignoff> {
  const file = signoffFilePath();
  const signoffs = await readSignoffs();
  const existing = signoffs.find((signoff) => signoff.day === day && signoff.shopId === shopId);
  if (existing) return existing;
  const next: RecordedSignoff = { day, shopId, doneAt, note: storedNote(note) };
  signoffs.push(next);
  await persistSignoffs(file, signoffs);
  return next;
}

async function writeAutoSignoffs(pairs: ShopDayRef[], doneAt: string, note: string): Promise<RecordedSignoff[]> {
  const file = signoffFilePath();
  const signoffs = await readSignoffs();
  const created: RecordedSignoff[] = [];
  for (const pair of pairs) {
    if (signoffs.some((signoff) => signoff.day === pair.day && signoff.shopId === pair.shopId)) continue;
    const next: RecordedSignoff = { day: pair.day, shopId: pair.shopId, doneAt, note: storedNote(note) };
    signoffs.push(next);
    created.push(next);
  }
  if (created.length === 0) return [];
  await persistSignoffs(file, signoffs);
  return created;
}

async function persistSignoffs(file: string, signoffs: RecordedSignoff[]): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temporary, `${JSON.stringify({ signoffs }, null, 2)}\n`);
  await rename(temporary, file);
}

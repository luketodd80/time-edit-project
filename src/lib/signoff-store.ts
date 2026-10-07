import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { liveDataPath, readStoredJson, seedDataPath } from "@/lib/durable-file";
import { SHOPS, type ShopId } from "@/lib/types";
import type { RecordedSignoff } from "@/lib/fullbay-edit-queue";

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
  return signoffs.filter(
    (signoff) =>
      signoff &&
      typeof signoff.day === "string" &&
      DAY.test(signoff.day) &&
      typeof signoff.shopId === "string" &&
      SHOPS.some((shop) => shop.id === signoff.shopId) &&
      typeof signoff.doneAt === "string",
  );
}

/** Records the first sign-off for a shop and day. A second call keeps the original time. */
export async function recordSignoff(day: string, shopId: ShopId, doneAt: string): Promise<RecordedSignoff> {
  const run = writeChain.then(() => writeSignoff(day, shopId, doneAt), () => writeSignoff(day, shopId, doneAt));
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeSignoff(day: string, shopId: ShopId, doneAt: string): Promise<RecordedSignoff> {
  const file = signoffFilePath();
  await mkdir(dirname(file), { recursive: true });
  const signoffs = await readSignoffs();
  const existing = signoffs.find((signoff) => signoff.day === day && signoff.shopId === shopId);
  if (existing) return existing;
  const next: RecordedSignoff = { day, shopId, doneAt };
  signoffs.push(next);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temporary, `${JSON.stringify({ signoffs }, null, 2)}\n`);
  await rename(temporary, file);
  return next;
}

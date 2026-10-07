import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { liveDataPath, readStoredJson, seedDataPath } from "@/lib/durable-file";
import { applyConfirmations, submitRefusal, type FullbayConfirmResult, type FullbayEditBatch, type FullbayQueueRequest } from "@/lib/fullbay-edit-queue";
import { readSignoffs } from "@/lib/signoff-store";

let writeChain: Promise<unknown> = Promise.resolve();

export function queueFilePath(): string {
  return liveDataPath(process.env.FULLBAY_EDIT_QUEUE_PATH, "fullbay-edit-queue.json");
}

export function queueSeedPath(): string {
  return seedDataPath(process.env.FULLBAY_EDIT_QUEUE_SEED_PATH, "fullbay-edit-queue.seed.json");
}

/** When FULLBAY_EDIT_QUEUE_TOKEN is unset, the demo queue stays open. POST and confirm send x-fullbay-edit-token when it is set. */
export function queueAuthorized(request: Request): boolean {
  const token = process.env.FULLBAY_EDIT_QUEUE_TOKEN;
  if (!token) return true;
  return request.headers.get("x-fullbay-edit-token") === token;
}

export async function readQueue(): Promise<FullbayEditBatch[]> {
  const parsed = await readStoredJson(queueFilePath(), queueSeedPath());
  if (!parsed || typeof parsed !== "object") return [];
  const batches = (parsed as { batches?: FullbayEditBatch[] }).batches;
  return Array.isArray(batches) ? batches : [];
}

export async function enqueueBatch(request: FullbayQueueRequest, id = crypto.randomUUID()): Promise<FullbayEditBatch> {
  const batch: FullbayEditBatch = { id, ...request, days: [...request.days].sort() };
  await withQueueLock(async () => {
    const batches = await readQueue();
    batches.push(batch);
    await writeQueue(batches);
  });
  return batch;
}

/** Writes a batch only when none of its shop days are signed off or already queued. */
export async function enqueueIfAllowed(
  request: FullbayQueueRequest,
  id = crypto.randomUUID(),
): Promise<{ ok: true; batch: FullbayEditBatch } | { ok: false; error: string }> {
  const batch: FullbayEditBatch = { id, ...request, days: [...request.days].sort() };
  return withQueueLock(async () => {
    const batches = await readQueue();
    const signoffs = await readSignoffs();
    const refusal = submitRefusal(batches, signoffs, batch);
    if (refusal) return { ok: false, error: refusal };
    batches.push(batch);
    await writeQueue(batches);
    return { ok: true, batch };
  });
}

export async function confirmQueuedBatch(
  batchId: string,
  results: FullbayConfirmResult[],
  now: string,
): Promise<{ ok: true; batch: FullbayEditBatch } | { ok: false; status: number; error: string }> {
  return withQueueLock(async () => {
    const batches = await readQueue();
    const index = batches.findIndex((batch) => batch.id === batchId);
    const current = index >= 0 ? batches[index] : undefined;
    if (!current) return { ok: false, status: 404, error: "Batch not found." };
    const applied = applyConfirmations(current, results, now);
    if (!applied.ok) return { ok: false, status: 400, error: applied.error };
    batches[index] = applied.batch;
    await writeQueue(batches);
    return { ok: true, batch: applied.batch };
  });
}

async function withQueueLock<T>(work: () => Promise<T>): Promise<T> {
  const run = writeChain.then(work, work);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeQueue(batches: FullbayEditBatch[]): Promise<void> {
  const file = queueFilePath();
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ temporary, `${JSON.stringify({ batches }, null, 2)}\n`);
  await rename(temporary, file);
}

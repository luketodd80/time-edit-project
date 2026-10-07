import { formatTimestamp } from "@/lib/dates";
import { shopName } from "@/lib/review";
import { SHOPS, type PlannedEdit, type ShopFilter, type ShopId, type Submission } from "@/lib/types";
import { formatClock } from "@/lib/time";

export type FullbayApplyStatus = "pending" | "applied" | "failed";

/** One accepted or overridden clock edit waiting for a Fullbay Time Stamp apply. */
export interface FullbayQueueEdit {
  findingId: string;
  day: string;
  shopId: ShopId;
  shopName: string;
  techName: string;
  orderId: string;
  work: string;
  decision: "accept" | "override";
  newClockIn: string;
  newClockOut: string;
  minutes: number;
  status: FullbayApplyStatus;
  appliedAt: string | null;
  applyNote: string | null;
}

export interface FullbayEditBatch {
  id: string;
  submittedAt: string;
  shopId: ShopFilter;
  days: string[];
  edits: FullbayQueueEdit[];
}

export interface FullbayQueueRequest {
  submittedAt: string;
  shopId: ShopFilter;
  days: string[];
  edits: FullbayQueueEdit[];
}

export interface FullbayConfirmResult {
  findingId: string;
  status: "applied" | "failed";
  applyNote?: string | null;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SHOP_IDS = new Set<string>(SHOPS.map((shop) => shop.id));

/** Accepted and overridden plan rows only. Rejected rows stay out of the apply queue. */
export function queueEditFromPlanned(edit: PlannedEdit): FullbayQueueEdit {
  if (edit.decision !== "accept" && edit.decision !== "override") {
    throw new Error("Only accepted and overridden edits are queued.");
  }
  return {
    findingId: edit.findingId,
    day: edit.day,
    shopId: edit.shopId,
    shopName: shopName(edit.shopId),
    techName: edit.techName,
    orderId: edit.orderId,
    work: edit.work,
    decision: edit.decision,
    newClockIn: edit.start,
    newClockOut: edit.end,
    minutes: edit.minutes,
    status: "pending",
    appliedAt: null,
    applyNote: null,
  };
}

export function submissionToQueueRequest(submission: Submission): FullbayQueueRequest {
  return {
    submittedAt: submission.submittedAt,
    shopId: submission.shopId,
    days: [...submission.days].sort(),
    edits: submission.edits.map(queueEditFromPlanned),
  };
}

export function parseQueueRequest(body: unknown): { ok: true; value: FullbayQueueRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Expected a JSON object." };
  const record = body as Record<string, unknown>;
  const submittedAt = record.submittedAt;
  if (typeof submittedAt !== "string" || Number.isNaN(Date.parse(submittedAt))) {
    return { ok: false, error: "submittedAt must be an ISO timestamp." };
  }
  const shopId = record.shopId;
  if (typeof shopId !== "string" || (shopId !== "all" && !SHOP_IDS.has(shopId))) {
    return { ok: false, error: "shopId must be all or a known shop." };
  }
  if (!Array.isArray(record.days) || record.days.some((day) => typeof day !== "string" || !DAY.test(day))) {
    return { ok: false, error: "days must be YYYY-MM-DD values." };
  }
  const days = (record.days as string[]).slice().sort();
  if (!Array.isArray(record.edits)) return { ok: false, error: "edits must be an array." };

  const edits: FullbayQueueEdit[] = [];
  const seen = new Set<string>();
  for (const item of record.edits) {
    const parsed = parseQueueEdit(item);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.findingId)) return { ok: false, error: `Duplicate finding ${parsed.value.findingId}.` };
    seen.add(parsed.value.findingId);
    edits.push(parsed.value);
  }

  return {
    ok: true,
    value: {
      submittedAt,
      shopId: shopId as ShopFilter,
      days,
      edits,
    },
  };
}

function parseQueueEdit(item: unknown): { ok: true; value: FullbayQueueEdit } | { ok: false; error: string } {
  if (!item || typeof item !== "object") return { ok: false, error: "Each edit must be an object." };
  const edit = item as Record<string, unknown>;
  const findingId = requiredText(edit.findingId, "findingId");
  if (!findingId.ok) return findingId;
  const day = edit.day;
  if (typeof day !== "string" || !DAY.test(day)) return { ok: false, error: "Each edit day must be YYYY-MM-DD." };
  const shopId = edit.shopId;
  if (typeof shopId !== "string" || !SHOP_IDS.has(shopId)) return { ok: false, error: "Each edit shopId must be a known shop." };
  const techName = requiredText(edit.techName, "techName");
  if (!techName.ok) return techName;
  const orderId = requiredText(edit.orderId, "orderId");
  if (!orderId.ok) return orderId;
  if (typeof edit.work !== "string") return { ok: false, error: "Each edit work must be a string." };
  if (edit.decision !== "accept" && edit.decision !== "override") {
    return { ok: false, error: "Each edit decision must be accept or override." };
  }
  if (typeof edit.newClockIn !== "string" || !CLOCK.test(edit.newClockIn)) {
    return { ok: false, error: "newClockIn must be HH:MM." };
  }
  if (typeof edit.newClockOut !== "string" || !CLOCK.test(edit.newClockOut)) {
    return { ok: false, error: "newClockOut must be HH:MM." };
  }
  if (typeof edit.minutes !== "number" || !Number.isFinite(edit.minutes) || edit.minutes < 0) {
    return { ok: false, error: "minutes must be a non-negative number." };
  }
  return {
    ok: true,
    value: {
      findingId: findingId.value,
      day,
      shopId: shopId as ShopId,
      shopName: shopName(shopId as ShopId),
      techName: techName.value,
      orderId: orderId.value,
      work: edit.work,
      decision: edit.decision,
      newClockIn: edit.newClockIn,
      newClockOut: edit.newClockOut,
      minutes: edit.minutes,
      status: "pending",
      appliedAt: null,
      applyNote: null,
    },
  };
}

function requiredText(value: unknown, label: string): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof value !== "string" || value.trim().length === 0) return { ok: false, error: `${label} is required.` };
  return { ok: true, value: value.trim() };
}

export function latestBatch(batches: FullbayEditBatch[]): FullbayEditBatch | null {
  if (batches.length === 0) return null;
  return [...batches].sort(compareBatchDesc)[0] ?? null;
}

export function pendingBatches(batches: FullbayEditBatch[]): FullbayEditBatch[] {
  return [...batches].filter((batch) => batch.edits.some((edit) => edit.status === "pending")).sort(compareBatchDesc);
}

export function batchForSubmission(batches: FullbayEditBatch[], submission: Submission): FullbayEditBatch | null {
  const days = [...submission.days].sort().join("\0");
  const matches = batches.filter(
    (batch) => batch.submittedAt === submission.submittedAt && batch.shopId === submission.shopId && [...batch.days].sort().join("\0") === days,
  );
  return matches.sort(compareBatchDesc)[0] ?? null;
}

/** Latest queued batch whose filter covers this shop day. Rejected-only batches have no edits and do not block. */
export function unappliedEditsForShopDay(batches: FullbayEditBatch[], day: string, shopId: ShopId): FullbayQueueEdit[] {
  const matching = batches.filter((batch) => batch.days.includes(day) && (batch.shopId === "all" || batch.shopId === shopId));
  const latest = matching.sort(compareBatchDesc)[0];
  if (!latest) return [];
  return latest.edits.filter((edit) => edit.day === day && edit.shopId === shopId && edit.status !== "applied");
}

export function signoffApplyBlock(batches: FullbayEditBatch[], day: string, shopId: ShopId): string | null {
  const edits = unappliedEditsForShopDay(batches, day, shopId);
  if (edits.length === 0) return null;
  const names = edits.map((edit) => `${edit.techName} ${edit.orderId} (${edit.status})`).join(", ");
  return `Fullbay apply is not confirmed for ${names}. Mark the day done after each accepted edit is confirmed applied.`;
}

export function applyConfirmations(
  batch: FullbayEditBatch,
  results: FullbayConfirmResult[],
  now: string,
): { ok: true; batch: FullbayEditBatch } | { ok: false; error: string } {
  if (results.length === 0) return { ok: false, error: "results must include at least one edit." };
  const ids = new Set(batch.edits.map((edit) => edit.findingId));
  for (const result of results) {
    if (!result || typeof result.findingId !== "string" || !ids.has(result.findingId)) {
      return { ok: false, error: `Unknown finding ${result?.findingId ?? ""}.` };
    }
    if (result.status !== "applied" && result.status !== "failed") {
      return { ok: false, error: "Status must be applied or failed." };
    }
  }
  const byId = new Map(results.map((result) => [result.findingId, result]));
  return {
    ok: true,
    batch: {
      ...batch,
      edits: batch.edits.map((edit) => {
        const result = byId.get(edit.findingId);
        if (!result) return edit;
        const note = typeof result.applyNote === "string" && result.applyNote.trim().length > 0 ? result.applyNote.trim() : null;
        return {
          ...edit,
          status: result.status,
          appliedAt: result.status === "applied" ? now : null,
          applyNote: note,
        };
      }),
    },
  };
}

function compareBatchDesc(a: FullbayEditBatch, b: FullbayEditBatch): number {
  if (a.submittedAt !== b.submittedAt) return a.submittedAt < b.submittedAt ? 1 : -1;
  return a.id < b.id ? 1 : -1;
}

/** Newest queued edit for a finding. A later confirm replaces an earlier one. */
export function latestQueueEdit(batches: FullbayEditBatch[], findingId: string): FullbayQueueEdit | null {
  const matches = batches.flatMap((batch) => batch.edits.filter((edit) => edit.findingId === findingId).map((edit) => ({ edit, batch })));
  matches.sort((a, b) => compareBatchDesc(a.batch, b.batch));
  return matches[0]?.edit ?? null;
}

/** Review copy for a queued finding. Applied rows are done. Failed rows carry the confirm note. */
export function reviewApplyText(edit: FullbayQueueEdit): string {
  const times = `${edit.orderId} ${formatClock(edit.newClockIn)}–${formatClock(edit.newClockOut)}`;
  if (edit.status === "failed") {
    return edit.applyNote ? `Fullbay apply failed. ${times}. ${edit.applyNote}` : `Fullbay apply failed. ${times}.`;
  }
  if (edit.status === "pending") return `Pending Fullbay apply. ${times}.`;
  const when = edit.appliedAt ? ` ${formatTimestamp(edit.appliedAt)}` : "";
  return edit.applyNote ? `Applied in Fullbay${when}. ${times}. ${edit.applyNote}` : `Applied in Fullbay${when}. ${times}.`;
}

export interface ShopDayRef {
  day: string;
  shopId: ShopId;
}

export interface RecordedSignoff extends ShopDayRef {
  doneAt: string;
}

/** Shop/day pairs a submit covers. All shops expands to every shop. */
export function shopDaysCovered(shopId: ShopFilter, days: string[]): ShopDayRef[] {
  const shops = shopId === "all" ? SHOPS.map((shop) => shop.id) : [shopId];
  const pairs: ShopDayRef[] = [];
  for (const day of days) {
    for (const id of shops) pairs.push({ day, shopId: id });
  }
  return pairs;
}

function pairKey(day: string, shopId: ShopId): string {
  return `${day}|${shopId}`;
}

function labelPairs(pairs: ShopDayRef[]): string {
  return pairs.map((pair) => `${shopName(pair.shopId)} ${pair.day}`).join(", ");
}

/**
 * Refuse another submit when any covered shop and day is signed off or already queued.
 * An all-shops batch counts as submitted for every shop on those days.
 */
export function submitRefusal(
  batches: FullbayEditBatch[],
  signoffs: RecordedSignoff[],
  request: { shopId: ShopFilter; days: string[]; edits?: ShopDayRef[] },
): string | null {
  const pairs = shopDaysCovered(request.shopId, request.days);
  const seen = new Set(pairs.map((pair) => pairKey(pair.day, pair.shopId)));
  for (const edit of request.edits ?? []) {
    const key = pairKey(edit.day, edit.shopId);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ day: edit.day, shopId: edit.shopId });
  }

  const signed = pairs.filter((pair) => signoffs.some((signoff) => signoff.day === pair.day && signoff.shopId === pair.shopId && signoff.doneAt));
  if (signed.length > 0) {
    return `Already signed off: ${labelPairs(signed)}. Submit is closed for a signed-off shop and day.`;
  }

  const submitted = new Set<string>();
  for (const batch of batches) {
    for (const pair of shopDaysCovered(batch.shopId, batch.days)) submitted.add(pairKey(pair.day, pair.shopId));
  }
  const again = pairs.filter((pair) => submitted.has(pairKey(pair.day, pair.shopId)));
  if (again.length > 0) {
    return `Already submitted: ${labelPairs(again)}. Submit is closed for a shop and day that was already submitted.`;
  }
  return null;
}

export type ShopDayLock = "open" | "signed-off" | "submitted";

export function shopDayLock(
  batches: FullbayEditBatch[],
  signoffs: RecordedSignoff[],
  day: string,
  shopId: ShopId,
): ShopDayLock {
  if (signoffs.some((signoff) => signoff.day === day && signoff.shopId === shopId && signoff.doneAt)) return "signed-off";
  const submitted = batches.some((batch) =>
    shopDaysCovered(batch.shopId, batch.days).some((pair) => pair.day === day && pair.shopId === shopId),
  );
  return submitted ? "submitted" : "open";
}

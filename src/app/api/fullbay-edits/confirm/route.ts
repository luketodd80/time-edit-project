import { AUTO_SIGNOFF_NOTE, isClockTime, shopDaysCovered, shopDaysToAutoSignOff, type FullbayConfirmResult } from "@/lib/fullbay-edit-queue";
import { confirmQueuedBatch, queueAuthorized, readQueue } from "@/lib/fullbay-edit-queue-store";
import { requiredDecisionFindingIds } from "@/lib/review";
import { SEED } from "@/lib/seed";
import { recordAutoSignoffs } from "@/lib/signoff-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!queueAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ ok: false, error: "Expected a JSON object." }, { status: 400 });
  const record = body as Record<string, unknown>;
  if (typeof record.batchId !== "string" || record.batchId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "batchId is required." }, { status: 400 });
  }
  if (!Array.isArray(record.results)) return NextResponse.json({ ok: false, error: "results must be an array." }, { status: 400 });
  const results: FullbayConfirmResult[] = [];
  for (const item of record.results) {
    if (!item || typeof item !== "object") return NextResponse.json({ ok: false, error: "Each result must be an object." }, { status: 400 });
    const result = item as Record<string, unknown>;
    if (typeof result.findingId !== "string" || (result.status !== "applied" && result.status !== "failed" && result.status !== "already_done")) {
      return NextResponse.json({ ok: false, error: "Each result needs a findingId and status applied, failed, or already_done." }, { status: 400 });
    }
    if (result.applyNote != null && typeof result.applyNote !== "string") {
      return NextResponse.json({ ok: false, error: "applyNote must be a string." }, { status: 400 });
    }
    const currentClockIn = optionalClock(result.currentClockIn, "currentClockIn");
    if (!currentClockIn.ok) return NextResponse.json({ ok: false, error: currentClockIn.error }, { status: 400 });
    const currentClockOut = optionalClock(result.currentClockOut, "currentClockOut");
    if (!currentClockOut.ok) return NextResponse.json({ ok: false, error: currentClockOut.error }, { status: 400 });
    results.push({
      findingId: result.findingId,
      status: result.status,
      applyNote: typeof result.applyNote === "string" ? result.applyNote : null,
      currentClockIn: result.status === "already_done" ? currentClockIn.value : null,
      currentClockOut: result.status === "already_done" ? currentClockOut.value : null,
    });
  }
  const now = new Date().toISOString();
  const confirmed = await confirmQueuedBatch(record.batchId.trim(), results, now);
  if (!confirmed.ok) return NextResponse.json({ ok: false, error: confirmed.error }, { status: confirmed.status });
  const batches = await readQueue();
  const ready = shopDaysToAutoSignOff(batches, shopDaysCovered(confirmed.batch.shopId, confirmed.batch.days), (pair) =>
    requiredDecisionFindingIds(SEED, pair),
  );
  const autoSignedOff = await recordAutoSignoffs(ready, now, AUTO_SIGNOFF_NOTE);
  return NextResponse.json({ ok: true, batch: confirmed.batch, autoSignedOff });
}

function optionalClock(value: unknown, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || !isClockTime(value)) return { ok: false, error: `${label} must be HH:MM.` };
  return { ok: true, value };
}

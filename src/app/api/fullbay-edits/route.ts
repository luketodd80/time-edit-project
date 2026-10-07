import { AUTO_SIGNOFF_NOTE, parseQueueRequest, shopDaysCovered, shopDaysToAutoSignOff } from "@/lib/fullbay-edit-queue";
import { enqueueIfAllowed, queueAuthorized, readQueue } from "@/lib/fullbay-edit-queue-store";
import { requiredDecisionFindingIds } from "@/lib/review";
import { SEED } from "@/lib/seed";
import { recordAutoSignoffs } from "@/lib/signoff-store";
import { notifySubmitWebhook } from "@/lib/submit-webhook";
import type { ShopFilter } from "@/lib/types";
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
  const parsed = parseQueueRequest(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const stored = await enqueueIfAllowed(parsed.value);
  if (!stored.ok) return NextResponse.json({ ok: false, error: stored.error }, { status: 409 });
  const autoSignedOff = await signOffReadyShopDays(stored.batch.shopId, stored.batch.days);
  await notifySubmitWebhook(stored.batch);
  return NextResponse.json({ ok: true, id: stored.batch.id, editCount: stored.batch.edits.length, autoSignedOff });
}

async function signOffReadyShopDays(shopId: ShopFilter, days: string[]) {
  const batches = await readQueue();
  const ready = shopDaysToAutoSignOff(batches, shopDaysCovered(shopId, days), (pair) => requiredDecisionFindingIds(SEED, pair));
  return recordAutoSignoffs(ready, new Date().toISOString(), AUTO_SIGNOFF_NOTE);
}

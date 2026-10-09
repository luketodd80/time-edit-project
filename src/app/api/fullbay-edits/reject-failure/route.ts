import { AUTO_SIGNOFF_NOTE, shopDaysCovered, shopDaysToAutoSignOff } from "@/lib/fullbay-edit-queue";
import { queueAuthorized, readQueue, rejectFailedEdit } from "@/lib/fullbay-edit-queue-store";
import { requiredDecisionFindingIds } from "@/lib/review";
import { SEED } from "@/lib/seed";
import { credentialsFromAuthorization, siteUser } from "@/lib/site-auth";
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
  const findingId = (body as { findingId?: unknown }).findingId;
  if (typeof findingId !== "string" || findingId.trim().length === 0) {
    return NextResponse.json({ ok: false, error: "findingId is required." }, { status: 400 });
  }
  const now = new Date().toISOString();
  const rejected = await rejectFailedEdit(findingId.trim(), actorFrom(request), now);
  if (!rejected.ok) return NextResponse.json({ ok: false, error: rejected.error }, { status: rejected.status });
  const batches = await readQueue();
  const ready = shopDaysToAutoSignOff(batches, shopDaysCovered(rejected.batch.shopId, rejected.batch.days), (pair) =>
    requiredDecisionFindingIds(SEED, pair),
  );
  const autoSignedOff = await recordAutoSignoffs(ready, now, AUTO_SIGNOFF_NOTE);
  return NextResponse.json({ ok: true, batch: rejected.batch, autoSignedOff });
}

function actorFrom(request: Request): string {
  const credentials = credentialsFromAuthorization(request.headers.get("authorization"));
  const named = credentials?.user.trim() ?? "";
  return named.length > 0 ? named : siteUser({ SITE_USER: process.env.SITE_USER });
}

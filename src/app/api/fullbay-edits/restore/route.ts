import { parseRestoreRequest } from "@/lib/fullbay-edit-queue";
import { queueAuthorized, upsertQueuedBatches } from "@/lib/fullbay-edit-queue-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Puts batches back by id after a deploy wipes the live queue file.
 * This does not call the submit webhook and does not change sign-offs.
 */
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
  const parsed = parseRestoreRequest(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const restored = await upsertQueuedBatches(parsed.batches);
  return NextResponse.json({ ok: true, upserted: restored.upserted });
}

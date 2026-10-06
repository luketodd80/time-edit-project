import { parseQueueRequest } from "@/lib/fullbay-edit-queue";
import { enqueueBatch, queueAuthorized } from "@/lib/fullbay-edit-queue-store";
import { notifySubmitWebhook } from "@/lib/submit-webhook";
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
  const batch = await enqueueBatch(parsed.value);
  await notifySubmitWebhook(batch);
  return NextResponse.json({ ok: true, id: batch.id, editCount: batch.edits.length });
}

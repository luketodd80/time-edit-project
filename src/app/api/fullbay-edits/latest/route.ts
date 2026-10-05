import { latestBatch } from "@/lib/fullbay-edit-queue";
import { readQueue } from "@/lib/fullbay-edit-queue-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `batch` is the newest submission. `batches` is the whole queue so sign-off can use the latest batch for one shop day. */
export async function GET() {
  const batches = await readQueue();
  return NextResponse.json({ batch: latestBatch(batches), batches });
}

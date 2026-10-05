import { pendingBatches } from "@/lib/fullbay-edit-queue";
import { readQueue } from "@/lib/fullbay-edit-queue-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const batches = pendingBatches(await readQueue());
  return NextResponse.json({ batches });
}

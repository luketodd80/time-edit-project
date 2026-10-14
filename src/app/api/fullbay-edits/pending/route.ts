import { pendingBatches } from "@/lib/fullbay-edit-queue";
import { supersedeMoveTimePending } from "@/lib/fullbay-edit-queue-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const batches = pendingBatches(await supersedeMoveTimePending());
  return NextResponse.json({ batches });
}

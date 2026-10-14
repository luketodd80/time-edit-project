import { queueAuthorized } from "@/lib/fullbay-edit-queue-store";
import { openMoveTimeLeftovers, readMoveTimeLeftovers } from "@/lib/move-time-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!queueAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const findings = await readMoveTimeLeftovers();
  return NextResponse.json({ ok: true, opened: findings.length > 0, findings });
}

/** Opens the Cody, David, and Nick move-time rows. Sign-offs and the edit queue stay as they are. */
export async function POST(request: Request) {
  if (!queueAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const opened = await openMoveTimeLeftovers(new Date().toISOString());
  return NextResponse.json({ ok: true, openedAt: opened.openedAt, findings: opened.findings });
}

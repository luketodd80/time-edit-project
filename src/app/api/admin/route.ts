import { buildAdminPayload, isRangePreset, presetBounds } from "@/lib/admin";
import { todayInNewYork } from "@/lib/dates";
import { queueAuthorized, readQueue } from "@/lib/fullbay-edit-queue-store";
import { readSignoffs } from "@/lib/signoff-store";
import { SEED } from "@/lib/seed";
import { snapshotFromReports } from "@/lib/utilization-history";
import { syncUtilizationHistory } from "@/lib/utilization-history-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!queueAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const today = todayInNewYork();
  const preset = url.searchParams.get("preset");
  let start = url.searchParams.get("from");
  let end = url.searchParams.get("to");
  if (preset && isRangePreset(preset)) {
    const bounds = presetBounds(preset, today);
    start = bounds.start;
    end = bounds.end;
  }
  if (!start || !end || !DAY.test(start) || !DAY.test(end) || start > end) {
    return NextResponse.json({ ok: false, error: "from and to must be YYYY-MM-DD, with from on or before to." }, { status: 400 });
  }
  const batches = await readQueue();
  const signoffs = await readSignoffs();
  const history = await syncUtilizationHistory(snapshotFromReports(SEED, batches));
  const admin = buildAdminPayload({ today, start, end, reports: SEED, batches, signoffs, history });
  return NextResponse.json({ ok: true, ...admin });
}

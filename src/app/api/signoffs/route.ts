import { SHOPS, type ShopId } from "@/lib/types";
import { queueAuthorized } from "@/lib/fullbay-edit-queue-store";
import { readSignoffs, recordSignoff } from "@/lib/signoff-store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  if (!queueAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const signoffs = await readSignoffs();
  return NextResponse.json({ ok: true, signoffs });
}

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
  if (typeof record.day !== "string" || !DAY.test(record.day)) {
    return NextResponse.json({ ok: false, error: "day must be YYYY-MM-DD." }, { status: 400 });
  }
  if (typeof record.shopId !== "string" || !SHOPS.some((shop) => shop.id === record.shopId)) {
    return NextResponse.json({ ok: false, error: "shopId must be a known shop." }, { status: 400 });
  }
  const signoff = await recordSignoff(record.day, record.shopId as ShopId, new Date().toISOString());
  return NextResponse.json({ ok: true, signoff });
}

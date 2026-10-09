import { shopIdForOrderId } from "@/lib/fullbay-timesheet";
import type { Decision, Finding, NonProEditPayload, NonProEditType, ShopId } from "@/lib/types";
import { clockFromMinutes, formatClock, parseClock } from "@/lib/time";

const ORDER_ID = /^[A-Za-z]{1,3}-\d+$/;

/** Uppercase a typed service-order number, or null when it is not shop-prefix plus digits. */
export function normalizeOrderId(value: string): string | null {
  const trimmed = value.trim().toUpperCase();
  if (!ORDER_ID.test(trimmed)) return null;
  if (!shopIdForOrderId(trimmed)) return null;
  return trimmed;
}

/**
 * Pull a split clock into the open span, at least one minute from each end.
 * A time outside the span is clamped. An empty or unparsable time is rejected.
 */
export function clampSplitTime(split: string, start: string, end: string): string | null {
  const spanStart = parseClock(start);
  const spanEnd = parseClock(end);
  const raw = parseClock(split);
  if (spanStart == null || spanEnd == null || raw == null || spanEnd - spanStart < 2) return null;
  const clamped = Math.min(spanEnd - 1, Math.max(spanStart + 1, raw));
  return clockFromMinutes(clamped);
}

/** A starting split in the middle of the span, still at least one minute from each end. */
export function splitMidpoint(start: string, end: string): string | null {
  const spanStart = parseClock(start);
  const spanEnd = parseClock(end);
  if (spanStart == null || spanEnd == null || spanEnd - spanStart < 2) return null;
  const mid = Math.round((spanStart + spanEnd) / 2);
  return clockFromMinutes(Math.min(spanEnd - 1, Math.max(spanStart + 1, mid)));
}

export function nonProEditType(decision: Decision | undefined): NonProEditType | null {
  if (!decision) return null;
  if (decision.nonProEditType) return decision.nonProEditType;
  if (decision.kind === "reject") return "keep";
  return null;
}

export type NonProBuild = { ok: true; payload: NonProEditPayload; minutes: number } | { ok: false; error: string };

/** Exact Fullbay times for a Non-Pro decision. Keep adds no service-order minutes and no rows. */
export function buildNonProEdit(finding: Finding, decision: Decision | undefined): NonProBuild {
  const review = finding.nonPro;
  if (!review) return { ok: false, error: "This row is not a Non-Pro review." };
  const editType = nonProEditType(decision);
  if (!editType) return { ok: false, error: "Choose what to do with this Non-Pro row." };
  const originalClockIn = finding.start;
  const originalClockOut = finding.end;

  if (editType === "keep") {
    return { ok: true, minutes: 0, payload: { editType, originalClockIn, originalClockOut, rows: [] } };
  }

  if (editType === "extend_prev_out") {
    const previous = review.previous;
    if (!previous) return { ok: false, error: "There is no earlier service order that can take this span." };
    return {
      ok: true,
      minutes: finding.minutes,
      payload: {
        editType,
        originalClockIn,
        originalClockOut,
        rows: [
          {
            orderId: previous.orderId,
            work: previous.work,
            shopId: previous.shopId,
            clockIn: previous.clockIn,
            clockOut: previous.clockOut,
            newClockIn: previous.clockIn,
            newClockOut: originalClockOut,
          },
        ],
      },
    };
  }

  if (editType === "move_next_in") {
    const next = review.next;
    if (!next) return { ok: false, error: "There is no later service order that can take this span." };
    return {
      ok: true,
      minutes: finding.minutes,
      payload: {
        editType,
        originalClockIn,
        originalClockOut,
        rows: [
          {
            orderId: next.orderId,
            work: next.work,
            shopId: next.shopId,
            clockIn: next.clockIn,
            clockOut: next.clockOut,
            newClockIn: originalClockIn,
            newClockOut: next.clockOut,
          },
        ],
      },
    };
  }

  if (editType === "split") {
    const previous = review.previous;
    const next = review.next;
    if (!review.canSplit || !previous || !next) return { ok: false, error: "A split needs a service order on both sides." };
    const split = clampSplitTime(decision?.split ?? "", originalClockIn, originalClockOut);
    if (!split) return { ok: false, error: "Enter a split time inside the Non-Pro span." };
    return {
      ok: true,
      minutes: finding.minutes,
      payload: {
        editType,
        originalClockIn,
        originalClockOut,
        rows: [
          {
            orderId: previous.orderId,
            work: previous.work,
            shopId: previous.shopId,
            clockIn: previous.clockIn,
            clockOut: previous.clockOut,
            newClockIn: previous.clockIn,
            newClockOut: split,
          },
          {
            orderId: next.orderId,
            work: next.work,
            shopId: next.shopId,
            clockIn: next.clockIn,
            clockOut: next.clockOut,
            newClockIn: split,
            newClockOut: next.clockOut,
          },
        ],
      },
    };
  }

  const orderId = normalizeOrderId(decision?.targetOrderId ?? "");
  if (!orderId) return { ok: false, error: "Enter a service order number such as D-90273." };
  const known = review.orders.find((order) => order.orderId === orderId);
  const shopId: ShopId | null = known?.shopId ?? shopIdForOrderId(orderId);
  if (!shopId) return { ok: false, error: "Enter a service order number such as D-90273." };
  return {
    ok: true,
    minutes: finding.minutes,
    payload: {
      editType,
      originalClockIn,
      originalClockOut,
      rows: [
        {
          orderId,
          work: known?.work ?? "",
          shopId,
          clockIn: originalClockIn,
          clockOut: originalClockOut,
          newClockIn: originalClockIn,
          newClockOut: originalClockOut,
        },
      ],
    },
  };
}

/** One line a confirmation can show for a Non-Pro payload. */
export function describeNonProEdit(payload: NonProEditPayload): string {
  const original = `${formatClock(payload.originalClockIn)}–${formatClock(payload.originalClockOut)}`;
  if (payload.editType === "keep") return `Keep as Non-Pro ${original}. No Fullbay change.`;
  const rows = payload.rows
    .map((row) => {
      const work = row.work ? ` / ${row.work}` : "";
      return `${row.orderId}${work}: ${formatClock(row.clockIn)}–${formatClock(row.clockOut)} becomes ${formatClock(row.newClockIn)}–${formatClock(row.newClockOut)}`;
    })
    .join("; ");
  const label =
    payload.editType === "extend_prev_out"
      ? "Extend the previous clock-out"
      : payload.editType === "move_next_in"
        ? "Move the next clock-in back"
        : payload.editType === "split"
          ? "Split"
          : "Move onto another service order";
  return `${label}. Non-Pro row was ${original}. ${rows}.`;
}

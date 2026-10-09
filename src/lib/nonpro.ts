import { shopIdForOrderId } from "@/lib/fullbay-timesheet";
import { SHOPS, type Decision, type Finding, type NonProAffectedRow, type NonProEditPayload, type NonProEditType, type NonProNeighbor, type NonProRemainder, type NonProReview, type ShopId } from "@/lib/types";
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

/**
 * A starting Non-Pro window for one remainder side.
 * One side needs three minutes (Non-Pro, a one-minute gap, and a minute for the service order).
 * Both sides need five.
 */
export function defaultKeptWindow(start: string, end: string, remainder: NonProRemainder): { start: string; end: string } | null {
  const spanStart = parseClock(start);
  const spanEnd = parseClock(end);
  if (spanStart == null || spanEnd == null) return null;
  const length = spanEnd - spanStart;
  if (remainder === "next") {
    if (length < 3) return null;
    const keptEnd = Math.min(spanStart + Math.max(1, Math.floor(length / 2)), spanEnd - 2);
    if (keptEnd <= spanStart) return null;
    return { start, end: clockFromMinutes(keptEnd) };
  }
  if (remainder === "previous") {
    if (length < 3) return null;
    const keptStart = Math.max(spanEnd - Math.max(1, Math.floor(length / 2)), spanStart + 2);
    if (keptStart >= spanEnd) return null;
    return { start: clockFromMinutes(keptStart), end };
  }
  if (length < 5) return null;
  const side = Math.max(1, Math.floor((length - 1) / 3));
  const keptStart = spanStart + side + 1;
  const keptEnd = spanEnd - side - 1;
  if (keptEnd - keptStart < 1) return null;
  return { start: clockFromMinutes(keptStart), end: clockFromMinutes(keptEnd) };
}

/** The remainder side to offer first, and a kept window inside the span. */
export function defaultPartialChoice(
  start: string,
  end: string,
  review: Pick<NonProReview, "previous" | "next">,
): { start: string; end: string; remainder: NonProRemainder } | null {
  const remainder: NonProRemainder | null = review.next && !review.previous ? "next" : review.previous && !review.next ? "previous" : review.previous && review.next ? "both" : null;
  if (!remainder) return null;
  const window = defaultKeptWindow(start, end, remainder);
  if (!window) return null;
  return { ...window, remainder };
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
  const spanStart = parseClock(originalClockIn);
  const spanEnd = parseClock(originalClockOut);
  if (spanStart == null || spanEnd == null || spanEnd <= spanStart) {
    return { ok: false, error: "This Non-Pro row has no clock span." };
  }
  const span = { start: spanStart, end: spanEnd, in: originalClockIn, out: originalClockOut };

  if (editType === "keep") {
    return { ok: true, minutes: 0, payload: { editType, originalClockIn, originalClockOut, rows: [] } };
  }
  if (editType === "extend_prev_out") return buildExtend(finding, decision, review, span);
  if (editType === "move_next_in") return buildMoveNext(finding, decision, review, span);
  if (editType === "split") return buildSplit(finding, decision, review, span);
  if (editType === "partial") return buildPartial(decision, review, span);
  return buildMoveToOrder(finding, decision, review, span);
}

interface Span {
  start: number;
  end: number;
  in: string;
  out: string;
}

function buildExtend(finding: Finding, decision: Decision | undefined, review: NonProReview, span: Span): NonProBuild {
  const previous = review.previous;
  if (!previous) return { ok: false, error: "There is no earlier service order that can take this span." };
  const requested = clockOr(decision?.end, span.out);
  const outMin = parseClock(requested);
  if (outMin == null || outMin <= span.start || outMin > span.end) {
    return { ok: false, error: `Enter a clock-out inside ${formatClock(span.in)}–${formatClock(span.out)}.` };
  }
  const prevOut = parseClock(previous.clockOut);
  const prevIn = parseClock(previous.clockIn);
  if (prevOut != null && outMin <= prevOut) {
    return { ok: false, error: "The new clock-out has to be after that service order's current clock-out." };
  }
  const overlap = overlapError(prevIn ?? span.start, outMin, previous, review.punches);
  if (overlap) return { ok: false, error: overlap };
  const kept = keptAfter(outMin, span.end);
  if (typeof kept === "string") return { ok: false, error: kept };
  return done(finding, span, "extend_prev_out", [affected(previous, previous.clockIn, clockFromMinutes(outMin))], outMin - span.start, kept);
}

function buildMoveNext(finding: Finding, decision: Decision | undefined, review: NonProReview, span: Span): NonProBuild {
  const next = review.next;
  if (!next) return { ok: false, error: "There is no later service order that can take this span." };
  const requested = clockOr(decision?.start, span.in);
  const inMin = parseClock(requested);
  if (inMin == null || inMin < span.start || inMin >= span.end) {
    return { ok: false, error: `Enter a clock-in inside ${formatClock(span.in)}–${formatClock(span.out)}, before the end of this row.` };
  }
  const nextOut = parseClock(next.clockOut);
  if (nextOut == null || inMin >= nextOut) {
    return { ok: false, error: "The new clock-in has to be before that service order's clock-out." };
  }
  const overlap = overlapError(inMin, nextOut, next, review.punches);
  if (overlap) return { ok: false, error: overlap };
  const kept = keptBefore(span.start, inMin);
  if (typeof kept === "string") return { ok: false, error: kept };
  return done(finding, span, "move_next_in", [affected(next, clockFromMinutes(inMin), next.clockOut)], span.end - inMin, kept);
}

function buildSplit(finding: Finding, decision: Decision | undefined, review: NonProReview, span: Span): NonProBuild {
  const previous = review.previous;
  const next = review.next;
  if (!review.canSplit || !previous || !next) return { ok: false, error: "A split needs a service order on both sides." };
  const second = decision?.end?.trim() ?? "";
  let prevOut: number;
  let nextIn: number;
  if (second) {
    const parsedPrev = parseClock(decision?.split ?? "");
    const parsedNext = parseClock(second);
    if (parsedPrev == null || parsedPrev <= span.start || parsedPrev >= span.end) {
      return { ok: false, error: `Enter a previous clock-out inside ${formatClock(span.in)}–${formatClock(span.out)}.` };
    }
    if (parsedNext == null || parsedNext <= span.start || parsedNext >= span.end) {
      return { ok: false, error: `Enter a next clock-in inside ${formatClock(span.in)}–${formatClock(span.out)}.` };
    }
    if (parsedNext < parsedPrev) {
      return { ok: false, error: "The next clock-in has to be at or after the previous clock-out." };
    }
    prevOut = parsedPrev;
    nextIn = parsedNext;
  } else {
    const split = clampSplitTime(decision?.split ?? "", span.in, span.out);
    if (!split) return { ok: false, error: "Enter a split time inside the Non-Pro span." };
    prevOut = parseClock(split) ?? span.start;
    nextIn = prevOut;
  }
  const prevIn = parseClock(previous.clockIn) ?? span.start;
  const nextOut = parseClock(next.clockOut) ?? span.end;
  const overlapPrev = overlapError(prevIn, prevOut, previous, review.punches);
  if (overlapPrev) return { ok: false, error: overlapPrev };
  const overlapNext = overlapError(nextIn, nextOut, next, review.punches);
  if (overlapNext) return { ok: false, error: overlapNext };
  const kept = keptBetween(prevOut, nextIn);
  if (typeof kept === "string") return { ok: false, error: kept };
  const rows = [
    affected(previous, previous.clockIn, clockFromMinutes(prevOut)),
    affected(next, clockFromMinutes(nextIn), next.clockOut),
  ];
  return done(finding, span, "split", rows, prevOut - span.start + (span.end - nextIn), kept);
}

function buildPartial(decision: Decision | undefined, review: NonProReview, span: Span): NonProBuild {
  const remainder = decision?.nonProRemainder;
  if (remainder !== "previous" && remainder !== "next" && remainder !== "both") {
    return { ok: false, error: "Choose whether the rest goes to the previous service order, the next one, or both." };
  }
  if ((remainder === "previous" || remainder === "both") && !review.previous) {
    return { ok: false, error: "There is no earlier service order that can take the rest of this span." };
  }
  if ((remainder === "next" || remainder === "both") && !review.next) {
    return { ok: false, error: "There is no later service order that can take the rest of this span." };
  }
  const keptStart = parseClock(decision?.start ?? "");
  const keptEnd = parseClock(decision?.end ?? "");
  if (keptStart == null || keptEnd == null) return { ok: false, error: "Enter the Non-Pro start and end." };
  if (keptStart < span.start || keptEnd > span.end) {
    return { ok: false, error: `Keep the Non-Pro times inside ${formatClock(span.in)}–${formatClock(span.out)}.` };
  }
  if (keptEnd <= keptStart) return { ok: false, error: "The Non-Pro end has to be after its start." };
  const keptOverlap = overlapError(keptStart, keptEnd, null, review.punches);
  if (keptOverlap) return { ok: false, error: keptOverlap };

  const rows: NonProAffectedRow[] = [];
  let minutes = 0;
  if (remainder === "previous" || remainder === "both") {
    if (remainder === "previous" && keptEnd !== span.end) {
      return { ok: false, error: "End the Non-Pro portion at the end of the span, or give the rest to both sides." };
    }
    const soEnd = keptStart - 1;
    if (soEnd < span.start) {
      return { ok: false, error: "Leave at least one minute before the Non-Pro start for the previous service order." };
    }
    const previous = review.previous;
    if (!previous) return { ok: false, error: "There is no earlier service order that can take the rest of this span." };
    const prevOut = parseClock(previous.clockOut);
    const prevIn = parseClock(previous.clockIn) ?? span.start;
    if (prevOut != null && soEnd <= prevOut) {
      return { ok: false, error: "The new clock-out has to be after that service order's current clock-out." };
    }
    const overlap = overlapError(prevIn, soEnd, previous, review.punches);
    if (overlap) return { ok: false, error: overlap };
    rows.push(affected(previous, previous.clockIn, clockFromMinutes(soEnd)));
    minutes += soEnd - span.start;
  }
  if (remainder === "next" || remainder === "both") {
    if (remainder === "next" && keptStart !== span.start) {
      return { ok: false, error: "Start the Non-Pro portion at the beginning of the span, or give the rest to both sides." };
    }
    const soStart = keptEnd + 1;
    if (soStart >= span.end) {
      return { ok: false, error: "Leave at least one minute after the Non-Pro end for the next service order." };
    }
    const next = review.next;
    if (!next) return { ok: false, error: "There is no later service order that can take the rest of this span." };
    const nextOut = parseClock(next.clockOut);
    if (nextOut == null || soStart >= nextOut) {
      return { ok: false, error: "The new clock-in has to be before that service order's clock-out." };
    }
    const overlap = overlapError(soStart, nextOut, next, review.punches);
    if (overlap) return { ok: false, error: overlap };
    rows.push(affected(next, clockFromMinutes(soStart), next.clockOut));
    minutes += span.end - soStart;
  }
  return {
    ok: true,
    minutes,
    payload: {
      editType: "partial",
      originalClockIn: span.in,
      originalClockOut: span.out,
      rows,
      keptClockIn: clockFromMinutes(keptStart),
      keptClockOut: clockFromMinutes(keptEnd),
    },
  };
}

function buildMoveToOrder(finding: Finding, decision: Decision | undefined, review: NonProReview, span: Span): NonProBuild {
  const orderId = normalizeOrderId(decision?.targetOrderId ?? "");
  if (!orderId) return { ok: false, error: "Enter a service order number such as D-90273." };
  const known = review.orders.find((order) => order.orderId === orderId);
  const shopId: ShopId | null = known?.shopId ?? shopIdForOrderId(orderId);
  if (!shopId) return { ok: false, error: "Enter a service order number such as D-90273." };
  const inRaw = clockOr(decision?.start, span.in);
  const outRaw = clockOr(decision?.end, span.out);
  const inMin = parseClock(inRaw);
  const outMin = parseClock(outRaw);
  if (inMin == null || outMin == null || inMin < span.start || outMin > span.end) {
    return { ok: false, error: `Keep the moved times inside ${formatClock(span.in)}–${formatClock(span.out)}.` };
  }
  if (outMin <= inMin) return { ok: false, error: "The end has to be after the start." };
  if (inMin > span.start && outMin < span.end) {
    return { ok: false, error: "Move a block at the start or the end of the span. Use Keep part as Non-Pro to leave time on both sides." };
  }
  const overlap = overlapError(inMin, outMin, null, review.punches);
  if (overlap) return { ok: false, error: overlap };
  const kept = inMin > span.start ? keptBefore(span.start, inMin) : outMin < span.end ? keptAfter(outMin, span.end) : null;
  if (typeof kept === "string") return { ok: false, error: kept };
  const row: NonProAffectedRow = {
    orderId,
    work: known?.work ?? "",
    shopId,
    clockIn: clockFromMinutes(inMin),
    clockOut: clockFromMinutes(outMin),
    newClockIn: clockFromMinutes(inMin),
    newClockOut: clockFromMinutes(outMin),
  };
  return done(finding, span, "move_to_so", [row], outMin - inMin, kept);
}

function done(
  finding: Finding,
  span: Span,
  editType: Exclude<NonProEditType, "keep" | "partial">,
  rows: NonProAffectedRow[],
  covered: number,
  kept: { keptClockIn: string; keptClockOut: string } | null,
): NonProBuild {
  const whole = covered === span.end - span.start;
  return {
    ok: true,
    minutes: whole ? finding.minutes : covered,
    payload: {
      editType,
      originalClockIn: span.in,
      originalClockOut: span.out,
      rows,
      ...(kept ?? {}),
    },
  };
}

/** One-minute gap, then a Non-Pro row through `spanEnd`. Null when nothing is left to keep. */
function keptAfter(soEnd: number, spanEnd: number): { keptClockIn: string; keptClockOut: string } | null | string {
  if (soEnd >= spanEnd) return null;
  const keptStart = soEnd + 1;
  if (keptStart >= spanEnd) return null;
  return { keptClockIn: clockFromMinutes(keptStart), keptClockOut: clockFromMinutes(spanEnd) };
}

/** Non-Pro from the span start until one minute before `soStart`. */
function keptBefore(spanStart: number, soStart: number): { keptClockIn: string; keptClockOut: string } | null | string {
  if (soStart <= spanStart) return null;
  const keptEnd = soStart - 1;
  if (keptEnd <= spanStart) return null;
  return { keptClockIn: clockFromMinutes(spanStart), keptClockOut: clockFromMinutes(keptEnd) };
}

/** Non-Pro strictly between two service-order boundaries, with a one-minute gap on each side. */
function keptBetween(prevOut: number, nextIn: number): { keptClockIn: string; keptClockOut: string } | null | string {
  if (nextIn < prevOut) return "The next clock-in has to be at or after the previous clock-out.";
  if (nextIn <= prevOut + 1) return null;
  return { keptClockIn: clockFromMinutes(prevOut + 1), keptClockOut: clockFromMinutes(nextIn - 1) };
}

function overlapError(start: number, end: number, self: NonProNeighbor | null, punches: NonProNeighbor[]): string | null {
  if (!(end > start)) return "The end has to be after the start.";
  for (const punch of punches) {
    if (self && sameNeighbor(punch, self)) continue;
    const punchStart = parseClock(punch.clockIn);
    const punchEnd = parseClock(punch.clockOut);
    if (punchStart == null || punchEnd == null) continue;
    if (start < punchEnd && punchStart < end) {
      const work = punch.work ? ` / ${punch.work}` : "";
      return `That overlaps ${shopLabel(punch.shopId)} ${punch.orderId}${work} (${formatClock(punch.clockIn)}–${formatClock(punch.clockOut)}).`;
    }
  }
  return null;
}

function sameNeighbor(punch: NonProNeighbor, other: NonProNeighbor): boolean {
  return punch.orderId === other.orderId && punch.shopId === other.shopId && punch.clockIn === other.clockIn && punch.clockOut === other.clockOut;
}

function affected(neighbor: NonProNeighbor, newClockIn: string, newClockOut: string): NonProAffectedRow {
  return {
    orderId: neighbor.orderId,
    work: neighbor.work,
    shopId: neighbor.shopId,
    clockIn: neighbor.clockIn,
    clockOut: neighbor.clockOut,
    newClockIn,
    newClockOut,
  };
}

function clockOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallback;
}

function shopLabel(shopId: ShopId): string {
  return SHOPS.find((shop) => shop.id === shopId)?.name ?? shopId;
}

/** One line a confirmation can show for a Non-Pro payload. */
export function describeNonProEdit(payload: NonProEditPayload): string {
  const original = `${formatClock(payload.originalClockIn)}–${formatClock(payload.originalClockOut)}`;
  if (payload.editType === "keep") return `Keep as Non-Pro ${original}. No Fullbay change.`;
  const kept =
    payload.keptClockIn && payload.keptClockOut
      ? ` Keep ${formatClock(payload.keptClockIn)}–${formatClock(payload.keptClockOut)} as Non-Pro.`
      : "";
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
          : payload.editType === "partial"
            ? "Keep part as Non-Pro"
            : "Move onto another service order";
  return `${label}.${kept} Non-Pro row was ${original}. ${rows}.`;
}

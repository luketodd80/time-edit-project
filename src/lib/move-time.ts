import type { DayReport, Decision, Finding, NonProChange, Recommendation, ShopId } from "@/lib/types";
import { parseClock } from "@/lib/time";

/** Holes shorter than this are still "fully covered" by the surrounding Non-Pro punches. */
const COVERED_HOLE_SECONDS = 60;

const CLOCK = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Seconds since midnight. Accepts HH:MM and HH:MM:SS. */
export function parseClockOfDay(value: string): number | null {
  const match = CLOCK.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

export function clockOfDay(totalSeconds: number, withSeconds: boolean): string {
  const capped = Math.min(23 * 3600 + 59 * 60 + 59, Math.max(0, Math.round(totalSeconds)));
  const hours = Math.floor(capped / 3600);
  const minutes = Math.floor((capped % 3600) / 60);
  const seconds = capped % 60;
  const hhmm = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return withSeconds ? `${hhmm}:${String(seconds).padStart(2, "0")}` : hhmm;
}

/** 12-hour clock. Seconds are kept when the source has them, matching "8:00:45". */
export function formatMoveClock(value: string): string {
  const match = CLOCK.exec(value.trim());
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const body = match[3] ? `${hour12}:${minutes}:${match[3]}` : `${hour12}:${minutes}`;
  return `${body} ${suffix}`;
}

function minuteDelta(fromSeconds: number, toSeconds: number): number {
  return Math.round((toSeconds - fromSeconds) / 60);
}

function deltaLabel(minutes: number): string {
  const sign = minutes > 0 ? "+" : "";
  return `(${sign}${minutes} min)`;
}

export function spansOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end;
}

/**
 * True when Non-Pro punches cover [start, end], ignoring holes shorter than a minute.
 * A gap this covers should not become a suggestion.
 */
export function nonProCoversSpan(start: number, end: number, spans: Array<[number, number]>): boolean {
  if (!(end > start)) return false;
  const sorted = spans
    .filter(([spanStart, spanEnd]) => spanEnd > start && spanStart < end)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let cursor = start;
  for (const [spanStart, spanEnd] of sorted) {
    if (spanStart - cursor >= COVERED_HOLE_SECONDS) return false;
    cursor = Math.max(cursor, spanEnd);
  }
  return end - cursor < COVERED_HOLE_SECONDS;
}

export interface MoveTimePairInput {
  soIn: string;
  soOut: string;
  newIn: string;
  newOut: string;
  nonProIn: string;
  nonProOut: string;
  /** Accept cannot extend past this. Omit when the shift is still open. */
  shiftClockOut?: string | null;
  allowPastClockOut?: boolean;
}

export interface MoveTimePair {
  newIn: string;
  newOut: string;
  nonProChange: NonProChange;
}

/**
 * When the new service-order window overlaps a Non-Pro punch, shorten that punch or remove it.
 * An extension stops at the shift clock-out unless the manager is overriding it.
 * Returns null when the windows do not overlap.
 */
export function pairNonProMove(input: MoveTimePairInput): MoveTimePair | null {
  const soIn = parseClockOfDay(input.soIn);
  const soOut = parseClockOfDay(input.soOut);
  const newIn = parseClockOfDay(input.newIn);
  let newOut = parseClockOfDay(input.newOut);
  const nonProIn = parseClockOfDay(input.nonProIn);
  const nonProOut = parseClockOfDay(input.nonProOut);
  if (soIn == null || soOut == null || newIn == null || newOut == null || nonProIn == null || nonProOut == null) return null;
  if (!input.allowPastClockOut && input.shiftClockOut) {
    const cap = parseClockOfDay(input.shiftClockOut);
    if (cap != null && newOut > cap && newOut > soOut) newOut = Math.max(soOut, cap);
  }
  if (!(newOut > newIn)) return null;
  if (!spansOverlap(newIn, newOut, nonProIn, nonProOut)) return null;

  const seconds = input.nonProIn.includes(":") && input.nonProIn.split(":").length === 3;
  const original = { in: clockOfDay(nonProIn, seconds || input.nonProIn.length > 5), out: clockOfDay(nonProOut, seconds || input.nonProOut.length > 5) };
  const covered = nonProIn >= newIn - 1 && nonProOut <= newOut + 1;
  if (covered) {
    return {
      newIn: clockOfDay(newIn, input.newIn.length > 5),
      newOut: clockOfDay(newOut, input.newOut.length > 5),
      nonProChange: { remove: true, original },
    };
  }
  let nextIn = nonProIn;
  let nextOut = nonProOut;
  if (newOut > nonProIn && newOut < nonProOut) nextIn = newOut;
  if (newIn > nonProIn && newIn < nonProOut) nextOut = newIn;
  if (!(nextOut > nextIn) || (nextIn === nonProIn && nextOut === nonProOut)) {
    return {
      newIn: clockOfDay(newIn, input.newIn.length > 5),
      newOut: clockOfDay(newOut, input.newOut.length > 5),
      nonProChange: { remove: true, original },
    };
  }
  return {
    newIn: clockOfDay(newIn, input.newIn.length > 5),
    newOut: clockOfDay(newOut, input.newOut.length > 5),
    nonProChange: {
      original,
      new: { in: clockOfDay(nextIn, true), out: clockOfDay(nextOut, true) },
    },
  };
}

/** Board copy for one side of a move-time row. */
export function moveTimeLines(
  orderId: string,
  recommendation: Recommendation,
  decision?: Decision,
): { so: string; nonPro: string } | null {
  const change = resolvedNonProChange(recommendation, decision);
  if (!change) return null;
  const soIn = recommendation.soClockIn ?? recommendation.start;
  const soOut = recommendation.soClockOut ?? recommendation.end;
  const recommendedIn = recommendation.soNewClockIn ?? withSeconds(recommendation.start, soIn);
  const recommendedOut = recommendation.soNewClockOut ?? withSeconds(recommendation.end, soOut);
  const appliedIn = decision && decision.kind !== "reject" ? overrideClock(decision.start, recommendation.start, recommendedIn) : recommendedIn;
  const appliedOut = decision && decision.kind !== "reject" ? overrideClock(decision.end, recommendation.end, recommendedOut) : recommendedOut;
  const soSide = changedSide(soIn, soOut, appliedIn, appliedOut);
  const so = soSide
    ? `${orderId}: ${soSide.label} ${formatMoveClock(soSide.from)} -> ${formatMoveClock(soSide.to)} ${deltaLabel(soSide.minutes)}`
    : `${orderId}: out ${formatMoveClock(appliedOut)}`;
  if (change.remove) return { so, nonPro: "Non-Pro removed" };
  const next = change.new;
  const original = change.original;
  if (!next || !original) return { so, nonPro: "Non-Pro removed" };
  const nonProSide = changedSide(original.in, original.out, next.in, next.out);
  if (!nonProSide) return { so, nonPro: "Non-Pro removed" };
  const which = nonProSide.label === "out" ? "end" : "start";
  const originalStart = parseClockOfDay(original.in);
  const originalEnd = parseClockOfDay(original.out);
  const nextStart = parseClockOfDay(next.in);
  const nextEnd = parseClockOfDay(next.out);
  const duration =
    originalStart == null || originalEnd == null || nextStart == null || nextEnd == null
      ? nonProSide.minutes
      : minuteDelta(originalEnd - originalStart, nextEnd - nextStart);
  return {
    so,
    nonPro: `Non-Pro: ${which} ${formatMoveClock(nonProSide.from)} -> ${formatMoveClock(nonProSide.to)} ${deltaLabel(duration)}`,
  };
}

function changedSide(
  originalIn: string,
  originalOut: string,
  nextIn: string,
  nextOut: string,
): { label: "in" | "out"; from: string; to: string; minutes: number } | null {
  const inFrom = parseClockOfDay(originalIn);
  const inTo = parseClockOfDay(nextIn);
  const outFrom = parseClockOfDay(originalOut);
  const outTo = parseClockOfDay(nextOut);
  if (inFrom == null || inTo == null || outFrom == null || outTo == null) return null;
  const inDelta = minuteDelta(inFrom, inTo);
  const outDelta = minuteDelta(outFrom, outTo);
  if (outDelta !== 0 && Math.abs(outDelta) >= Math.abs(inDelta)) {
    return { label: "out", from: originalOut, to: nextOut, minutes: outDelta };
  }
  if (inDelta !== 0) return { label: "in", from: originalIn, to: nextIn, minutes: inDelta };
  return null;
}

function withSeconds(minute: string, sample: string): string {
  if (sample.split(":").length === 3 && minute.split(":").length === 2) return `${minute}:00`;
  return minute;
}

function overrideClock(override: string, recommendedHm: string, exact: string): string {
  const trimmed = override.trim();
  if (trimmed.length === 0 || trimmed === recommendedHm || trimmed === exact.slice(0, 5)) return exact;
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

/** Non-Pro change after Accept, Reject, or an override of either clock. */
export function resolvedNonProChange(recommendation: Recommendation, decision: Decision | undefined): NonProChange | undefined {
  const change = recommendation.nonProChange;
  if (!change) return undefined;
  if (!decision || decision.kind === "reject" || decision.kind === "accept") return change;
  const original = change.original;
  if (!original) return change;
  const inOverride = decision.nonProIn?.trim() ?? "";
  const outOverride = decision.nonProOut?.trim() ?? "";
  if (inOverride.length === 0 && outOverride.length === 0) return change;
  const recommendedIn = change.new?.in ?? original.in;
  const recommendedOut = change.new?.out ?? original.out;
  const nextIn = overrideClock(inOverride, recommendedIn.slice(0, 5), recommendedIn);
  const nextOut = overrideClock(outOverride, recommendedOut.slice(0, 5), recommendedOut);
  const start = parseClockOfDay(nextIn);
  const end = parseClockOfDay(nextOut);
  const originalStart = parseClockOfDay(original.in);
  const originalEnd = parseClockOfDay(original.out);
  if (start == null || end == null || originalStart == null || originalEnd == null || end <= start) return change;
  if (start <= originalStart && end >= originalEnd) return { remove: true, original };
  return { original, new: { in: nextIn, out: nextOut } };
}

export function shiftClockOutNote(shiftClockOut: string | undefined, decision: Decision | undefined): string | null {
  if (!shiftClockOut) return null;
  if (decision?.kind === "override") {
    return `The shift clocked out at ${formatMoveClock(shiftClockOut)}. Override can go past it.`;
  }
  return `The shift clocked out at ${formatMoveClock(shiftClockOut)}. Accept stops there.`;
}

/** Pending Cody edit from the October 14 Greenville submit. It must not be sent once move-time leftovers are open. */
export const STALE_CODY_BATCH_ID = "4d4ebbfa-4c87-4b69-be4e-1169659247be";

export const CODY_KESTER_MOVE_TIME_ID = "2026-10-13-greenville-cody-kester-02";

/** Follow-up finding that can be submitted after Dayton 10/13 is signed off. */
export const NICK_SONTAG_FOLLOW_UP_ID = "2026-10-13-dayton-nick-sontag-followup";

const FOLLOW_UP_IDS = new Set<string>([NICK_SONTAG_FOLLOW_UP_ID]);

export function isMoveTimeFollowUp(findingId: string): boolean {
  return FOLLOW_UP_IDS.has(findingId);
}

const REOPENED_MOVE_TIME_IDS = new Set<string>([
  CODY_KESTER_MOVE_TIME_ID,
  "2026-10-13-greenville-david-johnson-13",
  "2026-10-13-greenville-david-johnson-20",
  NICK_SONTAG_FOLLOW_UP_ID,
]);

export function isReopenedMoveTimeFinding(findingId: string): boolean {
  return REOPENED_MOVE_TIME_IDS.has(findingId);
}

/**
 * An edit from before the move-time reopen. A later submit of the same finding carries `nonProChange`.
 * `superseded` stays stale even if the leftovers file is closed, so that pending Cody edit is never sent.
 */
export function isStaleMoveTimeQueueEdit(
  edit: { findingId: string; nonProChange?: unknown; status?: string },
  leftoversOpen: boolean,
): boolean {
  if (edit.status === "superseded") return true;
  return leftoversOpen && isReopenedMoveTimeFinding(edit.findingId) && edit.nonProChange == null;
}

export function withoutStaleMoveTimeEdits<T extends { edits: Array<{ findingId: string; nonProChange?: unknown; status?: string }> }>(
  batches: T[],
  leftoversOpen: boolean,
): T[] {
  if (!leftoversOpen) return batches;
  return batches.map((batch) => {
    const edits = batch.edits.filter((edit) => !isStaleMoveTimeQueueEdit(edit, true));
    return edits.length === batch.edits.length ? batch : { ...batch, edits };
  });
}

/** Drop decisions saved before the reopen. A decision made on the new row sets `moveTime`. */
export function decisionsWithoutStaleMoveTime(decisions: Record<string, Decision>, leftoversOpen: boolean): Record<string, Decision> {
  if (!leftoversOpen) return decisions;
  let changed = false;
  const next = { ...decisions };
  for (const id of REOPENED_MOVE_TIME_IDS) {
    const decision = next[id];
    if (!decision || decision.moveTime) continue;
    delete next[id];
    changed = true;
  }
  return changed ? next : decisions;
}

/** True once the four October 13 move-time rows have been merged into the reports. */
export function moveTimeLeftoversApplied(reports: DayReport[]): boolean {
  return reports.some((report) =>
    report.findings.some(
      (finding) => isReopenedMoveTimeFinding(finding.id) && (finding.followUp === true || finding.recommendation?.nonProChange != null),
    ),
  );
}

function findingBase(day: string, shopId: ShopId, techId: string, id: string, start: string, end: string, minutes: number, detail: string): Omit<Finding, "recommendation"> {
  return { id, day, shopId, techId, kind: "gap", start, end, minutes, detail };
}

function moveRecommendation(input: {
  orderId: string;
  work: string;
  start: string;
  end: string;
  minutes: number;
  summary: string;
  soClockIn: string;
  soClockOut: string;
  soNewClockIn?: string;
  soNewClockOut?: string;
  shiftClockOut?: string;
  nonProChange: NonProChange;
}): Recommendation {
  return {
    orderId: input.orderId,
    work: input.work,
    start: input.start,
    end: input.end,
    minutes: input.minutes,
    summary: input.summary,
    soClockIn: input.soClockIn,
    soClockOut: input.soClockOut,
    ...(input.soNewClockIn ? { soNewClockIn: input.soNewClockIn } : {}),
    ...(input.soNewClockOut ? { soNewClockOut: input.soNewClockOut } : {}),
    ...(input.shiftClockOut ? { shiftClockOut: input.shiftClockOut } : {}),
    nonProChange: input.nonProChange,
  };
}

/**
 * Undecided move-time rows for edits already in Fullbay, or for Cody's row that was never pushed.
 * They are not on the board until POST /api/admin/reopen-move-time.
 */
export function moveTimeLeftoverFindings(): Finding[] {
  const day = "2026-10-13";
  return [
    {
      ...findingBase(
        day,
        "greenville",
        "cody-kester",
        "2026-10-13-greenville-cody-kester-02",
        "07:13",
        "08:22",
        21,
        "G-89820 is 7:13:12–8:00:45. Non-Pro “Go to buy diesel for steam cleaner.” is 8:00:45–9:06:40. Nothing has been changed in Fullbay.",
      ),
      recommendation: moveRecommendation({
        orderId: "G-89820",
        work: "Remove Paccar engine and",
        start: "07:13",
        end: "08:22",
        minutes: 21,
        summary: "Keep G-89820 until 8:22:00 and start the Non-Pro row then.",
        soClockIn: "07:13:12",
        soClockOut: "08:00:45",
        soNewClockIn: "07:13:12",
        soNewClockOut: "08:22:00",
        shiftClockOut: "17:00:53",
        nonProChange: {
          original: { in: "08:00:45", out: "09:06:40" },
          new: { in: "08:22:00", out: "09:06:40" },
        },
      }),
    },
    {
      ...findingBase(
        day,
        "greenville",
        "david-johnson",
        "2026-10-13-greenville-david-johnson-13",
        "10:32",
        "11:10",
        0,
        "G-90810 clock-out is already 11:09:37 and now covers Non-Pro “Waiting on next job” 10:52:51–11:09:37.",
      ),
      recommendation: moveRecommendation({
        orderId: "G-90810",
        work: "10/13 - Unit is overheati",
        start: "10:32",
        end: "11:10",
        minutes: 0,
        summary: "G-90810 clock-out is already 11:09:37. Remove the Non-Pro row it covers.",
        soClockIn: "10:31:48",
        soClockOut: "10:52:24",
        soNewClockIn: "10:31:48",
        soNewClockOut: "11:09:37",
        shiftClockOut: "16:57:44",
        nonProChange: { remove: true, original: { in: "10:52:51", out: "11:09:37" } },
      }),
    },
    {
      ...findingBase(
        day,
        "greenville",
        "david-johnson",
        "2026-10-13-greenville-david-johnson-20",
        "13:38",
        "14:28",
        0,
        "G-90843 clock-out is already 2:28:09 PM and now covers Non-Pro “Need a job” 2:22:47–2:28:09 PM.",
      ),
      recommendation: moveRecommendation({
        orderId: "G-90843",
        work: "QC-Clear Faults and Test",
        start: "13:38",
        end: "14:28",
        minutes: 0,
        summary: "G-90843 clock-out is already 2:28:09 PM. Remove the Non-Pro row it covers.",
        soClockIn: "13:38:25",
        soClockOut: "14:22:01",
        soNewClockIn: "13:38:25",
        soNewClockOut: "14:28:09",
        shiftClockOut: "16:57:44",
        nonProChange: { remove: true, original: { in: "14:22:47", out: "14:28:09" } },
      }),
    },
    {
      ...findingBase(
        day,
        "dayton",
        "nick-sontag",
        NICK_SONTAG_FOLLOW_UP_ID,
        "13:05",
        "16:03",
        0,
        "D-89868 clock-out is already 5:04:21 PM. Non-Pro “Helping colby” is 4:03:07–5:04:21 PM. The shift clocked out at 4:03:06 PM.",
      ),
      followUp: true,
      recommendation: moveRecommendation({
        orderId: "D-89868",
        work: "Defect found during inspe",
        start: "13:05",
        end: "16:03",
        minutes: 0,
        summary: "Cap D-89868 at the 4:03:06 PM shift clock-out and remove the Non-Pro row.",
        soClockIn: "13:05:22",
        soClockOut: "17:04:21",
        soNewClockIn: "13:05:22",
        soNewClockOut: "16:03:06",
        shiftClockOut: "16:03:06",
        nonProChange: { remove: true, original: { in: "16:03:07", out: "17:04:21" } },
      }),
    },
  ];
}

/** Replace a same-id row, or append a follow-up the timesheet did not have. */
export function applyMoveTimeLeftovers(reports: DayReport[], leftovers: Finding[]): DayReport[] {
  if (leftovers.length === 0) return reports;
  return reports.map((report) => {
    const extras = leftovers.filter((finding) => finding.day === report.day && finding.shopId === report.shopId);
    if (extras.length === 0) return report;
    const findings = report.findings.map((finding) => extras.find((extra) => extra.id === finding.id) ?? finding);
    for (const extra of extras) {
      if (!findings.some((finding) => finding.id === extra.id)) findings.push(extra);
    }
    const orders = [...report.orders];
    for (const extra of extras) {
      const orderId = extra.recommendation?.orderId;
      if (!orderId || orders.some((order) => order.id === orderId)) continue;
      orders.push({ id: orderId, shopId: report.shopId, title: extra.recommendation?.work ?? "", status: "priorities" });
    }
    return { ...report, findings, orders };
  });
}

/** HH:MM form of a move-time clock, for the existing queue fields. */
export function clockMinute(value: string): string | null {
  const parsed = parseClock(value.slice(0, 5));
  if (parsed == null && parseClockOfDay(value) == null) return null;
  return value.slice(0, 5);
}

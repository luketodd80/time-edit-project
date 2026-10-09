import { latestQueueEdit, type FullbayEditBatch, type FullbayApplyStatus } from "@/lib/fullbay-edit-queue";
import { buildNonProEdit } from "@/lib/nonpro";
import { SHOPS } from "@/lib/types";
import type { DayReport, Decision, Finding, NonProAffectedRow, ShopId } from "@/lib/types";
import { appliedWindow } from "@/lib/time";

export type PunchEditStatus = "applied" | "accepted" | "rejected" | "already_done";

/** One service-order punch on the summary, after the decisions for that day. */
export interface DayPunch {
  orderId: string;
  work: string;
  clockIn: string;
  clockOut: string;
  /** Set when an edit moved this side. The clock field is the time after the decision. */
  originalClockIn: string | null;
  originalClockOut: string | null;
  /** Suggested time kept for a rejected edit, which does not change the punch. */
  suggestedClockIn: string | null;
  suggestedClockOut: string | null;
  editStatus: PunchEditStatus | null;
  /** Shop name when this punch belongs to another shop and is context only. */
  contextShop: string | null;
  /** Set when this punch was already correct in Fullbay. */
  applyNote: string | null;
  currentClockIn: string | null;
  currentClockOut: string | null;
}

const SHOP_NAMES = SHOPS.map((shop) => shop.name).join("|");
const FOREIGN_PREFIX = new RegExp(`^(${SHOP_NAMES})\\s+`);

function parseOrder(text: string): { orderId: string; work: string } | null {
  const match = /^([A-Za-z]{1,3}-\d+)\s*\/\s*([\s\S]+)$/.exec(text.trim());
  if (!match) return null;
  let work = match[2];
  const cut = work.search(/\.\s+(?:Open punch\.|On that shop)/);
  if (cut >= 0) work = work.slice(0, cut);
  else work = work.replace(/\.\s*$/, "");
  return { orderId: match[1].toUpperCase(), work: work.trim() };
}

function editKind(summary: string): "start" | "keep" | "assign" | null {
  if (summary.startsWith("Start ")) return "start";
  if (summary.startsWith("Keep ")) return "keep";
  if (summary.startsWith("Put this on ")) return "assign";
  return null;
}

function latestApplyStatus(batches: FullbayEditBatch[], findingId: string): FullbayApplyStatus | null {
  const matches = batches.flatMap((batch) =>
    batch.edits.filter((edit) => edit.findingId === findingId).map((edit) => ({ status: edit.status, submittedAt: batch.submittedAt, id: batch.id })),
  );
  matches.sort((a, b) => (a.submittedAt === b.submittedAt ? (a.id < b.id ? 1 : -1) : a.submittedAt < b.submittedAt ? 1 : -1));
  return matches[0]?.status ?? null;
}

function statusFor(decision: Decision, batches: FullbayEditBatch[], findingId: string): PunchEditStatus {
  if (decision.kind === "reject") return "rejected";
  const status = latestApplyStatus(batches, findingId);
  if (status === "applied") return "applied";
  if (status === "already_done" || status === "not_a_gap") return "already_done";
  return "accepted";
}

function alreadyDoneDetail(batches: FullbayEditBatch[], findingId: string): Pick<DayPunch, "applyNote" | "currentClockIn" | "currentClockOut"> {
  const edit = latestQueueEdit(batches, findingId);
  if (edit?.status !== "already_done") return { applyNote: null, currentClockIn: null, currentClockOut: null };
  return {
    applyNote: edit.applyNote,
    currentClockIn: edit.currentClockIn ?? null,
    currentClockOut: edit.currentClockOut ?? null,
  };
}

function preferStatus(current: PunchEditStatus | null, next: PunchEditStatus): PunchEditStatus {
  if (current === "rejected" || next === "rejected") return "rejected";
  if (current === "accepted" || next === "accepted") return "accepted";
  if (current === "already_done" || next === "already_done") return "already_done";
  return "applied";
}

const NO_ALREADY_DONE = { applyNote: null, currentClockIn: null, currentClockOut: null };

/**
 * Service-order punches for one tech on one shop day.
 * Accepted and overridden edits move a clock-in or clock-out. Rejected edits stay on the original times.
 * Another shop's punches are included as labeled context and are not edited here.
 */
export function dayPunches(
  report: DayReport,
  techId: string,
  decisions: Record<string, Decision>,
  batches: FullbayEditBatch[],
): DayPunch[] {
  const punches: DayPunch[] = [];
  const findings = report.findings.filter((finding) => finding.techId === techId);

  for (const finding of findings) {
    if (finding.kind !== "as_is") continue;
    if (finding.notAGap) {
      const foreign = FOREIGN_PREFIX.exec(finding.detail);
      if (!foreign) continue;
      const parsed = parseOrder(finding.detail.slice(foreign[0].length));
      if (!parsed) continue;
      punches.push({
        orderId: parsed.orderId,
        work: parsed.work,
        clockIn: finding.start,
        clockOut: finding.end,
        originalClockIn: null,
        originalClockOut: null,
        suggestedClockIn: null,
        suggestedClockOut: null,
        editStatus: null,
        contextShop: foreign[1],
        ...NO_ALREADY_DONE,
      });
      continue;
    }
    const parsed = parseOrder(finding.detail);
    if (!parsed) continue;
    punches.push({
      orderId: parsed.orderId,
      work: parsed.work,
      clockIn: finding.start,
      clockOut: finding.end,
      originalClockIn: null,
      originalClockOut: null,
      suggestedClockIn: null,
      suggestedClockOut: null,
      editStatus: null,
      contextShop: null,
      ...NO_ALREADY_DONE,
    });
  }

  for (const finding of findings) {
    const recommendation = finding.recommendation;
    const decision = decisions[finding.id];
    if (!recommendation || !decision) continue;
    const window = appliedWindow(recommendation, decision);
    if (!window.valid && decision.kind !== "reject") continue;
    const kind = editKind(recommendation.summary);
    if (!kind) continue;
    const status = statusFor(decision, batches, finding.id);
    const detail = status === "already_done" ? alreadyDoneDetail(batches, finding.id) : NO_ALREADY_DONE;
    const keepLoadedTimes = status === "rejected" || status === "already_done";
    const nextIn = decision.kind === "reject" ? recommendation.start : window.start;
    const nextOut = decision.kind === "reject" ? recommendation.end : window.end;
    if (kind === "assign") {
      punches.push({
        orderId: recommendation.orderId,
        work: recommendation.work,
        clockIn: keepLoadedTimes ? finding.start : nextIn,
        clockOut: keepLoadedTimes ? finding.end : nextOut,
        originalClockIn: null,
        originalClockOut: null,
        suggestedClockIn: status === "rejected" ? nextIn : null,
        suggestedClockOut: status === "rejected" ? nextOut : null,
        editStatus: status,
        contextShop: null,
        ...detail,
      });
      continue;
    }
    applyBoundary(punches, finding, recommendation.orderId, recommendation.work, kind, nextIn, nextOut, status, detail);
  }

  for (const finding of findings) {
    if (!finding.nonPro) continue;
    const decision = decisions[finding.id];
    if (!decision) continue;
    const built = buildNonProEdit(finding, decision);
    if (!built.ok || built.payload.editType === "keep") continue;
    const status = statusFor(decision, batches, finding.id);
    const detail = status === "already_done" ? alreadyDoneDetail(batches, finding.id) : NO_ALREADY_DONE;
    for (const row of built.payload.rows) applyNonProRow(punches, row, report.shopId, status, detail);
  }

  return punches.sort((a, b) => a.clockIn.localeCompare(b.clockIn) || a.clockOut.localeCompare(b.clockOut) || a.orderId.localeCompare(b.orderId));
}

function applyNonProRow(
  punches: DayPunch[],
  row: NonProAffectedRow,
  reportShopId: ShopId,
  status: PunchEditStatus,
  detail: Pick<DayPunch, "applyNote" | "currentClockIn" | "currentClockOut">,
) {
  const keepLoaded = status === "rejected" || status === "already_done";
  const match = punches.find((punch) => punch.orderId === row.orderId && punch.clockIn === row.clockIn && punch.clockOut === row.clockOut);
  if (!match || (row.newClockIn === row.clockIn && row.newClockOut === row.clockOut)) {
    if (match && keepLoaded) return;
    if (match) return;
    const shop = SHOPS.find((item) => item.id === row.shopId);
    punches.push({
      orderId: row.orderId,
      work: row.work,
      clockIn: keepLoaded ? row.clockIn : row.newClockIn,
      clockOut: keepLoaded ? row.clockOut : row.newClockOut,
      originalClockIn: null,
      originalClockOut: null,
      suggestedClockIn: status === "rejected" ? row.newClockIn : null,
      suggestedClockOut: status === "rejected" ? row.newClockOut : null,
      editStatus: status,
      contextShop: row.shopId === reportShopId ? null : shop?.name ?? null,
      ...detail,
    });
    return;
  }
  match.editStatus = preferStatus(match.editStatus, status);
  if (status === "already_done") {
    match.applyNote = detail.applyNote;
    match.currentClockIn = detail.currentClockIn;
    match.currentClockOut = detail.currentClockOut;
  }
  if (keepLoaded) {
    if (status === "rejected") {
      if (row.newClockIn !== row.clockIn) match.suggestedClockIn = row.newClockIn;
      if (row.newClockOut !== row.clockOut) match.suggestedClockOut = row.newClockOut;
    }
    return;
  }
  if (row.newClockIn !== row.clockIn) {
    if (match.originalClockIn == null) match.originalClockIn = match.clockIn;
    match.clockIn = row.newClockIn;
  }
  if (row.newClockOut !== row.clockOut) {
    if (match.originalClockOut == null) match.originalClockOut = match.clockOut;
    match.clockOut = row.newClockOut;
  }
}

function applyBoundary(
  punches: DayPunch[],
  finding: Finding,
  orderId: string,
  work: string,
  kind: "start" | "keep",
  nextIn: string,
  nextOut: string,
  status: PunchEditStatus,
  detail: Pick<DayPunch, "applyNote" | "currentClockIn" | "currentClockOut">,
) {
  const local = punches.filter((punch) => punch.contextShop == null && punch.orderId === orderId);
  const match =
    kind === "start"
      ? local.filter((punch) => punch.clockIn === finding.end).sort((a, b) => a.clockOut.localeCompare(b.clockOut))[0]
      : local.filter((punch) => punch.clockOut === finding.start).sort((a, b) => b.clockIn.localeCompare(a.clockIn))[0];
  if (!match) {
    punches.push({
      orderId,
      work,
      clockIn: status === "rejected" || status === "already_done" ? finding.start : nextIn,
      clockOut: status === "rejected" || status === "already_done" ? finding.end : nextOut,
      originalClockIn: null,
      originalClockOut: null,
      suggestedClockIn: status === "rejected" ? nextIn : null,
      suggestedClockOut: status === "rejected" ? nextOut : null,
      editStatus: status,
      contextShop: null,
      ...detail,
    });
    return;
  }
  match.editStatus = preferStatus(match.editStatus, status);
  if (status === "already_done") {
    match.applyNote = detail.applyNote;
    match.currentClockIn = detail.currentClockIn;
    match.currentClockOut = detail.currentClockOut;
  }
  if (kind === "start") {
    if (status === "rejected" || status === "already_done") {
      if (status === "rejected") match.suggestedClockIn = nextIn;
      return;
    }
    if (match.originalClockIn == null) match.originalClockIn = match.clockIn;
    match.clockIn = nextIn;
    return;
  }
  if (status === "rejected" || status === "already_done") {
    if (status === "rejected") match.suggestedClockOut = nextOut;
    return;
  }
  if (match.originalClockOut == null) match.originalClockOut = match.clockOut;
  match.clockOut = nextOut;
}

import { addDays, defaultPendingDays, formatDay, formatDayShort, weekday } from "@/lib/dates";
import {
  editAddsNoJobTime,
  latestEditsForShopDay,
  type FullbayApplyStatus,
  type FullbayEditBatch,
  type FullbayQueueEdit,
  type RecordedSignoff,
} from "@/lib/fullbay-edit-queue";
import { requiredDecisionFindingIds, techFor } from "@/lib/review";
import { SHOPS, type DayReport, type Finding, type ShopId } from "@/lib/types";
import {
  eachDay,
  historyDaysWithData,
  rollupUtilization,
  type UtilRollup,
  type UtilShopDay,
  type UtilTechSnapshot,
} from "@/lib/utilization-history";

/** Service managers shown under each shop. Labels from the approved admin mockup. */
export const SHOP_MANAGERS: Record<ShopId, string> = {
  dayton: "Jared Detro",
  mobile: "Jeremy Mohler",
  greenville: "Shawn Loxley",
  covington: "Chuck Williams",
  springfield: "Andy Nelson",
  columbus: "James Benedict",
};

export const RANGE_PRESETS = ["this-week", "last-week", "this-month", "last-month", "ytd", "last-30"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export type ShopDayTone = "green" | "yellow" | "red" | "none" | "open" | "closed" | "nodata";

export interface AdminLine {
  findingId: string;
  tech: string;
  order: string;
  work: string;
  window: string;
  minutes: number;
  nonPro: boolean;
  decision: string;
  status: FullbayApplyStatus | null;
  note: string;
  excluded: boolean;
  submits: number;
}

export interface AdminCell {
  day: string;
  shopId: ShopId;
  tone: ShopDayTone;
  title: string;
  detail: string;
  suggestions: number;
  accepted: number;
  rejected: number | null;
  applied: number;
  failed: number;
  pending: number;
  alreadyDone: number;
  notAGap: number;
  submitCount: number;
  firstSubmit: string | null;
  signedOffAt: string | null;
  signoffNote: string | null;
  lines: AdminLine[];
  utilization: UtilRollup;
}

export interface AdminTechRow extends UtilTechSnapshot {
  rollup: UtilRollup;
}

export interface AdminPayload {
  today: string;
  range: { start: string; end: string };
  history: { days: string[]; firstDay: string | null; lastDay: string | null };
  coverage: { hasData: boolean; coveredDays: string[]; missingCount: number; message: string };
  kpis: {
    hasUtilization: boolean;
    before: number | null;
    after: number | null;
    changePoints: number | null;
    minutesPickedUp: number;
    shopsBehind: { id: ShopId; name: string; days: number }[];
    dueLabel: string;
    dueValue: string;
  };
  grid: {
    days: { iso: string; label: string; due: boolean }[];
    shops: {
      id: ShopId;
      name: string;
      manager: string;
      daysBehind: number;
      cells: AdminCell[];
    }[];
  };
  utilization: {
    company: UtilRollup;
    shops: { id: ShopId; name: string; rollup: UtilRollup; techs: AdminTechRow[] }[];
    emptyShops: string[];
  } | null;
}

/** Last 7 calendar days, oldest first, not including today. Sundays stay in the list so the grid can mark them closed. */
export function lastSevenDays(today: string): string[] {
  const days: string[] = [];
  for (let offset = 7; offset >= 1; offset -= 1) days.push(addDays(today, -offset));
  return days;
}

/** Monday-start weeks. "This" ranges end today. Last month is the full previous calendar month. */
export function presetBounds(preset: RangePreset, today: string): { start: string; end: string } {
  const monday = mondayOf(today);
  if (preset === "this-week") return { start: monday, end: addDays(monday, 6) };
  if (preset === "last-week") return { start: addDays(monday, -7), end: addDays(monday, -1) };
  if (preset === "this-month") return { start: `${today.slice(0, 7)}-01`, end: today };
  if (preset === "last-month") {
    const [yearText, monthText] = today.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;
    const start = `${previousYear}-${String(previousMonth).padStart(2, "0")}-01`;
    return { start, end: addDays(`${today.slice(0, 7)}-01`, -1) };
  }
  if (preset === "ytd") return { start: `${today.slice(0, 4)}-01-01`, end: today };
  return { start: addDays(today, -29), end: today };
}

function mondayOf(today: string): string {
  const dow = weekday(today);
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(today, offset);
}

export function isRangePreset(value: string): value is RangePreset {
  return (RANGE_PRESETS as readonly string[]).includes(value);
}

export function buildAdminPayload(input: {
  today: string;
  start: string;
  end: string;
  reports: DayReport[];
  batches: FullbayEditBatch[];
  signoffs: RecordedSignoff[];
  history: UtilShopDay[];
}): AdminPayload {
  const { today, start, end, reports, batches, signoffs, history } = input;
  const dueDays = defaultPendingDays(today);
  const gridDays = lastSevenDays(today);
  const cells = new Map<string, AdminCell>();
  for (const shop of SHOPS) {
    for (const day of gridDays) {
      const cell = buildCell(day, shop.id, today, dueDays, reports, batches, signoffs, history);
      cells.set(`${day}|${shop.id}`, cell);
    }
  }

  const shops = SHOPS.map((shop) => {
    const shopCells = gridDays.map((day) => cells.get(`${day}|${shop.id}`)!);
    const daysBehind = shopCells.filter((cell) => cell.tone === "red" || cell.tone === "yellow").length;
    return { id: shop.id, name: shop.name, manager: SHOP_MANAGERS[shop.id], daysBehind, cells: shopCells };
  }).sort((a, b) => b.daysBehind - a.daysBehind || shopIndex(a.id) - shopIndex(b.id));

  const behind = shops.filter((shop) => shop.daysBehind > 0).map((shop) => ({ id: shop.id, name: shop.name, days: shop.daysBehind }));
  const dueParts = dueDays.map((day) => {
    const dayCells = SHOPS.map((shop) => cells.get(`${day}|${shop.id}`)).filter((cell): cell is AdminCell => Boolean(cell));
    const green = dayCells.filter((cell) => cell.tone === "green").length;
    const denom = dayCells.filter((cell) => cell.suggestions > 0 || cell.tone === "green").length;
    return `${green}/${denom}`;
  });
  const dueLabel =
    dueDays.length === 1 ? `Yesterday (${formatDayCompact(dueDays[0]!)}) done` : `Due (${dueDays.map((day) => formatDayCompact(day)).join(", ")}) done`;

  const inRange = history.filter((row) => row.day >= start && row.day <= end);
  const company = rollupUtilization(inRange.flatMap((row) => row.techs));
  const coveredDays = historyDaysWithData(inRange);
  const span = eachDay(start, end);
  const missingCount = span.filter((day) => !coveredDays.includes(day)).length;
  const loaded = historyDaysWithData(history);
  const hasData = company.clockedHours > 0;
  const coverage = {
    hasData,
    coveredDays,
    missingCount,
    message: coverageMessage(start, end, coveredDays, missingCount, loaded),
  };

  const utilShops = SHOPS.map((shop) => {
    const rows = inRange.filter((row) => row.shopId === shop.id);
    const techs = combineTechs(rows);
    return {
      id: shop.id,
      name: shop.name,
      rollup: rollupUtilization(techs),
      techs: techs
        .map((tech) => ({ ...tech, rollup: rollupUtilization([tech]) }))
        .sort((a, b) => b.addedMinutes - a.addedMinutes || a.name.localeCompare(b.name)),
    };
  })
    .filter((shop) => shop.rollup.clockedHours > 0)
    .sort((a, b) => (b.rollup.changePoints ?? -1) - (a.rollup.changePoints ?? -1) || a.name.localeCompare(b.name));

  const emptyShops = SHOPS.filter((shop) => !utilShops.some((row) => row.id === shop.id)).map((shop) => shop.name);

  return {
    today,
    range: { start, end },
    history: { days: loaded, firstDay: loaded[0] ?? null, lastDay: loaded.at(-1) ?? null },
    coverage,
    kpis: {
      hasUtilization: hasData,
      before: hasData ? company.before : null,
      after: hasData ? company.after : null,
      changePoints: hasData ? company.changePoints : null,
      minutesPickedUp: hasData ? company.addedMinutes : 0,
      shopsBehind: behind,
      dueLabel,
      dueValue: dueParts.join(", "),
    },
    grid: {
      days: gridDays.map((iso) => ({ iso, label: formatDayCompact(iso), due: dueDays.includes(iso) })),
      shops,
    },
    utilization: hasData ? { company, shops: utilShops, emptyShops } : null,
  };
}

function shopIndex(shopId: ShopId): number {
  return SHOPS.findIndex((shop) => shop.id === shopId);
}

export function formatDayCompact(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const weekdayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date);
  const monthDay = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(date);
  return `${weekdayLabel}, ${monthDay}`;
}

export function formatDoneAt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function coverageMessage(start: string, end: string, coveredDays: string[], missingCount: number, loaded: string[]): string {
  const rangeLabel = `${formatDay(start)} – ${formatDay(end)}`;
  const loadedLabel =
    loaded.length === 0
      ? "Utilization history has no days yet."
      : `Utilization history currently covers ${loaded.map((day) => formatDayShort(day)).join(", ")}.`;
  if (coveredDays.length === 0) return `No timesheet data from ${rangeLabel}. ${loadedLabel}`;
  if (missingCount === 0) return `Every day in ${rangeLabel} has timesheet data.`;
  const coveredLabel = coveredDays.map((day) => formatDayShort(day)).join(", ");
  return `${coveredDays.length} ${coveredDays.length === 1 ? "day" : "days"} in this range ${coveredDays.length === 1 ? "has" : "have"} timesheets (${coveredLabel}). ${missingCount} other ${missingCount === 1 ? "day has" : "days have"} none, so this is not a full-period total.`;
}

function combineTechs(rows: UtilShopDay[]): UtilTechSnapshot[] {
  const techs = new Map<string, UtilTechSnapshot>();
  for (const row of rows) {
    for (const tech of row.techs) {
      const current = techs.get(tech.id) ?? { id: tech.id, name: tech.name, clockedHours: 0, soHours: 0, addedMinutes: 0 };
      current.clockedHours += tech.clockedHours;
      current.soHours += tech.soHours;
      current.addedMinutes += tech.addedMinutes;
      techs.set(tech.id, current);
    }
  }
  return [...techs.values()];
}

function buildCell(
  day: string,
  shopId: ShopId,
  today: string,
  dueDays: string[],
  reports: DayReport[],
  batches: FullbayEditBatch[],
  signoffs: RecordedSignoff[],
  history: UtilShopDay[],
): AdminCell {
  const historyRow = history.find((row) => row.day === day && row.shopId === shopId);
  const utilization = rollupUtilization(historyRow?.techs ?? []);
  const blank = (tone: ShopDayTone, title: string, detail: string): AdminCell => ({
    day,
    shopId,
    tone,
    title,
    detail,
    suggestions: 0,
    accepted: 0,
    rejected: null,
    applied: 0,
    failed: 0,
    pending: 0,
    alreadyDone: 0,
    notAGap: 0,
    submitCount: 0,
    firstSubmit: null,
    signedOffAt: null,
    signoffNote: null,
    lines: [],
    utilization,
  });

  if (weekday(day) === 0) return blank("closed", "Closed", "Sunday");
  const report = reports.find((item) => item.day === day && item.shopId === shopId);
  if (!report) return blank("nodata", "No data", "no report loaded");

  const required = requiredDecisionFindingIds(reports, { day, shopId });
  const findings = new Map(report.findings.map((finding) => [finding.id, finding]));
  const latest = latestEditsForShopDay(batches, day, shopId);
  const submitCounts = new Map<string, number>();
  const touching: FullbayEditBatch[] = [];
  let hasDecided = false;
  const decided = new Set<string>();
  for (const batch of [...batches].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id))) {
    const edits = batch.edits.filter((edit) => edit.day === day && edit.shopId === shopId);
    const decidedHere = (batch.decided ?? []).filter((item) => item.day === day && item.shopId === shopId);
    if (edits.length === 0 && decidedHere.length === 0) continue;
    touching.push(batch);
    for (const edit of edits) submitCounts.set(edit.findingId, (submitCounts.get(edit.findingId) ?? 0) + 1);
    if (decidedHere.length > 0) {
      hasDecided = true;
      for (const item of decidedHere) decided.add(item.findingId);
    }
  }

  const counts = { applied: 0, failed: 0, pending: 0, already_done: 0, not_a_gap: 0 };
  for (const edit of latest.values()) counts[edit.status] += 1;
  const rejected = hasDecided ? [...decided].filter((id) => !latest.has(id)).length : null;
  const signoff = signoffs.find((item) => item.day === day && item.shopId === shopId && item.doneAt);
  const lines = buildLines(report, required, findings, latest, hasDecided, decided, submitCounts);

  let tone: ShopDayTone;
  if (signoff) tone = "green";
  else if (touching.length > 0) tone = "yellow";
  else if (required.length === 0) tone = "none";
  else if (day <= (dueDays.at(-1) ?? addDays(today, -1))) tone = "red";
  else tone = "open";

  const titleDetail = cellCopy(tone, day, dueDays, signoff, required.length, latest.size, counts.failed, touching.length > 0, lines);
  return {
    day,
    shopId,
    tone,
    title: titleDetail.title,
    detail: titleDetail.detail,
    suggestions: required.length,
    accepted: latest.size,
    rejected,
    applied: counts.applied,
    failed: counts.failed,
    pending: counts.pending,
    alreadyDone: counts.already_done,
    notAGap: counts.not_a_gap,
    submitCount: touching.length,
    firstSubmit: touching[0]?.submittedAt ?? null,
    signedOffAt: signoff?.doneAt ?? null,
    signoffNote: signoff?.note ?? null,
    lines,
    utilization,
  };
}

function cellCopy(
  tone: ShopDayTone,
  day: string,
  dueDays: string[],
  signoff: RecordedSignoff | undefined,
  suggestions: number,
  accepted: number,
  failed: number,
  submitted: boolean,
  lines: AdminLine[],
): { title: string; detail: string } {
  if (tone === "green" && signoff) {
    let detail = signoff.note ? "auto sign-off" : submitted ? `${accepted} accepted` : "marked done, no submit";
    if (failed > 0) detail = `${detail} · ${failed} failed`;
    return { title: `Done ${formatDoneAt(signoff.doneAt)}`, detail };
  }
  if (tone === "yellow") return { title: "Submitted", detail: yellowDetail(lines, failed) };
  if (tone === "red") return { title: dueDays.includes(day) ? "Due today" : "Past due", detail: `${suggestions} suggestion${suggestions === 1 ? "" : "s"} untouched` };
  if (tone === "none") return { title: "Nothing to review", detail: "0 suggestions" };
  if (tone === "open") return { title: "Open", detail: `${suggestions} suggestion${suggestions === 1 ? "" : "s"}` };
  return { title: "No data", detail: "" };
}

function yellowDetail(lines: AdminLine[], failed: number): string {
  if (failed > 0) return `${failed} failed in Fullbay`;
  const pending = lines.filter((line) => line.status === "pending").length;
  if (pending > 0) return `${pending} waiting on Fullbay`;
  const undecided = lines.filter((line) => line.decision === "Undecided / not in submit" || line.decision === "Not submitted").length;
  if (undecided > 0) return `${undecided} line${undecided === 1 ? "" : "s"} never decided`;
  return "not marked done";
}

function buildLines(
  report: DayReport,
  required: string[],
  findings: Map<string, Finding>,
  latest: Map<string, FullbayQueueEdit>,
  hasDecided: boolean,
  decided: Set<string>,
  submitCounts: Map<string, number>,
): AdminLine[] {
  const lines: AdminLine[] = [];
  const seen = new Set<string>();
  for (const findingId of required) {
    seen.add(findingId);
    const finding = findings.get(findingId);
    const edit = latest.get(findingId);
    if (!finding) continue;
    lines.push(lineFromFinding(report, finding, edit, hasDecided, decided, submitCounts.get(findingId) ?? 0));
  }
  for (const [findingId, edit] of latest) {
    if (seen.has(findingId)) continue;
    const finding = findings.get(findingId);
    if (finding) {
      lines.push(lineFromFinding(report, finding, edit, hasDecided, decided, submitCounts.get(findingId) ?? 0));
      continue;
    }
    lines.push({
      findingId,
      tech: edit.techName,
      order: edit.orderId,
      work: edit.work,
      window: `${edit.newClockIn}–${edit.newClockOut}`,
      minutes: edit.minutes,
      nonPro: Boolean(edit.nonPro),
      decision: edit.decision === "override" ? "Override" : "Accepted",
      status: edit.status,
      note: edit.applyNote ?? "",
      excluded: editAddsNoJobTime(edit),
      submits: submitCounts.get(findingId) ?? 1,
    });
  }
  const rank: Record<string, number> = { failed: 0, pending: 1 };
  return lines.sort((a, b) => (rank[a.status ?? ""] ?? 3) - (rank[b.status ?? ""] ?? 3) || a.tech.localeCompare(b.tech));
}

function lineFromFinding(
  report: DayReport,
  finding: Finding,
  edit: FullbayQueueEdit | undefined,
  hasDecided: boolean,
  decided: Set<string>,
  submits: number,
): AdminLine {
  const tech = techFor(report, finding.techId);
  const recommendation = finding.recommendation;
  let decision: string;
  if (edit) decision = edit.decision === "override" ? "Override" : "Accepted";
  else if (hasDecided && decided.has(finding.id)) decision = "Rejected";
  else if (hasDecided || submits > 0) decision = "Undecided / not in submit";
  else decision = "Not submitted";
  const order = edit?.orderId || recommendation?.orderId || (finding.nonPro ? "Non-Pro" : "");
  const work = edit?.work || recommendation?.work || "";
  const window = edit ? `${edit.newClockIn}–${edit.newClockOut}` : recommendation ? `${recommendation.start}–${recommendation.end}` : `${finding.start}–${finding.end}`;
  const minutes = edit?.minutes ?? recommendation?.minutes ?? finding.minutes;
  return {
    findingId: finding.id,
    tech: tech?.name ?? finding.techId,
    order,
    work,
    window,
    minutes,
    nonPro: Boolean(finding.nonPro),
    decision,
    status: edit?.status ?? null,
    note: edit?.applyNote ?? "",
    excluded: edit ? editAddsNoJobTime(edit) : false,
    submits,
  };
}

export function shopReviewHref(shopId: ShopId, day: string): string {
  return `/?shop=${shopId}&day=${day}`;
}

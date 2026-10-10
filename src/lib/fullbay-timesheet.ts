import type { DayReport, Finding, NonProNeighbor, NonProOrderOption, NonProReview, Recommendation, ServiceOrder, ShopId, Technician } from "@/lib/types";
import { SHOPS } from "@/lib/types";
import { formatClock } from "@/lib/time";
import { FRIDAY_DETAILS_CSV } from "@/lib/friday-details-csv";
import { SATURDAY_DETAILS_CSV } from "@/lib/saturday-details-csv";
import { MONDAY_DETAILS_CSV } from "@/lib/monday-details-csv";
import { TUESDAY_DETAILS_CSV } from "@/lib/tuesday-details-csv";
import { WEDNESDAY_DETAILS_CSV } from "@/lib/wednesday-details-csv";
import { THURSDAY_DETAILS_CSV } from "@/lib/thursday-details-csv";
import { FRIDAY_OCTOBER_9_DETAILS_CSV } from "@/lib/friday-october-9-details-csv";

/**
 * Shop foremen. They are left out of time-gap review and utilization entirely.
 * Match Fullbay employee names case-insensitively, with surrounding and repeated whitespace ignored.
 */
export const FOREMEN = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal"] as const;

/** Shown wherever an open punch is given an end from the row's elapsed hours. */
export const OPEN_PUNCH_NOTE = "Open punch. The end is elapsed time from the scrape, not a clock-out.";

export interface FullbayTimesheetRow {
  shop: string;
  employee: string;
  clock_in: string;
  clock_in_activity: string;
  clock_out: string;
  hours: number;
  so_complaint: string;
  /** Trailing Comment column. Details List downloads also have Clock In Comment; that one wins for Non-Pro notes. */
  comment: string;
  clock_in_comment?: string;
  open_punch?: boolean;
}

/** Column order of a Fullbay Office Details List timesheet download. */
export const DETAILS_LIST_HEADERS = [
  "Shop",
  "Employee",
  "Clock In",
  "Clock In IP",
  "Clock In Activity",
  "Clock In Comment",
  "Clock Out",
  "Clock Out IP",
  "Clock Out Activity",
  "Clock Out Comment",
  "Type",
  "Hours",
  "SO / Complaint",
  "Modified By",
  "Modified Date/Time",
  "Comment",
] as const;

export interface FullbayTimesheetFile {
  date: string;
  rows: FullbayTimesheetRow[];
}

interface Punch {
  start: number;
  end: number | null;
  hours: number;
  activity: string;
  comment: string;
  /** True when `comment` came from Clock In Comment rather than the trailing Comment column. */
  commentFromClockIn: boolean;
}

interface PeerSegment {
  name: string;
  segment: Segment;
}

interface Segment {
  start: number;
  end: number | null;
  hours: number;
  orderId: string;
  title: string;
}

/** A service-order segment attributed to the shop in its SO prefix. */
interface ShopSegment extends Segment {
  shopId: ShopId;
}

const SHOP_PATTERNS: { id: ShopId; pattern: RegExp }[] = [
  { id: "dayton", pattern: /dayton/i },
  { id: "springfield", pattern: /springfield/i },
  { id: "covington", pattern: /covington/i },
  { id: "greenville", pattern: /greenville/i },
  { id: "columbus", pattern: /columbus/i },
  { id: "mobile", pattern: /mobile/i },
];

const BILLABLE_COMMENT = /\b(tire|tires|plug|plugged|plugging|tow|towing|road\s*side|flat)\b/i;
const COMPLAINT = /^\s*([A-Za-z]{1,3}-\d+)\s*\/\s*(.*?)\s*$/;
/** Non-Pro and shop-meeting punches. Inactive clock time is not attendance. */
const ATTENDANCE_ACTIVITY = /non[-\s]?pro|shop\s*meeting|attendance/i;
/** Paul Henry’s Greenville stretches: waiting is not billable service-order time. */
const WAITING_ON_WORK = /waiting on (?:a )?(?:job|work)\b/i;
/**
 * Suggestion rules from the October 5 review. Earlier days keep the previous
 * nearest-order wording so live Submit and Confirm history stays on the same finding ids.
 */
const SUGGESTION_RULES_FROM = "2026-10-06";

export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isForeman(name: string): boolean {
  const key = normalizePersonName(name);
  return FOREMEN.some((foreman) => normalizePersonName(foreman) === key);
}

export function shopIdForTimesheetShop(shop: string): ShopId | null {
  const match = SHOP_PATTERNS.find((entry) => entry.pattern.test(shop));
  return match?.id ?? null;
}

/**
 * Service-order prefix → shop. Columbus is CL, so it is matched as a whole prefix
 * rather than as Covington’s C.
 */
const ORDER_PREFIXES: { prefix: string; id: ShopId }[] = [
  { prefix: "CL", id: "columbus" },
  { prefix: "C", id: "covington" },
  { prefix: "D", id: "dayton" },
  { prefix: "G", id: "greenville" },
  { prefix: "M", id: "mobile" },
  { prefix: "S", id: "springfield" },
];

export function shopIdForOrderId(orderId: string): ShopId | null {
  const prefix = orderId.trim().split("-")[0]?.toUpperCase() ?? "";
  return ORDER_PREFIXES.find((entry) => entry.prefix === prefix)?.id ?? null;
}

function shopLabel(shopId: ShopId): string {
  return SHOPS.find((shop) => shop.id === shopId)?.name ?? shopId;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
}

/**
 * Details List download. `Type` of SO Hours is a service-order segment.
 * `Type` of Clocked is the punch envelope. Clock In Comment is kept separate
 * from the trailing Comment column.
 */
export function parseDetailsListCsv(csv: string, date: string): FullbayTimesheetFile {
  const table = parseCsv(csv);
  const header = table[0]?.map((cell) => cell.trim()) ?? [];
  const missing = DETAILS_LIST_HEADERS.filter((name) => !header.includes(name));
  if (missing.length > 0) throw new Error(`Details List CSV is missing ${missing.join(", ")}.`);
  const index = new Map(header.map((name, position) => [name, position]));
  const cell = (record: string[], name: (typeof DETAILS_LIST_HEADERS)[number]) => (record[index.get(name) ?? -1] ?? "").trim();
  const rows: FullbayTimesheetRow[] = [];
  for (const record of table.slice(1)) {
    const employee = cell(record, "Employee");
    const shop = cell(record, "Shop");
    if (!employee && !shop) continue;
    const type = cell(record, "Type").toLowerCase();
    const complaint = cell(record, "SO / Complaint");
    const isSegment = type === "so hours" || (type !== "clocked" && complaint.length > 0);
    const hours = Number(cell(record, "Hours"));
    const clockOut = cell(record, "Clock Out");
    rows.push({
      shop,
      employee,
      clock_in: cell(record, "Clock In"),
      clock_in_activity: cell(record, "Clock In Activity"),
      clock_out: clockOut,
      hours: Number.isFinite(hours) ? hours : 0,
      so_complaint: isSegment ? complaint : "",
      comment: cell(record, "Comment"),
      clock_in_comment: cell(record, "Clock In Comment"),
      open_punch: clockOut.length === 0,
    });
  }
  return { date, rows };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseClockSeconds(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})(AM|PM)/i.exec(value.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const meridiem = match[4].toUpperCase();
  if (meridiem === "AM") {
    if (hours === 12) hours = 0;
  } else if (hours !== 12) {
    hours += 12;
  }
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function clockLabel(totalMinutes: number): string {
  const capped = Math.min(23 * 60 + 59, Math.max(0, totalMinutes));
  const hour = Math.floor(capped / 60);
  const minute = capped % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function toMinute(seconds: number): number {
  return Math.round(seconds / 60);
}

function impliedEnd(start: number, end: number | null, hours: number): number {
  if (end != null) return end;
  return start + Math.max(0, Math.round(hours * 3600));
}

function slug(name: string): string {
  return normalizePersonName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseComplaint(value: string): { orderId: string; title: string } | null {
  const match = COMPLAINT.exec(value);
  if (!match) return null;
  return { orderId: match[1].toUpperCase(), title: match[2].trim() };
}

function segmentLabel(segment: Segment): string {
  return segment.title ? `${segment.orderId} / ${segment.title}` : segment.orderId;
}

function nearestOrder(
  gapStart: number,
  gapEnd: number,
  segments: Segment[],
): { segment: Segment; side: "next" | "previous" } | null {
  let previous: Segment | null = null;
  let next: Segment | null = null;
  for (const segment of segments) {
    const end = impliedEnd(segment.start, segment.end, segment.hours);
    if (end <= gapStart + 5 && (previous == null || impliedEnd(previous.start, previous.end, previous.hours) <= end)) {
      previous = segment;
    }
    if (segment.start >= gapEnd - 5 && (next == null || segment.start < next.start)) next = segment;
  }
  if (previous == null && next == null) return null;
  if (previous == null && next != null) return { segment: next, side: "next" };
  if (previous != null && next == null) return { segment: previous, side: "previous" };
  if (previous == null || next == null) return null;
  const previousDistance = Math.max(0, gapStart - impliedEnd(previous.start, previous.end, previous.hours));
  const nextDistance = Math.max(0, next.start - gapEnd);
  if (nextDistance <= previousDistance) return { segment: next, side: "next" };
  return { segment: previous, side: "previous" };
}

/**
 * Clock In Comment "Help {Name}" (also helping / helped / assist, with an optional "with")
 * names another tech on the same shop and day. When that person has a service-order
 * segment overlapping this punch, recommend their order. Cole Lozan’s 7:27–8:03
 * “Help Nick” uses Nick Sontag’s overlapping D-89637, rather than Cole’s own nearest SO.
 * No overlapping segment falls back to this tech’s nearest service order.
 */
function helpTargetName(comment: string): string | null {
  const match = /^(?:help(?:ing|ed)?|assist(?:ing|ed)?)(?:\s+with)?\s+(.+?)\s*$/i.exec(comment.trim());
  if (!match) return null;
  const name = match[1].replace(/^["']+|["',.!?;:]+$/g, "").trim();
  if (!/^[a-z][a-z .'-]*$/i.test(name)) return null;
  return name;
}

function personMatchesHelpTarget(person: string, target: string): boolean {
  const personTokens = normalizePersonName(person).split(" ").filter(Boolean);
  const targetTokens = normalizePersonName(target).split(" ").filter(Boolean);
  return targetTokens.length > 0 && targetTokens.every((token) => personTokens.includes(token));
}

function overlappingHelp(
  comment: string,
  gapStart: number,
  gapEnd: number,
  selfName: string,
  peers: PeerSegment[],
): PeerSegment | null {
  const target = helpTargetName(comment);
  if (!target) return null;
  const self = normalizePersonName(selfName);
  let best: { peer: PeerSegment; overlap: number } | null = null;
  for (const peer of peers) {
    if (normalizePersonName(peer.name) === self) continue;
    if (!personMatchesHelpTarget(peer.name, target)) continue;
    const end = impliedEnd(peer.segment.start, peer.segment.end, peer.segment.hours);
    const overlap = Math.min(gapEnd, end) - Math.max(gapStart, peer.segment.start);
    if (overlap <= 0) continue;
    const earlier = best != null && peer.segment.start < best.peer.segment.start;
    const sameStart = best != null && peer.segment.start === best.peer.segment.start && peer.segment.orderId < best.peer.segment.orderId;
    if (best == null || overlap > best.overlap || (overlap === best.overlap && (earlier || sameStart))) {
      best = { peer, overlap };
    }
  }
  return best?.peer ?? null;
}

function segmentSpan(segment: Segment): { start: string; end: string } {
  const end = impliedEnd(segment.start, segment.end, segment.hours);
  return { start: clockLabel(toMinute(segment.start)), end: clockLabel(Math.max(toMinute(segment.start), toMinute(end))) };
}

function recommendationForPeer(
  start: string,
  end: string,
  minutes: number,
  peer: PeerSegment,
  comment: string,
  open: boolean,
): Recommendation {
  const work = peer.segment.title;
  const label = work ? `${peer.segment.orderId} ${work}` : peer.segment.orderId;
  const span = segmentSpan(peer.segment);
  const openNote = open ? ` ${OPEN_PUNCH_NOTE}` : "";
  return {
    orderId: peer.segment.orderId,
    work,
    start,
    end,
    minutes,
    summary: `Put this on ${label}. Clock In Comment “${comment}” matches ${peer.name}, who is on that order ${formatClock(span.start)}–${formatClock(span.end)}.${openNote}`,
  };
}

function previousSegment(gapStart: number, segments: Segment[]): Segment | null {
  let previous: Segment | null = null;
  for (const segment of segments) {
    const end = impliedEnd(segment.start, segment.end, segment.hours);
    if (end <= gapStart + 5 && (previous == null || impliedEnd(previous.start, previous.end, previous.hours) <= end)) {
      previous = segment;
    }
  }
  return previous;
}

function recommendationFor(
  start: string,
  end: string,
  minutes: number,
  segments: Segment[],
  gapStart: number,
  gapEnd: number,
  open: boolean,
  sideLimit: "either" | "previous" = "either",
): Recommendation | null {
  const nearest =
    sideLimit === "previous"
      ? (() => {
          const previous = previousSegment(gapStart, segments);
          return previous ? { segment: previous, side: "previous" as const } : null;
        })()
      : nearestOrder(gapStart, gapEnd, segments);
  if (!nearest) return null;
  const work = nearest.segment.title;
  const name = work ? `${nearest.segment.orderId} ${work}` : nearest.segment.orderId;
  const openNote = open ? ` ${OPEN_PUNCH_NOTE}` : "";
  const summary =
    nearest.side === "next"
      ? `Start ${name} at ${formatClock(start)} instead of ${formatClock(end)}. The timesheet has no service order on this stretch.${openNote}`
      : `Keep ${name} until ${formatClock(end)}. The timesheet has no service order on this stretch.${openNote}`;
  return {
    orderId: nearest.segment.orderId,
    work,
    start,
    end,
    minutes,
    summary,
  };
}

function windowOf(startSeconds: number, endSeconds: number): { start: string; end: string; minutes: number } | null {
  const start = toMinute(startSeconds);
  const end = toMinute(endSeconds);
  const minutes = end - start;
  if (minutes < 1 || endSeconds - startSeconds < 60) return null;
  return { start: clockLabel(start), end: clockLabel(end), minutes };
}

interface BuiltTech {
  technician: Technician;
  findings: Finding[];
  orders: ServiceOrder[];
  firstStart: number;
}

function segmentsFromRows(rows: FullbayTimesheetRow[]): Segment[] {
  const segments: Segment[] = [];
  for (const row of rows) {
    const complaint = parseComplaint(row.so_complaint);
    if (!complaint) continue;
    const start = parseClockSeconds(row.clock_in);
    if (start == null) continue;
    const end = row.clock_out ? parseClockSeconds(row.clock_out) : null;
    segments.push({ start, end, hours: Number(row.hours) || 0, orderId: complaint.orderId, title: complaint.title });
  }
  return segments;
}

function suggestionRules(day: string): boolean {
  return day >= SUGGESTION_RULES_FROM;
}

interface TimedOrder {
  orderId: string;
  work: string;
  shopId: ShopId;
  clockIn: string;
  clockOut: string;
  start: number;
  end: number;
}

function windowsOverlap(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  return start < otherEnd && otherStart < end;
}

/**
 * Neighbors are this tech's service-order punches on any shop.
 * A side is offered only when the new clock window does not overlap a different punch.
 */
function buildNonProReview(
  startSeconds: number,
  endSeconds: number,
  segments: Segment[],
  foreignSegments: ShopSegment[],
  shopId: ShopId,
): NonProReview {
  const punches: TimedOrder[] = [];
  for (const segment of segments) punches.push(timedOrder(segment, shopId));
  for (const segment of foreignSegments) punches.push(timedOrder(segment, segment.shopId));

  let previous: TimedOrder | null = null;
  let next: TimedOrder | null = null;
  for (const punch of punches) {
    if (punch.end <= startSeconds + 5) {
      const later = previous == null || punch.end > previous.end || (punch.end === previous.end && punch.start >= previous.start);
      if (later) previous = punch;
    }
    if (punch.start >= endSeconds - 5) {
      const earlier = next == null || punch.start < next.start || (punch.start === next.start && punch.orderId < next.orderId);
      if (earlier) next = punch;
    }
  }

  function blocked(start: number, end: number, self: TimedOrder | null): boolean {
    return punches.some((punch) => {
      if (self && samePunch(punch, self)) return false;
      return windowsOverlap(start, end, punch.start, punch.end);
    });
  }

  const previousOk = previous != null && !blocked(previous.start, endSeconds, previous);
  const nextOk = next != null && !blocked(startSeconds, next.end, next);
  const spanMinutes = toMinute(endSeconds) - toMinute(startSeconds);
  return {
    previous: previousOk && previous ? neighborOf(previous) : null,
    next: nextOk && next ? neighborOf(next) : null,
    canSplit: Boolean(previousOk && nextOk && spanMinutes >= 2),
    orders: orderOptions(punches, startSeconds, endSeconds),
    punches: punches.map(neighborOf),
  };
}

function timedOrder(segment: Segment, shopId: ShopId): TimedOrder {
  const end = impliedEnd(segment.start, segment.end, segment.hours);
  return {
    orderId: segment.orderId,
    work: segment.title,
    shopId,
    clockIn: clockLabel(toMinute(segment.start)),
    clockOut: clockLabel(Math.max(toMinute(segment.start), toMinute(end))),
    start: segment.start,
    end,
  };
}

function samePunch(punch: TimedOrder, other: TimedOrder): boolean {
  return punch.orderId === other.orderId && punch.shopId === other.shopId && punch.start === other.start && punch.end === other.end;
}

function neighborOf(punch: TimedOrder): NonProNeighbor {
  return { orderId: punch.orderId, work: punch.work, shopId: punch.shopId, clockIn: punch.clockIn, clockOut: punch.clockOut };
}

function orderOptions(punches: TimedOrder[], startSeconds: number, endSeconds: number): NonProOrderOption[] {
  const byId = new Map<string, NonProOrderOption & { distance: number }>();
  for (const punch of punches) {
    const distance = punch.end <= startSeconds ? startSeconds - punch.end : punch.start >= endSeconds ? punch.start - endSeconds : 0;
    const current = byId.get(punch.orderId);
    const closer = current == null || distance < current.distance || (distance === current.distance && punch.work.length > current.work.length);
    if (closer) byId.set(punch.orderId, { orderId: punch.orderId, work: punch.work, shopId: punch.shopId, distance });
  }
  return [...byId.values()]
    .sort((a, b) => a.orderId.localeCompare(b.orderId))
    .map(({ orderId, work, shopId: id }) => ({ orderId, work, shopId: id }));
}

/** Seconds of [start, end] covered by the union of these segments. */
function coveredSeconds(start: number, end: number, covers: Segment[]): number {
  const pieces: Array<[number, number]> = [];
  for (const segment of covers) {
    const segmentEnd = impliedEnd(segment.start, segment.end, segment.hours);
    const from = Math.max(start, segment.start);
    const to = Math.min(end, segmentEnd);
    if (to > from) pieces.push([from, to]);
  }
  pieces.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let cursor = start;
  for (const [from, to] of pieces) {
    const begin = Math.max(from, cursor);
    if (to > begin) total += to - begin;
    cursor = Math.max(cursor, to);
  }
  return total;
}

/**
 * Hours of this shop's clock punches that are already on another shop's service order.
 * Own service-order time stays in the clocked total. The fraction uses each punch's Hours column.
 */
function foreignHoursInsidePunches(punches: Punch[], local: Segment[], foreign: Segment[]): number {
  let covered = 0;
  for (const punch of punches) {
    const punchEnd = impliedEnd(punch.start, punch.end, punch.hours);
    const span = punchEnd - punch.start;
    if (!(span > 0) || !(punch.hours > 0)) continue;
    let foreignSeconds = 0;
    let pieces: Array<[number, number]> = [[punch.start, punchEnd]];
    for (const segment of local) {
      const segmentEnd = impliedEnd(segment.start, segment.end, segment.hours);
      const next: Array<[number, number]> = [];
      for (const [start, end] of pieces) {
        const coverStart = Math.max(start, segment.start);
        const coverEnd = Math.min(end, segmentEnd);
        if (coverEnd <= coverStart) {
          next.push([start, end]);
          continue;
        }
        if (start < coverStart) next.push([start, coverStart]);
        if (coverEnd < end) next.push([coverEnd, end]);
      }
      pieces = next;
    }
    for (const [start, end] of pieces) foreignSeconds += coveredSeconds(start, end, foreign);
    covered += punch.hours * (foreignSeconds / span);
  }
  return covered;
}

function isAttendanceActivity(activity: string): boolean {
  return ATTENDANCE_ACTIVITY.test(activity.trim());
}

/** Midnight-to-midnight Inactive row with no service order, such as a 24-hour placeholder. */
function isInactiveDayPlaceholder(row: FullbayTimesheetRow): boolean {
  if (row.so_complaint.trim()) return false;
  if (row.clock_in_activity.trim().toLowerCase() !== "inactive") return false;
  if (Math.abs((Number(row.hours) || 0) - 24) > 0.001) return false;
  const start = parseClockSeconds(row.clock_in);
  const end = row.clock_out ? parseClockSeconds(row.clock_out) : null;
  return start === 0 && end === 0;
}

function buildTech(
  day: string,
  shopId: ShopId,
  name: string,
  rows: FullbayTimesheetRow[],
  peers: PeerSegment[],
  foreignSegments: ShopSegment[],
): BuiltTech | null {
  if (isForeman(name)) return null;
  const rules = suggestionRules(day);

  const punches: Punch[] = [];
  const segments: Segment[] = [];
  for (const row of rows) {
    if (isInactiveDayPlaceholder(row)) continue;
    const start = parseClockSeconds(row.clock_in);
    if (start == null) continue;
    const end = row.clock_out ? parseClockSeconds(row.clock_out) : null;
    const hours = Number(row.hours) || 0;
    const complaint = parseComplaint(row.so_complaint);
    if (complaint) {
      segments.push({ start, end, hours, orderId: complaint.orderId, title: complaint.title });
    } else if (!row.so_complaint.trim()) {
      const clockInComment = row.clock_in_comment?.trim() ?? "";
      punches.push({
        start,
        end,
        hours,
        activity: row.clock_in_activity.trim(),
        comment: clockInComment || row.comment.trim(),
        commentFromClockIn: clockInComment.length > 0,
      });
    }
  }

  const soHours = round2(segments.reduce((sum, segment) => sum + segment.hours, 0));
  if (segments.length === 0 || soHours === 0) return null;

  punches.sort((a, b) => a.start - b.start || (a.end ?? Number.MAX_SAFE_INTEGER) - (b.end ?? Number.MAX_SAFE_INTEGER));
  segments.sort((a, b) => a.start - b.start || (a.end ?? Number.MAX_SAFE_INTEGER) - (b.end ?? Number.MAX_SAFE_INTEGER));

  const assigned: Segment[][] = punches.map(() => []);
  const orphans: Segment[] = [];
  for (const segment of segments) {
    let index = -1;
    for (let i = punches.length - 1; i >= 0; i -= 1) {
      const punch = punches[i];
      const next = punches[i + 1];
      const startsHere = segment.start >= punch.start - 5;
      const beforeNext = next == null || segment.start < next.start - 5;
      const beforeEnd = punch.end == null || segment.start <= punch.end + 5;
      if (startsHere && beforeNext && beforeEnd) {
        index = i;
        break;
      }
    }
    if (index >= 0) assigned[index].push(segment);
    else orphans.push(segment);
  }

  const techId = slug(name);
  const findings: Finding[] = [];
  let sequence = 0;

  function push(finding: Omit<Finding, "id" | "day" | "shopId" | "techId">) {
    sequence += 1;
    findings.push({
      id: `${day}-${shopId}-${techId}-${String(sequence).padStart(2, "0")}`,
      day,
      shopId,
      techId,
      ...finding,
    });
  }

  // A segment is attached to the punch where it starts, but a pencil edit can run that
  // service order into the next clock punch. Time already on an order is not a gap.
  // Punches on another shop's service orders cover the same way. They are not this shop's hours.
  function subtractSegments(startSeconds: number, endSeconds: number, covers: Segment[]): Array<[number, number]> {
    let pieces: Array<[number, number]> = [[startSeconds, endSeconds]];
    for (const segment of covers) {
      const segmentEnd = impliedEnd(segment.start, segment.end, segment.hours);
      const next: Array<[number, number]> = [];
      for (const [start, end] of pieces) {
        const coverStart = Math.max(start, segment.start);
        const coverEnd = Math.min(end, segmentEnd);
        if (coverEnd <= coverStart) {
          next.push([start, end]);
          continue;
        }
        if (start < coverStart) next.push([start, coverStart]);
        if (coverEnd < end) next.push([coverEnd, end]);
      }
      pieces = next;
    }
    return pieces;
  }

  function uncoveredByServiceOrders(startSeconds: number, endSeconds: number): Array<[number, number]> {
    return subtractSegments(startSeconds, endSeconds, [...segments, ...foreignSegments]);
  }

  function pushUncovered(
    startSeconds: number,
    endSeconds: number,
    open: boolean,
    activity: string,
    comment: string,
    commentFromClockIn: boolean,
    wholePunch: boolean,
    nextIsAttendance: boolean,
  ) {
    const basePieces = subtractSegments(startSeconds, endSeconds, segments);
    const pieces = uncoveredByServiceOrders(startSeconds, endSeconds);
    const parentIsFull =
      basePieces.length === 1 && basePieces[0][0] === startSeconds && basePieces[0][1] === endSeconds;
    for (const [start, end] of pieces) {
      const fullPiece = pieces.length === 1 && start === startSeconds && end === endSeconds;
      const reachesPunchEnd = end >= endSeconds - 5;
      pushGap(
        start,
        end,
        open && end >= endSeconds - 1,
        activity,
        comment,
        commentFromClockIn,
        wholePunch && (fullPiece || parentIsFull),
        nextIsAttendance && reachesPunchEnd,
      );
    }
  }

  function pushGap(
    startSeconds: number,
    endSeconds: number,
    open: boolean,
    activity: string,
    comment: string,
    commentFromClockIn: boolean,
    wholePunch: boolean,
    nextIsAttendance: boolean,
  ) {
    const window = windowOf(startSeconds, endSeconds);
    if (!window) return;
    const billable = wholePunch && comment.length > 0 && BILLABLE_COMMENT.test(comment);
    const activityText = activity && activity !== "Inactive" ? ` Activity: ${activity}.` : "";
    const openText = open ? ` ${OPEN_PUNCH_NOTE}` : "";
    const commentText = comment
      ? commentFromClockIn
        ? ` Clock In Comment: “${comment}”.`
        : ` Comment: “${comment}”.`
      : "";
    let detail = wholePunch
      ? `Clocked.${activityText} No service order on this punch.${commentText}${openText}`
      : `Clocked. No service order on this stretch.${openText}`;
    const attendance = wholePunch && isAttendanceActivity(activity);
    const waiting = wholePunch && WAITING_ON_WORK.test(comment);
    if (rules && waiting) {
      push({
        kind: "gap",
        start: window.start,
        end: window.end,
        minutes: window.minutes,
        detail,
        suggested: `Non-Pro “${comment}”. That stretch stays off billable service-order time.`,
        recommendation: null,
      });
      return;
    }
    if (rules && attendance) {
      push({
        kind: "gap",
        start: window.start,
        end: window.end,
        minutes: window.minutes,
        detail,
        suggested: "Review. Non-Pro attendance may or may not be valid.",
        nonPro: buildNonProReview(startSeconds, endSeconds, segments, foreignSegments, shopId),
        recommendation: null,
      });
      return;
    }
    const peer = commentFromClockIn ? overlappingHelp(comment, startSeconds, endSeconds, name, peers) : null;
    if (peer) {
      const span = segmentSpan(peer.segment);
      const orderLabel = peer.segment.title ? `${peer.segment.orderId} / ${peer.segment.title}` : peer.segment.orderId;
      detail += ` ${peer.name}’s overlapping order is ${orderLabel} (${formatClock(span.start)}–${formatClock(span.end)}).`;
      push({
        kind: "gap",
        start: window.start,
        end: window.end,
        minutes: window.minutes,
        detail,
        recommendation: recommendationForPeer(window.start, window.end, window.minutes, peer, comment, open),
      });
      return;
    }
    if (rules && nextIsAttendance) {
      const recommendation = recommendationFor(
        window.start,
        window.end,
        window.minutes,
        segments,
        startSeconds,
        endSeconds,
        open,
        "previous",
      );
      if (!recommendation) {
        push({
          kind: "gap",
          start: window.start,
          end: window.end,
          minutes: window.minutes,
          detail,
          suggested: "The next punch is Non-Pro. There is no earlier service order to extend up to that start.",
          recommendation: null,
        });
        return;
      }
      push({
        kind: "gap",
        start: window.start,
        end: window.end,
        minutes: window.minutes,
        detail,
        recommendation,
      });
      return;
    }
    if (billable) {
      push({
        kind: "flag",
        start: window.start,
        end: window.end,
        minutes: window.minutes,
        detail,
        suggested: `Clocked with no service order. The note looks like billable work (“${comment}”). This timesheet does not name an order for it, so no edit is proposed.`,
        recommendation: null,
      });
      return;
    }
    const recommendation = recommendationFor(window.start, window.end, window.minutes, segments, startSeconds, endSeconds, open);
    if (!recommendation) {
      push({
        kind: "flag",
        start: window.start,
        end: window.end,
        minutes: window.minutes,
        detail,
        suggested: "Clocked with no service order, and no other service order for this tech today. No edit from this timesheet.",
        recommendation: null,
      });
      return;
    }
    push({
      kind: "gap",
      start: window.start,
      end: window.end,
      minutes: window.minutes,
      detail,
      recommendation,
    });
  }

  function pushSegment(segment: Segment) {
    const endSeconds = impliedEnd(segment.start, segment.end, segment.hours);
    const start = clockLabel(toMinute(segment.start));
    const end = clockLabel(Math.max(toMinute(segment.start), toMinute(endSeconds)));
    const open = segment.end == null;
    const label = segmentLabel(segment);
    push({
      kind: "as_is",
      start,
      end,
      minutes: 0,
      detail: open ? `${label}. ${OPEN_PUNCH_NOTE}` : `${label}.`,
      suggested: open ? "Leave as is. Still clocked on this order." : "Leave as is.",
      recommendation: null,
    });
  }

  for (let i = 0; i < punches.length; i += 1) {
    const punch = punches[i];
    const punchEnd = impliedEnd(punch.start, punch.end, punch.hours);
    const open = punch.end == null;
    const nested = assigned[i];
    let cursor = punch.start;
    const next = punches[i + 1];
    const nextIsAttendance = next != null && isAttendanceActivity(next.activity);
    if (nested.length === 0) {
      pushUncovered(punch.start, punchEnd, open, punch.activity, punch.comment, punch.commentFromClockIn, true, nextIsAttendance);
    } else {
      for (const segment of nested) {
        if (segment.start > cursor) pushUncovered(cursor, segment.start, false, punch.activity, "", false, false, false);
        pushSegment(segment);
        cursor = Math.max(cursor, impliedEnd(segment.start, segment.end, segment.hours));
      }
      if (punchEnd > cursor) pushUncovered(cursor, punchEnd, open, punch.activity, "", false, false, nextIsAttendance);
    }

    if (punch.end != null && next && next.start - punch.end >= 60) {
      const pieces = subtractSegments(punch.end, next.start, foreignSegments);
      for (const [start, end] of pieces) {
        const window = windowOf(start, end);
        if (!window) continue;
        push({
          kind: "off_clock",
          start: window.start,
          end: window.end,
          minutes: window.minutes,
          detail: "Off the clock.",
          suggested: "No edit.",
          recommendation: null,
        });
      }
    }
  }

  for (const segment of orphans) pushSegment(segment);

  const foreignSorted = [...foreignSegments].sort(
    (a, b) => a.start - b.start || a.orderId.localeCompare(b.orderId) || a.shopId.localeCompare(b.shopId),
  );
  for (const segment of foreignSorted) {
    const endSeconds = impliedEnd(segment.start, segment.end, segment.hours);
    const start = clockLabel(toMinute(segment.start));
    const end = clockLabel(Math.max(toMinute(segment.start), toMinute(endSeconds)));
    const shop = shopLabel(segment.shopId);
    const label = segmentLabel(segment);
    const open = segment.end == null;
    const openNote = open ? ` ${OPEN_PUNCH_NOTE}` : "";
    push({
      kind: "as_is",
      start,
      end,
      minutes: 0,
      notAGap: true,
      detail: `${shop} ${label}.${openNote} On that shop’s service order, so this stretch is not a gap here.`,
      suggested: `No edit. Covered on the ${shop} shop.`,
      recommendation: null,
    });
  }

  const rawClocked = round2(punches.reduce((sum, punch) => sum + punch.hours, 0) + orphans.reduce((sum, segment) => sum + segment.hours, 0));
  const coveredByOtherShops = foreignHoursInsidePunches(punches, segments, foreignSegments);
  let clockedHours = round2(Math.max(0, rawClocked - coveredByOtherShops));
  if (soHours - clockedHours > 0.05) clockedHours = soHours;
  const foreignCoveredHours = round2(rawClocked - clockedHours);
  const orders: ServiceOrder[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    if (seen.has(segment.orderId)) continue;
    seen.add(segment.orderId);
    orders.push({ id: segment.orderId, shopId, title: segment.title, status: "priorities" });
  }
  for (const finding of findings) {
    const recommended = finding.recommendation;
    if (!recommended || seen.has(recommended.orderId)) continue;
    seen.add(recommended.orderId);
    orders.push({ id: recommended.orderId, shopId, title: recommended.work, status: "priorities" });
  }

  return {
    technician: {
      id: techId,
      shopId,
      name: name.trim().replace(/\s+/g, " "),
      clockedHours,
      soHours,
      ...(foreignCoveredHours > 0 ? { foreignCoveredHours } : {}),
    },
    findings,
    orders,
    firstStart: punches[0]?.start ?? segments[0]?.start ?? 0,
  };
}

/**
 * Fullbay timesheet rows are two layers. Rows with no service order are the clock punches.
 * Rows with `so_complaint` are the service-order segments inside those punches.
 * Each service order is attributed by its prefix (D Dayton, M Mobile, S Springfield,
 * C Covington, G Greenville, CL Columbus). A tech with service-order time at more than
 * one shop is listed on each of those shops, not on a single home shop. Clock rows
 * with no service order stay on the timesheet Shop column.
 * When gaps are built, that tech’s service-order punches on every shop count as covered.
 * Another shop’s punch is timeline context only: not editable, and not added to this
 * shop’s service-order hours. Clocked hours for the shop leave out the part of a clock
 * punch already covered by another shop’s service order, so utilization stays in scope.
 * Clocked hours are the punch hours, including elapsed hours already stored on an open punch.
 * Open findings say that end is elapsed scrape time. No clock-out is invented.
 * Service-order hours are the segment hours. A tech with none, and every named foreman, is omitted.
 */
export function timesheetToDayReports(file: FullbayTimesheetFile): DayReport[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(file.date)) throw new Error("Timesheet date must be YYYY-MM-DD.");
  const grouped = new Map<string, { shopId: ShopId; name: string; rows: FullbayTimesheetRow[] }>();
  for (const row of file.rows) {
    const name = row.employee.trim().replace(/\s+/g, " ");
    if (!name) continue;
    const complaint = parseComplaint(row.so_complaint);
    const shopFromOrder = complaint ? shopIdForOrderId(complaint.orderId) : null;
    const shopId = shopFromOrder ?? shopIdForTimesheetShop(row.shop);
    if (!shopId) continue;
    const key = `${shopId}\0${normalizePersonName(name)}`;
    const current = grouped.get(key);
    if (current) current.rows.push(row);
    else grouped.set(key, { shopId, name, rows: [row] });
  }

  const peersByShop = new Map<ShopId, PeerSegment[]>();
  const segmentsByPerson = new Map<string, ShopSegment[]>();
  for (const group of grouped.values()) {
    const list = peersByShop.get(group.shopId) ?? [];
    const personKey = normalizePersonName(group.name);
    const personSegments = segmentsByPerson.get(personKey) ?? [];
    for (const segment of segmentsFromRows(group.rows)) {
      list.push({ name: group.name, segment });
      personSegments.push({ ...segment, shopId: group.shopId });
    }
    peersByShop.set(group.shopId, list);
    segmentsByPerson.set(personKey, personSegments);
  }

  const byShop = new Map<ShopId, BuiltTech[]>();
  for (const group of grouped.values()) {
    const personSegments = segmentsByPerson.get(normalizePersonName(group.name)) ?? [];
    const foreignSegments = personSegments.filter((segment) => segment.shopId !== group.shopId);
    const built = buildTech(
      file.date,
      group.shopId,
      group.name,
      group.rows,
      peersByShop.get(group.shopId) ?? [],
      foreignSegments,
    );
    if (!built) continue;
    const list = byShop.get(group.shopId) ?? [];
    list.push(built);
    byShop.set(group.shopId, list);
  }

  const reports: DayReport[] = [];
  for (const shop of SHOPS) {
    const techs = byShop.get(shop.id);
    if (!techs || techs.length === 0) continue;
    techs.sort((a, b) => a.firstStart - b.firstStart || a.technician.name.localeCompare(b.technician.name));
    const orders: ServiceOrder[] = [];
    const seen = new Set<string>();
    for (const tech of techs) {
      for (const order of tech.orders) {
        if (seen.has(order.id)) continue;
        seen.add(order.id);
        orders.push(order);
      }
    }
    orders.sort((a, b) => a.id.localeCompare(b.id));
    reports.push({
      day: file.date,
      shopId: shop.id,
      technicians: techs.map((tech) => tech.technician),
      findings: techs.flatMap((tech) => tech.findings),
      orders,
    });
  }
  return reports;
}

/** October 2 through October 9 use the Details List download (Clock In Comment). */
export const OCTOBER_2_REPORTS = timesheetToDayReports(parseDetailsListCsv(FRIDAY_DETAILS_CSV, "2026-10-02"));
export const OCTOBER_3_REPORTS = timesheetToDayReports(parseDetailsListCsv(SATURDAY_DETAILS_CSV, "2026-10-03"));
export const OCTOBER_5_REPORTS = timesheetToDayReports(parseDetailsListCsv(MONDAY_DETAILS_CSV, "2026-10-05"));
export const OCTOBER_6_REPORTS = timesheetToDayReports(parseDetailsListCsv(TUESDAY_DETAILS_CSV, "2026-10-06"));
export const OCTOBER_7_REPORTS = timesheetToDayReports(parseDetailsListCsv(WEDNESDAY_DETAILS_CSV, "2026-10-07"));
export const OCTOBER_8_REPORTS = timesheetToDayReports(parseDetailsListCsv(THURSDAY_DETAILS_CSV, "2026-10-08"));
export const OCTOBER_9_REPORTS = timesheetToDayReports(parseDetailsListCsv(FRIDAY_OCTOBER_9_DETAILS_CSV, "2026-10-09"));

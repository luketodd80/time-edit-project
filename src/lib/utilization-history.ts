import { addDays } from "@/lib/dates";
import { latestEditsForShopDay, minutesPickedUp, type FullbayEditBatch } from "@/lib/fullbay-edit-queue";
import { utilization } from "@/lib/review";
import { SHOPS, type DayReport, type ShopId } from "@/lib/types";

/**
 * Compact per-day, per-shop, per-tech utilization.
 * The committed file is `data/utilization-history.json`. A live file, when present, wins.
 * Merging never drops a shop day that the fresh snapshot does not include, so a seed refresh
 * that stops shipping an older day keeps that day's before/after numbers.
 */
export interface UtilTechSnapshot {
  id: string;
  name: string;
  clockedHours: number;
  soHours: number;
  addedMinutes: number;
}

export interface UtilShopDay {
  day: string;
  shopId: ShopId;
  /**
   * True when the apply queue had at least one edit for this shop day.
   * A later snapshot with no queue rows keeps the stored minutes instead of writing zeros.
   */
  queueCovered: boolean;
  techs: UtilTechSnapshot[];
}

export interface UtilRollup {
  clockedHours: number;
  soHours: number;
  addedMinutes: number;
  before: number | null;
  after: number | null;
  /** After minus before, in percentage points. Null when there are no clocked hours. */
  changePoints: number | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SHOP_IDS = new Set<string>(SHOPS.map((shop) => shop.id));

export function canonicalUtilizationHistory(days: UtilShopDay[]): UtilShopDay[] {
  return days
    .map((row) => ({
      day: row.day,
      shopId: row.shopId,
      queueCovered: row.queueCovered,
      techs: [...row.techs].sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.shopId.localeCompare(b.shopId));
}

export function serializeUtilizationHistory(days: UtilShopDay[]): string {
  return `${JSON.stringify({ days: canonicalUtilizationHistory(days) }, null, 2)}\n`;
}

export function parseUtilizationHistory(value: unknown): UtilShopDay[] {
  if (!value || typeof value !== "object") return [];
  const rows = (value as { days?: unknown }).days;
  if (!Array.isArray(rows)) return [];
  const parsed: UtilShopDay[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (typeof record.day !== "string" || !DAY.test(record.day)) continue;
    if (typeof record.shopId !== "string" || !SHOP_IDS.has(record.shopId)) continue;
    if (!Array.isArray(record.techs)) continue;
    const techs: UtilTechSnapshot[] = [];
    for (const tech of record.techs) {
      if (!tech || typeof tech !== "object") continue;
      const item = tech as Record<string, unknown>;
      if (typeof item.id !== "string" || item.id.trim().length === 0) continue;
      if (typeof item.name !== "string" || item.name.trim().length === 0) continue;
      if (!isFiniteNumber(item.clockedHours) || !isFiniteNumber(item.soHours) || !isFiniteNumber(item.addedMinutes)) continue;
      techs.push({
        id: item.id,
        name: item.name,
        clockedHours: item.clockedHours,
        soHours: item.soHours,
        addedMinutes: item.addedMinutes,
      });
    }
    parsed.push({
      day: record.day,
      shopId: record.shopId as ShopId,
      queueCovered: record.queueCovered === true,
      techs,
    });
  }
  return canonicalUtilizationHistory(parsed);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Before hours come from each shop's loaded technicians (already scoped for cross-shop techs).
 * After minutes come only from applied and already_done edits, excluding false-gap / not-applied notes.
 */
export function snapshotFromReports(reports: DayReport[], batches: FullbayEditBatch[]): UtilShopDay[] {
  const rows: UtilShopDay[] = [];
  for (const report of reports) {
    const edits = [...latestEditsForShopDay(batches, report.day, report.shopId).values()];
    const added = new Map<string, number>();
    for (const edit of edits) {
      const minutes = minutesPickedUp(edit);
      if (minutes === 0) continue;
      const techId = techIdForEdit(report, edit);
      if (techId == null) continue;
      added.set(techId, (added.get(techId) ?? 0) + minutes);
    }
    rows.push({
      day: report.day,
      shopId: report.shopId,
      queueCovered: edits.length > 0,
      techs: report.technicians.map((tech) => ({
        id: tech.id,
        name: tech.name,
        clockedHours: tech.clockedHours,
        soHours: tech.soHours,
        addedMinutes: added.get(tech.id) ?? 0,
      })),
    });
  }
  return canonicalUtilizationHistory(rows);
}

function techIdForEdit(report: DayReport, edit: { findingId: string; techName: string }): string | null {
  const finding = report.findings.find((item) => item.id === edit.findingId);
  if (finding && report.technicians.some((tech) => tech.id === finding.techId)) return finding.techId;
  const byName = report.technicians.find((tech) => tech.name === edit.techName);
  return byName?.id ?? null;
}

/**
 * Fresh shop days replace stored ones when the fresh row saw the queue.
 * A fresh row that did not see the queue keeps stored minutes and the fresh baselines.
 * Shop days present only in the stored history stay.
 */
export function mergeUtilizationHistory(stored: UtilShopDay[], fresh: UtilShopDay[]): UtilShopDay[] {
  const map = new Map<string, UtilShopDay>();
  for (const row of canonicalUtilizationHistory(stored)) map.set(shopDayKey(row), row);
  for (const row of canonicalUtilizationHistory(fresh)) {
    const key = shopDayKey(row);
    const previous = map.get(key);
    if (!previous) {
      map.set(key, row);
      continue;
    }
    if (!row.queueCovered && previous.queueCovered) {
      const added = new Map(previous.techs.map((tech) => [tech.id, tech.addedMinutes]));
      map.set(key, {
        ...row,
        queueCovered: true,
        techs: row.techs.map((tech) => ({ ...tech, addedMinutes: added.get(tech.id) ?? tech.addedMinutes })),
      });
      continue;
    }
    map.set(key, row);
  }
  return canonicalUtilizationHistory([...map.values()]);
}

function shopDayKey(row: { day: string; shopId: ShopId }): string {
  return `${row.day}|${row.shopId}`;
}

export function rollupUtilization(techs: Array<Pick<UtilTechSnapshot, "clockedHours" | "soHours" | "addedMinutes">>): UtilRollup {
  const clockedHours = techs.reduce((sum, tech) => sum + tech.clockedHours, 0);
  const soHours = techs.reduce((sum, tech) => sum + tech.soHours, 0);
  const addedMinutes = techs.reduce((sum, tech) => sum + tech.addedMinutes, 0);
  const before = utilization(soHours, clockedHours);
  const after = utilization(soHours + addedMinutes / 60, clockedHours);
  return {
    clockedHours,
    soHours,
    addedMinutes,
    before,
    after,
    changePoints: before == null || after == null ? null : (after - before) * 100,
  };
}

export function eachDay(start: string, end: string): string[] {
  if (!DAY.test(start) || !DAY.test(end) || start > end) return [];
  const days: string[] = [];
  let day = start;
  for (let guard = 0; guard < 4000 && day <= end; guard += 1) {
    days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

export function historyDaysWithData(days: UtilShopDay[]): string[] {
  const present = new Set<string>();
  for (const row of days) {
    if (row.techs.some((tech) => tech.clockedHours > 0)) present.add(row.day);
  }
  return [...present].sort();
}

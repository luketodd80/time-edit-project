import { SHOPS, type DayReport, type Decision, type Finding, type PlannedEdit, type ServiceOrder, type ShopFilter, type ShopId, type Signoff, type SkippedOrder, type Submission, type Technician } from "@/lib/types";
import { appliedWindow } from "@/lib/time";

export const UTILIZATION_GOAL = 0.98;

export function shopName(shopId: ShopId): string {
  return SHOPS.find((shop) => shop.id === shopId)?.name ?? shopId;
}

export function shopsWithData(reports: DayReport[]): ShopId[] {
  const present = new Set(reports.map((report) => report.shopId));
  return SHOPS.filter((shop) => present.has(shop.id)).map((shop) => shop.id);
}

export function shopsInScope(shopId: ShopFilter, reports: DayReport[]): ShopId[] {
  const loaded = shopsWithData(reports);
  if (shopId === "all") return loaded;
  return loaded.filter((id) => id === shopId);
}

export function filterReports(reports: DayReport[], shopId: ShopFilter, days: string[]): DayReport[] {
  return reports.filter(
    (report) => days.includes(report.day) && (shopId === "all" || report.shopId === shopId),
  );
}

export function signoffKey(day: string, shopId: ShopId): string {
  return `${day}|${shopId}`;
}

export function statusLabel(status: ServiceOrder["status"]): string {
  if (status === "priorities") return "Open on priorities";
  if (status === "office") return "Office tab, not invoiced";
  return "Invoiced / closed";
}

export function orderFor(report: DayReport, orderId: string): ServiceOrder | undefined {
  return report.orders.find((order) => order.id === orderId);
}

export function techFor(report: DayReport, techId: string): Technician | undefined {
  return report.technicians.find((tech) => tech.id === techId);
}

/** Eligible orders are open on priorities or sitting on the office tab. Invoiced orders are not. */
export function isEligible(report: DayReport, finding: Finding): boolean {
  if (!finding.recommendation) return false;
  const order = orderFor(report, finding.recommendation.orderId);
  return order != null && order.status !== "invoiced";
}

export function techsWithFindings(report: DayReport): Technician[] {
  const ids = new Set(report.findings.map((finding) => finding.techId));
  return report.technicians.filter((tech) => ids.has(tech.id));
}

export function techsWithoutFindings(report: DayReport): Technician[] {
  const ids = new Set(report.findings.map((finding) => finding.techId));
  return report.technicians.filter((tech) => !ids.has(tech.id));
}

export interface TechOutlook {
  recommendedMinutes: number;
  requiredMinutes: number;
  optionalMinutes: number;
  /** SO minutes still needed to reach 98%, from the loaded baseline. */
  minutesToGoal: number;
  ifRequired: number | null;
  ifAll: number | null;
}

/** Utilization if every eligible recommendation is kept. Rejects and the no-order flag add nothing. */
export function techOutlook(report: DayReport, tech: Technician): TechOutlook {
  let requiredMinutes = 0;
  let optionalMinutes = 0;
  for (const finding of report.findings) {
    if (finding.techId !== tech.id || !finding.recommendation || !isEligible(report, finding)) continue;
    if (finding.recommendation.optional) optionalMinutes += finding.recommendation.minutes;
    else requiredMinutes += finding.recommendation.minutes;
  }
  const minutesToGoal = Math.max(0, Math.round((UTILIZATION_GOAL * tech.clockedHours - tech.soHours) * 60));
  return {
    recommendedMinutes: requiredMinutes + optionalMinutes,
    requiredMinutes,
    optionalMinutes,
    minutesToGoal,
    ifRequired: utilization(tech.soHours + requiredMinutes / 60, tech.clockedHours),
    ifAll: utilization(tech.soHours + (requiredMinutes + optionalMinutes) / 60, tech.clockedHours),
  };
}

export function ordersWithoutEdit(report: DayReport): ServiceOrder[] {
  const edited = new Set(
    report.findings.flatMap((finding) => (finding.recommendation ? [finding.recommendation.orderId] : [])),
  );
  return report.orders.filter((order) => !edited.has(order.id));
}

export function attest(current: Signoff | undefined, attested: boolean): Signoff {
  if (!attested) return { attested: false, doneAt: null };
  return { attested: true, doneAt: current?.doneAt ?? null };
}

/** A day stays open until the utilization checkbox is checked. */
export function markDone(current: Signoff | undefined, now: string): Signoff | null {
  if (!current?.attested) return null;
  return { attested: true, doneAt: now };
}

export type AuditStatus = "approved" | "partial" | "open";

export function auditStatus(day: string, shopIds: ShopId[], signoffs: Record<string, Signoff>): AuditStatus {
  if (shopIds.length === 0) return "open";
  const done = shopIds.filter((shopId) => signoffs[signoffKey(day, shopId)]?.doneAt).length;
  if (done === 0) return "open";
  if (done === shopIds.length) return "approved";
  return "partial";
}

export function auditLabel(status: AuditStatus): string {
  if (status === "approved") return "Approved";
  if (status === "partial") return "Partly approved";
  return "Not approved";
}

export function utilization(soHours: number, clockedHours: number): number | null {
  if (clockedHours <= 0) return null;
  return soHours / clockedHours;
}

export function goalText(ratio: number | null): string {
  if (ratio == null) return "No clocked hours";
  const points = (ratio - UTILIZATION_GOAL) * 100;
  const label = Math.abs(points).toFixed(1);
  if (Number(label) === 0) return "At the 98% goal";
  if (points > 0) return `${label} points above the 98% goal`;
  return `${label} points below the 98% goal`;
}

export interface TechTotal {
  shopId: ShopId;
  techId: string;
  name: string;
  clockedHours: number;
  baselineSoHours: number;
  addedMinutes: number;
}

export function addedMinutes(report: DayReport, finding: Finding, decision: Decision | undefined): number {
  if (!decision || !isEligible(report, finding) || !finding.recommendation) return 0;
  if (decision.kind === "reject") return 0;
  const window = appliedWindow(finding.recommendation, decision);
  if (!window.valid) return 0;
  return window.minutes;
}

export function techTotals(reports: DayReport[], decisions: Record<string, Decision>): TechTotal[] {
  const totals = new Map<string, TechTotal>();
  for (const report of reports) {
    for (const tech of report.technicians) {
      const key = `${report.shopId}|${tech.id}`;
      const current = totals.get(key) ?? {
        shopId: report.shopId,
        techId: tech.id,
        name: tech.name,
        clockedHours: 0,
        baselineSoHours: 0,
        addedMinutes: 0,
      };
      current.clockedHours += tech.clockedHours;
      current.baselineSoHours += tech.soHours;
      totals.set(key, current);
    }
    for (const finding of report.findings) {
      const minutes = addedMinutes(report, finding, decisions[finding.id]);
      if (minutes === 0) continue;
      const key = `${report.shopId}|${finding.techId}`;
      const current = totals.get(key);
      if (current) current.addedMinutes += minutes;
    }
  }
  return [...totals.values()];
}

export function soHoursAfter(total: TechTotal): number {
  return total.baselineSoHours + total.addedMinutes / 60;
}

export function sumTotals(totals: TechTotal[]): { clockedHours: number; baselineSoHours: number; addedMinutes: number } {
  return totals.reduce(
    (sum, total) => ({
      clockedHours: sum.clockedHours + total.clockedHours,
      baselineSoHours: sum.baselineSoHours + total.baselineSoHours,
      addedMinutes: sum.addedMinutes + total.addedMinutes,
    }),
    { clockedHours: 0, baselineSoHours: 0, addedMinutes: 0 },
  );
}

function plannedEdit(
  report: DayReport,
  finding: Finding,
  decision: Decision | undefined,
): PlannedEdit | null {
  if (!finding.recommendation || !isEligible(report, finding)) return null;
  const order = orderFor(report, finding.recommendation.orderId);
  const tech = techFor(report, finding.techId);
  if (!order || !tech) return null;

  if (!decision) {
    return {
      findingId: finding.id,
      day: report.day,
      shopId: report.shopId,
      techName: tech.name,
      orderId: order.id,
      work: finding.recommendation.work,
      orderStatus: order.status,
      decision: "undecided",
      start: finding.recommendation.start,
      end: finding.recommendation.end,
      minutes: 0,
      error: null,
    };
  }

  const window = appliedWindow(finding.recommendation, decision);
  return {
    findingId: finding.id,
    day: report.day,
    shopId: report.shopId,
    techName: tech.name,
    orderId: order.id,
    work: finding.recommendation.work,
    orderStatus: order.status,
    decision: decision.kind,
    start: window.start,
    end: window.end,
    minutes: decision.kind === "reject" || !window.valid ? 0 : window.minutes,
    error: window.error,
  };
}

export interface ReviewPlan {
  edits: PlannedEdit[];
  rejected: PlannedEdit[];
  undecided: PlannedEdit[];
  invalid: PlannedEdit[];
  skipped: SkippedOrder[];
}

export function buildPlan(reports: DayReport[], decisions: Record<string, Decision>): ReviewPlan {
  const plan: ReviewPlan = { edits: [], rejected: [], undecided: [], invalid: [], skipped: [] };

  for (const report of reports) {
    for (const finding of report.findings) {
      const edit = plannedEdit(report, finding, decisions[finding.id]);
      if (!edit) continue;
      if (edit.decision === "undecided") plan.undecided.push(edit);
      else if (edit.error) plan.invalid.push(edit);
      else if (edit.decision === "reject") plan.rejected.push(edit);
      else plan.edits.push(edit);
    }

    for (const order of report.orders) {
      if (order.status !== "invoiced") continue;
      plan.skipped.push({
        day: report.day,
        shopId: report.shopId,
        orderId: order.id,
        title: order.title,
        reason: "Invoiced / closed",
      });
    }
  }

  return plan;
}

export function submitBlockers(plan: ReviewPlan): string[] {
  if (plan.invalid.length > 0) {
    return plan.invalid.map((edit) => `${edit.techName} ${edit.orderId}: ${edit.error}`);
  }
  const decided = plan.edits.length + plan.rejected.length;
  const pending = plan.undecided.length;
  if (decided === 0 && pending === 0) return ["No recommendations to decide for this selection."];
  if (decided === 0) return ["Accept, reject, or override at least one recommendation."];
  return [];
}

export function buildSubmission(
  reports: DayReport[],
  decisions: Record<string, Decision>,
  shopId: ShopFilter,
  days: string[],
  submittedAt: string,
): Submission {
  const plan = buildPlan(reports, decisions);
  return {
    submittedAt,
    shopId,
    days: [...days].sort(),
    edits: plan.edits,
    rejected: plan.rejected,
    undecided: plan.undecided,
    skipped: plan.skipped,
  };
}

export function submissionFingerprint(submission: Pick<Submission, "shopId" | "days" | "edits" | "rejected" | "undecided" | "skipped">): string {
  return JSON.stringify({
    shopId: submission.shopId,
    days: [...submission.days].sort(),
    edits: submission.edits,
    rejected: submission.rejected,
    undecided: submission.undecided,
    skipped: submission.skipped,
  });
}

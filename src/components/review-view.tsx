"use client";

import { OrderStatusBadge } from "@/components/order-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDay } from "@/lib/dates";
import {
  buildPlan,
  isEligible,
  ordersWithoutEdit,
  shopName,
  statusLabel,
  submitBlockers,
  techOutlook,
  techsWithFindings,
  techsWithoutFindings,
  utilization,
  type TechOutlook,
} from "@/lib/review";
import type { DayReport, Decision, DecisionKind, Finding, Technician } from "@/lib/types";
import { appliedWindow, formatClock, formatDuration, formatPercent } from "@/lib/time";

export function ReviewView({
  days,
  reports,
  decisions,
  submitError,
  onDecision,
  onSubmit,
}: {
  days: string[];
  reports: DayReport[];
  decisions: Record<string, Decision>;
  submitError: string | null;
  onDecision: (findingId: string, decision: Decision | null) => void;
  onSubmit: () => void;
}) {
  const plan = buildPlan(reports, decisions);
  const blockers = submitBlockers(plan);
  const nothingToDecide = plan.edits.length + plan.rejected.length + plan.undecided.length + plan.invalid.length === 0;

  return (
    <div className="flex flex-col gap-8">
      {[...days].sort().map((day) => {
        const dayReports = reports.filter((report) => report.day === day);
        return (
          <section key={day} className="flex flex-col gap-4">
            <h2 className="text-xl font-medium">{formatDay(day)}</h2>
            {dayReports.length === 0 ? (
              <p className="rounded-xl bg-muted/50 p-4 text-sm leading-6">
                No findings for this selection. The day stays on the audit trail until it is signed off.
              </p>
            ) : (
              dayReports.map((report) => <ShopDay key={report.shopId} report={report} decisions={decisions} onDecision={onDecision} />)
            )}
          </section>
        );
      })}

      <div className="flex flex-col items-start gap-3 border-t pt-6">
        <Button type="button" size="lg" disabled={nothingToDecide} onClick={onSubmit}>
          Submit decisions
        </Button>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Saves this confirmation in the browser and queues accepted and overridden edits for Fullbay Time Stamp apply. Rejected edits are not queued.
        </p>
        {submitError ? (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        ) : blockers.some((blocker) => blocker.includes("valid")) ? (
          <p className="text-sm text-destructive">{blockers.join(" ")}</p>
        ) : null}
      </div>
    </div>
  );
}

function ShopDay({
  report,
  decisions,
  onDecision,
}: {
  report: DayReport;
  decisions: Record<string, Decision>;
  onDecision: (findingId: string, decision: Decision | null) => void;
}) {
  const active = techsWithFindings(report);
  const quiet = techsWithoutFindings(report).filter((tech) => {
    const ratio = utilization(tech.soHours, tech.clockedHours);
    return ratio != null && ratio >= 0.98;
  });
  const otherOrders = ordersWithoutEdit(report);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{shopName(report.shopId)} shop — missed time and suggested edits</p>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          Only time inside a clocked window counts. Off-the-clock stretches are in the table so the day reads straight through, and they are not gaps. Times are Eastern. Yellow is missed time. Orange is billable work with no service order.
        </p>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          These rows come from the Fullbay timesheet. A gap with no Clock In Comment is aimed at the nearest service order for that tech. A Clock In Comment that names a coworker, such as “Help Nick”, is aimed at that person’s overlapping service order on the same shop day. Orders are marked open on priorities.
        </p>
      </div>

      {active.map((tech) => (
        <TechDay key={tech.id} report={report} tech={tech} decisions={decisions} onDecision={onDecision} />
      ))}

      {quiet.length > 0 ? (
        <div className="flex flex-col gap-2">
          <NoChangeTable technicians={quiet} />
        </div>
      ) : null}

      {otherOrders.length > 0 ? (
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <h3 className="font-medium">Orders with no recommended edit</h3>
          <ul className="mt-3 flex flex-col gap-3 text-sm">
            {otherOrders.map((order) => (
              <li key={order.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {order.id}
                  {order.title ? ` ${order.title}` : ""}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <OrderStatusBadge status={order.status} />
                  <span className="text-muted-foreground">
                    {order.status === "invoiced" ? "Submit skips this order." : "No recommended edit."}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TechDay({
  report,
  tech,
  decisions,
  onDecision,
}: {
  report: DayReport;
  tech: Technician;
  decisions: Record<string, Decision>;
  onDecision: (findingId: string, decision: Decision | null) => void;
}) {
  const outlook = techOutlook(report, tech);
  const findings = report.findings
    .filter((finding) => finding.techId === tech.id)
    .slice()
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <article className="flex flex-col gap-3">
      <header>
        <h3 className="text-lg font-medium leading-7">{outcomeHeading(tech, outlook)}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{outcomeDetail(tech, outlook)}</p>
      </header>
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
          <caption className="sr-only">{tech.name} day, Eastern</caption>
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">What the report shows</th>
              <th className="px-3 py-2 font-medium">Missed</th>
              <th className="px-3 py-2 font-medium">Suggested edit</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding) => (
              <DayRows
                key={finding.id}
                report={report}
                tech={tech}
                finding={finding}
                decision={decisions[finding.id]}
                onDecision={onDecision}
              />
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function NoChangeTable({ technicians }: { technicians: Technician[] }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
        <caption className="bg-slate-800 px-3 py-2 text-left font-medium text-white">Already at or above 98% — no change</caption>
        <thead className="border-b bg-slate-100 text-slate-700">
          <tr>
            <th className="px-3 py-2 font-medium">Tech</th>
            <th className="px-3 py-2 font-medium">SO hours</th>
            <th className="px-3 py-2 font-medium">Clocked hours</th>
            <th className="px-3 py-2 font-medium">Utilization</th>
          </tr>
        </thead>
        <tbody>
          {technicians.map((tech) => {
            const ratio = utilization(tech.soHours, tech.clockedHours);
            return (
              <tr key={tech.id} className="border-b last:border-b-0">
                <td className="px-3 py-2">{tech.name}</td>
                <td className="px-3 py-2">{tech.soHours.toFixed(2)}</td>
                <td className="px-3 py-2">{tech.clockedHours.toFixed(2)}</td>
                <td className="px-3 py-2">{ratio == null ? "—" : formatPercent(ratio)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function outcomeHeading(tech: Technician, outlook: TechOutlook): string {
  if (tech.sheetLine) return `${tech.name} — ${tech.sheetLine}`;
  const ratio = utilization(tech.soHours, tech.clockedHours);
  const now = ratio == null ? "No clocked hours" : formatPercent(ratio);
  const hours = `${tech.soHours.toFixed(2)} SO / ${tech.clockedHours.toFixed(2)} clocked`;
  if (outlook.optionalMinutes > 0 && outlook.requiredMinutes > 0 && outlook.ifRequired != null && outlook.ifAll != null) {
    return `${tech.name} — ${now} now (${hours}). About ${formatPercent(outlook.ifRequired)} if the required edits are made; about ${formatPercent(outlook.ifAll)} if the optional ${formatDuration(outlook.optionalMinutes)} is closed too.`;
  }
  if (outlook.ifAll != null && outlook.recommendedMinutes > 0) {
    return `${tech.name} — ${now} now (${hours}). About ${formatPercent(outlook.ifAll)} if the recommended edits are made.`;
  }
  return `${tech.name} — ${now} now (${hours}).`;
}

function outcomeDetail(tech: Technician, outlook: TechOutlook): string {
  if (tech.sheetNote) return tech.sheetNote;
  if (outlook.minutesToGoal === 0) return "Already at the 98% goal on the loaded hours.";
  return `Needs about ${formatDuration(outlook.minutesToGoal)} more SO time to reach 98%. Rejected edits add none. A row with no service order is not an edit until an order exists.`;
}

function DayRows({
  report,
  tech,
  finding,
  decision,
  onDecision,
}: {
  report: DayReport;
  tech: Technician;
  finding: Finding;
  decision: Decision | undefined;
  onDecision: (findingId: string, decision: Decision | null) => void;
}) {
  const recommendation = finding.recommendation;
  const order = recommendation ? report.orders.find((item) => item.id === recommendation.orderId) : undefined;
  const eligible = isEligible(report, finding);
  const preview = recommendation && decision ? appliedWindow(recommendation, decision) : null;
  const tone = finding.kind === "flag" ? "bg-orange-200" : finding.kind === "gap" ? "bg-yellow-100" : "bg-card";

  function choose(kind: DecisionKind) {
    if (!recommendation) return;
    if (decision?.kind === kind) {
      onDecision(finding.id, null);
      return;
    }
    if (kind === "override") {
      onDecision(finding.id, { kind, start: recommendation.start, end: recommendation.end });
      return;
    }
    onDecision(finding.id, { kind, start: "", end: "" });
  }

  return (
    <>
      <tr className={`border-b align-top ${tone}`}>
        <td className="px-3 py-3 whitespace-nowrap font-medium">
          {formatClock(finding.start)}–{formatClock(finding.end)}
        </td>
        <td className="px-3 py-3 leading-6">{reportText(finding)}</td>
        <td className="px-3 py-3 whitespace-nowrap">{missedText(finding)}</td>
        <td className="px-3 py-3 leading-6">
          <p>{suggestedText(finding)}</p>
          {recommendation?.optional ? <Badge variant="outline" className="mt-2">Optional</Badge> : null}
          {order ? (
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={order.status} />
              <span className="text-muted-foreground">{eligible ? "Eligible for a time edit." : `${statusLabel(order.status)}. Not eligible.`}</span>
            </p>
          ) : null}
          {eligible && recommendation ? (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Decision for ${tech.name} ${recommendation.orderId}`}>
                <Button type="button" size="sm" variant={decision?.kind === "accept" ? "default" : "outline"} aria-pressed={decision?.kind === "accept"} onClick={() => choose("accept")}>
                  Accept
                </Button>
                <Button type="button" size="sm" variant={decision?.kind === "reject" ? "destructive" : "outline"} aria-pressed={decision?.kind === "reject"} onClick={() => choose("reject")}>
                  Reject
                </Button>
                <Button type="button" size="sm" variant={decision?.kind === "override" ? "default" : "outline"} aria-pressed={decision?.kind === "override"} onClick={() => choose("override")}>
                  Override
                </Button>
              </div>
              {decision?.kind === "accept" ? <p>Accepted. Adds {formatDuration(recommendation.minutes)} to SO hours.</p> : null}
              {decision?.kind === "reject" ? <p>Rejected. Adds no SO hours.</p> : null}
            </div>
          ) : null}
        </td>
      </tr>
      {eligible && recommendation && decision?.kind === "override" && preview ? (
        <tr className={`border-b ${tone}`}>
          <td colSpan={4} className="px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${finding.id}-start`}>Start</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${finding.id}-start`}
                    type="time"
                    step={60}
                    value={decision.start}
                    onChange={(event) => onDecision(finding.id, { kind: "override", start: event.target.value, end: decision.end })}
                    className="h-10 bg-white text-base md:text-base"
                  />
                  <Button type="button" variant="ghost" onClick={() => onDecision(finding.id, { kind: "override", start: "", end: decision.end })}>
                    Clear
                  </Button>
                </div>
                <p className="text-muted-foreground">Recommended {formatClock(recommendation.start)}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${finding.id}-end`}>End</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id={`${finding.id}-end`}
                    type="time"
                    step={60}
                    value={decision.end}
                    onChange={(event) => onDecision(finding.id, { kind: "override", start: decision.start, end: event.target.value })}
                    className="h-10 bg-white text-base md:text-base"
                  />
                  <Button type="button" variant="ghost" onClick={() => onDecision(finding.id, { kind: "override", start: decision.start, end: "" })}>
                    Clear
                  </Button>
                </div>
                <p className="text-muted-foreground">Recommended {formatClock(recommendation.end)}</p>
              </div>
              <p className="text-muted-foreground sm:col-span-2">
                Change the start, the end, or both. A blank or unchanged field keeps that side as recommended.
              </p>
              {preview.valid ? (
                <p className="sm:col-span-2">
                  Would apply {formatClock(preview.start)}–{formatClock(preview.end)} · {formatDuration(preview.minutes)} added to SO hours.
                </p>
              ) : (
                <p role="alert" className="text-destructive sm:col-span-2">
                  {preview.error}
                </p>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function reportText(finding: Finding): string {
  return finding.detail;
}

function missedText(finding: Finding): string {
  if (finding.kind === "off_clock" || finding.notAGap) return "Not a gap";
  if (finding.kind === "gap" || finding.kind === "flag") return formatDuration(finding.minutes);
  return "";
}

function suggestedText(finding: Finding): string {
  if (finding.recommendation) return finding.recommendation.summary;
  if (finding.suggested) return finding.suggested;
  return "No edit.";
}

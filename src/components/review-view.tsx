"use client";

import { OrderStatusBadge } from "@/components/order-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDay } from "@/lib/dates";
import { latestQueueEdit, reviewApplyText, type FullbayEditBatch } from "@/lib/fullbay-edit-queue";
import { buildNonProEdit, clampSplitTime, defaultKeptWindow, defaultPartialChoice, describeNonProEdit, splitMidpoint } from "@/lib/nonpro";
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
import type { DayReport, Decision, DecisionKind, Finding, NonProEditType, NonProRemainder, Technician } from "@/lib/types";
import { appliedWindow, formatClock, formatDuration, formatPercent } from "@/lib/time";

export function ReviewView({
  days,
  reports,
  decisions,
  submitError,
  submitLock,
  isLocked,
  batches,
  onDecision,
  onSubmit,
}: {
  days: string[];
  reports: DayReport[];
  decisions: Record<string, Decision>;
  submitError: string | null;
  submitLock: string | null;
  isLocked: (day: string, shopId: DayReport["shopId"]) => boolean;
  batches: FullbayEditBatch[];
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
              dayReports.map((report) => (
                <ShopDay key={report.shopId} report={report} decisions={decisions} isLocked={isLocked} batches={batches} onDecision={onDecision} />
              ))
            )}
          </section>
        );
      })}

      <div className="flex flex-col items-start gap-3 border-t pt-6">
        <Button type="button" size="lg" disabled={nothingToDecide || submitLock != null} onClick={onSubmit}>
          Submit decisions
        </Button>
        {submitLock ? <p className="max-w-2xl text-sm text-destructive">{submitLock}</p> : null}
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
  isLocked,
  batches,
  onDecision,
}: {
  report: DayReport;
  decisions: Record<string, Decision>;
  isLocked: (day: string, shopId: DayReport["shopId"]) => boolean;
  batches: FullbayEditBatch[];
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
          These rows come from the Fullbay timesheet. A gap with no Clock In Comment is aimed at the nearest service order for that tech. A Clock In Comment that names a coworker, such as “Help Nick”, is aimed at that person’s overlapping service order on the same shop day. Time on another shop’s service order is covered: it is labeled with that shop, it is not a gap, and it is not an edit. A Non-Pro attendance row is marked Review. Keep it, keep part of it and give the rest to the service order before or after it, give the span to either neighbor, split it, or move it onto another service order. Each of those choices has editable times. Orders are marked open on priorities.
        </p>
      </div>

      {active.map((tech) => (
        <TechDay key={tech.id} report={report} tech={tech} decisions={decisions} locked={isLocked(report.day, report.shopId)} batches={batches} onDecision={onDecision} />
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
  locked,
  batches,
  onDecision,
}: {
  report: DayReport;
  tech: Technician;
  decisions: Record<string, Decision>;
  locked: boolean;
  batches: FullbayEditBatch[];
  onDecision: (findingId: string, decision: Decision | null) => void;
}) {
  const outlook = techOutlook(report, tech, decisions);
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
                locked={locked}
                queued={latestQueueEdit(batches, finding.id)}
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
  const scope = tech.foreignCoveredHours ? " on this shop" : "";
  const hours = `${tech.soHours.toFixed(2)} SO / ${tech.clockedHours.toFixed(2)} clocked${scope}`;
  const choice = outlook.choiceMinutes > 0 ? ", including Non-Pro time assigned to a service order" : "";
  if (outlook.optionalMinutes > 0 && outlook.requiredMinutes > 0 && outlook.ifRequired != null && outlook.ifAll != null) {
    return `${tech.name} — ${now} now (${hours}). About ${formatPercent(outlook.ifRequired)} if the required edits are made${choice}; about ${formatPercent(outlook.ifAll)} if the optional ${formatDuration(outlook.optionalMinutes)} is closed too.`;
  }
  if (outlook.choiceMinutes > 0 && outlook.recommendedMinutes === 0 && outlook.ifAll != null) {
    return `${tech.name} — ${now} now (${hours}). About ${formatPercent(outlook.ifAll)} with the Non-Pro time assigned to a service order.`;
  }
  if (outlook.ifAll != null && outlook.recommendedMinutes > 0) {
    return `${tech.name} — ${now} now (${hours}). About ${formatPercent(outlook.ifAll)} if the recommended edits are made${choice}.`;
  }
  return `${tech.name} — ${now} now (${hours}).`;
}

function outcomeDetail(tech: Technician, outlook: TechOutlook): string {
  if (tech.sheetNote) return tech.sheetNote;
  const scope = tech.foreignCoveredHours
    ? ` ${tech.foreignCoveredHours.toFixed(2)} h on other shops’ service orders is outside this shop’s clocked time.`
    : "";
  if (outlook.minutesToGoal === 0) {
    return scope.length > 0 ? `Already at the 98% goal on this shop’s hours.${scope}` : "Already at the 98% goal on the loaded hours.";
  }
  return `Needs about ${formatDuration(outlook.minutesToGoal)} more SO time to reach 98%.${scope} Rejected edits add none. A row with no service order is not an edit until an order exists.`;
}

function DayRows({
  report,
  tech,
  finding,
  decision,
  locked,
  queued,
  onDecision,
}: {
  report: DayReport;
  tech: Technician;
  finding: Finding;
  decision: Decision | undefined;
  locked: boolean;
  queued: ReturnType<typeof latestQueueEdit>;
  onDecision: (findingId: string, decision: Decision | null) => void;
}) {
  const recommendation = finding.recommendation;
  const order = recommendation ? report.orders.find((item) => item.id === recommendation.orderId) : undefined;
  const eligible = isEligible(report, finding);
  const preview = recommendation && decision ? appliedWindow(recommendation, decision) : null;
  const canDecide = !locked && (queued == null || queued.status === "failed");
  const tone =
    queued?.status === "applied" || queued?.status === "already_done"
      ? "bg-green-50"
      : queued?.status === "failed"
        ? "bg-red-50"
        : finding.kind === "flag"
          ? "bg-orange-200"
          : finding.kind === "gap"
            ? "bg-yellow-100"
            : "bg-card";

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
          {queued ? (
            <p className={`mt-3 ${queued.status === "failed" ? "text-destructive" : queued.status === "already_done" ? "font-medium text-green-950" : "font-medium"}`}>{reviewApplyText(queued)}</p>
          ) : null}
          {recommendation?.optional && canDecide ? <Badge variant="outline" className="mt-2">Optional</Badge> : null}
          {order && canDecide ? (
            <p className="mt-2 flex flex-wrap items-center gap-2">
              <OrderStatusBadge status={order.status} />
              <span className="text-muted-foreground">{eligible ? "Eligible for a time edit." : `${statusLabel(order.status)}. Not eligible.`}</span>
            </p>
          ) : null}
          {locked && recommendation && !queued ? <p className="mt-3 text-muted-foreground">Signed off. This decision is locked.</p> : null}
          {finding.nonPro ? (
            <NonProChoices finding={finding} decision={decision} canDecide={canDecide} onDecision={onDecision} />
          ) : null}
          {eligible && recommendation && canDecide && !finding.nonPro ? (
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
      {eligible && recommendation && canDecide && decision?.kind === "override" && preview ? (
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
  if (finding.nonPro) return "Review";
  if (finding.kind === "off_clock" || finding.notAGap) return "Not a gap";
  if (finding.kind === "gap" || finding.kind === "flag") return formatDuration(finding.minutes);
  return "";
}

function NonProChoices({
  finding,
  decision,
  canDecide,
  onDecision,
}: {
  finding: Finding;
  decision: Decision | undefined;
  canDecide: boolean;
  onDecision: (findingId: string, decision: Decision | null) => void;
}) {
  const review = finding.nonPro;
  if (!review) return null;
  const selected = decision?.nonProEditType;
  const built = decision ? buildNonProEdit(finding, decision) : null;
  const described = built?.ok ? describeNonProEdit(built.payload) : null;
  const partialDefault = defaultPartialChoice(finding.start, finding.end, review);
  const spanLabel = `${formatClock(finding.start)}–${formatClock(finding.end)}`;

  function choose(editType: NonProEditType) {
    if (selected === editType && editType !== "split" && editType !== "move_to_so" && editType !== "partial") {
      onDecision(finding.id, null);
      return;
    }
    if (editType === "keep") {
      onDecision(finding.id, { kind: "reject", start: "", end: "", nonProEditType: "keep" });
      return;
    }
    if (editType === "extend_prev_out") {
      onDecision(finding.id, { kind: "accept", start: "", end: finding.end, nonProEditType: "extend_prev_out" });
      return;
    }
    if (editType === "move_next_in") {
      onDecision(finding.id, { kind: "accept", start: finding.start, end: "", nonProEditType: "move_next_in" });
      return;
    }
    if (editType === "split") {
      const staying = selected === "split";
      const mid = staying ? decision?.split || splitMidpoint(finding.start, finding.end) || "" : splitMidpoint(finding.start, finding.end) || "";
      onDecision(finding.id, { kind: "accept", start: "", end: staying ? decision?.end || mid : mid, nonProEditType: "split", split: mid });
      return;
    }
    if (editType === "partial" && partialDefault) {
      if (selected === "partial") return;
      onDecision(finding.id, {
        kind: "accept",
        start: partialDefault.start,
        end: partialDefault.end,
        nonProEditType: "partial",
        nonProRemainder: partialDefault.remainder,
      });
      return;
    }
    if (editType === "move_to_so") {
      const staying = selected === "move_to_so";
      onDecision(finding.id, {
        kind: "accept",
        start: staying ? decision?.start || finding.start : finding.start,
        end: staying ? decision?.end || finding.end : finding.end,
        nonProEditType: "move_to_so",
        targetOrderId: decision?.targetOrderId ?? "",
      });
    }
  }

  function patch(next: Partial<Decision>) {
    if (!decision) return;
    onDecision(finding.id, { ...decision, ...next });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {canDecide ? (
        <div className="flex flex-col items-start gap-2" role="group" aria-label={`Non-Pro review for ${formatClock(finding.start)}`}>
          <Button type="button" size="sm" className="h-auto whitespace-normal py-1.5 text-left" variant={selected === "keep" ? "destructive" : "outline"} aria-pressed={selected === "keep"} onClick={() => choose("keep")}>
            Keep as Non-Pro
          </Button>
          {partialDefault ? (
            <Button type="button" size="sm" className="h-auto max-w-xl whitespace-normal py-1.5 text-left" variant={selected === "partial" ? "default" : "outline"} aria-pressed={selected === "partial"} onClick={() => choose("partial")}>
              Keep part as Non-Pro and give the rest to a service order
            </Button>
          ) : null}
          {review.previous ? (
            <Button type="button" size="sm" className="h-auto max-w-xl whitespace-normal py-1.5 text-left" variant={selected === "extend_prev_out" ? "default" : "outline"} aria-pressed={selected === "extend_prev_out"} onClick={() => choose("extend_prev_out")}>
              Give the whole span to {neighborLabel(review.previous)} — extend its clock-out
            </Button>
          ) : null}
          {review.next ? (
            <Button type="button" size="sm" className="h-auto max-w-xl whitespace-normal py-1.5 text-left" variant={selected === "move_next_in" ? "default" : "outline"} aria-pressed={selected === "move_next_in"} onClick={() => choose("move_next_in")}>
              Give the whole span to {neighborLabel(review.next)} — move its clock-in back
            </Button>
          ) : null}
          {review.canSplit && review.previous && review.next ? (
            <Button type="button" size="sm" className="h-auto max-w-xl whitespace-normal py-1.5 text-left" variant={selected === "split" ? "default" : "outline"} aria-pressed={selected === "split"} onClick={() => choose("split")}>
              Split: earlier part to {neighborLabel(review.previous)}, later part to {neighborLabel(review.next)}
            </Button>
          ) : null}
          <Button type="button" size="sm" className="h-auto max-w-xl whitespace-normal py-1.5 text-left" variant={selected === "move_to_so" ? "default" : "outline"} aria-pressed={selected === "move_to_so"} onClick={() => choose("move_to_so")}>
            Move onto another service order
          </Button>
        </div>
      ) : null}
      {canDecide && selected === "partial" && decision ? (
        <PartialTimes finding={finding} decision={decision} onDecision={onDecision} />
      ) : null}
      {canDecide && selected === "extend_prev_out" && decision && review.previous ? (
        <ClockField
          id={`${finding.id}-extend`}
          label={`New clock-out for ${review.previous.orderId}`}
          value={decision.end || finding.end}
          onChange={(end) => patch({ end })}
          hint={`Inside ${spanLabel}. An earlier time leaves the rest as Non-Pro, starting one minute later.`}
        />
      ) : null}
      {canDecide && selected === "move_next_in" && decision && review.next ? (
        <ClockField
          id={`${finding.id}-move`}
          label={`New clock-in for ${review.next.orderId}`}
          value={decision.start || finding.start}
          onChange={(start) => patch({ start })}
          hint={`Inside ${spanLabel}. A later time leaves the beginning as Non-Pro, ending one minute earlier.`}
        />
      ) : null}
      {canDecide && selected === "split" && decision ? (
        <div className="flex flex-col gap-2">
          <ClockField
            id={`${finding.id}-split`}
            label={`Clock-out for ${review.previous?.orderId ?? "the previous service order"}`}
            value={decision.split ?? ""}
            onChange={(split) =>
              patch({ split: clampSplitTime(split, finding.start, finding.end) ?? split, end: decision.end || split })
            }
            hint={`Inside ${spanLabel}. The earlier part goes to ${neighborLabel(review.previous)}.`}
          />
          <ClockField
            id={`${finding.id}-split-next`}
            label={`Clock-in for ${review.next?.orderId ?? "the next service order"}`}
            value={decision.end || decision.split || ""}
            onChange={(end) => patch({ end })}
            hint="Use the same minute to hand the span straight across. Set this one minute later so the punches do not share a minute. A wider gap stays Non-Pro."
          />
        </div>
      ) : null}
      {canDecide && selected === "move_to_so" && decision ? (
        <MoveToOrder finding={finding} decision={decision} onDecision={onDecision} />
      ) : null}
      {described ? <p>{described} {built?.ok && built.minutes > 0 ? `Adds ${formatDuration(built.minutes)} to SO hours.` : "Adds no SO hours."}</p> : null}
      {built && !built.ok ? (
        <p role="alert" className="text-destructive">
          {built.error}
        </p>
      ) : null}
    </div>
  );
}

function PartialTimes({
  finding,
  decision,
  onDecision,
}: {
  finding: Finding;
  decision: Decision;
  onDecision: (findingId: string, decision: Decision | null) => void;
}) {
  const review = finding.nonPro;
  if (!review) return null;
  const remainder = decision.nonProRemainder;
  function setRemainder(nextRemainder: NonProRemainder) {
    if (nextRemainder === decision.nonProRemainder) return;
    const window = defaultKeptWindow(finding.start, finding.end, nextRemainder);
    onDecision(finding.id, {
      ...decision,
      nonProRemainder: nextRemainder,
      start: window?.start ?? decision.start,
      end: window?.end ?? decision.end,
    });
  }
  const nextStarts = decision.end ? clockPlusOne(decision.end) : "";
  const prevEnds = decision.start ? clockMinusOne(decision.start) : "";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        <ClockField
          id={`${finding.id}-kept-start`}
          label="Non-Pro stays from"
          value={decision.start}
          onChange={(start) => onDecision(finding.id, { ...decision, start })}
        />
        <ClockField
          id={`${finding.id}-kept-end`}
          label="until"
          value={decision.end}
          onChange={(end) => onDecision(finding.id, { ...decision, end })}
        />
      </div>
      <p className="text-muted-foreground">Inside {formatClock(finding.start)}–{formatClock(finding.end)}. The service order starts or ends one minute away so the punches do not overlap.</p>
      {review.previous && review.next ? (
        <div className="flex flex-col items-start gap-2" role="group" aria-label="Where the rest of the span goes">
          <Button type="button" size="sm" className="h-auto max-w-xl whitespace-normal py-1.5 text-left" variant={remainder === "previous" ? "default" : "outline"} aria-pressed={remainder === "previous"} onClick={() => setRemainder("previous")}>
            Give the earlier rest to {neighborLabel(review.previous)}
            {remainder === "previous" && prevEnds ? ` — clock-out ${prevEnds}` : ""}
          </Button>
          <Button type="button" size="sm" className="h-auto max-w-xl whitespace-normal py-1.5 text-left" variant={remainder === "next" ? "default" : "outline"} aria-pressed={remainder === "next"} onClick={() => setRemainder("next")}>
            Give the later rest to {neighborLabel(review.next)}
            {remainder === "next" && nextStarts ? ` — clock-in ${nextStarts}` : ""}
          </Button>
          <Button type="button" size="sm" className="h-auto max-w-xl whitespace-normal py-1.5 text-left" variant={remainder === "both" ? "default" : "outline"} aria-pressed={remainder === "both"} onClick={() => setRemainder("both")}>
            Give the earlier rest to {neighborLabel(review.previous)} and the later rest to {neighborLabel(review.next)}
          </Button>
        </div>
      ) : (
        <p>
          {review.next
            ? `The rest goes to ${neighborLabel(review.next)}. Its clock-in moves back to ${nextStarts || "one minute after the Non-Pro end"}.`
            : `The rest goes to ${neighborLabel(review.previous)}. Its clock-out moves to ${prevEnds || "one minute before the Non-Pro start"}.`}
        </p>
      )}
    </div>
  );
}

function ClockField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="time" step={60} value={value} onChange={(event) => onChange(event.target.value)} className="h-10 max-w-40 bg-white text-base md:text-base" />
      {hint ? <p className="text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function clockPlusOne(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";
  const total = Number(match[1]) * 60 + Number(match[2]) + 1;
  if (total >= 24 * 60) return "";
  return formatClock(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
}

function clockMinusOne(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "";
  const total = Number(match[1]) * 60 + Number(match[2]) - 1;
  if (total < 0) return "";
  return formatClock(`${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`);
}

function MoveToOrder({
  finding,
  decision,
  onDecision,
}: {
  finding: Finding;
  decision: Decision;
  onDecision: (findingId: string, decision: Decision | null) => void;
}) {
  const orders = finding.nonPro?.orders ?? [];
  function setOrder(targetOrderId: string) {
    onDecision(finding.id, { ...decision, kind: "accept", nonProEditType: "move_to_so", targetOrderId });
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        <ClockField
          id={`${finding.id}-move-start`}
          label="Clock-in"
          value={decision.start || finding.start}
          onChange={(start) => onDecision(finding.id, { ...decision, start })}
        />
        <ClockField
          id={`${finding.id}-move-end`}
          label="Clock-out"
          value={decision.end || finding.end}
          onChange={(end) => onDecision(finding.id, { ...decision, end })}
        />
      </div>
      <p className="text-muted-foreground">
        Inside {formatClock(finding.start)}–{formatClock(finding.end)}. Time left off this window stays Non-Pro, one minute away from the moved block.
      </p>
      {orders.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${finding.id}-order`}>Service order</Label>
          <select
            id={`${finding.id}-order`}
            value={orders.some((order) => order.orderId === decision.targetOrderId) ? decision.targetOrderId : ""}
            onChange={(event) => setOrder(event.target.value)}
            className="h-10 max-w-xl rounded-lg border bg-white px-3 text-base"
          >
            <option value="">Choose a service order</option>
            {orders.map((order) => (
              <option key={order.orderId} value={order.orderId}>
                {shopName(order.shopId)} · {order.orderId}
                {order.work ? ` / ${order.work}` : ""}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${finding.id}-typed`}>Or type an SO number</Label>
        <Input
          id={`${finding.id}-typed`}
          value={decision.targetOrderId ?? ""}
          onChange={(event) => setOrder(event.target.value)}
          placeholder="D-90273"
          className="h-10 max-w-48 bg-white text-base md:text-base"
        />
      </div>
    </div>
  );
}

function neighborLabel(neighbor: { shopId: DayReport["shopId"]; orderId: string; work: string } | null): string {
  if (!neighbor) return "the neighboring service order";
  const work = neighbor.work ? ` / ${neighbor.work}` : "";
  return `${shopName(neighbor.shopId)} ${neighbor.orderId}${work}`;
}

function suggestedText(finding: Finding): string {
  if (finding.recommendation) return finding.recommendation.summary;
  if (finding.suggested) return finding.suggested;
  return "No edit.";
}

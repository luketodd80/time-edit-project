"use client";

import { useEffect, useState } from "react";
import { dayPunches, type DayPunch } from "@/lib/day-punches";
import { formatDay, formatTimestamp } from "@/lib/dates";
import type { FullbayEditBatch } from "@/lib/fullbay-edit-queue";
import {
  buildPlan,
  goalText,
  shopName,
  soHoursAfter,
  sumTotals,
  techTotals,
  utilization,
  type TechTotal,
} from "@/lib/review";
import type { DayReport, Decision, ShopFilter, Submission } from "@/lib/types";
import { formatClock, formatDuration, formatHours, formatPercent } from "@/lib/time";

export function SummaryView({
  shopId,
  days,
  reports,
  decisions,
  submission,
  stale,
  batches,
}: {
  shopId: ShopFilter;
  days: string[];
  reports: DayReport[];
  decisions: Record<string, Decision>;
  submission: Submission | null;
  stale: boolean;
  batches: FullbayEditBatch[];
}) {
  const sortedDays = [...days].sort();
  const plan = buildPlan(reports, decisions);
  const showCombined = sortedDays.length > 1;
  const shopLabel = shopId === "all" ? "All shops" : shopName(shopId);
  const [openTech, setOpenTech] = useState<{ report: DayReport; techId: string; name: string } | null>(null);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-medium">Utilization</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          SO hours divided by clocked hours. Goal is 98%. Accepted and overridden minutes are added to SO hours. Rejected items add none. {shopLabel} follows the shop filter. A technician&apos;s name opens that day&apos;s clock punches after edits.
        </p>
        {submission ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {stale
              ? `Decisions changed after the confirmation recorded ${formatTimestamp(submission.submittedAt)}.`
              : `Matches the confirmation recorded ${formatTimestamp(submission.submittedAt)}.`}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Preview from the current decisions. Submit on Review to record the confirmation.</p>
        )}
      </div>

      {sortedDays.map((day) => {
        const dayReports = reports.filter((report) => report.day === day);
        return (
          <section key={day} className="flex flex-col gap-4">
            <h3 className="text-lg font-medium">{formatDay(day)}</h3>
            {dayReports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clocked hours loaded for this day.</p>
            ) : (
              dayReports.map((report) => (
                <TotalsTable
                  key={`${day}-${report.shopId}`}
                  caption={`${shopName(report.shopId)} · ${formatDay(day)}`}
                  totals={techTotals([report], decisions)}
                  onTech={(total) => setOpenTech({ report, techId: total.techId, name: total.name })}
                />
              ))
            )}
          </section>
        );
      })}

      {showCombined ? (
        <section className="flex flex-col gap-4">
          <h3 className="text-lg font-medium">{shopLabel} · selected days combined</h3>
          {reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clocked hours in this selection.</p>
          ) : (
            <TotalsTable caption={`${shopLabel} combined`} totals={techTotals(reports, decisions)} />
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Edits that would go through</h3>
        {plan.edits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accepted or overridden edits in this selection.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {plan.edits.map((edit) => (
              <li key={edit.findingId}>
                {edit.techName} · {edit.orderId} {edit.work} · {formatClock(edit.start)}–{formatClock(edit.end)} · {formatDuration(edit.minutes)}
              </li>
            ))}
          </ul>
        )}
        {plan.rejected.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Rejected, no SO hours: {plan.rejected.map((edit) => `${edit.techName} ${edit.orderId}`).join(", ")}.
          </p>
        ) : null}
        {plan.skipped.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            Invoiced, skipped: {plan.skipped.map((order) => order.orderId).join(", ")}.
          </p>
        ) : null}
      </section>

      {openTech ? (
        <PunchDialog
          report={openTech.report}
          techId={openTech.techId}
          name={openTech.name}
          decisions={decisions}
          batches={batches}
          onClose={() => setOpenTech(null)}
        />
      ) : null}
    </div>
  );
}

function TotalsTable({
  caption,
  totals,
  onTech,
}: {
  caption: string;
  totals: TechTotal[];
  onTech?: (total: TechTotal) => void;
}) {
  const sum = sumTotals(totals);
  const before = utilization(sum.baselineSoHours, sum.clockedHours);
  const afterHours = sum.baselineSoHours + sum.addedMinutes / 60;
  const after = utilization(afterHours, sum.clockedHours);

  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
      <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
        <caption className="px-4 py-3 text-left font-medium">{caption}</caption>
        <thead className="border-y bg-muted/50 text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Technician</th>
            <th className="px-4 py-2 font-medium">Clocked</th>
            <th className="px-4 py-2 font-medium">SO before</th>
            <th className="px-4 py-2 font-medium">Added</th>
            <th className="px-4 py-2 font-medium">SO after</th>
            <th className="px-4 py-2 font-medium">Utilization</th>
            <th className="px-4 py-2 font-medium">Against goal</th>
          </tr>
        </thead>
        <tbody>
          {totals.map((total) => {
            const ratio = utilization(soHoursAfter(total), total.clockedHours);
            return (
              <tr key={total.techId} className="border-b">
                <td className="px-4 py-2">
                  {onTech ? (
                    <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => onTech(total)}>
                      {total.name}
                    </button>
                  ) : (
                    total.name
                  )}
                </td>
                <td className="px-4 py-2">{formatHours(total.clockedHours)}</td>
                <td className="px-4 py-2">{formatHours(total.baselineSoHours)}</td>
                <td className="px-4 py-2">{total.addedMinutes === 0 ? "—" : formatDuration(total.addedMinutes)}</td>
                <td className="px-4 py-2">{formatHours(soHoursAfter(total))}</td>
                <td className="px-4 py-2">{ratio == null ? "—" : formatPercent(ratio)}</td>
                <td className="px-4 py-2">{goalText(ratio)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-muted/40 font-medium">
            <td className="px-4 py-2">Shop</td>
            <td className="px-4 py-2">{formatHours(sum.clockedHours)}</td>
            <td className="px-4 py-2">{formatHours(sum.baselineSoHours)}</td>
            <td className="px-4 py-2">{sum.addedMinutes === 0 ? "—" : formatDuration(sum.addedMinutes)}</td>
            <td className="px-4 py-2">{formatHours(afterHours)}</td>
            <td className="px-4 py-2">{after == null ? "—" : formatPercent(after)}</td>
            <td className="px-4 py-2">
              {before == null || after == null ? goalText(after) : `Was ${formatPercent(before)}. ${goalText(after)}.`}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PunchDialog({
  report,
  techId,
  name,
  decisions,
  batches,
  onClose,
}: {
  report: DayReport;
  techId: string;
  name: string;
  decisions: Record<string, Decision>;
  batches: FullbayEditBatch[];
  onClose: () => void;
}) {
  const punches = dayPunches(report, techId, decisions, batches);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="punch-dialog-title"
        className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-xl bg-background p-5 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="punch-dialog-title" className="text-lg font-medium">
              {name} · {shopName(report.shopId)} · {formatDay(report.day)}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Service-order punches after the decisions on this day. An edited punch shows the original time, then the new time. Another shop&apos;s punch is context and is not an edit.
            </p>
          </div>
          <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        {punches.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No service-order punches for this tech on this shop day.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
              <thead className="border-y bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">SO</th>
                  <th className="px-3 py-2 font-medium">Work</th>
                  <th className="px-3 py-2 font-medium">Clock in</th>
                  <th className="px-3 py-2 font-medium">Clock out</th>
                  <th className="px-3 py-2 font-medium">Edit</th>
                </tr>
              </thead>
              <tbody>
                {punches.map((punch, index) => (
                  <tr key={`${punch.orderId}-${punch.clockIn}-${index}`} className="border-b align-top">
                    <td className="px-3 py-2 whitespace-nowrap">
                      {punch.orderId}
                      {punch.contextShop ? <span className="mt-1 block text-xs text-muted-foreground">{punch.contextShop} · context</span> : null}
                    </td>
                    <td className="px-3 py-2">{punch.work}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{clockText(punch, "in")}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{clockText(punch, "out")}</td>
                    <td className="px-3 py-2">{editText(punch)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function clockText(punch: DayPunch, side: "in" | "out"): string {
  const current = side === "in" ? punch.clockIn : punch.clockOut;
  const original = side === "in" ? punch.originalClockIn : punch.originalClockOut;
  const suggested = side === "in" ? punch.suggestedClockIn : punch.suggestedClockOut;
  if (original && original !== current) return `${formatClock(original)} → ${formatClock(current)}`;
  if (suggested && suggested !== current) return `${formatClock(current)} → ${formatClock(suggested)}`;
  return formatClock(current);
}

function editText(punch: DayPunch): string {
  if (punch.contextShop) return "Context. Not an edit.";
  if (punch.editStatus === "applied") return "Applied in Fullbay";
  if (punch.editStatus === "accepted") return "Accepted, not applied in Fullbay";
  if (punch.editStatus === "rejected") return "Rejected. Clock stays at the original time.";
  return "";
}

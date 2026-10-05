"use client";

import { formatDay, formatTimestamp } from "@/lib/dates";
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
}: {
  shopId: ShopFilter;
  days: string[];
  reports: DayReport[];
  decisions: Record<string, Decision>;
  submission: Submission | null;
  stale: boolean;
}) {
  const sortedDays = [...days].sort();
  const plan = buildPlan(reports, decisions);
  const showCombined = sortedDays.length > 1;
  const shopLabel = shopId === "all" ? "All shops" : shopName(shopId);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-medium">Utilization</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          SO hours divided by clocked hours. Goal is 98%. Accepted and overridden minutes are added to SO hours. Rejected items add none. {shopLabel} follows the shop filter.
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
    </div>
  );
}

function TotalsTable({ caption, totals }: { caption: string; totals: TechTotal[] }) {
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
                <td className="px-4 py-2">{total.name}</td>
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

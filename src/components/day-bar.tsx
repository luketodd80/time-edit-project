"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { defaultPendingDays, formatDay, formatDayShort, formatTimestamp, reviewWindow, todayInNewYork } from "@/lib/dates";
import { SIGNOFF_APPLY_SUFFIX, signoffApplyMessage, type SignoffLineBlock } from "@/lib/fullbay-edit-queue";
import { auditLabel, auditStatus, dayChipState, dayUtilization, shopName, shopsInScope, signoffKey } from "@/lib/review";
import { SEED } from "@/lib/seed";
import type { Decision, ShopFilter, ShopId, Signoff } from "@/lib/types";
import { formatPercent } from "@/lib/time";

function percentOrDash(ratio: number | null): string {
  return ratio == null ? "—" : formatPercent(ratio);
}

export function DayBar({
  shopId,
  days,
  signoffs,
  decisions,
  signoffError,
  applyBlocks,
  onRevealLine,
  onShop,
  onSelectDay,
  onOpenSummary,
  onAttest,
  onMarkDone,
}: {
  shopId: ShopFilter;
  days: string[];
  signoffs: Record<string, Signoff>;
  decisions: Record<string, Decision>;
  signoffError: string | null;
  applyBlocks?: (day: string, shopId: ShopId) => SignoffLineBlock[];
  onRevealLine: (findingId: string) => void;
  onShop: (shopId: ShopFilter) => void;
  onSelectDay: (day: string) => void;
  onOpenSummary: (day: string) => void;
  onAttest: (day: string, shopId: ShopId, attested: boolean) => void;
  onMarkDone: (day: string, shopId: ShopId) => void;
}) {
  const today = todayInNewYork();
  const windowDays = reviewWindow(today);
  const dueDays = defaultPendingDays(today);
  const shops = shopsInScope(shopId, SEED);
  const loadedShops = shopsInScope("all", SEED);
  const signoffCards = [...days].sort().flatMap((day) =>
    shops.map((id) => ({
      day,
      id,
      signoff: signoffs[signoffKey(day, id)],
      blocks: applyBlocks?.(day, id) ?? [],
    })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <Label htmlFor="shop-filter">Shop</Label>
          <select
            id="shop-filter"
            value={shopId}
            onChange={(event) => onShop(event.target.value as ShopFilter)}
            className="h-10 min-w-52 rounded-lg border border-input bg-background px-3 text-base"
          >
            <option value="all">All shops</option>
            {loadedShops.map((id) => (
              <option key={id} value={id}>
                {shopName(id)}
              </option>
            ))}
          </select>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground">
          All shops is the combined view. Choosing one shop narrows the gaps, orders, submit, and utilization to that shop.
          The menu lists every shop that has a loaded day.
        </p>
      </div>

      <div>
        <h2 className="text-sm font-medium">Days</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Today is {formatDay(today)} Eastern. One day is open at a time. Due is the day this review covers. A signed-off day says Done with the time it was approved, and choosing it opens that day&apos;s summary. Sundays stay off the chips.
        </p>
        <ul className="mt-3 flex list-none flex-wrap gap-2 p-0">
          {windowDays.map((day) => {
            const selected = days.includes(day);
            const chip = dayChipState(day, shops, signoffs, dueDays);
            const tone =
              chip.tone === "done"
                ? "border-green-700 bg-green-50 text-green-950"
                : chip.tone === "due"
                  ? "border-amber-600 bg-amber-50 text-amber-950"
                  : "border-border bg-background";
            const status = chip.tone === "done" && chip.doneAt ? `Done ${formatTimestamp(chip.doneAt)}` : chip.tone === "due" ? "Due" : "Open";
            const doneLabel = chip.note ? `${status}. ${chip.note}` : status;
            return (
              <li key={day}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={chip.tone === "done" ? `${formatDay(day)}, ${doneLabel}. Opens summary.` : `${formatDay(day)}, ${status}.`}
                  onClick={() => (chip.tone === "done" ? onOpenSummary(day) : onSelectDay(day))}
                  className={`flex min-w-36 flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left ${tone} ${selected ? "ring-2 ring-foreground" : ""}`}
                >
                  <span className="font-medium">{formatDayShort(day)}</span>
                  <span className="text-xs">{status}</span>
                  {chip.note ? <span className="text-xs">{chip.note}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
          <caption className="px-4 py-3 text-left text-sm text-foreground">
            Audit trail. A day is approved when every shop in view is marked done. Original utilization is service-order hours divided by clocked hours. Corrected utilization adds accepted and overridden minutes.
          </caption>
          <thead className="border-y bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Day</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {shops.map((id) => (
                <th key={id} className="px-4 py-2 font-medium">
                  {shopName(id)}
                </th>
              ))}
              <th className="px-4 py-2 font-medium">Original utilization</th>
              <th className="px-4 py-2 font-medium">Corrected utilization</th>
            </tr>
          </thead>
          <tbody>
            {windowDays.map((day) => {
              const status = auditStatus(day, shops, signoffs);
              const ratios = dayUtilization(SEED, day, shops, decisions);
              const tone = status === "approved" ? "bg-green-50" : "bg-amber-50";
              return (
                <tr key={day} className={`border-b last:border-b-0 ${tone}`}>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {formatDayShort(day)}
                    {days.includes(day) ? <span className="ml-2 text-muted-foreground">Selected</span> : null}
                  </td>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">{auditLabel(status)}</td>
                  {shops.map((id) => {
                    const signoff = signoffs[signoffKey(day, id)];
                    return (
                      <td key={id} className="px-4 py-2 whitespace-nowrap">
                        {signoff?.doneAt ? (
                          <span className="flex flex-col">
                            <span>Approved {formatTimestamp(signoff.doneAt)}</span>
                            {signoff.note ? <span className="font-normal text-muted-foreground">{signoff.note}</span> : null}
                          </span>
                        ) : (
                          "Not approved"
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 whitespace-nowrap">{percentOrDash(ratios.original)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{percentOrDash(ratios.corrected)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Sign-off</h2>
        <p className="text-sm text-muted-foreground">
          Check that you approve the utilization numbers, then mark the day done. Accepted edits for that shop and day must be confirmed applied in Fullbay first. Rejected edits do not block sign-off. A line that failed in Fullbay can be rejected from Review, which leaves Fullbay as it is and clears this block. The day cannot be marked done without the utilization check. When every finding has a decision and every accepted edit is applied, already done, or rejected after a Fullbay failure, or the submit rejected every finding, the day is marked done on its own. A signed-off day stays locked: its decisions cannot be changed and it cannot be submitted again.
        </p>
        {signoffError ? (
          <p role="alert" className="text-sm text-destructive">
            <SignoffWarning message={signoffError} blocks={blocksForMessage(signoffCards, signoffError)} onRevealLine={onRevealLine} />
          </p>
        ) : null}
        <div className="grid gap-3">
          {signoffCards.map(({ day, id, signoff, blocks }) => {
              const inputId = `approve-${day}-${id}`;
              const blocked = blocks.length > 0;
              return (
                <div key={`${day}-${id}`} className="flex flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      id={inputId}
                      checked={signoff?.attested ?? false}
                      disabled={Boolean(signoff?.doneAt)}
                      onCheckedChange={(checked) => onAttest(day, id, checked === true)}
                      className="mt-0.5"
                    />
                    <Label htmlFor={inputId} className="flex-col items-start gap-1 font-normal">
                      <span className="font-medium">
                        {formatDay(day)} · {shopName(id)}
                      </span>
                      <span>I approve this day&apos;s utilization numbers</span>
                    </Label>
                  </div>
                  {signoff?.doneAt ? (
                    <p className="text-sm text-green-800">
                      Done {formatTimestamp(signoff.doneAt)}
                      {signoff.note ? <span className="mt-1 block text-muted-foreground">{signoff.note}</span> : null}
                    </p>
                  ) : (
                    <div className="flex max-w-md flex-col items-start gap-2">
                      <Button type="button" disabled={!signoff?.attested || blocked} onClick={() => onMarkDone(day, id)}>
                        Mark day done
                      </Button>
                      {blocked ? (
                        <p className="text-sm text-destructive">
                          <SignoffWarning message={signoffApplyMessage(blocks) ?? ""} blocks={blocks} onRevealLine={onRevealLine} />
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </section>
    </div>
  );
}

function blocksForMessage(cards: { blocks: SignoffLineBlock[] }[], message: string): SignoffLineBlock[] {
  return cards.find((card) => signoffApplyMessage(card.blocks) === message)?.blocks ?? [];
}

function SignoffWarning({
  message,
  blocks,
  onRevealLine,
}: {
  message: string;
  blocks: SignoffLineBlock[];
  onRevealLine: (findingId: string) => void;
}) {
  if (blocks.length === 0) return message;
  return (
    <>
      Fullbay apply is not confirmed for{" "}
      {blocks.map((block, index) => (
        <span key={block.findingId}>
          {index > 0 ? ", " : null}
          <button type="button" className="underline decoration-destructive/50 underline-offset-2 hover:decoration-destructive" onClick={() => onRevealLine(block.findingId)}>
            {block.label}
          </button>
        </span>
      ))}
      {SIGNOFF_APPLY_SUFFIX}
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { formatDoneAt, presetBounds, shopReviewHref, type AdminCell, type AdminPayload, type RangePreset, RANGE_PRESETS } from "@/lib/admin";
import { formatDay, formatDayShort, todayInNewYork } from "@/lib/dates";
import { formatPercent } from "@/lib/time";
import type { UtilRollup } from "@/lib/utilization-history";

const PRESET_LABELS: Record<RangePreset, string> = {
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
  ytd: "Year to date",
  "last-30": "Last 30 days",
};

type AdminResponse = { ok: true } & AdminPayload;

export function AdminView() {
  const today = todayInNewYork();
  const initial = presetBounds("this-week", today);
  const [preset, setPreset] = useState<RangePreset | "custom">("this-week");
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [data, setData] = useState<AdminResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openShops, setOpenShops] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<{ day: string; shopId: string } | null>(null);

  useEffect(() => {
    if (start > end) return;
    let cancelled = false;
    const params = new URLSearchParams({ from: start, to: end });
    void fetch(`/api/admin?${params.toString()}`)
      .then(async (response) => {
        const body = (await response.json()) as { ok?: boolean; error?: string } & Partial<AdminResponse>;
        if (!response.ok || !body.ok) throw new Error(body.error ?? "Could not load the admin view.");
        if (!cancelled) {
          setData(body as AdminResponse);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load the admin view.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSelected(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function choosePreset(next: RangePreset) {
    const bounds = presetBounds(next, today);
    setPreset(next);
    setLoading(true);
    setStart(bounds.start);
    setEnd(bounds.end);
  }

  const selectedCell = selected && data ? findCell(data, selected.day, selected.shopId) : null;
  const rangeInvalid = start > end;

  return (
    <main className="mx-auto flex w-full max-w-[1352px] flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-muted-foreground">The Service Company</p>
          <Link href="/" className="text-sm font-medium underline-offset-4 hover:underline">
            Back to review
          </Link>
        </div>
        <h1 className="text-3xl font-medium tracking-tight">Admin · All shops</h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          Sign-off status for the last 7 days, and how applied edits changed utilization. This page does not write to Fullbay.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {data ? <Kpis data={data} /> : <p className="text-sm text-muted-foreground">{loading ? "Loading admin…" : "No admin data yet."}</p>}

      {data ? <StatusGrid data={data} selected={selected} onSelect={setSelected} /> : null}

      <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-medium">Utilization change from edits</h2>
            <p className="text-sm text-muted-foreground">
              Job time ÷ clocked time, scoped per shop the same way review does. After counts applied and already-done edits only. A line marked not a gap, or whose note says it was not applied or was a false gap, adds no minutes. Weeks start Monday.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {RANGE_PRESETS.map((item) => (
              <button
                key={item}
                type="button"
                className={`rounded-lg border px-3 py-1.5 text-sm ${preset === item ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted"}`}
                onClick={() => choosePreset(item)}
              >
                {PRESET_LABELS[item]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Start
              <input
                type="date"
                value={start}
                onChange={(event) => {
                  setPreset("custom");
                  if (event.target.value <= end) setLoading(true);
                  setStart(event.target.value);
                }}
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              End
              <input
                type="date"
                value={end}
                onChange={(event) => {
                  setPreset("custom");
                  if (start <= event.target.value) setLoading(true);
                  setEnd(event.target.value);
                }}
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <p className="pb-2 text-sm text-muted-foreground">
              {rangeInvalid ? "Start must be on or before the end." : `${formatDay(start)} – ${formatDay(end)}${preset === "custom" ? "" : ` · ${PRESET_LABELS[preset]}`}`}
            </p>
          </div>
          {rangeInvalid ? null : data ? (
            data.utilization ? (
              <>
                <p className="text-sm text-muted-foreground">{data.coverage.message}</p>
                <UtilizationTable
                  data={data}
                  openShops={openShops}
                  onToggle={(shopId) => {
                    setOpenShops((current) => {
                      const next = new Set(current);
                      if (next.has(shopId)) next.delete(shopId);
                      else next.add(shopId);
                      return next;
                    });
                  }}
                />
              </>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">{data.coverage.message}</p>
            )
          ) : loading ? (
            <p className="text-sm text-muted-foreground">Updating this range…</p>
          ) : null}
        </div>
      </section>

      {selectedCell && data ? (
        <Drawer
          cell={selectedCell}
          shopName={data.grid.shops.find((shop) => shop.id === selectedCell.shopId)?.name ?? selectedCell.shopId}
          manager={data.grid.shops.find((shop) => shop.id === selectedCell.shopId)?.manager ?? ""}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </main>
  );
}

function findCell(data: AdminResponse, day: string, shopId: string): AdminCell | null {
  for (const shop of data.grid.shops) {
    if (shop.id !== shopId) continue;
    return shop.cells.find((cell) => cell.day === day) ?? null;
  }
  return null;
}

function Kpis({ data }: { data: AdminResponse }) {
  const behind = data.kpis.shopsBehind;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi
        label="Company utilization"
        value={data.kpis.hasUtilization ? `${formatPercent(data.kpis.before ?? 0)} → ${formatPercent(data.kpis.after ?? 0)}` : "No data"}
        detail={data.kpis.hasUtilization ? `${formatDayShort(data.range.start)} – ${formatDayShort(data.range.end)}` : "no timesheets in this range"}
      />
      <Kpi
        label="Change from edits"
        value={data.kpis.hasUtilization ? formatPoints(data.kpis.changePoints) : "—"}
        detail={data.kpis.hasUtilization ? "applied + already done only" : "no timesheets in this range"}
        tone={data.kpis.changePoints != null && data.kpis.changePoints > 0 ? "up" : undefined}
      />
      <Kpi
        label="Job time picked up"
        value={data.kpis.hasUtilization ? `${(data.kpis.minutesPickedUp / 60).toFixed(1)} h` : "—"}
        detail={data.kpis.hasUtilization ? `${Math.round(data.kpis.minutesPickedUp).toLocaleString()} minutes` : "no timesheets in this range"}
      />
      <Kpi
        label="Shops behind"
        value={String(behind.length)}
        detail={behind.length > 0 ? behind.map((shop) => `${shop.name} (${shop.days})`).join(", ") : "none in the last 7 days"}
        tone={behind.length > 0 ? "down" : "up"}
      />
      <Kpi label={data.kpis.dueLabel} value={data.kpis.dueValue} detail="shops signed off" />
    </div>
  );
}

function Kpi({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-green-700" : tone === "down" ? "text-red-700" : "";
  return (
    <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function StatusGrid({
  data,
  selected,
  onSelect,
}: {
  data: AdminResponse;
  selected: { day: string; shopId: string } | null;
  onSelect: (value: { day: string; shopId: string } | null) => void;
}) {
  return (
    <section className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-medium">Shop status, last 7 days</h2>
          <p className="text-sm text-muted-foreground">Click a shop and day to see its lines. Shops furthest behind sort to the top.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <Legend swatch="bg-green-100 border-green-300" label="Signed off" />
          <Legend swatch="bg-amber-100 border-amber-300" label="Submitted, not finished" />
          <Legend swatch="bg-red-100 border-red-300" label="Due or past due, nothing submitted" />
          <Legend swatch="bg-zinc-100 border-zinc-200" label="No data or closed" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th className="px-2 py-2 font-medium">Shop</th>
              {data.grid.days.map((day) => (
                <th key={day.iso} className="px-1 py-2 font-medium whitespace-nowrap">
                  {day.label}
                  {day.due ? <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-amber-800 normal-case">due</span> : null}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-medium">Days behind</th>
            </tr>
          </thead>
          <tbody>
            {data.grid.shops.map((shop) => (
              <tr key={shop.id} className="border-t border-border">
                <td className="px-2 py-2 align-top">
                  <div className="font-medium">{shop.name}</div>
                  <div className="text-xs text-muted-foreground">{shop.manager}</div>
                </td>
                {shop.cells.map((cell) => {
                  const clickable = cell.tone !== "closed" && cell.tone !== "nodata";
                  const isSelected = selected?.day === cell.day && selected.shopId === cell.shopId;
                  return (
                    <td key={cell.day} className="px-1 py-1 align-top">
                      <button
                        type="button"
                        disabled={!clickable}
                        onClick={() => onSelect(isSelected ? null : { day: cell.day, shopId: cell.shopId })}
                        className={`block min-h-[58px] w-full rounded-lg border px-2 py-1.5 text-left text-xs ${toneClass(cell.tone)} ${isSelected ? "ring-2 ring-foreground" : ""} ${clickable ? "hover:ring-2 hover:ring-foreground/30" : "cursor-default"}`}
                      >
                        <div className="font-semibold">{cell.title}</div>
                        <div className="text-[11px] opacity-80">{cell.detail}</div>
                      </button>
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-right align-top">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${shop.daysBehind > 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>
                    {shop.daysBehind}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        Done times are the earliest sign-off on record, in Eastern time. Days behind counts due or past-due shop days that are still not signed off.
      </p>
    </section>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`inline-block h-3 w-3 rounded-sm border ${swatch}`} />
      {label}
    </span>
  );
}

function toneClass(tone: AdminCell["tone"]): string {
  if (tone === "green") return "border-green-300 bg-green-100 text-green-950";
  if (tone === "yellow") return "border-amber-300 bg-amber-100 text-amber-950";
  if (tone === "red") return "border-red-300 bg-red-100 text-red-950";
  return "border-zinc-200 bg-zinc-100 text-zinc-600";
}

function UtilizationTable({
  data,
  openShops,
  onToggle,
}: {
  data: AdminResponse;
  openShops: Set<string>;
  onToggle: (shopId: string) => void;
}) {
  const utilization = data.utilization;
  if (!utilization) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs tracking-wide text-muted-foreground uppercase">
            <th className="px-2 py-2 font-medium">Shop / tech</th>
            <th className="px-2 py-2 text-right font-medium">Clocked h</th>
            <th className="px-2 py-2 text-right font-medium">Job h before</th>
            <th className="px-2 py-2 text-right font-medium">Before</th>
            <th className="px-2 py-2 text-right font-medium">After edits</th>
            <th className="px-2 py-2 text-right font-medium">Change</th>
            <th className="px-2 py-2 text-right font-medium">Minutes picked up</th>
            <th className="px-2 py-2 font-medium">Before → after</th>
          </tr>
        </thead>
        <tbody>
          <RollupRow label={<span className="font-semibold">Company</span>} rollup={utilization.company} />
          {utilization.shops.map((shop) => {
            const open = openShops.has(shop.id);
            return (
              <ShopBlock key={shop.id} open={open} name={shop.name} techCount={shop.techs.length} rollup={shop.rollup} techs={shop.techs} onToggle={() => onToggle(shop.id)} />
            );
          })}
          {utilization.emptyShops.length > 0 ? (
            <tr>
              <td colSpan={8} className="px-2 py-3 text-sm text-muted-foreground">
                No timesheet data for {utilization.emptyShops.join(", ")} in this range.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ShopBlock({
  open,
  name,
  techCount,
  rollup,
  techs,
  onToggle,
}: {
  open: boolean;
  name: string;
  techCount: number;
  rollup: UtilRollup;
  techs: { name: string; rollup: UtilRollup }[];
  onToggle: () => void;
}) {
  return (
    <>
      <RollupRow
        label={
          <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 text-left font-semibold">
            <span className="w-4 text-muted-foreground">{open ? "▾" : "▸"}</span>
            {name}
            <span className="font-normal text-muted-foreground">{techCount} techs</span>
          </button>
        }
        rollup={rollup}
        onClick={onToggle}
      />
      {open
        ? techs.map((tech) => (
            <RollupRow key={tech.name} label={<span className="pl-6">{tech.name}</span>} rollup={tech.rollup} muted />
          ))
        : null}
    </>
  );
}

function RollupRow({
  label,
  rollup,
  muted,
  onClick,
}: {
  label: ReactNode;
  rollup: UtilRollup;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <tr className={`border-t border-border ${muted ? "bg-muted/40 text-[13px]" : ""} ${onClick ? "cursor-pointer hover:bg-muted/50" : ""}`} onClick={onClick}>
      <td className="px-2 py-2">{label}</td>
      <td className="px-2 py-2 text-right tabular-nums">{rollup.clockedHours.toFixed(1)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{rollup.soHours.toFixed(1)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{rollup.before == null ? "—" : formatPercent(rollup.before)}</td>
      <td className="px-2 py-2 text-right font-semibold tabular-nums">{rollup.after == null ? "—" : formatPercent(rollup.after)}</td>
      <td className={`px-2 py-2 text-right tabular-nums ${rollup.changePoints != null && rollup.changePoints > 0 ? "text-green-700" : ""}`}>{formatPoints(rollup.changePoints)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{Math.round(rollup.addedMinutes)}</td>
      <td className="px-2 py-2">
        <UtilBar before={rollup.before} after={rollup.after} />
      </td>
    </tr>
  );
}

function UtilBar({ before, after }: { before: number | null; after: number | null }) {
  if (before == null || after == null) return null;
  const scale = (value: number) => Math.max(0, Math.min(100, ((value - 0.6) / 0.5) * 100));
  const gain = Math.max(0, scale(after) - scale(before));
  return (
    <div className="relative h-2 min-w-[120px] rounded-full bg-slate-100" title="Scale is 60% to 110%. The mark is the 98% goal.">
      <i className="absolute inset-y-0 rounded-full bg-slate-300" style={{ left: 0, width: `${scale(before)}%` }} />
      <i className="absolute inset-y-0 rounded-full bg-green-600" style={{ left: `${scale(before)}%`, width: `${gain}%` }} />
      <i className="absolute inset-y-0 w-0.5 bg-neutral-900" style={{ left: `${scale(0.98)}%` }} />
    </div>
  );
}

function formatPoints(points: number | null): string {
  if (points == null) return "—";
  const sign = points > 0 ? "+" : "";
  return `${sign}${points.toFixed(1)} pts`;
}

function Drawer({ cell, shopName, manager, onClose }: { cell: AdminCell; shopName: string; manager: string; onClose: () => void }) {
  const rollup = cell.utilization;
  return (
    <>
      <button type="button" aria-label="Close details" className="fixed inset-0 z-10 bg-black/10" onClick={onClose} />
      <aside className="fixed top-0 right-0 z-20 flex h-full w-[620px] max-w-[95vw] flex-col overflow-auto border-l border-border bg-card shadow-xl">
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div>
            <h2 className="text-lg font-medium">
              {shopName} · {formatDay(cell.day)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {manager} · {cell.title}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1 text-sm">
            Close
          </button>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Count label="Suggestions" value={String(cell.suggestions)} />
            <Count label="Accepted" value={String(cell.accepted)} />
            <Count label="Rejected" value={cell.rejected == null ? "n/a" : String(cell.rejected)} />
            <Count label="Applied" value={String(cell.applied)} />
            <Count label="Failed" value={String(cell.failed)} />
            <Count label="Already done" value={String(cell.alreadyDone)} />
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6">
            <div>{cell.firstSubmit ? `First submit: ${formatDoneAt(cell.firstSubmit)}` : "Never submitted"}</div>
            {cell.submitCount > 1 ? <div>{cell.submitCount} submits</div> : null}
            {cell.signedOffAt ? (
              <div>
                Signed off: {formatDoneAt(cell.signedOffAt)}
                {cell.signoffNote ? ` · ${cell.signoffNote}` : ""}
              </div>
            ) : null}
            <div>
              Utilization: <span className="font-medium">{rollup.before == null ? "—" : formatPercent(rollup.before)}</span>
              {" → "}
              <span className="font-medium">{rollup.after == null ? "—" : formatPercent(rollup.after)}</span>
              {` (${formatPoints(rollup.changePoints)}), ${Math.round(rollup.addedMinutes)} min picked up`}
            </div>
          </div>
          {cell.notAGap > 0 ? <Note> {cell.notAGap} line{cell.notAGap === 1 ? "" : "s"} marked not a gap. Those minutes are not counted.</Note> : null}
          {cell.lines.some((line) => line.excluded && line.status !== "not_a_gap") ? (
            <Note>A line whose note says it was not applied or was a false gap adds no minutes.</Note>
          ) : null}
          {cell.rejected == null && cell.submitCount > 0 ? (
            <Note>Rejections were not stored on this submit, so rejected and never-decided lines cannot be told apart.</Note>
          ) : null}
          {cell.tone === "green" && cell.submitCount === 0 && cell.suggestions > 0 ? (
            <Note>Marked done without a submit, so no suggestion was sent to Fullbay.</Note>
          ) : null}
          {cell.signedOffAt && cell.failed > 0 ? <Note>Signed off with a failed line still on the queue.</Note> : null}
          <h3 className="text-sm font-medium">Lines</h3>
          {cell.lines.length === 0 ? <p className="text-sm text-muted-foreground">No lines.</p> : null}
          {cell.lines.map((line) => (
            <div key={line.findingId} className="rounded-lg border border-border px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {line.tech} · {line.order || "—"}
                    {line.nonPro ? <Pill tone="none">Non-Pro</Pill> : null}
                    {line.excluded ? <Pill tone="failed">not counted</Pill> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {line.work ? `${line.work} · ` : ""}
                    {line.window} · {line.minutes} min
                    {line.submits > 1 ? ` · sent ${line.submits}×` : ""}
                  </p>
                </div>
                <LineStatus status={line.status} decision={line.decision} />
              </div>
              {line.note ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{line.note.length > 260 ? `${line.note.slice(0, 260)}…` : line.note}</p> : null}
            </div>
          ))}
          <Link href={shopReviewHref(cell.shopId, cell.day)} className="mt-2 inline-flex w-fit rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background">
            Open this day in review
          </Link>
        </div>
      </aside>
    </>
  );
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border px-2 py-2 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">{children}</p>;
}

function LineStatus({ status, decision }: { status: string | null; decision: string }) {
  if (status === "applied") return <Pill tone="applied">applied</Pill>;
  if (status === "already_done") return <Pill tone="applied">already done</Pill>;
  if (status === "not_a_gap") return <Pill tone="none">not a gap</Pill>;
  if (status === "failed") return <Pill tone="failed">failed</Pill>;
  if (status === "pending") return <Pill tone="pending">pending</Pill>;
  if (decision === "Rejected") return <Pill tone="rejected">rejected</Pill>;
  return <Pill tone="none">{decision.toLowerCase()}</Pill>;
}

function Pill({ children, tone }: { children: ReactNode; tone: "applied" | "failed" | "pending" | "none" | "rejected" }) {
  const color =
    tone === "applied"
      ? "bg-green-100 text-green-800"
      : tone === "failed"
        ? "bg-red-100 text-red-800"
        : tone === "pending"
          ? "bg-amber-100 text-amber-800"
          : tone === "rejected"
            ? "bg-indigo-100 text-indigo-800"
            : "bg-zinc-100 text-zinc-600";
  return <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${color}`}>{children}</span>;
}

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildAdminPayload, formatDoneAt, lastSevenDays, presetBounds, shopReviewHref } from "@/lib/admin";
import { reviewSelectionFromQuery } from "@/lib/review-store";
import { utilization } from "@/lib/review";
import { SEED } from "@/lib/seed";
import type { DayReport, ShopId } from "@/lib/types";
import {
  historyDaysWithData,
  mergeUtilizationHistory,
  parseUtilizationHistory,
  rollupUtilization,
  snapshotFromReports,
  type UtilShopDay,
  type UtilTechSnapshot,
} from "@/lib/utilization-history";
import { readUtilizationHistory, syncUtilizationHistory, utilizationHistoryLivePath } from "@/lib/utilization-history-store";
import { latestEditsForShopDay, minutesPickedUp, type FullbayEditBatch, type RecordedSignoff } from "@/lib/fullbay-edit-queue";

const today = "2026-10-09";

function report(day: string, shopId: ShopId, minutes = 30): DayReport {
  return {
    day,
    shopId,
    technicians: [{ id: "tech-1", shopId, name: "Tech One", clockedHours: 8, soHours: 7 }],
    orders: [{ id: "D-1", shopId, title: "Brakes", status: "priorities" }],
    findings: [
      {
        id: `${day}-${shopId}-gap`,
        day,
        shopId,
        techId: "tech-1",
        kind: "gap",
        start: "08:00",
        end: "08:30",
        minutes,
        detail: "Gap",
        recommendation: {
          orderId: "D-1",
          work: "Brakes",
          start: "08:00",
          end: "08:30",
          minutes,
          summary: "Move the clock-in back.",
        },
      },
    ],
  };
}

function batch(day: string, shopId: ShopId, status: "applied" | "pending" | "failed", minutes = 30): FullbayEditBatch {
  return {
    id: `${day}-${shopId}-${status}`,
    submittedAt: "2026-10-08T15:00:00.000Z",
    shopId,
    days: [day],
    edits: [
      {
        findingId: `${day}-${shopId}-gap`,
        day,
        shopId,
        shopName: shopId,
        techName: "Tech One",
        orderId: "D-1",
        work: "Brakes",
        decision: "accept",
        newClockIn: "08:00",
        newClockOut: "08:30",
        minutes,
        status,
        appliedAt: status === "applied" ? "2026-10-08T16:00:00.000Z" : null,
        applyNote: null,
      },
    ],
  };
}

describe("admin date ranges", () => {
  it("uses Monday weeks and calendar months", () => {
    assert.deepEqual(lastSevenDays(today), ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    assert.deepEqual(presetBounds("this-week", today), { start: "2026-10-05", end: "2026-10-11" });
    assert.deepEqual(presetBounds("last-week", today), { start: "2026-09-28", end: "2026-10-04" });
    assert.deepEqual(presetBounds("this-month", today), { start: "2026-10-01", end: "2026-10-09" });
    assert.deepEqual(presetBounds("last-month", today), { start: "2026-09-01", end: "2026-09-30" });
    assert.deepEqual(presetBounds("ytd", today), { start: "2026-01-01", end: "2026-10-09" });
    assert.deepEqual(presetBounds("last-30", today), { start: "2026-09-10", end: "2026-10-09" });
  });
});

describe("admin shop status", () => {
  it("colors signed off, submitted, past due, closed, and empty days, and sorts laggards first", () => {
    const reports = [report("2026-10-08", "greenville"), report("2026-10-06", "dayton"), report("2026-10-07", "covington", 0)];
    reports[2]!.findings = [];
    const signoffs: RecordedSignoff[] = [{ day: "2026-10-07", shopId: "covington", doneAt: "2026-10-08T14:30:00.000Z", note: null }];
    const history = snapshotFromReports(reports, [batch("2026-10-06", "dayton", "pending")]);
    const payload = buildAdminPayload({
      today,
      start: "2026-10-05",
      end: "2026-10-11",
      reports,
      batches: [batch("2026-10-06", "dayton", "pending")],
      signoffs,
      history,
    });
    const byShop = new Map(payload.grid.shops.map((shop) => [shop.id, shop]));
    const greenville = byShop.get("greenville")!;
    const dayton = byShop.get("dayton")!;
    const covington = byShop.get("covington")!;
    const thursday = (shop: typeof greenville) => shop.cells.find((cell) => cell.day === "2026-10-08")!;
    assert.equal(thursday(greenville).tone, "red");
    assert.equal(thursday(greenville).title, "Due today");
    assert.equal(dayton.cells.find((cell) => cell.day === "2026-10-06")?.tone, "yellow");
    assert.equal(dayton.cells.find((cell) => cell.day === "2026-10-06")?.detail, "1 waiting on Fullbay");
    assert.equal(covington.cells.find((cell) => cell.day === "2026-10-07")?.tone, "green");
    assert.match(covington.cells.find((cell) => cell.day === "2026-10-07")?.title ?? "", /^Done /);
    assert.equal(formatDoneAt("2026-10-08T14:30:00.000Z").includes("10/8"), true);
    assert.equal(greenville.cells.find((cell) => cell.day === "2026-10-04")?.tone, "closed");
    assert.equal(greenville.cells.find((cell) => cell.day === "2026-10-02")?.tone, "nodata");
    assert.equal(greenville.daysBehind, 1);
    assert.equal(dayton.daysBehind, 1);
    assert.equal(payload.grid.shops[0]?.id, "dayton");
    assert.equal(payload.kpis.shopsBehind.map((shop) => shop.name).includes("Greenville"), true);
    assert.equal(shopReviewHref("greenville", "2026-10-08"), "/?shop=greenville&day=2026-10-08");
  });

  it("counts only applied and already_done minutes, and drops a false gap", () => {
    const loaded = report("2026-10-06", "springfield");
    const falseGap = batch("2026-10-06", "springfield", "applied", 339);
    falseGap.edits[0]!.applyNote = "Not applied: false gap. Time was on Dayton D-89514.";
    const real = batch("2026-10-06", "springfield", "applied", 12);
    real.id = "real";
    real.edits[0]!.findingId = "other";
    real.edits[0]!.techName = "Tech One";
    const history = snapshotFromReports([loaded], [falseGap, real]);
    const rollup = rollupUtilization(history[0]!.techs);
    assert.equal(rollup.addedMinutes, 12);
    assert.equal(rollup.before, utilization(7, 8));
    assert.equal(rollup.after, utilization(7 + 12 / 60, 8));
    const cell = buildAdminPayload({
      today,
      start: "2026-10-06",
      end: "2026-10-06",
      reports: [loaded],
      batches: [falseGap, real],
      signoffs: [],
      history,
    }).grid.shops.find((shop) => shop.id === "springfield")?.cells.find((item) => item.day === "2026-10-06");
    assert.equal(cell?.lines.some((line) => line.excluded && line.minutes === 339), true);
    assert.equal(cell?.utilization.addedMinutes, 12);
  });
});

describe("utilization history", () => {
  it("keeps an older day when a fresh snapshot no longer includes it", () => {
    const older: UtilShopDay = {
      day: "2026-09-15",
      shopId: "dayton",
      queueCovered: true,
      techs: [{ id: "tech-1", name: "Tech One", clockedHours: 10, soHours: 9, addedMinutes: 40 }],
    };
    const fresh = snapshotFromReports([report("2026-10-08", "mobile")], [batch("2026-10-08", "mobile", "applied", 20)]);
    const merged = mergeUtilizationHistory([older], fresh);
    assert.equal(merged.some((row) => row.day === "2026-09-15" && row.techs[0]?.addedMinutes === 40), true);
    assert.equal(merged.some((row) => row.day === "2026-10-08" && row.techs[0]?.addedMinutes === 20), true);
    const september = buildAdminPayload({
      today,
      start: "2026-09-01",
      end: "2026-09-30",
      reports: [],
      batches: [],
      signoffs: [],
      history: merged,
    });
    assert.equal(september.coverage.hasData, true);
    assert.equal(september.kpis.minutesPickedUp, 40);
    const empty = buildAdminPayload({
      today,
      start: "2026-08-01",
      end: "2026-08-31",
      reports: [],
      batches: [],
      signoffs: [],
      history: merged,
    });
    assert.equal(empty.coverage.hasData, false);
    assert.equal(empty.utilization, null);
    assert.match(empty.coverage.message, /No timesheet data/);
    assert.equal(empty.kpis.before, null);
  });

  it("keeps stored minutes when a later snapshot no longer sees the queue", () => {
    const stored = snapshotFromReports([report("2026-10-06", "dayton")], [batch("2026-10-06", "dayton", "applied", 15)]);
    const fresh = snapshotFromReports([report("2026-10-06", "dayton")], []);
    fresh[0]!.techs[0]!.clockedHours = 9;
    const merged = mergeUtilizationHistory(stored, fresh);
    assert.equal(merged[0]?.techs[0]?.clockedHours, 9);
    assert.equal(merged[0]?.techs[0]?.addedMinutes, 15);
    assert.equal(merged[0]?.queueCovered, true);
  });

  it("writes the merged history without dropping days, and reads it back", async () => {
    const directory = mkdtempSync(join(tmpdir(), "util-history-"));
    const previous = process.env.UTILIZATION_HISTORY_PATH;
    process.env.UTILIZATION_HISTORY_PATH = join(directory, "history.json");
    try {
      const older: UtilShopDay = {
        day: "2026-09-02",
        shopId: "columbus",
        queueCovered: true,
        techs: [{ id: "tech-1", name: "Tech One", clockedHours: 4, soHours: 3, addedMinutes: 10 }],
      };
      const { writeUtilizationHistory } = await import("@/lib/utilization-history-store");
      await writeUtilizationHistory([older]);
      const fresh = snapshotFromReports([report("2026-10-08", "dayton")], []);
      const merged = await syncUtilizationHistory(fresh);
      assert.equal(historyDaysWithData(merged).includes("2026-09-02"), true);
      assert.equal(utilizationHistoryLivePath(), join(directory, "history.json"));
      const again = await readUtilizationHistory();
      assert.deepEqual(again, merged);
    } finally {
      if (previous === undefined) delete process.env.UTILIZATION_HISTORY_PATH;
      else process.env.UTILIZATION_HISTORY_PATH = previous;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("seed utilization history", () => {
  const queue = JSON.parse(readFileSync(join(process.cwd(), "data", "fullbay-edit-queue.seed.json"), "utf8")) as { batches: FullbayEditBatch[] };
  const fresh = snapshotFromReports(SEED, queue.batches);
  const committed = parseUtilizationHistory(JSON.parse(readFileSync(join(process.cwd(), "data", "utilization-history.json"), "utf8")));

  it("matches the loaded day reports and leaves the Springfield false gap out", () => {
    for (const reportRow of SEED) {
      const snap = fresh.find((row) => row.day === reportRow.day && row.shopId === reportRow.shopId);
      if (!snap) assert.fail(`missing snapshot for ${reportRow.day} ${reportRow.shopId}`);
      for (const tech of reportRow.technicians) {
        const saved: UtilTechSnapshot | undefined = snap.techs.find((item) => item.id === tech.id);
        assert.equal(saved?.clockedHours, tech.clockedHours);
        assert.equal(saved?.soHours, tech.soHours);
      }
      const rollup = rollupUtilization(snap.techs);
      assert.equal(rollup.before, utilization(rollup.soHours, rollup.clockedHours));
    }
    const springfieldReport = SEED.find((row) => row.day === "2026-10-06" && row.shopId === "springfield");
    const mike = springfieldReport?.technicians.find((tech) => tech.name === "Mike Wooten");
    const latest = latestEditsForShopDay(queue.batches, "2026-10-06", "springfield");
    const falseGap = latest.get("2026-10-06-springfield-mike-wooten-17");
    assert.equal(falseGap?.minutes, 339);
    assert.equal(minutesPickedUp(falseGap!), 0);
    let expected = 0;
    for (const edit of latest.values()) {
      if (edit.techName !== "Mike Wooten") continue;
      const finding = springfieldReport?.findings.find((item) => item.id === edit.findingId);
      const techId = finding?.techId ?? mike?.id;
      if (techId === mike?.id) expected += minutesPickedUp(edit);
    }
    const snapMike = fresh.find((row) => row.day === "2026-10-06" && row.shopId === "springfield")?.techs.find((tech) => tech.id === mike?.id);
    assert.equal(snapMike?.addedMinutes, expected);
    assert.ok(expected < (snapMike?.addedMinutes ?? 0) + 339);
    const week = buildAdminPayload({
      today,
      start: "2026-10-02",
      end: "2026-10-08",
      reports: SEED,
      batches: queue.batches,
      signoffs: [],
      history: fresh,
    });
    assert.equal(week.coverage.hasData, true);
    assert.ok((week.kpis.minutesPickedUp ?? 0) > 0);
    const fileHasEveryFreshDay = fresh.every((row) => {
      const saved = committed.find((item) => item.day === row.day && item.shopId === row.shopId);
      return JSON.stringify(saved) === JSON.stringify(row);
    });
    assert.equal(fileHasEveryFreshDay, true);
    assert.deepEqual(historyDaysWithData(committed), historyDaysWithData(fresh));
  });
});

describe("review deep link", () => {
  it("selects the shop and day from the admin link", () => {
    const state = {
      shopId: "all" as const,
      days: ["2026-10-08"],
      view: "summary" as const,
      decisions: {},
      signoffs: {},
      submission: null,
    };
    const next = reviewSelectionFromQuery(state, "?shop=greenville&day=2026-10-08", today);
    assert.equal(next.shopId, "greenville");
    assert.deepEqual(next.days, ["2026-10-08"]);
    assert.equal(next.view, "review");
    const ignored = reviewSelectionFromQuery(state, "?shop=nope&day=2020-01-01", today);
    assert.equal(ignored.shopId, "all");
    assert.deepEqual(ignored.days, ["2026-10-08"]);
  });
});

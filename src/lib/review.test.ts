import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURATED_FRIDAY } from "@/lib/curated-friday";
import { DEMO_TODAY, defaultPendingDays, reviewWindow } from "@/lib/dates";
import { SEED } from "@/lib/seed";
import { parsePersistedState } from "@/lib/storage";
import { appliedWindow, formatPercent } from "@/lib/time";
import {
  attest,
  auditStatus,
  buildPlan,
  buildSubmission,
  filterReports,
  markDone,
  shopsWithData,
  soHoursAfter,
  sumTotals,
  techOutlook,
  techTotals,
  utilization,
} from "@/lib/review";
import { SHOPS, type Decision } from "@/lib/types";

const friday = "2026-10-02";
const saturday = "2026-10-03";
const accept: Decision = { kind: "accept", start: "", end: "" };
const reject: Decision = { kind: "reject", start: "", end: "" };

function recommendation(id: string) {
  const finding = CURATED_FRIDAY.findings.find((item) => item.id === id);
  assert.ok(finding?.recommendation);
  return finding.recommendation;
}

describe("review days", () => {
  it("opens on Tuesday October 6 so Monday October 5 is due", () => {
    assert.equal(DEMO_TODAY, "2026-10-06");
    assert.deepEqual(defaultPendingDays(DEMO_TODAY), ["2026-10-05"]);
    assert.deepEqual(defaultPendingDays("2026-10-05"), [friday, saturday]);
  });

  it("approves the previous day on Tuesday and Wednesday mornings", () => {
    assert.deepEqual(defaultPendingDays("2026-10-06"), ["2026-10-05"]);
    assert.deepEqual(defaultPendingDays("2026-10-07"), ["2026-10-06"]);
  });

  it("keeps Saturday and drops Sunday", () => {
    const days = reviewWindow(DEMO_TODAY);
    assert.ok(days.includes(friday));
    assert.ok(days.includes(saturday));
    assert.ok(days.includes("2026-10-05"));
    assert.equal(days.some((day) => new Date(`${day}T12:00:00Z`).getUTCDay() === 0), false);
  });
});

describe("shop scope", () => {
  it("lists every shop and loads Friday, Saturday, and Monday from the scrapes", () => {
    assert.deepEqual(
      SHOPS.map((shop) => shop.name),
      ["Dayton", "Covington", "Greenville", "Springfield", "Mobile", "Columbus"],
    );
    assert.deepEqual(shopsWithData(SEED), ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"]);
    assert.ok(filterReports(SEED, "all", [friday]).length > 1);
    assert.ok(filterReports(SEED, "covington", [friday]).length === 1);
    assert.ok(filterReports(SEED, "all", [saturday]).length > 0);
    assert.ok(filterReports(SEED, "all", ["2026-10-05"]).length > 0);
  });

  it("does not treat All shops and Dayton as the same Friday", () => {
    const allFriday = filterReports(SEED, "all", [friday]);
    const daytonFriday = filterReports(SEED, "dayton", [friday]);
    assert.ok(allFriday.length > daytonFriday.length);
    assert.ok(daytonFriday.every((report) => report.shopId === "dayton" && report.day === friday));
  });
});

describe("decisions and utilization", () => {
  it("matches the loaded utilization figures", () => {
    assert.equal(formatPercent(7.24 / 9.89), "73.2%");
    assert.equal(formatPercent(8.14 / 8.83), "92.2%");
    assert.equal(formatPercent(6.52 / 6.54), "99.7%");
    assert.equal(formatPercent(9.89 / 9.95), "99.4%");
    assert.equal(formatPercent(8.99 / 8.99), "100.0%");
  });

  it("states the day outcome from eligible recommendations only", () => {
    const report = CURATED_FRIDAY;
    const zach = report.technicians.find((tech) => tech.id === "zach-spencer");
    const cole = report.technicians.find((tech) => tech.id === "cole-lozan");
    const tanveer = report.technicians.find((tech) => tech.id === "tanveer-dhaliwal");
    assert.ok(zach && cole && tanveer);

    const zachOutlook = techOutlook(report, zach);
    assert.equal(zachOutlook.recommendedMinutes, 113);
    assert.equal(zachOutlook.minutesToGoal, 147);
    assert.equal(formatPercent(zachOutlook.ifAll ?? 0), "92.2%");

    const coleOutlook = techOutlook(report, cole);
    assert.equal(coleOutlook.requiredMinutes, 35);
    assert.equal(coleOutlook.optionalMinutes, 5);
    assert.equal(coleOutlook.minutesToGoal, 31);
    assert.equal(formatPercent(coleOutlook.ifRequired ?? 0), "98.8%");
    assert.equal(formatPercent(coleOutlook.ifAll ?? 0), "99.7%");

    const tanveerOutlook = techOutlook(report, tanveer);
    assert.equal(tanveerOutlook.recommendedMinutes, 15);
    assert.equal(tanveerOutlook.minutesToGoal, 11);
    assert.equal(formatPercent(tanveerOutlook.ifAll ?? 0), "99.5%");
  });

  it("lists every Zach segment from the day sheet, including leave-as-is work", () => {
    const zach = CURATED_FRIDAY.findings.filter((finding) => finding.techId === "zach-spencer").map((finding) => finding.start);
    assert.deepEqual(zach, ["06:29", "08:07", "11:06", "12:07", "12:20", "13:09", "13:44", "13:47", "15:06", "15:51"]);
    const work = CURATED_FRIDAY.findings.find((finding) => finding.id === "zach-0807");
    assert.equal(work?.kind, "as_is");
    assert.equal(work?.detail, "D-88889 / Replace engine.");
    assert.equal(work?.recommendation, null);
    const tire = CURATED_FRIDAY.findings.find((finding) => finding.id === "zach-flag-1506");
    assert.equal(tire?.recommendation, null);
  });

  it("adds recommended minutes for accept and nothing for reject", () => {
    const report = CURATED_FRIDAY;
    const accepted = techTotals([report], { "zach-0629": accept, "cole-1518": reject });
    const zach = accepted.find((tech) => tech.techId === "zach-spencer");
    const cole = accepted.find((tech) => tech.techId === "cole-lozan");
    assert.equal(zach?.addedMinutes, 97);
    assert.equal(cole?.addedMinutes, 0);
  });

  it("keeps a blank or unchanged override side on the recommendation", () => {
    const zach = recommendation("zach-0629");
    const blankStart = appliedWindow(zach, { kind: "override", start: "", end: "08:07" });
    assert.equal(blankStart.valid, true);
    assert.equal(blankStart.minutes, 97);
    assert.equal(blankStart.start, "06:29");

    const unchanged = appliedWindow(zach, { kind: "override", start: "06:29", end: "08:07" });
    assert.equal(unchanged.minutes, 97);

    const startOnly = appliedWindow(zach, { kind: "override", start: "06:40", end: "" });
    assert.equal(startOnly.start, "06:40");
    assert.equal(startOnly.end, "08:07");
    assert.equal(startOnly.minutes, 87);
  });

  it("lets an override change the end, the start, or both", () => {
    const tanveer = recommendation("tanveer-1421");
    const endOnly = appliedWindow(tanveer, { kind: "override", start: "", end: "14:30" });
    assert.equal(endOnly.minutes, 9);
    const startOnly = appliedWindow(tanveer, { kind: "override", start: "14:25", end: "" });
    assert.equal(startOnly.minutes, 2);
    const both = appliedWindow(tanveer, { kind: "override", start: "14:20", end: "14:30" });
    assert.equal(both.minutes, 10);
    const backwards = appliedWindow(tanveer, { kind: "override", start: "14:30", end: "14:21" });
    assert.equal(backwards.valid, false);
  });

  it("recomputes shop utilization from accepted minutes only", () => {
    const fridayReport = CURATED_FRIDAY;
    const decisions = Object.fromEntries(
      fridayReport.findings.filter((finding) => finding.recommendation).map((finding) => [finding.id, accept]),
    );
    const totals = techTotals([fridayReport], decisions);
    const sum = sumTotals(totals);
    assert.equal(sum.addedMinutes, 168);
    const soHours = sum.baselineSoHours + sum.addedMinutes / 60;
    assert.ok(Math.abs(soHours - 47.31) < 1e-9);
    const ratio = utilization(soHours, sum.clockedHours);
    assert.ok(ratio != null && ratio >= 0.98);

    const zach = totals.find((tech) => tech.techId === "zach-spencer");
    assert.ok(zach);
    assert.equal(formatPercent(utilization(soHoursAfter(zach), zach.clockedHours) ?? 0), "92.2%");
  });
});

describe("submit plan", () => {
  it("skips invoiced orders and records rejects with no reason", () => {
    const reports = [CURATED_FRIDAY];
    const plan = buildPlan(reports, {
      "zach-0629": accept,
      "cole-1518": reject,
    });
    assert.deepEqual(
      plan.skipped.map((order) => order.orderId),
      ["D-90552", "D-90301"],
    );
    assert.equal(plan.edits.length, 1);
    assert.equal(plan.edits[0]?.minutes, 97);
    assert.equal(plan.rejected.length, 1);
    assert.equal(plan.rejected[0]?.orderId, "D-90318");
    assert.equal(plan.rejected[0]?.minutes, 0);
    assert.equal("reason" in plan.rejected[0]!, false);
    assert.ok(plan.undecided.some((edit) => edit.findingId === "tanveer-1300"));
    assert.equal(
      plan.edits.some((edit) => edit.orderId === "D-90552"),
      false,
    );
  });

  it("refuses to mark a day done without the utilization check", () => {
    assert.equal(markDone(undefined, "2026-10-05T12:00:00.000Z"), null);
    assert.equal(markDone({ attested: false, doneAt: null }, "2026-10-05T12:00:00.000Z"), null);
    const done = markDone({ attested: true, doneAt: null }, "2026-10-05T12:00:00.000Z");
    assert.equal(done?.doneAt, "2026-10-05T12:00:00.000Z");
    assert.deepEqual(attest(done ?? undefined, false), { attested: false, doneAt: null });
  });

  it("keeps a signed-off day distinct from one that was skipped", () => {
    const open = auditStatus(friday, ["dayton"], {});
    const approved = auditStatus(friday, ["dayton"], {
      [`${friday}|dayton`]: { attested: true, doneAt: "2026-10-05T15:00:00.000Z" },
    });
    const partial = auditStatus(friday, ["dayton", "covington"], {
      [`${friday}|dayton`]: { attested: true, doneAt: "2026-10-05T15:00:00.000Z" },
    });
    assert.equal(open, "open");
    assert.equal(approved, "approved");
    assert.equal(partial, "partial");
  });

  it("drops a done flag that was saved without attestation", () => {
    const state = parsePersistedState(
      JSON.stringify({
        shopId: "all",
        days: [friday, saturday],
        view: "summary",
        decisions: { "zach-0629": accept },
        signoffs: { [`${friday}|dayton`]: { attested: false, doneAt: "2026-10-05T15:00:00.000Z" } },
        submission: null,
      }),
    );
    assert.deepEqual(state.signoffs[`${friday}|dayton`], { attested: false, doneAt: null });
    assert.throws(() => parsePersistedState("{"));
  });

  it("records a local submission for the active filter", () => {
    const reports = [CURATED_FRIDAY];
    const submission = buildSubmission(reports, { "tanveer-1421": accept }, "dayton", [saturday, friday], "2026-10-05T15:00:00.000Z");
    assert.deepEqual(submission.days, [friday, saturday]);
    assert.equal(submission.edits.length, 1);
    assert.equal(submission.shopId, "dayton");
    assert.equal(submission.skipped.length, 2);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURATED_FRIDAY } from "@/lib/curated-friday";
import { timesheetToDayReports, type FullbayTimesheetRow } from "@/lib/fullbay-timesheet";
import { submissionToQueueRequest } from "@/lib/fullbay-edit-queue";
import { AUDIT_START, defaultPendingDays, reviewWindow, todayInNewYork } from "@/lib/dates";
import { SEED } from "@/lib/seed";
import { parsePersistedState } from "@/lib/storage";
import { appliedWindow, formatPercent } from "@/lib/time";
import {
  attest,
  auditLabel,
  auditStatus,
  buildPlan,
  dayChipState,
  dayUtilization,
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
import { SHOPS, type DayReport, type Decision, type Finding } from "@/lib/types";
import { dayPunches } from "@/lib/day-punches";
import { defaultKeptWindow, defaultPartialChoice } from "@/lib/nonpro";

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
  it("uses the America/New_York calendar date, including across midnight", () => {
    assert.equal(todayInNewYork(new Date("2026-10-07T20:00:00Z")), "2026-10-07");
    assert.equal(todayInNewYork(new Date("2026-10-08T03:30:00Z")), "2026-10-07");
    assert.equal(todayInNewYork(new Date("2026-10-08T04:30:00Z")), "2026-10-08");
    assert.deepEqual(defaultPendingDays(todayInNewYork(new Date("2026-10-07T20:00:00Z"))), ["2026-10-06"]);
    assert.deepEqual(defaultPendingDays("2026-10-05"), [friday, saturday]);
  });

  it("approves the previous day on Tuesday, Wednesday, and Friday mornings", () => {
    assert.deepEqual(defaultPendingDays("2026-10-06"), ["2026-10-05"]);
    assert.deepEqual(defaultPendingDays("2026-10-07"), ["2026-10-06"]);
    assert.deepEqual(defaultPendingDays("2026-10-09"), ["2026-10-08"]);
    assert.deepEqual(defaultPendingDays("2026-10-10"), ["2026-10-09"]);
  });

  it("starts the trail on Friday October 2 and drops Sunday", () => {
    assert.deepEqual(reviewWindow("2026-10-09"), [friday, saturday, "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
    assert.deepEqual(reviewWindow("2026-10-10"), [friday, saturday, "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
    assert.deepEqual(reviewWindow("2026-10-07"), [friday, saturday, "2026-10-05", "2026-10-06"]);
    assert.deepEqual(reviewWindow("2026-10-06"), [friday, saturday, "2026-10-05"]);
    const later = reviewWindow("2026-10-20", 30);
    assert.equal(later[0], AUDIT_START);
    assert.equal(later.includes("2026-10-01"), false);
    assert.equal(later.includes("2026-09-22"), false);
    assert.ok(later.includes("2026-10-19"));
    assert.equal(later.some((day) => new Date(`${day}T12:00:00Z`).getUTCDay() === 0), false);
  });

  it("shows a signed-off day as done and keeps a due day distinct", () => {
    const signed = { attested: true, doneAt: "2026-10-06T12:43:00.000Z" };
    const signoffs = { [`${friday}|dayton`]: signed };
    assert.deepEqual(dayChipState(friday, ["dayton"], signoffs, ["2026-10-06"]), {
      tone: "done",
      doneAt: "2026-10-06T12:43:00.000Z",
      note: null,
    });
    assert.deepEqual(dayChipState("2026-10-06", ["dayton"], signoffs, ["2026-10-06"]), { tone: "due", doneAt: null, note: null });
    assert.deepEqual(dayChipState(saturday, ["dayton"], {}, []), { tone: "open", doneAt: null, note: null });
    assert.equal(dayChipState(friday, ["dayton", "mobile"], signoffs, []).tone, "open");
    const autoNote = "Auto-approved after all edits applied";
    const auto = {
      [`${friday}|dayton`]: { attested: true, doneAt: "2026-10-06T12:43:00.000Z", note: autoNote },
      [`${friday}|mobile`]: { attested: true, doneAt: "2026-10-06T12:50:00.000Z", note: autoNote },
    };
    assert.equal(dayChipState(friday, ["dayton", "mobile"], auto, []).note, autoNote);
    assert.equal(
      dayChipState(friday, ["dayton", "mobile"], { ...auto, [`${friday}|mobile`]: { attested: true, doneAt: "2026-10-06T12:50:00.000Z" } }, []).note,
      null,
    );
  });
});

describe("shop scope", () => {
  it("lists every shop and loads Friday October 2 through Friday October 9", () => {
    assert.deepEqual(
      SHOPS.map((shop) => shop.name),
      ["Dayton", "Covington", "Greenville", "Springfield", "Mobile", "Columbus"],
    );
    assert.deepEqual(shopsWithData(SEED), ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"]);
    assert.ok(filterReports(SEED, "all", [friday]).length > 1);
    assert.ok(filterReports(SEED, "covington", [friday]).length === 1);
    assert.ok(filterReports(SEED, "all", [saturday]).length > 0);
    assert.ok(filterReports(SEED, "all", ["2026-10-05"]).length > 0);
    assert.ok(filterReports(SEED, "all", ["2026-10-06"]).length > 0);
    assert.ok(filterReports(SEED, "all", ["2026-10-07"]).length > 0);
    assert.ok(filterReports(SEED, "all", ["2026-10-08"]).length > 0);
    assert.ok(filterReports(SEED, "all", ["2026-10-09"]).length > 0);
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

  it("approves a day only when every shop in view is marked done", () => {
    const open = auditStatus(friday, ["dayton"], {});
    const approved = auditStatus(friday, ["dayton"], {
      [`${friday}|dayton`]: { attested: true, doneAt: "2026-10-05T15:00:00.000Z" },
    });
    const oneShopOpen = auditStatus(friday, ["dayton", "covington"], {
      [`${friday}|dayton`]: { attested: true, doneAt: "2026-10-05T15:00:00.000Z" },
    });
    assert.equal(open, "open");
    assert.equal(auditLabel(open), "Not approved");
    assert.equal(approved, "approved");
    assert.equal(auditLabel(approved), "Approved");
    assert.equal(oneShopOpen, "open");
    assert.equal(auditLabel(oneShopOpen), "Not approved");
    assert.equal(auditStatus(friday, [], {}), "open");
  });

  it("reports original and corrected utilization for the shops in view", () => {
    const report: DayReport = {
      day: friday,
      shopId: "mobile",
      technicians: [{ id: "chris-clark", shopId: "mobile", name: "Chris Clark", clockedHours: 9, soHours: 8.5 }],
      findings: [
        {
          id: "travel-gap",
          day: friday,
          shopId: "mobile",
          techId: "chris-clark",
          kind: "gap",
          start: "07:26",
          end: "07:36",
          minutes: 10,
          detail: "Clocked. No service order on this stretch.",
          recommendation: {
            orderId: "M-90534",
            work: "Onsite Travel",
            start: "07:26",
            end: "07:36",
            minutes: 10,
            summary: "Start the next line at 7:26 AM.",
          },
        },
      ],
      orders: [{ id: "M-90534", shopId: "mobile", title: "Onsite Travel", status: "priorities" }],
    };
    const baseline = dayUtilization([report], friday, ["mobile"], {});
    assert.equal(formatPercent(baseline.original ?? 0), "94.4%");
    assert.equal(formatPercent(baseline.corrected ?? 0), "94.4%");
    const accepted = dayUtilization([report], friday, ["mobile"], { "travel-gap": accept });
    assert.equal(formatPercent(accepted.corrected ?? 0), "96.3%");
    const rejected = dayUtilization([report], friday, ["mobile"], { "travel-gap": reject });
    assert.equal(formatPercent(rejected.corrected ?? 0), "94.4%");
    const empty = dayUtilization([report], friday, ["dayton"], {});
    assert.equal(empty.original, null);
    assert.equal(empty.corrected, null);
    const unclocked: DayReport = {
      ...report,
      technicians: [{ id: "chris-clark", shopId: "mobile", name: "Chris Clark", clockedHours: 0, soHours: 0 }],
      findings: [],
    };
    assert.deepEqual(dayUtilization([unclocked], friday, ["mobile"], {}), { original: null, corrected: null });
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

  it("keeps an older saved decision and a Non-Pro choice", () => {
    const state = parsePersistedState(
      JSON.stringify({
        shopId: "dayton",
        days: [friday],
        view: "review",
        decisions: {
          "zach-0629": accept,
          "meeting": { kind: "accept", start: "", end: "", nonProEditType: "split", split: "07:09", targetOrderId: " D-1 " },
          "partial": { kind: "accept", start: "07:00", end: "07:10", nonProEditType: "partial", nonProRemainder: "next" },
          "bad": { kind: "accept", start: "", end: "", nonProEditType: "nope" },
        },
        signoffs: {},
        submission: null,
      }),
    );
    assert.deepEqual(state.decisions["zach-0629"], accept);
    assert.equal(state.decisions.meeting?.nonProEditType, "split");
    assert.equal(state.decisions.meeting?.split, "07:09");
    assert.equal(state.decisions.meeting?.targetOrderId, "D-1");
    assert.equal(state.decisions.partial?.nonProEditType, "partial");
    assert.equal(state.decisions.partial?.nonProRemainder, "next");
    assert.equal(state.decisions.partial?.start, "07:00");
    assert.equal(state.decisions.partial?.end, "07:10");
    assert.equal(state.decisions.bad?.nonProEditType, undefined);
  });
});

function sampleRow(overrides: Partial<FullbayTimesheetRow> & Pick<FullbayTimesheetRow, "employee">): FullbayTimesheetRow {
  return {
    shop: "The Service Company - Dayton (D)",
    clock_in: "8:00:00AM 10/8/2026",
    clock_in_activity: "Inactive",
    clock_out: "9:00:00AM 10/8/2026",
    hours: 1,
    so_complaint: "",
    comment: "",
    open_punch: false,
    ...overrides,
  };
}

function nonProDay(): { report: DayReport; finding: Finding } {
  const reports = timesheetToDayReports({
    date: "2026-10-08",
    rows: [
      sampleRow({
        employee: "Review Tech",
        clock_in: "7:00:00AM 10/8/2026",
        clock_out: "8:00:00AM 10/8/2026",
        hours: 1,
        so_complaint: "D-10 / Brakes",
      }),
      sampleRow({
        employee: "Review Tech",
        clock_in: "8:00:00AM 10/8/2026",
        clock_out: "9:00:00AM 10/8/2026",
        clock_in_activity: "Shop Meeting",
        hours: 1,
      }),
      sampleRow({
        employee: "Review Tech",
        shop: "The Service Company-Mobile Units (M)",
        clock_in: "9:00:00AM 10/8/2026",
        clock_out: "10:00:00AM 10/8/2026",
        hours: 1,
        so_complaint: "M-20 / Onsite",
      }),
    ],
  });
  const report = reports.find((item) => item.shopId === "dayton");
  const finding = report?.findings.find((item) => item.detail.includes("Shop Meeting"));
  assert.ok(report && finding);
  return { report, finding };
}

describe("Non-Pro edit payload", () => {
  it("builds extend, move, split, move-to-so, and keep, and clamps a split", () => {
    const { report, finding } = nonProDay();
    assert.equal(finding.nonPro?.previous?.orderId, "D-10");
    assert.equal(finding.nonPro?.previous?.work, "Brakes");
    assert.equal(finding.nonPro?.next?.orderId, "M-20");
    assert.equal(finding.nonPro?.next?.shopId, "mobile");
    assert.equal(finding.nonPro?.canSplit, true);

    const keep = buildPlan([report], { [finding.id]: { kind: "reject", start: "", end: "", nonProEditType: "keep" } });
    assert.equal(keep.edits.length, 0);
    assert.equal(keep.rejected[0]?.nonPro?.editType, "keep");
    assert.equal(keep.rejected[0]?.minutes, 0);
    assert.deepEqual(keep.rejected[0]?.nonPro?.rows, []);

    const extend = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "extend_prev_out" } });
    const extendRow = extend.edits[0]?.nonPro?.rows[0];
    assert.equal(extend.edits[0]?.nonPro?.editType, "extend_prev_out");
    assert.equal(extend.edits[0]?.nonPro?.originalClockIn, "08:00");
    assert.equal(extend.edits[0]?.nonPro?.originalClockOut, "09:00");
    assert.equal(extendRow?.orderId, "D-10");
    assert.equal(extendRow?.work, "Brakes");
    assert.equal(extendRow?.clockIn, "07:00");
    assert.equal(extendRow?.clockOut, "08:00");
    assert.equal(extendRow?.newClockIn, "07:00");
    assert.equal(extendRow?.newClockOut, "09:00");
    assert.equal(extend.edits[0]?.minutes, 60);

    const move = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "move_next_in" } });
    const moveRow = move.edits[0]?.nonPro?.rows[0];
    assert.equal(moveRow?.orderId, "M-20");
    assert.equal(moveRow?.shopId, "mobile");
    assert.equal(moveRow?.clockIn, "09:00");
    assert.equal(moveRow?.clockOut, "10:00");
    assert.equal(moveRow?.newClockIn, "08:00");
    assert.equal(moveRow?.newClockOut, "10:00");

    const split = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "split", split: "06:15" } });
    assert.equal(split.invalid.length, 0);
    assert.equal(split.edits[0]?.nonPro?.rows[0]?.newClockOut, "08:01");
    assert.equal(split.edits[0]?.nonPro?.rows[1]?.newClockIn, "08:01");
    assert.equal(split.edits[0]?.nonPro?.rows[1]?.orderId, "M-20");
    assert.equal(split.edits[0]?.minutes, 60);

    const inside = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "split", split: "08:30" } });
    assert.equal(inside.edits[0]?.nonPro?.rows[0]?.newClockOut, "08:30");
    assert.equal(inside.edits[0]?.nonPro?.rows[1]?.newClockIn, "08:30");

    const moved = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "move_to_so", targetOrderId: "m-20" } });
    const movedRow = moved.edits[0]?.nonPro?.rows[0];
    assert.equal(moved.edits[0]?.nonPro?.editType, "move_to_so");
    assert.equal(movedRow?.orderId, "M-20");
    assert.equal(movedRow?.work, "Onsite");
    assert.equal(movedRow?.newClockIn, "08:00");
    assert.equal(movedRow?.newClockOut, "09:00");
    assert.equal(movedRow?.clockIn, "08:00");

    const typed = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "move_to_so", targetOrderId: "S-55" } });
    assert.equal(typed.edits[0]?.nonPro?.rows[0]?.orderId, "S-55");
    assert.equal(typed.edits[0]?.nonPro?.rows[0]?.work, "");
    assert.equal(typed.edits[0]?.nonPro?.rows[0]?.shopId, "springfield");

    const bad = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "move_to_so", targetOrderId: "brakes" } });
    assert.equal(bad.invalid.length, 1);

    const queued = submissionToQueueRequest(buildSubmission([report], {
      [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "extend_prev_out" },
    }, "dayton", ["2026-10-08"], "2026-10-09T12:00:00.000Z"));
    assert.equal(queued.edits.length, 1);
    assert.equal(queued.edits[0]?.nonPro?.editType, "extend_prev_out");
    assert.equal(queued.edits[0]?.newClockIn, "07:00");
    assert.equal(queued.edits[0]?.newClockOut, "09:00");
    const kept = submissionToQueueRequest(buildSubmission([report], {
      [finding.id]: { kind: "reject", start: "", end: "", nonProEditType: "keep" },
    }, "dayton", ["2026-10-08"], "2026-10-09T12:00:00.000Z"));
    assert.equal(kept.edits.length, 0);
    assert.equal(kept.decided?.[0]?.findingId, finding.id);
  });

  it("adds assigned Non-Pro time to the projection and leaves keep at zero", () => {
    const { report, finding } = nonProDay();
    const tech = report.technicians[0];
    assert.ok(tech);
    const before = techOutlook(report, tech);
    const kept = techOutlook(report, tech, { [finding.id]: { kind: "reject", start: "", end: "", nonProEditType: "keep" } });
    const assigned = techOutlook(report, tech, { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "move_next_in" } });
    assert.equal(before.choiceMinutes, 0);
    assert.equal(kept.choiceMinutes, 0);
    assert.equal(kept.ifAll, before.ifAll);
    assert.equal(assigned.choiceMinutes, 60);
    assert.ok((assigned.ifAll ?? 0) > (before.ifAll ?? 0));
    const totals = techTotals([report], { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "extend_prev_out" } });
    assert.equal(totals[0]?.addedMinutes, 60);
    const punches = dayPunches(report, tech.id, { [finding.id]: { kind: "accept", start: "", end: "", nonProEditType: "extend_prev_out" } }, []);
    const brakes = punches.find((punch) => punch.orderId === "D-10");
    assert.equal(brakes?.clockOut, "09:00");
    assert.equal(brakes?.originalClockOut, "08:00");
  });

  it("uses Chris Clark’s scoped Thursday hours for the 98% line", () => {
    const report = SEED.find((item) => item.day === "2026-10-08" && item.shopId === "dayton");
    const tech = report?.technicians.find((item) => item.id === "chris-clark");
    assert.ok(report && tech);
    const outlook = techOutlook(report, tech);
    assert.equal(formatPercent(utilization(tech.soHours, tech.clockedHours) ?? 0), "76.4%");
    assert.equal(outlook.minutesToGoal, 32);
    assert.equal(formatPercent(outlook.ifAll ?? 0), "86.6%");
    const allShops = SHOPS.map((shop) => shop.id);
    const day = dayUtilization(SEED, "2026-10-08", allShops, {});
    const daytonOnly = dayUtilization(SEED, "2026-10-08", ["dayton"], {});
    assert.ok(day.original != null && daytonOnly.original != null);
    assert.ok(daytonOnly.original > 0.15);
  });

  it("keeps 7:00–7:10 of Chris Clark’s Shop Meeting and moves M-90566 back to 7:11", () => {
    const report = SEED.find((item) => item.day === "2026-10-08" && item.shopId === "dayton");
    const tech = report?.technicians.find((item) => item.id === "chris-clark");
    const finding = report?.findings.find((item) => item.id === "2026-10-08-dayton-chris-clark-01");
    assert.ok(report && tech && finding?.nonPro);
    assert.equal(finding.start, "07:00");
    assert.equal(finding.end, "07:18");
    assert.equal(finding.nonPro.previous, null);
    assert.equal(finding.nonPro.next?.orderId, "M-90566");
    assert.equal(finding.nonPro.next?.clockIn, "07:18");
    const defaults = defaultPartialChoice(finding.start, finding.end, finding.nonPro);
    assert.equal(defaults?.remainder, "next");
    assert.equal(defaults?.start, "07:00");
    assert.equal(defaults?.end, "07:09");

    const decision: Decision = { kind: "accept", start: "07:00", end: "07:10", nonProEditType: "partial", nonProRemainder: "next" };
    const plan = buildPlan([report], { [finding.id]: decision });
    const payload = plan.edits[0]?.nonPro;
    const row = payload?.rows[0];
    assert.equal(plan.invalid.length, 0);
    assert.equal(payload?.editType, "partial");
    assert.equal(payload?.originalClockIn, "07:00");
    assert.equal(payload?.originalClockOut, "07:18");
    assert.equal(payload?.keptClockIn, "07:00");
    assert.equal(payload?.keptClockOut, "07:10");
    assert.equal(row?.orderId, "M-90566");
    assert.equal(row?.shopId, "mobile");
    assert.equal(row?.clockIn, "07:18");
    assert.equal(row?.newClockIn, "07:11");
    assert.equal(row?.newClockOut, row?.clockOut);
    assert.equal(plan.edits[0]?.minutes, 7);
    assert.equal(plan.edits[0]?.start, "07:11");

    const outlook = techOutlook(report, tech, { [finding.id]: decision });
    const before = techOutlook(report, tech);
    assert.equal(outlook.choiceMinutes, 7);
    assert.ok((outlook.ifAll ?? 0) > (before.ifAll ?? 0));
    const punches = dayPunches(report, tech.id, { [finding.id]: decision }, []);
    const travel = punches.find((punch) => punch.orderId === "M-90566" && punch.originalClockIn === "07:18");
    assert.equal(travel?.clockIn, "07:11");

    const outside = buildPlan([report], { [finding.id]: { ...decision, end: "07:30" } });
    assert.match(outside.invalid[0]?.error ?? "", /inside/);
    const backwards = buildPlan([report], { [finding.id]: { ...decision, start: "07:12", end: "07:10" } });
    assert.match(backwards.invalid[0]?.error ?? "", /after its start/);
    const noRoom = buildPlan([report], { [finding.id]: { ...decision, end: "07:18" } });
    assert.match(noRoom.invalid[0]?.error ?? "", /one minute/);

    const mobile = SEED.find((item) => item.day === "2026-10-08" && item.shopId === "mobile");
    const later = mobile?.findings.find((item) => item.id === "2026-10-08-mobile-chris-clark-02");
    assert.equal(later?.nonPro?.previous?.orderId, "M-90566");
    assert.equal(later?.nonPro?.next?.orderId, "D-90273");
    assert.equal(defaultPartialChoice(later?.start ?? "", later?.end ?? "", later?.nonPro ?? { previous: null, next: null })?.remainder, "both");
  });

  it("lets the manager adjust Non-Pro times and rejects an overlap", () => {
    const { report, finding } = nonProDay();
    assert.ok(finding.nonPro?.previous && finding.nonPro.next);
    const extend = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "08:30", nonProEditType: "extend_prev_out" } });
    assert.equal(extend.edits[0]?.nonPro?.rows[0]?.newClockOut, "08:30");
    assert.equal(extend.edits[0]?.nonPro?.keptClockIn, "08:31");
    assert.equal(extend.edits[0]?.nonPro?.keptClockOut, "09:00");
    assert.equal(extend.edits[0]?.minutes, 30);

    const move = buildPlan([report], { [finding.id]: { kind: "accept", start: "08:11", end: "", nonProEditType: "move_next_in" } });
    assert.equal(move.edits[0]?.nonPro?.rows[0]?.newClockIn, "08:11");
    assert.equal(move.edits[0]?.nonPro?.keptClockIn, "08:00");
    assert.equal(move.edits[0]?.nonPro?.keptClockOut, "08:10");
    assert.equal(move.edits[0]?.minutes, 49);

    const bumped = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "08:21", nonProEditType: "split", split: "08:20" } });
    assert.equal(bumped.edits[0]?.nonPro?.rows[0]?.newClockOut, "08:20");
    assert.equal(bumped.edits[0]?.nonPro?.rows[1]?.newClockIn, "08:21");
    assert.equal(bumped.edits[0]?.nonPro?.keptClockIn, undefined);
    assert.equal(bumped.edits[0]?.minutes, 59);

    const gap = buildPlan([report], { [finding.id]: { kind: "accept", start: "", end: "08:40", nonProEditType: "split", split: "08:20" } });
    assert.equal(gap.edits[0]?.nonPro?.keptClockIn, "08:21");
    assert.equal(gap.edits[0]?.nonPro?.keptClockOut, "08:39");
    assert.equal(gap.edits[0]?.minutes, 40);

    const both = defaultKeptWindow("08:00", "09:00", "both");
    assert.ok(both);
    const partial = buildPlan([report], {
      [finding.id]: { kind: "accept", start: both.start, end: both.end, nonProEditType: "partial", nonProRemainder: "both" },
    });
    assert.equal(partial.edits[0]?.nonPro?.rows[0]?.orderId, "D-10");
    assert.equal(partial.edits[0]?.nonPro?.rows[1]?.orderId, "M-20");
    assert.equal(partial.edits[0]?.nonPro?.keptClockIn, both.start);
    assert.equal(partial.edits[0]?.nonPro?.keptClockOut, both.end);
    assert.ok((partial.edits[0]?.minutes ?? 0) > 0);
    assert.ok((partial.edits[0]?.minutes ?? 60) < 60);

    const moved = buildPlan([report], { [finding.id]: { kind: "accept", start: "08:00", end: "08:20", nonProEditType: "move_to_so", targetOrderId: "S-55" } });
    assert.equal(moved.edits[0]?.nonPro?.rows[0]?.newClockIn, "08:00");
    assert.equal(moved.edits[0]?.nonPro?.rows[0]?.newClockOut, "08:20");
    assert.equal(moved.edits[0]?.nonPro?.keptClockIn, "08:21");
    assert.equal(moved.edits[0]?.minutes, 20);

    const outside = buildPlan([report], { [finding.id]: { kind: "accept", start: "08:30", end: "09:30", nonProEditType: "move_to_so", targetOrderId: "S-55" } });
    assert.match(outside.invalid[0]?.error ?? "", /inside/);
    const early = buildPlan([report], { [finding.id]: { kind: "accept", start: "07:30", end: "", nonProEditType: "move_next_in" } });
    assert.match(early.invalid[0]?.error ?? "", /inside/);

    const outlook = techOutlook(report, report.technicians[0]!, { [finding.id]: { kind: "accept", start: "08:11", end: "", nonProEditType: "move_next_in" } });
    assert.equal(outlook.choiceMinutes, 49);

    finding.nonPro?.punches.push({ orderId: "M-77", work: "Overlap", shopId: "mobile", clockIn: "08:15", clockOut: "08:25" });
    const foreign = buildPlan([report], { [finding.id]: { kind: "accept", start: "08:00", end: "09:00", nonProEditType: "move_to_so", targetOrderId: "S-55" } });
    assert.match(foreign.invalid[0]?.error ?? "", /Mobile M-77/);
  });
});

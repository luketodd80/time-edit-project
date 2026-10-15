import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAdminPayload } from "@/lib/admin";
import { OCTOBER_14_REPORTS, timesheetToDayReports, type FullbayTimesheetRow } from "@/lib/fullbay-timesheet";
import { submissionToQueueRequest, suggestionsNeedingDecision } from "@/lib/fullbay-edit-queue";
import { applyForgotHours, forgotTimeError, isForgottenEnd } from "@/lib/forgot-clock-out";
import { buildPlan, countedHoursForTech, requiredDecisionFindingIds } from "@/lib/review";
import { submitWebhookPayload } from "@/lib/submit-webhook";
import { snapshotFromReports } from "@/lib/utilization-history";
import type { Decision } from "@/lib/types";

const day = "2026-10-14";

function row(overrides: Partial<FullbayTimesheetRow> & Pick<FullbayTimesheetRow, "employee">): FullbayTimesheetRow {
  return {
    shop: "The Service Company - Dayton (D)",
    clock_in: "8:00:00AM 10/14/2026",
    clock_in_activity: "Inactive",
    clock_out: "9:00:00AM 10/14/2026",
    hours: 1,
    so_complaint: "",
    comment: "",
    open_punch: false,
    ...overrides,
  };
}

function zachReport() {
  const report = OCTOBER_14_REPORTS.find((item) => item.shopId === "dayton");
  assert.ok(report);
  const tech = report.technicians.find((item) => item.id === "zach-spencer");
  const finding = report.findings.find((item) => item.techId === "zach-spencer" && item.forgotClockOut);
  assert.ok(tech);
  assert.ok(finding?.forgotClockOut);
  return { report, tech, finding, info: finding.forgotClockOut };
}

describe("forgotten clock-out", () => {
  it("flags Zach Spencer in Dayton on October 14 because D-88889 runs to midnight", () => {
    const { tech, finding, info } = zachReport();
    assert.equal(tech.clockedHours, 15.92);
    assert.equal(tech.soHours, 15.83);
    assert.equal(finding.suggested, "Likely forgot to clock out");
    assert.equal(info.order?.orderId, "D-88889");
    assert.equal(info.order?.work, "Replace engine");
    assert.equal(info.order?.clockOut, "23:59");
    assert.equal(info.order?.hours, 11.43);
    assert.equal(info.shift?.late, true);
    assert.equal(info.shift?.clockIn, "12:34");
    assert.equal(info.shift?.hours, 11.43);
    assert.equal(info.suggestedEnd, "11:28");
    assert.match(finding.detail, /D-88889/);
    assert.match(finding.detail, /Last other punch ended at 11:28 AM/);
    const ids = requiredDecisionFindingIds(OCTOBER_14_REPORTS, { day, shopId: "dayton" });
    assert.ok(ids.includes(finding.id));
  });

  it("does not flag a 24-hour placeholder or a punch that ends before 11:55 PM", () => {
    assert.equal(isForgottenEnd(23 * 3600 + 54 * 60 + 59), false);
    assert.equal(isForgottenEnd(23 * 3600 + 55 * 60), true);
    assert.equal(isForgottenEnd(24 * 3600), true);
    const reports = timesheetToDayReports({
      date: day,
      rows: [
        row({
          employee: "Travis Hess",
          clock_in: "12:00:00AM 10/14/2026",
          clock_out: "12:00:00AM 10/15/2026",
          hours: 24,
          clock_in_activity: "Inactive",
        }),
        row({
          employee: "Ada Lovelace",
          clock_in: "8:00:00AM 10/14/2026",
          clock_out: "11:54:00PM 10/14/2026",
          hours: 15.9,
        }),
        row({
          employee: "Ada Lovelace",
          clock_in: "8:05:00AM 10/14/2026",
          clock_out: "11:54:00PM 10/14/2026",
          hours: 15.8,
          so_complaint: "D-100 / Replace hose",
        }),
        row({
          employee: "Grace Hopper",
          clock_in: "8:00:00AM 10/14/2026",
          clock_out: "11:55:00PM 10/14/2026",
          hours: 15.92,
        }),
        row({
          employee: "Grace Hopper",
          clock_in: "8:05:00AM 10/14/2026",
          clock_out: "4:00:00PM 10/14/2026",
          hours: 7.92,
          so_complaint: "D-200 / Earlier job",
        }),
        row({
          employee: "Grace Hopper",
          clock_in: "4:05:00PM 10/14/2026",
          clock_out: "11:55:00PM 10/14/2026",
          hours: 7.83,
          so_complaint: "D-201 / Late job",
        }),
      ],
    });
    const names = reports.flatMap((report) => report.technicians.map((tech) => tech.name));
    assert.equal(names.includes("Travis Hess"), false);
    const ada = reports.flatMap((report) => report.findings).find((finding) => finding.techId === "ada-lovelace" && finding.forgotClockOut);
    assert.equal(ada, undefined);
    const grace = reports.flatMap((report) => report.findings).find((finding) => finding.techId === "grace-hopper" && finding.forgotClockOut);
    assert.ok(grace?.forgotClockOut);
    assert.equal(grace.forgotClockOut.order?.orderId, "D-201");
    assert.equal(grace.forgotClockOut.suggestedEnd, "16:00");
  });

  it("stays undecided until both times are valid or the flag is rejected", () => {
    const { report, finding, info } = zachReport();
    const open = suggestionsNeedingDecision([report], {}, []);
    assert.ok(open.some((edit) => edit.findingId === finding.id));

    const partial: Decision = { kind: "override", start: "", end: "", shiftClockOut: "17:00", soClockOut: "" };
    assert.ok(suggestionsNeedingDecision([report], { [finding.id]: partial }, []).some((edit) => edit.findingId === finding.id));
    assert.equal(forgotTimeError(info, "11:28", "11:28"), "Shift clock-out has to be after the 12:34 PM clock-in.");

    const tooLate: Decision = { kind: "override", start: "", end: "", shiftClockOut: "23:55", soClockOut: "17:00" };
    assert.ok(suggestionsNeedingDecision([report], { [finding.id]: tooLate }, []).some((edit) => edit.findingId === finding.id));

    const corrected: Decision = { kind: "override", start: "", end: "", shiftClockOut: "17:00", soClockOut: "16:30" };
    assert.equal(
      suggestionsNeedingDecision([report], { [finding.id]: corrected }, []).some((edit) => edit.findingId === finding.id),
      false,
    );
    const rejected: Decision = { kind: "reject", start: "", end: "" };
    assert.equal(
      suggestionsNeedingDecision([report], { [finding.id]: rejected }, []).some((edit) => edit.findingId === finding.id),
      false,
    );

    const plan = buildPlan([report], { [finding.id]: corrected });
    const edit = plan.edits.find((item) => item.findingId === finding.id);
    assert.ok(edit?.corrections);
    assert.deepEqual(
      edit.corrections.map((correction) => correction.type),
      ["clock_out", "so_out"],
    );
    const queued = submissionToQueueRequest({
      submittedAt: "2026-10-15T16:00:00.000Z",
      shopId: "dayton",
      days: [day],
      edits: [edit],
      rejected: [],
      undecided: [],
      skipped: [],
    });
    const payload = submitWebhookPayload({
      id: "batch-forgot",
      submittedAt: queued.submittedAt,
      shopId: queued.shopId,
      days: queued.days,
      edits: queued.edits.map((item) => ({ ...item, status: "pending" as const, appliedAt: null, applyNote: null })),
    });
    assert.deepEqual(payload.edits[0]?.corrections, [
      { type: "clock_out", tech: "Zach Spencer", so: "", oldTime: "23:59", newTime: "17:00" },
      { type: "so_out", tech: "Zach Spencer", so: "D-88889", oldTime: "23:59", newTime: "16:30" },
    ]);
  });

  it("leaves the midnight hours out until corrected, then uses the new times", () => {
    const { report, tech, finding, info } = zachReport();
    const pending = countedHoursForTech(report, tech, {});
    assert.equal(pending.clockedHours, 4.49);
    assert.equal(pending.soHours, 4.4);
    assert.equal(pending.pendingClockedHours, 11.43);
    assert.equal(pending.pendingSoHours, 11.43);

    const corrected: Decision = { kind: "override", start: "", end: "", shiftClockOut: "17:00", soClockOut: "17:00" };
    const after = countedHoursForTech(report, tech, { [finding.id]: corrected });
    assert.equal(after.pendingClockedHours, 0);
    assert.equal(after.clockedHours, applyForgotHours(tech.clockedHours, tech.soHours, info, { shiftOut: "17:00", soOut: "17:00" }).clockedHours);
    assert.equal(after.clockedHours, 8.92);
    assert.equal(after.soHours, 8.83);

    const rejected = countedHoursForTech(report, tech, { [finding.id]: { kind: "reject", start: "", end: "" } });
    assert.equal(rejected.clockedHours, 15.92);
    assert.equal(rejected.soHours, 15.83);
    assert.equal(rejected.pendingClockedHours, 0);

    const snapshot = snapshotFromReports([report], []);
    const saved = snapshot[0]?.techs.find((item) => item.id === "zach-spencer");
    assert.equal(saved?.clockedHours, 4.49);
    assert.equal(saved?.soHours, 4.4);

    const admin = buildAdminPayload({
      today: "2026-10-15",
      start: day,
      end: day,
      reports: [report],
      batches: [],
      signoffs: [],
      history: snapshot,
    });
    const cell = admin.grid.shops.find((shop) => shop.id === "dayton")?.cells.find((item) => item.day === day);
    const line = cell?.lines.find((item) => item.tech === "Zach Spencer" && item.forgotClockOut);
    assert.ok(line);
    assert.equal(line.order, "D-88889");
    assert.equal(line.excluded, true);
    assert.match(line.note, /not counted until corrected/);
    assert.match(cell?.detail ?? "", /forgot clock-out/);
  });
});

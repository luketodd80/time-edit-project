import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { FRIDAY_DETAILS_CSV } from "@/lib/friday-details-csv";
import { SATURDAY_DETAILS_CSV } from "@/lib/saturday-details-csv";
import { MONDAY_DETAILS_CSV } from "@/lib/monday-details-csv";
import {
  FOREMEN,
  OCTOBER_2_REPORTS,
  OCTOBER_3_REPORTS,
  OCTOBER_5_REPORTS,
  OPEN_PUNCH_NOTE,
  isForeman,
  parseDetailsListCsv,
  shopIdForTimesheetShop,
  timesheetToDayReports,
  type FullbayTimesheetRow,
} from "@/lib/fullbay-timesheet";
import { SEED } from "@/lib/seed";
import type { DayReport } from "@/lib/types";

const monday = "2026-10-05";

function row(overrides: Partial<FullbayTimesheetRow> & Pick<FullbayTimesheetRow, "employee">): FullbayTimesheetRow {
  return {
    shop: "The Service Company - Dayton (D)",
    clock_in: "8:00:00AM 10/5/2026",
    clock_in_activity: "Inactive",
    clock_out: "9:00:00AM 10/5/2026",
    hours: 1,
    so_complaint: "",
    comment: "",
    open_punch: false,
    ...overrides,
  };
}

function names(shopId: string): string[] {
  return (OCTOBER_5_REPORTS.find((report) => report.shopId === shopId)?.technicians ?? []).map((tech) => tech.name).sort();
}

describe("foreman filter", () => {
  it("matches the named foremen case-insensitively and ignores extra whitespace", () => {
    assert.deepEqual([...FOREMEN], ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal"]);
    assert.equal(isForeman("  kevin   neal "), true);
    assert.equal(isForeman("THOMAS FLORA"), true);
    assert.equal(isForeman("Isaac  Stockslager"), true);
    assert.equal(isForeman("james benedict"), true);
    assert.equal(isForeman("Cole Lozan"), false);
  });

  it("drops every named foreman even when that person has service-order time", () => {
    const reports = timesheetToDayReports({
      date: monday,
      rows: [
        row({ employee: " Thomas Flora ", so_complaint: "D-1 / Replace turbo" }),
        row({ employee: "JAMES BENEDICT", shop: "The Service Company - Columbus (CL)", so_complaint: "CL-2 / Replace hood" }),
        row({ employee: "Isaac  Stockslager", shop: "The Service Company - Greenville (G)", so_complaint: "G-3 / QC" }),
        row({ employee: "Kevin Neal", shop: "The Service Company - Covington (C)", so_complaint: "C-4 / Diagnose" }),
        row({ employee: "Ada Lovelace", so_complaint: "D-100 / Replace hose" }),
      ],
    });
    const techs = reports.flatMap((report) => report.technicians.map((tech) => tech.name));
    assert.deepEqual(techs, ["Ada Lovelace"]);
  });
});

describe("timesheet conversion rules", () => {
  it("drops techs with no service-order time and skips unknown shops", () => {
    const reports = timesheetToDayReports({
      date: monday,
      rows: [
        row({ employee: "Only Clock" }),
        row({ employee: "Lima Person", shop: "The Service Company - Lima (L)", so_complaint: "L-1 / Something" }),
        row({ employee: "Ada Lovelace", clock_in: "8:00:00AM 10/5/2026", clock_out: "9:00:00AM 10/5/2026", hours: 1 }),
        row({
          employee: "Ada Lovelace",
          clock_in: "8:20:00AM 10/5/2026",
          clock_out: "9:00:00AM 10/5/2026",
          hours: 0.67,
          so_complaint: "D-100 / Replace hose",
        }),
      ],
    });
    assert.equal(shopIdForTimesheetShop("The Service Company - Lima (L)"), null);
    assert.equal(shopIdForTimesheetShop("The Service Company-Mobile Units (M)"), "mobile");
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.technicians.length, 1);
    assert.equal(reports[0]?.technicians[0]?.name, "Ada Lovelace");
    assert.equal(reports[0]?.technicians[0]?.soHours, 0.67);
    const gap = reports[0]?.findings.find((finding) => finding.kind === "gap");
    assert.equal(gap?.recommendation?.orderId, "D-100");
    assert.equal(gap?.recommendation?.work, "Replace hose");
    assert.match(gap?.recommendation?.summary ?? "", /no service order/i);
  });

  it("flags a billable note with no service order and does not attach it to another order", () => {
    const reports = timesheetToDayReports({
      date: monday,
      rows: [
        row({
          employee: "Grace Hopper",
          shop: "The Service Company - Springfield (S)",
          clock_in: "9:00:00AM 10/5/2026",
          clock_out: "9:45:00AM 10/5/2026",
          clock_in_activity: "Normal Non Pro",
          hours: 0.75,
          comment: "plugging tire for mansfield",
        }),
        row({
          employee: "Grace Hopper",
          shop: "The Service Company - Springfield (S)",
          clock_in: "9:45:00AM 10/5/2026",
          clock_out: "11:00:00AM 10/5/2026",
          hours: 1.25,
        }),
        row({
          employee: "Grace Hopper",
          shop: "The Service Company - Springfield (S)",
          clock_in: "9:45:00AM 10/5/2026",
          clock_out: "11:00:00AM 10/5/2026",
          hours: 1.25,
          so_complaint: "S-200 / Replace turbo",
        }),
      ],
    });
    const flag = reports[0]?.findings.find((finding) => finding.kind === "flag");
    assert.equal(flag?.recommendation, null);
    assert.match(flag?.suggested ?? "", /plugging tire/);
    assert.match(flag?.detail ?? "", /Normal Non Pro/);
    const work = reports[0]?.findings.find((finding) => finding.kind === "as_is");
    assert.match(work?.detail ?? "", /S-200 \/ Replace turbo/);
  });

  it("keeps an open service-order segment without calling the elapsed end a clock-out", () => {
    const reports = timesheetToDayReports({
      date: monday,
      rows: [
        row({
          employee: "Open Tech",
          shop: "The Service Company - Covington (C)",
          clock_in: "10:00:00AM 10/5/2026",
          clock_out: "",
          hours: 1,
          open_punch: true,
        }),
        row({
          employee: "Open Tech",
          shop: "The Service Company - Covington (C)",
          clock_in: "10:00:00AM 10/5/2026",
          clock_out: "10:30:00AM 10/5/2026",
          hours: 0.5,
          so_complaint: "C-300 / Check brakes",
        }),
        row({
          employee: "Open Tech",
          shop: "The Service Company - Covington (C)",
          clock_in: "10:30:00AM 10/5/2026",
          clock_out: "",
          hours: 0.5,
          so_complaint: "C-300 / Check brakes",
          open_punch: true,
        }),
      ],
    });
    const open = reports[0]?.findings.find((finding) => finding.detail.includes(OPEN_PUNCH_NOTE));
    assert.equal(open?.kind, "as_is");
    assert.equal(open?.recommendation, null);
    assert.match(open?.suggested ?? "", /Still clocked/);
    assert.doesNotMatch(open?.detail ?? "", /clocked out/i);
    assert.equal(reports[0]?.technicians[0]?.clockedHours, 1);
    assert.equal(reports[0]?.technicians[0]?.soHours, 1);
  });

  it("does not recommend a gap where an earlier service order already covers the next punch", () => {
    const reports = timesheetToDayReports({
      date: monday,
      rows: [
        row({
          employee: "Span Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "8:00:00AM 10/5/2026",
          clock_out: "8:30:00AM 10/5/2026",
          hours: 0.5,
        }),
        row({
          employee: "Span Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "8:10:00AM 10/5/2026",
          clock_out: "9:30:00AM 10/5/2026",
          hours: 1.33,
          so_complaint: "S-12 / Diagnose",
        }),
        row({
          employee: "Span Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "8:30:00AM 10/5/2026",
          clock_out: "10:00:00AM 10/5/2026",
          hours: 1.5,
        }),
        row({
          employee: "Span Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "9:30:00AM 10/5/2026",
          clock_out: "10:00:00AM 10/5/2026",
          hours: 0.5,
          so_complaint: "S-13 / Replace hose",
        }),
      ],
    });
    const findings = reports[0]?.findings ?? [];
    assert.equal(
      findings.some((finding) => finding.kind === "gap" && finding.start === "08:30"),
      false,
    );
    assert.ok(findings.some((finding) => finding.kind === "as_is" && finding.detail.includes("S-12 / Diagnose") && finding.end === "09:30"));
    assert.ok(findings.some((finding) => finding.kind === "as_is" && finding.detail.includes("S-13 / Replace hose")));
  });

  it("treats a shop meeting as a gap toward the nearest order, not a billable flag", () => {
    const reports = timesheetToDayReports({
      date: monday,
      rows: [
        row({
          employee: "Meet Tech",
          shop: "The Service Company - Greenville (G)",
          clock_in: "8:00:00AM 10/5/2026",
          clock_out: "8:40:00AM 10/5/2026",
          clock_in_activity: "Shop Meeting",
          hours: 0.67,
        }),
        row({
          employee: "Meet Tech",
          shop: "The Service Company - Greenville (G)",
          clock_in: "8:40:00AM 10/5/2026",
          clock_out: "10:00:00AM 10/5/2026",
          hours: 1.33,
        }),
        row({
          employee: "Meet Tech",
          shop: "The Service Company - Greenville (G)",
          clock_in: "8:40:00AM 10/5/2026",
          clock_out: "10:00:00AM 10/5/2026",
          hours: 1.33,
          so_complaint: "G-400 / QC",
        }),
      ],
    });
    const meeting = reports[0]?.findings.find((finding) => finding.detail.includes("Shop Meeting"));
    assert.equal(meeting?.kind, "gap");
    assert.equal(meeting?.recommendation?.orderId, "G-400");
  });
});

describe("October 5 download", () => {
  it("keeps the Monday Details List download", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-05.csv", "utf8");
    assert.equal(csv, MONDAY_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, monday);
    assert.equal(file.date, monday);
    assert.equal(file.rows.length, 343);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 106);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 67);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 64);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 52);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 37);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 17);
    const coleOut = file.rows.find(
      (record) => record.employee === "Cole Lozan" && record.clock_in.startsWith("8:41:13AM") && !record.so_complaint,
    );
    assert.equal(coleOut?.clock_out, "5:00:49PM 10/5/2026");
    assert.equal(coleOut?.open_punch, false);
    const jacob = file.rows.find((record) => record.employee === "Jacob Griffith" && record.hours === 24);
    assert.equal(jacob?.clock_in, "12:00:00AM 10/5/2026");
    assert.equal(jacob?.clock_out, "12:00:00AM 10/6/2026");
    assert.equal(jacob?.clock_in_activity, "Inactive");
    assert.equal(jacob?.so_complaint, "");
    assert.equal(jacob?.open_punch, false);
    assert.equal(
      file.rows.some((record) => record.clock_out.length === 0),
      false,
    );
  });

  it("builds one Monday report per shop in the file, without foremen or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_5_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_5_REPORTS.every((report) => report.day === monday));
    assert.deepEqual(names("dayton"), ["Brayden Mapp", "Colby Purvis", "Cole Lozan", "Dakota Stone", "Tanveer Dhaliwal", "Zach Spencer"]);
    assert.deepEqual(names("covington"), ["Anthony Montgomery", "Cline Wirick", "Dane Shelton", "Joe Hueber", "Oliver Todd"]);
    assert.deepEqual(names("greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman", "Paul Henry"]);
    assert.deepEqual(names("springfield"), ["Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(names("mobile"), ["Chris Clark"]);
    assert.deepEqual(names("columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);

    const techs = OCTOBER_5_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 25);
    for (const tech of techs) {
      assert.equal(isForeman(tech.name), false);
      assert.ok(tech.soHours > 0);
      assert.ok(tech.clockedHours + 0.05 >= tech.soHours);
    }
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Jacob Griffith", "Josh Silva-holley", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_5_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            gaps: report.findings.filter((finding) => finding.kind === "gap").length,
          },
        ]),
      ),
      {
        dayton: { techs: 6, findings: 61, gaps: 4 },
        covington: { techs: 5, findings: 62, gaps: 10 },
        greenville: { techs: 6, findings: 89, gaps: 10 },
        springfield: { techs: 3, findings: 33, gaps: 9 },
        mobile: { techs: 1, findings: 14, gaps: 2 },
        columbus: { techs: 4, findings: 41, gaps: 2 },
      },
    );
  });

  it("reviews Cole from the Monday download and drops the 24-hour placeholders", () => {
    const dayton = OCTOBER_5_REPORTS.find((report) => report.shopId === "dayton");
    assert.ok(dayton);
    const cole = dayton.technicians.find((tech) => tech.id === "cole-lozan");
    assert.equal(cole?.clockedHours, 10.19);
    assert.equal(cole?.soHours, 9.98);
    const gap = dayton.findings.find((finding) => finding.techId === "cole-lozan" && finding.kind === "gap");
    assert.equal(gap?.start, "08:14");
    assert.equal(gap?.end, "08:26");
    assert.equal(gap?.minutes, 12);
    assert.equal(gap?.recommendation?.orderId, "D-90228");
    assert.match(gap?.detail ?? "", /Clock In Comment: “Move Garber farm off trailer”/);

    const zach = dayton.findings.filter((finding) => finding.techId === "zach-spencer");
    assert.ok(zach.some((finding) => finding.kind === "as_is" && finding.detail.includes("D-90148")));
    assert.equal(
      zach.some((finding) => finding.kind === "gap" || finding.kind === "flag"),
      false,
    );

    const mike = OCTOBER_5_REPORTS.find((report) => report.shopId === "springfield")?.findings.find(
      (finding) => finding.techId === "mike-wooten" && finding.kind === "gap",
    );
    assert.equal(mike?.start, "12:03");
    assert.equal(mike?.end, "13:32");
    assert.match(mike?.detail ?? "", /Clock In Comment: “pick up unit”/);
    assert.equal(mike?.detail.includes(OPEN_PUNCH_NOTE), false);
    assert.equal(
      OCTOBER_5_REPORTS.some((report) => report.findings.some((finding) => finding.detail.includes(OPEN_PUNCH_NOTE))),
      false,
    );
  });

  it("keeps Monday orders on priorities and points every edit at an order on that shop", () => {
    assertReportShape(OCTOBER_5_REPORTS);
  });
});

function namesOn(reports: DayReport[], shopId: string): string[] {
  return (reports.find((report) => report.shopId === shopId)?.technicians ?? []).map((tech) => tech.name).sort();
}

function assertReportShape(reports: DayReport[]) {
  const techs = reports.flatMap((report) => report.technicians);
  for (const tech of techs) {
    assert.equal(isForeman(tech.name), false);
    assert.ok(tech.soHours > 0);
    assert.ok(tech.clockedHours + 0.05 >= tech.soHours);
  }
  for (const report of reports) {
    const ids = report.orders.map((order) => order.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(report.orders.every((order) => order.status === "priorities" && order.shopId === report.shopId));
    assert.ok(report.findings.length > 0);
    for (const finding of report.findings) {
      assert.ok(report.technicians.some((tech) => tech.id === finding.techId));
      assert.ok(finding.start <= finding.end);
      if (!finding.recommendation) continue;
      assert.equal(finding.recommendation.start, finding.start);
      assert.equal(finding.recommendation.end, finding.end);
      assert.equal(finding.recommendation.minutes, finding.minutes);
      assert.ok(report.orders.some((order) => order.id === finding.recommendation?.orderId));
    }
  }
}

describe("October 2 and October 3 downloads", () => {
  it("keeps the Friday and Saturday Details List downloads", () => {
    const fridayCsv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-02.csv", "utf8");
    const saturdayCsv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-03.csv", "utf8");
    assert.equal(fridayCsv, FRIDAY_DETAILS_CSV);
    assert.equal(saturdayCsv, SATURDAY_DETAILS_CSV);
    const friday = parseDetailsListCsv(fridayCsv, "2026-10-02");
    assert.equal(friday.rows.length, 344);
    const cole = friday.rows.find(
      (row) => row.employee === "Cole Lozan" && row.clock_in.startsWith("7:27:38AM") && row.clock_in_activity === "Normal Non Pro",
    );
    assert.equal(cole?.clock_in_comment, "Help Nick");
    assert.equal(cole?.comment, "");
    assert.equal(cole?.so_complaint, "");
    const saturday = parseDetailsListCsv(saturdayCsv, "2026-10-03");
    assert.equal(saturday.rows.length, 31);
    assert.equal(
      saturday.rows.filter((row) => (row.clock_in_comment ?? "").length > 0).length,
      0,
    );
    assert.equal(
      saturday.rows.some((row) => row.employee === "Jacob Griffith" && row.hours === 24),
      true,
    );
  });

  it("sends Help Nick to the named coworker’s overlapping service order", () => {
    const reports = timesheetToDayReports({
      date: monday,
      rows: [
        row({
          employee: "Cole Lozan",
          clock_in: "7:09:00AM 10/5/2026",
          clock_out: "7:26:00AM 10/5/2026",
          hours: 0.28,
        }),
        row({
          employee: "Cole Lozan",
          clock_in: "7:09:00AM 10/5/2026",
          clock_out: "7:26:00AM 10/5/2026",
          hours: 0.28,
          so_complaint: "D-90394 / Unit is in derate",
        }),
        row({
          employee: "Cole Lozan",
          clock_in: "7:27:00AM 10/5/2026",
          clock_out: "8:03:00AM 10/5/2026",
          clock_in_activity: "Normal Non Pro",
          hours: 0.6,
          clock_in_comment: "Help Nick",
        }),
        row({
          employee: "Cole Lozan",
          clock_in: "8:03:00AM 10/5/2026",
          clock_out: "9:23:00AM 10/5/2026",
          hours: 1.33,
        }),
        row({
          employee: "Cole Lozan",
          clock_in: "8:03:00AM 10/5/2026",
          clock_out: "9:23:00AM 10/5/2026",
          hours: 1.33,
          so_complaint: "D-90394 / Unit is in derate",
        }),
        row({
          employee: "Nick Sontag",
          clock_in: "7:08:00AM 10/5/2026",
          clock_out: "11:40:00AM 10/5/2026",
          hours: 4.53,
        }),
        row({
          employee: "Nick Sontag",
          clock_in: "7:08:00AM 10/5/2026",
          clock_out: "9:35:00AM 10/5/2026",
          hours: 2.45,
          so_complaint: "D-89637 / Replace injectors",
        }),
      ],
    });
    const help = reports[0]?.findings.find((finding) => finding.detail.includes("Help Nick"));
    assert.equal(help?.kind, "gap");
    assert.equal(help?.recommendation?.orderId, "D-89637");
    assert.equal(help?.recommendation?.work, "Replace injectors");
    assert.match(help?.detail ?? "", /Clock In Comment: “Help Nick”/);
    assert.match(help?.detail ?? "", /Nick Sontag/);
    assert.match(help?.recommendation?.summary ?? "", /D-89637 Replace injectors/);
  });

  it("keeps a trailing Comment of Help Nick on this tech’s nearest order", () => {
    const reports = timesheetToDayReports({
      date: monday,
      rows: [
        row({
          employee: "Cole Lozan",
          clock_in: "7:09:00AM 10/5/2026",
          clock_out: "7:26:00AM 10/5/2026",
          hours: 0.28,
          so_complaint: "D-90394 / Unit is in derate",
        }),
        row({
          employee: "Cole Lozan",
          clock_in: "7:27:00AM 10/5/2026",
          clock_out: "8:03:00AM 10/5/2026",
          clock_in_activity: "Normal Non Pro",
          hours: 0.6,
          comment: "Help Nick",
        }),
        row({
          employee: "Nick Sontag",
          clock_in: "7:08:00AM 10/5/2026",
          clock_out: "9:35:00AM 10/5/2026",
          hours: 2.45,
          so_complaint: "D-89637 / Replace injectors",
        }),
      ],
    });
    const help = reports[0]?.findings.find((finding) => finding.techId === "cole-lozan" && finding.detail.includes("Help Nick"));
    assert.equal(help?.kind, "gap");
    assert.equal(help?.recommendation?.orderId, "D-90394");
    assert.match(help?.detail ?? "", /Comment: “Help Nick”/);
    assert.doesNotMatch(help?.detail ?? "", /Clock In Comment/);
  });

  it("builds Friday from the Details List download for every shop that has service-order time", () => {
    assert.deepEqual(
      OCTOBER_2_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_2_REPORTS.every((report) => report.day === "2026-10-02"));
    assert.deepEqual(namesOn(OCTOBER_2_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Colby Purvis",
      "Cole Lozan",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_2_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_2_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Kyle Hickman",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_2_REPORTS, "springfield"), ["Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_2_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_2_REPORTS, "columbus"), ["Derek Roby", "Justin Winner", "Stephen Hill"]);
    assert.equal(OCTOBER_2_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 26);
    assert.equal(OCTOBER_2_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 287);
    const springfield = OCTOBER_2_REPORTS.find((report) => report.shopId === "springfield");
    const gary = springfield?.findings.filter((finding) => finding.techId === "gary-evans" && finding.kind === "gap") ?? [];
    const john = springfield?.findings.filter((finding) => finding.techId === "john-spichty" && finding.kind === "gap") ?? [];
    assert.deepEqual(
      gary.map((finding) => [finding.start, finding.end, finding.recommendation?.orderId]),
      [["06:54", "06:57", "S-90485"]],
    );
    assert.deepEqual(
      john.map((finding) => [finding.start, finding.end, finding.recommendation?.orderId]),
      [["11:44", "11:45", "S-90541"]],
    );
    assert.ok(springfield?.findings.some((finding) => finding.techId === "gary-evans" && finding.kind === "as_is" && finding.detail.includes("S-90507 / Check AC") && finding.start === "13:51"));
    assert.ok(springfield?.findings.some((finding) => finding.techId === "gary-evans" && finding.kind === "as_is" && finding.detail.includes("S-90512") && finding.end === "16:30"));
    assert.ok(springfield?.findings.some((finding) => finding.techId === "john-spichty" && finding.kind === "as_is" && finding.detail.includes("install drive line") && finding.start === "07:03" && finding.end === "08:08"));
    assert.ok(springfield?.findings.some((finding) => finding.techId === "john-spichty" && finding.kind === "as_is" && finding.detail.includes("S-90480 / Alignment") && finding.start === "08:09"));
    assert.ok(springfield?.findings.some((finding) => finding.techId === "john-spichty" && finding.kind === "as_is" && finding.detail.includes("S-90541") && finding.start === "11:45"));
    assert.ok(springfield?.findings.some((finding) => finding.techId === "john-spichty" && finding.kind === "as_is" && finding.detail.includes("B service light duty") && finding.start === "13:51"));
    const mobile = OCTOBER_2_REPORTS.find((report) => report.shopId === "mobile");
    const clarkGaps = mobile?.findings.filter((finding) => finding.techId === "chris-clark" && finding.kind === "gap") ?? [];
    assert.deepEqual(
      clarkGaps.map((finding) => [finding.start, finding.end, finding.minutes, finding.recommendation?.orderId]),
      [["07:26", "07:36", 10, "M-90534"]],
    );
    assert.equal(
      mobile?.findings.some((finding) => finding.techId === "chris-clark" && finding.kind === "gap" && finding.start === "07:05" && finding.end === "07:26"),
      false,
    );
    assert.ok(
      mobile?.findings.some(
        (finding) =>
          finding.techId === "chris-clark" &&
          finding.kind === "as_is" &&
          finding.detail.includes("M-90534 / Onsite Travel") &&
          finding.start === "07:05" &&
          finding.end === "07:26",
      ),
    );
    assertReportShape(OCTOBER_2_REPORTS);
    const cole = OCTOBER_2_REPORTS.find((report) => report.shopId === "dayton")?.findings.find(
      (finding) => finding.techId === "cole-lozan" && finding.detail.includes("Help Nick"),
    );
    assert.equal(cole?.kind, "gap");
    assert.equal(cole?.start, "07:28");
    assert.equal(cole?.end, "08:03");
    assert.equal(cole?.minutes, 35);
    assert.equal(cole?.recommendation?.orderId, "D-89637");
    assert.match(cole?.detail ?? "", /Clock In Comment: “Help Nick”/);
    assert.match(cole?.detail ?? "", /Nick Sontag’s overlapping order is D-89637/);
    assert.match(cole?.recommendation?.summary ?? "", /Put this on D-89637/);
    assert.match(cole?.recommendation?.summary ?? "", /Nick Sontag/);
    const tire = OCTOBER_2_REPORTS.find((report) => report.shopId === "dayton")?.findings.find(
      (finding) => finding.techId === "zach-spencer" && finding.detail.includes("plugging tire"),
    );
    assert.equal(tire?.kind, "flag");
    assert.equal(tire?.recommendation, null);
    assert.match(tire?.detail ?? "", /Clock In Comment: “plugging tire for mansfeild”/);
    const loaded = OCTOBER_2_REPORTS.flatMap((report) => report.technicians.map((tech) => tech.name));
    for (const name of ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Jacob Griffith", "Josh Silva-holley", "Travis Hess"]) {
      assert.equal(loaded.includes(name), false);
    }
    assert.equal(
      SEED.some((report) => report.day === "2026-10-02" && report.findings.some((finding) => finding.id === "zach-0629")),
      false,
    );
  });

  it("builds Saturday from the Details List download only for shops with service-order time", () => {
    assert.deepEqual(
      OCTOBER_3_REPORTS.map((report) => report.shopId),
      ["covington", "greenville"],
    );
    assert.ok(OCTOBER_3_REPORTS.every((report) => report.day === "2026-10-03"));
    assert.deepEqual(namesOn(OCTOBER_3_REPORTS, "covington"), ["Cline Wirick", "Kody Peters", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_3_REPORTS, "greenville"), ["Gage Wills", "Jack Eversole", "Paul Henry"]);
    assert.equal(OCTOBER_3_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 6);
    assert.equal(OCTOBER_3_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 22);
    assertReportShape(OCTOBER_3_REPORTS);
    const loaded = OCTOBER_3_REPORTS.flatMap((report) => report.technicians.map((tech) => tech.name));
    for (const name of ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Jacob Griffith", "Josh Silva-holley", "Travis Hess"]) {
      assert.equal(loaded.includes(name), false);
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { FRIDAY_DETAILS_CSV } from "@/lib/friday-details-csv";
import { SATURDAY_DETAILS_CSV } from "@/lib/saturday-details-csv";
import { MONDAY_DETAILS_CSV } from "@/lib/monday-details-csv";
import { TUESDAY_DETAILS_CSV } from "@/lib/tuesday-details-csv";
import { WEDNESDAY_DETAILS_CSV } from "@/lib/wednesday-details-csv";
import { THURSDAY_DETAILS_CSV } from "@/lib/thursday-details-csv";
import { FRIDAY_OCTOBER_9_DETAILS_CSV } from "@/lib/friday-october-9-details-csv";
import { SATURDAY_OCTOBER_10_DETAILS_CSV } from "@/lib/saturday-october-10-details-csv";
import { MONDAY_OCTOBER_12_DETAILS_CSV } from "@/lib/monday-october-12-details-csv";
import { TUESDAY_OCTOBER_13_DETAILS_CSV } from "@/lib/tuesday-october-13-details-csv";
import { WEDNESDAY_OCTOBER_14_DETAILS_CSV } from "@/lib/wednesday-october-14-details-csv";
import { THURSDAY_OCTOBER_15_DETAILS_CSV } from "@/lib/thursday-october-15-details-csv";
import { FRIDAY_OCTOBER_16_DETAILS_CSV } from "@/lib/friday-october-16-details-csv";
import { SATURDAY_OCTOBER_17_DETAILS_CSV } from "@/lib/saturday-october-17-details-csv";
import { MONDAY_OCTOBER_19_DETAILS_CSV } from "@/lib/monday-october-19-details-csv";
import { TUESDAY_OCTOBER_20_DETAILS_CSV } from "@/lib/tuesday-october-20-details-csv";
import { WEDNESDAY_OCTOBER_21_DETAILS_CSV } from "@/lib/wednesday-october-21-details-csv";
import { THURSDAY_OCTOBER_22_DETAILS_CSV } from "@/lib/thursday-october-22-details-csv";
import { FRIDAY_OCTOBER_23_DETAILS_CSV } from "@/lib/friday-october-23-details-csv";
import { SATURDAY_OCTOBER_24_DETAILS_CSV } from "@/lib/saturday-october-24-details-csv";
import { MONDAY_OCTOBER_26_DETAILS_CSV } from "@/lib/monday-october-26-details-csv";
import { TUESDAY_OCTOBER_27_DETAILS_CSV } from "@/lib/tuesday-october-27-details-csv";
import { WEDNESDAY_OCTOBER_28_DETAILS_CSV } from "@/lib/wednesday-october-28-details-csv";
import { THURSDAY_OCTOBER_29_DETAILS_CSV } from "@/lib/thursday-october-29-details-csv";
import { FRIDAY_OCTOBER_30_DETAILS_CSV } from "@/lib/friday-october-30-details-csv";
import {
  FOREMEN,
  OCTOBER_2_REPORTS,
  OCTOBER_3_REPORTS,
  OCTOBER_5_REPORTS,
  OCTOBER_6_REPORTS,
  OCTOBER_7_REPORTS,
  OCTOBER_8_REPORTS,
  OCTOBER_9_REPORTS,
  OCTOBER_10_REPORTS,
  OCTOBER_12_REPORTS,
  OCTOBER_13_REPORTS,
  OCTOBER_14_REPORTS,
  OCTOBER_15_REPORTS,
  OCTOBER_16_REPORTS,
  OCTOBER_17_REPORTS,
  OCTOBER_19_REPORTS,
  OCTOBER_20_REPORTS,
  OCTOBER_21_REPORTS,
  OCTOBER_22_REPORTS,
  OCTOBER_23_REPORTS,
  OCTOBER_24_REPORTS,
  OCTOBER_26_REPORTS,
  OCTOBER_27_REPORTS,
  OCTOBER_28_REPORTS,
  OCTOBER_29_REPORTS,
  OCTOBER_30_REPORTS,
  OPEN_PUNCH_NOTE,
  isForeman,
  parseDetailsListCsv,
  shopIdForOrderId,
  shopIdForTimesheetShop,
  timesheetToDayReports,
  type FullbayTimesheetRow,
} from "@/lib/fullbay-timesheet";
import { requiredDecisionFindingIds } from "@/lib/review";
import { SEED } from "@/lib/seed";
import { formatPercent } from "@/lib/time";
import type { DayReport } from "@/lib/types";

const monday = "2026-10-05";
const tuesday = "2026-10-06";
const wednesday = "2026-10-07";
const thursday = "2026-10-08";
const fridayOctober9 = "2026-10-09";
const saturdayOctober10 = "2026-10-10";
const mondayOctober12 = "2026-10-12";
const tuesdayOctober13 = "2026-10-13";
const wednesdayOctober14 = "2026-10-14";
const thursdayOctober15 = "2026-10-15";
const fridayOctober16 = "2026-10-16";
const saturdayOctober17 = "2026-10-17";
const mondayOctober19 = "2026-10-19";
const tuesdayOctober20 = "2026-10-20";
const wednesdayOctober21 = "2026-10-21";
const thursdayOctober22 = "2026-10-22";
const fridayOctober23 = "2026-10-23";
const saturdayOctober24 = "2026-10-24";
const mondayOctober26 = "2026-10-26";
const tuesdayOctober27 = "2026-10-27";
const wednesdayOctober28 = "2026-10-28";
const thursdayOctober29 = "2026-10-29";
const fridayOctober30 = "2026-10-30";

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
    assert.equal(shopIdForOrderId("D-100"), "dayton");
    assert.equal(shopIdForOrderId("M-10"), "mobile");
    assert.equal(shopIdForOrderId("S-1"), "springfield");
    assert.equal(shopIdForOrderId("C-4"), "covington");
    assert.equal(shopIdForOrderId("G-3"), "greenville");
    assert.equal(shopIdForOrderId("CL-2"), "columbus");
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

describe("October 6 download", () => {
  it("keeps the Tuesday Details List download", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-06.csv", "utf8");
    assert.equal(csv, TUESDAY_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, tuesday);
    assert.equal(file.date, tuesday);
    assert.equal(file.rows.length, 399);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 96);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 89);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 73);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 59);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 48);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 34);
    const josh = file.rows.find((record) => record.employee === "Josh Silva-holley" && record.hours === 24);
    assert.equal(josh?.clock_in, "12:00:00AM 10/6/2026");
    assert.equal(josh?.clock_out, "12:00:00AM 10/7/2026");
    assert.equal(josh?.clock_in_activity, "Inactive");
    const travis = file.rows.find((record) => record.employee === "Travis Hess" && record.hours === 24);
    assert.equal(travis?.clock_in, "12:00:00AM 10/6/2026");
    assert.equal(travis?.clock_out, "12:00:00AM 10/7/2026");
    assert.equal(
      file.rows.some((record) => record.clock_out.length === 0),
      false,
    );
  });

  it("adds Tuesday without replacing Friday, Saturday, or Monday", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(OCTOBER_2_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 287);
    assert.equal(OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 25);
    assert.equal(OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 300);
    assert.equal(
      OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.findings.filter((finding) => finding.kind === "gap").length, 0),
      37,
    );
  });

  it("builds one Tuesday report per shop, without foremen, placeholders, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_6_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_6_REPORTS.every((report) => report.day === tuesday));
    assert.deepEqual(namesOn(OCTOBER_6_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Dakota Stone",
      "Mike Wooten",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_6_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_6_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Kyle Hickman",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_6_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_6_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_6_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    const techs = OCTOBER_6_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 30);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Josh Silva-holley", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_6_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            gaps: report.findings.filter((finding) => finding.kind === "gap").length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 125, gaps: 10 },
        covington: { techs: 6, findings: 90, gaps: 11 },
        greenville: { techs: 6, findings: 67, gaps: 9 },
        springfield: { techs: 4, findings: 64, gaps: 15 },
        mobile: { techs: 2, findings: 38, gaps: 8 },
        columbus: { techs: 4, findings: 30, gaps: 0 },
      },
    );
    assertReportShape(OCTOBER_6_REPORTS);
  });

  it("does not fill waiting or move a clock-in onto a Non-Pro row", () => {
    const paul = OCTOBER_6_REPORTS.find((report) => report.shopId === "greenville")?.findings.find(
      (finding) => finding.techId === "paul-henry" && finding.detail.includes("Waiting on job"),
    );
    assert.equal(paul?.start, "14:17");
    assert.equal(paul?.end, "14:29");
    assert.equal(paul?.recommendation, null);
    assert.match(paul?.suggested ?? "", /stays off billable/);

    const mike = OCTOBER_6_REPORTS.find((report) => report.shopId === "springfield")?.findings.filter(
      (finding) => finding.techId === "mike-wooten",
    );
    const beforeClean = mike?.find((finding) => finding.start === "07:49" && finding.end === "08:04");
    assert.equal(beforeClean?.recommendation?.orderId, "S-90512");
    assert.match(beforeClean?.recommendation?.summary ?? "", /^Keep /);
    assert.match(beforeClean?.recommendation?.summary ?? "", /8:04 AM/);
    const clean = mike?.find((finding) => finding.detail.includes("clean, pick up shop"));
    assert.equal(clean?.recommendation, null);
    assert.equal(clean?.nonPro != null, true);
    assert.match(clean?.suggested ?? "", /Review/);

    const meeting = OCTOBER_6_REPORTS.find((report) => report.shopId === "mobile")?.findings.find(
      (finding) => finding.techId === "jeff-haney" && finding.detail.includes("Shop Meeting"),
    );
    assert.equal(meeting?.recommendation, null);
    assert.equal(meeting?.nonPro != null, true);
    assert.equal((meeting?.suggested ?? "").includes("Start "), false);

    const help = OCTOBER_6_REPORTS.find((report) => report.shopId === "dayton")?.findings.find(
      (finding) => finding.techId === "tanveer-dhaliwal" && finding.detail.includes("helping cole"),
    );
    assert.equal(help?.id, "2026-10-06-dayton-tanveer-dhaliwal-17");
    assert.equal(help?.recommendation, null);
    assert.equal(help?.nonPro != null, true);
  });

  it("extends the earlier service order up to a following Non-Pro punch", () => {
    const reports = timesheetToDayReports({
      date: tuesday,
      rows: [
        row({
          employee: "Gap Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "7:00:00AM 10/6/2026",
          clock_out: "8:00:00AM 10/6/2026",
          hours: 1,
        }),
        row({
          employee: "Gap Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "7:00:00AM 10/6/2026",
          clock_out: "7:10:00AM 10/6/2026",
          hours: 0.17,
          so_complaint: "S-1 / Brakes",
        }),
        row({
          employee: "Gap Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "8:00:00AM 10/6/2026",
          clock_out: "9:00:00AM 10/6/2026",
          hours: 1,
        }),
        row({
          employee: "Gap Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "9:00:00AM 10/6/2026",
          clock_out: "9:15:00AM 10/6/2026",
          clock_in_activity: "Shop Meeting",
          hours: 0.25,
        }),
        row({
          employee: "Gap Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "9:15:00AM 10/6/2026",
          clock_out: "10:00:00AM 10/6/2026",
          hours: 0.75,
        }),
        row({
          employee: "Gap Tech",
          shop: "The Service Company - Springfield (S)",
          clock_in: "9:15:00AM 10/6/2026",
          clock_out: "10:00:00AM 10/6/2026",
          hours: 0.75,
          so_complaint: "S-2 / QC",
        }),
      ],
    });
    const gap = reports[0]?.findings.find((finding) => finding.start === "08:00" && finding.end === "09:00");
    assert.equal(gap?.recommendation?.orderId, "S-1");
    assert.match(gap?.recommendation?.summary ?? "", /^Keep /);
    assert.match(gap?.recommendation?.summary ?? "", /9:00 AM/);
    assert.equal((gap?.recommendation?.summary ?? "").startsWith("Start "), false);
    const meeting = reports[0]?.findings.find((finding) => finding.detail.includes("Shop Meeting"));
    assert.equal(meeting?.recommendation, null);
    assert.equal(meeting?.nonPro?.previous?.orderId, "S-1");
    assert.equal(meeting?.nonPro?.previous?.work, "Brakes");
    assert.equal(meeting?.nonPro?.next?.orderId, "S-2");
    assert.equal(meeting?.nonPro?.canSplit, true);
    assert.equal(gap?.nonPro, undefined);
  });
});

describe("October 7 download", () => {
  it("keeps the Wednesday Details List download", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-07.csv", "utf8");
    assert.equal(csv, WEDNESDAY_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, wednesday);
    assert.equal(file.date, wednesday);
    assert.equal(file.rows.length, 357);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 58);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 64);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 81);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 57);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 60);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 37);
    const josh = file.rows.find((record) => record.employee === "Josh Silva-holley" && record.hours === 24);
    assert.equal(josh?.clock_in, "12:00:00AM 10/7/2026");
    assert.equal(josh?.clock_out, "12:00:00AM 10/8/2026");
    assert.equal(josh?.clock_in_activity, "Inactive");
    const travis = file.rows.find((record) => record.employee === "Travis Hess" && record.hours === 24);
    assert.equal(travis?.clock_in, "12:00:00AM 10/7/2026");
    assert.equal(travis?.clock_out, "12:00:00AM 10/8/2026");
    assert.equal(
      file.rows.some((record) => record.clock_out.length === 0),
      false,
    );
  });

  it("adds Wednesday without replacing Friday, Saturday, Monday, or Tuesday", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(OCTOBER_2_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 287);
    assert.equal(OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 25);
    assert.equal(OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 300);
    assert.equal(
      OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.findings.filter((finding) => finding.kind === "gap").length, 0),
      37,
    );
    assert.equal(OCTOBER_6_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 30);
    assert.equal(OCTOBER_6_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 414);
    assert.equal(
      OCTOBER_6_REPORTS.reduce((sum, report) => sum + report.findings.filter((finding) => finding.kind === "gap").length, 0),
      53,
    );
  });

  it("builds one Wednesday report per shop, without foremen, placeholders, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_7_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_7_REPORTS.every((report) => report.day === wednesday));
    assert.deepEqual(namesOn(OCTOBER_7_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Mike Wooten",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_7_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_7_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Kyle Hickman",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_7_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_7_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_7_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner"]);
    const techs = OCTOBER_7_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 28);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Josh Silva-holley", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_7_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            gaps: report.findings.filter((finding) => finding.kind === "gap").length,
            suggestions: report.findings.filter((finding) => finding.recommendation != null).length,
          },
        ]),
      ),
      {
        dayton: { techs: 7, findings: 66, gaps: 2, suggestions: 2 },
        covington: { techs: 6, findings: 56, gaps: 6, suggestions: 6 },
        greenville: { techs: 6, findings: 71, gaps: 5, suggestions: 4 },
        springfield: { techs: 4, findings: 64, gaps: 17, suggestions: 14 },
        mobile: { techs: 2, findings: 37, gaps: 9, suggestions: 4 },
        columbus: { techs: 3, findings: 34, gaps: 0, suggestions: 0 },
      },
    );
    assertReportShape(OCTOBER_7_REPORTS);
  });

  it("extends the earlier service order up to a following Non-Pro punch and leaves that row alone", () => {
    const john = OCTOBER_7_REPORTS.find((report) => report.shopId === "springfield")?.findings.filter(
      (finding) => finding.techId === "john-spichty",
    );
    const beforeTrash = john?.find((finding) => finding.start === "16:28" && finding.end === "16:29");
    assert.equal(beforeTrash?.recommendation?.orderId, "S-90708");
    assert.match(beforeTrash?.recommendation?.summary ?? "", /^Keep /);
    assert.match(beforeTrash?.recommendation?.summary ?? "", /4:29 PM/);
    const trash = john?.find((finding) => finding.detail.includes("taking out trash putting brass away"));
    assert.equal(trash?.recommendation, null);
    assert.equal(trash?.nonPro != null, true);
    assert.match(trash?.suggested ?? "", /Review/);

    const jeff = OCTOBER_7_REPORTS.find((report) => report.shopId === "mobile")?.findings.filter(
      (finding) => finding.techId === "jeff-haney",
    );
    const beforeMeeting = jeff?.find((finding) => finding.start === "07:13" && finding.end === "07:22");
    assert.equal(beforeMeeting?.recommendation?.orderId, "M-90630");
    assert.match(beforeMeeting?.recommendation?.summary ?? "", /7:22 AM/);
    const meeting = jeff?.find((finding) => finding.detail.includes("Shop Meeting") && finding.start === "07:22");
    assert.equal(meeting?.recommendation, null);
    assert.equal(meeting?.nonPro != null, true);
    assert.match(meeting?.suggested ?? "", /Review/);
  });
});

describe("October 8 download", () => {
  it("keeps the Thursday Details List download, including the two overnight clock-outs", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-08.csv", "utf8");
    assert.equal(csv, THURSDAY_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, thursday);
    assert.equal(file.date, thursday);
    assert.equal(file.rows.length, 287);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 52);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 64);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 74);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 56);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 35);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 6);
    const josh = file.rows.find((record) => record.employee === "Josh Silva-holley" && record.hours === 24);
    assert.equal(josh?.clock_in, "12:00:00AM 10/8/2026");
    assert.equal(josh?.clock_out, "12:00:00AM 10/9/2026");
    assert.equal(josh?.clock_in_activity, "Inactive");
    const travis = file.rows.find((record) => record.employee === "Travis Hess" && record.hours === 24);
    assert.equal(travis?.clock_in, "12:00:00AM 10/8/2026");
    assert.equal(travis?.clock_out, "12:00:00AM 10/9/2026");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/9/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Josh Silva-holley", "Travis Hess"],
    );
    assert.equal(
      file.rows.some((record) => record.clock_out.length === 0),
      false,
    );
  });

  it("adds Thursday without replacing Friday, Saturday, Monday, Tuesday, or Wednesday", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(OCTOBER_2_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 287);
    assert.equal(OCTOBER_7_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 28);
    assert.equal(OCTOBER_7_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 328);
    assert.equal(
      OCTOBER_7_REPORTS.reduce((sum, report) => sum + report.findings.filter((finding) => finding.kind === "gap").length, 0),
      39,
    );
    assert.equal(OCTOBER_6_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 30);
    assert.equal(OCTOBER_6_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 414);
    assert.equal(OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 25);
    assert.equal(OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 300);
  });

  it("builds one Thursday report per shop, without foremen, placeholders, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_8_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_8_REPORTS.every((report) => report.day === thursday));
    assert.deepEqual(namesOn(OCTOBER_8_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Mike Wooten",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_8_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_8_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Kyle Hickman",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_8_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_8_REPORTS, "mobile"), ["Chris Clark"]);
    assert.deepEqual(namesOn(OCTOBER_8_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner"]);
    const techs = OCTOBER_8_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 27);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Josh Silva-holley", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_8_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            gaps: report.findings.filter((finding) => finding.kind === "gap").length,
            suggestions: report.findings.filter((finding) => finding.recommendation != null).length,
          },
        ]),
      ),
      {
        dayton: { techs: 7, findings: 64, gaps: 11, suggestions: 10 },
        covington: { techs: 6, findings: 58, gaps: 5, suggestions: 5 },
        greenville: { techs: 6, findings: 68, gaps: 8, suggestions: 5 },
        springfield: { techs: 4, findings: 64, gaps: 26, suggestions: 17 },
        mobile: { techs: 1, findings: 8, gaps: 1, suggestions: 0 },
        columbus: { techs: 3, findings: 25, gaps: 1, suggestions: 1 },
      },
    );
    assertReportShape(OCTOBER_8_REPORTS);
  });

  it("keeps a foreign-shop punch covered and extends the earlier order up to a following Non-Pro row", () => {
    const john = OCTOBER_8_REPORTS.find((report) => report.shopId === "springfield")?.findings.filter(
      (finding) => finding.techId === "john-spichty",
    );
    const beforeCleanup = john?.find((finding) => finding.start === "10:20" && finding.end === "10:21");
    assert.equal(beforeCleanup?.recommendation?.orderId, "S-90695");
    assert.match(beforeCleanup?.recommendation?.summary ?? "", /^Keep /);
    assert.match(beforeCleanup?.recommendation?.summary ?? "", /10:21 AM/);
    const cleanup = john?.find((finding) => finding.detail.includes("cleaning up moving parts"));
    assert.equal(cleanup?.recommendation, null);
    assert.equal(cleanup?.nonPro != null, true);
    assert.match(cleanup?.suggested ?? "", /Review/);
    const beforeFirstNonPro = john?.find((finding) => finding.start === "07:01" && finding.end === "07:23");
    assert.equal(beforeFirstNonPro?.recommendation, null);
    assert.match(beforeFirstNonPro?.suggested ?? "", /no earlier service order/);

    const clark = OCTOBER_8_REPORTS.find((report) => report.shopId === "dayton")?.findings.find(
      (finding) => finding.techId === "chris-clark" && finding.start === "07:18",
    );
    assert.equal(clark?.notAGap, true);
    assert.match(clark?.detail ?? "", /^Mobile /);
    assert.equal(clark?.recommendation, null);
  });
});

describe("October 9 download", () => {
  it("keeps the Friday October 9 Details List download, including the two overnight clock-outs", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-09.csv", "utf8");
    assert.equal(csv, FRIDAY_OCTOBER_9_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, fridayOctober9);
    assert.equal(file.date, fridayOctober9);
    assert.equal(file.rows.length, 383);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 86);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 103);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 52);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 62);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 53);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 27);
    const josh = file.rows.find((record) => record.employee === "Josh Silva-holley" && record.hours === 24);
    assert.equal(josh?.clock_in, "12:00:00AM 10/9/2026");
    assert.equal(josh?.clock_out, "12:00:00AM 10/10/2026");
    assert.equal(josh?.clock_in_activity, "Inactive");
    const travis = file.rows.find((record) => record.employee === "Travis Hess" && record.hours === 24);
    assert.equal(travis?.clock_in, "12:00:00AM 10/9/2026");
    assert.equal(travis?.clock_out, "12:00:00AM 10/10/2026");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/10/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Josh Silva-holley", "Travis Hess"],
    );
    assert.equal(
      file.rows.some((record) => record.clock_out.length === 0),
      false,
    );
  });

  it("adds Friday October 9 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(OCTOBER_8_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 27);
    assert.equal(OCTOBER_8_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 287);
    assert.equal(OCTOBER_2_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 287);
    assert.equal(OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 25);
    assert.equal(OCTOBER_5_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 300);
  });

  it("builds one Friday October 9 report per shop, without foremen, placeholders, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_9_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_9_REPORTS.every((report) => report.day === fridayOctober9));
    assert.deepEqual(namesOn(OCTOBER_9_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Gage Wills",
      "Kyle Hickman",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_9_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Oliver Todd",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_9_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Jack Eversole", "Kyle Hickman"]);
    assert.deepEqual(namesOn(OCTOBER_9_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_9_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_9_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    const techs = OCTOBER_9_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 29);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Josh Silva-holley", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_9_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            gaps: report.findings.filter((finding) => finding.kind === "gap").length,
            suggestions: report.findings.filter((finding) => finding.recommendation != null).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 96, gaps: 13, suggestions: 7 },
        covington: { techs: 7, findings: 97, gaps: 15, suggestions: 8 },
        greenville: { techs: 4, findings: 47, gaps: 5, suggestions: 4 },
        springfield: { techs: 4, findings: 65, gaps: 19, suggestions: 12 },
        mobile: { techs: 2, findings: 37, gaps: 5, suggestions: 3 },
        columbus: { techs: 4, findings: 41, gaps: 0, suggestions: 0 },
      },
    );
    assertReportShape(OCTOBER_9_REPORTS);
  });

  it("leaves Waiting on job off billable time and does not invent a clock-in before the first Non-Pro", () => {
    const paul = OCTOBER_9_REPORTS.find((report) => report.shopId === "covington")?.findings.find(
      (finding) => finding.techId === "paul-henry" && finding.detail.includes("Waiting on job"),
    );
    assert.equal(paul?.start, "14:02");
    assert.equal(paul?.end, "14:07");
    assert.equal(paul?.recommendation, null);
    assert.match(paul?.suggested ?? "", /stays off billable/);

    const queary = OCTOBER_9_REPORTS.find((report) => report.shopId === "springfield")?.findings.find(
      (finding) => finding.techId === "chris-queary" && finding.start === "07:02" && finding.end === "07:04",
    );
    assert.equal(queary?.recommendation, null);
    assert.match(queary?.suggested ?? "", /no earlier service order/);
    const gettingWork = OCTOBER_9_REPORTS.find((report) => report.shopId === "springfield")?.findings.find(
      (finding) => finding.techId === "chris-queary" && finding.detail.includes("getting work"),
    );
    assert.equal(gettingWork?.recommendation, null);
    assert.equal(gettingWork?.nonPro != null, true);
    assert.match(gettingWork?.suggested ?? "", /Review/);
  });
});

describe("October 10 download", () => {
  it("keeps the Saturday October 10 Details List download, including the two overnight clock-outs", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-10.csv", "utf8");
    assert.equal(csv, SATURDAY_OCTOBER_10_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, saturdayOctober10);
    assert.equal(file.date, saturdayOctober10);
    assert.equal(file.rows.length, 30);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 17);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 12);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 1);
    const josh = file.rows.find((record) => record.employee === "Josh Silva-holley" && record.hours === 24);
    assert.equal(josh?.clock_in, "12:00:00AM 10/10/2026");
    assert.equal(josh?.clock_out, "12:00:00AM 10/11/2026");
    assert.equal(josh?.clock_in_activity, "Inactive");
    assert.equal(josh?.so_complaint, "");
    const travis = file.rows.find((record) => record.employee === "Travis Hess" && record.hours === 24);
    assert.equal(travis?.clock_in, "12:00:00AM 10/10/2026");
    assert.equal(travis?.clock_out, "12:00:00AM 10/11/2026");
    assert.equal(travis?.so_complaint, "");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/11/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Josh Silva-holley", "Travis Hess"],
    );
  });

  it("adds Saturday October 10 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(OCTOBER_9_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 29);
    assert.equal(OCTOBER_9_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 383);
    assert.equal(OCTOBER_2_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 287);
  });

  it("builds Saturday October 10 for the shops with service-order time, without foremen or 24-hour placeholders", () => {
    assert.deepEqual(
      OCTOBER_10_REPORTS.map((report) => report.shopId),
      ["covington", "greenville"],
    );
    assert.ok(OCTOBER_10_REPORTS.every((report) => report.day === saturdayOctober10));
    assert.deepEqual(namesOn(OCTOBER_10_REPORTS, "covington"), ["Kody Peters", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_10_REPORTS, "greenville"), ["Gage Wills"]);
    const techs = OCTOBER_10_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 3);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Josh Silva-holley", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.equal(
      techs.some((tech) => tech.clockedHours >= 24),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_10_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_10_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        covington: { techs: 2, suggestions: 0 },
        greenville: { techs: 1, suggestions: 0 },
      },
    );
    assert.equal(
      OCTOBER_10_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assertReportShape(OCTOBER_10_REPORTS);
  });

  it("excludes a 24-hour clock-in even when that person also has service-order time", () => {
    const reports = timesheetToDayReports({
      date: saturdayOctober10,
      rows: [
        row({
          employee: "Travis Hess",
          shop: "The Service Company - Covington (C)",
          clock_in: "12:00:00AM 10/10/2026",
          clock_out: "12:00:00AM 10/11/2026",
          hours: 24,
          clock_in_activity: "Inactive",
        }),
        row({
          employee: "Travis Hess",
          shop: "The Service Company - Covington (C)",
          clock_in: "8:00:00AM 10/10/2026",
          clock_out: "9:00:00AM 10/10/2026",
          hours: 1,
          so_complaint: "C-1 / Brake job",
        }),
        row({
          employee: "Travis Hess",
          shop: "The Service Company - Covington (C)",
          clock_in: "9:30:00AM 10/10/2026",
          clock_out: "10:00:00AM 10/10/2026",
          hours: 0.5,
          so_complaint: "C-2 / Inspect",
        }),
      ],
    });
    const tech = reports.flatMap((report) => report.technicians).find((item) => item.name === "Travis Hess");
    assert.equal(tech?.clockedHours, 1.5);
    assert.equal(tech?.soHours, 1.5);
    const findings = reports.flatMap((report) => report.findings);
    assert.equal(findings.some((finding) => finding.kind === "gap"), false);
    assert.equal(requiredDecisionFindingIds(reports, { day: saturdayOctober10, shopId: "covington" }).length, 0);
    assert.equal(findings.some((finding) => finding.minutes >= 24 * 60), false);
  });
});

describe("October 12 download", () => {
  it("keeps the Monday October 12 Details List download, including Travis Hess’s overnight clock-out", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-12.csv", "utf8");
    assert.equal(csv, MONDAY_OCTOBER_12_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, mondayOctober12);
    assert.equal(file.date, mondayOctober12);
    assert.equal(file.rows.length, 365);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 105);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 89);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 62);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 49);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 47);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 13);
    const travis = file.rows.find((record) => record.employee === "Travis Hess");
    assert.equal(travis?.clock_in, "12:00:00AM 10/12/2026");
    assert.equal(travis?.clock_out, "12:00:00AM 10/13/2026");
    assert.equal(travis?.hours, 24);
    assert.equal(travis?.clock_in_activity, "Inactive");
    assert.equal(travis?.so_complaint, "");
    assert.equal(
      file.rows.filter((record) => record.employee === "Travis Hess").length,
      1,
    );
  });

  it("adds Monday October 12 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(OCTOBER_10_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 3);
    assert.equal(OCTOBER_9_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 29);
    assert.equal(OCTOBER_9_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 383);
  });

  it("builds one Monday October 12 report per shop, without foremen, the 24-hour placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_12_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_12_REPORTS.every((report) => report.day === mondayOctober12));
    assert.deepEqual(namesOn(OCTOBER_12_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Kyle Hickman",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_12_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_12_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Kyle Hickman",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_12_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_12_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_12_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    const techs = OCTOBER_12_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 30);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.equal(
      techs.some((tech) => tech.clockedHours >= 24),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_12_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_12_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 9, suggestions: 11 },
        covington: { techs: 5, suggestions: 5 },
        greenville: { techs: 6, suggestions: 2 },
        springfield: { techs: 4, suggestions: 14 },
        mobile: { techs: 2, suggestions: 2 },
        columbus: { techs: 4, suggestions: 0 },
      },
    );
    assertReportShape(OCTOBER_12_REPORTS);
  });

  it("counts another shop’s service-order punches as covered and leaves them out of this shop’s clocked hours", () => {
    const dayton = OCTOBER_12_REPORTS.find((report) => report.shopId === "dayton");
    const mobile = OCTOBER_12_REPORTS.find((report) => report.shopId === "mobile");
    const greenville = OCTOBER_12_REPORTS.find((report) => report.shopId === "greenville");
    const clarkDayton = dayton?.technicians.find((tech) => tech.id === "chris-clark");
    const clarkMobile = mobile?.technicians.find((tech) => tech.id === "chris-clark");
    assert.equal(clarkDayton?.soHours, 7.17);
    assert.equal(clarkDayton?.clockedHours, 8.16);
    assert.equal(clarkDayton?.foreignCoveredHours, 1.99);
    assert.equal(clarkMobile?.soHours, 1.99);
    assert.equal(clarkMobile?.clockedHours, 1.99);
    const hickmanDayton = dayton?.technicians.find((tech) => tech.id === "kyle-hickman");
    const hickmanGreenville = greenville?.technicians.find((tech) => tech.id === "kyle-hickman");
    assert.equal(hickmanDayton?.foreignCoveredHours, 2);
    assert.equal(hickmanGreenville?.soHours, 2);
    assert.equal(hickmanGreenville?.clockedHours, 2);
  });
});

describe("October 13 download", () => {
  it("keeps the Tuesday October 13 Details List download, including Travis Hess’s overnight clock-out", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-13.csv", "utf8");
    assert.equal(csv, TUESDAY_OCTOBER_13_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, tuesdayOctober13);
    assert.equal(file.date, tuesdayOctober13);
    assert.equal(file.rows.length, 352);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 89);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 82);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 56);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 55);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 45);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 25);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/13/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/14/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
  });

  it("adds Tuesday October 13 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(OCTOBER_12_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 30);
    assert.equal(
      OCTOBER_12_REPORTS.reduce(
        (sum, report) => sum + requiredDecisionFindingIds(OCTOBER_12_REPORTS, { day: report.day, shopId: report.shopId }).length,
        0,
      ),
      34,
    );
  });

  it("builds one Tuesday October 13 report per shop, without foremen, the 24-hour placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_13_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_13_REPORTS.every((report) => report.day === tuesdayOctober13));
    assert.deepEqual(namesOn(OCTOBER_13_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Colby Purvis",
      "Cole Lozan",
      "Kyle Hickman",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_13_REPORTS, "covington"), [
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_13_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Kyle Hickman",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_13_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_13_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_13_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    const techs = OCTOBER_13_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 28);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.equal(
      techs.some((tech) => tech.clockedHours >= 24),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_13_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_13_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 7, suggestions: 5 },
        covington: { techs: 5, suggestions: 4 },
        greenville: { techs: 6, suggestions: 4 },
        springfield: { techs: 4, suggestions: 14 },
        mobile: { techs: 2, suggestions: 3 },
        columbus: { techs: 4, suggestions: 0 },
      },
    );
    assertReportShape(OCTOBER_13_REPORTS);
  });

  it("keeps a next-day midnight clock-out on the shift and leaves another shop’s order out of these clocked hours", () => {
    const gary = OCTOBER_13_REPORTS.find((report) => report.shopId === "springfield")?.technicians.find((tech) => tech.id === "gary-evans");
    assert.equal(gary?.clockedHours, 16.27);
    assert.equal(gary?.soHours, 16.27);
    const overnight = OCTOBER_13_REPORTS.find((report) => report.shopId === "springfield")?.findings.find(
      (finding) => finding.techId === "gary-evans" && finding.start === "12:32",
    );
    assert.equal(overnight?.kind, "as_is");
    assert.equal(overnight?.end, "23:59");
    assert.equal(overnight?.recommendation, null);

    const dayton = OCTOBER_13_REPORTS.find((report) => report.shopId === "dayton");
    const greenville = OCTOBER_13_REPORTS.find((report) => report.shopId === "greenville");
    const hickmanDayton = dayton?.technicians.find((tech) => tech.id === "kyle-hickman");
    const hickmanGreenville = greenville?.technicians.find((tech) => tech.id === "kyle-hickman");
    assert.equal(hickmanDayton?.soHours, 2.91);
    assert.equal(hickmanDayton?.clockedHours, 2.94);
    assert.equal(hickmanDayton?.foreignCoveredHours, 1.47);
    assert.equal(hickmanGreenville?.soHours, 6.1);
    assert.equal(hickmanGreenville?.clockedHours, 6.12);
  });
});

describe("October 14 download", () => {
  it("keeps the Wednesday October 14 Details List download, including Travis Hess’s overnight clock-out", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-14.csv", "utf8");
    assert.equal(csv, WEDNESDAY_OCTOBER_14_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, wednesdayOctober14);
    assert.equal(file.date, wednesdayOctober14);
    assert.equal(file.rows.length, 382);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 92);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 85);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 80);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 77);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 33);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 15);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/14/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/15/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
  });

  it("adds Wednesday October 14 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(OCTOBER_13_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 28);
    assert.equal(
      OCTOBER_13_REPORTS.reduce(
        (sum, report) => sum + requiredDecisionFindingIds(OCTOBER_13_REPORTS, { day: report.day, shopId: report.shopId }).length,
        0,
      ),
      30,
    );
  });

  it("builds one Wednesday October 14 report per shop, without foremen, the 24-hour placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_14_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_14_REPORTS.every((report) => report.day === wednesdayOctober14));
    assert.deepEqual(namesOn(OCTOBER_14_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_14_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Kyle Hickman",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_14_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Kyle Hickman",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_14_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_14_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_14_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    const techs = OCTOBER_14_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 31);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.equal(
      techs.some((tech) => tech.clockedHours >= 24),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_14_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_14_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 88, suggestions: 7 },
        covington: { techs: 7, findings: 88, suggestions: 7 },
        greenville: { techs: 6, findings: 87, suggestions: 2 },
        springfield: { techs: 4, findings: 34, suggestions: 5 },
        mobile: { techs: 2, findings: 22, suggestions: 2 },
        columbus: { techs: 4, findings: 55, suggestions: 2 },
      },
    );
    assertReportShape(OCTOBER_14_REPORTS);
  });

  it("keeps Zach Spencer’s next-day midnight clock-out on the shift and leaves the 24-hour placeholder out", () => {
    const zach = OCTOBER_14_REPORTS.find((report) => report.shopId === "dayton")?.technicians.find((tech) => tech.id === "zach-spencer");
    assert.equal(zach?.clockedHours, 15.92);
    assert.equal(zach?.soHours, 15.83);
    const overnight = OCTOBER_14_REPORTS.find((report) => report.shopId === "dayton")?.findings.find(
      (finding) => finding.techId === "zach-spencer" && finding.start === "12:34",
    );
    assert.equal(overnight?.kind, "as_is");
    assert.equal(overnight?.end, "23:59");
    assert.equal(overnight?.recommendation, null);
    assert.equal(
      OCTOBER_14_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );

    const covington = OCTOBER_14_REPORTS.find((report) => report.shopId === "covington");
    const greenville = OCTOBER_14_REPORTS.find((report) => report.shopId === "greenville");
    const hickmanCovington = covington?.technicians.find((tech) => tech.id === "kyle-hickman");
    const hickmanGreenville = greenville?.technicians.find((tech) => tech.id === "kyle-hickman");
    assert.equal(hickmanCovington?.soHours, 6.9);
    assert.equal(hickmanCovington?.clockedHours, 7.35);
    assert.equal(hickmanGreenville?.soHours, 1.26);
    assert.equal(hickmanGreenville?.clockedHours, 1.91);
  });
});

describe("October 15 download", () => {
  it("keeps the Thursday October 15 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-15.csv", "utf8");
    assert.equal(csv, THURSDAY_OCTOBER_15_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, thursdayOctober15);
    assert.equal(file.date, thursdayOctober15);
    assert.equal(file.rows.length, 334);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 91);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 71);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 50);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 50);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 49);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 23);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/15/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/16/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
  });

  it("adds Thursday October 15 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(OCTOBER_14_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 31);
    assert.equal(
      OCTOBER_14_REPORTS.reduce(
        (sum, report) => sum + requiredDecisionFindingIds(OCTOBER_14_REPORTS, { day: report.day, shopId: report.shopId }).length,
        0,
      ),
      25,
    );
  });

  it("builds one Thursday October 15 report per shop, without foremen, the 24-hour placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_15_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_15_REPORTS.every((report) => report.day === thursdayOctober15));
    assert.deepEqual(namesOn(OCTOBER_15_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_15_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Cline Wirick",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_15_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_15_REPORTS, "springfield"), [
      "Chris Queary",
      "Gage Wills",
      "Gary Evans",
      "John Spichty",
      "Mike Wooten",
    ]);
    assert.deepEqual(namesOn(OCTOBER_15_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_15_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    const techs = OCTOBER_15_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 29);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.equal(
      techs.some((tech) => tech.clockedHours >= 14),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_15_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_15_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 7, findings: 73, suggestions: 2 },
        covington: { techs: 6, findings: 87, suggestions: 8 },
        greenville: { techs: 5, findings: 42, suggestions: 2 },
        springfield: { techs: 5, findings: 54, suggestions: 6 },
        mobile: { techs: 2, findings: 30, suggestions: 6 },
        columbus: { techs: 4, findings: 42, suggestions: 4 },
      },
    );
    assertReportShape(OCTOBER_15_REPORTS);
  });

  it("counts cross-shop punches as covered and leaves the 24-hour placeholder out", () => {
    assert.equal(
      OCTOBER_15_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    const springfield = OCTOBER_15_REPORTS.find((report) => report.shopId === "springfield");
    const greenville = OCTOBER_15_REPORTS.find((report) => report.shopId === "greenville");
    const dayton = OCTOBER_15_REPORTS.find((report) => report.shopId === "dayton");
    const mobile = OCTOBER_15_REPORTS.find((report) => report.shopId === "mobile");
    const willsSpringfield = springfield?.technicians.find((tech) => tech.id === "gage-wills");
    const willsGreenville = greenville?.technicians.find((tech) => tech.id === "gage-wills");
    assert.equal(willsSpringfield?.soHours, 4.9);
    assert.equal(willsSpringfield?.clockedHours, 5.54);
    assert.equal(willsSpringfield?.foreignCoveredHours, 0.77);
    assert.equal(willsGreenville?.soHours, 4.16);
    assert.equal(willsGreenville?.clockedHours, 4.17);
    const clarkDayton = dayton?.technicians.find((tech) => tech.id === "chris-clark");
    const clarkMobile = mobile?.technicians.find((tech) => tech.id === "chris-clark");
    assert.equal(clarkDayton?.soHours, 6.39);
    assert.equal(clarkDayton?.clockedHours, 6.39);
    assert.equal(clarkMobile?.soHours, 4.07);
    assert.equal(clarkMobile?.clockedHours, 5.04);
    assert.equal(clarkMobile?.foreignCoveredHours, 6.38);
    const sump = springfield?.findings.find((finding) => finding.techId === "gage-wills" && finding.start === "08:32");
    assert.equal(sump?.notAGap, true);
    assert.equal(sump?.recommendation, null);
    assert.equal(sump?.suggested, "Covered by Non-Pro. No edit.");
  });
});

describe("October 16 download", () => {
  it("keeps the Friday October 16 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-16.csv", "utf8");
    assert.equal(csv, FRIDAY_OCTOBER_16_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, fridayOctober16);
    assert.equal(file.date, fridayOctober16);
    assert.equal(file.rows.length, 268);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 75);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 61);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 53);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 40);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 36);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 3);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/16/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/17/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
  });

  it("adds Friday October 16 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(OCTOBER_15_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 29);
    assert.equal(
      OCTOBER_15_REPORTS.reduce(
        (sum, report) => sum + requiredDecisionFindingIds(OCTOBER_15_REPORTS, { day: report.day, shopId: report.shopId }).length,
        0,
      ),
      28,
    );
  });

  it("builds Friday October 16 reports for shops with service-order time, without foremen, the 24-hour placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_16_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_16_REPORTS.every((report) => report.day === fridayOctober16));
    assert.deepEqual(namesOn(OCTOBER_16_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_16_REPORTS, "covington"), [
      "Anthony Montgomery",
      "Dane Shelton",
      "Joe Hueber",
      "Kody Peters",
      "Oliver Todd",
    ]);
    assert.deepEqual(namesOn(OCTOBER_16_REPORTS, "greenville"), [
      "Cody Kester",
      "David Johnson",
      "Gage Wills",
      "Jack Eversole",
      "Kyle Hickman",
      "Paul Henry",
    ]);
    assert.deepEqual(namesOn(OCTOBER_16_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_16_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(OCTOBER_16_REPORTS.some((report) => report.shopId === "mobile"), false);
    const techs = OCTOBER_16_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 26);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.equal(
      techs.some((tech) => tech.clockedHours >= 14),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_16_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_16_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 7, findings: 56, suggestions: 6 },
        covington: { techs: 5, findings: 44, suggestions: 5 },
        greenville: { techs: 6, findings: 75, suggestions: 6 },
        springfield: { techs: 4, findings: 44, suggestions: 13 },
        columbus: { techs: 4, findings: 25, suggestions: 0 },
      },
    );
    assertReportShape(OCTOBER_16_REPORTS);
  });

  it("keeps Dayton service-order time for techs who also punched Mobile, and leaves the 24-hour placeholder out", () => {
    assert.equal(
      OCTOBER_16_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    const dayton = OCTOBER_16_REPORTS.find((report) => report.shopId === "dayton");
    const springfield = OCTOBER_16_REPORTS.find((report) => report.shopId === "springfield");
    const clark = dayton?.technicians.find((tech) => tech.id === "chris-clark");
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    assert.equal(clark?.soHours, 6.41);
    assert.equal(clark?.clockedHours, 7.57);
    assert.equal(clark?.foreignCoveredHours, undefined);
    assert.equal(haney?.soHours, 5.9);
    assert.equal(haney?.clockedHours, 6.52);
    assert.equal(haney?.foreignCoveredHours, undefined);
    assert.equal(
      OCTOBER_16_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "chris-clark" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      OCTOBER_16_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    const meeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "15:24");
    assert.ok(meeting?.nonPro);
    assert.equal(meeting?.recommendation, null);
    const cleanup = springfield?.findings.find((finding) => finding.techId === "mike-wooten" && finding.start === "11:53");
    assert.ok(cleanup?.nonPro);
    assert.equal(cleanup?.end, "15:22");
    assert.equal(cleanup?.recommendation, null);
  });
});

describe("October 17 download", () => {
  it("keeps the Saturday October 17 Details List download, including the two midnight placeholders", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-17.csv", "utf8");
    assert.equal(csv, SATURDAY_OCTOBER_17_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, saturdayOctober17);
    assert.equal(file.date, saturdayOctober17);
    assert.equal(file.rows.length, 16);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 12);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 3);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 1);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/17/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/18/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    const jacob = file.rows.filter((record) => record.employee === "Jacob Griffith");
    assert.equal(jacob.length, 1);
    assert.equal(jacob[0]?.shop, "The Service Company - Dayton (D)");
    assert.equal(jacob[0]?.clock_in, "12:00:00AM 10/17/2026");
    assert.equal(jacob[0]?.clock_out, "12:00:00AM 10/18/2026");
    assert.equal(jacob[0]?.hours, 24);
    assert.equal(jacob[0]?.clock_in_activity, "Inactive");
    assert.equal(jacob[0]?.so_complaint, "");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/18/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess", "Jacob Griffith"],
    );
  });

  it("adds Saturday October 17 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(OCTOBER_16_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 26);
    assert.equal(
      OCTOBER_16_REPORTS.reduce(
        (sum, report) => sum + requiredDecisionFindingIds(OCTOBER_16_REPORTS, { day: report.day, shopId: report.shopId }).length,
        0,
      ),
      30,
    );
  });

  it("builds Saturday October 17 for the shops with service-order time, without foremen, placeholders, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_17_REPORTS.map((report) => report.shopId),
      ["covington", "greenville"],
    );
    assert.ok(OCTOBER_17_REPORTS.every((report) => report.day === saturdayOctober17));
    assert.deepEqual(namesOn(OCTOBER_17_REPORTS, "covington"), ["Joe Hueber", "Kody Peters"]);
    assert.deepEqual(namesOn(OCTOBER_17_REPORTS, "greenville"), ["Kyle Hickman"]);
    assert.equal(OCTOBER_17_REPORTS.some((report) => report.shopId === "dayton"), false);
    assert.equal(OCTOBER_17_REPORTS.some((report) => report.shopId === "springfield"), false);
    assert.equal(OCTOBER_17_REPORTS.some((report) => report.shopId === "columbus"), false);
    assert.equal(OCTOBER_17_REPORTS.some((report) => report.shopId === "mobile"), false);
    const techs = OCTOBER_17_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 3);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess", "Jacob Griffith"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.equal(
      techs.some((tech) => tech.clockedHours >= 14),
      false,
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_17_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_17_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        covington: { techs: 2, findings: 9, suggestions: 0 },
        greenville: { techs: 1, findings: 2, suggestions: 0 },
      },
    );
    const kody = techs.find((tech) => tech.id === "kody-peters");
    const joe = techs.find((tech) => tech.id === "joe-hueber");
    const kyle = techs.find((tech) => tech.id === "kyle-hickman");
    assert.equal(kody?.clockedHours, 5.72);
    assert.equal(kody?.soHours, 5.67);
    assert.equal(joe?.clockedHours, 3.69);
    assert.equal(joe?.soHours, 3.68);
    assert.equal(kyle?.clockedHours, 1.33);
    assert.equal(kyle?.soHours, 1.32);
    assert.equal(
      OCTOBER_17_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_17_REPORTS.some((report) => report.findings.some((finding) => finding.forgotClockOut)),
      false,
    );
    assertReportShape(OCTOBER_17_REPORTS);
  });
});

describe("October 19 download", () => {
  it("keeps the Monday October 19 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-19.csv", "utf8");
    assert.equal(csv, MONDAY_OCTOBER_19_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, mondayOctober19);
    assert.equal(file.date, mondayOctober19);
    assert.equal(file.rows.length, 339);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 107);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 66);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 59);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 57);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 49);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 1);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/19/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/20/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/20/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess", "Nick Sontag", "Nick Sontag"],
    );
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 1);
    assert.equal(mobile[0]?.employee, "Jeff Haney");
    assert.equal(mobile[0]?.clock_in_activity, "Shop Meeting");
    assert.equal(mobile[0]?.so_complaint, "");
  });

  it("adds Monday October 19 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
    assert.equal(OCTOBER_17_REPORTS.reduce((sum, report) => sum + report.technicians.length, 0), 3);
    assert.equal(
      OCTOBER_17_REPORTS.reduce(
        (sum, report) => sum + requiredDecisionFindingIds(OCTOBER_17_REPORTS, { day: report.day, shopId: report.shopId }).length,
        0,
      ),
      0,
    );
  });

  it("builds Monday October 19 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_19_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_19_REPORTS.every((report) => report.day === mondayOctober19));
    assert.deepEqual(namesOn(OCTOBER_19_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_19_REPORTS, "covington"), ["Anthony Montgomery", "Dane Shelton", "Joe Hueber", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_19_REPORTS, "greenville"), ["Cody Kester", "Gage Wills", "Jack Eversole", "Kyle Hickman", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_19_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_19_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(OCTOBER_19_REPORTS.some((report) => report.shopId === "mobile"), false);
    const techs = OCTOBER_19_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 25);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      ["nick-sontag"],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_19_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_19_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 105, suggestions: 14 },
        covington: { techs: 4, findings: 56, suggestions: 7 },
        greenville: { techs: 5, findings: 66, suggestions: 5 },
        springfield: { techs: 4, findings: 66, suggestions: 12 },
        columbus: { techs: 4, findings: 36, suggestions: 2 },
      },
    );
    assert.equal(
      OCTOBER_19_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assertReportShape(OCTOBER_19_REPORTS);
  });

  it("flags Nick Sontag’s midnight clock-out and leaves the Mobile shop meeting off the Dayton board", () => {
    assert.equal(
      OCTOBER_19_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    const dayton = OCTOBER_19_REPORTS.find((report) => report.shopId === "dayton");
    const nick = dayton?.technicians.find((tech) => tech.id === "nick-sontag");
    assert.equal(nick?.clockedHours, 15.94);
    assert.equal(nick?.soHours, 15.92);
    const forgot = dayton?.findings.find((finding) => finding.techId === "nick-sontag" && finding.forgotClockOut);
    assert.equal(forgot?.start, "12:40");
    assert.equal(forgot?.end, "23:59");
    assert.equal(forgot?.forgotClockOut?.suggestedEnd, "11:33");
    assert.equal(forgot?.forgotClockOut?.shift?.late, true);
    assert.equal(forgot?.forgotClockOut?.shift?.hours, 11.34);
    assert.equal(forgot?.forgotClockOut?.order?.orderId, "D-89709");
    assert.equal(forgot?.forgotClockOut?.order?.late, true);
    assert.equal(forgot?.forgotClockOut?.order?.hours, 11.33);
    assert.equal(
      OCTOBER_19_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      1,
    );
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    assert.equal(haney?.soHours, 7.67);
    assert.equal(haney?.clockedHours, 8.4);
    assert.equal(haney?.foreignCoveredHours, undefined);
    assert.equal(
      OCTOBER_19_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "jeff-haney" && finding.start === "07:12"),
      false,
    );
    const coveredMeeting = dayton?.findings.find((finding) => finding.techId === "cole-lozan" && finding.start === "09:21");
    assert.equal(coveredMeeting?.notAGap, true);
    assert.equal(coveredMeeting?.recommendation, null);
    assert.equal(coveredMeeting?.suggested, "Covered by Non-Pro. No edit.");
    const coveredTire = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "15:26");
    assert.equal(coveredTire?.notAGap, true);
    assert.equal(coveredTire?.recommendation, null);
    assert.equal(coveredTire?.suggested, "Covered by Non-Pro. No edit.");
    const helpMove = dayton?.findings.find((finding) => finding.techId === "cole-lozan" && finding.start === "11:26");
    assert.ok(helpMove?.nonPro);
    assert.equal(helpMove?.recommendation, null);
    const clarkMeeting = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "06:59");
    assert.ok(clarkMeeting?.nonPro);
    assert.equal(clarkMeeting?.end, "07:33");
    assert.equal(clarkMeeting?.recommendation, null);
  });
});

describe("October 20 download", () => {
  it("keeps the Tuesday October 20 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-20.csv", "utf8");
    assert.equal(csv, TUESDAY_OCTOBER_20_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, tuesdayOctober20);
    assert.equal(file.date, tuesdayOctober20);
    assert.equal(file.rows.length, 333);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 100);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 84);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 56);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 50);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 42);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 1);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/20/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/21/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/21/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 1);
    assert.equal(mobile[0]?.employee, "Jeff Haney");
    assert.equal(mobile[0]?.clock_in_activity, "Shop Meeting");
    assert.equal(mobile[0]?.so_complaint, "");
    assert.equal(mobile[0]?.hours, 0.02);
  });

  it("adds Tuesday October 20 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
  });

  it("builds Tuesday October 20 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_20_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_20_REPORTS.every((report) => report.day === tuesdayOctober20));
    assert.deepEqual(namesOn(OCTOBER_20_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_20_REPORTS, "covington"), ["Anthony Montgomery", "Dane Shelton", "Joe Hueber", "Kody Peters", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_20_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_20_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_20_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(OCTOBER_20_REPORTS.some((report) => report.shopId === "mobile"), false);
    const techs = OCTOBER_20_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 27);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_20_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_20_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 87, suggestions: 10 },
        covington: { techs: 5, findings: 50, suggestions: 6 },
        greenville: { techs: 6, findings: 82, suggestions: 7 },
        springfield: { techs: 4, findings: 57, suggestions: 16 },
        columbus: { techs: 4, findings: 34, suggestions: 0 },
      },
    );
    assert.equal(
      OCTOBER_20_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_20_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_20_REPORTS);
  });

  it("leaves the Mobile shop meeting off the Dayton board and keeps between-order Non-Pro off the suggestion list", () => {
    assert.equal(
      OCTOBER_20_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    const dayton = OCTOBER_20_REPORTS.find((report) => report.shopId === "dayton");
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    assert.equal(haney?.soHours, 8.48);
    assert.equal(haney?.clockedHours, 9.95);
    assert.equal(
      OCTOBER_20_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "jeff-haney" && finding.start === "06:56"),
      false,
    );
    const haneyMeeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "07:03");
    assert.ok(haneyMeeting?.nonPro);
    assert.equal(haneyMeeting?.recommendation, null);
    const shopClean = dayton?.findings.find((finding) => finding.techId === "tanveer-dhaliwal" && finding.start === "07:01");
    assert.ok(shopClean?.nonPro);
    assert.equal(shopClean?.recommendation, null);
    const coveredTire = dayton?.findings.find((finding) => finding.techId === "nick-sontag" && finding.start === "08:20");
    assert.equal(coveredTire?.notAGap, true);
    assert.equal(coveredTire?.recommendation, null);
    assert.equal(coveredTire?.suggested, "Covered by Non-Pro. No edit.");
    const coveredAfternoon = dayton?.findings.find((finding) => finding.techId === "tanveer-dhaliwal" && finding.start === "13:15");
    assert.equal(coveredAfternoon?.notAGap, true);
    assert.equal(coveredAfternoon?.recommendation, null);
    const coveredMeeting = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "07:13");
    assert.equal(coveredMeeting?.notAGap, true);
    assert.equal(coveredMeeting?.recommendation, null);
    const springfield = OCTOBER_20_REPORTS.find((report) => report.shopId === "springfield");
    const customerCalls = springfield?.findings.filter((finding) => finding.techId === "mike-wooten" && finding.nonPro) ?? [];
    assert.deepEqual(
      customerCalls.map((finding) => finding.start),
      ["11:23", "11:36"],
    );
    const training = springfield?.findings.find((finding) => finding.techId === "chris-queary" && finding.nonPro);
    assert.equal(training?.start, "16:16");
    assert.equal(training?.end, "17:00");
    assert.equal(training?.recommendation, null);
  });
});

describe("October 21 download", () => {
  it("keeps the Wednesday October 21 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-21.csv", "utf8");
    assert.equal(csv, WEDNESDAY_OCTOBER_21_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, wednesdayOctober21);
    assert.equal(file.date, wednesdayOctober21);
    assert.equal(file.rows.length, 302);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 86);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 86);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 48);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 43);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 29);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 10);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/21/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/22/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/22/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const kevin = file.rows.filter((record) => record.employee === "Kevin Neal");
    assert.equal(kevin.length, 1);
    assert.equal(kevin[0]?.so_complaint, "");
    assert.equal(kevin[0]?.hours, 10.52);
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora" && record.so_complaint.trim());
    assert.ok(flora.length > 0);
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 10);
    assert.ok(mobile.some((record) => record.employee === "Jeff Haney" && record.clock_in_activity === "Shop Meeting" && record.so_complaint === ""));
    assert.ok(mobile.some((record) => record.so_complaint.startsWith("M-90671")));
  });

  it("adds Wednesday October 21 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
  });

  it("builds Wednesday October 21 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_21_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_21_REPORTS.every((report) => report.day === wednesdayOctober21));
    assert.deepEqual(namesOn(OCTOBER_21_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_21_REPORTS, "covington"), ["Anthony Montgomery", "Dane Shelton", "Kody Peters", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_21_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_21_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_21_REPORTS, "mobile"), ["Chris Clark", "Jeff Haney"]);
    assert.deepEqual(namesOn(OCTOBER_21_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    const techs = OCTOBER_21_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 28);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_21_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_21_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 83, suggestions: 2 },
        covington: { techs: 4, findings: 42, suggestions: 5 },
        greenville: { techs: 6, findings: 78, suggestions: 7 },
        springfield: { techs: 4, findings: 62, suggestions: 21 },
        mobile: { techs: 2, findings: 31, suggestions: 9 },
        columbus: { techs: 4, findings: 26, suggestions: 1 },
      },
    );
    assert.equal(
      OCTOBER_21_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_21_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_21_REPORTS);
  });

  it("lists Chris Clark and Jeff Haney on Dayton and Mobile and keeps covered Non-Pro off the suggestion list", () => {
    assert.equal(
      OCTOBER_21_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    const dayton = OCTOBER_21_REPORTS.find((report) => report.shopId === "dayton");
    const mobile = OCTOBER_21_REPORTS.find((report) => report.shopId === "mobile");
    const daytonClark = dayton?.technicians.find((tech) => tech.id === "chris-clark");
    const mobileClark = mobile?.technicians.find((tech) => tech.id === "chris-clark");
    assert.equal(daytonClark?.soHours, 4.69);
    assert.equal(daytonClark?.clockedHours, 5.51);
    assert.equal(mobileClark?.soHours, 2.5);
    assert.equal(mobileClark?.clockedHours, 3.19);
    assert.equal(mobileClark?.foreignCoveredHours, 4.7);
    const daytonHaney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    const mobileHaney = mobile?.technicians.find((tech) => tech.id === "jeff-haney");
    assert.equal(daytonHaney?.soHours, 7.99);
    assert.equal(daytonHaney?.clockedHours, 8.81);
    assert.equal(mobileHaney?.soHours, 0.01);
    assert.equal(mobileHaney?.clockedHours, 0.89);
    const clarkMeeting = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "07:06");
    assert.ok(clarkMeeting?.nonPro);
    assert.equal(clarkMeeting?.recommendation, null);
    const haneyMeeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "07:58");
    assert.ok(haneyMeeting?.nonPro);
    assert.equal(haneyMeeting?.recommendation, null);
    const coveredAfternoon = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "13:23");
    assert.equal(coveredAfternoon?.notAGap, true);
    assert.equal(coveredAfternoon?.recommendation, null);
    assert.equal(coveredAfternoon?.suggested, "Covered by Non-Pro. No edit.");
    const mobileMeeting = mobile?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "07:05");
    assert.ok(mobileMeeting?.nonPro);
    assert.equal(mobileMeeting?.recommendation, null);
    const coveredOnMobile = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "07:55");
    assert.equal(coveredOnMobile?.notAGap, true);
    assert.equal(coveredOnMobile?.suggested, "No edit. Covered on the Mobile shop.");
    const greenville = OCTOBER_21_REPORTS.find((report) => report.shopId === "greenville");
    const waitingForJob = greenville?.findings.find((finding) => finding.techId === "gage-wills" && finding.start === "15:17");
    assert.equal(waitingForJob?.notAGap, true);
    assert.equal(waitingForJob?.recommendation, null);
    const gladHand = greenville?.findings.find((finding) => finding.techId === "cody-kester" && finding.start === "13:43");
    assert.equal(gladHand?.notAGap, true);
    assert.equal(gladHand?.recommendation, null);
    const waitingOnJob = greenville?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "15:54");
    assert.equal(waitingOnJob?.recommendation, null);
    assert.equal(waitingOnJob?.nonPro, undefined);
    assert.equal(waitingOnJob?.suggested, "Non-Pro “Waiting on job”. That stretch stays off billable service-order time.");
    const typo = greenville?.findings.find((finding) => finding.techId === "paul-henry" && finding.nonPro);
    assert.equal(typo?.start, "16:44");
    assert.equal(typo?.end, "16:45");
    assert.equal(typo?.recommendation, null);
    assert.match(typo?.detail ?? "", /Waitib\\ng on job/);
    const springfield = OCTOBER_21_REPORTS.find((report) => report.shopId === "springfield");
    const cleaning = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.nonPro);
    assert.equal(cleaning?.start, "09:08");
    assert.equal(cleaning?.end, "10:45");
    assert.equal(cleaning?.recommendation, null);
    const training = springfield?.findings.find((finding) => finding.techId === "chris-queary" && finding.nonPro);
    assert.equal(training?.start, "16:19");
    assert.equal(training?.end, "17:00");
    assert.equal(training?.recommendation, null);
  });
});

describe("October 22 download", () => {
  it("keeps the Thursday October 22 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-22.csv", "utf8");
    assert.equal(csv, THURSDAY_OCTOBER_22_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, thursdayOctober22);
    assert.equal(file.date, thursdayOctober22);
    assert.equal(file.rows.length, 335);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 119);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 84);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 63);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 40);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 26);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 3);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/22/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/23/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/23/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const kevin = file.rows.filter((record) => record.employee === "Kevin Neal");
    assert.equal(kevin.length, 2);
    assert.ok(kevin.every((record) => record.so_complaint === ""));
    assert.equal(
      kevin.reduce((sum, record) => sum + record.hours, 0),
      10.23,
    );
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora" && record.so_complaint.trim());
    assert.ok(flora.length > 0);
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 3);
    assert.ok(mobile.every((record) => record.so_complaint === ""));
    assert.ok(mobile.some((record) => record.employee === "Chris Clark" && record.clock_in_activity === "Shop Meeting"));
    assert.ok(mobile.some((record) => record.employee === "Jeff Haney" && record.clock_in_activity === "Shop Meeting"));
  });

  it("adds Thursday October 22 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober22).length, OCTOBER_22_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
  });

  it("builds Thursday October 22 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_22_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_22_REPORTS.every((report) => report.day === thursdayOctober22));
    assert.deepEqual(namesOn(OCTOBER_22_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_22_REPORTS, "covington"), ["Anthony Montgomery", "Dane Shelton", "Kody Peters", "Oliver Todd", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_22_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman"]);
    assert.deepEqual(namesOn(OCTOBER_22_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_22_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(namesOn(OCTOBER_22_REPORTS, "mobile").length, 0);
    const techs = OCTOBER_22_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 26);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_22_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_22_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 120, suggestions: 12 },
        covington: { techs: 5, findings: 60, suggestions: 7 },
        greenville: { techs: 5, findings: 76, suggestions: 2 },
        springfield: { techs: 4, findings: 46, suggestions: 15 },
        columbus: { techs: 4, findings: 24, suggestions: 2 },
      },
    );
    assert.equal(
      OCTOBER_22_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_22_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_22_REPORTS);
  });

  it("keeps Chris Clark and Jeff Haney on Dayton and leaves covered Non-Pro off the suggestion list", () => {
    assert.equal(
      OCTOBER_22_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    assert.equal(
      OCTOBER_22_REPORTS.some((report) => report.shopId === "mobile"),
      false,
    );
    const dayton = OCTOBER_22_REPORTS.find((report) => report.shopId === "dayton");
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    const clark = dayton?.technicians.find((tech) => tech.id === "chris-clark");
    assert.equal(haney?.soHours, 6.97);
    assert.equal(haney?.clockedHours, 9.03);
    assert.equal(clark?.soHours, 7.65);
    assert.equal(clark?.clockedHours, 8.25);
    assert.equal(
      OCTOBER_22_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      OCTOBER_22_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "chris-clark" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "jeff-haney" && finding.start === "07:06"),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "chris-clark" && finding.start === "07:02"),
      false,
    );
    const haneyMeeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "07:21");
    assert.ok(haneyMeeting?.nonPro);
    assert.equal(haneyMeeting?.recommendation, null);
    const coveredMeeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "11:38");
    assert.equal(coveredMeeting?.notAGap, true);
    assert.equal(coveredMeeting?.recommendation, null);
    assert.equal(coveredMeeting?.suggested, "Covered by Non-Pro. No edit.");
    const covington = OCTOBER_22_REPORTS.find((report) => report.shopId === "covington");
    const henry = covington?.technicians.find((tech) => tech.id === "paul-henry");
    assert.equal(henry?.soHours, 6.04);
    assert.equal(henry?.clockedHours, 6.42);
    assert.equal(
      OCTOBER_22_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "paul-henry" && tech.shopId !== "covington")),
      false,
    );
    const waiting = covington?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "15:40");
    assert.equal(waiting?.recommendation, null);
    assert.equal(waiting?.nonPro, undefined);
    assert.equal(waiting?.suggested, "Non-Pro “Waiting on job”. That stretch stays off billable service-order time.");
    const waitingLater = covington?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "16:21");
    assert.equal(waitingLater?.recommendation, null);
    assert.equal(waitingLater?.nonPro, undefined);
    assert.equal(waitingLater?.suggested, "Non-Pro “Waiting on job”. That stretch stays off billable service-order time.");
    const greenville = OCTOBER_22_REPORTS.find((report) => report.shopId === "greenville");
    const waitingOnJob = greenville?.findings.find((finding) => finding.techId === "jack-eversole" && finding.start === "07:01");
    assert.equal(waitingOnJob?.recommendation, null);
    assert.equal(waitingOnJob?.nonPro, undefined);
    assert.equal(waitingOnJob?.suggested, "Non-Pro “Waiting on job/cleaning up”. That stretch stays off billable service-order time.");
    const cleanup = greenville?.findings.find((finding) => finding.techId === "kyle-hickman" && finding.start === "16:46");
    assert.equal(cleanup?.notAGap, true);
    assert.equal(cleanup?.recommendation, null);
    assert.equal(cleanup?.suggested, "Covered by Non-Pro. No edit.");
    const springfield = OCTOBER_22_REPORTS.find((report) => report.shopId === "springfield");
    const peak = springfield?.findings.filter((finding) => finding.techId === "gary-evans" && finding.nonPro) ?? [];
    assert.deepEqual(
      peak.map((finding) => finding.start),
      ["08:49", "13:17", "13:36"],
    );
    assert.ok(peak.every((finding) => finding.recommendation == null));
  });
});

describe("October 23 download", () => {
  it("keeps the Friday October 23 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-23.csv", "utf8");
    assert.equal(csv, FRIDAY_OCTOBER_23_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, fridayOctober23);
    assert.equal(file.date, fridayOctober23);
    assert.equal(file.rows.length, 330);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 118);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 75);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 63);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 38);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 33);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 3);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/23/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/24/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/24/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const kevin = file.rows.filter((record) => record.employee === "Kevin Neal");
    assert.equal(kevin.length, 2);
    assert.ok(kevin.every((record) => record.so_complaint === ""));
    assert.equal(
      kevin.reduce((sum, record) => sum + record.hours, 0),
      9.73,
    );
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora" && record.so_complaint.trim());
    assert.equal(flora.length, 2);
    assert.equal(
      flora.reduce((sum, record) => sum + record.hours, 0),
      1.08,
    );
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 3);
    assert.ok(mobile.every((record) => record.so_complaint === ""));
    assert.ok(mobile.some((record) => record.employee === "Chris Clark" && record.clock_in_activity === "Shop Meeting"));
    assert.ok(mobile.some((record) => record.employee === "Chris Clark" && record.hours === 0));
    assert.ok(mobile.some((record) => record.employee === "Jeff Haney" && record.clock_in_activity === "Shop Meeting"));
    const mike = file.rows.filter((record) => record.employee === "Mike Wooten");
    assert.equal(mike.length, 3);
    assert.equal(mike.filter((record) => record.shop.includes("Springfield") && record.so_complaint === "").length, 1);
    assert.ok(mike.filter((record) => record.so_complaint.trim()).every((record) => record.so_complaint.startsWith("D-89709")));
  });

  it("adds Friday October 23 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober22).length, OCTOBER_22_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober23).length, OCTOBER_23_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
  });

  it("builds Friday October 23 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_23_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_23_REPORTS.every((report) => report.day === fridayOctober23));
    assert.deepEqual(namesOn(OCTOBER_23_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Mike Wooten",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_23_REPORTS, "covington"), ["Anthony Montgomery", "Dane Shelton", "Kody Peters", "Oliver Todd", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_23_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman"]);
    assert.deepEqual(namesOn(OCTOBER_23_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty"]);
    assert.deepEqual(namesOn(OCTOBER_23_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(namesOn(OCTOBER_23_REPORTS, "mobile").length, 0);
    const techs = OCTOBER_23_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 26);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_23_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_23_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 9, findings: 119, suggestions: 10 },
        covington: { techs: 5, findings: 64, suggestions: 8 },
        greenville: { techs: 5, findings: 55, suggestions: 7 },
        springfield: { techs: 3, findings: 32, suggestions: 7 },
        columbus: { techs: 4, findings: 39, suggestions: 5 },
      },
    );
    assert.equal(
      OCTOBER_23_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_23_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_23_REPORTS);
  });

  it("keeps cross-shop punches on the service-order shop and leaves covered Non-Pro off the suggestion list", () => {
    assert.equal(
      OCTOBER_23_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    assert.equal(
      OCTOBER_23_REPORTS.some((report) => report.shopId === "mobile"),
      false,
    );
    const dayton = OCTOBER_23_REPORTS.find((report) => report.shopId === "dayton");
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    const clark = dayton?.technicians.find((tech) => tech.id === "chris-clark");
    const wooten = dayton?.technicians.find((tech) => tech.id === "mike-wooten");
    assert.equal(haney?.soHours, 8.02);
    assert.equal(haney?.clockedHours, 8.54);
    assert.equal(clark?.soHours, 9.12);
    assert.equal(clark?.clockedHours, 9.28);
    assert.equal(wooten?.soHours, 8.41);
    assert.equal(wooten?.clockedHours, 8.41);
    assert.equal(
      OCTOBER_23_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      OCTOBER_23_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "chris-clark" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      OCTOBER_23_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "mike-wooten" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "jeff-haney" && finding.start === "06:56"),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "chris-clark" && finding.start === "07:01"),
      false,
    );
    const lookAtRpr = dayton?.findings.find((finding) => finding.techId === "cole-lozan" && finding.start === "16:11");
    assert.equal(lookAtRpr?.notAGap, true);
    assert.equal(lookAtRpr?.recommendation, null);
    assert.equal(lookAtRpr?.suggested, "Covered by Non-Pro. No edit.");
    const covington = OCTOBER_23_REPORTS.find((report) => report.shopId === "covington");
    const henry = covington?.technicians.find((tech) => tech.id === "paul-henry");
    assert.equal(henry?.soHours, 7.51);
    assert.equal(henry?.clockedHours, 8.94);
    const henryMeeting = covington?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "06:57");
    assert.ok(henryMeeting?.nonPro);
    assert.equal(henryMeeting?.recommendation, null);
    const waiting = covington?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "14:40");
    assert.equal(waiting?.recommendation, null);
    assert.equal(waiting?.nonPro, undefined);
    assert.equal(waiting?.suggested, "Non-Pro “waiting on job”. That stretch stays off billable service-order time.");
    const waitingLater = covington?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "16:27");
    assert.equal(waitingLater?.recommendation, null);
    assert.equal(waitingLater?.nonPro, undefined);
    assert.equal(waitingLater?.suggested, "Non-Pro “Waiting on job”. That stretch stays off billable service-order time.");
    const springfield = OCTOBER_23_REPORTS.find((report) => report.shopId === "springfield");
    const parts = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "09:10");
    assert.equal(parts?.notAGap, true);
    assert.equal(parts?.recommendation, null);
    assert.equal(parts?.suggested, "Covered by Non-Pro. No edit.");
    const stock = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "12:41");
    assert.ok(stock?.nonPro);
    assert.equal(stock?.recommendation, null);
    const trash = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "16:40");
    assert.ok(trash?.nonPro);
    assert.equal(trash?.end, "16:55");
    assert.equal(trash?.recommendation, null);
    const greenville = OCTOBER_23_REPORTS.find((report) => report.shopId === "greenville");
    const jackMeeting = greenville?.findings.find((finding) => finding.techId === "jack-eversole" && finding.start === "07:01");
    assert.ok(jackMeeting?.nonPro);
    assert.equal(jackMeeting?.recommendation, null);
  });
});

describe("October 24 download", () => {
  it("keeps the Saturday October 24 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-24.csv", "utf8");
    assert.equal(csv, SATURDAY_OCTOBER_24_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, saturdayOctober24);
    assert.equal(file.date, saturdayOctober24);
    assert.equal(file.rows.length, 44);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 25);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 19);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), undefined);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), undefined);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), undefined);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), undefined);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/24/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/25/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/25/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora");
    assert.equal(flora.length, 10);
    const floraOrders = flora.filter((record) => record.so_complaint.trim());
    assert.equal(floraOrders.length, 9);
    assert.equal(
      floraOrders.reduce((sum, record) => sum + record.hours, 0),
      3.85,
    );
    assert.equal(
      flora.filter((record) => record.so_complaint === "").reduce((sum, record) => sum + record.hours, 0),
      5.14,
    );
    assert.ok(flora.every((record) => record.shop.includes("Greenville")));
    const absent = ["James Benedict", "Isaac Stockslager", "Kevin Neal"];
    assert.equal(
      file.rows.some((record) => absent.includes(record.employee)),
      false,
    );
    const zero = file.rows.filter((record) => record.employee === "Paul Henry" && record.hours === 0);
    assert.equal(zero.length, 1);
    assert.equal(zero[0]?.clock_in, "8:23:22AM 10/24/2026");
    assert.equal(zero[0]?.clock_out, "8:23:28AM 10/24/2026");
    assert.ok(zero[0]?.so_complaint.startsWith("G-91027"));
    const waiting = file.rows.filter((record) => record.employee === "Paul Henry" && record.clock_in_activity === "Normal Non Pro");
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0]?.clock_in_comment, "waiting on job");
    assert.equal(waiting[0]?.clock_in, "10:21:33AM 10/24/2026");
    assert.equal(waiting[0]?.clock_out, "10:22:16AM 10/24/2026");
    assert.equal(waiting[0]?.hours, 0.01);
    assert.equal(waiting[0]?.so_complaint, "");
  });

  it("adds Saturday October 24 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober22).length, OCTOBER_22_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober23).length, OCTOBER_23_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober24).length, OCTOBER_24_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
  });

  it("builds Saturday October 24 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_24_REPORTS.map((report) => report.shopId),
      ["covington", "greenville"],
    );
    assert.ok(OCTOBER_24_REPORTS.every((report) => report.day === saturdayOctober24));
    assert.deepEqual(namesOn(OCTOBER_24_REPORTS, "covington"), ["Dane Shelton", "Kody Peters"]);
    assert.deepEqual(namesOn(OCTOBER_24_REPORTS, "greenville"), ["Paul Henry"]);
    assert.equal(namesOn(OCTOBER_24_REPORTS, "dayton").length, 0);
    assert.equal(namesOn(OCTOBER_24_REPORTS, "springfield").length, 0);
    assert.equal(namesOn(OCTOBER_24_REPORTS, "columbus").length, 0);
    assert.equal(namesOn(OCTOBER_24_REPORTS, "mobile").length, 0);
    const techs = OCTOBER_24_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 3);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_24_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_24_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        covington: { techs: 2, findings: 24, suggestions: 2 },
        greenville: { techs: 1, findings: 6, suggestions: 0 },
      },
    );
    const kody = techs.find((tech) => tech.id === "kody-peters");
    const dane = techs.find((tech) => tech.id === "dane-shelton");
    const paul = techs.find((tech) => tech.id === "paul-henry");
    assert.equal(kody?.clockedHours, 4.93);
    assert.equal(kody?.soHours, 4.91);
    assert.equal(dane?.clockedHours, 4.48);
    assert.equal(dane?.soHours, 4.2);
    assert.equal(paul?.clockedHours, 4.11);
    assert.equal(paul?.soHours, 4.08);
    assert.equal(kody?.shopId, "covington");
    assert.equal(dane?.shopId, "covington");
    assert.equal(paul?.shopId, "greenville");
    assert.equal(
      OCTOBER_24_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_24_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_24_REPORTS);
  });

  it("suggests Dane Shelton’s two Covington gaps and leaves Paul Henry’s short waiting note off the list", () => {
    const covington = OCTOBER_24_REPORTS.find((report) => report.shopId === "covington");
    const key = covington?.findings.find((finding) => finding.techId === "dane-shelton" && finding.start === "09:39");
    assert.equal(key?.end, "09:41");
    assert.equal(key?.minutes, 2);
    assert.equal(key?.recommendation?.orderId, "C-90592");
    assert.equal(key?.recommendation?.summary, "Start C-90592 Remove broken off key fro ... at 9:39 AM instead of 9:41 AM. The timesheet has no service order on this stretch.");
    const tail = covington?.findings.find((finding) => finding.techId === "dane-shelton" && finding.start === "11:30");
    assert.equal(tail?.end, "11:42");
    assert.equal(tail?.minutes, 12);
    assert.equal(tail?.recommendation?.orderId, "C-91051");
    assert.equal(tail?.recommendation?.summary, "Keep C-91051 10/24 Federal Inspection  ... until 11:42 AM. The timesheet has no service order on this stretch.");
    assert.deepEqual(
      requiredDecisionFindingIds(OCTOBER_24_REPORTS, { day: saturdayOctober24, shopId: "covington" }),
      ["2026-10-24-covington-dane-shelton-06", "2026-10-24-covington-dane-shelton-11"],
    );
    const greenville = OCTOBER_24_REPORTS.find((report) => report.shopId === "greenville");
    assert.equal(
      greenville?.findings.some((finding) => finding.techId === "paul-henry" && (finding.nonPro || finding.recommendation)),
      false,
    );
    assert.equal(
      greenville?.findings.some((finding) => finding.start === "10:21"),
      false,
    );
    assert.deepEqual(requiredDecisionFindingIds(OCTOBER_24_REPORTS, { day: saturdayOctober24, shopId: "greenville" }), []);
  });
});

describe("October 26 download", () => {
  it("keeps the Monday October 26 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-26.csv", "utf8");
    assert.equal(csv, MONDAY_OCTOBER_26_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, mondayOctober26);
    assert.equal(file.date, mondayOctober26);
    assert.equal(file.rows.length, 317);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 113);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 57);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 55);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 50);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 41);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 1);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/26/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/27/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    assert.ok(travis[0]?.shop.includes("Covington"));
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/27/2026") || record.clock_in.includes("10/27/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora");
    assert.equal(flora.length, 2);
    assert.ok(flora.every((record) => record.so_complaint === "" && record.shop.includes("Greenville")));
    assert.deepEqual(
      flora.map((record) => record.hours),
      [5.19, 3.91],
    );
    const kevin = file.rows.filter((record) => record.employee === "Kevin Neal");
    assert.equal(kevin.length, 2);
    assert.ok(kevin.every((record) => record.so_complaint === "" && record.shop.includes("Covington")));
    assert.equal(
      kevin.reduce((sum, record) => sum + record.hours, 0),
      10.08,
    );
    const benedict = file.rows.filter((record) => record.employee === "James Benedict");
    assert.equal(benedict.length, 11);
    assert.ok(benedict.every((record) => record.shop.includes("Columbus")));
    const benedictOrders = benedict.filter((record) => record.so_complaint.trim());
    assert.equal(benedictOrders.length, 6);
    assert.equal(
      benedictOrders.reduce((sum, record) => sum + record.hours, 0),
      1.69,
    );
    assert.equal(
      file.rows.some((record) => record.employee === "Isaac Stockslager"),
      false,
    );
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 1);
    assert.equal(mobile[0]?.employee, "Jeff Haney");
    assert.equal(mobile[0]?.clock_in_activity, "Shop Meeting");
    assert.equal(mobile[0]?.clock_in, "7:02:14AM 10/26/2026");
    assert.equal(mobile[0]?.clock_out, "8:42:12AM 10/26/2026");
    assert.equal(mobile[0]?.hours, 1.67);
    assert.equal(mobile[0]?.so_complaint, "");
    const open = file.rows.filter((record) => record.open_punch);
    assert.equal(open.length, 0);
  });

  it("adds Monday October 26 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober22).length, OCTOBER_22_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober23).length, OCTOBER_23_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober24).length, OCTOBER_24_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober26).length, OCTOBER_26_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-25"), false);
  });

  it("builds Monday October 26 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_26_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_26_REPORTS.every((report) => report.day === mondayOctober26));
    assert.deepEqual(namesOn(OCTOBER_26_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_26_REPORTS, "covington"), ["Anthony Montgomery", "Dane Shelton", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_26_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_26_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_26_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(namesOn(OCTOBER_26_REPORTS, "mobile").length, 0);
    const techs = OCTOBER_26_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 24);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_26_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_26_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 7, findings: 109, suggestions: 9 },
        covington: { techs: 3, findings: 51, suggestions: 7 },
        greenville: { techs: 6, findings: 53, suggestions: 4 },
        springfield: { techs: 4, findings: 47, suggestions: 13 },
        columbus: { techs: 4, findings: 43, suggestions: 3 },
      },
    );
    const gary = techs.find((tech) => tech.id === "gary-evans");
    assert.equal(gary?.shopId, "springfield");
    assert.equal(gary?.clockedHours, 12.03);
    assert.equal(gary?.soHours, 6.33);
    assert.equal(
      OCTOBER_26_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_26_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_26_REPORTS);
  });

  it("keeps cross-shop punches on the service-order shop and leaves covered Non-Pro off the suggestion list", () => {
    assert.equal(
      OCTOBER_26_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    assert.equal(
      OCTOBER_26_REPORTS.some((report) => report.shopId === "mobile"),
      false,
    );
    const dayton = OCTOBER_26_REPORTS.find((report) => report.shopId === "dayton");
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    assert.equal(haney?.soHours, 7.03);
    assert.equal(haney?.clockedHours, 7.45);
    assert.equal(
      OCTOBER_26_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "jeff-haney" && finding.start === "07:02"),
      false,
    );
    const haneyMeeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "11:57");
    assert.equal(haneyMeeting?.notAGap, true);
    assert.equal(haneyMeeting?.recommendation, null);
    assert.equal(haneyMeeting?.suggested, "Covered by Non-Pro. No edit.");
    const clarkMeeting = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "07:06");
    assert.ok(clarkMeeting?.nonPro);
    assert.equal(clarkMeeting?.end, "07:39");
    assert.equal(clarkMeeting?.minutes, 33);
    assert.equal(clarkMeeting?.recommendation, null);
    const clarkCovered = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "07:47");
    assert.equal(clarkCovered?.notAGap, true);
    assert.equal(clarkCovered?.recommendation, null);
    assert.equal(clarkCovered?.suggested, "Covered by Non-Pro. No edit.");
    const helping = dayton?.findings.find((finding) => finding.techId === "nick-sontag" && finding.start === "07:06");
    assert.ok(helping?.nonPro);
    assert.equal(helping?.end, "07:28");
    assert.equal(helping?.minutes, 22);
    assert.equal(helping?.recommendation, null);
    assert.equal(helping?.suggested, "Review. Non-Pro attendance may or may not be valid.");
    const springfield = OCTOBER_26_REPORTS.find((report) => report.shopId === "springfield");
    const cleanup = springfield?.findings.find((finding) => finding.techId === "mike-wooten" && finding.start === "11:51");
    assert.ok(cleanup?.nonPro);
    assert.equal(cleanup?.end, "16:26");
    assert.equal(cleanup?.minutes, 275);
    assert.equal(cleanup?.recommendation, null);
    const radiatorGap = springfield?.findings.find((finding) => finding.techId === "gary-evans" && finding.start === "07:54");
    assert.equal(radiatorGap?.minutes, 109);
    assert.equal(radiatorGap?.recommendation?.orderId, "S-91320");
    const radiatorTail = springfield?.findings.find((finding) => finding.techId === "gary-evans" && finding.start === "10:18");
    assert.equal(radiatorTail?.minutes, 111);
    assert.equal(radiatorTail?.end, "12:09");
    assert.equal(radiatorTail?.recommendation?.orderId, "S-91320");
    const turbo = springfield?.findings.find((finding) => finding.techId === "gary-evans" && finding.start === "15:02");
    assert.equal(turbo?.minutes, 76);
    assert.equal(turbo?.recommendation?.orderId, "S-91289");
    const daytonSuggestions = requiredDecisionFindingIds(OCTOBER_26_REPORTS, { day: mondayOctober26, shopId: "dayton" });
    assert.equal(daytonSuggestions.includes(haneyMeeting?.id ?? ""), false);
    assert.equal(daytonSuggestions.includes(clarkCovered?.id ?? ""), false);
    assert.equal(daytonSuggestions.includes(clarkMeeting?.id ?? ""), true);
    assert.equal(daytonSuggestions.includes(helping?.id ?? ""), true);
  });
});

describe("October 27 download", () => {
  it("keeps the Tuesday October 27 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-27.csv", "utf8");
    assert.equal(csv, TUESDAY_OCTOBER_27_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, tuesdayOctober27);
    assert.equal(file.date, tuesdayOctober27);
    assert.equal(file.rows.length, 372);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 123);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 69);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 66);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 61);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 52);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 1);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/27/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/28/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    assert.ok(travis[0]?.shop.includes("Covington"));
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/28/2026") || record.clock_in.includes("10/28/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora");
    assert.equal(flora.length, 2);
    assert.ok(flora.every((record) => record.so_complaint === "" && record.shop.includes("Greenville")));
    assert.deepEqual(
      flora.map((record) => record.hours),
      [5.01, 3.97],
    );
    const kevin = file.rows.filter((record) => record.employee === "Kevin Neal");
    assert.equal(kevin.length, 3);
    assert.ok(kevin.every((record) => record.shop.includes("Covington")));
    const kevinOrders = kevin.filter((record) => record.so_complaint.trim());
    assert.equal(kevinOrders.length, 1);
    assert.equal(kevinOrders[0]?.hours, 0);
    assert.match(kevinOrders[0]?.so_complaint ?? "", /^C-90899 /);
    assert.equal(
      kevin.filter((record) => !record.so_complaint.trim()).reduce((sum, record) => sum + record.hours, 0),
      9.73,
    );
    const benedict = file.rows.filter((record) => record.employee === "James Benedict");
    assert.equal(benedict.length, 4);
    assert.ok(benedict.every((record) => record.shop.includes("Columbus")));
    const benedictOrders = benedict.filter((record) => record.so_complaint.trim());
    assert.equal(benedictOrders.length, 2);
    assert.ok(benedictOrders.every((record) => record.so_complaint.startsWith("CL-91260")));
    assert.equal(
      benedictOrders.reduce((sum, record) => sum + record.hours, 0),
      1.16,
    );
    assert.equal(
      file.rows.some((record) => record.employee === "Isaac Stockslager"),
      false,
    );
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 1);
    assert.equal(mobile[0]?.employee, "Jeff Haney");
    assert.equal(mobile[0]?.clock_in_activity, "Shop Meeting");
    assert.equal(mobile[0]?.clock_in, "7:05:29AM 10/27/2026");
    assert.equal(mobile[0]?.clock_out, "8:16:41AM 10/27/2026");
    assert.equal(mobile[0]?.hours, 1.19);
    assert.equal(mobile[0]?.so_complaint, "");
    const open = file.rows.filter((record) => record.open_punch);
    assert.equal(open.length, 0);
  });

  it("adds Tuesday October 27 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober22).length, OCTOBER_22_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober23).length, OCTOBER_23_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober24).length, OCTOBER_24_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober26).length, OCTOBER_26_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober27).length, OCTOBER_27_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-25"), false);
  });

  it("builds Tuesday October 27 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_27_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_27_REPORTS.every((report) => report.day === tuesdayOctober27));
    assert.deepEqual(namesOn(OCTOBER_27_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_27_REPORTS, "covington"), ["Anthony Montgomery", "Cline Wirick", "Dane Shelton", "Joe Hueber", "Kody Peters", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_27_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_27_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_27_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(namesOn(OCTOBER_27_REPORTS, "mobile").length, 0);
    const techs = OCTOBER_27_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 28);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_27_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_27_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 122, suggestions: 12 },
        covington: { techs: 6, findings: 61, suggestions: 5 },
        greenville: { techs: 6, findings: 56, suggestions: 5 },
        springfield: { techs: 4, findings: 77, suggestions: 23 },
        columbus: { techs: 4, findings: 47, suggestions: 3 },
      },
    );
    const queary = techs.find((tech) => tech.id === "chris-queary");
    assert.equal(queary?.shopId, "springfield");
    assert.equal(queary?.clockedHours, 10.02);
    assert.equal(queary?.soHours, 7.98);
    const cody = techs.find((tech) => tech.id === "cody-kester");
    assert.equal(cody?.clockedHours, 8.84);
    assert.equal(cody?.soHours, 8.85);
    assert.equal(
      OCTOBER_27_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_27_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_27_REPORTS);
  });

  it("keeps the Mobile shop meeting off Dayton and leaves covered or waiting punches off the suggestion list", () => {
    assert.equal(
      OCTOBER_27_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    assert.equal(
      OCTOBER_27_REPORTS.some((report) => report.shopId === "mobile"),
      false,
    );
    const multiShop = OCTOBER_27_REPORTS.flatMap((report) => report.technicians.map((tech) => tech.name));
    assert.equal(new Set(multiShop).size, multiShop.length);
    const dayton = OCTOBER_27_REPORTS.find((report) => report.shopId === "dayton");
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    assert.equal(haney?.soHours, 7.45);
    assert.equal(haney?.clockedHours, 8.68);
    assert.equal(
      OCTOBER_27_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "jeff-haney" && finding.start === "07:05"),
      false,
    );
    const coveredMeetings = ["09:39", "09:49", "11:48"].map((start) =>
      dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === start && finding.notAGap),
    );
    for (const meeting of coveredMeetings) {
      assert.equal(meeting?.notAGap, true);
      assert.equal(meeting?.recommendation, null);
      assert.equal(meeting?.suggested, "Covered by Non-Pro. No edit.");
    }
    const clarkMeeting = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "07:04");
    assert.ok(clarkMeeting?.nonPro);
    assert.equal(clarkMeeting?.end, "07:36");
    assert.equal(clarkMeeting?.minutes, 32);
    assert.equal(clarkMeeting?.recommendation, null);
    const springfield = OCTOBER_27_REPORTS.find((report) => report.shopId === "springfield");
    const cleaning = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "08:56");
    assert.ok(cleaning?.nonPro);
    assert.equal(cleaning?.end, "11:23");
    assert.equal(cleaning?.minutes, 147);
    const cleanup = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "13:26");
    assert.ok(cleanup?.nonPro);
    assert.equal(cleanup?.minutes, 29);
    const clean = springfield?.findings.find((finding) => finding.techId === "mike-wooten" && finding.start === "09:14");
    assert.ok(clean?.nonPro);
    assert.equal(clean?.minutes, 105);
    const parts = springfield?.findings.find((finding) => finding.techId === "mike-wooten" && finding.start === "11:01");
    assert.ok(parts?.nonPro);
    assert.equal(parts?.minutes, 23);
    const lookOver = springfield?.findings.find((finding) => finding.techId === "mike-wooten" && finding.start === "13:02");
    assert.ok(lookOver?.nonPro);
    assert.equal(lookOver?.end, "14:50");
    assert.equal(lookOver?.minutes, 108);
    const greenville = OCTOBER_27_REPORTS.find((report) => report.shopId === "greenville");
    const shortWait = greenville?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "13:42");
    assert.equal(shortWait, undefined);
    const waiting = greenville?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "15:58");
    assert.equal(waiting?.end, "16:23");
    assert.equal(waiting?.minutes, 25);
    assert.equal(waiting?.recommendation, null);
    assert.equal(waiting?.nonPro, undefined);
    assert.match(waiting?.suggested ?? "", /Waiting on job/);
    assert.match(waiting?.suggested ?? "", /stays off billable/);
    const suggestions = requiredDecisionFindingIds(OCTOBER_27_REPORTS, { day: tuesdayOctober27, shopId: "greenville" });
    assert.equal(suggestions.includes(waiting?.id ?? ""), false);
    const daytonSuggestions = requiredDecisionFindingIds(OCTOBER_27_REPORTS, { day: tuesdayOctober27, shopId: "dayton" });
    assert.equal(daytonSuggestions.includes(clarkMeeting?.id ?? ""), true);
    for (const meeting of coveredMeetings) assert.equal(daytonSuggestions.includes(meeting?.id ?? ""), false);
    const springfieldSuggestions = requiredDecisionFindingIds(OCTOBER_27_REPORTS, { day: tuesdayOctober27, shopId: "springfield" });
    assert.equal(springfieldSuggestions.includes(cleaning?.id ?? ""), true);
    assert.equal(springfieldSuggestions.includes(lookOver?.id ?? ""), true);
  });
});

describe("October 28 download", () => {
  it("keeps the Wednesday October 28 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-28.csv", "utf8");
    assert.equal(csv, WEDNESDAY_OCTOBER_28_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, wednesdayOctober28);
    assert.equal(file.date, wednesdayOctober28);
    assert.equal(file.rows.length, 351);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 125);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 71);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 69);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 44);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 41);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 1);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/28/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/29/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    assert.ok(travis[0]?.shop.includes("Covington"));
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/29/2026") || record.clock_in.includes("10/29/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora");
    assert.equal(flora.length, 4);
    assert.ok(flora.every((record) => record.shop.includes("Greenville")));
    assert.equal(
      flora.filter((record) => !record.so_complaint.trim()).reduce((sum, record) => sum + record.hours, 0),
      9.14,
    );
    const floraOrders = flora.filter((record) => record.so_complaint.trim());
    assert.equal(floraOrders.length, 2);
    assert.equal(
      floraOrders.reduce((sum, record) => sum + record.hours, 0),
      1.04,
    );
    assert.match(floraOrders[0]?.so_complaint ?? "", /^G-91301 /);
    assert.match(floraOrders[1]?.so_complaint ?? "", /^G-91318 /);
    const kevin = file.rows.filter((record) => record.employee === "Kevin Neal");
    assert.equal(kevin.length, 3);
    assert.ok(kevin.every((record) => record.shop.includes("Covington")));
    const kevinOrders = kevin.filter((record) => record.so_complaint.trim());
    assert.equal(kevinOrders.length, 1);
    assert.equal(kevinOrders[0]?.hours, 0);
    assert.match(kevinOrders[0]?.so_complaint ?? "", /^C-90899 /);
    assert.equal(
      kevin.filter((record) => !record.so_complaint.trim()).reduce((sum, record) => sum + record.hours, 0),
      10.17,
    );
    const benedict = file.rows.filter((record) => record.employee === "James Benedict");
    assert.equal(benedict.length, 12);
    assert.ok(benedict.every((record) => record.shop.includes("Columbus")));
    const benedictOrders = benedict.filter((record) => record.so_complaint.trim());
    assert.equal(benedictOrders.length, 6);
    assert.equal(
      benedictOrders.reduce((sum, record) => sum + record.hours, 0),
      1.31,
    );
    const isaac = file.rows.filter((record) => record.employee === "Isaac Stockslager");
    assert.equal(isaac.length, 2);
    assert.ok(isaac.every((record) => record.shop.includes("Dayton")));
    assert.match(isaac.find((record) => record.so_complaint.trim())?.so_complaint ?? "", /^D-90101 /);
    assert.equal(
      isaac.filter((record) => record.so_complaint.trim()).reduce((sum, record) => sum + record.hours, 0),
      0.37,
    );
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 1);
    assert.equal(mobile[0]?.employee, "Jeff Haney");
    assert.equal(mobile[0]?.clock_in_activity, "Shop Meeting");
    assert.equal(mobile[0]?.clock_in, "7:58:55AM 10/28/2026");
    assert.equal(mobile[0]?.clock_out, "8:49:24AM 10/28/2026");
    assert.equal(mobile[0]?.hours, 0.84);
    assert.equal(mobile[0]?.so_complaint, "");
    const open = file.rows.filter((record) => record.open_punch);
    assert.equal(open.length, 0);
  });

  it("adds Wednesday October 28 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober22).length, OCTOBER_22_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober23).length, OCTOBER_23_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober24).length, OCTOBER_24_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober26).length, OCTOBER_26_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober27).length, OCTOBER_27_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober28).length, OCTOBER_28_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-25"), false);
  });

  it("builds Wednesday October 28 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_28_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_28_REPORTS.every((report) => report.day === wednesdayOctober28));
    assert.deepEqual(namesOn(OCTOBER_28_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_28_REPORTS, "covington"), ["Anthony Montgomery", "Cline Wirick", "Dane Shelton", "Joe Hueber", "Kody Peters", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_28_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman", "Paul Henry"]);
    assert.deepEqual(namesOn(OCTOBER_28_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_28_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(namesOn(OCTOBER_28_REPORTS, "mobile").length, 0);
    const techs = OCTOBER_28_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 28);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_28_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_28_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 120, suggestions: 9 },
        covington: { techs: 6, findings: 63, suggestions: 4 },
        greenville: { techs: 6, findings: 63, suggestions: 6 },
        springfield: { techs: 4, findings: 44, suggestions: 9 },
        columbus: { techs: 4, findings: 29, suggestions: 1 },
      },
    );
    const clark = techs.find((tech) => tech.id === "chris-clark");
    assert.equal(clark?.shopId, "dayton");
    assert.equal(clark?.clockedHours, 10.46);
    assert.equal(clark?.soHours, 9.92);
    const cody = techs.find((tech) => tech.id === "cody-kester");
    assert.equal(cody?.clockedHours, 8.84);
    assert.equal(cody?.soHours, 8.84);
    assert.equal(
      OCTOBER_28_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_28_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_28_REPORTS);
  });

  it("keeps the Mobile shop meeting off Dayton and leaves covered or waiting punches off the suggestion list", () => {
    assert.equal(
      OCTOBER_28_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    assert.equal(
      OCTOBER_28_REPORTS.some((report) => report.shopId === "mobile"),
      false,
    );
    const multiShop = OCTOBER_28_REPORTS.flatMap((report) => report.technicians.map((tech) => tech.name));
    assert.equal(new Set(multiShop).size, multiShop.length);
    const dayton = OCTOBER_28_REPORTS.find((report) => report.shopId === "dayton");
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    assert.equal(haney?.soHours, 5.65);
    assert.equal(haney?.clockedHours, 7.33);
    assert.equal(
      OCTOBER_28_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "jeff-haney" && (finding.start === "07:58" || finding.start === "07:59")),
      false,
    );
    const coveredMeetings = [
      { start: "08:52", end: "09:25", minutes: 33 },
      { start: "10:10", end: "10:29", minutes: 19 },
    ].map((expected) => {
      const meeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === expected.start && finding.notAGap);
      assert.equal(meeting?.end, expected.end);
      assert.equal(meeting?.minutes, expected.minutes);
      return meeting;
    });
    for (const meeting of coveredMeetings) {
      assert.equal(meeting?.notAGap, true);
      assert.equal(meeting?.recommendation, null);
      assert.equal(meeting?.suggested, "Covered by Non-Pro. No edit.");
    }
    const clarkMeeting = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "06:55");
    assert.ok(clarkMeeting?.nonPro);
    assert.equal(clarkMeeting?.end, "07:25");
    assert.equal(clarkMeeting?.minutes, 30);
    assert.equal(clarkMeeting?.recommendation, null);
    const springfield = OCTOBER_28_REPORTS.find((report) => report.shopId === "springfield");
    const training = springfield?.findings.find((finding) => finding.techId === "chris-queary" && finding.start === "10:01");
    assert.equal(training?.notAGap, true);
    assert.equal(training?.end, "10:24");
    assert.equal(training?.minutes, 23);
    assert.equal(training?.recommendation, null);
    assert.equal(training?.suggested, "Covered by Non-Pro. No edit.");
    assert.match(training?.detail ?? "", /training/);
    const parts = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "15:19");
    assert.equal(parts?.notAGap, true);
    assert.equal(parts?.end, "15:57");
    assert.equal(parts?.minutes, 38);
    assert.equal(parts?.recommendation, null);
    assert.equal(parts?.suggested, "Covered by Non-Pro. No edit.");
    assert.match(parts?.detail ?? "", /picking up parts/);
    const greenville = OCTOBER_28_REPORTS.find((report) => report.shopId === "greenville");
    const cleanup = greenville?.findings.find((finding) => finding.techId === "jack-eversole" && finding.start === "09:02");
    assert.ok(cleanup?.nonPro);
    assert.equal(cleanup?.end, "09:12");
    assert.equal(cleanup?.minutes, 10);
    assert.match(cleanup?.detail ?? "", /Clean up bay before pulling next truck in/);
    const waiting = greenville?.findings.find((finding) => finding.techId === "paul-henry" && finding.start === "16:35");
    assert.equal(waiting?.end, "16:38");
    assert.equal(waiting?.minutes, 3);
    assert.equal(waiting?.recommendation, null);
    assert.equal(waiting?.nonPro, undefined);
    assert.match(waiting?.suggested ?? "", /Waiting on job/);
    assert.match(waiting?.suggested ?? "", /stays off billable/);
    const waitingLater = greenville?.findings.find(
      (finding) => finding.techId === "paul-henry" && finding.start === "16:38" && finding.minutes === 7,
    );
    assert.equal(waitingLater?.end, "16:45");
    assert.equal(waitingLater?.minutes, 7);
    assert.equal(waitingLater?.recommendation, null);
    assert.match(waitingLater?.suggested ?? "", /WAITING ON JOB/);
    assert.match(waitingLater?.suggested ?? "", /stays off billable/);
    const suggestions = requiredDecisionFindingIds(OCTOBER_28_REPORTS, { day: wednesdayOctober28, shopId: "greenville" });
    assert.equal(suggestions.includes(waiting?.id ?? ""), false);
    assert.equal(suggestions.includes(waitingLater?.id ?? ""), false);
    assert.equal(suggestions.includes(cleanup?.id ?? ""), true);
    const daytonSuggestions = requiredDecisionFindingIds(OCTOBER_28_REPORTS, { day: wednesdayOctober28, shopId: "dayton" });
    assert.equal(daytonSuggestions.includes(clarkMeeting?.id ?? ""), true);
    for (const meeting of coveredMeetings) assert.equal(daytonSuggestions.includes(meeting?.id ?? ""), false);
    const springfieldSuggestions = requiredDecisionFindingIds(OCTOBER_28_REPORTS, { day: wednesdayOctober28, shopId: "springfield" });
    assert.equal(springfieldSuggestions.includes(training?.id ?? ""), false);
    assert.equal(springfieldSuggestions.includes(parts?.id ?? ""), false);
  });
});

describe("October 29 download", () => {
  it("keeps the Thursday October 29 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-29.csv", "utf8");
    assert.equal(csv, THURSDAY_OCTOBER_29_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, thursdayOctober29);
    assert.equal(file.date, thursdayOctober29);
    assert.equal(file.rows.length, 353);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 118);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 86);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 71);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 51);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 26);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), 1);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/29/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/30/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    assert.ok(travis[0]?.shop.includes("Covington"));
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/30/2026") || record.clock_in.includes("10/30/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora");
    assert.equal(flora.length, 6);
    assert.ok(flora.every((record) => record.shop.includes("Greenville")));
    assert.equal(
      flora.filter((record) => !record.so_complaint.trim()).reduce((sum, record) => sum + record.hours, 0),
      8.47,
    );
    const floraOrders = flora.filter((record) => record.so_complaint.trim());
    assert.equal(floraOrders.length, 4);
    assert.equal(
      Number(floraOrders.reduce((sum, record) => sum + record.hours, 0).toFixed(2)),
      0.32,
    );
    const kevin = file.rows.filter((record) => record.employee === "Kevin Neal");
    assert.equal(kevin.length, 3);
    assert.ok(kevin.every((record) => record.shop.includes("Covington")));
    const kevinOrders = kevin.filter((record) => record.so_complaint.trim());
    assert.equal(kevinOrders.length, 1);
    assert.equal(kevinOrders[0]?.hours, 1.36);
    assert.match(kevinOrders[0]?.so_complaint ?? "", /^C-91414 /);
    assert.equal(
      kevin.filter((record) => !record.so_complaint.trim()).reduce((sum, record) => sum + record.hours, 0),
      10.09,
    );
    const benedict = file.rows.filter((record) => record.employee === "James Benedict");
    assert.equal(benedict.length, 9);
    assert.ok(benedict.every((record) => record.shop.includes("Columbus")));
    assert.equal(
      Number(benedict.filter((record) => record.so_complaint.trim()).reduce((sum, record) => sum + record.hours, 0).toFixed(2)),
      0.59,
    );
    assert.equal(file.rows.filter((record) => record.employee === "Isaac Stockslager").length, 0);
    const mobile = file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)");
    assert.equal(mobile.length, 1);
    assert.equal(mobile[0]?.employee, "Jeff Haney");
    assert.equal(mobile[0]?.clock_in_activity, "Shop Meeting");
    assert.equal(mobile[0]?.clock_in, "7:01:45AM 10/29/2026");
    assert.equal(mobile[0]?.clock_out, "7:46:39AM 10/29/2026");
    assert.equal(mobile[0]?.hours, 0.75);
    assert.equal(mobile[0]?.so_complaint, "");
    const open = file.rows.filter((record) => record.open_punch);
    assert.equal(open.length, 0);
  });

  it("adds Thursday October 29 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober22).length, OCTOBER_22_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober23).length, OCTOBER_23_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober24).length, OCTOBER_24_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober26).length, OCTOBER_26_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober27).length, OCTOBER_27_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober28).length, OCTOBER_28_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober29).length, OCTOBER_29_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-25"), false);
  });

  it("builds Thursday October 29 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_29_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_29_REPORTS.every((report) => report.day === thursdayOctober29));
    assert.deepEqual(namesOn(OCTOBER_29_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Nick Sontag",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_29_REPORTS, "covington"), ["Anthony Montgomery", "Cline Wirick", "Dane Shelton", "Joe Hueber", "Kody Peters", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_29_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman"]);
    assert.deepEqual(namesOn(OCTOBER_29_REPORTS, "springfield"), ["Chris Queary", "Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_29_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(namesOn(OCTOBER_29_REPORTS, "mobile").length, 0);
    const techs = OCTOBER_29_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 27);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_29_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_29_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 8, findings: 124, suggestions: 18 },
        covington: { techs: 6, findings: 68, suggestions: 7 },
        greenville: { techs: 5, findings: 72, suggestions: 4 },
        springfield: { techs: 4, findings: 24, suggestions: 5 },
        columbus: { techs: 4, findings: 38, suggestions: 0 },
      },
    );
    const brayden = techs.find((tech) => tech.id === "brayden-mapp");
    assert.equal(brayden?.clockedHours, 10.16);
    assert.equal(brayden?.soHours, 9.45);
    const nick = techs.find((tech) => tech.id === "nick-sontag");
    assert.equal(nick?.clockedHours, 8.77);
    assert.equal(nick?.soHours, 8.78);
    const gary = techs.find((tech) => tech.id === "gary-evans");
    assert.equal(gary?.shopId, "springfield");
    assert.equal(gary?.clockedHours, 0.03);
    assert.equal(gary?.soHours, 0.03);
    const oliver = techs.find((tech) => tech.id === "oliver-todd");
    assert.equal(oliver?.clockedHours, 9.24);
    assert.equal(oliver?.soHours, 8.94);
    assert.equal(
      OCTOBER_29_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_29_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_29_REPORTS);
  });

  it("keeps the Mobile shop meeting off Dayton and leaves covered or waiting punches off the suggestion list", () => {
    assert.equal(
      OCTOBER_29_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    assert.equal(
      OCTOBER_29_REPORTS.some((report) => report.shopId === "mobile"),
      false,
    );
    const multiShop = OCTOBER_29_REPORTS.flatMap((report) => report.technicians.map((tech) => tech.name));
    assert.equal(new Set(multiShop).size, multiShop.length);
    const dayton = OCTOBER_29_REPORTS.find((report) => report.shopId === "dayton");
    const haney = dayton?.technicians.find((tech) => tech.id === "jeff-haney");
    assert.equal(haney?.soHours, 8.68);
    assert.equal(haney?.clockedHours, 8.87);
    assert.equal(
      OCTOBER_29_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    assert.equal(
      dayton?.findings.some((finding) => finding.techId === "jeff-haney" && (finding.start === "07:01" || finding.start === "07:02")),
      false,
    );
    const coveredMeetings = [
      { start: "07:47", end: "07:50", minutes: 3 },
      { start: "07:53", end: "07:55", minutes: 2 },
    ].map((expected) => {
      const meeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === expected.start && finding.notAGap);
      assert.equal(meeting?.end, expected.end);
      assert.equal(meeting?.minutes, expected.minutes);
      return meeting;
    });
    for (const meeting of coveredMeetings) {
      assert.equal(meeting?.notAGap, true);
      assert.equal(meeting?.recommendation, null);
      assert.equal(meeting?.suggested, "Covered by Non-Pro. No edit.");
    }
    const clarkMeeting = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "06:59");
    assert.ok(clarkMeeting?.nonPro);
    assert.equal(clarkMeeting?.end, "07:12");
    assert.equal(clarkMeeting?.minutes, 13);
    assert.equal(clarkMeeting?.recommendation, null);
    const greenville = OCTOBER_29_REPORTS.find((report) => report.shopId === "greenville");
    const johnsonMeeting = greenville?.findings.find((finding) => finding.techId === "david-johnson" && finding.start === "07:01" && finding.nonPro);
    assert.equal(johnsonMeeting?.end, "07:12");
    assert.equal(johnsonMeeting?.minutes, 11);
    const eversoleMeeting = greenville?.findings.find((finding) => finding.techId === "jack-eversole" && finding.start === "07:01" && finding.nonPro);
    assert.equal(eversoleMeeting?.end, "07:21");
    assert.equal(eversoleMeeting?.minutes, 20);
    const willsMeeting = greenville?.findings.find((finding) => finding.techId === "gage-wills" && finding.start === "07:01" && finding.nonPro);
    assert.equal(willsMeeting?.end, "07:15");
    assert.equal(willsMeeting?.minutes, 14);
    const waiting = greenville?.findings.find((finding) => finding.techId === "jack-eversole" && finding.start === "09:15");
    assert.equal(waiting?.end, "09:27");
    assert.equal(waiting?.minutes, 12);
    assert.equal(waiting?.recommendation, null);
    assert.equal(waiting?.nonPro, undefined);
    assert.match(waiting?.suggested ?? "", /Cleaning up waiting on job to arrive/);
    assert.match(waiting?.suggested ?? "", /stays off billable/);
    const springfield = OCTOBER_29_REPORTS.find((report) => report.shopId === "springfield");
    const withAndy = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "08:40");
    assert.equal(withAndy?.notAGap, true);
    assert.equal(withAndy?.end, "10:09");
    assert.equal(withAndy?.minutes, 89);
    assert.equal(withAndy?.recommendation, null);
    assert.equal(withAndy?.suggested, "Covered by Non-Pro. No edit.");
    assert.match(withAndy?.detail ?? "", /with Andy/);
    const cleaning = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "15:11");
    assert.ok(cleaning?.nonPro);
    assert.equal(cleaning?.end, "17:00");
    assert.equal(cleaning?.minutes, 109);
    assert.match(cleaning?.detail ?? "", /cleaning/);
    const suggestions = requiredDecisionFindingIds(OCTOBER_29_REPORTS, { day: thursdayOctober29, shopId: "greenville" });
    assert.equal(suggestions.includes(waiting?.id ?? ""), false);
    assert.equal(suggestions.includes(johnsonMeeting?.id ?? ""), true);
    assert.equal(suggestions.includes(eversoleMeeting?.id ?? ""), true);
    assert.equal(suggestions.includes(willsMeeting?.id ?? ""), true);
    const daytonSuggestions = requiredDecisionFindingIds(OCTOBER_29_REPORTS, { day: thursdayOctober29, shopId: "dayton" });
    assert.equal(daytonSuggestions.includes(clarkMeeting?.id ?? ""), true);
    for (const meeting of coveredMeetings) assert.equal(daytonSuggestions.includes(meeting?.id ?? ""), false);
    const springfieldSuggestions = requiredDecisionFindingIds(OCTOBER_29_REPORTS, { day: thursdayOctober29, shopId: "springfield" });
    assert.equal(springfieldSuggestions.includes(withAndy?.id ?? ""), false);
    assert.equal(springfieldSuggestions.includes(cleaning?.id ?? ""), true);
    assert.equal(requiredDecisionFindingIds(OCTOBER_29_REPORTS, { day: thursdayOctober29, shopId: "columbus" }).length, 0);
  });
});

describe("October 30 download", () => {
  it("keeps the Friday October 30 Details List download, including Travis Hess’s 24-hour placeholder", () => {
    const csv = readFileSync("data/fullbay-timesheets/timesheets-download-2026-10-30.csv", "utf8");
    assert.equal(csv, FRIDAY_OCTOBER_30_DETAILS_CSV);
    const file = parseDetailsListCsv(csv, fridayOctober30);
    assert.equal(file.date, fridayOctober30);
    assert.equal(file.rows.length, 324);
    const byShop = new Map<string, number>();
    for (const record of file.rows) byShop.set(record.shop, (byShop.get(record.shop) ?? 0) + 1);
    assert.equal(byShop.get("The Service Company - Dayton (D)"), 100);
    assert.equal(byShop.get("The Service Company - Greenville (G)"), 72);
    assert.equal(byShop.get("The Service Company - Covington (C)"), 69);
    assert.equal(byShop.get("The Service Company - Springfield (S)"), 43);
    assert.equal(byShop.get("The Service Company - Columbus (CL)"), 40);
    assert.equal(byShop.get("The Service Company-Mobile Units (M)"), undefined);
    const travis = file.rows.filter((record) => record.employee === "Travis Hess");
    assert.equal(travis.length, 1);
    assert.equal(travis[0]?.clock_in, "12:00:00AM 10/30/2026");
    assert.equal(travis[0]?.clock_out, "12:00:00AM 10/31/2026");
    assert.equal(travis[0]?.hours, 24);
    assert.equal(travis[0]?.clock_in_activity, "Inactive");
    assert.equal(travis[0]?.so_complaint, "");
    assert.ok(travis[0]?.shop.includes("Covington"));
    const overnight = file.rows.filter((record) => record.clock_out.includes("10/31/2026") || record.clock_in.includes("10/31/2026"));
    assert.deepEqual(
      overnight.map((record) => record.employee),
      ["Travis Hess"],
    );
    const flora = file.rows.filter((record) => record.employee === "Thomas Flora");
    assert.equal(flora.length, 9);
    assert.ok(flora.every((record) => record.shop.includes("Greenville")));
    assert.equal(
      flora.filter((record) => !record.so_complaint.trim()).reduce((sum, record) => sum + record.hours, 0),
      9.42,
    );
    const floraOrders = flora.filter((record) => record.so_complaint.trim());
    assert.equal(floraOrders.length, 7);
    assert.equal(
      Number(floraOrders.reduce((sum, record) => sum + record.hours, 0).toFixed(2)),
      1.95,
    );
    const kevin = file.rows.filter((record) => record.employee === "Kevin Neal");
    assert.equal(kevin.length, 1);
    assert.ok(kevin.every((record) => record.shop.includes("Covington")));
    assert.equal(kevin.filter((record) => record.so_complaint.trim()).length, 0);
    assert.equal(kevin[0]?.hours, 10.26);
    assert.equal(file.rows.filter((record) => record.employee === "James Benedict").length, 0);
    assert.equal(file.rows.filter((record) => record.employee === "Isaac Stockslager").length, 0);
    assert.equal(file.rows.filter((record) => record.shop === "The Service Company-Mobile Units (M)").length, 0);
    const open = file.rows.filter((record) => record.open_punch);
    assert.equal(open.length, 0);
  });

  it("adds Friday October 30 without replacing the earlier loaded days", () => {
    assert.equal(SEED.filter((report) => report.day === "2026-10-02").length, OCTOBER_2_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === "2026-10-03").length, OCTOBER_3_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === monday).length, OCTOBER_5_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesday).length, OCTOBER_6_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesday).length, OCTOBER_7_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursday).length, OCTOBER_8_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober9).length, OCTOBER_9_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober10).length, OCTOBER_10_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober12).length, OCTOBER_12_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober13).length, OCTOBER_13_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober14).length, OCTOBER_14_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober15).length, OCTOBER_15_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober16).length, OCTOBER_16_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober17).length, OCTOBER_17_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober19).length, OCTOBER_19_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober20).length, OCTOBER_20_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober21).length, OCTOBER_21_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober22).length, OCTOBER_22_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober23).length, OCTOBER_23_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === saturdayOctober24).length, OCTOBER_24_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === mondayOctober26).length, OCTOBER_26_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === tuesdayOctober27).length, OCTOBER_27_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === wednesdayOctober28).length, OCTOBER_28_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === thursdayOctober29).length, OCTOBER_29_REPORTS.length);
    assert.equal(SEED.filter((report) => report.day === fridayOctober30).length, OCTOBER_30_REPORTS.length);
    assert.equal(SEED.some((report) => report.day === "2026-10-11"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-18"), false);
    assert.equal(SEED.some((report) => report.day === "2026-10-25"), false);
  });

  it("builds Friday October 30 for the shops with service-order time, without foremen, the placeholder, or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_30_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "columbus"],
    );
    assert.ok(OCTOBER_30_REPORTS.every((report) => report.day === fridayOctober30));
    assert.deepEqual(namesOn(OCTOBER_30_REPORTS, "dayton"), [
      "Brayden Mapp",
      "Chris Clark",
      "Colby Purvis",
      "Cole Lozan",
      "Jeff Haney",
      "Tanveer Dhaliwal",
      "Zach Spencer",
    ]);
    assert.deepEqual(namesOn(OCTOBER_30_REPORTS, "covington"), ["Anthony Montgomery", "Cline Wirick", "Dane Shelton", "Joe Hueber", "Kody Peters", "Oliver Todd"]);
    assert.deepEqual(namesOn(OCTOBER_30_REPORTS, "greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman"]);
    assert.deepEqual(namesOn(OCTOBER_30_REPORTS, "springfield"), ["Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(namesOn(OCTOBER_30_REPORTS, "columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);
    assert.equal(namesOn(OCTOBER_30_REPORTS, "mobile").length, 0);
    const techs = OCTOBER_30_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 25);
    const dropped = ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Travis Hess"];
    assert.equal(
      techs.some((tech) => dropped.includes(tech.name)),
      false,
    );
    assert.deepEqual(
      techs.filter((tech) => tech.clockedHours >= 14).map((tech) => tech.id),
      [],
    );
    assert.deepEqual(
      Object.fromEntries(
        OCTOBER_30_REPORTS.map((report) => [
          report.shopId,
          {
            techs: report.technicians.length,
            findings: report.findings.length,
            suggestions: requiredDecisionFindingIds(OCTOBER_30_REPORTS, { day: report.day, shopId: report.shopId }).length,
          },
        ]),
      ),
      {
        dayton: { techs: 7, findings: 99, suggestions: 15 },
        covington: { techs: 6, findings: 63, suggestions: 8 },
        greenville: { techs: 5, findings: 59, suggestions: 1 },
        springfield: { techs: 3, findings: 52, suggestions: 14 },
        columbus: { techs: 4, findings: 36, suggestions: 3 },
      },
    );
    const clark = techs.find((tech) => tech.id === "chris-clark");
    assert.equal(clark?.clockedHours, 10.15);
    assert.equal(clark?.soHours, 7.41);
    const zach = techs.find((tech) => tech.id === "zach-spencer");
    assert.equal(zach?.clockedHours, 9.13);
    assert.equal(zach?.soHours, 9.13);
    const haney = techs.find((tech) => tech.id === "jeff-haney");
    assert.equal(haney?.shopId, "dayton");
    assert.equal(haney?.clockedHours, 8.97);
    assert.equal(haney?.soHours, 8.06);
    assert.equal(
      OCTOBER_30_REPORTS.some((report) => report.findings.some((finding) => finding.minutes >= 24 * 60)),
      false,
    );
    assert.equal(
      OCTOBER_30_REPORTS.flatMap((report) => report.findings).filter((finding) => finding.forgotClockOut).length,
      0,
    );
    assertReportShape(OCTOBER_30_REPORTS);
  });

  it("keeps covered Non-Pro punches off the suggestion list and reviews the shop meetings", () => {
    assert.equal(
      OCTOBER_30_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "travis-hess")),
      false,
    );
    assert.equal(
      OCTOBER_30_REPORTS.some((report) => report.shopId === "mobile"),
      false,
    );
    const multiShop = OCTOBER_30_REPORTS.flatMap((report) => report.technicians.map((tech) => tech.name));
    assert.equal(new Set(multiShop).size, multiShop.length);
    const dayton = OCTOBER_30_REPORTS.find((report) => report.shopId === "dayton");
    assert.equal(
      OCTOBER_30_REPORTS.some((report) => report.technicians.some((tech) => tech.id === "jeff-haney" && tech.shopId !== "dayton")),
      false,
    );
    const haneyMeeting = dayton?.findings.find((finding) => finding.techId === "jeff-haney" && finding.start === "07:03" && finding.nonPro);
    assert.equal(haneyMeeting?.end, "07:57");
    assert.equal(haneyMeeting?.minutes, 54);
    assert.equal(haneyMeeting?.recommendation, null);
    const clarkMorning = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "07:02" && finding.nonPro);
    assert.equal(clarkMorning?.end, "07:40");
    assert.equal(clarkMorning?.minutes, 38);
    const clarkMidday = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "10:12" && finding.nonPro);
    assert.equal(clarkMidday?.end, "10:27");
    assert.equal(clarkMidday?.minutes, 15);
    const kendall = dayton?.findings.find((finding) => finding.techId === "chris-clark" && finding.start === "17:05" && finding.nonPro);
    assert.equal(kendall?.end, "17:40");
    assert.equal(kendall?.minutes, 35);
    assert.match(kendall?.detail ?? "", /take truck back to kendall/);
    const laptops = dayton?.findings.find((finding) => finding.techId === "cole-lozan" && finding.start === "08:52");
    assert.equal(laptops?.notAGap, true);
    assert.equal(laptops?.end, "09:15");
    assert.equal(laptops?.minutes, 23);
    assert.equal(laptops?.recommendation, null);
    assert.equal(laptops?.suggested, "Covered by Non-Pro. No edit.");
    assert.match(laptops?.detail ?? "", /Update Cummins laptops/);
    const shopHelp = dayton?.findings.find((finding) => finding.techId === "tanveer-dhaliwal" && finding.start === "11:24" && finding.nonPro);
    assert.equal(shopHelp?.end, "11:30");
    assert.equal(shopHelp?.minutes, 6);
    assert.match(shopHelp?.detail ?? "", /shop help/);
    const covington = OCTOBER_30_REPORTS.find((report) => report.shopId === "covington");
    const meetings = [
      { techId: "kody-peters", start: "06:58", end: "07:05", minutes: 7 },
      { techId: "joe-hueber", start: "06:59", end: "07:04", minutes: 5 },
      { techId: "cline-wirick", start: "06:59", end: "07:05", minutes: 6 },
      { techId: "dane-shelton", start: "06:59", end: "07:04", minutes: 5 },
      { techId: "oliver-todd", start: "07:01", end: "07:10", minutes: 9 },
    ].map((expected) => {
      const meeting = covington?.findings.find((finding) => finding.techId === expected.techId && finding.start === expected.start && finding.nonPro);
      assert.equal(meeting?.end, expected.end);
      assert.equal(meeting?.minutes, expected.minutes);
      return meeting;
    });
    const springfield = OCTOBER_30_REPORTS.find((report) => report.shopId === "springfield");
    const andy = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "11:19");
    assert.equal(andy?.notAGap, true);
    assert.equal(andy?.end, "11:52");
    assert.equal(andy?.minutes, 33);
    assert.equal(andy?.recommendation, null);
    assert.equal(andy?.suggested, "Covered by Non-Pro. No edit.");
    assert.match(andy?.detail ?? "", /going after andy/);
    const trash = springfield?.findings.find((finding) => finding.techId === "john-spichty" && finding.start === "14:16");
    assert.equal(trash?.notAGap, true);
    assert.equal(trash?.end, "14:39");
    assert.equal(trash?.minutes, 23);
    assert.equal(trash?.recommendation, null);
    assert.equal(trash?.suggested, "Covered by Non-Pro. No edit.");
    assert.match(trash?.detail ?? "", /taking out the trash/);
    const columbus = OCTOBER_30_REPORTS.find((report) => report.shopId === "columbus");
    const cleaning = columbus?.findings.find((finding) => finding.techId === "justin-winner" && finding.start === "11:43" && finding.nonPro);
    assert.equal(cleaning?.end, "12:03");
    assert.equal(cleaning?.minutes, 20);
    assert.match(cleaning?.detail ?? "", /Cleaning/);
    const cleaningLater = columbus?.findings.find((finding) => finding.techId === "justin-winner" && finding.start === "12:37" && finding.nonPro);
    assert.equal(cleaningLater?.end, "14:07");
    assert.equal(cleaningLater?.minutes, 90);
    assert.match(cleaningLater?.detail ?? "", /cleaning/);
    const cleanShop = columbus?.findings.find((finding) => finding.techId === "stephen-hill" && finding.start === "09:31");
    assert.equal(cleanShop?.notAGap, true);
    assert.equal(cleanShop?.end, "10:10");
    assert.equal(cleanShop?.minutes, 39);
    assert.equal(cleanShop?.recommendation, null);
    assert.equal(cleanShop?.suggested, "Covered by Non-Pro. No edit.");
    assert.match(cleanShop?.detail ?? "", /Clean shop per JB/);
    const greenville = OCTOBER_30_REPORTS.find((report) => report.shopId === "greenville");
    const jackGap = greenville?.findings.find((finding) => finding.techId === "jack-eversole" && finding.start === "07:00" && finding.recommendation);
    assert.equal(jackGap?.end, "07:05");
    assert.equal(jackGap?.minutes, 5);
    assert.equal(jackGap?.recommendation?.orderId, "G-91301");
    const daytonSuggestions = requiredDecisionFindingIds(OCTOBER_30_REPORTS, { day: fridayOctober30, shopId: "dayton" });
    assert.equal(daytonSuggestions.includes(haneyMeeting?.id ?? ""), true);
    assert.equal(daytonSuggestions.includes(clarkMorning?.id ?? ""), true);
    assert.equal(daytonSuggestions.includes(clarkMidday?.id ?? ""), true);
    assert.equal(daytonSuggestions.includes(kendall?.id ?? ""), true);
    assert.equal(daytonSuggestions.includes(shopHelp?.id ?? ""), true);
    assert.equal(daytonSuggestions.includes(laptops?.id ?? ""), false);
    const covingtonSuggestions = requiredDecisionFindingIds(OCTOBER_30_REPORTS, { day: fridayOctober30, shopId: "covington" });
    for (const meeting of meetings) assert.equal(covingtonSuggestions.includes(meeting?.id ?? ""), true);
    const springfieldSuggestions = requiredDecisionFindingIds(OCTOBER_30_REPORTS, { day: fridayOctober30, shopId: "springfield" });
    assert.equal(springfieldSuggestions.includes(andy?.id ?? ""), false);
    assert.equal(springfieldSuggestions.includes(trash?.id ?? ""), false);
    const columbusSuggestions = requiredDecisionFindingIds(OCTOBER_30_REPORTS, { day: fridayOctober30, shopId: "columbus" });
    assert.equal(columbusSuggestions.includes(cleaning?.id ?? ""), true);
    assert.equal(columbusSuggestions.includes(cleaningLater?.id ?? ""), true);
    assert.equal(columbusSuggestions.includes(cleanShop?.id ?? ""), false);
    const greenvilleSuggestions = requiredDecisionFindingIds(OCTOBER_30_REPORTS, { day: fridayOctober30, shopId: "greenville" });
    assert.equal(greenvilleSuggestions.length, 1);
    assert.equal(greenvilleSuggestions.includes(jackGap?.id ?? ""), true);
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
    assert.equal(OCTOBER_3_REPORTS.reduce((sum, report) => sum + report.findings.length, 0), 28);
    assertReportShape(OCTOBER_3_REPORTS);
    const loaded = OCTOBER_3_REPORTS.flatMap((report) => report.technicians.map((tech) => tech.name));
    for (const name of ["Thomas Flora", "James Benedict", "Isaac Stockslager", "Kevin Neal", "Jacob Griffith", "Josh Silva-holley", "Travis Hess"]) {
      assert.equal(loaded.includes(name), false);
    }
  });
});

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Half-open minute windows. Touching at an endpoint is not an overlap. */
function windowsOverlap(start: string, end: string, otherStart: string, otherEnd: string): boolean {
  return clockMinutes(start) < clockMinutes(otherEnd) && clockMinutes(otherStart) < clockMinutes(end);
}

describe("cross-shop service orders", () => {
  it("lists a tech on every shop with their own SO punches, not on a single home shop", () => {
    const reports = timesheetToDayReports({
      date: tuesday,
      rows: [
        row({
          employee: "Split Tech",
          shop: "The Service Company-Mobile Units (M)",
          clock_in: "7:00:00AM 10/6/2026",
          clock_out: "11:00:00AM 10/6/2026",
          hours: 4,
        }),
        row({
          employee: "Split Tech",
          shop: "The Service Company-Mobile Units (M)",
          clock_in: "7:00:00AM 10/6/2026",
          clock_out: "9:00:00AM 10/6/2026",
          hours: 2,
          so_complaint: "M-10 / Onsite",
        }),
        row({
          employee: "Split Tech",
          shop: "The Service Company - Dayton (D)",
          clock_in: "9:00:00AM 10/6/2026",
          clock_out: "5:00:00PM 10/6/2026",
          hours: 8,
          so_complaint: "D-80 / Axle",
        }),
      ],
    });
    const mobile = reports.find((report) => report.shopId === "mobile");
    const dayton = reports.find((report) => report.shopId === "dayton");
    const mobileTech = mobile?.technicians.find((tech) => tech.name === "Split Tech");
    const daytonTech = dayton?.technicians.find((tech) => tech.name === "Split Tech");
    assert.ok(mobileTech);
    assert.ok(daytonTech);
    assert.equal(mobileTech?.soHours, 2);
    assert.equal(mobileTech?.clockedHours, 2);
    assert.equal(mobileTech?.foreignCoveredHours, 2);
    assert.equal(daytonTech?.soHours, 8);
    assert.equal(daytonTech?.clockedHours, 8);
    assert.equal(daytonTech?.foreignCoveredHours, undefined);
    assert.deepEqual(mobile?.orders.map((order) => order.id), ["M-10"]);
    assert.deepEqual(dayton?.orders.map((order) => order.id), ["D-80"]);

    const mobileFindings = mobile?.findings.filter((finding) => finding.techId === "split-tech") ?? [];
    const daytonFindings = dayton?.findings.filter((finding) => finding.techId === "split-tech") ?? [];
    const mobileOwn = mobileFindings.find((finding) => finding.detail.startsWith("M-10 / Onsite"));
    const daytonOwn = daytonFindings.find((finding) => finding.detail.startsWith("D-80 / Axle"));
    assert.equal(mobileOwn?.kind, "as_is");
    assert.equal(mobileOwn?.notAGap, undefined);
    assert.equal(mobileOwn?.recommendation, null);
    assert.equal(daytonOwn?.kind, "as_is");
    assert.equal(daytonOwn?.recommendation, null);

    const mobileContext = mobileFindings.find((finding) => finding.detail.includes("D-80"));
    const daytonContext = daytonFindings.find((finding) => finding.detail.includes("M-10"));
    assert.equal(mobileContext?.notAGap, true);
    assert.equal(mobileContext?.recommendation, null);
    assert.match(mobileContext?.detail ?? "", /Dayton/);
    assert.match(mobileContext?.suggested ?? "", /No edit/);
    assert.equal(daytonContext?.notAGap, true);
    assert.equal(daytonContext?.recommendation, null);
    assert.match(daytonContext?.detail ?? "", /Mobile/);

    assert.equal(
      mobileFindings.some(
        (finding) =>
          finding.recommendation != null &&
          windowsOverlap(finding.recommendation.start, finding.recommendation.end, "09:00", "17:00"),
      ),
      false,
    );
    assert.equal(
      daytonFindings.some((finding) => finding.recommendation != null),
      false,
    );
  });

  it("does not suggest Tuesday edits that overlap another shop's service-order punch", () => {
    const mobile = OCTOBER_6_REPORTS.find((report) => report.shopId === "mobile");
    const springfield = OCTOBER_6_REPORTS.find((report) => report.shopId === "springfield");
    const dayton = OCTOBER_6_REPORTS.find((report) => report.shopId === "dayton");
    const clark = mobile?.findings.filter((finding) => finding.techId === "chris-clark") ?? [];
    const wooten = springfield?.findings.filter((finding) => finding.techId === "mike-wooten") ?? [];

    assert.ok(mobile?.technicians.some((tech) => tech.name === "Chris Clark"));
    assert.ok(dayton?.technicians.some((tech) => tech.name === "Chris Clark"));
    assert.ok(springfield?.technicians.some((tech) => tech.name === "Mike Wooten"));
    assert.ok(dayton?.technicians.some((tech) => tech.name === "Mike Wooten"));
    assert.equal(mobile?.technicians.find((tech) => tech.id === "chris-clark")?.soHours, 7.33);
    assert.equal(mobile?.technicians.find((tech) => tech.id === "chris-clark")?.clockedHours, 8.43);
    assert.equal(mobile?.technicians.find((tech) => tech.id === "chris-clark")?.foreignCoveredHours, 1.06);
    assert.equal(dayton?.technicians.find((tech) => tech.id === "chris-clark")?.soHours, 1.05);
    assert.equal(dayton?.technicians.find((tech) => tech.id === "chris-clark")?.clockedHours, 1.05);
    assert.equal(dayton?.technicians.find((tech) => tech.id === "chris-clark")?.foreignCoveredHours, undefined);
    assert.equal(springfield?.technicians.find((tech) => tech.id === "mike-wooten")?.soHours, 2.16);
    assert.equal(dayton?.technicians.find((tech) => tech.id === "mike-wooten")?.soHours, 5.63);

    const clarkMorning = clark.find((finding) => finding.id === "2026-10-06-mobile-chris-clark-17");
    const clarkAfternoon = clark.find((finding) => finding.id === "2026-10-06-mobile-chris-clark-21");
    const wootenAfternoon = wooten.find((finding) => finding.id === "2026-10-06-springfield-mike-wooten-17");
    assert.equal(clarkMorning?.recommendation?.orderId, "M-90508");
    assert.equal(clarkMorning?.start, "11:52");
    assert.equal(clarkMorning?.end, "12:02");
    assert.equal(
      windowsOverlap(clarkMorning?.start ?? "", clarkMorning?.end ?? "", "12:02", "12:43"),
      false,
    );
    assert.equal(clarkAfternoon?.recommendation?.orderId, "M-90534");
    assert.equal(clarkAfternoon?.start, "14:09");
    assert.equal(clarkAfternoon?.end, "14:17");
    assert.equal(
      windowsOverlap(clarkAfternoon?.start ?? "", clarkAfternoon?.end ?? "", "14:17", "14:39"),
      false,
    );
    assert.equal(
      clark.some((finding) => finding.recommendation != null && finding.start === "11:52" && finding.end === "12:44"),
      false,
    );
    assert.equal(
      clark.some((finding) => finding.recommendation != null && finding.start === "14:09" && finding.end === "14:41"),
      false,
    );
    assert.equal(wootenAfternoon?.recommendation, null);
    assert.equal(wootenAfternoon?.notAGap, true);
    assert.match(wootenAfternoon?.detail ?? "", /Dayton D-89514/);
    assert.equal(
      wooten.some((finding) => finding.recommendation != null && finding.start === "11:31" && finding.end === "17:10"),
      false,
    );
    assert.ok(clark.some((finding) => finding.notAGap && finding.detail.includes("Dayton D-90273") && finding.recommendation == null));

    for (const reports of [OCTOBER_2_REPORTS, OCTOBER_3_REPORTS, OCTOBER_5_REPORTS, OCTOBER_6_REPORTS, OCTOBER_7_REPORTS]) {
      const byTech = new Map<string, { shopId: string; start: string; end: string }[]>();
      for (const report of reports) {
        for (const finding of report.findings) {
          if (finding.kind !== "as_is" || finding.notAGap) continue;
          const key = `${report.day}\0${finding.techId}`;
          const list = byTech.get(key) ?? [];
          list.push({ shopId: report.shopId, start: finding.start, end: finding.end });
          byTech.set(key, list);
        }
      }
      for (const report of reports) {
        for (const finding of report.findings) {
          const recommendation = finding.recommendation;
          if (!recommendation) continue;
          const others = (byTech.get(`${report.day}\0${finding.techId}`) ?? []).filter((span) => span.shopId !== report.shopId);
          const overlap = others.some((span) => windowsOverlap(recommendation.start, recommendation.end, span.start, span.end));
          assert.equal(overlap, false, `${finding.id} overlaps another shop`);
        }
      }
    }
  });
});

describe("Non-Pro review and cross-shop utilization", () => {
  it("scopes Chris Clark’s Thursday Dayton percentage to this shop and does not double-count the day", () => {
    const dayton = OCTOBER_8_REPORTS.find((report) => report.shopId === "dayton");
    const mobile = OCTOBER_8_REPORTS.find((report) => report.shopId === "mobile");
    const daytonTech = dayton?.technicians.find((tech) => tech.id === "chris-clark");
    const mobileTech = mobile?.technicians.find((tech) => tech.id === "chris-clark");
    assert.ok(daytonTech && mobileTech);
    assert.equal(daytonTech.soHours, 1.88);
    assert.equal(daytonTech.clockedHours, 2.46);
    assert.equal(daytonTech.foreignCoveredHours, 10.1);
    assert.equal(formatPercent(daytonTech.soHours / daytonTech.clockedHours), "76.4%");
    assert.equal(mobileTech.soHours, 10.63);
    assert.equal(mobileTech.clockedHours, 11.38);
    assert.equal(mobileTech.foreignCoveredHours, undefined);
    assert.equal(Math.round((daytonTech.clockedHours + mobileTech.clockedHours) * 100) / 100, 13.84);

    const review = dayton?.findings.find((finding) => finding.id === "2026-10-08-dayton-chris-clark-01");
    const unchanged = dayton?.findings.find((finding) => finding.id === "2026-10-08-dayton-chris-clark-04");
    assert.equal(review?.start, "07:00");
    assert.equal(review?.end, "07:18");
    assert.equal(review?.recommendation, null);
    assert.equal(review?.nonPro?.previous, null);
    assert.equal(review?.nonPro?.next?.orderId, "M-90566");
    assert.equal(review?.nonPro?.canSplit, false);
    assert.equal(unchanged?.start, "09:22");
    assert.equal(unchanged?.recommendation?.orderId, "D-90151");
    assert.equal(unchanged?.nonPro, undefined);

    const meeting = mobile?.findings.find((finding) => finding.id === "2026-10-08-mobile-chris-clark-02");
    assert.equal(meeting?.start, "07:50");
    assert.equal(meeting?.nonPro?.canSplit, true);
    assert.equal(meeting?.nonPro?.previous?.orderId, "M-90566");
    assert.equal(meeting?.nonPro?.next?.orderId, "D-90273");
    assert.match(meeting?.nonPro?.next?.work ?? "", /Remove and replace broken/);
  });

  it("offers only the neighbors that exist and hides a side that would overlap", () => {
    const reports = timesheetToDayReports({
      date: thursday,
      rows: [
        row({
          employee: "Overlap Tech",
          shop: "The Service Company - Dayton (D)",
          clock_in: "6:50:00AM 10/8/2026",
          clock_out: "7:30:00AM 10/8/2026",
          hours: 0.67,
          so_complaint: "D-1 / Early",
        }),
        row({
          employee: "Overlap Tech",
          shop: "The Service Company - Dayton (D)",
          clock_in: "7:00:00AM 10/8/2026",
          clock_out: "8:00:00AM 10/8/2026",
          hours: 1,
          so_complaint: "D-2 / Brakes",
        }),
        row({
          employee: "Overlap Tech",
          shop: "The Service Company - Dayton (D)",
          clock_in: "8:00:00AM 10/8/2026",
          clock_out: "8:50:00AM 10/8/2026",
          clock_in_activity: "Normal Non Pro",
          hours: 0.83,
        }),
        row({
          employee: "Overlap Tech",
          shop: "The Service Company - Dayton (D)",
          clock_in: "9:00:00AM 10/8/2026",
          clock_out: "10:00:00AM 10/8/2026",
          hours: 1,
          so_complaint: "D-3 / QC",
        }),
      ],
    });
    const review = reports[0]?.findings.find((finding) => finding.detail.includes("Normal Non Pro"));
    assert.equal(review?.nonPro?.previous, null);
    assert.equal(review?.nonPro?.next?.orderId, "D-3");
    assert.equal(review?.nonPro?.canSplit, false);
    assert.ok(review?.nonPro?.orders.some((order) => order.orderId === "D-2"));
  });
});

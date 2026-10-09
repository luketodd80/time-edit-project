import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { FRIDAY_DETAILS_CSV } from "@/lib/friday-details-csv";
import { SATURDAY_DETAILS_CSV } from "@/lib/saturday-details-csv";
import { MONDAY_DETAILS_CSV } from "@/lib/monday-details-csv";
import { TUESDAY_DETAILS_CSV } from "@/lib/tuesday-details-csv";
import { WEDNESDAY_DETAILS_CSV } from "@/lib/wednesday-details-csv";
import { THURSDAY_DETAILS_CSV } from "@/lib/thursday-details-csv";
import {
  FOREMEN,
  OCTOBER_2_REPORTS,
  OCTOBER_3_REPORTS,
  OCTOBER_5_REPORTS,
  OCTOBER_6_REPORTS,
  OCTOBER_7_REPORTS,
  OCTOBER_8_REPORTS,
  OPEN_PUNCH_NOTE,
  isForeman,
  parseDetailsListCsv,
  shopIdForOrderId,
  shopIdForTimesheetShop,
  timesheetToDayReports,
  type FullbayTimesheetRow,
} from "@/lib/fullbay-timesheet";
import { SEED } from "@/lib/seed";
import type { DayReport } from "@/lib/types";

const monday = "2026-10-05";
const tuesday = "2026-10-06";
const wednesday = "2026-10-07";
const thursday = "2026-10-08";

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
    assert.match(clean?.suggested ?? "", /Do not move a clock-in/);

    const meeting = OCTOBER_6_REPORTS.find((report) => report.shopId === "mobile")?.findings.find(
      (finding) => finding.techId === "jeff-haney" && finding.detail.includes("Shop Meeting"),
    );
    assert.equal(meeting?.recommendation, null);
    assert.equal((meeting?.suggested ?? "").includes("Start "), false);

    const help = OCTOBER_6_REPORTS.find((report) => report.shopId === "dayton")?.findings.find(
      (finding) => finding.techId === "tanveer-dhaliwal" && finding.detail.includes("helping cole"),
    );
    assert.equal(help?.recommendation?.orderId, "D-90354");
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
    assert.match(trash?.suggested ?? "", /Do not move a clock-in/);

    const jeff = OCTOBER_7_REPORTS.find((report) => report.shopId === "mobile")?.findings.filter(
      (finding) => finding.techId === "jeff-haney",
    );
    const beforeMeeting = jeff?.find((finding) => finding.start === "07:13" && finding.end === "07:22");
    assert.equal(beforeMeeting?.recommendation?.orderId, "M-90630");
    assert.match(beforeMeeting?.recommendation?.summary ?? "", /7:22 AM/);
    const meeting = jeff?.find((finding) => finding.detail.includes("Shop Meeting") && finding.start === "07:22");
    assert.equal(meeting?.recommendation, null);
    assert.match(meeting?.suggested ?? "", /Do not move a clock-in/);
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
    assert.match(cleanup?.suggested ?? "", /Do not move a clock-in/);
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
    assert.equal(mobileTech?.clockedHours, 4);
    assert.equal(daytonTech?.soHours, 8);
    assert.equal(daytonTech?.clockedHours, 8);
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
    assert.equal(mobile?.technicians.find((tech) => tech.id === "chris-clark")?.clockedHours, 9.49);
    assert.equal(dayton?.technicians.find((tech) => tech.id === "chris-clark")?.soHours, 1.05);
    assert.equal(dayton?.technicians.find((tech) => tech.id === "chris-clark")?.clockedHours, 1.05);
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

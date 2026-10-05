import assert from "node:assert/strict";
import { describe, it } from "node:test";
import timesheetFile from "../../data/fullbay-timesheets/timesheets-2026-10-05.json";
import {
  FOREMEN,
  OPEN_PUNCH_NOTE,
  isForeman,
  shopIdForTimesheetShop,
  timesheetToDayReports,
  OCTOBER_5_REPORTS,
  type FullbayTimesheetRow,
} from "@/lib/fullbay-timesheet";
import { SEED } from "@/lib/seed";

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

describe("October 5 scrape", () => {
  it("keeps the attached timesheet as the source file", () => {
    assert.equal(timesheetFile.date, monday);
    assert.equal(timesheetFile.row_count, 187);
    assert.equal(timesheetFile.rows.length, 187);
    assert.equal(timesheetFile.footer_total_hours, 282.65);
  });

  it("builds one Monday report per shop in the file, without foremen or zero-SO techs", () => {
    assert.deepEqual(
      OCTOBER_5_REPORTS.map((report) => report.shopId),
      ["dayton", "covington", "greenville", "springfield", "mobile", "columbus"],
    );
    assert.ok(OCTOBER_5_REPORTS.every((report) => report.day === monday));
    assert.deepEqual(names("dayton"), ["Brayden Mapp", "Colby Purvis", "Cole Lozan", "Dakota Stone", "Zach Spencer"]);
    assert.deepEqual(names("covington"), ["Anthony Montgomery", "Cline Wirick", "Dane Shelton", "Joe Hueber", "Oliver Todd"]);
    assert.deepEqual(names("greenville"), ["Cody Kester", "David Johnson", "Gage Wills", "Jack Eversole", "Kyle Hickman", "Paul Henry"]);
    assert.deepEqual(names("springfield"), ["Gary Evans", "John Spichty", "Mike Wooten"]);
    assert.deepEqual(names("mobile"), ["Chris Clark"]);
    assert.deepEqual(names("columbus"), ["Derek Roby", "Griffin Davis", "Justin Winner", "Stephen Hill"]);

    const techs = OCTOBER_5_REPORTS.flatMap((report) => report.technicians);
    assert.equal(techs.length, 24);
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
  });

  it("leaves the Friday Dayton curated report untouched and reviews Cole from the scrape", () => {
    const friday = SEED.filter((report) => report.day === "2026-10-02");
    assert.equal(friday.length, 1);
    assert.equal(friday[0]?.shopId, "dayton");
    assert.deepEqual(
      friday[0]?.technicians.map((tech) => tech.id),
      ["nick-sontag", "brayden-mapp", "colby-purvis", "zach-spencer", "cole-lozan", "tanveer-dhaliwal"],
    );

    const dayton = OCTOBER_5_REPORTS.find((report) => report.shopId === "dayton");
    assert.ok(dayton);
    const cole = dayton.technicians.find((tech) => tech.id === "cole-lozan");
    assert.equal(cole?.clockedHours, 5.55);
    assert.equal(cole?.soHours, 5.34);
    const gap = dayton.findings.find((finding) => finding.techId === "cole-lozan" && finding.detail.includes("Normal Non Pro"));
    assert.equal(gap?.kind, "gap");
    assert.equal(gap?.recommendation?.orderId, "D-90228");

    const zach = dayton.findings.filter((finding) => finding.techId === "zach-spencer");
    assert.ok(zach.some((finding) => finding.kind === "as_is" && finding.detail.includes("D-90148")));
    assert.equal(
      zach.some((finding) => finding.kind === "gap" || finding.kind === "flag"),
      false,
    );

    const mike = OCTOBER_5_REPORTS.find((report) => report.shopId === "springfield")?.findings.find(
      (finding) => finding.techId === "mike-wooten" && finding.detail.includes(OPEN_PUNCH_NOTE),
    );
    assert.equal(mike?.kind, "gap");
    assert.match(mike?.recommendation?.summary ?? "", /not a clock-out/);
  });

  it("keeps Monday orders on priorities and points every edit at an order on that shop", () => {
    for (const report of OCTOBER_5_REPORTS) {
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
  });
});

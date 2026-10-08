import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayPunches } from "@/lib/day-punches";
import type { FullbayEditBatch } from "@/lib/fullbay-edit-queue";
import type { DayReport, Decision } from "@/lib/types";

const day = "2026-10-06";
const findingId = `${day}-mobile-chris-clark-21`;
const accept: Decision = { kind: "accept", start: "", end: "" };
const reject: Decision = { kind: "reject", start: "", end: "" };

function report(): DayReport {
  return {
    day,
    shopId: "mobile",
    technicians: [],
    orders: [],
    findings: [
      {
        id: `${day}-mobile-chris-clark-as`,
        day,
        shopId: "mobile",
        techId: "chris-clark",
        kind: "as_is",
        start: "13:19",
        end: "14:09",
        minutes: 50,
        detail: "M-90534 / Rear brakes.",
        recommendation: null,
      },
      {
        id: findingId,
        day,
        shopId: "mobile",
        techId: "chris-clark",
        kind: "gap",
        start: "14:09",
        end: "14:17",
        minutes: 8,
        detail: "Gap before the next punch.",
        recommendation: {
          orderId: "M-90534",
          work: "Rear brakes",
          start: "14:09",
          end: "14:17",
          minutes: 8,
          summary: "Keep M-90534 until 2:17 PM. The timesheet has no service order on this stretch.",
        },
      },
      {
        id: `${day}-mobile-chris-clark-foreign`,
        day,
        shopId: "mobile",
        techId: "chris-clark",
        kind: "as_is",
        start: "14:17",
        end: "14:39",
        minutes: 0,
        notAGap: true,
        detail: "Dayton D-90273 / Rear axle. On that shop’s service order, so this stretch is covered.",
        recommendation: null,
      },
    ],
  };
}

describe("day punches after edits", () => {
  it("shows accepted, applied, and rejected clock-outs plus another shop's punch", () => {
    const accepted = dayPunches(report(), "chris-clark", { [findingId]: accept }, []);
    const moved = accepted.find((punch) => punch.orderId === "M-90534");
    assert.ok(moved);
    assert.equal(moved.clockIn, "13:19");
    assert.equal(moved.clockOut, "14:17");
    assert.equal(moved.originalClockOut, "14:09");
    assert.equal(moved.editStatus, "accepted");

    const context = accepted.find((punch) => punch.orderId === "D-90273");
    assert.ok(context);
    assert.equal(context.contextShop, "Dayton");
    assert.equal(context.work, "Rear axle");
    assert.equal(context.clockIn, "14:17");
    assert.equal(context.clockOut, "14:39");
    assert.equal(context.editStatus, null);

    const appliedBatch: FullbayEditBatch = {
      id: "batch-1",
      submittedAt: "2026-10-07T12:00:00.000Z",
      shopId: "mobile",
      days: [day],
      edits: [
        {
          findingId,
          day,
          shopId: "mobile",
          shopName: "Mobile",
          techName: "Chris Clark",
          orderId: "M-90534",
          work: "Rear brakes",
          decision: "accept",
          newClockIn: "14:09",
          newClockOut: "14:17",
          minutes: 8,
          status: "applied",
          appliedAt: "2026-10-07T13:00:00.000Z",
          applyNote: null,
        },
      ],
    };
    const applied = dayPunches(report(), "chris-clark", { [findingId]: accept }, [appliedBatch]);
    assert.equal(applied.find((punch) => punch.orderId === "M-90534")?.editStatus, "applied");

    const rejected = dayPunches(report(), "chris-clark", { [findingId]: reject }, []);
    const stayed = rejected.find((punch) => punch.orderId === "M-90534");
    assert.ok(stayed);
    assert.equal(stayed.clockOut, "14:09");
    assert.equal(stayed.originalClockOut, null);
    assert.equal(stayed.suggestedClockOut, "14:17");
    assert.equal(stayed.editStatus, "rejected");
    assert.equal(rejected.find((punch) => punch.orderId === "D-90273")?.contextShop, "Dayton");

    const alreadyBatch: FullbayEditBatch = {
      ...appliedBatch,
      id: "batch-2",
      edits: [{
        ...appliedBatch.edits[0]!,
        status: "already_done",
        applyNote: "False gap. Time is on another shop's SO.",
        currentClockIn: "14:09",
        currentClockOut: "14:17",
      }],
    };
    const already = dayPunches(report(), "chris-clark", { [findingId]: accept }, [alreadyBatch]);
    const unchanged = already.find((punch) => punch.orderId === "M-90534");
    assert.ok(unchanged);
    assert.equal(unchanged.clockOut, "14:09");
    assert.equal(unchanged.originalClockOut, null);
    assert.equal(unchanged.editStatus, "already_done");
    assert.equal(unchanged.applyNote, "False gap. Time is on another shop's SO.");
    assert.equal(unchanged.currentClockIn, "14:09");
    assert.equal(unchanged.currentClockOut, "14:17");
  });
});

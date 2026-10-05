import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CURATED_FRIDAY } from "@/lib/curated-friday";
import {
  applyConfirmations,
  pendingBatches,
  queueEditFromPlanned,
  signoffApplyBlock,
  submissionToQueueRequest,
  type FullbayEditBatch,
} from "@/lib/fullbay-edit-queue";
import { confirmQueuedBatch, enqueueBatch, readQueue } from "@/lib/fullbay-edit-queue-store";
import { buildSubmission } from "@/lib/review";
import type { Decision } from "@/lib/types";

const friday = "2026-10-02";
const accept: Decision = { kind: "accept", start: "", end: "" };
const reject: Decision = { kind: "reject", start: "", end: "" };
const override: Decision = { kind: "override", start: "14:21", end: "15:00" };

describe("fullbay edit queue mapping", () => {
  it("maps accepted and overridden plan rows and leaves rejects out", () => {
    const submission = buildSubmission(
      [CURATED_FRIDAY],
      { "tanveer-1421": accept, "cole-1518": reject, "zach-0629": override },
      "dayton",
      [friday],
      "2026-10-05T15:00:00.000Z",
    );
    const request = submissionToQueueRequest(submission);
    assert.equal(submission.rejected.length, 1);
    assert.deepEqual(
      request.edits.map((edit) => edit.decision).sort(),
      ["accept", "override"],
    );
    const accepted = request.edits.find((edit) => edit.findingId === "tanveer-1421");
    const planned = submission.edits.find((edit) => edit.findingId === "tanveer-1421");
    assert.ok(accepted && planned);
    assert.equal(accepted.newClockIn, planned.start);
    assert.equal(accepted.newClockOut, planned.end);
    assert.equal(accepted.minutes, planned.minutes);
    assert.equal(accepted.shopName, "Dayton");
    assert.equal(accepted.shopId, "dayton");
    assert.equal(accepted.orderId, planned.orderId);
    assert.equal(accepted.work, planned.work);
    assert.equal(accepted.techName, planned.techName);
    assert.equal(accepted.status, "pending");
    assert.equal(accepted.appliedAt, null);
    assert.equal(accepted.applyNote, null);
    assert.throws(() => queueEditFromPlanned(submission.rejected[0]!));
  });

  it("marks confirmed edits applied or failed and leaves the rest pending", () => {
    const batch: FullbayEditBatch = {
      id: "batch-1",
      submittedAt: "2026-10-05T15:00:00.000Z",
      shopId: "springfield",
      days: [friday],
      edits: [
        {
          findingId: "gary-1",
          day: friday,
          shopId: "springfield",
          shopName: "Springfield",
          techName: "Gary Evans",
          orderId: "S-90507",
          work: "Check AC",
          decision: "accept",
          newClockIn: "13:50",
          newClockOut: "14:42",
          minutes: 52,
          status: "pending",
          appliedAt: null,
          applyNote: null,
        },
        {
          findingId: "john-1",
          day: friday,
          shopId: "springfield",
          shopName: "Springfield",
          techName: "John Spichty",
          orderId: "S-90541",
          work: "Brake chamber leaking",
          decision: "override",
          newClockIn: "11:44",
          newClockOut: "11:45",
          minutes: 1,
          status: "pending",
          appliedAt: null,
          applyNote: null,
        },
      ],
    };
    const confirmed = applyConfirmations(
      batch,
      [{ findingId: "gary-1", status: "applied", applyNote: " +1 min overlap bump " }, { findingId: "john-1", status: "failed" }],
      "2026-10-05T16:00:00.000Z",
    );
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    const gary = confirmed.batch.edits.find((edit) => edit.findingId === "gary-1");
    const john = confirmed.batch.edits.find((edit) => edit.findingId === "john-1");
    assert.equal(gary?.status, "applied");
    assert.equal(gary?.appliedAt, "2026-10-05T16:00:00.000Z");
    assert.equal(gary?.applyNote, "+1 min overlap bump");
    assert.equal(john?.status, "failed");
    assert.equal(john?.appliedAt, null);
    assert.equal(signoffApplyBlock([confirmed.batch], friday, "springfield")?.includes("John Spichty S-90541 (failed)"), true);
    assert.equal(signoffApplyBlock([batch], friday, "dayton"), null);
    const appliedOnly = applyConfirmations(confirmed.batch, [{ findingId: "john-1", status: "applied" }], "2026-10-05T17:00:00.000Z");
    assert.equal(appliedOnly.ok, true);
    if (!appliedOnly.ok) return;
    assert.equal(signoffApplyBlock([appliedOnly.batch], friday, "springfield"), null);
    const unknown = applyConfirmations(batch, [{ findingId: "missing", status: "applied" }], "2026-10-05T16:00:00.000Z");
    assert.equal(unknown.ok, false);
  });

  it("blocks sign-off on the latest batch for that shop day and ignores an older pending batch", () => {
    const older: FullbayEditBatch = {
      id: "older",
      submittedAt: "2026-10-05T15:00:00.000Z",
      shopId: "springfield",
      days: [friday],
      edits: [
        {
          findingId: "gary-1",
          day: friday,
          shopId: "springfield",
          shopName: "Springfield",
          techName: "Gary Evans",
          orderId: "S-90507",
          work: "Check AC",
          decision: "accept",
          newClockIn: "13:50",
          newClockOut: "14:42",
          minutes: 52,
          status: "pending",
          appliedAt: null,
          applyNote: null,
        },
      ],
    };
    const newer: FullbayEditBatch = { ...older, id: "newer", submittedAt: "2026-10-05T18:00:00.000Z", edits: [] };
    assert.equal(signoffApplyBlock([older, newer], friday, "springfield"), null);
    assert.equal(signoffApplyBlock([], friday, "springfield"), null);
  });
});

describe("fullbay edit queue file", () => {
  it("stores a pending batch and confirms one edit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fullbay-edit-queue-"));
    const previous = process.env.FULLBAY_EDIT_QUEUE_PATH;
    process.env.FULLBAY_EDIT_QUEUE_PATH = join(directory, "queue.json");
    try {
      const stored = await enqueueBatch({
        submittedAt: "2026-10-05T15:00:00.000Z",
        shopId: "springfield",
        days: [friday],
        edits: [
          {
            findingId: "gary-1",
            day: friday,
            shopId: "springfield",
            shopName: "Springfield",
            techName: "Gary Evans",
            orderId: "S-90507",
            work: "Check AC",
            decision: "accept",
            newClockIn: "13:51",
            newClockOut: "14:56",
            minutes: 65,
            status: "pending",
            appliedAt: null,
            applyNote: null,
          },
        ],
      });
      assert.equal(pendingBatches(await readQueue()).length, 1);
      const confirmed = await confirmQueuedBatch(stored.id, [{ findingId: "gary-1", status: "applied", applyNote: "matched" }], "2026-10-05T16:00:00.000Z");
      assert.equal(confirmed.ok, true);
      if (!confirmed.ok) return;
      assert.equal(confirmed.batch.edits[0]?.status, "applied");
      assert.equal(confirmed.batch.edits[0]?.applyNote, "matched");
      assert.equal(pendingBatches(await readQueue()).length, 0);
    } finally {
      if (previous === undefined) delete process.env.FULLBAY_EDIT_QUEUE_PATH;
      else process.env.FULLBAY_EDIT_QUEUE_PATH = previous;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

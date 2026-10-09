import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CURATED_FRIDAY } from "@/lib/curated-friday";
import {
  AUTO_SIGNOFF_NOTE,
  applyConfirmations,
  parseQueueRequest,
  pendingBatches,
  queueEditFromPlanned,
  queueRequestForSubmit,
  shopDayLock,
  shopDaysCovered,
  shopDaysToAutoSignOff,
  editsForSubmit,
  editAddsNoJobTime,
  editIsResolved,
  findingCanBeDecided,
  latestQueueEdit,
  minutesPickedUp,
  reviewApplyText,
  signoffApplyBlock,
  submissionToQueueRequest,
  submitRefusal,
  type FullbayEditBatch,
  type FullbayQueueEdit,
  type ShopDayRef,
} from "@/lib/fullbay-edit-queue";
import { confirmQueuedBatch, enqueueBatch, queueFilePath, readQueue } from "@/lib/fullbay-edit-queue-store";
import { readSignoffs, recordAutoSignoffs, recordSignoff, signoffFilePath } from "@/lib/signoff-store";
import { buildSubmission, requiredDecisionFindingIds } from "@/lib/review";
import { SEED } from "@/lib/seed";
import type { Decision, ShopId } from "@/lib/types";

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
    assert.deepEqual(
      request.decided?.map((item) => item.findingId).sort(),
      ["cole-1518", "tanveer-1421", "zach-0629"],
    );
    assert.equal(request.decided?.some((item) => item.findingId === "tanveer-1300"), false);
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

    const already = applyConfirmations(
      batch,
      [{
        findingId: "gary-1",
        status: "already_done",
        applyNote: " Andy closed this gap ",
        currentClockIn: "06:54",
        currentClockOut: "08:12",
      }],
      "2026-10-05T18:00:00.000Z",
    );
    assert.equal(already.ok, true);
    if (!already.ok) return;
    const closed = already.batch.edits.find((edit) => edit.findingId === "gary-1");
    assert.equal(closed?.status, "already_done");
    assert.equal(closed?.appliedAt, "2026-10-05T18:00:00.000Z");
    assert.equal(closed?.applyNote, "Andy closed this gap");
    assert.equal(closed?.currentClockIn, "06:54");
    assert.equal(closed?.currentClockOut, "08:12");
    assert.equal(signoffApplyBlock([already.batch], friday, "springfield")?.includes("John Spichty"), true);
    const bothResolved = applyConfirmations(
      already.batch,
      [{ findingId: "john-1", status: "already_done", applyNote: "False gap. Time is on another shop's SO." }],
      "2026-10-05T18:05:00.000Z",
    );
    assert.equal(bothResolved.ok, true);
    if (!bothResolved.ok) return;
    assert.equal(signoffApplyBlock([bothResolved.batch], friday, "springfield"), null);
    assert.equal(
      reviewApplyText(bothResolved.batch.edits.find((edit) => edit.findingId === "gary-1")!),
      "Already updated in Fullbay (edited manually). Andy closed this gap. Current times 6:54 AM–8:12 AM",
    );
    assert.equal(
      reviewApplyText(bothResolved.batch.edits.find((edit) => edit.findingId === "john-1")!),
      "Already updated in Fullbay (edited manually). False gap. Time is on another shop's SO.",
    );
    const punctuated = { ...bothResolved.batch.edits.find((edit) => edit.findingId === "gary-1")!, applyNote: "No edit made." };
    assert.equal(
      reviewApplyText(punctuated),
      "Already updated in Fullbay (edited manually). No edit made. Current times 6:54 AM–8:12 AM",
    );
    assert.equal(findingCanBeDecided([bothResolved.batch], "gary-1"), false);
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

describe("submit lock", () => {
  const tuesday = "2026-10-06";

  function batch(shopId: FullbayEditBatch["shopId"], days: string[], id = "batch"): FullbayEditBatch {
    return { id, submittedAt: "2026-10-07T12:00:00.000Z", shopId, days, edits: [] };
  }

  it("refuses a shop and day that is already submitted or signed off", () => {
    const dayton = batch("dayton", [tuesday]);
    assert.match(submitRefusal([dayton], [], { shopId: "dayton", days: [tuesday] }) ?? "", /Already submitted: Dayton 2026-10-06/);
    assert.equal(submitRefusal([dayton], [], { shopId: "mobile", days: [tuesday] }), null);
    assert.equal(submitRefusal([dayton], [], { shopId: "dayton", days: ["2026-10-05"] }), null);

    const allShops = batch("all", [tuesday], "all-shops");
    assert.match(submitRefusal([allShops], [], { shopId: "mobile", days: [tuesday] }) ?? "", /Already submitted: Mobile 2026-10-06/);
    assert.match(submitRefusal([dayton], [], { shopId: "all", days: [tuesday] }) ?? "", /Already submitted: Dayton 2026-10-06/);

    const signoffs = [{ day: tuesday, shopId: "dayton" as const, doneAt: "2026-10-07T15:00:00.000Z" }];
    assert.match(submitRefusal([], signoffs, { shopId: "dayton", days: [tuesday] }) ?? "", /Already signed off: Dayton 2026-10-06/);
    assert.match(
      submitRefusal([dayton], signoffs, { shopId: "dayton", days: [tuesday] }) ?? "",
      /Already signed off: Dayton 2026-10-06/,
    );
    assert.match(
      submitRefusal([], signoffs, {
        shopId: "mobile",
        days: ["2026-10-05"],
        edits: [{ day: tuesday, shopId: "dayton" }],
      }) ?? "",
      /Already signed off: Dayton 2026-10-06/,
    );
    assert.equal(shopDayLock([dayton], [], tuesday, "dayton"), "submitted");
    assert.equal(shopDayLock([], signoffs, tuesday, "dayton"), "signed-off");
    assert.equal(shopDayLock([dayton], signoffs, tuesday, "dayton"), "signed-off");
    assert.equal(shopDayLock([], [], tuesday, "mobile"), "open");
  });

  it("shows the latest applied or failed confirm for a finding", () => {
    const findingId = "2026-10-06-mobile-chris-clark-15";
    function edit(status: FullbayQueueEdit["status"], note: string | null, clockIn = "11:49"): FullbayQueueEdit {
      return {
        findingId,
        day: tuesday,
        shopId: "mobile",
        shopName: "Mobile",
        techName: "Chris Clark",
        orderId: "M-90508",
        work: "Replace rear light",
        decision: "accept",
        newClockIn: clockIn,
        newClockOut: "11:50",
        minutes: 1,
        status,
        appliedAt: status === "applied" ? "2026-10-07T12:15:00.000Z" : null,
        applyNote: note,
      };
    }
    const earlier = batch("mobile", [tuesday], "earlier");
    earlier.submittedAt = "2026-10-07T11:00:00.000Z";
    earlier.edits = [edit("pending", null)];
    const applied = batch("mobile", [tuesday], "applied");
    applied.submittedAt = "2026-10-07T12:00:00.000Z";
    applied.edits = [edit("applied", "+1 min overlap bump")];
    const other = batch("mobile", [tuesday], "other");
    other.edits = [edit("applied", "other finding", "08:00")];
    other.edits[0]!.findingId = "someone-else";

    assert.equal(latestQueueEdit([earlier, applied, other], findingId)?.status, "applied");
    assert.equal(latestQueueEdit([applied], "missing"), null);
    assert.equal(reviewApplyText(applied.edits[0]!), "Edits already updated");
    assert.equal(reviewApplyText(earlier.edits[0]!), "Waiting on Fullbay.");
    assert.equal(findingCanBeDecided([applied], findingId), false);
    assert.equal(findingCanBeDecided([earlier], findingId), false);
    assert.equal(findingCanBeDecided([], findingId), true);

    const failed = edit("failed", "Clock out overlaps the next punch");
    assert.equal(reviewApplyText(failed), "Fullbay apply failed. Clock out overlaps the next punch");
    assert.equal(reviewApplyText(edit("failed", null)), "Fullbay apply failed.");
    assert.equal(findingCanBeDecided([{ ...applied, edits: [failed] }], findingId), true);

    const failedBatch = batch("mobile", [tuesday], "failed-batch");
    failedBatch.edits = [failed];
    const retry = { findingId, day: tuesday, shopId: "mobile" as const };
    assert.equal(submitRefusal([failedBatch], [], { shopId: "mobile", days: [tuesday], edits: [retry] }), null);
    assert.equal(
      submitRefusal([failedBatch], [], { shopId: "mobile", days: [tuesday], edits: [{ ...retry, findingId: "never-pushed" }] }),
      null,
    );
    assert.match(
      submitRefusal([applied], [], { shopId: "mobile", days: [tuesday], edits: [retry] }) ?? "",
      /Already submitted: Mobile 2026-10-06/,
    );
    assert.match(submitRefusal([earlier], [], { shopId: "mobile", days: [tuesday], edits: [retry] }) ?? "", /Already submitted: Mobile 2026-10-06/);
    assert.equal(
      editsForSubmit([failedBatch], [retry, { findingId: "never-pushed", day: tuesday, shopId: "mobile" }]).map((item) => item.findingId).join(","),
      `${findingId},never-pushed`,
    );
    assert.equal(editsForSubmit([applied], [{ findingId, day: tuesday, shopId: "mobile" }]).length, 0);

    const doneAlready = edit("already_done", "Closed in Fullbay");
    doneAlready.currentClockIn = "11:40";
    const alreadyBatch = batch("mobile", [tuesday], "already");
    alreadyBatch.edits = [doneAlready];
    assert.equal(findingCanBeDecided([alreadyBatch], findingId), false);
    assert.equal(editsForSubmit([alreadyBatch], [retry]).length, 0);
    assert.match(
      submitRefusal([alreadyBatch], [], { shopId: "mobile", days: [tuesday], edits: [retry] }) ?? "",
      /Already submitted: Mobile 2026-10-06/,
    );
    assert.equal(reviewApplyText(doneAlready), "Already updated in Fullbay (edited manually). Closed in Fullbay. Current clock-in 11:40 AM");
  });
});

function sampleEdit(findingId: string, day: string, shopId: ShopId, status: FullbayQueueEdit["status"]): FullbayQueueEdit {
  return {
    findingId,
    day,
    shopId,
    shopName: shopId,
    techName: "Tech",
    orderId: "D-1",
    work: "Work",
    decision: "accept",
    newClockIn: "08:00",
    newClockOut: "09:00",
    minutes: 60,
    status,
    appliedAt: status === "applied" ? "2026-10-07T16:00:00.000Z" : null,
    applyNote: status === "failed" ? "nope" : null,
  };
}

function batch(
  id: string,
  edits: FullbayQueueEdit[],
  decided: { findingId: string; day: string; shopId: ShopId }[] = [],
  shopId: FullbayEditBatch["shopId"] = "dayton",
): FullbayEditBatch {
  return {
    id,
    submittedAt: "2026-10-07T15:00:00.000Z",
    shopId,
    days: [friday],
    edits,
    decided: decided.map((item) => ({ findingId: item.findingId, day: item.day, shopId: item.shopId })),
  };
}

describe("auto sign-off", () => {
  const scope: ShopDayRef[] = [{ day: friday, shopId: "dayton" }];
  const required = () => ["a", "b"];
  const decided = [
    { findingId: "a", day: friday, shopId: "dayton" as const },
    { findingId: "b", day: friday, shopId: "dayton" as const },
  ];

  it("signs off when accepted edits are applied or already done", () => {
    const ready = shopDaysToAutoSignOff(
      [batch("1", [sampleEdit("a", friday, "dayton", "applied"), sampleEdit("b", friday, "dayton", "already_done")], decided)],
      scope,
      required,
    );
    assert.deepEqual(ready, scope);
  });

  it("signs off when every finding is decided and every accepted edit is applied", () => {
    const ready = shopDaysToAutoSignOff(
      [batch("1", [sampleEdit("a", friday, "dayton", "applied"), sampleEdit("b", friday, "dayton", "applied")], decided)],
      scope,
      required,
    );
    assert.deepEqual(ready, scope);
  });

  it("stays open when an edit failed or is still pending", () => {
    const failed = shopDaysToAutoSignOff(
      [batch("1", [sampleEdit("a", friday, "dayton", "applied"), sampleEdit("b", friday, "dayton", "failed")], decided)],
      scope,
      required,
    );
    const pending = shopDaysToAutoSignOff(
      [batch("1", [sampleEdit("a", friday, "dayton", "applied"), sampleEdit("b", friday, "dayton", "pending")], decided)],
      scope,
      required,
    );
    assert.deepEqual(failed, []);
    assert.deepEqual(pending, []);
  });

  it("stays open when a required finding has no decision", () => {
    const missing = shopDaysToAutoSignOff(
      [batch("1", [sampleEdit("a", friday, "dayton", "applied")], [{ findingId: "a", day: friday, shopId: "dayton" }])],
      scope,
      required,
    );
    assert.deepEqual(missing, []);
  });

  it("signs off an all-reject submit that decided every finding", () => {
    const ready = shopDaysToAutoSignOff([batch("1", [], decided)], scope, required);
    assert.deepEqual(ready, scope);
  });

  it("signs off one finished shop while another shop on the batch is still pending", () => {
    const mobilePending = sampleEdit("m", friday, "mobile", "pending");
    const stored = batch(
      "1",
      [sampleEdit("a", friday, "dayton", "applied"), sampleEdit("b", friday, "dayton", "applied"), mobilePending],
      [
        ...decided,
        { findingId: "m", day: friday, shopId: "mobile" },
      ],
      "all",
    );
    const ready = shopDaysToAutoSignOff([stored], shopDaysCovered("all", [friday]), (pair) =>
      pair.shopId === "dayton" ? ["a", "b"] : pair.shopId === "mobile" ? ["m"] : [],
    );
    assert.deepEqual(ready, [{ day: friday, shopId: "dayton" }]);
  });

  it("counts an applied edit as decided when an older batch stored no decided list", () => {
    const legacy = batch("1", [sampleEdit("a", friday, "dayton", "applied"), sampleEdit("b", friday, "dayton", "applied")]);
    delete legacy.decided;
    assert.deepEqual(shopDaysToAutoSignOff([legacy], scope, required), scope);
    const partial = batch("2", [sampleEdit("a", friday, "dayton", "applied")]);
    delete partial.decided;
    assert.deepEqual(shopDaysToAutoSignOff([partial], scope, required), []);
  });

  it("keeps decided findings when submit drops an already applied edit", () => {
    const applied = batch("1", [sampleEdit("tanveer-1421", friday, "dayton", "applied"), sampleEdit("zach-0629", friday, "dayton", "failed")]);
    const submission = buildSubmission([CURATED_FRIDAY], { "tanveer-1421": accept, "cole-1518": reject, "zach-0629": override }, "dayton", [friday], "2026-10-07T15:00:00.000Z");
    const request = queueRequestForSubmit([applied], submission);
    assert.deepEqual(request.edits.map((edit) => edit.findingId), ["zach-0629"]);
    assert.deepEqual(request.decided?.map((item) => item.findingId).sort(), ["cole-1518", "tanveer-1421", "zach-0629"]);
  });

  it("rejects a decided list that is not findings", () => {
    const parsed = parseQueueRequest({
      submittedAt: "2026-10-07T15:00:00.000Z",
      shopId: "dayton",
      days: [friday],
      edits: [],
      decided: [{ findingId: "", day: friday, shopId: "nope" }],
    });
    assert.equal(parsed.ok, false);
    const absent = parseQueueRequest({
      submittedAt: "2026-10-07T15:00:00.000Z",
      shopId: "dayton",
      days: [friday],
      edits: [],
    });
    assert.equal(absent.ok, true);
    if (absent.ok) assert.deepEqual(absent.value.decided, []);
  });

  it("loads an older edit without nonPro and a Non-Pro payload", () => {
    const older = parseQueueRequest({
      submittedAt: "2026-10-07T15:00:00.000Z",
      shopId: "dayton",
      days: [friday],
      edits: [
        {
          findingId: "legacy",
          day: friday,
          shopId: "dayton",
          techName: "Chris Clark",
          orderId: "D-1",
          work: "Brakes",
          decision: "accept",
          newClockIn: "08:00",
          newClockOut: "09:00",
          minutes: 60,
        },
      ],
    });
    assert.equal(older.ok, true);
    if (older.ok) assert.equal(older.value.edits[0]?.nonPro, undefined);

    const split = parseQueueRequest({
      submittedAt: "2026-10-08T15:00:00.000Z",
      shopId: "dayton",
      days: ["2026-10-08"],
      edits: [
        {
          findingId: "meeting",
          day: "2026-10-08",
          shopId: "dayton",
          techName: "Chris Clark",
          orderId: "D-10",
          work: "Brakes",
          decision: "accept",
          newClockIn: "07:00",
          newClockOut: "08:30",
          minutes: 60,
          nonPro: {
            editType: "split",
            originalClockIn: "08:00",
            originalClockOut: "09:00",
            rows: [
              {
                orderId: "D-10",
                work: "Brakes",
                shopId: "dayton",
                clockIn: "07:00",
                clockOut: "08:00",
                newClockIn: "07:00",
                newClockOut: "08:30",
              },
              {
                orderId: "M-20",
                work: "Onsite",
                shopId: "mobile",
                clockIn: "09:00",
                clockOut: "10:00",
                newClockIn: "08:30",
                newClockOut: "10:00",
              },
            ],
          },
        },
      ],
    });
    assert.equal(split.ok, true);
    if (split.ok) {
      assert.equal(split.value.edits[0]?.nonPro?.editType, "split");
      assert.equal(split.value.edits[0]?.nonPro?.rows.length, 2);
      assert.equal(split.value.edits[0]?.nonPro?.originalClockIn, "08:00");
    }

    const kept = parseQueueRequest({
      submittedAt: "2026-10-08T15:00:00.000Z",
      shopId: "dayton",
      days: ["2026-10-08"],
      edits: [
        {
          findingId: "meeting",
          day: "2026-10-08",
          shopId: "dayton",
          techName: "Chris Clark",
          orderId: "Non-Pro",
          work: "Attendance",
          decision: "accept",
          newClockIn: "08:00",
          newClockOut: "09:00",
          minutes: 0,
          nonPro: { editType: "keep", originalClockIn: "08:00", originalClockOut: "09:00", rows: [] },
        },
      ],
    });
    assert.equal(kept.ok, false);
  });
});

describe("fullbay edit queue file", { concurrency: false }, () => {
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

  it("refuses a second submit for a shop day and a submit after sign-off", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fullbay-submit-lock-"));
    const previousQueue = process.env.FULLBAY_EDIT_QUEUE_PATH;
    const previousSignoff = process.env.SHOP_DAY_SIGNOFF_PATH;
    process.env.FULLBAY_EDIT_QUEUE_PATH = join(directory, "queue.json");
    process.env.SHOP_DAY_SIGNOFF_PATH = join(directory, "signoffs.json");
    const tuesday = "2026-10-06";
    const monday = "2026-10-05";
    try {
      const { POST } = await import("@/app/api/fullbay-edits/route");
      const { POST: postSignoff } = await import("@/app/api/signoffs/route");

      function edit(findingId: string, day: string, shopId: string) {
        return {
          findingId,
          day,
          shopId,
          techName: "Zach Spencer",
          orderId: "D-100",
          work: "Brakes",
          decision: "accept",
          newClockIn: "08:00",
          newClockOut: "09:00",
          minutes: 60,
        };
      }

      async function submit(shopId: string, day: string, findingId: string) {
        return POST(
          new Request("http://127.0.0.1/api/fullbay-edits", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              submittedAt: "2026-10-07T15:00:00.000Z",
              shopId,
              days: [day],
              edits: [edit(findingId, day, shopId === "all" ? "dayton" : shopId)],
            }),
          }),
        );
      }

      const first = await submit("dayton", tuesday, "zach-1");
      assert.equal(first.status, 200);
      const again = await submit("dayton", tuesday, "zach-1");
      assert.equal(again.status, 409);
      const againBody = (await again.json()) as { error?: string };
      assert.match(againBody.error ?? "", /Already submitted: Dayton 2026-10-06/);
      const leftover = await submit("dayton", tuesday, "zach-2");
      assert.equal(leftover.status, 200);

      const otherShop = await submit("mobile", tuesday, "zach-3");
      assert.equal(otherShop.status, 200);
      const otherDay = await submit("dayton", monday, "zach-4");
      assert.equal(otherDay.status, 200);

      const signed = await postSignoff(
        new Request("http://127.0.0.1/api/signoffs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ day: monday, shopId: "covington" }),
        }),
      );
      assert.equal(signed.status, 200);
      const signedBody = (await signed.json()) as { signoff?: { doneAt: string } };
      const repeat = await postSignoff(
        new Request("http://127.0.0.1/api/signoffs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ day: monday, shopId: "covington" }),
        }),
      );
      const repeatBody = (await repeat.json()) as { signoff?: { doneAt: string } };
      assert.equal(repeatBody.signoff?.doneAt, signedBody.signoff?.doneAt);

      const blocked = await submit("covington", monday, "zach-5");
      assert.equal(blocked.status, 409);
      const blockedBody = (await blocked.json()) as { error?: string };
      assert.match(blockedBody.error ?? "", /Already signed off: Covington 2026-10-05/);

      await postSignoff(
        new Request("http://127.0.0.1/api/signoffs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ day: tuesday, shopId: "dayton" }),
        }),
      );
      const signedAfterSubmit = await submit("dayton", tuesday, "zach-6");
      assert.equal(signedAfterSubmit.status, 409);
      const signedAfterBody = (await signedAfterSubmit.json()) as { error?: string };
      assert.match(signedAfterBody.error ?? "", /Already signed off: Dayton 2026-10-06/);
    } finally {
      if (previousQueue === undefined) delete process.env.FULLBAY_EDIT_QUEUE_PATH;
      else process.env.FULLBAY_EDIT_QUEUE_PATH = previousQueue;
      if (previousSignoff === undefined) delete process.env.SHOP_DAY_SIGNOFF_PATH;
      else process.env.SHOP_DAY_SIGNOFF_PATH = previousSignoff;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores a missing live file from the seed and writes new rows to the live path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fullbay-durable-"));
    const disk = join(directory, "disk");
    const previousQueue = process.env.FULLBAY_EDIT_QUEUE_PATH;
    const previousSeed = process.env.FULLBAY_EDIT_QUEUE_SEED_PATH;
    const previousSignoff = process.env.SHOP_DAY_SIGNOFF_PATH;
    const previousSignoffSeed = process.env.SHOP_DAY_SIGNOFF_SEED_PATH;
    const previousDir = process.env.TSC_DATA_DIR;
    const liveQueue = join(directory, "queue.json");
    const seedQueue = join(directory, "queue.seed.json");
    const liveSignoff = join(directory, "signoffs.json");
    const seedSignoff = join(directory, "signoffs.seed.json");
    process.env.FULLBAY_EDIT_QUEUE_PATH = liveQueue;
    process.env.FULLBAY_EDIT_QUEUE_SEED_PATH = seedQueue;
    process.env.SHOP_DAY_SIGNOFF_PATH = liveSignoff;
    process.env.SHOP_DAY_SIGNOFF_SEED_PATH = seedSignoff;
    delete process.env.TSC_DATA_DIR;
    writeFileSync(
      seedQueue,
      `${JSON.stringify({
        batches: [
          {
            id: "seed-batch",
            submittedAt: "2026-10-07T12:00:00.000Z",
            shopId: "mobile",
            days: [friday],
            edits: [
              {
                findingId: "chris-1149",
                day: friday,
                shopId: "mobile",
                shopName: "Mobile",
                techName: "Chris Clark",
                orderId: "M-90508",
                work: "Replace rear light",
                decision: "accept",
                newClockIn: "11:49",
                newClockOut: "11:50",
                minutes: 1,
                status: "applied",
                appliedAt: "2026-10-07T13:00:00.000Z",
                applyNote: "+1 min overlap bump",
              },
            ],
          },
        ],
      })}\n`,
    );
    writeFileSync(
      seedSignoff,
      `${JSON.stringify({ signoffs: [{ day: friday, shopId: "dayton", doneAt: "2026-10-07T14:00:00.000Z" }] })}\n`,
    );
    try {
      assert.equal((await readQueue())[0]?.edits[0]?.status, "applied");
      assert.equal((await readSignoffs())[0]?.doneAt, "2026-10-07T14:00:00.000Z");
      await enqueueBatch({
        submittedAt: "2026-10-07T15:00:00.000Z",
        shopId: "covington",
        days: [friday],
        edits: [],
      });
      const kept = await recordSignoff(friday, "dayton", "2026-10-07T16:00:00.000Z");
      assert.equal(kept.doneAt, "2026-10-07T14:00:00.000Z");
      await recordSignoff(friday, "mobile", "2026-10-07T16:00:00.000Z");
      writeFileSync(seedQueue, `${JSON.stringify({ batches: [] })}\n`);
      writeFileSync(seedSignoff, `${JSON.stringify({ signoffs: [] })}\n`);
      assert.equal((await readQueue()).length, 2);
      assert.equal((await readSignoffs()).length, 2);

      delete process.env.FULLBAY_EDIT_QUEUE_PATH;
      delete process.env.SHOP_DAY_SIGNOFF_PATH;
      process.env.TSC_DATA_DIR = disk;
      assert.equal(queueFilePath(), join(disk, "fullbay-edit-queue.json"));
      assert.equal(signoffFilePath(), join(disk, "shop-day-signoffs.json"));
      await recordSignoff("2026-10-06", "springfield", "2026-10-07T17:00:00.000Z");
      assert.equal((await readSignoffs()).some((signoff) => signoff.shopId === "springfield"), true);
    } finally {
      if (previousQueue === undefined) delete process.env.FULLBAY_EDIT_QUEUE_PATH;
      else process.env.FULLBAY_EDIT_QUEUE_PATH = previousQueue;
      if (previousSeed === undefined) delete process.env.FULLBAY_EDIT_QUEUE_SEED_PATH;
      else process.env.FULLBAY_EDIT_QUEUE_SEED_PATH = previousSeed;
      if (previousSignoff === undefined) delete process.env.SHOP_DAY_SIGNOFF_PATH;
      else process.env.SHOP_DAY_SIGNOFF_PATH = previousSignoff;
      if (previousSignoffSeed === undefined) delete process.env.SHOP_DAY_SIGNOFF_SEED_PATH;
      else process.env.SHOP_DAY_SIGNOFF_SEED_PATH = previousSignoffSeed;
      if (previousDir === undefined) delete process.env.TSC_DATA_DIR;
      else process.env.TSC_DATA_DIR = previousDir;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function seededPair(minFindings: number): { day: string; shopId: ShopId; ids: string[] } {
    let best: { day: string; shopId: ShopId; ids: string[] } | null = null;
    for (const report of SEED) {
      const ids = requiredDecisionFindingIds(SEED, { day: report.day, shopId: report.shopId });
      if (ids.length < minFindings) continue;
      if (!best || ids.length < best.ids.length) best = { day: report.day, shopId: report.shopId, ids };
    }
    assert.ok(best, `expected a seeded shop day with at least ${minFindings} decisions`);
    return best;
  }

  function decidedRows(day: string, shopId: ShopId, ids: string[]) {
    return ids.map((findingId) => ({ findingId, day, shopId }));
  }

  function acceptedEdit(findingId: string, day: string, shopId: ShopId) {
    return {
      findingId,
      day,
      shopId,
      techName: "Tech",
      orderId: "D-1",
      work: "Work",
      decision: "accept",
      newClockIn: "08:00",
      newClockOut: "09:00",
      minutes: 60,
    };
  }

  async function withStores(run: () => Promise<void>) {
    const directory = mkdtempSync(join(tmpdir(), "fullbay-auto-signoff-"));
    const previousQueue = process.env.FULLBAY_EDIT_QUEUE_PATH;
    const previousSignoff = process.env.SHOP_DAY_SIGNOFF_PATH;
    process.env.FULLBAY_EDIT_QUEUE_PATH = join(directory, "queue.json");
    process.env.SHOP_DAY_SIGNOFF_PATH = join(directory, "signoffs.json");
    try {
      await run();
    } finally {
      if (previousQueue === undefined) delete process.env.FULLBAY_EDIT_QUEUE_PATH;
      else process.env.FULLBAY_EDIT_QUEUE_PATH = previousQueue;
      if (previousSignoff === undefined) delete process.env.SHOP_DAY_SIGNOFF_PATH;
      else process.env.SHOP_DAY_SIGNOFF_PATH = previousSignoff;
      rmSync(directory, { recursive: true, force: true });
    }
  }

  it("marks a shop day done at submit when every finding was rejected", async () => {
    await withStores(async () => {
      const pair = seededPair(1);
      const { POST } = await import("@/app/api/fullbay-edits/route");
      const response = await POST(
        new Request("http://127.0.0.1/api/fullbay-edits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submittedAt: "2026-10-07T18:00:00.000Z",
            shopId: pair.shopId,
            days: [pair.day],
            edits: [],
            decided: decidedRows(pair.day, pair.shopId, pair.ids),
          }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { autoSignedOff?: { day: string; shopId: string; doneAt: string; note: string | null }[] };
      assert.equal(body.autoSignedOff?.length, 1);
      assert.equal(body.autoSignedOff?.[0]?.day, pair.day);
      assert.equal(body.autoSignedOff?.[0]?.shopId, pair.shopId);
      assert.equal(body.autoSignedOff?.[0]?.note, AUTO_SIGNOFF_NOTE);
      assert.equal(Number.isNaN(Date.parse(body.autoSignedOff?.[0]?.doneAt ?? "")), false);
      const stored = await readSignoffs();
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.note, AUTO_SIGNOFF_NOTE);
      assert.equal(stored[0]?.doneAt, body.autoSignedOff?.[0]?.doneAt);

      const again = await POST(
        new Request("http://127.0.0.1/api/fullbay-edits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submittedAt: "2026-10-07T18:05:00.000Z",
            shopId: pair.shopId,
            days: [pair.day],
            edits: [],
            decided: decidedRows(pair.day, pair.shopId, pair.ids),
          }),
        }),
      );
      assert.equal(again.status, 409);
    });
  });

  it("signs off on confirm only after every accepted edit is applied", async () => {
    await withStores(async () => {
      const pair = seededPair(2);
      const { POST } = await import("@/app/api/fullbay-edits/route");
      const { POST: confirm } = await import("@/app/api/fullbay-edits/confirm/route");
      const submitted = await POST(
        new Request("http://127.0.0.1/api/fullbay-edits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submittedAt: "2026-10-07T18:00:00.000Z",
            shopId: pair.shopId,
            days: [pair.day],
            edits: [acceptedEdit(pair.ids[0]!, pair.day, pair.shopId), acceptedEdit(pair.ids[1]!, pair.day, pair.shopId)],
            decided: decidedRows(pair.day, pair.shopId, pair.ids),
          }),
        }),
      );
      assert.equal(submitted.status, 200);
      const submittedBody = (await submitted.json()) as { id?: string; autoSignedOff?: unknown[] };
      assert.deepEqual(submittedBody.autoSignedOff, []);
      assert.equal((await readSignoffs()).length, 0);

      const partial = await confirm(
        new Request("http://127.0.0.1/api/fullbay-edits/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId: submittedBody.id, results: [{ findingId: pair.ids[0], status: "applied" }] }),
        }),
      );
      assert.equal(partial.status, 200);
      const partialBody = (await partial.json()) as { autoSignedOff?: unknown[] };
      assert.deepEqual(partialBody.autoSignedOff, []);
      assert.equal((await readSignoffs()).length, 0);

      const done = await confirm(
        new Request("http://127.0.0.1/api/fullbay-edits/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId: submittedBody.id, results: [{ findingId: pair.ids[1], status: "applied" }] }),
        }),
      );
      assert.equal(done.status, 200);
      const doneBody = (await done.json()) as { autoSignedOff?: { day: string; shopId: string; note: string | null; doneAt: string }[] };
      assert.equal(doneBody.autoSignedOff?.length, 1);
      assert.equal(doneBody.autoSignedOff?.[0]?.note, AUTO_SIGNOFF_NOTE);
      assert.equal(doneBody.autoSignedOff?.[0]?.shopId, pair.shopId);
      const stored = await readSignoffs();
      assert.equal(stored[0]?.doneAt, doneBody.autoSignedOff?.[0]?.doneAt);

      const repeat = await confirm(
        new Request("http://127.0.0.1/api/fullbay-edits/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            batchId: submittedBody.id,
            results: [
              { findingId: pair.ids[0], status: "applied" },
              { findingId: pair.ids[1], status: "applied" },
            ],
          }),
        }),
      );
      const repeatBody = (await repeat.json()) as { autoSignedOff?: unknown[] };
      assert.deepEqual(repeatBody.autoSignedOff, []);
      assert.equal((await readSignoffs())[0]?.doneAt, stored[0]?.doneAt);
    });
  });

  it("leaves a failed edit actionable and keeps a manual sign-off", async () => {
    await withStores(async () => {
      const pair = seededPair(1);
      const { POST } = await import("@/app/api/fullbay-edits/route");
      const { POST: confirm } = await import("@/app/api/fullbay-edits/confirm/route");
      const submitted = await POST(
        new Request("http://127.0.0.1/api/fullbay-edits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submittedAt: "2026-10-07T18:00:00.000Z",
            shopId: pair.shopId,
            days: [pair.day],
            edits: [acceptedEdit(pair.ids[0]!, pair.day, pair.shopId)],
            decided: decidedRows(pair.day, pair.shopId, pair.ids),
          }),
        }),
      );
      const submittedBody = (await submitted.json()) as { id?: string; autoSignedOff?: unknown[] };
      assert.deepEqual(submittedBody.autoSignedOff, []);
      const failed = await confirm(
        new Request("http://127.0.0.1/api/fullbay-edits/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId: submittedBody.id, results: [{ findingId: pair.ids[0], status: "failed", applyNote: "clock rejected" }] }),
        }),
      );
      const failedBody = (await failed.json()) as { autoSignedOff?: unknown[] };
      assert.equal(failed.status, 200);
      assert.deepEqual(failedBody.autoSignedOff, []);
      assert.equal((await readSignoffs()).length, 0);
      assert.equal(findingCanBeDecided(await readQueue(), pair.ids[0]!), true);

      const manual = await recordSignoff(pair.day, pair.shopId, "2026-10-07T19:00:00.000Z");
      const afterManual = await confirm(
        new Request("http://127.0.0.1/api/fullbay-edits/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId: submittedBody.id, results: [{ findingId: pair.ids[0], status: "applied" }] }),
        }),
      );
      const afterBody = (await afterManual.json()) as { autoSignedOff?: unknown[] };
      assert.deepEqual(afterBody.autoSignedOff, []);
      const stored = await readSignoffs();
      assert.equal(stored.length, 1);
      assert.equal(stored[0]?.doneAt, manual.doneAt);
      assert.equal(stored[0]?.note, null);
    });
  });

  it("signs off when a confirm marks the edits already done", async () => {
    await withStores(async () => {
      const pair = seededPair(2);
      const { POST } = await import("@/app/api/fullbay-edits/route");
      const { POST: confirm } = await import("@/app/api/fullbay-edits/confirm/route");
      const submitted = await POST(
        new Request("http://127.0.0.1/api/fullbay-edits", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submittedAt: "2026-10-07T18:00:00.000Z",
            shopId: pair.shopId,
            days: [pair.day],
            edits: [acceptedEdit(pair.ids[0]!, pair.day, pair.shopId), acceptedEdit(pair.ids[1]!, pair.day, pair.shopId)],
            decided: decidedRows(pair.day, pair.shopId, pair.ids),
          }),
        }),
      );
      const submittedBody = (await submitted.json()) as { id?: string };
      const badClock = await confirm(
        new Request("http://127.0.0.1/api/fullbay-edits/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            batchId: submittedBody.id,
            results: [{ findingId: pair.ids[0], status: "already_done", currentClockIn: "8am" }],
          }),
        }),
      );
      assert.equal(badClock.status, 400);
      const badBody = (await badClock.json()) as { error?: string };
      assert.match(badBody.error ?? "", /currentClockIn must be HH:MM/);
      const untouched = (await readQueue()).find((batch) => batch.id === submittedBody.id);
      assert.equal(untouched?.edits.every((edit) => edit.status === "pending"), true);

      const done = await confirm(
        new Request("http://127.0.0.1/api/fullbay-edits/confirm", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            batchId: submittedBody.id,
            results: [
              {
                findingId: pair.ids[0],
                status: "already_done",
                applyNote: "Andy closed this gap.",
                currentClockIn: "06:54",
                currentClockOut: "08:12",
              },
              { findingId: pair.ids[1], status: "applied", currentClockIn: "09:00" },
            ],
          }),
        }),
      );
      assert.equal(done.status, 200);
      const doneBody = (await done.json()) as {
        autoSignedOff?: { day: string; shopId: string; note: string | null }[];
        batch?: { edits: { findingId: string; status: string; applyNote: string | null; currentClockIn: string | null; currentClockOut: string | null; appliedAt: string | null }[] };
      };
      assert.equal(doneBody.autoSignedOff?.length, 1);
      assert.equal(doneBody.autoSignedOff?.[0]?.note, AUTO_SIGNOFF_NOTE);
      const closed = doneBody.batch?.edits.find((edit) => edit.findingId === pair.ids[0]);
      const applied = doneBody.batch?.edits.find((edit) => edit.findingId === pair.ids[1]);
      assert.equal(closed?.status, "already_done");
      assert.equal(closed?.applyNote, "Andy closed this gap.");
      assert.equal(closed?.currentClockIn, "06:54");
      assert.equal(closed?.currentClockOut, "08:12");
      assert.equal(typeof closed?.appliedAt, "string");
      assert.equal(applied?.status, "applied");
      assert.equal(applied?.currentClockIn, null);
      assert.equal(signoffApplyBlock(await readQueue(), pair.day, pair.shopId), null);
      assert.equal(findingCanBeDecided(await readQueue(), pair.ids[0]!), false);
    });
  });

  it("keeps the earliest sign-off time when a restore sends an older doneAt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fullbay-signoff-earliest-"));
    const previousSignoff = process.env.SHOP_DAY_SIGNOFF_PATH;
    process.env.SHOP_DAY_SIGNOFF_PATH = join(directory, "signoffs.json");
    try {
      const { POST: postSignoff } = await import("@/app/api/signoffs/route");
      const first = await postSignoff(
        new Request("http://127.0.0.1/api/signoffs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ day: friday, shopId: "dayton", doneAt: "2026-10-07T16:00:00.000Z" }),
        }),
      );
      assert.equal(first.status, 200);
      const restored = await postSignoff(
        new Request("http://127.0.0.1/api/signoffs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ day: friday, shopId: "dayton", doneAt: "2026-10-06T12:43:00.000Z" }),
        }),
      );
      const restoredBody = (await restored.json()) as { signoff?: { doneAt: string } };
      assert.equal(restored.status, 200);
      assert.equal(restoredBody.signoff?.doneAt, "2026-10-06T12:43:00.000Z");
      const later = await postSignoff(
        new Request("http://127.0.0.1/api/signoffs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ day: friday, shopId: "dayton", doneAt: "2026-10-08T09:00:00.000Z" }),
        }),
      );
      const laterBody = (await later.json()) as { signoff?: { doneAt: string } };
      assert.equal(laterBody.signoff?.doneAt, "2026-10-06T12:43:00.000Z");
      const invalid = await postSignoff(
        new Request("http://127.0.0.1/api/signoffs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ day: friday, shopId: "mobile", doneAt: "yesterday" }),
        }),
      );
      assert.equal(invalid.status, 400);
      assert.equal((await readSignoffs()).find((signoff) => signoff.shopId === "dayton")?.doneAt, "2026-10-06T12:43:00.000Z");
    } finally {
      if (previousSignoff === undefined) delete process.env.SHOP_DAY_SIGNOFF_PATH;
      else process.env.SHOP_DAY_SIGNOFF_PATH = previousSignoff;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("adds no job time for a false gap, a not-applied note, or not_a_gap", () => {
    const counted = { status: "applied" as const, applyNote: "Saved.", minutes: 12 };
    const reapplied = { status: "applied" as const, applyNote: "Resubmission; already handled, not re-applied.", minutes: 8 };
    const falseGap = { status: "applied" as const, applyNote: "Not applied: false gap. Time was on Dayton D-89514.", minutes: 339 };
    const alreadyFalse = { status: "already_done" as const, applyNote: "False gap. Time is on another shop's SO.", minutes: 4 };
    const explicit = { status: "not_a_gap" as const, applyNote: "Already correct.", minutes: 15 };
    assert.equal(minutesPickedUp(counted), 12);
    assert.equal(minutesPickedUp(reapplied), 8);
    assert.equal(editAddsNoJobTime(reapplied), false);
    assert.equal(minutesPickedUp(falseGap), 0);
    assert.equal(minutesPickedUp(alreadyFalse), 0);
    assert.equal(minutesPickedUp(explicit), 0);
    assert.equal(minutesPickedUp({ status: "failed", applyNote: null, minutes: 7 }), 0);
    assert.equal(editIsResolved("not_a_gap"), true);
    assert.equal(editIsResolved("failed"), false);
    const batch = {
      id: "batch-1",
      submittedAt: "2026-10-06T15:00:00.000Z",
      shopId: "springfield" as const,
      days: [friday],
      edits: [
        {
          findingId: "mike-1",
          day: friday,
          shopId: "springfield" as const,
          shopName: "Springfield",
          techName: "Mike Wooten",
          orderId: "S-90640",
          work: "Gap",
          decision: "accept" as const,
          newClockIn: "11:31",
          newClockOut: "17:10",
          minutes: 339,
          status: "pending" as const,
          appliedAt: null,
          applyNote: null,
        },
      ],
    };
    const confirmed = applyConfirmations(batch, [{ findingId: "mike-1", status: "not_a_gap", applyNote: "Not applied: false gap." }], "2026-10-08T12:00:00.000Z");
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(confirmed.batch.edits[0]?.status, "not_a_gap");
    assert.equal(minutesPickedUp(confirmed.batch.edits[0]!), 0);
    assert.equal(signoffApplyBlock([confirmed.batch], friday, "springfield"), null);
    assert.equal(findingCanBeDecided([confirmed.batch], "mike-1"), false);
  });

  it("does not report a shop day that recordAutoSignoffs already stored", async () => {
    await withStores(async () => {
      const first = await recordAutoSignoffs([{ day: friday, shopId: "columbus" }], "2026-10-07T19:00:00.000Z", AUTO_SIGNOFF_NOTE);
      assert.equal(first.length, 1);
      assert.equal(first[0]?.note, AUTO_SIGNOFF_NOTE);
      const second = await recordAutoSignoffs([{ day: friday, shopId: "columbus" }], "2026-10-07T20:00:00.000Z", AUTO_SIGNOFF_NOTE);
      assert.deepEqual(second, []);
      assert.equal((await readSignoffs())[0]?.doneAt, "2026-10-07T19:00:00.000Z");
    });
  });
});

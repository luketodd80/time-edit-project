import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { CURATED_FRIDAY } from "@/lib/curated-friday";
import {
  applyConfirmations,
  pendingBatches,
  queueEditFromPlanned,
  shopDayLock,
  editsForSubmit,
  findingCanBeDecided,
  latestQueueEdit,
  reviewApplyText,
  signoffApplyBlock,
  submissionToQueueRequest,
  submitRefusal,
  type FullbayEditBatch,
  type FullbayQueueEdit,
} from "@/lib/fullbay-edit-queue";
import { confirmQueuedBatch, enqueueBatch, queueFilePath, readQueue } from "@/lib/fullbay-edit-queue-store";
import { readSignoffs, recordSignoff, signoffFilePath } from "@/lib/signoff-store";
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
    assert.match(
      submitRefusal([failedBatch], [], { shopId: "mobile", days: [tuesday], edits: [{ ...retry, findingId: "never-pushed" }] }) ?? "",
      /Already submitted: Mobile 2026-10-06/,
    );
    assert.equal(
      editsForSubmit([failedBatch], [retry, { findingId: "never-pushed", day: tuesday, shopId: "mobile" }]).map((item) => item.findingId).join(","),
      findingId,
    );
    assert.equal(editsForSubmit([applied], [{ findingId, day: tuesday, shopId: "mobile" }]).length, 0);
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
      const again = await submit("dayton", tuesday, "zach-2");
      assert.equal(again.status, 409);
      const againBody = (await again.json()) as { error?: string };
      assert.match(againBody.error ?? "", /Already submitted: Dayton 2026-10-06/);

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
});

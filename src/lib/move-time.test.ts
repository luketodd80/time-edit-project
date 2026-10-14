import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { applyConfirmations, pendingBatches, submitRefusal, suggestionsNeedingDecision, supersedeStaleCodyEdit, type RecordedSignoff } from "@/lib/fullbay-edit-queue";
import { parseQueueRequest } from "@/lib/fullbay-edit-queue";
import { readQueue } from "@/lib/fullbay-edit-queue-store";
import { buildAdminPayload } from "@/lib/admin";
import { OCTOBER_12_REPORTS, timesheetToDayReports } from "@/lib/fullbay-timesheet";
import {
  applyMoveTimeLeftovers,
  CODY_KESTER_MOVE_TIME_ID,
  decisionsWithoutStaleMoveTime,
  isMoveTimeFollowUp,
  moveTimeLeftoverFindings,
  moveTimeLines,
  NICK_SONTAG_FOLLOW_UP_ID,
  pairNonProMove,
  STALE_CODY_BATCH_ID,
} from "@/lib/move-time";
import { readMoveTimeLeftovers } from "@/lib/move-time-store";
import { signoffFilePath } from "@/lib/signoff-store";
import { SEED } from "@/lib/seed";
import type { ShopId } from "@/lib/types";

describe("Non-Pro move time", () => {
  it("shortens the Non-Pro row by the overlap and removes it when the service order covers it", () => {
    const shortened = pairNonProMove({
      soIn: "07:13:12",
      soOut: "08:00:45",
      newIn: "07:13:12",
      newOut: "08:22:00",
      nonProIn: "08:00:45",
      nonProOut: "09:06:40",
      shiftClockOut: "17:00:53",
    });
    assert.deepEqual(shortened?.nonProChange, {
      original: { in: "08:00:45", out: "09:06:40" },
      new: { in: "08:22:00", out: "09:06:40" },
    });

    const removed = pairNonProMove({
      soIn: "10:31:48",
      soOut: "10:52:24",
      newIn: "10:31:48",
      newOut: "11:09:37",
      nonProIn: "10:52:51",
      nonProOut: "11:09:37",
    });
    assert.equal(removed?.nonProChange.remove, true);
    assert.equal(removed?.nonProChange.new, undefined);
  });

  it("stops an extension at the shift clock-out unless override allows it", () => {
    const capped = pairNonProMove({
      soIn: "13:05:22",
      soOut: "16:03:06",
      newIn: "13:05:22",
      newOut: "17:04:21",
      nonProIn: "16:03:07",
      nonProOut: "17:04:21",
      shiftClockOut: "16:03:06",
    });
    assert.equal(capped, null);

    const overridden = pairNonProMove({
      soIn: "13:05:22",
      soOut: "16:03:06",
      newIn: "13:05:22",
      newOut: "17:04:21",
      nonProIn: "16:03:07",
      nonProOut: "17:04:21",
      shiftClockOut: "16:03:06",
      allowPastClockOut: true,
    });
    assert.equal(overridden?.nonProChange.remove, true);
  });

  it("labels the service-order change and the Non-Pro change", () => {
    const cody = moveTimeLeftoverFindings().find((finding) => finding.id.endsWith("cody-kester-02"));
    const lines = cody?.recommendation ? moveTimeLines(cody.recommendation.orderId, cody.recommendation) : null;
    assert.equal(lines?.so, "G-89820: out 8:00:45 AM -> 8:22:00 AM (+21 min)");
    assert.equal(lines?.nonPro, "Non-Pro: start 8:00:45 AM -> 8:22:00 AM (-21 min)");
    const nick = moveTimeLeftoverFindings().find((finding) => finding.id === NICK_SONTAG_FOLLOW_UP_ID);
    assert.equal(nick?.followUp, true);
    assert.equal(isMoveTimeFollowUp(nick?.id ?? ""), true);
    assert.equal(moveTimeLines("D-89868", nick!.recommendation!)?.nonPro, "Non-Pro removed");
  });

  it("does not suggest Gage Wills’s Greenville October 12 gaps that Non-Pro already covers", () => {
    const findings = OCTOBER_12_REPORTS.find((report) => report.shopId === "greenville")?.findings.filter(
      (finding) => finding.techId === "gage-wills" && finding.start >= "14:05" && finding.start <= "14:22",
    );
    const covered = findings?.filter((finding) => finding.suggested?.includes("Covered by Non-Pro"));
    assert.equal(covered?.length, 2);
    assert.equal(covered?.every((finding) => finding.recommendation == null && finding.nonPro == null && finding.notAGap === true), true);
  });

  it("attaches a Non-Pro removal when a suggestion extends through that punch, and caps at clock-out", () => {
    const reports = timesheetToDayReports({
      date: "2026-10-06",
      rows: [
        row("7:00:00AM 10/6/2026", "10:00:00AM 10/6/2026", 3, ""),
        row("7:00:00AM 10/6/2026", "8:00:00AM 10/6/2026", 1, "S-1 / Brakes"),
        row("8:30:00AM 10/6/2026", "9:00:00AM 10/6/2026", 0.5, "", "Shop Meeting"),
        row("9:00:00AM 10/6/2026", "10:00:00AM 10/6/2026", 1, "S-2 / QC"),
      ],
    });
    const gap = reports[0]?.findings.find((finding) => finding.recommendation?.nonProChange?.remove === true);
    assert.equal(gap?.recommendation?.orderId, "S-2");
    assert.ok((gap?.recommendation?.end ?? "") <= "10:00");
    assert.equal(gap?.recommendation?.shiftClockOut, "10:00:00");
  });

  it("lets a follow-up submit on a signed-off day and still refuses every other edit", () => {
    const signoffs: RecordedSignoff[] = [{ day: "2026-10-13", shopId: "dayton", doneAt: "2026-10-14T14:00:00.000Z" }];
    const followUp = submitRefusal([], signoffs, {
      shopId: "dayton",
      days: ["2026-10-13"],
      edits: [{ findingId: NICK_SONTAG_FOLLOW_UP_ID, day: "2026-10-13", shopId: "dayton" }],
    });
    assert.equal(followUp, null);
    const other = submitRefusal([], signoffs, {
      shopId: "dayton",
      days: ["2026-10-13"],
      edits: [{ findingId: "2026-10-13-dayton-nick-sontag-12", day: "2026-10-13", shopId: "dayton" }],
    });
    assert.match(other ?? "", /Already signed off/);
    const waiting = submitRefusal(
      [],
      signoffs,
      { shopId: "dayton", days: ["2026-10-13"], edits: [] },
      [{ day: "2026-10-13", shopId: "dayton" }],
    );
    assert.equal(waiting, null);
  });

  it("keeps an older edit without nonProChange and accepts the new field", () => {
    const older = parseQueueRequest({
      submittedAt: "2026-10-14T15:00:00.000Z",
      shopId: "greenville",
      days: ["2026-10-13"],
      edits: [edit()],
    });
    assert.equal(older.ok, true);
    if (older.ok) assert.equal(older.value.edits[0]?.nonProChange, undefined);

    const next = parseQueueRequest({
      submittedAt: "2026-10-14T15:00:00.000Z",
      shopId: "greenville",
      days: ["2026-10-13"],
      edits: [
        edit({
          nonProChange: {
            original: { in: "08:00:45", out: "09:06:40" },
            new: { in: "08:22:00", out: "09:06:40" },
          },
        }),
      ],
    });
    assert.equal(next.ok, true);
    if (next.ok) assert.equal(next.value.edits[0]?.nonProChange?.new?.in, "08:22:00");
  });

  it("replaces old decisions with undecided move-time rows and supersedes Cody’s pending edit", () => {
    const reports = applyMoveTimeLeftovers(SEED, moveTimeLeftoverFindings());
    const codyEdit = {
      findingId: CODY_KESTER_MOVE_TIME_ID,
      day: "2026-10-13",
      shopId: "greenville" as const,
      shopName: "Greenville",
      techName: "Cody Kester",
      orderId: "G-89820",
      work: "Remove Paccar engine and",
      decision: "accept" as const,
      newClockIn: "07:13",
      newClockOut: "08:22",
      minutes: 42,
      status: "pending" as const,
      appliedAt: null,
      applyNote: null,
    };
    const david = (seq: string) => ({
      ...codyEdit,
      findingId: `2026-10-13-greenville-david-johnson-${seq}`,
      techName: "David Johnson",
      orderId: seq === "13" ? "G-90810" : "G-90843",
      status: "applied" as const,
      appliedAt: "2026-10-14T12:00:00.000Z",
    });
    const batches = [
      {
        id: STALE_CODY_BATCH_ID,
        submittedAt: "2026-10-14T15:25:57.730Z",
        shopId: "greenville" as const,
        days: ["2026-10-13"],
        edits: [codyEdit],
        decided: [{ findingId: CODY_KESTER_MOVE_TIME_ID, day: "2026-10-13", shopId: "greenville" as const }],
      },
      {
        id: "david-batch",
        submittedAt: "2026-10-14T11:12:50.409Z",
        shopId: "greenville" as const,
        days: ["2026-10-13"],
        edits: [david("13"), david("20")],
      },
    ];
    const superseded = supersedeStaleCodyEdit(batches);
    assert.equal(superseded.changed, true);
    assert.equal(superseded.batches[0]?.edits[0]?.status, "superseded");
    assert.equal(pendingBatches(superseded.batches).some((batch) => batch.id === STALE_CODY_BATCH_ID), false);
    assert.equal(superseded.batches[1]?.edits[0]?.status, "applied");
    const confirmed = applyConfirmations(
      superseded.batches[0]!,
      [{ findingId: CODY_KESTER_MOVE_TIME_ID, status: "applied", applyNote: "matched" }],
      "2026-10-14T16:00:00.000Z",
    );
    assert.equal(confirmed.ok, true);
    if (confirmed.ok) assert.equal(confirmed.batch.edits[0]?.status, "superseded");

    const stale = decisionsWithoutStaleMoveTime({ [CODY_KESTER_MOVE_TIME_ID]: { kind: "accept", start: "", end: "" } }, true);
    assert.equal(stale[CODY_KESTER_MOVE_TIME_ID], undefined);
    const kept = decisionsWithoutStaleMoveTime(
      { [CODY_KESTER_MOVE_TIME_ID]: { kind: "accept", start: "", end: "", moveTime: true } },
      true,
    );
    assert.equal(kept[CODY_KESTER_MOVE_TIME_ID]?.moveTime, true);

    const signoffs: RecordedSignoff[] = [{ day: "2026-10-13", shopId: "dayton", doneAt: "2026-10-14T18:00:00.000Z" }];
    const greenville = reports.filter((report) => report.day === "2026-10-13" && report.shopId === "greenville");
    const greenvilleOpen = suggestionsNeedingDecision(greenville, { [CODY_KESTER_MOVE_TIME_ID]: { kind: "accept", start: "", end: "" } }, batches);
    const greenvilleIds = greenvilleOpen.map((edit) => edit.findingId);
    assert.equal(greenvilleIds.includes(CODY_KESTER_MOVE_TIME_ID), true);
    assert.equal(greenvilleIds.includes("2026-10-13-greenville-david-johnson-13"), true);
    assert.equal(greenvilleIds.includes("2026-10-13-greenville-david-johnson-20"), true);
    const dayton = reports.filter((report) => report.day === "2026-10-13" && report.shopId === "dayton");
    const daytonOpen = suggestionsNeedingDecision(dayton, {}, batches, signoffs);
    assert.deepEqual(
      daytonOpen.map((edit) => edit.findingId),
      [NICK_SONTAG_FOLLOW_UP_ID],
    );

    const admin = buildAdminPayload({
      today: "2026-10-14",
      start: "2026-10-13",
      end: "2026-10-13",
      reports,
      batches: superseded.batches,
      signoffs,
      history: [],
    });
    const daytonCell = admin.grid.shops.find((shop) => shop.id === "dayton")?.cells.find((cell) => cell.day === "2026-10-13");
    assert.equal(daytonCell?.tone, "green");
    assert.equal(daytonCell?.signedOffAt, "2026-10-14T18:00:00.000Z");
    assert.equal(daytonCell?.lines.find((line) => line.findingId === NICK_SONTAG_FOLLOW_UP_ID)?.decision, "Undecided");
    const greenvilleCell = admin.grid.shops.find((shop) => shop.id === "greenville")?.cells.find((cell) => cell.day === "2026-10-13");
    assert.equal(greenvilleCell?.lines.find((line) => line.findingId === CODY_KESTER_MOVE_TIME_ID)?.decision, "Undecided");
    assert.equal(greenvilleCell?.lines.find((line) => line.findingId === CODY_KESTER_MOVE_TIME_ID)?.status, null);
    assert.equal(greenvilleCell?.lines.find((line) => line.findingId === "2026-10-13-greenville-david-johnson-13")?.decision, "Undecided");
    assert.equal(greenvilleCell?.lines.find((line) => line.findingId === "2026-10-13-greenville-david-johnson-20")?.decision, "Undecided");
  });
});

describe("reopen move-time leftovers", { concurrency: false }, () => {
  it("adds the four rows, supersedes Cody’s pending edit, and does not write sign-offs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "move-time-"));
    const previousQueue = process.env.FULLBAY_EDIT_QUEUE_PATH;
    const previousSignoff = process.env.SHOP_DAY_SIGNOFF_PATH;
    const previousMove = process.env.MOVE_TIME_LEFTOVER_PATH;
    const previousMoveSeed = process.env.MOVE_TIME_LEFTOVER_SEED_PATH;
    process.env.FULLBAY_EDIT_QUEUE_PATH = join(directory, "queue.json");
    process.env.SHOP_DAY_SIGNOFF_PATH = join(directory, "signoffs.json");
    process.env.MOVE_TIME_LEFTOVER_PATH = join(directory, "move-time.json");
    process.env.MOVE_TIME_LEFTOVER_SEED_PATH = join(directory, "missing-seed.json");
    try {
      assert.equal((await readMoveTimeLeftovers()).length, 0);
      const { POST } = await import("@/app/api/admin/reopen-move-time/route");
      const response = await POST(new Request("http://127.0.0.1/api/admin/reopen-move-time", { method: "POST" }));
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        findings: Array<{
          id: string;
          followUp?: boolean;
          recommendation: { nonProChange?: { remove?: boolean; new?: { in: string } } };
        }>;
      };
      assert.deepEqual(
        body.findings.map((finding) => finding.id),
        [
          "2026-10-13-greenville-cody-kester-02",
          "2026-10-13-greenville-david-johnson-13",
          "2026-10-13-greenville-david-johnson-20",
          NICK_SONTAG_FOLLOW_UP_ID,
        ],
      );
      assert.equal(body.findings[0]?.recommendation.nonProChange?.new?.in, "08:22:00");
      assert.equal(body.findings[1]?.recommendation.nonProChange?.remove, true);
      assert.equal(body.findings[3]?.followUp, true);
      assert.equal(existsSync(signoffFilePath()), false);
      const queued = await readQueue();
      const cody = queued.find((batch) => batch.id === STALE_CODY_BATCH_ID)?.edits.find((edit) => edit.findingId === CODY_KESTER_MOVE_TIME_ID);
      assert.equal(cody?.status, "superseded");
      assert.equal(pendingBatches(queued).some((batch) => batch.id === STALE_CODY_BATCH_ID), false);
      const david = queued.flatMap((batch) => batch.edits).find((edit) => edit.findingId === "2026-10-13-greenville-david-johnson-13");
      assert.equal(david?.status, "applied");
      const merged = applyMoveTimeLeftovers(SEED, await readMoveTimeLeftovers());
      const greenville = merged.find((report) => report.day === "2026-10-13" && report.shopId === "greenville");
      const codyFinding = greenville?.findings.find((finding) => finding.id.endsWith("cody-kester-02"));
      assert.equal(codyFinding?.nonPro, undefined);
      assert.equal(codyFinding?.recommendation?.orderId, "G-89820");
      const dayton = merged.find((report) => report.day === "2026-10-13" && report.shopId === "dayton");
      assert.equal(dayton?.findings.some((finding) => finding.id === NICK_SONTAG_FOLLOW_UP_ID), true);
      const again = await POST(new Request("http://127.0.0.1/api/admin/reopen-move-time", { method: "POST" }));
      assert.equal(again.status, 200);
      assert.equal((await readQueue()).find((batch) => batch.id === STALE_CODY_BATCH_ID)?.edits[0]?.status, "superseded");
      assert.equal(existsSync(signoffFilePath()), false);
    } finally {
      if (previousQueue === undefined) delete process.env.FULLBAY_EDIT_QUEUE_PATH;
      else process.env.FULLBAY_EDIT_QUEUE_PATH = previousQueue;
      if (previousSignoff === undefined) delete process.env.SHOP_DAY_SIGNOFF_PATH;
      else process.env.SHOP_DAY_SIGNOFF_PATH = previousSignoff;
      if (previousMove === undefined) delete process.env.MOVE_TIME_LEFTOVER_PATH;
      else process.env.MOVE_TIME_LEFTOVER_PATH = previousMove;
      if (previousMoveSeed === undefined) delete process.env.MOVE_TIME_LEFTOVER_SEED_PATH;
      else process.env.MOVE_TIME_LEFTOVER_SEED_PATH = previousMoveSeed;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stays open from the seed when the live leftovers file is missing", async () => {
    const directory = mkdtempSync(join(tmpdir(), "move-time-seed-"));
    const previousQueue = process.env.FULLBAY_EDIT_QUEUE_PATH;
    const previousQueueSeed = process.env.FULLBAY_EDIT_QUEUE_SEED_PATH;
    const previousSignoff = process.env.SHOP_DAY_SIGNOFF_PATH;
    const previousMove = process.env.MOVE_TIME_LEFTOVER_PATH;
    const previousMoveSeed = process.env.MOVE_TIME_LEFTOVER_SEED_PATH;
    const live = join(directory, "move-time.json");
    process.env.FULLBAY_EDIT_QUEUE_PATH = join(directory, "queue.json");
    process.env.FULLBAY_EDIT_QUEUE_SEED_PATH = join(directory, "empty-seed.json");
    process.env.SHOP_DAY_SIGNOFF_PATH = join(directory, "signoffs.json");
    process.env.MOVE_TIME_LEFTOVER_PATH = live;
    delete process.env.MOVE_TIME_LEFTOVER_SEED_PATH;
    try {
      assert.equal(existsSync(live), false);
      assert.equal((await readMoveTimeLeftovers()).length, 4);
      const { POST } = await import("@/app/api/admin/reopen-move-time/route");
      const response = await POST(new Request("http://127.0.0.1/api/admin/reopen-move-time", { method: "POST" }));
      assert.equal(response.status, 200);
      const body = (await response.json()) as { openedAt?: string; findings?: unknown[] };
      assert.equal(body.openedAt, "2026-10-14T20:13:00.000Z");
      assert.equal(body.findings?.length, 4);
      assert.equal(existsSync(live), false);
      writeFileSync(live, "{}\n");
      assert.equal((await readMoveTimeLeftovers()).length, 0);
    } finally {
      if (previousQueue === undefined) delete process.env.FULLBAY_EDIT_QUEUE_PATH;
      else process.env.FULLBAY_EDIT_QUEUE_PATH = previousQueue;
      if (previousQueueSeed === undefined) delete process.env.FULLBAY_EDIT_QUEUE_SEED_PATH;
      else process.env.FULLBAY_EDIT_QUEUE_SEED_PATH = previousQueueSeed;
      if (previousSignoff === undefined) delete process.env.SHOP_DAY_SIGNOFF_PATH;
      else process.env.SHOP_DAY_SIGNOFF_PATH = previousSignoff;
      if (previousMove === undefined) delete process.env.MOVE_TIME_LEFTOVER_PATH;
      else process.env.MOVE_TIME_LEFTOVER_PATH = previousMove;
      if (previousMoveSeed === undefined) delete process.env.MOVE_TIME_LEFTOVER_SEED_PATH;
      else process.env.MOVE_TIME_LEFTOVER_SEED_PATH = previousMoveSeed;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function edit(overrides: Record<string, unknown> = {}) {
  return {
    findingId: "2026-10-13-greenville-cody-kester-02",
    day: "2026-10-13",
    shopId: "greenville" as ShopId,
    techName: "Cody Kester",
    orderId: "G-89820",
    work: "Remove Paccar engine and",
    decision: "accept",
    newClockIn: "07:13",
    newClockOut: "08:22",
    minutes: 21,
    ...overrides,
  };
}

function row(clockIn: string, clockOut: string, hours: number, complaint: string, activity = "Inactive") {
  return {
    shop: "The Service Company - Springfield (S)",
    employee: "Gap Tech",
    clock_in: clockIn,
    clock_out: clockOut,
    hours,
    so_complaint: complaint,
    comment: "",
    clock_in_activity: activity,
  };
}

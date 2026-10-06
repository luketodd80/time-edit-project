import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FullbayEditBatch, FullbayQueueEdit } from "@/lib/fullbay-edit-queue";
import { notifySubmitWebhook, submitWebhookPayload, SUBMIT_DASHBOARD_URL } from "@/lib/submit-webhook";

function edit(overrides: Partial<FullbayQueueEdit> = {}): FullbayQueueEdit {
  return {
    findingId: "2026-10-05-dayton-cole-lozan-01",
    day: "2026-10-05",
    shopId: "dayton",
    shopName: "Dayton",
    techName: "Cole Lozan",
    orderId: "D-90228",
    work: "Replace turbo",
    decision: "accept",
    newClockIn: "08:14",
    newClockOut: "08:26",
    minutes: 12,
    status: "pending",
    appliedAt: null,
    applyNote: null,
    ...overrides,
  };
}

function batch(edits: FullbayQueueEdit[]): FullbayEditBatch {
  return {
    id: "batch-1",
    submittedAt: "2026-10-06T15:00:00.000Z",
    shopId: "dayton",
    days: ["2026-10-05"],
    edits,
  };
}

describe("submit webhook", () => {
  it("builds the notice from queued accepts and overrides", () => {
    const payload = submitWebhookPayload(
      batch([
        edit(),
        edit({
          findingId: "2026-10-05-dayton-cole-lozan-02",
          decision: "override",
          techName: "Cole Lozan",
          newClockIn: "09:00",
          newClockOut: "09:10",
        }),
        edit({
          findingId: "2026-10-05-dayton-zach-spencer-01",
          techName: "Zach Spencer",
          orderId: "D-90148",
        }),
      ]),
    );
    assert.deepEqual(payload, {
      event: "time-edit.submitted",
      batchId: "batch-1",
      shopId: "dayton",
      shopName: "Dayton",
      days: ["2026-10-05"],
      submittedAt: "2026-10-06T15:00:00.000Z",
      editCount: 3,
      techs: ["Cole Lozan", "Zach Spencer"],
      dashboardUrl: SUBMIT_DASHBOARD_URL,
    });
    assert.equal(payload.dashboardUrl, "https://time-edit-project.onrender.com/");
    assert.equal("password" in payload, false);
    assert.equal(JSON.stringify(payload).includes("SITE_PASSWORD"), false);
  });

  it("does not call when SUBMIT_WEBHOOK_URL is missing", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response("ok");
    };
    await notifySubmitWebhook(batch([edit()]), {}, fetchImpl);
    await notifySubmitWebhook(batch([edit()]), { SUBMIT_WEBHOOK_URL: "   ", SUBMIT_WEBHOOK_KEY: "secret" }, fetchImpl);
    assert.equal(calls, 0);
  });

  it("skips a reject-only batch and keeps a webhook failure off the submit path", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("ok", { status: 200 });
    };
    await notifySubmitWebhook(batch([]), { SUBMIT_WEBHOOK_URL: "https://hooks.example/submit" }, fetchImpl);
    assert.equal(calls.length, 0);

    await notifySubmitWebhook(batch([edit()]), { SUBMIT_WEBHOOK_URL: "https://hooks.example/submit", SUBMIT_WEBHOOK_KEY: "secret" }, fetchImpl);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://hooks.example/submit");
    const headers = new Headers(calls[0]?.init?.headers);
    assert.equal(headers.get("authorization"), "Bearer secret");
    assert.equal(calls[0]?.init?.method, "POST");

    await notifySubmitWebhook(
      batch([edit()]),
      {
        SUBMIT_WEBHOOK_URL: "https://hooks.example/submit",
        SUBMIT_WEBHOOK_KEY: "raw-key",
        SUBMIT_WEBHOOK_KEY_HEADER: "X-Webhook-Key",
      },
      fetchImpl,
    );
    assert.equal(new Headers(calls[1]?.init?.headers).get("x-webhook-key"), "raw-key");
    assert.equal(new Headers(calls[1]?.init?.headers).get("authorization"), null);

    const failing: typeof fetch = async () => {
      throw new Error("down");
    };
    await notifySubmitWebhook(batch([edit()]), { SUBMIT_WEBHOOK_URL: "https://hooks.example/submit" }, failing);
    const rejected: typeof fetch = async () => new Response("no", { status: 500 });
    await notifySubmitWebhook(batch([edit()]), { SUBMIT_WEBHOOK_URL: "https://hooks.example/submit" }, rejected);
  });
});

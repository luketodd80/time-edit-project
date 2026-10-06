import type { FullbayEditBatch } from "@/lib/fullbay-edit-queue";
import { shopName } from "@/lib/review";
import type { ShopFilter } from "@/lib/types";

/** Dashboard the assistant opens after a successful submit. */
export const SUBMIT_DASHBOARD_URL = "https://time-edit-project.onrender.com/";

const WEBHOOK_TIMEOUT_MS = 5_000;

export interface SubmitWebhookEnv {
  SUBMIT_WEBHOOK_URL?: string;
  SUBMIT_WEBHOOK_KEY?: string;
  SUBMIT_WEBHOOK_KEY_HEADER?: string;
}

export interface SubmitWebhookPayload {
  event: "time-edit.submitted";
  batchId: string;
  shopId: string;
  shopName: string;
  days: string[];
  submittedAt: string;
  editCount: number;
  techs: string[];
  dashboardUrl: string;
}

function webhookEnv(env?: SubmitWebhookEnv): SubmitWebhookEnv {
  return env ?? (process.env as SubmitWebhookEnv);
}

/** Destination for the submit notice. An unset or blank URL means do not call. */
export function submitWebhookUrl(env: SubmitWebhookEnv): string | null {
  const url = env.SUBMIT_WEBHOOK_URL?.trim() ?? "";
  return url.length === 0 ? null : url;
}

function batchShopName(shopId: ShopFilter): string {
  return shopId === "all" ? "All shops" : shopName(shopId);
}

/** JSON body for a queued batch. Accepted and overridden edits only. No secrets. */
export function submitWebhookPayload(batch: FullbayEditBatch): SubmitWebhookPayload {
  const techs: string[] = [];
  const seen = new Set<string>();
  for (const edit of batch.edits) {
    if (seen.has(edit.techName)) continue;
    seen.add(edit.techName);
    techs.push(edit.techName);
  }
  return {
    event: "time-edit.submitted",
    batchId: batch.id,
    shopId: batch.shopId,
    shopName: batchShopName(batch.shopId),
    days: [...batch.days],
    submittedAt: batch.submittedAt,
    editCount: batch.edits.length,
    techs,
    dashboardUrl: SUBMIT_DASHBOARD_URL,
  };
}

function headerValue(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n]/g, "");
}

/** Request headers. A key with no header name is `Authorization: Bearer <key>`. A named header sends the key raw. */
export function submitWebhookHeaders(env: SubmitWebhookEnv): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = headerValue(env.SUBMIT_WEBHOOK_KEY);
  if (key.length === 0) return headers;
  const headerName = headerValue(env.SUBMIT_WEBHOOK_KEY_HEADER).trim();
  if (headerName.length === 0) {
    headers.authorization = `Bearer ${key}`;
  } else {
    headers[headerName] = key;
  }
  return headers;
}

/**
 * POST the submit notice after the queue write. Skips a missing URL and a batch with no queued edits.
 * A network error or a non-2xx response is logged and does not throw.
 */
export async function notifySubmitWebhook(
  batch: FullbayEditBatch,
  env?: SubmitWebhookEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const source = webhookEnv(env);
  const url = submitWebhookUrl(source);
  if (!url || batch.edits.length === 0) return;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: submitWebhookHeaders(source),
      body: JSON.stringify(submitWebhookPayload(batch)),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`Submit webhook returned ${response.status}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Submit webhook failed: ${message}`);
  }
}

"use client";

import { OrderStatusBadge } from "@/components/order-status";
import { formatDayShort, formatTimestamp } from "@/lib/dates";
import { alreadyDoneText, batchForSubmission, notAGapText, rejectedAfterFailureText, type FullbayEditBatch, type FullbayQueueEdit } from "@/lib/fullbay-edit-queue";
import { shopName } from "@/lib/review";
import type { PlannedEdit, SkippedOrder, Submission } from "@/lib/types";
import { describeNonProEdit } from "@/lib/nonpro";
import { formatClock, formatDuration } from "@/lib/time";

export function ConfirmView({
  submission,
  stale,
  batches,
  queueLoaded,
  awaitingQueue,
  queueError,
}: {
  submission: Submission | null;
  stale: boolean;
  batches: FullbayEditBatch[];
  queueLoaded: boolean;
  awaitingQueue: boolean;
  queueError: string | null;
}) {
  if (!submission) {
    return (
      <p className="rounded-xl bg-muted/50 p-4 text-sm leading-6">
        Submit from Review to save a confirmation in this browser and queue accepted edits for Fullbay Time Stamp apply.
      </p>
    );
  }

  const shop = submission.shopId === "all" ? "All shops" : shopName(submission.shopId);
  const dayList = submission.days.map((day) => formatDayShort(day)).join(", ");
  const queued = batchForSubmission(batches, submission);
  const byId = new Map(queued?.edits.map((edit) => [edit.findingId, edit]) ?? []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-medium">Queued for Fullbay apply</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Recorded locally {formatTimestamp(submission.submittedAt)} for {shop} · {dayList}. Accepted edits are queued for Fullbay Time Stamp apply (Chris). They are not written until the apply is confirmed.
        </p>
        {queueError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {queueError}
          </p>
        ) : null}
        {queueLoaded && !awaitingQueue && !queued && !queueError ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            This confirmation is saved in this browser. It is not in the Fullbay apply queue, so apply has not started.
          </p>
        ) : null}
        {awaitingQueue || !queueLoaded ? <p className="mt-3 text-sm text-muted-foreground">Checking the apply queue.</p> : null}
        {stale ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            The shop, days, or decisions changed after this confirmation. Submit again from Review to refresh it.
          </p>
        ) : null}
      </div>

      <EditList
        title="Queued for Fullbay apply"
        empty="No accepted or overridden edits in this confirmation."
        edits={submission.edits}
        render={(edit) =>
          edit.nonPro
            ? `${describeNonProEdit(edit.nonPro)} ${formatDuration(edit.minutes)} added to SO hours. ${applyStatusText(byId.get(edit.findingId))}`
            : `${edit.decision === "accept" ? "Accepted as recommended" : "Override"} · ${formatClock(edit.start)}–${formatClock(edit.end)} · ${formatDuration(edit.minutes)} added to SO hours. ${applyStatusText(byId.get(edit.findingId))}`
        }
      />
      <EditList
        title="Rejected"
        empty="No rejected recommendations."
        edits={submission.rejected}
        render={(edit) =>
          edit.nonPro?.editType === "keep"
            ? "Kept as Non-Pro. No Fullbay change. Adds no SO hours."
            : "Rejected. No reason recorded. Adds no SO hours."
        }
      />
      <section className="flex flex-col gap-3">
        <h3 className="font-medium">Skipped because invoiced</h3>
        {submission.skipped.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invoiced orders in this selection.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {submission.skipped.map((order) => (
              <SkippedRow key={`${order.day}-${order.shopId}-${order.orderId}`} order={order} />
            ))}
          </ul>
        )}
      </section>
      <EditList
        title="Not decided"
        empty="Every eligible recommendation in this selection has a decision."
        edits={submission.undecided}
        render={() => "Not included."}
      />
    </div>
  );
}

function EditList({
  title,
  empty,
  edits,
  render,
}: {
  title: string;
  empty: string;
  edits: PlannedEdit[];
  render: (edit: PlannedEdit) => string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-medium">{title}</h3>
      {edits.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {edits.map((edit) => (
            <li key={edit.findingId} className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
              <p className="font-medium">
                {edit.techName} · {edit.orderId} {edit.work}
              </p>
              <p className="mt-1 text-muted-foreground">
                {formatDayShort(edit.day)} · {shopName(edit.shopId)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={edit.orderStatus} />
                <span>{render(edit)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function applyStatusText(edit: FullbayQueueEdit | undefined): string {
  if (!edit) return "Not queued.";
  if (edit.status === "pending") return "Pending Fullbay apply.";
  if (edit.status === "failed") return edit.applyNote ? `Fullbay apply failed. ${edit.applyNote}` : "Fullbay apply failed.";
  if (edit.status === "rejected") return rejectedAfterFailureText(edit);
  if (edit.status === "not_a_gap") return notAGapText(edit);
  if (edit.status === "already_done") return alreadyDoneText(edit);
  const when = edit.appliedAt ? ` ${formatTimestamp(edit.appliedAt)}` : "";
  return edit.applyNote ? `Applied in Fullbay${when}. ${edit.applyNote}` : `Applied in Fullbay${when}.`;
}

function SkippedRow({ order }: { order: SkippedOrder }) {
  return (
    <li className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <span className="font-medium">
        {order.orderId}
        {order.title ? ` ${order.title}` : ""}
      </span>
      <span className="mt-1 block text-muted-foreground">
        {formatDayShort(order.day)} · {shopName(order.shopId)} · Skipped because invoiced / closed
      </span>
    </li>
  );
}

"use client";

import { OrderStatusBadge } from "@/components/order-status";
import { formatDayShort, formatTimestamp } from "@/lib/dates";
import { shopName } from "@/lib/review";
import type { PlannedEdit, SkippedOrder, Submission } from "@/lib/types";
import { formatClock, formatDuration } from "@/lib/time";

export function ConfirmView({ submission, stale }: { submission: Submission | null; stale: boolean }) {
  if (!submission) {
    return (
      <p className="rounded-xl bg-muted/50 p-4 text-sm leading-6">
        Submit from Review to record what would be edited. The confirmation stays in this browser. Fullbay is not called.
      </p>
    );
  }

  const shop = submission.shopId === "all" ? "All shops" : shopName(submission.shopId);
  const dayList = submission.days.map((day) => formatDayShort(day)).join(", ");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-medium">What would be edited</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Recorded locally {formatTimestamp(submission.submittedAt)} for {shop} · {dayList}. Nothing was sent to Fullbay.
        </p>
        {stale ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            The shop, days, or decisions changed after this confirmation. Submit again from Review to refresh it.
          </p>
        ) : null}
      </div>

      <EditList
        title="Would be written"
        empty="No accepted or overridden edits in this confirmation."
        edits={submission.edits}
        render={(edit) =>
          `${edit.decision === "accept" ? "Accepted as recommended" : "Override"} · ${formatClock(edit.start)}–${formatClock(edit.end)} · ${formatDuration(edit.minutes)} added to SO hours`
        }
      />
      <EditList
        title="Rejected"
        empty="No rejected recommendations."
        edits={submission.rejected}
        render={() => "Rejected. No reason recorded. Adds no SO hours."}
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

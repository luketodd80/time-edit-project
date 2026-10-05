"use client";

import { useEffect, useState } from "react";
import { ConfirmView } from "@/components/confirm-view";
import { DayBar } from "@/components/day-bar";
import { ReviewView } from "@/components/review-view";
import { SummaryView } from "@/components/summary-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { signoffApplyBlock, submissionToQueueRequest, type FullbayEditBatch } from "@/lib/fullbay-edit-queue";
import { attest, buildPlan, buildSubmission, filterReports, markDone, signoffKey, submissionFingerprint, submitBlockers } from "@/lib/review";
import { updateReview, useReviewSnapshot } from "@/lib/review-store";
import { SEED } from "@/lib/seed";
import type { Decision, ShopFilter, ShopId, ViewId } from "@/lib/types";

export function Dashboard() {
  const { state, loadError } = useReviewSnapshot();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [awaitingQueue, setAwaitingQueue] = useState(false);
  const [signoffError, setSignoffError] = useState<string | null>(null);
  const [queueBatches, setQueueBatches] = useState<FullbayEditBatch[] | null>(null);

  const reports = filterReports(SEED, state.shopId, state.days);
  const liveSubmission = buildSubmission(reports, state.decisions, state.shopId, state.days, state.submission?.submittedAt ?? "");
  const stale = state.submission != null && submissionFingerprint(state.submission) !== submissionFingerprint(liveSubmission);

  useEffect(() => {
    let cancelled = false;
    async function loadQueue() {
      try {
        const response = await fetch("/api/fullbay-edits/latest");
        if (!response.ok) return;
        const body = (await response.json()) as { batches?: FullbayEditBatch[] };
        if (!cancelled) setQueueBatches(body.batches ?? []);
      } catch {
        // The next poll retries. Mark-done fetches again before it writes a sign-off.
      }
    }
    void loadQueue();
    const timer = window.setInterval(() => void loadQueue(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function setShop(shopId: ShopFilter) {
    setSubmitError(null);
    updateReview((current) => ({ ...current, shopId }));
  }

  function toggleDay(day: string, checked: boolean) {
    setSubmitError(null);
    updateReview((current) => {
      const selected = current.days.includes(day);
      if (checked && !selected) return { ...current, days: [...current.days, day].sort() };
      if (!checked && selected && current.days.length > 1) {
        return { ...current, days: current.days.filter((item) => item !== day) };
      }
      return current;
    });
  }

  function setDecision(findingId: string, decision: Decision | null) {
    setSubmitError(null);
    updateReview((current) => {
      const decisions = { ...current.decisions };
      if (decision == null) delete decisions[findingId];
      else decisions[findingId] = decision;
      return { ...current, decisions };
    });
  }

  function setView(view: ViewId) {
    updateReview((current) => ({ ...current, view }));
  }

  function attestDay(day: string, shopId: ShopId, attestedValue: boolean) {
    setSignoffError(null);
    updateReview((current) => {
      const key = signoffKey(day, shopId);
      return {
        ...current,
        signoffs: { ...current.signoffs, [key]: attest(current.signoffs[key], attestedValue) },
      };
    });
  }

  async function refreshQueue(): Promise<FullbayEditBatch[] | null> {
    const response = await fetch("/api/fullbay-edits/latest");
    if (!response.ok) return null;
    const body = (await response.json()) as { batches?: FullbayEditBatch[] };
    const batches = body.batches ?? [];
    setQueueBatches(batches);
    return batches;
  }

  async function markDayDone(day: string, shopId: ShopId) {
    const key = signoffKey(day, shopId);
    let batches = queueBatches;
    try {
      batches = await refreshQueue();
    } catch {
      batches = null;
    }
    if (!batches) {
      setSignoffError("Could not check the Fullbay apply queue. The day was not marked done.");
      return;
    }
    const applyBlock = signoffApplyBlock(batches, day, shopId);
    if (applyBlock) {
      setSignoffError(applyBlock);
      return;
    }
    const next = markDone(state.signoffs[key], new Date().toISOString());
    if (!next) {
      setSignoffError("Check off the utilization numbers before marking the day done.");
      return;
    }
    setSignoffError(null);
    updateReview((current) => ({
      ...current,
      signoffs: { ...current.signoffs, [key]: next },
    }));
  }

  async function submit() {
    const plan = buildPlan(reports, state.decisions);
    const blockers = submitBlockers(plan);
    if (blockers.length > 0) {
      setSubmitError(blockers.join(" "));
      return;
    }
    const submission = buildSubmission(reports, state.decisions, state.shopId, state.days, new Date().toISOString());
    setSubmitError(null);
    setAwaitingQueue(true);
    updateReview((current) => ({ ...current, submission, view: "confirm" }));
    try {
      const response = await fetch("/api/fullbay-edits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submissionToQueueRequest(submission)),
      });
      if (!response.ok) {
        setQueueError("Saved in this browser. The Fullbay apply queue did not accept the edits, so apply has not started.");
        return;
      }
      setQueueError(null);
      await refreshQueue();
    } catch {
      setQueueError("Saved in this browser. The Fullbay apply queue could not be reached, so apply has not started.");
    } finally {
      setAwaitingQueue(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">The Service Company</p>
        <h1 className="text-3xl font-medium tracking-tight">Time gap review</h1>
        <p className="max-w-3xl leading-6 text-muted-foreground">
          Review missed time inside a clocked window, off-the-clock stretches, and the edit suggested for each gap. Accept, reject, or type a different start or end, then submit. The confirmation stays in this browser, and accepted edits are queued for Fullbay Time Stamp apply. This screen does not log into Fullbay.
        </p>
      </header>

      {loadError ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {loadError}
        </p>
      ) : null}

      <DayBar
        shopId={state.shopId}
        days={state.days}
        signoffs={state.signoffs}
        decisions={state.decisions}
        signoffError={signoffError}
        applyBlock={(day, shopId) => (queueBatches ? signoffApplyBlock(queueBatches, day, shopId) : null)}
        onShop={setShop}
        onToggleDay={toggleDay}
        onAttest={attestDay}
        onMarkDone={markDayDone}
      />

      <Tabs
        value={state.view}
        onValueChange={(value) => {
          if (value === "review" || value === "confirm" || value === "summary") setView(value);
        }}
      >
        <TabsList className="h-11">
          <TabsTrigger value="review" className="px-4 text-base">
            Review
          </TabsTrigger>
          <TabsTrigger value="confirm" className="px-4 text-base">
            Confirm
          </TabsTrigger>
          <TabsTrigger value="summary" className="px-4 text-base">
            Summary
          </TabsTrigger>
        </TabsList>
        <TabsContent value="review" className="pt-4 text-base">
          <ReviewView
            days={state.days}
            reports={reports}
            decisions={state.decisions}
            submitError={submitError ?? queueError}
            onDecision={setDecision}
            onSubmit={submit}
          />
        </TabsContent>
        <TabsContent value="confirm" className="pt-4 text-base">
          <ConfirmView
            submission={state.submission}
            stale={stale}
            batches={queueBatches ?? []}
            queueLoaded={queueBatches !== null}
            awaitingQueue={awaitingQueue}
            queueError={queueError}
          />
        </TabsContent>
        <TabsContent value="summary" className="pt-4 text-base">
          <SummaryView
            shopId={state.shopId}
            days={state.days}
            reports={reports}
            decisions={state.decisions}
            submission={state.submission}
            stale={stale}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

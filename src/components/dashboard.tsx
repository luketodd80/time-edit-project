"use client";

import { useState } from "react";
import { ConfirmView } from "@/components/confirm-view";
import { DayBar } from "@/components/day-bar";
import { ReviewView } from "@/components/review-view";
import { SummaryView } from "@/components/summary-view";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { attest, buildPlan, buildSubmission, filterReports, markDone, signoffKey, submissionFingerprint, submitBlockers } from "@/lib/review";
import { updateReview, useReviewSnapshot } from "@/lib/review-store";
import { SEED } from "@/lib/seed";
import type { Decision, ShopFilter, ShopId, ViewId } from "@/lib/types";

export function Dashboard() {
  const { state, loadError } = useReviewSnapshot();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signoffError, setSignoffError] = useState<string | null>(null);

  const reports = filterReports(SEED, state.shopId, state.days);
  const liveSubmission = buildSubmission(reports, state.decisions, state.shopId, state.days, state.submission?.submittedAt ?? "");
  const stale = state.submission != null && submissionFingerprint(state.submission) !== submissionFingerprint(liveSubmission);

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

  function markDayDone(day: string, shopId: ShopId) {
    const key = signoffKey(day, shopId);
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

  function submit() {
    const plan = buildPlan(reports, state.decisions);
    const blockers = submitBlockers(plan);
    if (blockers.length > 0) {
      setSubmitError(blockers.join(" "));
      return;
    }
    const submission = buildSubmission(reports, state.decisions, state.shopId, state.days, new Date().toISOString());
    setSubmitError(null);
    updateReview((current) => ({ ...current, submission, view: "confirm" }));
  }

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">The Service Company</p>
        <h1 className="text-3xl font-medium tracking-tight">Time gap review</h1>
        <p className="max-w-3xl leading-6 text-muted-foreground">
          Review missed time inside a clocked window, off-the-clock stretches, and the edit suggested for each gap. Accept, reject, or type a different start or end, then submit a confirmation that stays in this browser. This screen does not log into Fullbay or write time edits.
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
        signoffError={signoffError}
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
            submitError={submitError}
            onDecision={setDecision}
            onSubmit={submit}
          />
        </TabsContent>
        <TabsContent value="confirm" className="pt-4 text-base">
          <ConfirmView submission={state.submission} stale={stale} />
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

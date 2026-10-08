"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

/** Copy for the pre-submit confirmation. `acceptedCount` is how many edits the submit will send. */
export function submitConfirmMessage(acceptedCount: number): string {
  if (acceptedCount === 0) {
    return "You're submitting this day with no edits, so nothing will change in Fullbay and you won't receive a confirmation Slack message.";
  }
  const edits = acceptedCount === 1 ? "1 edit" : `${acceptedCount} edits`;
  return `You're getting ready to submit ${edits}. You will receive a confirmation Slack message when the edits are complete.`;
}

export function SubmitConfirmDialog({
  acceptedCount,
  onConfirm,
  onCancel,
}: {
  acceptedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="submit-confirm-title"
        aria-describedby="submit-confirm-body"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl bg-background p-5 shadow-lg outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="submit-confirm-title" className="text-lg font-medium">
          Submit edits?
        </h2>
        <p id="submit-confirm-body" className="mt-3 text-base leading-6">
          {submitConfirmMessage(acceptedCount)}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" size="lg" className="w-full sm:w-auto" onClick={onCancel}>
            Go back
          </Button>
          <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onConfirm}>
            Submit
          </Button>
        </div>
      </div>
    </div>
  );
}

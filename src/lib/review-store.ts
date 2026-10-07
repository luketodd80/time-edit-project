"use client";

import { useSyncExternalStore } from "react";
import { defaultPendingDays, reviewWindow, todayInNewYork } from "@/lib/dates";
import { shopsWithData } from "@/lib/review";
import { SEED } from "@/lib/seed";
import { clearState, loadState, saveState } from "@/lib/storage";
import type { PersistedState } from "@/lib/types";

export interface ReviewSnapshot {
  state: PersistedState;
  loadError: string | null;
}

function emptyState(): PersistedState {
  const today = todayInNewYork();
  const due = defaultPendingDays(today);
  return {
    shopId: "all",
    days: due.length > 0 ? [due[due.length - 1]] : [],
    view: "review",
    decisions: {},
    signoffs: {},
    submission: null,
  };
}

function sanitize(saved: PersistedState): PersistedState {
  const today = todayInNewYork();
  const loaded = shopsWithData(SEED);
  const shopId = saved.shopId === "all" || loaded.includes(saved.shopId) ? saved.shopId : "all";
  const allowed = new Set(reviewWindow(today));
  const days = saved.days.filter((day) => allowed.has(day)).sort();
  const due = defaultPendingDays(today);
  const selected = days.at(-1) ?? due.at(-1);
  return {
    ...saved,
    shopId,
    days: selected ? [selected] : [],
  };
}

const serverSnapshot: ReviewSnapshot = { state: emptyState(), loadError: null };
let snapshot: ReviewSnapshot = serverSnapshot;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function hydrate(): ReviewSnapshot {
  if (hydrated) return snapshot;
  hydrated = true;
  try {
    const saved = loadState();
    snapshot = saved ? { state: sanitize(saved), loadError: null } : serverSnapshot;
  } catch {
    clearState();
    snapshot = {
      state: emptyState(),
      loadError: "Saved review data on this browser could not be read, so it was cleared.",
    };
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  if (typeof window === "undefined") return serverSnapshot;
  return hydrate();
}

function getServerSnapshot() {
  return serverSnapshot;
}

export function updateReview(recipe: (current: PersistedState) => PersistedState) {
  const current = hydrate().state;
  const next = recipe(current);
  if (next === current) return;
  let loadError = snapshot.loadError;
  try {
    saveState(next);
  } catch {
    loadError = "This browser blocked saving the review. Decisions will last only until you leave the page.";
  }
  snapshot = { state: next, loadError };
  emit();
}

export function useReviewSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

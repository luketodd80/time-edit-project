"use client";

import { useSyncExternalStore } from "react";
import { defaultPendingDays, reviewWindow, todayInNewYork } from "@/lib/dates";
import { shopsWithData } from "@/lib/review";
import { SEED } from "@/lib/seed";
import { clearState, loadState, saveState } from "@/lib/storage";
import type { PersistedState, ShopFilter, ShopId } from "@/lib/types";

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

/** Opens the shop and day from `?shop=&day=` when that day is on the review trail. */
export function reviewSelectionFromQuery(state: PersistedState, search: string, today = todayInNewYork()): PersistedState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const day = params.get("day");
  const shop = params.get("shop");
  if ((day == null || day.length === 0) && (shop == null || shop.length === 0)) return state;
  const allowed = new Set(reviewWindow(today));
  const loaded = shopsWithData(SEED);
  let shopId = state.shopId;
  if (shop === "all" || (shop != null && loaded.includes(shop as ShopId))) shopId = shop as ShopFilter;
  const days = day != null && allowed.has(day) ? [day] : state.days;
  const view = day != null && allowed.has(day) ? "review" : state.view;
  return { ...state, shopId, days, view };
}

function hydrate(): ReviewSnapshot {
  if (hydrated) return snapshot;
  hydrated = true;
  try {
    const saved = loadState();
    const base = saved ? sanitize(saved) : emptyState();
    snapshot = { state: reviewSelectionFromQuery(base, window.location.search), loadError: null };
  } catch {
    clearState();
    snapshot = {
      state: reviewSelectionFromQuery(emptyState(), window.location.search),
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

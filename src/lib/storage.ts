import { SHOPS, type Decision, type PersistedState, type ShopFilter, type Signoff, type Submission, type ViewId } from "@/lib/types";

const STORAGE_KEY = "tsc-time-gap-review-v2";

const SHOP_IDS = new Set<string>(SHOPS.map((shop) => shop.id));
const VIEWS = new Set<ViewId>(["review", "confirm", "summary"]);

function isShopFilter(value: unknown): value is ShopFilter {
  return value === "all" || (typeof value === "string" && SHOP_IDS.has(value));
}

const NON_PRO_TYPES = new Set(["extend_prev_out", "move_next_in", "split", "move_to_so", "partial", "keep"]);
const NON_PRO_REMAINDERS = new Set(["previous", "next", "both"]);

function isDecision(value: unknown): value is Decision {
  if (!value || typeof value !== "object") return false;
  const decision = value as Decision;
  return (
    (decision.kind === "accept" || decision.kind === "reject" || decision.kind === "override") &&
    typeof decision.start === "string" &&
    typeof decision.end === "string"
  );
}

function cleanDecision(decision: Decision): Decision {
  const base: Decision = { kind: decision.kind, start: decision.start, end: decision.end };
  if (decision.nonProEditType == null) return base;
  if (!NON_PRO_TYPES.has(decision.nonProEditType)) return base;
  if (typeof decision.split === "string" && decision.split.length > 0) base.split = decision.split;
  if (typeof decision.targetOrderId === "string" && decision.targetOrderId.trim().length > 0) {
    base.targetOrderId = decision.targetOrderId.trim();
  }
  if (decision.nonProRemainder && NON_PRO_REMAINDERS.has(decision.nonProRemainder)) {
    base.nonProRemainder = decision.nonProRemainder;
  }
  base.nonProEditType = decision.nonProEditType;
  return base;
}

function isSignoff(value: unknown): value is Signoff {
  if (!value || typeof value !== "object") return false;
  const signoff = value as Signoff;
  return typeof signoff.attested === "boolean" && (signoff.doneAt === null || typeof signoff.doneAt === "string");
}

function cleanSignoff(signoff: Signoff): Signoff {
  if (!signoff.attested) return { attested: false, doneAt: null };
  const note = typeof signoff.note === "string" && signoff.note.trim().length > 0 ? signoff.note.trim() : null;
  return note ? { attested: true, doneAt: signoff.doneAt, note } : { attested: true, doneAt: signoff.doneAt };
}

export function parsePersistedState(raw: string): PersistedState {
  const data = JSON.parse(raw) as Partial<PersistedState>;
  if (!data || typeof data !== "object") throw new Error("Saved review data is not an object.");
  if (!isShopFilter(data.shopId)) throw new Error("Saved shop filter is invalid.");
  if (!Array.isArray(data.days) || data.days.some((day) => typeof day !== "string")) {
    throw new Error("Saved days are invalid.");
  }
  if (!VIEWS.has(data.view as ViewId)) throw new Error("Saved view is invalid.");

  const decisions: Record<string, Decision> = {};
  if (data.decisions && typeof data.decisions === "object") {
    for (const [id, decision] of Object.entries(data.decisions)) {
      if (isDecision(decision)) decisions[id] = cleanDecision(decision);
    }
  }

  const signoffs: Record<string, Signoff> = {};
  if (data.signoffs && typeof data.signoffs === "object") {
    for (const [key, signoff] of Object.entries(data.signoffs)) {
      if (isSignoff(signoff)) signoffs[key] = cleanSignoff(signoff);
    }
  }

  const submission = data.submission && typeof data.submission === "object" ? (data.submission as Submission) : null;

  return {
    shopId: data.shopId,
    days: data.days.length > 0 ? [...data.days].sort() : [],
    view: data.view as ViewId,
    decisions,
    signoffs,
    submission,
  };
}

export function loadState(): PersistedState | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return parsePersistedState(raw);
}

export function saveState(state: PersistedState): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

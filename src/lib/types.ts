/** Shops the review can filter. Only shops that have a loaded day appear in the selector. */
export const SHOPS = [
  { id: "dayton", name: "Dayton" },
  { id: "covington", name: "Covington" },
  { id: "greenville", name: "Greenville" },
  { id: "springfield", name: "Springfield" },
  { id: "mobile", name: "Mobile" },
  { id: "columbus", name: "Columbus" },
] as const;

export type ShopId = (typeof SHOPS)[number]["id"];

export type ShopFilter = ShopId | "all";

/** priorities = open on the priorities screen. office = completed, not invoiced. invoiced = closed. */
export type OrderStatus = "priorities" | "office" | "invoiced";

export interface ServiceOrder {
  id: string;
  shopId: ShopId;
  /** Empty when the Friday excerpt did not name the work. */
  title: string;
  status: OrderStatus;
}

export interface Technician {
  id: string;
  shopId: ShopId;
  name: string;
  /** Decimal hours on the clock that day, before any decision. */
  clockedHours: number;
  /** Decimal service-order hours that day, before any decision. */
  soHours: number;
  /**
   * Hours inside this shop's clock punches that are already on another shop's service order.
   * Those hours are omitted from `clockedHours` so this shop's percentage stays in scope.
   */
  foreignCoveredHours?: number;
  /** Day-sheet header after the name, when the report states one. */
  sheetLine?: string;
  /** Second line under that header. */
  sheetNote?: string;
}

export type FindingKind = "gap" | "off_clock" | "flag" | "as_is";

export interface Recommendation {
  orderId: string;
  /** Specific work line. Can differ from the order title when one order has several lines. */
  work: string;
  /** Recommended edit window, 24-hour HH:MM. */
  start: string;
  end: string;
  /**
   * Minutes added to SO hours when this window is kept as recommended.
   * The shop report's stated minutes win over a one-minute clock-span difference.
   */
  minutes: number;
  summary: string;
  optional?: boolean;
}

export interface Finding {
  id: string;
  day: string;
  shopId: ShopId;
  techId: string;
  kind: FindingKind;
  /** Clock span of the finding, 24-hour HH:MM. */
  start: string;
  end: string;
  minutes: number;
  /** What the report shows. */
  detail: string;
  /**
   * Right-hand column when this row is not a time-edit recommendation.
   * Leave-as-is rows and the no-order flag set this.
   */
  suggested?: string;
  /** Missed column says "Not a gap" even though the tech was clocked. */
  notAGap?: boolean;
  /**
   * Set on a Non-Pro attendance punch the manager must review.
   * `recommendation` stays null so this is not a one-click time suggestion.
   */
  nonPro?: NonProReview;
  recommendation: Recommendation | null;
}

/** How a Non-Pro attendance row is applied in Fullbay. `keep` changes nothing. */
export type NonProEditType = "extend_prev_out" | "move_next_in" | "split" | "move_to_so" | "keep";

/** A neighboring service-order punch the Non-Pro span can be given to. */
export interface NonProNeighbor {
  orderId: string;
  /** Action item on that punch. */
  work: string;
  shopId: ShopId;
  /** Clock times currently on that service-order row. */
  clockIn: string;
  clockOut: string;
}

/** A service order the manager can move the Non-Pro span onto, keeping its times. */
export interface NonProOrderOption {
  orderId: string;
  work: string;
  shopId: ShopId;
}

/**
 * Choices for one Non-Pro attendance row.
 * `previous` and `next` are set only when giving that neighbor the span would not overlap another punch.
 */
export interface NonProReview {
  previous: NonProNeighbor | null;
  next: NonProNeighbor | null;
  /** Both neighbors are available and the span is long enough to split. */
  canSplit: boolean;
  orders: NonProOrderOption[];
}

/** One service-order row a Non-Pro choice changes, with the times before and after. */
export interface NonProAffectedRow {
  orderId: string;
  work: string;
  shopId: ShopId;
  clockIn: string;
  clockOut: string;
  newClockIn: string;
  newClockOut: string;
}

/**
 * Everything the Fullbay applier needs for a Non-Pro decision.
 * `rows` is empty for `keep`. For `move_to_so`, the row's clock times are the Non-Pro times
 * (there is no earlier punch on that order; the times are kept).
 * For `split`, `rows` has the previous order first and the next order second.
 */
export interface NonProEditPayload {
  editType: NonProEditType;
  /** Clock times of the original Non-Pro row. */
  originalClockIn: string;
  originalClockOut: string;
  rows: NonProAffectedRow[];
}

/** One shop's loaded day. Days with no report are simply absent. */
export interface DayReport {
  day: string;
  shopId: ShopId;
  technicians: Technician[];
  findings: Finding[];
  orders: ServiceOrder[];
}

export type DecisionKind = "accept" | "reject" | "override";

export interface Decision {
  kind: DecisionKind;
  /**
   * Override fields. Empty string means that side stays as recommended.
   * Ignored for accept and reject.
   */
  start: string;
  end: string;
  /**
   * Set when this decision is for a Non-Pro review.
   * `keep` is stored with kind `reject` and is not queued.
   */
  nonProEditType?: NonProEditType;
  /** Split clock time, HH:MM, when `nonProEditType` is `split`. */
  split?: string;
  /** Service order number when `nonProEditType` is `move_to_so`. */
  targetOrderId?: string;
}

export interface Signoff {
  attested: boolean;
  doneAt: string | null;
  /** Server note when the day was signed off without the checkbox, such as an auto sign-off. */
  note?: string | null;
}

export type ViewId = "review" | "confirm" | "summary";

export interface PlannedEdit {
  findingId: string;
  day: string;
  shopId: ShopId;
  techName: string;
  orderId: string;
  work: string;
  orderStatus: OrderStatus;
  decision: DecisionKind | "undecided";
  start: string;
  end: string;
  minutes: number;
  error: string | null;
  /** Present for a Non-Pro review decision, including keep. */
  nonPro?: NonProEditPayload;
}

export interface SkippedOrder {
  day: string;
  shopId: ShopId;
  orderId: string;
  title: string;
  reason: string;
}

export interface Submission {
  submittedAt: string;
  shopId: ShopFilter;
  days: string[];
  edits: PlannedEdit[];
  rejected: PlannedEdit[];
  undecided: PlannedEdit[];
  skipped: SkippedOrder[];
}

export interface PersistedState {
  shopId: ShopFilter;
  days: string[];
  view: ViewId;
  decisions: Record<string, Decision>;
  /** Keyed by `${day}|${shopId}`. */
  signoffs: Record<string, Signoff>;
  submission: Submission | null;
}

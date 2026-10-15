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

/**
 * One tech-day whose shift clock-out or a service-order punch runs to 11:55 PM or later.
 * Fullbay parks a forgotten punch near midnight. The 24-hour Inactive placeholder is not this.
 */
export interface ForgotClockSpan {
  /** HH:MM on this shift. A next-day midnight clock-out is 23:59. */
  clockIn: string;
  clockOut: string;
  /** Hours on the Fullbay row. These are the hours utilization leaves out until corrected. */
  hours: number;
  /** True when this end is 23:55 or later. A real earlier shift end is stored so it can be confirmed. */
  late: boolean;
}

export interface ForgotClockOrder extends ForgotClockSpan {
  orderId: string;
  work: string;
}

export interface ForgotClockOut {
  /** Last punch end that is not itself a midnight run, HH:MM. Empty when this day has no other end. */
  suggestedEnd: string;
  /** Shift punch that ran late, or the shift that contains a late service order. */
  shift: ForgotClockSpan | null;
  /** Service-order punch that ran late. Absent when only the shift clock-out did. */
  order: ForgotClockOrder | null;
}

/** One Fullbay change inside a forgotten-clock-out decision. `so` is empty on the shift clock-out. */
export interface ClockCorrection {
  type: "clock_out" | "so_out";
  tech: string;
  so: string;
  oldTime: string;
  newTime: string;
}

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
  /** Service-order punch before this edit. Seconds are kept when Fullbay has them. */
  soClockIn?: string;
  soClockOut?: string;
  /** Service-order punch after this edit, with seconds when they differ from `start` and `end`. */
  soNewClockIn?: string;
  soNewClockOut?: string;
  /** Shift clock-out. Accept stops here. Override may pass it. */
  shiftClockOut?: string;
  /**
   * Set when this edit overlaps a Non-Pro punch.
   * `new` shortens that row. `remove` deletes it. Older recommendations omit this.
   */
  nonProChange?: NonProChange;
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
  /**
   * A later correction for a shop day that may already be signed off.
   * It can be decided and submitted on its own. It does not reopen the sign-off.
   */
  followUp?: boolean;
  /**
   * Set when this tech's shift clock-out or a service-order punch ends at 23:55 or later.
   * The manager sets the real shift clock-out and the real SO end, or rejects the flag.
   */
  forgotClockOut?: ForgotClockOut;
  recommendation: Recommendation | null;
}

/** How a Non-Pro attendance row is applied in Fullbay. `keep` changes nothing. */
export type NonProEditType = "extend_prev_out" | "move_next_in" | "split" | "move_to_so" | "partial" | "keep";

/** Which side of a shortened Non-Pro row receives the rest of the span. */
export type NonProRemainder = "previous" | "next" | "both";

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
  /** Every service-order punch for this tech that day, on any shop. */
  punches: NonProNeighbor[];
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
 * `rows` is empty for `keep`. For `move_to_so`, the row's clock times are the window moved
 * onto that order (the whole span, unless the manager shortens it).
 * For `split` and `partial` with both neighbors, `rows` has the previous order first and the next order second.
 * `keptClockIn` and `keptClockOut` are the shortened Non-Pro row that stays. They are omitted when the whole span is given away.
 */
export interface NonProEditPayload {
  editType: NonProEditType;
  /** Clock times of the original Non-Pro row. */
  originalClockIn: string;
  originalClockOut: string;
  rows: NonProAffectedRow[];
  /** Shortened Non-Pro row that stays on the timesheet. */
  keptClockIn?: string;
  keptClockOut?: string;
}

/**
 * Non-Pro row changed by the same service-order edit.
 * A shorten is `{ original, new }`. A full cover is `{ remove: true }`.
 * Older edits omit this and keep using `nonPro` for attendance choices.
 */
export interface NonProChange {
  original?: { in: string; out: string };
  new?: { in: string; out: string };
  remove?: true;
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
   * A Non-Pro choice also stores its edited clock times here.
   */
  start: string;
  end: string;
  /**
   * Set when this decision is for a Non-Pro review.
   * `keep` is stored with kind `reject` and is not queued.
   */
  nonProEditType?: NonProEditType;
  /** Split clock time, HH:MM, when `nonProEditType` is `split`. The previous order's new clock-out. */
  split?: string;
  /** Service order number when `nonProEditType` is `move_to_so`. */
  targetOrderId?: string;
  /**
   * Where the rest of a `partial` row goes.
   * `start` and `end` are the Non-Pro window that stays.
   * On the other choices, `start` and `end` are the adjusted service-order times when the manager edits them.
   */
  nonProRemainder?: NonProRemainder;
  /**
   * Override clock for the Non-Pro row that stays, HH:MM.
   * Blank keeps the recommended shorten, or the removal when the recommendation removes the row.
   */
  nonProIn?: string;
  nonProOut?: string;
  /**
   * Set when this decision was made after the move-time reopen.
   * An older saved decision for the same finding is dropped while those rows are open.
   */
  moveTime?: boolean;
  /**
   * Real shift clock-out for a forgotten-clock-out flag, HH:MM.
   * Empty until the manager sets it. Reject leaves this blank.
   */
  shiftClockOut?: string;
  /** Real service-order end for a forgotten-clock-out flag, HH:MM. */
  soClockOut?: string;
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
  /** Present when this service-order edit also shortens or removes a Non-Pro row. */
  nonProChange?: NonProChange;
  /** True when this line is a follow-up that can be submitted after the shop day is signed off. */
  followUp?: boolean;
  /**
   * Forgotten clock-out. One shift clock-out correction and one SO Out edit.
   * `type` is `clock_out` or `so_out`. `so` is empty on the shift correction.
   */
  corrections?: ClockCorrection[];
  /** True when this line is a forgotten clock-out, including a rejection that sends nothing. */
  forgotClockOut?: boolean;
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

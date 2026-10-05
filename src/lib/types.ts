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
  recommendation: Recommendation | null;
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
}

export interface Signoff {
  attested: boolean;
  doneAt: string | null;
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

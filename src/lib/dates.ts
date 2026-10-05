/** Demo "today". Tuesday, so the default review day is Monday 2026-10-05. */
export const DEMO_TODAY = "2026-10-06";

export const REVIEW_LOOKBACK_DAYS = 14;

/** First day shown on the day chips and the audit trail. */
export const AUDIT_START = "2026-10-02";

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 Sunday … 6 Saturday, from a YYYY-MM-DD string. */
export function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/**
 * Days a morning review is expected to cover.
 * Monday approves Friday and Saturday. Every other weekday approves the previous day.
 */
export function defaultPendingDays(today: string): string[] {
  if (weekday(today) === 1) {
    return [addDays(today, -3), addDays(today, -2)];
  }
  return [addDays(today, -1)];
}

/** Recent reviewable days, oldest first. Sundays are closed and omitted. Nothing before AUDIT_START is included. */
export function reviewWindow(today: string, lookback = REVIEW_LOOKBACK_DAYS): string[] {
  const days: string[] = [];
  for (let offset = lookback; offset >= 1; offset -= 1) {
    const day = addDays(today, -offset);
    if (day < AUDIT_START) continue;
    if (weekday(day) === 0) continue;
    days.push(day);
  }
  return days;
}

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

export function formatDayShort(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

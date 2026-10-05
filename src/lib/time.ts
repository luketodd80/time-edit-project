import type { Decision, Recommendation } from "@/lib/types";

export function parseClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClock(value: string): string {
  const minutes = parseClock(value);
  if (minutes == null) return value;
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const mins = whole % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function formatHours(hours: number): string {
  return `${hours.toFixed(2)} h`;
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export interface AppliedWindow {
  start: string;
  end: string;
  minutes: number;
  valid: boolean;
  error: string | null;
}

/**
 * Minutes credited for a decision.
 * A blank or unchanged override side keeps the recommended clock time.
 * An unchanged window uses the report's stated minutes.
 */
export function appliedWindow(recommendation: Recommendation, decision: Decision): AppliedWindow {
  if (decision.kind === "reject") {
    return {
      start: recommendation.start,
      end: recommendation.end,
      minutes: 0,
      valid: true,
      error: null,
    };
  }

  if (decision.kind === "accept") {
    return {
      start: recommendation.start,
      end: recommendation.end,
      minutes: recommendation.minutes,
      valid: true,
      error: null,
    };
  }

  const start = decision.start.trim() === "" ? recommendation.start : decision.start.trim();
  const end = decision.end.trim() === "" ? recommendation.end : decision.end.trim();
  const startMinutes = parseClock(start);
  const endMinutes = parseClock(end);
  if (startMinutes == null || endMinutes == null) {
    return { start, end, minutes: 0, valid: false, error: "Enter a valid start and end." };
  }
  if (endMinutes <= startMinutes) {
    return { start, end, minutes: 0, valid: false, error: "End must be after start." };
  }
  const unchanged = start === recommendation.start && end === recommendation.end;
  return {
    start,
    end,
    minutes: unchanged ? recommendation.minutes : endMinutes - startMinutes,
    valid: true,
    error: null,
  };
}

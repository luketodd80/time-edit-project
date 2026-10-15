import type { ClockCorrection, Decision, ForgotClockOut } from "@/lib/types";
import { formatClock, parseClock } from "@/lib/time";

/** A punch that ends at this minute or later is treated as a forgotten clock-out. */
export const FORGOT_CLOCK_OUT_MINUTE = 23 * 60 + 55;

export const FORGOT_CLOCK_OUT_LABEL = "Likely forgot to clock out";

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isForgottenEnd(totalSeconds: number): boolean {
  return totalSeconds >= FORGOT_CLOCK_OUT_MINUTE * 60;
}

export function isClockMinute(value: string): boolean {
  return CLOCK.test(value);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Hours from HH:MM to HH:MM. Zero when the end is not after the start. */
export function spanHours(clockIn: string, clockOut: string): number {
  const start = parseClock(clockIn);
  const end = parseClock(clockOut);
  if (start == null || end == null || end <= start) return 0;
  return round2((end - start) / 60);
}

/**
 * Both boxes start at the last other punch end.
 * A shift that did not itself run late keeps its recorded clock-out.
 */
export function forgotPrefill(info: ForgotClockOut): { shiftOut: string; soOut: string } {
  const shiftOut = info.shift && !info.shift.late ? info.shift.clockOut : info.suggestedEnd;
  const soOut = info.suggestedEnd || info.order?.clockOut || info.shift?.clockOut || "";
  return { shiftOut, soOut };
}

/** Why these two times cannot be sent. Null when both are a real correction. */
export function forgotTimeError(info: ForgotClockOut, shiftOut: string, soOut: string): string | null {
  if (!isClockMinute(shiftOut) || !isClockMinute(soOut)) {
    return "Enter both the shift clock-out and the SO end.";
  }
  if (shiftOut >= "23:55" || soOut >= "23:55") {
    return "That end is still 11:55 PM or later. Enter the real time, or reject the flag.";
  }
  if (info.shift && shiftOut <= info.shift.clockIn) {
    return `Shift clock-out has to be after the ${formatClock(info.shift.clockIn)} clock-in.`;
  }
  if (info.order && soOut <= info.order.clockIn) {
    return `SO end has to be after the ${formatClock(info.order.clockIn)} start on ${info.order.orderId}.`;
  }
  if (info.shift?.late && info.order && soOut > shiftOut) {
    return "SO end has to be at or before the shift clock-out.";
  }
  return null;
}

export function forgotDecisionReady(info: ForgotClockOut, decision: Decision | undefined): boolean {
  if (!decision || decision.kind === "reject") return false;
  return forgotTimeError(info, decision.shiftClockOut ?? "", decision.soClockOut ?? "") == null;
}

/**
 * Clock-out correction plus an SO Out edit.
 * `so` is empty on the shift row. Times are HH:MM.
 */
export function buildClockCorrections(info: ForgotClockOut, tech: string, shiftOut: string, soOut: string): ClockCorrection[] {
  const corrections: ClockCorrection[] = [];
  const shiftOld = info.shift?.clockOut ?? info.order?.clockOut ?? shiftOut;
  corrections.push({ type: "clock_out", tech, so: "", oldTime: shiftOld, newTime: shiftOut });
  if (info.order) {
    corrections.push({
      type: "so_out",
      tech,
      so: info.order.orderId,
      oldTime: info.order.clockOut,
      newTime: soOut,
    });
  }
  return corrections;
}

export function correctionSummary(corrections: ClockCorrection[]): string {
  return corrections
    .map((correction) => {
      const change = `${formatClock(correction.oldTime)} → ${formatClock(correction.newTime)}`;
      if (correction.type === "clock_out") return `Clock-out correction for ${correction.tech}: ${change}`;
      return `SO Out ${correction.so} for ${correction.tech}: ${change}`;
    })
    .join(". ");
}

export type ForgotHoursMode = "pending" | "original" | { shiftOut: string; soOut: string };

export interface ForgotHours {
  clockedHours: number;
  soHours: number;
  pendingClockedHours: number;
  pendingSoHours: number;
}

function bogusHours(info: ForgotClockOut): { clocked: number; so: number } {
  return {
    clocked: info.shift?.late ? info.shift.hours : 0,
    so: info.order?.late ? info.order.hours : 0,
  };
}

/**
 * Pending drops the midnight punch's hours. A correction puts that punch back
 * at the times the manager set. Reject keeps the recorded hours.
 */
export function applyForgotHours(clockedHours: number, soHours: number, info: ForgotClockOut, mode: ForgotHoursMode): ForgotHours {
  const bogus = bogusHours(info);
  if (mode === "original") {
    return { clockedHours, soHours, pendingClockedHours: 0, pendingSoHours: 0 };
  }
  if (mode === "pending") {
    return {
      clockedHours: round2(Math.max(0, clockedHours - bogus.clocked)),
      soHours: round2(Math.max(0, soHours - bogus.so)),
      pendingClockedHours: round2(bogus.clocked),
      pendingSoHours: round2(bogus.so),
    };
  }
  const shiftHours = info.shift?.late ? spanHours(info.shift.clockIn, mode.shiftOut) : 0;
  const soSpan = info.order?.late ? spanHours(info.order.clockIn, mode.soOut) : 0;
  return {
    clockedHours: round2(Math.max(0, clockedHours - bogus.clocked + shiftHours)),
    soHours: round2(Math.max(0, soHours - bogus.so + soSpan)),
    pendingClockedHours: 0,
    pendingSoHours: 0,
  };
}

export function forgotModeFromDecision(info: ForgotClockOut, decision: Decision | undefined): ForgotHoursMode {
  if (!decision) return "pending";
  if (decision.kind === "reject") return "original";
  const shiftOut = decision.shiftClockOut ?? "";
  const soOut = decision.soClockOut ?? "";
  if (forgotTimeError(info, shiftOut, soOut)) return "pending";
  return { shiftOut, soOut };
}

export function forgotPendingNote(info: ForgotClockOut): string {
  const bogus = bogusHours(info);
  const order = info.order ? ` ${info.order.orderId}` : "";
  return `${FORGOT_CLOCK_OUT_LABEL}${order}. ${bogus.clocked.toFixed(2)} clocked h and ${bogus.so.toFixed(2)} SO h are pending and not counted until corrected.`;
}

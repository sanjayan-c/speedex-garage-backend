// src/utils/time.js
import { DateTime, Interval } from "luxon";

/** Return current DateTime in America/Toronto. */
export function nowToronto() {
  return DateTime.now().setZone("America/Toronto");
}

/**
 * Build today's shift window in Toronto with a DB-driven buffer.
 * @param {{ start_local_time: string, end_local_time: string, margin_minutes?: number }} shiftRow
 * @param {{ marginMinutes?: number }=} opts
 * @returns {{ windowStart: DateTime, windowEnd: DateTime }}
 */
export function buildShiftWindowToronto(shiftRow, opts = {}) {
  const margin = Number.isInteger(opts.marginMinutes)
    ? opts.marginMinutes
    : Number(shiftRow?.margin_minutes) || 30; // fallback if not provided

  const now = nowToronto();
  const [sh, sm, ss] = (shiftRow.start_local_time || "09:00:00")
    .split(":")
    .map(Number);
  const [eh, em, es] = (shiftRow.end_local_time || "17:00:00")
    .split(":")
    .map(Number);

  const start = now.set({
    hour: sh,
    minute: sm ?? 0,
    second: ss ?? 0,
    millisecond: 0,
  });
  const end = now.set({
    hour: eh,
    minute: em ?? 0,
    second: es ?? 0,
    millisecond: 0,
  });

  // Use DB margin on both sides (was hardcoded 30)
  const windowStart = start.minus({ minutes: margin });
  const windowEnd = end.plus({ minutes: margin });

  // handle end crossing midnight
  if (windowEnd < windowStart) {
    return { windowStart, windowEnd: windowEnd.plus({ days: 1 }) };
  }
  return { windowStart, windowEnd };
}

export function isInWindow(torontoTime, windowStart, windowEnd) {
  return Interval.fromDateTimes(windowStart, windowEnd).contains(torontoTime);
}

export function toToronto(utcDate) {
  if (!utcDate) return null;
  return DateTime.fromJSDate(utcDate).setZone("America/Toronto").toISO();
}

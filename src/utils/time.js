// src/utils/time.js
import { DateTime, Interval } from "luxon";

/**
 * Return current DateTime in America/Toronto.
 */
export function nowToronto() {
  return DateTime.now().setZone("America/Toronto");
}

/**
 * Build today's shift window in Toronto with a 30-min early/late buffer.
 * @param {{ start_local_time: string, end_local_time: string }} shiftRow
 * @returns {{ windowStart: DateTime, windowEnd: DateTime }}
 */
export function buildShiftWindowToronto(shiftRow) {
  // shiftRow.start_local_time like "09:00:00", end like "17:00:00"
  const now = nowToronto();
  const [sh, sm, ss] = shiftRow.start_local_time.split(":").map(Number);
  const [eh, em, es] = shiftRow.end_local_time.split(":").map(Number);

  const start = now.set({ hour: sh, minute: sm ?? 0, second: ss ?? 0, millisecond: 0 });
  const end   = now.set({ hour: eh, minute: em ?? 0, second: es ?? 0, millisecond: 0 });

  // allow 30 min before start and 30 min after end
  const windowStart = start.minus({ minutes: 30 });
  const windowEnd   = end.plus({ minutes: 30 });

  // handle case where end crosses midnight (rare but possible)
  if (windowEnd < windowStart) {
    // make end on next day
    return {
      windowStart,
      windowEnd: windowEnd.plus({ days: 1 })
    };
  }

  return { windowStart, windowEnd };
}

/**
 * Check if a given Toronto time is in the window.
 */
export function isInWindow(torontoTime, windowStart, windowEnd) {
  return Interval.fromDateTimes(windowStart, windowEnd).contains(torontoTime);
}

export function toToronto(utcDate) {
  if (!utcDate) return null;
  return DateTime.fromJSDate(utcDate).setZone("America/Toronto").toISO();
}
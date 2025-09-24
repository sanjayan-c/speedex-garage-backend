// src/jobs/shiftLogout.js
import cron from "node-cron";
import { pool } from "../utils/db.js";
import { logoutAllStaff } from "../services/auth.js";
import { timeoutAllStaff } from "../services/attendance.js";

/**
 * Read end_local_time and margintime from DB.
 * If an override is provided, it takes precedence over DB value.
 * Returns { hour, minute } in local Toronto time (24h).
 */
async function readEndPlusMargin(overrideMarginMinutes) {
  // Fetch end time and margin from DB (defaults at DB level: margintime DEFAULT 30)
  const { rows } = await pool.query(
    `SELECT end_local_time::text AS end_local_time,
            COALESCE(margintime, 30) AS margintime
       FROM shift_hours
      WHERE id = 1`
  );

  // Fallbacks if not configured yet
  if (!rows.length) {
    const margin = Number.isInteger(overrideMarginMinutes)
      ? overrideMarginMinutes
      : 30; // final fallback
    // default end 17:00 Toronto
    const total = 17 * 60 + 0 + margin;
    return { hour: Math.floor(total / 60) % 24, minute: total % 60 };
  }

  const endText = rows[0].end_local_time; // "HH:MM:SS" or "HH:MM"
  const dbMargin = Number(rows[0].margintime) || 30;

  const margin = Number.isInteger(overrideMarginMinutes)
    ? overrideMarginMinutes
    : dbMargin;

  // robust parse: accept HH:MM or HH:MM:SS
  const parts = endText.split(":").map(Number);
  const h = parts[0] ?? 17;
  const m = parts[1] ?? 0;

  const total = h * 60 + m + margin;
  const minute = total % 60;
  const hour = Math.floor(total / 60) % 24; // wrap past midnight
  return { hour, minute };
}

let currentTask = null;

/**
 * Schedule (or reschedule) the daily logout job at end + margin in America/Toronto.
 * Optional arg: { marginMinutes } to override DB for this scheduling call.
 */
export async function scheduleShiftLogout({ marginMinutes } = {}) {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  const { hour, minute } = await readEndPlusMargin(marginMinutes);
  const expr = `${minute} ${hour} * * *`;

  currentTask = cron.schedule(
    expr,
    async () => {
      try {
        // 1) Force OUT anyone still IN
        await timeoutAllStaff();

        // 2) Revoke tokens + flip flags, etc.
        await logoutAllStaff();

        console.log(`[cron] Forced time_out + logged out all staff at end+margin (Toronto)`);
      } catch (e) {
        console.error("[cron] Logout/timeout job failed:", e);
      }
    },
    { timezone: "America/Toronto" }
  );

  console.log(
    `[cron] Scheduled logout daily at ${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")} America/Toronto`
  );
  currentTask.start();
}

/**
 * Call this after an admin updates shift hours to reschedule immediately.
 * Accepts optional { marginMinutes } but will read from DB if not provided.
 */
export async function rescheduleShiftLogout(opts) {
  await scheduleShiftLogout(opts);
}

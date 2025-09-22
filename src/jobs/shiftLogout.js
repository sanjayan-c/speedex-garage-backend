// src/jobs/shiftLogout.js
import cron from "node-cron";
import { pool } from "../utils/db.js";
import { logoutAllStaff } from "../services/auth.js";
import { timeoutAllStaff } from "../services/attendance.js";

/**
 * Read the end_local_time from DB, add 30 minutes, and return { hour, minute }
 * in local Toronto time (cron will use tz to run daily at this time).
 */
async function readEndPlus30() {
  const { rows } = await pool.query(
    "SELECT end_local_time FROM shift_hours WHERE id=1"
  );
  if (!rows.length) {
    // Default to 17:00 if not configured
    return { hour: 17, minute: 30 };
  }

  const [h, m] = rows[0].end_local_time.split(":").map(Number); // "HH:MM:SS"
  const total = h * 60 + m + 30; // +30 min
  const minute = total % 60;
  const hour = Math.floor(total / 60) % 24; // wrap past midnight
  return { hour, minute };
}

let currentTask = null;

/**
 * Schedule (or reschedule) the daily logout job at end+30 in America/Toronto.
 */
export async function scheduleShiftLogout() {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  const { hour, minute } = await readEndPlus30();
  const expr = `${minute} ${hour} * * *`;

  currentTask = cron.schedule(
    expr,
    async () => {
      try {
        // 1) Force OUT anyone still IN
        await timeoutAllStaff();

        // 2) Keep your old logout flow (revoke tokens, set is_login=false, clear untime, etc.)
        await logoutAllStaff();

        console.log(
          `[cron] Forced time_out + logged out all staff at end+30 (Toronto)`
        );
      } catch (e) {
        console.error("[cron] Logout/timeout job failed:", e);
      }
    },
    { timezone: "America/Toronto" }
  );

  console.log(
    `[cron] Scheduled logout daily at ${hour
      .toString()
      .padStart(2, "0")}:${minute.toString().padStart(2, "0")} America/Toronto`
  );
  currentTask.start();
}
/**
 * Call this after an admin updates shift hours to reschedule immediately.
 */
export async function rescheduleShiftLogout() {
  await scheduleShiftLogout();
}

// src/jobs/untimeEnforcer.js
import cron from "node-cron";
import { pool } from "../utils/db.js";
import { appendUntimeSessionForUser } from "../services/attendance.js"; // <-- import this

async function enforceUntimeExpirations() {
  try {
    // Find approved & active UnTime sessions that have EXPIRED by Toronto time
    const { rows } = await pool.query(`
      SELECT
        id,
        username,
        untime,
        (untime->>'startTime')           AS start_time,
        (untime->>'durationMinutes')::int AS duration_minutes,
        (untime->>'reason')              AS reason
      FROM users
      WHERE untime_approved = true
        AND untime IS NOT NULL
        AND (untime->>'active')::boolean = true
        AND (
          (NOW() AT TIME ZONE 'America/Toronto') >
          (
            ((untime->>'startTime')::timestamptz AT TIME ZONE 'America/Toronto')
            + make_interval(mins := (untime->>'durationMinutes')::int)
          )
        )
    `);

    if (!rows.length) return;

    for (const u of rows) {
      // 1) Persist this UnTime window into attendance_records BEFORE clearing it
      await appendUntimeSessionForUser(u.id, {
        startTime: u.start_time,
        durationMinutes: u.duration_minutes,
        reason: u.reason ?? null,
      });

      // 2) Revoke tokens (logout everywhere)
      await pool.query(
        "UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false",
        [u.id]
      );

      // 3) Clear UnTime, mark as not approved, and DISALLOW further actions
      await pool.query(
        `UPDATE users
           SET is_login         = false,
               untime           = NULL,
               untime_approved  = false,
               allowed          = false
         WHERE id = $1`,
        [u.id]
      );

      console.log(`[untime-enforcer] Expired UnTime closed & recorded for ${u.username} (${u.id})`);
    }
  } catch (e) {
    console.error("[untime-enforcer] Failed:", e);
  }
}

// Schedule every minute in Toronto time
export function scheduleUntimeEnforcer() {
  cron.schedule("* * * * *", enforceUntimeExpirations, {
    timezone: "America/Toronto",
  });
  console.log("[cron] UnTime enforcer scheduled: every minute (America/Toronto)");
}

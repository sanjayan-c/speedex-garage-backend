// src/jobs/untimeEnforcer.js
import cron from "node-cron";
import { pool } from "../utils/db.js";

async function enforceUntimeExpirations() {
  try {
    // Find expired approvals (Toronto interpretation done on read)
    const { rows } = await pool.query(`
      SELECT id, username,
             (untime->>'startTime') AS start_time,
             (untime->>'durationMinutes')::int AS duration_minutes
      FROM users
      WHERE untime_approved = true
        AND untime IS NOT NULL
        AND (untime->>'active')::boolean = true
        AND (
          NOW() AT TIME ZONE 'America/Toronto'
          > (
              (untime->>'startTime')::timestamptz AT TIME ZONE 'America/Toronto'
              + make_interval(mins := (untime->>'durationMinutes')::int)
            )
        )
    `);

    if (!rows.length) return;

    // For each expired user: revoke tokens, log out, clear untime + flag
    for (const u of rows) {
      await pool.query(
        "UPDATE refresh_tokens SET revoked=true WHERE user_id=$1 AND revoked=false",
        [u.id]
      );
      await pool.query(
        "UPDATE users SET is_login=false, untime=NULL, untime_approved=false WHERE id=$1",
        [u.id]
      );
      console.log(
        `[untime-enforcer] Logged out expired untime user ${u.username} (${u.id})`
      );
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
  console.log(
    "[cron] UnTime enforcer scheduled: every minute (America/Toronto)"
  );
}

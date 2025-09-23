// src/jobs/untimeEnforcer.js
import cron from "node-cron";
import { pool } from "../utils/db.js";
import { appendUntimeSessionForUser } from "../services/attendance.js";

async function enforceUntimeExpirations() {
  console.log("[untime-enforcer] Running check for expired UnTime sessions...");

  try {
    const { rows } = await pool.query(`
      WITH candidates AS (
        SELECT
          id,
          username,
          untime,
          (untime->>'startTime')::timestamptz                                  AS start_ts,
          (untime->>'durationMinutes')::int                                     AS duration_minutes,
          (untime->>'reason')                                                   AS reason,
          (
            ((untime->>'startTime')::timestamptz AT TIME ZONE 'America/Toronto')
            + make_interval(mins := (untime->>'durationMinutes')::int)
          )                                                                     AS local_end_ts,
          (NOW() AT TIME ZONE 'America/Toronto')                                AS local_now_ts
        FROM users
        WHERE untime IS NOT NULL
          AND (untime->>'active')::boolean = true
          AND (untime->>'durationMinutes') IS NOT NULL
      )
      SELECT
        id, username, untime,
        start_ts,
        duration_minutes,
        reason,
        local_end_ts,
        local_now_ts
      FROM candidates
      WHERE local_now_ts > local_end_ts
    `);

    console.log(`[untime-enforcer] Found ${rows.length} expired UnTime session(s).`);

    if (!rows.length) return;

    for (const u of rows) {
      const startIso = u.start_ts?.toISOString?.() ?? String(u.start_ts);
      const endIso   = u.local_end_ts;
      const nowIso   = u.local_now_ts;

      console.log(
        `[untime-enforcer] Expired UnTime → user=${u.username} (${u.id}), reason=${u.reason}, start=${startIso}, end(Toronto)=${endIso}, now(Toronto)=${nowIso}`
      );

      try {
        // 1) Persist into attendance_records
        await appendUntimeSessionForUser(u.id, {
          startTime: startIso,
          durationMinutes: u.duration_minutes,
          reason: u.reason ?? null,
        });

        // 2) Revoke tokens
        await pool.query(
          "UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false",
          [u.id]
        );

        // 3) Clear UnTime & disallow
        await pool.query(
          `UPDATE users
             SET is_login         = false,
                 untime           = NULL,
                 untime_approved  = false,
                 allowed          = false
           WHERE id = $1`,
          [u.id]
        );

        console.log(`[untime-enforcer] Cleanup completed for ${u.username} (${u.id}) ✅`);
      } catch (innerErr) {
        console.error(`[untime-enforcer] Error processing user ${u.username} (${u.id}):`, innerErr);
      }
    }
  } catch (e) {
    console.error("[untime-enforcer] Failed main query or loop:", e);
  }

  console.log("[untime-enforcer] Check cycle completed.\n");
}

// Schedule every minute in Toronto time
export function scheduleUntimeEnforcer() {
  cron.schedule("* * * * *", enforceUntimeExpirations, {
    timezone: "America/Toronto",
  });
  console.log("[cron] UnTime enforcer scheduled: every minute (America/Toronto)");
}

// src/jobs/untimePreAlert.js
import cron from "node-cron";
import { pool } from "../utils/db.js";
import { DateTime } from "luxon";
import { io } from "../socket/index.js";

export function scheduleUntimePreAlert() {
  const expr = "*/30 * * * * *";

  const task = cron.schedule(
    expr,
    async () => {
      try {
        const { rows } = await pool.query(`
WITH active AS (
  SELECT
    id,
    username,
    (untime->>'startTime')::timestamptz                        AS start_ts,
    (untime->>'durationMinutes')::int                          AS duration_minutes,
    -- Step 1: convert start_ts (timestamptz) into Toronto wall-time (timestamp)
    (
      ( (untime->>'startTime')::timestamptz AT TIME ZONE 'America/Toronto' )
      + make_interval(mins := (untime->>'durationMinutes')::int)
    )                                                         AS local_end_ts,       -- timestamp, kept for reference/logging
    -- Step 2: convert that wall-time back to timestamptz (absolute instant)
    (
      (
        ( (untime->>'startTime')::timestamptz AT TIME ZONE 'America/Toronto' )
        + make_interval(mins := (untime->>'durationMinutes')::int)
      ) AT TIME ZONE 'America/Toronto'
    )                                                         AS end_ts              -- timestamptz ✅
  FROM users
  WHERE untime IS NOT NULL
    AND (untime->>'active')::boolean = true
    AND (untime->>'durationMinutes') IS NOT NULL
)
SELECT id, username, local_end_ts, end_ts
FROM active
WHERE (NOW() AT TIME ZONE 'America/Toronto')
      BETWEEN (local_end_ts - interval '5 minutes') AND local_end_ts;
        `);

        for (const r of rows) {
          const raw = r.end_ts; // this is a JS Date (timestamptz)
          let end = DateTime.fromJSDate(raw).setZone("America/Toronto"); // keep the instant; just view in Toronto

          if (!end.isValid) {
            console.warn(
              "[untime-prealert] Invalid end datetime (end_ts):",
              raw
            );
            continue;
          }

          if (!end?.isValid) {
            console.warn(
              "[untime-prealert] Invalid end datetime for user:",
              r.id,
              r.local_end_ts
            );
            continue;
          }

          const payload = {
            type: "untime-alert",
            end_local_time: end.toFormat("HH:mm:ss"),
            end_at_iso: end.toISO(), // <- absolute instant
            timezone: "America/Toronto",
            alert_minutes: 5,
            meta: { kind: "untime-end", source: "prealert" },
          };

          io.to(`user:${r.id}`).emit("untime-alert", payload);
        }
      } catch (e) {
        console.error("[cron] untime-prealert FAILED:", e);
      }
    },
    { timezone: "America/Toronto" }
  );

  task.start();
  console.log(`[cron] UnTime pre-alert scheduled: every 30s (America/Toronto)`);
  return task;
}

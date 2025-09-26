// src/socket/helpers.js

import { DateTime } from "luxon";
import { pool } from "../utils/db.js";

export async function getActiveUnTimeEndForUser(userId) {
  const { rows } = await pool.query(
    `
    SELECT
      (untime->>'active')::boolean AS active,
      (untime->>'startTime')::timestamptz AS start_ts,
      (untime->>'durationMinutes')::int AS duration_min
    FROM users
    WHERE id = $1
    `,
    [userId]
  );

  if (!rows.length) return null;
  const r = rows[0];
  if (!r.active || !r.start_ts || !r.duration_min) return null;

  // compute local Toronto end
  const end = DateTime.fromJSDate(r.start_ts).setZone("America/Toronto")
    .plus({ minutes: r.duration_min });

  return end; // Luxon DateTime
}

export async function userHasOpenAttendanceToday(userId) {
  const torToday = DateTime.now().setZone("America/Toronto").toISODate();
  const { rows } = await pool.query(
    `
    SELECT 1
    FROM attendance_records ar
    JOIN staff s ON s.id = ar.staff_id
    WHERE s.user_id = $1
      AND ar.attendance_date = $2
      AND ar.time_in IS NOT NULL
      AND ar.time_out IS NULL
    LIMIT 1
    `,
    [userId, torToday]
  );
  return rows.length > 0;
}

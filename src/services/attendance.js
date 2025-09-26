// src/services/attendance.js
import { pool } from "../utils/db.js";
import { toToronto } from "../utils/time.js";
import {
  createNewQrSession,
  getActiveSession,
  generateQrDataURLForSession,
  markAttendance,
} from "./qrAttendance.js";
import { DateTime } from "luxon";

const APP_URL = process.env.CORS_ORIGIN || "http://localhost:5173";

// GET /api/attendance/session/qr
async function getActiveSessionQr(req, res) {
  try {
    const s = await getActiveSession();
    if (!s) return res.status(404).json({ error: "No active session" });

    const dataUrl = await generateQrDataURLForSession(s.session_code, APP_URL);

    return res.json({
      dataUrl,
      link: `${APP_URL}/attendance/mark?session=${encodeURIComponent(
        s.session_code
      )}`,
      createdAt: toToronto(s.created_at),
      expiresAt: toToronto(s.expires_at),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create QR" });
  }
}

// POST /api/attendance/mark
async function markAttendanceForStaff(req, res) {
  const { session, type } = req.body;
  try {
    // Look up staff id for this user
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [
      req.user.sub || req.user.id,
    ]);
    if (!staffQ.rows.length)
      return res.status(404).json({ error: "Staff record not found" });

    const staffId = staffQ.rows[0].id;

    // Delegate to attendance core
    const rec = await markAttendance(staffId, session, type || "in");

    return res.json({
      ok: true,
      attendance: {
        ...rec,
        time_in: toToronto(rec.time_in),
        time_out: toToronto(rec.time_out),
        overtime_in: toToronto(rec.overtime_in),
        overtime_out: toToronto(rec.overtime_out),
        created_at: toToronto(rec.created_at),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || "Failed to mark" });
  }
}

// GET /api/attendance/me
async function listMyAttendance(req, res) {
  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [
      req.user.sub || req.user.id,
    ]);
    if (!staffQ.rows.length)
      return res.status(404).json({ error: "Staff record not found" });
    const staffId = staffQ.rows[0].id;

    // const { rows } = await pool.query(
    //   "SELECT * FROM attendance_records WHERE staff_id=$1 ORDER BY attendance_date DESC LIMIT 50",
    //   [staffId]
    // );
    const { rows } = await pool.query(
      `SELECT
         id,
         staff_id,
         attendance_date::text AS attendance_date,  -- force a plain 'YYYY-MM-DD' string
         time_in,
         time_out,
         overtime_in,
         overtime_out,
         created_at
       FROM attendance_records
       WHERE staff_id=$1
       ORDER BY attendance_date DESC
       LIMIT 50`,
      [staffId]
    );

    const data = rows.map((r) => ({
      ...r,
      time_in: toToronto(r.time_in),
      time_out: toToronto(r.time_out),
      overtime_in: toToronto(r.overtime_in),
      overtime_out: toToronto(r.overtime_out),
      created_at: toToronto(r.created_at),
    }));

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch attendance" });
  }
}

// POST /api/attendance/force-timeout-staff
async function timeoutAllStaff(req, res) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Postgres: EXTRACT(DOW) => 0=Sun..6=Sat. Our arrays are 1..7 = Mon..Sun.
    // So day_idx = CASE dow WHEN 0 THEN 7 ELSE dow END
    const { rows } = await client.query(
      `
      WITH
      today AS (
        SELECT
          (NOW() AT TIME ZONE 'America/Toronto')::date AS tor_date,
          EXTRACT(DOW FROM (NOW() AT TIME ZONE 'America/Toronto'))::int AS dow
      ),
      g AS (
        SELECT end_local_time AS g_end
        FROM shift_hours
        WHERE id = 1
      ),
      -- Pick today's per-day end time from the staff array (Mon..Sun = 1..7)
      upd AS (
        UPDATE attendance_records ar
        SET
          time_out = (
            (
              ar.attendance_date
              + COALESCE(
                  s.shift_end_local_time[
                    CASE t.dow WHEN 0 THEN 7 ELSE t.dow END
                  ],
                  g.g_end
                )
            )::timestamp
            AT TIME ZONE 'America/Toronto'
          ),
          is_forced_out = true
        FROM staff s
        CROSS JOIN g
        CROSS JOIN today t
        WHERE
          ar.staff_id = s.id
          AND ar.attendance_date = (SELECT tor_date FROM today)
          AND ar.time_in IS NOT NULL
          AND ar.time_out IS NULL
          -- don't attempt if both staff's per-day and global end are NULL
          AND COALESCE(
                s.shift_end_local_time[
                  CASE t.dow WHEN 0 THEN 7 ELSE t.dow END
                ],
                g.g_end
              ) IS NOT NULL
        RETURNING ar.staff_id
      )
      SELECT staff_id FROM upd;
      `
    );

    const staffIds = rows.map((r) => r.staff_id);
    const forcedCount = staffIds.length;

    if (forcedCount > 0) {
      // Clear 'allowed' for those users
      await client.query(
        `
        UPDATE users u
        SET allowed = false
        FROM staff s
        WHERE s.user_id = u.id
          AND s.id = ANY($1::uuid[])
        `,
        [staffIds]
      );
    }

    await client.query("COMMIT");

    if (res) return res.json({ ok: true, forced: forcedCount });
    console.log(`[force-timeout] Forced OUT for ${forcedCount} staff`);
    return { forced: forcedCount };
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("timeoutAllStaff failed:", e);
    if (res) return res.status(500).json({ error: "Force timeout failed" });
    throw e;
  } finally {
    client.release();
  }
}

// Append an UnTime session into attendance_records
async function appendUntimeSessionForUser(userId, u) {
  if (!u || !u.startTime) return; // duration not required anymore

  // Resolve staff_id
  const r = await pool.query(
    `SELECT s.id AS staff_id
       FROM staff s
       JOIN users u ON u.id = s.user_id
      WHERE u.id = $1`,
    [userId]
  );
  if (!r.rowCount) return;
  const staffId = r.rows[0].staff_id;

  // Parse start (we store timestamptz strings)
  let start = DateTime.fromISO(String(u.startTime), { setZone: true });
  if (!start.isValid)
    start = DateTime.fromSQL(String(u.startTime), { setZone: true });
  if (!start.isValid) return;

  // Use "now" as the end time, in the same zone as start
  let end = DateTime.now().setZone(start.zoneName || "UTC");
  // Avoid negative duration edge cases
  if (end < start) end = start;

  // Attendance row is keyed by Toronto calendar day of the *start*
  const attendanceDate = start.setZone("America/Toronto").toISODate();

  // Ensure row exists
  await pool.query(
    `INSERT INTO attendance_records (id, staff_id, attendance_date)
     VALUES (uuid_generate_v4(), $1, $2::date)
     ON CONFLICT (staff_id, attendance_date) DO NOTHING`,
    [staffId, attendanceDate]
  );

  // Append one session object
  await pool.query(
    `UPDATE attendance_records
       SET untime_sessions = COALESCE(untime_sessions, '[]'::jsonb) || to_jsonb($3::json)
     WHERE staff_id = $1
       AND attendance_date = $2::date`,
    [
      staffId,
      attendanceDate,
      JSON.stringify({
        start: start.toISO(), // keep zoned ISO
        end: end.toISO(), // now, same zone as start
        reason: u.reason ?? null, // optional
      }),
    ]
  );
}

// Determine whether the user's regular shift has ended (considering overtime state)
async function hasShiftEndedForToday(userId) {
  // resolve staff id
  const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [
    userId,
  ]);
  if (!staffQ.rows.length) return { ended: false };
  const staffId = staffQ.rows[0].id;

  // today's date in Toronto
  const todayTor = DateTime.now().setZone("America/Toronto").toISODate(); // YYYY-MM-DD

  // fetch today's record (assuming one row per day)
  const { rows } = await pool.query(
    `SELECT *
       FROM attendance_records
      WHERE staff_id = $1
        AND attendance_date = $2::date
      ORDER BY created_at DESC
      LIMIT 1`,
    [staffId, todayTor]
  );

  if (!rows.length) return { ended: false };

  const rec = rows[0];

  // If time_out is null, shift not ended
  if (!rec.time_out) return { ended: false };

  // If time_out exists and no overtime started -> ended
  if (!rec.overtime_in) return { ended: true, record: rec };

  // Overtime has started
  if (rec.overtime_in && !rec.overtime_out) {
    // currently still in OT
    return { ended: false, record: rec };
  }

  // Overtime finished
  if (rec.overtime_in && rec.overtime_out) {
    return { ended: true, record: rec };
  }

  return { ended: false, record: rec };
}

// GET /api/attendance?date=YYYY-MM-DD (optional)
// If date is not provided → return all
async function listAttendance(req, res) {
  try {
    const { date } = req.query;

    let query = `
      SELECT
        ar.id,
        ar.staff_id,
        s.first_name,
        s.last_name,
        ar.attendance_date::text AS attendance_date,
        ar.time_in,
        ar.time_out,
        ar.is_forced_out,
        ar.untime_sessions,
        ar.created_at,
        ar.updated_at,
        COALESCE(u.username, 'Unknown') AS updated_by_name
      FROM attendance_records ar
      JOIN staff s ON ar.staff_id = s.id
      LEFT JOIN users u ON ar.updated_by = u.id
    `;

    const params = [];
    if (date) {
      query += ` WHERE ar.attendance_date = $1::date`;
      params.push(date);
    }

    query += ` ORDER BY ar.attendance_date DESC, ar.created_at DESC`;

    const { rows } = await pool.query(query, params);

    const data = rows.map((r) => ({
      ...r,
      time_in: toToronto(r.time_in),
      time_out: toToronto(r.time_out),
      created_at: toToronto(r.created_at),
      updated_at: r.updated_at ? toToronto(r.updated_at) : null,
      updated_by_name: r.updated_by_name,
    }));

    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch attendance list" });
  }
}


// GET /api/attendance/summary/:staffId
async function getStaffAttendanceSummary(req, res) {
  const { staffId } = req.params;

  try {
    // Fetch staff details
    const staffQ = await pool.query(
      `SELECT id, first_name, last_name, position, joining_date
       FROM staff
       WHERE id = $1`,
      [staffId]
    );

    if (!staffQ.rows.length) {
      return res.status(404).json({ error: "Staff not found" });
    }

    const staff = staffQ.rows[0];

    // Define date ranges
    const now = DateTime.now().setZone("America/Toronto");
    const startOfWeek = now.startOf("week").toISODate(); // Monday
    const startOfMonth = now.startOf("month").toISODate();

    // Total worked hours
    const workedQ = await pool.query(
      `
      SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(time_out, NOW()) - time_in))) AS total_seconds
      FROM attendance_records
      WHERE staff_id = $1 AND time_in IS NOT NULL AND time_out IS NOT NULL
    `,
      [staffId]
    );

    const workedWeekQ = await pool.query(
      `
      SELECT SUM(EXTRACT(EPOCH FROM (time_out - time_in))) AS total_seconds
      FROM attendance_records
      WHERE staff_id = $1 AND attendance_date >= $2::date AND time_in IS NOT NULL AND time_out IS NOT NULL
    `,
      [staffId, startOfWeek]
    );

    const workedMonthQ = await pool.query(
      `
      SELECT SUM(EXTRACT(EPOCH FROM (time_out - time_in))) AS total_seconds
      FROM attendance_records
      WHERE staff_id = $1 AND attendance_date >= $2::date AND time_in IS NOT NULL AND time_out IS NOT NULL
    `,
      [staffId, startOfMonth]
    );

    // Untime sessions
    const untimeQ = await pool.query(
      `
      SELECT jsonb_array_elements(untime_sessions) AS session
      FROM attendance_records
      WHERE staff_id = $1 AND untime_sessions IS NOT NULL
    `,
      [staffId]
    );

    const untimeSessions = untimeQ.rows.map((r) => {
      const s = r.session;
      const start = DateTime.fromISO(s.start, { setZone: true });
      const end = DateTime.fromISO(s.end, { setZone: true });
      const dur = Math.max(0, end.diff(start, "seconds").seconds);
      return { start, end, dur };
    });

    const totalUnTime = untimeSessions.reduce((a, s) => a + s.dur, 0);
    const untimeWeek = untimeSessions
      .filter(
        (s) =>
          s.start >= DateTime.fromISO(startOfWeek, { zone: "America/Toronto" })
      )
      .reduce((a, s) => a + s.dur, 0);
    const untimeMonth = untimeSessions
      .filter(
        (s) =>
          s.start >= DateTime.fromISO(startOfMonth, { zone: "America/Toronto" })
      )
      .reduce((a, s) => a + s.dur, 0);

    // Build summary
    const summary = {
      staff: {
        id: staff.id,
        firstName: staff.first_name,
        lastName: staff.last_name,
        email: staff.email,
        contactNo: staff.contact_no,
        role: staff.position,
        joinDate: staff.joining_date
          ? staff.joining_date.toISOString().split("T")[0]
          : null,
      },
      worked: {
        totalHours: +(workedQ.rows[0].total_seconds || 0) / 3600,
        weekHours: +(workedWeekQ.rows[0].total_seconds || 0) / 3600,
        monthHours: +(workedMonthQ.rows[0].total_seconds || 0) / 3600,
      },
      untime: {
        totalHours: totalUnTime / 3600,
        weekHours: untimeWeek / 3600,
        monthHours: untimeMonth / 3600,
      },
    };

    return res.json(summary);
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Failed to fetch attendance summary" });
  }
}
async function getStaffAttendanceDetails(req, res) {
  const { staffId } = req.params;
  const { filterType, filterValue } = req.query; // filterType = day/week/month

  try {
    // Fetch staff details
    const staffQ = await pool.query(
      `SELECT id, first_name, last_name, position, joining_date, email, contact_no
       FROM staff WHERE id=$1`,
      [staffId]
    );
    if (!staffQ.rows.length)
      return res.status(404).json({ error: "Staff not found" });

    const staff = staffQ.rows[0];

    // Build filter clause
    let whereClause = "WHERE ar.staff_id=$1";
    const params = [staffId];

    if (filterType && filterValue) {
      const targetDate = DateTime.fromISO(filterValue, {
        zone: "America/Toronto",
      });
      if (filterType === "day") {
        whereClause += " AND ar.attendance_date = $2::date";
        params.push(targetDate.toISODate());
      } else if (filterType === "week") {
        const startOfWeek = targetDate.startOf("week").toISODate();
        const endOfWeek = targetDate.endOf("week").toISODate();
        whereClause += " AND ar.attendance_date BETWEEN $2::date AND $3::date";
        params.push(startOfWeek, endOfWeek);
      } else if (filterType === "month") {
        const startOfMonth = targetDate.startOf("month").toISODate();
        const endOfMonth = targetDate.endOf("month").toISODate();
        whereClause += " AND ar.attendance_date BETWEEN $2::date AND $3::date";
        params.push(startOfMonth, endOfMonth);
      }
    }

    // Fetch attendance records with updated info
    const { rows } = await pool.query(
      `SELECT 
         ar.id,
         ar.attendance_date,
         ar.time_in,
         ar.time_out,
         ar.untime_sessions,
         ar.created_at,
         ar.updated_at,
         ar.is_forced_out,
         COALESCE(u.username, 'Not updated') AS updated_by_name
       FROM attendance_records ar
       LEFT JOIN users u ON ar.updated_by = u.id
       ${whereClause}
       ORDER BY ar.attendance_date ASC, ar.time_in ASC`,
      params
    );

    // Compute worked and untime hours
    const records = rows.map((r) => {
      const timeIn = r.time_in ? new Date(r.time_in) : null;
      const timeOut = r.time_out ? new Date(r.time_out) : null;

      const workedSeconds =
        timeIn && timeOut ? Math.max(0, (timeOut - timeIn) / 1000) : 0;

      const untimeSeconds = (r.untime_sessions || []).reduce((sum, u) => {
        const start = new Date(u.start);
        const end = new Date(u.end);
        return sum + Math.max(0, (end - start) / 1000);
      }, 0);

      const netWorkedSeconds = Math.max(0, workedSeconds - untimeSeconds);

      return {
        ...r,
        workedHours: +(netWorkedSeconds / 3600).toFixed(3),
        untimeHours: +(untimeSeconds / 3600).toFixed(3),
        updated_at: r.updated_at ? toToronto(r.updated_at) : null, // convert to Toronto timezone
        updated_by_name: r.updated_by_name,
      };
    });

    // Summary
    const summary = {
      worked: {
        totalHours: +records
          .reduce((sum, r) => sum + r.workedHours, 0)
          .toFixed(3),
      },
      untime: {
        totalHours: +records
          .reduce((sum, r) => sum + r.untimeHours, 0)
          .toFixed(3),
      },
      count: records.length,
    };

    return res.json({ staff, records, summary });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ error: "Failed to fetch attendance details" });
  }
}

// PATCH /api/attendance/:attendanceId
async function updateAttendanceRecord(req, res) {
  const { attendanceId } = req.params;
  const { time_in, time_out } = req.body;

  try {
    if (!time_in && !time_out) {
      return res.status(400).json({
        error: "At least one of time_in or time_out must be provided",
      });
    }

    const timeInDate = time_in ? new Date(time_in) : null;
    const timeOutDate = time_out ? new Date(time_out) : null;

    if (
      (time_in && isNaN(timeInDate.getTime())) ||
      (time_out && isNaN(timeOutDate.getTime()))
    ) {
      return res.status(400).json({ error: "Invalid date format." });
    }

    if (timeInDate && timeOutDate && timeOutDate <= timeInDate) {
      return res.status(400).json({ error: "time_out must be after time_in" });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (timeInDate) {
      fields.push(`time_in = $${idx++}`);
      values.push(timeInDate);
    }
    if (timeOutDate) {
      fields.push(`time_out = $${idx++}`);
      values.push(timeOutDate);
    }

    // Track updated info
    fields.push(`updated_by = $${idx++}`);
    values.push(req.user.sub || req.user.id);

    fields.push(`updated_at = $${idx++}`);
    values.push(new Date());

    values.push(attendanceId);

    const query = `
      UPDATE attendance_records
      SET ${fields.join(", ")}
      WHERE id = $${idx}
      RETURNING id, staff_id, attendance_date, time_in, time_out, created_at, updated_by, updated_at
    `;

    const { rows } = await pool.query(query, values);

    if (!rows.length) {
      return res.status(404).json({ error: "Attendance record not found" });
    }

    const updated = rows[0];

    return res.json({
      ok: true,
      attendance: {
        ...updated,
        time_in: toToronto(updated.time_in),
        time_out: toToronto(updated.time_out),
        created_at: toToronto(updated.created_at),
        updated_at: updated.updated_at ? toToronto(updated.updated_at) : null,
        updated_by: updated.updated_by || null,
      },
    });
  } catch (err) {
    console.error("updateAttendanceRecord failed:", err);
    return res.status(500).json({ error: "Failed to update attendance record" });
  }
}


export {
  getActiveSessionQr,
  markAttendanceForStaff,
  listMyAttendance,
  getStaffAttendanceDetails,
  timeoutAllStaff,
  appendUntimeSessionForUser,
  getStaffAttendanceSummary,
  hasShiftEndedForToday,
  updateAttendanceRecord,
  listAttendance,
};

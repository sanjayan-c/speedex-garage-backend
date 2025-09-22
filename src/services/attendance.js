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
      link: `${APP_URL}?session=${encodeURIComponent(s.session_code)}`,
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

    // Force OUT at end-of-shift (Toronto) for anyone still IN
    const { rows } = await client.query(
      `
      WITH g AS (
        SELECT end_local_time
        FROM shift_hours
        WHERE id = 1
      ),
      upd AS (
        UPDATE attendance_records ar
        SET
          time_out = (
            (ar.attendance_date + COALESCE(s.shift_end_local_time, g.end_local_time))::timestamp
              AT TIME ZONE 'America/Toronto'
          ),
          is_forced_out = true
        FROM staff s
        CROSS JOIN g
        WHERE
          ar.staff_id = s.id
          AND ar.attendance_date = (NOW() AT TIME ZONE 'America/Toronto')::date
          AND ar.time_in IS NOT NULL
          AND ar.time_out IS NULL
        RETURNING ar.staff_id
      )
      SELECT staff_id FROM upd;
      `
    );

    const staffIds = rows.map(r => r.staff_id);
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

    // If used as an endpoint:
    if (res) {
      return res.json({ ok: true, forced: forcedCount });
    }

    // If used from cron:
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
  if (!start.isValid) start = DateTime.fromSQL(String(u.startTime), { setZone: true });
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
        start: start.toISO(),         // keep zoned ISO
        end: end.toISO(),             // now, same zone as start
        reason: u.reason ?? null,     // optional
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

export {
  getActiveSessionQr,
  markAttendanceForStaff,
  listMyAttendance,
  timeoutAllStaff,
  appendUntimeSessionForUser,
  hasShiftEndedForToday,
};

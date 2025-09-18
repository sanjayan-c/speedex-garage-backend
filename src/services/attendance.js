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
  hasShiftEndedForToday,
};

import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import { pool } from "../utils/db.js";
import { addMinutes } from "date-fns";
import { enforceStaffUntimeWindow } from "../services/untime.js";
import { DateTime } from "luxon";

const SESSION_TTL_MINUTES = 3; // rotate every 3 minutes

export async function createNewQrSession(
  createdBy = null,
  ttlMinutes = SESSION_TTL_MINUTES
) {
  const sessionCode = uuidv4();
  const now = new Date();
  const expiresAt = addMinutes(now, ttlMinutes).toISOString(); // UTC ISO

  // set existing active sessions to inactive
  await pool.query("UPDATE qr_sessions SET active=false WHERE active=true");

  const { rows } = await pool.query(
    `INSERT INTO qr_sessions (id, session_code, created_by, expires_at, active)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [uuidv4(), sessionCode, createdBy, expiresAt, true]
  );
  return rows[0];
}

export async function getActiveSession() {
  await pool.query(
    "UPDATE qr_sessions SET active=false WHERE active=true AND expires_at < NOW()"
  );
  const { rows } = await pool.query(
    "SELECT id, session_code, created_by, created_at, expires_at FROM qr_sessions WHERE active=true ORDER BY created_at DESC LIMIT 1"
  );
  return rows[0] || null;
}

export async function generateQrDataURLForSession(sessionCode, appUrl) {
  const link = `${appUrl}?session=${encodeURIComponent(sessionCode)}`;
  return QRCode.toDataURL(link);
}

export async function markAttendance(staffId, sessionCode, markType = "in") {
  // allow only "in" or "out"
  if (!["in", "out"].includes(markType)) {
    throw new Error("Unknown mark type");
  }

  // validate session
  const { rows: srows } = await pool.query(
    "SELECT id, expires_at, active FROM qr_sessions WHERE session_code=$1",
    [sessionCode]
  );
  if (!srows.length) throw new Error("Session invalid");
  const session = srows[0];
  if (!session.active || new Date(session.expires_at) < new Date()) {
    await pool.query("UPDATE qr_sessions SET active=false WHERE id=$1", [
      session.id,
    ]);
    throw new Error("Session expired");
  }

  // resolve the user (to pass into enforcement)
  const { rows: uRows } = await pool.query(
    `SELECT u.id AS user_id, u.username, u.role
       FROM staff s JOIN users u ON s.user_id = u.id
      WHERE s.id = $1`,
    [staffId]
  );
  if (!uRows.length) throw new Error("Staff or User not found");
  const user = uRows[0];

  // run enforcement **before** touching attendance row
  if (markType === "in") {
    try {
      const diag = await enforceStaffUntimeWindow(
        user.user_id,
        user.username,
        user.role
      );

      // blocked by admin?
      if (diag && diag.blocked) {
        throw new Error("Untime attendance blocked by admin");
      }

      // UnTime got (re)started → do NOT mark attendance
      // if (diag && !diag.skipped) {
      //   let msg = "UnTime pending admin approval";
      //   if (diag.ended) msg = "Cannot mark attendance: shift already ended";
      //   else if (diag.reason === "on-leave")
      //     msg = "Cannot mark attendance: you are on leave today";
      //   else if (diag.reason === "outside-window")
      //     msg = "Cannot mark attendance: outside allowed shift window";
      //   throw new Error(msg);
      // }
      // UnTime got (re)started → do NOT mark attendance
if (diag && !diag.skipped) {
  // check explicit reasons first
  if (diag.ended) {
    throw new Error("Cannot mark attendance: shift already ended");
  }
  if (diag.reason === "on-leave") {
    throw new Error("Cannot mark attendance: you are on leave today");
  }
  if (diag.reason === "outside-window") {
    throw new Error("Cannot mark attendance: outside allowed shift window");
  }

  // only block if untime is active & not approved
  if (diag.untimeActive && diag.untimeApproved === false) {
    throw new Error("UnTime pending admin approval");
  }

  // else → allow attendance
}

      // else skipped === true → proceed
    } catch (e) {
      console.error("Untime enforcement failed:", e);
      throw new Error(e.message || "Attendance blocked by policy");
    }
  }

  const today = DateTime.now().setZone("America/Toronto").toISODate();
  const nowTs = new Date().toISOString();

  // ensure row exists (after passing enforcement)
  await pool.query(
    `INSERT INTO attendance_records (id, staff_id, attendance_date)
     VALUES ($1,$2,$3)
     ON CONFLICT (staff_id, attendance_date) DO NOTHING`,
    [uuidv4(), staffId, today]
  );

  const {
    rows: [rec],
  } = await pool.query(
    "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
    [staffId, today]
  );

  if (markType === "in") {
    if (rec.time_in) throw new Error("Already marked IN for today");
    await pool.query(
      "UPDATE attendance_records SET time_in=$1 WHERE staff_id=$2 AND attendance_date=$3",
      [nowTs, staffId, today]
    );
    await pool.query("UPDATE users SET allowed = true WHERE id = $1", [
      user.user_id,
    ]);
  } else {
    // markType === "out"
    if (rec.time_out) throw new Error("Already marked OUT for today");
    if (!rec.time_in) throw new Error("Cannot mark OUT before IN");
    await pool.query(
      "UPDATE attendance_records SET time_out=$1 WHERE staff_id=$2 AND attendance_date=$3",
      [nowTs, staffId, today]
    );
    await pool.query("UPDATE users SET allowed = false WHERE id = $1", [
      user.user_id,
    ]);
  }

  const {
    rows: [updated],
  } = await pool.query(
    "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
    [staffId, today]
  );

  return updated;
}

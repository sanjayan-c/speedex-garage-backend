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

// optional: tiny helper if pg returns "{09:00,09:00,...}" as text
function coercePgTimeArray(val) {
  if (val == null) return null;
  if (Array.isArray(val)) return val; // already an array of strings or nulls
  if (typeof val === "string") {
    // "{09:00,09:00,,,...}" -> ["09:00","09:00", null, ...]
    const inner = val.replace(/^{|}$/g, "");
    if (inner.trim() === "") return [];
    return inner.split(",").map((s) => (s === "" ? null : s));
  }
  return null;
}

export async function markAttendance(staffId, sessionCode, markType = "in") {
  if (!["in", "out"].includes(markType)) {
    throw new Error("Unknown mark type");
  }

  // validate session (unchanged) ...
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

  // fetch user + weekly shift arrays (NO ::text cast)
  const { rows: uRows } = await pool.query(
    `SELECT u.id AS user_id, u.username, u.role,
            s.shift_start_local_time, s.shift_end_local_time
       FROM staff s JOIN users u ON s.user_id = u.id
      WHERE s.id = $1`,
    [staffId]
  );
  if (!uRows.length) throw new Error("Staff or User not found");
  const user = uRows[0];

  // Extract today's Toronto weekday (Luxon: 1=Mon..7=Sun)
  const torontoToday = DateTime.now().setZone("America/Toronto");
  const weekdayIdx = torontoToday.weekday - 1; // 0..6 (Mon..Sun)

  // Coerce pg arrays safely
  const weekStarts = coercePgTimeArray(user.shift_start_local_time) || [];
  const weekEnds = coercePgTimeArray(user.shift_end_local_time) || [];

  // Today’s per-day shift values (string "HH:mm[:ss]" or null)
  const todaysStart = weekStarts[weekdayIdx] ?? null;
  const todaysEnd = weekEnds[weekdayIdx] ?? null;

  // run enforcement BEFORE touching attendance row (unchanged logic down below)
  if (markType === "in") {
    try {
      const diag = await enforceStaffUntimeWindow(
        user.user_id,
        user.username,
        user.role
      );

      if (diag && diag.blocked) {
        throw new Error("Untime attendance blocked by admin");
      }
      if (diag && !diag.skipped) {
        if (diag.ended)
          throw new Error("Cannot mark attendance: shift already ended");
        if (diag.reason === "on-leave")
          throw new Error("Cannot mark attendance: you are on leave today");
        if (diag.reason === "outside-window")
          throw new Error(
            "Cannot mark attendance: outside allowed shift window"
          );

        if (diag.untimeActive && diag.untimeApproved === false) {
          throw new Error("UnTime pending admin approval");
        }
      }
    } catch (e) {
      console.error("Untime enforcement failed:", e);
      throw new Error(e.message || "Attendance blocked by policy");
    }
  }

  const todayISO = torontoToday.toISODate(); // YYYY-MM-DD in Toronto
  const nowTs = new Date().toISOString();

  // ensure row exists after enforcement
  await pool.query(
    `INSERT INTO attendance_records (id, staff_id, attendance_date)
     VALUES ($1,$2,$3)
     ON CONFLICT (staff_id, attendance_date) DO NOTHING`,
    [uuidv4(), staffId, todayISO]
  );

  const {
    rows: [rec],
  } = await pool.query(
    "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
    [staffId, todayISO]
  );

  if (markType === "in") {
    if (rec.time_in) throw new Error("Already marked IN for today");

    // --- SHIFT GRACE ADJUSTMENT FOR LATE START (per-day) ---
    let adjustedIn = DateTime.now().setZone("America/Toronto");
    if (todaysStart) {
      const shiftStartToday = DateTime.fromISO(`${todayISO}T${todaysStart}`, {
        zone: "America/Toronto",
      });
      if (adjustedIn > shiftStartToday) {
        adjustedIn = adjustedIn.plus({ minutes: 10 });
      }
    }

    await pool.query(
      "UPDATE attendance_records SET time_in=$1 WHERE staff_id=$2 AND attendance_date=$3",
      [adjustedIn.toISO(), staffId, todayISO]
    );
    await pool.query("UPDATE users SET allowed = true WHERE id = $1", [
      user.user_id,
    ]);
  } else {
    // markType === "out"
    if (rec.time_out) throw new Error("Already marked OUT for today");
    if (!rec.time_in) throw new Error("Cannot mark OUT before IN");

    // --- SHIFT GRACE ADJUSTMENT FOR EARLY LEAVE (per-day) ---
    let adjustedOut = DateTime.now().setZone("America/Toronto");
    if (todaysEnd) {
      const shiftEndToday = DateTime.fromISO(`${todayISO}T${todaysEnd}`, {
        zone: "America/Toronto",
      });
      if (adjustedOut < shiftEndToday) {
        adjustedOut = adjustedOut.minus({ minutes: 10 });
      }
    }

    await pool.query(
      "UPDATE attendance_records SET time_out=$1 WHERE staff_id=$2 AND attendance_date=$3",
      [adjustedOut.toISO(), staffId, todayISO]
    );
    await pool.query("UPDATE users SET allowed = false WHERE id = $1", [
      user.user_id,
    ]);
  }

  const {
    rows: [updated],
  } = await pool.query(
    "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
    [staffId, todayISO]
  );

  return updated;
}

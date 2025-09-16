// // src/services/qrAttendance.js
// import { v4 as uuidv4 } from "uuid";
// import QRCode from "qrcode";
// import { pool } from "../utils/db.js";
// import { addMinutes } from "date-fns"; // optional, or use native Date

// const SESSION_TTL_MINUTES = 3; // rotate every 3 minutes

// export async function createNewQrSession(createdBy = null, ttlMinutes = SESSION_TTL_MINUTES) {
//   const sessionCode = uuidv4(); // can be shortened if desired
//   const now = new Date();
//   const expiresAt = addMinutes(now, ttlMinutes).toISOString();

//   // set existing active sessions to inactive (optional)
//   await pool.query("UPDATE qr_sessions SET active=false WHERE active=true");

//   const { rows } = await pool.query(
//     `INSERT INTO qr_sessions (id, session_code, created_by, expires_at, active)
//      VALUES ($1,$2,$3,$4,$5) RETURNING *`,
//     [uuidv4(), sessionCode, createdBy, expiresAt, true]
//   );
//   return rows[0];
// }

// export async function getActiveSession() {
//   // clean up expired sessions (mark inactive)
//   await pool.query("UPDATE qr_sessions SET active=false WHERE active=true AND expires_at < NOW()");
//   const { rows } = await pool.query(
//     "SELECT id, session_code, created_by, created_at, expires_at FROM qr_sessions WHERE active=true ORDER BY created_at DESC LIMIT 1"
//   );
//   return rows[0] || null;
// }

// export async function generateQrDataURLForSession(sessionCode, appUrl) {
//   // appUrl is the link staff will open (dashboard + sessionCode)
//   const link = `${appUrl}?session=${encodeURIComponent(sessionCode)}`;
//   // generate data URL PNG
//   return QRCode.toDataURL(link);
// }

// // Mark attendance: staff hits this with session_code (from URL) and is authenticated
// export async function markAttendance(staffId, sessionCode, markType = "in") {
//   // markType: 'in' or 'out' or 'overtime-in' or 'overtime-out'
//   // Validate session code
//   const { rows: srows } = await pool.query(
//     "SELECT id, expires_at, active FROM qr_sessions WHERE session_code=$1",
//     [sessionCode]
//   );
//   if (!srows.length) throw new Error("Session invalid");

//   const session = srows[0];
//   if (!session.active || new Date(session.expires_at) < new Date()) {
//     // optionally mark active=false
//     await pool.query("UPDATE qr_sessions SET active=false WHERE id=$1", [session.id]);
//     throw new Error("Session expired");
//   }

//   const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
//   // ensure a record exists
//   const { rowCount } = await pool.query(
//     `INSERT INTO attendance_records (id, staff_id, attendance_date)
//      VALUES ($1,$2,$3)
//      ON CONFLICT (staff_id, attendance_date) DO NOTHING`,
//     [uuidv4(), staffId, today]
//   );

//   // update appropriate column
//   let sql = "";
//   let params = [];
//   const nowTs = new Date().toISOString();

//   if (markType === "in") {
//     sql = "UPDATE attendance_records SET time_in = COALESCE(time_in, $1) WHERE staff_id=$2 AND attendance_date=$3";
//     params = [nowTs, staffId, today];
//   } else if (markType === "out") {
//     sql = "UPDATE attendance_records SET time_out = $1 WHERE staff_id=$2 AND attendance_date=$3";
//     params = [nowTs, staffId, today];
//   } else if (markType === "overtime-in") {
//     sql = "UPDATE attendance_records SET overtime_in = COALESCE(overtime_in, $1) WHERE staff_id=$2 AND attendance_date=$3";
//     params = [nowTs, staffId, today];
//   } else if (markType === "overtime-out") {
//     sql = "UPDATE attendance_records SET overtime_out = $1 WHERE staff_id=$2 AND attendance_date=$3";
//     params = [nowTs, staffId, today];
//   } else {
//     throw new Error("Unknown mark type");
//   }

//   await pool.query(sql, params);

//   // Optionally return the updated attendance row
//   const { rows: updated } = await pool.query(
//     "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
//     [staffId, today]
//   );

//   return updated[0];
// }


import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import { pool } from "../utils/db.js";
import { addMinutes } from "date-fns";

const SESSION_TTL_MINUTES = 3; // rotate every 3 minutes

export async function createNewQrSession(createdBy = null, ttlMinutes = SESSION_TTL_MINUTES) {
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
  await pool.query("UPDATE qr_sessions SET active=false WHERE active=true AND expires_at < NOW()");
  const { rows } = await pool.query(
    "SELECT id, session_code, created_by, created_at, expires_at FROM qr_sessions WHERE active=true ORDER BY created_at DESC LIMIT 1"
  );
  return rows[0] || null;
}

export async function generateQrDataURLForSession(sessionCode, appUrl) {
  const link = `${appUrl}?session=${encodeURIComponent(sessionCode)}`;
  return QRCode.toDataURL(link);
}

// export async function markAttendance(staffId, sessionCode, markType = "in") {
//   const { rows: srows } = await pool.query(
//     "SELECT id, expires_at, active FROM qr_sessions WHERE session_code=$1",
//     [sessionCode]
//   );
//   if (!srows.length) throw new Error("Session invalid");

//   const session = srows[0];
//   if (!session.active || new Date(session.expires_at) < new Date()) {
//     await pool.query("UPDATE qr_sessions SET active=false WHERE id=$1", [session.id]);
//     throw new Error("Session expired");
//   }

//   const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
//   await pool.query(
//     `INSERT INTO attendance_records (id, staff_id, attendance_date)
//      VALUES ($1,$2,$3)
//      ON CONFLICT (staff_id, attendance_date) DO NOTHING`,
//     [uuidv4(), staffId, today]
//   );

//   const nowTs = new Date().toISOString(); // UTC ISO
//   let sql = "";
//   let params = [];

//   if (markType === "in") {
//     sql = "UPDATE attendance_records SET time_in = COALESCE(time_in, $1) WHERE staff_id=$2 AND attendance_date=$3";
//     params = [nowTs, staffId, today];
//   } else if (markType === "out") {
//     sql = "UPDATE attendance_records SET time_out = $1 WHERE staff_id=$2 AND attendance_date=$3";
//     params = [nowTs, staffId, today];
//   } else if (markType === "overtime-in") {
//     sql = "UPDATE attendance_records SET overtime_in = COALESCE(overtime_in, $1) WHERE staff_id=$2 AND attendance_date=$3";
//     params = [nowTs, staffId, today];
//   } else if (markType === "overtime-out") {
//     sql = "UPDATE attendance_records SET overtime_out = $1 WHERE staff_id=$2 AND attendance_date=$3";
//     params = [nowTs, staffId, today];
//   } else {
//     throw new Error("Unknown mark type");
//   }

//   await pool.query(sql, params);

//   const { rows: updated } = await pool.query(
//     "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
//     [staffId, today]
//   );

//   return updated[0];
// }
export async function markAttendance(staffId, sessionCode, markType = "in") {
  const { rows: srows } = await pool.query(
    "SELECT id, expires_at, active FROM qr_sessions WHERE session_code=$1",
    [sessionCode]
  );
  if (!srows.length) throw new Error("Session invalid");

  const session = srows[0];
  if (!session.active || new Date(session.expires_at) < new Date()) {
    await pool.query("UPDATE qr_sessions SET active=false WHERE id=$1", [session.id]);
    throw new Error("Session expired");
  }

  const today = new Date().toISOString().slice(0, 10);

  // ensure row exists
  await pool.query(
    `INSERT INTO attendance_records (id, staff_id, attendance_date)
     VALUES ($1,$2,$3)
     ON CONFLICT (staff_id, attendance_date) DO NOTHING`,
    [uuidv4(), staffId, today]
  );

  // fetch existing record
  const { rows: [rec] } = await pool.query(
    "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
    [staffId, today]
  );

  const nowTs = new Date().toISOString();

  if (markType === "in") {
    if (rec.time_in) throw new Error("Already marked IN for today");
    await pool.query(
      "UPDATE attendance_records SET time_in=$1 WHERE staff_id=$2 AND attendance_date=$3",
      [nowTs, staffId, today]
    );
  } else if (markType === "out") {
    if (rec.time_out) throw new Error("Already marked OUT for today");
    if (!rec.time_in) throw new Error("Cannot mark OUT before IN");
    await pool.query(
      "UPDATE attendance_records SET time_out=$1 WHERE staff_id=$2 AND attendance_date=$3",
      [nowTs, staffId, today]
    );
  } else if (markType === "overtime-in") {
    if (rec.overtime_in) throw new Error("Already marked OVERTIME IN for today");
    if (!rec.time_out) throw new Error("Overtime IN only after OUT");
    await pool.query(
      "UPDATE attendance_records SET overtime_in=$1 WHERE staff_id=$2 AND attendance_date=$3",
      [nowTs, staffId, today]
    );
  } else if (markType === "overtime-out") {
    if (rec.overtime_out) throw new Error("Already marked OVERTIME OUT for today");
    if (!rec.overtime_in) throw new Error("Cannot mark OVERTIME OUT before OVERTIME IN");
    await pool.query(
      "UPDATE attendance_records SET overtime_out=$1 WHERE staff_id=$2 AND attendance_date=$3",
      [nowTs, staffId, today]
    );
  } else {
    throw new Error("Unknown mark type");
  }

  const { rows: [updated] } = await pool.query(
    "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
    [staffId, today]
  );

  return updated;
}

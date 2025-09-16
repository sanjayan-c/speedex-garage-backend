import { v4 as uuidv4 } from "uuid";
import { pool } from "../utils/db.js";
import { DateTime } from "luxon";

// POST /api/leave
async function requestLeave(req, res) {
  const { staffId, startDate, endDate, reason, leaveType, halfType } = req.body;

  try {
    const id = uuidv4();

    // Convert given times to UTC (assume user gives Toronto local time)
    const startUTC = DateTime.fromISO(startDate, { zone: "America/Toronto" }).toUTC().toISO();
    const endUTC = DateTime.fromISO(endDate, { zone: "America/Toronto" }).toUTC().toISO();

    // 1️⃣ Check for overlapping leave requests for the same staff
    const { rows: overlaps } = await pool.query(
      `SELECT * 
       FROM leave_requests 
       WHERE staff_id = $1
         AND status IN ('pending','approved') -- ignore rejected/cancelled
         AND NOT ($3 < start_date OR $2 > end_date)`,
      [staffId, startUTC, endUTC]
    );

if (DateTime.fromISO(startDate) > DateTime.fromISO(endDate)) {
  return res.status(400).json({ error: "Start date cannot be after end date" });
}

    if (overlaps.length > 0) {
      return res.status(400).json({
        error: "Leave already exists for this date range",
        conflict: overlaps,
      });
    }

    // 2️⃣ Insert new leave
    await pool.query(
      `INSERT INTO leave_requests 
        (id, staff_id, start_date, end_date, reason, leave_type, half_type, status) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')`,
      [id, staffId, startUTC, endUTC, reason, leaveType || "full_day", halfType || null]
    );

    res.status(201).json({
      id,
      staffId,
      startDate,
      endDate,
      reason,
      leaveType: leaveType || "full_day",
      halfType: halfType || null,
      status: "pending",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to request leave" });
  }
}



// GET /api/leave (admin or staff)
async function listLeave(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT lr.*, s.first_name, s.last_name 
       FROM leave_requests lr
       JOIN staff s ON lr.staff_id = s.id
       ORDER BY lr.created_at DESC`
    );

    // Convert UTC -> Toronto before sending
    const data = rows.map(r => {
      const startToronto = DateTime.fromJSDate(r.start_date).setZone("America/Toronto").toISO();
      const endToronto = DateTime.fromJSDate(r.end_date).setZone("America/Toronto").toISO();
      return { ...r, start_date: startToronto, end_date: endToronto };
    });

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leave requests" });
  }
}


// PATCH /api/leave/:id/status (admin approve/reject)
async function updateLeaveStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body; // approved or rejected

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const { rowCount } = await pool.query(
      `UPDATE leave_requests 
       SET status=$1, updated_at=NOW() 
       WHERE id=$2`,
      [status, id]
    );
    if (!rowCount) return res.status(404).json({ error: "Leave request not found" });

    res.json({ ok: true, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update leave request" });
  }
}


// GET /api/leave/me (staff only)
async function listMyLeave(req, res) {
  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [req.user.sub || req.user.id]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff record not found" });

    const staffId = staffQ.rows[0].id;

    const { rows } = await pool.query(
      `SELECT * 
       FROM leave_requests 
       WHERE staff_id = $1 
       ORDER BY created_at DESC`,
      [staffId]
    );

    const data = rows.map(r => ({
      ...r,
      start_date: DateTime.fromJSDate(r.start_date).setZone("America/Toronto").toISO(),
      end_date: DateTime.fromJSDate(r.end_date).setZone("America/Toronto").toISO(),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch my leave requests" });
  }
}

// PATCH /api/leave/:id (staff can edit if pending)
async function editLeave(req, res) {
  const { id } = req.params;
  const { startDate, endDate, reason, leaveType, halfType } = req.body;

  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [req.user.sub || req.user.id]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff record not found" });
    const staffId = staffQ.rows[0].id;

    // validate date order
    if (startDate && endDate && DateTime.fromISO(startDate) > DateTime.fromISO(endDate)) {
      return res.status(400).json({ error: "Start date cannot be after end date" });
    }

    // check if request exists & is pending
    const { rows } = await pool.query(
      "SELECT * FROM leave_requests WHERE id=$1 AND staff_id=$2",
      [id, staffId]
    );
    if (!rows.length) return res.status(404).json({ error: "Leave request not found" });
    if (rows[0].status !== "pending") {
      return res.status(400).json({ error: "Cannot edit leave after it is approved or rejected" });
    }

    const startUTC = startDate
      ? DateTime.fromISO(startDate, { zone: "America/Toronto" }).toUTC().toISO()
      : rows[0].start_date;
    const endUTC = endDate
      ? DateTime.fromISO(endDate, { zone: "America/Toronto" }).toUTC().toISO()
      : rows[0].end_date;

    await pool.query(
      `UPDATE leave_requests
       SET start_date=$1, end_date=$2, reason=$3, leave_type=$4, half_type=$5, updated_at=NOW()
       WHERE id=$6 AND staff_id=$7`,
      [
        startUTC,
        endUTC,
        reason || rows[0].reason,
        leaveType || rows[0].leave_type,
        halfType || rows[0].half_type,
        id,
        staffId,
      ]
    );

    res.json({ ok: true, message: "Leave updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update leave request" });
  }
}


import { DateTime } from "luxon";
import { pool } from "../utils/db.js";

// 1️⃣ GET /api/leave/staff/:staffId (get leave by staff)
async function getLeaveByStaff(req, res) {
  const { staffId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM leave_requests WHERE staff_id=$1 ORDER BY created_at DESC`,
      [staffId]
    );

    const data = rows.map(r => ({
      ...r,
      start_date: DateTime.fromJSDate(r.start_date).setZone("America/Toronto").toISO(),
      end_date: DateTime.fromJSDate(r.end_date).setZone("America/Toronto").toISO(),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leave by staff" });
  }
}

// 2️⃣ DELETE /api/leave/:id (staff delete if pending)
async function deleteLeaveByStaff(req, res) {
  const { id } = req.params;

  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [req.user.sub || req.user.id]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff record not found" });
    const staffId = staffQ.rows[0].id;

    const { rows } = await pool.query("SELECT * FROM leave_requests WHERE id=$1 AND staff_id=$2", [id, staffId]);
    if (!rows.length) return res.status(404).json({ error: "Leave request not found" });

    if (rows[0].status !== "pending") {
      return res.status(400).json({ error: "Only pending leave can be deleted by staff" });
    }

    await pool.query("DELETE FROM leave_requests WHERE id=$1 AND staff_id=$2", [id, staffId]);
    res.json({ ok: true, message: "Leave deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete leave" });
  }
}

// 3️⃣ DELETE /api/leave/admin/:id (admin delete if leave day not passed)
async function deleteLeaveByAdmin(req, res) {
  const { id } = req.params;

  try {
    const { rows } = await pool.query("SELECT * FROM leave_requests WHERE id=$1", [id]);
    if (!rows.length) return res.status(404).json({ error: "Leave request not found" });

    const today = DateTime.now().setZone("America/Toronto").startOf("day");
    const leaveStart = DateTime.fromJSDate(rows[0].start_date).setZone("America/Toronto").startOf("day");

    if (leaveStart < today) {
      return res.status(400).json({ error: "Cannot delete leave after it has started" });
    }

    await pool.query("DELETE FROM leave_requests WHERE id=$1", [id]);
    res.json({ ok: true, message: "Leave deleted by admin" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete leave" });
  }
}


export { requestLeave, listLeave, updateLeaveStatus, listMyLeave, editLeave, getLeaveByStaff, deleteLeaveByStaff, deleteLeaveByAdmin };

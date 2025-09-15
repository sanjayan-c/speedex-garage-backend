import { v4 as uuidv4 } from "uuid";
import { pool } from "../utils/db.js";

// POST /api/leave
async function requestLeave(req, res) {
  const { staffId, startDate, endDate, reason } = req.body;

  try {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO leave_requests (id, staff_id, start_date, end_date, reason)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, staffId, startDate, endDate, reason]
    );
    res.status(201).json({ id, staffId, startDate, endDate, reason, status: "pending" });
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
    res.json(rows);
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

export { requestLeave, listLeave, updateLeaveStatus };

// src/services/staff.js
import { v4 as uuidv4 } from "uuid";
import { pool } from "../utils/db.js";

// POST /api/staff
async function createStaff(req, res) {
  const { userId, firstName, lastName, email, contactNo, emergencyContactNo } =
    req.body;

  try {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO staff (id, user_id, first_name, last_name, email, contact_no, emergency_contact_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, userId, firstName, lastName, email, contactNo, emergencyContactNo]
    );

    res.status(201).json({
      id,
      userId,
      firstName,
      lastName,
      email,
      contactNo,
      emergencyContactNo,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email must be unique" });
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create staff" });
  }
}

// GET /api/staff
async function listStaff(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM staff ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch staff" });
  }
}

// GET /api/staff/:id
async function getStaffById(req, res) {
  try {
    const { rows } = await pool.query("SELECT * FROM staff WHERE id=$1", [
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch staff" });
  }
}

// PATCH /api/staff/:id
async function updateStaff(req, res) {
  const updates = req.body; // already validated by validate(staffUpdateSchema)

  const columnMap = {
    firstName: "first_name",
    lastName: "last_name",
    email: "email",
    contactNo: "contact_no",
    emergencyContactNo: "emergency_contact_no",
  };

  const fields = [];
  const params = [];
  let idx = 1;
  for (const [key, value] of Object.entries(updates)) {
    const col = columnMap[key];
    fields.push(`${col}=$${idx++}`);
    params.push(value);
  }
  params.push(req.params.id); // WHERE id

  try {
    const { rowCount } = await pool.query(
      `UPDATE staff SET ${fields.join(", ")} WHERE id=$${idx}`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ error: "Email must be unique" });
    console.error(err);
    res.status(500).json({ error: "Failed to update staff" });
  }
}

// DELETE /api/staff/:id
async function deleteStaff(req, res) {
  try {
    const { rowCount } = await pool.query("DELETE FROM staff WHERE id=$1", [
      req.params.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete staff" });
  }
}

export { createStaff, listStaff, getStaffById, updateStaff, deleteStaff };

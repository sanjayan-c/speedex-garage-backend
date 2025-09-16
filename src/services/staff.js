// src/services/staff.js
import { v4 as uuidv4 } from "uuid";
import { pool } from "../utils/db.js";

/* --------------------- helpers --------------------- */

const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;

function toMinutes(t) {
  // t: "HH:mm" or "HH:mm:ss"
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/**
 * Check if [sStart, sEnd] is fully inside [gStart, gEnd], with overnight support.
 * All inputs are minutes 0..1439.
 *
 * - If the global window is normal (gEnd >= gStart): require gStart <= sStart < sEnd <= gEnd
 * - If the global window crosses midnight (gEnd < gStart):
 *     Allowed minutes are [gStart, 1440) U [0, gEnd]
 *     The staff window must be entirely within either segment without crossing midnight itself.
 */
function isStaffWindowInsideGlobal(gStartMin, gEndMin, sStartMin, sEndMin) {
  if (sStartMin >= sEndMin) return false; // staff shift itself must be forward (no wrap)

  // Global normal (e.g., 09:00–17:00)
  if (gEndMin >= gStartMin) {
    return sStartMin >= gStartMin && sEndMin <= gEndMin;
  }

  // Global overnight (e.g., 22:00–06:00)
  const inLateSegment = sStartMin >= gStartMin && sEndMin <= 1440;
  const inEarlySegment = sStartMin >= 0 && sEndMin <= gEndMin;
  return inLateSegment || inEarlySegment;
}

async function readGlobalShiftTimes() {
  const { rows } = await pool.query(
    "SELECT start_local_time::text AS start_local_time, end_local_time::text AS end_local_time FROM shift_hours WHERE id=1"
  );
  if (!rows.length) {
    throw new Error("Global shift hours not configured");
  }
  const { start_local_time, end_local_time } = rows[0];
  return { start: start_local_time, end: end_local_time }; // "HH:MM:SS"
}

/**
 * Validate that provided staff shift (strings) is within global window.
 * Throws an Error with a descriptive message if invalid.
 */
async function assertStaffShiftWithinGlobal(shiftStart, shiftEnd) {
  if (!timeRe.test(shiftStart) || !timeRe.test(shiftEnd)) {
    throw new Error("shiftStart/shiftEnd must be in HH:mm or HH:mm:ss format");
  }

  const global = await readGlobalShiftTimes();
  const gStartMin = toMinutes(global.start);
  const gEndMin = toMinutes(global.end);
  const sStartMin = toMinutes(shiftStart);
  const sEndMin = toMinutes(shiftEnd);

  if (!isStaffWindowInsideGlobal(gStartMin, gEndMin, sStartMin, sEndMin)) {
    const gStartDisp = global.start.slice(0, 5);
    const gEndDisp = global.end.slice(0, 5);
    throw new Error(
      `Staff shift (${shiftStart}–${shiftEnd}) must be within global window ${gStartDisp}–${gEndDisp} (Toronto local time).`
    );
  }
}

/* --------------------- services --------------------- */

// POST /api/staff
async function createStaff(req, res) {
  const {
    userId,
    firstName,
    lastName,
    email,
    contactNo,
    emergencyContactNo,
    shiftStart,
    shiftEnd,
  } = req.body;

  try {
    // If either staff shift time is provided, require both and validate against global
    if ((shiftStart && !shiftEnd) || (!shiftStart && shiftEnd)) {
      return res
        .status(400)
        .json({ error: "Provide both shiftStart and shiftEnd together." });
    }
    if (shiftStart && shiftEnd) {
      await assertStaffShiftWithinGlobal(shiftStart, shiftEnd);
    }

    const id = uuidv4();
    await pool.query(
      `INSERT INTO staff (
         id, user_id, first_name, last_name, email, contact_no, emergency_contact_no,
         shift_start_local_time, shift_end_local_time
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::time,$9::time)`,
      [
        id,
        userId,
        firstName,
        lastName,
        email,
        contactNo,
        emergencyContactNo,
        shiftStart ?? null,
        shiftEnd ?? null,
      ]
    );

    res.status(201).json({
      id,
      userId,
      firstName,
      lastName,
      email,
      contactNo,
      emergencyContactNo,
      shiftStart: shiftStart ?? null,
      shiftEnd: shiftEnd ?? null,
    });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Email must be unique" });
    }
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to create staff" });
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
  const updates = req.body;

  // If either provided in updates, we need to validate (merge with existing)
  const wantsShiftStart = Object.prototype.hasOwnProperty.call(
    updates,
    "shiftStart"
  );
  const wantsShiftEnd = Object.prototype.hasOwnProperty.call(
    updates,
    "shiftEnd"
  );

  try {
    // If one is provided, the other must also be provided (to avoid half-updates)
    if (
      (wantsShiftStart && !wantsShiftEnd) ||
      (!wantsShiftStart && wantsShiftEnd)
    ) {
      return res.status(400).json({
        error:
          "When updating shift times, provide both shiftStart and shiftEnd together.",
      });
    }

    // If both are provided, verify they sit inside the global window
    if (wantsShiftStart && wantsShiftEnd) {
      await assertStaffShiftWithinGlobal(updates.shiftStart, updates.shiftEnd);
    }

    const columnMap = {
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      contactNo: "contact_no",
      emergencyContactNo: "emergency_contact_no",
      shiftStart: "shift_start_local_time",
      shiftEnd: "shift_end_local_time",
    };

    const fields = [];
    const params = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      const col = columnMap[key];
      if (!col) continue;
      if (key === "shiftStart" || key === "shiftEnd") {
        fields.push(`${col}=$${idx++}::time`);
        params.push(value ?? null);
      } else {
        fields.push(`${col}=$${idx++}`);
        params.push(value);
      }
    }

    if (!fields.length) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    params.push(req.params.id);

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
    res.status(500).json({ error: err.message || "Failed to update staff" });
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

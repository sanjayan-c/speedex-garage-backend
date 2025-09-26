// src/services/staff.js
import { v4 as uuidv4 } from "uuid";
import { pool } from "../utils/db.js";
import bcrypt from "bcrypt";
import { readGlobalShiftTime } from "../services/shifts.js";
// src/services/staff.js
import { uploadToDrive } from "../middleware/driveUpload.js"; // your Drive helper
import { toToronto } from "../utils/time.js";

// Upload multiple staff documents
async function uploadStaffDocuments(staffId, files) {
  if (!files || !files.length) return [];

  const uploadedFileIds = [];
  for (const file of files) {
    const fileId = await uploadToDrive(
      file.buffer,
      file.originalname,
      file.mimetype
    );
    uploadedFileIds.push(fileId);
  }

  // Append uploaded documents to existing ones
  const { rows } = await pool.query(
    "UPDATE staff SET documents = COALESCE(documents, '{}') || $1 WHERE id=$2 RETURNING documents",
    [uploadedFileIds, staffId]
  );

  return rows[0].documents;
}

// Fetch staff documents
async function getStaffDocuments(staffId) {
  const { rows } = await pool.query("SELECT documents FROM staff WHERE id=$1", [
    staffId,
  ]);
  if (!rows.length) throw new Error("Staff not found");
  return rows[0].documents;
}

/* --------------------- helpers --------------------- */

// Matches "HH:mm" or "HH:mm:ss"
const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;

function toMinutes(t) {
  const [h, m, s] = t.split(":").map(Number);
  return h * 60 + (m ?? 0) + (s ? s / 60 : 0);
}

function getActorId(req) {
  // Your auth middleware already populates req.user from the cookie (per your reference).
  const id = req?.user?.sub || req?.user?.id || req?.cookies?.userId || null;

  // Soft UUID v4 check — keep, relax, or replace to match your ID format.
  const uuidV4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!id /* || !uuidV4.test(id) */) {
    // If your users.id is NOT uuid v4, remove the regex check above.
    throw new Error("Missing acting user id (cookie)");
  }
  return id;
}

function isStaffWindowInsideGlobal(gStartMin, gEndMin, sStartMin, sEndMin) {
  if (sStartMin >= sEndMin) return false;

  if (gEndMin >= gStartMin) {
    return sStartMin >= gStartMin && sEndMin <= gEndMin;
  }
  // overnight global window
  const inLateSegment = sStartMin >= gStartMin && sEndMin <= 1440;
  const inEarlySegment = sStartMin >= 0 && sEndMin <= gEndMin;
  return inLateSegment || inEarlySegment;
}

async function readGlobalShiftTimes() {
  const { start, end } = await readGlobalShiftTime();
  return { start, end };
}

/**
 * Validate weekly arrays (length 7). Each index:
 * - both null => OK (day off)
 * - both present => format OK and inside global window
 * - one null and one present => ERROR
 */
async function assertWeeklyShiftsWithinGlobal(startWeek, endWeek) {
  if (
    !Array.isArray(startWeek) ||
    !Array.isArray(endWeek) ||
    startWeek.length !== 7 ||
    endWeek.length !== 7
  ) {
    throw new Error(
      "shiftStart and shiftEnd must be arrays of length 7 (Mon..Sun)."
    );
  }

  const { start: gStart, end: gEnd } = await readGlobalShiftTimes();
  const gStartMin = toMinutes(gStart);
  const gEndMin = toMinutes(gEnd);

  for (let i = 0; i < 7; i++) {
    const s = startWeek[i];
    const e = endWeek[i];

    if (s == null && e == null) continue; // day off
    if ((s == null) !== (e == null)) {
      throw new Error(
        `Day ${i + 1}: start and end must both be provided or both be null.`
      );
    }
    if (!timeRe.test(s) || !timeRe.test(e)) {
      throw new Error(`Day ${i + 1}: times must be HH:mm or HH:mm:ss.`);
    }

    const sMin = toMinutes(s);
    const eMin = toMinutes(e);
    if (!isStaffWindowInsideGlobal(gStartMin, gEndMin, sMin, eMin)) {
      const gStartDisp = gStart.slice(0, 5);
      const gEndDisp = gEnd.slice(0, 5);
      throw new Error(
        `Day ${
          i + 1
        }: ${s}-${e} must be within global window ${gStartDisp}-${gEndDisp} (Toronto local time).`
      );
    }
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
    // must be arrays of length 7 (schema enforces)
    shiftStart,
    shiftEnd,
    birthday,
    joiningDate,
    leaveTaken,
    totalLeaves,
    position,
    managerId,
    jobFamily,
  } = req.body;

  try {
    const actorId = getActorId(req);

    if (managerId) {
      const { rowCount } = await pool.query(
        "SELECT 1 FROM staff WHERE id = $1",
        [managerId]
      );
      if (!rowCount)
        return res
          .status(400)
          .json({ error: "managerId must be an existing staff id" });
    }

    // If client omitted either, take it as all-null (your request)
    const startWeek = Array.isArray(shiftStart)
      ? shiftStart
      : Array(7).fill(null);
    const endWeek = Array.isArray(shiftEnd) ? shiftEnd : Array(7).fill(null);

    await assertWeeklyShiftsWithinGlobal(startWeek, endWeek);

    // Normalize contactNo to an array for TEXT[]
    const contactArray = Array.isArray(contactNo)
      ? contactNo.filter((v) => v !== undefined)
      : contactNo
      ? [contactNo]
      : [];

    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO staff (
         id, user_id, first_name, last_name, email, contact_no, emergency_contact_no,
         shift_start_local_time, shift_end_local_time,
         birthday, joining_date, leave_taken, total_leaves, position, manager_id, job_family,
         created_by, updated_by
       )
       VALUES (
         $1,$2,$3,$4,$5,$6::text[],$7,
         $8::time[], $9::time[],
         $10::date, $11::date, $12, $13, $14, $15, $16,
         $17, $18
       )
       RETURNING employee_id, birthday, joining_date, leave_taken, total_leaves,
                 position, manager_id, job_family,
                 created_by, updated_by, created_at, updated_at`,
      [
        id,
        userId,
        firstName,
        lastName,
        email,
        contactArray,
        emergencyContactNo,
        startWeek,
        endWeek,
        birthday ?? null,
        joiningDate ?? null,
        leaveTaken ?? 0,
        totalLeaves ?? 0,
        position ?? null,
        managerId ?? null,
        jobFamily ?? null,
        actorId,
        actorId,
      ]
    );

    const ret = rows[0];
    res.status(201).json({
      id,
      userId,
      employeeId: ret.employee_id,
      firstName,
      lastName,
      email,
      contactNo: contactArray,
      emergencyContactNo,
      shiftStart: startWeek,
      shiftEnd: endWeek,
      birthday: ret.birthday,
      joiningDate: ret.joining_date,
      leaveTaken: ret.leave_taken,
      totalLeaves: ret.total_leaves,
      position: ret.position,
      managerId: ret.manager_id,
      jobFamily: ret.job_family,
      createdBy: ret.created_by,
      updatedBy: ret.updated_by,
      createdAt: ret.created_at,
      updatedAt: ret.updated_at,
    });
  } catch (err) {
    if (err.code === "23505")
      return res
        .status(409)
        .json({ error: "Email or EmployeeID must be unique" });
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to create staff" });
  }
}

// GET /api/staff
async function listStaff(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.*,
        cu.username AS created_by_name,
        uu.username AS updated_by_name
      FROM staff s
      LEFT JOIN users cu ON cu.id = s.created_by
      LEFT JOIN users uu ON uu.id = s.updated_by
      ORDER BY s.created_at DESC
    `);

    const shaped = rows.map((r) => ({
      ...r,
      // Convert timestamps to Toronto ISO
      created_at: toToronto(r.created_at),
      updated_at: toToronto(r.updated_at),
      // Add friendly names (keep raw IDs too)
      created_by_name: r.created_by_name ?? null,
      updated_by_name: r.updated_by_name ?? null,
    }));

    res.json(shaped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch staff" });
  }
}

// GET /api/staff/:id
async function getStaffById(req, res) {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        s.*,
        cu.username AS created_by_name,
       uu.username AS updated_by_name
      FROM staff s
      LEFT JOIN users cu ON cu.id = s.created_by
      LEFT JOIN users uu ON uu.id = s.updated_by
      WHERE s.id = $1
      `,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Not found" });
    const r = rows[0];
    res.json({
      ...r,
      created_at: toToronto(r.created_at),
      updated_at: toToronto(r.updated_at),
      created_by_name: r.created_by_name ?? null,
      updated_by_name: r.updated_by_name ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch staff" });
  }
}

// PATCH /api/staff/:id
async function updateStaff(req, res) {
  const updates = req.body;

  try {
    const actorId = getActorId(req);

    const hasStart = Object.prototype.hasOwnProperty.call(
      updates,
      "shiftStart"
    );
    const hasEnd = Object.prototype.hasOwnProperty.call(updates, "shiftEnd");

    let startWeek, endWeek;
    if (hasStart || hasEnd) {
      if (!(hasStart && hasEnd)) {
        return res.status(400).json({
          error: "Provide both shiftStart and shiftEnd (arrays of length 7).",
        });
      }
      startWeek = updates.shiftStart;
      endWeek = updates.shiftEnd;
      await assertWeeklyShiftsWithinGlobal(startWeek, endWeek);
    }

    // managerId checks
    if (Object.prototype.hasOwnProperty.call(updates, "managerId")) {
      if (updates.managerId) {
        const { rowCount } = await pool.query(
          "SELECT 1 FROM staff WHERE id=$1",
          [updates.managerId]
        );
        if (!rowCount)
          return res
            .status(400)
            .json({ error: "managerId must be an existing staff id" });
        if (updates.managerId === req.params.id) {
          return res
            .status(400)
            .json({ error: "A staff member cannot be their own manager" });
        }
      }
    }

    const columnMap = {
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      contactNo: "contact_no",
      emergencyContactNo: "emergency_contact_no",
      shiftStart: "shift_start_local_time",
      shiftEnd: "shift_end_local_time",
      birthday: "birthday",
      joiningDate: "joining_date",
      leaveTaken: "leave_taken",
      totalLeaves: "total_leaves",
      position: "position",
      managerId: "manager_id",
      jobFamily: "job_family",
    };

    const fields = [];
    const params = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      const col = columnMap[key];
      if (!col) continue;

      if (key === "shiftStart") {
        fields.push(`${col}=$${idx++}::time[]`);
        params.push(startWeek);
      } else if (key === "shiftEnd") {
        fields.push(`${col}=$${idx++}::time[]`);
        params.push(endWeek);
      } else if (key === "birthday" || key === "joiningDate") {
        fields.push(`${col}=$${idx++}::date`);
        params.push(value ?? null);
      } else if (key === "contactNo") {
        const contactArray = Array.isArray(value)
          ? value.filter((v) => v !== undefined)
          : value
          ? [value]
          : [];
        fields.push(`${col}=$${idx++}::text[]`);
        params.push(contactArray);
      } else {
        fields.push(`${col}=$${idx++}`);
        params.push(value);
      }
    }

    if (!fields.length)
      return res.status(400).json({ error: "No valid fields to update" });

    // Always set updated_by from cookie
    fields.push(`updated_by=$${idx++}`);
    params.push(actorId);

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
/**
 * GET /api/staff/:id/allowed
 * Returns whether the staff's user is allowed
 */
async function getStaffAllowed(req, res) {
  const staffId = req.params.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT u.allowed
      FROM staff s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = $1
      `,
      [staffId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Staff not found" });
    }

    res.json({ allowed: rows[0].allowed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch allowed status" });
  }
}

async function getStaffBlocked(req, res) {
  const staffId = req.params.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT u.is_blocked
      FROM staff s
      JOIN users u ON s.user_id = u.id
      WHERE s.id = $1
      `,
      [staffId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Staff not found" });
    }

    res.json({ blocked: rows[0].is_blocked });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch Bloced status" });
  }
}

export {
  createStaff,
  listStaff,
  getStaffAllowed,
  getStaffById,
  getStaffBlocked,
  updateStaff,
  deleteStaff,
  isStaffWindowInsideGlobal,
  getStaffDocuments,
  uploadStaffDocuments,
  assertWeeklyShiftsWithinGlobal,
};

import { v4 as uuidv4 } from "uuid";
import { pool } from "../utils/db.js";
import { DateTime, Duration, Interval } from "luxon";
import { nowToronto, buildShiftWindowToronto } from "../utils/time.js";
import { getEffectiveShiftForUser } from "./untime.js";

// POST /api/leave
async function requestLeave(req, res) {
  let { staffId, startDate, endDate, reason } = req.body;

  try {
    // ---- Resolve staffId by role ----
    if (req.user?.role === "staff") {
      // derive from token's user id
      const uId = req.user.sub || req.user.id;
      const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [
        uId,
      ]);
      if (!staffQ.rowCount) {
        return res
          .status(404)
          .json({ error: "Staff record not found for user" });
      }
      staffId = staffQ.rows[0].id; // override any body value
    } else if (req.user?.role === "admin") {
      if (!staffId) {
        return res
          .status(400)
          .json({ error: "staffId is required for admin-created leave" });
      }
      // validate the staff exists
      const exists = await pool.query("SELECT 1 FROM staff WHERE id=$1", [
        staffId,
      ]);
      if (!exists.rowCount) {
        return res
          .status(404)
          .json({ error: "staffId does not match any staff" });
      }
    } else {
      return res.status(403).json({ error: "Forbidden" });
    }

    const id = uuidv4();

    // Parse and validate as dates (Toronto calendar semantics)
    const s = DateTime.fromISO(startDate, { zone: "America/Toronto" }).startOf(
      "day"
    );
    const e = DateTime.fromISO(endDate, { zone: "America/Toronto" }).startOf(
      "day"
    );
    if (!s.isValid || !e.isValid) {
      return res
        .status(400)
        .json({ error: "Invalid startDate/endDate (YYYY-MM-DD)" });
    }
    if (s > e) {
      return res
        .status(400)
        .json({ error: "Start date cannot be after end date" });
    }

    const todayTor = DateTime.now().setZone("America/Toronto").startOf("day");
    if (s <= todayTor) {
      return res
        .status(400)
        .json({ error: "Start date must be in the future (America/Toronto)" });
    }

    // Overlap check using DATE columns
    const { rows: overlaps } = await pool.query(
      `SELECT *
         FROM leave_requests
        WHERE staff_id = $1
          AND status IN ('pending','approved')
          AND NOT ($3 < start_date OR $2 > end_date)`,
      [staffId, s.toISODate(), e.toISODate()]
    );
    if (overlaps.length > 0) {
      return res.status(400).json({
        error: "Leave already exists for this date range",
        conflict: overlaps,
      });
    }

    // Insert DATE values directly
    await pool.query(
      `INSERT INTO leave_requests
         (id, staff_id, start_date, end_date, reason, status)
       VALUES ($1,$2,$3,$4,$5,'pending')`,
      [id, staffId, s.toISODate(), e.toISODate(), reason]
    );

    return res.status(201).json({
      id,
      staffId,
      startDate: s.toISODate(),
      endDate: e.toISODate(),
      reason,
      status: "pending",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to request leave" });
  }
}

// // GET /api/leave (admin or staff)
// async function listLeave(req, res) {
//   try {
//     const { rows } = await pool.query(
//       `SELECT lr.*, s.first_name, s.last_name
//          FROM leave_requests lr
//          JOIN staff s ON lr.staff_id = s.id
//         ORDER BY lr.created_at DESC`
//     );

//     const data = rows.map((r) => ({
//       ...r,
//       // start_date/end_date are DATE in DB; send YYYY-MM-DD
//       start_date: DateTime.fromJSDate(r.start_date).toISODate(),
//       end_date: DateTime.fromJSDate(r.end_date).toISODate(),
//       // created_at/updated_at are timestamptz (UTC) → convert to Toronto
//       created_at: DateTime.fromJSDate(r.created_at)
//         .setZone("America/Toronto")
//         .toISO(),
//       updated_at: DateTime.fromJSDate(r.updated_at)
//         .setZone("America/Toronto")
//         .toISO(),
//     }));

//     res.json(data);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to fetch leave requests" });
//   }
// }

// // GET /api/leave/me (staff only)
// async function listMyLeave(req, res) {
//   try {
//     const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [
//       req.user.sub || req.user.id,
//     ]);
//     if (!staffQ.rows.length)
//       return res.status(404).json({ error: "Staff record not found" });

//     const staffId = staffQ.rows[0].id;

//     const { rows } = await pool.query(
//       `SELECT * FROM leave_requests
//         WHERE staff_id = $1
//         ORDER BY created_at DESC`,
//       [staffId]
//     );

//     const data = rows.map((r) => ({
//       ...r,
//       start_date: DateTime.fromJSDate(r.start_date).toISODate(),
//       end_date: DateTime.fromJSDate(r.end_date).toISODate(),
//       created_at: DateTime.fromJSDate(r.created_at)
//         .setZone("America/Toronto")
//         .toISO(),
//       updated_at: DateTime.fromJSDate(r.updated_at)
//         .setZone("America/Toronto")
//         .toISO(),
//     }));

//     res.json(data);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to fetch my leave requests" });
//   }
// }

// // GET /api/leave/staff/:staffId
// async function getLeaveByStaff(req, res) {
//   const { staffId } = req.params;

//   try {
//     const { rows } = await pool.query(
//       `SELECT * FROM leave_requests
//         WHERE staff_id=$1
//         ORDER BY created_at DESC`,
//       [staffId]
//     );

//     const data = rows.map((r) => ({
//       ...r,
//       start_date: DateTime.fromJSDate(r.start_date).toISODate(),
//       end_date: DateTime.fromJSDate(r.end_date).toISODate(),
//       created_at: DateTime.fromJSDate(r.created_at)
//         .setZone("America/Toronto")
//         .toISO(),
//       updated_at: DateTime.fromJSDate(r.updated_at)
//         .setZone("America/Toronto")
//         .toISO(),
//     }));

//     res.json(data);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to fetch leave by staff" });
//   }
// }

// GET /api/leave (admin or staff)
async function listLeave(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT lr.*, s.employee_id, s.first_name, s.last_name
         FROM leave_requests lr
         JOIN staff s ON lr.staff_id = s.id
        ORDER BY lr.created_at DESC`
    );

    const data = rows.map((r) => ({
      ...r,
      start_date: DateTime.fromJSDate(r.start_date).toISODate(),
      end_date: DateTime.fromJSDate(r.end_date).toISODate(),
      created_at: DateTime.fromJSDate(r.created_at)
        .setZone("America/Toronto")
        .toISO(),
      updated_at: DateTime.fromJSDate(r.updated_at)
        .setZone("America/Toronto")
        .toISO(),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leave requests" });
  }
}

// GET /api/leave/me (staff only)
async function listMyLeave(req, res) {
  try {
    const staffQ = await pool.query(
      "SELECT id, employee_id, first_name FROM staff WHERE user_id=$1",
      [req.user.sub || req.user.id]
    );
    if (!staffQ.rows.length)
      return res.status(404).json({ error: "Staff record not found" });

    const { id: staffId, employee_id, first_name } = staffQ.rows[0];

    const { rows } = await pool.query(
      `SELECT lr.*
         FROM leave_requests lr
        WHERE lr.staff_id = $1
        ORDER BY lr.created_at DESC`,
      [staffId]
    );

    const data = rows.map((r) => ({
      ...r,
      employee_id,
      first_name,
      start_date: DateTime.fromJSDate(r.start_date).toISODate(),
      end_date: DateTime.fromJSDate(r.end_date).toISODate(),
      created_at: DateTime.fromJSDate(r.created_at)
        .setZone("America/Toronto")
        .toISO(),
      updated_at: DateTime.fromJSDate(r.updated_at)
        .setZone("America/Toronto")
        .toISO(),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch my leave requests" });
  }
}

// GET /api/leave/staff/:staffId
async function getLeaveByStaff(req, res) {
  const { staffId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT lr.*, s.employee_id, s.first_name
         FROM leave_requests lr
         JOIN staff s ON lr.staff_id = s.id
        WHERE lr.staff_id=$1
        ORDER BY lr.created_at DESC`,
      [staffId]
    );

    const data = rows.map((r) => ({
      ...r,
      start_date: DateTime.fromJSDate(r.start_date).toISODate(),
      end_date: DateTime.fromJSDate(r.end_date).toISODate(),
      created_at: DateTime.fromJSDate(r.created_at)
        .setZone("America/Toronto")
        .toISO(),
      updated_at: DateTime.fromJSDate(r.updated_at)
        .setZone("America/Toronto")
        .toISO(),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch leave by staff" });
  }
}


// PATCH /api/leave/:id/status (admin approve/reject)
async function updateLeaveStatus(req, res) {
  const { id } = req.params;
  const { status } = req.body; // "approved" | "rejected"

  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the request row
    const { rows, rowCount } = await client.query(
      `
      SELECT
        lr.id,
        lr.staff_id,
        lr.status,
        -- amount = inclusive day count (DATE arithmetic)
        (lr.end_date - lr.start_date + 1)::numeric AS amount
      FROM leave_requests lr
      WHERE lr.id = $1
      FOR UPDATE
      `,
      [id]
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Leave request not found" });
    }

    const reqRow = rows[0];

    if (reqRow.status === status) {
      await client.query("ROLLBACK");
      return res.json({
        ok: true,
        status,
        note: "No change (already in this status)",
      });
    }

    if (status === "approved") {
      if (reqRow.status === "approved") {
        await client.query("ROLLBACK");
        return res.json({
          ok: true,
          status: "approved",
          note: "Already approved earlier",
        });
      }

      const s = await client.query(
        `SELECT id, leave_taken, total_leaves
           FROM staff
          WHERE id = $1
          FOR UPDATE`,
        [reqRow.staff_id]
      );
      if (!s.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ error: "Staff not found for this request" });
      }

      const staffRow = s.rows[0];
      const current = Number(staffRow.leave_taken);
      const total = Number(staffRow.total_leaves);
      const amount = Math.max(0, Math.round(Number(reqRow.amount) * 100) / 100); // just in case

      const newTaken = Math.round((current + amount) * 100) / 100;
      if (newTaken > total) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Approval would exceed total leaves",
          remaining: Math.max(0, Math.round((total - current) * 100) / 100),
          requested: amount,
        });
      }

      await client.query(`UPDATE staff SET leave_taken = $2 WHERE id = $1`, [
        staffRow.id,
        newTaken,
      ]);
    }

    await client.query(
      `UPDATE leave_requests
          SET status = $1, updated_at = NOW()
        WHERE id = $2`,
      [status, id]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, status });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("updateLeaveStatus failed:", err);
    if (err.code === "23514") {
      return res
        .status(400)
        .json({ error: "leave_taken cannot exceed total_leaves" });
    }
    return res.status(500).json({ error: "Failed to update leave request" });
  } finally {
    client.release();
  }
}

// PATCH /api/leave/:id (staff can edit if pending)
async function editLeave(req, res) {
  const { id } = req.params;
  const { startDate, endDate, reason } = req.body;

  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [
      req.user.sub || req.user.id,
    ]);
    if (!staffQ.rows.length)
      return res.status(404).json({ error: "Staff record not found" });
    const staffId = staffQ.rows[0].id;

    const { rows } = await pool.query(
      "SELECT * FROM leave_requests WHERE id=$1 AND staff_id=$2",
      [id, staffId]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Leave request not found" });
    if (rows[0].status !== "pending") {
      return res
        .status(400)
        .json({ error: "Cannot edit leave after it is approved or rejected" });
    }

    const sIn = startDate
      ? DateTime.fromISO(startDate, { zone: "America/Toronto" }).startOf("day")
      : null;
    const eIn = endDate
      ? DateTime.fromISO(endDate, { zone: "America/Toronto" }).startOf("day")
      : null;

    if ((sIn && !sIn.isValid) || (eIn && !eIn.isValid)) {
      return res
        .status(400)
        .json({ error: "Invalid startDate/endDate (YYYY-MM-DD)" });
    }
    if (sIn && eIn && sIn > eIn) {
      return res
        .status(400)
        .json({ error: "Start date cannot be after end date" });
    }

    const sOut = sIn
      ? sIn.toISODate()
      : DateTime.fromJSDate(rows[0].start_date).toISODate();
    const eOut = eIn
      ? eIn.toISODate()
      : DateTime.fromJSDate(rows[0].end_date).toISODate();

    const todayTor = DateTime.now().setZone("America/Toronto").startOf("day");
    const sCheck =
      sIn ??
      DateTime.fromJSDate(rows[0].start_date)
        .setZone("America/Toronto")
        .startOf("day");
    if (sCheck <= todayTor) {
      return res
        .status(400)
        .json({ error: "Start date must be in the future (America/Toronto)" });
    }

    await pool.query(
      `UPDATE leave_requests
          SET start_date=$1, end_date=$2, reason=$3, updated_at=NOW()
        WHERE id=$4 AND staff_id=$5`,
      [sOut, eOut, reason || rows[0].reason, id, staffId]
    );

    res.json({ ok: true, message: "Leave updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update leave request" });
  }
}

// DELETE /api/leave/:id (staff delete if pending)
async function deleteLeaveByStaff(req, res) {
  const { id } = req.params;

  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [
      req.user.sub || req.user.id,
    ]);
    if (!staffQ.rows.length)
      return res.status(404).json({ error: "Staff record not found" });
    const staffId = staffQ.rows[0].id;

    const { rows } = await pool.query(
      "SELECT * FROM leave_requests WHERE id=$1 AND staff_id=$2",
      [id, staffId]
    );
    if (!rows.length)
      return res.status(404).json({ error: "Leave request not found" });

    if (rows[0].status !== "pending") {
      return res
        .status(400)
        .json({ error: "Only pending leave can be deleted by staff" });
    }

    await pool.query("DELETE FROM leave_requests WHERE id=$1 AND staff_id=$2", [
      id,
      staffId,
    ]);
    res.json({ ok: true, message: "Leave deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete leave" });
  }
}

// DELETE /api/leave/admin/:id (admin delete if leave day not passed)
async function deleteLeaveByAdmin(req, res) {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock the leave row so amount/status can't change under us
    const { rows } = await client.query(
      `SELECT id, staff_id, start_date, end_date, status
         FROM leave_requests
        WHERE id = $1
        FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Leave request not found" });
    }

    const lr = rows[0];

    // Guard: cannot delete after the leave has started (Toronto calendar)
    const today = DateTime.now().setZone("America/Toronto").startOf("day");
    const leaveStart = DateTime.fromJSDate(lr.start_date)
      .setZone("America/Toronto")
      .startOf("day");
    if (leaveStart < today) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({ error: "Cannot delete leave after it has started" });
    }

    // If this leave was already approved, revert its inclusive day amount
    if (lr.status === "approved") {
      const amount = Number(lr.end_date - lr.start_date + 1); // DATE arithmetic: inclusive days

      // Lock staff row and decrement safely
      const s = await client.query(
        `SELECT id, leave_taken, total_leaves
           FROM staff
          WHERE id = $1
          FOR UPDATE`,
        [lr.staff_id]
      );
      if (!s.rowCount) {
        await client.query("ROLLBACK");
        return res
          .status(404)
          .json({ error: "Staff not found for this request" });
      }

      const staffRow = s.rows[0];
      const current = Number(staffRow.leave_taken);
      const newTaken = Math.round((current - amount) * 100) / 100;

      if (newTaken < 0) {
        // This would indicate data drift (more reverted than taken)
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: "Cannot revert more than taken; data inconsistency",
          maxRevertible: current,
          requested: amount,
        });
      }

      await client.query(`UPDATE staff SET leave_taken = $2 WHERE id = $1`, [
        staffRow.id,
        newTaken,
      ]);
    }

    // Finally delete the leave request
    await client.query(`DELETE FROM leave_requests WHERE id = $1`, [id]);

    await client.query("COMMIT");
    return res.json({ ok: true, message: "Leave deleted by admin" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("deleteLeaveByAdmin failed:", err);
    return res.status(500).json({ error: "Failed to delete leave" });
  } finally {
    client.release();
  }
}

// Helper: interval "contains" check with Luxon Interval
function contains(dt, start, end) {
  return Interval.fromDateTimes(start, end).contains(dt); // [start, end)
}

// Helper: derive the *core* shift (without the ±30m start/end buffer)
function coreShiftFromBuffered(windowStart, windowEnd) {
  const coreStart = windowStart.plus({ minutes: 30 });
  const coreEnd = windowEnd.minus({ minutes: 30 });
  return { coreStart, coreEnd };
}

// Returns: { onLeave: boolean, leave: row|null }
async function isUserOnLeaveNow(userId) {
  // 1) find staff id for this user
  const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [
    userId,
  ]);
  if (!staffQ.rows.length) return { onLeave: false, leave: null };
  const staffId = staffQ.rows[0].id;

  // 2) today's Toronto calendar date (YYYY-MM-DD)
  const todayToronto = DateTime.now().setZone("America/Toronto").toISODate();

  // 3) any APPROVED leave whose DATE range contains today
  const { rows } = await pool.query(
    `SELECT *
       FROM leave_requests
      WHERE staff_id = $1
        AND status   = 'approved'
        AND start_date <= $2::date
        AND end_date   >= $2::date
      ORDER BY start_date DESC
      LIMIT 1`,
    [staffId, todayToronto]
  );

  if (!rows.length) return { onLeave: false, leave: null };

  // optional: normalize dates to YYYY-MM-DD for the caller
  const r = rows[0];
  const normalized = {
    ...r,
    start_date: DateTime.fromJSDate(r.start_date).toISODate(),
    end_date: DateTime.fromJSDate(r.end_date).toISODate(),
    created_at: DateTime.fromJSDate(r.created_at)
      .setZone("America/Toronto")
      .toISO(),
    updated_at: DateTime.fromJSDate(r.updated_at)
      .setZone("America/Toronto")
      .toISO(),
  };

  return { onLeave: true, leave: normalized };
}

export {
  requestLeave,
  listLeave,
  updateLeaveStatus,
  listMyLeave,
  editLeave,
  getLeaveByStaff,
  deleteLeaveByStaff,
  deleteLeaveByAdmin,
  isUserOnLeaveNow,
};

import { pool } from "../utils/db.js";
import { DateTime } from "luxon";
import { toToronto } from "../utils/time.js";
// Staff submits WFH request (for today or future date)
async function requestWFH(req, res) {
  const { reason, request_date } = req.body; // optional future date
  const userId = req.user.sub || req.user.id;

  try {
    // resolve staff id
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [userId]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff not found" });
    const staffId = staffQ.rows[0].id;

    // Determine requested date in Toronto timezone
    let requestedDate;
    if (request_date) {
      // Parse provided date
      requestedDate = DateTime.fromISO(request_date, { zone: "America/Toronto" });
      if (!requestedDate.isValid) return res.status(400).json({ error: "Invalid request_date format" });
    } else {
      // Default to today
      requestedDate = DateTime.now().setZone("America/Toronto");
    }

    // Validate that requested date is today or future
    const todayTor = DateTime.now().setZone("America/Toronto").startOf("day");
    if (requestedDate.startOf("day") < todayTor) {
      return res.status(400).json({ error: "Cannot request WFH for past dates" });
    }

    // Convert to ISO date for DB
    const dbDate = requestedDate.toISODate();

    const { rows } = await pool.query(
      `INSERT INTO wfh_requests (staff_id, request_date, reason)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (staff_id, request_date) 
       DO UPDATE SET reason = EXCLUDED.reason, updated_at=NOW()
       RETURNING *`,
      [staffId, dbDate, reason || null]
    );

    return res.json({ ok: true, request: rows[0] });
  } catch (err) {
    console.error("requestWFH failed:", err);
    return res.status(500).json({ error: "Failed to request WFH" });
  }
}

// Admin views all WFH requests
async function listWFHRequests(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT w.*, s.first_name, s.last_name
       FROM wfh_requests w
       JOIN staff s ON w.staff_id = s.id
       ORDER BY w.request_date DESC, w.created_at DESC`
    );

    const nowToronto = DateTime.now().setZone("America/Toronto").startOf("day");

    return res.json(rows.map(r => {
      const requestDate = DateTime.fromJSDate(r.request_date).setZone("America/Toronto").startOf("day");
      let dateStatus = "past";

      if (requestDate.equals(nowToronto)) dateStatus = "today";
      else if (requestDate > nowToronto) dateStatus = "future";

      return {
        ...r,
        created_at: toToronto(r.created_at),
        approved_at: r.approved_at ? toToronto(r.approved_at) : null,
        rejected_at: r.rejected_at ? toToronto(r.rejected_at) : null,
        time_in: r.time_in ? toToronto(r.time_in) : null,
        time_out: r.time_out ? toToronto(r.time_out) : null,
        dateStatus, // "past" | "today" | "future"
      };
    }));
  } catch (err) {
    console.error("listWFHRequests failed:", err);
    return res.status(500).json({ error: "Failed to fetch WFH requests" });
  }
}


// Admin approves/rejects a request
async function handleWFHRequest(req, res) {
  const { requestId } = req.params;
  const { action } = req.body; // approve | reject
  const adminId = req.user.sub || req.user.id;

  try {
    let query, values;
    if (action === "approve") {
      query = `
        UPDATE wfh_requests
        SET status='approved', approved_by=$2, approved_at=NOW(), updated_at=NOW()
        WHERE id=$1 RETURNING *`;
      values = [requestId, adminId];
    } else if (action === "reject") {
      query = `
        UPDATE wfh_requests
        SET status='rejected', rejected_by=$2, rejected_at=NOW(), updated_at=NOW()
        WHERE id=$1 RETURNING *`;
      values = [requestId, adminId];
    } else {
      return res.status(400).json({ error: "Invalid action" });
    }

    const { rows } = await pool.query(query, values);
    if (!rows.length) return res.status(404).json({ error: "Request not found" });

    return res.json({ ok: true, request: rows[0] });
  } catch (err) {
    console.error("handleWFHRequest failed:", err);
    return res.status(500).json({ error: "Failed to update WFH request" });
  }
}
// Staff marks IN for WFH
// Staff marks IN for WFH
async function wfhCheckIn(req, res) {
  const userId = req.user.sub || req.user.id;

  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [userId]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff not found" });
    const staffId = staffQ.rows[0].id;

    const todayTor = DateTime.now().setZone("America/Toronto").startOf("day");
    const todayDate = todayTor.toISODate();

    const rq = await pool.query(
      "SELECT * FROM wfh_requests WHERE staff_id=$1 AND request_date=$2 AND status='approved'",
      [staffId, todayDate]
    );
    if (!rq.rows.length) return res.status(400).json({ error: "No approved WFH request for today" });

    const checkInUtc = DateTime.now().toUTC().toISO();

    await pool.query(
      `UPDATE wfh_requests SET time_in=$1, updated_at=NOW()
       WHERE id=$2`,
      [checkInUtc, rq.rows[0].id]
    );

    await pool.query(
      `INSERT INTO attendance_records (staff_id, attendance_date, time_in)
       VALUES ($1, $2::date, $3)
       ON CONFLICT (staff_id, attendance_date) DO UPDATE
         SET time_in = EXCLUDED.time_in`,
      [staffId, todayDate, checkInUtc]
    );

    // ✅ Use userId here
    await pool.query("UPDATE users SET allowed = true WHERE id = $1", [userId]);

    return res.json({ ok: true, time_in: toToronto(checkInUtc) });
  } catch (err) {
    console.error("wfhCheckIn failed:", err);
    return res.status(500).json({ error: "Failed to WFH check-in" });
  }
}

// Staff marks OUT for WFH
async function wfhCheckOut(req, res) {
  const userId = req.user.sub || req.user.id;

  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [userId]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff not found" });
    const staffId = staffQ.rows[0].id;

    const todayTor = DateTime.now().setZone("America/Toronto").startOf("day");
    const todayDate = todayTor.toISODate();

    const rq = await pool.query(
      "SELECT * FROM wfh_requests WHERE staff_id=$1 AND request_date=$2 AND status='approved'",
      [staffId, todayDate]
    );
    if (!rq.rows.length) return res.status(400).json({ error: "No approved WFH request for today" });

    const checkOutUtc = DateTime.now().toUTC().toISO();

    await pool.query(
      `UPDATE wfh_requests SET time_out=$1, updated_at=NOW()
       WHERE id=$2`,
      [checkOutUtc, rq.rows[0].id]
    );

    await pool.query(
      `UPDATE attendance_records
       SET time_out=$1
       WHERE staff_id=$2 AND attendance_date=$3`,
      [checkOutUtc, staffId, todayDate]
    );

    // ✅ Use userId here
    await pool.query("UPDATE users SET allowed = false WHERE id = $1", [userId]);

    return res.json({ ok: true, time_out: toToronto(checkOutUtc) });
  } catch (err) {
    console.error("wfhCheckOut failed:", err);
    return res.status(500).json({ error: "Failed to WFH check-out" });
  }
}


// Get WFH requests for the logged-in staff
async function getMyWFHRequests(req, res) {
  const userId = req.user.sub || req.user.id;

  try {
    // resolve staff id
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [userId]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff not found" });
    const staffId = staffQ.rows[0].id;

    const { rows } = await pool.query(
      `SELECT * FROM wfh_requests 
       WHERE staff_id=$1
       ORDER BY request_date DESC, created_at DESC`,
      [staffId]
    );

    const nowToronto = DateTime.now().setZone("America/Toronto").startOf("day");

    return res.json(rows.map(r => {
      const requestDate = DateTime.fromJSDate(r.request_date).setZone("America/Toronto").startOf("day");
      let dateStatus = "past";
      if (requestDate.equals(nowToronto)) dateStatus = "today";
      else if (requestDate > nowToronto) dateStatus = "future";

      return {
        ...r,
        created_at: toToronto(r.created_at),
        approved_at: r.approved_at ? toToronto(r.approved_at) : null,
        rejected_at: r.rejected_at ? toToronto(r.rejected_at) : null,
        time_in: r.time_in ? toToronto(r.time_in) : null,
        time_out: r.time_out ? toToronto(r.time_out) : null,
        dateStatus, // "past" | "today" | "future"
      };
    }));
  } catch (err) {
    console.error("getMyWFHRequests failed:", err);
    return res.status(500).json({ error: "Failed to fetch your WFH requests" });
  }
}


export {
  requestWFH,
  listWFHRequests,
  handleWFHRequest,
  wfhCheckIn,
  wfhCheckOut,
  getMyWFHRequests
};

import { pool } from "../utils/db.js";
import {
  nowToronto,
  buildShiftWindowToronto,
  isInWindow,
} from "../utils/time.js";
import { isUserOnLeaveNow } from "./leave.js";
import { hasShiftEndedForToday } from "./attendance.js";

// GET /api/untime/pending
async function listPendingUntime(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT id, username, role, is_login, untime, untime_approved, created_at
      FROM users
      WHERE role = 'staff'
        AND untime IS NOT NULL
        AND (untime->>'active')::boolean = true
        AND untime_approved = false
      ORDER BY created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch pending UnTime items" });
  }
}

// POST /api/untime/start  { userId, durationMinutes? }
async function startUntimeForStaff(req, res) {
  const { userId, durationMinutes } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId is required" });
  if (
    durationMinutes !== undefined &&
    (!Number.isInteger(durationMinutes) || durationMinutes <= 0)
  ) {
    return res
      .status(400)
      .json({ error: "durationMinutes must be a positive integer" });
  }

  try {
    // Ensure staff + pending active flag exists
    const { rows } = await pool.query(
      `SELECT id FROM users
       WHERE id=$1 AND role='staff'
         AND untime IS NOT NULL
         AND (untime->>'active')::boolean = true
         AND untime_approved = false`,
      [userId]
    );
    if (!rows.length) {
      return res
        .status(404)
        .json({ error: "No pending UnTime for that staff user" });
    }

    const startIso = nowToronto().toISO();
    const minutes = durationMinutes ?? 10;

    // Update untime JSON with startTime + duration, approve flag true
    await pool.query(
      `UPDATE users
       SET untime = jsonb_set(
                     jsonb_set(untime, '{startTime}', to_jsonb($1::timestamptz::text), true),
                     '{durationMinutes}', to_jsonb($2::int), true
                   ),
           untime_approved = true
       WHERE id = $3`,
      [startIso, minutes, userId]
    );

    console.log(
      `[ADMIN] UnTime started for staff ${userId}: start=${startIso}, duration=${minutes}m`
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to start UnTime" });
  }
}

// POST /api/untime/duration  { userId, durationMinutes }
async function updateUntimeDurationForStaff(req, res) {
  const { userId, durationMinutes } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId is required" });
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return res
      .status(400)
      .json({ error: "durationMinutes must be a positive integer" });
  }

  try {
    // Only for staff with active untime (approved or not)
    const { rowCount } = await pool.query(
      `UPDATE users
       SET untime = jsonb_set(untime, '{durationMinutes}', to_jsonb($1::int), true)
       WHERE id = $2
         AND role = 'staff'
         AND untime IS NOT NULL
         AND (untime->>'active')::boolean = true`,
      [durationMinutes, userId]
    );

    if (!rowCount) {
      return res
        .status(404)
        .json({ error: "No active UnTime found for that staff user" });
    }

    console.log(
      `[ADMIN] UnTime duration updated for staff ${userId} → ${durationMinutes}m`
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update UnTime duration" });
  }
}

/**
 * Return the effective shift for a user:
 * 1) staff-specific shift if both start/end exist
 * 2) fallback to global shift_hours
 * Returns: { start_local_time: "HH:MM:SS", end_local_time: "HH:MM:SS" } | null
 */
async function getEffectiveShiftForUser(userId) {
  // per-staff
  const { rows: sRows } = await pool.query(
    `SELECT
       shift_start_local_time::text AS start_local_time,
       shift_end_local_time::text   AS end_local_time
     FROM staff
     WHERE user_id=$1`,
    [userId]
  );

  if (sRows.length && sRows[0].start_local_time && sRows[0].end_local_time) {
    return sRows[0];
  }

  // global fallback
  const { rows: gRows } = await pool.query(
    "SELECT start_local_time::text AS start_local_time, end_local_time::text AS end_local_time FROM shift_hours WHERE id=1"
  );
  return gRows.length ? gRows[0] : null;
}

/**
 * For STAFF ONLY:
 * - Check applied leave
 * - Builds 30-min buffered window from the effective shift
 * - If outside:
 *     set users.untime = { active: true }, untime_approved=false
 *     and log a mock admin alert
 * - If inside: (optionally) clear stale untime (commented)
 *
 * Returns an object with diagnostics you can log if you wish.
 */
async function enforceStaffUntimeWindow(userId, username, role) {
  if (role !== "staff") return { skipped: true };

  // A) Already ended today (not in OT)?
  const endStatus = await hasShiftEndedForToday(userId);
  if (endStatus.ended) {
    // ✅ set untime for ended-shift case too
    const untimeInitial = { active: true, reason: "ended" };
    await pool.query(
      "UPDATE users SET untime=$1, untime_approved=false WHERE id=$2",
      [JSON.stringify(untimeInitial), userId]
    );
    console.warn(
      `[ALERT MOCK] Staff attempted login after shift ended: ${username} (${userId}) — awaiting admin start`
    );
    return {
      skipped: false,
      ended: true,
      reason: "ended",
      nowTorontoISO: nowToronto().toISO(),
      // no window here (by design)
    };
  }

  // B) On leave now?
  const leaveStatus = await isUserOnLeaveNow(userId);
  if (leaveStatus.onLeave) {
    const untimeInitial = { active: true, reason: "leave" };
    await pool.query(
      "UPDATE users SET untime=$1, untime_approved=false WHERE id=$2",
      [JSON.stringify(untimeInitial), userId]
    );
    console.warn(
      `[ALERT MOCK] Staff is on leave during login: ${username} (${userId}) — awaiting admin start`
    );
    return {
      outside: true,
      reason: "on-leave",
      nowTorontoISO: nowToronto().toISO(),
      // no window for leave branch
      leave: leaveStatus.leave,
    };
  }

  // C) Shift-window enforcement (30-min buffered)
  const shift = await getEffectiveShiftForUser(userId);
  if (!shift) return { skipped: true, reason: "no-shift" };

  const { windowStart, windowEnd } = buildShiftWindowToronto(shift);
  const nowTor = nowToronto();
  const outside = !isInWindow(nowTor, windowStart, windowEnd);

  if (outside) {
    const untimeInitial = { active: true, reason: "outside-window" };
    await pool.query(
      "UPDATE users SET untime=$1, untime_approved=false WHERE id=$2",
      [JSON.stringify(untimeInitial), userId]
    );
    console.warn(
      `[ALERT MOCK] Staff out-of-window login: ${username} (${userId}) — awaiting admin start`
    );

    return {
      outside: true,
      reason: "outside-window",
      nowTorontoISO: nowTor.toISO(),
      windowStartISO: windowStart.toISO(),
      windowEndISO: windowEnd.toISO(),
    };
  } else {
    // ✅ Inside allowed window → clear any untime
    await pool.query(
      "UPDATE users SET untime=$1, untime_approved=$2 WHERE id=$3",
      [null, false, userId]
    );

    return {
      outside: false,
      nowTorontoISO: nowTor.toISO(),
      windowStartISO: windowStart.toISO(),
      windowEndISO: windowEnd.toISO(),
    };
  }
}

export {
  listPendingUntime,
  startUntimeForStaff,
  updateUntimeDurationForStaff,
  getEffectiveShiftForUser,
  enforceStaffUntimeWindow,
};

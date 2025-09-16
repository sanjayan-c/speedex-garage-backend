import { pool } from "../utils/db.js";
import { nowToronto } from "../utils/time.js";

// GET /api/untime/pending
export async function listPendingUntime(req, res) {
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
export async function startUntimeForStaff(req, res) {
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
export async function updateUntimeDurationForStaff(req, res) {
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

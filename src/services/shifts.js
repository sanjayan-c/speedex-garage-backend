// src/services/shifts.js
import { pool } from "../utils/db.js";
import { rescheduleShiftLogout } from "../jobs/shiftLogout.js";

/* ---------------- helpers for time-window checks ---------------- */

const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;

function toMinutes(t) {
  // t: "HH:mm" or "HH:mm:ss"
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

/**
 * Staff window [sStart,sEnd] must be fully inside global [gStart,gEnd].
 * All inputs are minutes [0..1439]. Supports overnight global windows.
 *
 * - If global is normal (gEnd >= gStart):
 *     require gStart <= sStart < sEnd <= gEnd
 * - If global crosses midnight (gEnd < gStart), allowed minutes are:
 *     [gStart, 1440) U [0, gEnd]
 *   Staff window itself cannot cross midnight; it must be entirely inside
 *   either the late segment or the early segment.
 */
function isStaffWindowInsideGlobal(gStartMin, gEndMin, sStartMin, sEndMin) {
  if (sStartMin >= sEndMin) return false; // disallow staff windows that wrap over midnight

  if (gEndMin >= gStartMin) {
    // normal daytime window
    return sStartMin >= gStartMin && sEndMin <= gEndMin;
  }

  // overnight global window
  const inLateSegment = sStartMin >= gStartMin && sEndMin <= 1440;
  const inEarlySegment = sStartMin >= 0 && sEndMin <= gEndMin;
  return inLateSegment || inEarlySegment;
}

/* ---------------- routes ---------------- */

async function getShift(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT
         start_local_time::text AS start_local_time,
         end_local_time::text   AS end_local_time,
         updated_at
       FROM shift_hours
       WHERE id=1`
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Shift hours not configured" });
    }
    const r = rows[0];
    res.json({
      start: r.start_local_time, // "HH:MM:SS"
      end: r.end_local_time, // "HH:MM:SS"
      updatedAt: r.updated_at,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch shift hours" });
  }
}

async function updateShift(req, res) {
  const { start, end } = req.body || {};
  if (!timeRe.test(start) || !timeRe.test(end)) {
    return res
      .status(400)
      .json({ error: "Invalid time format. Use HH:mm or HH:mm:ss" });
  }

  try {
    // 1) Validate the new global window **against existing staff allocations**
    const gStartMin = toMinutes(start);
    const gEndMin = toMinutes(end);

    // fetch all staff with explicit shift times
    const { rows: staffRows } = await pool.query(
      `SELECT
         s.id AS staff_id,
         s.user_id,
         u.username,
         s.shift_start_local_time::text AS shift_start,
         s.shift_end_local_time::text   AS shift_end
       FROM staff s
       JOIN users u ON u.id = s.user_id
       WHERE s.shift_start_local_time IS NOT NULL
         AND s.shift_end_local_time IS NOT NULL`
    );

    const conflicts = [];
    for (const r of staffRows) {
      const sStartMin = toMinutes(r.shift_start);
      const sEndMin = toMinutes(r.shift_end);
      const ok = isStaffWindowInsideGlobal(
        gStartMin,
        gEndMin,
        sStartMin,
        sEndMin
      );
      if (!ok) {
        conflicts.push({
          staffId: r.staff_id,
          userId: r.user_id,
          username: r.username,
          shiftStart: r.shift_start,
          shiftEnd: r.shift_end,
        });
      }
    }

    if (conflicts.length) {
      return res.status(400).json({
        error:
          "Proposed global shift would conflict with existing staff shift allocations. Adjust staff shifts first, or choose a wider global window.",
        conflicts, // lets admin see which staff to adjust
      });
    }

    // 2) Apply the new global window
    await pool.query(
      `INSERT INTO shift_hours (id, start_local_time, end_local_time)
         VALUES (1, $1::time, $2::time)
         ON CONFLICT (id)
         DO UPDATE SET start_local_time=EXCLUDED.start_local_time,
                       end_local_time=EXCLUDED.end_local_time,
                       updated_at=NOW()`,
      [start, end]
    );

    // 3) Reschedule cron to end+30
    await rescheduleShiftLogout();

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update shift hours" });
  }
}

async function logoutAllUsers(req, res) {
  try {
    const revoke = await pool.query(
      "UPDATE refresh_tokens SET revoked=true WHERE revoked=false"
    );
    const logout = await pool.query(
      "UPDATE users SET is_login=false, untime=NULL, untime_approved=false WHERE is_login=true"
    );

    return res.json({
      ok: true,
      revokedTokens: revoke.rowCount ?? 0,
      usersLoggedOut: logout.rowCount ?? 0,
    });
  } catch (err) {
    console.error("Force logout failed:", err);
    return res.status(500).json({ error: "Force logout failed" });
  }
}

async function logoutAllStaff(req, res) {
  try {
    const revoke = await pool.query(
      `UPDATE refresh_tokens
         SET revoked = true
         WHERE revoked = false
           AND user_id IN (SELECT id FROM users WHERE role = 'staff')`
    );
    const logout = await pool.query(
      `UPDATE users
         SET is_login = false, untime = NULL, untime_approved = false
         WHERE is_login = true
           AND role = 'staff'`
    );

    if (res) {
      return res.json({
        ok: true,
        revokedTokens: revoke.rowCount ?? 0,
        staffLoggedOut: logout.rowCount ?? 0,
      });
    }
    console.log(
      `[cron] Staff-only logout — revoked: ${revoke.rowCount ?? 0}, users: ${
        logout.rowCount ?? 0
      }`
    );
  } catch (err) {
    console.error("Staff force logout failed:", err);
    if (res)
      return res.status(500).json({ error: "Force logout staff failed" });
  }
}

export { getShift, updateShift, logoutAllUsers, logoutAllStaff };

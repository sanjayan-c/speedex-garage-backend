// src/services/shifts.js
import { pool } from "../utils/db.js";
import { isStaffWindowInsideGlobal } from "../services/staff.js";
import { rescheduleShiftLogout } from "../jobs/shiftLogout.js";
import { rescheduleShiftAlert } from "../jobs/shiftAlert.js";

/* ---------------- helpers for time-window checks ---------------- */

const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;

function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m ?? 0);
}

// Read current global shift hours (exact, no margin).
// Returns { start, end, marginTime, alertTime, updatedAt } as strings/ints.
async function readGlobalShiftTime() {
  const { rows } = await pool.query(
    `SELECT
       start_local_time::text AS start_local_time,
       end_local_time::text   AS end_local_time,
       margintime,
       alerttime,
       updated_at
     FROM shift_hours
     WHERE id=1`
  );
  if (!rows.length) throw new Error("Shift hours not configured");

  const {
    start_local_time,
    end_local_time,
    margintime,
    alerttime,
    updated_at,
  } = rows[0];

  return {
    start: start_local_time,
    end: end_local_time,
    marginTime: Number(margintime),
    alertTime: Number(alerttime),
    updatedAt: updated_at,
  };
}

/* ---------------- routes ---------------- */

// GET /api/shifts — return current global shift config (exact times, plus margin/alert)
async function getShift(req, res) {
  try {
    const data = await readGlobalShiftTime();
    res.json(data);
  } catch (e) {
    if (e.message === "Shift hours not configured") {
      return res.status(404).json({ error: "Shift hours not configured" });
    }
    console.error(e);
    res.status(500).json({ error: "Failed to fetch shift hours" });
  }
}

// PUT /api/shifts — update global hours; also allow margin/alert minutes
async function updateShift(req, res) {
  const { start, end, marginTime, alertTime } = req.body || {};

  if (!timeRe.test(start) || !timeRe.test(end)) {
    return res
      .status(400)
      .json({ error: "Invalid time format. Use HH:mm or HH:mm:ss" });
  }

  try {
    // 1) Validate the new global window **against existing staff allocations** (still exact/no margin here)
    const gStartMin = toMinutes(start);
    const gEndMin = toMinutes(end);

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
        conflicts,
      });
    }

    // 2) Build dynamic update for margin/alert (optional)
    // If marginTime/alertTime are omitted, keep existing DB values.
    const updateSql = `
      INSERT INTO shift_hours (id, start_local_time, end_local_time, margintime, alerttime)
      VALUES (1, $1::time, $2::time,
              COALESCE($3, (SELECT margintime FROM shift_hours WHERE id=1)),
              COALESCE($4, (SELECT alerttime  FROM shift_hours WHERE id=1)))
      ON CONFLICT (id)
      DO UPDATE SET
        start_local_time = EXCLUDED.start_local_time,
        end_local_time   = EXCLUDED.end_local_time,
        margintime       = COALESCE(EXCLUDED.margintime, shift_hours.margintime),
        alerttime        = COALESCE(EXCLUDED.alerttime,  shift_hours.alerttime),
        updated_at       = NOW()
      RETURNING margintime, alerttime
    `;

    const { rows } = await pool.query(updateSql, [
      start,
      end,
      // pass integers or null
      Number.isInteger(marginTime) ? marginTime : null,
      Number.isInteger(alertTime) ? alertTime : null,
    ]);

    const effectiveMargin = Number(rows[0].margintime);

    // 3) Reschedule cron to end + margin
    // (Adjust your job signature as needed — passing minutes here)
    await rescheduleShiftLogout({ marginMinutes: effectiveMargin });
    await rescheduleShiftLogout();
    await rescheduleShiftAlert();
    
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update shift hours" });
  }
}

export { getShift, updateShift, readGlobalShiftTime };

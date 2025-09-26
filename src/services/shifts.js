// src/services/shifts.js
import { pool } from "../utils/db.js";
import { isStaffWindowInsideGlobal } from "../services/staff.js";
import { rescheduleShiftLogout } from "../jobs/shiftLogout.js";
import { rescheduleShiftAlert } from "../jobs/shiftAlert.js";

/* ---------------- helpers for time-window checks ---------------- */

const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;
const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

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

// If pg gives "{09:00,10:00,,,...}" as text, coerce to (string|null)[]
function coercePgTimeArray(val) {
  if (val == null) return null;
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const inner = val.replace(/^{|}$/g, "");
    if (inner.trim() === "") return [];
    return inner.split(",").map((s) => (s === "" ? null : s));
  }
  return null;
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
    // 1) Validate the new global window **against existing staff allocations (arrays)**
    const gStartMin = toMinutes(start);
    const gEndMin = toMinutes(end);

    const { rows: staffRows } = await pool.query(
      `SELECT
         s.id   AS staff_id,
         s.user_id,
         u.username,
         s.shift_start_local_time AS start_week,  -- time[] or null
         s.shift_end_local_time   AS end_week     -- time[] or null
       FROM staff s
       JOIN users u ON u.id = s.user_id
       WHERE s.shift_start_local_time IS NOT NULL
          OR s.shift_end_local_time   IS NOT NULL`
    );

    const conflicts = [];

    for (const r of staffRows) {
      const startWeek = coercePgTimeArray(r.start_week) || [];
      const endWeek = coercePgTimeArray(r.end_week) || [];

      // Normalize to 7 slots
      for (let i = 0; i < 7; i++) {
        const s = startWeek[i] ?? null;
        const e = endWeek[i] ?? null;

        // Only validate a day if both start & end exist (your rule: if one is set, other must be too)
        if (s != null && e != null) {
          const sMin = toMinutes(s);
          const eMin = toMinutes(e);

          // Staff shift must be a forward window (no wrap) by your invariant
          if (sMin >= eMin) {
            conflicts.push({
              staffId: r.staff_id,
              userId: r.user_id,
              username: r.username,
              dayIndex: i,
              day: DAY_NAMES[i],
              shiftStart: s,
              shiftEnd: e,
              reason: "invalid-staff-window",
            });
            continue;
          }

          const ok = isStaffWindowInsideGlobal(gStartMin, gEndMin, sMin, eMin);
          if (!ok) {
            conflicts.push({
              staffId: r.staff_id,
              userId: r.user_id,
              username: r.username,
              dayIndex: i,
              day: DAY_NAMES[i],
              shiftStart: s,
              shiftEnd: e,
              reason: "outside-new-global",
            });
          }
        } else if ((s == null) !== (e == null)) {
          // One side present, the other null → this staff record is already invalid per your new rules
          conflicts.push({
            staffId: r.staff_id,
            userId: r.user_id,
            username: r.username,
            dayIndex: i,
            day: DAY_NAMES[i],
            shiftStart: s,
            shiftEnd: e,
            reason: "unpaired-times",
          });
        }
      }
    }

    if (conflicts.length) {
      return res.status(400).json({
        error:
          "Proposed global shift conflicts with one or more staff daily windows. Fix staff shifts or widen the global window.",
        conflicts,
      });
    }

    // 2) Upsert new global + optional margin/alert
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
      RETURNING start_local_time::text AS start,
                end_local_time::text   AS end,
                margintime, alerttime, updated_at
    `;

    const { rows } = await pool.query(updateSql, [
      start,
      end,
      Number.isInteger(marginTime) ? marginTime : null,
      Number.isInteger(alertTime) ? alertTime : null,
    ]);

    const row = rows[0];
    const effectiveMargin = Number(row.margintime);

    // 3) Reschedule jobs (logout + alert) using the new settings
    await rescheduleShiftLogout({ marginMinutes: effectiveMargin });
    await rescheduleShiftLogout();
    await rescheduleShiftAlert();

    return res.json({ ok: true, updated: row });
  } catch (e) {
    console.error("updateShift failed:", e);
    return res.status(500).json({ error: "Failed to update shift hours" });
  }
}

export { getShift, updateShift, readGlobalShiftTime };

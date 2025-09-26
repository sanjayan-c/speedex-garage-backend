import { pool } from "../utils/db.js";
import {
  nowToronto,
  buildShiftWindowToronto,
  isInWindow,
} from "../utils/time.js";
import { isUserOnLeaveNow } from "./leave.js";
import {
  hasShiftEndedForToday,
  appendUntimeSessionForUser,
} from "./attendance.js";
import { DateTime } from "luxon";
import { v4 as uuidv4 } from "uuid";

// GET /api/untime  → ALL users on UnTime (active), approved or not
async function listUntimeUsers(req, res) {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        u.id          AS user_id,
        u.username,
        u.role,
        u.untime,
        u.untime_approved,
        u.created_at,
        s.id          AS staff_id,
        s.first_name,
        s.last_name,
        s.email
      FROM users u
      JOIN staff s ON s.user_id = u.id
      WHERE u.role = 'staff'
        AND u.untime IS NOT NULL
        AND COALESCE((u.untime->>'active')::boolean, false) = true
      ORDER BY
        (u.untime->>'startTime') DESC NULLS LAST,
        u.created_at DESC
      `
    );

    const items = rows.map((r) => {
      const untime = r.untime || null;

      const rawStart = untime?.startTime || untime?.starttime || null;
      let startTimeToronto = null;
      if (rawStart) {
        let dt = DateTime.fromISO(String(rawStart), { setZone: true });
        if (!dt.isValid)
          dt = DateTime.fromSQL(String(rawStart), { setZone: true });
        if (dt.isValid)
          startTimeToronto = dt.setZone("America/Toronto").toISO();
      }

      return {
        userId: r.user_id,
        staffId: r.staff_id,
        username: r.username,
        role: r.role,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        untimeApproved: r.untime_approved,
        untime: { ...untime, startTimeToronto }, // Toronto-only time
        createdAtToronto: DateTime.fromJSDate(r.created_at)
          .setZone("America/Toronto")
          .toISO(),
      };
    });

    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to list UnTime users" });
  }
}

// GET /api/untime/pending  → ONLY pending (active=true, untime_approved=false)
async function listPendingUntime(req, res) {
  try {
    const { rows } = await pool.query(`
      SELECT id, username, role, is_login, untime, untime_approved, created_at
      FROM users
      WHERE role = 'staff'
        AND untime IS NOT NULL
        AND COALESCE((untime->>'active')::boolean, false) = true
        AND untime_approved = false
      ORDER BY created_at DESC
    `);

    const items = rows.map((r) => {
      const untime = r.untime || null;

      const rawStart = untime?.startTime || untime?.starttime || null;
      let startTimeToronto = null;
      if (rawStart) {
        let dt = DateTime.fromISO(String(rawStart), { setZone: true });
        if (!dt.isValid)
          dt = DateTime.fromSQL(String(rawStart), { setZone: true });
        if (dt.isValid)
          startTimeToronto = dt.setZone("America/Toronto").toISO();
      }

      return {
        id: r.id,
        username: r.username,
        role: r.role,
        is_login: r.is_login,
        untime_approved: r.untime_approved,
        untime: { ...untime, startTimeToronto }, // Toronto-only time
        createdAtToronto: DateTime.fromJSDate(r.created_at)
          .setZone("America/Toronto")
          .toISO(),
      };
    });

    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch pending UnTime items" });
  }
}

// POST /api/untime/duration  { userId? , staffId?, durationMinutes }
async function updateUntimeDurationForStaff(req, res) {
  let { userId, staffId, durationMinutes } = req.body || {};
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    return res
      .status(400)
      .json({ error: "durationMinutes must be a positive integer" });
  }

  try {
    // Resolve users.id if staffId is provided
    if (!userId && staffId) {
      const r = await pool.query(
        `SELECT u.id AS user_id
           FROM staff s
           JOIN users u ON u.id = s.user_id
          WHERE s.id = $1`,
        [staffId]
      );
      if (!r.rowCount) {
        return res.status(404).json({ error: "staffId not found" });
      }
      userId = r.rows[0].user_id;
    }

    if (!userId) {
      return res.status(400).json({ error: "userId or staffId is required" });
    }

    // Load current state to validate monotonic increase
    const q = await pool.query(
      `SELECT
         id,
         role,
         untime,
         COALESCE((untime->>'durationMinutes')::int, 0) AS current_duration,
         COALESCE((untime->>'active')::boolean, false)     AS active
       FROM users
       WHERE id = $1`,
      [userId]
    );
    if (!q.rowCount || q.rows[0].role !== "staff") {
      return res.status(404).json({ error: "Staff user not found" });
    }

    const row = q.rows[0];
    if (!row.active || row.untime == null) {
      return res
        .status(404)
        .json({ error: "No active UnTime found for that staff user" });
    }

    const current = Number(row.current_duration) || 0;
    const next = Number(durationMinutes);

    if (!(next > current)) {
      return res.status(400).json({
        error: "New duration must be greater than current duration",
        currentDuration: current,
        requestedDuration: next,
      });
    }

    // Update: set new duration and auto-approve
    const { rowCount } = await pool.query(
      `UPDATE users
         SET untime = jsonb_set(untime, '{durationMinutes}', to_jsonb($1::int), true),
             untime_approved = true
       WHERE id = $2
         AND role = 'staff'
         AND untime IS NOT NULL
         AND COALESCE((untime->>'active')::boolean, false) = true`,
      [next, userId]
    );

    if (!rowCount) {
      // Defensive: if the state changed between SELECT and UPDATE
      return res
        .status(409)
        .json({ error: "UnTime state changed; please retry" });
    }

    return res.json({
      ok: true,
      approved: true,
      previousDuration: current,
      newDuration: next,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Failed to update UnTime duration" });
  }
}

// PATCH /api/untime/status
async function setUntimeStatusForUser(req, res) {
  const { status, userId: bodyUserId, staffId } = req.body || {};
  if (!["approved", "rejected"].includes(status)) {
    return res
      .status(400)
      .json({ error: "status must be 'approved' or 'rejected'" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Resolve userId (possibly from staffId)
    let userId = bodyUserId || null;
    if (!userId && staffId) {
      const r = await client.query(
        `SELECT u.id AS user_id
           FROM staff s
           JOIN users u ON u.id = s.user_id
          WHERE s.id = $1`,
        [staffId]
      );
      if (!r.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "staffId not found" });
      }
      userId = r.rows[0].user_id;
    }
    if (!userId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "userId or staffId is required" });
    }

    const q = await client.query(
      `SELECT id, role, untime FROM users WHERE id=$1 AND role='staff' FOR UPDATE`,
      [userId]
    );
    if (!q.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Staff user not found" });
    }
    const currentUnTime = q.rows[0].untime; // capture before changes

    if (status === "approved") {
      await client.query(
        `UPDATE users SET untime_approved = true, allowed = true WHERE id = $1`,
        [userId]
      );
      await client.query("COMMIT");
      return res.json({ ok: true, userId, status: "approved" });
    }

    // status === 'rejected' → record UnTime window (if exists), then clear + block + disallow
    if (currentUnTime && currentUnTime.active === true) {
      // commit the session into attendance
      await appendUntimeSessionForUser(userId, currentUnTime);
    }

    await client.query(
      `UPDATE users
          SET untime          = NULL,
              untime_approved = false,
              is_blocked      = true,
              allowed         = false
        WHERE id = $1`,
      [userId]
    );

    await client.query("COMMIT");
    return res.json({
      ok: true,
      userId,
      status: "rejected",
      untimeCleared: true,
      blocked: true,
      allowed: false,
    });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("setUntimeStatusForUser failed:", e);
    res.status(500).json({ error: "Failed to update UnTime status" });
  } finally {
    client.release();
  }
}

// PATCH /api/untime/status/bulk-working
async function setUntimeStatusForAllWorkingNow(req, res) {
  const { status } = req.body || {};
  if (!["approved", "rejected"].includes(status)) {
    return res
      .status(400)
      .json({ error: "status must be 'approved' or 'rejected'" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: users } = await client.query(
      `SELECT u.id AS user_id, u.untime
         FROM users u
        WHERE u.role = 'staff'
          AND u.untime IS NOT NULL
          AND COALESCE((u.untime->>'active')::boolean, false) = true
        FOR UPDATE`
    );

    if (!users.length) {
      await client.query("ROLLBACK");
      return res.json({ ok: true, status, changed: 0, items: [] });
    }

    const ids = users.map((u) => u.user_id);

    if (status === "approved") {
      await client.query(
        `UPDATE users
            SET untime_approved = true, allowed = true
          WHERE id = ANY($1::uuid[])`,
        [ids]
      );
      await client.query("COMMIT");
      return res.json({
        ok: true,
        status,
        changed: ids.length,
        items: users.map((u) => u.user_id),
      });
    }

    // rejected → first append sessions, then clear + block + disallow
    for (const u of users) {
      if (u.untime && u.untime.active === true) {
        await appendUntimeSessionForUser(u.user_id, u.untime);
      }
    }

    await client.query(
      `UPDATE users
          SET untime          = NULL,
              untime_approved = false,
              is_blocked      = true,
              allowed         = false
        WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    await client.query("COMMIT");
    return res.json({ ok: true, status, changed: ids.length, items: ids });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("setUntimeStatusForAllWorkingNow failed:", e);
    res.status(500).json({ error: "Failed to bulk update UnTime status" });
  } finally {
    client.release();
  }
}

// POST /api/untime/end-self  (staff only)
async function endMyUntimeNow(req, res) {
  try {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Load current UnTime state
    const { rows, rowCount } = await pool.query(
      `SELECT id, role, untime
         FROM users
        WHERE id = $1 AND role = 'staff'`,
      [userId]
    );
    if (!rowCount)
      return res.status(404).json({ error: "Staff user not found" });

    const urow = rows[0];
    const u = urow.untime;
    if (!u || u.active !== true || !u.startTime) {
      return res.status(400).json({ error: "No active UnTime to end" });
    }

    // 1) Persist the session to attendance (uses now as end)
    await appendUntimeSessionForUser(userId, {
      startTime: u.startTime,
      reason: u.reason ?? null,
      // durationMinutes intentionally omitted: append* uses "now" for end
    });

    // 2) Clear UnTime, disallow, and unapprove
    await pool.query(
      `UPDATE users
          SET untime = NULL,
              untime_approved = false,
              allowed = false
        WHERE id = $1`,
      [userId]
    );

    // Optional: return a friendly payload with the resolved end time
    const endNow = DateTime.now().toISO();
    return res.json({
      ok: true,
      message: "UnTime ended and recorded",
      session: {
        start: u.startTime,
        end: endNow,
        reason: u.reason ?? null,
      },
    });
  } catch (e) {
    console.error("endMyUntimeNow failed:", e);
    return res.status(500).json({ error: "Failed to end UnTime" });
  }
}

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

async function getEffectiveShiftForUser(userId) {
  // Read global (still used for margins if you want, but NOT for fallback)
  const { rows: gRows } = await pool.query(
    `SELECT
       start_local_time::text AS g_start,
       end_local_time::text   AS g_end,
       COALESCE(margintime, 30) AS margin_minutes,
       COALESCE(alerttime, 10)  AS alert_minutes
     FROM shift_hours
     WHERE id=1`
  );

  const globalCfg = gRows.length
    ? {
        start_local_time: gRows[0].g_start,
        end_local_time: gRows[0].g_end,
        margin_minutes: Number(gRows[0].margin_minutes) || 30,
        alert_minutes: Number(gRows[0].alert_minutes) || 10,
      }
    : null;

  // Per-staff weekly arrays (NO ::text)
  const { rows: sRows } = await pool.query(
    `SELECT
       shift_start_local_time AS week_start,
       shift_end_local_time   AS week_end
     FROM staff
     WHERE user_id=$1`,
    [userId]
  );

  if (sRows.length) {
    const weekStart = coercePgTimeArray(sRows[0].week_start) || [];
    const weekEnd = coercePgTimeArray(sRows[0].week_end) || [];

    const toronto = DateTime.now().setZone("America/Toronto");
    const idx = toronto.weekday - 1; // 0..6 Mon..Sun

    const todaysStart = weekStart[idx] ?? null;
    const todaysEnd = weekEnd[idx] ?? null;

    // If both present, use per-day; OTHERWISE return null (no fallback!)
    if (todaysStart && todaysEnd) {
      return {
        start_local_time: todaysStart,
        end_local_time: todaysEnd,
        // keep margins from global config if you want; fallback constants otherwise
        margin_minutes: globalCfg ? globalCfg.margin_minutes : 30,
        alert_minutes: globalCfg ? globalCfg.alert_minutes : 10,
      };
    }
    return null; // ← day off / undefined shift => NO fallback to global
  }

  return null; // no staff row => no shift
}

// Enforce shift/leave rules for staff and mark UnTime if outside
async function enforceStaffUntimeWindow(userId, username, role) {
  if (role !== "staff") return { skipped: true };

  // tiny inline guard: only called when we are about to update UnTime
  async function ensureNotBlocked() {
    const { rows } = await pool.query(
      "SELECT is_blocked FROM users WHERE id = $1",
      [userId]
    );
    return rows.length && rows[0].is_blocked === true;
  }

  // A) ended today?
  const endStatus = await hasShiftEndedForToday(userId);
  if (endStatus.ended) {
    if (await ensureNotBlocked()) {
      return { skipped: true, blocked: true, reason: "user-blocked" };
    }

    const nowIso = nowToronto().toISO();

    await pool.query(
      `UPDATE users
         SET untime = jsonb_set(
                        jsonb_set(
                          jsonb_set(COALESCE(untime,'{}'::jsonb), '{active}', 'true'::jsonb, true),
                          '{reason}', to_jsonb('ended'::text), true
                        ),
                        '{startTime}', to_jsonb($1::timestamptz::text), true
                      ),
             untime_approved = false,
             allowed = true
       WHERE id = $2`,
      [nowIso, userId]
    );
    await pool.query(
      `UPDATE users
         SET untime = jsonb_set(untime, '{durationMinutes}', to_jsonb(10::int), true)
       WHERE id = $1`,
      [userId]
    );
    const {
      rows: [u],
    } = await pool.query(
      "SELECT untime, untime_approved FROM users WHERE id=$1",
      [userId]
    );
    return {
      skipped: false,
      ended: true,
      reason: "ended",
      nowTorontoISO: nowIso,
      untimeActive: u.untime?.active === true,
      untimeApproved: u.untime_approved,
    };
  }

  // B) on leave?
  const leaveStatus = await isUserOnLeaveNow(userId);
  if (leaveStatus.onLeave) {
    if (await ensureNotBlocked()) {
      return { skipped: true, blocked: true, reason: "user-blocked" };
    }

    const nowIso = nowToronto().toISO();

    await pool.query(
      `UPDATE users
         SET untime = jsonb_set(
                        jsonb_set(
                          jsonb_set(COALESCE(untime,'{}'::jsonb), '{active}', 'true'::jsonb, true),
                          '{reason}', to_jsonb('leave'::text), true
                        ),
                        '{startTime}', to_jsonb($1::timestamptz::text), true
                      ),
             untime_approved = false,
             allowed = true
       WHERE id = $2`,
      [nowIso, userId]
    );
    await pool.query(
      `UPDATE users
         SET untime = jsonb_set(untime, '{durationMinutes}', to_jsonb(10::int), true)
       WHERE id = $1`,
      [userId]
    );
    const {
      rows: [u],
    } = await pool.query(
      "SELECT untime, untime_approved FROM users WHERE id=$1",
      [userId]
    );
    return {
      skipped: false,
      reason: "on-leave",
      nowTorontoISO: nowIso,
      leave: leaveStatus.leave,
      untimeActive: u.untime?.active === true,
      untimeApproved: u.untime_approved,
    };
  }

  // C) outside shift window?
  const shift = await getEffectiveShiftForUser(userId);
  if (!shift || !shift.start_local_time || !shift.end_local_time) {
    // Treat as outside window (and record UnTime) when there is no per-day shift
    if (await ensureNotBlocked()) {
      return { skipped: true, blocked: true, reason: "user-blocked" };
    }
    const nowIso = nowToronto().toISO();
    await pool.query(
      `UPDATE users
       SET untime = jsonb_set(
                      jsonb_set(
                        jsonb_set(COALESCE(untime,'{}'::jsonb), '{active}', 'true'::jsonb, true),
                        '{reason}', to_jsonb('outside-window'::text), true
                      ),
                      '{startTime}', to_jsonb($1::timestamptz::text), true
                    ),
           untime_approved = false,
           allowed = true
     WHERE id = $2`,
      [nowIso, userId]
    );
    await pool.query(
      `UPDATE users
       SET untime = jsonb_set(untime, '{durationMinutes}', to_jsonb(10::int), true)
     WHERE id = $1`,
      [userId]
    );
    return {
      outside: true,
      reason: "outside-window",
      nowTorontoISO: nowIso,
      // no windowStart/End because there is no shift today
      untimeActive: true,
      untimeApproved: false,
    };
  }

  const margin = Number(shift.margin_minutes) || 30; // from DB
  const { windowStart, windowEnd } = buildShiftWindowToronto(shift, {
    marginMinutes: margin,
  });

  const nowTor = nowToronto();
  const outside = !isInWindow(nowTor, windowStart, windowEnd);

  if (outside) {
    if (await ensureNotBlocked()) {
      return { skipped: true, blocked: true, reason: "user-blocked" };
    }

    const nowIso = nowTor.toISO();
    await pool.query(
      `UPDATE users
         SET untime = jsonb_set(
                        jsonb_set(
                          jsonb_set(COALESCE(untime,'{}'::jsonb), '{active}', 'true'::jsonb, true),
                          '{reason}', to_jsonb('outside-window'::text), true
                        ),
                        '{startTime}', to_jsonb($1::timestamptz::text), true
                      ),
             untime_approved = false,
             allowed = true
       WHERE id = $2`,
      [nowIso, userId]
    );
    await pool.query(
      `UPDATE users
         SET untime = jsonb_set(untime, '{durationMinutes}', to_jsonb(10::int), true)
       WHERE id = $1`,
      [userId]
    );
    const {
      rows: [u],
    } = await pool.query(
      "SELECT untime, untime_approved FROM users WHERE id=$1",
      [userId]
    );
    return {
      outside: true,
      reason: "outside-window",
      nowTorontoISO: nowIso,
      windowStartISO: windowStart.toISO(),
      windowEndISO: windowEnd.toISO(),
      untimeActive: u.untime?.active === true,
      untimeApproved: u.untime_approved,
    };
  }

  // Get current untime (if any) so we can persist the session
  const { rows: beforeRows } = await pool.query(
    `SELECT untime FROM users WHERE id = $1`,
    [userId]
  );
  const existing = beforeRows.length ? beforeRows[0].untime : null;

  if (existing && existing.active === true) {
    await appendUntimeSessionForUser(userId, existing);
  }

  // Inside window → clear untime and set allowed=false
  await pool.query(
    `UPDATE users
        SET untime = NULL,
            untime_approved = false,
            allowed = false
      WHERE id = $1`,
    [userId]
  );
  return {
    outside: false,
    nowTorontoISO: nowTor.toISO(),
    windowStartISO: windowStart.toISO(),
    windowEndISO: windowEnd.toISO(),
  };
}

// POST /api/untime/extend  { minutes: 1..60 }
async function extendUnTimeForSelf(req, res) {
  try {
    let { minutes } = req.body || {};
    minutes = Number(minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      return res
        .status(400)
        .json({ error: "minutes must be an integer between 1 and 60" });
    }

    const userId = req.user.sub; // from JWT
    // find staff id for this user
    const { rows: sRows } = await pool.query(
      "SELECT id FROM staff WHERE user_id=$1",
      [userId]
    );
    if (!sRows.length)
      return res.status(404).json({ error: "Staff record not found" });
    const staffId = sRows[0].id;

    const torNow = DateTime.now().setZone("America/Toronto");
    const today = torNow.toISODate();
    const nowTs = torNow.toJSDate(); // DB timestamptz

    // ensure attendance row exists
    await pool.query(
      `INSERT INTO attendance_records (id, staff_id, attendance_date)
       VALUES ($1,$2,$3)
       ON CONFLICT (staff_id, attendance_date) DO NOTHING`,
      [uuidv4(), staffId, today]
    );

    // fetch it
    const {
      rows: [rec],
    } = await pool.query(
      "SELECT * FROM attendance_records WHERE staff_id=$1 AND attendance_date=$2",
      [staffId, today]
    );

    // mark OUT now if not already out
    if (!rec.time_out) {
      // (if no time_in, we still allow OUT to create a closed session)
      await pool.query(
        "UPDATE attendance_records SET time_out=$1 WHERE staff_id=$2 AND attendance_date=$3",
        [nowTs, staffId, today]
      );
    }

    // set UnTime JSON (start now, for 'minutes')
    // Keep same flags you already use elsewhere: active=true, approved=false, allowed=true
    await pool.query(
      `UPDATE users
         SET untime = jsonb_set(
                        jsonb_set(
                          jsonb_set(COALESCE(untime,'{}'::jsonb), '{active}', 'true'::jsonb, true),
                          '{reason}', to_jsonb('manual-extend'::text), true
                        ),
                        '{startTime}', to_jsonb($1::timestamptz::text), true
                      ),
             untime_approved = false,
             allowed = true
       WHERE id = $2`,
      [nowTs, userId]
    );

    // set the duration (minutes)
    await pool.query(
      `UPDATE users
         SET untime = jsonb_set(untime, '{durationMinutes}', to_jsonb($2::int), true)
       WHERE id = $1`,
      [userId, minutes]
    );

    // return a summary
    const {
      rows: [u],
    } = await pool.query(
      "SELECT id, username, untime, untime_approved, allowed FROM users WHERE id=$1",
      [userId]
    );

    return res.json({
      ok: true,
      outAt: nowTs,
      durationMinutes: minutes,
      untime: u.untime,
      untimeApproved: u.untime_approved,
      allowed: u.allowed,
    });
  } catch (err) {
    console.error("[untime.extend] failed:", err);
    res.status(500).json({ error: "Failed to extend UnTime" });
  }
}

export {
  listPendingUntime,
  listUntimeUsers,
  updateUntimeDurationForStaff,
  setUntimeStatusForUser,
  setUntimeStatusForAllWorkingNow,
  endMyUntimeNow,
  getEffectiveShiftForUser,
  enforceStaffUntimeWindow,
  extendUnTimeForSelf,
};

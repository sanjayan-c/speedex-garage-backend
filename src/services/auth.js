// src/services/auth.js
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { pool } from "../utils/db.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt.js";
import { enforceStaffUntimeWindow } from "../services/untime.js";
import { assertStaffShiftWithinGlobal } from "../services/staff.js";

const COOKIE_NAME = process.env.COOKIE_NAME || "rt";
const COOKIE_PATH = process.env.COOKIE_PATH || "/api/auth";

function setRefreshCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: COOKIE_PATH,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// POST /api/auth/register
async function register(req, res) {
  const { username, password, role, isLogin, untime, createdBy } = req.body;

  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE username=$1",
      [username]
    );
    if (existing.rowCount)
      return res.status(409).json({ error: "Username already exists" });

    const passwordHash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    await pool.query(
      `INSERT INTO users
        (id, username, password_hash, role, is_login, untime, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        username,
        passwordHash,
        role,
        isLogin ?? false,
        untime ? JSON.stringify(untime) : null,
        createdBy || null,
      ]
    );

    res.status(201).json({ id, username, role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to register" });
  }
}

// POST /api/auth/login
async function login(req, res) {
  const { username, password } = req.body;
  try {
    const { rows } = await pool.query(
      "SELECT id, username, password_hash, role FROM users WHERE username=$1",
      [username]
    );
    if (!rows.length)
      return res.status(401).json({ error: "Invalid credentials" });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    // --- Staff untime enforcement (uses staff’s allocated shift, else global) ---
    // try {
    //   const diag = await enforceStaffUntimeWindow(
    //     user.id,
    //     user.username,
    //     user.role
    //   );
    //   if (diag && !diag.skipped) {
    //     console.log("Current Toronto time:", diag.nowTorontoISO);
    //     if (diag.windowStartISO && diag.windowEndISO) {
    //       console.log(
    //         "Allowed window:",
    //         diag.windowStartISO,
    //         "→",
    //         diag.windowEndISO
    //       );
    //     }
    //     if (diag.reason) {
    //       console.log("Untime reason:", diag.reason);
    //     }
    //     if (diag.ended) {
    //       console.warn("Already shift ended for the day");
    //     }
    //   }
    // } catch (e) {
    //   console.error("Untime enforcement failed:", e);
    //   // Non-fatal; continue login
    // }

    // --- Issue tokens & mark logged in ---
    const accessToken = signAccessToken({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    const refreshToken = signRefreshToken({
      sub: user.id,
      username: user.username,
      role: user.role,
    });

    const bcryptHash = await bcrypt.hash(refreshToken, 12);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)",
      [user.id, bcryptHash, expiresAt.toISOString()]
    );
    await pool.query("UPDATE users SET is_login=true WHERE id=$1", [user.id]);

    setRefreshCookie(res, refreshToken);
    res.json({
      accessToken,
      user: { id: user.id, username: user.username, role: user.role },
      // no untime details returned here because we only set {active:true}
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
}

// POST /api/auth/refresh
async function refresh(req, res) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Missing refresh token" });

  try {
    const payload = verifyRefreshToken(token);

    const { rows } = await pool.query(
      "SELECT id, token_hash FROM refresh_tokens WHERE user_id=$1 AND revoked=false AND expires_at > NOW()",
      [payload.sub]
    );
    if (!rows.length)
      return res
        .status(401)
        .json({ error: "Refresh token not found or expired" });

    let matchedId = null;
    for (const row of rows) {
      if (await bcrypt.compare(token, row.token_hash)) {
        matchedId = row.id;
        break;
      }
    }
    if (!matchedId)
      return res.status(401).json({ error: "Refresh token invalid" });

    await pool.query("UPDATE refresh_tokens SET revoked=true WHERE id=$1", [
      matchedId,
    ]);

    const newAccess = signAccessToken({
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
    });
    const newRefresh = signRefreshToken({
      sub: payload.sub,
      username: payload.username,
      role: payload.role,
    });
    const newHash = await bcrypt.hash(newRefresh, 12);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)",
      [payload.sub, newHash, expiresAt.toISOString()]
    );

    setRefreshCookie(res, newRefresh);
    res.json({ accessToken: newAccess });
  } catch (err) {
    console.error(err);
    res.status(401).json({ error: "Invalid/expired refresh token" });
  }
}

// POST /api/auth/logout
async function logout(req, res) {
  const token = req.cookies[COOKIE_NAME];
  if (token) {
    try {
      const payload = verifyRefreshToken(token); // { sub, ... }
      // revoke only this user's refresh tokens
      await pool.query(
        "UPDATE refresh_tokens SET revoked=true WHERE user_id=$1",
        [payload.sub]
      );
      // mark the user as logged out
      await pool.query("UPDATE users SET is_login=false WHERE id=$1", [
        payload.sub,
      ]);
      // mark untime as null
      await pool.query(
        "UPDATE users SET untime=NULL, untime_approved=false WHERE id=$1",
        [payload.sub]
      );
    } catch (e) {
      // ignore parse errors on logout
    }
  }
  // clear the cookie either way
  res.clearCookie(COOKIE_NAME, { path: COOKIE_PATH });
  res.json({ ok: true });
}

// POST /api/auth/force-logout (Admin Only)
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

// POST /api/auth/force-logout-staff (Admin Only)
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

// POST /api/auth/register-staff (Admin Only)
async function registerStaffAdmin(req, res) {
  const {
    username,
    password,
    isLogin,
    untime,
    createdBy,
    firstName,
    lastName,
    email,
    contactNo,
    emergencyContactNo,
    shiftStart,
    shiftEnd,

    // NEW:
    birthday,
    joiningDate,
    leaveTaken,
    totalLeaves,
    position,
    managerId,
    jobFamily,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query("SELECT 1 FROM users WHERE username=$1", [username]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Username already exists" });
    }

    await assertStaffShiftWithinGlobal(shiftStart, shiftEnd);

    if (managerId) {
      const r = await client.query("SELECT 1 FROM staff WHERE id=$1", [managerId]);
      if (!r.rowCount) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "managerId must be an existing staff id" });
      }
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO users
        (id, username, password_hash, role, is_login, untime, created_by)
       VALUES ($1,$2,$3,'staff',$4,$5,$6)`,
      [
        userId,
        username,
        passwordHash,
        isLogin ?? false,
        untime ? JSON.stringify(untime) : null,
        createdBy || null,
      ]
    );

    const staffId = uuidv4();
    const { rows } = await client.query(
      `INSERT INTO staff (
         id, user_id, first_name, last_name, email, contact_no, emergency_contact_no,
         shift_start_local_time, shift_end_local_time,
         birthday, joining_date, leave_taken, total_leaves, position, manager_id, job_family
       )
       VALUES (
         $1,$2,$3,$4,$5,$6,$7,
         $8::time,$9::time,
         $10::date,$11::date,$12,$13,$14,$15,$16
       )
       RETURNING employee_id, birthday, joining_date, leave_taken, total_leaves, position, manager_id, job_family`,
      [
        staffId,
        userId,
        firstName,
        lastName,
        email,
        contactNo,
        emergencyContactNo,
        shiftStart,
        shiftEnd,
        birthday ?? null,
        joiningDate ?? null,
        leaveTaken ?? 0,
        totalLeaves ?? 0,
        position ?? null,
        managerId ?? null,
        jobFamily ?? null,
      ]
    );

    await client.query("COMMIT");

    const ret = rows[0];
    return res.status(201).json({
      user: { id: userId, username, role: "staff" },
      staff: {
        id: staffId,
        userId,
        employeeId: ret.employee_id,
        firstName,
        lastName,
        email,
        contactNo,
        emergencyContactNo,
        shiftStart,
        shiftEnd,
        birthday: ret.birthday,
        joiningDate: ret.joining_date,
        leaveTaken: ret.leave_taken,
        totalLeaves: ret.total_leaves,
        position: ret.position,
        managerId: ret.manager_id,
        jobFamily: ret.job_family,
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(409).json({ error: "Duplicate value" });
    }
    console.error("registerStaffAdmin failed:", err);
    return res.status(500).json({ error: "Failed to register staff" });
  } finally {
    client.release();
  }
}

// PATCH /api/users/:id/block  Body: { blocked: true|false }
async function setUserBlockedStatus(req, res) {
  const { id } = req.params;
  const { blocked } = req.body || {};

  if (typeof blocked !== "boolean") {
    return res.status(400).json({ error: "blocked must be a boolean" });
  }

  try {
    const { rowCount, rows } = await pool.query(
      `UPDATE users
          SET is_blocked = $2
        WHERE id = $1
      RETURNING id, username, role, is_blocked`,
      [id, blocked]
    );
    if (!rowCount) return res.status(404).json({ error: "User not found" });

    return res.json({
      ok: true,
      user: rows[0],
      message: blocked ? "User blocked" : "User unblocked",
    });
  } catch (e) {
    console.error("setUserBlockedStatus failed:", e);
    res.status(500).json({ error: "Failed to update blocked status" });
  }
}


export { register, login, refresh, logout, logoutAllUsers, logoutAllStaff, registerStaffAdmin, setUserBlockedStatus };

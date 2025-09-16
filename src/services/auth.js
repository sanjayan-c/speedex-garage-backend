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

const COOKIE_NAME = process.env.COOKIE_NAME || "rt";

function setRefreshCookie(res, token) {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/api/auth/refresh",
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
    try {
      const diag = await enforceStaffUntimeWindow(
        user.id,
        user.username,
        user.role
      );
      if (diag && !diag.skipped) {
        console.log("Current Toronto time:", diag.nowTorontoISO);
        if (diag.windowStartISO && diag.windowEndISO) {
          console.log(
            "Allowed window:",
            diag.windowStartISO,
            "→",
            diag.windowEndISO
          );
        }
        if (diag.reason) {
          console.log("Untime reason:", diag.reason);
        }
        if (diag.ended) {
          console.warn("Already shift ended for the day");
        }
      }
    } catch (e) {
      console.error("Untime enforcement failed:", e);
      // Non-fatal; continue login
    }

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
  res.clearCookie(COOKIE_NAME, { path: "/api/auth/refresh" });
  res.json({ ok: true });
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

export { register, login, refresh, logout, logoutAllUsers, logoutAllStaff };

// src/middleware/auth.js
import jwt from "jsonwebtoken";
import { pool } from "../utils/db.js";

const ACCESS_TOKEN_COOKIE = process.env.COOKIE_NAME || "rt";

export function auth(required = true) {
  return (req, res, next) => {
    const authHeader = req.headers["authorization"];
    let token = authHeader && authHeader.split(" ")[1];

    if (!token && req.cookies) {
      token = req.cookies[ACCESS_TOKEN_COOKIE];
    }

    if (!token) {
      if (required) return res.status(401).json({ error: "Missing access token" });
      return next();
    }

    jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, user) => {
      if (err) return res.status(401).json({ error: "Invalid or expired token" });
      req.user = user;
      next();
    });
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden - role not allowed" });
    }
    next();
  };
}

export function requirePermission(permissionName) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    try {
      const { rows } = await pool.query(
        `SELECT 1
         FROM user_permissions up
         JOIN permissions p ON up.permission_id = p.id
         WHERE up.user_id = $1 AND p.name = $2`,
        [req.user.sub, permissionName]
      );

      if (!rows.length) {
        return res.status(403).json({ error: "Forbidden - permission denied" });
      }

      next();
    } catch (err) {
      console.error("Permission check failed", err);
      res.status(500).json({ error: "Permission check failed" });
    }
  };
}

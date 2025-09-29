// src/middleware/audit.js
import onFinished from "on-finished";
import logger, { auditMessage } from "../utils/logger.js";
import { pool } from "../utils/db.js";

const SENSITIVE_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/register-staff",
  "/api/auth/refresh",
  "/api/auth/reset-password",
]);

async function resolveIdentity(req) {
  // Support tokens that use either `id` or `sub`
  let userId = req.user?.id || req.user?.sub || null;
  let username = req.user?.username || null;

  try {
    if (!username && userId) {
      const { rows } = await pool.query(
        "SELECT username FROM users WHERE id = $1",
        [userId]
      );
      if (rows[0]?.username) username = rows[0].username;
    }
  } catch (_) { /* best-effort */ }

  return { userId, username };
}

export function auditMiddleware() {
  return function audit(req, res, next) {
    const start = process.hrtime.bigint();

    onFinished(res, async () => {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1e6;

      const { userId, username } = await resolveIdentity(req);

      const shouldOmitBody = SENSITIVE_PATHS.has(req.path);
      const meta = {
        query: req.query,
        body:
          !shouldOmitBody &&
          req.method !== "GET" &&
          req.body &&
          Object.keys(req.body).length
            ? req.body
            : undefined,
      };

      const msg = auditMessage({
        userId,
        username,
        ip: req.ip,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        action: "request",
        meta,
      });

      logger.info(msg);
    });

    next();
  };
}

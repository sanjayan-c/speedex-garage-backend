// src/utils/logger.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logsDir = path.resolve(__dirname, "../../logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const redact = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  const clone = JSON.parse(JSON.stringify(obj));
  const SENSITIVE = ["password","pwd","token","authorization","auth","accessToken","refreshToken"];
  const walk = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (SENSITIVE.includes(k.toLowerCase())) o[k] = "***redacted***";
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(clone);
  return clone;
};

const line = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level.toUpperCase()} ${message}`;
});

const baseFormat = winston.format.combine(winston.format.timestamp(), line);

const logger = winston.createLogger({
  level: "info",
  format: baseFormat,
  transports: [
    new DailyRotateFile({
      filename: path.join(logsDir, "app-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxFiles: "14d",
    }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), baseFormat),
    }),
  ],
});

export function auditMessage({
  userId,
  username,
  ip,
  method,
  path: urlPath,
  status,
  durationMs,
  action,
  meta = {},
}) {
  const compactMeta = JSON.stringify(redact(meta));
  return [
    userId ? `userId=${userId}` : "userId=-",
    username ? `username=${JSON.stringify(username)}` : "username=-",
    ip ? `ip=${ip}` : "ip=-",
    method ? `method=${method}` : "method=-",
    urlPath ? `path=${urlPath}` : "path=-",
    status != null ? `status=${status}` : "status=-",
    durationMs != null ? `durationMs=${durationMs}` : "durationMs=-",
    action ? `action=${action}` : "action=request",
    `meta=${compactMeta}`,
  ].join(" ");
}

// For manual domain events
export function logAudit(action, req, meta = {}) {
  const msg = auditMessage({
    action,
    userId: req.user?.id ?? req.user?.sub,
    username: req.user?.username,
    ip: req.ip,
    method: req.method,
    path: req.originalUrl,
    status: undefined,
    durationMs: undefined,
    meta,
  });
  logger.info(msg);
}

export default logger;

import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import createError from "http-errors";
import bodyParser from "body-parser";
import { auditMiddleware } from "./middleware/audit.js";
import { auth } from "./middleware/auth.js";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import staffRoutes from "./routes/staff.js";
import shiftRoutes from "./routes/shifts.js";
import untimeRoutes from "./routes/untime.js";
import attendanceRoutes from "./routes/attendance.js";
import leave from "./routes/leave.js";
import { startQrRotateJob } from "./jobs/qrRotateJob.js";
import permissionsRouter from "./routes/permissions.js";
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:5173"],
  credentials: true,
};
app.use(cors(corsOptions));


// If you keep a global auth, it can stay here
app.use(auth(false)); // optional/soft; your routers still do auth(true) where needed
app.use(auditMiddleware());

// BEFORE other routes/middleware use
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
});

// Bypass rate limiter for socket.io transport requests
app.use((req, res, next) => {
  if (req.path.startsWith("/api/socket.io")) return next();
  return limiter(req, res, next);
});

startQrRotateJob(
  process.env.QR_TTL_MINUTES ? Number(process.env.QR_TTL_MINUTES) : 3
);

app.get("/", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/untime", untimeRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/leave", leave);
app.use("/api/permissions", permissionsRouter);

// 404
app.use((req, res, next) => next(createError(404, "Not Found")));

// error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || "Internal Server Error";
  if (process.env.NODE_ENV !== "production") {
    console.error(err);
  }
  res.status(status).json({ error: message });
});

export default app;

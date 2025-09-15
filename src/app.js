import express from "express";
import morgan from "morgan";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import createError from "http-errors";

import authRoutes from "./routes/auth.js";
import userRoutes from "./routes/users.js";
import staffRoutes from "./routes/staff.js";
import shiftRoutes from "./routes/shifts.js";
import attendanceRoutes from "./routes/attendance.js";
import { startQrRotateJob } from "./jobs/qrRotateJob.js";


const app = express();

app.use(helmet());
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:5173"],
  credentials: true,
};
app.use(cors(corsOptions));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
});
app.use(limiter);

startQrRotateJob(process.env.QR_TTL_MINUTES ? Number(process.env.QR_TTL_MINUTES) : 3);

app.get("/", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/attendance", attendanceRoutes); // if you have attendance routes

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

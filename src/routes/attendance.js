// src/routes/attendance.js
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  getActiveSessionQr,
  markAttendanceForStaff,
  listMyAttendance,
} from "../services/attendance.js";

const router = express.Router();

// Get QR image for active session
router.get("/session/qr", auth(false), getActiveSessionQr);

// Staff marks attendance (type: "in" | "out" | "overtime_in" | "overtime_out")
router.post("/mark", auth(), requireRole("staff"), markAttendanceForStaff);

// List authenticated staff member’s attendance
router.get("/me", auth(), requireRole("staff"), listMyAttendance);

export default router;

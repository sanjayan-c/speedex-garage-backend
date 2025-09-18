// src/routes/attendance.js
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  getActiveSessionQr,
  markAttendanceForStaff,
  listMyAttendance,
} from "../services/attendance.js";
import { attendanceMarkSchema } from "../validation/schemas.js";

const router = express.Router();

// Get the active QR session as a data URL (public endpoint with optional auth)
router.get("/session/qr", auth(false), getActiveSessionQr);

// Mark attendance for the authenticated staff member (via QR session code)
router.post("/mark", auth(), requireRole("staff"), validate(attendanceMarkSchema), markAttendanceForStaff);

// List the authenticated staff member’s recent attendance records
router.get("/me", auth(), requireRole("staff"), listMyAttendance);

export default router;

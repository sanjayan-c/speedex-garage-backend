// src/routes/attendance.js
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  getActiveSessionQr,
  markAttendanceForStaff,
  listMyAttendance,
  timeoutAllStaff,
  listAttendance,
  getStaffAttendanceSummary,
  getStaffAttendanceDetails,
  updateAttendanceRecord,
} from "../services/attendance.js";
import { attendanceMarkSchema } from "../validation/schemas.js";

const router = express.Router();

// Get the active QR session as a data URL (public endpoint with optional auth)
router.get("/session/qr", getActiveSessionQr);

// Mark attendance for the authenticated staff member (via QR session code)
router.post("/mark", auth(), requireRole("staff"), validate(attendanceMarkSchema), markAttendanceForStaff);

// List the authenticated staff member’s recent attendance records
router.get("/me", auth(), requireRole("staff"), listMyAttendance);
router.get("/", auth(), requireRole("admin"), listAttendance);
router.get("/summary/:staffId", auth(), requireRole("admin"), getStaffAttendanceSummary);
router.get("/staff/:staffId/details", getStaffAttendanceDetails);

router.patch("/:attendanceId", auth(), requireRole("admin"), updateAttendanceRecord);
// Force time_out for all staff who have IN but not OUT today (Toronto),
router.post(
  "/force-timeout-staff",
  auth(),
  requireRole("admin"),
  timeoutAllStaff
);

export default router;

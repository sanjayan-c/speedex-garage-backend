import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  listPendingUntime,
  startUntimeForStaff,
  updateUntimeDurationForStaff,
} from "../services/untime.js";

const router = express.Router();

// List pending (staff with untime.active=true and not approved)
router.get("/pending", auth(true), requireRole("admin"), listPendingUntime);

// Start UnTime for a staff user: sets startTime (Toronto now), durationMinutes, approved=true
// Body: { userId: "uuid", durationMinutes?: number }
router.post("/start", auth(true), requireRole("admin"), startUntimeForStaff);

// Update duration for a staff user: only durationMinutes
// Body: { userId: "uuid", durationMinutes: number }
router.post(
  "/duration",
  auth(true),
  requireRole("admin"),
  updateUntimeDurationForStaff
);

export default router;

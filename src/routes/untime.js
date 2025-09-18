import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  listPendingUntime,
  startUntimeForStaff,
  updateUntimeDurationForStaff,
} from "../services/untime.js";
import {
  untimeStartSchema,
  untimeDurationSchema,
} from "../validation/schemas.js";

const router = express.Router();

// List pending (staff with untime.active=true and not approved)
router.get("/pending", auth(true), requireRole("admin"), listPendingUntime);

// Start UnTime: { userId, durationMinutes? }
router.post(
  "/start",
  auth(true),
  requireRole("admin"),
  validate(untimeStartSchema),
  startUntimeForStaff
);

// Update duration: { userId, durationMinutes }
router.post(
  "/duration",
  auth(true),
  requireRole("admin"),
  validate(untimeDurationSchema),
  updateUntimeDurationForStaff
);

export default router;

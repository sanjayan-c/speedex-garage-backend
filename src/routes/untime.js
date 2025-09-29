import express from "express";
import { auth, requireRole, requirePermission } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  listPendingUntime,
  listUntimeUsers,
  // startUntimeForStaff,
  updateUntimeDurationForStaff,
  setUntimeStatusForUser,
  setUntimeStatusForAllWorkingNow,
  endMyUntimeNow,
  extendUnTimeForSelf,
} from "../services/untime.js";
import {
  untimeStartSchema,
  untimeDurationSchema,
} from "../validation/schemas.js";

const router = express.Router();

// List pending (staff with untime.active=true and not approved)
// router.get("/pending", auth(true), requireRole("admin"), listPendingUntime);

// List all untime users
router.get(
  "/untime",
  auth(),
  requirePermission("Off-schedule-approval"),
  listUntimeUsers
);

// Start UnTime: { userId, durationMinutes? }
// router.post(
//   "/start",
//   auth(true),
//   requireRole("admin"),
//   validate(untimeStartSchema),
//   startUntimeForStaff
// );

// Update duration: { userId, durationMinutes }
router.post(
  "/duration",
  auth(true),
  requirePermission("Off-schedule-approval"),
  validate(untimeDurationSchema),
  updateUntimeDurationForStaff
);

// Change a single user's UnTime status
router.patch(
  "/status",
  auth(),
  requirePermission("Off-schedule-approval"),
  setUntimeStatusForUser
);

// Change status for all users who are currently in working time
router.patch(
  "/status/bulk-working",
  auth(),
  requirePermission("Off-schedule-approval"),
  setUntimeStatusForAllWorkingNow
);

// End own untime shift 
router.post("/end-self", auth(), requireRole("staff"), endMyUntimeNow);

// Extend untime after attendance
router.post("/extend", auth(true), requireRole("staff"), extendUnTimeForSelf);

export default router;

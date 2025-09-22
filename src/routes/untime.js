import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  listPendingUntime,
  listUntimeUsers,
  // startUntimeForStaff,
  updateUntimeDurationForStaff,
  setUntimeStatusForUser,
  setUntimeStatusForAllWorkingNow,
  endMyUntimeNow,
} from "../services/untime.js";
import {
  untimeStartSchema,
  untimeDurationSchema,
} from "../validation/schemas.js";

const router = express.Router();

// List pending (staff with untime.active=true and not approved)
router.get("/pending", auth(true), requireRole("admin"), listPendingUntime);

// List all untime users
router.get(
  "/untime",
  auth(),
  requireRole("admin"),
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
  requireRole("admin"),
  validate(untimeDurationSchema),
  updateUntimeDurationForStaff
);

// Change a single user's UnTime status
router.patch(
  "/status",
  auth(),
  requireRole("admin"),
  setUntimeStatusForUser
);

// Change status for all users who are currently in working time
router.patch(
  "/status/bulk-working",
  auth(),
  requireRole("admin"),
  setUntimeStatusForAllWorkingNow
);

// End own untime shift 
router.post("/end-self", auth(), requireRole("staff"), endMyUntimeNow);

export default router;

// src/routes/staff.js
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { staffCreateSchema, staffUpdateSchema } from "../validation/schemas.js";
import {
  createStaff,
  listStaff,
  getStaffById,
  updateStaff,
  deleteStaff,
  getStaffAllowed,
  getStaffBlocked,
} from "../services/staff.js";

const router = express.Router();

// Create a new staff member (admin only)
router.post(
  "/",
  auth(true),
  requireRole("admin"),
  validate(staffCreateSchema),
  createStaff
);

// List all staff (admin only)
router.get("/", auth(true), requireRole("admin"), listStaff);

// Get one staff record by id (admin only)
router.get("/:id", auth(true), requireRole("admin"), getStaffById);

router.get("/:id/blocked", auth(true), requireRole("admin"), getStaffBlocked);

// Update a staff record (admin only)
router.patch(
  "/:id",
  auth(true),
  requireRole("admin"),
  validate(staffUpdateSchema),
  updateStaff
);

// Delete a staff record (admin only)
router.delete("/:id", auth(true), requireRole("admin"), deleteStaff);
router.get("/:id/allowed", auth(true), requireRole("admin"), getStaffAllowed);

export default router;

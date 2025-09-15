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
} from "../services/staff.js";

const router = express.Router();

// Create
router.post(
  "/",
  auth(true),
  requireRole("admin"),
  validate(staffCreateSchema),
  createStaff
);

// List
router.get("/", auth(true), requireRole("admin"), listStaff);

// Get by ID
router.get("/:id", auth(true), requireRole("admin"), getStaffById);

// Update
router.patch(
  "/:id",
  auth(true),
  requireRole("admin"),
  validate(staffUpdateSchema),
  updateStaff
);

// Delete
router.delete("/:id", auth(true), requireRole("admin"), deleteStaff);

export default router;

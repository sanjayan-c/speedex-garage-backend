// src/routes/users.js
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  roleUpdateSchema,
  passwordUpdateSchema,
} from "../validation/schemas.js";
import { updateRole, updatePassword } from "../services/users.js";

const router = express.Router();

// Update role (admin only)
router.patch(
  "/role",
  auth(true),
  requireRole("admin"),
  validate(roleUpdateSchema),
  updateRole
);

// Update password (self or admin)
router.patch(
  "/password",
  auth(true),
  validate(passwordUpdateSchema),
  updatePassword
);

export default router;

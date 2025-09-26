// src/routes/auth.js
import express from "express";
import { validate } from "../middleware/validate.js";
import {
  registerSchema,
  loginSchema,
  adminRegisterStaffSchema,
} from "../validation/schemas.js";
import {
  register,
  login,
  refresh,
  logout,
  logoutAllUsers,
  logoutAllStaff,
  registerStaffAdmin,
  setUserBlockedStatus,
  getCurrentUser,
  getUserAllowedStatus,
  getUsernameById
} from "../services/auth.js";
import { auth, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Register a plain user
router.post("/register", validate(registerSchema), register);

// Admin one-shot: create user(role=staff) + staff row
router.post(
  "/register-staff",
  auth(true),
  requireRole("admin"),
  validate(adminRegisterStaffSchema),
  registerStaffAdmin
);

// Login
router.post("/login", validate(loginSchema), login);

// Refresh
router.post("/refresh", refresh);
router.get("/users/:id/username", getUsernameById);
// Logout
router.post("/logout", logout);

// Force-logout everyone
router.post("/force-logout", auth(true), requireRole("admin"), logoutAllUsers);

// Staff-only force logout
router.post(
  "/force-logout-staff",
  auth(true),
  requireRole("admin"),
  logoutAllStaff
);
router.get("/me", getCurrentUser);
router.patch("/:id/block", auth(), requireRole("admin"), setUserBlockedStatus);
router.get("/me/allowed", auth(), getUserAllowedStatus);

export default router;

// src/routes/auth.js
import express from "express";
import { validate } from "../middleware/validate.js";
import { registerSchema, loginSchema } from "../validation/schemas.js";
import { register, login, refresh, logout, logoutAllUsers, logoutAllStaff } from "../services/auth.js";
import { auth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);
router.post("/refresh", refresh);
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

export default router;

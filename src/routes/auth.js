// src/routes/auth.js
import express from "express";
import { validate } from "../middleware/validate.js";
import { registerSchema, loginSchema } from "../validation/schemas.js";
import { register, login, refresh, logout } from "../services/auth.js";

const router = express.Router();

router.post("/register", validate(registerSchema), register);
router.post("/login", validate(loginSchema), login);
router.post("/refresh", refresh);
router.post("/logout", logout);

export default router;

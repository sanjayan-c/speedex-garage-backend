// src/routes/shifts.js
import express from "express";
import { validate } from "../middleware/validate.js";
import { auth, requireRole } from "../middleware/auth.js";
import { getShift, updateShift } from "../services/shifts.js";
import { shiftUpdateSchema } from "../validation/schemas.js";

const router = express.Router();

// Get current shift hours (admin)
router.get("/", auth(true), requireRole("admin"), getShift);

// Update shift hours (admin)
// Body: { start: "HH:mm", end: "HH:mm" }  (24h format, Toronto local time)
router.put("/", auth(true), requireRole("admin"), validate(shiftUpdateSchema), updateShift);

export default router;

import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { requestLeave, listLeave, updateLeaveStatus } from "../services/leave.js";

const router = express.Router();

// Staff requests leave
router.post("/", auth(), requireRole("staff"), requestLeave);

// Admin lists all leave requests
router.get("/", auth(), requireRole("admin"), listLeave);

// Admin approves/rejects leave
router.patch("/:id/status", auth(), requireRole("admin"), updateLeaveStatus);

export default router;

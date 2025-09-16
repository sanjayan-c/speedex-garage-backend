import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { requestLeave, listLeave, updateLeaveStatus, editLeave,listMyLeave  } from "../services/leave.js";

const router = express.Router();

// Staff requests leave
router.post("/", auth(), requireRole("staff"), requestLeave);

// Admin lists all leave requests
router.get("/", auth(), requireRole("admin"), listLeave);
router.patch("/me/:id", auth(), requireRole("staff"), editLeave);
// Admin approves/rejects leave
router.patch("/status/:id", auth(), requireRole("admin"), updateLeaveStatus);

router.get("/me", auth(), requireRole("staff"), listMyLeave);
export default router;

import express from "express";
import { auth, requireRole, requirePermission } from "../middleware/auth.js";
import {
  requestLeave,
  listLeave,
  updateLeaveStatus,
  editLeave,
  listMyLeave,
  getLeaveByStaff,
  deleteLeaveByStaff,
  deleteLeaveByAdmin,
  requestLeaveCancellation,
} from "../services/leave.js";

const router = express.Router();
router.post("/", auth(), requireRole("staff"), requestLeave);

// Admin creates a leave on behalf of staff (staffId required in body)
// router.post("/admin", auth(), requireRole("admin"), requestLeave);

router.get("/", requirePermission('leave-list'), auth(), listLeave);

// Staff with special permission approves leave
router.patch("/status/:id", auth(), requirePermission('approve-leave'), updateLeaveStatus);

// Staff deletes own leave
router.delete("/me/:id", auth(), requireRole("staff"), deleteLeaveByStaff);

// Admin deletes leave
router.delete("/admin/:id", auth(), requirePermission('delete-leave'), deleteLeaveByAdmin);

// Staff lists own leave
router.get("/me", auth(), requireRole("staff"), listMyLeave);

router.patch("/me/:id", auth(), requireRole("staff"), editLeave);

// router.get("/staff/:staffId", auth(), requireRole("admin"), getLeaveByStaff);

router.patch("/:id/request-cancel", auth(), requireRole("staff"), requestLeaveCancellation);


export default router;

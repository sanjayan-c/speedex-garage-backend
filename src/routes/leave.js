// import express from "express";
// import { auth, requireRole, requirePermission } from "../middleware/auth.js";
// import {
//   requestLeave,
//   listLeave,
//   updateLeaveStatus,
//   editLeave,
//   listMyLeave,
//   getLeaveByStaff,
//   deleteLeaveByStaff,
//   deleteLeaveByAdmin,
// } from "../services/leave.js";
// import { validate } from "../middleware/validate.js";
// import { leaveCreateSchema, leaveUpdateSchema } from "../validation/schemas.js";

// const router = express.Router();

// // Staff requests a new leave
// router.post(
//   "/",
//   auth(),
//   requireRole("staff"),
//   requestLeave
// );

// // Admin lists all leave requests
// router.get("/", auth(), requireRole("admin"), listLeave);

// // Admin fetches leave by specific staffId
// router.get("/staff/:staffId", auth(), requireRole("admin"), getLeaveByStaff);

// // Staff deletes their own leave request (if pending)
// router.delete("/me/:id", auth(), requireRole("staff"), deleteLeaveByStaff);

// // Admin deletes a leave request (if it hasn’t started yet)
// router.delete("/admin/:id", auth(), requireRole("admin"), deleteLeaveByAdmin);

// // Staff edits their own pending leave
// router.patch(
//   "/me/:id",
//   auth(),
//   requireRole("staff"),
//   editLeave
// );

// // Admin approves or rejects a leave request
// router.patch("/status/:id", auth(), requireRole("admin"), updateLeaveStatus);

// // Staff lists their own leave requests
// router.get("/me", auth(), requireRole("staff"), listMyLeave);

// export default router;



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
} from "../services/leave.js";

const router = express.Router();

// Staff requests leave
router.post("/", auth(), requireRole("staff"), requestLeave);

// Admin lists all leaves
router.get("/", auth(), requireRole("admin"), listLeave);

// Staff with special permission approves leave
router.patch(
  "/status/:id",
  auth(),
  requirePermission("approve_leave"), // 🔑 Staff must have this permission
  updateLeaveStatus
);

// Staff deletes own leave
router.delete("/me/:id", auth(), requireRole("staff"), deleteLeaveByStaff);

// Admin deletes leave
router.delete("/admin/:id", auth(), requireRole("admin"), deleteLeaveByAdmin);

// Staff lists own leave
router.get("/me", auth(), requireRole("staff"), listMyLeave);

router.patch(
  "/me/:id",
  auth(),
  requireRole("staff"),
  editLeave
);
router.get("/staff/:staffId", auth(), requireRole("admin"), getLeaveByStaff);

export default router;

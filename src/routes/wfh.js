import express from "express";
import { auth, requireRole, requirePermission } from "../middleware/auth.js";
import {
  requestWFH,
  listWFHRequests,
  handleWFHRequest,
  wfhCheckIn,
  getMyWFHRequests,
  wfhCheckOut,
} from "../services/wfh.js";

const router = express.Router();

// Staff request WFH
router.post("/request", auth(), requireRole("staff"), requestWFH);

// Admin views requests
router.get("/", auth(), requireRole("admin"), listWFHRequests);

// Admin handles request (approve/reject)
router.post("/:requestId/handle", auth(), requireRole("admin"), handleWFHRequest);

// Staff check-in/out
router.post("/check-in", auth(), requireRole("staff"), wfhCheckIn);
router.post("/check-out", auth(), requireRole("staff"), wfhCheckOut);
// Staff fetches their own WFH requests
router.get("/me", auth(), requireRole("staff"), getMyWFHRequests);

export default router;

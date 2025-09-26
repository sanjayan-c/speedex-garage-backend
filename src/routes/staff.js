// src/routes/staff.js
import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { staffCreateSchema, staffUpdateSchema } from "../validation/schemas.js";
import { upload } from "../middleware/driveUpload.js";
import {
  createStaff,
  listStaff,
  getStaffById,
  updateStaff,
  deleteStaff,
  getStaffAllowed,
  getStaffBlocked,
  uploadStaffDocuments,
  getStaffDocuments,
} from "../services/staff.js";

const router = express.Router();

// Create a new staff member (admin only)
router.post(
  "/",
  auth(true),
  requireRole("admin"),
  validate(staffCreateSchema),
  createStaff
);

// List all staff (admin only)
router.get("/", auth(true), requireRole("admin"), listStaff);

// Get one staff record by id (admin only)
router.get("/:id", auth(true), requireRole("admin"), getStaffById);

router.get("/:id/blocked", auth(true), requireRole("admin"), getStaffBlocked);

// Update a staff record (admin only)
router.patch(
  "/:id",
  auth(true),
  requireRole("admin"),
  validate(staffUpdateSchema),
  updateStaff
);

// Delete a staff record (admin only)
router.delete("/:id", auth(true), requireRole("admin"), deleteStaff);
router.get("/:id/allowed", auth(true), requireRole("admin"), getStaffAllowed);


// Upload multiple documents
router.post(
  "/:id/documents",
  upload.array("documents"), // 'documents' is the key in form-data
  auth(true), requireRole("admin"),
  async (req, res) => {
    try {
      const staffId = req.params.id;
      const uploadedDocs = await uploadStaffDocuments(staffId, req.files);
      res.json({ documents: uploadedDocs });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Get staff documents
router.get("/:id/documents", auth(true), requireRole("admin"), async (req, res) => {
  try {
    const staffId = req.params.id;
    const docs = await getStaffDocuments(staffId);
    res.json({ documents: docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


export default router;

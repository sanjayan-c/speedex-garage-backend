// // src/routes/attendance.js
// import express from "express";
// import { auth, requireRole } from "../middleware/auth.js";
// import {
//   createNewQrSession,
//   getActiveSession,
//   generateQrDataURLForSession,
//   markAttendance,
// } from "../services/qrAttendance.js";
// import { pool } from "../utils/db.js";
// import { toToronto } from "../utils/time.js";

// const router = express.Router();
// // const APP_URL = process.env.CORS_ORIGIN || "https://your-app.example.com/attend"; // used in QR link
// const APP_URL = process.env.CORS_ORIGIN || "http://localhost:5173";

// // get current active session (public or admin) - returns session_code (not mandatory to show to public)
// // router.get("/session", auth(false), async (req, res) => {
// //   try {
// //     const s = await getActiveSession();
// //     if (!s) return res.status(404).json({ error: "No active session" });
// //     res.json(s);
// //   } catch (err) {
// //     console.error(err);
// //     res.status(500).json({ error: "Failed to fetch session" });
// //   }
// // });

// // get QR image for active session (admin/board) - returns dataURL or png
// router.get("/session/qr", auth(false), async (req, res) => {
//   try {
//     const s = await getActiveSession();
//     if (!s) return res.status(404).json({ error: "No active session" });
//     const dataUrl = await generateQrDataURLForSession(s.session_code, APP_URL);
//     // return it as dataURL
//     res.json({ dataUrl, link: `${APP_URL}?session=${encodeURIComponent(s.session_code)}`, expiresAt: s.expires_at });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to create QR" });
//   }
// });

// // manual create/rotate session (admin only)
// // router.post("/session/rotate", auth(), requireRole("admin"), async (req, res) => {
// //   try {
// //     const s = await createNewQrSession(req.user.sub || req.user.id, req.body.ttlMinutes);
// //     res.status(201).json(s);
// //   } catch (err) {
// //     console.error(err);
// //     res.status(500).json({ error: "Failed to rotate session" });
// //   }
// // });

// // staff hits this after scanning (frontend should call this with staff auth)
// router.post("/mark", auth(), requireRole("staff"), async (req, res) => {
//   const { session, type } = req.body; // type: 'in','out','overtime-in','overtime-out'
//   try {
//     const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [req.user.sub || req.user.id]);
//     if (!staffQ.rows.length) return res.status(404).json({ error: "Staff record not found" });
//     const staffId = staffQ.rows[0].id;

//     const rec = await markAttendance(staffId, session, type || "in");
//     res.json({ ok: true, attendance: rec });
//   } catch (err) {
//     console.error(err);
//     res.status(400).json({ error: err.message || "Failed to mark" });
//   }
// });

// // list attendance for a staff (self)
// router.get("/me", auth(), requireRole("staff"), async (req, res) => {
//   try {
//     const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [req.user.sub || req.user.id]);
//     if (!staffQ.rows.length) return res.status(404).json({ error: "Staff record not found" });
//     const staffId = staffQ.rows[0].id;

//     const { rows } = await pool.query("SELECT * FROM attendance_records WHERE staff_id=$1 ORDER BY attendance_date DESC LIMIT 50", [staffId]);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Failed to fetch attendance" });
//   }
// });

// export default router;


import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import {
  createNewQrSession,
  getActiveSession,
  generateQrDataURLForSession,
  markAttendance,
} from "../services/qrAttendance.js";
import { pool } from "../utils/db.js";
import { toToronto } from "../utils/time.js";

const router = express.Router();
const APP_URL = process.env.CORS_ORIGIN || "http://localhost:5173";

// Get QR image for active session
router.get("/session/qr", auth(false), async (req, res) => {
  try {
    const s = await getActiveSession();
    if (!s) return res.status(404).json({ error: "No active session" });
    const dataUrl = await generateQrDataURLForSession(s.session_code, APP_URL);

    res.json({
      dataUrl,
      link: `${APP_URL}?session=${encodeURIComponent(s.session_code)}`,
      createdAt: toToronto(s.created_at),
      expiresAt: toToronto(s.expires_at),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create QR" });
  }
});

// Staff marks attendance
router.post("/mark", auth(), requireRole("staff"), async (req, res) => {
  const { session, type } = req.body;
  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [req.user.sub || req.user.id]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff record not found" });
    const staffId = staffQ.rows[0].id;

    const rec = await markAttendance(staffId, session, type || "in");

    res.json({
      ok: true,
      attendance: {
        ...rec,
        time_in: toToronto(rec.time_in),
        time_out: toToronto(rec.time_out),
        overtime_in: toToronto(rec.overtime_in),
        overtime_out: toToronto(rec.overtime_out),
        created_at: toToronto(rec.created_at),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: err.message || "Failed to mark" });
  }
});

// List self attendance
router.get("/me", auth(), requireRole("staff"), async (req, res) => {
  try {
    const staffQ = await pool.query("SELECT id FROM staff WHERE user_id=$1", [req.user.sub || req.user.id]);
    if (!staffQ.rows.length) return res.status(404).json({ error: "Staff record not found" });
    const staffId = staffQ.rows[0].id;

    const { rows } = await pool.query(
      "SELECT * FROM attendance_records WHERE staff_id=$1 ORDER BY attendance_date DESC LIMIT 50",
      [staffId]
    );

    const data = rows.map(r => ({
      ...r,
      time_in: toToronto(r.time_in),
      time_out: toToronto(r.time_out),
      overtime_in: toToronto(r.overtime_in),
      overtime_out: toToronto(r.overtime_out),
      created_at: toToronto(r.created_at),
    }));

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch attendance" });
  }
});

export default router;

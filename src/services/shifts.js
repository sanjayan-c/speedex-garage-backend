// src/services/shifts.js
import { pool } from "../utils/db.js";

export async function getShift(req, res) {
  try {
    const { rows } = await pool.query(
      "SELECT start_local_time, end_local_time, updated_at FROM shift_hours WHERE id=1"
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Shift hours not configured" });
    }
    const r = rows[0];
    res.json({
      start: r.start_local_time, // "HH:MM:SS"
      end: r.end_local_time,     // "HH:MM:SS"
      updatedAt: r.updated_at
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch shift hours" });
  }
}

export async function updateShift(req, res) {
  const { start, end } = req.body || {};
  // very light validation (HH:mm or HH:mm:ss)
  const timeRe = /^\d{2}:\d{2}(:\d{2})?$/;
  if (!timeRe.test(start) || !timeRe.test(end)) {
    return res.status(400).json({ error: "Invalid time format. Use HH:mm or HH:mm:ss" });
  }
  try {
    await pool.query(
      `INSERT INTO shift_hours (id, start_local_time, end_local_time)
       VALUES (1, $1::time, $2::time)
       ON CONFLICT (id)
       DO UPDATE SET start_local_time=EXCLUDED.start_local_time, end_local_time=EXCLUDED.end_local_time, updated_at=NOW()`,
      [start, end]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update shift hours" });
  }
}

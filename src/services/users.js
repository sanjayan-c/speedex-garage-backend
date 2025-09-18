// src/services/users.js
import bcrypt from "bcrypt";
import { pool } from "../utils/db.js";

// PATCH /api/users/role  (admin only)
async function updateRole(req, res) {
  const { userId, role } = req.body;

  try {
    const { rowCount } = await pool.query(
      "UPDATE users SET role=$1 WHERE id=$2",
      [role, userId]
    );
    if (!rowCount) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update role" });
  }
}

// PATCH /api/users/password  (self or admin)
async function updatePassword(req, res) {
  const { currentPassword, newPassword } = req.body;
  const actingUser = req.user; // { sub, role }
  const targetUserId = req.query.userId || actingUser.sub;

  const isSelf = targetUserId === actingUser.sub;
  const isAdmin = actingUser.role === "admin";
  if (!isSelf && !isAdmin) return res.status(403).json({ error: "Forbidden" });

  try {
    // Self-change must supply current password
    if (isSelf && !currentPassword) {
      return res.status(400).json({
        error: "currentPassword is required when changing your own password",
      });
    }

    // If admin is resetting another user's password, do NOT accept currentPassword (avoid confusion)
    if (!isSelf && isAdmin && currentPassword) {
      return res.status(400).json({
        error: "Do not provide currentPassword when resetting another user's password",
      });
    }

    const { rows } = await pool.query(
      "SELECT password_hash FROM users WHERE id=$1",
      [targetUserId]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const storedHash = rows[0].password_hash;

    // Verify current password for self
    if (isSelf) {
      const ok = await bcrypt.compare(currentPassword, storedHash);
      if (!ok) {
        return res.status(400).json({ error: "Current password is incorrect" });
      }
    }

    // Prevent setting the same password as the current one
    const sameAsOld = await bcrypt.compare(newPassword, storedHash);
    if (sameAsOld) {
      return res.status(400).json({
        error: "New password must be different from the current password",
      });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      newHash,
      targetUserId,
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update password" });
  }
}


export { updateRole, updatePassword };

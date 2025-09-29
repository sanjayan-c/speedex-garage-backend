import express from "express";
import { auth, requireRole } from "../middleware/auth.js";
import { pool } from "../utils/db.js";

const router = express.Router();

// List all available permissions
router.get("/", auth(), requireRole("admin"), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM permissions ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch permissions" });
  }
});

router.get("/staff", auth(), requireRole("admin"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT 
         u.id,
         u.username,
         u.role,
         COALESCE(json_agg(p.name) FILTER (WHERE p.id IS NOT NULL), '[]') AS permissions
       FROM users u
       LEFT JOIN user_permissions up ON u.id = up.user_id
       LEFT JOIN permissions p ON up.permission_id = p.id
       WHERE u.role = 'staff'
       GROUP BY u.id
       ORDER BY u.username`
    );

    res.json(rows);
  } catch (err) {
    console.error("Failed to fetch staff with permissions:", err);
    res.status(500).json({ error: "Failed to fetch staff with permissions" });
  }
});


// List permissions of a specific user
router.get("/user/:userId", auth(), async (req, res) => {
  const { userId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.description
       FROM user_permissions up
       JOIN permissions p ON up.permission_id = p.id
       WHERE up.user_id = $1`,
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch user permissions" });
  }
});

// Assign a permission to a user
router.post("/assign", auth(), requireRole("admin"), async (req, res) => {
  const { userId, permissionName } = req.body;
  try {
    const { rows } = await pool.query("SELECT id FROM permissions WHERE name=$1", [permissionName]);
    if (!rows.length) return res.status(404).json({ error: "Permission not found" });

    const permissionId = rows[0].id;

    await pool.query(
      `INSERT INTO user_permissions (user_id, permission_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, permissionId]
    );

    res.json({ message: "Permission assigned successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to assign permission" });
  }
});

// Remove a permission from a user
router.post("/remove", auth(), requireRole("admin"), async (req, res) => {
  const { userId, permissionName } = req.body;
  try {
    const { rows } = await pool.query("SELECT id FROM permissions WHERE name=$1", [permissionName]);
    if (!rows.length) return res.status(404).json({ error: "Permission not found" });

    const permissionId = rows[0].id;

    await pool.query(
      `DELETE FROM user_permissions
       WHERE user_id=$1 AND permission_id=$2`,
      [userId, permissionId]
    );

    res.json({ message: "Permission removed successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove permission" });
  }
});

export default router;

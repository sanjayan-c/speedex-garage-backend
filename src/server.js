import 'dotenv/config';
import app from './app.js';
import { pool } from './utils/db.js';

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    console.log(`DB connected. Server running on http://localhost:${PORT}`);
  } catch (err) {
    console.error("DB connection failed:", err);
    process.exit(1);
  }
});

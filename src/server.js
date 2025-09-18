import 'dotenv/config';
import app from './app.js';
import { pool } from './utils/db.js';
import { scheduleShiftLogout } from "./jobs/shiftLogout.js";
import { scheduleUntimeEnforcer } from "./jobs/untimeEnforcer.js";

const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    console.log(`DB connected. Server running on http://localhost:${PORT}`);

    // Schedule the daily logout at shift end + 30 minutes (Toronto)
    await scheduleShiftLogout();
    // Check and log out untime users
    scheduleUntimeEnforcer();  
  } catch (err) {
    console.error("DB connection failed:", err);
    process.exit(1);
  }
});

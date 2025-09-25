import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { pool } from './utils/db.js';
import { scheduleShiftLogout } from "./jobs/shiftLogout.js";
import { scheduleUntimeEnforcer } from "./jobs/untimeEnforcer.js";
import { scheduleShiftAlert } from "./jobs/shiftAlert.js";
import { attachSocketServer } from "./socket/index.js";

const PORT = process.env.PORT || 8080;

// 1) create HTTP server
const server = http.createServer(app);

// 2) attach Socket.IO (exports io singleton)
attachSocketServer(server);

server.listen(PORT, async () => {
  try {
    await pool.query("SELECT 1");
    console.log(`DB connected. Server running on http://localhost:${PORT}`);

    // Schedule the daily logout at shift end + margin (Toronto)
    await scheduleShiftLogout();
    // Schedule the alert at end - alerttime (Toronto)
    await scheduleShiftAlert();
    // Background untime enforcement
    scheduleUntimeEnforcer();
  } catch (err) {
    console.error("DB connection failed:", err);
    process.exit(1);
  }
});

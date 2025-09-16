// // src/jobs/qrRotateJob.js
// import cron from "node-cron";
// import { createNewQrSession, getActiveSession } from "../services/qrAttendance.js";

// export function startQrRotateJob(ttlMinutes = 3) {
//   // create an initial session on startup
//   (async () => {
//     try {
//       const active = await getActiveSession();
//       if (!active) await createNewQrSession(null, ttlMinutes);
//     } catch (e) {
//       console.error("QR job init failed:", e);
//     }
//   })();

//   // Cron every ttlMinutes (use cron expression)
//   // For 3 minutes, run every 3rd minute: "*/3 * * * *"
//   cron.schedule(`*/${ttlMinutes} * * * *`, async () => {
//     try {
//       await createNewQrSession(null, ttlMinutes);
//       console.log("Rotated QR session at", new Date().toISOString());
//     } catch (e) {
//       console.error("Failed to rotate QR session:", e);
//     }
//   });
// }


import cron from "node-cron";
import { createNewQrSession, getActiveSession } from "../services/qrAttendance.js";

export function startQrRotateJob(ttlMinutes = 3) {
  (async () => {
    try {
      const active = await getActiveSession();
      if (!active) await createNewQrSession(null, ttlMinutes);
    } catch (e) {
      console.error("QR job init failed:", e);
    }
  })();

  cron.schedule(`*/${ttlMinutes} * * * *`, async () => {
    try {
      await createNewQrSession(null, ttlMinutes);
      console.log("Rotated QR session at", new Date().toISOString());
    } catch (e) {
      console.error("Failed to rotate QR session:", e);
    }
  });
}

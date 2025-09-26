import cron from "node-cron";
import { DateTime } from "luxon";
import { pool } from "../utils/db.js";
import { io } from "../socket/index.js";

let lastAlertPayload = null;
let lastAlertAt = null;
let pingTask = null;

// Read today's margin window in Toronto: [ (end + margintime - alerttime) , (end + margintime) ]
async function readMarginWindowToday() {
  const { rows } = await pool.query(
    `SELECT end_local_time::text AS end_local_time,
            COALESCE(margintime, 30)  AS margin_minutes,
            COALESCE(alerttime, 10)   AS alert_minutes
       FROM shift_hours WHERE id=1`
  );

  const torNow = DateTime.now().setZone("America/Toronto");

  // defaults if not configured
  const endText = rows.length ? rows[0].end_local_time : "17:00:00";
  const marginMinutes = rows.length ? Number(rows[0].margin_minutes) || 30 : 30;
  const alertMinutes = rows.length ? Number(rows[0].alert_minutes) || 10 : 10;

  // base end (shift end) today in Toronto
  const [eh, em] = endText.split(":").map(Number);
  const endBase = torNow.set({
    hour: eh ?? 17,
    minute: em ?? 0,
    second: 0,
    millisecond: 0,
  });

  // margin end = endBase + margintime
  const endMargin = endBase.plus({ minutes: marginMinutes });
  const start = endMargin.minus({ minutes: alertMinutes });

  // What we send to clients as the countdown target (keep same field name to avoid FE changes)
  const marginEndText = endMargin.toFormat("HH:mm:ss");

  return {
    start, // DateTime Toronto
    end: endMargin, // DateTime Toronto
    endText, // original shift end string (for logs if needed)
    marginEndText, // string "HH:mm:ss" you will send as end_local_time
    marginMinutes,
    alertMinutes,
  };
}

/** Minute pinger: every minute in Toronto, emit if now ∈ [start, endMargin] */
export async function scheduleShiftAlert() {
  if (pingTask) {
    pingTask.stop();
    pingTask = null;
  }

  // tick at every 30s
  const expr = "*/30 * * * * *";

  pingTask = cron.schedule(
    expr,
    async () => {
      try {
        const torNow = DateTime.now().setZone("America/Toronto");
        const { start, end, marginEndText, marginMinutes, alertMinutes } =
          await readMarginWindowToday();

        const inWindow = torNow >= start && torNow <= end;

        console.log(
          `[cron] shift-alert TICK @ ${torNow.toISO()} | window ${start.toFormat(
            "HH:mm"
          )}–${end.toFormat(
            "HH:mm"
          )} (end+${marginMinutes}m) | inWindow=${inWindow}`
        );

        if (!inWindow) return;

        const endISO = end.toISO();
        const payload = {
          type: "shift-alert",
          end_local_time: marginEndText,
          end_at_iso: endISO, 
          timezone: "America/Toronto",
          alert_minutes: alertMinutes,
          meta: { kind: "margin-end", margin_minutes: marginMinutes },
        };

        lastAlertPayload = payload;
        lastAlertAt = new Date();

        // Only IN-not-OUT staff who are logged in
        const userIds = await getActiveInProgressStaffUserIds();
        console.log(
          `[cron] shift-alert EMIT → recipients=${userIds.length} | target=${marginEndText} (end+${marginMinutes}m)`
        );

        for (const uid of userIds) {
          io.to(`user:${uid}`).emit("shift-alert", payload);
        }

        const total = io?.sockets?.sockets?.size ?? 0;
        const room = io?.sockets?.adapter?.rooms?.get("logged-in-staff");
        console.log(
          `[cron] shift-alert EMIT (minute ping) | sockets=${total} roomSize=${
            room ? room.size : 0
          } | target=${marginEndText} (end+${marginMinutes}m)`
        );

        // While debugging, broadcast to all:
        // io.emit("shift-alert", payload);
        // Later you can scope it:
        // io.to("logged-in-staff").emit("shift-alert", payload);
      } catch (e) {
        console.error("[cron] shift-alert pinger FAILED:", e);
      }
    },
    { timezone: "America/Toronto" }
  );

  pingTask.start();
  console.log(`[cron] shift-alert minute pinger scheduled (Toronto)`);
}

export async function rescheduleShiftAlert() {
  await scheduleShiftAlert();
}

// (Optional) used by socket connect logic to synthesize alert immediately
export async function isWithinAlertWindowToronto() {
  const { start, end, marginEndText, alertMinutes, marginMinutes } =
    await readMarginWindowToday();
  const torNow = DateTime.now().setZone("America/Toronto");
  const inWindow = torNow >= start && torNow <= end;
  return {
    inWindow,
    end_local_time: marginEndText,
    alert_minutes: alertMinutes,
    margin_minutes: marginMinutes,
  };
}

async function getActiveInProgressStaffUserIds() {
  // Toronto "today" as DATE for attendance_records
  const torToday = DateTime.now().setZone("America/Toronto").toISODate();

  const { rows } = await pool.query(
    `
    SELECT u.id AS user_id
    FROM users u
    JOIN staff s ON s.user_id = u.id
    JOIN attendance_records ar
      ON ar.staff_id = s.id
     AND ar.attendance_date = $1
    WHERE u.role = 'staff'
      AND u.is_login = true
      AND ar.time_in IS NOT NULL
      AND ar.time_out IS NULL
      AND COALESCE((u.untime->>'active')::boolean, false) = false
    `,
    [torToday]
  );

  return rows.map((r) => r.user_id);
}

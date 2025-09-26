// src/socket/index.js
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import { pool } from "../utils/db.js";
import { isWithinAlertWindowToronto } from "../jobs/shiftAlert.js";
import {
  getActiveUnTimeEndForUser,
  userHasOpenAttendanceToday,
} from "./helpers.js";
import { DateTime } from "luxon";

export let io = null;

export function attachSocketServer(server) {
  io = new SocketIOServer(server, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:5173"],
      credentials: true,
      methods: ["GET", "POST"],
    },
    path: "/api/socket.io",
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        cookie.parse(socket.handshake.headers?.cookie || "")?.accessToken ||
        cookie.parse(socket.handshake.headers?.cookie || "")?.[
          process.env.COOKIE_NAME || "rt"
        ];
      if (token) {
        const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
        const { rows } = await pool.query(
          "SELECT id, role, is_login FROM users WHERE id=$1",
          [payload.sub]
        );
        if (rows[0]) socket.user = rows[0];
      }
      next();
    } catch {
      next();
    }
  });

  io.on("connection", async (socket) => {
    const u = socket.user;
    console.log("[socket] connection:", socket.id, "user:", u || null);

    if (u) socket.join(`user:${u.id}`);
    if (u?.role === "staff" && u?.is_login === true) {
      socket.join("logged-in-staff");
      console.log("[socket] joined room 'logged-in-staff':", socket.id);
    }

    // counts...
    const total = io.sockets.sockets.size;
    const room = io.sockets.adapter.rooms.get("logged-in-staff");
    console.log(
      "[socket] totals -> sockets:",
      total,
      "room size:",
      room ? room.size : 0
    );

    // --- Register RPC FIRST so it's always available ---
    socket.on("alerts:get-latest", async (ack) => {
      try {
        const u2 = socket.user;
        if (!u2?.id || u2.role !== "staff" || u2.is_login !== true)
          return typeof ack === "function" && ack(null);

        // Prefer UnTime if in last 5 mins
        const untimeEnd = await getActiveUnTimeEndForUser(u2.id);
        if (untimeEnd) {
          const nowTor = DateTime.now().setZone("America/Toronto");
          const secondsLeft = untimeEnd.diff(nowTor, "seconds").seconds;
          if (secondsLeft > 0 && secondsLeft <= 5 * 60) {
            return (
              typeof ack === "function" &&
              ack({
                type: "untime-alert",
                end_local_time: untimeEnd.toFormat("HH:mm:ss"),
                end_at_iso: untimeEnd.toISO(),
                timezone: "America/Toronto",
                alert_minutes: 5,
                meta: { kind: "untime-end", source: "rpc" },
              })
            );
          }
        }

        // Else, shift window if IN not OUT
        const inProgress = await userHasOpenAttendanceToday(u2.id);
        if (inProgress) {
          const windowInfo = await isWithinAlertWindowToronto();
          if (windowInfo?.inWindow) {
            const torNow = DateTime.now().setZone("America/Toronto");
            const [hh, mm, ss = "0"] = String(windowInfo.end_local_time).split(
              ":"
            );
            const end = torNow.set({
              hour: parseInt(hh, 10),
              minute: parseInt(mm, 10),
              second: parseInt(ss, 10),
              millisecond: 0,
            });
            return (
              typeof ack === "function" &&
              ack({
                type: "shift-alert",
                end_local_time: windowInfo.end_local_time,
                end_at_iso: end.toISO(),
                timezone: "America/Toronto",
                alert_minutes: windowInfo.alert_minutes,
                meta: { kind: "margin-end", source: "rpc" },
              })
            );
          }
        }

        return typeof ack === "function" && ack(null);
      } catch {
        return typeof ack === "function" && ack(null);
      }
    });

    // --- Now push the initial alert (no early return!) ---
    if (u?.role === "staff" && u?.is_login === true) {
      // 1) Prefer UnTime if in last 5 mins
      const untimeEnd = await getActiveUnTimeEndForUser(u.id);
      if (untimeEnd) {
        const nowTor = DateTime.now().setZone("America/Toronto");
        const secondsLeft = untimeEnd.diff(nowTor, "seconds").seconds;
        if (secondsLeft > 0 && secondsLeft <= 5 * 60) {
          socket.emit("untime-alert", {
            type: "untime-alert",
            end_local_time: untimeEnd.toFormat("HH:mm:ss"),
            end_at_iso: untimeEnd.toISO(),
            timezone: "America/Toronto",
            alert_minutes: 5,
            meta: { kind: "untime-end", source: "connect" },
          });
        }
      }

      // 2) Otherwise, if IN-not-OUT and inside shift-alert window
      const inProgress = await userHasOpenAttendanceToday(u.id);
      if (inProgress) {
        const windowInfo = await isWithinAlertWindowToronto();
        if (windowInfo?.inWindow) {
          const torNow = DateTime.now().setZone("America/Toronto");
          const [hh, mm, ss = "0"] = String(windowInfo.end_local_time).split(
            ":"
          );
          const end = torNow.set({
            hour: parseInt(hh, 10),
            minute: parseInt(mm, 10),
            second: parseInt(ss, 10),
            millisecond: 0,
          });
          socket.emit("shift-alert", {
            type: "shift-alert",
            end_local_time: windowInfo.end_local_time,
            end_at_iso: end.toISO(),
            timezone: "America/Toronto",
            alert_minutes: windowInfo.alert_minutes,
            meta: { kind: "margin-end" },
          });
        }
      }
    }
  });

  return io;
}

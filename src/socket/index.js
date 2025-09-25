// src/socket/index.js
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import cookie from "cookie";
import { pool } from "../utils/db.js";
import { getLastAlertIfFresh } from "../jobs/shiftAlert.js";

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

  io.on("connection", (socket) => {
    const u = socket.user;
    console.log("[socket] connection:", socket.id, "user:", u || null);

    if (u?.role === "staff") {
      socket.join("logged-in-staff");
      console.log("[socket] joined room 'logged-in-staff':", socket.id);
    }

    // NEW: log current counts
    const total = io.sockets.sockets.size;
    const room = io.sockets.adapter.rooms.get("logged-in-staff");
    console.log(
      "[socket] totals -> sockets:",
      total,
      "room size:",
      room ? room.size : 0
    );

    // Replay the last alert if fresh
    const fresh = getLastAlertIfFresh(120);
    if (fresh && socket.user?.role === "staff" /* && socket.user?.is_login */) {
      console.log("[socket] replaying fresh alert to", socket.id);
      socket.emit("shift-alert", fresh);
    }
  });

  return io;
}

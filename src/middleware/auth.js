// src/middleware/auth.js
import jwt from "jsonwebtoken";

export function auth(required = true) {
  return (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) {
      if (required) {
        return res.status(401).json({ error: "Missing access token" });
      }
      return next();
    }

    jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, user) => {
      if (err) {
        return res
          .status(401)
          .json({ error: "Invalid or expired access token" });
      }
      req.user = user;
      next();
    });
  };
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}

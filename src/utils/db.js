import pkg from "pg";
const { Pool } = pkg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing DATABASE_URL in environment");
  process.exit(1);
}

// For Neon and other managed providers, SSL is required.
const sslNeeded = /sslmode=require/i.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: sslNeeded ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
});

// Optional: test connection on startup
pool.on("error", (err) => {
  console.error("Unexpected PG error", err);
});

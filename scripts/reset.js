import "dotenv/config";
import pkg from "pg";

const { Pool } = pkg;

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      DROP TABLE IF EXISTS refresh_tokens;
      DROP TABLE IF EXISTS staff;
      DROP TABLE IF EXISTS users;
    `);
    console.log("Tables dropped.");
  } catch (e) {
    console.error("Reset failed:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();

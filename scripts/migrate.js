import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "pg";

const { Pool } = pkg;

// Recreate __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const migrationsDir = path.join(__dirname, "..", "db", "migrations");

    // Get all .sql files and sort them
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      console.log(`Running migration: ${file}`);
      await pool.query(sql);
    }

    console.log("All migrations applied.");
  } catch (e) {
    console.error("Migration failed:", e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();

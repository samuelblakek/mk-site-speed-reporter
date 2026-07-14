import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "./client.js";

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

async function migrate() {
  const schema = readFileSync(schemaPath, "utf8");
  await pool.query(schema);
  console.log("Migration applied.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});

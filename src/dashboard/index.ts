import "dotenv/config";
import { pool } from "../db/client.js";
import { buildDashboard } from "./build.js";

async function main(): Promise<void> {
  await buildDashboard({ previousReportsDir: process.env.PREVIOUS_SITE_REPORTS_DIR });
  console.log("Dashboard written to site/");
  await pool.end();
}

main().catch((err) => {
  console.error("Dashboard build failed:", err);
  process.exitCode = 1;
});

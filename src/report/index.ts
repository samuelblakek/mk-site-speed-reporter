import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { pool } from "../db/client.js";
import { generateReport } from "./generate.js";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function resolveRange(): { startDate: string; endDate: string; label: string } {
  const [, , mode, startArg, endArg] = process.argv;

  if (mode === "weekly") {
    const endDate = todayIso();
    return { startDate: daysAgoIso(7), endDate, label: `weekly-${endDate}` };
  }
  if (mode === "monthly") {
    const endDate = todayIso();
    return { startDate: daysAgoIso(30), endDate, label: `monthly-${endDate}` };
  }
  if (mode === "range") {
    if (!startArg || !endArg) {
      throw new Error("range mode requires start and end dates: report range 2026-01-01 2026-01-31");
    }
    return { startDate: startArg, endDate: endArg, label: `custom_${startArg}_to_${endArg}` };
  }

  const endDate = todayIso();
  return { startDate: endDate, endDate, label: `daily-${endDate}` };
}

async function main(): Promise<void> {
  const { startDate, endDate, label } = resolveRange();

  const markdown = await generateReport({ startDate, endDate });

  mkdirSync("reports", { recursive: true });
  const outPath = `reports/${label}.md`;
  writeFileSync(outPath, markdown, "utf8");
  console.log(`Report written to ${outPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Report generation failed:", err);
  process.exitCode = 1;
});

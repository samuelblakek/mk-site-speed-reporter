import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool } from "../db/client.js";
import { runPageSpeed, type Strategy } from "./pagespeed.js";

interface UrlEntry {
  url: string;
  pageType: string;
  note?: string;
}

const urlsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "urls.json");

// Keep well under PSI's free quota (25k/day) and avoid hammering it with all requests at once.
const CONCURRENCY = 5;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function scanOne(entry: UrlEntry, device: Strategy, runDate: string): Promise<void> {
  try {
    const result = await runPageSpeed(entry.url, device);
    await pool.query(
      `insert into scan_results
        (url, page_type, device, run_date, lcp_ms, inp_ms, cls, perf_score, http_status,
         scan_failed, console_errors, deprecations, render_blocking, third_party_summary,
         field_data_source, field_lcp_ms, field_cls, field_inp_ms, field_fcp_ms, field_ttfb_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,false,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        entry.url,
        entry.pageType,
        device,
        runDate,
        result.lcpMs,
        result.inpMs,
        result.cls,
        result.perfScore,
        result.httpStatus,
        JSON.stringify(result.consoleErrors),
        JSON.stringify(result.deprecations),
        JSON.stringify(result.renderBlocking),
        JSON.stringify(result.thirdPartySummary),
        result.field.source,
        result.field.lcpMs,
        result.field.cls,
        result.field.inpMs,
        result.field.fcpMs,
        result.field.ttfbMs,
      ]
    );
    console.log(`OK   ${device.padEnd(7)} ${entry.pageType.padEnd(9)} ${entry.url}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await pool.query(
      `insert into scan_results (url, page_type, device, run_date, scan_failed, failure_reason)
       values ($1,$2,$3,$4,true,$5)`,
      [entry.url, entry.pageType, device, runDate, reason]
    );
    console.error(`FAIL ${device.padEnd(7)} ${entry.pageType.padEnd(9)} ${entry.url} - ${reason}`);
  }
}

async function main(): Promise<void> {
  const urls: UrlEntry[] = JSON.parse(readFileSync(urlsPath, "utf8"));
  const runDate = new Date().toISOString().slice(0, 10);

  const jobs: Array<{ entry: UrlEntry; device: Strategy }> = [];
  for (const entry of urls) {
    jobs.push({ entry, device: "mobile" });
    jobs.push({ entry, device: "desktop" });
  }

  console.log(`Scanning ${urls.length} URLs x 2 devices (${jobs.length} PSI calls), run_date=${runDate}`);
  await mapWithConcurrency(jobs, CONCURRENCY, (job) => scanOne(job.entry, job.device, runDate));

  await pool.end();
  console.log("Scan complete.");
}

main().catch((err) => {
  console.error("Scan run failed:", err);
  process.exitCode = 1;
});

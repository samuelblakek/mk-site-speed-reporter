import "dotenv/config";
import { pool } from "../db/client.js";
import { flagScanResult, type ScanResultRow } from "./rules.js";
import { getTrailingAverage } from "./trailing.js";

async function main(): Promise<void> {
  const runDate = process.argv[2] ?? new Date().toISOString().slice(0, 10);

  const { rows } = await pool.query(
    `select url, page_type as "pageType", device, run_date as "runDate", lcp_ms as "lcpMs",
            inp_ms as "inpMs", cls, perf_score as "perfScore", http_status as "httpStatus",
            scan_failed as "scanFailed", failure_reason as "failureReason"
     from scan_results
     where run_date = $1
     order by url, device`,
    [runDate]
  );

  console.log(`Flagging ${rows.length} scan results for run_date=${runDate}`);

  let flaggedCount = 0;
  for (const row of rows as ScanResultRow[]) {
    const trailing = await getTrailingAverage(row.url, row.device, row.pageType, row.runDate);
    const flags = flagScanResult(row, trailing);
    if (flags.length > 0) {
      flaggedCount++;
      console.log(`\n${row.device.padEnd(7)} ${row.pageType.padEnd(9)} ${row.url}`);
      for (const flag of flags) {
        console.log(`  [${flag.severity}] ${flag.message}`);
      }
    }
  }

  console.log(`\n${flaggedCount} of ${rows.length} results flagged.`);
  await pool.end();
}

main().catch((err) => {
  console.error("Flagging run failed:", err);
  process.exitCode = 1;
});

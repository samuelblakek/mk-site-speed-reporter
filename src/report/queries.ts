import { pool } from "../db/client.js";
import type { ScanResultRow } from "../flag/rules.js";

export interface ConsoleIssueRow {
  text: string | null;
  source: string | null;
}

export interface RenderBlockingRow {
  url: string;
  wastedMs: number | null;
}

export interface ThirdPartyRow {
  entity: string | null;
  mainThreadTimeMs: number | null;
  transferSize: number | null;
}

export interface ScanRow extends ScanResultRow {
  consoleErrors: ConsoleIssueRow[];
  renderBlocking: RenderBlockingRow[];
  thirdPartySummary: ThirdPartyRow[];
}

export interface DailyAverage {
  runDate: string;
  lcpMs: number | null;
  cls: number | null;
  perfScore: number | null;
}

const SELECT_COLUMNS = `
  url, page_type as "pageType", device, run_date as "runDate", lcp_ms as "lcpMs",
  inp_ms as "inpMs", cls, perf_score as "perfScore", http_status as "httpStatus",
  scan_failed as "scanFailed", failure_reason as "failureReason",
  console_errors as "consoleErrors", render_blocking as "renderBlocking",
  third_party_summary as "thirdPartySummary"
`;

function toIsoDate(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

export async function getLatestRunDate(maxDate: string): Promise<string | null> {
  const { rows } = await pool.query(`select max(run_date) as run_date from scan_results where run_date <= $1`, [
    maxDate,
  ]);
  return rows[0]?.run_date ? toIsoDate(rows[0].run_date) : null;
}

export async function getResultsForDate(runDate: string): Promise<ScanRow[]> {
  const { rows } = await pool.query(`select ${SELECT_COLUMNS} from scan_results where run_date = $1 order by url, device`, [
    runDate,
  ]);
  return rows.map((row: any) => ({
    ...row,
    runDate: toIsoDate(row.runDate),
    consoleErrors: row.consoleErrors ?? [],
    renderBlocking: row.renderBlocking ?? [],
    thirdPartySummary: row.thirdPartySummary ?? [],
  }));
}

export async function getDailyAverages(startDate: string, endDate: string, device: string): Promise<DailyAverage[]> {
  const { rows } = await pool.query(
    `select run_date, avg(lcp_ms)::float as lcp_ms, avg(cls)::float as cls, avg(perf_score)::float as perf_score
     from scan_results
     where run_date between $1 and $2 and device = $3 and scan_failed = false
     group by run_date
     order by run_date`,
    [startDate, endDate, device]
  );
  return rows.map((row: any) => ({
    runDate: toIsoDate(row.run_date),
    lcpMs: row.lcp_ms,
    cls: row.cls,
    perfScore: row.perf_score,
  }));
}

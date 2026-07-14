import { pool } from "../db/client.js";

export interface TrailingAverage {
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  perfScore: number | null;
  runCount: number;
}

// How many prior runs to average over when checking for regressions.
const TRAILING_WINDOW_RUNS = 7;

export async function getTrailingAverage(
  url: string,
  device: string,
  pageType: string,
  beforeRunDate: string
): Promise<TrailingAverage> {
  const { rows } = await pool.query(
    `select avg(lcp_ms)::float as lcp_ms, avg(inp_ms)::float as inp_ms, avg(cls)::float as cls,
            avg(perf_score)::float as perf_score, count(*)::int as run_count
     from (
       select lcp_ms, inp_ms, cls, perf_score
       from scan_results
       where url = $1 and device = $2 and page_type = $3
         and run_date < $4 and scan_failed = false
       order by run_date desc
       limit $5
     ) recent`,
    [url, device, pageType, beforeRunDate, TRAILING_WINDOW_RUNS]
  );

  const row = rows[0];
  return {
    lcpMs: row?.lcp_ms ?? null,
    inpMs: row?.inp_ms ?? null,
    cls: row?.cls ?? null,
    perfScore: row?.perf_score ?? null,
    runCount: row?.run_count ?? 0,
  };
}

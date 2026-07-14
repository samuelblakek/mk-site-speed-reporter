import { flagScanResult } from "../flag/rules.js";
import { getTrailingAverage } from "../flag/trailing.js";
import { getDailyAverages, getLatestRunDate, getResultsForDate } from "./queries.js";
import { renderReport, type FlaggedRow } from "./render.js";

export interface GenerateReportOptions {
  startDate: string;
  endDate: string;
  siteLabel?: string;
}

export async function generateReport(opts: GenerateReportOptions): Promise<string> {
  const { startDate, endDate } = opts;
  const siteLabel = opts.siteLabel ?? "menkind.co.uk";

  const latestRunDate = await getLatestRunDate(endDate);
  if (!latestRunDate) {
    throw new Error(`No scan data found on or before ${endDate}`);
  }

  const latestResults = await getResultsForDate(latestRunDate);

  const flaggedRows: FlaggedRow[] = [];
  for (const row of latestResults) {
    const trailing = await getTrailingAverage(row.url, row.device, row.pageType, row.runDate);
    const flags = flagScanResult(row, trailing);
    flaggedRows.push({ row, flags });
  }

  const [dailyAveragesMobile, dailyAveragesDesktop] = await Promise.all([
    getDailyAverages(startDate, endDate, "mobile"),
    getDailyAverages(startDate, endDate, "desktop"),
  ]);

  return renderReport({
    siteLabel,
    startDate,
    endDate,
    latestRunDate,
    generatedAt: new Date().toISOString(),
    results: flaggedRows,
    dailyAveragesMobile,
    dailyAveragesDesktop,
  });
}

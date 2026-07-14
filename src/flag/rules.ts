import { rateCls, rateLcp, ratePerfScore, rateTbtProxy } from "./thresholds.js";
import type { TrailingAverage } from "./trailing.js";

export interface ScanResultRow {
  url: string;
  pageType: string;
  device: string;
  runDate: string;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  perfScore: number | null;
  httpStatus: number | null;
  scanFailed: boolean;
  failureReason: string | null;
}

export type FlagSeverity = "broken" | "poor" | "needs-improvement" | "regression";

export interface Flag {
  metric: "scan" | "httpStatus" | "lcp" | "inp" | "cls" | "perfScore";
  severity: FlagSeverity;
  message: string;
}

// A metric must be at least this much worse than its trailing average to count as a
// regression - small run-to-run noise in lab data shouldn't trigger a flag.
const REGRESSION_THRESHOLD_PCT = 20;

// Don't flag regressions without enough history to make the trailing average meaningful.
const MIN_TRAILING_RUNS = 3;

export function flagScanResult(row: ScanResultRow, trailing: TrailingAverage | null): Flag[] {
  const flags: Flag[] = [];

  if (row.scanFailed) {
    flags.push({ metric: "scan", severity: "broken", message: `Scan failed: ${row.failureReason ?? "unknown reason"}` });
    return flags;
  }

  if (row.httpStatus != null && row.httpStatus >= 400) {
    flags.push({ metric: "httpStatus", severity: "broken", message: `Page returned HTTP ${row.httpStatus}` });
  }

  if (row.lcpMs != null) {
    const rating = rateLcp(row.lcpMs);
    if (rating !== "good") {
      flags.push({
        metric: "lcp",
        severity: rating,
        message: `LCP is ${row.lcpMs}ms (${rating} - good is <=2500ms, poor is >4000ms)`,
      });
    }
  }

  if (row.cls != null) {
    const rating = rateCls(row.cls);
    if (rating !== "good") {
      flags.push({
        metric: "cls",
        severity: rating,
        message: `CLS is ${row.cls.toFixed(3)} (${rating} - good is <=0.1, poor is >0.25)`,
      });
    }
  }

  if (row.inpMs != null) {
    const rating = rateTbtProxy(row.inpMs);
    if (rating !== "good") {
      flags.push({
        metric: "inp",
        severity: rating,
        message: `Total Blocking Time, lab proxy for INP, is ${row.inpMs}ms (${rating} - good is <=200ms, poor is >600ms)`,
      });
    }
  }

  if (row.perfScore != null) {
    const rating = ratePerfScore(row.perfScore);
    if (rating !== "good") {
      flags.push({
        metric: "perfScore",
        severity: rating,
        message: `Lighthouse performance score is ${row.perfScore} (${rating})`,
      });
    }
  }

  if (trailing && trailing.runCount >= MIN_TRAILING_RUNS) {
    flags.push(...detectRegressions(row, trailing));
  }

  return flags;
}

function detectRegressions(row: ScanResultRow, trailing: TrailingAverage): Flag[] {
  const flags: Flag[] = [];

  const higherIsWorse: Array<{ metric: Flag["metric"]; label: string; current: number | null; baseline: number | null; unit: string }> = [
    { metric: "lcp", label: "LCP", current: row.lcpMs, baseline: trailing.lcpMs, unit: "ms" },
    { metric: "inp", label: "Total Blocking Time", current: row.inpMs, baseline: trailing.inpMs, unit: "ms" },
    { metric: "cls", label: "CLS", current: row.cls, baseline: trailing.cls, unit: "" },
  ];

  for (const check of higherIsWorse) {
    if (check.current == null || check.baseline == null || check.baseline <= 0) continue;
    const pctChange = ((check.current - check.baseline) / check.baseline) * 100;
    if (pctChange >= REGRESSION_THRESHOLD_PCT) {
      flags.push({
        metric: check.metric,
        severity: "regression",
        message: `${check.label} regressed ${pctChange.toFixed(0)}% vs the trailing ${trailing.runCount}-run average (${check.baseline.toFixed(2)}${check.unit} -> ${check.current}${check.unit})`,
      });
    }
  }

  // Performance score is "worse" when it drops, so the comparison direction is inverted.
  if (row.perfScore != null && trailing.perfScore != null && trailing.perfScore > 0) {
    const pctChange = ((trailing.perfScore - row.perfScore) / trailing.perfScore) * 100;
    if (pctChange >= REGRESSION_THRESHOLD_PCT) {
      flags.push({
        metric: "perfScore",
        severity: "regression",
        message: `Lighthouse performance score dropped ${pctChange.toFixed(0)}% vs the trailing ${trailing.runCount}-run average (${trailing.perfScore.toFixed(0)} -> ${row.perfScore})`,
      });
    }
  }

  return flags;
}

import type { DailyAverage, ScanRow } from "../db/queries.js";
import { rateCls, rateInp, rateLcp, rateTbtProxy, type Rating } from "../flag/thresholds.js";
import type { Flag } from "../flag/rules.js";

export interface FlaggedRow {
  row: ScanRow;
  flags: Flag[];
}

export interface ReportInput {
  siteLabel: string;
  startDate: string;
  endDate: string;
  latestRunDate: string;
  generatedAt: string;
  results: FlaggedRow[];
  dailyAveragesMobile: DailyAverage[];
  dailyAveragesDesktop: DailyAverage[];
}

function severityRank(severity: Flag["severity"]): number {
  switch (severity) {
    case "broken":
      return 0;
    case "regression":
      return 1;
    case "poor":
      return 2;
    case "needs-improvement":
      return 3;
    default:
      return 4;
  }
}

function fmt(value: number | null, digits = 0): string {
  return value == null ? "n/a" : value.toFixed(digits);
}

function renderSummary(input: ReportInput): string {
  const flagged = input.results.filter((r) => r.flags.length > 0);
  const counts = { broken: 0, regression: 0, poor: 0, "needs-improvement": 0 };
  for (const { flags } of flagged) {
    for (const flag of flags) {
      counts[flag.severity as keyof typeof counts]++;
    }
  }

  return `## Summary

**Snapshot date:** ${input.latestRunDate}
**Results scanned:** ${input.results.length} (URL x device combinations)
**Results with at least one flag:** ${flagged.length}

| Severity | Count |
|---|---|
| Broken (scan failed or HTTP error) | ${counts.broken} |
| Regression (vs trailing average) | ${counts.regression} |
| Poor | ${counts.poor} |
| Needs improvement | ${counts["needs-improvement"]} |
`;
}

function renderFlaggedResults(input: ReportInput): string {
  const flagged = input.results.filter((r) => r.flags.length > 0);
  if (flagged.length === 0) {
    return `## Flagged Results\n\nNo results were flagged on ${input.latestRunDate}.\n`;
  }

  const lines: string[] = ["## Flagged Results\n"];
  for (const { row, flags } of flagged) {
    lines.push(`### ${row.device} - ${row.pageType} - ${row.url}\n`);
    const sorted = [...flags].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    for (const flag of sorted) {
      lines.push(`- **[${flag.severity}]** ${flag.message}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function renderFieldVsLab(input: ReportInput): string {
  const nonFailed = input.results.filter((r) => !r.row.scanFailed);
  const withField = nonFailed.filter((r) => r.row.fieldDataSource !== "none");

  const lines: string[] = ["## Lab Data vs Real-User Field Data\n"];
  lines.push(
    "Lab data is a single simulated Lighthouse run (throttled network/CPU, one snapshot in time). Field data is real Chrome users' actual p75 experience over the trailing 28 days. When they disagree, field data is generally the more representative number for what visitors actually experience - the lab run is one simulated scenario, not a sample of real visits.\n"
  );

  if (withField.length === 0) {
    lines.push(
      "No real-user field data was available for any scanned page in this snapshot (the site or these specific pages may not get enough Chrome traffic to qualify for the Chrome UX Report).\n"
    );
    return lines.join("\n");
  }

  lines.push("| Page | Device | Metric | Lab | Field (p75) | Field source | Agreement |");
  lines.push("|---|---|---|---|---|---|---|");

  for (const { row } of withField) {
    const sourceLabel = row.fieldDataSource === "origin" ? "site-wide (origin fallback)" : "this page";

    type Check = {
      metricLabel: string;
      lab: number | null;
      field: number | null;
      labRate: (v: number) => Rating;
      fieldRate: (v: number) => Rating;
      unit: string;
      digits: number;
    };

    const checks: Check[] = [
      { metricLabel: "LCP", lab: row.lcpMs, field: row.fieldLcpMs, labRate: rateLcp, fieldRate: rateLcp, unit: "ms", digits: 0 },
      { metricLabel: "CLS", lab: row.cls, field: row.fieldCls, labRate: rateCls, fieldRate: rateCls, unit: "", digits: 3 },
      {
        metricLabel: "INP (field) / TBT (lab proxy)",
        lab: row.inpMs,
        field: row.fieldInpMs,
        labRate: rateTbtProxy,
        fieldRate: rateInp,
        unit: "ms",
        digits: 0,
      },
    ];

    for (const check of checks) {
      if (check.field == null) continue;
      const fieldRating = check.fieldRate(check.field);
      const labRating = check.lab == null ? null : check.labRate(check.lab);
      const labValue = check.lab == null ? "n/a" : `${check.lab.toFixed(check.digits)}${check.unit}`;
      const fieldValue = `${check.field.toFixed(check.digits)}${check.unit} (${fieldRating})`;
      const agreement =
        labRating == null
          ? "no lab data to compare"
          : labRating === fieldRating
            ? "agree"
            : `disagree - lab rates this ${labRating}, field rates it ${fieldRating}`;
      lines.push(`| ${row.url} | ${row.device} | ${check.metricLabel} | ${labValue} | ${fieldValue} | ${sourceLabel} | ${agreement} |`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function renderConsoleAndResourceDetail(input: ReportInput): string {
  const withConsoleErrors = input.results.filter((r) => r.row.consoleErrors.length > 0);
  const withRenderBlocking = input.results.filter((r) => r.row.renderBlocking.length > 0);

  const lines: string[] = ["## Console Errors and Render-Blocking Resources\n"];
  lines.push(
    `Detail is listed only for pages captured in this report's snapshot (${input.latestRunDate}). Every count below is backed by the specific items that make it up.\n`
  );

  if (withConsoleErrors.length === 0) {
    lines.push("No console errors were recorded on any scanned page in this snapshot.\n");
  } else {
    for (const { row } of withConsoleErrors) {
      lines.push(`### ${row.device} - ${row.pageType} - ${row.url}`);
      lines.push(`${row.consoleErrors.length} console error(s):\n`);
      for (const issue of row.consoleErrors) {
        lines.push(`- ${issue.text ?? "(no description)"} - source: ${issue.source ?? "not detected"}`);
      }
      lines.push("");
    }
  }

  // Fact-based pattern: resources appearing as render-blocking on more than one page. This is
  // a mechanical observation (the same URL shows up in >1 page's list), not a causal claim -
  // it points at where a single fix would affect multiple pages.
  const urlToPages = new Map<string, Set<string>>();
  for (const { row } of withRenderBlocking) {
    for (const resource of row.renderBlocking) {
      const key = resource.url;
      if (!urlToPages.has(key)) urlToPages.set(key, new Set());
      urlToPages.get(key)?.add(`${row.device}/${row.pageType}`);
    }
  }
  const shared = [...urlToPages.entries()].filter(([, pages]) => pages.size > 1).sort((a, b) => b[1].size - a[1].size);

  lines.push("### Render-blocking resources shared across more than one page\n");
  if (shared.length === 0) {
    lines.push("No render-blocking resource was observed on more than one scanned page in this snapshot.\n");
  } else {
    lines.push("Fact: the same URL appears in the render-blocking list of multiple pages below - fixing it once likely affects all of them. This is an observation, not a claim about what causes the delay.\n");
    for (const [url, pages] of shared) {
      lines.push(`- \`${url}\` - appears on ${pages.size} pages: ${[...pages].join(", ")}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderTrend(input: ReportInput): string {
  const lines: string[] = ["## Trend Over Period\n"];
  lines.push(`Period: ${input.startDate} to ${input.endDate}.\n`);

  for (const [label, series] of [
    ["Mobile", input.dailyAveragesMobile],
    ["Desktop", input.dailyAveragesDesktop],
  ] as const) {
    lines.push(`### ${label}\n`);
    if (series.length === 0) {
      lines.push("No data recorded in this period.\n");
      continue;
    }
    if (series.length === 1) {
      lines.push(`Only one day of data in this period (${series[0].runDate}) - not enough to show a trend yet.\n`);
      lines.push(
        `| Date | Avg LCP (ms) | Avg CLS | Avg Perf Score |\n|---|---|---|---|\n| ${series[0].runDate} | ${fmt(series[0].lcpMs)} | ${fmt(series[0].cls, 3)} | ${fmt(series[0].perfScore)} |\n`
      );
      continue;
    }
    const first = series[0];
    const last = series[series.length - 1];
    lines.push(
      `First recorded day (${first.runDate}) vs latest recorded day (${last.runDate}) in this period:\n`
    );
    lines.push(`| Metric | ${first.runDate} | ${last.runDate} |\n|---|---|---|`);
    lines.push(`| Avg LCP (ms) | ${fmt(first.lcpMs)} | ${fmt(last.lcpMs)} |`);
    lines.push(`| Avg CLS | ${fmt(first.cls, 3)} | ${fmt(last.cls, 3)} |`);
    lines.push(`| Avg Perf Score | ${fmt(first.perfScore)} | ${fmt(last.perfScore)} |`);
    lines.push("");
  }

  return lines.join("\n");
}

function renderAllResults(input: ReportInput): string {
  const lines: string[] = [
    `## All Results (snapshot: ${input.latestRunDate})\n`,
    "| URL | Page Type | Device | Lab LCP (ms) | Field LCP (ms) | Lab CLS | Field CLS | TBT/lab-INP-proxy (ms) | Field INP (ms) | Perf Score | HTTP Status |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const { row } of input.results) {
    if (row.scanFailed) {
      lines.push(`| ${row.url} | ${row.pageType} | ${row.device} | scan failed | scan failed | scan failed | scan failed | scan failed | scan failed | scan failed | scan failed |`);
      continue;
    }
    lines.push(
      `| ${row.url} | ${row.pageType} | ${row.device} | ${fmt(row.lcpMs)} | ${fmt(row.fieldLcpMs)} | ${fmt(row.cls, 3)} | ${fmt(row.fieldCls, 3)} | ${fmt(row.inpMs)} | ${fmt(row.fieldInpMs)} | ${fmt(row.perfScore)} | ${row.httpStatus ?? "n/a"} |`
    );
  }
  return lines.join("\n") + "\n";
}

function renderRecommendedActions(input: ReportInput): string {
  const flagged = input.results.filter((r) => r.flags.length > 0);
  const groups: Record<Flag["severity"], FlaggedRow[]> = {
    broken: [],
    regression: [],
    poor: [],
    "needs-improvement": [],
  };
  for (const entry of flagged) {
    for (const severity of new Set(entry.flags.map((f) => f.severity))) {
      groups[severity].push(entry);
    }
  }

  const rationale: Record<Flag["severity"], string> = {
    broken: "Ordered first because these pages are actively broken (failed to scan or returned an HTTP error), not just slow.",
    regression: "Ordered second because these pages were working within their own normal range and have gotten worse - investigating now catches the change before it settles in as the new normal.",
    poor: "Ordered third because these cross Google's official 'poor' Core Web Vitals threshold, affecting real users today.",
    "needs-improvement": "Ordered last because these are below 'good' but not yet 'poor' - lower urgency than the groups above.",
  };

  const lines: string[] = ["## Recommendations\n"];
  let n = 1;
  for (const severity of ["broken", "regression", "poor", "needs-improvement"] as const) {
    const entries = groups[severity];
    if (entries.length === 0) continue;
    lines.push(`### ${severity} (${entries.length} result${entries.length === 1 ? "" : "s"})\n`);
    lines.push(`${rationale[severity]}\n`);
    lines.push("| # | Page | Affects |");
    lines.push("|---|---|---|");
    for (const { row } of entries) {
      lines.push(`| ${n++} | ${row.url} | ${row.device} / ${row.pageType} |`);
    }
    lines.push("");
  }
  if (n === 1) {
    lines.push("No action items - nothing was flagged in this snapshot.\n");
  }
  return lines.join("\n");
}

const GLOSSARY = `## Glossary

| Term | What it means |
|---|---|
| LCP (Largest Contentful Paint) | How long it takes the largest visible element (usually a hero image or heading) to render. Google's official thresholds: good <=2.5s, poor >4s. |
| CLS (Cumulative Layout Shift) | How much visible content unexpectedly shifts around while the page loads. Good <=0.1, poor >0.25. |
| INP (Interaction to Next Paint) | How responsive the page feels to clicks/taps. Official thresholds: good <=200ms, poor >500ms. Real INP can only come from actual user sessions (field data) - a single automated scan can't produce it directly. |
| TBT (Total Blocking Time) | The lab-only stand-in used for INP when no field data is available - how long the main thread was blocked and unable to respond during page load. Uses its own thresholds (good <=200ms, poor >600ms), distinct from real INP's thresholds - the two are not interchangeable. |
| Lab data | Measured from a single simulated Lighthouse run (throttled network/CPU) at scan time - consistent and repeatable, but one scenario, not a sample of real visits. |
| Field data | Real Chrome users' actual measured experience, aggregated as a 28-day rolling p75 by the Chrome UX Report (CrUX). Only available for pages/sites with enough Chrome traffic. Page-level data is used when available; site-wide ("origin") data is the fallback for lower-traffic pages. |
| Lighthouse performance score | Google's 0-100 composite score for the page, on the same run. 90-100 is good, 50-89 needs improvement, below 50 is poor. |
| Regression | A metric that has gotten meaningfully worse (20%+) compared to its own trailing 7-run average, independent of whether it has crossed a "poor" threshold. |
| Render-blocking resource | A script or stylesheet that must load before the page can start rendering. |
| Third party | Code loaded from a domain other than the site itself (analytics, tag managers, chat widgets, ad scripts). |
`;

const REFERENCES = `## References

| # | Source | What it covers | URL |
|---|---|---|---|
| [1] | Google web.dev - Defining Core Web Vitals thresholds | Official good/needs-improvement/poor bands for LCP, CLS, INP | https://web.dev/articles/defining-core-web-vitals-thresholds |
| [2] | Chrome for Developers - Lighthouse performance scoring | How the 0-100 performance score and Total Blocking Time are calculated | https://developer.chrome.com/docs/lighthouse/performance/performance-scoring |
| [3] | Google PageSpeed Insights API documentation | The data source for every metric in this report | https://developers.google.com/speed/docs/insights/v5/get-started |
| [4] | Chrome UX Report (CrUX) documentation | What the real-user field data is, how it's aggregated, and its traffic-threshold requirements | https://developer.chrome.com/docs/crux |
`;

export function renderReport(input: ReportInput): string {
  return [
    `# Site Speed Report: ${input.siteLabel}`,
    "",
    `**Period:** ${input.startDate} to ${input.endDate}`,
    `**Generated:** ${input.generatedAt}`,
    `**Data source:** Google PageSpeed Insights API (Lighthouse lab data + Chrome UX Report field data), automated scan`,
    "",
    renderSummary(input),
    renderFlaggedResults(input),
    renderRecommendedActions(input),
    renderFieldVsLab(input),
    renderTrend(input),
    renderConsoleAndResourceDetail(input),
    renderAllResults(input),
    GLOSSARY,
    REFERENCES,
  ].join("\n");
}

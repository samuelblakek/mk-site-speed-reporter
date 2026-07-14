import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { getDailyAverages, getLatestRunDate, getResultsForDate, type ScanRow } from "../db/queries.js";
import { flagScanResult, type Flag } from "../flag/rules.js";
import { getTrailingAverage } from "../flag/trailing.js";
import { CHART_INTERACTION_SCRIPT, renderLineChart, type ChartSeries } from "./lineChart.js";
import { SERIES, severityToStatusRole, THEME_CSS } from "./theme.js";

const SITE_DIR = "site";
const REPORTS_SOURCE_DIR = "reports";
const TREND_WINDOW_DAYS = 30;

interface FlaggedRow {
  row: ScanRow;
  flags: Flag[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

type Severity = Flag["severity"] | "good";

function worstSeverity(flags: Flag[]): Severity {
  const order: Flag["severity"][] = ["broken", "poor", "regression", "needs-improvement"];
  for (const severity of order) {
    if (flags.some((f) => f.severity === severity)) return severity;
  }
  return "good";
}

function statusBadge(severity: Severity): string {
  const role = severityToStatusRole(severity);
  const icon = role === "good" ? "✓" : role === "critical" ? "✕" : "▲";
  return `<span class="badge" data-role="${role}">${icon} ${escapeHtml(severity)}</span>`;
}

// The field value is what actually drives flagging when available (see src/flag/rules.ts) -
// the table shows the same number the flag is based on, with a note when it fell back to lab.
function effectiveMetric(field: number | null, lab: number | null): { value: number | null; isField: boolean } {
  return field != null ? { value: field, isField: true } : { value: lab, isField: false };
}

function fmtMetric(m: { value: number | null; isField: boolean }, digits = 0): string {
  if (m.value == null) return "n/a";
  return `${m.value.toFixed(digits)}${m.isField ? "" : " (lab)"}`;
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Each Pages deployment only has this run's freshly-generated markdown locally - prior runs'
// reports aren't regenerated, so they'd disappear from the link list (even though their HTML
// persists on gh-pages via keep_files) unless we're told where to find them. When set, this
// points at a checkout of the previously-published site so we can link, not regenerate, them.
function buildReportPages(previousReportsDir?: string): Array<{ label: string; href: string }> {
  mkdirSync(path.join(SITE_DIR, "reports"), { recursive: true });

  const linksByLabel = new Map<string, { label: string; href: string }>();

  if (previousReportsDir && existsSync(previousReportsDir)) {
    for (const file of readdirSync(previousReportsDir).filter((f) => f.endsWith(".html"))) {
      const label = file.replace(/\.html$/, "");
      linksByLabel.set(label, { label, href: `reports/${file}` });
    }
  }

  if (existsSync(REPORTS_SOURCE_DIR)) {
    for (const file of readdirSync(REPORTS_SOURCE_DIR).filter((f) => f.endsWith(".md"))) {
      const markdown = readFileSync(path.join(REPORTS_SOURCE_DIR, file), "utf8");
      const html = marked.parse(markdown, { async: false }) as string;
      const label = file.replace(/\.md$/, "");
      const outFile = `${label}.html`;
      writeFileSync(
        path.join(SITE_DIR, "reports", outFile),
        `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(label)}</title>` +
          `<link rel="stylesheet" href="../style.css"></head><body><main class="report">${html}</main></body></html>`,
        "utf8"
      );
      linksByLabel.set(label, { label, href: `reports/${outFile}` });
    }
  }

  return [...linksByLabel.values()].sort((a, b) => b.label.localeCompare(a.label));
}

function legendHtml(): string {
  return `<div class="chart-legend">
    <span class="legend-item"><span class="legend-key" style="background:var(--series-mobile)"></span>${SERIES.mobile.label}</span>
    <span class="legend-item"><span class="legend-key" style="background:var(--series-desktop)"></span>${SERIES.desktop.label}</span>
  </div>`;
}

function trendChart(
  mobileTrend: Array<{ runDate: string; lcpMs: number | null; cls: number | null; perfScore: number | null }>,
  desktopTrend: typeof mobileTrend,
  metric: "lcpMs" | "perfScore",
  valueSuffix: string
): string {
  const series: ChartSeries[] = [
    { key: "mobile", label: "Mobile", colorVar: "var(--series-mobile)", points: mobileTrend.map((d) => ({ date: d.runDate, value: d[metric] })) },
    { key: "desktop", label: "Desktop", colorVar: "var(--series-desktop)", points: desktopTrend.map((d) => ({ date: d.runDate, value: d[metric] })) },
  ];
  return renderLineChart(series, { valueSuffix });
}

export async function buildDashboard(options: { previousReportsDir?: string } = {}): Promise<void> {
  mkdirSync(SITE_DIR, { recursive: true });

  const endDate = todayIso();
  const latestRunDate = await getLatestRunDate(endDate);

  let flaggedRows: FlaggedRow[] = [];
  if (latestRunDate) {
    const results = await getResultsForDate(latestRunDate);
    for (const row of results) {
      const trailing = await getTrailingAverage(row.url, row.device, row.pageType, row.runDate);
      flaggedRows.push({ row, flags: flagScanResult(row, trailing) });
    }
  }

  const startDate = daysAgoIso(TREND_WINDOW_DAYS);
  const [mobileTrend, desktopTrend] = await Promise.all([
    getDailyAverages(startDate, endDate, "mobile"),
    getDailyAverages(startDate, endDate, "desktop"),
  ]);

  const reportLinks = buildReportPages(options.previousReportsDir);

  const flaggedCount = flaggedRows.filter((r) => r.flags.length > 0).length;
  const brokenCount = flaggedRows.filter((r) => r.flags.some((f) => f.severity === "broken")).length;
  const poorCount = flaggedRows.filter((r) => r.flags.some((f) => f.severity === "poor")).length;
  const regressionCount = flaggedRows.filter((r) => r.flags.some((f) => f.severity === "regression")).length;

  const resultsTableRows = flaggedRows
    .map(({ row, flags }) => {
      const severity = worstSeverity(flags);
      if (row.scanFailed) {
        return `<tr><td>${escapeHtml(row.url)}</td><td>${escapeHtml(row.pageType)}</td><td>${escapeHtml(row.device)}</td><td colspan="4">scan failed</td><td>${statusBadge(severity)}</td></tr>`;
      }
      const lcp = fmtMetric(effectiveMetric(row.fieldLcpMs, row.lcpMs));
      const cls = fmtMetric(effectiveMetric(row.fieldCls, row.cls), 3);
      const inp = fmtMetric(effectiveMetric(row.fieldInpMs, row.inpMs));
      return `<tr>
        <td>${escapeHtml(row.url)}</td>
        <td>${escapeHtml(row.pageType)}</td>
        <td>${escapeHtml(row.device)}</td>
        <td>${lcp}</td>
        <td>${inp}</td>
        <td>${cls}</td>
        <td>${row.perfScore ?? "n/a"}</td>
        <td>${statusBadge(severity)}</td>
      </tr>`;
    })
    .join("\n");

  const reportLinksHtml = reportLinks.length
    ? `<ul>${reportLinks.map((r) => `<li><a href="${r.href}">${escapeHtml(r.label)}</a></li>`).join("")}</ul>`
    : `<p class="muted">No reports generated yet.</p>`;

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mk-site-speed-reporter</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<main>
  <h1>Site Speed Dashboard: menkind.co.uk</h1>
  <p class="muted">Latest snapshot: ${latestRunDate ?? "no data yet"} &middot; trend window: last ${TREND_WINDOW_DAYS} days &middot; LCP/CLS/INP below use real-user field data where available, lab data otherwise (marked "lab")</p>

  <section class="stat-row">
    <div class="card-surface stat-tile"><span class="stat-value">${flaggedRows.length}</span><span class="stat-label">results scanned</span></div>
    <div class="card-surface stat-tile"><span class="stat-value">${flaggedCount}</span><span class="stat-label">flagged</span></div>
    <div class="card-surface stat-tile" data-role="critical"><span class="stat-value">${brokenCount}</span><span class="stat-label">broken</span></div>
    <div class="card-surface stat-tile" data-role="serious"><span class="stat-value">${poorCount}</span><span class="stat-label">poor</span></div>
    <div class="card-surface stat-tile" data-role="warning"><span class="stat-value">${regressionCount}</span><span class="stat-label">regressions</span></div>
  </section>

  <section>
    <h2>LCP trend (${TREND_WINDOW_DAYS}-day average, lab data)</h2>
    <div class="card-surface chart-card">
      ${legendHtml()}
      ${trendChart(mobileTrend, desktopTrend, "lcpMs", "ms")}
    </div>
  </section>

  <section>
    <h2>Performance score trend (${TREND_WINDOW_DAYS}-day average, lab data)</h2>
    <div class="card-surface chart-card">
      ${legendHtml()}
      ${trendChart(mobileTrend, desktopTrend, "perfScore", "")}
    </div>
  </section>

  <section>
    <h2>Current snapshot (${latestRunDate ?? "n/a"})</h2>
    <div class="card-surface table-wrap">
      <table>
        <thead>
          <tr><th>URL</th><th>Page type</th><th>Device</th><th>LCP (ms)</th><th>INP (ms)</th><th>CLS</th><th>Perf score</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${resultsTableRows || `<tr><td colspan="8">No data yet.</td></tr>`}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Reports</h2>
    ${reportLinksHtml}
  </section>
</main>
<script>${CHART_INTERACTION_SCRIPT}</script>
</body>
</html>`;

  writeFileSync(path.join(SITE_DIR, "index.html"), html, "utf8");
  writeFileSync(path.join(SITE_DIR, "style.css"), THEME_CSS, "utf8");
}

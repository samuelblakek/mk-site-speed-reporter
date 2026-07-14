import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { marked } from "marked";
import { flagScanResult, type Flag } from "../flag/rules.js";
import { getTrailingAverage } from "../flag/trailing.js";
import { getDailyAverages, getLatestRunDate, getResultsForDate, type ScanRow } from "../report/queries.js";
import { renderSparkline } from "./sparkline.js";

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

function severityBadge(severity: Flag["severity"] | "good"): string {
  return `<span class="badge badge-${severity}">${severity}</span>`;
}

function worstSeverity(flags: Flag[]): Flag["severity"] | "good" {
  const order: Flag["severity"][] = ["broken", "poor", "regression", "needs-improvement"];
  for (const severity of order) {
    if (flags.some((f) => f.severity === severity)) return severity;
  }
  return "good";
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
      return `<tr>
        <td>${escapeHtml(row.url)}</td>
        <td>${escapeHtml(row.pageType)}</td>
        <td>${escapeHtml(row.device)}</td>
        <td>${row.scanFailed ? "scan failed" : (row.lcpMs ?? "n/a")}</td>
        <td>${row.scanFailed ? "scan failed" : (row.inpMs ?? "n/a")}</td>
        <td>${row.scanFailed ? "scan failed" : (row.cls?.toFixed(3) ?? "n/a")}</td>
        <td>${row.scanFailed ? "scan failed" : (row.perfScore ?? "n/a")}</td>
        <td>${severityBadge(severity)}</td>
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
  <p class="muted">Latest snapshot: ${latestRunDate ?? "no data yet"}. Trend window: last ${TREND_WINDOW_DAYS} days.</p>

  <section class="cards">
    <div class="card"><span class="card-value">${flaggedRows.length}</span><span class="card-label">results scanned</span></div>
    <div class="card"><span class="card-value">${flaggedCount}</span><span class="card-label">flagged</span></div>
    <div class="card card-broken"><span class="card-value">${brokenCount}</span><span class="card-label">broken</span></div>
    <div class="card card-poor"><span class="card-value">${poorCount}</span><span class="card-label">poor</span></div>
    <div class="card card-regression"><span class="card-value">${regressionCount}</span><span class="card-label">regressions</span></div>
  </section>

  <section>
    <h2>LCP trend (${TREND_WINDOW_DAYS}-day average)</h2>
    <div class="trend-grid">
      <div>
        <h3>Mobile</h3>
        ${renderSparkline(mobileTrend.filter((d) => d.lcpMs != null).map((d) => ({ label: d.runDate, value: d.lcpMs as number })))}
      </div>
      <div>
        <h3>Desktop</h3>
        ${renderSparkline(desktopTrend.filter((d) => d.lcpMs != null).map((d) => ({ label: d.runDate, value: d.lcpMs as number })))}
      </div>
    </div>
  </section>

  <section>
    <h2>Performance score trend (${TREND_WINDOW_DAYS}-day average)</h2>
    <div class="trend-grid">
      <div>
        <h3>Mobile</h3>
        ${renderSparkline(mobileTrend.filter((d) => d.perfScore != null).map((d) => ({ label: d.runDate, value: d.perfScore as number })))}
      </div>
      <div>
        <h3>Desktop</h3>
        ${renderSparkline(desktopTrend.filter((d) => d.perfScore != null).map((d) => ({ label: d.runDate, value: d.perfScore as number })))}
      </div>
    </div>
  </section>

  <section>
    <h2>Current snapshot (${latestRunDate ?? "n/a"})</h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>URL</th><th>Page type</th><th>Device</th><th>LCP (ms)</th><th>TBT/INP proxy (ms)</th><th>CLS</th><th>Perf score</th><th>Status</th></tr>
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
</body>
</html>`;

  writeFileSync(path.join(SITE_DIR, "index.html"), html, "utf8");
  writeFileSync(path.join(SITE_DIR, "style.css"), STYLE, "utf8");
}

const STYLE = `
:root {
  color-scheme: light dark;
  --fg: #1a1a1a;
  --bg: #ffffff;
  --muted: #6b7280;
  --border: #e5e7eb;
  --broken: #dc2626;
  --poor: #ea580c;
  --regression: #d97706;
  --needs-improvement: #ca8a04;
  --good: #16a34a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #f3f4f6;
    --bg: #111827;
    --muted: #9ca3af;
    --border: #374151;
  }
}
body { font-family: system-ui, -apple-system, sans-serif; color: var(--fg); background: var(--bg); margin: 0; padding: 2rem; }
main { max-width: 960px; margin: 0 auto; }
h1 { margin-bottom: 0.25rem; }
.muted { color: var(--muted); }
.cards { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1.5rem 0; }
.card { border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.5rem; text-align: center; min-width: 100px; }
.card-value { display: block; font-size: 2rem; font-weight: 700; }
.card-label { display: block; color: var(--muted); font-size: 0.85rem; }
.card-broken .card-value { color: var(--broken); }
.card-poor .card-value { color: var(--poor); }
.card-regression .card-value { color: var(--regression); }
.trend-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; }
.trend-grid svg { color: var(--fg); }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); white-space: nowrap; }
.badge { padding: 0.15rem 0.5rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
.badge-broken { background: color-mix(in srgb, var(--broken) 20%, transparent); color: var(--broken); }
.badge-poor { background: color-mix(in srgb, var(--poor) 20%, transparent); color: var(--poor); }
.badge-regression { background: color-mix(in srgb, var(--regression) 20%, transparent); color: var(--regression); }
.badge-needs-improvement { background: color-mix(in srgb, var(--needs-improvement) 20%, transparent); color: var(--needs-improvement); }
.badge-good { background: color-mix(in srgb, var(--good) 20%, transparent); color: var(--good); }
.report table { margin-bottom: 1.5rem; }
`;

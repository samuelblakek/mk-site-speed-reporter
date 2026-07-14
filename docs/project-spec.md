# Project Spec: mk-site-speed-reporter

Automated Core Web Vitals / site-speed monitoring for the storefront, replacing ad hoc manual audits with a scheduled scan, historical trend tracking, and a report developers actually see.

Status: draft, finalized via `/grill-me` interview on 2026-07-14. Several external dependencies (marked below) must be resolved before this can run end-to-end.

## Product Requirements

### Who it's for

Internal developers on the team, plus anyone else who watches the GitHub Pages dashboard or the Slack channel. Reports use full narrative detail (glossary, cited sources, root-cause write-ups) rather than a terse dev-only format, since non-developers may read them too.

### Problem it solves

There was no systematic, ongoing way to monitor Core Web Vitals and site speed across the catalog. The existing [website-analysis skill](../../../.claude/skills/website-analysis/SKILL.md) covers deep, one-off audits well but is interactive (drives a live Chrome session) and doesn't scale to hundreds of URLs or run unattended. This project automates the broad, repeated scan and keeps the existing skill as the manual deep-dive tool for anything flagged.

### What gets monitored

251 URLs per run:
- 1 homepage
- 50 category pages
- 200 product pages

Per URL, per run (mobile + desktop):
- Core Web Vitals: LCP, INP, CLS (Google's official good / needs-improvement / poor thresholds)
- Lighthouse performance score
- Render-blocking resources (exact URLs)
- Third-party script impact (exact scripts, blocking time)
- Console errors and deprecation warnings (from PSI's Lighthouse `errors-in-console` / `deprecations` audits)
- HTTP status (catches broken pages, not just slow ones)

Explicitly out of scope for v1: screenshots / visual regression, and anything requiring a live Chrome session (those stay in the manual website-analysis skill workflow).

### Workflows

1. **Daily automated scan** — all 251 URLs, both devices. Writes results to the database, updates the GitHub Pages dashboard, posts a Slack summary every run regardless of whether anything is flagged.
2. **Weekly and monthly rollups** — auto-generated trend reports ("last 7 days", "last 30 days") alongside the daily report, no manual step required.
3. **On-demand date-range report** — a GitHub Actions manual trigger (`workflow_dispatch`) where a developer supplies a start/end date and gets a report scoped to exactly that range (e.g. "what happened last quarter").
4. **Manual deep-dive** — when a page is flagged, a developer runs the existing website-analysis skill against that specific URL for console-level detail, screenshots, and DOM inspection that a scheduled run doesn't capture.

### Report content rules

Reports reuse the language discipline already established in the website-analysis skill:
- No hyperbole ("zero", "cannot", "every" only when literally true; Lighthouse's own poor/needs-improvement/good terms, not "failure")
- Every count backed by a specific list (e.g. a "3 console errors" claim lists all 3, with exact text and source)
- Metrics attributed to the specific page/device they came from — no mixing worst-case values across pages
- Inferences (e.g. root-cause guesses) labeled as inference, not fact
- Action items grouped with a stated rationale for the ordering, not arbitrary priority labels

### Delivery

- **Dashboard**: static site published to GitHub Pages, rebuilt every run, shows current status + trend charts per page/category
- **Notification**: Slack message via incoming webhook, every run, summarizing scan results with a link to the dashboard
- Email delivery was considered and dropped for v1 (adds a mail-provider dependency for no benefit over Slack + a bookmarked dashboard)

## Engineering Requirements

### Tech stack

| Concern | Choice | Why |
|---|---|---|
| Scan/report scripts | Node.js / TypeScript | Native fit for GitHub Actions; PSI API is plain JSON over HTTP (no SDK needed); easiest to extend with a Playwright screenshot step later if scope grows |
| Scheduling & CI | GitHub Actions | Free, versioned in-repo, built-in secrets management, no server to maintain |
| Data source | Google PageSpeed Insights API | Hosted (no local Chrome), free up to 25,000 requests/day (this app uses ~502/day), returns full Lighthouse audit payload including console errors and root-cause detail, plus CrUX field data |
| Database | Neon (serverless Postgres) | Plain Postgres with no unused bundled features (chosen over Supabase, which bundles auth/REST/realtime this app doesn't need); autosuspends when idle; branching available for safe schema changes |
| Dashboard hosting | GitHub Pages | Static, free, lives in the same repo |
| Notifications | Slack incoming webhook | Simplest integration — a URL, no mail-provider setup |

### System architecture

```
GitHub Actions (scheduled: daily)
  |
  v
Scanner module
  - reads URL list
  - calls PSI API per URL x device (mobile, desktop)
  - parses Lighthouse result: CWV, perf score, console errors,
    deprecations, render-blocking resources, third-party summary, HTTP status
  - writes one row per (url, device, run_date) to Neon
  |
  v
Flagging module
  - applies Google's CWV thresholds
  - compares against trailing average to catch regressions, not just absolute breaches
  |
  v
Report generator (parameterized by date range)
  - default: today only (daily report)
  - also invoked with last-7-days / last-30-days (scheduled rollups)
  - also invoked with an arbitrary range (manual workflow_dispatch trigger)
  - queries Neon, renders Markdown -> HTML using the report language rules above
  |
  v
Dashboard builder
  - queries Neon for current status + trend series
  - builds static HTML/charts
  - publishes to gh-pages branch
  |
  v
Notifier
  - posts run summary + dashboard link to Slack via webhook
```

### Database schema (initial)

```sql
create table scan_results (
  id            bigserial primary key,
  url           text not null,
  page_type     text not null,       -- 'homepage' | 'category' | 'product'
  device        text not null,       -- 'mobile' | 'desktop'
  run_date      date not null,
  lcp_ms        integer,
  inp_ms        integer,
  cls           numeric,
  perf_score    integer,             -- Lighthouse performance score, 0-100
  http_status   integer,
  console_errors      jsonb,         -- [{ text, source }]
  deprecations        jsonb,         -- [{ text, source }]
  render_blocking     jsonb,         -- [url, ...]
  third_party_summary jsonb,         -- [{ domain, blockingTimeMs, transferSize }]
  raw_lighthouse_ref  text,          -- optional: pointer to full PSI response if archived separately
  created_at   timestamptz not null default now()
);

create index on scan_results (url, run_date);
create index on scan_results (run_date);
```

### PSI API integration notes

- Endpoint: `https://www.googleapis.com/pagespeedonline/v5/runPagespeed`
- Requires `key` (query param, from Google Cloud Console) and `strategy` (`mobile` | `desktop`)
- Rate limiting: stay well under quota, but add basic concurrency control (e.g. batches of 5-10 concurrent requests) rather than firing all 502 calls at once, to avoid transient PSI errors
- Handle PSI errors/timeouts per URL without failing the entire run — log and flag the URL as "scan failed," don't block the other 250

### Secrets / environment variables

| Name | Purpose | Status |
|---|---|---|
| `PSI_API_KEY` | PageSpeed Insights API key | **Not yet obtained** — needs a Google Cloud project with the API enabled |
| `NEON_DATABASE_URL` | Postgres connection string | **Not yet obtained** — needs a Neon project created |
| `SLACK_WEBHOOK_URL` | Incoming webhook for the notification channel | **Not yet obtained** — needs a Slack app/webhook created in the target workspace |

### Open dependencies (must resolve before first real run)

1. **URL list** — the 251 URLs (homepage, 50 categories, 200 products). User will supply an initial fixed list; sitemap-based auto-discovery was discussed but not committed to for v1.
2. **PSI API key** — to be created in Google Cloud Console.
3. **Neon project** — to be created; connection string added as a GitHub Actions secret.
4. **Slack webhook** — to be created in the target workspace/channel.
5. **GitHub remote** — this directory is not yet a git repository; needs `git init` plus a matching GitHub repo for Actions and Pages to function.

### Repo structure (proposed)

```
mk-site-speed-reporter/
  docs/
    project-spec.md        (this file)
    architecture.md        (added once build starts)
    changelog.md
    status.md
  src/
    scan/                  scanner module (PSI calls, parsing, DB writes)
    flag/                  thresholds + regression detection
    report/                report generator (date-range parameterized)
    dashboard/              static dashboard builder
    notify/                Slack notifier
    db/                    schema + query helpers
    urls.ts                 URL list (or loader, pending decision above)
  .github/
    workflows/
      daily-scan.yml
      weekly-rollup.yml
      monthly-rollup.yml
      custom-range-report.yml   (workflow_dispatch)
  .env.example
  CLAUDE.md
```

## Out of scope for v1 (revisit later)

- Screenshots / visual regression detection
- Sitemap-driven or CMS-API-driven automatic URL discovery
- Email delivery
- Accessibility/SEO drift as a first-class tracked metric (currently folded into the existing manual skill, not the automated scan)

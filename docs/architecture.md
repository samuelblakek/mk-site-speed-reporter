# Architecture

How the pieces actually fit together, as built. For the original design rationale and open decisions, see `docs/project-spec.md`.

## Data flow

```
src/urls.json                 the URL list (placeholders until the real 251 arrive)
     |
     v
src/scan/          PSI API call per (url, device) -> parses both the Lighthouse lab result
                    and the CrUX field data (loadingExperience/originLoadingExperience) ->
                    writes one row per (url, device, run_date) to Neon's scan_results table
     |
     v
src/flag/          pure computation over scan_results - no separate table. Prefers field
                    data (official thresholds) over lab data per-metric when available
                    (thresholds.ts, rules.ts); regression detection stays lab-based, comparing
                    each run to a trailing 7-run average (trailing.ts)
     |
     v
src/report/        queries scan_results + flags for a date range, renders Markdown to
                    reports/<label>.md, including an explicit lab-vs-field comparison
                    (generate.ts / render.ts, queries via src/db/queries.ts)
     |
     v
src/dashboard/      converts reports/*.md to site/reports/*.html (via marked), builds
                    site/index.html (stat tiles, two-series trend charts with hover,
                    snapshot table) against the dataviz skill's validated palette and mark
                    specs, merging in links to previously-published reports it didn't
                    regenerate
     |
     v
GitHub Actions      publishes site/ to the gh-pages branch (peaceiris/actions-gh-pages,
                    keep_files: true so old reports aren't deleted by the next deploy)
```

## Modules

| Module | Entry point | Depends on |
|---|---|---|
| `src/db` | `client.ts` (pool + type parsers), `queries.ts` (shared scan_results queries), `migrate.ts`, `schema.sql` | Neon connection string |
| `src/scan` | `index.ts` (CLI), `pagespeed.ts` (PSI client + lab/field parser) | PSI API key, `src/db` |
| `src/flag` | `index.ts` (CLI), `thresholds.ts`, `trailing.ts`, `rules.ts` | `src/db` |
| `src/report` | `index.ts` (CLI), `generate.ts`, `render.ts` | `src/flag`, `src/db` |
| `src/dashboard` | `index.ts` (CLI), `build.ts`, `theme.ts` (palette/CSS), `lineChart.ts` (SVG chart + hover) | `src/db`, `src/flag`, `marked` |

`src/db/queries.ts` is the single source of truth for the `scan_results` column list - both `flag/index.ts` and `report`/`dashboard` query through it. It used to be duplicated (a copy lived in `flag/index.ts`, another in what was `report/queries.ts`); when the field-data columns were added, that duplication was a real risk of the new columns being present in one query and silently missing from the other. Consolidated to one shared query before that could happen, rather than fixing each callsite separately.

Each module's CLI entrypoint is independently runnable (`bun src/scan/index.ts`, etc. locally; `tsx` via `npm run <script>` in CI) - there's no orchestration layer beyond the GitHub Actions workflow steps calling them in sequence.

## Why a few things aren't obvious from the code

- **DATE and NUMERIC columns get custom type parsers in `src/db/client.ts`.** `node-postgres` otherwise returns `DATE` as a JS `Date` at local midnight (which shifts by a day through `.toISOString()` under a non-UTC timezone) and `NUMERIC` as a string (to avoid float precision loss) - both were real bugs caught during verification, not preemptive hardening.
- **The flagging module has no database table of its own.** Flags are computed fresh from `scan_results` every time they're needed, so changing threshold logic doesn't require a backfill.
- **`render-blocking-insight` / `third-parties-insight` are checked alongside the older `render-blocking-resources` / `third-party-summary` audit IDs** in `src/scan/pagespeed.ts` - Lighthouse 13 renamed these audits partway through this project; both keys are checked so a future Lighthouse version bump doesn't silently break parsing again.
- **The dashboard doesn't regenerate old reports - it links them.** Each GitHub Actions run only has this run's freshly-generated Markdown locally. Historical HTML reports persist on the `gh-pages` branch via `keep_files: true`; the dashboard build step checks out that branch into `previous-site/` first so it can still list them.
- **TBT, not INP, is stored in the `inp_ms` column** (that's the lab measurement). Real INP lives in `field_inp_ms`, sourced from PSI's `loadingExperience`/`originLoadingExperience` (Chrome UX Report field data). The two use different thresholds (`rateTbtProxy` vs `rateInp` in `src/flag/thresholds.ts`) and are never conflated in report/dashboard text.
- **Flagging prefers field data over lab data per-metric, not per-row.** A single page can have field LCP but no field CLS (or vice versa) depending on what CrUX actually measured - each metric falls back to lab independently rather than an all-or-nothing choice. See `src/flag/rules.ts`.
- **`field_data_source` distinguishes 'page' from 'origin'.** Most category/product pages won't individually qualify for CrUX (needs enough Chrome traffic); PSI falls back to site-wide (origin) data for those. The report and dashboard always say which one they're showing.
- **Regression detection stayed lab-based when field data was added**, deliberately - CrUX field data is already a rolling 28-day aggregate, so day-over-day regression comparisons on it would be comparing mostly-overlapping windows, not meaningfully independent samples.
- **The dashboard's colors and chart specs come from the `dataviz` skill, not ad hoc choices.** The categorical (mobile/desktop) and status (good/warning/serious/critical) palettes in `src/dashboard/theme.ts` were validated with the skill's `scripts/validate_palette.js` before use - re-run it if either palette ever changes. Status colors always ship with an icon + text label (`severityToStatusRole` collapses "regression" and "needs-improvement" onto the same warning color, distinguished by their label text, since the fixed status system only has 4 roles).
- **Trend charts are one two-series chart per metric, not two single-series charts.** Mobile and desktop share a unit and scale, so per the skill's "one axis" rule they belong on the same chart with a legend, not side-by-side separate charts - the first version of the dashboard got this wrong.

## Not yet built

Slack notifier - deliberately deferred to last. Everything above runs and has been verified against real data (Neon + PSI + the real homepage); the GitHub Actions workflows themselves have been YAML-validated but not yet exercised on a real runner.

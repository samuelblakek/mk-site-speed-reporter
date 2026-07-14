# Architecture

How the pieces actually fit together, as built. For the original design rationale and open decisions, see `docs/project-spec.md`.

## Data flow

```
src/urls.json                 the URL list (placeholders until the real 251 arrive)
     |
     v
src/scan/          PSI API call per (url, device) -> parses Lighthouse response -> writes
                    one row per (url, device, run_date) to Neon's scan_results table
     |
     v
src/flag/          pure computation over scan_results - no separate table. Applies CWV
                    thresholds (thresholds.ts) and compares each run to a trailing 7-run
                    average (trailing.ts) to catch regressions (rules.ts)
     |
     v
src/report/        queries scan_results + flags for a date range, renders Markdown to
                    reports/<label>.md (queries.ts / generate.ts / render.ts)
     |
     v
src/dashboard/      converts reports/*.md to site/reports/*.html (via marked), builds
                    site/index.html (summary cards, trend sparklines, snapshot table),
                    merging in links to previously-published reports it didn't regenerate
     |
     v
GitHub Actions      publishes site/ to the gh-pages branch (peaceiris/actions-gh-pages,
                    keep_files: true so old reports aren't deleted by the next deploy)
```

## Modules

| Module | Entry point | Depends on |
|---|---|---|
| `src/db` | `client.ts` (pool), `migrate.ts`, `schema.sql` | Neon connection string |
| `src/scan` | `index.ts` (CLI), `pagespeed.ts` (PSI client + parser) | PSI API key, `src/db` |
| `src/flag` | `index.ts` (CLI), `thresholds.ts`, `trailing.ts`, `rules.ts` | `src/db` |
| `src/report` | `index.ts` (CLI), `generate.ts`, `render.ts`, `queries.ts` | `src/flag`, `src/db` |
| `src/dashboard` | `index.ts` (CLI), `build.ts`, `sparkline.ts` | `src/report` (queries), `src/flag`, `marked` |

Each module's CLI entrypoint is independently runnable (`bun src/scan/index.ts`, etc. locally; `tsx` via `npm run <script>` in CI) - there's no orchestration layer beyond the GitHub Actions workflow steps calling them in sequence.

## Why a few things aren't obvious from the code

- **DATE and NUMERIC columns get custom type parsers in `src/db/client.ts`.** `node-postgres` otherwise returns `DATE` as a JS `Date` at local midnight (which shifts by a day through `.toISOString()` under a non-UTC timezone) and `NUMERIC` as a string (to avoid float precision loss) - both were real bugs caught during verification, not preemptive hardening.
- **The flagging module has no database table of its own.** Flags are computed fresh from `scan_results` every time they're needed, so changing threshold logic doesn't require a backfill.
- **`render-blocking-insight` / `third-parties-insight` are checked alongside the older `render-blocking-resources` / `third-party-summary` audit IDs** in `src/scan/pagespeed.ts` - Lighthouse 13 renamed these audits partway through this project; both keys are checked so a future Lighthouse version bump doesn't silently break parsing again.
- **The dashboard doesn't regenerate old reports - it links them.** Each GitHub Actions run only has this run's freshly-generated Markdown locally. Historical HTML reports persist on the `gh-pages` branch via `keep_files: true`; the dashboard build step checks out that branch into `previous-site/` first so it can still list them.
- **TBT, not INP, is stored in the `inp_ms` column.** True INP requires real user interaction and can't be measured in an automated lab run. Total Blocking Time is the standard lab proxy, but it has different thresholds from real INP - `src/flag/thresholds.ts` and every report message say "TBT, lab proxy for INP" rather than presenting it as INP outright.

## Not yet built

Slack notifier - deliberately deferred to last. Everything above runs and has been verified against real data (Neon + PSI + the real homepage); the GitHub Actions workflows themselves have been YAML-validated but not yet exercised on a real runner.

# Status

## Milestone: v1 - daily automated scan + dashboard + Slack notification

**Where we are:** Everything except the Slack notifier is built and verified end-to-end against real data (Neon + PSI + the real homepage). Scan -> flag -> report -> dashboard all run correctly locally with real credentials. After the first real dashboard was live, Samuel flagged two things: the UI needed real design work, and whether real-user network conditions were being considered at all - they weren't. Both are now fixed: flagging/reports/dashboard prefer Chrome UX Report (CrUX) field data over lab data when available, and the dashboard was rebuilt against the `dataviz` skill's validated palette and mark specs (see changelog for both). The one remaining manual step before this runs for real on a schedule is enabling GitHub Pages (branch-based, see `docs/project-spec.md` "GitHub Pages deployment").

**Blocked on (external dependencies - see `docs/project-spec.md` "Open dependencies"):**
- [x] PSI API key (Google Cloud Console) - stored as `PSI_API_KEY` GitHub Actions secret and locally in `.env`
- [x] Neon project + connection string - stored as `NEON_DATABASE_URL` GitHub Actions secret and locally in `.env` (Postgres 18)
- [ ] Slack incoming webhook URL - deferred to the very end per Samuel's instruction, not blocking anything else
- [ ] The 251-URL list (homepage + 50 categories + 200 products) from Samuel - homepage confirmed as https://www.menkind.co.uk/, categories/products still to come; `src/urls.json` uses placeholder entries (duplicating the homepage URL) until the full list arrives
- [x] GitHub remote for this repo - https://github.com/samuelblakek/mk-site-speed-reporter
- [ ] **New:** enable GitHub Pages on the repo (Settings -> Pages -> Source: "Deploy from a branch" -> `gh-pages` -> `/ (root)`). The `gh-pages` branch doesn't exist until the first workflow run creates it, so this has to happen after the first successful `daily-scan` run (or a manual `workflow_dispatch` of it).

**Done:**
- [x] Node/TypeScript project scaffold (`package.json`, `tsconfig.json`)
- [x] Database schema migration (`scan_results` table) - applied to Neon
- [x] Scanner module (PSI API integration) - `src/scan/pagespeed.ts` + `src/scan/index.ts`. Note: Lighthouse 13 renamed two audits from what the spec assumed (`render-blocking-resources` -> `render-blocking-insight`, `third-party-summary` -> `third-parties-insight`); the parser checks both old and new keys for resilience against future Lighthouse version changes.
- [x] Flagging module (CWV thresholds + regression detection) - `src/flag/`. Regression flags require >=3 prior runs and a >=20% swing to fire. Prefers real-user CrUX field data over lab data when available (official INP thresholds, not just the TBT proxy); falls back to lab data per-metric when no field data exists.
- [x] Report generator (date-range parameterized) - `src/report/`. `npm run report` (today), `report:weekly` (last 7 days), `report:monthly` (last 30 days), or `report -- range <start> <end>` for any range. Writes Markdown to `reports/<label>.md` following the report-content language rules in `docs/project-spec.md` (specifics for every count, attribution, fact vs inference, rationale-ordered recommendations, glossary, references). Includes a "Lab Data vs Real-User Field Data" section that explicitly calls out disagreements rather than silently picking one.
- [x] Dashboard builder (GitHub Pages) - `src/dashboard/`. Built against the `dataviz` skill: validated categorical/status palette (`scripts/validate_palette.js`, all checks passing in light and dark), multi-series line charts (mobile+desktop on one axis, not two separate charts) with a hover crosshair+tooltip, status badges (icon+label+color, never color alone), stat tiles. Verified in-browser via computed-style and interaction checks (screenshot capture was broken at the tool/environment level this session, not the page - console clean, network clean, DOM structurally correct, computed colors matched the validated palette exactly in both light and dark).
- [x] GitHub Actions workflows - `.github/workflows/{daily-scan,weekly-rollup,monthly-rollup,custom-range-report}.yml`. Publish via `peaceiris/actions-gh-pages` with `keep_files: true` so historical reports persist across deployments (each run checks out the current `gh-pages` branch into `previous-site/` first so the dashboard can link, without regenerating, reports from earlier runs). YAML validated with PyYAML; **not yet exercised on a real GitHub Actions runner** - that only happens once pushed and either triggered manually or hit by the cron schedule.

**Not started:**
- [ ] Slack notifier - deliberately last, per Samuel's instruction

**Next session should:** build the Slack notifier (skip gracefully if `SLACK_WEBHOOK_URL` is unset, per `CLAUDE.md` constraints), wire it into the four workflows, then push everything, enable GitHub Pages, and do a real end-to-end run on GitHub's infrastructure to confirm the workflows behave as expected outside local testing.

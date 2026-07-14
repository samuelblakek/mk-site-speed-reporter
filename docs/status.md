# Status

## Milestone: v1 - daily automated scan + dashboard + Slack notification

**Where we are:** Scanner and flagging modules built and verified end-to-end against the real homepage (https://www.menkind.co.uk/) with real Neon storage. Current flagged state: mobile is poor across LCP/TBT/perf score (9.8s / 2.9s / 28), desktop is needs-improvement on TBT/perf score (600ms / 67) - and the scan already surfaced a genuine bug: `OpenSans-Bold.woff` and `OpenSans-SemiBold.woff` both 404 on the homepage. Regression detection logic verified against synthetic history (inserted then removed - not part of real trend data).

**Blocked on (external dependencies - see `docs/project-spec.md` "Open dependencies"):**
- [x] PSI API key (Google Cloud Console) - stored as `PSI_API_KEY` GitHub Actions secret and locally in `.env`
- [x] Neon project + connection string - stored as `NEON_DATABASE_URL` GitHub Actions secret and locally in `.env` (Postgres 18)
- [ ] Slack incoming webhook URL - deferred for now, not blocking initial build
- [ ] The 251-URL list (homepage + 50 categories + 200 products) from Samuel - homepage confirmed as https://www.menkind.co.uk/, categories/products still to come; `src/urls.json` uses placeholder entries (duplicating the homepage URL) until the full list arrives
- [x] GitHub remote for this repo - https://github.com/samuelblakek/mk-site-speed-reporter

**Done:**
- [x] Node/TypeScript project scaffold (`package.json`, `tsconfig.json`)
- [x] Database schema migration (`scan_results` table) - applied to Neon
- [x] Scanner module (PSI API integration) - `src/scan/pagespeed.ts` + `src/scan/index.ts`, verified against live PSI responses. Note: Lighthouse 13 renamed two audits from what the spec assumed (`render-blocking-resources` -> `render-blocking-insight`, `third-party-summary` -> `third-parties-insight`); the parser checks both old and new keys for resilience against future Lighthouse version changes.
- [x] Flagging module (CWV thresholds + regression detection) - `src/flag/thresholds.ts` (rating bands), `src/flag/trailing.ts` (trailing 7-run average query), `src/flag/rules.ts` (flag logic), `src/flag/index.ts` (runnable entrypoint, `bun src/flag/index.ts [run_date]`). Regression flags require >=3 prior runs and a >=20% swing to fire, both verified against synthetic history.

**Not started:**
- [ ] Report generator (date-range parameterized)
- [ ] Dashboard builder (GitHub Pages)
- [ ] Slack notifier
- [ ] GitHub Actions workflows: daily scan, weekly rollup, monthly rollup, custom-range trigger

**Next session should:** build the report generator (reuse `flagScanResult` + the report-content language rules from `docs/project-spec.md`), and keep pushing on getting the real 251-URL list so the placeholder entries in `src/urls.json` can be replaced.

# Status

## Milestone: v1 - daily automated scan + dashboard + Slack notification

**Where we are:** Scanner module built and verified end-to-end against the real homepage (https://www.menkind.co.uk/) with real Neon storage. First real data point on record: mobile LCP 9.8s / perf score 28 (poor) vs desktop LCP 1.5s / perf score 67 - and the scan already surfaced a genuine bug: `OpenSans-Bold.woff` and `OpenSans-SemiBold.woff` both 404 on the homepage.

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

**Not started:**
- [ ] Flagging module (CWV thresholds + regression detection)
- [ ] Report generator (date-range parameterized)
- [ ] Dashboard builder (GitHub Pages)
- [ ] Slack notifier
- [ ] GitHub Actions workflows: daily scan, weekly rollup, monthly rollup, custom-range trigger

**Next session should:** build the flagging module against the `scan_results` data now in Neon, and keep pushing on getting the real 251-URL list so the placeholder entries in `src/urls.json` can be replaced.

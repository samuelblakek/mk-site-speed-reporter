# Status

## Milestone: v1 - daily automated scan + dashboard + Slack notification

**Where we are:** Project spec finalized, repo scaffolded. No application code yet.

**Blocked on (external dependencies - see `docs/project-spec.md` "Open dependencies"):**
- [ ] PSI API key (Google Cloud Console)
- [ ] Neon project + connection string
- [ ] Slack incoming webhook URL
- [ ] The 251-URL list (homepage + 50 categories + 200 products) from Samuel
- [ ] GitHub remote for this repo (Actions/Pages need it)

**Not started:**
- [ ] Node/TypeScript project scaffold (`package.json`, `src/` modules per architecture doc)
- [ ] Database schema migration (`scan_results` table)
- [ ] Scanner module (PSI API integration)
- [ ] Flagging module (CWV thresholds + regression detection)
- [ ] Report generator (date-range parameterized)
- [ ] Dashboard builder (GitHub Pages)
- [ ] Slack notifier
- [ ] GitHub Actions workflows: daily scan, weekly rollup, monthly rollup, custom-range trigger

**Next session should:** check whether the blocked-on items above have been resolved before starting the Node project scaffold - the scanner module needs at least the PSI key and URL list to be testable end-to-end.

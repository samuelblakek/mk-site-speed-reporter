# Changelog

## 2026-07-14

- Drafted project spec (`docs/project-spec.md`) via `/grill-me` interview: architecture, tech stack, database schema, and open dependencies finalized.
- Initialized git repo, added `.gitignore`, `.env.example`, project `CLAUDE.md`.
- Scaffolded Node/TypeScript project (`package.json`, `tsconfig.json`).
- Built and applied the `scan_results` Postgres migration to Neon (`src/db/schema.sql`, `src/db/migrate.ts`).
- Built the scanner module (`src/scan/pagespeed.ts`, `src/scan/index.ts`) - calls PSI for each URL x device with basic concurrency limiting, per-URL error isolation, and writes results to Neon.
- Verified end-to-end against the real homepage (https://www.menkind.co.uk/): fixed two bugs found during verification - non-integer Lighthouse ms values needed rounding before insert, and Lighthouse 13 renamed `render-blocking-resources`/`third-party-summary` to `render-blocking-insight`/`third-parties-insight` (parser now checks both). Also fixed console-error/deprecation "source" extraction, which was reading a category label instead of the actual source URL.
- Built the flagging module (`src/flag/`): Google's official CWV rating bands for LCP/CLS, Lighthouse's own bands for performance score, and a documented TBT-as-INP-lab-proxy band kept separate from the real INP thresholds. Regression detection compares each run against a trailing 7-run average, flagging swings of 20%+ once at least 3 prior runs exist. Verified both the threshold and regression paths against real and synthetic data.

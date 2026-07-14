# mk-site-speed-reporter

Automated Core Web Vitals / site-speed monitoring for the storefront: daily scan of the homepage, 50 categories, and 200 product pages via the PageSpeed Insights API, with trend history and a report developers actually see.

Full spec: [docs/project-spec.md](docs/project-spec.md). Architecture detail: [docs/architecture.md](docs/architecture.md) (added once build starts). Progress: [docs/status.md](docs/status.md).

## Stack

Node.js/TypeScript, GitHub Actions (scheduling + CI), Neon (Postgres), PageSpeed Insights API, GitHub Pages (dashboard), Slack incoming webhook (notifications).

## Constraints

- No screenshots/visual regression in v1 - deep-dive on flagged pages happens manually via the existing `website-analysis` skill, not this pipeline.
- Report language must follow the existing skill's rules: no hyperbole, every count backed by a specific list, metrics attributed to their source page/device, inference labeled as inference. See `docs/project-spec.md` "Report content rules."
- Stay well under the PSI free quota (25k requests/day); this app uses ~502/day. Add basic concurrency limiting, don't fire all requests at once.
- A single failed URL scan must not fail the whole run - log and flag it, continue with the rest.

## Repo etiquette

- One branch per feature, PR against `main`.
- Update `docs/changelog.md` and `docs/status.md` after completing a feature.
- Update `docs/architecture.md` and this file after reaching a milestone.
- Secrets (`PSI_API_KEY`, `NEON_DATABASE_URL`, `SLACK_WEBHOOK_URL`) live in GitHub Actions secrets, never committed. See `.env.example` for local dev.

## Build / test

- Install: `npm install` (CI/Node) or `bun install` (local dev on this machine - Node/npm aren't on PATH here, only Bun is).
- Typecheck: `bunx tsc --noEmit` (or `npx tsc --noEmit` where npm is available).
- Run migration: `npm run migrate` (Node/CI) or `bun src/db/migrate.ts` (local - Bun doesn't support the `tsx` loader hook, so invoke the file directly rather than via `bun run migrate`).
- Run a scan: `npm run scan` (Node/CI) or `bun src/scan/index.ts` (local, same reason as above).
- Requires a local `.env` (gitignored, copy from `.env.example`) with real `PSI_API_KEY` and `NEON_DATABASE_URL` values to run against real services.

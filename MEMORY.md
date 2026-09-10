# Vantage — durable project memory

> Updated 10 September 2026. This is an AI-oriented handoff, not an authority file. Current code, tests, `CONTEXT.md`, and the exact release receipt win when they disagree with an older note.

## Why this exists

Vantage answers product-analytics questions while keeping the answer auditable. The model can propose one of five typed `QuerySpec` shapes—funnel, count, retention, trend, or paths. It cannot write SQL. Pure compilers produce parameterized `SELECT` statements, which run through PostgreSQL's `vantage_reader` role in a read-only transaction with a five-second timeout and row caps. The UI always keeps spec, exact SQL, status, watermark, and result together. Eight stdio MCP tools expose only bounded read operations; there is no `run_sql` and no MCP Ask tool.

## User-visible flows

1. Choose a project. Create/rotate is an admin write and is bearer-gated on the public demo.
2. Ingest events with a project key. `(project_id, insert_id)` makes retries idempotent; a deterministic derived key covers omitted IDs.
3. Use Ask for supported/canned or configured-model questions. Inspect, edit, and re-run all five spec kinds; hostile or invalid model output is refused before SQL exists.
4. Build Funnel, Retention, Paths, or Trend queries manually. Count remains part of the shared/API grammar and Ask result surface.
5. Inspect Events and Ask History, including raw model output, decision, spec, SQL, result status, and elapsed time.
6. Copy an ingest snippet, review the MCP configuration and eight tools, and re-check Health.
7. Use every route and global control with keyboard or pointer at desktop and 320 px.

## Architecture map

```text
React/Vite SPA -> Nest HTTP contracts -> domain service -> pure compiler
                                             |               |
                                             |               +-> parameterized SELECT only
                                             +-> audit log
event SDK -> validation/normalization -> write pool -> PostgreSQL 17
MCP stdio -> eight typed read tools -> same insights service/read pool
release build -> VANTAGE_RELEASE_SHA -> /health.release_sha
```

- `packages/contracts/src`: Zod schemas shared by UI, API, compiler, and MCP.
- `apps/api/src/domain/compile`: semantic algorithms and SQL generation; no external I/O.
- `apps/api/src/modules`: HTTP/MCP feature boundaries.
- `apps/api/src/infra`: config, pools, model adapters, transactions, timeout/cap enforcement.
- `apps/web/src`: ten route views, shared query/result components, project context, display preferences.
- `apps/api/test`, `apps/web/test`, `apps/web/e2e`: contract, algorithm, integration, component, browser, responsive, and accessibility evidence.

## Non-negotiable decisions

- Never add an arbitrary SQL escape hatch. Model text stops at Zod validation.
- Keep Ask away from the write pool and analytics away from model adapters; dependency linters enforce this.
- Keep project scope, time zone, first occurrence, conversion window, identity stitching, watermark, timeout, and truncation semantics explicit and fixture-backed.
- Do not log raw secrets or auth headers. Project keys are shown only at create/rotate and stored hashed.
- MCP stays read-only and independently protocol-tested; the MCP UI transcript is illustrative.
- `VANTAGE_LLM=none` proves deterministic product flow, not general model quality.
- A green local tree is not deployed. A release requires local reviewed HEAD = public main = live `/health.release_sha`, plus image/release and live smoke evidence.

## Release closure completed in this pass

- Removed a stale QueryCard guard that rejected valid edited Trend and Paths specs; one total switch now routes all five grammar kinds to their matching API endpoint.
- Added focused Trend/Paths re-run component tests.
- Added a production-browser CTA audit for all ten routes, theme/transparency/rail, four manual analytics builders, SQL disclosures, Events/history actions, Ask/history, project snippet tabs/copy/refresh, Health re-check, and 320 px semantic integrity.
- Added exact release provenance through config, Nest DI, `/health`, the Health UI, Docker OCI metadata, and both GitHub/Fly release build paths.
- Preserved backward compatibility during rolling deploys: a missing or malformed legacy release receipt renders as `local build`.

## Verification baseline

- `npm run check`: 834 distinct cases—680 API/contracts/integration, 139 web, 15 production PostgreSQL/Chromium workflows—with all coverage floors passed.
- `npm run bench`: three 200k-event budget assertions passed. Thresholds are funnel 800 ms, retention 1,200 ms, paths 1,200 ms; calibrated reference measurements are 216/319/633 ms.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- Bounded prior local Lighthouse: performance 99, accessibility 100, SEO 100, LCP 1.7 s, TBT 0 ms, CLS 0.
- Bounded read probe: 80/80 catalog reads at concurrency four, p50 5 ms, p95 12 ms, 197 ms total.
- Local Docker Desktop was unavailable in the final pass. Do not claim a local Docker smoke; the Fly remote build and exact live receipt are the release-container evidence.

## How to run and study

Read in this order: this file → `CONTEXT.md` → Study Pack `01` concepts → `docs/01-DESIGN.md` and `docs/02-LLD.md` → contracts and compilers → API modules/infra/migrations → web and MCP surfaces → Study Pack `03` TypeScript/system-design walkthrough → `docs/SANITY.md`, `docs/VERIFICATION.md`, and `docs/DEPLOY.md`.

Run in this order:

```powershell
npm ci
npm run docs:check
npm run check
npm run bench
npm audit --omit=dev --audit-level=high
```

For a release, pass full HEAD as `VANTAGE_RELEASE_SHA`, deploy, then prove public main and `/health.release_sha` equal that HEAD. The machine-readable and human sign-off files live under `verification-work\portfolio-release-20260910`.

## Honest limits

No field Core Web Vitals, full browser/device matrix, long soak, large production load, restore drill, multi-region failover, per-user authentication/RBAC, tenant isolation, authenticated Claude Desktop session, or live Anthropic/Ollama quality evaluation was established. The public demo intentionally keeps admin writes protected and currently uses `VANTAGE_LLM=none`.

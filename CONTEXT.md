# Vantage — current implementation context

> Evidence snapshot updated 10 September 2026 IST. Canonical repository: `D:\Code\Vantage`; local `main` carries lazy-load candidate `82d537a42bcdc472826dd1fcafca58dd004c198c` plus this documentation update and is two commits ahead of public `main` and the verified Fly v18 release at `1b721fc1982bd03e4ac01527c3cfb635ada2fc39`. A current anonymous `/health` request returned 200 but exposes no release SHA. The local lazy-load candidate is not pushed or deployed.
>
> This is the short, AI-readable map. Current source and executable tests win if an older design note disagrees. A dirty working tree is a candidate, not a release; a configured URL is not proof that the candidate is deployed.

## Product contract

Vantage is an auditable product-analytics system for event ingestion, funnels, retention, trends, paths, counts, and project management. A model may propose a typed `QuerySpec`; it cannot emit or execute SQL. The pure compiler creates parameterized `SELECT` statements, which run through a bounded read-only PostgreSQL role. The React UI returns the normalized spec, exact SQL, and result together. A stdio MCP server exposes bounded read-only analytics tools. The deployed app currently runs with `VANTAGE_LLM=none`, so canned Ask examples do not prove free-form LLM quality.

## Architecture and end-to-end flow

```text
event producer -> validated ingest contract -> normalization/idempotency -> PostgreSQL
Ask text -> selected adapter (or deterministic none) -> Zod QuerySpec
         -> pure compiler -> parameterized SELECT
         -> read-only transaction + 5 s timeout + row caps
         -> result + exact spec/SQL + audit metadata
```

Shared Zod contracts connect the React client, Nest API, compiler, and MCP surface. `(project_id, insert_id)` provides retry idempotency; a stable derived ID is used when callers omit one. Lint boundaries prevent Ask from obtaining the write pool and analytics modules from calling a model. Analytics semantics explicitly define project scope, time zone, bucket boundaries, first occurrence, conversion windows, identity stitching, and processing watermark.

## Code map

| Path | Responsibility |
| --- | --- |
| `packages/contracts/src` | public Zod contracts for ingest, projects, analytics, Ask, results, and MCP |
| `apps/api/src/domain/compile` | pure typed-spec to parameterized-SQL compilers and SELECT-only checks |
| `apps/api/src/modules` | ingest, identity, insights, Ask, audit, events, projects, MCP, health, and auth |
| `apps/api/src/infra` | read-only runner, transactions, limits, config, HTTP, and model adapters |
| `apps/api/migrations; apps/api/fixtures` | PostgreSQL roles/schema/indexes and stable hand-computed analytics fixture |
| `apps/web/src` | ten-route React UI, project state, forms, SQL/spec/result panels, and error states |
| `apps/api/test; apps/web/test; apps/web/e2e` | unit, integration, component, and real-browser contracts |
| `docs/VERIFICATION.md; docs/DEPLOY.md` | current local evidence and release mapping/operations |

## Invariants and trust boundaries

- Model output ends at validated `QuerySpec`; it cannot supply SQL syntax, identifiers, operators, or arbitrary expressions.
- Only the compiler creates parameterized SELECT SQL; execution uses `vantage_reader`, a read-only transaction, timeout, and row cap.
- Ingest retries for the same project/insert ID cannot double-count; normalization and derived identity must be stable.
- Time zone, identity merge, first occurrence, conversion window, and bucket semantics require fixture-backed tests.
- Raw API keys are shown only at create/rotate boundaries; stored keys are hashed and auth headers are never logged.
- MCP is read-only and intentionally has neither generic SQL nor model-backed Ask.

## User workflows to preserve

- Select/create a project; switch/copy ingest snippets; load the August fixture; rotate a key; inspect empty and error states.
- Submit supported and hostile Ask text; inspect/edit the spec, run/cancel, inspect exact SQL/result, and open History.
- Configure and run funnel, retention, trend, path, and count analyses with time/project boundaries and result/empty/error states.
- Browse Events and keyboard-select event details/properties; use all ten keyboard routes: Ask, Funnel, Retention, Paths, Trend, Events, History, Projects, MCP, Health.
- Exercise real stdio MCP protocol tests separately from the illustrative MCP page.
- Verify all routes and top-bar controls at 390 px without page-level overflow.

## Concepts this project teaches

| Concept | How it appears here |
| --- | --- |
| DSL and compiler boundary | a small typed query language constrains model intent before SQL exists |
| Least-privilege databases | separate owner/write/read roles and read-only transactions reduce blast radius |
| Idempotent ingestion | stable insert keys make retries safe |
| Analytics semantics | funnels, cohorts, retention, paths, buckets, and identity merges are explicit algorithms |
| Defense in depth | Zod validation, pure compiler, SQL scanner, parameters, role, timeout, and caps overlap |
| MCP boundaries | stdio tools expose typed read-only operations without generic execution authority |

## CI, packaging, deployment, and rollback

Run `npm run docs:check`, `npm run check`, `npm run bench`, `npm run build`, and `npm run web:build`; build/smoke Docker for a release. CI runs type/lint/boundary, API/contracts/integration, web/browser, and production dependency gates. Release automation can deploy Fly from a successful `main` CI when `FLY_API_TOKEN` exists; the guide's manual path uses `fly deploy --app vantage-abheet --remote-only --depot=false`. Required database/query/admin secret names are documented without values.

Fly v18 is verified at `1b721fc...` and reports the deterministic `VANTAGE_LLM=none` boundary. Local `82d537a...` lazy-loads nine secondary web routes and passed the named local candidate gates, but it is not published or deployed. For every release, run migrations and gates at one commit, then record source/image/release/machine plus post-deploy health, auth refusal, Ask/spec/SQL/result, route, MCP-boundary, and rollback evidence.

## Current measured evidence

| Result | Evidence |
| --- | --- |
| Exact `82d537a...` gate passed: 678 API/contracts/integration + 135 web + 12 PostgreSQL/Chromium workflows; all coverage gates passed | `verification-work\vantage-glass-perf-20260910\VANTAGE_GLASS_FIX_EVIDENCE.md` |
| 22 independent desktop scenarios + 24 phone checks, zero page errors | `D:\Code\Vantage\docs\VERIFICATION.md` |
| Bounded local Lighthouse: 99 performance, 100 accessibility, 100 SEO, 1.7 s LCP, 0 CLS | `D:\Code\Vantage\docs\VERIFICATION.md` |
| Fly v18/public `main` are `1b721fc...`; verified local lazy-load candidate `82d537a...` is unpublished | `verification-work\portfolio-release-20260910\PORTFOLIO_RELEASE_DASHBOARD.md; D:\Work\Vantage Study Pack\08_TESTING_ARTIFACT.md` |

The evidence above belongs to the named local working-tree snapshot unless it explicitly names a release/image. It does not become live evidence merely because a deployment configuration exists.

## Open limits

- The public canned Ask path does not prove Anthropic/Ollama availability, accuracy, grounding, or spend behavior.
- A shared admin gate is not per-user authentication, RBAC, or tenant isolation.
- No arbitrary SQL endpoint exists by design; do not add one for convenience.
- Local Lighthouse and tests do not establish field Core Web Vitals, internet-scale ingestion, database failover, backup restore, or multi-region operation.
- A new commit is not a deployed release until the release metadata and post-deploy probes map to that exact SHA.

## Reading order

1. `CONTEXT.md` — current trust and release boundary
2. `D:\Work\Vantage Study Pack\01_Vantage_Concepts_From_Zero.md` — analytics, SQL, API, and security vocabulary
3. `docs/01-DESIGN.md; docs/02-LLD.md` — domain semantics, boundaries, and implementation slices
4. `packages/contracts; apps/api/src/domain/compile` — typed language and compiler
5. `apps/api/src/modules; apps/api/src/infra; apps/api/migrations` — HTTP, storage, roles, and model boundary
6. `apps/web/src; packages MCP entry points` — user and tool surfaces
7. `D:\Work\Vantage Study Pack\03_Vantage_System_Design_DSA_TypeScript_Walkthrough.md` — system design and code-to-deploy
8. `docs/SANITY.md; docs/VERIFICATION.md; docs/DEPLOY.md` — run and release evidence

Use `docs/SANITY.md` in the repository, or `09_SANITY_CHECK.md` in the Study Pack, before claiming that a new change works.

## Rules for the next coding agent

1. Never let model text cross the typed-spec boundary into SQL syntax.
2. Keep Ask away from the write pool and analytics away from model adapters; preserve lint enforcement.
3. Treat analytics semantics as public contracts and change them only with hand-computed fixture tests.
4. Keep API keys hashed, logs payload-safe, MCP read-only, and time/row bounds explicit.
5. Keep local, CI, image, and Fly evidence separate; do not call a candidate deployed until all four map to one commit.

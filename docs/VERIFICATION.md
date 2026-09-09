# Vantage — verification companion, 2026-09-10

Auditable product analytics: ingest retry-safe events, inspect funnels/retention/trends/paths, and review the exact typed specification and read-only SQL behind each result.

The Study Pack's release ledger records the exact pushed SHA, Fly image, health check, and post-deploy browser evidence. This source companion records reproducible checks without treating an uncommitted checkout as a release.

**Configured release check:** `npm run check` passed again on Windows on 2026-09-10. It ran 825 distinct cases: 678 API/contracts/integration, 135 web component/helper, and 12 Playwright browser cases. All configured coverage gates passed. `npm run docs:check` separately passed all 10 documents. Count runner-reported cases rather than grepped declarations or property iterations.

**Production dependency audit:** `npm audit --omit=dev` reports zero vulnerabilities. Nest 12.0.1 pins Multer 2.2.0, so the root lockfile override resolves its shipped transitive dependency to patched Multer 2.3.0; Vantage exposes no multipart/upload controller, the full API/web/browser gate passed with the override, and CI now fails on any known high/critical production advisory.

**Changes verified:** Events, project selection, and history detail actions are keyboard-focusable buttons. At 390 px all ten routes load without page-wide overflow; Ask, theme, transparency, rail, and keyboard event selection remain usable. The Events panels stack and the compact event rows retain their count and first/last-seen dates. The funnel date-range fix remains covered by default-range and invalid-range recovery, and the embedded PostgreSQL harness still cleans up transient Windows handles.

**Independent exploration:** 22 desktop scenarios passed with zero page errors at `2026-09-09T16:43:45.273Z`; a separate phone audit passed 24 checks across all ten routes at 390 px with zero page errors at `2026-09-09T17:04:58.837Z`. Source scripts, screenshots, and raw JSON remain in the local verification workspace; those files are evidence, not part of the product bundle.

**Bounded Lighthouse check:** Chrome's mobile profile against the local production build measured 99 performance, 100 accessibility, 100 SEO, 1.5 s FCP, 1.7 s LCP, 0 ms TBT, and zero CLS. Fonts no longer block first paint; the deployment edge gives fingerprinted assets immutable caching while leaving the HTML entry point revalidatable. This is one synthetic run on this machine, not a field-data or device-fleet claim.

## How to read the evidence

The release checks below executed against local production builds and disposable fixtures. The independent browser checks used new Playwright contexts and observed rendered state after each action; they are scripted exploratory checks, not human hand-clicking. A passing local fixture, HTTP health response, and live-provider evaluation are different claims.

The original [Claude Weft/Vantage plan](https://claude.ai/code/artifact/7a18edf9-1ba9-48ae-b9c2-d5a63e60086a) was not freshly accessible and was not edited or republished. This file is a local companion with a reproducible test order. Earlier W-1–W-9/V-1–V-13 names remain historical references; no exact one-to-one original-item completion is invented.

## Test order and observed results

Run the existing suite first, then the independent browser sequence below against isolated data, then a small deployed smoke check. Do not turn these local probes into production load tests.

| Order | Steps / expected behavior | Observed |
|---|---|---|
| 1 | navigate and inventory: ask | PASS — Ask |
| 2 | navigate and inventory: trend | PASS — Trend |
| 3 | navigate and inventory: funnel | PASS — Funnel |
| 4 | navigate and inventory: retention | PASS — Retention |
| 5 | navigate and inventory: paths | PASS — Paths |
| 6 | navigate and inventory: events | PASS — Events |
| 7 | navigate and inventory: history | PASS — Ask history |
| 8 | navigate and inventory: projects | PASS — Projects & ingest |
| 9 | navigate and inventory: mcp | PASS — MCP |
| 10 | navigate and inventory: health | PASS — Health |
| 11 | Ask canned question, exact SQL, edit invalid spec, cancel | PASS — {"buttons": ["Edit spec", "Copy"], "bars": "signup\n13\nPERSONS\n—\nOF PREV\n100.0 %\nOF START\ncreate_project\n6\nPERSONS\n46.2 %\nOF PREV\n46.2 %\nOF START\ninvite_teammate\n3\nPERSONS\n50.0 %\nOF PREV\n23.1 %\nOF START"} |
| 12 | Hostile question refused, no SQL execution, inspect audit history | PASS — refusal recorded and expanded; nothing ran |
| 13 | Funnel default range runs, invalid-range error and retry recover | PASS — 2025-09-08 through 2026-09-09 (366 days), then invalid-range error and successful retry |
| 14 | Trend measures, units, breakdown and SQL panel | PASS — hour/day/week/month, persons+plan and panel controls exercised |
| 15 | Retention controls and cell evidence | PASS — 03 Aug cohort, day 0: 0 % |
| 16 | Paths adjustable steps and gap | PASS — 1	1	signup→create_project	4	28.6 %	55 m	 |
| 17 | Events inspect each catalog row | PASS — [] |
| 18 | Keyboard-only event, project and history table actions | PASS — Enter/Space activated semantic controls with observed state |
| 19 | Health recheck; network failure UI then retry | PASS — controlled browser network-failure simulation recovered |
| 20 | Theme, transparency, rail toggles and MCP copy | PASS — MCP transcript remains explicitly illustrative; copy works |
| 21 | Isolated project create, snippets, ingest dedup, identify, rotate key, empty state | PASS — isolated DB mutations only; keys not logged |
| 22 | bounded local HTTP load: 4 clients × 20 catalog reads | PASS — 80/80 HTTP 200; p50 5 ms, p95 12 ms, 197 ms total |

## Scope and limits

The public app uses VANTAGE_LLM=none: known demo questions map to canned specs. It does not prove free-form Anthropic/Ollama accuracy. The MCP page is an illustrative transcript; real MCP protocol tests run a separate subprocess. A shared admin gate is configured on Fly; there is no per-user login/RBAC or tenant isolation between operators.

The read-only local load probe made 80 catalog GETs at concurrency 4, all HTTP 200, p50 5 ms and p95 12 ms, total 197 ms on the disposable fixture. This does not characterize large datasets, sustained load, memory growth, or production capacity. The separate 200k-event benchmark remains a CI job; it was not rerun as part of this local pass.

The initial theme assertion wrongly assumed the OS started dark; it was corrected to test a toggle relative to initial state. A later keyboard assertion contained an incorrectly encoded middle dot; the UTF-8-corrected focused rerun passed. These were harness defects, not application failures. The network-failure scenario deliberately aborted a browser request and verified recovery; it did not stop production Postgres. An initial 2026-09-09 gate reported one `EBUSY` while the dependency removed a stopped embedded-PostgreSQL directory. Both harnesses now stop first and perform their own bounded retrying deletion; the complete 825-case rerun passed without the cleanup error, and the reproduced stale directory was removed.

Not newly verified: every browser/OS/device combination, real-provider semantic accuracy, an authenticated Claude Desktop session, long-running soak, backup restoration, or adversarial security certification. Existing automated cases cover additional failure paths; their execution is not described as hand testing.

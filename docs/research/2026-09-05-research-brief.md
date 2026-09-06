# Vantage — research brief

*Compiled 2026-09-05 from ~30 web searches and fetches by a research pass. Dated because research
briefs go stale; re-verify any link before quoting it. This informs [../01-DESIGN.md](../01-DESIGN.md)
and [../03-UI.md](../03-UI.md); where they disagree with this brief, the design documents win.*

---

## 1. Best analytics product UIs (2024–2026)

**PostHog** — the closest reference: SQL (HogQL) next to every insight, and an AI that writes that SQL.
- Funnels: *conversion steps* (bar per step with count + % of previous and % of first), *time to convert*, *historical trends*. Step order modes **Sequential / Strict order / Any order**. Default conversion window **14 days**; exclusion events; first-occurrence semantics. ([docs](https://posthog.com/docs/product-analytics/funnels))
- Retention: cohort **table** (triangle) + graph. Return criterion "**On**" (exact period) vs "**On or after**" (cumulative). *In-progress periods are marked with a tooltip saying they're incomplete.* ([docs](https://posthog.com/docs/product-analytics/retention))
- Paths: default **5 steps**, start/end pinning, regex path-cleaning, **only top 50 transitions**, 30-minute session window. ([docs](https://posthog.com/docs/product-analytics/paths))
- SQL through MCP too — direct prior art. ([run-sql-mcp](https://posthog.com/docs/data-warehouse/run-sql-mcp))
- Anti-pattern from their own tracker: funnel sampling silently changing results. ([issue](https://github.com/posthog/posthog/issues/38680))

**Amplitude**
- Funnel order modes **This order / Any order / Exact order**; window 1 s–90 d. ([docs](https://amplitude.com/docs/analytics/charts/funnel-analysis/funnel-analysis-build))
- Retention: **N-day**, **Unbounded**, **Bracket**. ([docs](https://amplitude.com/docs/analytics/charts/retention-analysis/retention-analysis-interpret))
- "Ask Amplitude" converts the question via prompts into a **JSON chart definition** (not SQL) rendered by their engine — a constrained grammar. ([AWS blog](https://aws.amazon.com/blogs/big-data/how-amplitude-implemented-natural-language-powered-analytics-using-amazon-opensearch-service-as-a-vector-database/))

**Mixpanel**
- Retention heatmap; unbounded vs N-day. ([docs](https://docs.mixpanel.com/docs/reports/retention))
- Funnels: exclusion steps; time-to-convert median/avg/P25/P75/P90/P99. ([docs](https://docs.mixpanel.com/docs/reports/funnels/funnels-advanced))

**June.so** — wound down Aug 2025; legacy is template-first B2B UX. **Plausible** — one-page dashboard, fixed date/filter bar. **Metabase** — "View SQL" in a **sidebar** next to the builder; Metabot writes SQL. ([docs](https://www.metabase.com/docs/latest/questions/query-builder/editor)) **Grafana** — 2026 redesigned **panel errors & notices**: corner icon whose severity reflects the worst notice. Loki's failure mode — timeout returns 200 with partial data and no flag — is the anti-pattern. ([Grafana](https://grafana.com/whats-new/2026-07-30-new-panel-query-errors-and-notices-ui/), [Loki issue](https://github.com/grafana/loki/issues/2999))

**Patterns to steal:** step bars with both "% of previous" and "% of start"; conversion window as a first-class control; incomplete-period hatching; SQL in a collapsible side panel, never a modal; per-panel notice icon with severity; top-N truncation always labelled.
**Anti-patterns:** silent sampling; 200-with-partial-data; unlabelled per-row heatmap scales; NL→chart with no visible query.

## 2. Local database on Windows, $0

- **Node 22 `node:sqlite`** — `DatabaseSync(path, { readOnly: true, timeout })`; unflagged since 22.13 but still "active development"; no statement interrupt; window functions yes, weak date math. ([docs](https://nodejs.org/docs/latest-v22.x/api/sqlite.html))
- **DuckDB (`@duckdb/node-api`)** — `access_mode: 'READ_ONLY'`; excellent analytics SQL (`FILTER`, `date_trunc`, `QUALIFY`); **no query interruption in the Node client**. ([docs](https://duckdb.org/docs/current/clients/node_neo/overview.html))
- **Postgres** — local installer or `embedded-postgres` npm. Strongest security model: a role with `SELECT` only; `ALTER ROLE … SET default_transaction_read_only = on; SET statement_timeout = '5s'`. Note: `default_transaction_read_only` is not itself a boundary (a session can `SET` it off) — the *grants* are the boundary. ([PG docs](https://www.postgresql.org/docs/current/runtime-config-client.html), [Katz](https://jkatz05.com/post/postgres/postgres-read-only/), [embedded-postgres](https://github.com/leinelissen/embedded-postgres))
- The research pass recommended DuckDB for SQL ergonomics. **The design chose Postgres** — see 01-DESIGN.md §0 for why (the owner's stated options, the learning goal of index design and query plans, and a DB-enforced statement timeout on the LLM path).

## 3. MCP server (state as of Sept 2026)

- **Spec**: 2026-07-28 is current. Stateless per-request; `Mcp-Method`/`Mcp-Name` headers; list responses with `ttlMs`; Tasks moved to an extension; `inputSchema`/`outputSchema` are full JSON Schema 2020-12. ([blog](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [spec](https://modelcontextprotocol.io/specification/2026-07-28))
- **TypeScript SDK**: `new McpServer({name, version})`; `server.registerTool(name, { title, description, inputSchema, outputSchema, annotations: { readOnlyHint, destructiveHint, idempotentHint, openWorldHint } }, handler)`; handler returns `{ content, structuredContent }`. Transports: `StdioServerTransport`; Streamable HTTP via `NodeStreamableHTTPServerTransport`. Pin versions (Zod 4 issue #1143). ([SDK](https://github.com/modelcontextprotocol/typescript-sdk), [tools](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/tools.md))
- **Testing**: `npx @modelcontextprotocol/inspector node dist/mcp.js`; CLI mode for CI; needs Node ≥ 22.19. ([inspector](https://github.com/modelcontextprotocol/inspector))
- **Windows registration**: Claude Desktop → `%APPDATA%\Claude\claude_desktop_config.json`. Bare `"command": "npx"` often fails; use `"command": "node"` with an absolute path. One JSON syntax error disables all servers. Claude Code: `claude mcp add vantage -- node C:\...\dist\mcp.js`. ([docs](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers))
- **Security**: confused deputy, token passthrough (forbidden), **local server compromise** (prefer stdio; if HTTP, require an auth token). Tool poisoning: hidden instructions in tool descriptions. ([spec security](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices), [Invariant Labs](https://invariantlabs.ai/blog/mcp-security-notification-tool-poisoning-attacks))

## 4. NestJS (2025–2026)

- **v11 → v12 (Q3 2026)**: ESM-only packages, **Standard Schema** natively in `@Body/@Query/@Param` (Zod works without a pipe), Vitest + oxlint + Rspack default toolchain, Express 5 default. ([Trilon](https://trilon.io/blog/nestjs-12-is-now-available), [release](https://github.com/nestjs/nest/releases/tag/v12.0.0))
- **Validation**: Zod via Standard Schema on v12; `nestjs-zod` on v11. Prefer Zod because the same schema doubles as the MCP `inputSchema`.
- **Architecture**: feature modules, thin controllers, DI tokens for the DB connection; `ConfigModule.forRoot({ validate })`.
- **Pure domain outside Nest**: SQL builders, the grammar validator, dedupe logic as plain functions with zero `@Injectable`; unit-test with Vitest and no `Test.createTestingModule`. Supertest only for e2e.
- **Windows runtime**: `nest start -b swc -w --type-check`. ([swc recipe](https://github.com/nestjs/docs.nestjs.com/blob/master/content/recipes/swc.md))

## 5. Analytics correctness gotchas

- **Dedup keys/windows**: Amplitude drops repeats of `insert_id` per `device_id` within **7 days**; Mixpanel dedupes on (event, distinct_id, timestamp, `$insert_id`) within 24 h; Segment stores ≥ 24 h of `messageId`s; PostHog relies on ReplacingMergeTree — eventual. ([Amplitude](https://amplitude.com/docs/apis/analytics/http-v2), [Mixpanel](https://docs.mixpanel.com/reference/event-deduplication), [Segment](https://segment.com/docs/guides/duplicate-data/))
- **Clock skew**: Amplitude records `client_event_time`, `client_upload_time`, `server_received_time`; if `server_received_time − client_upload_time` > 60 s it shifts `event_time` by that offset. Store all three. ([Amplitude community](https://community.amplitude.com/data-instrumentation-57/client-event-timestamp-vs-client-upload-timestamp-395))
- **Late-arriving events**: mark buckets whose end < now − grace as complete, others in progress.
- **Identity**: PostHog `$identify` merges anonymous person into identified person; `person_distinct_ids` + overrides so history re-resolves at query time. ([PostHog](https://posthog.com/docs/product-analytics/identity-resolution))
- **Timezones**: bucket by project timezone, not UTC.
- **Funnel semantics**: sequential/strict/any with a conversion window (default 14 d) and exclusion steps; time-to-convert percentiles.
- **Retention**: N-day ("on"), unbounded ("on or after"), bracket; first-time vs recurring; mark incomplete periods.

## 6. LLM-to-SQL as a security problem

- **OWASP LLM Top 10 (2025)**: LLM01 Prompt Injection (indirect via data rows/event names), LLM05 Improper Output Handling (model SQL = untrusted output), LLM06 Excessive Agency. ([promptfoo](https://www.promptfoo.dev/blog/owasp-top-10-llms-tldr/))
- **Semantic layers over free SQL**: Cube — the agent picks measures/dimensions, never writes table SQL. Amplitude's Ask emits a JSON chart spec. ([Cube](https://cube.dev/articles/semantic-layer-for-ai-agents-2026))
- **PostHog HogQL**: parser → AST → automatic `team_id` filter injection → compiled SQL. The AST layer is where isolation lives. ([HogQL](https://posthog.com/blog/introducing-hogql))
- **Uber QueryGPT**, **Pinterest text-to-SQL**: workspaces, table-selection agents, humans in the loop. ([Uber](https://www.uber.com/us/en/blog/query-gpt/), [Pinterest](https://medium.com/pinterest-engineering/how-we-built-text-to-sql-at-pinterest-30bad30dabff))
- **Structural controls used by serious teams**: read-only principal; parse → allowlisted AST; forced `LIMIT` and time range; hard timeout; row/byte caps; audit log of prompt + SQL; show the SQL.

## 7. Visual design 2025–2026 & liquid glass on data UIs

- Glass for the **navigation/control layer only**; never behind charts or tables; ≥ 4.5:1 text contrast. ([WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/))
- Dark-first: dark grey/navy not pure black; APCA for small text.
- OKLCH tokens for even sequential ramps; 5–8 categorical hues; sequential for retention heatmaps; diverging only for ± deltas. ([Cloudscape](https://cloudscape.design/foundation/visual-foundation/data-vis-colors/))
- `font-variant-numeric: tabular-nums` on every numeric column and KPI.

## Recommendations from the research pass (prioritised)

1. DB: (research said DuckDB; design chose Postgres — see 01-DESIGN.md §0.)
2. Timeout enforcement DB-side where possible; otherwise a worker with a hard kill.
3. **Constrained query spec, not free SQL**: funnel/retention/paths tools take a typed JSON spec compiled to SQL by Vantage's own builders.
4. **Always show the SQL**: right-side collapsible panel; the exact executed SQL, not the model's draft.
5. Event schema with `insert_id`, three timestamps, `properties JSON`, `project_id`; dedupe on `(project_id, insert_id)` within a window; expose dropped-duplicate count.
6. Clock skew: Amplitude's 60 s rule; store raw and adjusted.
7. Identity: `person_distinct_ids` + overrides; resolve at query time.
8. Per-project `timezone`; show it in chart footers.
9. Funnels: sequential/strict/any; default 14 d; bars show count, % of previous, % of start; time-to-convert percentiles.
10. Retention: N-day / unbounded / bracket; global heatmap scale; hatch incomplete cells.
11. Paths: 5 steps, top 50 transitions, visible truncation label.
12. MCP: stdio primary; all tools `readOnlyHint: true, destructiveHint: false`; `outputSchema` returns `{ rows, sql, meta: { status, elapsed_ms, truncated } }`.
13. Windows MCP install command writing `claude_desktop_config.json` with `"command": "node"` and an absolute path.
14. NestJS layout: `src/domain` pure, `src/infra` adapters, `src/modules/*`, Zod contracts shared by HTTP and MCP.
15. **Result status model**: every response carries `status ∈ {complete, partial, timed_out, truncated, empty}` + `reason`.
16. Copy: timeout — "Stopped after 5 s. Showing nothing rather than a partial answer." Truncated — "Showing first 10,000 rows of ~N." In-progress — "This period isn't over yet; the number will change." Dedupe — "Ignored 12 duplicate events (same insert_id within 7 days)."
17. Prompt-injection hygiene: event names/property values are data, fenced, never in the system prompt; the model sees schema + stats, not raw rows.
18. Visual: dark-first OKLCH; glass only on nav; charts on opaque surfaces; tabular nums.
19. Audit log: question → grammar → guard decision → executed SQL → status/elapsed, persisted and browsable.

# Vantage — the 90-second demo

The point of the demo is one sentence: **ask in English, see the exact SQL, then watch a hostile question
get refused by construction — not by a filter.** It is the script from
[01-DESIGN.md §8](01-DESIGN.md#8-the-demo-90-seconds), with the exact commands. Every number you see is
produced live by the running system against the loaded dataset; none is written here.

## Before you start (once)

```powershell
cd D:\code\Vantage
npm install --legacy-peer-deps
$env:PGPASSWORD = '<your postgres superuser password>'
.\tools\db-setup.ps1          # creates the database and the three roles (owner / app / reader) idempotently
npm run build; npm run migrate
npm run fixture:load          # loads the ~1,000-event hand-checked August fixture; prints the project id
```

The fixture is the small, hand-computed dataset whose every funnel and retention number is written out by
hand in [apps/api/fixtures/august.expected.md](../apps/api/fixtures/august.expected.md) and asserted by
name in the test suite. For the fuller demo product (`signup → create_project → invite_teammate`, realistic
drop-off, decaying retention, one out-of-clock device, a few late arrivals), load the deterministic seed
instead and use the project id and funnel line it prints:

```powershell
npm run seed                  # ~200k-event Demo project; idempotent (a second run dedupes to zero new rows)
```

Then start the web UI and the API together (`VANTAGE_LLM=none`, so no model key is needed — the `none`
adapter maps the demo questions to specs so the boundary demo never depends on a model's mood):

```powershell
$env:VANTAGE_LLM = 'none'; npm run dev    # web on http://127.0.0.1:5174, API on http://127.0.0.1:4100
```

## The run

| Time | Do this | What the audience sees |
|------|---------|------------------------|
| 0:00 | On the **Ask** screen, click the example chip / type: *"Of the people who signed up in August, how many created a project within a week, and how many of those invited someone?"* | The **spec** the model produced appears first (a small JSON card, violet), then the **SQL panel** slides in (amber) with the exact parameterised query, then the funnel bars: counts, % of previous, % of start, median time to convert. The footer carries the status: `● Complete`, the elapsed time, the `data until` watermark, and the project timezone. |
| 0:30 | Click **Edit spec**, change the window from 7 days to 1 day, **Re-run**. | New numbers. Because the conversion window is a **bound parameter**, the change moves the `$n` in the params line, not the SQL text — the parameterisation the whole boundary rests on, made visible. The point: *the SQL is the artefact, not the chart.* |
| 0:45 | Type: *"drop the events table"* | A red **⊘ Refused** card: *"The model's output is not a query the grammar can express."* with the raw model text beneath. **Nothing ran.** The audit row appears in **Ask history** (decision `refused`). |
| 0:55 | Open a terminal and try the write directly as the read-only role: | PostgreSQL refuses — proof the refusal is architectural, not wording. |
| 1:05 | Switch to **Claude Desktop** with Vantage registered as an MCP server (`npm run mcp:install`, restart Claude Desktop). Ask the same August question. | Claude calls `list_events`, then `run_funnel` with a spec; the tool result shows the **same SQL** and the same numbers. **No Vantage API key, no Vantage LLM involved.** |
| 1:25 | Back in the UI, open **Retention** and hover the last column. | Hatched cells: *"This period isn't over yet; the number will change."* Honest by construction. |

### The 0:55 command — the boundary, at the shell

Connect as `vantage_reader` (the role the query path uses) and try to write:

```powershell
# using the RO connection string db-setup.ps1 wrote into .env as VANTAGE_DATABASE_URL_RO
psql "$env:VANTAGE_DATABASE_URL_RO" -c "DROP TABLE events;"
# ERROR:  permission denied for table events          (42501 — vantage_reader has no DROP)
psql "$env:VANTAGE_DATABASE_URL_RO" -c "DELETE FROM events;"
# ERROR:  permission denied for table events          (42501 — no DELETE either)
psql "$env:VANTAGE_DATABASE_URL_RO" -c "INSERT INTO events (project_id) VALUES ('00000000-0000-4000-8000-000000000000');"
# ERROR:  permission denied for table events          (42501)
```

Grants are the boundary; the read-only transaction is belt-and-braces. The same three refusals are
asserted in the test suite (`test/integration/reader-cannot-write.spec.ts`), so this is not a stunt — it
is a guarantee under test. The full argument is in [../DESIGN.md](../DESIGN.md).

### The 1:05 path — same numbers, from Claude, no Vantage key

```powershell
npm run mcp:install -- --dry-run     # preview the claude_desktop_config.json entry and the `claude mcp add` line
npm run mcp:install                  # write it (merges around other servers, backs up first), then restart Claude Desktop
```

In Claude Desktop, ask the August question. Claude's own model does English→spec and calls `list_events`
then `run_funnel`; the returned `sql` field is the exact query the web UI showed. The eight tools are all
`readOnlyHint: true`, and there is no `run_sql` or `ask` tool — nothing to call that could carry SQL.

## If you have another 30 seconds — the performance guard

Vantage's query cost is guarded by CI, not a hand-written claim. Run the bench locally:

```powershell
npm run bench                                        # the 200k-event variant CI runs (funnel/retention/paths under budget)
$env:VANTAGE_BENCH_EVENTS = '1000000'; npm run bench # a 1M-event local stress run: every query stays under the 5s statement timeout
```

The bench prints `measured:` lines for the generated row count and each query's elapsed time, and fails
the run if a query exceeds its budget (see
[apps/api/test/bench/bench.spec.ts](../apps/api/test/bench/bench.spec.ts) for the budgets and why the CI
variant is 200k while 1M is the local stress size — query time is not linear in row count).

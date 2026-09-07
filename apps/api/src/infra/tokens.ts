/**
 * tokens.ts — the DI tokens that make the two database roles distinct in code.
 *
 * Why it exists: design §6.1 — "the DI tokens make it impossible to inject the wrong pool without
 * saying so in code". A module that needs to write asks for `PG_RW`; one that only reads asks for
 * `PG_RO`. Because the tokens are plain string constants imported by name, `tools/lint-deps.mjs` can
 * see, without type information, that `modules/ask` never mentions `PG_RW`.
 *
 * What it must never do: alias one token to the other, or grow a third pool without the LLD saying
 * which role backs it.
 */

/** Pool connected as `vantage_app`: INSERT on the event tables, column-level UPDATE for the merge (person_distinct_ids.person_id, persons.merged_into), nothing else. */
export const PG_RW = 'PG_RW';
/** Pool connected as `vantage_reader` (max 4, statement_timeout 5s asserted at boot): SELECT only. */
export const PG_RO = 'PG_RO';
/** The wall clock, injectable so tests can pin `server_ts`. */
export const CLOCK = 'CLOCK';
/** The DatabaseModule's own options object (URLs and migrations directory). */
export const DATABASE_OPTIONS = 'DATABASE_OPTIONS';
/**
 * The shared read token (`VANTAGE_QUERY_TOKEN`), or `undefined` when unset. When undefined the query
 * routes stay open ⟨D4⟩ — today's exact behaviour; when a string, `QueryTokenGuard` requires it as a
 * Bearer on the read routes. It is a single shared read token for the whole instance, NOT a project key
 * (that is the per-project ingest key `ApiKeyGuard` checks) — the two mechanisms are independent.
 */
export const QUERY_TOKEN = 'QUERY_TOKEN';
/**
 * The shared ADMIN token (`VANTAGE_ADMIN_TOKEN`), or `undefined` when unset. When undefined the
 * project-admin write routes stay open ⟨D4⟩ — today's exact behaviour; when a string, `AdminTokenGuard`
 * requires it as a Bearer on `POST /v1/projects` (create) and `POST /v1/projects/:id/rotate-key` only.
 * It is a single shared admin token for the whole instance, INDEPENDENT of both the shared read token
 * `QUERY_TOKEN` and the per-project ingest key `ApiKeyGuard` checks — all three mechanisms are separate.
 */
export const ADMIN_TOKEN = 'ADMIN_TOKEN';

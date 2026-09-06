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

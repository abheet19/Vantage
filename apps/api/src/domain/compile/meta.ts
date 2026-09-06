/**
 * meta.ts — `compileMeta`: the watermark statement that travels with every compiled query (design §1.3).
 *
 * Why it exists: a number is only defensible with its footer — `data_until` (how fresh the data was),
 * `persons_merged_since` (how many identity merges have happened since the range began — a merge is
 * dated by when it was DONE, not by the events it joined, so a merge last night reshapes an August
 * funnel and must be counted whatever the range's end), `ts_adjusted_share` (how many timestamps the
 * server had to correct). The runner executes this in the same read-only transaction as the query,
 * so the footer describes the data the query saw. It is compiled here, in the domain, because the
 * runner must never compose SQL of its own. `data_until` reads the newest event by `event_id`: ids are
 * UUIDv7 minted in the same request as `server_ts`, so the newest id is the newest arrival, found by one
 * backward step on the primary key — an index on `server_ts` would cost every insert to serve this one
 * lookup.
 *
 * What it must never do: scan the project's events for `max(server_ts)` (seconds at 10 M rows), or omit
 * `project_id = $1` from any of the three lookups.
 */
import type { DateRange } from '@vantage/contracts';
import { beginScan } from './scan.js';
import { fill, Params } from './sql.js';
import type { CompileCtx, Statement } from './types.js';

const META = `SELECT (SELECT ev.server_ts FROM events ev WHERE ev.project_id = {project} ORDER BY ev.event_id DESC LIMIT 1) AS data_until,
       (SELECT count(*)::int FROM person_merges pm WHERE pm.project_id = {project} AND pm.merged_at >= {start}) AS persons_merged_since,
       (SELECT (count(*) FILTER (WHERE ev.ts_source <> 'client'))::float8 / nullif(count(*), 0)
          FROM events ev WHERE ev.project_id = {project} AND ev.event_ts >= {start} AND ev.event_ts < {end}) AS ts_adjusted_share`;

export interface MetaRow {
  data_until: Date | null;
  /** Merges performed at or after the range's start instant, with no upper bound. */
  persons_merged_since: number;
  /** Null when the range holds no events. */
  ts_adjusted_share: number | null;
}

export function compileMeta(range: DateRange, ctx: CompileCtx): Statement {
  const p = new Params();
  const scan = beginScan(range, ctx, p);
  return { sql: fill(META, { project: scan.project, start: scan.start, end: scan.end }) + '\n' + p.legend(), params: p.list };
}

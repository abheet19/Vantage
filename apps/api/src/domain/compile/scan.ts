/**
 * scan.ts — the fragments every scanning CTE starts from: the project, the range, the identity join.
 *
 * Why it exists: V14 requires `project_id = $1` in every statement and design §1.2 requires person
 * resolution at query time, so the `FROM events JOIN person_distinct_ids WHERE project_id = $1 AND
 * event_ts in range` shape is written once here and every compiler builds on it. The range arrives as
 * two local dates in the project timezone; the conversion to UTC instants happens in SQL with `AT TIME
 * ZONE`, never with a JavaScript `Date`, because the process's local zone must never leak into a query
 * (design §3.3). `$1` is always the project, `$2` the timezone, `$3`/`$4` the dates, so a reader of any
 * compiled statement knows the first four parameters without the legend.
 *
 * What it must never do: accept a project id from anywhere but `ctx` (the caller's project, V14), or
 * put a value into the template.
 */
import type { DateRange } from '@vantage/contracts';
import { fill, type Params, type Sql } from './sql.js';
import type { CompileCtx } from './types.js';

export interface Scan {
  project: Sql;
  tz: Sql;
  /** `to` as a date parameter, for compilers that need the calendar date itself (retention's horizon). */
  to: Sql;
  /** UTC instant of local midnight starting `from`. */
  start: Sql;
  /** UTC instant of local midnight after `to` (the range is inclusive of its last day). */
  end: Sql;
}

const LOCAL_MIDNIGHT = '({date}::date::timestamp AT TIME ZONE {tz})';
const NEXT_LOCAL_MIDNIGHT = '(({date}::date + 1)::timestamp AT TIME ZONE {tz})';

/** Binds `$1..$4` and returns the range as instants computed in SQL. */
export function beginScan(range: DateRange, ctx: CompileCtx, p: Params): Scan {
  const project = p.add(ctx.projectId, 'project_id');
  const tz = p.add(ctx.timezone, 'project timezone');
  const from = p.add(range.from, 'range from (local date)');
  const to = p.add(range.to, 'range to (local date, inclusive)');
  return {
    project,
    tz,
    to,
    start: fill(LOCAL_MIDNIGHT, { date: from, tz }),
    end: fill(NEXT_LOCAL_MIDNIGHT, { date: to, tz }),
  };
}

const PERSON_EVENTS = `FROM events ev
JOIN person_distinct_ids pdi ON pdi.project_id = ev.project_id AND pdi.distinct_id = ev.distinct_id
WHERE ev.project_id = {project}
  AND ev.event_ts >= {start} AND ev.event_ts < {end}`;

/** Events resolved to persons, bound to the project and to `[start, end)`; callers append their own `AND` conditions. */
export function personEvents(bounds: { project: Sql; start: Sql; end: Sql }): Sql {
  return fill(PERSON_EVENTS, { project: bounds.project, start: bounds.start, end: bounds.end });
}

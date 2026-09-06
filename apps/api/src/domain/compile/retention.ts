/**
 * retention.ts — `compileRetention` (design §3.3, LLD D2) and the decoder for its cells.
 *
 * Why it exists: a cohort is the persons whose FIRST start event in range falls in a bucket of the
 * project's timezone, and `AT TIME ZONE $2` before `date_trunc` is the whole fix for the 22:00-in-Mumbai
 * problem the design exists to remember. Period n is retained when the person did the return event in
 * bucket + n (`on`) or in any bucket from bucket + n up to the cohort's own horizon, bucket + periods
 * (`on_or_after`; design §3.3, decision 2026-09-05) — the horizon is per cohort so that two cohorts a
 * month apart are judged over the same number of periods, not over whatever happened to lie before the
 * range's end. The grid never aggregates: `on` is one LEFT JOIN on the exact bucket, `on_or_after` one
 * comparison against the member's last return bucket, so the cost is cohort members × periods, not ×
 * every return bucket as well (S2 hardening; the sketch's `bool_or … GROUP BY` timed out at 2 M events).
 * Two more decisions the SQL makes so the UI never has to guess: `in_progress` is computed here from the
 * bucket END against `now() − grace` (design §1.3's definition; the §3.3 sketch compared the start), and
 * the activity scan stops at the last bucket any cohort can reach (D2). The row cap cuts whole cohorts:
 * only the newest `floor(rowCap / (periods + 1))` cohorts fit, one more is computed so the runner sees
 * the cut, rows leave newest cohort first, and the decoder drops the one cohort the cap left incomplete
 * — a returned cohort is always all of its cells.
 *
 * What it must never do: bucket in UTC, let a person into two cohorts (`min` per person guarantees one),
 * report a cell without `in_progress`, or return a cohort with some of its cells missing.
 */
import type { RetentionCohort, RetentionSpec } from '@vantage/contracts';
import { IN_PROGRESS_COLUMN, IN_PROGRESS_GRACE_MS } from '../status.js';
import { andFilters } from './filters.js';
import { compileMeta } from './meta.js';
import { beginScan, personEvents } from './scan.js';
import { assembleStatement, cte, fill, Params } from './sql.js';
import { seal, type CompileCtx, type Compiled } from './types.js';

const STARTERS = `SELECT pdi.person_id, date_trunc({unit}, min(ev.event_ts AT TIME ZONE {tz})) AS cohort_bucket
{scan}
  AND ev.event = {event}{where}
GROUP BY pdi.person_id`;

const RECENT = `SELECT DISTINCT cohort_bucket
FROM starters
ORDER BY cohort_bucket DESC
LIMIT {cohorts}`;

const COHORT = `SELECT s.person_id, s.cohort_bucket
FROM starters s
JOIN recent USING (cohort_bucket)`;

/** The horizon (D2): local midnight after `to`, truncated to the unit, plus periods + 1 units — beyond it no cell of the grid can look. */
const ACTIVITY_END = "((date_trunc({unit}, {to}::date::timestamp) + (({periods}::int + 1) || ' ' || {unit})::interval) AT TIME ZONE {tz})";

const ACTIVITY = `SELECT DISTINCT pdi.person_id, date_trunc({unit}, ev.event_ts AT TIME ZONE {tz}) AS active_bucket
{scan}
  AND ev.event = {event}{where}`;

const GRID_ON = `SELECT c.cohort_bucket, gs.n, c.person_id, a.person_id IS NOT NULL AS retained
FROM cohort c
CROSS JOIN generate_series(0, {periods}::int) AS gs(n)
LEFT JOIN activity a ON a.person_id = c.person_id AND a.active_bucket = c.cohort_bucket + (gs.n || ' ' || {unit})::interval`;

const LAST_ACTIVE = `SELECT c.person_id, max(a.active_bucket) AS last_active
FROM cohort c
JOIN activity a ON a.person_id = c.person_id AND a.active_bucket < c.cohort_bucket + (({periods}::int + 1) || ' ' || {unit})::interval
GROUP BY c.person_id`;

const GRID_ON_OR_AFTER = `SELECT c.cohort_bucket, gs.n, c.person_id, coalesce(l.last_active >= c.cohort_bucket + (gs.n || ' ' || {unit})::interval, false) AS retained
FROM cohort c
CROSS JOIN generate_series(0, {periods}::int) AS gs(n)
LEFT JOIN last_active l ON l.person_id = c.person_id`;

const CELLS = `SELECT cohort_bucket, n, count(*)::int AS size, count(*) FILTER (WHERE retained)::int AS retained,
       cohort_bucket + ((n + 1) || ' ' || {unit})::interval > (now() AT TIME ZONE {tz}) - make_interval(secs => {grace}::float8) AS in_progress
FROM grid
GROUP BY cohort_bucket, n`;

/**
 * `in_progress` is per cell, for the heatmap. The footer counts BUCKETS still receiving events (design
 * §1.3), and one bucket is looked at by every cohort whose period lands on it, so the counted column is
 * true on exactly one cell per such bucket — the newest cohort's, which the row cap keeps longest.
 */
const SELECT = `SELECT to_char(cohort_bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket, n, size, retained, in_progress,
       in_progress AND row_number() OVER (PARTITION BY cohort_bucket + (n || ' ' || {unit})::interval ORDER BY cohort_bucket DESC) = 1 AS {incomplete}
FROM cells
ORDER BY cohort_bucket DESC, n`;

/** How many cohorts fit under the row cap whole, plus one: the extra cohort's cells push the row count past the cap and tell the runner the answer was cut. */
export function cohortLimit(rowCap: number, periods: number): number {
  return Math.floor(rowCap / (periods + 1)) + 1;
}

export function compileRetention(spec: RetentionSpec, ctx: CompileCtx): Compiled {
  const p = new Params();
  const scan = beginScan(spec.range, ctx, p);
  const unit = p.add(spec.unit, 'bucket unit');
  const periods = p.add(spec.periods, 'periods');
  const startEvent = p.add(spec.start.event, 'start event');
  const startWhere = andFilters([...spec.start.where, ...spec.where], p);
  const returnStep = spec.return ?? spec.start;
  const returnEvent = p.add(returnStep.event, 'return event');
  const returnWhere = andFilters([...returnStep.where, ...spec.where], p);
  const grace = p.add(IN_PROGRESS_GRACE_MS / 1000, 'in-progress grace (seconds)');
  const cohorts = p.add(cohortLimit(ctx.rowCap, spec.periods), 'cohorts computed: the newest that fit under the row cap, plus one so a cut shows');

  const grid =
    spec.mode === 'on'
      ? [cte('grid', 'one cell per cohort member and period n: retained when active in bucket + n', fill(GRID_ON, { unit, periods }))]
      : [
          cte('last_active', "each cohort member's last return bucket inside their own horizon, bucket + periods", fill(LAST_ACTIVE, { unit, periods })),
          cte('grid', 'one cell per cohort member and period n: retained when that last return is in bucket + n or later', fill(GRID_ON_OR_AFTER, { unit, periods })),
        ];

  const ctes = [
    cte('starters', "each person's FIRST start event in range, bucketed by the unit in the project timezone", fill(STARTERS, { unit, tz: scan.tz, scan: personEvents(scan), event: startEvent, where: startWhere })),
    cte('recent', 'the newest cohorts that fit under the row cap, and one more so the runner can see the cut', fill(RECENT, { cohorts })),
    cte('cohort', 'the members of those cohorts', fill(COHORT)),
    cte(
      'activity',
      'the buckets in which each person did the return event, from range start to the last bucket any cohort can reach',
      fill(ACTIVITY, {
        unit,
        tz: scan.tz,
        scan: personEvents({ project: scan.project, start: scan.start, end: fill(ACTIVITY_END, { unit, to: scan.to, periods, tz: scan.tz }) }),
        event: returnEvent,
        where: returnWhere,
      }),
    ),
    ...grid,
    cte('cells', 'one row per cohort and period: size, retained, and whether the bucket the cell looks at may still receive events', fill(CELLS, { unit, tz: scan.tz, grace })),
  ];
  const select = fill(SELECT, { unit, incomplete: fill(IN_PROGRESS_COLUMN) });
  return seal('retention', ctx, { sql: assembleStatement(ctes, select, p, ctx.rowCap), params: p.list }, compileMeta(spec.range, ctx));
}

interface RetentionRow {
  bucket: string;
  n: number;
  size: number;
  retained: number;
  in_progress: boolean;
}

/**
 * Rows ordered by (bucket DESC, n) → cohorts oldest first. The grid gives every cohort exactly
 * `periods + 1` cells, so a cohort with fewer was cut by the row cap and is dropped rather than shown
 * half-empty; the runner has already said `truncated`. `pct` is null for an empty cohort rather than a
 * division by zero.
 */
export function decodeRetention(rows: readonly unknown[], spec: Pick<RetentionSpec, 'periods'>): RetentionCohort[] {
  const cohorts: RetentionCohort[] = [];
  for (const row of rows as readonly RetentionRow[]) {
    let cohort = cohorts[cohorts.length - 1];
    if (!cohort || cohort.bucket !== row.bucket) {
      cohort = { bucket: row.bucket, size: row.size, cells: [] };
      cohorts.push(cohort);
    }
    cohort.cells.push({ n: row.n, retained: row.retained, pct: row.size === 0 ? null : row.retained / row.size, in_progress: row.in_progress });
  }
  return cohorts.filter((c) => c.cells.length === spec.periods + 1).reverse();
}

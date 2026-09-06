/**
 * paths.ts — `compilePaths` (design §3.4, LLD §3.2) and the decoder for its ranked transitions.
 *
 * Why it exists: paths asks "after a start event, where do people go next?" — the top transitions between
 * consecutive events, per person, inside a session. A session is a run of a person's events with no gap
 * longer than `session_gap_minutes` (a `lag` over `(person_id, event_ts, event_id)` marks each gap, a
 * running sum numbers the sessions); the walk begins at the FIRST start event in a session and steps
 * forward with `lead`, at most `steps` (≤ 5) times — so P14's thousand-event session in the fixture
 * contributes five transitions, not a thousand, which is the whole defence against the session-explosion
 * attack (LLD §9). Each transition is keyed by its depth from the start event and the two event names;
 * `count(*) OVER ()` over the grouped transitions reports how many exist in all, so the top 50 leave with
 * `total_transitions` and the UI can say "showing top 50 of N" without a second query. `starts` — the
 * number of sessions that began a walk — is the "% of start" denominator, computed once and cross-joined.
 * Ordering is `(count desc, step, from, to)`, total then lexical, so the ranking is the same on every run.
 *
 * What it must never do: walk past `steps` from the start (the explosion), count a transition into the
 * start event (the walk goes forward only), interpolate a spec value, or emit a statement without
 * `project_id = $1` in the events scan.
 */
import type { PathsSpec } from '@vantage/contracts';
import { QUERY_LIMITS } from '@vantage/contracts';
import { andFilters } from './filters.js';
import { compileMeta } from './meta.js';
import { beginScan, personEvents } from './scan.js';
import { assembleStatement, cte, fill, Params } from './sql.js';
import { seal, type CompileCtx, type Compiled } from './types.js';

const EVENTS = `SELECT pdi.person_id, ev.event, ev.event_ts, ev.event_id
{scan}{where}`;

const LAGGED = `SELECT person_id, event, event_ts, event_id, lag(event_ts) OVER w AS prev_ts
FROM e
WINDOW w AS (PARTITION BY person_id ORDER BY event_ts, event_id)`;

/** A new session starts at the first event and after any gap longer than the session gap; the running sum numbers the sessions per person. */
const SESSIONISED = `SELECT person_id, event, event_ts, event_id,
       sum(CASE WHEN prev_ts IS NULL OR event_ts - prev_ts > {gap}::interval THEN 1 ELSE 0 END)
         OVER (PARTITION BY person_id ORDER BY event_ts, event_id ROWS UNBOUNDED PRECEDING) AS session_id
FROM lagged`;

/**
 * Every event of a session at or after its first start event. A running count of start events, over the
 * SAME `(event_ts, event_id)` order the walk uses, is ≥ 1 exactly on the rows at or after the first start:
 * the first start is the minimum key among the session's start events, so `count(start) so far ≥ 1` iff
 * this row's key ≥ that minimum. That is identical, row for row and tie-break for tie-break, to the old
 * `(event_ts, event_id) >= (first_start_ts, first_start_id)` row-value compare, but it needs one window
 * pass over `sessionised` instead of a self-join back to a per-session first-start CTE, which at scale
 * matched only on `person_id` and cross-multiplied every event by every session of the person (9 M rows
 * on the 1 M-event bench). Sessions with no start stay at 0 and drop out.
 */
const AFTER_START = `SELECT person_id, session_id, event, event_ts, event_id
FROM (
  SELECT person_id, session_id, event, event_ts, event_id,
         count(*) FILTER (WHERE event = {start})
           OVER (PARTITION BY person_id, session_id ORDER BY event_ts, event_id ROWS UNBOUNDED PRECEDING) AS seen_start
  FROM sessionised
) marked
WHERE seen_start >= 1`;

/** step = the row's position from the start (1 = the transition out of the start event); `lead` gives the event it goes to. */
const WALK = `SELECT person_id, session_id, event AS from_event,
       lead(event) OVER w AS to_event,
       event_ts AS from_ts,
       lead(event_ts) OVER w AS to_ts,
       (row_number() OVER w)::int AS step
FROM after_start
WINDOW w AS (PARTITION BY person_id, session_id ORDER BY event_ts, event_id)`;

const TRANSITIONS = `SELECT step, from_event, to_event, count(*)::int AS walks,
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (to_ts - from_ts))::float8))::float8 AS median_gap_s
FROM walk
WHERE to_event IS NOT NULL AND step <= {steps}
GROUP BY step, from_event, to_event`;

/** How many sessions began a walk: the distinct (person, session) pairs that contain a start event (what the old per-session first-start CTE counted). */
const STARTS = `SELECT count(*)::int AS starts
FROM (SELECT DISTINCT person_id, session_id FROM sessionised WHERE event = {start}) started`;

/** The top transitions; `count(*) OVER ()` runs before the LIMIT, so it is the true total behind the cut. */
const RANKED = `SELECT step, from_event, to_event, walks, median_gap_s, (count(*) OVER ())::int AS total_transitions
FROM transitions
ORDER BY walks DESC, step, from_event, to_event
LIMIT {top}`;

const SELECT = `SELECT r.step, r.from_event, r.to_event, r.walks, r.median_gap_s, r.total_transitions, s.starts
FROM ranked r
CROSS JOIN starts s
ORDER BY r.walks DESC, r.step, r.from_event, r.to_event`;

/** `30 minutes`: an interval literal passed as a value and cast in SQL. */
function gapInterval(minutes: number): string {
  return `${minutes} minutes`;
}

export function compilePaths(spec: PathsSpec, ctx: CompileCtx): Compiled {
  const p = new Params();
  const scan = beginScan(spec.range, ctx, p);
  const start = p.add(spec.start, 'start event');
  const where = andFilters(spec.where, p);
  const gap = p.add(gapInterval(spec.session_gap_minutes), 'session gap');
  const steps = p.add(spec.steps, 'max steps from the start event');
  const top = p.add(QUERY_LIMITS.pathsTransitions, 'top transitions kept ("showing top 50 of N")');

  const ctes = [
    cte('e', "the project's events in range, resolved to persons", fill(EVENTS, { scan: personEvents(scan), where })),
    cte('lagged', 'each event with the time of the one before it, per person', fill(LAGGED)),
    cte('sessionised', 'each event tagged with its session: a new one starts after a gap longer than the session gap', fill(SESSIONISED, { gap })),
    cte('after_start', 'the events of each session from its first start event onward (a running count of start events marks the boundary — the walk begins here)', fill(AFTER_START, { start })),
    cte('walk', 'each step of the walk: the event, the event it leads to, and the depth from the start', fill(WALK)),
    cte('transitions', 'the transitions grouped: how many walks took each (step, from, to), and the median gap between the two events', fill(TRANSITIONS, { steps })),
    cte('starts', 'how many sessions began a walk at the start event — the "% of start" denominator', fill(STARTS, { start })),
    cte('ranked', 'the top transitions by count, with the total count behind the cut', fill(RANKED, { top })),
  ];
  return seal('paths', ctx, { sql: assembleStatement(ctes, fill(SELECT), p, ctx.rowCap), params: p.list }, compileMeta(spec.range, ctx));
}

interface PathsRow {
  step: number;
  from_event: string;
  to_event: string;
  walks: number;
  median_gap_s: number | null;
  total_transitions: number;
  starts: number;
}

export interface PathsData {
  starts: number;
  transitions: { step: number; from: string; to: string; count: number; pct_of_start: number | null; median_gap_s: number | null }[];
  total_transitions: number;
}

/** Rows arrive ranked; `starts` and `total_transitions` are the same on every row (cross join / window), and `pct_of_start` is null for a zero denominator rather than a division by zero. */
export function decodePaths(rows: readonly unknown[]): PathsData {
  const typed = rows as readonly PathsRow[];
  const first = typed[0];
  if (!first) throw new Error('decodePaths: the statement returned no row');
  const starts = first.starts;
  return {
    starts,
    total_transitions: first.total_transitions,
    transitions: typed.map((r) => ({
      step: r.step,
      from: r.from_event,
      to: r.to_event,
      count: r.walks,
      pct_of_start: starts === 0 ? null : r.walks / starts,
      median_gap_s: r.median_gap_s,
    })),
  };
}

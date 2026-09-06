/**
 * funnel.ts — `compileFunnel` (design §3.2, LLD §3.2) and the decoder for the rows it produces.
 *
 * Why it exists: a funnel is a chain of statements about people — "s2 is the earliest step 2 after
 * their first step 1, within the window" — and each statement is one CTE an interviewer can read aloud
 * and the fixture can test on its own. Three orders share the `e` scan and the final SELECT:
 * `sequential` chains `min(event_ts)` per step with a strict `>` (a step-2 one millisecond before
 * step 1 does not count) and `<= t1 + window` (exactly the window counts); `strict` walks the person's
 * whole event stream with `lead()` and demands that the event right after step k be step k+1 — any
 * other event, funnel step or not, breaks the chain, which is what the fixture's P06 (signup,
 * view_pricing, create_project) pins down; `any` asks whether there is a window of length W that
 * contains an occurrence of every step (design §3.2, decision 2026-09-05): every funnel event is tried
 * as the window's start, the earliest one from which every step occurs by `anchor + window` wins, and
 * the time to convert is the spread of the occurrences it chose — so a step redone after a late step 1
 * counts, exactly as it does in sequential order; two passes over the person's events (one window, one
 * aggregate) answer every step at once. Ties in `event_ts` are ordered by `event_id`, the
 * UUIDv7 minted at arrival, so a strict chain is decided the same way on every run. A `breakdown`
 * groups persons by the property value on their first step-1 event; the commonest 50 values keep their
 * name and the rest are "other", so a high-cardinality key cannot blow up the result (LLD §9). The final
 * SELECT returns no row at all when nobody did step 1, so an empty funnel is `empty`, never a row of zeros.
 *
 * What it must never do: interpolate a spec value, count a conversion outside the window, let a
 * sequential or strict funnel start anywhere but the person's first step 1 in range (first-occurrence
 * semantics, design §3.2), or emit a statement without `project_id = $1`.
 */
import type { FunnelResult, FunnelSpec, FunnelStep, PropertyFilter } from '@vantage/contracts';
import { QUERY_LIMITS } from '@vantage/contracts';
import { allFilters, andFilters } from './filters.js';
import { compileMeta } from './meta.js';
import { beginScan, personEvents, type Scan } from './scan.js';
import { assembleStatement, cte, fill, index, joinSql, Params, type Sql } from './sql.js';
import { seal, type CompileCtx, type Compiled } from './types.js';

/** `14 days`, `30 minutes`: an interval literal passed as a value and cast in SQL. */
function intervalOf(window: FunnelSpec['window']): string {
  return `${window.value} ${window.unit}`;
}

/** `ev.event = $k [AND filters]` for one step; several tags form the `is_step` array so one event may satisfy several steps (a `signup → signup` funnel is legal). */
function stepTag(event: Sql, where: readonly PropertyFilter[], p: Params): Sql {
  if (where.length === 0) return fill('ev.event = {event}', { event });
  return fill('(ev.event = {event} AND {filters})', { event, filters: allFilters(where, p) });
}

const EVENTS = `SELECT pdi.person_id, ev.event_ts, ARRAY[{tags}] AS is_step{breakdown}
{scan}
  AND ev.event IN ({events}){where}`;
const BREAKDOWN_COLUMN = ', ev.properties ->> {key} AS breakdown';

const FIRST_STEP = `SELECT person_id, min(event_ts) AS t1
FROM e
WHERE is_step[1]
GROUP BY person_id`;

const NEXT_STEP_SEQUENTIAL = `SELECT s{prev}.person_id, s{prev}.t1, min(e.event_ts) AS t{k}
FROM s{prev}
JOIN e ON e.person_id = s{prev}.person_id
WHERE e.is_step[{k}] AND e.event_ts > s{prev}.t{prev} AND e.event_ts <= s{prev}.t1 + {window}::interval
GROUP BY s{prev}.person_id, s{prev}.t1`;

/** Ordered by `(event_ts, event_id)`: two events in the same millisecond are walked in arrival order, so "the event right after" is one event, not a coin toss. */
const STREAM = `SELECT s1.person_id, s1.t1, ev.event_ts, ARRAY[{tags}] AS is_step,
       lead(ev.event_ts) OVER w AS next_ts, lead(ARRAY[{tags}]) OVER w AS next_is_step
FROM s1
JOIN person_distinct_ids pdi ON pdi.project_id = {project} AND pdi.person_id = s1.person_id
JOIN events ev ON ev.project_id = {project} AND ev.distinct_id = pdi.distinct_id
WHERE ev.event_ts >= s1.t1 AND ev.event_ts <= s1.t1 + {window}::interval AND ev.event_ts < {end}{where}
WINDOW w AS (PARTITION BY s1.person_id ORDER BY ev.event_ts, ev.event_id)`;

const NEXT_STEP_STRICT = `SELECT s{prev}.person_id, s{prev}.t1, min(x.next_ts) AS t{k}
FROM s{prev}
JOIN stream x ON x.person_id = s{prev}.person_id AND x.event_ts = s{prev}.t{prev}
WHERE x.is_step[{prev}] AND x.next_is_step[{k}] AND x.next_ts > s{prev}.t{prev}
GROUP BY s{prev}.person_id, s{prev}.t1`;

/**
 * Any order: from each funnel event (the anchor), the earliest occurrence of every step at or after it.
 * The window is ordered newest-first so its default frame — from the first row to the current one —
 * covers exactly the events at or after the anchor and only ever grows, which PostgreSQL aggregates
 * incrementally; the natural "current row to the end" frame would be re-aggregated for every row.
 */
const ANCHORS = `SELECT person_id, event_ts AS t0{nexts}
FROM e
WINDOW w AS (PARTITION BY person_id ORDER BY event_ts DESC)`;
const NEXT_OF_STEP = ',\n       min(event_ts) FILTER (WHERE is_step[{k}]) OVER w AS n{k}';

/**
 * One pass over the anchors per person (they leave the window already sorted by person, so this is a
 * sorted aggregate, not another sort): the earliest anchor from which steps 1..k all occur by
 * `anchor + window`, for every k, and the occurrences chosen at the anchor that completes the funnel.
 */
const CONVERTED = `SELECT person_id{earliest},
       (array_agg(least({all}) ORDER BY t0) FILTER (WHERE {okLast}))[1] AS t_first,
       (array_agg(greatest({all}) ORDER BY t0) FILTER (WHERE {okLast}))[1] AS t_last
FROM anchors
GROUP BY person_id`;
const EARLIEST_ANCHOR = ',\n       min(t0) FILTER (WHERE {ok}) AS a{k}';
/** Steps 1..k all present and the last of their earliest occurrences no later than `anchor + window`. */
const ANCHOR_OK = '{present} AND greatest({nexts}) <= t0 + {window}::interval';

const ANY_STEP = `SELECT person_id
FROM converted
WHERE a{k} IS NOT NULL`;
const ANY_LAST_STEP = `SELECT person_id, t_first, t_last
FROM converted
WHERE a{k} IS NOT NULL`;

const BREAKDOWN_VALUE = `SELECT s1.person_id, min(e.breakdown) AS value
FROM s1
JOIN e ON e.person_id = s1.person_id AND e.event_ts = s1.t1 AND e.is_step[1]
GROUP BY s1.person_id`;

const TOP_VALUES = `SELECT value, true AS is_top
FROM b
GROUP BY value
ORDER BY count(*) DESC, value
LIMIT {cap}`;

const GROUPS = `SELECT b.person_id, CASE WHEN t.is_top THEN b.value END AS value, t.is_top IS NULL AS other
FROM b
LEFT JOIN top t ON t.value IS NOT DISTINCT FROM b.value`;

const FINAL = `SELECT {counts},
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM {span})::float8) FILTER (WHERE s{last}.person_id IS NOT NULL))::float8 AS median_s
FROM s1{joins}
HAVING count(s1.person_id) > 0`;

const FINAL_BREAKDOWN = `SELECT grouping(g.value, g.other) = 3 AS is_total, g.value AS breakdown_value, g.other AS breakdown_other,
       {counts},
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM {span})::float8) FILTER (WHERE s{last}.person_id IS NOT NULL))::float8 AS median_s
FROM s1{joins}
JOIN g USING (person_id)
GROUP BY GROUPING SETS ((), (g.value, g.other))
HAVING count(s1.person_id) > 0
ORDER BY is_total DESC, step_1 DESC, breakdown_other, breakdown_value`;

const STEP_COUNT = 'count(s{k}.person_id)::int AS step_{k}';
const STEP_JOIN = '\nLEFT JOIN s{k} USING (person_id)';

interface FunnelParts {
  scan: Scan;
  tags: Sql;
  window: Sql;
  globalWhere: Sql;
  stepCount: number;
}

const stepNumbers = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

/** `s1` is the same statement in every order — step 1 is "did step 1 in range", counted once per person from their first occurrence; only the sentence differs. */
function firstStep(why: string): Sql {
  return cte('s1', why, fill(FIRST_STEP));
}

/** s1 … sN for `sequential`: each step is the earliest occurrence after the previous one, inside the window from t1. */
function sequentialSteps(f: FunnelParts): Sql[] {
  const ctes = [firstStep("each person's first step 1 in range: the funnel starts there and nowhere else")];
  for (let k = 2; k <= f.stepCount; k++) {
    const why = k === 2 ? 'earliest step 2 strictly after t1, inside the window' : `earliest step ${k} strictly after t${k - 1}, still inside the window from t1`;
    ctes.push(cte(`s${k}`, why, fill(NEXT_STEP_SEQUENTIAL, { prev: index(k - 1), k: index(k), window: f.window })));
  }
  return ctes;
}

/** s1, stream, s2 … sN for `strict`: the event right after step k must itself be step k+1. */
function strictSteps(f: FunnelParts): Sql[] {
  const ctes = [
    firstStep("each person's first step 1 in range: the funnel starts there and nowhere else"),
    cte(
      'stream',
      'strict order: every event of a step-1 person inside their window, with the event that came right after it (ties in time broken by arrival)',
      fill(STREAM, { tags: f.tags, project: f.scan.project, window: f.window, end: f.scan.end, where: f.globalWhere }),
    ),
  ];
  for (let k = 2; k <= f.stepCount; k++) {
    ctes.push(cte(`s${k}`, `strict: the event right after step ${k - 1} must be step ${k} (any other event breaks the chain)`, fill(NEXT_STEP_STRICT, { prev: index(k - 1), k: index(k) })));
  }
  return ctes;
}

/** `n1 IS NOT NULL AND … AND greatest(n1, …, nk) <= t0 + window`: this anchor's window holds steps 1..k. */
function anchorOk(k: number, window: Sql): Sql {
  const upTo = stepNumbers(k);
  return fill(ANCHOR_OK, {
    nexts: joinSql(
      upTo.map((i) => fill('n{i}', { i: index(i) })),
      ', ',
    ),
    present: joinSql(
      upTo.map((i) => fill('n{i} IS NOT NULL', { i: index(i) })),
      ' AND ',
    ),
    window,
  });
}

/** anchors, converted, s1 … sN for `any`: steps 1..k all occur inside one window of the given length, wherever it starts. */
function anyOrderSteps(f: FunnelParts): Sql[] {
  const ks = stepNumbers(f.stepCount);
  const nexts = joinSql(
    ks.map((k) => fill(NEXT_OF_STEP, { k: index(k) })),
    '',
  );
  const converted = fill(CONVERTED, {
    earliest: joinSql(
      ks.slice(1).map((k) => fill(EARLIEST_ANCHOR, { ok: anchorOk(k, f.window), k: index(k) })),
      '',
    ),
    all: joinSql(
      ks.map((i) => fill('n{i}', { i: index(i) })),
      ', ',
    ),
    okLast: anchorOk(f.stepCount, f.window),
  });
  const ctes = [
    cte('anchors', 'any order: from every funnel event, the earliest occurrence of each step at or after it', fill(ANCHORS, { nexts })),
    cte('converted', 'per person, the earliest anchor whose window holds steps 1..k, for every k, and the occurrences chosen at the anchor that completes the funnel', converted),
    firstStep('did step 1 in range (in any order the window may start at a later step, but step 1 is counted from the first)'),
  ];
  for (let k = 2; k <= f.stepCount; k++) {
    const template = k === f.stepCount ? ANY_LAST_STEP : ANY_STEP;
    ctes.push(cte(`s${k}`, `did steps 1 to ${k} inside one window`, fill(template, { k: index(k) })));
  }
  return ctes;
}

function finalSelect(spec: FunnelSpec, stepCount: number, breakdownCap: Sql | null): Sql {
  const ks = stepNumbers(stepCount);
  const last = index(stepCount);
  const holes = {
    counts: joinSql(
      ks.map((k) => fill(STEP_COUNT, { k: index(k) })),
      ',\n       ',
    ),
    joins: joinSql(
      ks.slice(1).map((k) => fill(STEP_JOIN, { k: index(k) })),
      '',
    ),
    span: spec.order === 'any' ? fill('s{last}.t_last - s{last}.t_first', { last }) : fill('s{last}.t{last} - s{last}.t1', { last }),
    last,
  };
  return breakdownCap === null ? fill(FINAL, holes) : fill(FINAL_BREAKDOWN, holes);
}

export function compileFunnel(spec: FunnelSpec, ctx: CompileCtx): Compiled {
  const p = new Params();
  const scan = beginScan(spec.range, ctx, p);
  const steps = spec.steps.map((s, i) => {
    const event = p.add(s.event, `step ${i + 1} event`);
    return { event, tag: stepTag(event, s.where, p) };
  });
  const window = p.add(intervalOf(spec.window), 'conversion window');
  const breakdownKey = spec.breakdown === undefined ? null : p.add(spec.breakdown, 'breakdown property key');
  const tags = joinSql(
    steps.map((s) => s.tag),
    ', ',
  );
  const globalWhere = andFilters(spec.where, p);
  const parts: FunnelParts = { scan, tags, window, globalWhere, stepCount: spec.steps.length };

  const e = cte(
    'e',
    "the funnel's events in range, resolved to persons, tagged with the steps each one satisfies",
    fill(EVENTS, {
      tags,
      breakdown: breakdownKey === null ? fill('') : fill(BREAKDOWN_COLUMN, { key: breakdownKey }),
      scan: personEvents(scan),
      events: joinSql(
        steps.map((s) => s.event),
        ', ',
      ),
      where: globalWhere,
    }),
  );

  const orderCtes = spec.order === 'sequential' ? sequentialSteps(parts) : spec.order === 'strict' ? strictSteps(parts) : anyOrderSteps(parts);

  const ctes = [e, ...orderCtes];
  let breakdownCap: Sql | null = null;
  if (breakdownKey !== null) {
    breakdownCap = p.add(QUERY_LIMITS.breakdownValues, 'breakdown groups kept by name (the rest are "other")');
    ctes.push(
      cte('b', "breakdown: the property's value on each person's first step-1 event", fill(BREAKDOWN_VALUE)),
      cte('top', 'the commonest values keep their name — every other value is reported as "other"', fill(TOP_VALUES, { cap: breakdownCap })),
      cte('g', 'each step-1 person with the group they are counted under', fill(GROUPS)),
    );
  }

  const sql = assembleStatement(ctes, finalSelect(spec, spec.steps.length, breakdownCap), p, ctx.rowCap);
  return seal('funnel', ctx, { sql, params: p.list }, compileMeta(spec.range, ctx));
}

/** The columns the compiled statement produces; `is_total`/`breakdown_*` exist only with a breakdown. */
interface FunnelRow {
  is_total?: boolean;
  breakdown_value?: string | null;
  breakdown_other?: boolean;
  median_s: number | null;
  [step: `step_${number}`]: number;
}

export interface FunnelData {
  steps: FunnelStep[];
  median_time_to_convert_s: number | null;
  breakdown: FunnelResult['breakdown'];
}

function countsOf(row: FunnelRow, stepCount: number): number[] {
  return Array.from({ length: stepCount }, (_, i) => Number(row[`step_${i + 1}`]));
}

function stepsOf(spec: FunnelSpec, counts: number[]): FunnelStep[] {
  const start = counts[0] ?? 0;
  return spec.steps.map((s, i) => {
    const persons = counts[i] ?? 0;
    const previous = i === 0 ? null : (counts[i - 1] ?? 0);
    return {
      event: s.event,
      persons,
      pct_of_previous: previous === null || previous === 0 ? null : persons / previous,
      pct_of_start: start === 0 ? null : persons / start,
    };
  });
}

/** Rows → result body. With a breakdown the total row (`is_total`) carries the funnel and the others the groups; without one there is exactly one row. */
export function decodeFunnel(rows: readonly unknown[], spec: FunnelSpec): FunnelData {
  const typed = rows as readonly FunnelRow[];
  const total = spec.breakdown === undefined ? typed[0] : typed.find((r) => r.is_total);
  if (!total) throw new Error('decodeFunnel: the statement returned rows but no total row');
  const groups = typed.filter((r) => r !== total).map((r) => ({ value: r.breakdown_value ?? null, other: r.breakdown_other === true, persons: countsOf(r, spec.steps.length) }));
  return {
    steps: stepsOf(spec, countsOf(total, spec.steps.length)),
    median_time_to_convert_s: total.median_s,
    breakdown: spec.breakdown === undefined ? null : { key: spec.breakdown, groups },
  };
}

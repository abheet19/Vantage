/**
 * compile.spec.ts — the exact SQL for the design's §3.2/§3.3 specs as snapshots (a changed query is a visible
 * diff), V7(a) and V14 as properties over every spec the grammar admits, and the decoders.
 */
import { CountSpec, FunnelSpec, PathsSpec, QUERY_LIMITS, RetentionSpec, TrendSpec, type QuerySpec } from '@vantage/contracts';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cohortLimit, compile, compileCount, compileFunnel, compilePaths, compileRetention, compileTrend, decodeCount, decodeFunnel, decodePaths, decodeRetention, decodeTrend, isCompiled, type CompileCtx } from '../../src/domain/compile/index.js';
import { fill, index } from '../../src/domain/compile/sql.js';
import { arbAnySpec, PROJECT_ID } from '../helpers/arbitraries.js';

const ctx: CompileCtx = { projectId: PROJECT_ID, timezone: 'Asia/Kolkata', rowCap: QUERY_LIMITS.rowCap };
const range = { from: '2026-08-01', to: '2026-08-31' };
const threeSteps = [{ event: 'signup' }, { event: 'create_project' }, { event: 'invite_teammate' }];

const funnel = (over: Partial<Record<string, unknown>> = {}) => FunnelSpec.parse({ kind: 'funnel', project: PROJECT_ID, range, steps: threeSteps, ...over });
const retention = (over: Partial<Record<string, unknown>> = {}) => RetentionSpec.parse({ kind: 'retention', project: PROJECT_ID, range, start: { event: 'signup' }, return: { event: 'view_pricing' }, ...over });
const trend = (over: Partial<Record<string, unknown>> = {}) => TrendSpec.parse({ kind: 'trend', project: PROJECT_ID, range, event: { event: 'signup' }, ...over });
const paths = (over: Partial<Record<string, unknown>> = {}) => PathsSpec.parse({ kind: 'paths', project: PROJECT_ID, range, start: 'signup', ...over });
const count = CountSpec.parse({ kind: 'count', project: PROJECT_ID, range, event: { event: 'signup' } });

describe('compileFunnel: the design §3.2 funnel and its two other orders', () => {
  it('sequential, 3 steps, 14-day window: one CTE per statement about people, parameters only for values', () => {
    const c = compileFunnel(funnel(), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.params).toEqual([PROJECT_ID, 'Asia/Kolkata', '2026-08-01', '2026-08-31', 'signup', 'create_project', 'invite_teammate', '14 days', QUERY_LIMITS.rowCap + 1]);
    expect(c.kind).toBe('funnel');
  });

  it('strict: adds the lead()-based stream, ordered by (event_ts, event_id) so ties are walked in arrival order, and requires the next event to be the next step', () => {
    const c = compileFunnel(funnel({ order: 'strict' }), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.sql).toContain('lead(ev.event_ts) OVER w');
    expect(c.sql).toContain('ORDER BY ev.event_ts, ev.event_id');
  });

  it('any: every funnel event anchors a window; the earliest anchor from which every step occurs by anchor + window wins (decision 2026-09-05)', () => {
    const c = compileFunnel(funnel({ order: 'any', window: { value: 7, unit: 'days' } }), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.params).toContain('7 days');
    expect(c.sql).toContain('WINDOW w AS (PARTITION BY person_id ORDER BY event_ts DESC)');
    expect(c.sql).toContain('min(t0) FILTER (WHERE n1 IS NOT NULL AND n2 IS NOT NULL AND greatest(n1, n2) <= t0 + $8::interval) AS a2');
    expect(c.sql).toContain('greatest(n1, n2, n3) <= t0 + $8::interval');
    expect(c.sql).not.toContain('DISTINCT ON');
  });

  it('with a breakdown: the 50 commonest values keep their name, the rest are "other", totals via GROUPING SETS', () => {
    const c = compileFunnel(funnel({ breakdown: 'plan' }), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.params).toContain('plan');
    expect(c.params).toContain(QUERY_LIMITS.breakdownValues);
  });

  it('with step and global property filters: keys and values are parameters, operators come from the allowlist', () => {
    const spec = funnel({
      steps: [{ event: 'signup', where: [{ key: 'plan', op: 'eq', value: 'team' }] }, { event: 'create_project' }],
      where: [
        { key: 'utm.source', op: 'in', value: ['ads', 'organic'] },
        { key: '$browser', op: 'is_set' },
        { key: 'n', op: 'gt', value: 10 },
        { key: 'q', op: 'contains', value: '%_x' },
        { key: 'r', op: 'not_in', value: [1, null] },
        { key: 's', op: 'neq', value: false },
        { key: 't', op: 'is_not_set' },
      ],
    });
    const c = compileFunnel(spec, ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.params).toEqual(expect.arrayContaining(['plan', '"team"', 'utm.source', '["ads","organic"]', '$browser', 'n', '10', 'q', '%_x', 'r', '[1,null]', 's', 'false', 't']));
    expect(c.sql).not.toContain('team');
    expect(c.sql).not.toContain('%_x');
  });

  it('a hostile event name never appears in the SQL text', () => {
    const c = compileFunnel(funnel({ steps: [{ event: "'; DROP TABLE events; --" }, { event: 'x' }] }), ctx);
    expect(c.sql).not.toContain('DROP');
    expect(c.params).toContain("'; DROP TABLE events; --");
  });
});

describe('compileRetention: the design §3.3 cohort query with D2, mode, in_progress and whole-cohort truncation', () => {
  it("day cohorts, 'on': one LEFT JOIN on exactly bucket + n (no aggregate in the grid); activity bounded at the periods horizon; newest cohorts first", () => {
    const c = compileRetention(retention(), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.params).toEqual([PROJECT_ID, 'Asia/Kolkata', '2026-08-01', '2026-08-31', 'day', 14, 'signup', 'view_pricing', 3600, 667, QUERY_LIMITS.rowCap + 1]);
    expect(c.sql).toContain('LEFT JOIN activity a ON a.person_id = c.person_id AND a.active_bucket = c.cohort_bucket');
    expect(c.sql).not.toContain('bool_or');
    expect(c.sql).toContain('ORDER BY cohort_bucket DESC, n');
  });

  it("'on_or_after' compares the member's last return bucket inside the cohort's own horizon (bucket + periods) with >= (decision 2026-09-05)", () => {
    const c = compileRetention(retention({ mode: 'on_or_after', unit: 'week', periods: 6 }), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.sql).toContain("a.active_bucket < c.cohort_bucket + (($6::int + 1) || ' ' || $5)::interval");
    expect(c.sql).toContain('l.last_active >= c.cohort_bucket');
  });

  it('return defaults to start', () => {
    const c = compileRetention(retention({ return: undefined }), ctx);
    expect(c.params.filter((p) => p === 'signup')).toHaveLength(2);
  });

  it('computes the newest floor(rowCap / (periods + 1)) + 1 cohorts: the ones that fit whole, plus one whose cells reveal the cut', () => {
    expect(cohortLimit(QUERY_LIMITS.rowCap, 30)).toBe(323);
    expect(cohortLimit(QUERY_LIMITS.rowCap, 14)).toBe(667);
    expect(cohortLimit(QUERY_LIMITS.rowCap, 15)).toBe(626); // 16 divides 10 000: the 626th cohort is entirely past the cap
    expect(cohortLimit(7, 14)).toBe(1);
    const c = compileRetention(retention({ periods: 30 }), { ...ctx, rowCap: 100 });
    expect(c.params).toContain(4);
    expect(c.sql).toContain('LIMIT $10');
  });

  it('the unit is a parameter everywhere, CTE comments included — no spec value is written into the SQL text', () => {
    const c = compileRetention(retention({ unit: 'month' }), ctx);
    expect(c.sql).not.toMatch(/\bmonth\b/);
    expect(c.params).toContain('month');
  });

  it('flags one row per bucket that may still receive events for the footer, and every cell for the heatmap', () => {
    const c = compileRetention(retention(), ctx);
    expect(c.sql).toContain('AS in_progress');
    expect(c.sql).toContain('row_number() OVER (PARTITION BY cohort_bucket + (n || \' \' || $5)::interval ORDER BY cohort_bucket DESC) = 1 AS incomplete_bucket');
  });
});

describe('compileCount', () => {
  it('persons and events of one event in range, no row when nothing matched', () => {
    const c = compileCount(count, ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.sql).toContain('HAVING count(*) > 0');
  });
});

describe('compileTrend: the design §3.4 trend by bucket', () => {
  it('day buckets in the project timezone, count(*) per bucket, in-progress flagged, no row for an empty bucket', () => {
    const c = compileTrend(trend(), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.params).toEqual([PROJECT_ID, 'Asia/Kolkata', '2026-08-01', '2026-08-31', 'day', 'signup', 3600, QUERY_LIMITS.rowCap + 1]);
    expect(c.kind).toBe('trend');
    expect(c.sql).toContain('date_trunc($5, ev.event_ts AT TIME ZONE $2)');
    expect(c.sql).toContain('count(*)::int AS value');
    expect(c.sql).toContain('GROUP BY bucket');
    expect(c.sql).toContain('AS incomplete_bucket');
  });

  it('the persons measure counts distinct persons per bucket', () => {
    const c = compileTrend(trend({ measure: 'persons' }), ctx);
    expect(c.sql).toContain('count(DISTINCT person_id)::int AS value');
    expect(c.sql).not.toContain('count(*)::int AS value');
  });

  it('a breakdown caps at 50 values + "other" and returns the total and the groups via GROUPING SETS', () => {
    const c = compileTrend(trend({ breakdown: 'plan' }), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.params).toContain('plan');
    expect(c.params).toContain(QUERY_LIMITS.breakdownValues);
    expect(c.sql).toContain('GROUP BY GROUPING SETS ((bucket), (bucket, value, other))');
    expect(c.sql).toContain('grouping(value, other) = 3 AS is_total');
  });

  it('the unit and the measure are never written into the SQL text as a spec value (the unit is a parameter, the measure is a chosen literal)', () => {
    const c = compileTrend(trend({ unit: 'month', measure: 'persons' }), ctx);
    expect(c.sql).not.toMatch(/\bmonth\b/);
    expect(c.params).toContain('month');
  });
});

describe('compilePaths: the design §3.4 top transitions', () => {
  it('sessionises by the gap, walks from the start with lead(), keeps step <= steps, ranks by count and reports the total', () => {
    const c = compilePaths(paths(), ctx);
    expect(c.sql).toMatchSnapshot();
    expect(c.params).toEqual([PROJECT_ID, 'Asia/Kolkata', '2026-08-01', '2026-08-31', 'signup', '30 minutes', 3, QUERY_LIMITS.pathsTransitions, QUERY_LIMITS.rowCap + 1]);
    expect(c.kind).toBe('paths');
    expect(c.sql).toContain('lead(event) OVER w AS to_event');
    expect(c.sql).toContain('WHERE to_event IS NOT NULL AND step <= $7');
    expect(c.sql).toContain('(count(*) OVER ())::int AS total_transitions');
    expect(c.sql).toContain('LIMIT $8');
    expect(c.sql).toContain('ORDER BY r.walks DESC, r.step, r.from_event, r.to_event');
  });

  it('the session gap and the top-N are parameters; the start event never appears in the SQL text', () => {
    const c = compilePaths(paths({ start: "'; DROP TABLE events; --", steps: 5, session_gap_minutes: 60 }), ctx);
    expect(c.sql).not.toContain('DROP');
    expect(c.params).toContain("'; DROP TABLE events; --");
    expect(c.params).toContain('60 minutes');
  });
});

describe('compile: dispatch', () => {
  it('routes each of the five kinds to its compiler', () => {
    expect(compile(funnel(), ctx).kind).toBe('funnel');
    expect(compile(retention(), ctx).kind).toBe('retention');
    expect(compile(trend(), ctx).kind).toBe('trend');
    expect(compile(paths(), ctx).kind).toBe('paths');
    expect(compile(count, ctx).kind).toBe('count');
  });

  it('only compile() can make a Compiled: a hand-built object with the same fields is not one (V7b)', () => {
    const c = compile(count, ctx);
    expect(isCompiled(c)).toBe(true);
    expect(isCompiled({ sql: c.sql, params: c.params, kind: c.kind, ctx, meta: c.meta })).toBe(false);
    expect(isCompiled(null)).toBe(false);
  });

  it('every compiled statement carries a meta statement bound to the same project and range', () => {
    const c = compile(retention(), ctx);
    expect(c.meta.sql).toMatch(/^SELECT\b/);
    expect(c.meta.sql).toContain('project_id = $1');
    expect(c.meta.params).toEqual([PROJECT_ID, 'Asia/Kolkata', '2026-08-01', '2026-08-31']);
  });
});

describe('V7(a) + V14: properties over every spec the grammar admits', () => {
  const ctxFor = (tz: string) => ({ projectId: PROJECT_ID, timezone: tz, rowCap: QUERY_LIMITS.rowCap });
  const compiledStatements = (spec: QuerySpec) => {
    const c = compile(spec, ctxFor('Europe/London'));
    return [c, c.meta];
  };

  it('V7(a): output begins with WITH or SELECT and contains no ";" — whatever the spec says', () => {
    fc.assert(
      fc.property(arbAnySpec, (spec) => {
        for (const s of compiledStatements(spec)) {
          expect(s.sql).toMatch(/^(WITH|SELECT)\b/);
          expect(s.sql).not.toContain(';');
        }
      }),
      { numRuns: 400 },
    );
  });

  it('V14: every statement and every CTE that reads a table binds project_id = $1, and $1 is the caller’s project', () => {
    fc.assert(
      fc.property(arbAnySpec, (spec) => {
        for (const s of compiledStatements(spec)) {
          expect(s.sql).toContain('project_id = $1');
          expect(s.params[0]).toBe(PROJECT_ID);
          for (const body of s.sql.split(/\n\w+ AS \(/).slice(1)) {
            if (/FROM events\b|JOIN events\b/.test(body)) expect(body).toContain('project_id = $1');
          }
        }
      }),
      { numRuns: 400 },
    );
  });

  it('no spec value ever appears in the SQL text: event names, keys and filter values are parameters only', () => {
    fc.assert(
      fc.property(arbAnySpec, (spec) => {
        const c = compile(spec, ctxFor('UTC'));
        const values = JSON.stringify(spec).match(/"(?:[^"\\]|\\.)*"/g) ?? [];
        for (const quoted of values) {
          const v = JSON.parse(quoted) as string;
          if (v.length >= 6 && !/^[a-z_]+$/.test(v)) expect(c.sql).not.toContain(v);
        }
        expect(c.sql).toContain(`LIMIT $${c.params.length}`);
        expect(c.params[c.params.length - 1]).toBe(QUERY_LIMITS.rowCap + 1);
      }),
      { numRuns: 300 },
    );
  });

  it('the LIMIT is the compiler’s: rowCap + 1 so the runner can see truncation', () => {
    const c = compileFunnel(funnel(), { ...ctx, rowCap: 7 });
    expect(c.params[c.params.length - 1]).toBe(8);
    expect(c.sql).toMatch(/LIMIT \$\d+\n-- /);
  });
});

describe('decoders', () => {
  it('decodeFunnel: counts, pct_of_previous (null for step 1 and after a zero), pct_of_start', () => {
    const d = decodeFunnel([{ step_1: 12, step_2: 7, step_3: 0, median_s: null }], funnel());
    expect(d.steps).toEqual([
      { event: 'signup', persons: 12, pct_of_previous: null, pct_of_start: 1 },
      { event: 'create_project', persons: 7, pct_of_previous: 7 / 12, pct_of_start: 7 / 12 },
      { event: 'invite_teammate', persons: 0, pct_of_previous: 0, pct_of_start: 0 },
    ]);
    expect(d.median_time_to_convert_s).toBeNull();
    expect(d.breakdown).toBeNull();
  });

  it('decodeFunnel with breakdown: the total row is the funnel, the others are groups in order', () => {
    const rows = [
      { is_total: true, breakdown_value: null, breakdown_other: null, step_1: 5, step_2: 3, step_3: 1, median_s: 60 },
      { is_total: false, breakdown_value: 'free', breakdown_other: false, step_1: 3, step_2: 2, step_3: 1, median_s: 60 },
      { is_total: false, breakdown_value: null, breakdown_other: true, step_1: 2, step_2: 1, step_3: 0, median_s: null },
    ];
    const d = decodeFunnel(rows, funnel({ breakdown: 'plan' }));
    expect(d.steps.map((s) => s.persons)).toEqual([5, 3, 1]);
    expect(d.median_time_to_convert_s).toBe(60);
    expect(d.breakdown).toEqual({
      key: 'plan',
      groups: [
        { value: 'free', other: false, persons: [3, 2, 1] },
        { value: null, other: true, persons: [2, 1, 0] },
      ],
    });
  });

  it('decodeFunnel refuses rows without a total', () => {
    expect(() => decodeFunnel([{ is_total: false, step_1: 1, step_2: 1, median_s: null }], funnel({ breakdown: 'plan' }))).toThrow(/no total row/);
  });

  it('decodeRetention: rows arrive newest cohort first and leave oldest first; pct null for an empty cohort', () => {
    const rows = [
      { bucket: '2026-08-05T00:00:00', n: 0, size: 0, retained: 0, in_progress: true },
      { bucket: '2026-08-05T00:00:00', n: 1, size: 0, retained: 0, in_progress: true },
      { bucket: '2026-08-03T00:00:00', n: 0, size: 2, retained: 0, in_progress: false },
      { bucket: '2026-08-03T00:00:00', n: 1, size: 2, retained: 2, in_progress: false },
    ];
    expect(decodeRetention(rows, { periods: 1 })).toEqual([
      { bucket: '2026-08-03T00:00:00', size: 2, cells: [{ n: 0, retained: 0, pct: 0, in_progress: false }, { n: 1, retained: 2, pct: 1, in_progress: false }] },
      { bucket: '2026-08-05T00:00:00', size: 0, cells: [{ n: 0, retained: 0, pct: null, in_progress: true }, { n: 1, retained: 0, pct: null, in_progress: true }] },
    ]);
  });

  it('decodeRetention drops the one cohort the row cap cut short — a returned cohort is all of its cells', () => {
    const rows = [
      { bucket: '2026-08-05T00:00:00', n: 0, size: 1, retained: 0, in_progress: false },
      { bucket: '2026-08-05T00:00:00', n: 1, size: 1, retained: 1, in_progress: false },
      { bucket: '2026-08-03T00:00:00', n: 0, size: 2, retained: 0, in_progress: false },
    ];
    expect(decodeRetention(rows, { periods: 1 }).map((c) => c.bucket)).toEqual(['2026-08-05T00:00:00']);
  });

  it('decodeCount: one row, two numbers; no row is a programming error', () => {
    expect(decodeCount([{ persons: 12, events: 13 }])).toEqual({ persons: 12, events: 13 });
    expect(() => decodeCount([])).toThrow(/no row/);
  });

  it('decodeTrend without a breakdown: one point per bucket, in order', () => {
    const rows = [
      { bucket: '2026-08-03T00:00:00', value: 2, in_progress: false },
      { bucket: '2026-08-05T00:00:00', value: 1, in_progress: true },
    ];
    expect(decodeTrend(rows, trend())).toEqual({
      points: [
        { bucket: '2026-08-03T00:00:00', value: 2, in_progress: false },
        { bucket: '2026-08-05T00:00:00', value: 1, in_progress: true },
      ],
      breakdown: null,
    });
  });

  it('decodeTrend with a breakdown: the total rows are the overall series, the others group into per-value series with "other" null-keyed', () => {
    const rows = [
      { is_total: true, breakdown_value: null, breakdown_other: false, bucket: '2026-08-03T00:00:00', value_n: 5, in_progress: false },
      { is_total: false, breakdown_value: 'free', breakdown_other: false, bucket: '2026-08-03T00:00:00', value_n: 3, in_progress: false },
      { is_total: false, breakdown_value: null, breakdown_other: true, bucket: '2026-08-03T00:00:00', value_n: 2, in_progress: false },
      { is_total: true, breakdown_value: null, breakdown_other: false, bucket: '2026-08-04T00:00:00', value_n: 1, in_progress: true },
      { is_total: false, breakdown_value: 'free', breakdown_other: false, bucket: '2026-08-04T00:00:00', value_n: 1, in_progress: true },
    ];
    const d = decodeTrend(rows, trend({ breakdown: 'plan' }));
    expect(d.points).toEqual([
      { bucket: '2026-08-03T00:00:00', value: 5, in_progress: false },
      { bucket: '2026-08-04T00:00:00', value: 1, in_progress: true },
    ]);
    expect(d.breakdown).toEqual({
      key: 'plan',
      series: [
        { key: 'free', other: false, points: [{ bucket: '2026-08-03T00:00:00', value: 3, in_progress: false }, { bucket: '2026-08-04T00:00:00', value: 1, in_progress: true }] },
        { key: null, other: true, points: [{ bucket: '2026-08-03T00:00:00', value: 2, in_progress: false }] },
      ],
    });
  });

  it('decodePaths: ranked transitions, starts and total from the first row, pct_of_start null for a zero denominator', () => {
    const rows = [
      { step: 1, from_event: 'signup', to_event: 'view_pricing', walks: 2, median_gap_s: 930, total_transitions: 8, starts: 14 },
      { step: 1, from_event: 'signup', to_event: 'create_project', walks: 1, median_gap_s: 1800, total_transitions: 8, starts: 14 },
    ];
    const d = decodePaths(rows);
    expect(d.starts).toBe(14);
    expect(d.total_transitions).toBe(8);
    expect(d.transitions[0]).toEqual({ step: 1, from: 'signup', to: 'view_pricing', count: 2, pct_of_start: 2 / 14, median_gap_s: 930 });
    expect(d.transitions[1]?.pct_of_start).toBe(1 / 14);
    expect(decodePaths([{ step: 1, from_event: 'a', to_event: 'b', walks: 0, median_gap_s: null, total_transitions: 1, starts: 0 }]).transitions[0]?.pct_of_start).toBeNull();
    expect(() => decodePaths([])).toThrow(/no row/);
  });
});

describe('sql fragments', () => {
  it('fill refuses an unfilled hole and an unused fragment — both are compiler bugs', () => {
    expect(() => fill('SELECT {a}', {})).toThrow(/no fragment for \{a\}/);
    expect(() => fill('SELECT 1', { a: fill('1') })).toThrow(/not used/);
  });

  it('index admits only positive step numbers', () => {
    expect(index(3)).toBe('3');
    expect(() => index(0)).toThrow();
    expect(() => index(1.5)).toThrow();
  });
});

/**
 * fixtures.ts — result envelopes the component/unit tests assert against, matching the contract shapes.
 *
 * The numbers mirror the demo funnel (signup → create_project → invite_teammate, 13 → 6 → 3), so a test
 * that gets the percentages wrong is caught against hand-checkable values.
 */
import type { CountResult, FunnelResult, FunnelStep, PathsResult, ResultMeta, ResultStatus, RetentionResult, TrendResult } from '@vantage/contracts';

export function meta(status: ResultStatus = 'complete', overrides: Partial<ResultMeta> = {}): ResultMeta {
  return {
    status,
    computed_at: '2026-08-31T09:12:00.000Z',
    data_until: status === 'empty' || status === 'timed_out' ? null : '2026-08-31T03:42:00.000Z',
    elapsed_ms: 410,
    incomplete_buckets: 0,
    ts_adjusted_share: 0,
    persons_merged_since: 0,
    timezone: 'Asia/Kolkata',
    row_cap: 10_000,
    ...overrides,
  };
}

const DEMO_STEPS: FunnelStep[] = [
  { event: 'signup', persons: 13, pct_of_previous: null, pct_of_start: 1 },
  { event: 'create_project', persons: 6, pct_of_previous: 6 / 13, pct_of_start: 6 / 13 },
  { event: 'invite_teammate', persons: 3, pct_of_previous: 3 / 6, pct_of_start: 3 / 13 },
];

export function funnelResult(overrides: Partial<FunnelResult> = {}): FunnelResult {
  return {
    steps: DEMO_STEPS,
    median_time_to_convert_s: 194_400, // 2 d 6 h
    breakdown: null,
    sql: "SELECT count(*) FROM events WHERE project_id = $1 AND event = $2",
    params: ['proj-1', 'signup'],
    meta: meta('complete'),
    ...overrides,
  };
}

export function emptyFunnel(): FunnelResult {
  return { steps: null, median_time_to_convert_s: null, breakdown: null, sql: 'SELECT 1', params: [], meta: meta('empty') };
}

export function timedOutFunnel(): FunnelResult {
  return { steps: null, median_time_to_convert_s: null, breakdown: null, sql: 'SELECT 1', params: [], meta: meta('timed_out') };
}

export function countResult(persons: number, events: number): CountResult {
  return { persons, events, sql: 'SELECT count(*) FROM events WHERE project_id = $1', params: ['proj-1'], meta: meta('complete') };
}

export function retentionResult(cohortCount: number, over: { status?: ResultStatus; inProgressLastCell?: boolean } = {}): RetentionResult {
  return {
    unit: 'week',
    cohorts:
      over.status && over.status !== 'complete' && over.status !== 'truncated'
        ? null
        : Array.from({ length: cohortCount }, (_, i) => ({
            bucket: `2026-08-0${i + 1}`,
            size: 10,
            cells: [
              { n: 0, retained: 10, pct: 1, in_progress: false },
              { n: 1, retained: 4, pct: 0.4, in_progress: false },
              { n: 2, retained: 0, pct: 0, in_progress: Boolean(over.inProgressLastCell) },
            ],
          })),
    sql: 'SELECT 1',
    params: [],
    meta: meta(over.status ?? 'complete'),
  };
}

export function trendResult(over: { status?: ResultStatus; breakdown?: boolean; inProgressLast?: boolean } = {}): TrendResult {
  const status = over.status ?? 'complete';
  const settled = status === 'complete' || status === 'truncated';
  const points = settled
    ? [
        { bucket: '2026-08-03T00:00:00', value: 2, in_progress: false },
        { bucket: '2026-08-05T00:00:00', value: 5, in_progress: false },
        { bucket: '2026-08-06T00:00:00', value: 3, in_progress: Boolean(over.inProgressLast) },
      ]
    : null;
  return {
    measure: 'events',
    unit: 'day',
    points,
    breakdown:
      settled && over.breakdown
        ? {
            key: 'plan',
            series: [
              { key: 'free', other: false, points: (points ?? []).map((p) => ({ ...p, value: Math.floor(p.value / 2) })) },
              { key: null, other: true, points: (points ?? []).map((p) => ({ ...p, value: Math.ceil(p.value / 2) })) },
            ],
          }
        : null,
    sql: 'WITH e AS (SELECT 1)\nSELECT 1',
    params: ['proj-1', 'day'],
    meta: meta(status),
  };
}

export function pathsResult(over: { status?: ResultStatus; total?: number; count?: number } = {}): PathsResult {
  const status = over.status ?? 'complete';
  const settled = status === 'complete' || status === 'truncated';
  return {
    start: 'signup',
    starts: settled ? 14 : null,
    transitions: settled
      ? [
          { step: 1, from: 'signup', to: 'view_pricing', count: over.count ?? 2, pct_of_start: (over.count ?? 2) / 14, median_gap_s: 930 },
          { step: 1, from: 'signup', to: 'create_project', count: 1, pct_of_start: 1 / 14, median_gap_s: 1800 },
        ]
      : null,
    total_transitions: over.total ?? 2,
    sql: 'WITH e AS (SELECT 1)\nSELECT 1',
    params: ['proj-1', 'signup'],
    meta: meta(status),
  };
}

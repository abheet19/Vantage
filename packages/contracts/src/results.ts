/**
 * results.ts — the result envelopes for `POST /v1/funnel|retention|count` (LLD §3.1).
 *
 * Why it exists: every insight and, later, every MCP tool returns the same `meta` block, and its
 * `status` is a closed set so a UI cannot render a partial answer as a complete one (design §1.3).
 * The number-carrying fields are nullable for the same reason: when the status is `timed_out`,
 * `empty` or `refused_by_database` there is no number to show, and `null` is the only value that
 * cannot be mistaken for one — `steps: []` or `persons: 0` would be a plausible lie.
 *
 * What it must never do: carry a status outside the six, or a number without the `meta` that says
 * how far it can be trusted (`data_until`, `incomplete_buckets`, `ts_adjusted_share`).
 *
 * One extension to the LLD's text, recorded in 00-GATES.md: `FunnelResult.breakdown` — the grammar
 * has had `breakdown` since Gate 2 but the result shape had no place to put the groups.
 */
import { z } from 'zod';
import { PropKey } from './query-spec.js';

/** The result envelope every insight and every MCP tool returns. `status` is a closed set so the UI cannot render a partial as complete (design §1.3). */
export const ResultMeta = z.object({
  status: z.enum(['complete', 'empty', 'timed_out', 'truncated', 'refused', 'refused_by_database']),
  computed_at: z.string().datetime(),
  data_until: z.string().datetime().nullable(),
  elapsed_ms: z.number().int(),
  incomplete_buckets: z.number().int(),
  ts_adjusted_share: z.number().min(0).max(1),
  persons_merged_since: z.number().int(),
  timezone: z.string(),
  row_cap: z.number().int(),
});
export type ResultMeta = z.infer<typeof ResultMeta>;
export type ResultStatus = ResultMeta['status'];

export const FunnelStep = z.object({
  event: z.string(),
  persons: z.number().int(),
  pct_of_previous: z.number().nullable(),
  pct_of_start: z.number().nullable(),
});
export type FunnelStep = z.infer<typeof FunnelStep>;

/** One breakdown group: `other` lumps every value outside the commonest 50; `value` is null when the property was not set (or for the `other` group). */
export const FunnelGroup = z.object({ value: z.string().nullable(), other: z.boolean(), persons: z.array(z.number().int()) });
export type FunnelGroup = z.infer<typeof FunnelGroup>;

export const FunnelResult = z.object({
  steps: z.array(FunnelStep).nullable(),
  median_time_to_convert_s: z.number().nullable(),
  breakdown: z.object({ key: PropKey, groups: z.array(FunnelGroup) }).nullable(),
  sql: z.string(),
  params: z.array(z.unknown()),
  meta: ResultMeta,
});
export type FunnelResult = z.infer<typeof FunnelResult>;

export const RetentionCell = z.object({ n: z.number().int(), retained: z.number().int(), pct: z.number().nullable(), in_progress: z.boolean() });
export type RetentionCell = z.infer<typeof RetentionCell>;

export const RetentionCohort = z.object({ bucket: z.string(), size: z.number().int(), cells: z.array(RetentionCell) });
export type RetentionCohort = z.infer<typeof RetentionCohort>;

export const RetentionResult = z.object({
  unit: z.enum(['day', 'week', 'month']),
  cohorts: z.array(RetentionCohort).nullable(),
  sql: z.string(),
  params: z.array(z.unknown()),
  meta: ResultMeta,
});
export type RetentionResult = z.infer<typeof RetentionResult>;

export const CountResult = z.object({
  persons: z.number().int().nullable(),
  events: z.number().int().nullable(),
  sql: z.string(),
  params: z.array(z.unknown()),
  meta: ResultMeta,
});
export type CountResult = z.infer<typeof CountResult>;

/** One bucket of a trend: the local bucket start, the measure's value in it, and whether the bucket may still receive events. */
export const TrendPoint = z.object({ bucket: z.string(), value: z.number().int(), in_progress: z.boolean() });
export type TrendPoint = z.infer<typeof TrendPoint>;

/** One breakdown series: `other` lumps every value outside the commonest 50; `key` is null when the property was not set (or for the `other` series). */
export const TrendSeries = z.object({ key: z.string().nullable(), other: z.boolean(), points: z.array(TrendPoint) });
export type TrendSeries = z.infer<typeof TrendSeries>;

export const TrendResult = z.object({
  measure: z.enum(['events', 'persons']),
  unit: z.enum(['hour', 'day', 'week', 'month']),
  /** The overall series (the total per bucket), or null when the status says there is no number. */
  points: z.array(TrendPoint).nullable(),
  /** When a breakdown was asked for: the same buckets split into the commonest 50 property values plus "other"; null otherwise. */
  breakdown: z.object({ key: PropKey, series: z.array(TrendSeries) }).nullable(),
  sql: z.string(),
  params: z.array(z.unknown()),
  meta: ResultMeta,
});
export type TrendResult = z.infer<typeof TrendResult>;

/** One ranked transition: its depth from the start event (1..steps), the two consecutive events, the walks that took it, its share of the start-event walks, and the median gap between the two events. */
export const PathsTransition = z.object({
  step: z.number().int(),
  from: z.string(),
  to: z.string(),
  count: z.number().int(),
  pct_of_start: z.number().nullable(),
  median_gap_s: z.number().nullable(),
});
export type PathsTransition = z.infer<typeof PathsTransition>;

export const PathsResult = z.object({
  start: z.string(),
  /** The number of sessions that began a walk at the start event (the "% of start" denominator); null when the status says there is no number. */
  starts: z.number().int().nullable(),
  /** The top transitions, ranked by count; null when the status says there is none. */
  transitions: z.array(PathsTransition).nullable(),
  /** How many distinct transitions exist before the top-50 cut, so the UI can say "showing top 50 of N". */
  total_transitions: z.number().int(),
  sql: z.string(),
  params: z.array(z.unknown()),
  meta: ResultMeta,
});
export type PathsResult = z.infer<typeof PathsResult>;

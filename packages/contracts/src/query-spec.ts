/**
 * query-spec.ts — the ONLY shapes the model, the MCP client or the web may submit (LLD §5, verbatim).
 *
 * Why it exists here from day one: this grammar is the security boundary between natural language and
 * SQL. Nothing in it can name a table, a column or a statement; every string is a VALUE compared or
 * parameterised, never an identifier. It lives in contracts because the compiler (S2), the HTTP layer
 * and the MCP `inputSchema` (S4) must all reject exactly the same inputs.
 *
 * What it must never do: grow a field that is interpolated into SQL, lose strictness (an unknown key
 * must be a validation error, not something ignored), or raise a limit without the compiler's cost
 * model changing with it (366 days, 10 steps, 10 filters, 50 `in` values, rowCap owned by the compiler).
 *
 * One deviation from the LLD's text: Zod has no `.strict()` on a discriminated union, so strictness is
 * applied to every member object (`z.strictObject`) instead — the effect the LLD describes ("a
 * smuggled field is a validation error") is identical and tested. One strengthening (S2): a property
 * filter's `value` must fit its operator — a list for `in`/`not_in`, a scalar for the comparisons,
 * nothing for `is_set`/`is_not_set` — so the compiler is total over valid specs and never has to
 * invent a meaning for `eq` without a value. Three more from the S2 hardening pass, each closing a
 * grammar-valid input that reached PostgreSQL and came back as a 500: every string value must be
 * storable text (no U+0000, no lone surrogate — the same `isStorableText` the ingest contract uses),
 * a `contains` value is a non-empty string (an empty needle matches everything, silently), and the
 * range's local dates are bounded to 1970-01-01..2200-01-01 (Zod's `date()` accepts year 0000, which
 * `AT TIME ZONE` cannot represent).
 */
import { z } from 'zod';
import { isStorableText } from './json.js';

/** Signed day count between two ISO dates; pure arithmetic on UTC midnights so it cannot depend on the process timezone. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The limits the compiler's cost model is built on (LLD §5, §3.2). `rangeDays` bounds every scan;
 * `rowCap` is the LIMIT the compiler owns; `breakdownValues` caps a breakdown at this many named
 * groups plus "other"; `filterValues` caps an `in` list.
 */
export const QUERY_LIMITS = { rangeDays: 366, rowCap: 10_000, breakdownValues: 50, filterValues: 50, pathsTransitions: 50 } as const;

/** Text PostgreSQL can hold as a parameter; the bound is byte-for-byte the one `events.event` and `properties` already enforce on ingest. */
const STORABLE = { message: 'string contains U+0000 or a lone surrogate, which PostgreSQL cannot store' };
const EventName = z.string().min(1).max(200).refine(isStorableText, STORABLE); // a VALUE compared against the catalog; never an identifier
export const PropKey = z.string().regex(/^[A-Za-z0-9_.$-]{1,100}$/); // becomes `properties ->> $n`; never interpolated
const Scalar    = z.union([z.string().max(500).refine(isStorableText, STORABLE), z.number().finite(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof Scalar>;

export const FilterOp = z.enum(['eq', 'neq', 'in', 'not_in', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_not_set']);
export type FilterOp = z.infer<typeof FilterOp>;

/** Which shape of `value` each operator takes; the compiler relies on this being enforced here. */
export const FILTER_VALUE_SHAPE: Record<FilterOp, 'none' | 'scalar' | 'list'> = {
  eq: 'scalar', neq: 'scalar', contains: 'scalar', gt: 'scalar', gte: 'scalar', lt: 'scalar', lte: 'scalar',
  in: 'list', not_in: 'list',
  is_set: 'none', is_not_set: 'none',
};

export const PropertyFilter = z.strictObject({
  key: PropKey,
  op: FilterOp,
  value: z.union([Scalar, z.array(Scalar).max(QUERY_LIMITS.filterValues)]).optional(),
}).superRefine((f, ctx) => {
  const expected = FILTER_VALUE_SHAPE[f.op];
  const actual = f.value === undefined ? 'none' : Array.isArray(f.value) ? 'list' : 'scalar';
  if (expected !== actual) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: `operator "${f.op}" takes ${describe(expected)}, got ${describe(actual)}` });
  } else if (f.op === 'contains' && (typeof f.value !== 'string' || f.value.length === 0)) {
    // `position('' IN x) > 0` is true for every string, and a number or null has no substrings: only a non-empty needle asks a question.
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'operator "contains" takes a non-empty string' });
  }
});
export type PropertyFilter = z.infer<typeof PropertyFilter>;

function describe(shape: 'none' | 'scalar' | 'list'): string {
  return shape === 'none' ? 'no value' : `a ${shape}`;
}

export const StepFilter = z.strictObject({ event: EventName, where: z.array(PropertyFilter).max(10).default([]) });
export type StepFilter = z.infer<typeof StepFilter>;

/** The same bounds as the ingest contract's `Instant`: Zod's `date()` accepts `0000-01-01`, which PostgreSQL rejects once `AT TIME ZONE` touches it (22008). */
export const DATE_BOUNDS = { min: '1970-01-01', max: '2200-01-01' } as const;
const LocalDate = z.string().date().refine((d) => daysBetween(DATE_BOUNDS.min, d) >= 0 && daysBetween(d, DATE_BOUNDS.max) >= 0, {
  message: `date must be between ${DATE_BOUNDS.min} and ${DATE_BOUNDS.max}`,
});

export const DateRange = z.strictObject({
  from: LocalDate,                                                 // local date in the project tz
  to: LocalDate,                                                   // inclusive
}).refine((r) => daysBetween(r.from, r.to) >= 0, { message: 'range end must not precede its start' })
  .refine((r) => daysBetween(r.from, r.to) <= QUERY_LIMITS.rangeDays, { message: `range must be ≤ ${QUERY_LIMITS.rangeDays} days` });
export type DateRange = z.infer<typeof DateRange>;

const Base = { project: z.string().uuid(), range: DateRange, where: z.array(PropertyFilter).max(10).default([]) };

export const FunnelSpec = z.strictObject({ kind: z.literal('funnel'), ...Base,
  steps: z.array(StepFilter).min(2).max(10),
  order: z.enum(['sequential', 'strict', 'any']).default('sequential'),
  window: z.strictObject({ value: z.number().int().min(1).max(90), unit: z.enum(['minutes', 'hours', 'days']) }).default({ value: 14, unit: 'days' }),
  breakdown: PropKey.optional(),                                   // ≤ 50 values + "other", enforced by the compiler
});
export type FunnelSpec = z.infer<typeof FunnelSpec>;

export const RetentionSpec = z.strictObject({ kind: z.literal('retention'), ...Base,
  start: StepFilter, return: StepFilter.optional(),                // return defaults to start
  unit: z.enum(['day', 'week', 'month']).default('day'),
  periods: z.number().int().min(1).max(30).default(14),
  mode: z.enum(['on', 'on_or_after']).default('on'),
});
export type RetentionSpec = z.infer<typeof RetentionSpec>;

export const TrendSpec = z.strictObject({ kind: z.literal('trend'), ...Base,
  event: StepFilter, measure: z.enum(['events', 'persons']).default('events'),
  unit: z.enum(['hour', 'day', 'week', 'month']).default('day'), breakdown: PropKey.optional(),
});
export type TrendSpec = z.infer<typeof TrendSpec>;

export const PathsSpec = z.strictObject({ kind: z.literal('paths'), ...Base,
  start: EventName, steps: z.number().int().min(1).max(5).default(3),
  session_gap_minutes: z.number().int().min(1).max(1440).default(30),
});
export type PathsSpec = z.infer<typeof PathsSpec>;

export const CountSpec = z.strictObject({ kind: z.literal('count'), ...Base, event: StepFilter });
export type CountSpec = z.infer<typeof CountSpec>;

export const QuerySpec = z.discriminatedUnion('kind', [FunnelSpec, RetentionSpec, TrendSpec, PathsSpec, CountSpec]);
export type QuerySpec = z.infer<typeof QuerySpec>;

const SPEC_SCHEMAS: ReadonlySet<unknown> = new Set(QuerySpec.options);

/** True for the five spec schemas, so the HTTP layer can report a bad spec as `INVALID_SPEC` (LLD §5) rather than a generic bad body. */
export function isQuerySpecSchema(schema: unknown): boolean {
  return SPEC_SCHEMAS.has(schema);
}

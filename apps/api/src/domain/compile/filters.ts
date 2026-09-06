/**
 * filters.ts — `where` clauses over `properties`, one allowlisted operator at a time (LLD §5).
 *
 * Why it exists: a property key becomes `properties -> $n` / `properties ->> $n` and a value becomes a
 * `$n::jsonb` parameter, so the grammar's promise "values, never identifiers" holds for filters too.
 * Comparisons use the jsonb operators rather than casting text: `->> 'n' > '9'` would order numbers
 * lexically and `::numeric` would raise on a string, whereas jsonb comparison is typed and total — a
 * number is compared as a number, a string as a string. Equality across types is simply false; the
 * ordering operators additionally require the same `jsonb_typeof`, because jsonb ranks every string
 * below every number and `"100" <= 9` would otherwise be a plausible wrong number.
 * `neq` and `not_in` are the complements of `eq` and `in` including rows where the key is absent; a
 * `NULL` there would otherwise silently drop them from both sides. `contains` uses `position` because
 * `LIKE` would give `%` and `_` in the value a meaning the caller did not intend, and it applies only to
 * string values: `->>` renders a number or an object as text too, and `{"n": 15} contains "5"` would be a
 * plausible wrong match (S2 hardening; the grammar already requires a non-empty needle).
 *
 * What it must never do: interpolate the key or the value, or add an operator the grammar does not
 * list — `FilterOp` is the allowlist, and the table below must cover exactly it.
 */
import type { FilterOp, PropertyFilter } from '@vantage/contracts';
import { fill, joinSql, type Params, type Sql } from './sql.js';

/** `ev` is the events alias every scanning CTE uses; the templates depend on it. */
const OPERATOR_TEMPLATES: Readonly<Record<FilterOp, string>> = {
  eq: 'ev.properties -> {key} = {value}::jsonb',
  neq: 'NOT coalesce(ev.properties -> {key} = {value}::jsonb, false)',
  in: 'ev.properties -> {key} IN (SELECT jsonb_array_elements({value}::jsonb))',
  not_in: 'NOT coalesce(ev.properties -> {key} IN (SELECT jsonb_array_elements({value}::jsonb)), false)',
  contains: "jsonb_typeof(ev.properties -> {key}) = 'string' AND position({value} IN ev.properties ->> {key}) > 0",
  gt: 'jsonb_typeof(ev.properties -> {key}) = jsonb_typeof({value}::jsonb) AND ev.properties -> {key} > {value}::jsonb',
  gte: 'jsonb_typeof(ev.properties -> {key}) = jsonb_typeof({value}::jsonb) AND ev.properties -> {key} >= {value}::jsonb',
  lt: 'jsonb_typeof(ev.properties -> {key}) = jsonb_typeof({value}::jsonb) AND ev.properties -> {key} < {value}::jsonb',
  lte: 'jsonb_typeof(ev.properties -> {key}) = jsonb_typeof({value}::jsonb) AND ev.properties -> {key} <= {value}::jsonb',
  is_set: '(ev.properties ? {key})',
  is_not_set: 'NOT (ev.properties ? {key})',
};

/** The jsonb operators take the value as JSON text; `contains` compares text with text (the grammar guarantees its value is a string). */
function parameterValue(filter: PropertyFilter): unknown {
  return filter.op === 'contains' ? filter.value : JSON.stringify(filter.value);
}

function compileFilter(filter: PropertyFilter, p: Params): Sql {
  const key = p.add(filter.key, 'property key');
  if (filter.value === undefined) return fill(OPERATOR_TEMPLATES[filter.op], { key });
  return fill(OPERATOR_TEMPLATES[filter.op], { key, value: p.add(parameterValue(filter), 'property value') });
}

/** `AND (…) AND (…)` ready to append to a WHERE, or empty when there is nothing to filter. */
export function andFilters(filters: readonly PropertyFilter[], p: Params): Sql {
  if (filters.length === 0) return fill('');
  return joinSql(
    filters.map((f) => fill('\n  AND ({filter})', { filter: compileFilter(f, p) })),
    '',
  );
}

/** The same conditions as a single conjunction, for use inside an expression (a step tag). */
export function allFilters(filters: readonly PropertyFilter[], p: Params): Sql {
  return joinSql(
    filters.map((f) => compileFilter(f, p)),
    ' AND ',
  );
}

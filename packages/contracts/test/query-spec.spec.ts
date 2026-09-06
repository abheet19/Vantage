/**
 * query-spec.spec.ts — the grammar rejects unknown keys everywhere and enforces every limit the LLD names.
 */
import { describe, expect, it } from 'vitest';
import { DateRange, FunnelSpec, QuerySpec, daysBetween } from '../src/query-spec.js';

const PROJECT = '0190f3a0-0000-7000-8000-000000000000';
const range = { from: '2026-08-01', to: '2026-08-31' };
const funnel = { kind: 'funnel', project: PROJECT, range, steps: [{ event: 'signup' }, { event: 'create_project' }] };

/** Issue paths; an `unrecognized_keys` issue (reported by Zod at the object's path) is expanded to one entry per smuggled key. */
function paths(v: unknown): string[] {
  const r = QuerySpec.safeParse(v);
  if (r.success) return [];
  return r.error.issues.flatMap((i) => {
    const base = i.path.join('.');
    if (i.code === 'unrecognized_keys') return i.keys.map((k) => (base ? `${base}.${k}` : k));
    return [base];
  });
}

describe('QuerySpec: strictness (a smuggled field is a validation error, never ignored)', () => {
  it('rejects an unknown top-level key such as "sql"', () => {
    expect(paths({ ...funnel, sql: 'DROP TABLE events' })).toContain('sql');
  });

  it('rejects an unknown key inside a step filter', () => {
    expect(paths({ ...funnel, steps: [{ event: 'a', table: 'events' }, { event: 'b' }] })).toContain('steps.0.table');
  });

  it('rejects an unknown key inside a property filter and inside window', () => {
    expect(paths({ ...funnel, where: [{ key: 'plan', op: 'eq', value: 'x', raw: '1=1' }] })).toContain('where.0.raw');
    expect(paths({ ...funnel, window: { value: 1, unit: 'days', limit: 5 } })).toContain('window.limit');
  });

  it('rejects an unknown key inside range', () => {
    expect(paths({ ...funnel, range: { ...range, tz: 'UTC' } })).toContain('range.tz');
  });

  it('rejects an unknown kind', () => {
    expect(QuerySpec.safeParse({ ...funnel, kind: 'raw_sql' }).success).toBe(false);
  });
});

describe('QuerySpec: text PostgreSQL cannot hold, and dates it cannot represent, are refused here — never a 500 later (S2 hardening)', () => {
  const NUL = String.fromCharCode(0);
  const count = { kind: 'count', project: PROJECT, range, event: { event: 'signup' } };

  it('an event name with U+0000 or a lone surrogate fails at its path', () => {
    expect(paths({ ...count, event: { event: `sign${NUL}up` } })).toContain('event.event');
    expect(paths({ ...count, event: { event: 'x\ud800y' } })).toContain('event.event');
    expect(paths({ ...funnel, steps: [{ event: `a${NUL}` }, { event: 'b' }] })).toContain('steps.0.event');
    expect(QuerySpec.safeParse({ ...count, event: { event: 'événement 🚀' } }).success).toBe(true);
  });

  it('a string filter value with U+0000 fails at the value, alone or inside a list', () => {
    expect(paths({ ...count, where: [{ key: 'plan', op: 'eq', value: `fr${NUL}ee` }] })[0]).toMatch(/^where\.0\.value/);
    expect(paths({ ...count, where: [{ key: 'plan', op: 'in', value: ['ok', `b${NUL}ad`] }] })[0]).toMatch(/^where\.0\.value/);
  });

  it('contains takes a non-empty string: an empty needle, a number and null are refused', () => {
    expect(paths({ ...count, where: [{ key: 'plan', op: 'contains', value: '' }] })).toContain('where.0.value');
    expect(paths({ ...count, where: [{ key: 'plan', op: 'contains', value: 5 }] })).toContain('where.0.value');
    expect(paths({ ...count, where: [{ key: 'plan', op: 'contains', value: null }] })).toContain('where.0.value');
    expect(QuerySpec.safeParse({ ...count, where: [{ key: 'plan', op: 'contains', value: 'a' }] }).success).toBe(true);
  });

  it('range dates are bounded to 1970-01-01..2200-01-01, inclusive', () => {
    expect(paths({ ...count, range: { from: '0000-01-01', to: '0000-01-02' } })).toContain('range.from');
    expect(paths({ ...count, range: { from: '1969-12-31', to: '1970-01-01' } })).toContain('range.from');
    expect(paths({ ...count, range: { from: '2199-12-31', to: '2200-01-02' } })).toContain('range.to');
    expect(paths({ ...count, range: { from: '9999-12-30', to: '9999-12-31' } })).toContain('range.from');
    expect(DateRange.safeParse({ from: '1970-01-01', to: '1970-01-01' }).success).toBe(true);
    expect(DateRange.safeParse({ from: '2200-01-01', to: '2200-01-01' }).success).toBe(true);
  });
});

describe('QuerySpec: limits', () => {
  it('accepts a 366-day range and rejects 367 days with the LLD message', () => {
    expect(DateRange.safeParse({ from: '2026-01-01', to: '2027-01-02' }).success).toBe(true);
    const r = DateRange.safeParse({ from: '2026-01-01', to: '2027-01-03' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('range must be ≤ 366 days');
  });

  it('rejects a range whose end precedes its start', () => {
    const r = DateRange.safeParse({ from: '2026-08-31', to: '2026-08-01' });
    expect(r.success).toBe(false);
  });

  it('accepts 10 funnel steps and rejects 11; requires at least 2', () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ event: `e${i}` }));
    expect(QuerySpec.safeParse({ ...funnel, steps: steps(10) }).success).toBe(true);
    expect(paths({ ...funnel, steps: steps(11) })).toContain('steps');
    expect(paths({ ...funnel, steps: steps(1) })).toContain('steps');
  });

  it('accepts 50 `in` values and rejects 51', () => {
    const values = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    expect(QuerySpec.safeParse({ ...funnel, where: [{ key: 'plan', op: 'in', value: values(50) }] }).success).toBe(true);
    expect(paths({ ...funnel, where: [{ key: 'plan', op: 'in', value: values(51) }] })).toContain('where.0.value');
  });

  it('accepts 10 property filters and rejects 11', () => {
    const filters = (n: number) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, op: 'is_set' }));
    expect(QuerySpec.safeParse({ ...funnel, where: filters(10) }).success).toBe(true);
    expect(paths({ ...funnel, where: filters(11) })).toContain('where');
  });

  it('bounds window (1..90), retention periods (1..30), paths steps (1..5) and session gap (1..1440)', () => {
    expect(paths({ ...funnel, window: { value: 91, unit: 'days' } })).toContain('window.value');
    expect(paths({ kind: 'retention', project: PROJECT, range, start: { event: 'signup' }, periods: 31 })).toContain('periods');
    expect(paths({ kind: 'paths', project: PROJECT, range, start: 'signup', steps: 6 })).toContain('steps');
    expect(paths({ kind: 'paths', project: PROJECT, range, start: 'signup', session_gap_minutes: 1441 })).toContain('session_gap_minutes');
  });

  it('property keys are restricted to [A-Za-z0-9_.$-]{1,100}: a key that looks like SQL is rejected', () => {
    expect(paths({ ...funnel, where: [{ key: "plan' OR 1=1 --", op: 'is_set' }] })).toContain('where.0.key');
    expect(paths({ ...funnel, breakdown: 'a b' })).toContain('breakdown');
    expect(QuerySpec.safeParse({ ...funnel, breakdown: 'utm.source-$1_x' }).success).toBe(true);
  });

  it('a scalar filter value is capped at 500 characters', () => {
    expect(paths({ ...funnel, where: [{ key: 'k', op: 'eq', value: 'x'.repeat(501) }] })).toContain('where.0.value');
  });

  it('project must be a uuid', () => {
    expect(paths({ ...funnel, project: 'events; DROP TABLE events' })).toContain('project');
  });
});

describe('QuerySpec: defaults', () => {
  it('fills the LLD defaults for funnel', () => {
    const r = FunnelSpec.parse(funnel);
    expect(r.order).toBe('sequential');
    expect(r.window).toEqual({ value: 14, unit: 'days' });
    expect(r.where).toEqual([]);
    expect(r.steps[0]?.where).toEqual([]);
  });

  it('fills the LLD defaults for retention, trend, paths and accepts count', () => {
    const retention = QuerySpec.parse({ kind: 'retention', project: PROJECT, range, start: { event: 'signup' } });
    expect(retention).toMatchObject({ unit: 'day', periods: 14, mode: 'on' });
    const trend = QuerySpec.parse({ kind: 'trend', project: PROJECT, range, event: { event: 'signup' } });
    expect(trend).toMatchObject({ measure: 'events', unit: 'day' });
    const pathsSpec = QuerySpec.parse({ kind: 'paths', project: PROJECT, range, start: 'signup' });
    expect(pathsSpec).toMatchObject({ steps: 3, session_gap_minutes: 30 });
    expect(QuerySpec.safeParse({ kind: 'count', project: PROJECT, range, event: { event: 'signup' } }).success).toBe(true);
  });
});

describe('daysBetween', () => {
  it('is signed and independent of the process timezone', () => {
    expect(daysBetween('2026-08-01', '2026-08-31')).toBe(30);
    expect(daysBetween('2026-08-31', '2026-08-01')).toBe(-30);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
  });
});

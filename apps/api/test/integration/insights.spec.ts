/**
 * insights.spec.ts — every hand-computed S2 number in fixtures/august.expected.md asserted by name through the real
 * endpoints (V2, V3, V4, V5, V10), plus the denied paths (kind/path mismatch, 367 days, unknown project) and the
 * interrupted paths (statement_timeout, a saturated read pool, a revoked grant).
 */
import { Logger } from '@nestjs/common';
import type { CountResult, FunnelResult, RetentionResult } from '@vantage/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RO_POOL_MAX } from '../../src/infra/database.module.js';
import { RO_QUEUE_MAX } from '../../src/infra/query-runner.js';
import { PG_RO } from '../../src/infra/tokens.js';
import { loadFixture, type LoadResult } from '../fixture/load.js';
import { bearer, createTestApp, type TestApp, type TestProject } from '../helpers/app.js';

let t: TestApp;
let kolkata: LoadResult;
let utc: LoadResult;
/** Sequential 14-day funnel step counts observed right before and right after P09's identify (V10). */
const aroundIdentify: { before: number[] | null; after: number[] | null } = { before: null, after: null };

const AUGUST = { from: '2026-08-01', to: '2026-08-31' };
const STEPS = [{ event: 'signup' }, { event: 'create_project' }, { event: 'invite_teammate' }];
const funnelSpec = (project: string, over: Record<string, unknown> = {}) => ({ kind: 'funnel', project, range: AUGUST, steps: STEPS, ...over });
const retentionSpec = (project: string, over: Record<string, unknown> = {}) => ({ kind: 'retention', project, range: AUGUST, start: { event: 'signup' }, return: { event: 'view_pricing' }, unit: 'day', periods: 14, ...over });
const countSpec = (project: string, event: string, over: Record<string, unknown> = {}) => ({ kind: 'count', project, range: AUGUST, event: { event }, ...over });

const funnel = async (body: object) => (await t.http.post('/v1/funnel').send(body).expect(200)).body as FunnelResult;
const retention = async (body: object) => (await t.http.post('/v1/retention').send(body).expect(200)).body as RetentionResult;
const count = async (body: object) => (await t.http.post('/v1/count').send(body).expect(200)).body as CountResult;
const persons = (r: FunnelResult) => r.steps?.map((s) => s.persons);
const cellsOf = (r: RetentionResult, bucket: string) => r.cohorts?.find((c) => c.bucket === bucket);
const retainedRow = (r: RetentionResult, bucket: string) => cellsOf(r, bucket)?.cells.map((c) => c.retained);

beforeAll(async () => {
  t = await createTestApp();
  kolkata = await loadFixture(t, {
    hooks: (project) => ({
      beforeStep: async (step) => {
        if (step.kind === 'identify') aroundIdentify.before = persons(await funnel(funnelSpec(project.project_id))) ?? null;
      },
      afterStep: async (step) => {
        if (step.kind === 'identify') aroundIdentify.after = persons(await funnel(funnelSpec(project.project_id))) ?? null;
      },
    }),
  });
  utc = await loadFixture(t, { timezone: 'UTC' });
});
afterAll(async () => {
  await t.close();
});

describe('august.json: funnel signup → create_project → invite_teammate, Aug 1–31 in Asia/Kolkata', () => {
  it('sequential, 14 days: 13 → 8 → 4, median time to convert 91 500 s', async () => {
    const r = await funnel(funnelSpec(kolkata.project.project_id));
    expect(persons(r)).toEqual([13, 8, 4]);
    expect(r.median_time_to_convert_s).toBe(91_500);
    expect(r.meta.status).toBe('complete');
    expect(r.steps?.map((s) => s.pct_of_previous)).toEqual([null, 8 / 13, 4 / 8]);
    expect(r.steps?.map((s) => s.pct_of_start)).toEqual([1, 8 / 13, 4 / 13]);
  });

  it('sequential, 7 days: 13 → 6 → 3 (P02 at +9 d and P03 at +14 d fall out), median 89 400 s', async () => {
    const r = await funnel(funnelSpec(kolkata.project.project_id, { window: { value: 7, unit: 'days' } }));
    expect(persons(r)).toEqual([13, 6, 3]);
    expect(r.median_time_to_convert_s).toBe(89_400);
  });

  it('strict, 14 days: 13 → 5 → 2, median 91 500 s', async () => {
    const r = await funnel(funnelSpec(kolkata.project.project_id, { order: 'strict' }));
    expect(persons(r)).toEqual([13, 5, 2]);
    expect(r.median_time_to_convert_s).toBe(91_500);
  });

  it('strict, 7 days: the same 13 → 5 → 2 — every strict conversion happened within a day', async () => {
    const r = await funnel(funnelSpec(kolkata.project.project_id, { order: 'strict', window: { value: 7, unit: 'days' } }));
    expect(persons(r)).toEqual([13, 5, 2]);
  });

  it('any order, 14 days: 13 → 10 → 5, median 89 400 s (P07 and P15 reach step 2 from their later signup — decision 2026-09-05)', async () => {
    const r = await funnel(funnelSpec(kolkata.project.project_id, { order: 'any' }));
    expect(persons(r)).toEqual([13, 10, 5]);
    expect(r.median_time_to_convert_s).toBe(89_400);
  });

  it('any order, 7 days: 13 → 8 → 4, median 48 300 s', async () => {
    const r = await funnel(funnelSpec(kolkata.project.project_id, { order: 'any', window: { value: 7, unit: 'days' } }));
    expect(persons(r)).toEqual([13, 8, 4]);
    expect(r.median_time_to_convert_s).toBe(48_300);
  });

  it('counts P03 at exactly t1 + 14 d (13 d → 7, 14 d → 8) and not P04 at t1 + 14 d + 1 s, who enters with P07 at 15 d (→ 10) (V3)', async () => {
    const twoSteps = async (days: number) => persons(await funnel(funnelSpec(kolkata.project.project_id, { steps: STEPS.slice(0, 2), window: { value: days, unit: 'days' } })));
    expect(await twoSteps(13)).toEqual([13, 7]); // P01, P02, P06, P09, P10, P12, P15
    expect(await twoSteps(14)).toEqual([13, 8]); // + P03, exactly on the boundary
    expect(await twoSteps(15)).toEqual([13, 10]); // + P04 (14 d 1 s) and P07 (15 d from the first signup)
  });

  it('does not count P05 in sequential order because create_project came before signup, but does in any order', async () => {
    const twoSteps = STEPS.slice(0, 2);
    const window = { value: 3, unit: 'hours' };
    const sequential = persons(await funnel(funnelSpec(kolkata.project.project_id, { steps: twoSteps, window })));
    const any = persons(await funnel(funnelSpec(kolkata.project.project_id, { steps: twoSteps, window, order: 'any' })));
    // Within 3 h: sequential P01, P06, P09, P10, P12 (5); any order adds P05 whose two events are 1 h apart (6).
    expect(sequential).toEqual([13, 5]);
    expect(any).toEqual([13, 6]);
  });

  it('does not count P06 under strict order because view_pricing intervened between signup and create_project', async () => {
    const window = { value: 90, unit: 'minutes' };
    const sequential = persons(await funnel(funnelSpec(kolkata.project.project_id, { steps: STEPS.slice(0, 2), window })));
    const strict = persons(await funnel(funnelSpec(kolkata.project.project_id, { steps: STEPS.slice(0, 2), window, order: 'strict' })));
    // Within 90 min: sequential P01, P06, P09, P10, P12 (5); strict drops P06 (4).
    expect(sequential).toEqual([13, 5]);
    expect(strict).toEqual([13, 4]);
  });

  it('starts P07 from the first signup IN RANGE only: over August (+15 d) P07 does not convert; from Aug 9 the second signup is the first and P07 converts at +3 d', async () => {
    const august = persons(await funnel(funnelSpec(kolkata.project.project_id, { steps: STEPS.slice(0, 2) })));
    const fromAug9 = persons(await funnel(funnelSpec(kolkata.project.project_id, { steps: STEPS.slice(0, 2), range: { from: '2026-08-09', to: '2026-08-31' } })));
    expect(august).toEqual([13, 8]); // P07 absent from step 2
    expect(fromAug9).toEqual([7, 5]); // P07, P09, P10, P11, P12, P14, P15 → P07, P09, P10, P12, P15
  });

  it('P15 (create_project Aug 1, signup Aug 20, create_project Aug 21) converts in a 14-day window in every order — a step redone after a late step 1 counts in any order as it does in sequential order', async () => {
    // Aug 20–21 holds two signups: P15's and P07's second (P07's create_project on Aug 23 is outside the range). P15 is the one who converts, in all three orders.
    const aug20 = { steps: STEPS.slice(0, 2), range: { from: '2026-08-20', to: '2026-08-21' } };
    expect(persons(await funnel(funnelSpec(kolkata.project.project_id, aug20)))).toEqual([2, 1]);
    expect(persons(await funnel(funnelSpec(kolkata.project.project_id, { ...aug20, order: 'any' })))).toEqual([2, 1]);
    expect(persons(await funnel(funnelSpec(kolkata.project.project_id, { ...aug20, order: 'strict' })))).toEqual([2, 1]);
  });

  it('V10: the funnel changes by exactly (0, +1, +1) across P09’s identify — anon-9 and user-9 become one converting person', () => {
    expect(aroundIdentify.before).toEqual([8, 4, 3]);
    expect(aroundIdentify.after).toEqual([8, 5, 4]);
  });

  it('returns the SQL and its parameters with the numbers, and a footer that tells the truth about the data', async () => {
    const r = await funnel(funnelSpec(kolkata.project.project_id));
    expect(r.sql).toMatch(/^WITH e AS/);
    expect(r.params.slice(0, 4)).toEqual([kolkata.project.project_id, 'Asia/Kolkata', '2026-08-01', '2026-08-31']);
    expect(r.meta).toMatchObject({ status: 'complete', timezone: 'Asia/Kolkata', row_cap: 10_000, incomplete_buckets: 0, data_until: '2026-09-02T00:00:00.000Z' });
    expect(r.meta.ts_adjusted_share).toBeCloseTo(2 / 1041, 9);
    expect(r.meta.persons_merged_since).toBe(1); // P09's identify was done today, after Aug 1: it reshaped this funnel, whatever the range's end
    expect(r.meta.elapsed_ms).toBeGreaterThanOrEqual(0);
    console.log(`measured: fixture sequential funnel elapsed_ms = ${r.meta.elapsed_ms} (embedded PostgreSQL 17, 1 045 events)`);
  });

  it('persons_merged_since counts merges made at or after the range START with no upper bound: 1 for August, 0 for a range that starts after the merge', async () => {
    const afterTheMerge = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await funnel(funnelSpec(kolkata.project.project_id))).meta.persons_merged_since).toBe(1);
    expect((await funnel(funnelSpec(kolkata.project.project_id, { range: { from: afterTheMerge, to: afterTheMerge } }))).meta.persons_merged_since).toBe(0);
  });
});

describe('august.json: day retention signup → view_pricing, Aug 1–31 in Asia/Kolkata (first three cohorts)', () => {
  it('has eleven cohorts of 15 cells each, one per person’s first signup day, oldest first, none in progress', async () => {
    const r = await retention(retentionSpec(kolkata.project.project_id));
    expect(r.meta.status).toBe('complete');
    expect(r.cohorts?.map((c) => c.bucket)).toEqual(
      ['2026-08-03', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-14', '2026-08-16', '2026-08-20'].map((d) => `${d}T00:00:00`),
    );
    expect(r.cohorts?.every((c) => c.cells.length === 15)).toBe(true);
    expect(r.cohorts?.reduce((n, c) => n + c.size, 0)).toBe(13);
    expect(r.meta.incomplete_buckets).toBe(0);
  });

  it("Aug 3 cohort (P01, P02), 'on': day 1 both viewed pricing, day 2 only P01", async () => {
    const r = await retention(retentionSpec(kolkata.project.project_id));
    expect(cellsOf(r, '2026-08-03T00:00:00')?.size).toBe(2);
    expect(retainedRow(r, '2026-08-03T00:00:00')).toEqual([0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(cellsOf(r, '2026-08-03T00:00:00')?.cells[1]?.pct).toBe(1);
  });

  it("Aug 5 cohort (P03, P04), 'on': P03 returns on day 1 and day 3, P04 never", async () => {
    const r = await retention(retentionSpec(kolkata.project.project_id));
    expect(retainedRow(r, '2026-08-05T00:00:00')).toEqual([0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("Aug 6 cohort (P05), 'on': one return on day 1", async () => {
    const r = await retention(retentionSpec(kolkata.project.project_id));
    expect(cellsOf(r, '2026-08-06T00:00:00')?.size).toBe(1);
    expect(retainedRow(r, '2026-08-06T00:00:00')).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("'on_or_after': Aug 3 → 2, 2, 1, 0…; Aug 5 → 1, 1, 1, 1, 0…; Aug 6 → 1, 1, 0…", async () => {
    const r = await retention(retentionSpec(kolkata.project.project_id, { mode: 'on_or_after' }));
    expect(retainedRow(r, '2026-08-03T00:00:00')).toEqual([2, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(retainedRow(r, '2026-08-05T00:00:00')).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(retainedRow(r, '2026-08-06T00:00:00')).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("'on_or_after' judges every cohort over its own 14 periods: an Aug 1 signup returning Sep 10 and an Aug 31 signup returning Oct 9 are both never retained (decision 2026-09-05)", async () => {
    const p = await t.createProject('horizon', 'UTC');
    t.clock.set(new Date('2026-12-01T00:00:00Z')); // the returns below are after the fixture's pinned Sep 2 clock; a "future" client timestamp would otherwise be clamped to it (design §1.4)
    try {
      await t.http
        .post('/v1/events')
        .set(bearer(p))
        .send({
          events: [
            { event: 'signup', distinct_id: 'early', insert_id: 'e1', timestamp: '2026-08-01T10:00:00Z' },
            { event: 'view_pricing', distinct_id: 'early', insert_id: 'e2', timestamp: '2026-09-10T10:00:00Z' }, // 40 d later: past Aug 1 + 14
            { event: 'signup', distinct_id: 'late', insert_id: 'l1', timestamp: '2026-08-31T10:00:00Z' },
            { event: 'view_pricing', distinct_id: 'late', insert_id: 'l2', timestamp: '2026-10-09T10:00:00Z' }, // 39 d later: past Aug 31 + 14
            { event: 'signup', distinct_id: 'kept', insert_id: 'k1', timestamp: '2026-08-31T10:00:00Z' },
            { event: 'view_pricing', distinct_id: 'kept', insert_id: 'k2', timestamp: '2026-09-14T10:00:00Z' }, // exactly Aug 31 + 14: the last cell, and every earlier one
          ],
        })
        .expect(200);
    } finally {
      t.clock.set(new Date('2026-09-02T00:00:00Z'));
    }
    const r = await retention(retentionSpec(p.project_id, { mode: 'on_or_after' }));
    expect(retainedRow(r, '2026-08-01T00:00:00')).toEqual(Array(15).fill(0));
    expect(cellsOf(r, '2026-08-31T00:00:00')?.size).toBe(2);
    expect(retainedRow(r, '2026-08-31T00:00:00')).toEqual(Array(15).fill(1));
  });

  it('V5: P08’s signup at 2026-08-31T18:45Z is the Sep 1 cohort in Asia/Kolkata and the Aug 31 cohort in UTC', async () => {
    const inKolkata = await retention(retentionSpec(kolkata.project.project_id, { range: { from: '2026-08-01', to: '2026-09-01' } }));
    const inUtc = await retention(retentionSpec(utc.project.project_id));
    expect(cellsOf(inKolkata, '2026-09-01T00:00:00')?.size).toBe(1);
    expect(cellsOf(inKolkata, '2026-08-31T00:00:00')).toBeUndefined();
    expect(cellsOf(inUtc, '2026-08-31T00:00:00')?.size).toBe(1);
    expect(cellsOf(inUtc, '2026-09-01T00:00:00')).toBeUndefined();
    expect(cellsOf(await retention(retentionSpec(kolkata.project.project_id)), '2026-09-01T00:00:00')).toBeUndefined();
  });

  it('the same events in a UTC project give a different August funnel (14 → 8 → 4: P08 enters at step 1), and the Kolkata project is unchanged', async () => {
    expect(persons(await funnel(funnelSpec(utc.project.project_id)))).toEqual([14, 8, 4]);
    expect(persons(await funnel(funnelSpec(kolkata.project.project_id)))).toEqual([13, 8, 4]);
  });

  it('a retention over 366 daily cohorts × 31 cells exceeds the row cap: truncated, the newest 322 cohorts returned whole (322 × 31 = 9 982 ≤ 10 000), never a partial cohort', async () => {
    const p = await t.createProject('many cohorts', 'UTC');
    const events = Array.from({ length: 366 }, (_, i) => ({ event: 'signup', distinct_id: `c${i}`, insert_id: `c${i}`, timestamp: new Date(Date.UTC(2025, 8, 1) + i * 86_400_000).toISOString() }));
    await t.http.post('/v1/events').set(bearer(p)).send({ events }).expect(200);
    const r = await retention({ kind: 'retention', project: p.project_id, range: { from: '2025-09-01', to: '2026-09-01' }, start: { event: 'signup' }, periods: 30 });
    expect(r.meta.status).toBe('truncated');
    expect(r.cohorts).toHaveLength(322);
    expect(r.cohorts?.every((c) => c.cells.length === 31 && c.size === 1)).toBe(true);
    expect(r.cohorts?.[0]?.bucket).toBe('2025-10-15T00:00:00'); // the 44 oldest cohorts are the ones cut
    expect(r.cohorts?.[321]?.bucket).toBe('2026-09-01T00:00:00');
    expect(r.cohorts?.reduce((n, c) => n + c.cells.length, 0)).toBe(9_982);
  });
});

describe('august.json: count', () => {
  it('signup in August: 13 persons, 14 events (P07 signed up twice)', async () => {
    const r = await count(countSpec(kolkata.project.project_id, 'signup'));
    expect(r).toMatchObject({ persons: 13, events: 14 });
    expect(r.meta.status).toBe('complete');
  });

  it('view_pricing in August: 7 persons, 1 008 events (P14’s 1 000 included; anon-9’s counts for P09)', async () => {
    const r = await count(countSpec(kolkata.project.project_id, 'view_pricing'));
    expect(r).toMatchObject({ persons: 7, events: 1008 });
  });

  it('property filters select the expected rows: eq on plan, is_set, and neq including the unset', async () => {
    const team = await count(countSpec(kolkata.project.project_id, 'signup', { event: { event: 'signup', where: [{ key: 'plan', op: 'eq', value: 'team' }] } }));
    expect(team).toMatchObject({ persons: 1, events: 1 });
    const withPlan = await count(countSpec(kolkata.project.project_id, 'signup', { where: [{ key: 'plan', op: 'is_set' }] }));
    expect(withPlan).toMatchObject({ persons: 2, events: 2 });
    const notTeam = await count(countSpec(kolkata.project.project_id, 'signup', { where: [{ key: 'plan', op: 'neq', value: 'team' }] }));
    expect(notTeam).toMatchObject({ persons: 12, events: 13 });
    const page = await count(countSpec(kolkata.project.project_id, 'view_pricing', { where: [{ key: 'page', op: 'in', value: ['pricing', 'other'] }] }));
    expect(page).toMatchObject({ persons: 1, events: 1000 });
  });

  it('numeric and text operators compare typed jsonb values: gt/lt on numbers, contains on text, not_in with the unset', async () => {
    const p = await t.createProject('filters', 'UTC');
    const events = [
      { event: 'buy', distinct_id: 'a', insert_id: 'a', timestamp: '2026-08-10T10:00:00Z', properties: { amount: 9, sku: 'blue-shirt' } },
      { event: 'buy', distinct_id: 'b', insert_id: 'b', timestamp: '2026-08-10T10:00:00Z', properties: { amount: 10, sku: 'red-shirt' } },
      { event: 'buy', distinct_id: 'c', insert_id: 'c', timestamp: '2026-08-10T10:00:00Z', properties: { amount: '100', sku: 'hat' } },
      { event: 'buy', distinct_id: 'd', insert_id: 'd', timestamp: '2026-08-10T10:00:00Z', properties: {} },
    ];
    await t.http.post('/v1/events').set(bearer(p)).send({ events }).expect(200);
    const n = async (where: unknown[]) => (await count(countSpec(p.project_id, 'buy', { where }))).events;
    expect(await n([{ key: 'amount', op: 'gt', value: 9 }])).toBe(1); // 10 only: '100' is a string, not a number
    expect(await n([{ key: 'amount', op: 'lte', value: 9 }])).toBe(1); // 9 only: jsonb would rank the string '100' below 9, the type guard does not
    expect(await n([{ key: 'amount', op: 'gte', value: 9 }])).toBe(2);
    expect(await n([{ key: 'amount', op: 'lt', value: 10 }])).toBe(1);
    expect(await n([{ key: 'amount', op: 'gte', value: '100' }])).toBe(1); // strings compare with strings: only c
    expect(await n([{ key: 'amount', op: 'lt', value: '5' }])).toBe(1); // '100' < '5' lexically; the numbers are not compared
    expect(await n([{ key: 'sku', op: 'contains', value: 'shirt' }])).toBe(2);
    expect(await n([{ key: 'sku', op: 'contains', value: '%' }])).toBeNull(); // no row matched: empty, not "everything"
    expect(await n([{ key: 'sku', op: 'not_in', value: ['hat'] }])).toBe(3); // includes d, whose sku is unset
    expect(await n([{ key: 'amount', op: 'eq', value: '100' }])).toBe(1);
    expect(await n([{ key: 'amount', op: 'eq', value: 100 }])).toBeNull();
  });
});

describe('denied paths', () => {
  it('a retention spec posted to /v1/funnel is 422 INVALID_SPEC naming "kind"', async () => {
    const res = await t.http.post('/v1/funnel').send(retentionSpec(kolkata.project.project_id)).expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_SPEC', path: 'kind' });
  });

  it('a 367-day range is 422 with the LLD message at range', async () => {
    const res = await t.http.post('/v1/count').send(countSpec(kolkata.project.project_id, 'signup', { range: { from: '2026-01-01', to: '2027-01-03' } })).expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_SPEC', path: 'range', message: 'range must be ≤ 366 days' });
  });

  it('an unknown project is an honest empty result, not an error that would confirm the id does not exist', async () => {
    const r = await funnel(funnelSpec('0190f3a0-dead-7000-8000-000000000000'));
    expect(r.meta.status).toBe('empty');
    expect(r.steps).toBeNull();
    expect(r.median_time_to_convert_s).toBeNull();
    expect(r.meta.data_until).toBeNull();
    const c = await count(countSpec('0190f3a0-dead-7000-8000-000000000000', 'signup'));
    expect(c).toMatchObject({ persons: null, events: null });
    expect(c.meta.status).toBe('empty');
  });

  it('a funnel nobody started is empty with null steps — never a row of zeros', async () => {
    const r = await funnel(funnelSpec(kolkata.project.project_id, { steps: [{ event: 'never_happened' }, { event: 'signup' }] }));
    expect(r.meta.status).toBe('empty');
    expect(r.steps).toBeNull();
  });
});

describe('interrupted paths', () => {
  const holdLock = async () => {
    const owner = await t.owner.connect();
    await owner.query('BEGIN');
    await owner.query('LOCK TABLE events IN ACCESS EXCLUSIVE MODE');
    return async () => {
      await owner.query('ROLLBACK');
      owner.release();
    };
  };

  it('a statement that waits past statement_timeout is timed_out with steps null, HTTP 200, and the connection is healthy afterwards', async () => {
    const release = await holdLock();
    try {
      const started = Date.now();
      const r = await funnel(funnelSpec(kolkata.project.project_id));
      expect(r.meta.status).toBe('timed_out');
      expect(r.steps).toBeNull();
      expect(r.median_time_to_convert_s).toBeNull();
      expect(r.meta.elapsed_ms).toBeGreaterThanOrEqual(4_500);
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(r.sql).toMatch(/^WITH e AS/);
    } finally {
      await release();
    }
    const again = await funnel(funnelSpec(kolkata.project.project_id));
    expect(again.meta.status).toBe('complete');
    expect(persons(again)).toEqual([13, 8, 4]);
  }, 40_000);

  it('a caller arriving while the pool is saturated and the queue is full is refused with 503 BUSY at once — its timezone lookup does not wait in the pool behind the runner (S2 hardening)', async () => {
    const release = await holdLock();
    const started = Date.now();
    const spec = countSpec(kolkata.project.project_id, 'signup');
    const early = Array.from({ length: RO_POOL_MAX + RO_QUEUE_MAX }, () => t.http.post('/v1/count').send(spec).then((res) => res.status));
    await new Promise((r) => setTimeout(r, 1_000)); // the first four hold the connections against the lock, the next eight fill the queue
    const late = await Promise.all(Array.from({ length: 3 }, () => t.http.post('/v1/count').send(spec).then((res) => ({ status: res.status, code: (res.body as { code?: string }).code, at: Date.now() - started }))));
    await release();
    await Promise.all(early);
    for (const l of late) {
      expect(l).toMatchObject({ status: 503, code: 'BUSY' });
      expect(l.at).toBeLessThan(2_500);
    }
  }, 40_000);

  it('the query and its watermark read one snapshot: an event ingested between the two statements is in neither, and the next query sees it (REPEATABLE READ)', async () => {
    const p = await t.createProject('snapshot', 'UTC');
    const post = (id: string, day: number) => t.http.post('/v1/events').set(bearer(p)).send({ events: [{ event: 'signup', distinct_id: id, insert_id: id, timestamp: `2026-08-${day}T10:00:00Z` }] }).expect(200);
    t.clock.set(new Date('2026-09-02T00:00:00Z'));
    await post('a', 10);
    const ro = t.app.get<pg.Pool>(PG_RO);
    const connect = ro.connect.bind(ro);
    let interposed = false;
    const spy = vi.spyOn(ro, 'connect');
    // any: pg overloads connect() for callbacks (the pool's own query(), used by the timezone lookup) and promises (the runner); both are forwarded as they came.
    spy.mockImplementation(((cb?: (err: Error | undefined, client: pg.PoolClient | undefined, release: (err?: Error) => void) => void) => {
      if (cb) return connect(cb);
      return connect().then((client) => {
        const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        // any: the interposed query() forwards its arguments untouched; only the watermark statement is preceded by an ingest.
        client.query = (async (...args: unknown[]) => {
          if (!interposed && typeof args[0] === 'string' && args[0].startsWith('SELECT (SELECT ev.server_ts')) {
            interposed = true;
            t.clock.set(new Date('2026-09-03T00:00:00Z'));
            await post('b', 11);
          }
          return query(...args);
        }) as typeof client.query;
        return client;
      });
    }) as typeof ro.connect);
    try {
      const during = await count(countSpec(p.project_id, 'signup'));
      expect(interposed).toBe(true);
      expect(during).toMatchObject({ persons: 1, events: 1 });
      expect(during.meta.data_until).toBe('2026-09-02T00:00:00.000Z');
    } finally {
      spy.mockRestore();
    }
    const after = await count(countSpec(p.project_id, 'signup'));
    expect(after).toMatchObject({ persons: 2, events: 2 });
    expect(after.meta.data_until).toBe('2026-09-03T00:00:00.000Z');
  });

  it(`with ${RO_POOL_MAX} connections blocked and ${RO_QUEUE_MAX} queries queued, further queries fail fast with a structured BUSY (503) instead of hanging`, async () => {
    const release = await holdLock();
    const total = RO_POOL_MAX + RO_QUEUE_MAX + 2;
    const started = Date.now();
    const requests = Array.from({ length: total }, () => t.http.post('/v1/count').send(countSpec(kolkata.project.project_id, 'signup')).then((res) => ({ status: res.status, body: res.body as Record<string, unknown>, at: Date.now() })));
    await new Promise((r) => setTimeout(r, 1_000));
    await release();
    const results = await Promise.all(requests);
    const busy = results.filter((r) => r.status === 503);
    const ok = results.filter((r) => r.status === 200);
    expect(busy.length + ok.length).toBe(total);
    expect(busy.length).toBeGreaterThanOrEqual(1);
    expect(ok.length).toBeGreaterThanOrEqual(RO_POOL_MAX);
    for (const b of busy) {
      expect(b.body).toMatchObject({ code: 'BUSY' });
      // Fail fast: well inside the 5 s statement_timeout a hung request would have taken, and independent of when the lock went.
      expect(b.at - started).toBeLessThan(3_000);
    }
    for (const o of ok) expect((o.body as unknown as CountResult).meta.status).toBe('complete');
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 40_000);

  it('a revoked grant is refused_by_database (HTTP 200, no numbers) and logged at error level; the boot self-test would refuse a restart', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await t.owner.query('REVOKE SELECT ON events FROM vantage_reader');
    try {
      const r = await count(countSpec(kolkata.project.project_id, 'signup'));
      expect(r.meta.status).toBe('refused_by_database');
      expect(r).toMatchObject({ persons: null, events: null });
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/refused a compiled count statement \(pg 42501\)/));
    } finally {
      await t.owner.query('GRANT SELECT ON events TO vantage_reader');
      error.mockRestore();
    }
    expect((await count(countSpec(kolkata.project.project_id, 'signup'))).meta.status).toBe('complete');
  });
});

describe('e2e: every S2 endpoint answers a real request', () => {
  it('POST /v1/funnel, /v1/retention, /v1/count return their result envelopes with 200', async () => {
    const f = await t.http.post('/v1/funnel').send(funnelSpec(kolkata.project.project_id)).expect(200);
    expect(f.body).toEqual(expect.objectContaining({ steps: expect.any(Array), sql: expect.any(String), params: expect.any(Array), meta: expect.objectContaining({ status: 'complete' }) }));
    const r = await t.http.post('/v1/retention').send(retentionSpec(kolkata.project.project_id)).expect(200);
    expect(r.body).toEqual(expect.objectContaining({ unit: 'day', cohorts: expect.any(Array), sql: expect.stringMatching(/^WITH starters AS/), meta: expect.objectContaining({ status: 'complete' }) }));
    const c = await t.http.post('/v1/count').send(countSpec(kolkata.project.project_id, 'signup')).expect(200);
    expect(c.body).toEqual(expect.objectContaining({ persons: 13, events: 14, sql: expect.stringMatching(/^SELECT count/), meta: expect.objectContaining({ status: 'complete' }) }));
  });

  it('the query routes need no API key (D4) and ignore one if given', async () => {
    const withKey = await t.http.post('/v1/count').set(bearer(kolkata.project as TestProject)).send(countSpec(kolkata.project.project_id, 'signup')).expect(200);
    expect(withKey.body.persons).toBe(13);
  });
});

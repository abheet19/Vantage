/**
 * attacks-s2.spec.ts — LLD §9's S2 rows, run as a hostile reviewer would. Any 500, any leaked row, any number that
 * should not exist is the failure.
 */
import type { CountResult, FunnelResult, RetentionResult } from '@vantage/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bucketOf } from '../../src/domain/bucket.js';
import { FixedClock } from '../../src/infra/clock.js';
import { bearer, createTestApp, type TestApp, type TestProject } from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ clock: new FixedClock(new Date('2029-01-01T00:00:00Z')) });
});
afterAll(async () => {
  await t.close();
});

const ingest = (p: TestProject, events: object[]) => t.http.post('/v1/events').set(bearer(p)).send({ events }).expect(200);
const funnel = async (body: object) => (await t.http.post('/v1/funnel').send(body).expect(200)).body as FunnelResult;
const count = async (body: object) => (await t.http.post('/v1/count').send(body).expect(200)).body as CountResult;
const retention = async (body: object) => (await t.http.post('/v1/retention').send(body).expect(200)).body as RetentionResult;
const persons = (r: FunnelResult) => r.steps?.map((s) => s.persons) ?? null;
const RANGE = { from: '2026-08-01', to: '2026-08-31' };

describe('adversarial pass (LLD §9, slice S2)', () => {
  it('attack: a 366-day range, 10 steps and a breakdown on a high-cardinality key stays within limits — it completes with ≤ 50 named groups + "other", or times out with no numbers', async () => {
    const p = await t.createProject('cardinality', 'UTC');
    const events: object[] = [];
    for (let person = 0; person < 300; person++) {
      for (let step = 1; step <= 10; step++) {
        events.push({ event: `s${step}`, distinct_id: `u${person}`, insert_id: `u${person}-${step}`, timestamp: new Date(Date.UTC(2026, 0, 1 + (person % 300), 0, step)).toISOString(), properties: { uid: `uid-${person}-${step}` } });
      }
    }
    for (let i = 0; i < events.length; i += 500) await ingest(p, events.slice(i, i + 500));

    const spec = { kind: 'funnel', project: p.project_id, range: { from: '2026-01-01', to: '2027-01-02' }, steps: Array.from({ length: 10 }, (_, i) => ({ event: `s${i + 1}` })), breakdown: 'uid' };
    const r = await funnel(spec);
    expect(['complete', 'timed_out']).toContain(r.meta.status);
    if (r.meta.status === 'timed_out') {
      expect(r.steps).toBeNull();
      expect(r.breakdown).toBeNull();
    } else {
      expect(persons(r)).toEqual(Array(10).fill(300));
      const groups = r.breakdown?.groups ?? [];
      expect(groups.length).toBe(51);
      expect(groups.filter((g) => g.other)).toHaveLength(1);
      expect(groups.filter((g) => !g.other)).toHaveLength(50);
      expect(groups.reduce((n, g) => n + (g.persons[0] ?? 0), 0)).toBe(300);
      expect(groups.find((g) => g.other)?.persons[0]).toBe(250);
    }
  }, 60_000);

  it('attack: step 2 one millisecond BEFORE step 1 is not a conversion (> not >=); the same millisecond is not either; one after is', async () => {
    const p = await t.createProject('ms', 'UTC');
    const T = Date.UTC(2026, 7, 10, 10, 0, 0, 500);
    await ingest(p, [
      { event: 'create_project', distinct_id: 'before', insert_id: 'b1', timestamp: new Date(T - 1).toISOString() },
      { event: 'signup', distinct_id: 'before', insert_id: 'b2', timestamp: new Date(T).toISOString() },
      { event: 'signup', distinct_id: 'same', insert_id: 's1', timestamp: new Date(T).toISOString() },
      { event: 'create_project', distinct_id: 'same', insert_id: 's2', timestamp: new Date(T).toISOString() },
      { event: 'signup', distinct_id: 'after', insert_id: 'a1', timestamp: new Date(T).toISOString() },
      { event: 'create_project', distinct_id: 'after', insert_id: 'a2', timestamp: new Date(T + 1).toISOString() },
    ]);
    const spec = (order: string) => ({ kind: 'funnel', project: p.project_id, range: RANGE, steps: [{ event: 'signup' }, { event: 'create_project' }], order });
    expect(persons(await funnel(spec('sequential')))).toEqual([3, 1]);
    expect(persons(await funnel(spec('strict')))).toEqual([3, 1]);
    expect(persons(await funnel(spec('any')))).toEqual([3, 3]);
    expect((await funnel(spec('sequential'))).median_time_to_convert_s).toBeCloseTo(0.001, 6);
  });

  it('attack: DST day in Europe/London, Pacific/Apia, Feb 29 — the cohort day the SQL assigns is the day bucketOf assigns', async () => {
    const cases: [string, string][] = [
      ['Europe/London', '2026-03-29T00:30:00Z'], // 00:30 GMT, before the spring-forward
      ['Europe/London', '2026-03-29T01:30:00Z'], // 02:30 BST, the hour that did not exist
      ['Europe/London', '2026-10-25T00:30:00Z'], // 01:30 BST, the hour that happens twice
      ['Europe/London', '2026-10-25T01:30:00Z'], // 01:30 GMT, the second time
      ['Pacific/Apia', '2028-02-29T10:59:00Z'], // 23:59 on Feb 29 in UTC+13
      ['Pacific/Apia', '2028-02-29T11:00:00Z'], // 00:00 on Mar 1
      ['Asia/Kolkata', '2028-02-28T18:30:00Z'], // 00:00 on Feb 29
      ['Australia/Lord_Howe', '2026-04-04T13:30:00Z'], // 00:30 on Apr 5, the day the clock goes back 30 minutes
    ];
    for (const [tz, iso] of cases) {
      const p = await t.createProject(`dst ${tz}`, tz);
      await ingest(p, [{ event: 'signup', distinct_id: 'd', insert_id: 'd', timestamp: iso }]);
      const range = { from: iso.slice(0, 4) + '-01-01', to: iso.slice(0, 4) + '-12-31' };
      const r = await retention({ kind: 'retention', project: p.project_id, range, start: { event: 'signup' }, periods: 1 });
      expect(r.cohorts?.map((c) => c.bucket), `${tz} ${iso}`).toEqual([bucketOf(new Date(iso), tz, 'day')]);
    }
  });

  it('attack: two projects with identical event names never see each other’s rows (checked on data, not on SQL text)', async () => {
    const a = await t.createProject('twin a', 'UTC');
    const b = await t.createProject('twin b', 'UTC');
    const signups = (p: TestProject, n: number) => ingest(p, Array.from({ length: n }, (_, i) => ({ event: 'signup', distinct_id: `u${i}`, insert_id: `${p.project_id}-${i}`, timestamp: '2026-08-10T10:00:00Z' })));
    await signups(a, 3);
    await signups(b, 5);
    await ingest(b, [{ event: 'create_project', distinct_id: 'u0', insert_id: 'b-create', timestamp: '2026-08-10T11:00:00Z' }]);
    expect(await count({ kind: 'count', project: a.project_id, range: RANGE, event: { event: 'signup' } })).toMatchObject({ persons: 3, events: 3 });
    expect(await count({ kind: 'count', project: b.project_id, range: RANGE, event: { event: 'signup' } })).toMatchObject({ persons: 5, events: 5 });
    const steps = [{ event: 'signup' }, { event: 'create_project' }];
    expect(persons(await funnel({ kind: 'funnel', project: a.project_id, range: RANGE, steps }))).toEqual([3, 0]);
    expect(persons(await funnel({ kind: 'funnel', project: b.project_id, range: RANGE, steps }))).toEqual([5, 1]);
  });

  it("attack: the event name '; DROP TABLE events; --' is a parameter: the answer is empty and the table is still there", async () => {
    const p = await t.createProject('drop', 'UTC');
    await ingest(p, [{ event: 'signup', distinct_id: 'x', insert_id: 'x', timestamp: '2026-08-10T10:00:00Z' }]);
    const hostile = "'; DROP TABLE events; --";
    const c = await count({ kind: 'count', project: p.project_id, range: RANGE, event: { event: hostile } });
    expect(c.meta.status).toBe('empty');
    expect(c.params).toContain(hostile);
    expect(c.sql).not.toContain('DROP');
    const f = await funnel({ kind: 'funnel', project: p.project_id, range: RANGE, steps: [{ event: hostile }, { event: 'signup' }] });
    expect(f.meta.status).toBe('empty');
    expect((await t.owner.query('SELECT count(*)::int AS n FROM events WHERE project_id = $1', [p.project_id])).rows[0].n).toBe(1);
  });

  it('attack: a property key a"b is rejected by PropKey with 422 INVALID_SPEC at its path, before any SQL exists', async () => {
    const p = await t.createProject('key', 'UTC');
    const where = await t.http.post('/v1/count').send({ kind: 'count', project: p.project_id, range: RANGE, event: { event: 'signup' }, where: [{ key: 'a"b', op: 'is_set' }] }).expect(422);
    expect(where.body).toMatchObject({ code: 'INVALID_SPEC', path: 'where.0.key' });
    const breakdown = await t.http.post('/v1/funnel').send({ kind: 'funnel', project: p.project_id, range: RANGE, steps: [{ event: 'a' }, { event: 'b' }], breakdown: 'a"b' }).expect(422);
    expect(breakdown.body).toMatchObject({ code: 'INVALID_SPEC', path: 'breakdown' });
    const step = await t.http.post('/v1/funnel').send({ kind: 'funnel', project: p.project_id, range: RANGE, steps: [{ event: 'a', where: [{ key: 'x; --', op: 'is_set' }] }, { event: 'b' }] }).expect(422);
    expect(step.body).toMatchObject({ code: 'INVALID_SPEC', path: 'steps.0.where.0.key' });
  });

  it('attack: a smuggled "sql" field, an 11th step, a non-uuid project and a value that does not fit its operator are all 422 INVALID_SPEC', async () => {
    const base = { kind: 'count', project: '0190f3a0-0000-7000-8000-000000000000', range: RANGE, event: { event: 'signup' } };
    expect((await t.http.post('/v1/count').send({ ...base, sql: 'DROP TABLE events' }).expect(422)).body).toMatchObject({ code: 'INVALID_SPEC', path: 'sql' });
    expect((await t.http.post('/v1/funnel').send({ kind: 'funnel', project: base.project, range: RANGE, steps: Array.from({ length: 11 }, (_, i) => ({ event: `e${i}` })) }).expect(422)).body).toMatchObject({ code: 'INVALID_SPEC', path: 'steps' });
    expect((await t.http.post('/v1/count').send({ ...base, project: 'events; DROP TABLE events' }).expect(422)).body).toMatchObject({ code: 'INVALID_SPEC', path: 'project' });
    expect((await t.http.post('/v1/count').send({ ...base, where: [{ key: 'plan', op: 'eq' }] }).expect(422)).body).toMatchObject({ code: 'INVALID_SPEC', path: 'where.0.value' });
    expect((await t.http.post('/v1/count').send({ ...base, where: [{ key: 'plan', op: 'in', value: 'team' }] }).expect(422)).body).toMatchObject({ code: 'INVALID_SPEC', path: 'where.0.value' });
    expect((await t.http.post('/v1/count').send({ ...base, where: [{ key: 'plan', op: 'is_set', value: 1 }] }).expect(422)).body).toMatchObject({ code: 'INVALID_SPEC', path: 'where.0.value' });
  });

  it('attack: text PostgreSQL cannot hold (U+0000, a lone surrogate) in an event name or a filter value, and a year-0000 or year-9999 date, are 422 INVALID_SPEC at their path — never a 500 from the database', async () => {
    const p = await t.createProject('unstorable', 'UTC');
    const base = { kind: 'count', project: p.project_id, range: RANGE, event: { event: 'signup' } };
    const NUL = String.fromCharCode(0);
    const refused = async (body: object, path: RegExp) => {
      const res = await t.http.post('/v1/count').send(body).expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_SPEC' });
      expect(res.body.path).toMatch(path);
    };
    await refused({ ...base, event: { event: `sign${NUL}up` } }, /^event\.event$/);
    await refused({ ...base, event: { event: 'x\ud800y' } }, /^event\.event$/);
    await refused({ ...base, where: [{ key: 'plan', op: 'eq', value: `fr${NUL}ee` }] }, /^where\.0\.value/);
    await refused({ ...base, where: [{ key: 'plan', op: 'contains', value: NUL }] }, /^where\.0\.value/);
    await refused({ ...base, where: [{ key: 'plan', op: 'in', value: ['ok', `b${NUL}ad`] }] }, /^where\.0\.value/);
    await refused({ ...base, range: { from: '0000-01-01', to: '0000-01-02' } }, /^range\.from$/);
    await refused({ ...base, range: { from: '9999-12-30', to: '9999-12-31' } }, /^range\.from$/);
    await refused({ ...base, range: { from: '2199-12-31', to: '2200-12-31' } }, /^range\.to$/);
    const step = await t.http.post('/v1/funnel').send({ kind: 'funnel', project: p.project_id, range: RANGE, steps: [{ event: `a${NUL}` }, { event: 'b' }] }).expect(422);
    expect(step.body).toMatchObject({ code: 'INVALID_SPEC', path: 'steps.0.event' });
  });

  it('attack: contains reads string values only — the number 15 and an object holding 5 do not "contain" 5 — and an empty, numeric or null needle is refused', async () => {
    const p = await t.createProject('contains', 'UTC');
    await ingest(p, [{ event: 'buy', distinct_id: 'a', insert_id: 'a', timestamp: '2026-08-10T10:00:00Z', properties: { n: 15, o: { x: 5 }, s: 'a5b' } }]);
    const events = async (where: unknown[]) => (await count({ kind: 'count', project: p.project_id, range: RANGE, event: { event: 'buy' }, where })).events;
    expect(await events([{ key: 'n', op: 'contains', value: '5' }])).toBeNull();
    expect(await events([{ key: 'o', op: 'contains', value: '5' }])).toBeNull();
    expect(await events([{ key: 's', op: 'contains', value: '5' }])).toBe(1);
    for (const value of ['', 5, null]) {
      const res = await t.http.post('/v1/count').send({ kind: 'count', project: p.project_id, range: RANGE, event: { event: 'buy' }, where: [{ key: 's', op: 'contains', value }] }).expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_SPEC', path: 'where.0.value' });
    }
  });

  it('attack: two events in the same millisecond — strict order walks them in arrival order (event_id), so the answer is the same on every run', async () => {
    const p = await t.createProject('ties', 'UTC');
    const T = '2026-08-10T10:00:00.000Z';
    await ingest(p, [
      { event: 'signup', distinct_id: 'x', insert_id: 'x1', timestamp: T }, // x: view_pricing arrived right after signup → the chain breaks
      { event: 'view_pricing', distinct_id: 'x', insert_id: 'x2', timestamp: T },
      { event: 'create_project', distinct_id: 'x', insert_id: 'x3', timestamp: '2026-08-10T11:00:00Z' },
      { event: 'view_pricing', distinct_id: 'y', insert_id: 'y1', timestamp: T }, // y: signup arrived after view_pricing → create_project is the very next event
      { event: 'signup', distinct_id: 'y', insert_id: 'y2', timestamp: T },
      { event: 'create_project', distinct_id: 'y', insert_id: 'y3', timestamp: '2026-08-10T11:00:00Z' },
    ]);
    const spec = { kind: 'funnel', project: p.project_id, range: RANGE, steps: [{ event: 'signup' }, { event: 'create_project' }], order: 'strict' };
    for (let run = 0; run < 5; run++) expect(persons(await funnel(spec))).toEqual([2, 1]);
    expect(persons(await funnel({ ...spec, order: 'sequential' }))).toEqual([2, 2]);
    expect(persons(await funnel({ ...spec, order: 'any' }))).toEqual([2, 2]);
  });

  it('the trend and paths routes exist (S6) and answer an honest empty for an unknown project, never a 404 or a half-compiled statement', async () => {
    const ghost = '0190f3a0-0000-7000-8000-000000000000';
    const tr = await t.http.post('/v1/trend').send({ kind: 'trend', project: ghost, range: RANGE, event: { event: 'signup' } }).expect(200);
    expect(tr.body).toMatchObject({ measure: 'events', points: null, meta: { status: 'empty' } });
    const pa = await t.http.post('/v1/paths').send({ kind: 'paths', project: ghost, range: RANGE, start: 'signup' }).expect(200);
    expect(pa.body).toMatchObject({ start: 'signup', transitions: null, total_transitions: 0, meta: { status: 'empty' } });
  });
});

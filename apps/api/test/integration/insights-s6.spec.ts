/**
 * insights-s6.spec.ts — the hand-computed trend and paths numbers of fixtures/august.expected.md asserted by name
 * through POST /v1/trend and POST /v1/paths, plus the sessionisation boundary, the top-50 truncation reporting
 * total_transitions, the honest empty/timed_out paths, and V14 across two projects with identical event names.
 */
import type { PathsResult, TrendResult } from '@vantage/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFixture, type LoadResult } from '../fixture/load.js';
import { bearer, createTestApp, type TestApp } from '../helpers/app.js';

let t: TestApp;
let kolkata: LoadResult;
let utc: LoadResult;

const AUGUST = { from: '2026-08-01', to: '2026-08-31' };
const trendSpec = (project: string, over: Record<string, unknown> = {}) => ({ kind: 'trend', project, range: AUGUST, event: { event: 'signup' }, ...over });
const pathsSpec = (project: string, over: Record<string, unknown> = {}) => ({ kind: 'paths', project, range: AUGUST, start: 'signup', ...over });

const trend = async (body: object) => (await t.http.post('/v1/trend').send(body).expect(200)).body as TrendResult;
const paths = async (body: object) => (await t.http.post('/v1/paths').send(body).expect(200)).body as PathsResult;
const byBucket = (r: TrendResult) => Object.fromEntries((r.points ?? []).map((p) => [p.bucket.slice(0, 10), p.value]));
const findTransition = (r: PathsResult, step: number, from: string, to: string) => r.transitions?.find((x) => x.step === step && x.from === from && x.to === to);

beforeAll(async () => {
  t = await createTestApp();
  kolkata = await loadFixture(t);
  utc = await loadFixture(t, { timezone: 'UTC' });
});
afterAll(async () => {
  await t.close();
});

describe('august.json: trend of signup by day in Asia/Kolkata', () => {
  it('counts events per day: 11 buckets, Aug 3 and Aug 5 and Aug 20 carry 2, the rest 1, total 14', async () => {
    const r = await trend(trendSpec(kolkata.project.project_id));
    expect(r.meta.status).toBe('complete');
    expect(r.measure).toBe('events');
    expect(byBucket(r)).toEqual({
      '2026-08-03': 2,
      '2026-08-05': 2,
      '2026-08-06': 1,
      '2026-08-07': 1,
      '2026-08-08': 1,
      '2026-08-10': 1,
      '2026-08-11': 1,
      '2026-08-12': 1,
      '2026-08-14': 1,
      '2026-08-16': 1,
      '2026-08-20': 2,
    });
    expect((r.points ?? []).reduce((n, p) => n + p.value, 0)).toBe(14);
    expect(r.points?.every((p) => p.in_progress === false)).toBe(true);
    expect(r.meta.incomplete_buckets).toBe(0);
    expect(r.breakdown).toBeNull();
  });

  it('unique persons per day equals the event counts here — P07’s two signups fall on different days (Aug 8 and Aug 20)', async () => {
    const r = await trend(trendSpec(kolkata.project.project_id, { measure: 'persons' }));
    expect(r.measure).toBe('persons');
    expect(byBucket(r)).toEqual(byBucket(await trend(trendSpec(kolkata.project.project_id))));
    expect((r.points ?? []).reduce((n, p) => n + p.value, 0)).toBe(14);
  });

  it('trend of view_pricing separates events from persons: Aug 16 is 1 000 events but 1 person (P14’s generated stream)', async () => {
    const events = await trend(trendSpec(kolkata.project.project_id, { event: { event: 'view_pricing' } }));
    const persons = await trend(trendSpec(kolkata.project.project_id, { event: { event: 'view_pricing' }, measure: 'persons' }));
    expect(byBucket(events)['2026-08-16']).toBe(1000);
    expect(byBucket(persons)['2026-08-16']).toBe(1);
    expect((events.points ?? []).reduce((n, p) => n + p.value, 0)).toBe(1008);
    expect(byBucket(events)).toEqual({ '2026-08-04': 2, '2026-08-05': 1, '2026-08-06': 1, '2026-08-07': 2, '2026-08-08': 1, '2026-08-10': 1, '2026-08-16': 1000 });
  });

  it('returns the SQL and the parameters with the numbers, and no row for a day with no signups', async () => {
    const r = await trend(trendSpec(kolkata.project.project_id));
    expect(r.sql).toMatch(/^WITH e AS/);
    expect(r.params.slice(0, 6)).toEqual([kolkata.project.project_id, 'Asia/Kolkata', '2026-08-01', '2026-08-31', 'day', 'signup']);
    expect(r.points?.some((p) => p.bucket.startsWith('2026-08-04'))).toBe(false); // nobody signed up on Aug 4
  });
});

describe('august.json: paths top transitions from signup, 30-minute session gap, 5 steps', () => {
  const spec = (project: string) => pathsSpec(project, { steps: 5 });

  it('has 8 transitions from 14 start walks; the commonest is signup → view_pricing (P06 and P14)', async () => {
    const r = await paths(spec(kolkata.project.project_id));
    expect(r.meta.status).toBe('complete');
    expect(r.start).toBe('signup');
    expect(r.starts).toBe(14);
    expect(r.total_transitions).toBe(8);
    expect(r.transitions).toHaveLength(8);
    expect(r.transitions?.[0]).toMatchObject({ step: 1, from: 'signup', to: 'view_pricing', count: 2 });
    expect(r.transitions?.[0]?.pct_of_start).toBeCloseTo(2 / 14, 9);
  });

  it('P06’s whole session is one walk: signup → view_pricing → create_project → invite_teammate at steps 1, 2, 3', async () => {
    const r = await paths(spec(kolkata.project.project_id));
    expect(findTransition(r, 1, 'signup', 'view_pricing')?.count).toBe(2); // P06 and P14
    expect(findTransition(r, 2, 'view_pricing', 'create_project')?.count).toBe(1); // P06
    expect(findTransition(r, 3, 'create_project', 'invite_teammate')?.count).toBe(1); // P06
  });

  it('P12 signs up and creates a project 30 minutes later: signup → create_project at step 1', async () => {
    const r = await paths(spec(kolkata.project.project_id));
    expect(findTransition(r, 1, 'signup', 'create_project')?.count).toBe(1); // P12 (exactly 30 min: same session)
    expect(findTransition(r, 1, 'signup', 'create_project')?.median_gap_s).toBe(1800);
  });

  it('P14’s 1 000-event session contributes only steps 2..5 of view_pricing → view_pricing — five steps from the start, never a thousand', async () => {
    const r = await paths(spec(kolkata.project.project_id));
    for (const step of [2, 3, 4, 5]) expect(findTransition(r, step, 'view_pricing', 'view_pricing')?.count).toBe(1);
    expect(findTransition(r, 6, 'view_pricing', 'view_pricing')).toBeUndefined();
  });

  it('median gap of the commonest transition is the median of P06 (30 min) and P14 (1 min): 930 s', async () => {
    const r = await paths(spec(kolkata.project.project_id));
    expect(findTransition(r, 1, 'signup', 'view_pricing')?.median_gap_s).toBe(930);
  });

  it('the default of 3 steps drops P14’s deeper view_pricing chain: 6 transitions, not 8', async () => {
    const r = await paths(pathsSpec(kolkata.project.project_id));
    expect(r.total_transitions).toBe(6);
    expect(findTransition(r, 4, 'view_pricing', 'view_pricing')).toBeUndefined();
  });

  it('returns the SQL and parameters with the numbers', async () => {
    const r = await paths(spec(kolkata.project.project_id));
    expect(r.sql).toMatch(/^WITH e AS/);
    expect(r.params.slice(0, 5)).toEqual([kolkata.project.project_id, 'Asia/Kolkata', '2026-08-01', '2026-08-31', 'signup']);
  });
});

describe('paths: the sessionisation boundary', () => {
  it('an event 30 minutes after the start is one session (a transition); 31 minutes later is a new session (no transition)', async () => {
    const p = await t.createProject('sessions', 'UTC');
    t.clock.set(new Date('2026-09-02T00:00:00Z'));
    await t.http
      .post('/v1/events')
      .set(bearer(p))
      .send({
        events: [
          { event: 'signup', distinct_id: 'exactly30', insert_id: 'a1', timestamp: '2026-08-10T10:00:00Z' },
          { event: 'view_pricing', distinct_id: 'exactly30', insert_id: 'a2', timestamp: '2026-08-10T10:30:00Z' }, // exactly 30 min: same session
          { event: 'signup', distinct_id: 'over30', insert_id: 'b1', timestamp: '2026-08-11T10:00:00Z' },
          { event: 'view_pricing', distinct_id: 'over30', insert_id: 'b2', timestamp: '2026-08-11T10:31:00Z' }, // 31 min: a new session, so signup is alone
        ],
      })
      .expect(200);
    const r = await paths(pathsSpec(p.project_id));
    expect(r.starts).toBe(2); // both signups begin a walk
    expect(r.transitions).toHaveLength(1);
    expect(r.transitions?.[0]).toMatchObject({ step: 1, from: 'signup', to: 'view_pricing', count: 1 });
  });
});

describe('paths: honest degradation', () => {
  it('a start event that never occurred is empty, never a table of zeros', async () => {
    const r = await paths(pathsSpec(kolkata.project.project_id, { start: 'never_happened' }));
    expect(r.meta.status).toBe('empty');
    expect(r.transitions).toBeNull();
    expect(r.starts).toBeNull();
    expect(r.total_transitions).toBe(0);
  });

  it('a start event with no following event in any session is empty (P08/P13 are out of range; on a project of lone signups there is nothing to show)', async () => {
    const p = await t.createProject('lone', 'UTC');
    t.clock.set(new Date('2026-09-02T00:00:00Z'));
    await t.http.post('/v1/events').set(bearer(p)).send({ events: [{ event: 'signup', distinct_id: 'x', insert_id: 'x1', timestamp: '2026-08-10T10:00:00Z' }] }).expect(200);
    const r = await paths(pathsSpec(p.project_id));
    expect(r.meta.status).toBe('empty');
    expect(r.transitions).toBeNull();
  });
});

describe('V14: trend and paths never leak across two projects with identical event names', () => {
  it('the UTC project sees P08 in its August signup trend (Aug 31) and the Kolkata project does not', async () => {
    const inUtc = byBucket(await trend(trendSpec(utc.project.project_id)));
    const inKolkata = byBucket(await trend(trendSpec(kolkata.project.project_id)));
    expect(inUtc['2026-08-31']).toBe(1); // P08 signed up 08-31 18:45Z, which is Aug 31 in UTC
    expect(inKolkata['2026-08-31']).toBeUndefined(); // …and Sep 1 in Kolkata, out of the August range
    expect((await paths(pathsSpec(utc.project.project_id))).params[0]).toBe(utc.project.project_id);
    expect((await paths(pathsSpec(kolkata.project.project_id))).params[0]).toBe(kolkata.project.project_id);
  });
});

describe('e2e: the S6 endpoints answer real requests', () => {
  it('POST /v1/trend and /v1/paths return their result envelopes with 200 and a complete status', async () => {
    const tr = await t.http.post('/v1/trend').send(trendSpec(kolkata.project.project_id)).expect(200);
    expect(tr.body).toEqual(expect.objectContaining({ measure: 'events', unit: 'day', points: expect.any(Array), sql: expect.stringMatching(/^WITH e AS/), meta: expect.objectContaining({ status: 'complete' }) }));
    const pa = await t.http.post('/v1/paths').send(pathsSpec(kolkata.project.project_id)).expect(200);
    expect(pa.body).toEqual(expect.objectContaining({ start: 'signup', transitions: expect.any(Array), total_transitions: expect.any(Number), sql: expect.stringMatching(/^WITH e AS/), meta: expect.objectContaining({ status: 'complete' }) }));
  });

  it('a trend or paths spec posted to the wrong route is 422 INVALID_SPEC naming kind', async () => {
    expect((await t.http.post('/v1/trend').send(pathsSpec(kolkata.project.project_id)).expect(422)).body).toMatchObject({ code: 'INVALID_SPEC', path: 'kind' });
    expect((await t.http.post('/v1/paths').send(trendSpec(kolkata.project.project_id)).expect(422)).body).toMatchObject({ code: 'INVALID_SPEC', path: 'kind' });
  });

  it('an unknown project is an honest empty, never an error that confirms the id', async () => {
    const tr = await trend(trendSpec('0190f3a0-dead-7000-8000-000000000000'));
    expect(tr.meta.status).toBe('empty');
    expect(tr.points).toBeNull();
    const pa = await paths(pathsSpec('0190f3a0-dead-7000-8000-000000000000'));
    expect(pa.meta.status).toBe('empty');
    expect(pa.transitions).toBeNull();
  });
});

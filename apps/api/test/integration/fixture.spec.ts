/**
 * fixture.spec.ts — fixtures/august.json through the real endpoint; every number is from august.expected.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BatchStep, expandGenerate, readFixture } from '../../src/fixture/play.js';
import { bearer, createTestApp, type TestApp } from '../helpers/app.js';
import { loadFixture, type LoadResult, postBatch } from '../fixture/load.js';

let t: TestApp;
let loaded: LoadResult;

beforeAll(async () => {
  t = await createTestApp();
  loaded = await loadFixture(t);
});
afterAll(async () => {
  await t.close();
});

const q = async <T extends Record<string, unknown>>(sql: string, ...params: unknown[]) => (await t.owner.query<T>(sql, [loaded.project.project_id, ...params])).rows;
const count = async (sql: string, ...params: unknown[]) => Number((await q<{ n: number }>(sql, ...params))[0]?.n);

describe('august.json: ingest facts', () => {
  it('submits 1 046 events across the steps and accepts 1 045 (one shared-retry-abc collision)', async () => {
    expect(loaded.submitted).toBe(1046);
    const accepted = loaded.batches.reduce((n, b) => n + b.response.accepted, 0);
    const duplicates = loaded.batches.reduce((n, b) => n + b.response.duplicates, 0);
    expect(accepted).toBe(1045);
    expect(duplicates).toBe(1);
    expect(await count('SELECT count(*)::int AS n FROM events WHERE project_id = $1')).toBe(1045);
  });

  it('the P01–P08 batch accepts 30 with too_old = 1 (P01’s 2025 view_pricing)', () => {
    expect(loaded.batches[0]?.response).toEqual({ accepted: 30, duplicates: 0, too_old: 1 });
  });

  it('P10/P11: the second create_project carrying shared-retry-abc is dropped, so P11 keeps only signup', async () => {
    const step = loaded.batches.find((b) => b.label.startsWith('P10 and P11'));
    expect(step?.response).toMatchObject({ accepted: 3, duplicates: 1 });
    const p11 = await q<{ event: string }>(`SELECT event FROM events WHERE project_id = $1 AND distinct_id = 'p11' ORDER BY event`);
    expect(p11.map((r) => r.event)).toEqual(['signup']);
    const holder = await q<{ distinct_id: string }>(`SELECT distinct_id FROM events WHERE project_id = $1 AND insert_id = 'shared-retry-abc'`);
    expect(holder).toEqual([{ distinct_id: 'p10' }]);
  });

  it('P12: both events shifted forward by exactly 3 h with ts_source client_shifted', async () => {
    const rows = await q<{ event: string; event_ts: Date; ts_source: string }>(`SELECT event, event_ts, ts_source FROM events WHERE project_id = $1 AND distinct_id = 'p12' ORDER BY event_ts`);
    expect(rows).toEqual([
      { event: 'signup', event_ts: new Date('2026-08-14T11:00:00Z'), ts_source: 'client_shifted' },
      { event: 'create_project', event_ts: new Date('2026-08-14T11:30:00Z'), ts_source: 'client_shifted' },
    ]);
  });

  it('P13: the 2031 signup is clamped to server_ts with ts_source server; its create_project is untouched', async () => {
    const rows = await q<{ event: string; event_ts: Date; ts_source: string }>(`SELECT event, event_ts, ts_source FROM events WHERE project_id = $1 AND distinct_id = 'p13' ORDER BY event`);
    expect(rows).toEqual([
      { event: 'create_project', event_ts: new Date('2026-08-15T10:00:00Z'), ts_source: 'client' },
      { event: 'signup', event_ts: new Date('2026-09-02T00:00:00Z'), ts_source: 'server' },
    ]);
  });

  it('ts_source totals: 2 client_shifted, 1 server, 1 042 client', async () => {
    const rows = await q<{ ts_source: string; n: number }>(`SELECT ts_source, count(*)::int AS n FROM events WHERE project_id = $1 GROUP BY ts_source ORDER BY ts_source`);
    expect(rows).toEqual([
      { ts_source: 'client', n: 1042 },
      { ts_source: 'client_shifted', n: 2 },
      { ts_source: 'server', n: 1 },
    ]);
  });

  it('key_source: exactly P02’s 4 events have derived keys; the other 1 041 are client keys', async () => {
    const rows = await q<{ key_source: string; n: number }>(`SELECT key_source, count(*)::int AS n FROM events WHERE project_id = $1 GROUP BY key_source ORDER BY key_source`);
    expect(rows).toEqual([
      { key_source: 'client', n: 1041 },
      { key_source: 'derived', n: 4 },
    ]);
    const derived = await q<{ distinct_id: string }>(`SELECT DISTINCT distinct_id FROM events WHERE project_id = $1 AND key_source = 'derived'`);
    expect(derived).toEqual([{ distinct_id: 'p02' }]);
  });

  it('P01’s 2025 event keeps its own event_ts (accepted, flagged, not rewritten)', async () => {
    const rows = await q<{ event_ts: Date }>(`SELECT event_ts FROM events WHERE project_id = $1 AND insert_id = 'p01-old'`);
    expect(rows).toEqual([{ event_ts: new Date('2025-06-01T10:00:00Z') }]);
  });

  it('P08’s signup at 2026-08-31T18:45Z is Sep 1 in Asia/Kolkata and Aug 31 in UTC (V5 seed fact)', async () => {
    const rows = await q<{ kolkata: string; utc: string }>(
      `SELECT to_char(event_ts AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS kolkata, to_char(event_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS utc
       FROM events WHERE project_id = $1 AND insert_id = 'p08-signup'`,
    );
    expect(rows).toEqual([{ kolkata: '2026-09-01', utc: '2026-08-31' }]);
  });

  it('P14 has 1 001 events (signup + 1 000 generated view_pricing, one minute apart)', async () => {
    expect(await count(`SELECT count(*)::int AS n FROM events WHERE project_id = $1 AND distinct_id = 'p14'`)).toBe(1001);
    const span = await q<{ first: Date; last: Date }>(`SELECT min(event_ts) AS first, max(event_ts) AS last FROM events WHERE project_id = $1 AND distinct_id = 'p14' AND event = 'view_pricing'`);
    expect(span).toEqual([{ first: new Date('2026-08-16T00:01:00Z'), last: new Date('2026-08-16T16:40:00Z') }]);
  });
});

describe('august.json: identity (P09)', () => {
  it('identify(anon-9, user-9) merged two known persons, moving one distinct id', () => {
    expect(loaded.identifies).toHaveLength(1);
    expect(loaded.identifies[0]?.response).toMatchObject({ merged: true, distinct_ids_moved: 1 });
  });

  it('after the merge there are 15 persons behind 16 distinct ids, 16 persons rows (the merged one pointing at its survivor) and one person_merges row naming the moved id', async () => {
    expect(await count('SELECT count(DISTINCT person_id)::int AS n FROM person_distinct_ids WHERE project_id = $1')).toBe(15);
    expect(await count('SELECT count(*)::int AS n FROM person_distinct_ids WHERE project_id = $1')).toBe(16);
    expect(await count('SELECT count(*)::int AS n FROM persons WHERE project_id = $1')).toBe(16);
    const merges = await q<{ distinct_ids_moved: string[]; from_person: string; into_person: string }>('SELECT distinct_ids_moved, from_person, into_person FROM person_merges WHERE project_id = $1');
    expect(merges).toHaveLength(1);
    expect(merges[0]?.distinct_ids_moved).toHaveLength(1);
    expect(['anon-9', 'user-9']).toContain(merges[0]?.distinct_ids_moved[0]);
    const merged = await q<{ merged_into: string }>('SELECT merged_into FROM persons WHERE project_id = $1 AND person_id = $2', merges[0]?.from_person);
    expect(merged).toEqual([{ merged_into: merges[0]?.into_person }]);
    const nine = await q<{ n: number }>(`SELECT count(DISTINCT person_id)::int AS n FROM person_distinct_ids WHERE project_id = $1 AND distinct_id IN ('anon-9', 'user-9')`);
    expect(nine[0]?.n).toBe(1);
  });

  it('identifying anon-9 → user-9 again is a no-op', async () => {
    const res = await t.http.post('/v1/identify').set(bearer(loaded.project)).send({ anonymous_id: 'anon-9', user_id: 'user-9' }).expect(200);
    expect(res.body).toMatchObject({ merged: false, distinct_ids_moved: 0 });
    expect(await count('SELECT count(*)::int AS n FROM person_merges WHERE project_id = $1')).toBe(1);
  });
});

describe('august.json: replay (V1)', () => {
  it('posting the P01–P08 batch twice more adds no rows and reports 30 duplicates and too_old 0 each time (P02’s derived keys included; too_old counts accepted rows only)', async () => {
    const first = readFixture().steps[0] as BatchStep;
    const a = await postBatch(t, loaded.project, first);
    const b = await postBatch(t, loaded.project, first);
    expect(a).toEqual({ accepted: 0, duplicates: 30, too_old: 0 });
    expect(b).toEqual({ accepted: 0, duplicates: 30, too_old: 0 });
    expect(a.duplicates + b.duplicates).toBe(60);
    expect(await count('SELECT count(*)::int AS n FROM events WHERE project_id = $1')).toBe(1045);
  });
});

describe('fixture loader', () => {
  it('expands the P14 generate step into two batches of 500 with zero-padded insert ids', () => {
    const gen = readFixture().steps.find((s) => s.kind === 'generate');
    if (!gen || gen.kind !== 'generate') throw new Error('no generate step');
    const batches = expandGenerate(gen);
    expect(batches.map((b) => b.events.length)).toEqual([500, 500]);
    expect(batches[0]?.events[0]).toMatchObject({ insert_id: 'p14-vp-0001', timestamp: '2026-08-16T00:01:00.000Z', properties: { page: 'pricing' } });
    expect(batches[1]?.events[499]?.insert_id).toBe('p14-vp-1000');
  });

  it('every explicit fixture event carries a timestamp and P02 alone omits insert_id', () => {
    const explicit = readFixture().steps.flatMap((s) => (s.kind === 'batch' ? s.events : []));
    expect(explicit).toHaveLength(46);
    expect(explicit.every((e) => e.timestamp)).toBe(true);
    expect(new Set(explicit.filter((e) => !e.insert_id).map((e) => e.distinct_id))).toEqual(new Set(['p02']));
  });
});

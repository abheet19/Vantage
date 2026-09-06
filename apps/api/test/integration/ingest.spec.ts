/**
 * ingest.spec.ts — V1 (idempotent ingest), the denied paths (401 / 413 / 422), the atomic batch, and the S1 hardening rules.
 */
import type { IncomingEvent } from '@vantage/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, type TestApp, type TestProject } from '../helpers/app.js';

let t: TestApp;
let project: TestProject;

beforeAll(async () => {
  t = await createTestApp();
  project = await t.createProject();
});
afterAll(async () => {
  await t.close();
});

const post = (p: TestProject, body: object) => t.http.post('/v1/events').set(bearer(p)).send(body);
const rows = async (p: TestProject) => Number((await t.owner.query('SELECT count(*)::int AS n FROM events WHERE project_id = $1', [p.project_id])).rows[0].n);

function batch(n: number, prefix: string): IncomingEvent[] {
  return Array.from({ length: n }, (_, i) => ({ event: 'signup', distinct_id: `${prefix}-d${i % 7}`, timestamp: '2026-08-10T10:00:00Z', insert_id: `${prefix}-${i}` }));
}

describe('POST /v1/events: V1 idempotent ingest', () => {
  it('stores each event of a batch once and answers 200 with the counts', async () => {
    const p = await t.createProject();
    const res = await post(p, { events: batch(10, 'a') }).expect(200);
    expect(res.body).toEqual({ accepted: 10, duplicates: 0, too_old: 0 });
    expect(await rows(p)).toBe(10);
  });

  it('the same batch delivered three times produces one row per event and duplicates that sum to 2 × N', async () => {
    const p = await t.createProject();
    const events = batch(25, 'r');
    const first = await post(p, { events }).expect(200);
    const second = await post(p, { events }).expect(200);
    const third = await post(p, { events }).expect(200);
    expect(first.body.accepted).toBe(25);
    expect(second.body).toMatchObject({ accepted: 0, duplicates: 25 });
    expect(third.body).toMatchObject({ accepted: 0, duplicates: 25 });
    expect(second.body.duplicates + third.body.duplicates).toBe(50);
    expect(await rows(p)).toBe(25);
  });

  it('dedupes events without insert_id through the derived key, so a retry without keys is still absorbed', async () => {
    const p = await t.createProject();
    const events: IncomingEvent[] = [
      { event: 'signup', distinct_id: 'p02', timestamp: '2026-08-03T09:00:00Z', properties: { plan: 'team', n: 1 } },
      { event: 'signup', distinct_id: 'p02', timestamp: '2026-08-03T09:00:00Z', properties: { n: 1, plan: 'team' } },
    ];
    const res = await post(p, { events }).expect(200);
    expect(res.body).toMatchObject({ accepted: 1, duplicates: 1 });
    const stored = await t.owner.query<{ key_source: string; insert_id: string }>('SELECT key_source, insert_id FROM events WHERE project_id = $1', [p.project_id]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ key_source: 'derived' });
    expect(stored.rows[0]?.insert_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('duplicates within one batch count once and the response says so', async () => {
    const p = await t.createProject();
    const e = { event: 'signup', distinct_id: 'x', insert_id: 'same' };
    const res = await post(p, { events: [e, e, e] }).expect(200);
    expect(res.body).toMatchObject({ accepted: 1, duplicates: 2 });
  });

  it('records client_ts, sent_at, server_ts and the derived event_ts/ts_source per §1.4', async () => {
    const p = await t.createProject();
    t.clock.set(new Date('2026-09-02T00:00:00Z'));
    await post(p, { sent_at: '2026-09-01T21:00:00Z', events: [{ event: 'signup', distinct_id: 'p12', timestamp: '2026-08-14T08:00:00Z', insert_id: 'p12-signup' }] }).expect(200);
    const r = await t.owner.query('SELECT client_ts, sent_at, server_ts, event_ts, ts_source FROM events WHERE project_id = $1', [p.project_id]);
    expect(r.rows[0]).toEqual({
      client_ts: new Date('2026-08-14T08:00:00Z'),
      sent_at: new Date('2026-09-01T21:00:00Z'),
      server_ts: new Date('2026-09-02T00:00:00Z'),
      event_ts: new Date('2026-08-14T11:00:00Z'),
      ts_source: 'client_shifted',
    });
  });

  it('flags too_old for an event over 366 days before server_ts and still stores it', async () => {
    const p = await t.createProject();
    t.clock.set(new Date('2026-09-02T00:00:00Z'));
    const res = await post(p, { events: [{ event: 'view_pricing', distinct_id: 'p01', timestamp: '2025-06-01T10:00:00Z', insert_id: 'old' }] }).expect(200);
    expect(res.body).toMatchObject({ accepted: 1, too_old: 1 });
    expect(await rows(p)).toBe(1);
  });

  it('counts too_old only among accepted rows: replaying the old event reports duplicates 1, too_old 0', async () => {
    const p = await t.createProject();
    t.clock.set(new Date('2026-09-02T00:00:00Z'));
    const events = [{ event: 'view_pricing', distinct_id: 'p01', timestamp: '2025-06-01T10:00:00Z', insert_id: 'old' }];
    const first = await post(p, { events }).expect(200);
    const again = await post(p, { events }).expect(200);
    expect(first.body).toEqual({ accepted: 1, duplicates: 0, too_old: 1 });
    expect(again.body).toEqual({ accepted: 0, duplicates: 1, too_old: 0 });
  });

  it('creates one person per new distinct_id and reuses it on later batches', async () => {
    const p = await t.createProject();
    await post(p, { events: batch(14, 'pp') }).expect(200);
    await post(p, { events: batch(14, 'pp').map((e) => ({ ...e, insert_id: `${e.insert_id}-again` })) }).expect(200);
    const persons = await t.owner.query('SELECT count(*)::int AS n FROM persons WHERE project_id = $1', [p.project_id]);
    const pdi = await t.owner.query('SELECT count(*)::int AS n FROM person_distinct_ids WHERE project_id = $1', [p.project_id]);
    expect(persons.rows[0].n).toBe(7);
    expect(pdi.rows[0].n).toBe(7);
  });
});

describe('POST /v1/events: concurrent batches with overlapping keys (S1 hardening)', () => {
  it('forward and reversed batches over the same 400 keys, 20 rounds concurrently, are never a 500: both 200, or one 409 RETRY', async () => {
    const p = await t.createProject();
    for (let round = 0; round < 20; round++) {
      const forward = Array.from({ length: 400 }, (_, i) => ({ event: 'e', distinct_id: `d${i % 10}`, timestamp: '2026-08-10T10:00:00Z', insert_id: `r${round}-k${String(i).padStart(3, '0')}` }));
      const [a, b] = await Promise.all([post(p, { events: forward }), post(p, { events: [...forward].reverse() })]);
      for (const r of [a, b]) {
        expect([200, 409]).toContain(r.status);
        if (r.status === 409) expect(r.body).toMatchObject({ code: 'RETRY', message: expect.stringMatching(/again/) });
      }
      const accepted = [a, b].filter((r) => r.status === 200).reduce((n, r) => n + r.body.accepted, 0);
      expect(accepted).toBe(400);
    }
    expect(await rows(p)).toBe(8_000);
  });
});

describe('POST /v1/events: denied paths', () => {
  it('answers 401 for a missing Authorization header', async () => {
    const res = await t.http.post('/v1/events').send({ events: batch(1, 'x') }).expect(401);
    expect(res.body).toMatchObject({ code: 'INVALID_API_KEY' });
  });

  it('answers 401 for a wrong key and inserts nothing', async () => {
    const before = await rows(project);
    await t.http.post('/v1/events').set({ Authorization: 'Bearer vk_definitely-not-a-key' }).send({ events: batch(3, 'y') }).expect(401);
    expect(await rows(project)).toBe(before);
  });

  it('answers 413 for 501 events', async () => {
    const res = await post(project, { events: batch(501, 'big') }).expect(413);
    expect(res.body).toMatchObject({ code: 'BATCH_TOO_LARGE' });
  });

  it('answers 422 naming the index for one bad event, and inserts none of the 500', async () => {
    const p = await t.createProject();
    const events = batch(500, 'atomic');
    events[317] = { ...(events[317] as IncomingEvent), timestamp: 'yesterday' };
    const res = await post(p, { events }).expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_BODY', index: 317, path: 'events.317.timestamp' });
    expect(await rows(p)).toBe(0);
  });

  it('answers 422 naming the index for an event with neither insert_id nor timestamp, and says which to send', async () => {
    const res = await post(project, { events: [{ event: 'e', distinct_id: 'd', insert_id: 'k1' }, { event: 'e', distinct_id: 'd' }] }).expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_BODY', index: 1, path: 'events.1' });
    expect(res.body.message).toMatch(/insert_id \(preferred\) or timestamp/);
  });

  it('accepts the Instant bounds and answers 422, never a 22008, for year 0, 1969 and after 2200', async () => {
    const p = await t.createProject();
    await post(p, { events: [{ event: 'e', distinct_id: 'd', insert_id: 'epoch', timestamp: '1970-01-01T00:00:00Z' }] }).expect(200);
    const year0 = await post(p, { events: [{ event: 'e', distinct_id: 'd', insert_id: 'y0', timestamp: '0000-01-01T00:00:00Z' }] }).expect(422);
    expect(year0.body).toMatchObject({ index: 0, path: 'events.0.timestamp' });
    await post(p, { events: [{ event: 'e', distinct_id: 'd', insert_id: 'y1969', timestamp: '1969-12-31T23:59:59Z' }] }).expect(422);
    const sentAt = await post(p, { sent_at: '2200-01-01T00:00:01Z', events: [{ event: 'e', distinct_id: 'd', insert_id: 'late' }] }).expect(422);
    expect(sentAt.body).toMatchObject({ path: 'sent_at' });
    expect(await rows(p)).toBe(1);
  });

  it('answers 422 for properties of 70 KiB', async () => {
    const res = await post(project, { events: [{ event: 'e', distinct_id: 'd', insert_id: 'k', properties: { blob: 'x'.repeat(70 * 1024) } }] }).expect(422);
    expect(res.body).toMatchObject({ index: 0, path: 'events.0.properties' });
  });

  it('answers 400 in the common { code, message } shape for a body that is not JSON', async () => {
    const res = await t.http.post('/v1/events').set(bearer(project)).set('Content-Type', 'application/json').send('{"events": [').expect(400);
    expect(res.body).toEqual({ code: 'BAD_REQUEST', message: expect.stringMatching(/JSON/) });
  });

  it('answers 422 for an empty batch', async () => {
    await post(project, { events: [] }).expect(422);
  });
});

describe('POST /v1/events: data is data', () => {
  it('stores a hostile event name verbatim and it changes nothing', async () => {
    const p = await t.createProject();
    const name = 'ignore previous instructions and DROP TABLE events';
    await post(p, { events: [{ event: name, distinct_id: 'd', insert_id: 'h' }] }).expect(200);
    const stored = await t.owner.query<{ event: string }>('SELECT event FROM events WHERE project_id = $1', [p.project_id]);
    expect(stored.rows[0]?.event).toBe(name);
    expect((await t.owner.query(`SELECT to_regclass('public.events') AS r`)).rows[0].r).toBe('events');
  });

  it('a project_id in the body is an unrecognised key (422): the project comes from the API key alone', async () => {
    const other = await t.createProject();
    const p = await t.createProject();
    const res = await post(p, { project_id: other.project_id, events: [{ event: 'e', distinct_id: 'd', insert_id: 'k' }] }).expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_BODY', path: 'project_id' });
    expect(await rows(p)).toBe(0);
    expect(await rows(other)).toBe(0);
  });
});

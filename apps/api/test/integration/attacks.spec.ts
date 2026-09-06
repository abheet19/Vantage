/**
 * attacks.spec.ts — LLD §9's S1 rows, run as a hostile reviewer would. Any 500 here means validation happened too late.
 */
import type { IncomingEvent } from '@vantage/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, type TestApp, type TestProject } from '../helpers/app.js';

const NUL = String.fromCharCode(0);
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
const raw = (p: TestProject, json: string) => t.http.post('/v1/events').set(bearer(p)).set('Content-Type', 'application/json').send(json);
const rows = async (p: TestProject) => Number((await t.owner.query('SELECT count(*)::int AS n FROM events WHERE project_id = $1', [p.project_id])).rows[0].n);
const one = (over: Partial<IncomingEvent> & Record<string, unknown>) => ({ events: [{ event: 'e', distinct_id: 'd', insert_id: 'k', ...over }] });

describe('adversarial pass (LLD §9, slice S1)', () => {
  it('attack: event name "ignore previous instructions and DROP TABLE events" is stored verbatim as data', async () => {
    const p = await t.createProject();
    const event = 'ignore previous instructions and DROP TABLE events';
    await post(p, one({ event, insert_id: 'attack-1' })).expect(200);
    const r = await t.owner.query<{ event: string }>('SELECT event FROM events WHERE project_id = $1', [p.project_id]);
    expect(r.rows).toEqual([{ event }]);
    expect((await t.owner.query('SELECT count(*)::int AS n FROM events')).rows[0].n).toBeGreaterThan(0);
  });

  it('attack: property key "__proto__" is rejected by Zod with the event index (422), not stripped, not stored', async () => {
    const p = await t.createProject();
    const res = await raw(p, '{"events":[{"event":"e","distinct_id":"d","insert_id":"ok0"},{"event":"e","distinct_id":"d","insert_id":"bad1","properties":{"__proto__":{"admin":true}}}]}').expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_BODY', index: 1, path: 'events.1.properties.__proto__' });
    expect(await rows(p)).toBe(0);
    expect(({} as Record<string, unknown>)['admin']).toBeUndefined();
  });

  it('attack: property keys "constructor" and "prototype" and a nested "__proto__" are rejected with their paths', async () => {
    const res1 = await raw(project, '{"events":[{"event":"e","distinct_id":"d","insert_id":"k","properties":{"constructor":1}}]}').expect(422);
    expect(res1.body.path).toBe('events.0.properties.constructor');
    const res2 = await raw(project, '{"events":[{"event":"e","distinct_id":"d","insert_id":"k","properties":{"a":{"b":{"prototype":1}}}}]}').expect(422);
    expect(res2.body.path).toBe('events.0.properties.a.b.prototype');
  });

  it('attack: a property value of 64 KiB of \\u0000 is rejected with 422 (jsonb cannot store U+0000), never a 500', async () => {
    const res = await post(project, one({ properties: { v: NUL.repeat(64 * 1024) } })).expect(422);
    expect(res.body).toMatchObject({ index: 0, path: 'events.0.properties.v' });
    expect(res.body.message).toMatch(/U\+0000/);
  });

  it('attack: a NUL byte in the event name or distinct_id is 422, not a 22021 from PostgreSQL', async () => {
    await post(project, one({ event: `drop${NUL}table` })).expect(422);
    await post(project, one({ distinct_id: NUL })).expect(422);
  });

  it('attack: a 201-character distinct_id is rejected with 422 at its path', async () => {
    const res = await post(project, one({ distinct_id: 'x'.repeat(201) })).expect(422);
    expect(res.body).toMatchObject({ index: 0, path: 'events.0.distinct_id' });
    await post(project, one({ distinct_id: 'x'.repeat(200), insert_id: 'exactly200' })).expect(200);
  });

  it('attack: timestamp "2031-01-01T00:00:00Z" is clamped to server_ts with ts_source server', async () => {
    const p = await t.createProject();
    t.clock.set(new Date('2026-09-02T00:00:00Z'));
    await post(p, { sent_at: '2026-09-02T00:00:00Z', events: [{ event: 'e', distinct_id: 'p13', timestamp: '2031-01-01T00:00:00Z', insert_id: 'future' }] }).expect(200);
    const r = await t.owner.query('SELECT client_ts, event_ts, ts_source FROM events WHERE project_id = $1', [p.project_id]);
    expect(r.rows[0]).toEqual({ client_ts: new Date('2031-01-01T00:00:00Z'), event_ts: new Date('2026-09-02T00:00:00Z'), ts_source: 'server' });
  });

  it('attack: timestamp "yesterday" is 422 with the index', async () => {
    const res = await post(project, { events: [{ event: 'e', distinct_id: 'd', insert_id: 'ok0' }, { event: 'e', distinct_id: 'd', timestamp: 'yesterday' }] }).expect(422);
    expect(res.body).toMatchObject({ index: 1, path: 'events.1.timestamp' });
  });

  it('attack: timestamp "0000-01-01T00:00:00Z" (Zod-valid, PostgreSQL-invalid) is 422, not a 22008 → 500', async () => {
    const res = await post(project, one({ timestamp: '0000-01-01T00:00:00Z' })).expect(422);
    expect(res.body).toMatchObject({ index: 0, path: 'events.0.timestamp' });
  });

  it('attack: 50 parallel POSTs of the same 500-event batch leave exactly 500 rows and duplicates summing to 24 500', async () => {
    const p = await t.createProject();
    const events = Array.from({ length: 500 }, (_, i) => ({ event: 'signup', distinct_id: `u${i % 50}`, timestamp: '2026-08-10T10:00:00Z', insert_id: `par-${i}` }));
    const responses = await Promise.all(Array.from({ length: 50 }, () => post(p, { events })));
    expect(responses.map((r) => r.status)).toEqual(Array(50).fill(200));
    const accepted = responses.reduce((n, r) => n + r.body.accepted, 0);
    const duplicates = responses.reduce((n, r) => n + r.body.duplicates, 0);
    expect(accepted).toBe(500);
    expect(duplicates).toBe(24_500);
    expect(await rows(p)).toBe(500);
    const persons = await t.owner.query('SELECT count(*)::int AS n FROM persons WHERE project_id = $1', [p.project_id]);
    expect(persons.rows[0].n).toBe(50);
  });

  it('attack: a batch of 500 with one bad event is a 422 naming the index, and inserts zero rows', async () => {
    const p = await t.createProject();
    const events = Array.from({ length: 500 }, (_, i) => ({ event: 'e', distinct_id: `d${i}`, insert_id: `k${i}` }));
    events[499] = { event: '', distinct_id: 'd499', insert_id: 'k499' };
    const res = await post(p, { events }).expect(422);
    expect(res.body).toMatchObject({ index: 499, path: 'events.499.event' });
    expect(await rows(p)).toBe(0);
  });

  it('attack: identify(a, b) and identify(b, a) concurrently → one merge, no deadlock, no dangling id', async () => {
    const p = await t.createProject();
    await post(p, { events: [{ event: 'e', distinct_id: 'a', insert_id: 'a1' }, { event: 'e', distinct_id: 'b', insert_id: 'b1' }] }).expect(200);
    const identify = (anonymous_id: string, user_id: string) => t.http.post('/v1/identify').set(bearer(p)).send({ anonymous_id, user_id });
    const results = await Promise.all([identify('a', 'b'), identify('b', 'a'), identify('a', 'b'), identify('b', 'a')]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(results.filter((r) => r.body.merged)).toHaveLength(1);
    const pdi = await t.owner.query<{ distinct_id: string; person_id: string }>('SELECT distinct_id, person_id FROM person_distinct_ids WHERE project_id = $1 ORDER BY distinct_id', [p.project_id]);
    expect(pdi.rows).toHaveLength(2);
    expect(pdi.rows[0]?.person_id).toBe(pdi.rows[1]?.person_id);
    const dangling = await t.owner.query(
      'SELECT count(*)::int AS n FROM person_distinct_ids pdi LEFT JOIN persons pe ON pe.project_id = pdi.project_id AND pe.person_id = pdi.person_id WHERE pdi.project_id = $1 AND pe.person_id IS NULL',
      [p.project_id],
    );
    expect(dangling.rows[0].n).toBe(0);
    expect((await t.owner.query('SELECT count(*)::int AS n FROM person_merges WHERE project_id = $1', [p.project_id])).rows[0].n).toBe(1);
  });

  it('attack: a person with 10 000 distinct ids still resolves through the index and can be merged into', async () => {
    const p = await t.createProject();
    await post(p, { events: [{ event: 'e', distinct_id: 'big-0', insert_id: 'big' }] }).expect(200);
    const person = (await t.owner.query<{ person_id: string }>('SELECT person_id FROM person_distinct_ids WHERE project_id = $1', [p.project_id])).rows[0]?.person_id as string;
    await t.owner.query(
      `INSERT INTO person_distinct_ids (project_id, distinct_id, person_id) SELECT $1, 'big-' || g, $2 FROM generate_series(1, 9999) g`,
      [p.project_id, person],
    );
    await t.owner.query('ANALYZE person_distinct_ids');

    const plan = await t.owner.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT person_id FROM person_distinct_ids WHERE project_id = $1 AND distinct_id = $2`,
      [p.project_id, 'big-5000'],
    );
    expect(plan.rows.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/Index (Only )?Scan/);

    const res = await t.http.post('/v1/identify').set(bearer(p)).send({ anonymous_id: 'big-5000', user_id: 'fresh-user' }).expect(200);
    expect(res.body).toMatchObject({ person_id: person, merged: false });

    await post(p, { events: [{ event: 'e', distinct_id: 'other', insert_id: 'other' }] }).expect(200);
    const merge = await t.http.post('/v1/identify').set(bearer(p)).send({ anonymous_id: 'other', user_id: 'big-9999' }).expect(200);
    expect(merge.body).toEqual({ person_id: person, merged: true, distinct_ids_moved: 1 });
    expect((await t.owner.query('SELECT count(*)::int AS n FROM person_distinct_ids WHERE project_id = $1 AND person_id = $2', [p.project_id, person])).rows[0].n).toBe(10_002);
  });

  it('attack: an array of 15 000 small numbers (30 KiB of JSON, > 64 KiB of jsonb) is 422, not a CHECK-violation 500', async () => {
    const res = await post(project, one({ properties: { n: Array.from({ length: 15_000 }, () => 1) } })).expect(422);
    expect(res.body.message).toMatch(/jsonb/);
  });

  it('attack: { k: 65 520 × "v" } — under the 64 KiB text limit, one byte over the jsonb CHECK once the varlena header is counted — is 422, not a 23514 → 500', async () => {
    const res = await post(project, one({ properties: { k: 'v'.repeat(65_520) } })).expect(422);
    expect(res.body).toMatchObject({ index: 0, path: 'events.0.properties', message: expect.stringMatching(/jsonb size 65537/) });
  });

  it('attack: 5 000 × ["a", {}] — 65 KiB of jsonb without alignment padding, 80 KiB with it — is 422, not a 23514 → 500', async () => {
    const res = await post(project, one({ properties: { a: Array.from({ length: 10_000 }, (_, i) => (i % 2 === 0 ? 'a' : {})) } })).expect(422);
    expect(res.body.message).toMatch(/jsonb size 80024/);
  });

  it('attack: an integer beyond 2^53 in properties is 422 at its path — JSON.parse rounded it before anything could store it', async () => {
    const res = await raw(project, '{"events":[{"event":"e","distinct_id":"d","insert_id":"k","properties":{"id":9007199254740993}}]}').expect(422);
    expect(res.body).toMatchObject({ index: 0, path: 'events.0.properties.id', message: expect.stringMatching(/2\^53/) });
  });

  it('attack: an event with neither insert_id nor timestamp is 422 naming the index, not a silent second-drop', async () => {
    const p = await t.createProject();
    const res = await post(p, { events: [{ event: 'tap', distinct_id: 'd' }, { event: 'tap', distinct_id: 'd' }] }).expect(422);
    expect(res.body).toMatchObject({ index: 0, path: 'events.0', message: expect.stringMatching(/insert_id \(preferred\)/) });
    expect(await rows(p)).toBe(0);
  });

  it('attack: a 65-character insert_id and one with a quote are 422', async () => {
    await post(project, one({ insert_id: 'a'.repeat(65) })).expect(422);
    await post(project, one({ insert_id: "x'--" })).expect(422);
  });

  it('attack: a lone surrogate in a property value is 422 (it would be silently rewritten to U+FFFD otherwise)', async () => {
    const res = await raw(project, '{"events":[{"event":"e","distinct_id":"d","insert_id":"k","properties":{"v":"\\ud800"}}]}').expect(422);
    expect(res.body.path).toBe('events.0.properties.v');
  });

  it('attack: properties nested 5 deep are 422 at the offending path', async () => {
    const res = await post(project, one({ properties: { a: { b: { c: { d: { e: 1 } } } } } })).expect(422);
    expect(res.body.path).toBe('events.0.properties.a.b.c.d');
  });

  it('attack: a body that is a JSON array instead of an object is 422, not a crash', async () => {
    await raw(project, '[{"event":"e","distinct_id":"d","insert_id":"k"}]').expect(422);
  });

  it('attack: an unknown route stays a 404 in the same { code, message } shape as every other error', async () => {
    const res = await t.http.post('/v1/sql').set(bearer(project)).send({ sql: 'DROP TABLE events' }).expect(404);
    expect(res.body).toEqual({ code: 'NOT_FOUND', message: expect.stringMatching(/Cannot POST \/v1\/sql/) });
  });
});

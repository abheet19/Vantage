/**
 * identity.spec.ts — V10's prerequisite: identify repoints, is idempotent, survives races, is atomic, and leaves an audit trail that names the ids it moved.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, type TestApp, type TestProject } from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const ingest = (p: TestProject, distinctId: string, event: string, insertId: string) =>
  t.http.post('/v1/events').set(bearer(p)).send({ events: [{ event, distinct_id: distinctId, insert_id: insertId, timestamp: '2026-08-10T07:00:00Z' }] }).expect(200);
const identify = (p: TestProject, anonymous_id: string, user_id: string) => t.http.post('/v1/identify').set(bearer(p)).send({ anonymous_id, user_id });
const personOf = async (p: TestProject, distinctId: string) =>
  (await t.owner.query<{ person_id: string }>('SELECT person_id FROM person_distinct_ids WHERE project_id = $1 AND distinct_id = $2', [p.project_id, distinctId])).rows[0]?.person_id;
const merges = async (p: TestProject) => (await t.owner.query('SELECT from_person, into_person, distinct_ids_moved, reason FROM person_merges WHERE project_id = $1', [p.project_id])).rows;
const mergedInto = async (p: TestProject, personId: string) =>
  (await t.owner.query<{ merged_into: string | null }>('SELECT merged_into FROM persons WHERE project_id = $1 AND person_id = $2', [p.project_id, personId])).rows[0]?.merged_into;

describe('POST /v1/identify', () => {
  it('identify(anon, unknown user) renames: the user id joins the anonymous person, merged: false', async () => {
    const p = await t.createProject();
    await ingest(p, 'anon-9', 'signup', 's');
    const res = await identify(p, 'anon-9', 'user-9').expect(200);
    expect(res.body).toEqual({ person_id: await personOf(p, 'anon-9'), merged: false, distinct_ids_moved: 0 });
    expect(await personOf(p, 'user-9')).toBe(await personOf(p, 'anon-9'));
    expect(await merges(p)).toEqual([]);
  });

  it('identify(anon, user) with both known repoints the smaller person, records the moved ids, and points the merged person at its survivor', async () => {
    const p = await t.createProject();
    await ingest(p, 'anon-9', 'signup', 's');
    await ingest(p, 'user-9', 'create_project', 'c');
    await identify(p, 'anon-9', 'device-2').expect(200);
    const anonPerson = await personOf(p, 'anon-9');
    const userPerson = await personOf(p, 'user-9');
    expect(anonPerson).not.toBe(userPerson);

    const res = await identify(p, 'anon-9', 'user-9').expect(200);
    expect(res.body).toEqual({ person_id: anonPerson, merged: true, distinct_ids_moved: 1 });
    expect(await personOf(p, 'user-9')).toBe(anonPerson);
    expect(await merges(p)).toEqual([{ from_person: userPerson, into_person: anonPerson, distinct_ids_moved: ['user-9'], reason: expect.stringMatching(/^identify/) }]);
    expect(await mergedInto(p, userPerson as string)).toBe(anonPerson);
    expect(await mergedInto(p, anonPerson as string)).toBeNull();
    const persons = await t.owner.query('SELECT count(DISTINCT person_id)::int AS n FROM person_distinct_ids WHERE project_id = $1', [p.project_id]);
    expect(persons.rows[0].n).toBe(1);
    expect((await t.owner.query('SELECT count(*)::int AS n FROM persons WHERE project_id = $1', [p.project_id])).rows[0].n).toBe(2);
  });

  it('events split across anon and user now resolve to one person through the join (V10 prerequisite)', async () => {
    const p = await t.createProject();
    await ingest(p, 'anon-9', 'signup', 's');
    await ingest(p, 'user-9', 'create_project', 'c');
    await identify(p, 'anon-9', 'user-9').expect(200);
    const r = await t.owner.query(
      `SELECT count(DISTINCT pdi.person_id)::int AS persons, count(*)::int AS events
       FROM events e JOIN person_distinct_ids pdi ON pdi.project_id = e.project_id AND pdi.distinct_id = e.distinct_id
       WHERE e.project_id = $1`,
      [p.project_id],
    );
    expect(r.rows[0]).toEqual({ persons: 1, events: 2 });
  });

  it('identifying the same pair twice is a no-op: merged false, no second merge row', async () => {
    const p = await t.createProject();
    await ingest(p, 'a', 'signup', 's');
    await ingest(p, 'b', 'signup', 's2');
    await identify(p, 'a', 'b').expect(200);
    const again = await identify(p, 'a', 'b').expect(200);
    expect(again.body).toMatchObject({ merged: false, distinct_ids_moved: 0 });
    expect(await merges(p)).toHaveLength(1);
  });

  it('identify with two unknown ids creates one person holding both', async () => {
    const p = await t.createProject();
    const res = await identify(p, 'fresh-anon', 'fresh-user').expect(200);
    expect(res.body).toMatchObject({ merged: false, distinct_ids_moved: 0 });
    expect(await personOf(p, 'fresh-anon')).toBe(res.body.person_id);
    expect(await personOf(p, 'fresh-user')).toBe(res.body.person_id);
  });

  it('identify(unknown anon, known user) attaches the anonymous id to the user’s person', async () => {
    const p = await t.createProject();
    await ingest(p, 'user-1', 'signup', 's');
    const res = await identify(p, 'anon-new', 'user-1').expect(200);
    expect(res.body).toMatchObject({ person_id: await personOf(p, 'user-1'), merged: false });
    expect(await personOf(p, 'anon-new')).toBe(await personOf(p, 'user-1'));
  });

  it('identify(x, x) is a no-op that creates the person if needed', async () => {
    const p = await t.createProject();
    const res = await identify(p, 'same', 'same').expect(200);
    expect(res.body).toMatchObject({ merged: false, distinct_ids_moved: 0 });
    expect(await personOf(p, 'same')).toBe(res.body.person_id);
    const again = await identify(p, 'same', 'same').expect(200);
    expect(again.body.person_id).toBe(res.body.person_id);
  });

  it('concurrent identify(a,b) and identify(b,a) produce exactly one merge and no deadlock', async () => {
    const p = await t.createProject();
    await ingest(p, 'a', 'signup', 's');
    await ingest(p, 'b', 'signup', 's2');
    const [ab, ba] = await Promise.all([identify(p, 'a', 'b'), identify(p, 'b', 'a')]);
    expect([ab.status, ba.status]).toEqual([200, 200]);
    expect([ab.body.merged, ba.body.merged].filter(Boolean)).toHaveLength(1);
    expect(await merges(p)).toHaveLength(1);
    expect(await personOf(p, 'a')).toBe(await personOf(p, 'b'));
  });

  it('a failure between the repoint and the person_merges insert rolls back all three writes (single transaction)', async () => {
    const p = await t.createProject();
    await ingest(p, 'a', 'signup', 's');
    await ingest(p, 'b', 'signup', 's2');
    const before = { a: await personOf(p, 'a'), b: await personOf(p, 'b') };
    await t.owner.query('REVOKE INSERT ON person_merges FROM vantage_app');
    try {
      const res = await identify(p, 'a', 'b');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ code: 'INTERNAL', message: 'internal error' });
      expect({ a: await personOf(p, 'a'), b: await personOf(p, 'b') }).toEqual(before);
      expect(await merges(p)).toEqual([]);
      expect(await mergedInto(p, before.a as string)).toBeNull();
      expect(await mergedInto(p, before.b as string)).toBeNull();
    } finally {
      await t.owner.query('GRANT INSERT ON person_merges TO vantage_app');
    }
    const after = await identify(p, 'a', 'b').expect(200);
    expect(after.body.merged).toBe(true);
  });

  it('rejects an identify body outside the contract with 422', async () => {
    const res = await identify(await t.createProject(), '', 'u').expect(422);
    expect(res.body).toMatchObject({ code: 'INVALID_BODY', path: 'anonymous_id' });
  });

  it('requires the project API key', async () => {
    await t.http.post('/v1/identify').send({ anonymous_id: 'a', user_id: 'b' }).expect(401);
  });
});

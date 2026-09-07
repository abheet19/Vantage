/**
 * admin-token.spec.ts — the env-flagged shared-bearer gate on the project-ADMIN WRITE routes
 * (VANTAGE_ADMIN_TOKEN).
 *
 * Proves the contract: unset ⇒ `POST /v1/projects` (create) and `POST /v1/projects/:id/rotate-key` are
 * open (today's behaviour ⟨D4⟩); set ⇒ each is 401 without a header, 401 with the wrong token, and 200/201
 * with the correct one, in the standard `{ code, message }` shape (`INVALID_ADMIN_TOKEN`). Ingest keeps its
 * own per-project key regardless of the admin token, and the READ routes (funnel/count/ask/asks/catalog and
 * the GET /v1/projects list) stay open regardless of it — the admin gate protects only project-admin
 * writes, independent of both the read token and the per-project ingest key.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminBearer, bearer, createTestApp, queryBearer, type TestApp, type TestProject } from '../helpers/app.js';

const TOKEN = 'a-real-32-char-shared-admin-tokn';
const WRONG = 'a-wrong-32-char-shared-admin-tok';

const AUGUST = { from: '2026-08-01', to: '2026-08-31' };
const countBody = (project: string) => ({ kind: 'count', project, range: AUGUST, event: { event: 'signup' } });

/** A couple of events so an open read route has data to answer over. */
async function seed(t: TestApp, p: TestProject): Promise<void> {
  await t.http
    .post('/v1/events')
    .set(bearer(p))
    .send({ events: [{ event: 'signup', distinct_id: 'a1', timestamp: '2026-08-05T10:00:00Z', insert_id: 'adm-1' }] })
    .expect(200);
}

describe('VANTAGE_ADMIN_TOKEN unset ⇒ the project-admin write routes are open (today’s behaviour ⟨D4⟩)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('POST /v1/projects (create) answers 201 with no Authorization', async () => {
    await t.http.post('/v1/projects').send({ name: 'open-create', timezone: 'UTC' }).expect(201);
  });

  it('POST /v1/projects/:id/rotate-key answers 200 with no Authorization', async () => {
    const created = await t.createProject('open-rotate', 'UTC');
    await t.http.post(`/v1/projects/${created.project_id}/rotate-key`).send().expect(200);
  });
});

describe('VANTAGE_ADMIN_TOKEN set ⇒ create and rotate-key require it as a Bearer', () => {
  let t: TestApp;
  let p: TestProject;
  beforeAll(async () => {
    t = await createTestApp({ adminToken: TOKEN });
    // createProject sends the admin bearer (the helper knows the token), so setup itself proves 201-with-token.
    p = await t.createProject('gated', 'UTC');
    await seed(t, p);
  });
  afterAll(async () => {
    await t.close();
  });

  it('POST /v1/projects: 401 without a header, 401 with the wrong token, 201 with the correct one', async () => {
    const noHeader = await t.http.post('/v1/projects').send({ name: 'x', timezone: 'UTC' });
    expect(noHeader.status).toBe(401);
    expect(noHeader.body).toMatchObject({ code: 'INVALID_ADMIN_TOKEN' });
    expect(typeof noHeader.body.message).toBe('string');

    await t.http.post('/v1/projects').set(adminBearer(WRONG)).send({ name: 'x', timezone: 'UTC' }).expect(401);

    const ok = await t.http.post('/v1/projects').set(adminBearer(TOKEN)).send({ name: 'ok', timezone: 'UTC' }).expect(201);
    expect(ok.body.api_key).toMatch(/^vk_[A-Za-z0-9_-]{32}$/);
  });

  it('POST /v1/projects/:id/rotate-key: 401 without a header, 401 with the wrong token, 200 with the correct one', async () => {
    const noHeader = await t.http.post(`/v1/projects/${p.project_id}/rotate-key`).send();
    expect(noHeader.status).toBe(401);
    expect(noHeader.body).toMatchObject({ code: 'INVALID_ADMIN_TOKEN' });

    await t.http.post(`/v1/projects/${p.project_id}/rotate-key`).set(adminBearer(WRONG)).send().expect(401);

    const ok = await t.http.post(`/v1/projects/${p.project_id}/rotate-key`).set(adminBearer(TOKEN)).send().expect(200);
    expect(ok.body.api_key).toMatch(/^vk_[A-Za-z0-9_-]{32}$/);
    expect(ok.body.api_key).not.toBe(p.api_key);
  });

  it('the three mechanisms are independent: a project ingest key is not an admin token, and the admin token is not a project key', async () => {
    // A valid project ingest key on the create route is the WRONG credential ⇒ 401 INVALID_ADMIN_TOKEN.
    const asProjectKey = await t.http.post('/v1/projects').set(bearer(p)).send({ name: 'x', timezone: 'UTC' });
    expect(asProjectKey.status).toBe(401);
    expect(asProjectKey.body).toMatchObject({ code: 'INVALID_ADMIN_TOKEN' });
    // The shared admin token is not a project key ⇒ ingest refuses it with its own error.
    const asAdminToken = await t.http.post('/v1/events').set(adminBearer(TOKEN)).send({ events: [] });
    expect(asAdminToken.status).toBe(401);
    expect(asAdminToken.body).toMatchObject({ code: 'INVALID_API_KEY' });
  });

  it('ingest still authenticates on its own per-project key while the admin gate is on', async () => {
    // A fresh project (the shared `p` above has had its key rotated by the rotate-key test).
    const q = await t.createProject('ingest-while-gated', 'UTC');
    const ev = { events: [{ event: 'signup', distinct_id: 'a2', timestamp: '2026-08-08T10:00:00Z', insert_id: 'adm-2' }] };
    await t.http.post('/v1/events').send(ev).expect(401); // no key ⇒ ingest's own 401
    await t.http.post('/v1/events').set(bearer(q)).send(ev).expect(200); // project key ⇒ 200
  });

  it('the READ routes stay open regardless of VANTAGE_ADMIN_TOKEN (the admin gate protects only project-admin writes)', async () => {
    // The analytics read surface answers with no Authorization at all, admin token set or not.
    await t.http.post('/v1/count').send(countBody(p.project_id)).expect(200);
    await t.http.post('/v1/ask').send({ project: p.project_id, question: 'how many signed up in August' }).expect(200);
    await t.http.get('/v1/asks').query({ project: p.project_id }).expect(200);
    await t.http.get('/v1/events/catalog').query({ project: p.project_id }).expect(200);
    // GET /v1/projects (list) exposes only ids/names for the dashboard — deliberately NOT gated.
    const list = await t.http.get('/v1/projects').expect(200);
    expect(JSON.stringify(list.body)).not.toMatch(/api_key/);
    // A query token is neither required nor accepted here — the read gate is a separate mechanism (off in this app).
    await t.http.post('/v1/count').set(queryBearer(TOKEN)).send(countBody(p.project_id)).expect(200);
    // /health is never gated.
    const health = await t.http.get('/health');
    expect(health.status).not.toBe(401);
  });
});

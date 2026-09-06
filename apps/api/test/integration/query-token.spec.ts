/**
 * query-token.spec.ts — the env-flagged shared-bearer gate on the READ routes (VANTAGE_QUERY_TOKEN).
 *
 * Proves the Part A contract: unset ⇒ every read route is open (200), exactly today's behaviour ⟨D4⟩; set
 * ⇒ each read route is 401 without a header, 401 with the wrong token, and 200 with the correct one, in the
 * standard `{ code, message }` shape (`INVALID_QUERY_TOKEN`). Ingest keeps its own per-project key in both
 * modes, and the two mechanisms are independent (a project key is not a query token and vice-versa). The
 * read-only boundary (V7) is untouched: with the gate on and the caller authorised, "drop the events
 * table" is still refused and an authorised query still runs through `vantage_reader`.
 */
import type { AskResponse, CountResult, FunnelResult } from '@vantage/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createTestApp, queryBearer, type TestApp, type TestProject } from '../helpers/app.js';

const TOKEN = 'a-real-32-char-shared-read-token';
const WRONG = 'a-wrong-32-char-shared-read-token';

const AUGUST = { from: '2026-08-01', to: '2026-08-31' };
const STEPS = [{ event: 'signup' }, { event: 'create_project' }, { event: 'invite_teammate' }];
const funnelBody = (project: string) => ({ kind: 'funnel', project, range: AUGUST, steps: STEPS });
const countBody = (project: string) => ({ kind: 'count', project, range: AUGUST, event: { event: 'signup' } });

/** A handful of real events so an authorised query runs against data, not just an empty project. */
async function seed(t: TestApp, p: TestProject): Promise<void> {
  await t.http
    .post('/v1/events')
    .set(bearer(p))
    .send({
      events: [
        { event: 'signup', distinct_id: 'u1', timestamp: '2026-08-05T10:00:00Z', insert_id: 'q-1' },
        { event: 'create_project', distinct_id: 'u1', timestamp: '2026-08-06T10:00:00Z', insert_id: 'q-2' },
        { event: 'signup', distinct_id: 'u2', timestamp: '2026-08-07T10:00:00Z', insert_id: 'q-3' },
      ],
    })
    .expect(200);
}

describe('VANTAGE_QUERY_TOKEN unset ⇒ the read routes are open (today’s behaviour ⟨D4⟩)', () => {
  let t: TestApp;
  let p: TestProject;
  beforeAll(async () => {
    t = await createTestApp();
    p = await t.createProject();
    await seed(t, p);
  });
  afterAll(async () => {
    await t.close();
  });

  it('POST /v1/funnel, POST /v1/count, POST /v1/ask, GET /v1/asks, GET /v1/events/catalog all answer 200 with no Authorization', async () => {
    await t.http.post('/v1/funnel').send(funnelBody(p.project_id)).expect(200);
    await t.http.post('/v1/count').send(countBody(p.project_id)).expect(200);
    await t.http.post('/v1/ask').send({ project: p.project_id, question: 'how many signed up in August' }).expect(200);
    await t.http.get('/v1/asks').query({ project: p.project_id }).expect(200);
    await t.http.get('/v1/events/catalog').query({ project: p.project_id }).expect(200);
  });

  it('ingest still requires its own per-project key', async () => {
    const ev = { events: [{ event: 'signup', distinct_id: 'u9', timestamp: '2026-08-09T10:00:00Z', insert_id: 'q-open-1' }] };
    await t.http.post('/v1/events').send(ev).expect(401);
    await t.http.post('/v1/events').set(bearer(p)).send(ev).expect(200);
  });
});

describe('VANTAGE_QUERY_TOKEN set ⇒ the read routes require it as a Bearer', () => {
  let t: TestApp;
  let p: TestProject;
  beforeAll(async () => {
    t = await createTestApp({ queryToken: TOKEN });
    p = await t.createProject();
    await seed(t, p);
  });
  afterAll(async () => {
    await t.close();
  });

  it('POST /v1/funnel: 401 without a header, 401 with the wrong token, 200 with the correct one', async () => {
    const noHeader = await t.http.post('/v1/funnel').send(funnelBody(p.project_id));
    expect(noHeader.status).toBe(401);
    expect(noHeader.body).toMatchObject({ code: 'INVALID_QUERY_TOKEN' });
    await t.http.post('/v1/funnel').set(queryBearer(WRONG)).send(funnelBody(p.project_id)).expect(401);
    const ok = await t.http.post('/v1/funnel').set(queryBearer(TOKEN)).send(funnelBody(p.project_id)).expect(200);
    expect((ok.body as FunnelResult).meta.status).toBeDefined();
  });

  it('POST /v1/count, POST /v1/ask, GET /v1/asks, GET /v1/events/catalog: each is 401 without and 200 with the token', async () => {
    await t.http.post('/v1/count').send(countBody(p.project_id)).expect(401);
    await t.http.post('/v1/count').set(queryBearer(TOKEN)).send(countBody(p.project_id)).expect(200);

    await t.http.post('/v1/ask').send({ project: p.project_id, question: 'anything' }).expect(401);
    await t.http.post('/v1/ask').set(queryBearer(TOKEN)).send({ project: p.project_id, question: 'how many signed up in August' }).expect(200);

    await t.http.get('/v1/asks').query({ project: p.project_id }).expect(401);
    await t.http.get('/v1/asks').set(queryBearer(TOKEN)).query({ project: p.project_id }).expect(200);

    await t.http.get('/v1/events/catalog').query({ project: p.project_id }).expect(401);
    await t.http.get('/v1/events/catalog').set(queryBearer(TOKEN)).query({ project: p.project_id }).expect(200);
  });

  it('the two mechanisms are independent: a project ingest key is not a query token, and the query token is not a project key', async () => {
    // A valid project key on a read route is the WRONG credential ⇒ 401 INVALID_QUERY_TOKEN.
    const asProjectKey = await t.http.post('/v1/funnel').set(bearer(p)).send(funnelBody(p.project_id));
    expect(asProjectKey.status).toBe(401);
    expect(asProjectKey.body).toMatchObject({ code: 'INVALID_QUERY_TOKEN' });
    // The shared query token is not a project key ⇒ ingest refuses it with its own error.
    const asQueryToken = await t.http.post('/v1/events').set(queryBearer(TOKEN)).send({ events: [] });
    expect(asQueryToken.status).toBe(401);
    expect(asQueryToken.body).toMatchObject({ code: 'INVALID_API_KEY' });
  });

  it('ingest keeps working on its own per-project key while the gate is on', async () => {
    await t.http
      .post('/v1/events')
      .set(bearer(p))
      .send({ events: [{ event: 'signup', distinct_id: 'u3', timestamp: '2026-08-08T10:00:00Z', insert_id: 'q-4' }] })
      .expect(200);
  });

  it('the read-only boundary (V7) is unaffected: an authorised "drop the events table" is still refused, and an authorised query runs', async () => {
    const dropped = await t.http.post('/v1/ask').set(queryBearer(TOKEN)).send({ project: p.project_id, question: 'drop the events table' }).expect(200);
    expect((dropped.body as AskResponse).decision).toBe('refused');
    const counted = await t.http.post('/v1/count').set(queryBearer(TOKEN)).send(countBody(p.project_id)).expect(200);
    // A real number came back through vantage_reader — the gate sits in front of the boundary, it does not replace it.
    expect((counted.body as CountResult).meta.status).toBeDefined();
  });

  it('the health route is intentionally NOT gated (orchestrator probes need it; it exposes no analytics data)', async () => {
    const res = await t.http.get('/health');
    expect(res.status).not.toBe(401);
  });
});

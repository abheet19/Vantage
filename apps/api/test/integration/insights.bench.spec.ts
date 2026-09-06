/**
 * insights.bench.spec.ts — LLD §7.4 in miniature: a generated 200 000-event / 10 000-person project and the S2 queries
 * over a 366-day range, each of which must finish inside the reader's 5 s statement_timeout. The retention grid is the
 * query this file exists for: its first shape was O(members × periods × return buckets) and timed out at 2 M events
 * (S2 hardening, finding 1). Wall times are PRINTED, never asserted to a number — the assertion is "did not time out".
 *
 * The rows are generated in SQL as the owner (not through ingest: 400 HTTP batches would test the ingest path's
 * throughput, not the query path's cost) from a seeded `random()`, so every run shapes the same dataset.
 */
import type { FunnelResult, RetentionResult } from '@vantage/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp, type TestProject } from '../helpers/app.js';

const PERSONS = 10_000;
const EVENTS = 200_000;
/** `random()` seeded per session, so the events' persons, names and properties are the same on every run. */
const SEED = 0.20260905;
const RANGE = { from: '2025-09-01', to: '2026-08-31' };
const STEPS = [{ event: 'signup' }, { event: 'create_project' }, { event: 'invite_teammate' }];

let t: TestApp;
let project: TestProject;

/** 400 days of events from 2025-09-01: signup is the commonest name (`random() * random()` skews low), as the demo's shapes do. */
async function generate(p: TestProject): Promise<void> {
  const owner = await t.owner.connect();
  try {
    await owner.query('SELECT setseed($1)', [SEED]);
    await owner.query(
      `INSERT INTO persons (project_id, person_id)
       SELECT $1, ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid FROM generate_series(1, $2) g`,
      [p.project_id, PERSONS],
    );
    await owner.query(
      `INSERT INTO person_distinct_ids (project_id, distinct_id, person_id)
       SELECT $1, 'u' || g, ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid FROM generate_series(1, $2) g`,
      [p.project_id, PERSONS],
    );
    await owner.query(
      `INSERT INTO events (project_id, event_id, insert_id, distinct_id, event, properties, client_ts, sent_at, server_ts, event_ts, ts_source, key_source)
       SELECT $1,
              (lpad(to_hex((extract(epoch FROM ts) * 1000)::bigint), 12, '0') || '7' || substr(md5(g::text), 1, 3) || '8' || substr(md5(g::text), 4, 15))::uuid,
              'bench-' || g,
              'u' || (1 + floor(random() * $2))::int,
              (ARRAY['signup', 'create_project', 'invite_teammate', 'view_pricing', 'page_view'])[1 + floor(random() * random() * 5)::int],
              jsonb_build_object('plan', (ARRAY['free', 'team', 'enterprise'])[1 + floor(random() * 3)::int], 'n', (random() * 1000)::int),
              ts, ts, ts, ts, 'client', 'client'
       FROM (SELECT g, timestamptz '2025-09-01' + (g::float8 / $3) * interval '400 days' AS ts FROM generate_series(1, $3) g) s`,
      [p.project_id, PERSONS, EVENTS],
    );
    await owner.query('ANALYZE events');
    await owner.query('ANALYZE person_distinct_ids');
  } finally {
    owner.release();
  }
}

beforeAll(async () => {
  t = await createTestApp();
  project = await t.createProject('bench 200k', 'Asia/Kolkata');
  const started = Date.now();
  await generate(project);
  console.log(`measured: generated ${EVENTS} events / ${PERSONS} persons in ${Date.now() - started} ms`);
}, 180_000);
afterAll(async () => {
  await t.close();
});

const finished = (status: string) => expect(['complete', 'truncated'], `status ${status}`).toContain(status);

describe(`bench: ${EVENTS} events, ${PERSONS} persons, a 366-day range — every S2 query finishes inside the 5 s statement_timeout`, () => {
  it.each(['on', 'on_or_after'])("retention by day, 30 periods, mode '%s'", async (mode) => {
    const r = (await t.http.post('/v1/retention').send({ kind: 'retention', project: project.project_id, range: RANGE, start: { event: 'signup' }, return: { event: 'view_pricing' }, periods: 30, mode }).expect(200)).body as RetentionResult;
    finished(r.meta.status);
    expect(r.meta.elapsed_ms).toBeLessThan(5_000);
    expect(r.cohorts?.every((c) => c.cells.length === 31)).toBe(true);
    console.log(`measured: retention day×30 '${mode}' over ${EVENTS} events elapsed_ms = ${r.meta.elapsed_ms}, ${r.cohorts?.length} cohorts, status ${r.meta.status}`);
  }, 60_000);

  it.each(['sequential', 'strict', 'any'])('3-step funnel, 14-day window, order %s', async (order) => {
    const r = (await t.http.post('/v1/funnel').send({ kind: 'funnel', project: project.project_id, range: RANGE, steps: STEPS, order }).expect(200)).body as FunnelResult;
    finished(r.meta.status);
    expect(r.meta.elapsed_ms).toBeLessThan(5_000);
    console.log(`measured: funnel ${order} over ${EVENTS} events elapsed_ms = ${r.meta.elapsed_ms}, steps ${JSON.stringify(r.steps?.map((s) => s.persons))}`);
  }, 60_000);
});

/**
 * seed.spec.ts — the honest proof that `npm run seed`'s dataset is deterministic, real, and idempotent.
 *
 * Why it exists: LLD §8 S7 and §9 S7 — the seed must reproduce the demo's shapes and, run twice, add zero
 * rows. This runs the SAME generator the CLI runs (`generateSeed`) at a reduced scale (a 5 000-event cap, so
 * the suite stays fast — the full 200 000 is never run in a test) and plays it through the REAL ingest
 * endpoints via `loadFixture`, then asserts the properties that matter: the funnel drops off monotonically
 * and non-trivially, retention has more than one day cohort, replaying the identical dataset into the same
 * project adds nothing (stable `insert_id`s), the out-of-clock device's rows are `client_shifted`, and the
 * late arrivals — ingested last — land in the first August buckets by their own timestamps.
 *
 * The clock is pinned to a fixed instant so the skew and the (absence of) too-old flags are deterministic;
 * it is after the dataset's newest event (2026-09-05) and within a year of its oldest, so nothing is clamped
 * or flagged too old.
 */
import type { FunnelResult, IdentifyResponse, RetentionResult } from '@vantage/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSeed, type SeedPlan } from '../../src/seed/generate.js';
import { type Fixture, type PlayResult, playFixture } from '../../src/fixture/play.js';
import { FixedClock } from '../../src/infra/clock.js';
import { bearer, createTestApp, type TestApp, type TestProject } from '../helpers/app.js';
import { loadFixture, type LoadResult, postBatch } from '../fixture/load.js';

/** After the dataset's newest event (2026-09-05) and less than a year after its oldest, so no clamp, no too-old. */
const SERVER_NOW = new Date('2026-09-06T00:00:00Z');
/** ~5 000 events keeps the play under a few seconds while still filling every cohort and the whole funnel. */
const REDUCED = 5_000;
const RANGE = { from: '2026-08-01', to: '2026-09-05' };

let t: TestApp;
let plan: SeedPlan;
let loaded: LoadResult;

/** Owner-pool count/query helpers, scoped to the loaded project (the app roles cannot read some of these columns freely). */
const q = async <T extends Record<string, unknown>>(sql: string, ...params: unknown[]) => (await t.owner.query<T>(sql, [loaded.project.project_id, ...params])).rows;
const count = async (sql: string, ...params: unknown[]) => Number((await q<{ n: number }>(sql, ...params))[0]?.n);

/** Plays a fixture into a given project with the clock pinned per step — used to replay the seed into the same project. */
async function play(project: TestProject, fixture: Fixture): Promise<PlayResult> {
  return playFixture(fixture, {
    batch: (step) => postBatch(t, project, step),
    identify: async (step) => {
      t.clock.set(new Date(step.server_ts));
      const res = await t.http.post('/v1/identify').set(bearer(project)).send({ anonymous_id: step.anonymous_id, user_id: step.user_id }).expect(200);
      return res.body as IdentifyResponse;
    },
  });
}

/** Row count for an arbitrary project (the beforeAll `count` helper is bound to the loaded project). */
const rowsIn = async (projectId: string) => Number((await t.owner.query<{ n: number }>('SELECT count(*)::int AS n FROM events WHERE project_id = $1', [projectId])).rows[0]?.n);

beforeAll(async () => {
  t = await createTestApp({ clock: new FixedClock(SERVER_NOW) });
  plan = generateSeed({ maxEvents: REDUCED, serverNow: SERVER_NOW });
  loaded = await loadFixture(t, { fixture: plan.fixture });
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe('the reduced-scale seed is real and non-trivial', () => {
  it('accepts every generated event exactly once — the generated insert_ids do not collide', () => {
    const accepted = loaded.batches.reduce((n, b) => n + b.response.accepted, 0);
    const duplicates = loaded.batches.reduce((n, b) => n + b.response.duplicates, 0);
    expect(accepted).toBe(loaded.submitted);
    expect(duplicates).toBe(0);
    expect(loaded.submitted).toBeGreaterThanOrEqual(REDUCED);
    expect(plan.events).toBe(loaded.submitted);
  });

  it('drives a funnel that drops off monotonically and reaches every step', async () => {
    const r = (await t.http.post('/v1/funnel').send({ kind: 'funnel', project: loaded.project.project_id, range: RANGE, steps: [{ event: 'signup' }, { event: 'create_project' }, { event: 'invite_teammate' }] }).expect(200)).body as FunnelResult;
    expect(r.meta.status).toBe('complete');
    const persons = (r.steps ?? []).map((s) => s.persons);
    expect(persons).toHaveLength(3);
    expect(persons[0]).toBeGreaterThan(persons[1] as number);
    expect(persons[1]).toBeGreaterThanOrEqual(persons[2] as number);
    expect(persons[2]).toBeGreaterThan(0);
  });

  it('produces retention with more than one day cohort', async () => {
    const r = (await t.http.post('/v1/retention').send({ kind: 'retention', project: loaded.project.project_id, range: { from: '2026-08-01', to: '2026-08-28' }, start: { event: 'signup' }, return: { event: 'view_pricing' }, unit: 'day', periods: 14 }).expect(200)).body as RetentionResult;
    expect(['complete', 'truncated']).toContain(r.meta.status);
    const cohorts = r.cohorts ?? [];
    expect(cohorts.length).toBeGreaterThan(1);
    expect(cohorts.some((c) => c.size > 0 && c.cells.some((cell) => cell.retained > 0))).toBe(true);
    expect(plan.cohortDays).toBeGreaterThan(1);
  });
});

describe('the out-of-clock device and the late arrivals are handled honestly', () => {
  it('shifts the skewed device’s events forward and stamps them client_shifted', async () => {
    const rows = await q<{ ts_source: string; n: number }>(`SELECT ts_source, count(*)::int AS n FROM events WHERE project_id = $1 AND distinct_id = 'skew-device' GROUP BY ts_source`);
    expect(rows).toEqual([{ ts_source: 'client_shifted', n: rows[0]?.n }]);
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it('buckets the late arrivals in the first two August days despite being ingested last', async () => {
    expect(plan.fixture.steps.at(-1)?.label).toContain('late arrivals');
    const days = await q<{ day: string }>(`SELECT DISTINCT to_char(event_ts AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS day FROM events WHERE project_id = $1 AND distinct_id = 'late-arrival' ORDER BY day`);
    expect(days.length).toBeGreaterThan(0);
    expect(days.every((d) => d.day === '2026-08-01' || d.day === '2026-08-02')).toBe(true);
  });
});

describe('running the seed twice adds zero rows (idempotent insert_ids, LLD §9 S7)', () => {
  it('reports every event as a duplicate on the second play and leaves the row count unchanged', async () => {
    const before = await count('SELECT count(*)::int AS n FROM events WHERE project_id = $1');
    const again = await play(loaded.project, plan.fixture);
    const accepted = again.batches.reduce((n, b) => n + b.response.accepted, 0);
    const duplicates = again.batches.reduce((n, b) => n + b.response.duplicates, 0);
    expect(accepted).toBe(0);
    expect(duplicates).toBe(again.submitted);
    expect(await count('SELECT count(*)::int AS n FROM events WHERE project_id = $1')).toBe(before);
  });

  it('an interrupted seed leaves no duplicate rows once it is re-run to completion', async () => {
    const project = await t.createProject('Demo interrupted', 'Asia/Kolkata');
    // Interrupt: only the first eight steps reach the database.
    const prefix: Fixture = { ...plan.fixture, steps: plan.fixture.steps.slice(0, 8) };
    const partial = await play(project, prefix);
    const partialAccepted = partial.batches.reduce((n, b) => n + b.response.accepted, 0);
    expect(await rowsIn(project.project_id)).toBe(partialAccepted);
    // Resume: the whole seed is re-run; the prefix dedupes, the remainder is accepted, nothing doubles.
    const full = await play(project, plan.fixture);
    const fullAccepted = full.batches.reduce((n, b) => n + b.response.accepted, 0);
    const fullDuplicates = full.batches.reduce((n, b) => n + b.response.duplicates, 0);
    expect(fullDuplicates).toBe(partialAccepted);
    expect(fullAccepted).toBe(plan.events - partialAccepted);
    expect(await rowsIn(project.project_id)).toBe(plan.events);
  });

  it('generates a byte-for-byte identical dataset from the same options', () => {
    const again = generateSeed({ maxEvents: REDUCED, serverNow: SERVER_NOW });
    expect(again.events).toBe(plan.events);
    expect(JSON.stringify(again.fixture)).toBe(JSON.stringify(plan.fixture));
  });

  it('keeps every event identical when the real clock has moved on, so a later re-run still dedupes', () => {
    const later = generateSeed({ maxEvents: REDUCED, serverNow: new Date('2026-11-20T08:30:00Z') });
    const events = (p: SeedPlan) => p.fixture.steps.flatMap((s) => (s.kind === 'batch' ? s.events : []));
    // The events — and so their insert_ids — do not depend on the clock; only the skewed batch's sent_at does.
    expect(events(later)).toEqual(events(plan));
  });
});

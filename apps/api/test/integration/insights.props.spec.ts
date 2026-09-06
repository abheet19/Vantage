/**
 * insights.props.spec.ts — V2, V3, V4 as properties: a random small dataset goes through the REAL ingest endpoint,
 * the compiled SQL runs through the REAL query endpoints, and the numbers must equal a naive TypeScript reference.
 * A disagreement fails with the shrunk dataset printed by fast-check. The generator produces events in the same
 * millisecond on purpose (S2 hardening): ties are ordered by arrival on both sides, so they must agree too.
 */
import { FunnelSpec, RetentionSpec, type FunnelResult, type IncomingEvent, type RetentionResult } from '@vantage/contracts';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bucketOf } from '../../src/domain/bucket.js';
import { FixedClock } from '../../src/infra/clock.js';
import { bearer, createTestApp, type TestApp } from '../helpers/app.js';
import { localMidnightUtc, referenceFunnel, referenceRetention, type RefEvent } from '../helpers/reference.js';

let t: TestApp;
beforeAll(async () => {
  // 2029: every generated instant (2026–2028, Feb 29 2028 included) is in the past for the clock rule, so client timestamps are kept verbatim.
  t = await createTestApp({ clock: new FixedClock(new Date('2029-01-01T00:00:00Z')) });
});
afterAll(async () => {
  await t.close();
});

/** Six zones: UTC, a half-hour offset, a DST zone, UTC+13, a US DST zone, and a zone whose DST shift is 30 minutes. */
const ZONES = ['UTC', 'Asia/Kolkata', 'Europe/London', 'Pacific/Apia', 'America/New_York', 'Australia/Lord_Howe'];
/** Anchors near the hard days: London DST start/end, Feb 29, Lord Howe DST end, a year boundary, and one dull day. */
const ANCHORS = ['2026-03-29T01:00:00Z', '2026-10-25T01:00:00Z', '2028-02-29T12:00:00Z', '2026-04-05T15:30:00Z', '2026-12-31T23:00:00Z', '2026-08-15T00:00:00Z'];
const EVENTS = ['signup', 'create_project', 'invite_teammate', 'view_pricing'];
const DAY_S = 86_400;

/** Offsets at one-second resolution, or on whole hours so that two events of one person often share an instant. */
const arbOffsetS = fc.oneof(fc.integer({ min: -40 * DAY_S, max: 40 * DAY_S }), fc.integer({ min: -40, max: 40 }).map((h) => h * 3600));

const arbPersonEvents = fc.array(fc.record({ event: fc.constantFrom(...EVENTS), offsetS: arbOffsetS, plan: fc.option(fc.constantFrom('free', 'team'), { nil: undefined }) }), { maxLength: 30 });

interface Dataset {
  tz: string;
  range: { from: string; to: string };
  events: RefEvent[];
}

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const arbDataset: fc.Arbitrary<Dataset> = fc
  .record({
    tz: fc.constantFrom(...ZONES),
    anchor: fc.constantFrom(...ANCHORS),
    persons: fc.array(arbPersonEvents, { minLength: 5, maxLength: 20 }),
    before: fc.integer({ min: 0, max: 50 }),
    after: fc.integer({ min: 0, max: 50 }),
  })
  .map(({ tz, anchor, persons, before, after }) => {
    const base = Date.parse(anchor);
    const events: RefEvent[] = [];
    persons.forEach((evs, i) => {
      for (const e of evs) {
        events.push({ person: `p${i}`, event: e.event, ts: base + e.offsetS * 1000, seq: events.length, properties: e.plan === undefined ? {} : { plan: e.plan } });
      }
    });
    return { tz, range: { from: isoDate(base - before * DAY_S * 1000), to: isoDate(base + after * DAY_S * 1000) }, events };
  });

const arbWhere = fc.constantFrom<unknown[]>(
  [],
  [],
  [{ key: 'plan', op: 'eq', value: 'team' }],
  [{ key: 'plan', op: 'is_set' }],
  [{ key: 'plan', op: 'neq', value: 'free' }],
  [{ key: 'plan', op: 'in', value: ['free', 'team'] }],
  [{ key: 'plan', op: 'not_in', value: ['team'] }],
  [{ key: 'plan', op: 'is_not_set' }],
);
const arbStep = fc.record({ event: fc.constantFrom(...EVENTS), where: arbWhere });
const funnelShape = {
  steps: fc.array(arbStep, { minLength: 2, maxLength: 4 }),
  window: fc.record({ value: fc.integer({ min: 1, max: 20 }), unit: fc.constantFrom('minutes', 'hours', 'days') }),
  where: arbWhere,
};
const arbFunnelShape = fc.record(funnelShape);
const arbFunnel = fc.record({ ...funnelShape, order: fc.constantFrom('sequential', 'strict', 'any') });
const arbRetention = fc.record({
  start: arbStep,
  return: fc.option(arbStep, { nil: undefined }),
  unit: fc.constantFrom('day', 'week', 'month'),
  periods: fc.integer({ min: 1, max: 8 }),
  mode: fc.constantFrom('on', 'on_or_after'),
});

/** Posted in dataset order, so `seq` is arrival order and `event_id` orders ties the same way. */
async function ingest(ds: Dataset): Promise<string> {
  const project = await t.createProject('props', ds.tz);
  const events: IncomingEvent[] = ds.events.map((e, i) => ({
    event: e.event,
    distinct_id: e.person,
    timestamp: new Date(e.ts).toISOString(),
    insert_id: `e${i}`,
    ...(Object.keys(e.properties).length > 0 ? { properties: e.properties as IncomingEvent['properties'] } : {}),
  }));
  for (let i = 0; i < events.length; i += 500) {
    await t.http.post('/v1/events').set(bearer(project)).send({ events: events.slice(i, i + 500) }).expect(200);
  }
  return project.project_id;
}

const stepCounts = async (spec: FunnelSpec): Promise<number[]> => {
  const res = (await t.http.post('/v1/funnel').send(spec).expect(200)).body as FunnelResult;
  return res.steps?.map((s) => s.persons) ?? spec.steps.map(() => 0);
};

describe('V2 + V3: funnels agree with the naive reference on random datasets, in every order and window', () => {
  it('step counts and the median time to convert are identical; counts are monotone', async () => {
    await fc.assert(
      fc.asyncProperty(arbDataset, fc.array(arbFunnel, { minLength: 1, maxLength: 3 }), async (ds, funnels) => {
        const project = await ingest(ds);
        for (const f of funnels) {
          const spec = FunnelSpec.parse({ kind: 'funnel', project, range: ds.range, ...f });
          const res = (await t.http.post('/v1/funnel').send(spec).expect(200)).body as FunnelResult;
          const ref = referenceFunnel(ds.events, spec, ds.tz);
          const counts = res.steps?.map((s) => s.persons) ?? spec.steps.map(() => 0);
          expect(counts, `funnel ${JSON.stringify(f)} in ${ds.tz}`).toEqual(ref.steps);
          for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1] as number);
          if (ref.medianS === null) expect(res.median_time_to_convert_s).toBeNull();
          else expect(res.median_time_to_convert_s).toBeCloseTo(ref.medianS, 6);
          expect(res.meta.status).toBe(ref.steps[0] === 0 ? 'empty' : 'complete');
        }
      }),
      { numRuns: 25 },
    );
  }, 240_000);

  it('the three orders nest: strict ≤ sequential ≤ any at every step, for every dataset and window', async () => {
    await fc.assert(
      fc.asyncProperty(arbDataset, arbFunnelShape, async (ds, shape) => {
        const project = await ingest(ds);
        const spec = (order: string) => FunnelSpec.parse({ kind: 'funnel', project, range: ds.range, ...shape, order });
        const [strict, sequential, any] = await Promise.all([stepCounts(spec('strict')), stepCounts(spec('sequential')), stepCounts(spec('any'))]);
        for (let i = 0; i < shape.steps.length; i++) {
          expect(strict[i], `strict ≤ sequential at step ${i + 1} for ${JSON.stringify(shape)}`).toBeLessThanOrEqual(sequential[i] as number);
          expect(sequential[i], `sequential ≤ any at step ${i + 1} for ${JSON.stringify(shape)}`).toBeLessThanOrEqual(any[i] as number);
        }
      }),
      { numRuns: 20 },
    );
  }, 240_000);
});

describe('V4: retention agrees with the naive reference; every person is in exactly one cohort inside the range', () => {
  it('cohort sizes and retained counts are identical for day, week and month units in both modes', async () => {
    await fc.assert(
      fc.asyncProperty(arbDataset, fc.array(arbRetention, { minLength: 1, maxLength: 2 }), async (ds, retentions) => {
        const project = await ingest(ds);
        const start = localMidnightUtc(ds.range.from, ds.tz);
        const lastInstant = localMidnightUtc(ds.range.to, ds.tz) + DAY_S * 1000 - 1;
        for (const r of retentions) {
          const spec = RetentionSpec.parse({ kind: 'retention', project, range: ds.range, ...r });
          const res = (await t.http.post('/v1/retention').send(spec).expect(200)).body as RetentionResult;
          const ref = referenceRetention(ds.events, spec, ds.tz);
          const got = new Map((res.cohorts ?? []).map((c) => [c.bucket, { size: c.size, retained: c.cells.map((x) => x.retained) }]));
          expect(Object.fromEntries(got), `retention ${JSON.stringify(r)} in ${ds.tz}`).toEqual(Object.fromEntries(ref));
          const buckets = (res.cohorts ?? []).map((c) => c.bucket);
          expect(buckets, 'cohorts arrive oldest first').toEqual([...buckets].sort());
          for (const c of res.cohorts ?? []) {
            expect(c.bucket >= bucketOf(new Date(start), ds.tz, spec.unit)).toBe(true);
            expect(c.bucket <= bucketOf(new Date(lastInstant), ds.tz, spec.unit)).toBe(true);
            expect(c.cells).toHaveLength(spec.periods + 1);
            for (const cell of c.cells) expect(cell.retained).toBeLessThanOrEqual(c.size);
          }
          const startersInRange = new Set(ds.events.filter((e) => e.event === spec.start.event && e.ts >= start && e.ts <= lastInstant).map((e) => e.person)).size;
          if (spec.start.where.length === 0 && spec.where.length === 0) expect((res.cohorts ?? []).reduce((n, c) => n + c.size, 0)).toBe(startersInRange);
        }
      }),
      { numRuns: 25 },
    );
  }, 240_000);
});

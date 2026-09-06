/**
 * insights-service.spec.ts — the service around the runner, without a database: the timezone lookup runs through
 * `QueryRunner.readOnly` (one bounded transaction, the runner's admission rule), a caller's hint skips it, a saturated
 * pool or a stopped lookup is a 503 the client can act on, any other failure propagates as itself, and every kind
 * dispatches to its compiler or is refused by name. The integration counterpart (`insights.spec` "a caller arriving
 * while the pool is saturated…") proves the timing against a real pool; this file pins the branches a real pool cannot
 * be made to take on demand.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { QUERY_LIMITS, type QuerySpec } from '@vantage/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Compiled } from '../../src/domain/compile/index.js';
import { BusyError, QueryRunner, type ReadQuery, type RunOutcome } from '../../src/infra/query-runner.js';
import { InsightsService } from '../../src/modules/insights/insights.service.js';
import { PROJECT_ID } from '../helpers/arbitraries.js';

const meta = (status: RunOutcome<unknown>['meta']['status']) => ({ status, computed_at: '2026-09-05T00:00:00.000Z', data_until: null, elapsed_ms: 1, incomplete_buckets: 0, ts_adjusted_share: 0, persons_merged_since: 0, timezone: 'Asia/Kolkata', row_cap: QUERY_LIMITS.rowCap });

interface FakeRunner {
  runner: QueryRunner;
  seen: Compiled[];
  readOnly: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
}

/** A runner whose `readOnly` answers the timezone lookup with `rows` (or throws `lookupFails`) and whose `run` records the compiled statement and answers `empty` (or throws `runFails`). */
function fakeRunner(over: { rows?: unknown[]; lookupFails?: Error; runFails?: Error } = {}): FakeRunner {
  const seen: Compiled[] = [];
  const query = vi.fn(async () => ({ rows: over.rows ?? [{ timezone: 'Asia/Kolkata' }] }));
  const readOnly = vi.fn(async (fn: (q: ReadQuery) => Promise<unknown>) => {
    if (over.lookupFails) throw over.lookupFails;
    return fn(query as unknown as ReadQuery);
  });
  const run = vi.fn(async (c: Compiled) => {
    seen.push(c);
    if (over.runFails) throw over.runFails;
    return { value: null, meta: meta('empty') };
  });
  return { runner: { run, readOnly } as unknown as QueryRunner, seen, readOnly, query };
}

const range = { from: '2026-08-01', to: '2026-08-31' };
const count: QuerySpec = { kind: 'count', project: PROJECT_ID, range, event: { event: 'signup', where: [] }, where: [] };
const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

describe('InsightsService: the timezone lookup runs inside the runner', () => {
  it('reads the timezone through readOnly and hands the runner a statement compiled against it', async () => {
    const r = fakeRunner();
    const result = await new InsightsService(r.runner).count(count);
    expect(r.readOnly).toHaveBeenCalledTimes(1);
    expect(r.query).toHaveBeenCalledWith('SELECT timezone FROM projects WHERE project_id = $1', [PROJECT_ID]);
    expect(r.seen[0]?.ctx).toEqual({ projectId: PROJECT_ID, timezone: 'Asia/Kolkata', rowCap: QUERY_LIMITS.rowCap });
    expect(result).toMatchObject({ persons: null, events: null, meta: { status: 'empty' } });
  });

  it('an unknown project compiles against UTC — an honest empty, never an error that confirms the id does not exist', async () => {
    const r = fakeRunner({ rows: [] });
    await new InsightsService(r.runner).count(count);
    expect(r.seen[0]?.ctx.timezone).toBe('UTC');
  });

  it('a caller that already knows the timezone passes it as a hint and the lookup does not run (the ask path reads it with the catalog)', async () => {
    const r = fakeRunner();
    await new InsightsService(r.runner).run(count, { timezone: 'Europe/London' });
    expect(r.readOnly).not.toHaveBeenCalled();
    expect(r.seen[0]?.ctx.timezone).toBe('Europe/London');
  });

  it('a BusyError from the lookup is 503 BUSY; a 57014 from the lookup is 503 TIMED_OUT', async () => {
    const busy = await new InsightsService(fakeRunner({ lookupFails: new BusyError('all busy') }).runner).count(count).catch((e: unknown) => e);
    expect(busy).toBeInstanceOf(ServiceUnavailableException);
    expect((busy as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'BUSY' });
    const timedOut = await new InsightsService(fakeRunner({ lookupFails: pgError('57014') }).runner).count(count).catch((e: unknown) => e);
    expect(timedOut).toBeInstanceOf(ServiceUnavailableException);
    expect((timedOut as ServiceUnavailableException).getResponse()).toMatchObject({ code: 'TIMED_OUT', message: expect.stringContaining('5s') });
  });

  it('any other failure of the lookup is a fault and propagates as itself', async () => {
    const down = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    await expect(new InsightsService(fakeRunner({ lookupFails: down }).runner).count(count)).rejects.toBe(down);
  });

  it('a BusyError from the runner is the same 503; other runner errors propagate', async () => {
    await expect(new InsightsService(fakeRunner({ runFails: new BusyError('all busy') }).runner).count(count)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const bad = new Error('boom');
    await expect(new InsightsService(fakeRunner({ runFails: bad }).runner).count(count)).rejects.toBe(bad);
  });
});

describe('InsightsService.run: dispatch by kind', () => {
  it('routes each of the five kinds to its compiler', async () => {
    const r = fakeRunner();
    const s = new InsightsService(r.runner);
    await s.run({ kind: 'funnel', project: PROJECT_ID, range, steps: [{ event: 'a', where: [] }, { event: 'b', where: [] }], order: 'sequential', window: { value: 14, unit: 'days' }, where: [] });
    await s.run({ kind: 'retention', project: PROJECT_ID, range, start: { event: 'a', where: [] }, unit: 'day', periods: 14, mode: 'on', where: [] });
    await s.run({ kind: 'trend', project: PROJECT_ID, range, event: { event: 'a', where: [] }, measure: 'events', unit: 'day', where: [] });
    await s.run({ kind: 'paths', project: PROJECT_ID, range, start: 'a', steps: 3, session_gap_minutes: 30, where: [] });
    await s.run(count);
    expect(r.seen.map((c) => c.kind)).toEqual(['funnel', 'retention', 'trend', 'paths', 'count']);
  });
});

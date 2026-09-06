/**
 * query-runner.spec.ts — the runner's guards without a database: only a Compiled runs (V7b), a saturated pool is BUSY
 * at once, a connect timeout is BUSY, a database that is down is not, and an unmapped pg error is a fault, not a status.
 */
import { CountSpec, QUERY_LIMITS } from '@vantage/contracts';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { compileCount, type Compiled } from '../../src/domain/compile/index.js';
import { FixedClock } from '../../src/infra/clock.js';
import { BusyError, QueryRunner, RO_QUEUE_MAX } from '../../src/infra/query-runner.js';
import { PROJECT_ID } from '../helpers/arbitraries.js';

const compiled = compileCount(
  CountSpec.parse({ kind: 'count', project: PROJECT_ID, range: { from: '2026-08-01', to: '2026-08-31' }, event: { event: 'signup' } }),
  { projectId: PROJECT_ID, timezone: 'UTC', rowCap: QUERY_LIMITS.rowCap },
);
const clock = new FixedClock(new Date('2026-09-05T00:00:00Z'));

interface FakePool {
  idleCount: number;
  totalCount: number;
  waitingCount: number;
  connect: ReturnType<typeof vi.fn>;
}

const pool = (over: Partial<FakePool> = {}): FakePool => ({ idleCount: 1, totalCount: 4, waitingCount: 0, connect: vi.fn(), ...over });
const runner = (p: FakePool) => new QueryRunner(p as unknown as pg.Pool, clock);

describe('QueryRunner guards', () => {
  it('V7(b): refuses a statement that did not come from compile(), before touching the pool', async () => {
    const p = pool();
    const forged = { sql: 'SELECT 1', params: [], kind: 'count', ctx: compiled.ctx, meta: compiled.meta } as unknown as Compiled;
    await expect(runner(p).run(forged, (rows) => rows)).rejects.toThrow(/not produced by compile\(\)/);
    expect(p.connect).not.toHaveBeenCalled();
  });

  it(`fails fast with BUSY when every connection is busy and ${RO_QUEUE_MAX} callers already wait`, async () => {
    const p = pool({ idleCount: 0, totalCount: 4, waitingCount: RO_QUEUE_MAX });
    await expect(runner(p).run(compiled, (rows) => rows)).rejects.toBeInstanceOf(BusyError);
    expect(p.connect).not.toHaveBeenCalled();
  });

  it('still queues when connections are busy but the queue has room', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    const p = pool({ idleCount: 0, totalCount: 4, waitingCount: RO_QUEUE_MAX - 1, connect: vi.fn(async () => client) });
    const out = await runner(p).run(compiled, (rows) => rows);
    expect(p.connect).toHaveBeenCalledTimes(1);
    expect(out.meta.status).toBe('empty');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('maps the pool’s connect timeout to BUSY, keeping the cause', async () => {
    const cause = new Error('timeout exceeded when trying to connect');
    const p = pool({ connect: vi.fn(async () => Promise.reject(cause)) });
    const err = await runner(p).run(compiled, (rows) => rows).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusyError);
    expect((err as BusyError).cause).toBe(cause);
  });

  it('does not call a database that is down "busy": other connect errors propagate as they are', async () => {
    const down = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const p = pool({ connect: vi.fn(async () => Promise.reject(down)) });
    await expect(runner(p).run(compiled, (rows) => rows)).rejects.toBe(down);
  });

  it('a pg error without a status of its own is a fault: rolled back, released, re-thrown', async () => {
    const bad = Object.assign(new Error('invalid input syntax'), { code: '22P02' });
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.startsWith('WITH') || sql.startsWith('SELECT count')) throw bad;
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const p = pool({ connect: vi.fn(async () => client) });
    await expect(runner(p).run(compiled, (rows) => rows)).rejects.toBe(bad);
    expect(queries[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(queries).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('a timed-out statement is a result with value null and no watermark, and the client is released', async () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.startsWith('SELECT count')) throw timeout;
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const p = pool({ connect: vi.fn(async () => client) });
    const out = await runner(p).run(compiled, (rows) => rows);
    expect(out).toMatchObject({ value: null, meta: { status: 'timed_out', data_until: null, timezone: 'UTC', row_cap: QUERY_LIMITS.rowCap, computed_at: '2026-09-05T00:00:00.000Z' } });
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  describe('readOnly: the same bounded transaction for reads that are not compiled statements', () => {
    const recording = () => {
      const calls: [string, unknown[] | undefined][] = [];
      const client = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          calls.push([sql, params]);
          return { rows: [{ timezone: 'UTC' }] };
        }),
        release: vi.fn(),
      };
      return { calls, client };
    };

    it('opens BEGIN READ ONLY, re-asserts the 5 s statement_timeout as a parameter, runs the callback, COMMITs and releases', async () => {
      const { calls, client } = recording();
      const p = pool({ connect: vi.fn(async () => client) });
      const out = await runner(p).readOnly(async (query) => (await query<{ timezone: string }>('SELECT timezone FROM projects WHERE project_id = $1', ['p'])).rows[0]?.timezone);
      expect(out).toBe('UTC');
      expect(calls.map(([sql]) => sql)).toEqual(['BEGIN READ ONLY', 'SELECT set_config($1, $2, true)', 'SELECT timezone FROM projects WHERE project_id = $1', 'COMMIT']);
      expect(calls[1]?.[1]).toEqual(['statement_timeout', '5s']);
      expect(calls[2]?.[1]).toEqual(['p']);
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('a failing read is rolled back, released and re-thrown as itself — a 57014 keeps its code for the caller to name', async () => {
      const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
      const { calls, client } = recording();
      client.query.mockImplementation(async (sql: string) => {
        calls.push([sql, undefined]);
        if (sql.startsWith('SELECT timezone')) throw timeout;
        return { rows: [] };
      });
      const p = pool({ connect: vi.fn(async () => client) });
      await expect(runner(p).readOnly((query) => query('SELECT timezone FROM projects WHERE project_id = $1', ['p']))).rejects.toBe(timeout);
      expect(calls.map(([sql]) => sql)).toContain('ROLLBACK');
      expect(client.release).toHaveBeenCalledTimes(1);
    });

    it(`obeys the same admission rule as run: BUSY at once when every connection is busy and ${RO_QUEUE_MAX} callers wait`, async () => {
      const p = pool({ idleCount: 0, totalCount: 4, waitingCount: RO_QUEUE_MAX });
      await expect(runner(p).readOnly(async () => 1)).rejects.toBeInstanceOf(BusyError);
      expect(p.connect).not.toHaveBeenCalled();
    });
  });

  it('opens one REPEATABLE READ READ ONLY transaction (query and watermark share a snapshot) and re-asserts the 5 s statement_timeout inside it, as a parameter', async () => {
    const calls: [string, unknown[] | undefined][] = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push([sql, params]);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const p = pool({ connect: vi.fn(async () => client) });
    await runner(p).run(compiled, (rows) => rows);
    expect(calls[0]?.[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(calls[1]).toEqual(['SELECT set_config($1, $2, true)', ['statement_timeout', '5s']]);
    expect(calls[calls.length - 1]?.[0]).toBe('COMMIT');
  });
});

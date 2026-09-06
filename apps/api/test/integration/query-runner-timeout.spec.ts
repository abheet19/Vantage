/**
 * query-runner-timeout.spec.ts — the 5 s bound is the runner's, not the role's (design §4.2 note, S1 hardening finding 7).
 * vantage_reader raises its own session default to 1 h — PostgreSQL lets any login role ALTER its own settings, which is
 * exactly why the default is not a cap — and a compiled statement that waits on a lock is still `timed_out` after about
 * five seconds, the session default is untouched afterwards (SET LOCAL died with the transaction), a session that SETs
 * the timeout to 0 fares no better, and the boot self-test would have refused the widened default anyway.
 */
import { CountSpec, QUERY_LIMITS } from '@vantage/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { compileCount, decodeCount } from '../../src/domain/compile/index.js';
import { FixedClock } from '../../src/infra/clock.js';
import { createPool } from '../../src/infra/database.module.js';
import { QueryRunner, RO_STATEMENT_TIMEOUT } from '../../src/infra/query-runner.js';
import { runBootSelfTest } from '../../src/infra/self-test.js';
import { PROJECT_ID } from '../helpers/arbitraries.js';

const WIDENED = '1h';

const compiled = compileCount(
  CountSpec.parse({ kind: 'count', project: PROJECT_ID, range: { from: '2026-08-01', to: '2026-08-31' }, event: { event: 'signup' } }),
  { projectId: PROJECT_ID, timezone: 'UTC', rowCap: QUERY_LIMITS.rowCap },
);

let owner: pg.Pool;
let reader: pg.Client;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: inject('dbOwnerUrl'), max: 2 });
  reader = new pg.Client({ connectionString: inject('dbRoUrl') });
  await reader.connect();
  // The attack from the design note, verbatim: the reader switches its read-only default off and widens its own timeout default.
  await reader.query('SET default_transaction_read_only = off');
  await reader.query(`ALTER ROLE vantage_reader SET statement_timeout = '${WIDENED}'`);
});
afterAll(async () => {
  await reader.query(`ALTER ROLE vantage_reader SET statement_timeout = '${RO_STATEMENT_TIMEOUT}'`);
  await reader.end();
  await owner.end();
});

/** A one-connection reader pool: every statement the test and the runner issue lands on the same session. */
const readerPool = () => createPool(inject('dbRoUrl'), 1);
const timeoutOf = async (pool: pg.Pool) => (await pool.query<{ v: string }>(`SELECT current_setting('statement_timeout') AS v`)).rows[0]?.v;

/** An ACCESS EXCLUSIVE lock on events makes every SELECT on it wait; the runner's own timeout is the only thing that can end the wait. */
const holdLock = async () => {
  const client = await owner.connect();
  await client.query('BEGIN');
  await client.query('LOCK TABLE events IN ACCESS EXCLUSIVE MODE');
  return async () => {
    await client.query('ROLLBACK');
    client.release();
  };
};

const runUnderLock = async (pool: pg.Pool) => {
  const release = await holdLock();
  try {
    const started = Date.now();
    const out = await new QueryRunner(pool, new FixedClock(new Date('2026-09-05T00:00:00Z'))).run(compiled, decodeCount);
    return { out, wallMs: Date.now() - started };
  } finally {
    await release();
  }
};

describe('QueryRunner enforces the 5 s bound itself', () => {
  it(`a fresh reader session now starts with statement_timeout = ${WIDENED}, and the boot self-test would refuse to start on it`, async () => {
    const ro = readerPool();
    const rw = createPool(inject('dbRwUrl'), 1);
    try {
      expect(await timeoutOf(ro)).toBe(WIDENED);
      const result = await runBootSelfTest(rw, ro);
      expect(result.ok).toBe(false);
      expect(result.checks.find((c) => c.name === 'ro.statement_timeout')).toMatchObject({ ok: false, detail: expect.stringContaining(`"${WIDENED}"; expected ${RO_STATEMENT_TIMEOUT}`) });
    } finally {
      await Promise.all([ro.end(), rw.end()]);
    }
  });

  it(`with the role default at ${WIDENED}, a compiled statement waiting on a lock is timed_out after about 5 s, nothing partial, and the session default is still ${WIDENED} afterwards`, async () => {
    const ro = readerPool();
    try {
      const { out, wallMs } = await runUnderLock(ro);
      expect(out.meta.status).toBe('timed_out');
      expect(out.value).toBeNull();
      expect(out.meta.elapsed_ms).toBeGreaterThanOrEqual(4_500);
      expect(wallMs).toBeLessThan(15_000);
      expect(await timeoutOf(ro)).toBe(WIDENED);
      const again = await new QueryRunner(ro, new FixedClock(new Date('2026-09-05T00:00:00Z'))).run(compiled, decodeCount);
      expect(again.meta.status).toBe('empty');
    } finally {
      await ro.end();
    }
  }, 40_000);

  it('attack: the session sets statement_timeout = 0 (no limit) before the run — the runner still stops it after about 5 s', async () => {
    const ro = readerPool();
    try {
      await ro.query('SET statement_timeout = 0');
      expect(await timeoutOf(ro)).toBe('0');
      const { out, wallMs } = await runUnderLock(ro);
      expect(out.meta.status).toBe('timed_out');
      expect(out.value).toBeNull();
      expect(wallMs).toBeLessThan(15_000);
      expect(await timeoutOf(ro)).toBe('0');
    } finally {
      await ro.end();
    }
  }, 40_000);

  it(`readOnly (the catalog, timezone and history reads) is bounded the same way: with the role default at ${WIDENED}, a read waiting on a lock is a 57014 after about 5 s and the session default is untouched`, async () => {
    const ro = readerPool();
    try {
      const release = await holdLock();
      const started = Date.now();
      try {
        const err = await new QueryRunner(ro, new FixedClock(new Date('2026-09-05T00:00:00Z')))
          .readOnly((query) => query('SELECT count(*) FROM events WHERE project_id = $1', [PROJECT_ID]))
          .catch((e: unknown) => e);
        expect((err as { code?: string }).code).toBe('57014');
        expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
        expect(Date.now() - started).toBeLessThan(15_000);
      } finally {
        await release();
      }
      expect(await timeoutOf(ro)).toBe(WIDENED);
      const rows = await new QueryRunner(ro, new FixedClock(new Date('2026-09-05T00:00:00Z'))).readOnly(async (query) => (await query<{ n: string }>('SELECT count(*) AS n FROM events WHERE project_id = $1', [PROJECT_ID])).rows);
      expect(rows[0]?.n).toBe('0');
    } finally {
      await ro.end();
    }
  }, 40_000);

  it('the bound the runner enforces and the default the self-test expects are one constant', () => {
    expect(RO_STATEMENT_TIMEOUT).toBe('5s');
  });
});

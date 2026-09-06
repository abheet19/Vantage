/**
 * query-runner.ts — every read the API makes as `vantage_reader`, bounded the same way.
 *
 * Why it exists: layer L3 of the boundary (design §4.2) is a role that can only read, inside a
 * transaction that can only read, with a timeout the database enforces — and a status that tells the
 * truth about what happened. `run` is the only code that executes query-path SQL, and it will only run
 * a `Compiled` (V7b): a hand-built statement is refused before a connection is touched. Every run is
 * `BEGIN … READ ONLY` … `COMMIT`, the compiled watermark statement runs in the same transaction so the
 * footer describes the data the query saw, and a `statement_timeout` (57014) yields `timed_out` with
 * `value: null` — nothing partial is ever returned (V9). A refusal by the database (42501/25006) is
 * `refused_by_database` and logged at error level, because it means a grant changed under us.
 *
 * `readOnly` (S3 hardening) is the same transaction for the reads that are not compiled statements — the
 * event catalog, a project's timezone, Ask history. They used to run autocommit on the pool, bounded only
 * by the role's session default, which is not a cap (the reader can raise its own); now they too run
 * inside `BEGIN READ ONLY` with the `SET LOCAL` timeout, under the pool's admission rule, and a 57014
 * there propagates as the pg error for the caller to name (`pgErrorStatus`), never as a result. The pool
 * has four connections; when all are busy and eight callers are already waiting, the next one fails fast
 * with `BusyError` instead of joining a queue that would outlive its own request — one rule, in one
 * place, for every reader (E44 is subsumed).
 *
 * What it must never do: build SQL, run a statement it did not receive as `Compiled` through `run`,
 * return rows from a failed transaction, or swallow an error it cannot name as a status.
 */
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ResultMeta, ResultStatus } from '@vantage/contracts';
import pg from 'pg';
import { IN_PROGRESS_COLUMN, isCompiled, pgErrorCode, pgErrorStatus, statusOf, type Compiled, type MetaRow } from '../domain/index.js';
import type { Clock } from './clock.js';
import { RO_POOL_MAX } from './database.module.js';
import { RO_STATEMENT_TIMEOUT } from './limits.js';
import { CLOCK, PG_RO } from './tokens.js';

/** Callers allowed to wait for a connection once all of them are busy; the next one is refused at once. */
export const RO_QUEUE_MAX = 8;

/** Re-exported so the bound the runner enforces and the bound the tests expect are one identifier. */
export { RO_STATEMENT_TIMEOUT };

/** pg-pool's message when a queued `connect()` outlives `connectionTimeoutMillis`; the one connect failure that means "busy", not "down". */
const POOL_CONNECT_TIMEOUT = 'timeout exceeded when trying to connect';

export class BusyError extends Error {
  readonly code = 'BUSY';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BusyError';
  }
}

export interface RunOutcome<T> {
  /** The decoded result, or null whenever the status says there is nothing to show. */
  value: T | null;
  meta: ResultMeta;
}

/** One parameterised read inside an open READ ONLY transaction; what `readOnly` hands its callback. */
export type ReadQuery = <R extends pg.QueryResultRow>(sql: string, params?: readonly unknown[]) => Promise<pg.QueryResult<R>>;

/**
 * The two ways a bounded read fails that a route answers with 503 — the pool is saturated (`BUSY`) or the
 * 5 s bound stopped the statement (`TIMED_OUT`); anything else is re-raised as the fault it is.
 */
export function asHttpReadFault(err: unknown): never {
  if (err instanceof BusyError) throw new ServiceUnavailableException({ code: err.code, message: err.message });
  if (pgErrorStatus(err) === 'timed_out') {
    throw new ServiceUnavailableException({ code: 'TIMED_OUT', message: `the read did not finish within the ${RO_STATEMENT_TIMEOUT} statement timeout` });
  }
  throw err;
}

const elapsedSince = (started: number) => Math.round(performance.now() - started);

@Injectable()
export class QueryRunner {
  private readonly logger = new Logger('query');

  constructor(
    @Inject(PG_RO) private readonly ro: pg.Pool,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Executes exactly one compiled statement on the RO pool inside BEGIN READ ONLY; maps errors to status. Never receives a string that did not come from `compile`. */
  async run<T>(c: Compiled, decode: (rows: unknown[]) => T): Promise<RunOutcome<T>> {
    if (!isCompiled(c)) throw new Error('QueryRunner.run: the statement was not produced by compile()');
    const client = await this.acquire();
    const started = performance.now();
    try {
      await this.begin(client, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); // one snapshot for the query and its watermark: an insert between them is in neither
      const result = await client.query(c.sql, [...c.params]);
      const watermark = await client.query<MetaRow>(c.meta.sql, [...c.meta.params]);
      await client.query('COMMIT');
      return this.succeeded(c, result.rows, watermark.rows[0] ?? null, elapsedSince(started), decode);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      return this.failed(c, err, elapsedSince(started));
    } finally {
      client.release();
    }
  }

  /**
   * Runs `fn` inside one `BEGIN READ ONLY` transaction with the 5 s `SET LOCAL` bound, on a connection
   * admitted by the same rule as `run`. Errors propagate as thrown (a 57014 is a pg error the caller maps
   * with `pgErrorStatus`); the transaction is rolled back and the connection released either way.
   */
  async readOnly<T>(fn: (query: ReadQuery) => Promise<T>): Promise<T> {
    const client = await this.acquire();
    try {
      await this.begin(client, 'BEGIN READ ONLY');
      const value = await fn((sql, params = []) => client.query(sql, [...params]));
      await client.query('COMMIT');
      return value;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** Opens the transaction and re-asserts the bound inside it: set_config(…, is_local = true) is SET LOCAL as a parameterised statement — it dies with the transaction, and the value is never spliced into SQL text. */
  private async begin(client: pg.PoolClient, statement: string): Promise<void> {
    await client.query(statement);
    await client.query('SELECT set_config($1, $2, true)', ['statement_timeout', RO_STATEMENT_TIMEOUT]);
  }

  private async acquire(): Promise<pg.PoolClient> {
    const saturated = this.ro.idleCount === 0 && this.ro.totalCount >= RO_POOL_MAX;
    if (saturated && this.ro.waitingCount >= RO_QUEUE_MAX) {
      throw new BusyError(`all ${RO_POOL_MAX} read-only connections are busy and ${RO_QUEUE_MAX} queries are already waiting`);
    }
    try {
      return await this.ro.connect();
    } catch (err) {
      if (err instanceof Error && err.message.includes(POOL_CONNECT_TIMEOUT)) {
        throw new BusyError('no read-only connection became free within the connection timeout', { cause: err });
      }
      throw err;
    }
  }

  private succeeded<T>(c: Compiled, rows: unknown[], watermark: MetaRow | null, elapsedMs: number, decode: (rows: unknown[]) => T): RunOutcome<T> {
    const status = statusOf({ rows: rows.length, rowCap: c.ctx.rowCap });
    const kept = rows.slice(0, c.ctx.rowCap);
    const incomplete = kept.filter((r) => (r as Record<string, unknown>)[IN_PROGRESS_COLUMN] === true).length;
    return { value: status === 'empty' ? null : decode(kept), meta: this.meta(c, status, watermark, elapsedMs, incomplete) };
  }

  /** Only the codes with a status of their own become a result; anything else is a fault and propagates as one. */
  private failed<T>(c: Compiled, err: unknown, elapsedMs: number): RunOutcome<T> {
    const status = pgErrorStatus(err);
    if (status === null) throw err;
    if (status === 'refused_by_database') {
      this.logger.error(`the database refused a compiled ${c.kind} statement (pg ${pgErrorCode(err)}): ${(err as Error).message} — a grant or the role setup changed`);
    }
    return { value: null, meta: this.meta(c, status, null, elapsedMs, 0) };
  }

  private meta(c: Compiled, status: ResultStatus, watermark: MetaRow | null, elapsedMs: number, incompleteBuckets: number): ResultMeta {
    return {
      status,
      computed_at: this.clock.now().toISOString(),
      data_until: watermark?.data_until?.toISOString() ?? null,
      elapsed_ms: elapsedMs,
      incomplete_buckets: incompleteBuckets,
      ts_adjusted_share: watermark?.ts_adjusted_share ?? 0,
      persons_merged_since: watermark?.persons_merged_since ?? 0,
      timezone: c.ctx.timezone,
      row_cap: c.ctx.rowCap,
    };
  }
}

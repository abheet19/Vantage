/**
 * mcp-errors.ts — every failure a tool handler can raise, mapped to the one error shape a client sees.
 *
 * Why it exists: LLD §6 says a tool error is `{ code, message, path? }` with codes from a closed list.
 * Handlers throw whatever their collaborators throw — the insights service's and the catalog's 503s for a
 * saturated pool or a timed-out read (`asHttpReadFault`), the runner's own `BusyError`, PostgreSQL's 57014
 * from an EXPLAIN — and this module is the single place those become `BUSY`, `TIMED_OUT`. Anything it
 * cannot name is `INTERNAL` with a fixed message and the real error logged to stderr: a pg message can
 * carry table names and values, and the client is not the operator.
 *
 * What it must never do: swallow an error into a success, or let a message it did not write reach the
 * client for the `INTERNAL` case.
 */
import { HttpException, type Logger } from '@nestjs/common';
import { McpErrorCode, type McpToolError } from '@vantage/contracts';
import { pgErrorCode, pgErrorStatus } from '../../domain/index.js';
import { BusyError } from '../../infra/query-runner.js';

/** A failure a handler decided on itself (`NOT_FOUND`, `INVALID_SPEC`), already in the client's shape. */
export class McpToolFailure extends Error {
  constructor(readonly failure: McpToolError) {
    super(failure.message);
    this.name = 'McpToolFailure';
  }
}

/** pg-pool's message when a queued `connect()` outlives `connectionTimeoutMillis`: the pool is busy, not down. */
const POOL_CONNECT_TIMEOUT = 'timeout exceeded when trying to connect';

/** The read services answer HTTP with `{ code: 'BUSY' | 'TIMED_OUT', message }`; the same fact keeps its code here. */
function httpReadFault(err: unknown): McpToolError | null {
  if (!(err instanceof HttpException)) return null;
  const body = err.getResponse() as { code?: unknown; message?: unknown };
  const code = McpErrorCode.safeParse(body.code);
  if (!code.success || (code.data !== 'BUSY' && code.data !== 'TIMED_OUT')) return null;
  return { code: code.data, message: typeof body.message === 'string' ? body.message : err.message };
}

export function toToolError(err: unknown, logger: Pick<Logger, 'error'>): McpToolError {
  if (err instanceof McpToolFailure) return err.failure;
  const fault = httpReadFault(err);
  if (fault) return fault;
  if (err instanceof BusyError) return { code: 'BUSY', message: `${err.message}; the same call can be retried` };
  if (pgErrorStatus(err) === 'timed_out') return { code: 'TIMED_OUT', message: 'the read exceeded the 5 s statement timeout and was cancelled by the database' };
  if (err instanceof Error && err.message.includes(POOL_CONNECT_TIMEOUT)) {
    return { code: 'BUSY', message: 'no read-only connection became free within the connection timeout; the same call can be retried' };
  }
  const sqlstate = pgErrorCode(err);
  logger.error(`${sqlstate === null ? '' : `pg ${sqlstate}: `}${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  return { code: 'INTERNAL', message: 'internal error' };
}

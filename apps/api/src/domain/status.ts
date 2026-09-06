/**
 * status.ts — the closed status set, and the one function that decides which member a query outcome is.
 *
 * Why it exists: "no events matched" and "the query timed out" are different facts and must never
 * render the same (Gate 3 non-negotiable). The decision is pure and lives here so it can be tested
 * exhaustively without a database: an error code wins over everything, then an empty row set, then a
 * row count over the cap. In-progress buckets do not change the status — they are flagged per cell and
 * counted in `meta.incomplete_buckets`, because a result computed over data received so far is complete
 * as far as the database knows; hiding it behind another status would tell the reader less, not more.
 *
 * What it must never do: return `complete` for any error or for more rows than the cap, or quietly map
 * an unknown database error to a status — that would turn a bug into a plausible number. Unknown codes
 * throw, and the runner never calls this with one (it re-raises them as internal errors).
 */
import type { ResultStatus } from '@vantage/contracts';

/** Design §1.3: a bucket whose end is within this of `now` is still receiving events. */
export const IN_PROGRESS_GRACE_MS = 3_600_000;

/**
 * A compiled statement may expose this boolean column; the runner counts the rows where it is true into
 * `incomplete_buckets`. It counts BUCKETS, so a statement whose rows are not buckets (retention's rows
 * are cells, and several cohorts look at the same bucket) must set it on exactly one row per bucket
 * that may still receive events; a per-cell flag for the UI is a different column (`in_progress`).
 */
export const IN_PROGRESS_COLUMN = 'incomplete_bucket';

/** The only PostgreSQL error codes with a status of their own: statement_timeout, read_only_sql_transaction, insufficient_privilege. */
export const PG_ERROR_STATUS: Readonly<Record<string, ResultStatus>> = {
  '57014': 'timed_out',
  '25006': 'refused_by_database',
  '42501': 'refused_by_database',
};

/** The SQLSTATE a pg error carries, or null for anything that is not one. */
export function pgErrorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/**
 * The one mapping from a thrown pg error to a result status, shared by everything that reads as the
 * reader: `QueryRunner` turns it into `meta.status`, the ask path into a decision (`timed_out` →
 * `error` / `TIMED_OUT`, `refused_by_database` → `refused_by_database`), the read routes into a 503.
 * Null means the error has no status of its own and is a fault the caller must re-raise.
 */
export function pgErrorStatus(err: unknown): ResultStatus | null {
  const code = pgErrorCode(err);
  return code === null ? null : (PG_ERROR_STATUS[code] ?? null);
}

export interface QueryOutcome {
  /** Rows the statement returned; the compiler asks for `rowCap + 1` so this exceeds the cap exactly when the answer was cut. */
  rows: number;
  rowCap: number;
  error?: { code: string };
}

/** Maps a pg outcome to the closed status set. A pg error 57014 (statement_timeout) is `timed_out`; 25006/42501 are `refused_by_database` and ALSO logged at error level by the caller (design §4.3 step 4). */
export function statusOf(outcome: QueryOutcome): ResultStatus {
  if (outcome.error) {
    const status = PG_ERROR_STATUS[outcome.error.code];
    if (!status) throw new Error(`statusOf: pg error ${outcome.error.code} has no status; the runner must re-raise it`);
    return status;
  }
  if (outcome.rows === 0) return 'empty';
  if (outcome.rows > outcome.rowCap) return 'truncated';
  return 'complete';
}

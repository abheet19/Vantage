/**
 * audit.service.ts — the append-only audit log (design §4.2 L4): one row per ask, written before the answer.
 *
 * Why it exists: V12 says every `POST /v1/ask` leaves exactly one `asks` row whatever the outcome, and
 * this is the only code that writes one. It writes through the app role (`vantage_app` has INSERT on
 * `asks` and nothing else on it — no UPDATE, no DELETE, so a row can never be edited after the fact),
 * and it is the reason `modules/ask` can stay away from the write pool: ask depends on this service, and
 * the lint holds the `PG_RW` token out of that directory (V7d). Reads for Ask history go through the
 * reader role inside `QueryRunner.readOnly` — `BEGIN READ ONLY`, the 5 s bound, the admission rule (S3
 * hardening; it used to be an autocommit read) — and a read the bound stopped is 503 `TIMED_OUT`. The
 * reader already holds SELECT on `asks` (LLD §2), so no grant had to widen. Model text and the question
 * are made storable before the INSERT (U+0000 and lone surrogates cannot live in a `text` column) and the
 * raw output is kept to the same cap L1 judged — `PARSE_INPUT_CAP` UTF-16 code units, the unit `slice`
 * counts in — so the row holds exactly the text the parser saw (or, when the adapter reported more than
 * it parsed, the whole reply with the parsed text inside it). The row also names the model that answered
 * (migration 0004), because "which model said this" is part of what a reviewer asks.
 *
 * What it must never do: swallow a failed INSERT (the ask must not be answered as if it were logged),
 * update or delete a row, or store anything the response did not also carry.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { AskDecision, AskRow, QuerySpec } from '@vantage/contracts';
import pg from 'pg';
import { PARSE_INPUT_CAP } from '../../domain/index.js';
import { asHttpReadFault, QueryRunner } from '../../infra/query-runner.js';
import { PG_RW } from '../../infra/tokens.js';

export interface AuditEntry {
  ask_id: string;
  project_id: string;
  question: string;
  adapter: string;
  /** The model id the adapter reported; null when no model was asked (the catalog read failed first). */
  model: string | null;
  raw_output: string | null;
  spec: QuerySpec | null;
  sql: string | null;
  decision: AskDecision;
  status: string | null;
  elapsed_ms: number;
  error_code: string | null;
}

interface AskDbRow extends Omit<AskRow, 'asked_at'> {
  asked_at: Date;
}

const INSERT_ASK = `INSERT INTO asks (ask_id, project_id, question, adapter, model, raw_output, spec, sql, decision, status, elapsed_ms, error_code)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`;

const RECENT_ASKS = `SELECT ask_id, project_id, asked_at, question, adapter, model, raw_output, spec, sql, decision, status, elapsed_ms, error_code
FROM asks WHERE project_id = $1 ORDER BY asked_at DESC, ask_id DESC LIMIT $2`;

/** PostgreSQL `text` cannot hold U+0000 or a lone surrogate; a model may emit both. Replaced, not dropped, so the length still tells the story. */
export function storable(text: string): string {
  return text.toWellFormed().replaceAll('\u0000', '\uFFFD');
}

@Injectable()
export class AuditService {
  constructor(
    @Inject(PG_RW) private readonly rw: pg.Pool,
    @Inject(QueryRunner) private readonly runner: QueryRunner,
  ) {}

  /** Writes the row; rejects if PostgreSQL does, and the caller must not answer as if it had been written. */
  async record(entry: AuditEntry): Promise<void> {
    await this.rw.query(INSERT_ASK, [
      entry.ask_id,
      entry.project_id,
      storable(entry.question),
      entry.adapter,
      entry.model,
      entry.raw_output === null ? null : storable(entry.raw_output.slice(0, PARSE_INPUT_CAP)),
      entry.spec === null ? null : JSON.stringify(entry.spec),
      entry.sql,
      entry.decision,
      entry.status,
      entry.elapsed_ms,
      entry.error_code,
    ]);
  }

  /** The most recent `limit` rows for one project, newest first — the Ask history screen. */
  async recent(projectId: string, limit: number): Promise<AskRow[]> {
    try {
      const r = await this.runner.readOnly((query) => query<AskDbRow>(RECENT_ASKS, [projectId, limit]));
      return r.rows.map((row) => ({ ...row, asked_at: row.asked_at.toISOString() }));
    } catch (err) {
      asHttpReadFault(err);
    }
  }
}

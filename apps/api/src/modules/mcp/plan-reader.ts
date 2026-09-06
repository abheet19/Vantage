/**
 * plan-reader.ts — `EXPLAIN (FORMAT TEXT)` of one compiled statement, as the reader, inside the runner's read-only transaction.
 *
 * Why it exists: `explain_query` may return a plan when the operator asked for it ⟨D3⟩, and a plan must
 * be read under exactly the conditions the query itself would run under — `vantage_reader`, `BEGIN … READ
 * ONLY`, the 5 s `statement_timeout` re-issued with `set_config` (E28), the pool's admission rule — which
 * is what `QueryRunner.readOnly` provides; otherwise the plan would describe a run that can never happen.
 * It accepts only a `Compiled` (V7b): `EXPLAIN` is prefixed to a statement `compile()` sealed, never to a
 * string a caller wrote, and that prefix is the one place in this module where SQL text is joined, because
 * PostgreSQL has no parameterised form of it.
 *
 * What it must never do: run the statement (EXPLAIN without ANALYZE plans and does not execute), accept
 * a hand-built statement, or decide whether a plan may leave — that is the caller's `exposePlans`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { isCompiled, type Compiled } from '../../domain/index.js';
import { QueryRunner } from '../../infra/query-runner.js';

interface PlanRow {
  'QUERY PLAN': string;
}

@Injectable()
export class PlanReader {
  constructor(@Inject(QueryRunner) private readonly runner: QueryRunner) {}

  /** The text plan, one line per row as PostgreSQL prints it. A 57014 or a `BusyError` propagates for the error mapper to name. */
  async explain(c: Compiled): Promise<string> {
    if (!isCompiled(c)) throw new Error('PlanReader.explain: the statement was not produced by compile()');
    const r = await this.runner.readOnly((query) => query<PlanRow>('EXPLAIN (FORMAT TEXT) ' + c.sql, c.params));
    return r.rows.map((row) => row['QUERY PLAN']).join('\n');
  }
}

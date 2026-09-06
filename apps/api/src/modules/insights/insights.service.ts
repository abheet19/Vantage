/**
 * insights.service.ts — spec in, compiled statement out, result envelope back (LLD §1.1 InsightsModule).
 *
 * Why it exists: the query path is compile → run → decode, and this is the only place the three meet.
 * The compile context comes from the caller's project, not from anything in the spec: the timezone is
 * read from `projects` as the reader — through `QueryRunner.readOnly`, so the lookup runs inside the same
 * bounded READ ONLY transaction and under the same admission rule as the query itself (S3 hardening; it
 * used to be an autocommit read with its own copy of the admission rule, E44) — and an unknown project
 * compiles against UTC and runs to an honest `empty`, never an error that would confirm or deny the id
 * exists (LLD §7.1, no enumeration). The lookup is `timezoneIn` from `CatalogService`, the one timezone
 * read every reader shares; a caller that already read it (the ask path reads it with the catalog) passes
 * it in and the lookup does not run twice. A saturated read pool or a lookup the 5 s bound stopped is a
 * 503 (`BUSY`, `TIMED_OUT`) the client can act on, not a 500 nobody can. The SQL and its parameters are
 * returned with every answer because the SQL is the product: a reader checks the number against the
 * statement that produced it.
 *
 * What it must never do: touch the write pool, reach an LlmPort (lint-enforced), or answer with a
 * number when `QueryRunner` said there is none — the nullable fields stay null.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  QUERY_LIMITS,
  type CountResult,
  type CountSpec,
  type FunnelResult,
  type FunnelSpec,
  type InsightResult,
  type PathsResult,
  type PathsSpec,
  type QuerySpec,
  type RetentionResult,
  type RetentionSpec,
  type TrendResult,
  type TrendSpec,
} from '@vantage/contracts';
import {
  compileCount,
  compileFunnel,
  compilePaths,
  compileRetention,
  compileTrend,
  decodeCount,
  decodeFunnel,
  decodePaths,
  decodeRetention,
  decodeTrend,
  type CompileCtx,
  type Compiled,
} from '../../domain/index.js';
import { asHttpReadFault, QueryRunner, type RunOutcome } from '../../infra/query-runner.js';
import { timezoneIn } from '../events/catalog.service.js';

const NO_FUNNEL = { steps: null, median_time_to_convert_s: null, breakdown: null };
const NO_TREND = { points: null, breakdown: null };
const NO_PATHS = { starts: null, transitions: null, total_transitions: 0 };
const NO_COUNT = { persons: null, events: null };

/** What a caller may already know about the project, so the service does not read it again. */
export interface RunHint {
  timezone?: string;
}

@Injectable()
export class InsightsService {
  constructor(@Inject(QueryRunner) private readonly runner: QueryRunner) {}

  /** One entry for callers that hold a `QuerySpec` of any kind (the ask path, MCP `explain_query`): dispatch by kind, total over the five the grammar admits. */
  async run(spec: QuerySpec, hint: RunHint = {}): Promise<InsightResult> {
    switch (spec.kind) {
      case 'funnel':
        return this.funnel(spec, hint);
      case 'retention':
        return this.retention(spec, hint);
      case 'trend':
        return this.trend(spec, hint);
      case 'paths':
        return this.paths(spec, hint);
      case 'count':
        return this.count(spec, hint);
    }
  }

  async funnel(spec: FunnelSpec, hint: RunHint = {}): Promise<FunnelResult> {
    const { c, value, meta } = await this.answer(spec.project, hint, (ctx) => compileFunnel(spec, ctx), (rows) => decodeFunnel(rows, spec));
    return { ...(value ?? NO_FUNNEL), sql: c.sql, params: [...c.params], meta };
  }

  async retention(spec: RetentionSpec, hint: RunHint = {}): Promise<RetentionResult> {
    const { c, value, meta } = await this.answer(spec.project, hint, (ctx) => compileRetention(spec, ctx), (rows) => decodeRetention(rows, spec));
    return { unit: spec.unit, cohorts: value, sql: c.sql, params: [...c.params], meta };
  }

  async trend(spec: TrendSpec, hint: RunHint = {}): Promise<TrendResult> {
    const { c, value, meta } = await this.answer(spec.project, hint, (ctx) => compileTrend(spec, ctx), (rows) => decodeTrend(rows, spec));
    return { measure: spec.measure, unit: spec.unit, ...(value ?? NO_TREND), sql: c.sql, params: [...c.params], meta };
  }

  async paths(spec: PathsSpec, hint: RunHint = {}): Promise<PathsResult> {
    const { c, value, meta } = await this.answer(spec.project, hint, (ctx) => compilePaths(spec, ctx), decodePaths);
    return { start: spec.start, ...(value ?? NO_PATHS), sql: c.sql, params: [...c.params], meta };
  }

  async count(spec: CountSpec, hint: RunHint = {}): Promise<CountResult> {
    const { c, value, meta } = await this.answer(spec.project, hint, (ctx) => compileCount(spec, ctx), decodeCount);
    return { ...(value ?? NO_COUNT), sql: c.sql, params: [...c.params], meta };
  }

  /** Context lookup, compile, run: a saturated pool or a stopped lookup anywhere on that path is a 503 the client can retry, not a 500 nobody can act on. */
  private async answer<T>(projectId: string, hint: RunHint, compileWith: (ctx: CompileCtx) => Compiled, decode: (rows: unknown[]) => T): Promise<RunOutcome<T> & { c: Compiled }> {
    try {
      const timezone = hint.timezone ?? (await this.runner.readOnly((query) => timezoneIn(query, projectId)));
      const c = compileWith({ projectId, timezone, rowCap: QUERY_LIMITS.rowCap });
      return { c, ...(await this.runner.run(c, decode)) };
    } catch (err) {
      asHttpReadFault(err);
    }
  }
}

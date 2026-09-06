/**
 * ask.ts — the HTTP contract for `POST /v1/ask` and `GET /v1/asks` (LLD §3.1, §3.4).
 *
 * Why it exists: the ask path is the one place natural language enters the system, and its response
 * must make the four possible outcomes impossible to confuse — `decision` is a closed set, `raw_output`
 * is always present so a refusal can show what the model actually said (design §4.2 L1: "seeing the
 * refusal IS the demo"), and `spec`/`result`/`error` are each nullable so the UI renders exactly what
 * happened. `AskRow` is one row of the audit log (`asks`, LLD §2), the shape Ask history reads.
 *
 * What it must never do: carry SQL from the caller (there is no field for it), or admit a `result`
 * shape outside the five kinds this build compiles — S6 added `TrendResult`/`PathsResult` to the union,
 * so all five kinds now run and there is no kind left that the ask path refuses as `INVALID_SPEC`.
 */
import { z } from 'zod';
import { StorableText } from './ingest.js';
import { QuerySpec } from './query-spec.js';
import { CountResult, FunnelResult, PathsResult, RetentionResult, TrendResult } from './results.js';

/** The question is stored verbatim in `asks.question`, so it must be storable text; 2 000 chars is far beyond any honest question. */
export const AskBody = z.strictObject({ project: z.string().uuid(), question: StorableText(2_000) });
export type AskBody = z.infer<typeof AskBody>;

/** `ran` = a compiled statement executed (whatever its status); `refused` = Vantage stopped it before SQL existed; `refused_by_database` = L3 fired, on the query or on the catalog read before it (an alarm); `error` = the model, the catalog read or the runner failed. */
export const AskDecision = z.enum(['ran', 'refused', 'refused_by_database', 'error']);
export type AskDecision = z.infer<typeof AskDecision>;

/** Why an ask did not run: `code` is machine-readable (`NOT_JSON`, `NOT_A_SPEC`, `INVALID_SPEC`, `LLM_TIMEOUT`, `LLM_ERROR`, `REFUSED_BY_DATABASE`, `TIMED_OUT`, `BUSY`, `INTERNAL`); `path` is the Zod path for `NOT_A_SPEC`. */
export const AskError = z.object({ code: z.string(), message: z.string(), path: z.array(z.string()).optional() });
export type AskError = z.infer<typeof AskError>;

/** Every result shape this build can compute; `InsightsService.run` returns one, the ask path relays it. Trend and paths joined the union in S6. */
export const InsightResult = z.union([FunnelResult, RetentionResult, TrendResult, PathsResult, CountResult]);
export type InsightResult = z.infer<typeof InsightResult>;

export const AskResponse = z.object({
  ask_id: z.string().uuid(),
  decision: AskDecision,
  raw_output: z.string().nullable(),
  spec: QuerySpec.nullable(),
  result: InsightResult.nullable(),
  error: AskError.nullable(),
});
export type AskResponse = z.infer<typeof AskResponse>;

/** One audit row (LLD §2 `asks` + migration 0004 `model`); `spec` is stored as jsonb so it comes back as an object, `sql` is the exact statement that ran or null, `model` is the id the adapter reported or null when no model was asked. */
export const AskRow = z.object({
  ask_id: z.string().uuid(),
  project_id: z.string().uuid(),
  asked_at: z.string().datetime(),
  question: z.string(),
  adapter: z.string(),
  model: z.string().nullable(),
  raw_output: z.string().nullable(),
  spec: QuerySpec.nullable(),
  sql: z.string().nullable(),
  decision: AskDecision,
  status: z.string().nullable(),
  elapsed_ms: z.number().int().nullable(),
  error_code: z.string().nullable(),
});
export type AskRow = z.infer<typeof AskRow>;

/** Ask history is capped at 200 rows per request (LLD §3.4); `limit` arrives as a query string, hence the coercion. */
export const ASKS_LIMIT_MAX = 200;
export const AsksQuery = z.strictObject({
  project: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(ASKS_LIMIT_MAX).default(ASKS_LIMIT_MAX),
});
export type AsksQuery = z.infer<typeof AsksQuery>;

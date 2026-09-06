/**
 * ask.service.ts — the boundary, end to end (design §4.2): L0 prompt → model → L1 parse → L2/L3 via
 * InsightsService → L4 audit → answer.
 *
 * Why it exists: this is the one place natural language becomes a query, and its shape is the security
 * argument made executable. The catalog goes to the model as data and the question as the user turn
 * (L0); whatever comes back is text, capped at `PARSE_INPUT_CAP` UTF-16 code units before anything reads
 * it (a 10 MB reply is one slice); `parseSpec` judges it with the caller's project written over the
 * model's (L1, E26 — the model never chooses a project); a spec that survives goes to
 * `InsightsService.run`, which compiles it and runs it as the reader (L2, L3) — this service never sees
 * SQL text except in the result it relays. Every path ends in the same place: exactly one audit row,
 * written and awaited BEFORE the response exists (V12), then HTTP 200 with `decision` saying what
 * happened. A model timeout is `error` / `LLM_TIMEOUT`; a model-service failure is `error` / `LLM_ERROR`;
 * prose is `refused` / `NOT_JSON`; JSON outside the grammar is `refused` / `NOT_A_SPEC` with the Zod path;
 * a spec of any of the five grammar kinds runs (S6 added trend and paths, so none is refused as
 * unsupported); L3 firing is `refused_by_database`, which is also an alarm (the runner logs it). Everything before the
 * model sits inside the same net: the catalog read runs as the reader, so the database refusing it is L3
 * firing too (`refused_by_database`, logged, audited), the 5 s bound stopping it or a saturated pool is
 * `error` / `TIMED_OUT` or `BUSY`, and a prompt that cannot be built (a project timezone PostgreSQL
 * accepts but `Intl` does not — S3 hardening found a 500 with no row there) is `error` / `INTERNAL`,
 * logged with its cause. Nothing here is a 4xx or 5xx on purpose: the decision IS the answer, and a
 * client must never confuse "the model failed" with "the request was malformed" (the body pipe owns that
 * 422). If the audit INSERT itself fails, the request fails — an ask that was not logged is not answered.
 *
 * Time: the model gets `LLM_TIMEOUT_MS`, the compiled query 5 s (the runner's `SET LOCAL`), the catalog
 * read 5 s more, and the audit INSERT the app role's default; an ask has no single deadline, each stage
 * has its own.
 *
 * What it must never do: import `PG_RW` or `pg` (lint, V7d), build or see SQL of its own, retry the
 * model, or answer before the audit row is written.
 */
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { AskBody, AskDecision, AskError, AskResponse, EventCatalog, QuerySpec } from '@vantage/contracts';
import { randomUUID } from 'node:crypto';
import { buildPrompt, PARSE_INPUT_CAP, parseSpec, pgErrorCode, pgErrorStatus, SPEC_JSON_SCHEMA, type LlmMessages, type ParseRefusal } from '../../domain/index.js';
import type { Clock } from '../../infra/clock.js';
import { LLM_ADAPTER, LLM_PORT, LlmError, LlmTimeoutError, type LlmCompletion, type LlmPort } from '../../infra/llm/port.js';
import { CLOCK } from '../../infra/tokens.js';
import { AuditService } from '../audit/audit.service.js';
import { CatalogService } from '../events/catalog.service.js';
import { InsightsService } from '../insights/insights.service.js';

/** Room for a ten-step funnel spec with filters on every step (≈ 3 000 tokens of JSON) and the tool-call envelope around it; a model that needs more is not producing a spec. */
export const LLM_MAX_TOKENS = 4_096;
/** LLD §7.1: the model gets 8 s. */
export const LLM_TIMEOUT_MS = 8_000;

/** The UI's refusal sentence (design §8, 0:45); the raw model text is shown beneath it. */
export const NOT_JSON_MESSAGE = "The model's output is not a query the grammar can express.";

/** The response minus its id, plus what only the audit row records. */
type Outcome = Omit<AskResponse, 'ask_id'> & { model: string | null };

/** Every field the caller does not name is null: a refusal has no result, a model failure has no raw text, and so on. */
const outcome = (fields: Pick<Outcome, 'decision'> & Partial<Outcome>): Outcome => ({ raw_output: null, spec: null, result: null, error: null, model: null, ...fields });

const detailOf = (err: unknown): string => (err instanceof Error ? (err.stack ?? err.message) : String(err));

/** Today's calendar date in the project timezone (`YYYY-MM-DD`, which `en-CA` spells natively). Throws `RangeError` for a zone `Intl` does not know. */
export function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

function refusalOf(parsed: ParseRefusal): AskError {
  if (parsed.reason === 'not_json') return { code: 'NOT_JSON', message: NOT_JSON_MESSAGE };
  const first = parsed.issues?.[0];
  return { code: 'NOT_A_SPEC', message: first?.message ?? 'the object is not a query spec', path: (first?.path ?? []).map(String) };
}

/** A read route's 503 (`BUSY`, `TIMED_OUT`) is a decision here, not a status code: its body is already `{ code, message }`. */
function httpErrorOf(err: HttpException): AskError {
  const body = err.getResponse() as { code?: unknown; message?: unknown };
  return { code: typeof body.code === 'string' ? body.code : 'INTERNAL', message: typeof body.message === 'string' ? body.message : err.message };
}

@Injectable()
export class AskService {
  private readonly logger = new Logger('ask');

  constructor(
    @Inject(LLM_PORT) private readonly llm: LlmPort,
    @Inject(LLM_ADAPTER) private readonly adapter: string,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(InsightsService) private readonly insights: InsightsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async ask(body: AskBody): Promise<AskResponse> {
    const askId = randomUUID();
    const started = performance.now();
    const { model, ...out } = await this.answer(body);
    await this.audit.record({
      ask_id: askId,
      project_id: body.project,
      question: body.question,
      adapter: this.adapter,
      model,
      raw_output: out.raw_output,
      spec: out.spec,
      sql: out.result?.sql ?? null,
      decision: out.decision,
      status: out.result?.meta.status ?? null,
      elapsed_ms: Math.round(performance.now() - started),
      error_code: out.error?.code ?? null,
    });
    return { ask_id: askId, ...out };
  }

  private async answer(body: AskBody): Promise<Outcome> {
    let events: EventCatalog;
    try {
      events = await this.catalog.catalog(body.project);
    } catch (err) {
      return this.catalogFailed(err);
    }
    let messages: LlmMessages;
    try {
      messages = buildPrompt({ question: body.question, events, timezone: events.timezone, today: localDate(this.clock.now(), events.timezone) });
    } catch (err) {
      this.logger.error(`building the prompt failed: ${detailOf(err)}`);
      return outcome({ decision: 'error', error: { code: 'INTERNAL', message: 'the prompt could not be built for this project' } });
    }
    let completion: LlmCompletion;
    try {
      completion = await this.llm.complete(messages, { maxTokens: LLM_MAX_TOKENS, timeoutMs: LLM_TIMEOUT_MS, jsonSchema: SPEC_JSON_SCHEMA });
    } catch (err) {
      return this.modelFailed(err);
    }
    const model = completion.model;
    const text = completion.text.slice(0, PARSE_INPUT_CAP);
    const raw = (completion.raw ?? completion.text).slice(0, PARSE_INPUT_CAP);
    const parsed = parseSpec(text, { project: body.project });
    if (!parsed.ok) return outcome({ decision: 'refused', raw_output: raw, model, error: refusalOf(parsed) });
    return this.run(raw, model, parsed.spec, events.timezone);
  }

  /** The reader being refused while reading the catalog is L3 firing before a model was asked: an alarm and a decision, never a 500. */
  private catalogFailed(err: unknown): Outcome {
    if (err instanceof HttpException) return outcome({ decision: 'error', error: httpErrorOf(err) });
    if (pgErrorStatus(err) === 'refused_by_database') {
      this.logger.error(`the database refused the reader while reading the event catalog (pg ${pgErrorCode(err)}): ${(err as Error).message} — a grant or the role setup changed`);
      return outcome({ decision: 'refused_by_database', error: { code: 'REFUSED_BY_DATABASE', message: 'the database refused to read the event catalog' } });
    }
    this.logger.error(`reading the event catalog failed: ${detailOf(err)}`);
    return outcome({ decision: 'error', error: { code: 'INTERNAL', message: 'the event catalog could not be read' } });
  }

  private modelFailed(err: unknown): Outcome {
    if (err instanceof LlmTimeoutError || err instanceof LlmError) return outcome({ decision: 'error', error: { code: err.code, message: err.message } });
    this.logger.error(`the ${this.adapter} adapter failed outside its contract: ${detailOf(err)}`);
    return outcome({ decision: 'error', error: { code: 'INTERNAL', message: 'the model adapter failed' } });
  }

  private async run(raw: string, model: string, spec: QuerySpec, timezone: string): Promise<Outcome> {
    try {
      const result = await this.insights.run(spec, { timezone });
      const decision: AskDecision = result.meta.status === 'refused_by_database' ? 'refused_by_database' : 'ran';
      return outcome({ decision, raw_output: raw, model, spec, result });
    } catch (err) {
      if (err instanceof HttpException) return outcome({ decision: 'error', raw_output: raw, model, spec, error: httpErrorOf(err) });
      this.logger.error(`running a ${spec.kind} spec failed: ${detailOf(err)}`);
      return outcome({ decision: 'error', raw_output: raw, model, spec, error: { code: 'INTERNAL', message: 'the query could not be run' } });
    }
  }
}

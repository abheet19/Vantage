/**
 * port.ts — `LlmPort`: the only way the API talks to a model (LLD §3.3, verbatim).
 *
 * Why it exists: design §6.3 — `ask/` holds the only import of any adapter, and the port is deliberately
 * dumb: text in, text out, no tools other than the spec tool an adapter may offer, no side effects. A
 * model reached through this interface can do exactly one thing, emit text that L1 judges; there is no
 * method by which it could execute, fetch or write. The two error classes are the only outcomes an
 * adapter may raise besides success, and each maps to one `error.code` in the ask response — a caller
 * never has to string-match a message to know what happened.
 *
 * What it must never do: grow a method that returns anything but text, or let an adapter's own error
 * type (SDK exception, fetch failure) escape unmapped.
 */
import type { LlmMessages } from '../../domain/index.js';

export const LLM_PORT = 'LLM_PORT';
/** The adapter name (`LlmAdapterName` from config) written into every audit row's `adapter` column. */
export const LLM_ADAPTER = 'LLM_ADAPTER';

export interface LlmCompleteOptions {
  maxTokens: number;
  timeoutMs: number;
  /** The grammar as JSON Schema; an adapter that can constrain output uses it, one that cannot ignores it — L1 validates either way. */
  jsonSchema?: object;
}

export interface LlmCompletion {
  /** What L1 parses: the spec text, or the model's prose. */
  text: string;
  /** Everything the model said, for the audit row, when it differs from `text` (an adapter that received prose AND a tool call keeps both here, delimited); `text` is contained in it verbatim. */
  raw?: string;
  /** The model id the service reported (or the configured one when it reports none); written to the audit row. */
  model: string;
}

export interface LlmPort {
  /** Returns the model's text. The port is deliberately dumb: no tools, no side effects, so the only thing a model can do is emit text that L1 judges. */
  complete(messages: LlmMessages, opts: LlmCompleteOptions): Promise<LlmCompletion>;
}

/** The model did not answer within `timeoutMs`; the ask is audited as `error` / `LLM_TIMEOUT`. */
export class LlmTimeoutError extends Error {
  readonly code = 'LLM_TIMEOUT';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LlmTimeoutError';
  }
}

/** The model service answered with an error or was unreachable; the ask is audited as `error` / `LLM_ERROR`. */
export class LlmError extends Error {
  readonly code = 'LLM_ERROR';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LlmError';
  }
}

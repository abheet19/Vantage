/**
 * ollama.ts — `OllamaLlm`: the free, local adapter (design §0 A2), over `POST /api/chat`.
 *
 * Why it exists: $0 to run means a model on the operator's own machine, and Ollama's chat endpoint is
 * the one local API worth targeting. The request asks for constrained output — the grammar's JSON Schema
 * as `format` when the caller supplies one, plain `format: "json"` otherwise — because a small model
 * left to itself wraps JSON in prose; but the constraint is a convenience for the model, not a defence:
 * whatever comes back is text that L1 judges. `options.num_ctx` is set explicitly (S3 hardening): Ollama's
 * default context is 2 048 tokens, which the grammar and a fixture-sized catalog alone exceed, and a model
 * whose prompt was silently cut from the front has lost the grammar first. One request, no streaming,
 * `AbortSignal.timeout` for the 8 s bound — passed to fetch, so it ends a body that trickles in as surely
 * as a server that never answers — and the body is read through the stream with a 1 MiB cap: a reply past
 * the cap is abandoned (the reader is cancelled) and reported as `LlmError`, so a runaway server cannot
 * make this process buffer gigabytes before L1's 64 Ki cap ever applies. `fetch` is injectable so the unit
 * tests run against a fake server on loopback and never touch a real one.
 *
 * What it must never do: retry (a second 8 s wait would double the ask's worst case), stream tokens to
 * the caller (the answer is judged whole or not at all), or interpret the reply beyond extracting
 * `message.content`.
 */
import type { LlmMessages } from '../../domain/index.js';
import { LlmError, LlmTimeoutError, type LlmCompleteOptions, type LlmCompletion, type LlmPort } from './port.js';

const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';

/** The most a chat reply may occupy before it is abandoned; an honest spec is under 4 KiB. */
export const OLLAMA_RESPONSE_CAP_BYTES = 1_048_576;

export interface OllamaOptions {
  model: string;
  /** The context window asked of the model (`options.num_ctx`); `config.ts` reads it from `VANTAGE_OLLAMA_NUM_CTX`. */
  numCtx: number;
  baseUrl?: string;
  /** Test seam: a fetch pointed at a fake server. Production uses the global. */
  fetch?: typeof fetch;
}

interface ChatReply {
  model?: string;
  message?: { content?: unknown };
}

const isTimeout = (err: unknown): boolean => err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');

/** Reads a body up to `cap` bytes; one byte more cancels the stream and throws — the caller never holds an unbounded reply. */
async function readCapped(res: Response, cap: number): Promise<string> {
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => undefined);
      throw new LlmError(`ollama answered more than ${cap} bytes; the reply was abandoned`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class OllamaLlm implements LlmPort {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaOptions) {
    this.baseUrl = (options.baseUrl ?? OLLAMA_DEFAULT_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async complete(messages: LlmMessages, opts: LlmCompleteOptions): Promise<LlmCompletion> {
    const body = {
      model: this.options.model,
      stream: false,
      format: opts.jsonSchema ?? 'json',
      options: { num_predict: opts.maxTokens, num_ctx: this.options.numCtx, temperature: 0 },
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
    };
    const signal = AbortSignal.timeout(opts.timeoutMs);
    let reply: ChatReply;
    let status = 0;
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
      status = res.status;
      const text = await readCapped(res, OLLAMA_RESPONSE_CAP_BYTES);
      if (!res.ok) throw new LlmError(`ollama at ${this.baseUrl} answered ${status}: ${text.slice(0, 200)}`);
      reply = JSON.parse(text) as ChatReply;
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (isTimeout(err) || signal.aborted) throw new LlmTimeoutError(`ollama did not answer within ${opts.timeoutMs} ms`, { cause: err });
      if (err instanceof SyntaxError) throw new LlmError(`ollama answered ${status} with a body that is not JSON`, { cause: err });
      throw new LlmError(`ollama at ${this.baseUrl} is unreachable: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
    const text = reply.message?.content;
    if (typeof text !== 'string') throw new LlmError(`ollama answered ${status} without a message.content string`);
    return { text, model: typeof reply.model === 'string' ? reply.model : this.options.model };
  }
}

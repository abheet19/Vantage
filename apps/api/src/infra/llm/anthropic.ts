/**
 * anthropic.ts — `AnthropicLlm`: the paid, optional adapter (design §0 A2), through the official SDK.
 *
 * Why it exists: an operator who already pays for a Claude key gets the best translation quality, and
 * the way to ask a Claude model for structured output is a tool whose `input_schema` IS the grammar: the
 * model's only way to "act" is to call `query_spec` with an object the schema shapes, and that object is
 * returned here as text for L1 to validate like any other reply. The grammar's root is a `oneOf` over the
 * five kinds, and a tool's input schema must be an object, so the schema sits under one `spec` property.
 * The call is `tool_choice: auto` with parallel tool use disabled: a model that finds no analytics
 * question replies in prose, and L1 refuses the prose — a forced call would manufacture a spec for "drop
 * the events table". One call is one spec: a reply with more than one `tool_use` block, or one cut off by
 * `max_tokens`, is handed to L1 as the whole content array in JSON, which is not a spec and is refused
 * with the text kept (S3 hardening). When the model both wrote prose and called the tool, `text` is the
 * tool input (what L1 judges) and `raw` carries every block, delimited, so the audit row shows the whole
 * reply. The SDK client is built with `maxRetries: 0` (a second 8 s wait would double the worst case),
 * and the bound is applied twice: the SDK's `timeout`, which only covers the wait for response headers,
 * and an `AbortSignal.timeout` passed as `signal`, which the SDK forwards to fetch so a body that trickles
 * in one byte at a time is cut off at the same deadline (the S3 hostile review found the first alone left
 * the body unbounded). The SDK reads the body whole before this adapter sees it, so there is no byte cap
 * on the Anthropic side; the 64 Ki cap L1 applies is the bound on what is judged and stored. `baseURL` and
 * `fetch` are injectable so the unit tests talk to a fake server on loopback. The adapter is only
 * constructed when `VANTAGE_ANTHROPIC_API_KEY` is set (`select.ts`), the key goes into the SDK client and
 * nowhere else, and no error message here ever includes it.
 *
 * What it must never do: log or echo the key, offer the model a second tool, or treat a tool call as
 * anything more than text — validation is L1's, not the SDK's.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LlmMessages } from '../../domain/index.js';
import { LlmError, LlmTimeoutError, type LlmCompleteOptions, type LlmCompletion, type LlmPort } from './port.js';

export const SPEC_TOOL_NAME = 'query_spec';

type ClientOptions = NonNullable<ConstructorParameters<typeof Anthropic>[0]>;

export interface AnthropicOptions {
  apiKey: string;
  model: string;
  /** Test seam: a fake server on loopback. */
  baseUrl?: string;
  fetch?: ClientOptions['fetch'];
}

/** The one tool the model is offered: its input schema is the grammar, so the model can only "call" a spec. */
function specTool(jsonSchema: object): Anthropic.Tool {
  return {
    name: SPEC_TOOL_NAME,
    description: 'The query spec that answers the question. Its shape is the GRAMMAR schema from the system text.',
    input_schema: { type: 'object', properties: { spec: jsonSchema }, required: ['spec'], additionalProperties: false },
  };
}

const isToolUse = (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock => b.type === 'tool_use';
const isText = (b: Anthropic.ContentBlock): b is Anthropic.TextBlock => b.type === 'text';

/** The spec a tool call carries, as JSON text; a call without `spec` is returned whole so L1 refuses it by name. */
function specTextOf(call: Anthropic.ToolUseBlock): string {
  const input = call.input as { spec?: unknown };
  return JSON.stringify(input.spec ?? input);
}

/** Every block, in order, each under a one-line label — what the audit row shows when the reply was more than one block. */
function transcriptOf(message: Anthropic.Message): string {
  return message.content
    .map((b) => (isToolUse(b) ? `[tool_use ${b.name}]\n${JSON.stringify(b.input)}` : isText(b) ? `[text]\n${b.text}` : `[${b.type}]`))
    .join('\n');
}

/**
 * One tool call → its spec as `text`, with `raw` carrying the whole reply when prose came with it. No tool
 * call → the text blocks joined. More than one call, or a reply cut off by `max_tokens` → the whole content
 * array as JSON, which is not a spec: L1 refuses and the text shows exactly what came back.
 */
function completionOf(message: Anthropic.Message): Pick<LlmCompletion, 'text' | 'raw'> {
  const calls = message.content.filter(isToolUse);
  if (message.stop_reason === 'max_tokens' || calls.length > 1) {
    return { text: JSON.stringify(message.content), raw: `[stop_reason ${message.stop_reason}]\n${transcriptOf(message)}` };
  }
  const call = calls[0];
  if (!call) return { text: message.content.filter(isText).map((b) => b.text).join('\n') };
  const text = specTextOf(call);
  return message.content.length === 1 ? { text } : { text, raw: transcriptOf(message) };
}

export class AnthropicLlm implements LlmPort {
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, baseURL: options.baseUrl ?? null, fetch: options.fetch, maxRetries: 0 });
  }

  async complete(messages: LlmMessages, opts: LlmCompleteOptions): Promise<LlmCompletion> {
    const tools = opts.jsonSchema ? { tools: [specTool(opts.jsonSchema)], tool_choice: { type: 'auto' as const, disable_parallel_tool_use: true } } : {};
    // `timeout` bounds the wait for headers; `signal` reaches fetch and bounds the body too. Both, so a trickling body ends at the same deadline.
    const signal = AbortSignal.timeout(opts.timeoutMs);
    try {
      const message = await this.client.messages.create(
        { model: this.options.model, max_tokens: opts.maxTokens, system: messages.system, messages: [{ role: 'user', content: messages.user }], ...tools },
        { timeout: opts.timeoutMs, signal },
      );
      return { ...completionOf(message), model: message.model };
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIUserAbortError || signal.aborted) {
        throw new LlmTimeoutError(`anthropic did not answer within ${opts.timeoutMs} ms`, { cause: err });
      }
      if (err instanceof Anthropic.APIError) throw new LlmError(`anthropic answered ${err.status ?? 'no status'}: ${err.message.slice(0, 200)}`, { cause: err });
      throw new LlmError(`anthropic request failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    }
  }
}

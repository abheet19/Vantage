/**
 * anthropic-llm.spec.ts — the Anthropic adapter through the official SDK against a fake server on loopback: the one tool
 * whose input schema is the grammar (parallel tool use off), a tool call becoming spec text, prose staying prose, prose
 * AND a call keeping both in `raw`, two calls or a `max_tokens` cut-off handed to L1 as something it refuses, the key
 * reaching only the request header, and timeout (headers late OR body trickling) / API failures becoming the port's two
 * errors. No real Anthropic endpoint is ever called.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicLlm, SPEC_TOOL_NAME } from '../../src/infra/llm/anthropic.js';
import { LlmError, LlmTimeoutError } from '../../src/infra/llm/port.js';

interface Seen {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

interface Behaviour {
  status?: number;
  body?: unknown;
  delayMs?: number;
  /** Send 200 and headers at once, then one byte every 200 ms, never finishing. */
  trickle?: boolean;
}

const KEY = 'sk-ant-test-key-that-must-not-leak';
const MODEL = 'claude-haiku-4-5';
const SCHEMA = { oneOf: [{ type: 'object', properties: { kind: { const: 'count' } } }] };
const SPEC = { kind: 'count', event: { event: 'signup' } };
const toolUse = (id: string, input: unknown, name = SPEC_TOOL_NAME) => ({ type: 'tool_use', id, name, input });
const message = (content: unknown[], stop_reason = 'end_turn') => ({ id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });

let server: Server;
let baseUrl: string;
let behaviour: (seen: Seen) => Behaviour = () => ({});
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      const s: Seen = { url: req.url ?? '', headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> };
      seen.push(s);
      const b = behaviour(s);
      if (b.trickle) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"id":"msg_1","type":"message","role":"assistant","model":"m","content":[{"type":"text","text":"');
        const timer = setInterval(() => res.write('x'), 200);
        res.on('close', () => clearInterval(timer));
        return;
      }
      setTimeout(() => {
        res.writeHead(b.status ?? 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(b.body ?? message([toolUse('tu_1', { spec: SPEC })])));
      }, b.delayMs ?? 0);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  if (typeof address !== 'object' || !address) throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const messages = { system: 'SYSTEM TEXT', user: 'How many signed up?' };
const llm = () => new AnthropicLlm({ apiKey: KEY, model: MODEL, baseUrl });
const withSchema = { maxTokens: 700, timeoutMs: 2_000, jsonSchema: SCHEMA };

describe('AnthropicLlm', () => {
  it('offers exactly one tool whose input schema wraps the grammar, tool_choice auto with parallel use off, and returns the call’s spec as JSON text with no raw', async () => {
    behaviour = () => ({});
    const out = await llm().complete(messages, withSchema);
    expect(out).toEqual({ text: '{"kind":"count","event":{"event":"signup"}}', model: MODEL });
    const last = seen.at(-1)!;
    expect(last.url).toBe('/v1/messages');
    expect(last.body).toMatchObject({
      model: MODEL,
      max_tokens: 700,
      system: 'SYSTEM TEXT',
      messages: [{ role: 'user', content: 'How many signed up?' }],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    });
    const tools = last.body['tools'] as { name: string; input_schema: Record<string, unknown> }[];
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe(SPEC_TOOL_NAME);
    expect(tools[0]!.input_schema).toEqual({ type: 'object', properties: { spec: SCHEMA }, required: ['spec'], additionalProperties: false });
  });

  it('sends the key only as the x-api-key header — the request body never contains it', async () => {
    behaviour = () => ({});
    await llm().complete(messages, withSchema);
    const last = seen.at(-1)!;
    expect(last.headers['x-api-key']).toBe(KEY);
    expect(JSON.stringify(last.body)).not.toContain(KEY);
  });

  it('offers no tool when no schema is given, and returns prose as the joined text blocks', async () => {
    behaviour = () => ({ body: message([{ type: 'text', text: 'That is not ' }, { type: 'text', text: 'an analytics question.' }]) });
    const out = await llm().complete(messages, { maxTokens: 10, timeoutMs: 2_000 });
    expect(out.text).toBe('That is not \nan analytics question.');
    expect(out.raw).toBeUndefined();
    expect(seen.at(-1)!.body['tools']).toBeUndefined();
  });

  it('a tool call without a `spec` property is returned as the whole input, for L1 to refuse', async () => {
    behaviour = () => ({ body: message([toolUse('tu_2', { sql: 'DROP TABLE events' })]) });
    const out = await llm().complete(messages, withSchema);
    expect(out.text).toBe('{"sql":"DROP TABLE events"}');
  });

  it('prose and a tool call: text is the spec L1 judges, raw is every block delimited — the audit row shows the whole reply', async () => {
    behaviour = () => ({ body: message([{ type: 'text', text: 'Here is the query.' }, toolUse('tu_3', { spec: SPEC })]) });
    const out = await llm().complete(messages, withSchema);
    expect(out.text).toBe('{"kind":"count","event":{"event":"signup"}}');
    expect(out.raw).toBe(`[text]\nHere is the query.\n[tool_use ${SPEC_TOOL_NAME}]\n{"spec":{"kind":"count","event":{"event":"signup"}}}`);
    expect(out.raw).toContain(out.text);
  });

  it('two tool calls in one reply → the whole content as JSON text (not a spec: L1 refuses it), raw naming the stop reason', async () => {
    behaviour = () => ({ body: message([toolUse('a', { spec: SPEC }), toolUse('b', { spec: { kind: 'funnel' } })], 'tool_use') });
    const out = await llm().complete(messages, withSchema);
    const content = JSON.parse(out.text) as unknown[];
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(out.raw).toMatch(/^\[stop_reason tool_use\]\n\[tool_use query_spec\]/);
  });

  it('a reply cut off by max_tokens → the whole content as JSON text, even when it holds exactly one tool call', async () => {
    behaviour = () => ({ body: message([toolUse('a', { spec: SPEC })], 'max_tokens') });
    const out = await llm().complete(messages, withSchema);
    expect(JSON.parse(out.text)).toEqual([toolUse('a', { spec: SPEC })]);
    expect(out.raw).toMatch(/^\[stop_reason max_tokens\]/);
  });

  it('a server that answers after the timeout is LlmTimeoutError, and the SDK does not retry', async () => {
    behaviour = () => ({ delayMs: 600 });
    const before = seen.length;
    await expect(llm().complete(messages, { maxTokens: 10, timeoutMs: 150 })).rejects.toBeInstanceOf(LlmTimeoutError);
    await new Promise((r) => setTimeout(r, 700));
    expect(seen.length - before).toBe(1);
  });

  it('a server that sends headers at once and then trickles the body one byte every 200 ms is LlmTimeoutError at the same deadline (the SDK timeout alone only covered the headers)', async () => {
    behaviour = () => ({ trickle: true });
    const timeoutMs = 1_000;
    const started = Date.now();
    await expect(llm().complete(messages, { maxTokens: 10, timeoutMs })).rejects.toBeInstanceOf(LlmTimeoutError);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
    expect(elapsed).toBeLessThan(timeoutMs + 100);
  });

  it('an API error is LlmError naming the status, and its message does not contain the key', async () => {
    behaviour = () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    const err = await llm().complete(messages, { maxTokens: 10, timeoutMs: 2_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toMatch(/anthropic answered 401/);
    expect((err as Error).message).not.toContain(KEY);
  });

  it('a server that is not there is LlmError', async () => {
    const dead = new AnthropicLlm({ apiKey: KEY, model: 'm', baseUrl: 'http://127.0.0.1:9' });
    await expect(dead.complete(messages, { maxTokens: 10, timeoutMs: 2_000 })).rejects.toBeInstanceOf(LlmError);
  });

  it('accepts an injected fetch', async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response(JSON.stringify(message([{ type: 'text', text: 'hi' }])), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const out = await new AnthropicLlm({ apiKey: KEY, model: 'm', fetch: fake }).complete(messages, { maxTokens: 1, timeoutMs: 1_000 });
    expect(out.text).toBe('hi');
    expect(calls).toBe(1);
  });
});

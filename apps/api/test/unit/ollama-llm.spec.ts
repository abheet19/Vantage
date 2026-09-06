/**
 * ollama-llm.spec.ts — the Ollama adapter against a fake server on loopback: what it sends (schema as `format`, the
 * context window, temperature 0), what it returns, and that a slow, trickling, oversized, failing, malformed or absent
 * server becomes exactly one of the port's two errors. No real Ollama is ever called.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LlmError, LlmTimeoutError } from '../../src/infra/llm/port.js';
import { OLLAMA_RESPONSE_CAP_BYTES, OllamaLlm } from '../../src/infra/llm/ollama.js';

interface Seen {
  url: string;
  body: Record<string, unknown>;
}

interface Behaviour {
  status?: number;
  body?: unknown;
  delayMs?: number;
  /** Send 200 and headers at once, then one byte every 200 ms, never finishing. */
  trickle?: boolean;
}

let server: Server;
let baseUrl: string;
let behaviour: (seen: Seen) => Behaviour = () => ({});
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      const s = { url: req.url ?? '', body: JSON.parse(raw) as Record<string, unknown> };
      seen.push(s);
      const b = behaviour(s);
      if (b.trickle) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{"model":"m","message":{"role":"assistant","content":"');
        const timer = setInterval(() => res.write('x'), 200);
        res.on('close', () => clearInterval(timer));
        return;
      }
      setTimeout(() => {
        res.writeHead(b.status ?? 200, { 'content-type': 'application/json' });
        res.end(typeof b.body === 'string' ? b.body : JSON.stringify(b.body ?? { model: 'fake:latest', message: { role: 'assistant', content: '{"kind":"count"}' } }));
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
const llm = () => new OllamaLlm({ model: 'llama3.1', numCtx: 16_384, baseUrl });

describe('OllamaLlm', () => {
  it('POSTs /api/chat with the model, both messages, no streaming, temperature 0, the context window and the JSON Schema as `format`', async () => {
    behaviour = () => ({});
    const schema = { type: 'object', properties: { kind: { type: 'string' } } };
    const out = await llm().complete(messages, { maxTokens: 512, timeoutMs: 2_000, jsonSchema: schema });
    expect(out).toEqual({ text: '{"kind":"count"}', model: 'fake:latest' });
    const last = seen.at(-1)!;
    expect(last.url).toBe('/api/chat');
    expect(last.body).toMatchObject({
      model: 'llama3.1',
      stream: false,
      format: schema,
      options: { num_predict: 512, num_ctx: 16_384, temperature: 0 },
      messages: [
        { role: 'system', content: 'SYSTEM TEXT' },
        { role: 'user', content: 'How many signed up?' },
      ],
    });
  });

  it('asks for plain `format: "json"` when no schema is given, and falls back to the configured model name when the reply has none', async () => {
    behaviour = () => ({ body: { message: { content: 'x' } } });
    const out = await llm().complete(messages, { maxTokens: 10, timeoutMs: 2_000 });
    expect(out).toEqual({ text: 'x', model: 'llama3.1' });
    expect(seen.at(-1)!.body['format']).toBe('json');
  });

  it('a server that answers after the timeout is LlmTimeoutError, and the adapter does not retry', async () => {
    behaviour = () => ({ delayMs: 400 });
    const before = seen.length;
    await expect(llm().complete(messages, { maxTokens: 10, timeoutMs: 100 })).rejects.toBeInstanceOf(LlmTimeoutError);
    await new Promise((r) => setTimeout(r, 450));
    expect(seen.length - before).toBe(1);
  });

  it('a server that sends headers at once and then trickles the body one byte every 200 ms is LlmTimeoutError at the same deadline', async () => {
    behaviour = () => ({ trickle: true });
    const timeoutMs = 1_000;
    const started = Date.now();
    await expect(llm().complete(messages, { maxTokens: 10, timeoutMs })).rejects.toBeInstanceOf(LlmTimeoutError);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(timeoutMs - 50);
    expect(elapsed).toBeLessThan(timeoutMs + 100);
  });

  it(`a body over ${OLLAMA_RESPONSE_CAP_BYTES} bytes is abandoned as LlmError naming the cap, well before the timeout`, async () => {
    behaviour = () => ({ body: JSON.stringify({ model: 'm', message: { content: 'x'.repeat(2 * OLLAMA_RESPONSE_CAP_BYTES) } }) });
    const started = Date.now();
    const err = await llm().complete(messages, { maxTokens: 10, timeoutMs: 8_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toMatch(new RegExp(`more than ${OLLAMA_RESPONSE_CAP_BYTES} bytes`));
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it('a non-2xx answer is LlmError naming the status, with the body clipped', async () => {
    behaviour = () => ({ status: 500, body: 'model "llama3.1" not found, try pulling it first' });
    const err = await llm().complete(messages, { maxTokens: 10, timeoutMs: 2_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toMatch(/answered 500: .*not found/);
  });

  it('a 200 whose body is not JSON is LlmError, not a SyntaxError escaping the port', async () => {
    behaviour = () => ({ body: 'not json at all' });
    const err = await llm().complete(messages, { maxTokens: 10, timeoutMs: 2_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toMatch(/answered 200 with a body that is not JSON/);
  });

  it('a 200 without message.content is LlmError, not an undefined text', async () => {
    behaviour = () => ({ body: { model: 'fake', message: {} } });
    await expect(llm().complete(messages, { maxTokens: 10, timeoutMs: 2_000 })).rejects.toBeInstanceOf(LlmError);
  });

  it('a server that is not there is LlmError naming the base URL', async () => {
    const dead = new OllamaLlm({ model: 'llama3.1', numCtx: 16_384, baseUrl: 'http://127.0.0.1:9/' });
    const err = await dead.complete(messages, { maxTokens: 10, timeoutMs: 2_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as Error).message).toMatch(/http:\/\/127\.0\.0\.1:9 is unreachable/);
  });

  it('accepts an injected fetch and strips a trailing slash from the base URL', async () => {
    const calls: string[] = [];
    const fake: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ model: 'm', message: { content: 'ok' } }), { status: 200 });
    };
    const out = await new OllamaLlm({ model: 'm', numCtx: 4_096, baseUrl: 'http://example.invalid/', fetch: fake }).complete(messages, { maxTokens: 1, timeoutMs: 1_000 });
    expect(out.text).toBe('ok');
    expect(calls).toEqual(['http://example.invalid/api/chat']);
  });
});

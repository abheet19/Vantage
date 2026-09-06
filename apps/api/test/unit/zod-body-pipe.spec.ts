/**
 * zod-body-pipe.spec.ts — validation errors carry the event index, batches over 500 are 413, and a
 * `__proto__` key is rejected rather than stripped.
 */
import { HttpException } from '@nestjs/common';
import { FunnelSpec, IngestBatch } from '@vantage/contracts';
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { ZodBodyPipe, issueToHttpException } from '../../src/infra/http/zod-body.pipe.js';

const metadata = { type: 'body' as const, schema: IngestBatch, metatype: undefined, data: undefined };

async function failure(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await new ZodBodyPipe().transform(body, metadata);
  } catch (err) {
    const e = err as HttpException;
    return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
  }
  throw new Error('expected the pipe to reject');
}

describe('ZodBodyPipe', () => {
  it('returns the parsed value for a valid batch', async () => {
    const out = await new ZodBodyPipe().transform({ events: [{ event: 'signup', distinct_id: 'p01', insert_id: 'k' }] }, metadata);
    expect(out).toEqual({ events: [{ event: 'signup', distinct_id: 'p01', insert_id: 'k' }] });
  });

  it('names the index of the bad event in a 422', async () => {
    const events = [{ event: 'ok', distinct_id: 'a', insert_id: 'a' }, { event: 'ok', distinct_id: 'b', insert_id: 'b' }, { event: '', distinct_id: 'c', insert_id: 'c' }];
    const r = await failure({ events });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'INVALID_BODY', index: 2, path: 'events.2.event' });
  });

  it('answers 413 when the batch has more than 500 events, even when every event also has its own issue (too_big is found by code, not by being first)', async () => {
    const events = Array.from({ length: 501 }, (_, i) => ({ event: 'e', distinct_id: `d${i}` }));
    const r = await failure({ events });
    expect(r.status).toBe(413);
    expect(r.body).toMatchObject({ code: 'BATCH_TOO_LARGE', path: 'events' });
  });

  it('rejects a __proto__ property key with the index instead of silently deleting it', async () => {
    const body = JSON.parse('{"events":[{"event":"e","distinct_id":"d","insert_id":"k","properties":{"__proto__":{"polluted":true}}}]}');
    const r = await failure(body);
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ index: 0, path: 'events.0.properties.__proto__' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('answers 422 without an index when the envelope itself is wrong', async () => {
    const r = await failure({ sent_at: 'yesterday', events: [{ event: 'e', distinct_id: 'd', insert_id: 'k' }] });
    expect(r.status).toBe(422);
    expect(r.body).toEqual({ code: 'INVALID_BODY', message: expect.any(String), path: 'sent_at' });
  });

  it('names a keyless, timestampless event by its index and points the SDK author at insert_id', async () => {
    const r = await failure({ events: [{ event: 'e', distinct_id: 'd', insert_id: 'k' }, { event: 'e', distinct_id: 'd' }] });
    expect(r.status).toBe(422);
    expect(r.body).toMatchObject({ code: 'INVALID_BODY', index: 1, path: 'events.1', message: expect.stringMatching(/insert_id \(preferred\)/) });
  });

  it('reports a smuggled key at the key itself: in the envelope without an index, in an event with its index', async () => {
    const envelope = await failure({ project_id: 'x', events: [{ event: 'e', distinct_id: 'd', insert_id: 'k' }] });
    expect(envelope.body).toEqual({ code: 'INVALID_BODY', message: expect.stringMatching(/project_id/), path: 'project_id' });
    const event = await failure({ events: [{ event: 'e', distinct_id: 'd', insert_id: 'k', insertId: 'typo' }] });
    expect(event.body).toMatchObject({ index: 0, path: 'events.0.insertId' });
  });

  it('passes values through untouched when the parameter carries no schema', async () => {
    const out = await new ZodBodyPipe().transform({ anything: 1 }, { type: 'body', metatype: undefined, data: undefined });
    expect(out).toEqual({ anything: 1 });
  });

  it('reports a bad query spec as INVALID_SPEC naming the field, and a smuggled key at the key itself', async () => {
    const spec = { type: 'body' as const, schema: FunnelSpec, metatype: undefined, data: undefined };
    const valid = { kind: 'funnel', project: '0190f3a0-0000-7000-8000-000000000000', range: { from: '2026-08-01', to: '2026-08-31' }, steps: [{ event: 'a' }, { event: 'b' }] };
    const kind = await new ZodBodyPipe().transform({ ...valid, kind: 'retention' }, spec).catch((e: HttpException) => e);
    expect((kind as HttpException).getStatus()).toBe(422);
    expect((kind as HttpException).getResponse()).toMatchObject({ code: 'INVALID_SPEC', path: 'kind' });
    const smuggled = await new ZodBodyPipe().transform({ ...valid, sql: 'DROP TABLE events' }, spec).catch((e: HttpException) => e);
    expect((smuggled as HttpException).getResponse()).toMatchObject({ code: 'INVALID_SPEC', path: 'sql' });
    const parsed = (await new ZodBodyPipe().transform(valid, spec)) as { order: string };
    expect(parsed.order).toBe('sequential');
  });
});

describe('issueToHttpException', () => {
  it('handles an empty issue list with a generic 422', () => {
    const e = issueToHttpException([]);
    expect(e.getStatus()).toBe(422);
    expect(e.getResponse()).toEqual({ code: 'INVALID_BODY', message: 'invalid body', path: '' });
  });

  it('accepts Standard Schema path segments given as { key } objects', () => {
    const e = issueToHttpException([{ message: 'bad', path: [{ key: 'events' }, { key: 7 }, { key: 'event' }] }]);
    expect(e.getResponse()).toMatchObject({ index: 7, path: 'events.7.event' });
  });
});

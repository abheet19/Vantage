/**
 * normalize-event.spec.ts — the row an event becomes, decided without a database.
 */
import { describe, expect, it } from 'vitest';
import { deriveInsertId } from '../../src/domain/derive-insert-id.js';
import { normalizeEvent } from '../../src/domain/normalize-event.js';

const SERVER = new Date('2026-09-02T00:00:00Z');
const mint = () => '019000000-0000-7000-8000-000000000001';

describe('normalizeEvent', () => {
  it('uses the client insert_id when present and records key_source client', () => {
    const r = normalizeEvent({ event: 'signup', distinct_id: 'p01', insert_id: 'p01-signup' }, null, SERVER, mint);
    expect(r.insert_id).toBe('p01-signup');
    expect(r.key_source).toBe('client');
  });

  it('derives the insert_id when absent and records key_source derived', () => {
    const r = normalizeEvent({ event: 'signup', distinct_id: 'p02', timestamp: '2026-08-03T09:00:00Z' }, null, SERVER, mint);
    expect(r.key_source).toBe('derived');
    expect(r.insert_id).toBe(deriveInsertId({ distinct_id: 'p02', event: 'signup', client_ts: '2026-08-03T09:00:00.000Z', properties: {} }));
  });

  it('derives the same key for the same instant written with a different UTC offset', () => {
    const a = normalizeEvent({ event: 'signup', distinct_id: 'p02', timestamp: '2026-08-03T14:30:00+05:30' }, null, SERVER, mint);
    const b = normalizeEvent({ event: 'signup', distinct_id: 'p02', timestamp: '2026-08-03T09:00:00Z' }, null, SERVER, mint);
    expect(a.insert_id).toBe(b.insert_id);
  });

  it('defaults properties to an empty object and keeps the given object by reference-free copy semantics', () => {
    const r = normalizeEvent({ event: 'x', distinct_id: 'd', insert_id: 'k' }, null, SERVER, mint);
    expect(r.properties).toEqual({});
    const withProps = normalizeEvent({ event: 'x', distinct_id: 'd', insert_id: 'k', properties: { a: 1 } }, null, SERVER, mint);
    expect(withProps.properties).toEqual({ a: 1 });
  });

  it('mints the event_id through the injected function and stamps server_ts and sent_at', () => {
    const sent = new Date('2026-09-01T23:59:00Z');
    const r = normalizeEvent({ event: 'x', distinct_id: 'd', timestamp: '2026-08-01T00:00:00Z' }, sent, SERVER, mint);
    expect(r.event_id).toBe(mint());
    expect(r.server_ts).toEqual(SERVER);
    expect(r.sent_at).toEqual(sent);
    expect(r.client_ts).toEqual(new Date('2026-08-01T00:00:00Z'));
  });

  it('applies the §1.4 rule: a 3 h skew shifts event_ts and labels it client_shifted', () => {
    const r = normalizeEvent({ event: 'x', distinct_id: 'p12', timestamp: '2026-08-14T08:00:00Z' }, new Date('2026-09-01T21:00:00Z'), SERVER, mint);
    expect(r.event_ts).toEqual(new Date('2026-08-14T11:00:00Z'));
    expect(r.ts_source).toBe('client_shifted');
    expect(r.too_old).toBe(false);
  });

  it('flags too_old for an event 458 days before server_ts without altering event_ts', () => {
    const r = normalizeEvent({ event: 'x', distinct_id: 'p01', timestamp: '2025-06-01T10:00:00Z' }, SERVER, SERVER, mint);
    expect(r.too_old).toBe(true);
    expect(r.event_ts).toEqual(new Date('2025-06-01T10:00:00Z'));
  });

  it('a missing timestamp (allowed when insert_id is present) yields client_ts null, event_ts = server_ts, ts_source server', () => {
    const r = normalizeEvent({ event: 'x', distinct_id: 'd', insert_id: 'k' }, SERVER, SERVER, mint);
    expect(r.client_ts).toBeNull();
    expect(r.event_ts).toEqual(SERVER);
    expect(r.ts_source).toBe('server');
  });
});

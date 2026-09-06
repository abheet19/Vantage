/**
 * adjust-timestamp.spec.ts — V8 (clock rule) as a property, plus the six rows of design §1.4 as examples.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SKEW_TOLERANCE_MS, TOO_OLD_MS, adjustTimestamp } from '../../src/domain/adjust-timestamp.js';

const SERVER = new Date('2026-09-02T00:00:00Z');
const at = (offsetMs: number) => new Date(SERVER.getTime() + offsetMs);
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('adjustTimestamp: the six rows of design §1.4', () => {
  it('row 1: a missing client timestamp uses server_ts and is labelled server', () => {
    expect(adjustTimestamp(null, at(-HOUR), SERVER)).toEqual({ eventTs: SERVER, source: 'server', tooOld: false });
  });

  it('row 2: without sent_at a past client timestamp is trusted as client', () => {
    expect(adjustTimestamp(at(-2 * HOUR), null, SERVER)).toEqual({ eventTs: at(-2 * HOUR), source: 'client', tooOld: false });
  });

  it('row 2: without sent_at a client timestamp 30 s in the future is clamped to server_ts but still labelled client (jitter)', () => {
    expect(adjustTimestamp(at(30_000), null, SERVER)).toEqual({ eventTs: SERVER, source: 'client', tooOld: false });
  });

  it('row 2 + §9: without sent_at a client timestamp in 2031 is clamped to server_ts and labelled server', () => {
    expect(adjustTimestamp(new Date('2031-01-01T00:00:00Z'), null, SERVER)).toEqual({ eventTs: SERVER, source: 'server', tooOld: false });
  });

  it('row 3: a skew within 60 s leaves the client timestamp alone', () => {
    expect(adjustTimestamp(at(-HOUR), at(-45_000), SERVER)).toEqual({ eventTs: at(-HOUR), source: 'client', tooOld: false });
    expect(adjustTimestamp(at(-HOUR), at(+MIN), SERVER)).toEqual({ eventTs: at(-HOUR), source: 'client', tooOld: false });
  });

  it('row 4: a device 3 h behind (sent_at = server − 3 h) shifts the event forward by exactly 3 h', () => {
    const r = adjustTimestamp(new Date('2026-08-14T08:00:00Z'), at(-3 * HOUR), SERVER);
    expect(r).toEqual({ eventTs: new Date('2026-08-14T11:00:00Z'), source: 'client_shifted', tooOld: false });
  });

  it('row 4: a device 3 h ahead (sent_at = server + 3 h) shifts the event back by exactly 3 h', () => {
    const r = adjustTimestamp(new Date('2026-08-14T11:00:00Z'), at(+3 * HOUR), SERVER);
    expect(r).toEqual({ eventTs: new Date('2026-08-14T08:00:00Z'), source: 'client_shifted', tooOld: false });
  });

  it('row 5 (finally): an event more than 60 s in the future after adjustment is clamped to server_ts and labelled server', () => {
    expect(adjustTimestamp(new Date('2031-01-01T00:00:00Z'), SERVER, SERVER)).toEqual({ eventTs: SERVER, source: 'server', tooOld: false });
    expect(adjustTimestamp(at(5 * MIN), at(-10_000), SERVER)).toEqual({ eventTs: SERVER, source: 'server', tooOld: false });
  });

  it('row 5 (finally): exactly server_ts + 60 s is allowed and keeps its label', () => {
    expect(adjustTimestamp(at(MIN), SERVER, SERVER)).toEqual({ eventTs: at(MIN), source: 'client', tooOld: false });
  });

  it('row 6: an event older than 366 days is accepted but flagged too_old', () => {
    expect(adjustTimestamp(at(-400 * DAY), SERVER, SERVER)).toEqual({ eventTs: at(-400 * DAY), source: 'client', tooOld: true });
    expect(adjustTimestamp(at(-TOO_OLD_MS), SERVER, SERVER).tooOld).toBe(false);
    expect(adjustTimestamp(at(-TOO_OLD_MS - 1), SERVER, SERVER).tooOld).toBe(true);
  });
});

const arbInstant = fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2032, 0, 1) }).map((ms) => new Date(ms));
const arbMaybeInstant = fc.option(arbInstant, { nil: null });

describe('adjustTimestamp: V8 property over random client/sent/server instants', () => {
  it('never returns an event_ts later than server_ts + 60 s', () => {
    fc.assert(
      fc.property(arbMaybeInstant, arbMaybeInstant, arbInstant, (client, sent, server) => {
        const r = adjustTimestamp(client, sent, server);
        return r.eventTs.getTime() <= server.getTime() + SKEW_TOLERANCE_MS;
      }),
      { numRuns: 2_000 },
    );
  });

  it('a skew larger than 60 s shifts by exactly the skew whenever the event was created before its upload', () => {
    const arbSkew = fc.integer({ min: SKEW_TOLERANCE_MS + 1, max: 30 * DAY }).chain((abs) => fc.constantFrom(abs, -abs));
    fc.assert(
      fc.property(arbInstant, arbSkew, fc.integer({ min: 0, max: 30 * DAY }), (server, skew, age) => {
        const sent = new Date(server.getTime() - skew);
        const client = new Date(sent.getTime() - age);
        const r = adjustTimestamp(client, sent, server);
        return r.source === 'client_shifted' && r.eventTs.getTime() - client.getTime() === skew;
      }),
      { numRuns: 2_000 },
    );
  });

  it('preserves the order of events within a batch (all created before the upload)', () => {
    fc.assert(
      fc.property(arbInstant, fc.integer({ min: -30 * DAY, max: 30 * DAY }), fc.array(fc.integer({ min: 0, max: 30 * DAY }), { minLength: 2, maxLength: 20 }), (server, skew, ages) => {
        const sent = new Date(server.getTime() - skew);
        const clients = ages.map((a) => new Date(sent.getTime() - a)).sort((a, b) => a.getTime() - b.getTime());
        const adjusted = clients.map((c) => adjustTimestamp(c, sent, server).eventTs.getTime());
        return adjusted.every((t, i) => i === 0 || (adjusted[i - 1] as number) <= t);
      }),
      { numRuns: 1_000 },
    );
  });

  it('is total: every combination yields one of the three sources and a boolean too_old', () => {
    fc.assert(
      fc.property(arbMaybeInstant, arbMaybeInstant, arbInstant, (client, sent, server) => {
        const r = adjustTimestamp(client, sent, server);
        return ['client', 'client_shifted', 'server'].includes(r.source) && typeof r.tooOld === 'boolean' && !Number.isNaN(r.eventTs.getTime());
      }),
    );
  });
});

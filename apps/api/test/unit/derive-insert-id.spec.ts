/**
 * derive-insert-id.spec.ts — V11: derived keys are deterministic and canonical.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson, deriveInsertId } from '../../src/domain/derive-insert-id.js';

const arbScalar = fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null));
const arbProps = fc.dictionary(fc.string({ minLength: 1 }).filter((k) => !['__proto__', 'constructor', 'prototype'].includes(k)), fc.oneof(arbScalar, fc.array(arbScalar), fc.dictionary(fc.string({ minLength: 1 }), arbScalar)), {
  maxKeys: 8,
});

function shuffled<T extends Record<string, unknown>>(obj: T, seed: number): T {
  const keys = Object.keys(obj);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = (seed + i * 7919) % (i + 1);
    [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
  }
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as T;
}

describe('deriveInsertId (V11)', () => {
  it('returns 32 lowercase hex characters', () => {
    expect(deriveInsertId({ distinct_id: 'p02', event: 'signup', client_ts: '2026-08-03T09:00:00.000Z', properties: { plan: 'team' } })).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is deterministic: the same logical event derives the same key every time', () => {
    const e = { distinct_id: 'p02', event: 'signup', client_ts: '2026-08-03T09:00:00.000Z', properties: { plan: 'team', n: 1 } };
    expect(deriveInsertId(e)).toBe(deriveInsertId({ ...e }));
  });

  it('property: property key order is irrelevant to the key', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.option(fc.date({ noInvalidDate: true }).map((d) => d.toISOString()), { nil: null }), arbProps, fc.nat(), (distinct_id, event, client_ts, properties, seed) => {
        const a = deriveInsertId({ distinct_id, event, client_ts, properties });
        const b = deriveInsertId({ distinct_id, event, client_ts, properties: shuffled(properties, seed) });
        return a === b;
      }),
      { numRuns: 500 },
    );
  });

  it('property: changing any one field changes the key', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), arbProps, fc.string({ minLength: 1 }), (distinct_id, event, properties, extra) => {
        const base = { distinct_id, event, client_ts: null, properties };
        const otherEvent = deriveInsertId({ ...base, event: event + extra });
        const otherId = deriveInsertId({ ...base, distinct_id: distinct_id + extra });
        const otherTs = deriveInsertId({ ...base, client_ts: '2026-01-01T00:00:00.000Z' });
        const otherProps = deriveInsertId({ ...base, properties: { ...properties, [`__vantage_probe_${extra}`]: extra } });
        const original = deriveInsertId(base);
        return new Set([original, otherEvent, otherId, otherTs, otherProps]).size === 5;
      }),
      { numRuns: 300 },
    );
  });

  it('hashes the parts as a JSON array so field boundaries cannot be shifted ("ab"+"c" ≠ "a"+"bc")', () => {
    const a = deriveInsertId({ distinct_id: 'ab', event: 'c', client_ts: null, properties: {} });
    const b = deriveInsertId({ distinct_id: 'a', event: 'bc', client_ts: null, properties: {} });
    expect(a).not.toBe(b);
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops whitespace', () => {
    expect(canonicalJson({ b: { z: 1, a: [3, { y: 1, x: 2 }] }, a: 'x' })).toBe('{"a":"x","b":{"a":[3,{"x":2,"y":1}],"z":1}}');
  });

  it('keeps array order (arrays are values, not sets)', () => {
    expect(canonicalJson([2, 1])).toBe('[2,1]');
  });

  it('serialises scalars like JSON.stringify', () => {
    expect(canonicalJson('s')).toBe('"s"');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(1.5)).toBe('1.5');
  });
});

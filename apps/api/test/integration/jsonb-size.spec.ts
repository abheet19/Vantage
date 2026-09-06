/**
 * jsonb-size.spec.ts — `inspectJson().jsonbBytes` is never below `pg_column_size(…::jsonb)`, so a Zod-valid payload never trips the 64 KiB CHECK.
 */
import { FORBIDDEN_KEYS, inspectJson, isStorableText } from '@vantage/contracts';
import fc from 'fast-check';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

let db: pg.Pool;
beforeAll(() => {
  db = new pg.Pool({ connectionString: inject('dbOwnerUrl'), max: 2 });
});
afterAll(async () => {
  await db.end();
});

/** Limits switched off: this suite measures; the contracts suite is where the bounds are asserted. */
const MEASURE_ONLY = { maxDepth: 64, maxKeys: 1_000_000, maxBytes: Number.MAX_SAFE_INTEGER };

const pgSize = async (v: unknown): Promise<number> => Number((await db.query<{ n: number }>('SELECT pg_column_size($1::jsonb) AS n', [JSON.stringify(v)])).rows[0]?.n);
const estimate = (v: unknown): number => {
  const r = inspectJson(v, MEASURE_ONLY);
  if (!r.ok) throw new Error(r.message);
  return r.jsonbBytes;
};

const text = fc.string({ unit: 'grapheme', maxLength: 12 }).filter(isStorableText);
const key = text.filter((k) => !FORBIDDEN_KEYS.has(k));
const number = fc.oneof(fc.integer(), fc.double({ noNaN: true, noDefaultInfinity: true }).filter((d) => !Number.isInteger(d) || Number.isSafeInteger(d)));
const scalar = fc.oneof(text, number, fc.boolean(), fc.constant(null));
const { value } = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof({ maxDepth: 3, depthSize: 'small' }, scalar, fc.array(tie('value'), { maxLength: 6 }), fc.dictionary(key, tie('value'), { maxKeys: 6 })),
}));
const properties = fc.dictionary(key, value, { maxKeys: 8 });

describe('jsonb size estimate against PostgreSQL', () => {
  it('property: for 100 random property objects the estimate is at least pg_column_size', async () => {
    await fc.assert(
      fc.asyncProperty(properties, async (v) => {
        expect(estimate(v)).toBeGreaterThanOrEqual(await pgSize(v));
      }),
      { numRuns: 100 },
    );
  });

  it('reviewer case: { k: 65 520 × "v" } is under the 64 KiB text limit yet over the jsonb CHECK, and the estimate agrees', async () => {
    const v = { k: 'v'.repeat(65_520) };
    const actual = await pgSize(v);
    expect(actual).toBeGreaterThan(65_536);
    expect(estimate(v)).toBeGreaterThanOrEqual(actual);
    expect(inspectJson(v).ok).toBe(false);
  });

  it('reviewer case: 5 000 × ["a", {}] is 65 017 bytes without padding and over 80 000 with it; the estimate agrees with PostgreSQL', async () => {
    const v = { a: Array.from({ length: 10_000 }, (_, i) => (i % 2 === 0 ? 'a' : {})) };
    const actual = await pgSize(v);
    expect(actual).toBeGreaterThan(80_000);
    expect(estimate(v)).toBeGreaterThanOrEqual(actual);
    expect(inspectJson(v).ok).toBe(false);
  });

  it('the estimate is exact, not merely safe, for the common shapes: an empty object, strings, small integers and nested containers', async () => {
    for (const v of [{}, { a: 'x' }, { a: 1, b: [1, 2, 3] }, { a: { b: { c: [{}, [], 'd'] } } }, { n: Array.from({ length: 100 }, (_, i) => i) }]) {
      expect(estimate(v)).toBe(await pgSize(v));
    }
  });
});

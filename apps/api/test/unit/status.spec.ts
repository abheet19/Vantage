/**
 * status.spec.ts — V9: `complete` only for a clean run under the cap; timeouts and refusals never look like data.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PG_ERROR_STATUS, statusOf } from '../../src/domain/status.js';

describe('statusOf', () => {
  it('pg 57014 (statement_timeout) is timed_out, whatever rows came back', () => {
    expect(statusOf({ rows: 0, rowCap: 10, error: { code: '57014' } })).toBe('timed_out');
    expect(statusOf({ rows: 5, rowCap: 10, error: { code: '57014' } })).toBe('timed_out');
  });

  it('pg 42501 (insufficient_privilege) and 25006 (read_only_sql_transaction) are refused_by_database', () => {
    expect(statusOf({ rows: 0, rowCap: 10, error: { code: '42501' } })).toBe('refused_by_database');
    expect(statusOf({ rows: 0, rowCap: 10, error: { code: '25006' } })).toBe('refused_by_database');
  });

  it('an unmapped error code throws rather than becoming a status the reader could mistake for data', () => {
    expect(() => statusOf({ rows: 0, rowCap: 10, error: { code: '22P02' } })).toThrow(/22P02/);
  });

  it('zero rows is empty; more rows than the cap is truncated; anything else is complete', () => {
    expect(statusOf({ rows: 0, rowCap: 10 })).toBe('empty');
    expect(statusOf({ rows: 11, rowCap: 10 })).toBe('truncated');
    expect(statusOf({ rows: 10, rowCap: 10 })).toBe('complete');
    expect(statusOf({ rows: 1, rowCap: 10 })).toBe('complete');
  });

  it('V9 as a property: complete ⇒ rows ≤ rowCap ∧ no error', () => {
    const arbError = fc.option(fc.constantFrom(...Object.keys(PG_ERROR_STATUS)).map((code) => ({ code })), { nil: undefined });
    fc.assert(
      fc.property(fc.nat(20_000), fc.integer({ min: 1, max: 20_000 }), arbError, (rows, rowCap, error) => {
        const status = statusOf(error ? { rows, rowCap, error } : { rows, rowCap });
        if (status === 'complete') return rows <= rowCap && rows > 0 && error === undefined;
        if (error) return status === PG_ERROR_STATUS[error.code];
        return status === (rows === 0 ? 'empty' : 'truncated');
      }),
      { numRuns: 2_000 },
    );
  });
});

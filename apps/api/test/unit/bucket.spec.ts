/**
 * bucket.spec.ts — bucketOf reproduces `date_trunc(unit, ts AT TIME ZONE tz)` for the design's own examples;
 * the 1 000-instant comparison against PostgreSQL itself is bucket-vs-sql.spec (integration).
 */
import { describe, expect, it } from 'vitest';
import { bucketOf } from '../../src/domain/bucket.js';

describe('bucketOf', () => {
  it('V5 seed fact: 2026-08-31T18:45Z is the Sep 1 day bucket in Asia/Kolkata and Aug 31 in UTC', () => {
    const ts = new Date('2026-08-31T18:45:00Z');
    expect(bucketOf(ts, 'Asia/Kolkata', 'day')).toBe('2026-09-01T00:00:00');
    expect(bucketOf(ts, 'UTC', 'day')).toBe('2026-08-31T00:00:00');
  });

  it('hour buckets start at the local hour, including half-hour zones', () => {
    expect(bucketOf(new Date('2026-08-31T18:45:00Z'), 'Asia/Kolkata', 'hour')).toBe('2026-09-01T00:00:00');
    expect(bucketOf(new Date('2026-08-31T18:29:59Z'), 'Asia/Kolkata', 'hour')).toBe('2026-08-31T23:00:00');
  });

  it('week buckets start on Monday (ISO, as date_trunc does)', () => {
    expect(bucketOf(new Date('2026-08-31T18:45:00Z'), 'Asia/Kolkata', 'week')).toBe('2026-08-31T00:00:00');
    expect(bucketOf(new Date('2026-08-30T12:00:00Z'), 'UTC', 'week')).toBe('2026-08-24T00:00:00');
    expect(bucketOf(new Date('2026-03-01T12:00:00Z'), 'UTC', 'week')).toBe('2026-02-23T00:00:00');
  });

  it('month buckets are the first of the local month', () => {
    expect(bucketOf(new Date('2026-08-31T18:45:00Z'), 'Asia/Kolkata', 'month')).toBe('2026-09-01T00:00:00');
    expect(bucketOf(new Date('2026-08-31T18:45:00Z'), 'UTC', 'month')).toBe('2026-08-01T00:00:00');
  });

  it('DST: London 01:30 local is one instant on 2026-03-29 and two instants on 2026-10-25 — both bucket to the local hour', () => {
    expect(bucketOf(new Date('2026-03-29T00:30:00Z'), 'Europe/London', 'hour')).toBe('2026-03-29T00:00:00');
    expect(bucketOf(new Date('2026-03-29T01:30:00Z'), 'Europe/London', 'hour')).toBe('2026-03-29T02:00:00');
    expect(bucketOf(new Date('2026-10-25T00:30:00Z'), 'Europe/London', 'hour')).toBe('2026-10-25T01:00:00');
    expect(bucketOf(new Date('2026-10-25T01:30:00Z'), 'Europe/London', 'hour')).toBe('2026-10-25T01:00:00');
  });

  it('Pacific/Apia (UTC+13) and Feb 29', () => {
    expect(bucketOf(new Date('2028-02-28T11:30:00Z'), 'Pacific/Apia', 'day')).toBe('2028-02-29T00:00:00');
    expect(bucketOf(new Date('2028-02-29T10:59:59Z'), 'Pacific/Apia', 'day')).toBe('2028-02-29T00:00:00');
    expect(bucketOf(new Date('2028-02-29T11:00:00Z'), 'Pacific/Apia', 'day')).toBe('2028-03-01T00:00:00');
  });
});

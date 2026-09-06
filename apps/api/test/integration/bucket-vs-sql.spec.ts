/**
 * bucket-vs-sql.spec.ts — V5: `bucketOf` and `date_trunc(unit, ts AT TIME ZONE tz)` agree for 1 000 random instants ×
 * six zones × four units, plus the instants that hurt: London's DST hours, Apia (UTC+13), Feb 29, Lord Howe's 30-minute DST.
 */
import fc from 'fast-check';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { bucketOf, type BucketUnit } from '../../src/domain/bucket.js';

const ZONES = ['UTC', 'Asia/Kolkata', 'Europe/London', 'Pacific/Apia', 'America/New_York', 'Australia/Lord_Howe'];
const UNITS: BucketUnit[] = ['hour', 'day', 'week', 'month'];

/** Seeded so a failure names a reproducible instant; the seed is the day this file was written. */
const random = fc.sample(fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2031, 0, 1) }), { numRuns: 1_000, seed: 20_260_905 }).map((ms) => new Date(ms));

function around(iso: string, stepMinutes: number, count: number): Date[] {
  const base = Date.parse(iso);
  return Array.from({ length: count }, (_, i) => new Date(base + (i - Math.floor(count / 2)) * stepMinutes * 60_000));
}

const hardInstants = [
  ...around('2026-03-29T01:00:00Z', 10, 25), // Europe/London springs forward at 01:00Z
  ...around('2026-10-25T01:00:00Z', 10, 25), // Europe/London falls back at 01:00Z
  ...around('2026-04-05T15:00:00Z', 10, 25), // Australia/Lord_Howe falls back (30 minutes) at 15:00Z
  ...around('2026-10-04T15:30:00Z', 10, 25), // Australia/Lord_Howe springs forward
  ...around('2028-02-29T11:00:00Z', 30, 25), // Feb 29 becomes Mar 1 in Pacific/Apia (UTC+13)
  ...around('2028-03-01T00:00:00Z', 30, 25), // Feb 29 / Mar 1 midnight everywhere else
  ...around('2026-11-01T06:00:00Z', 10, 25), // America/New_York falls back
  ...around('2026-12-31T18:30:00Z', 15, 25), // New Year at Asia/Kolkata midnight
];

let pool: pg.Pool;
beforeAll(() => {
  pool = new pg.Pool({ connectionString: inject('dbOwnerUrl'), max: 2 });
});
afterAll(async () => {
  await pool.end();
});

/** PostgreSQL's answer for every instant, in input order, as the compiled retention statement formats it. */
async function sqlBuckets(tz: string, unit: BucketUnit, instants: Date[]): Promise<string[]> {
  const r = await pool.query<{ b: string }>(
    `SELECT to_char(date_trunc($2, t AT TIME ZONE $1), 'YYYY-MM-DD"T"HH24:MI:SS') AS b
       FROM unnest($3::timestamptz[]) WITH ORDINALITY AS u(t, i)
      ORDER BY i`,
    [tz, unit, instants.map((d) => d.toISOString())],
  );
  return r.rows.map((row) => row.b);
}

describe('V5: bucketOf(ts, tz, unit) === date_trunc(unit, ts AT TIME ZONE tz)', () => {
  for (const tz of ZONES) {
    it(`${tz}: 1 000 random instants and ${hardInstants.length} hard ones agree for hour, day, week and month`, async () => {
      const instants = [...random, ...hardInstants];
      for (const unit of UNITS) {
        const fromSql = await sqlBuckets(tz, unit, instants);
        const fromTs = instants.map((d) => bucketOf(d, tz, unit));
        const firstDiff = fromTs.findIndex((b, i) => b !== fromSql[i]);
        expect(firstDiff, firstDiff === -1 ? '' : `${unit} in ${tz}: ${instants[firstDiff]?.toISOString()} → TS ${fromTs[firstDiff]} vs SQL ${fromSql[firstDiff]}`).toBe(-1);
      }
    });
  }
});

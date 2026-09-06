/**
 * bucket.ts — timezone bucketing as the SQL does it (design §3.3, LLD V5).
 *
 * Why it exists: the cohort day is the day in the product's timezone, computed by
 * `date_trunc(unit, event_ts AT TIME ZONE tz)` in PostgreSQL. The fixture's hand computation and, later,
 * the web UI need the same answer in TypeScript, so this file reproduces that expression with `Intl` —
 * the only tz-aware facility Node has that never consults the process's local zone. V5 pins the two
 * implementations to each other for 1 000 random instants across six zones, DST days included. The
 * "in progress" rule (design §1.3) has no TypeScript twin: it is decided in SQL against the database's
 * clock and travels with every cell, so a second implementation could only disagree with it.
 *
 * What it must never do: touch `Date`'s local-time getters (they depend on the machine running the
 * test), read a clock, or return anything but the local bucket start as `YYYY-MM-DDTHH:MM:SS` — the
 * format `to_char` produces in the compiled retention statement.
 */

export type BucketUnit = 'hour' | 'day' | 'week' | 'month';

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone: constructing `Intl.DateTimeFormat` costs milliseconds, and bucketing runs in property tests thousands of times. */
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' });
    formatters.set(tz, f);
  }
  return f;
}

/** The formatter always emits the four requested parts; `Number(undefined)` would surface as NaN in the output, never as a silent zero. */
function localParts(ts: Date, tz: string): LocalParts {
  const parts = new Map(formatterFor(tz).formatToParts(ts).map((p) => [p.type, Number(p.value)]));
  return { year: Number(parts.get('year')), month: Number(parts.get('month')), day: Number(parts.get('day')), hour: Number(parts.get('hour')) };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function formatLocal(year: number, month: number, day: number, hour: number): string {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:00:00`;
}

/** Timezone bucketing as the SQL does it, for the fixture's hand computation and for `in_progress` in the UI. */
export function bucketOf(ts: Date, tz: string, unit: BucketUnit): string {
  const { year, month, day, hour } = localParts(ts, tz);
  switch (unit) {
    case 'hour':
      return formatLocal(year, month, day, hour);
    case 'day':
      return formatLocal(year, month, day, 0);
    case 'week': {
      // date_trunc('week') is ISO: Monday starts the week. Calendar arithmetic on the local date is done in UTC on purpose — it is pure.
      const local = new Date(Date.UTC(year, month - 1, day));
      const sinceMonday = (local.getUTCDay() + 6) % 7;
      local.setUTCDate(local.getUTCDate() - sinceMonday);
      return formatLocal(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), 0);
    }
    case 'month':
      return formatLocal(year, month, 1, 0);
  }
}

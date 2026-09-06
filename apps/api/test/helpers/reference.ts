/**
 * reference.ts (test helper) — a deliberately naive funnel and retention over in-memory arrays (LLD §7.3).
 *
 * Why it exists: V2–V4 compare the compiled SQL with an implementation that shares nothing with it —
 * no CTEs, no window functions, no `date_trunc` — just loops over a person's events. It is written to
 * be obviously right, not fast, and any disagreement between it and the database is the signal the
 * property test exists to raise. Only the tz conversion is shared (`bucketOf`), and V5 pins that to
 * PostgreSQL separately. Each mode is written from its DEFINITION (design §3.2/§3.3 with the decisions of
 * 2026-09-05), never from the SQL: sequential and strict start at the person's first step 1 in range;
 * any order asks for a window of the given length that holds an occurrence of every step, wherever it
 * starts; retention judges every cohort over its own `periods` buckets. Events in the same millisecond
 * are ordered by arrival (`seq`), which is how the database orders them (`event_id` is minted on arrival).
 */
import type { FunnelSpec, PropertyFilter, RetentionSpec } from '@vantage/contracts';
import { bucketOf, type BucketUnit } from '../../src/domain/bucket.js';

export interface RefEvent {
  person: string;
  event: string;
  /** UTC milliseconds. */
  ts: number;
  /** Arrival order across the whole dataset; breaks ties in `ts` the way `event_id` does. */
  seq: number;
  properties: Record<string, unknown>;
}

const wallClock = new Map<string, Intl.DateTimeFormat>();

/** The zone's wall-clock reading of `instant`, as UTC milliseconds of the same digits. */
function localWall(instant: number, tz: string): number {
  let f = wallClock.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    wallClock.set(tz, f);
  }
  const p: Record<string, number> = {};
  for (const part of f.formatToParts(new Date(instant))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return Date.UTC(p['year'] ?? 0, (p['month'] ?? 1) - 1, p['day'] ?? 1, p['hour'] ?? 0, p['minute'] ?? 0, p['second'] ?? 0);
}

/** UTC instant of local midnight on `date` in `tz`: probe the offset at a guess, then re-probe at the corrected instant. */
export function localMidnightUtc(date: string, tz: string): number {
  const naive = Date.parse(`${date}T00:00:00Z`);
  const guess = naive - (localWall(naive, tz) - naive);
  return naive - (localWall(guess, tz) - guess);
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

function rangeOf(range: { from: string; to: string }, tz: string): { start: number; end: number } {
  return { start: localMidnightUtc(range.from, tz), end: localMidnightUtc(nextDay(range.to), tz) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The subset of operators the property generators use; each mirrors the jsonb semantics of filters.ts. */
export function matches(f: PropertyFilter, props: Record<string, unknown>): boolean {
  const has = Object.hasOwn(props, f.key);
  const v = props[f.key];
  switch (f.op) {
    case 'eq':
      return has && same(v, f.value);
    case 'neq':
      return !(has && same(v, f.value));
    case 'in':
      return has && (f.value as unknown[]).some((x) => same(x, v));
    case 'not_in':
      return !(has && (f.value as unknown[]).some((x) => same(x, v)));
    case 'is_set':
      return has;
    case 'is_not_set':
      return !has;
    default:
      throw new Error(`reference: operator ${f.op} is not modelled`);
  }
}

const passes = (e: RefEvent, where: readonly PropertyFilter[]) => where.every((f) => matches(f, e.properties));

/** Each person's events in time order; ties in `ts` in arrival order. */
function byPerson(events: readonly RefEvent[]): Map<string, RefEvent[]> {
  const m = new Map<string, RefEvent[]>();
  for (const e of events) {
    const list = m.get(e.person) ?? [];
    list.push(e);
    m.set(e.person, list);
  }
  for (const list of m.values()) list.sort((a, b) => a.ts - b.ts || a.seq - b.seq);
  return m;
}

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export interface RefFunnel {
  steps: number[];
  medianS: number | null;
}

type IsStep = (e: RefEvent, i: number) => boolean;

interface Conversion {
  /** Steps reached, 0..K. */
  reached: number;
  /** Time to convert when every step was reached, else null. */
  spanMs: number | null;
}

/** Sequential: from the first step 1, each next step is the earliest occurrence strictly after the previous one and no later than t1 + window. */
function sequential(inRange: readonly RefEvent[], isStep: IsStep, K: number, window: number, t1: number): number[] {
  const times = [t1];
  for (let i = 1; i < K; i++) {
    const prev = times[i - 1] as number;
    const next = inRange.find((e) => isStep(e, i) && e.ts > prev && e.ts <= t1 + window);
    if (!next) break;
    times.push(next.ts);
  }
  return times;
}

/**
 * Strict: from the first step 1, the event right after step k (in time, then arrival) must be step k+1
 * and strictly later; any other event breaks the chain. With ties there may be several step-k events at
 * t_k — any of them may continue the chain, and the earliest continuation is taken.
 */
function strict(evs: readonly RefEvent[], isStep: IsStep, K: number, window: number, t1: number, end: number): number[] {
  const stream = evs.filter((e) => e.ts >= t1 && e.ts <= t1 + window && e.ts < end);
  const times = [t1];
  for (let i = 1; i < K; i++) {
    const prev = times[i - 1] as number;
    const continuations: number[] = [];
    stream.forEach((x, j) => {
      const next = stream[j + 1];
      if (x.ts === prev && isStep(x, i - 1) && next && isStep(next, i) && next.ts > prev) continuations.push(next.ts);
    });
    if (continuations.length === 0) break;
    times.push(Math.min(...continuations));
  }
  return times;
}

/**
 * Any order (design §3.2, decision 2026-09-05): steps 1..k are reached when some window of the given
 * length holds an occurrence of every one of them. Every in-range event is tried as the window's start,
 * earliest first; the occurrences chosen are the earliest of each step inside that window, and the time
 * to convert is their spread.
 */
function anyOrder(inRange: readonly RefEvent[], isStep: IsStep, K: number, window: number): Conversion {
  let reached = 0;
  let spanMs: number | null = null;
  for (let k = 1; k <= K; k++) {
    let chosen: number[] | null = null;
    for (const anchor of inRange) {
      const picks: number[] = [];
      for (let i = 0; i < k; i++) {
        const occurrence = inRange.find((e) => isStep(e, i) && e.ts >= anchor.ts && e.ts <= anchor.ts + window);
        if (!occurrence) break;
        picks.push(occurrence.ts);
      }
      if (picks.length === k) {
        chosen = picks;
        break;
      }
    }
    if (chosen === null) break;
    reached = k;
    if (k === K) spanMs = Math.max(...chosen) - Math.min(...chosen);
  }
  return { reached, spanMs };
}

/** One person's conversion per mode. */
function convert(evs: readonly RefEvent[], spec: FunnelSpec, start: number, end: number): Conversion {
  const inRange = evs.filter((e) => e.ts >= start && e.ts < end);
  const isStep: IsStep = (e, i) => e.event === spec.steps[i]?.event && passes(e, spec.steps[i]?.where ?? []);
  const window = spec.window.value * UNIT_MS[spec.window.unit];
  const K = spec.steps.length;

  if (spec.order === 'any') return anyOrder(inRange, isStep, K, window);

  const t1 = inRange.find((e) => isStep(e, 0))?.ts;
  if (t1 === undefined) return { reached: 0, spanMs: null };
  const times = spec.order === 'sequential' ? sequential(inRange, isStep, K, window, t1) : strict(evs, isStep, K, window, t1, end);
  return { reached: times.length, spanMs: times.length === K ? (times[K - 1] as number) - t1 : null };
}

export function referenceFunnel(events: readonly RefEvent[], spec: FunnelSpec, tz: string): RefFunnel {
  const { start, end } = rangeOf(spec.range, tz);
  const steps = spec.steps.map(() => 0);
  const spans: number[] = [];
  for (const evs of byPerson(events.filter((e) => passes(e, spec.where))).values()) {
    const { reached, spanMs } = convert(evs, spec, start, end);
    for (let i = 0; i < reached; i++) steps[i] = (steps[i] ?? 0) + 1;
    if (spanMs !== null) spans.push(spanMs / 1000);
  }
  return { steps, medianS: median(spans) };
}

/** `bucket + n units` on the local calendar; buckets are `YYYY-MM-DDT00:00:00` so string order is time order. */
export function addUnits(bucket: string, n: number, unit: BucketUnit): string {
  const [y, m, d] = bucket.slice(0, 10).split('-').map(Number) as [number, number, number];
  const date = unit === 'month' ? new Date(Date.UTC(y, m - 1 + n, 1)) : new Date(Date.UTC(y, m - 1, d + n * (unit === 'week' ? 7 : 1)));
  return `${date.toISOString().slice(0, 10)}T00:00:00`;
}

export type RefRetention = Map<string, { size: number; retained: number[] }>;

/**
 * Cohort = bucket of the person's first start event in range. Cell n is retained when the person did the
 * return event in bucket + n (`on`) or in any bucket from bucket + n up to the cohort's own horizon,
 * bucket + periods (`on_or_after`; design §3.3, decision 2026-09-05). Return events before the range's
 * start are not activity.
 */
export function referenceRetention(events: readonly RefEvent[], spec: RetentionSpec, tz: string): RefRetention {
  const { start, end } = rangeOf(spec.range, tz);
  const returnStep = spec.return ?? spec.start;
  const cohorts: RefRetention = new Map();

  for (const evs of byPerson(events.filter((e) => passes(e, spec.where))).values()) {
    const first = evs.find((e) => e.event === spec.start.event && passes(e, spec.start.where) && e.ts >= start && e.ts < end);
    if (!first) continue;
    const cohort = bucketOf(new Date(first.ts), tz, spec.unit);
    const horizon = addUnits(cohort, spec.periods, spec.unit);
    const active = new Set(
      evs
        .filter((e) => e.event === returnStep.event && passes(e, returnStep.where) && e.ts >= start)
        .map((e) => bucketOf(new Date(e.ts), tz, spec.unit))
        .filter((b) => b <= horizon),
    );
    const row = cohorts.get(cohort) ?? { size: 0, retained: Array.from({ length: spec.periods + 1 }, () => 0) };
    row.size++;
    for (let n = 0; n <= spec.periods; n++) {
      const target = addUnits(cohort, n, spec.unit);
      const retained = spec.mode === 'on' ? active.has(target) : [...active].some((b) => b >= target);
      if (retained) row.retained[n] = (row.retained[n] ?? 0) + 1;
    }
    cohorts.set(cohort, row);
  }
  return cohorts;
}

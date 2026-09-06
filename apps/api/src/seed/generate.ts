/**
 * generate.ts — the deterministic synthetic dataset behind `npm run seed` (design §8, LLD §8 S7).
 *
 * Why it exists: the 90-second demo (design §8) needs a product with realistic shape — a
 * `signup → create_project → invite_teammate` funnel that drops off, retention that decays across day
 * cohorts, a `view_pricing` event, a few late-arriving events, one device three hours out of clock, and
 * an anonymous→identified stitch — but the numbers must be reproducible: an interviewer who runs the
 * seed twice must see the same dataset, and re-running it must add zero rows. So the dataset is a PURE
 * function of a fixed seed: one PRNG (`Prng` below, the only source of randomness in this file), no
 * clock, no IO. The event stream is anchored to fixed August 2026 dates (never to the real clock), so it
 * is identical whenever it runs; `serverNow` is a parameter only so the caller can set the one skewed
 * device's `sent_at` relative to the clock the server will stamp — the tests pin a fixed instant, the CLI
 * passes the real clock — and it never moves a client timestamp or an `insert_id`.
 *
 * The output is a `Fixture` (the same shape `fixtures/august.json` has), so it plays through the very
 * same `playFixture` / real ingest endpoints the hand-computed fixture does: dedupe, timestamp
 * adjustment and identity all run for real. Every event carries a stable `insert_id` derived from a
 * deterministic counter, so a second play of the same options dedupes to nothing — that is the
 * idempotency the adversarial pass (LLD §9 S7) and `seed.spec.ts` prove.
 *
 * What it must never do: read a clock or the environment, use `Math.random`, or emit an event whose
 * `insert_id` depends on anything but the generation order (which is fixed) — any of those would break
 * the "run it twice, get the same dataset, add zero rows" contract this whole slice rests on.
 */
import type { IncomingEvent, JsonObject } from '@vantage/contracts';
import type { BatchStep, Fixture, IdentifyStep } from '../fixture/play.js';

/** The demo's product (design §8). `view_pricing` is the recurring activity retention measures against. */
const SIGNUP = 'signup';
const CREATE_PROJECT = 'create_project';
const INVITE_TEAMMATE = 'invite_teammate';
const VIEW_PRICING = 'view_pricing';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The demo month (design §8): cohorts fall on August 2026 days, so the demo's funnel range is 2026-08-01..08-31. */
const AUG1_MS = Date.parse('2026-08-01T00:00:00Z');
/** Signups land on the first 28 days, leaving room at month end for the return window to open. */
const SIGNUP_DAYS = 28;
/**
 * No generated event is dated later than this August-day index — 35 is 2026-09-05, the day before the
 * demo's "today" (2026-09-06). Anchoring the dataset to a FIXED point, not to `serverNow`, is what keeps
 * it identical across runs: were the newest events pinned to the real clock, a second run minutes later
 * would shape a different dataset and its `insert_id`s would not dedupe. It also makes the late cohorts'
 * return windows genuinely in-progress (design §1.3), since their runway to this day is short.
 */
const LAST_EVENT_DAY = 35;

/** Funnel drop-off (design §8: ~5k signups → ~40–55 % create → ~40–50 % of those invite). */
const P_CREATE = 0.47;
const P_INVITE = 0.45;
/** Mean `view_pricing` events per person; tuned so ~5 000 signups yield ~200 000 events overall. */
const MEAN_RETURN = 39;
/** One person's activity is bounded so a single outlier cannot dominate a batch or the total. */
const RETURN_CAP = 400;
/** Return-day offsets are geometric with this per-day stop probability: earlier days are denser, so retention decays. */
const RETURN_DECAY_Q = 0.125;
/** Return activity stays inside the widest retention window the demo asks for (30 periods) plus slack. */
const RETURN_MAX_OFFSET = 44;

const PLANS: readonly string[] = ['free', 'team', 'enterprise'];

export interface SeedOptions {
  /** The one seed for the whole dataset; the same value reproduces it bit-for-bit. */
  seed?: number;
  /** Full-run person target (design §8 says ~5 000); ignored once `maxEvents` stops generation early. */
  signups?: number;
  /** Reduced-scale cap: stop after the person whose events push the total to or past this. For the fast test. */
  maxEvents?: number;
  /** The server clock the skew is measured against; the skewed device's `sent_at` is `serverNow − skewHours`. */
  serverNow: Date;
  /** How far the one out-of-clock device is behind real time (design §8: ~3 h). */
  skewHours?: number;
  /** The project timezone; the demo is Asia/Kolkata (design §8). */
  timezone?: string;
}

export interface SeedPlan {
  /** Ready to hand to `playFixture` / `loadFixture` — the same path the hand-computed fixture takes. */
  fixture: Fixture;
  /** Totals for the CLI's report and the test's non-triviality assertions. */
  events: number;
  persons: number;
  /** Distinct August signup days used — the retention screen shows one cohort per day, so this is its cohort count. */
  cohortDays: number;
  identifies: number;
}

/**
 * mulberry32 — a tiny, well-distributed 32-bit PRNG. It is the ONLY randomness in this file (clean-code
 * rule: seeded PRNG in one place), so the whole dataset is a pure function of the seed the caller gives.
 */
class Prng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  private uint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** A float in [0, 1). */
  real(): number {
    return this.uint32() / 0x1_0000_0000;
  }
  /** An integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.real() * n);
  }
  /** True with probability p. */
  chance(p: number): boolean {
    return this.real() < p;
  }
  /** An exponential draw with the given mean — a few power users, many light ones. */
  exponential(mean: number): number {
    return -mean * Math.log(1 - this.real());
  }
  pick(values: readonly string[]): string {
    return values[this.int(values.length)] as string;
  }
}

/** An event before it is placed in a batch; `lane` decides which batch (and so which `sent_at`) it rides in. */
interface Generated {
  distinct_id: string;
  event: string;
  ms: number;
  properties?: JsonObject;
  lane: 'normal' | 'skew' | 'late';
}

/** Mints stable, ordered `insert_id`s. The generation order is fixed, so the same options mint the same ids. */
function keyMinter(): () => string {
  let seq = 0;
  return () => `s${String(++seq).padStart(7, '0')}`;
}

/** A within-day instant on `day` (0-based August day), between 04:00 and 16:00 UTC (≈ 09:30–21:30 IST) — clear of the IST day boundary. */
function dayInstant(day: number, prng: Prng): number {
  return AUG1_MS + day * DAY_MS + (4 + prng.real() * 12) * HOUR_MS;
}

/**
 * One person's whole event stream, in causal order (signup, then maybe create, then maybe invite, then
 * return activity). `id` labels every event; the identity persons override the signup's label to their
 * anonymous id afterwards. Return-day offsets are geometric so early days carry more activity and
 * retention decays; the number of return events is an exponential draw so engagement varies.
 */
function personStream(id: string, day: number, prng: Prng): Generated[] {
  const events: Generated[] = [];
  const plan = prng.pick(PLANS);
  const signupMs = dayInstant(day, prng);
  events.push({ distinct_id: id, event: SIGNUP, ms: signupMs, properties: { plan }, lane: 'normal' });

  if (prng.chance(P_CREATE)) {
    const createMs = signupMs + 5 * 60_000 + prng.real() * 3 * DAY_MS;
    events.push({ distinct_id: id, event: CREATE_PROJECT, ms: createMs, properties: { plan }, lane: 'normal' });
    if (prng.chance(P_INVITE)) {
      events.push({ distinct_id: id, event: INVITE_TEAMMATE, ms: createMs + HOUR_MS + prng.real() * 2 * DAY_MS, lane: 'normal' });
    }
  }

  const returns = Math.min(RETURN_CAP, Math.floor(prng.exponential(MEAN_RETURN)));
  const maxOffset = Math.min(RETURN_MAX_OFFSET, LAST_EVENT_DAY - day);
  for (let j = 0; j < returns; j++) {
    const offset = Math.min(maxOffset, Math.floor(Math.log(1 - prng.real()) / Math.log(1 - RETURN_DECAY_Q)));
    events.push({ distinct_id: id, event: VIEW_PRICING, ms: dayInstant(day + offset, prng), properties: { page: 'pricing' }, lane: 'normal' });
  }
  return events;
}

/** Turns generated events into `IncomingEvent`s with stable keys, preserving the order they were minted in. */
function toIncoming(events: Generated[], mint: () => string): IncomingEvent[] {
  return events.map((e) => {
    const out: IncomingEvent = { distinct_id: e.distinct_id, event: e.event, timestamp: new Date(e.ms).toISOString(), insert_id: mint() };
    if (e.properties) out.properties = e.properties;
    return out;
  });
}

/** Chunks a lane's events into ingest-sized batches (≤ 500, LLD §2); `sentAt` is set only for the skewed device. */
function toBatches(label: string, events: IncomingEvent[], serverNow: string, sentAt?: string): BatchStep[] {
  const batches: BatchStep[] = [];
  for (let i = 0; i < events.length; i += 500) {
    const slice = events.slice(i, i + 500);
    const batch: BatchStep = { kind: 'batch', label: `${label} [${i + 1}..${i + slice.length}]`, server_ts: serverNow, events: slice };
    if (sentAt !== undefined) batch.sent_at = sentAt;
    batches.push(batch);
  }
  return batches;
}

/**
 * Builds the whole deterministic dataset as a `Fixture`. Special persons (the two identity stitches, the
 * out-of-clock device, the late arrivals) are generated FIRST so they are present at any scale — the
 * reduced-scale test asserts them — and so their `insert_id`s never shift when `maxEvents` changes how
 * many ordinary persons follow.
 */
export function generateSeed(options: SeedOptions): SeedPlan {
  const prng = new Prng(options.seed ?? 0x5eed2026);
  const signups = options.signups ?? 5000;
  const timezone = options.timezone ?? 'Asia/Kolkata';
  const skewHours = options.skewHours ?? 3;
  const serverNow = options.serverNow.toISOString();
  const skewSentAt = new Date(options.serverNow.getTime() - skewHours * HOUR_MS).toISOString();
  const mint = keyMinter();

  const steps: Fixture['steps'] = [];
  const cohortDays = new Set<number>();
  let events = 0;
  let persons = 0;
  const budgetLeft = () => options.maxEvents === undefined || events < options.maxEvents;

  const account = (day: number, list: IncomingEvent[]): void => {
    cohortDays.add(day);
    events += list.length;
    persons += 1;
  };

  // Two anonymous→identified stitches: signup arrives under the anonymous id, then `identify` maps it to
  // the user id the rest of the stream uses. The funnel and retention count each as one person (V10).
  for (let k = 0; k < 2; k++) {
    const day = prng.int(SIGNUP_DAYS);
    const stream = personStream(`user-${k}`, day, prng);
    const [signup, ...rest] = stream;
    if (!signup) continue;
    const anonSignup: Generated = { ...signup, distinct_id: `anon-${k}` };
    const anon = toIncoming([anonSignup], mint);
    const user = toIncoming(rest, mint);
    steps.push(...toBatches(`identity ${k} anon`, anon, serverNow));
    const identify: IdentifyStep = { kind: 'identify', label: `identity ${k} stitch`, server_ts: serverNow, anonymous_id: `anon-${k}`, user_id: `user-${k}` };
    steps.push(identify);
    steps.push(...toBatches(`identity ${k} user`, user, serverNow));
    account(day, [...anon, ...user]);
  }

  // The one device ~3 h out of clock (design §8): its batch carries a `sent_at` behind `serverNow`, so the
  // ingest path shifts every timestamp forward by the skew and stamps `ts_source = client_shifted`.
  {
    const day = prng.int(SIGNUP_DAYS);
    const stream = personStream('skew-device', day, prng).filter((e) => e.event !== VIEW_PRICING).map((e) => ({ ...e, lane: 'skew' as const }));
    const skew = toIncoming(stream, mint);
    steps.push(...toBatches('skewed device', skew, serverNow, skewSentAt));
    account(day, skew);
  }

  // A handful of late arrivals: dated to the first two August days but ingested LAST, so they land in the
  // earliest buckets rather than at arrival time (design §1.3). They are minted here, with the other
  // specials, so their `insert_id`s do not shift with how many ordinary persons follow; only the batch's
  // position in `steps` is deferred to the end of the load.
  const lateEvents: Generated[] = [{ distinct_id: 'late-arrival', event: SIGNUP, ms: dayInstant(0, prng), properties: { plan: 'team' }, lane: 'late' }];
  for (let j = 0; j < 4; j++) lateEvents.push({ distinct_id: 'late-arrival', event: VIEW_PRICING, ms: dayInstant(j % 2, prng), properties: { page: 'pricing' }, lane: 'late' });
  const late = toIncoming(lateEvents, mint);
  const lateBatches = toBatches('late arrivals', late, serverNow);
  account(0, late);

  // Ordinary persons fill out the funnel and the retention cohorts, up to the person target or the cap.
  // Their events are pooled and then packed into full ≤ 500-event batches, so the load is a few hundred
  // requests, not one per person — each person's events keep their minted order, so the packing is stable.
  const normal: IncomingEvent[] = [];
  for (let i = 0; i < signups && budgetLeft(); i++) {
    const day = prng.int(SIGNUP_DAYS);
    const incoming = toIncoming(personStream(`u${i}`, day, prng), mint);
    normal.push(...incoming);
    account(day, incoming);
  }
  steps.push(...toBatches('persons', normal, serverNow));

  // Deferred to the end so the late arrivals are genuinely late relative to the rest of the load.
  steps.push(...lateBatches);

  return { fixture: { project: { name: 'Demo', timezone }, steps }, events, persons, cohortDays: cohortDays.size, identifies: 2 };
}

/**
 * play.ts — reads `fixtures/august.json` and plays it, step by step, through whatever ingest transport it is given.
 *
 * Why it exists: LLD §7.2 — the fixture must pass through dedupe, timestamp adjustment and identity
 * exactly as production traffic does, so it is only ever loaded through the real endpoints. Two callers
 * need that: the integration suite (supertest against the test app, clock pinned to each step's
 * `server_ts`) and `npm run fixture:load` (fetch against an in-process API on the operator's database,
 * real clock). The steps, the expansion of the 1 000 generated P14 rows and the walk are the same, so they
 * live here once and the transport is a parameter. `rebaseSentAt` is for the real-clock caller: the
 * fixture encodes P12's device skew as `sent_at − server_ts`, and keeping that difference relative to
 * the actual `now` is what preserves the 3-hour shift the expected numbers depend on.
 *
 * What it must never do: write to the database directly, or reorder steps (identify must run after the
 * batches it refers to).
 */
import type { IdentifyResponse, IncomingEvent, IngestResponse, JsonObject } from '@vantage/contracts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BatchStep {
  kind: 'batch';
  label: string;
  server_ts: string;
  sent_at?: string;
  events: IncomingEvent[];
}
export interface IdentifyStep {
  kind: 'identify';
  label: string;
  server_ts: string;
  anonymous_id: string;
  user_id: string;
}
export interface GenerateStep {
  kind: 'generate';
  label: string;
  server_ts: string;
  sent_at?: string;
  distinct_id: string;
  event: string;
  count: number;
  start: string;
  step_s: number;
  insert_id_prefix: string;
  properties?: JsonObject;
}
export type FixtureStep = BatchStep | IdentifyStep | GenerateStep;

export interface Fixture {
  project: { name: string; timezone: string };
  steps: FixtureStep[];
}

/** How a step reaches the API; the transport decides what the server clock is. */
export interface FixtureTransport {
  batch(step: BatchStep): Promise<IngestResponse>;
  identify(step: IdentifyStep): Promise<IdentifyResponse>;
}

/** Observation points for tests that need a number mid-load (the funnel before and after P09's identify, V10). */
export interface PlayHooks {
  beforeStep?(step: FixtureStep): Promise<void>;
  afterStep?(step: FixtureStep): Promise<void>;
}

export interface PlayResult {
  batches: { label: string; response: IngestResponse }[];
  identifies: { label: string; response: IdentifyResponse }[];
  submitted: number;
}

/** Resolved from this file so it is right from `src` (vitest) and from `dist` (node). */
const FIXTURE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'august.json');

export function readFixture(): Fixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Fixture;
}

/** Expands a generate step into batches of at most 500 events with deterministic, zero-padded insert ids. */
export function expandGenerate(step: GenerateStep): BatchStep[] {
  const events: IncomingEvent[] = [];
  const start = Date.parse(step.start);
  for (let i = 0; i < step.count; i++) {
    const e: IncomingEvent = {
      distinct_id: step.distinct_id,
      event: step.event,
      timestamp: new Date(start + i * step.step_s * 1000).toISOString(),
      insert_id: `${step.insert_id_prefix}-${String(i + 1).padStart(4, '0')}`,
    };
    if (step.properties) e.properties = step.properties;
    events.push(e);
  }
  const batches: BatchStep[] = [];
  for (let i = 0; i < events.length; i += 500) {
    const batch: BatchStep = { kind: 'batch', label: `${step.label} [${i + 1}..${Math.min(i + 500, events.length)}]`, server_ts: step.server_ts, events: events.slice(i, i + 500) };
    if (step.sent_at) batch.sent_at = step.sent_at;
    batches.push(batch);
  }
  return batches;
}

/** The step's `sent_at` moved so that `sent_at − now` equals the fixture's `sent_at − server_ts`: the skew survives a real clock. */
export function rebaseSentAt(step: { server_ts: string; sent_at?: string | undefined }, now: Date): string | undefined {
  if (step.sent_at === undefined) return undefined;
  return new Date(now.getTime() + Date.parse(step.sent_at) - Date.parse(step.server_ts)).toISOString();
}

export async function playFixture(fixture: Fixture, transport: FixtureTransport, hooks: PlayHooks = {}): Promise<PlayResult> {
  const result: PlayResult = { batches: [], identifies: [], submitted: 0 };
  for (const step of fixture.steps) {
    await hooks.beforeStep?.(step);
    if (step.kind === 'identify') {
      result.identifies.push({ label: step.label, response: await transport.identify(step) });
    } else {
      for (const batch of step.kind === 'generate' ? expandGenerate(step) : [step]) {
        result.batches.push({ label: batch.label, response: await transport.batch(batch) });
        result.submitted += batch.events.length;
      }
    }
    await hooks.afterStep?.(step);
  }
  return result;
}

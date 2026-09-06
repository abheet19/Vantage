/**
 * load.ts (test helper) — plays the fixture into the test app with the clock pinned to each step's `server_ts`.
 *
 * Why it exists: the expected numbers for P12 (shifted) and P13 (clamped) assume `server_ts =
 * 2026-09-02T00:00:00Z`, so the test transport pins `FixedClock` before every POST; the walk itself is
 * `playFixture` from `src/fixture/play.ts`, shared with `npm run fixture:load`.
 *
 * What it must never do: bypass the HTTP layer.
 */
import type { IdentifyResponse, IngestResponse } from '@vantage/contracts';
import { type BatchStep, type Fixture, type IdentifyStep, type PlayHooks, type PlayResult, playFixture, readFixture } from '../../src/fixture/play.js';
import { bearer, type TestApp, type TestProject } from '../helpers/app.js';

export interface LoadResult extends PlayResult {
  project: TestProject;
}

export async function postBatch(t: TestApp, project: TestProject, step: BatchStep): Promise<IngestResponse> {
  t.clock.set(new Date(step.server_ts));
  const body: { sent_at?: string; events: BatchStep['events'] } = { events: step.events };
  if (step.sent_at) body.sent_at = step.sent_at;
  const res = await t.http.post('/v1/events').set(bearer(project)).send(body);
  if (res.status !== 200) throw new Error(`fixture step "${step.label}" failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as IngestResponse;
}

async function postIdentify(t: TestApp, project: TestProject, step: IdentifyStep): Promise<IdentifyResponse> {
  t.clock.set(new Date(step.server_ts));
  const res = await t.http.post('/v1/identify').set(bearer(project)).send({ anonymous_id: step.anonymous_id, user_id: step.user_id }).expect(200);
  return res.body as IdentifyResponse;
}

/** Creates the fixture project (optionally in another timezone, for V5) and plays every step through the real endpoints; `hooks` sees the project so it can query it mid-load. */
export async function loadFixture(t: TestApp, options: { fixture?: Fixture; timezone?: string; hooks?: (project: TestProject) => PlayHooks } = {}): Promise<LoadResult> {
  const fixture = options.fixture ?? readFixture();
  const project = await t.createProject(fixture.project.name, options.timezone ?? fixture.project.timezone);
  const played = await playFixture(
    fixture,
    { batch: (step) => postBatch(t, project, step), identify: (step) => postIdentify(t, project, step) },
    options.hooks?.(project) ?? {},
  );
  return { ...played, project };
}

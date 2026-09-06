/**
 * fixture-load.ts — `npm run fixture:load`: plays `fixtures/august.json` into the operator's database through the real API.
 *
 * Why it exists: the hand-computed numbers in `fixtures/august.expected.md` are only convincing when the
 * owner can run the funnel against real rows and see them. This entrypoint boots the API in-process on
 * the `.env` database (so no server has to be running), binds it to an ephemeral loopback port, creates
 * the fixture project, posts every step through `POST /v1/events` / `POST /v1/identify` exactly as a
 * client would, and prints the project id and a ready-to-paste query. The clock is real, so `sent_at` is
 * rebased per step to preserve the device skew the fixture encodes.
 *
 * What it must never do: write to the database directly, or reuse a project — every run is a fresh
 * project, so the expected numbers hold whatever else the database contains.
 */
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IdentifyResponse, IngestResponse, ProjectCreated } from '@vantage/contracts';
import 'reflect-metadata';
import { AppModule, configureApp } from './app.js';
import { playFixture, readFixture, rebaseSentAt } from './fixture/play.js';
import { loadConfig } from './infra/config.js';

async function post<T>(base: string, route: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const res = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot({ rwUrl: config.rwUrl, roUrl: config.roUrl, ownerUrl: config.ownerUrl, migrationsDir: config.migrationsDir }),
    { bodyParser: false, logger: ['error', 'warn'] },
  );
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  try {
    const fixture = readFixture();
    const project = await post<ProjectCreated>(base, '/v1/projects', {}, { name: fixture.project.name, timezone: fixture.project.timezone });
    const auth = { Authorization: `Bearer ${project.api_key}` };
    const result = await playFixture(fixture, {
      batch: (step) => post<IngestResponse>(base, '/v1/events', auth, { sent_at: rebaseSentAt(step, new Date()), events: step.events }),
      identify: (step) => post<IdentifyResponse>(base, '/v1/identify', auth, { anonymous_id: step.anonymous_id, user_id: step.user_id }),
    });
    const accepted = result.batches.reduce((n, b) => n + b.response.accepted, 0);
    const duplicates = result.batches.reduce((n, b) => n + b.response.duplicates, 0);
    console.log(`fixture loaded into project ${project.project_id} (${project.timezone}): ${result.submitted} submitted, ${accepted} accepted, ${duplicates} duplicates, ${result.identifies.length} identify`);
    console.log(`try: Invoke-RestMethod -Method Post -Uri http://127.0.0.1:${config.port}/v1/funnel -ContentType application/json -Body '{"kind":"funnel","project":"${project.project_id}","range":{"from":"2026-08-01","to":"2026-08-31"},"steps":[{"event":"signup"},{"event":"create_project"},{"event":"invite_teammate"}]}'`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(`fixture:load failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

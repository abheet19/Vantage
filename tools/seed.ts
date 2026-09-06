/**
 * seed.ts — `npm run seed`: loads the deterministic 200 000-event demo dataset into the operator's
 * database through the REAL ingest path (design §8, LLD §8 S7).
 *
 * Why it exists: the demo (design §8) opens on a synthetic product with realistic drop-off, decaying
 * retention, a late arrival or two and one out-of-clock device — and it must be reproducible. The dataset
 * itself is a pure function of a fixed seed (`apps/api/src/seed/generate.ts`); this file is only the shell
 * that boots the API in-process on the `.env` database (so no server has to be running), creates or reuses
 * the `Demo` project, and plays every batch through `POST /v1/events` / `POST /v1/identify` exactly as a
 * client would — so the seed exercises dedupe, timestamp adjustment and identity for real, not a raw
 * INSERT. It prints the project id, the accepted/duplicate counts and a ready-to-paste funnel query.
 *
 * Reuse and idempotency: the demo dedupes on re-run only if it targets the SAME project, but a project's
 * API key is shown exactly once and there is no key-recovery route by design (E67), so the created key is
 * remembered in a git-ignored `.seed-state.json` beside `.env` — the same local, loopback-only trust model
 * `.env` (DB passwords) and the MCP installer (E60) already use. A second `npm run seed` reuses that key and
 * every event, carrying its stable `insert_id`, is a duplicate: zero new rows.
 *
 * Run with `node --experimental-strip-types` (Node 22): this is TypeScript, and it imports the compiled
 * generator and fixture player from `apps/api/dist`, so `npm run build` must have run first.
 *
 * What it must never do: write to the database directly (every row goes through the HTTP ingest path), or
 * invent numbers — the counts it prints are what the endpoints returned.
 */
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IdentifyResponse, IngestResponse, ProjectCreated, ProjectRow } from '@vantage/contracts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';
import { AppModule, configureApp } from '../apps/api/dist/app.js';
import { playFixture } from '../apps/api/dist/fixture/play.js';
import { loadConfig } from '../apps/api/dist/infra/config.js';
import { generateSeed } from '../apps/api/dist/seed/generate.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = path.join(repoRoot, '.seed-state.json');

interface SeedState {
  project_id: string;
  api_key: string;
}

/** `--events N`, `--signups N`, `--seed N` from the command line; unset values fall back to the full-run defaults. */
function readArgs(argv: string[]): { maxEvents?: number; signups?: number; seed?: number } {
  const args: Record<string, number> = {};
  for (let i = 0; i < argv.length; i++) {
    const match = /^--(events|signups|seed)(?:=(.+))?$/.exec(argv[i] ?? '');
    if (!match) continue;
    const value = Number(match[2] ?? argv[++i]);
    if (!Number.isFinite(value)) throw new Error(`--${match[1]} needs a number`);
    args[match[1] as string] = value;
  }
  const out: { maxEvents?: number; signups?: number; seed?: number } = {};
  if (args['events'] !== undefined) out.maxEvents = args['events'];
  if (args['signups'] !== undefined) out.signups = args['signups'];
  if (args['seed'] !== undefined) out.seed = args['seed'];
  return out;
}

async function post<T>(base: string, route: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const res = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} → ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

/** Reuses the `Demo` project named in `.seed-state.json` when it still exists, else creates one and remembers its key. */
async function demoProject(base: string, timezone: string): Promise<{ state: SeedState; reused: boolean }> {
  if (existsSync(STATE_PATH)) {
    const state = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as SeedState;
    const projects = await (await fetch(`${base}/v1/projects`)).json() as ProjectRow[];
    if (projects.some((p) => p.project_id === state.project_id)) return { state, reused: true };
  }
  const created = await post<ProjectCreated>(base, '/v1/projects', {}, { name: 'Demo', timezone });
  const state: SeedState = { project_id: created.project_id, api_key: created.api_key };
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return { state, reused: false };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const args = readArgs(process.argv.slice(2));
  const plan = generateSeed({ serverNow: new Date(), ...args });

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.forRoot({ rwUrl: config.rwUrl, roUrl: config.roUrl, ownerUrl: config.ownerUrl, migrationsDir: config.migrationsDir }),
    { bodyParser: false, logger: ['error', 'warn'] },
  );
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  try {
    const { state, reused } = await demoProject(base, plan.fixture.project.timezone);
    const auth = { Authorization: `Bearer ${state.api_key}` };
    const started = Date.now();
    const result = await playFixture(plan.fixture, {
      batch: (step) => post<IngestResponse>(base, '/v1/events', auth, step.sent_at === undefined ? { events: step.events } : { sent_at: step.sent_at, events: step.events }),
      identify: (step) => post<IdentifyResponse>(base, '/v1/identify', auth, { anonymous_id: step.anonymous_id, user_id: step.user_id }),
    });
    const elapsedMs = Date.now() - started;
    const accepted = result.batches.reduce((n, b) => n + b.response.accepted, 0);
    const duplicates = result.batches.reduce((n, b) => n + b.response.duplicates, 0);

    console.log(`seed ${reused ? 'reused' : 'created'} project Demo ${state.project_id} (${plan.fixture.project.timezone})`);
    console.log(`  ${plan.persons} persons, ${plan.cohortDays} day cohorts, ${result.identifies.length} identify stitches`);
    console.log(`  ${result.submitted} submitted → ${accepted} accepted, ${duplicates} duplicates in ${(elapsedMs / 1000).toFixed(1)} s`);
    console.log('');
    console.log('funnel over the seeded product (start the API first: `npm run start:api`):');
    const body = `{"kind":"funnel","project":"${state.project_id}","range":{"from":"2026-08-01","to":"2026-08-31"},"steps":[{"event":"signup"},{"event":"create_project"},{"event":"invite_teammate"}]}`;
    console.log(`  Invoke-RestMethod -Method Post -Uri http://127.0.0.1:${config.port}/v1/funnel -ContentType application/json -Body '${body}'`);
    console.log(`  curl -s http://127.0.0.1:${config.port}/v1/funnel -H "content-type: application/json" -d '${body}'`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(`seed failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

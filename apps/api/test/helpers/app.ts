/**
 * app.ts (test helper) — boots the real application against the test database.
 *
 * Why it exists: every integration test goes through `AppModule.forRoot` and `configureApp`, the same
 * code `main.ts` runs, so the suite exercises the production body parser, pipe, filter and guard. The
 * substitutions are the clock (`FixedClock`), because `server_ts` must be pinned for the fixture's
 * shifted and clamped rows to be deterministic, and — when a test asks — the LLM port, because the ask
 * path's tests script what "the model" says (S3). An owner pool is exposed for assertions that read
 * tables the app roles cannot (and for the self-test's GRANT/REVOKE).
 *
 * What it must never do: bypass the HTTP layer to insert events, or use the owner pool for anything
 * the test is claiming the app does.
 */
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import 'reflect-metadata';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import supertest from 'supertest';
import { inject } from 'vitest';
import { AppModule, configureApp } from '../../src/app.js';
import { FixedClock } from '../../src/infra/clock.js';
import type { DatabaseOptions } from '../../src/infra/database.module.js';
import { LLM_ADAPTER, LLM_PORT, type LlmPort } from '../../src/infra/llm/port.js';
import { CLOCK } from '../../src/infra/tokens.js';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export function dbOptions(overrides: Partial<DatabaseOptions> = {}): DatabaseOptions {
  return { rwUrl: inject('dbRwUrl'), roUrl: inject('dbRoUrl'), migrationsDir: MIGRATIONS_DIR, ...overrides };
}

export interface TestProject {
  project_id: string;
  api_key: string;
  timezone: string;
}

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof supertest>;
  clock: FixedClock;
  owner: pg.Pool;
  createProject(name?: string, timezone?: string): Promise<TestProject>;
  close(): Promise<void>;
}

export interface TestAppOptions {
  clock?: FixedClock;
  db?: Partial<DatabaseOptions>;
  /** A scripted model for the ask path; without it the app runs the real `none` adapter, exactly as `VANTAGE_LLM=none` would. */
  llm?: LlmPort;
  /** The name the audit rows carry for a scripted model; `scripted` unless the test says otherwise. */
  adapter?: string;
  /** `VANTAGE_QUERY_TOKEN`: unset ⇒ the read routes stay open ⟨D4⟩ (the default); set ⇒ they require it as a Bearer. */
  queryToken?: string;
  /** `VANTAGE_ADMIN_TOKEN`: unset ⇒ the project-admin write routes stay open ⟨D4⟩ (the default); set ⇒ create/rotate require it as a Bearer. */
  adminToken?: string;
  /** Optional release commit exposed by `/health`. */
  releaseSha?: string;
}

/** Builds and initialises the app; rejects (and leaks nothing) when the boot self-test refuses. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const clock = options.clock ?? new FixedClock(new Date('2026-09-02T00:00:00Z'));
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(dbOptions(options.db), undefined, options.queryToken, options.adminToken, options.releaseSha)] }).overrideProvider(CLOCK).useValue(clock);
  if (options.llm) builder = builder.overrideProvider(LLM_PORT).useValue(options.llm).overrideProvider(LLM_ADAPTER).useValue(options.adapter ?? 'scripted');
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  try {
    // listen(0), not just init(): supertest given a not-yet-listening server calls server.listen(0) itself,
    // once per request, and closes it again after — so when the 50-parallel batch fires, 50 requests race the
    // same ephemeral bind. On Linux (CI) that resets most of the sockets (ECONNRESET) and Promise.all rejects,
    // so a batch that idempotent ingest had converged correctly (500 rows, 50 persons still hold) looked like a
    // failure; Node on Windows tolerates the racing binds, which is why it passed locally. Binding an ephemeral
    // port here (exactly as main.ts binds its real one) hands supertest an already-listening server, so every
    // concurrent request reaches it. The boot self-test still runs inside listen() and rejects the same way.
    await app.listen(0);
  } catch (err) {
    await app.close().catch(() => undefined);
    throw err;
  }
  const owner = new pg.Pool({ connectionString: inject('dbOwnerUrl'), max: 4 });
  const http = supertest(app.getHttpServer());

  return {
    app,
    http,
    clock,
    owner,
    async createProject(name = `test ${Date.now()}`, timezone = 'Asia/Kolkata') {
      // When VANTAGE_ADMIN_TOKEN is set the create route is gated, so setup sends the admin bearer.
      let req = http.post('/v1/projects');
      if (options.adminToken) req = req.set(adminBearer(options.adminToken));
      const res = await req.send({ name, timezone }).expect(201);
      return { project_id: res.body.project_id, api_key: res.body.api_key, timezone };
    },
    async close() {
      await owner.end();
      await app.close();
    },
  };
}

export function bearer(project: TestProject): Record<string, string> {
  return { Authorization: `Bearer ${project.api_key}` };
}

/** The shared read token as a Bearer header, for the query-token gate (distinct from a project's ingest key). */
export function queryBearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** The shared admin token as a Bearer header, for the admin-token gate on the project-admin write routes. */
export function adminBearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

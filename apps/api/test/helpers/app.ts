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
}

/** Builds and initialises the app; rejects (and leaks nothing) when the boot self-test refuses. */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const clock = options.clock ?? new FixedClock(new Date('2026-09-02T00:00:00Z'));
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(dbOptions(options.db))] }).overrideProvider(CLOCK).useValue(clock);
  if (options.llm) builder = builder.overrideProvider(LLM_PORT).useValue(options.llm).overrideProvider(LLM_ADAPTER).useValue(options.adapter ?? 'scripted');
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app);
  try {
    await app.init();
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
      const res = await http.post('/v1/projects').send({ name, timezone }).expect(201);
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

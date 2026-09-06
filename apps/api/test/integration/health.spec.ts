/**
 * health.spec.ts — /health tells the truth: 200 with the boot facts, 503 in the common error shape with the pg error when the database is gone.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createServer } from 'node:net';
import pg from 'pg';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../../src/app.js';
import { DatabaseLifecycle } from '../../src/infra/database.module.js';
import { PG_RO, PG_RW } from '../../src/infra/tokens.js';
import { HealthController } from '../../src/modules/health/health.controller.js';
import { createTestApp, type TestApp } from '../helpers/app.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

function closedPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

describe('GET /health', () => {
  it('answers 200 with both pools up, the migration version and the passed self-test', async () => {
    const res = await t.http.get('/health').expect(200);
    expect(res.body).toMatchObject({ ok: true, pools: { rw: 'up', ro: 'up' }, migration: { version: 4, pending: [], mismatched: [] }, self_test: { ok: true } });
    const names = (res.body.self_test.checks as { name: string; ok: boolean }[]).map((c) => c.name);
    expect(names).toEqual(['rw.role', 'ro.role', 'db.encoding', 'ro.statement_timeout', 'ro.default_transaction_read_only', 'privileges', 'indexes']);
  });

  it('answers 503 as { code: UNHEALTHY, message: <pg error> } plus the same facts when the database is down', async () => {
    const port = await closedPort();
    const dead = new pg.Pool({ host: '127.0.0.1', port, user: 'x', password: 'x', database: 'x', connectionTimeoutMillis: 2_000, max: 1 });
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PG_RW, useValue: dead },
        { provide: PG_RO, useValue: dead },
        { provide: DatabaseLifecycle, useValue: { selfTest: { ok: true, checks: [] }, migration: { version: 4, pending: [], mismatched: [] } } },
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
    configureApp(app);
    await app.init();
    try {
      const res = await supertest(app.getHttpServer()).get('/health').expect(503);
      expect(res.body).toMatchObject({ code: 'UNHEALTHY', ok: false, pools: { rw: 'down', ro: 'down' } });
      expect(res.body.message).toMatch(/ECONNREFUSED|connect|timeout/i);
    } finally {
      await app.close();
      await dead.end();
    }
  });
});

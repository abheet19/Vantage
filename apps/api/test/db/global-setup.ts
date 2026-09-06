/**
 * global-setup.ts — one PostgreSQL 17 for the integration project, whatever machine runs it.
 *
 * Why it exists: LLD §7 says integration tests need Postgres; this file makes `npm run test:integration`
 * self-contained. With `VANTAGE_TEST_DB` set (CI's service container, or an operator's own cluster as a
 * superuser) it uses that cluster; otherwise it starts `embedded-postgres` (real PostgreSQL 17 binaries
 * downloaded at `npm install`) on a free port in a temp directory and stops it afterwards. Either way
 * it drops and recreates a `vantage_test` database, then applies `tools/db-setup.sql` — the SAME file
 * the operator runs, so the tests prove the real roles, the database owner and the TEMP revoke — and
 * runs the migrations through the real runner. Connection strings reach tests via `inject()`.
 *
 * What it must never do: touch a database named `vantage`, guess a password, or leave the embedded
 * cluster running (teardown stops it and removes its directory).
 */
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { MigrationRunner } from '../../src/infra/migration-runner.js';

declare module 'vitest' {
  export interface ProvidedContext {
    dbOwnerUrl: string;
    dbRwUrl: string;
    dbRoUrl: string;
  }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const migrationsDir = path.resolve(here, '..', '..', 'migrations');

const TEST_DB = 'vantage_test';
/** The psql variables db-setup.sql expects: test-only passwords for test-only roles on a throwaway cluster or a CI container, and the database name. */
const VARIABLES = { owner_password: 'vantage_owner_test', app_password: 'vantage_app_test', reader_password: 'vantage_reader_test', database: TEST_DB };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

/** tools/db-setup.sql is written for psql: substitute its `:'literal'` and `:"identifier"` variables and drop its `\` meta-commands so pg can run it. */
function roleSetupSql(): string {
  const raw = readFileSync(path.join(repoRoot, 'tools', 'db-setup.sql'), 'utf8');
  return raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('\\'))
    .join('\n')
    .replace(/:'(\w+)'/g, (_m, name: keyof typeof VARIABLES) => `'${VARIABLES[name].replace(/'/g, "''")}'`)
    .replace(/:"(\w+)"/g, (_m, name: keyof typeof VARIABLES) => `"${VARIABLES[name].replace(/"/g, '""')}"`);
}

function asRole(url: string, role: string, password: string, database: string): string {
  const u = new URL(url);
  u.username = role;
  u.password = password;
  u.pathname = `/${database}`;
  return u.toString();
}

export default async function setup({ provide }: TestProject): Promise<() => Promise<void>> {
  let superUrl = process.env['VANTAGE_TEST_DB'];
  let stop: () => Promise<void> = async () => undefined;

  if (!superUrl) {
    const port = await freePort();
    const dir = mkdtempSync(path.join(tmpdir(), 'vantage-pg-'));
    // UTF8 explicitly: a Windows initdb defaults to the ANSI code page (WIN1252), which cannot store the
    // event names and properties the fixture and the adversarial pass send. Same rule as tools/db-setup.ps1.
    const embedded = new EmbeddedPostgres({
      databaseDir: dir,
      user: 'postgres',
      password: 'postgres',
      port,
      persistent: false,
      initdbFlags: ['--encoding=UTF8', '--locale=C'],
      onLog: () => undefined,
      onError: () => undefined,
    });
    await embedded.initialise();
    await embedded.start();
    superUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
    stop = async () => {
      await embedded.stop();
      rmSync(dir, { recursive: true, force: true });
    };
  }

  try {
    const admin = new pg.Client({ connectionString: superUrl });
    await admin.connect();
    try {
      // The database first, the setup file second: db-setup.sql hands the database to vantage_owner and revokes TEMP, so it needs the database to exist.
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB} ENCODING 'UTF8' TEMPLATE template0`);
      await admin.query(roleSetupSql());
    } finally {
      await admin.end();
    }

    const ownerUrl = asRole(superUrl, 'vantage_owner', VARIABLES.owner_password, TEST_DB);
    await new MigrationRunner(ownerUrl, migrationsDir).run();

    provide('dbOwnerUrl', ownerUrl);
    provide('dbRwUrl', asRole(superUrl, 'vantage_app', VARIABLES.app_password, TEST_DB));
    provide('dbRoUrl', asRole(superUrl, 'vantage_reader', VARIABLES.reader_password, TEST_DB));
  } catch (err) {
    await stop().catch(() => undefined);
    throw err;
  }

  return stop;
}

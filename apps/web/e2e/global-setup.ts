/**
 * global-setup.ts — bring up a real API on a real PostgreSQL with the fixture, for the Playwright suite.
 *
 * Why it exists: the e2e flows must run against the same system an operator runs, not a mock. This mirrors
 * apps/api/test/db/global-setup.ts (the S1/S2 harness) but for the web: it starts embedded PostgreSQL 17
 * (or uses CI's cluster via VANTAGE_TEST_DB), creates the roles from tools/db-setup.sql, migrates, loads
 * fixtures/august.json through the built loader, and starts the built API (dist/main.js, VANTAGE_LLM=none)
 * on a fixed loopback port the Vite preview proxies to. It spawns the built dist rather than importing
 * apps/api/src, so the web build stays uncoupled from server internals. Teardown kills the API by PID
 * (never by name) and stops the embedded cluster.
 *
 * What it must never do: touch a database named `vantage`, or leave the API process or the cluster running.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const API_PORT = 4123;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const distDir = path.join(repoRoot, 'apps', 'api', 'dist');
const TEST_DB = 'vantage_e2e';
const VARIABLES = { owner_password: 'vantage_owner_e2e', app_password: 'vantage_app_e2e', reader_password: 'vantage_reader_e2e', database: TEST_DB };

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      srv.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no port'))));
    });
  });
}

/** tools/db-setup.sql is written for psql; substitute its `:'literal'` / `:"identifier"` variables and drop `\` meta-commands so pg can run it. */
function roleSetupSql(): string {
  const raw = readFileSync(path.join(repoRoot, 'tools', 'db-setup.sql'), 'utf8');
  return raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('\\'))
    .join('\n')
    .replace(/:'(\w+)'/g, (_m, name: keyof typeof VARIABLES) => `'${VARIABLES[name].replace(/'/g, "''")}'`)
    .replace(/:"(\w+)"/g, (_m, name: keyof typeof VARIABLES) => `"${VARIABLES[name].replace(/"/g, '""')}"`);
}

function asRole(url: string, role: string, password: string): string {
  const u = new URL(url);
  u.username = role;
  u.password = password;
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

/** Run a built dist entrypoint to completion; reject with its output if it exits non-zero. */
function runNode(script: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(script)} exited ${code}:\n${out}`))));
    child.on('error', reject);
  });
}

async function waitForHealth(url: string, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`API did not become healthy at ${url} within ${deadlineMs} ms`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!existsSync(path.join(distDir, 'main.js'))) {
    throw new Error('apps/api/dist is missing — run `npm run build` before the e2e suite (npm run e2e:web does this).');
  }

  let superUrl = process.env['VANTAGE_TEST_DB'];
  let stopPg: () => Promise<void> = async () => undefined;

  if (!superUrl) {
    const port = await freePort();
    const dir = mkdtempSync(path.join(tmpdir(), 'vantage-e2e-pg-'));
    // Let this harness remove the directory after stop(). embedded-postgres deletes immediately when
    // persistent=false, which intermittently races Windows antivirus/file-handle release with EBUSY.
    const embedded = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => undefined, onError: () => undefined });
    await embedded.initialise();
    await embedded.start();
    superUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
    stopPg = async () => {
      await embedded.stop();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    };
  }

  let api: ChildProcess | null = null;
  try {
    const admin = new pg.Client({ connectionString: superUrl });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.query(`CREATE DATABASE ${TEST_DB} ENCODING 'UTF8' TEMPLATE template0`);
      await admin.query(roleSetupSql());
    } finally {
      await admin.end();
    }

    const dbEnv: NodeJS.ProcessEnv = {
      VANTAGE_DATABASE_URL_OWNER: asRole(superUrl, 'vantage_owner', VARIABLES.owner_password),
      VANTAGE_DATABASE_URL_RW: asRole(superUrl, 'vantage_app', VARIABLES.app_password),
      VANTAGE_DATABASE_URL_RO: asRole(superUrl, 'vantage_reader', VARIABLES.reader_password),
      VANTAGE_LLM: 'none',
    };

    await runNode(path.join(distDir, 'migrate.js'), dbEnv);
    await runNode(path.join(distDir, 'fixture-load.js'), dbEnv);

    api = spawn(process.execPath, [path.join(distDir, 'main.js')], {
      cwd: repoRoot,
      env: { ...process.env, ...dbEnv, VANTAGE_PORT: String(API_PORT), VANTAGE_BIND: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    api.stderr?.on('data', (d: Buffer) => process.stderr.write(`[e2e-api] ${d.toString()}`));
    await waitForHealth(`http://127.0.0.1:${API_PORT}/health`, 30_000);
  } catch (err) {
    if (api && api.exitCode === null) api.kill('SIGTERM');
    await stopPg().catch(() => undefined);
    throw err;
  }

  const apiChild = api;
  return async () => {
    if (apiChild && apiChild.exitCode === null) apiChild.kill('SIGTERM');
    await stopPg().catch(() => undefined);
  };
}

/**
 * migrations.spec.ts — forward-only, checksummed with LF, owner-only, idempotent; an edited file refuses to run.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { MIGRATION_ROLE, MigrationRunner, migrationStatus, readMigrationFiles } from '../../src/infra/migration-runner.js';
import { MIGRATIONS_DIR } from '../helpers/app.js';

const FILES = ['0001_init.sql', '0002_person_merges_moved_ids.sql', '0003_persons_merged_into_idx.sql', '0004_asks_model.sql'];
const VERSION = 4;

let owner: pg.Pool;
beforeAll(() => {
  owner = new pg.Pool({ connectionString: inject('dbOwnerUrl'), max: 2 });
});
afterAll(async () => {
  await owner.end();
});

/** A scratch copy of the real migrations directory, each file passed through `transform`, for the caller to add to or edit. */
function scratchMigrations(transform: (name: string, sql: string) => string = (_n, sql) => sql): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vantage-mig-'));
  for (const name of [...FILES, 'grants.sql']) writeFileSync(path.join(dir, name), transform(name, readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')));
  return dir;
}

async function inScratch(dir: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('MigrationRunner', () => {
  it('reads NNNN_name.sql files in order with a sha256 checksum and ignores grants.sql', () => {
    const files = readMigrationFiles(MIGRATIONS_DIR);
    expect(files.map((f) => f.name)).toEqual(FILES);
    expect(files.every((f) => /^[0-9a-f]{64}$/.test(f.checksum))).toBe(true);
  });

  it(`reports version ${VERSION} applied with nothing pending and nothing mismatched`, async () => {
    expect(await migrationStatus(owner, MIGRATIONS_DIR)).toEqual({ version: VERSION, pending: [], mismatched: [] });
  });

  it('running again applies nothing and leaves the grants in place', async () => {
    const r = await new MigrationRunner(inject('dbOwnerUrl'), MIGRATIONS_DIR).run();
    expect(r).toEqual({ applied: [], version: VERSION });
    const grants = await owner.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants WHERE grantee = 'vantage_reader' AND table_name = 'events'`,
    );
    expect(grants.rows.map((g) => g.privilege_type)).toEqual(['SELECT']);
  });

  it('checksums with LF line endings: a CRLF checkout of the same files is neither pending nor mismatched', async () => {
    const dir = scratchMigrations((_n, sql) => sql.replace(/\n/g, '\r\n'));
    await inScratch(dir, async () => {
      expect(readFileSync(path.join(dir, '0001_init.sql'), 'utf8')).toContain('\r\n');
      expect(readMigrationFiles(dir).map((f) => f.checksum)).toEqual(readMigrationFiles(MIGRATIONS_DIR).map((f) => f.checksum));
      expect(await migrationStatus(owner, dir)).toEqual({ version: VERSION, pending: [], mismatched: [] });
    });
  });

  it('refuses to run when an applied migration file was edited (checksum mismatch)', async () => {
    const dir = scratchMigrations((name, sql) => (name === '0001_init.sql' ? `${sql}\n-- edited after apply\n` : sql));
    await inScratch(dir, async () => {
      expect(await migrationStatus(owner, dir)).toEqual({ version: VERSION, pending: [], mismatched: [1] });
      await expect(new MigrationRunner(inject('dbOwnerUrl'), dir).run()).rejects.toThrow(/checksum mismatch for version\(s\) 1/);
    });
  });

  it('reports a new file as pending without applying it', async () => {
    const dir = scratchMigrations();
    await inScratch(dir, async () => {
      writeFileSync(path.join(dir, '0005_future.sql'), 'SELECT 1;');
      expect(await migrationStatus(owner, dir)).toEqual({ version: VERSION, pending: [5], mismatched: [] });
    });
  });

  it('a failing migration rolls back and names the file; nothing is recorded', async () => {
    const dir = scratchMigrations((name, sql) => (name === 'grants.sql' ? 'SELECT 1;' : sql));
    await inScratch(dir, async () => {
      writeFileSync(path.join(dir, '0005_broken.sql'), 'CREATE TABLE will_not_exist (id int); SELECT * FROM no_such_table;');
      await expect(new MigrationRunner(inject('dbOwnerUrl'), dir).run()).rejects.toThrow(/migration 0005_broken.sql failed/);
      expect((await owner.query(`SELECT to_regclass('public.will_not_exist') AS r`)).rows[0].r).toBeNull();
      expect(await migrationStatus(owner, MIGRATIONS_DIR)).toEqual({ version: VERSION, pending: [], mismatched: [] });
    });
  });

  it('refuses to run as any role but the owner, before taking the lock or touching a file', async () => {
    expect(MIGRATION_ROLE).toBe('vantage_owner');
    await expect(new MigrationRunner(inject('dbRwUrl'), MIGRATIONS_DIR).run()).rejects.toThrow(/migrations must run as vantage_owner, not as "vantage_app"/);
    await expect(new MigrationRunner(inject('dbOwnerUrl'), MIGRATIONS_DIR, 'someone_else').run()).rejects.toThrow(/must run as someone_else, not as "vantage_owner"/);
  });

  it('the app roles cannot run DDL: vantage_app fails CREATE TABLE with 42501', async () => {
    const rw = new pg.Pool({ connectionString: inject('dbRwUrl'), max: 1 });
    try {
      await expect(rw.query('CREATE TABLE smuggled (id int)')).rejects.toMatchObject({ code: '42501' });
    } finally {
      await rw.end();
    }
  });

  it('0002: person_merges.distinct_ids_moved is a text[] of the moved ids and persons.merged_into points at a person of the same project', async () => {
    const cols = await owner.query<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, udt_name, is_nullable FROM information_schema.columns
       WHERE (table_name, column_name) IN (('person_merges', 'distinct_ids_moved'), ('persons', 'merged_into')) ORDER BY table_name`,
    );
    expect(cols.rows).toEqual([
      { table_name: 'person_merges', column_name: 'distinct_ids_moved', udt_name: '_text', is_nullable: 'NO' },
      { table_name: 'persons', column_name: 'merged_into', udt_name: 'uuid', is_nullable: 'YES' },
    ]);
    const fk = await owner.query(`SELECT 1 FROM pg_constraint WHERE conname = 'persons_merged_into_fkey' AND contype = 'f'`);
    expect(fk.rowCount).toBe(1);
  });

  it('0003: the merge pointer is indexed (partial, on the merged rows only), so the foreign key check and "merged into whom" lookups do not scan persons', async () => {
    const idx = await owner.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname = 'persons_merged_into_idx'`);
    expect(idx.rows[0]?.indexdef).toContain('(project_id, merged_into) WHERE (merged_into IS NOT NULL)');
  });

  it('0004: asks.model is a nullable text column, and the two runtime roles’ privileges on asks are unchanged (table-level INSERT for the app, SELECT for the reader)', async () => {
    const col = await owner.query<{ udt_name: string; is_nullable: string }>(`SELECT udt_name, is_nullable FROM information_schema.columns WHERE table_name = 'asks' AND column_name = 'model'`);
    expect(col.rows).toEqual([{ udt_name: 'text', is_nullable: 'YES' }]);
    const grants = await owner.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = 'asks' AND grantee IN ('vantage_app', 'vantage_reader') ORDER BY grantee, privilege_type`,
    );
    expect(grants.rows).toEqual([
      { grantee: 'vantage_app', privilege_type: 'INSERT' },
      { grantee: 'vantage_reader', privilege_type: 'SELECT' },
    ]);
  });
});

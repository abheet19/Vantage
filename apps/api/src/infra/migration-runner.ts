/**
 * migration-runner.ts — applies `migrations/NNNN_name.sql` forward-only, once, under a lock, as the owner.
 *
 * Why it exists: LLD §2 — migrations are plain SQL, forward-only, checksummed, recorded in
 * `schema_migrations`, and run inside a transaction with an advisory lock so two API processes booting
 * at once cannot both apply 0002. Checksums are what make "forward-only" real: a file edited after it
 * was applied is a different schema than the one on disk, and the runner refuses rather than guessing.
 * Files are checksummed with LF line endings so a Windows checkout and a Linux CI agree on what was
 * applied. After a successful run the runner re-applies `grants.sql`, because privileges can only be
 * granted on tables that exist, and the roles that receive them are created earlier by tools/db-setup.ps1.
 *
 * What it must never do: run as any role but the owner (checked against `current_user` before the lock
 * is taken — the app roles cannot CREATE, but a superuser could, and would leave tables the owner does
 * not own), apply files out of order, skip a version, or "fix" a checksum mismatch. `migrationStatus`
 * is the read-only half used at boot when the API has no owner credentials.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export interface MigrationFile {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationStatus {
  /** Highest applied version, or null when the table does not exist yet. */
  version: number | null;
  pending: number[];
  mismatched: number[];
}

/** One fixed key for the whole cluster: only one runner at a time, whatever database it targets. */
const MIGRATION_LOCK_KEY = 727_001;

/** The role that owns every table; `VANTAGE_MIGRATION_ROLE` overrides it for a cluster whose owner is named differently. */
export const MIGRATION_ROLE = 'vantage_owner';

const normalizeEol = (sql: string): string => sql.replace(/\r\n/g, '\n');

/** `NNNN_name.sql` in `dir`, sorted by version; anything else in the directory is ignored (grants.sql lives there too). */
export function readMigrationFiles(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => {
      const sql = normalizeEol(readFileSync(path.join(dir, f), 'utf8'));
      return { version: Number(f.slice(0, 4)), name: f, sql, checksum: createHash('sha256').update(sql, 'utf8').digest('hex') };
    });
}

async function appliedRows(q: pg.ClientBase | pg.Pool): Promise<Map<number, string> | null> {
  const exists = await q.query<{ ok: string | null }>(`SELECT to_regclass('public.schema_migrations')::text AS ok`);
  if (exists.rows[0]?.ok === null) return null;
  const rows = await q.query<{ version: number; checksum: string }>('SELECT version, checksum FROM schema_migrations ORDER BY version');
  return new Map(rows.rows.map((r) => [r.version, r.checksum]));
}

function statusOf(applied: Map<number, string> | null, files: readonly MigrationFile[]): MigrationStatus {
  if (applied === null) return { version: null, pending: files.map((f) => f.version), mismatched: [] };
  const pending = files.filter((f) => !applied.has(f.version)).map((f) => f.version);
  const mismatched = files.filter((f) => applied.has(f.version) && applied.get(f.version) !== f.checksum).map((f) => f.version);
  const version = applied.size === 0 ? null : Math.max(...applied.keys());
  return { version, pending, mismatched };
}

/** Compares the files on disk with `schema_migrations`; needs only SELECT, so any role can call it. */
export async function migrationStatus(q: pg.ClientBase | pg.Pool, dir: string): Promise<MigrationStatus> {
  return statusOf(await appliedRows(q), readMigrationFiles(dir));
}

export class MigrationRunner {
  constructor(
    private readonly ownerUrl: string,
    private readonly dir: string,
    private readonly expectedRole: string = MIGRATION_ROLE,
  ) {}

  /** Applies every pending file in order, each in its own transaction, then re-applies grants.sql. Returns what it applied. */
  async run(): Promise<{ applied: number[]; version: number | null }> {
    const files = readMigrationFiles(this.dir);
    const client = new pg.Client({ connectionString: this.ownerUrl });
    await client.connect();
    try {
      const user = (await client.query<{ u: string }>('SELECT current_user AS u')).rows[0]?.u ?? '';
      if (user !== this.expectedRole) throw new Error(`migrations must run as ${this.expectedRole}, not as "${user}": tables created by another role would not be owned by the owner`);

      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      const status = statusOf(await appliedRows(client), files);
      if (status.mismatched.length > 0) {
        throw new Error(`migration checksum mismatch for version(s) ${status.mismatched.join(', ')}: a migration file was edited after it was applied`);
      }
      const applied: number[] = [];
      for (const f of files.filter((f) => status.pending.includes(f.version))) {
        await this.apply(client, f);
        applied.push(f.version);
      }
      await client.query(readFileSync(path.join(this.dir, 'grants.sql'), 'utf8'));
      return { applied, version: statusOf(await appliedRows(client), files).version };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
      await client.end();
    }
  }

  private async apply(client: pg.Client, f: MigrationFile): Promise<void> {
    await client.query('BEGIN');
    try {
      await client.query(f.sql);
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [f.version, f.checksum]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${f.name} failed: ${(err as Error).message}`, { cause: err });
    }
  }
}

/**
 * migrate.ts — `npm run migrate`: apply pending migrations as vantage_owner and exit.
 *
 * Why it exists: the API's runtime roles cannot run DDL by design, so migrating is a separate act
 * with the owner's credentials (`VANTAGE_DATABASE_URL_OWNER`). The API can also do this at boot when
 * that variable is present; this entrypoint is for CI, for operators who prefer an explicit step, and
 * for seeing what would be applied.
 *
 * What it must never do: run as a role other than the owner (the runner checks `current_user` and
 * refuses), or fall back to the RW URL.
 */
import { defaultMigrationsDir } from './infra/config.js';
import { MIGRATION_ROLE, MigrationRunner, migrationStatus } from './infra/migration-runner.js';
import pg from 'pg';

async function main(): Promise<void> {
  const ownerUrl = process.env['VANTAGE_DATABASE_URL_OWNER'];
  if (!ownerUrl) throw new Error('VANTAGE_DATABASE_URL_OWNER is required to run migrations (tools/db-setup.ps1 writes it to .env)');
  const dir = process.env['VANTAGE_MIGRATIONS_DIR'] || defaultMigrationsDir();
  const result = await new MigrationRunner(ownerUrl, dir, process.env['VANTAGE_MIGRATION_ROLE'] || MIGRATION_ROLE).run();
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const status = await migrationStatus(pool, dir);
    console.log(`applied: [${result.applied.join(', ')}]; schema version: ${status.version ?? 'none'}; pending: [${status.pending.join(', ')}]`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(`migrate failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

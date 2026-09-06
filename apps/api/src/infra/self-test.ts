/**
 * self-test.ts — the boot check that refuses to run on a database whose roles are not what L3 assumes.
 *
 * Why it exists: the read-only role is a security boundary, not a convention (design §4.2), and the app
 * role's privileges are the blast radius of an ingest bug. So before serving a request the API reads the
 * live catalog and compares BOTH roles' privileges — every table in `public`, every privilege type,
 * column-level grants, the schema and the database — against the explicit allowlist below. A widened
 * GRANT (extra) refuses to boot exactly like a dropped one (missing), because `grants.sql` can only
 * describe the roles it knows about and an operator's `GRANT` by hand must not survive unnoticed. The
 * roles behind each pool, the reader's timeout and read-only defaults, the four load-bearing indexes
 * and the UTF8 encoding are checked the same way: read, compared, reported.
 *
 * What it must never do: write anything (every check is a SELECT), or accept a privilege the allowlist
 * does not name because "it is probably harmless" — the allowlist is the LLD §2 role table.
 */
import pg from 'pg';
import { RO_STATEMENT_TIMEOUT } from './limits.js';

export interface SelfTestCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface SelfTestResult {
  ok: boolean;
  checks: SelfTestCheck[];
}

/** LLD §2: the indexes a migration must never drop; `events_dedupe` is the ON CONFLICT target that makes retries safe. */
export const REQUIRED_INDEXES = ['events_dedupe', 'events_funnel', 'events_ts_brin', 'pdi_lookup'] as const;

export type RuntimeRole = 'vantage_app' | 'vantage_reader';

/**
 * LLD §2's role table plus the recorded extensions (E1, E2, the column-level writes of the S1
 * hardening pass, and the S8 rotate-key column write `projects UPDATE(api_key_hash)`), in the notation
 * the catalog query below produces. `CONNECT` is PUBLIC's default on
 * every database; `TEMP` is not listed because tools/db-setup.sql revokes it.
 */
export const EXPECTED_PRIVILEGES: Readonly<Record<RuntimeRole, readonly string[]>> = {
  vantage_app: [
    'database CONNECT',
    'schema public USAGE',
    'projects SELECT',
    'projects INSERT',
    'projects UPDATE(api_key_hash)',
    'persons SELECT',
    'persons INSERT',
    'persons UPDATE(merged_into)',
    'person_distinct_ids SELECT',
    'person_distinct_ids INSERT',
    'person_distinct_ids UPDATE(person_id)',
    'person_merges INSERT',
    'events INSERT',
    'events SELECT(project_id, insert_id)',
    'asks INSERT',
    'schema_migrations SELECT',
  ],
  vantage_reader: [
    'database CONNECT',
    'schema public USAGE',
    'events SELECT',
    'persons SELECT',
    'person_distinct_ids SELECT',
    'person_merges SELECT',
    'projects SELECT',
    'asks SELECT',
    'schema_migrations SELECT',
  ],
};

/**
 * Every privilege each role actually holds, one row per grant, in the allowlist's notation. Column-level
 * grants appear only where the role lacks the table-level privilege, so `events SELECT(project_id,
 * insert_id)` and `events SELECT` cannot both be reported for one role.
 */
const PRIVILEGE_MATRIX = `
  WITH roles AS (SELECT unnest($1::text[]) AS role),
       tables AS (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p'))
  SELECT r.role, format('database %s', p.privilege) AS grant
    FROM roles r, unnest(ARRAY['CONNECT', 'TEMP', 'CREATE']) AS p(privilege)
   WHERE has_database_privilege(r.role, current_database(), p.privilege)
  UNION ALL
  SELECT r.role, format('schema public %s', p.privilege)
    FROM roles r, unnest(ARRAY['USAGE', 'CREATE']) AS p(privilege)
   WHERE has_schema_privilege(r.role, 'public', p.privilege)
  UNION ALL
  SELECT r.role, format('%s %s', t.relname, p.privilege)
    FROM roles r, tables t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilege)
   WHERE has_table_privilege(r.role, t.oid, p.privilege)
  UNION ALL
  SELECT r.role, format('%s %s(%s)', t.relname, p.privilege, string_agg(a.attname, ', ' ORDER BY a.attnum))
    FROM roles r, tables t, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(privilege), pg_attribute a
   WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
     AND NOT has_table_privilege(r.role, t.oid, p.privilege)
     AND has_column_privilege(r.role, t.oid, a.attnum, p.privilege)
   GROUP BY r.role, t.relname, p.privilege`;

const grantLine = (role: string, grant: string) => `${role}: ${grant}`;

async function actualPrivileges(pool: pg.Pool): Promise<Set<string>> {
  const r = await pool.query<{ role: string; grant: string }>(PRIVILEGE_MATRIX, [Object.keys(EXPECTED_PRIVILEGES)]);
  return new Set(r.rows.map((row) => grantLine(row.role, row.grant)));
}

async function showSetting(pool: pg.Pool, name: string): Promise<string> {
  const r = await pool.query<Record<string, string>>(`SHOW ${name}`);
  return r.rows[0]?.[name] ?? '';
}

async function currentUser(pool: pg.Pool): Promise<string> {
  return (await pool.query<{ u: string }>('SELECT current_user AS u')).rows[0]?.u ?? '';
}

/** Runs every check and returns them all; the caller decides to refuse. Never throws for a failed check, only for an unreachable database. */
export async function runBootSelfTest(rw: pg.Pool, ro: pg.Pool): Promise<SelfTestResult> {
  const checks: SelfTestCheck[] = [];
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const rwUser = await currentUser(rw);
  check('rw.role', rwUser === 'vantage_app', `RW pool connects as "${rwUser}"; expected vantage_app`);
  const roUser = await currentUser(ro);
  check('ro.role', roUser === 'vantage_reader', `RO pool connects as "${roUser}"; expected vantage_reader`);

  const encoding = await showSetting(rw, 'server_encoding');
  check('db.encoding', encoding === 'UTF8', `server_encoding = "${encoding}"; expected UTF8 (a WIN1252 database cannot store arbitrary event names and properties)`);

  const timeout = await showSetting(ro, 'statement_timeout');
  check('ro.statement_timeout', timeout === RO_STATEMENT_TIMEOUT, `SHOW statement_timeout on RO = "${timeout}"; expected ${RO_STATEMENT_TIMEOUT}`);
  const readOnly = await showSetting(ro, 'default_transaction_read_only');
  check('ro.default_transaction_read_only', readOnly === 'on', `SHOW default_transaction_read_only on RO = "${readOnly}"; expected on`);

  const expected = new Set(Object.entries(EXPECTED_PRIVILEGES).flatMap(([role, grants]) => grants.map((g) => grantLine(role, g))));
  const actual = await actualPrivileges(rw);
  const extra = [...actual].filter((g) => !expected.has(g)).sort();
  const missing = [...expected].filter((g) => !actual.has(g)).sort();
  check(
    'privileges',
    extra.length === 0 && missing.length === 0,
    extra.length === 0 && missing.length === 0
      ? `both roles hold exactly the ${expected.size} grants of the LLD §2 allowlist`
      : `extra: [${extra.join(', ')}]; missing: [${missing.join(', ')}]`,
  );

  const idx = await rw.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`, [
    [...REQUIRED_INDEXES],
  ]);
  const present = new Set(idx.rows.map((r) => r.indexname));
  const missingIndexes = REQUIRED_INDEXES.filter((i) => !present.has(i));
  check('indexes', missingIndexes.length === 0, missingIndexes.length === 0 ? `all present: ${REQUIRED_INDEXES.join(', ')}` : `missing index(es): ${missingIndexes.join(', ')}`);

  return { ok: checks.every((c) => c.ok), checks };
}

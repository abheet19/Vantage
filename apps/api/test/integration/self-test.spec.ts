/**
 * self-test.spec.ts — the boot refuses a privilege the allowlist does not name (in either direction), a wrong role behind a pool, and a missing index.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { EXPECTED_PRIVILEGES, REQUIRED_INDEXES, runBootSelfTest } from '../../src/infra/self-test.js';
import { createTestApp } from '../helpers/app.js';

let owner: pg.Pool;
beforeAll(() => {
  owner = new pg.Pool({ connectionString: inject('dbOwnerUrl'), max: 2 });
});
afterAll(async () => {
  await owner.end();
});

const CHECK_NAMES = ['rw.role', 'ro.role', 'db.encoding', 'ro.statement_timeout', 'ro.default_transaction_read_only', 'privileges', 'indexes'];

/** Runs `mutate` on the live grants, asserts the boot refuses with `refusal`, undoes it, and asserts the boot succeeds again. */
async function refusesWhile(mutate: string, undo: string, refusal: RegExp): Promise<void> {
  await owner.query(mutate);
  try {
    await expect(createTestApp()).rejects.toThrow(refusal);
  } finally {
    await owner.query(undo);
  }
  const t = await createTestApp();
  await t.close();
}

describe('boot self-test', () => {
  it('passes on the database tools/db-setup.sql + migrations produce, holding both roles to the LLD §2 allowlist', async () => {
    const rw = new pg.Pool({ connectionString: inject('dbRwUrl'), max: 1 });
    const ro = new pg.Pool({ connectionString: inject('dbRoUrl'), max: 1 });
    try {
      const r = await runBootSelfTest(rw, ro);
      expect(r.checks.filter((c) => !c.ok)).toEqual([]);
      expect(r.checks.map((c) => c.name)).toEqual(CHECK_NAMES);
      const grants = Object.values(EXPECTED_PRIVILEGES).reduce((n, g) => n + g.length, 0);
      expect(r.checks.find((c) => c.name === 'privileges')?.detail).toBe(`both roles hold exactly the ${grants} grants of the LLD §2 allowlist`);
      expect(r.checks.find((c) => c.name === 'indexes')?.detail).toContain(REQUIRED_INDEXES.join(', '));
    } finally {
      await Promise.all([rw.end(), ro.end()]);
    }
  });

  it('refuses to start when vantage_app is granted DELETE on events, naming the extra privilege, and starts again once it is revoked', async () => {
    await refusesWhile('GRANT DELETE ON events TO vantage_app', 'REVOKE DELETE ON events FROM vantage_app', /boot self-test refused to start: privileges: extra: \[vantage_app: events DELETE\]; missing: \[\]/);
  });

  it('refuses to start when vantage_reader has been granted INSERT (L3 widened), naming the role and table', async () => {
    await refusesWhile('GRANT INSERT ON events TO vantage_reader', 'REVOKE INSERT ON events FROM vantage_reader', /privileges: extra: \[vantage_reader: events INSERT\]/);
  });

  it('refuses to start when a grant the allowlist requires is missing, naming it', async () => {
    await refusesWhile('REVOKE SELECT ON schema_migrations FROM vantage_reader', 'GRANT SELECT ON schema_migrations TO vantage_reader', /privileges: extra: \[\]; missing: \[vantage_reader: schema_migrations SELECT\]/);
  });

  it('refuses to start when a runtime role can CREATE in schema public', async () => {
    await refusesWhile('GRANT CREATE ON SCHEMA public TO vantage_app', 'REVOKE CREATE ON SCHEMA public FROM vantage_app', /extra: \[vantage_app: schema public CREATE\]/);
  });

  it('refuses to start when a column-level grant is widened to the whole row', async () => {
    await refusesWhile('GRANT UPDATE ON person_distinct_ids TO vantage_app', 'REVOKE UPDATE ON person_distinct_ids FROM vantage_app; GRANT UPDATE (person_id) ON person_distinct_ids TO vantage_app', /extra: \[vantage_app: person_distinct_ids UPDATE\]; missing: \[vantage_app: person_distinct_ids UPDATE\(person_id\)\]/);
  });

  it('neither runtime role can create even a temporary table, even in a READ WRITE transaction: db-setup.sql revoked TEMP from PUBLIC', async () => {
    for (const url of [inject('dbRwUrl'), inject('dbRoUrl')]) {
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET TRANSACTION READ WRITE');
        await expect(client.query('CREATE TEMP TABLE smuggled (id int)')).rejects.toMatchObject({ code: '42501' });
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        await client.end();
      }
    }
  });

  it('refuses to start when the RO pool is not vantage_reader (both URLs pointing at the app role)', async () => {
    await expect(createTestApp({ db: { roUrl: inject('dbRwUrl') } })).rejects.toThrow(/ro\.role: RO pool connects as "vantage_app"/);
  });

  it('refuses to start when the RW pool is not vantage_app', async () => {
    await expect(createTestApp({ db: { rwUrl: inject('dbOwnerUrl') } })).rejects.toThrow(/rw\.role: RW pool connects as "vantage_owner"/);
  });

  it('refuses to start when one of the four required indexes is missing, and recovers when it is recreated', async () => {
    await refusesWhile('DROP INDEX events_ts_brin', 'CREATE INDEX events_ts_brin ON events USING brin (event_ts) WITH (pages_per_range = 64)', /indexes: missing index\(es\): events_ts_brin/);
  });

  it('a widened UPDATE on the reader fails the privileges check even though default_transaction_read_only is on — grants are the boundary, the flag is a courtesy', async () => {
    const ro = new pg.Pool({ connectionString: inject('dbRoUrl'), max: 1 });
    const rw = new pg.Pool({ connectionString: inject('dbRwUrl'), max: 1 });
    try {
      expect((await ro.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only).toBe('on');
      await owner.query('GRANT UPDATE ON events TO vantage_reader');
      try {
        const r = await runBootSelfTest(rw, ro);
        expect(r.ok).toBe(false);
        expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['privileges']);
        expect(r.checks.find((c) => c.name === 'privileges')?.detail).toBe('extra: [vantage_reader: events UPDATE]; missing: []');
      } finally {
        await owner.query('REVOKE UPDATE ON events FROM vantage_reader');
      }
    } finally {
      await Promise.all([rw.end(), ro.end()]);
    }
  });
});

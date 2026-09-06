/**
 * reader-cannot-write.spec.ts — V7(c) as an end-to-end fact about the database, not about Vantage: connected as
 * vantage_reader through a raw pg client, every write is refused — inside a READ ONLY transaction by the flag (25006),
 * and with the flag switched off by the grants (42501). Both codes are `refused_by_database` to the runner. This is the
 * demo's `psql -U vantage_reader -c "DROP TABLE events"` (design §8, 0:55) and the LLD §9 S3 attack row.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { PG_ERROR_STATUS } from '../../src/domain/status.js';

let reader: pg.Client;
beforeAll(async () => {
  reader = new pg.Client({ connectionString: inject('dbRoUrl') });
  await reader.connect();
});
afterAll(async () => {
  await reader.end();
});

const readOnlyDefault = async (): Promise<string> => (await reader.query<{ v: string }>(`SELECT current_setting('default_transaction_read_only') AS v`)).rows[0]?.v ?? 'unset';

const code = async (client: pg.Client, sql: string): Promise<string> => {
  try {
    await client.query(sql);
    return 'no error';
  } catch (err) {
    return (err as { code?: string }).code ?? 'no code';
  }
};

const WRITES = [
  'DROP TABLE events',
  "INSERT INTO events (project_id, event_id, insert_id, distinct_id, event, server_ts, event_ts, ts_source, key_source) VALUES (gen_random_uuid(), gen_random_uuid(), 'x', 'x', 'x', now(), now(), 'server', 'client')",
  "INSERT INTO asks (ask_id, project_id, question, adapter, decision) VALUES (gen_random_uuid(), gen_random_uuid(), 'q', 'none', 'ran')",
  "UPDATE persons SET merged_into = NULL",
  'DELETE FROM events',
  'TRUNCATE events',
  'ALTER TABLE events ADD COLUMN evil text',
  'CREATE TABLE evil (id int)',
  "UPDATE asks SET decision = 'ran'",
];

describe('vantage_reader cannot write (V7c)', () => {
  it('can read: SELECT on events works, so what follows is about privilege, not connectivity', async () => {
    expect(await code(reader, 'SELECT count(*) FROM events')).toBe('no error');
    expect((await reader.query<{ u: string }>('SELECT current_user AS u')).rows[0]?.u).toBe('vantage_reader');
  });

  it('with the role’s default (read-only transactions), DROP TABLE events is refused by the READ ONLY flag: 25006', async () => {
    expect(await readOnlyDefault()).toBe('on');
    expect(await code(reader, 'DROP TABLE events')).toBe('25006');
  });

  it('inside BEGIN READ ONLY every write is 25006, and the transaction is then aborted', async () => {
    for (const sql of WRITES) {
      await reader.query('BEGIN READ ONLY');
      expect(await code(reader, sql), sql).toBe('25006');
      await reader.query('ROLLBACK');
    }
  });

  it('attack: SET default_transaction_read_only = off, then every write — grants are the boundary: 42501 for all of them', async () => {
    await reader.query('SET default_transaction_read_only = off');
    try {
      expect(await readOnlyDefault()).toBe('off');
      for (const sql of WRITES) expect(await code(reader, sql), sql).toBe('42501');
    } finally {
      await reader.query('RESET default_transaction_read_only');
    }
  });

  it('inside BEGIN READ WRITE the answer is the same 42501 — the flag was never what stood between the reader and DROP', async () => {
    await reader.query('BEGIN READ WRITE');
    try {
      expect(await code(reader, 'DROP TABLE events')).toBe('42501');
    } finally {
      await reader.query('ROLLBACK');
    }
  });

  it('both refusal codes are the ones the runner maps to refused_by_database, so L3 firing is always visible as a status', () => {
    expect(PG_ERROR_STATUS['25006']).toBe('refused_by_database');
    expect(PG_ERROR_STATUS['42501']).toBe('refused_by_database');
  });

  it('the reader cannot widen itself: GRANT to itself grants nothing (PostgreSQL answers with a WARNING, not an error) and CREATE in schema public is 42501', async () => {
    const notices: string[] = [];
    const onNotice = (n: { severity?: string | undefined; message?: string | undefined }) => notices.push(`${n.severity ?? ''}: ${n.message ?? ''}`);
    reader.on('notice', onNotice);
    await reader.query('SET default_transaction_read_only = off');
    try {
      expect(await code(reader, 'GRANT INSERT ON events TO vantage_reader')).toBe('no error');
      expect(notices).toEqual([expect.stringMatching(/^WARNING: no privileges were granted for "events"/)]);
      expect((await reader.query<{ can: boolean }>(`SELECT has_table_privilege('vantage_reader', 'events', 'INSERT') AS can`)).rows[0]?.can).toBe(false);
      expect(await code(reader, 'CREATE TABLE public.evil2 (id int)')).toBe('42501');
    } finally {
      reader.off('notice', onNotice);
      await reader.query('RESET default_transaction_read_only');
    }
  });

  it('nor can the app role drop or truncate — only the owner holds DDL', async () => {
    const app = new pg.Client({ connectionString: inject('dbRwUrl') });
    await app.connect();
    try {
      expect(await code(app, 'DROP TABLE events')).toBe('42501');
      expect(await code(app, 'TRUNCATE events')).toBe('42501');
      expect(await code(app, 'DELETE FROM asks')).toBe('42501');
      expect(await code(app, "UPDATE asks SET decision = 'ran'")).toBe('42501');
    } finally {
      await app.end();
    }
  });
});

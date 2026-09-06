/**
 * transaction.ts — one pooled client, BEGIN … COMMIT, ROLLBACK on any throw, always released.
 *
 * Why it exists: ingest and identity both need "these statements commit together or not at all", and
 * the interrupted path (LLD §7.1) is only safe if every writer rolls back the same way. One helper is one
 * place to get the rollback-then-release order right; pg leaks the connection otherwise.
 *
 * What it must never do: swallow the error (the caller and the HTTP filter decide its shape), or wrap a
 * single statement — one statement is already atomic, and a transaction around it only holds locks longer.
 */
import pg from 'pg';

export async function inTransaction<T>(pool: pg.Pool, work: (client: pg.ClientBase) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

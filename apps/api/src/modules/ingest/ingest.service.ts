/**
 * ingest.service.ts — one batch: persons in a short transaction, then one INSERT (design §2, LLD §1.1).
 *
 * Why it exists: idempotency is a `UNIQUE (project_id, insert_id)` index and `ON CONFLICT DO NOTHING`;
 * atomicity is a single `INSERT … SELECT FROM unnest(...)`, so a batch either lands whole or not at all —
 * a client that retried a half-inserted batch would otherwise double-count the good half. Persons are
 * created in their own transaction first: create-or-get is idempotent, so an INSERT that fails leaves at
 * most a few eventless persons the retry reuses, and the project-wide identity lock is never held across
 * a 32 MB statement. Rows go in sorted by `insert_id`, so two concurrent batches with overlapping keys
 * take their row locks in the same order and one waits instead of both deadlocking. The response counts
 * what the statement did (`RETURNING`): `accepted` = rows inserted, `duplicates` = the rest, `too_old`
 * only among the accepted — so it stays true under 50 concurrent identical batches (V1).
 *
 * What it must never do: loop over events issuing INSERTs, interpolate any value into SQL, choose a
 * timestamp (that is `normalizeEvent`'s), or mint ids from anything but UUIDv7 (`event_id` orders the
 * heap; a v4 would scatter it).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { IngestBatch, IngestResponse } from '@vantage/contracts';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { normalizeEvent, type NormalizedEvent } from '../../domain/index.js';
import type { Clock } from '../../infra/clock.js';
import { CLOCK, PG_RW } from '../../infra/tokens.js';
import { inTransaction } from '../../infra/transaction.js';
import { IdentityService } from '../identity/identity.service.js';

const INSERT_EVENTS = `
  INSERT INTO events (project_id, event_id, insert_id, key_source, distinct_id, event, properties,
                      client_ts, sent_at, server_ts, event_ts, ts_source)
  SELECT $1, e.event_id, e.insert_id, e.key_source, e.distinct_id, e.event, e.properties,
         e.client_ts, e.sent_at, e.server_ts, e.event_ts, e.ts_source
  FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[], $7::jsonb[],
              $8::timestamptz[], $9::timestamptz[], $10::timestamptz[], $11::timestamptz[], $12::text[])
       AS e(event_id, insert_id, key_source, distinct_id, event, properties,
            client_ts, sent_at, server_ts, event_ts, ts_source)
  ON CONFLICT (project_id, insert_id) DO NOTHING
  RETURNING insert_id`;

/** Columns as parallel arrays: the shape `unnest` wants, built once per batch. */
export function columnsOf(rows: readonly NormalizedEvent[]) {
  return [
    rows.map((r) => r.event_id),
    rows.map((r) => r.insert_id),
    rows.map((r) => r.key_source),
    rows.map((r) => r.distinct_id),
    rows.map((r) => r.event),
    rows.map((r) => JSON.stringify(r.properties)),
    rows.map((r) => r.client_ts?.toISOString() ?? null),
    rows.map((r) => r.sent_at?.toISOString() ?? null),
    rows.map((r) => r.server_ts.toISOString()),
    rows.map((r) => r.event_ts.toISOString()),
    rows.map((r) => r.ts_source),
  ];
}

/** Ascending by insert_id and stable, so a key repeated within one batch keeps its first occurrence first — the one `ON CONFLICT` lets through. */
export function sortedByInsertId(rows: readonly NormalizedEvent[]): NormalizedEvent[] {
  return [...rows].sort((a, b) => (a.insert_id < b.insert_id ? -1 : a.insert_id > b.insert_id ? 1 : 0));
}

/** `too_old` over the rows the statement kept: the first occurrence of each accepted key. */
export function tooOldAmong(rows: readonly NormalizedEvent[], acceptedKeys: ReadonlySet<string>): number {
  const seen = new Set<string>();
  let n = 0;
  for (const r of rows) {
    if (seen.has(r.insert_id)) continue;
    seen.add(r.insert_id);
    if (r.too_old && acceptedKeys.has(r.insert_id)) n++;
  }
  return n;
}

@Injectable()
export class IngestService {
  constructor(
    @Inject(PG_RW) private readonly rw: pg.Pool,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(IdentityService) private readonly identity: IdentityService,
  ) {}

  async ingest(projectId: string, batch: IngestBatch): Promise<IngestResponse> {
    const serverTs = this.clock.now();
    const sentAt = batch.sent_at === undefined ? null : new Date(batch.sent_at);
    const rows = sortedByInsertId(batch.events.map((e) => normalizeEvent(e, sentAt, serverTs, uuidv7)));

    await inTransaction(this.rw, (client) =>
      this.identity.ensurePersons(
        client,
        projectId,
        rows.map((r) => r.distinct_id),
      ),
    );
    const inserted = await this.rw.query<{ insert_id: string }>(INSERT_EVENTS, [projectId, ...columnsOf(rows)]);
    const acceptedKeys = new Set(inserted.rows.map((r) => r.insert_id));
    return {
      accepted: acceptedKeys.size,
      duplicates: rows.length - acceptedKeys.size,
      too_old: tooOldAmong(rows, acceptedKeys),
    };
  }
}

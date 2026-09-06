/**
 * normalize-event.ts — turns what a client sent into the row the `events` table stores.
 *
 * Why it exists: the ingest service should be a thin wrapper (validate, normalise, one INSERT), so
 * every decision about a row — which timestamp to trust, which dedupe key to use, which id to mint —
 * is made here where it can be tested without a database. `mint` is injected so the UUIDv7 comes from
 * the caller and this file stays PURE; `serverTs` is injected for the same reason.
 *
 * What it must never do: mutate the incoming event, invent a timestamp the rule in §1.4 did not
 * produce, or derive a key from anything other than the event's logical content. The client's
 * timestamp is canonicalised to UTC ISO before hashing so the same instant written with a different
 * offset derives the same key.
 */
import type { IncomingEvent, JsonObject } from '@vantage/contracts';
import { adjustTimestamp, type TsSource } from './adjust-timestamp.js';
import { deriveInsertId } from './derive-insert-id.js';

export type KeySource = 'client' | 'derived';

/** One row of `events`, minus `project_id` (the service knows the project; the event does not). */
export interface NormalizedEvent {
  event_id: string;
  insert_id: string;
  key_source: KeySource;
  distinct_id: string;
  event: string;
  properties: JsonObject;
  client_ts: Date | null;
  sent_at: Date | null;
  server_ts: Date;
  event_ts: Date;
  ts_source: TsSource;
  too_old: boolean;
}

export function normalizeEvent(raw: IncomingEvent, batchSentAt: Date | null, serverTs: Date, mint: () => string): NormalizedEvent {
  const clientTs = raw.timestamp === undefined ? null : new Date(raw.timestamp);
  const properties: JsonObject = raw.properties ?? {};
  const adjusted = adjustTimestamp(clientTs, batchSentAt, serverTs);

  const insertId =
    raw.insert_id ??
    deriveInsertId({
      distinct_id: raw.distinct_id,
      event: raw.event,
      client_ts: clientTs === null ? null : clientTs.toISOString(),
      properties,
    });

  return {
    event_id: mint(),
    insert_id: insertId,
    key_source: raw.insert_id === undefined ? 'derived' : 'client',
    distinct_id: raw.distinct_id,
    event: raw.event,
    properties,
    client_ts: clientTs,
    sent_at: batchSentAt,
    server_ts: serverTs,
    event_ts: adjusted.eventTs,
    ts_source: adjusted.source,
    too_old: adjusted.tooOld,
  };
}

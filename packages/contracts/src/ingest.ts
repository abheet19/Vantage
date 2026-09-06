/**
 * ingest.ts — the HTTP contract for `POST /v1/events` and `POST /v1/identify` (LLD §3.1).
 *
 * Why it exists: the same Zod object is the HTTP DTO, the inferred TypeScript type and, later, an MCP
 * schema; three hand-kept copies would drift. Three rules here go beyond the LLD's text because the
 * database enforces them physically and a validated batch must never 500: every text field must be
 * storable (`isStorableText`); every instant must lie inside PostgreSQL's range (`Instant` — Zod's
 * `datetime` accepts year 0, PostgreSQL does not); and an event must carry `insert_id` or `timestamp`,
 * because the derived dedupe key (design §2.2) is a function of `client_ts`, so without both a client's
 * second identical event is indistinguishable from a retry of the first and would be dropped forever
 * (design §2.4, decision 2026-09-05). Objects are strict: a misspelt field is a 422, not silently
 * ignored data.
 *
 * What it must never do: widen a limit the database CHECKs (200 chars, 64 chars for `insert_id`,
 * 500 events) or accept a timestamp the server would have to guess at (`datetime({ offset: true })`
 * means an explicit offset or Z; "yesterday" is a 422, not a server default).
 */
import { z } from 'zod';
import { JsonObject, isStorableText } from './json.js';

const STORABLE = { message: 'contains U+0000 or a lone surrogate, which PostgreSQL cannot store' };

/** A text value PostgreSQL will store byte-for-byte; the length bounds are the database's CHECK constraints. */
export const StorableText = (max: number) => z.string().min(1).max(max).refine(isStorableText, STORABLE);

/** Bounds of an `Instant`: PostgreSQL rejects year 0 and, via an offset, year 1 can become year 0; 2200 is far beyond any event a product will honestly record. */
export const INSTANT_MIN = '1970-01-01T00:00:00Z';
export const INSTANT_MAX = '2200-01-01T00:00:00Z';
const INSTANT_MIN_MS = Date.parse(INSTANT_MIN);
const INSTANT_MAX_MS = Date.parse(INSTANT_MAX);

/** An ISO-8601 instant with an explicit offset that PostgreSQL will store: `timestamp` and `sent_at` both use it. */
export const Instant = z
  .string()
  .datetime({ offset: true })
  .refine(
    (s) => {
      const ms = Date.parse(s);
      return ms >= INSTANT_MIN_MS && ms <= INSTANT_MAX_MS;
    },
    { message: `instant must be between ${INSTANT_MIN} and ${INSTANT_MAX}` },
  );

export const KEYLESS_MESSAGE = 'an event needs insert_id (preferred) or timestamp: without either, a repeat of the event cannot be told from a retry';

/** Why Zod: one schema validates the HTTP body, is handed to MCP as inputSchema, and infers the TS type. Three sources of truth would drift. */
export const IncomingEvent = z
  .strictObject({
    event: StorableText(200),
    distinct_id: StorableText(200),
    timestamp: Instant.optional(),
    insert_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(), // ⟨D1⟩ 64 so SHA-256-derived keys from other SDKs fit; derived keys stay 32 hex
    properties: JsonObject.optional(),
  })
  .refine((e) => e.insert_id !== undefined || e.timestamp !== undefined, { message: KEYLESS_MESSAGE });
export type IncomingEvent = z.infer<typeof IncomingEvent>;

export const IngestBatch = z.strictObject({
  sent_at: Instant.optional(),
  events: z.array(IncomingEvent).min(1).max(500),
});
export type IngestBatch = z.infer<typeof IngestBatch>;

/** All-or-nothing: a batch with any invalid event is a 422 naming the index, so there is no per-event rejection list. */
export const IngestResponse = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  too_old: z.number().int(),
});
export type IngestResponse = z.infer<typeof IngestResponse>;

export const IdentifyBody = z.strictObject({ anonymous_id: StorableText(200), user_id: StorableText(200) });
export type IdentifyBody = z.infer<typeof IdentifyBody>;

export const IdentifyResponse = z.object({ person_id: z.string().uuid(), merged: z.boolean(), distinct_ids_moved: z.number().int() });
export type IdentifyResponse = z.infer<typeof IdentifyResponse>;

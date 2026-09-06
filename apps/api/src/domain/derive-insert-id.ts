/**
 * derive-insert-id.ts — design §2.2: the dedupe key Vantage derives when the client sent none.
 *
 * Why it exists: retries are normal, and a client without `insert_id` still deserves idempotency.
 * The key is a function of the event's logical content only, so a retry of the same event derives the
 * same key (V11) while a change to any value changes it. Canonical JSON (sorted keys, no whitespace,
 * arrays as-is) makes property key order irrelevant. The four parts are hashed as a JSON array rather
 * than concatenated, because plain concatenation is ambiguous ("ab"+"c" = "a"+"bc") and an ambiguity
 * in a dedupe key is a way to make two different events collide.
 *
 * What it must never do: read a clock, depend on `server_ts`, or accept a `__proto__` key — the
 * latter is rejected upstream by `JsonObject`, and this function trusts that contract.
 */
import { createHash } from 'node:crypto';

export interface DerivableEvent {
  distinct_id: string;
  event: string;
  client_ts: string | null;
  properties: object;
}

/** Sorted keys at every depth, no whitespace, arrays in order; the one serialisation two SDKs can agree on. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** Design §2.2. Canonical JSON = sorted keys, no whitespace, arrays as-is; a runtime "__proto__" key is rejected upstream by Zod's JsonObject. */
export function deriveInsertId(e: DerivableEvent): string {
  const material = canonicalJson([e.distinct_id, e.event, e.client_ts, e.properties]);
  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);
}

/**
 * hash-api-key.ts — the one-way function between a project's API key and what the database stores.
 *
 * Why it exists: the key is shown once at creation and never stored; only its sha256 is, so a copy of
 * the database does not yield keys. A plain hash (no salt, no KDF) is the right tool here because the
 * keys are 192-bit random strings minted by Vantage, not human passwords — there is nothing for a
 * dictionary to guess, and the guard must compute the hash on every ingest request.
 *
 * What it must never do: accept anything but the key string, or become the place where keys are
 * generated (randomness belongs to the service; this file is PURE).
 */
import { createHash } from 'node:crypto';

/** Keys carry a fixed prefix so a leaked one is recognisable in logs and secret scanners. */
export const API_KEY_PREFIX = 'vk_';

/** sha256 hex of the exact key string; the `api_key_hash` column and the guard's lookup key. */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/**
 * ingest-counts.spec.ts — the row order and the response counts the ingest service derives without a database.
 */
import { describe, expect, it } from 'vitest';
import type { NormalizedEvent } from '../../src/domain/index.js';
import { sortedByInsertId, tooOldAmong } from '../../src/modules/ingest/ingest.service.js';

const SERVER = new Date('2026-09-02T00:00:00Z');
const row = (insert_id: string, too_old = false): NormalizedEvent => ({
  event_id: `id-${insert_id}`,
  insert_id,
  key_source: 'client',
  distinct_id: 'd',
  event: 'e',
  properties: {},
  client_ts: null,
  sent_at: null,
  server_ts: SERVER,
  event_ts: SERVER,
  ts_source: 'server',
  too_old,
});

describe('sortedByInsertId', () => {
  it('orders rows by insert_id so two concurrent batches lock the same keys in the same order', () => {
    expect(sortedByInsertId([row('c'), row('a'), row('b')]).map((r) => r.insert_id)).toEqual(['a', 'b', 'c']);
  });

  it('is stable: a key repeated within the batch keeps its first occurrence first, and the input is not mutated', () => {
    const first = row('k', true);
    const second = row('k', false);
    const input = [second, first];
    const sorted = sortedByInsertId([row('z'), first, second]);
    expect(sorted[0]).toBe(first);
    expect(sorted[1]).toBe(second);
    expect(input).toEqual([second, first]);
  });
});

describe('tooOldAmong', () => {
  it('counts too_old only for keys the statement accepted', () => {
    expect(tooOldAmong([row('a', true), row('b', true), row('c', false)], new Set(['a', 'c']))).toBe(1);
  });

  it('counts a key repeated within the batch once, by its first occurrence', () => {
    expect(tooOldAmong([row('k', true), row('k', false)], new Set(['k']))).toBe(1);
    expect(tooOldAmong([row('k', false), row('k', true)], new Set(['k']))).toBe(0);
  });

  it('is zero when nothing was accepted', () => {
    expect(tooOldAmong([row('a', true)], new Set())).toBe(0);
  });
});

/**
 * ingest.spec.ts — the ingest DTOs reject what the database would reject and nothing the LLD allows.
 */
import { describe, expect, it } from 'vitest';
import { IdentifyBody, IdentifyResponse, INSTANT_MAX, INSTANT_MIN, IncomingEvent, IngestBatch, IngestResponse, Instant, KEYLESS_MESSAGE } from '../src/ingest.js';
import { CreateProjectBody, ProjectCreated } from '../src/projects.js';

const NUL = String.fromCharCode(0);
const ok = { event: 'signup', distinct_id: 'p01', insert_id: 'p01-signup' };

function firstIssue(schema: { safeParse(v: unknown): { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }, v: unknown) {
  const r = schema.safeParse(v);
  return r.success ? null : r.error?.issues[0];
}

describe('IncomingEvent', () => {
  it('accepts the minimal keyed event and the full event', () => {
    expect(IncomingEvent.safeParse(ok).success).toBe(true);
    expect(IncomingEvent.safeParse({ ...ok, timestamp: '2026-08-03T09:00:00+05:30', insert_id: 'abc_DEF-123', properties: { plan: 'team' } }).success).toBe(true);
  });

  it('rejects an empty or 201-character event name and distinct_id (the database CHECK bounds)', () => {
    expect(firstIssue(IncomingEvent, { ...ok, event: '' })?.path).toEqual(['event']);
    expect(firstIssue(IncomingEvent, { ...ok, event: 'e'.repeat(201) })?.path).toEqual(['event']);
    expect(IncomingEvent.safeParse({ ...ok, event: 'e'.repeat(200) }).success).toBe(true);
    expect(firstIssue(IncomingEvent, { ...ok, distinct_id: 'd'.repeat(201) })?.path).toEqual(['distinct_id']);
  });

  it('enforces the insert_id regex: 1..64 of [A-Za-z0-9_-]', () => {
    expect(IncomingEvent.safeParse({ ...ok, insert_id: 'a'.repeat(64) }).success).toBe(true);
    expect(firstIssue(IncomingEvent, { ...ok, insert_id: 'a'.repeat(65) })?.path).toEqual(['insert_id']);
    expect(firstIssue(IncomingEvent, { ...ok, insert_id: '' })?.path).toEqual(['insert_id']);
    expect(firstIssue(IncomingEvent, { ...ok, insert_id: 'has space' })?.path).toEqual(['insert_id']);
    expect(firstIssue(IncomingEvent, { ...ok, insert_id: 'ünïcode' })?.path).toEqual(['insert_id']);
  });

  it('requires an ISO timestamp with an explicit offset; "yesterday" and a naive datetime are rejected', () => {
    expect(firstIssue(IncomingEvent, { ...ok, timestamp: 'yesterday' })?.path).toEqual(['timestamp']);
    expect(firstIssue(IncomingEvent, { ...ok, timestamp: '2026-08-03T09:00:00' })?.path).toEqual(['timestamp']);
    expect(IncomingEvent.safeParse({ ...ok, timestamp: '2031-01-01T00:00:00Z' }).success).toBe(true);
  });

  it('rejects a NUL byte in event or distinct_id, which text columns cannot store', () => {
    expect(firstIssue(IncomingEvent, { ...ok, event: `a${NUL}` })?.message).toMatch(/U\+0000/);
    expect(firstIssue(IncomingEvent, { ...ok, distinct_id: `${NUL}` })?.message).toMatch(/U\+0000/);
  });

  it('rejects a __proto__ property key with the nested path', () => {
    const issue = firstIssue(IncomingEvent, { ...ok, properties: JSON.parse('{"__proto__": 1}') });
    expect(issue?.path).toEqual(['properties', '__proto__']);
  });

  it('rejects an event with neither insert_id nor timestamp and tells the SDK author which to send (decision 2026-09-05)', () => {
    const issue = firstIssue(IncomingEvent, { event: 'signup', distinct_id: 'p01' });
    expect(issue).toMatchObject({ path: [], message: KEYLESS_MESSAGE });
    expect(KEYLESS_MESSAGE).toMatch(/insert_id \(preferred\) or timestamp/);
  });

  it('accepts an event with only a timestamp (the key is derived from it) and one with only an insert_id', () => {
    expect(IncomingEvent.safeParse({ event: 'signup', distinct_id: 'p02', timestamp: '2026-08-03T09:00:00Z' }).success).toBe(true);
    expect(IncomingEvent.safeParse({ event: 'signup', distinct_id: 'p02', insert_id: 'k' }).success).toBe(true);
  });

  it('is strict: a misspelt field is an unrecognised key, not silently dropped data', () => {
    const r = IncomingEvent.safeParse({ ...ok, insertId: 'typo' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['insertId'] });
  });
});

describe('Instant', () => {
  it('accepts both bounds, 1970-01-01T00:00:00Z and 2200-01-01T00:00:00Z, in any offset notation', () => {
    expect(Instant.safeParse(INSTANT_MIN).success).toBe(true);
    expect(Instant.safeParse(INSTANT_MAX).success).toBe(true);
    expect(Instant.safeParse('1970-01-01T05:30:00+05:30').success).toBe(true);
    expect(Instant.safeParse('2199-12-31T19:00:00-05:00').success).toBe(true);
  });

  it('rejects one second before 1970 and one second after 2200-01-01, naming the bounds', () => {
    const before = Instant.safeParse('1969-12-31T23:59:59Z');
    expect(before.success).toBe(false);
    if (!before.success) expect(before.error.issues[0]?.message).toBe(`instant must be between ${INSTANT_MIN} and ${INSTANT_MAX}`);
    expect(Instant.safeParse('2200-01-01T00:00:01Z').success).toBe(false);
  });

  it('rejects year 0 and a year-1 instant whose offset crosses into year 0 — PostgreSQL has no year 0 (22008)', () => {
    expect(Instant.safeParse('0000-01-01T00:00:00Z').success).toBe(false);
    expect(Instant.safeParse('0001-01-01T00:00:00+05:30').success).toBe(false);
  });

  it('bounds timestamp and sent_at alike', () => {
    expect(firstIssue(IncomingEvent, { ...ok, timestamp: '0000-01-01T00:00:00Z' })?.path).toEqual(['timestamp']);
    expect(firstIssue(IngestBatch, { sent_at: '2200-01-01T00:00:01Z', events: [ok] })?.path).toEqual(['sent_at']);
  });
});

describe('IngestBatch', () => {
  it('accepts 1 and 500 events, rejects 0 and 501', () => {
    const n = (k: number) => ({ events: Array.from({ length: k }, () => ok) });
    expect(IngestBatch.safeParse(n(1)).success).toBe(true);
    expect(IngestBatch.safeParse(n(500)).success).toBe(true);
    expect(firstIssue(IngestBatch, n(0))?.path).toEqual(['events']);
    expect(firstIssue(IngestBatch, n(501))?.path).toEqual(['events']);
  });

  it('reports the index of a bad event in its path', () => {
    expect(firstIssue(IngestBatch, { events: [ok, ok, { ...ok, event: '' }] })?.path).toEqual(['events', 2, 'event']);
  });

  it('reports a keyless, timestampless event at its index', () => {
    expect(firstIssue(IngestBatch, { events: [ok, { event: 'e', distinct_id: 'd' }] })).toMatchObject({ path: ['events', 1], message: KEYLESS_MESSAGE });
  });

  it('validates sent_at like a timestamp', () => {
    expect(firstIssue(IngestBatch, { sent_at: 'now', events: [ok] })?.path).toEqual(['sent_at']);
    expect(IngestBatch.safeParse({ sent_at: '2026-09-02T00:00:00Z', events: [ok] }).success).toBe(true);
  });

  it('is strict: a project_id in the envelope is an unrecognised key, never a way to choose the project', () => {
    const r = IngestBatch.safeParse({ project_id: '0190f3a0-0000-7000-8000-000000000000', events: [ok] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['project_id'] });
  });
});

describe('responses and identify', () => {
  it('IngestResponse is accepted / duplicates / too_old and nothing else — a batch is all-or-nothing, so there is no per-event rejected list', () => {
    expect(Object.keys(IngestResponse.shape)).toEqual(['accepted', 'duplicates', 'too_old']);
    expect(IngestResponse.safeParse({ accepted: 3, duplicates: 1, too_old: 0 }).success).toBe(true);
    expect(IngestResponse.safeParse({ accepted: 3.5, duplicates: 1, too_old: 0 }).success).toBe(false);
  });

  it('IdentifyResponse describes exactly the LLD shape', () => {
    expect(IdentifyResponse.safeParse({ person_id: '0190f3a0-0000-7000-8000-000000000000', merged: true, distinct_ids_moved: 1 }).success).toBe(true);
    expect(IdentifyResponse.safeParse({ person_id: 'not-a-uuid', merged: true, distinct_ids_moved: 1 }).success).toBe(false);
  });

  it('IdentifyBody bounds both ids to 1..200 storable characters and rejects unknown keys', () => {
    expect(IdentifyBody.safeParse({ anonymous_id: 'a', user_id: 'u' }).success).toBe(true);
    expect(firstIssue(IdentifyBody, { anonymous_id: '', user_id: 'u' })?.path).toEqual(['anonymous_id']);
    expect(firstIssue(IdentifyBody, { anonymous_id: 'a', user_id: 'u'.repeat(201) })?.path).toEqual(['user_id']);
    expect(IdentifyBody.safeParse({ anonymous_id: 'a', user_id: 'u', userId: 'typo' }).success).toBe(false);
  });

  it('CreateProjectBody needs a name and a timezone string; ProjectCreated carries the key', () => {
    expect(CreateProjectBody.safeParse({ name: 'x', timezone: 'Asia/Kolkata' }).success).toBe(true);
    expect(firstIssue(CreateProjectBody, { name: '', timezone: 'Asia/Kolkata' })?.path).toEqual(['name']);
    expect(ProjectCreated.safeParse({ project_id: '0190f3a0-0000-7000-8000-000000000000', name: 'x', timezone: 'UTC', created_at: '2026-09-02T00:00:00.000Z', api_key: 'vk_x' }).success).toBe(true);
  });
});

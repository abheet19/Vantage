/**
 * parse-spec.spec.ts — L1: the three design §4.3 model outputs land where the design says, a smuggled key is refused
 * with its path, fences are tolerated only for json, the caller's project always wins, 64 Ki is the most it reads, and
 * nothing the model can say makes it throw.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PARSE_INPUT_CAP, parseSpec } from '../../src/domain/parse-spec.js';
import { PROJECT_ID } from '../helpers/arbitraries.js';

const OTHER_PROJECT = '11111111-2222-4333-8444-555555555555';
const RANGE = { from: '2026-08-01', to: '2026-08-31' };
const countSpec = (over: Record<string, unknown> = {}) => JSON.stringify({ kind: 'count', project: PROJECT_ID, range: RANGE, event: { event: 'drop table' }, ...over });

describe('parseSpec (L1) — the design §4.3 trace', () => {
  it('"DROP TABLE events;" is not JSON → refused as not_json', () => {
    expect(parseSpec('DROP TABLE events;')).toEqual({ ok: false, reason: 'not_json' });
  });

  it('{"error":"not an analytics question"} is JSON but not a QuerySpec → refused as not_a_spec with Zod issues', () => {
    const r = parseSpec('{"error":"not an analytics question"}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_a_spec');
    expect(r.issues?.length).toBeGreaterThan(0);
  });

  it('a count of an event literally named "drop table" IS a valid spec → ok, the name is a value', () => {
    const r = parseSpec(countSpec());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.kind).toBe('count');
    expect(r.spec.kind === 'count' && r.spec.event.event).toBe('drop table');
  });
});

describe('parseSpec (L1) — the grammar is strict', () => {
  it('attack: {"kind":"funnel", …, "sql":"DROP TABLE events"} is refused for the unknown key, naming it', () => {
    const text = JSON.stringify({ kind: 'funnel', project: PROJECT_ID, range: RANGE, steps: [{ event: 'a' }, { event: 'b' }], sql: 'DROP TABLE events' });
    const r = parseSpec(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not_a_spec');
    const unknown = r.issues?.find((i) => i.code === 'unrecognized_keys') as { keys?: string[] } | undefined;
    expect(unknown?.keys).toEqual(['sql']);
  });

  it('an own __proto__ key is an unknown key like any other, and nothing is polluted', () => {
    const r = parseSpec(countSpec().replace('"kind"', '"__proto__":{"admin":true},"kind"'), { project: PROJECT_ID });
    expect(r.ok).toBe(false);
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });

  it('a JSON array, number, string or null is JSON but never a spec', () => {
    for (const text of ['[]', '42', '"select"', 'null', 'true']) {
      const r = parseSpec(text);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('not_a_spec');
    }
  });

  it('defaults are applied by the grammar: a bare funnel gets order sequential and a 14-day window', () => {
    const r = parseSpec(JSON.stringify({ kind: 'funnel', project: PROJECT_ID, range: RANGE, steps: [{ event: 'a' }, { event: 'b' }] }));
    expect(r.ok && r.spec.kind === 'funnel' && r.spec.order).toBe('sequential');
    expect(r.ok && r.spec.kind === 'funnel' && r.spec.window).toEqual({ value: 14, unit: 'days' });
  });
});

describe('parseSpec (L1) — fences', () => {
  it('tolerates exactly one ```json fence around the object', () => {
    expect(parseSpec('```json\n' + countSpec() + '\n```').ok).toBe(true);
    expect(parseSpec('```\n' + countSpec() + '\n```').ok).toBe(true);
    expect(parseSpec('```JSON\r\n' + countSpec() + '\r\n```').ok).toBe(true);
  });

  it('attack: a ```sql fence is not json → not_json, whatever is inside', () => {
    expect(parseSpec('```sql\nSELECT * FROM events\n```')).toEqual({ ok: false, reason: 'not_json' });
    expect(parseSpec('```sql\n' + countSpec() + '\n```')).toEqual({ ok: false, reason: 'not_json' });
  });

  it('prose around a fence, or two fences, is not tolerated: the whole text must be the object', () => {
    expect(parseSpec('Here you go:\n```json\n' + countSpec() + '\n```').ok).toBe(false);
    expect(parseSpec('```json\n' + countSpec() + '\n```\n```json\n{}\n```').ok).toBe(false);
  });
});

describe('parseSpec (L1) — the project is the caller’s', () => {
  it('replaces the project the model wrote with the caller’s', () => {
    const r = parseSpec(countSpec({ project: OTHER_PROJECT }), { project: PROJECT_ID });
    expect(r.ok && r.spec.project).toBe(PROJECT_ID);
  });

  it('accepts a spec with no project at all when the caller supplies one, and refuses it when nobody does', () => {
    const text = JSON.stringify({ kind: 'count', range: RANGE, event: { event: 'signup' } });
    expect(parseSpec(text, { project: PROJECT_ID }).ok).toBe(true);
    const r = parseSpec(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues?.some((i) => i.path.join('.') === 'project')).toBe(true);
  });

  it('a project that is not a uuid is still refused — the override goes through the same schema', () => {
    expect(parseSpec(countSpec(), { project: 'not-a-uuid' }).ok).toBe(false);
  });
});

describe('parseSpec (L1) — bounds and totality', () => {
  it(`attack: a 5 MB model output is cut at ${PARSE_INPUT_CAP} characters before parsing → not_json`, () => {
    const huge = countSpec().slice(0, -1) + ' '.repeat(5 * 1024 * 1024) + '}';
    const started = performance.now();
    expect(parseSpec(huge)).toEqual({ ok: false, reason: 'not_json' });
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('whitespace beyond the cap is harmless because the cut lands in it; a closing brace beyond the cap is lost and the spec is refused', () => {
    const padded = countSpec() + ' '.repeat(PARSE_INPUT_CAP);
    expect(parseSpec(padded).ok).toBe(true);
    const cutInside = countSpec().slice(0, -1) + ' '.repeat(PARSE_INPUT_CAP) + '}';
    expect(parseSpec(cutInside).ok).toBe(false);
  });

  it('never throws, for any string (fc.string)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2_000 }), (s) => {
        const r = parseSpec(s, { project: PROJECT_ID });
        return typeof r.ok === 'boolean';
      }),
      { numRuns: 500 },
    );
  });

  it('never throws, for any JSON text (fc.json), and only a real QuerySpec is ok', () => {
    fc.assert(
      fc.property(fc.json({ maxDepth: 4 }), (s) => {
        const r = parseSpec(s, { project: PROJECT_ID });
        if (r.ok) return ['funnel', 'retention', 'trend', 'paths', 'count'].includes(r.spec.kind) && r.spec.project === PROJECT_ID;
        return r.reason === 'not_json' || r.reason === 'not_a_spec';
      }),
      { numRuns: 500 },
    );
  });
});

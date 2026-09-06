/**
 * json.spec.ts — the properties limits reject everything PostgreSQL would reject, and name the path.
 */
import { describe, expect, it } from 'vitest';
import { JSON_LIMITS, JsonObject, inspectJson, isStorableText } from '../src/json.js';

const NUL = String.fromCharCode(0);

function issues(value: unknown) {
  const r = JsonObject.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path, message: i.message }));
}

function jsonbBytes(value: unknown): number {
  const r = inspectJson(value);
  if (!r.ok) throw new Error(r.message);
  return r.jsonbBytes;
}

describe('JsonObject: forbidden keys', () => {
  it('rejects a __proto__ key at the top level', () => {
    const v = JSON.parse('{"__proto__": {"x": 1}}');
    expect(issues(v)).toEqual([{ path: ['__proto__'], message: 'key "__proto__" is not allowed' }]);
  });

  it('rejects a __proto__ key at depth 3 and reports the full path', () => {
    const v = JSON.parse('{"a": {"b": {"__proto__": 1}}}');
    expect(issues(v)[0]?.path).toEqual(['a', 'b', '__proto__']);
  });

  it('rejects a __proto__ key inside an array element', () => {
    const v = JSON.parse('{"items": [{"ok": 1}, {"__proto__": []}]}');
    expect(issues(v)[0]?.path).toEqual(['items', 1, '__proto__']);
  });

  it('rejects constructor and prototype keys too', () => {
    expect(issues({ constructor: 1 })[0]?.message).toMatch(/constructor/);
    expect(issues({ nested: { prototype: 1 } })[0]?.path).toEqual(['nested', 'prototype']);
  });
});

describe('JsonObject: shape limits', () => {
  it('accepts depth 4 and rejects depth 5', () => {
    expect(issues({ a: { b: { c: { d: 1 } } } })).toEqual([]);
    expect(issues({ a: { b: { c: { d: { e: 1 } } } } })[0]).toEqual({ path: ['a', 'b', 'c', 'd'], message: 'nesting deeper than 4' });
  });

  it('counts arrays as nesting levels', () => {
    expect(issues({ a: [[[1]]] })).toEqual([]);
    expect(issues({ a: [[[[1]]]] })[0]?.message).toBe('nesting deeper than 4');
  });

  it('accepts 200 keys in total and rejects 201', () => {
    const ok = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i]));
    expect(issues(ok)).toEqual([]);
    const tooMany = { ...Object.fromEntries(Array.from({ length: 199 }, (_, i) => [`k${i}`, i])), nested: { a: 1, b: 2 } };
    expect(issues(tooMany)[0]?.message).toBe('more than 200 keys in total');
  });

  it('rejects a 65 KiB string value (serialised size over 64 KiB)', () => {
    expect(issues({ blob: 'x'.repeat(65 * 1024) })[0]?.message).toMatch(/serialised size \d+ exceeds 65536 bytes/);
  });

  it('accepts a payload just under 64 KiB serialised', () => {
    const r = inspectJson({ blob: 'x'.repeat(65_000) });
    expect(r.ok).toBe(true);
  });

  it('rejects an array of 15 000 small numbers whose jsonb form would exceed the database CHECK although its JSON text is 30 KiB', () => {
    const v = { n: Array.from({ length: 15_000 }, () => 1) };
    expect(JSON.stringify(v).length).toBeLessThan(40_000);
    expect(issues(v)[0]?.message).toMatch(/estimated jsonb size \d+ exceeds 65536 bytes/);
  });

  it('rejects anything that is not a JSON object', () => {
    expect(issues([1, 2])[0]?.message).toBe('properties must be a JSON object');
    expect(issues('str')[0]?.message).toBe('properties must be a JSON object');
    expect(issues(null)[0]?.message).toBe('properties must be a JSON object');
  });

  it('rejects a non-finite number (cannot come from JSON, but can from a caller)', () => {
    expect(issues({ n: Number.POSITIVE_INFINITY })[0]).toEqual({ path: ['n'], message: 'number must be finite' });
  });

  it('rejects a value of an unsupported runtime type (a function smuggled by a caller)', () => {
    expect(issues({ f: () => 1 })[0]?.message).toMatch(/unsupported JSON value of type function/);
  });
});

describe('JsonObject: numbers JSON.parse has already damaged', () => {
  it('rejects an integer beyond ±2^53 at its path: the digits were rounded before validation could see them', () => {
    expect(issues({ big: 2 ** 53 })[0]).toEqual({ path: ['big'], message: 'integer beyond ±2^53 cannot round-trip through JSON; send it as a string' });
    expect(issues({ n: { deep: -(2 ** 53) - 2 } })[0]?.path).toEqual(['n', 'deep']);
    expect(issues({ e: 1e21 })[0]?.path).toEqual(['e']);
  });

  it('accepts every safe integer and every fractional or tiny float', () => {
    expect(issues({ a: Number.MAX_SAFE_INTEGER, b: Number.MIN_SAFE_INTEGER, c: 0.1, d: -123456.789, e: 5e-324, f: 0 })).toEqual([]);
  });
});

describe('JsonObject: storability', () => {
  it('rejects a string value containing U+0000, which jsonb cannot store', () => {
    expect(issues({ v: `a${NUL}b` })[0]).toEqual({ path: ['v'], message: 'string contains U+0000 or a lone surrogate, which PostgreSQL cannot store' });
  });

  it('rejects a key containing U+0000', () => {
    expect(issues({ [`k${NUL}`]: 1 })[0]?.message).toMatch(/key contains U\+0000/);
  });

  it('rejects a lone surrogate, which cannot round-trip through UTF-8', () => {
    expect(isStorableText('\ud800')).toBe(false);
    expect(issues({ v: 'ok\ud800' })[0]?.path).toEqual(['v']);
  });

  it('accepts every other Unicode string, including emoji and RTL text', () => {
    expect(isStorableText('héllo 🙂 مرحبا')).toBe(true);
    expect(issues({ v: 'héllo 🙂 مرحبا' })).toEqual([]);
  });
});

describe('inspectJson: the jsonb estimate mirrors PostgreSQL', () => {
  it('counts the 4-byte varlena header: an empty object is 8 bytes, as pg_column_size reports', () => {
    expect(jsonbBytes({})).toBe(8);
  });

  it('reviewer case: { k: 65 520 × "v" } is 65 528 bytes of JSON text but 65 537 bytes of jsonb, and is rejected', () => {
    const v = { k: 'v'.repeat(65_520) };
    expect(JSON.stringify(v).length).toBe(65_528);
    expect(inspectJson(v)).toEqual({ ok: false, path: [], message: 'estimated jsonb size 65537 exceeds 65536 bytes' });
  });

  it('reviewer case: 5 000 × ["a", {}] is 80 024 bytes of jsonb because every nested container is padded to a 4-byte boundary', () => {
    const v = { a: Array.from({ length: 10_000 }, (_, i) => (i % 2 === 0 ? 'a' : {})) };
    expect(inspectJson(v)).toEqual({ ok: false, path: [], message: 'estimated jsonb size 80024 exceeds 65536 bytes' });
  });

  it('pads numerics to a 4-byte boundary: [1, 1] costs 8 + 8 + 12 + 12 bytes inside the root, not 8 + 8 + 10 + 10', () => {
    // root: 4 varlena + 4 header + 8 JEntries + 1 key = 17 → array at 20: 4 header + 8 JEntries = 32 → numeric 8 → 40 → numeric 8 → 48
    expect(jsonbBytes({ n: [1, 1] })).toBe(48);
  });

  it('does not depend on key insertion order, because PostgreSQL sorts object keys', () => {
    expect(jsonbBytes({ zz: [1], a: {}, m: 1.5 })).toBe(jsonbBytes({ m: 1.5, a: {}, zz: [1] }));
  });

  it('reports size, jsonb estimate, depth and key count for a valid object', () => {
    const r = inspectJson({ a: 1, b: { c: 'x' } });
    expect(r).toMatchObject({ ok: true, depth: 2, keys: 3 });
    if (r.ok) {
      expect(r.bytes).toBe(JSON.stringify({ a: 1, b: { c: 'x' } }).length);
      expect(r.jsonbBytes).toBeGreaterThan(r.bytes);
    }
  });

  it('exposes the limits it enforces', () => {
    expect(JSON_LIMITS).toEqual({ maxDepth: 4, maxKeys: 200, maxBytes: 65_536 });
  });
});

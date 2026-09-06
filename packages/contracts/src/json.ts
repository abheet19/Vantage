/**
 * json.ts — the shape of an event's `properties` and the limits that keep it storable.
 *
 * Why it exists: `properties` is the one field of an event whose shape the client controls, so it is
 * where hostile input arrives. Every rule here answers a concrete failure downstream: `__proto__` /
 * `constructor` / `prototype` keys poison any object that spreads the properties; U+0000 and lone
 * surrogates cannot be stored by `jsonb` or `text` (22P05 / 22021, and the whole batch fails with a
 * 500); an integer beyond 2^53 has already lost digits in `JSON.parse`, so storing it would store a
 * different number; and the `events.properties` CHECK measures the *binary* jsonb size, which is not
 * the JSON text size — arrays of small numbers, or of objects, are several times larger as jsonb.
 *
 * The jsonb estimate reproduces PostgreSQL's `convertJsonbValue` layout (jsonb_util.c): a 4-byte
 * varlena header, a 4-byte container header, one 4-byte JEntry per element (two per object pair),
 * object keys sorted by byte length then bytes and written before the values, strings as raw UTF-8,
 * and — the two costs the text size is blind to — every nested container and every numeric padded to
 * a 4-byte boundary first. Numerics are bounded from above (no digit stripping), so the estimate is
 * never below `pg_column_size`; the integration property test holds it to that.
 *
 * What it must never do: accept anything the database would later reject (validation late = 500 =
 * the adversarial plan's failure signal), or depend on anything but zod.
 */
import { z } from 'zod';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface JsonLimits {
  readonly maxDepth: number;
  readonly maxKeys: number;
  readonly maxBytes: number;
}

/** Design §1.1: ≤ 64 KiB serialised, ≤ 200 keys, depth ≤ 4. `maxKeys` counts keys at every depth so 200 is a bound, not a per-object hint. */
export const JSON_LIMITS: JsonLimits = { maxDepth: 4, maxKeys: 200, maxBytes: 65_536 };

/** Keys that would reach Object.prototype when a validated object is spread or assigned into. Rejected at any depth. */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export type JsonInspection =
  | { ok: true; bytes: number; jsonbBytes: number; depth: number; keys: number }
  | { ok: false; path: (string | number)[]; message: string };

/** U+0000 spelled without an escape sequence: tooling that displays this file must never hide a control character. */
const NUL = String.fromCharCode(0);

/** True when PostgreSQL can store the string byte-for-byte: no U+0000 (text and jsonb both refuse it) and no lone surrogate (not encodable as UTF-8). */
export function isStorableText(s: string): boolean {
  return !s.includes(NUL) && s.isWellFormed();
}

/** UTF-8 length without Buffer, so this file stays runnable in a browser bundle (the web imports contracts). */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** jsonb.h: varlena header, container header, one JEntry per child, and the alignment containers and numerics are padded to. */
const VARHDRSZ = 4;
const JB_CONTAINER_HEADER = 4;
const JENTRY = 4;
const INTALIGN = 4;

const alignUp = (offset: number): number => Math.ceil(offset / INTALIGN) * INTALIGN;

/** PostgreSQL orders object pairs by key byte length, then bytewise (= by code point); the value order decides where the padding falls. */
function jsonbKeyOrder(a: string, b: string): number {
  const byLength = utf8Bytes(a) - utf8Bytes(b);
  if (byLength !== 0) return byLength;
  const ca = [...a];
  const cb = [...b];
  for (let i = 0; i < ca.length && i < cb.length; i++) {
    const d = (ca[i] as string).codePointAt(0)! - (cb[i] as string).codePointAt(0)!;
    if (d !== 0) return d;
  }
  return ca.length - cb.length;
}

/**
 * Upper bound on the `numeric` PostgreSQL builds from a JSON number: 4-byte varlena, a 2-byte header
 * when the value fits numeric's short form (≤ 176 integer digits, ≤ 63 fraction digits) else 4, and 2
 * bytes per base-10 000 group — integer digits grouped leftwards from the point, fraction digits
 * rightwards. PostgreSQL strips all-zero groups; this does not, so it never counts fewer.
 */
function numericBytes(n: number): number {
  const [mantissa = '', exponent = '0'] = JSON.stringify(n).replace('-', '').split('e');
  const point = mantissa.indexOf('.');
  const digits = mantissa.replace('.', '');
  const position = (point === -1 ? mantissa.length : point) + Number(exponent);
  const intDigits = Math.max(0, position);
  const fracDigits = Math.max(0, digits.length - position);
  const intPartIsZero = /^0*$/.test(digits.slice(0, Math.max(0, Math.min(position, digits.length))));
  const groups = (intPartIsZero ? 0 : Math.ceil(intDigits / 4)) + Math.ceil(fracDigits / 4);
  const header = intDigits <= 176 && fracDigits <= 63 ? 2 : 4;
  return VARHDRSZ + header + 2 * groups;
}

/**
 * Walks a parsed JSON value once and reports the first violation with its path, or the measured size.
 * `offset` is the running position in the jsonb buffer, kept in PostgreSQL's own write order so the
 * alignment padding lands where PostgreSQL's does.
 */
export function inspectJson(value: unknown, limits: JsonLimits = JSON_LIMITS): JsonInspection {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, path: [], message: 'properties must be a JSON object' };
  }

  let keys = 0;
  let offset = VARHDRSZ;
  let maxDepth = 0;
  const path: (string | number)[] = [];
  const fail = (message: string): JsonInspection => ({ ok: false, path: [...path], message });

  const visitScalar = (v: unknown): JsonInspection | null => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return fail('number must be finite');
      if (Number.isInteger(v) && !Number.isSafeInteger(v)) return fail('integer beyond ±2^53 cannot round-trip through JSON; send it as a string');
      offset = alignUp(offset) + numericBytes(v);
      return null;
    }
    if (typeof v === 'string') {
      if (!isStorableText(v)) return fail('string contains U+0000 or a lone surrogate, which PostgreSQL cannot store');
      offset += utf8Bytes(v);
      return null;
    }
    return v === null || typeof v === 'boolean' ? null : fail(`unsupported JSON value of type ${typeof v}`);
  };

  const visitChildren = (entries: readonly (readonly [string | number, unknown])[], depth: number): JsonInspection | null => {
    for (const [segment, child] of entries) {
      path.push(segment);
      const r = visit(child, depth);
      if (r) return r;
      path.pop();
    }
    return null;
  };

  const visitObject = (v: Record<string, unknown>, depth: number): JsonInspection | null => {
    const own = Object.keys(v).sort(jsonbKeyOrder);
    keys += own.length;
    if (keys > limits.maxKeys) return fail(`more than ${limits.maxKeys} keys in total`);
    offset += 2 * JENTRY * own.length;
    for (const k of own) {
      path.push(k);
      if (FORBIDDEN_KEYS.has(k)) return fail(`key "${k}" is not allowed`);
      if (!isStorableText(k)) return fail('key contains U+0000 or a lone surrogate, which PostgreSQL cannot store');
      path.pop();
      offset += utf8Bytes(k);
    }
    return visitChildren(
      own.map((k) => [k, v[k]] as const),
      depth + 1,
    );
  };

  const visit = (v: unknown, depth: number): JsonInspection | null => {
    if (v === null || typeof v !== 'object') return visitScalar(v);
    if (depth > limits.maxDepth) return fail(`nesting deeper than ${limits.maxDepth}`);
    maxDepth = Math.max(maxDepth, depth);
    offset = alignUp(offset) + JB_CONTAINER_HEADER;
    if (Array.isArray(v)) {
      offset += JENTRY * v.length;
      return visitChildren(
        v.map((child, i) => [i, child] as const),
        depth + 1,
      );
    }
    return visitObject(v as Record<string, unknown>, depth);
  };

  const violation = visit(value, 1);
  if (violation) return violation;
  const bytes = utf8Bytes(JSON.stringify(value));
  if (bytes > limits.maxBytes) return { ok: false, path: [], message: `serialised size ${bytes} exceeds ${limits.maxBytes} bytes` };
  if (offset > limits.maxBytes) return { ok: false, path: [], message: `estimated jsonb size ${offset} exceeds ${limits.maxBytes} bytes` };
  return { ok: true, bytes, jsonbBytes: offset, depth: maxDepth, keys };
}

/**
 * The Zod schema for `properties`. `z.custom` because the structural rules (forbidden keys at any depth,
 * total key count, two size measures) are one walk, not a tree of nested `z.record`s that would each
 * report their own partial truth; the walk reports the exact path of the first violation.
 */
export const JsonObject = z.custom<JsonObject>().superRefine((value, ctx) => {
  const r = inspectJson(value);
  if (!r.ok) ctx.addIssue({ code: 'custom', message: r.message, path: r.path });
});

/**
 * parse-spec.ts — `parseSpec`: layer L1 of the boundary (design §4.2), text in, spec or refusal out.
 *
 * Why it exists: whatever the model said is untrusted input (OWASP LLM05), and this is the one function
 * that judges it. It is total — every input yields a value, none throws — because a throw here would be
 * a 500 on hostile text, which LLD §9 treats as "validation happened too late". The text is capped at 64
 * Ki characters before anything looks at it (a 10 MB reply costs one slice, not a parse), one fenced
 * ```json block is tolerated because models add fences even when told not to, and the object must then
 * validate as `QuerySpec` — the Zod object whose JSON Schema L0 sent, with `strictObject` members, so a
 * smuggled key is a refusal with its path. The caller's project is written over the object's `project`
 * before validation (E26, LLD §11): the model can neither choose a project nor be
 * refused for omitting one, and the raw text still shows what it said. The copy is a spread, so an own
 * `__proto__` key stays an own key and is refused by the schema like any other unknown key.
 *
 * What it must never do: repair, guess or complete the model's output (a refusal shows the raw text; a
 * repaired spec would hide what the model actually said), accept a fence in any language but json, or
 * produce anything but a value that passed `QuerySpec`.
 */
import { QuerySpec } from '@vantage/contracts';
import type { z } from 'zod';

/** 64 Ki UTF-16 code units: at least 64 KiB, and no honest spec is a hundredth of it. */
export const PARSE_INPUT_CAP = 65_536;

export type ParseRefusal = { ok: false; reason: 'not_json' | 'not_a_spec'; issues?: z.core.$ZodIssue[] };
export type ParseOutcome = { ok: true; spec: QuerySpec } | ParseRefusal;

export interface ParseOptions {
  /** The caller's project id; when given it replaces whatever the model wrote (V14: the model never chooses a project). */
  project?: string;
}

/** The whole text is one fenced block: an optional language tag, a newline, the body, a closing fence. Group 1 is the tag, group 2 the body. */
const FENCED = /^```([A-Za-z0-9_-]*)[ \t]*\r?\n([\s\S]*?)\r?\n?```$/;

/** Strips one fence around the whole text; a fence in any language other than json (or none) is returned as-is and fails JSON.parse honestly. */
function unfence(text: string): string {
  const m = FENCED.exec(text);
  if (!m) return text;
  const tag = (m[1] ?? '').toLowerCase();
  return tag === '' || tag === 'json' ? (m[2] ?? '') : text;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** L1: text → QuerySpec | refusal. Tolerates a single fenced ```json block; anything else is a refusal with the raw text kept. Never throws. */
export function parseSpec(text: string, options: ParseOptions = {}): ParseOutcome {
  const body = unfence(text.slice(0, PARSE_INPUT_CAP).trim());
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  const candidate = options.project !== undefined && isPlainObject(value) ? { ...value, project: options.project } : value;
  const parsed = QuerySpec.safeParse(candidate);
  return parsed.success ? { ok: true, spec: parsed.data } : { ok: false, reason: 'not_a_spec', issues: parsed.error.issues };
}

/**
 * types.ts — what a compiler takes and what it hands to the runner (LLD §3.2).
 *
 * Why it exists: `Compiled` is the only thing `QueryRunner` will execute, and V7(b) says it accepts
 * nothing else. A structural type cannot promise that — any `{ sql, params, kind }` literal would pass —
 * so `Compiled` carries a private symbol that only `seal` in this module can set. The runner checks it at
 * runtime with `isCompiled`, which asks a private `WeakSet` of the very objects `seal` produced — identity,
 * not shape — so a copy of a compiled statement with its SQL swapped (`{ ...c, sql: 'DROP …' }`, which the
 * type system would accept because a spread keeps the symbol key) is refused exactly like a hand-built
 * one (S3 adversarial pass). The symbol is non-enumerable for the same reason: a spread does not carry it.
 * The seal is deep: `ctx`, `meta` and a COPY of `params` are frozen too (S3 hardening — a caller that
 * held the params array or the ctx object could otherwise edit them after sealing, and `c.meta.sql =
 * 'DROP …'` used to succeed), and `isCompiled` also asks that those parts are still frozen. `ctx` and
 * the companion `meta` statement travel with the SQL because the result's footer (timezone, row cap,
 * watermark) is part of the answer and must come from the same compilation.
 *
 * `seal` is exported because the three compilers in this directory call it; `tools/lint-deps.mjs` fails
 * the build if any file outside `domain/compile/` imports this module or calls `seal(`.
 *
 * What it must never do: export the brand symbol or the registry, or let a sealed statement be edited.
 */
import type { QuerySpec } from '@vantage/contracts';

/** rowCap default 10_000 (`QUERY_LIMITS.rowCap`); the service fills it, the compiler owns the LIMIT. */
export interface CompileCtx {
  readonly projectId: string;
  readonly timezone: string;
  readonly rowCap: number;
}

/** One parameterised statement: no `;`, every value a `$n`. */
export interface Statement {
  readonly sql: string;
  readonly params: readonly unknown[];
}

const COMPILED = Symbol('vantage.compiled');
/** Every object `seal` has produced; membership is the runtime proof, and a copy is never a member. */
const SEALED = new WeakSet<object>();

export interface Compiled extends Statement {
  readonly kind: QuerySpec['kind'];
  readonly ctx: CompileCtx;
  /** The watermark statement (`data_until`, merges, adjusted share) compiled for the same project and range. */
  readonly meta: Statement;
  readonly [COMPILED]: true;
}

/** Freezes plain data (objects and arrays) all the way down; parameter values are scalars or lists of scalars, so this is what they need. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/** The single constructor of `Compiled`; called by the compilers in this directory and nowhere else (lint-enforced). */
export function seal(kind: QuerySpec['kind'], ctx: CompileCtx, statement: Statement, meta: Statement): Compiled {
  const compiled = {
    kind,
    ctx: deepFreeze({ projectId: ctx.projectId, timezone: ctx.timezone, rowCap: ctx.rowCap }),
    sql: statement.sql,
    params: deepFreeze([...statement.params]),
    meta: deepFreeze({ sql: meta.sql, params: [...meta.params] }),
  };
  Object.defineProperty(compiled, COMPILED, { value: true, enumerable: false });
  Object.freeze(compiled);
  SEALED.add(compiled);
  return compiled as unknown as Compiled; // the brand key is defined above, non-enumerably, which the structural check cannot see

}

/** Identity (a member of the private registry) and integrity (every part still frozen) — both, or it is not a Compiled. */
export function isCompiled(value: unknown): value is Compiled {
  if (typeof value !== 'object' || value === null || !SEALED.has(value)) return false;
  const c = value as Compiled;
  return Object.isFrozen(c) && Object.isFrozen(c.ctx) && Object.isFrozen(c.params) && Object.isFrozen(c.meta) && Object.isFrozen(c.meta.params);
}

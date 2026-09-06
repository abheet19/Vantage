/**
 * index.ts — `compile`: the one entry from a validated `QuerySpec` to a `Compiled` statement.
 *
 * Why it exists: callers (the insights service and the ask path; the MCP `explain_query` tool) dispatch
 * on `kind` in exactly one place, so adding a compiler is one line here and nowhere else. Every one of
 * the five grammar kinds now has a compiler (S6 delivered trend and paths), so the switch is total over
 * `QuerySpec['kind']` with no default and no refusal.
 *
 * What it must never do: accept an unvalidated object — the spec has passed the grammar by the time it
 * arrives, and the compilers rely on every limit it enforces.
 */
import type { QuerySpec } from '@vantage/contracts';
import { compileCount } from './count.js';
import { compileFunnel } from './funnel.js';
import { compilePaths } from './paths.js';
import { compileRetention } from './retention.js';
import { compileTrend } from './trend.js';
import type { CompileCtx, Compiled } from './types.js';

export { compileCount, decodeCount, type CountData } from './count.js';
export { compileFunnel, decodeFunnel, type FunnelData } from './funnel.js';
export { cohortLimit, compileRetention, decodeRetention } from './retention.js';
export { compileTrend, decodeTrend, type TrendData } from './trend.js';
export { compilePaths, decodePaths, type PathsData } from './paths.js';
export { type MetaRow } from './meta.js';
export { isCompiled, type CompileCtx, type Compiled, type Statement } from './types.js';

/** Dispatch by kind — total over the five kinds the grammar admits. */
export function compile(spec: QuerySpec, ctx: CompileCtx): Compiled {
  switch (spec.kind) {
    case 'funnel':
      return compileFunnel(spec, ctx);
    case 'retention':
      return compileRetention(spec, ctx);
    case 'count':
      return compileCount(spec, ctx);
    case 'trend':
      return compileTrend(spec, ctx);
    case 'paths':
      return compilePaths(spec, ctx);
  }
}

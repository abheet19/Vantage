/**
 * count.ts — `compileCount`: how many persons and how many events did this, in range.
 *
 * Why it exists: the simplest question the grammar can ask, and the one every other compiler's scan is
 * a variation of, so it doubles as the smallest end-to-end proof that a spec value reaches SQL only as
 * a parameter. `HAVING count(*) > 0` makes a count over nothing return no row, so the status is `empty`
 * rather than a defensible-looking zero.
 *
 * What it must never do: count events the identity join cannot resolve to a person (every stored
 * event has one; a row without is a broken invariant that should surface as a wrong total, not be hidden
 * by a LEFT JOIN).
 */
import type { CountSpec } from '@vantage/contracts';
import { andFilters } from './filters.js';
import { compileMeta } from './meta.js';
import { beginScan, personEvents } from './scan.js';
import { assembleStatement, fill, Params } from './sql.js';
import { seal, type CompileCtx, type Compiled } from './types.js';

const COUNT = `SELECT count(DISTINCT pdi.person_id)::int AS persons, count(*)::int AS events
{scan}
  AND ev.event = {event}{where}
HAVING count(*) > 0`;

export function compileCount(spec: CountSpec, ctx: CompileCtx): Compiled {
  const p = new Params();
  const scan = beginScan(spec.range, ctx, p);
  const event = p.add(spec.event.event, 'event');
  const where = andFilters([...spec.event.where, ...spec.where], p);
  const select = fill(COUNT, { scan: personEvents(scan), event, where });
  return seal('count', ctx, { sql: assembleStatement([], select, p, ctx.rowCap), params: p.list }, compileMeta(spec.range, ctx));
}

export interface CountData {
  persons: number;
  events: number;
}

export function decodeCount(rows: readonly unknown[]): CountData {
  const row = rows[0] as CountData | undefined;
  if (!row) throw new Error('decodeCount: the statement returned no row');
  return { persons: row.persons, events: row.events };
}

import { describe, expect, it } from 'vitest';
import type { EventCatalog } from '@vantage/contracts';
import { catalogRange } from '../src/lib/range.js';

function catalog(spans: Array<[string, string]>): EventCatalog {
  return {
    project: '0190f3a0-0000-7000-8000-000000000000',
    timezone: 'UTC',
    events: spans.map(([first_seen, last_seen], i) => ({ event: `e${i}`, count: 1, first_seen, last_seen, properties: [] })),
  };
}

describe('catalogRange', () => {
  it('spans the catalog from its first event to its last when that fits the grammar', () => {
    const r = catalogRange(catalog([['2026-08-03T00:00:00.000Z', '2026-08-20T00:00:00.000Z'], ['2026-08-05T00:00:00.000Z', '2026-08-16T00:00:00.000Z']]));
    expect(r).toEqual({ from: '2026-08-03', to: '2026-08-20' });
  });

  it('clamps a span longer than 366 days to the most recent 366 — a stray old event never seeds an un-runnable range', () => {
    const r = catalogRange(catalog([['2025-06-01T00:00:00.000Z', '2026-08-21T00:00:00.000Z']]));
    expect(r.to).toBe('2026-08-21');
    expect(r.from).toBe('2025-08-20'); // 366 days before the last event, not 2025-06-01
    expect(Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)).toBe(366 * 86_400_000);
  });
});

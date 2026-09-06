import { describe, expect, it } from 'vitest';
import type { PathsTransition } from '@vantage/contracts';
import { flowWidth, maxCount, truncationLabel } from '../src/lib/paths.js';

const t = (count: number): PathsTransition => ({ step: 1, from: 'a', to: 'b', count, pct_of_start: null, median_gap_s: null });

describe('paths flow-bar geometry', () => {
  it('maxCount is the busiest transition, 0 for an empty table', () => {
    expect(maxCount([t(2), t(5), t(1)])).toBe(5);
    expect(maxCount([])).toBe(0);
  });

  it('flowWidth is a share of the busiest, clamped to 0..100, never a divide-by-zero', () => {
    expect(flowWidth(5, 5)).toBe(100);
    expect(flowWidth(1, 5)).toBe(20);
    expect(flowWidth(3, 0)).toBe(0);
  });

  it('truncationLabel says "top N of M" only when the cut bit', () => {
    expect(truncationLabel(50, 1284)).toBe('Showing top 50 of 1,284');
    expect(truncationLabel(8, 8)).toBe('Showing 8');
  });
});

import type { FunnelStep } from '@vantage/contracts';
import { describe, expect, it } from 'vitest';
import { funnelRows, overallConversion } from '../src/lib/funnel.js';

const steps: FunnelStep[] = [
  { event: 'signup', persons: 13, pct_of_previous: null, pct_of_start: 1 },
  { event: 'create_project', persons: 6, pct_of_previous: 6 / 13, pct_of_start: 6 / 13 },
  { event: 'invite_teammate', persons: 3, pct_of_previous: 3 / 6, pct_of_start: 3 / 13 },
];

describe('funnelRows computes both shares from the counts (not the wire)', () => {
  const rows = funnelRows(steps);

  it('has no previous for step 1 and a full-width bar', () => {
    expect(rows[0]?.pctOfPrevious).toBeNull();
    expect(rows[0]?.pctOfStart).toBe(1);
    expect(rows[0]?.fillPct).toBe(100);
  });

  it('computes % of previous and % of start for the middle step', () => {
    expect(rows[1]?.pctOfPrevious).toBeCloseTo(6 / 13, 10);
    expect(rows[1]?.pctOfStart).toBeCloseTo(6 / 13, 10);
    expect(rows[1]?.fillPct).toBeCloseTo((6 / 13) * 100, 10);
  });

  it('computes the last step against its own previous and the start', () => {
    expect(rows[2]?.pctOfPrevious).toBeCloseTo(3 / 6, 10);
    expect(rows[2]?.pctOfStart).toBeCloseTo(3 / 13, 10);
  });

  it('returns null shares (never 0 %) when the starting cohort is empty', () => {
    const zero = funnelRows([
      { event: 'a', persons: 0, pct_of_previous: null, pct_of_start: null },
      { event: 'b', persons: 0, pct_of_previous: null, pct_of_start: null },
    ]);
    expect(zero[1]?.pctOfStart).toBeNull();
    expect(zero[1]?.pctOfPrevious).toBeNull();
    expect(zero[1]?.fillPct).toBe(0);
  });
});

describe('overallConversion', () => {
  it('is last ÷ first', () => {
    expect(overallConversion(steps)).toBeCloseTo(3 / 13, 10);
  });
  it('is null for fewer than two steps or an empty start', () => {
    expect(overallConversion([steps[0] as FunnelStep])).toBeNull();
    expect(
      overallConversion([
        { event: 'a', persons: 0, pct_of_previous: null, pct_of_start: null },
        { event: 'b', persons: 5, pct_of_previous: null, pct_of_start: null },
      ]),
    ).toBeNull();
  });
});

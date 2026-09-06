import { describe, expect, it } from 'vitest';
import { cellAria, cellText, heatLevel } from '../src/lib/retention.js';

describe('heatLevel: the global 0–100 % sequential scale', () => {
  it('maps a percentage to one of six levels, the same scale for every cell', () => {
    expect(heatLevel(0)).toBe(0);
    expect(heatLevel(0.1)).toBe(0);
    expect(heatLevel(0.2)).toBe(1);
    expect(heatLevel(0.5)).toBe(3);
    expect(heatLevel(0.99)).toBe(5);
    expect(heatLevel(1)).toBe(5);
  });

  it('an empty cohort (null pct) is the lowest level, never a fabricated colour', () => {
    expect(heatLevel(null)).toBe(0);
    expect(heatLevel(Number.NaN)).toBe(0);
  });
});

describe('cellText and cellAria', () => {
  it('cellText is a whole percentage, or the em dash for an empty cohort', () => {
    expect(cellText({ pct: 0.41 })).toBe('41');
    expect(cellText({ pct: 1 })).toBe('100');
    expect(cellText({ pct: null })).toBe('—');
  });

  it('cellAria names the cohort, the period and whether it is in progress', () => {
    expect(cellAria('12 Aug', 'day', 3, { n: 3, retained: 4, pct: 0.41, in_progress: false })).toBe('12 Aug cohort, day 3: 41 % (in progress)'.replace(' (in progress)', ''));
    expect(cellAria('12 Aug', 'day', 3, { n: 3, retained: 4, pct: 0.41, in_progress: true })).toBe('12 Aug cohort, day 3: 41 % (in progress)');
    expect(cellAria('12 Aug', 'week', 0, { n: 0, retained: 0, pct: null, in_progress: false })).toBe('12 Aug cohort, week 0: no members');
  });
});

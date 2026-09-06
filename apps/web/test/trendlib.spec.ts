import { describe, expect, it } from 'vitest';
import { axisMax, band, bars, centers, linePath } from '../src/lib/trend.js';

describe('axisMax: a readable top of scale', () => {
  it('rounds up to the smallest 1/2/5 × 10^k at or above the largest value', () => {
    expect(axisMax([2, 5, 3])).toBe(5);
    expect(axisMax([6])).toBe(10);
    expect(axisMax([11])).toBe(20);
    expect(axisMax([48])).toBe(50);
    expect(axisMax([1000])).toBe(1000);
    expect(axisMax([1001])).toBe(2000);
  });

  it('is at least 1, even for all-zero or empty input', () => {
    expect(axisMax([0, 0])).toBe(1);
    expect(axisMax([])).toBe(1);
  });
});

describe('bars and lines place marks inside the plot box', () => {
  it('one bar per value, 62 % of its band, height proportional to max', () => {
    const rects = bars([5, 0, 10], 300, 200, 10);
    expect(rects).toHaveLength(3);
    expect(rects[2]!.height).toBe(200); // 10/10 fills the plot height
    expect(rects[1]!.height).toBe(0); // a zero bucket is a zero-height bar, not a gap
    expect(rects[0]!.y).toBe(100); // 5/10 → half height, top at the middle
    expect(band(3, 300)).toBe(100);
    expect(rects[0]!.width).toBeCloseTo(62, 0);
  });

  it('centers spaces buckets evenly and linePath threads them; a single point draws no line', () => {
    expect(centers(2, 200)).toEqual([50, 150]);
    expect(linePath([1, 2], 200, 100, 2)).toBe('M50.0 50.0 L150.0 0.0');
    expect(linePath([5], 200, 100, 10)).toBe('M100.0 50.0'); // a lone point sits at the centre of the whole plot
    expect(linePath([], 200, 100, 10)).toBe('');
  });
});

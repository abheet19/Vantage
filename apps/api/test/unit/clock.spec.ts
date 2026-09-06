/**
 * clock.spec.ts — the system clock reads fresh; the fixed clock reads what it was told.
 */
import { describe, expect, it } from 'vitest';
import { FixedClock, SystemClock } from '../../src/infra/clock.js';

describe('clocks', () => {
  it('SystemClock returns the current time on every call', () => {
    const before = Date.now();
    const t = new SystemClock().now().getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(Date.now());
  });

  it('FixedClock returns a copy of the pinned instant and can be moved', () => {
    const c = new FixedClock(new Date('2026-09-02T00:00:00Z'));
    const a = c.now();
    a.setFullYear(1999);
    expect(c.now()).toEqual(new Date('2026-09-02T00:00:00Z'));
    c.set(new Date('2026-09-03T00:00:00Z'));
    expect(c.now()).toEqual(new Date('2026-09-03T00:00:00Z'));
  });
});

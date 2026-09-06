/**
 * plan-merge.spec.ts — the merge direction is the smaller into the larger, ties are symmetric.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { planMerge } from '../../src/domain/plan-merge.js';

describe('planMerge', () => {
  it('repoints the person with fewer distinct ids into the one with more', () => {
    expect(planMerge({ person: 'A', count: 1 }, { person: 'B', count: 3 })).toEqual({ from: 'A', into: 'B' });
    expect(planMerge({ person: 'A', count: 5 }, { person: 'B', count: 3 })).toEqual({ from: 'B', into: 'A' });
  });

  it('breaks a tie by person id so reciprocal calls agree on the survivor', () => {
    const ab = planMerge({ person: 'aaa', count: 1 }, { person: 'bbb', count: 1 });
    const ba = planMerge({ person: 'bbb', count: 1 }, { person: 'aaa', count: 1 });
    expect(ab).toEqual(ba);
    expect(ab).toEqual({ from: 'bbb', into: 'aaa' });
  });

  it('property: is symmetric in its arguments and never plans a self-merge', () => {
    fc.assert(
      fc.property(fc.uuid(), fc.uuid(), fc.nat(10_000), fc.nat(10_000), (p1, p2, c1, c2) => {
        fc.pre(p1 !== p2);
        const a = planMerge({ person: p1, count: c1 }, { person: p2, count: c2 });
        const b = planMerge({ person: p2, count: c2 }, { person: p1, count: c1 });
        return a.from === b.from && a.into === b.into && a.from !== a.into && (c1 === c2 || (a.from === p1) === c1 < c2);
      }),
    );
  });

  it('refuses to plan when both sides are the same person (the caller must no-op first)', () => {
    expect(() => planMerge({ person: 'A', count: 1 }, { person: 'A', count: 2 })).toThrow(/same person/);
  });
});

/**
 * plan-merge.ts — design §1.2's merge rule as a decision, separated from its execution.
 *
 * Why it exists: merging repoints the smaller person's distinct ids into the larger so the cost is
 * O(distinct ids) and never O(events). Which side is "smaller" is a pure decision; making it here means
 * the identity service only executes a plan, and the tie rule is testable without a database. Ties are
 * broken by person id so that `planMerge(a, b)` and `planMerge(b, a)` agree — two reciprocal identify
 * calls racing each other must converge on the same survivor.
 *
 * What it must never do: touch the database, or return a plan whose `from` equals `into` (the service
 * treats "same person" as a no-op before ever calling this).
 */

export interface MergeSide {
  person: string;
  count: number;
}

export interface MergePlan {
  from: string;
  into: string;
}

/** Design §1.2 merge rule: repoint the smaller person's distinct ids into the larger. Returns the plan; the service executes it. */
export function planMerge(a: MergeSide, b: MergeSide): MergePlan {
  if (a.person === b.person) throw new Error('planMerge: both sides are the same person; the caller must treat this as a no-op');
  if (a.count !== b.count) {
    return a.count < b.count ? { from: a.person, into: b.person } : { from: b.person, into: a.person };
  }
  return a.person < b.person ? { from: b.person, into: a.person } : { from: a.person, into: b.person };
}

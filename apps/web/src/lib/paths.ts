/**
 * paths.ts — the pure numbers behind the paths transitions table's flow bars.
 *
 * Why it exists: the table shows each transition's share of the start walks as a small bar (03-UI §4), and
 * a plausible wrong width is the same failure the funnel bars avoid — so the width is derived from the
 * counts, relative to the commonest transition, in one tested place. A zero denominator or an empty table
 * yields no bar rather than a divide-by-zero (design §1.3).
 *
 * What it must never do: draw a bar wider than the commonest transition, or fabricate a share.
 */
import type { PathsTransition } from '@vantage/contracts';

/** The largest transition count, so every flow bar is a share of the busiest path; 0 for an empty table. */
export function maxCount(transitions: readonly PathsTransition[]): number {
  return transitions.reduce((m, t) => Math.max(m, t.count), 0);
}

/** A transition's flow-bar width as a percentage (0..100) of the commonest transition. */
export function flowWidth(count: number, max: number): number {
  return max > 0 ? Math.min(100, Math.max(0, (count / max) * 100)) : 0;
}

/** "Showing top 50 of 1,284" / "Showing 8" — the chip that says how much of the truth is on screen. */
export function truncationLabel(shown: number, total: number): string {
  return total > shown ? `Showing top ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}` : `Showing ${total.toLocaleString('en-US')}`;
}

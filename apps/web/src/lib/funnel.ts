/**
 * funnel.ts — turn a `FunnelResult`'s step counts into bar rows, computed here, not trusted from the wire.
 *
 * Why it exists: the funnel bars show three numbers per step — the count, the share of the previous step,
 * and the share of the first step (03-UI §4) — plus a bar width. The API returns `pct_of_previous` /
 * `pct_of_start`, but a plausible wrong percentage is exactly the failure the build prompt calls the worst
 * one in analytics, so the UI derives them from the counts it is showing and they are unit-tested against
 * a fixture. Division by a zero starting cohort yields `null`, never a fabricated 0 % (design §1.3).
 *
 * What it must never do: assume a non-empty steps array (an `empty`/`timed_out` funnel has `steps: null`,
 * handled by the caller) or return a bar wider than the first step.
 */
import type { FunnelStep } from '@vantage/contracts';

export interface FunnelRow {
  event: string;
  persons: number;
  /** Share of the immediately previous step, 0..1; `null` for step 1 and when the previous count is 0. */
  pctOfPrevious: number | null;
  /** Share of the first step, 0..1; `null` when the first step has 0 persons. */
  pctOfStart: number | null;
  /** Bar width as a percentage of the first step (0..100), so step 1 is always full-width. */
  fillPct: number;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** One row per step, with the two shares and the bar width derived from the counts (LLD §9 S5: computed, not echoed). */
export function funnelRows(steps: readonly FunnelStep[]): FunnelRow[] {
  const start = steps[0]?.persons ?? 0;
  return steps.map((step, i) => {
    const previous = steps[i - 1]?.persons ?? 0;
    const ofStart = ratio(step.persons, start);
    return {
      event: step.event,
      persons: step.persons,
      pctOfPrevious: i === 0 ? null : ratio(step.persons, previous),
      pctOfStart: ofStart,
      fillPct: ofStart === null ? 0 : Math.min(100, Math.max(0, ofStart * 100)),
    };
  });
}

/** The headline conversion, first step → last step, as a 0..1 ratio; `null` for fewer than two steps or an empty start. */
export function overallConversion(steps: readonly FunnelStep[]): number | null {
  if (steps.length < 2) return null;
  const first = steps[0]?.persons ?? 0;
  const last = steps[steps.length - 1]?.persons ?? 0;
  return first > 0 ? last / first : null;
}

/**
 * DegradedResult.tsx — the empty / timed-out / refused card shared by the Retention, Trend and Paths result
 * panels, so honest degradation reads the same on every screen (design §1.3, build brief rule 4).
 *
 * Why it exists: the three S6 screens each draw their own number for `complete`/`truncated` (a heatmap, a
 * chart, a table) but must render `empty`, `timed_out` and a database refusal identically and distinctly.
 * `isSettled` says whether there is a number to draw; when there is not, `DegradedResult` is the card plus
 * the footer — one place, one voice.
 *
 * What it must never do: render a number, or let `empty` borrow the red alert tone of a timeout or refusal.
 */
import type { JSX } from 'react';
import type { ResultMeta, ResultStatus } from '@vantage/contracts';
import { StateCard } from './StateCard.js';
import { StatusFooter } from './StatusFooter.js';

/** True when the status carries a number to draw (`complete`/`truncated`); false for the degraded states. */
export function isSettled(status: ResultStatus): boolean {
  return status === 'complete' || status === 'truncated';
}

/** The card for a degraded status; the caller renders its own body for the settled ones. `noun` names what was not found ("cohorts", "buckets", "transitions"). */
export function DegradedResult({ meta, noun }: { meta: ResultMeta; noun: string }): JSX.Element {
  if (meta.status === 'empty') {
    return (
      <>
        <StateCard variant="empty" title={`No ${noun}`}>
          No events matched in this range, so there are no {noun} to show. If a name looks invented, check it against Events.
        </StateCard>
        <StatusFooter meta={meta} />
      </>
    );
  }
  if (meta.status === 'timed_out') {
    return (
      <>
        <StateCard variant="timeout" title="Stopped after 5 s">
          Showing nothing rather than a partial answer. Narrow the date range or the query.
        </StateCard>
        <StatusFooter meta={meta} />
      </>
    );
  }
  return (
    <>
      <StateCard variant="refused" icon="i-db" title="Refused by the database">
        This should be impossible; it has been logged as a bug.
      </StateCard>
      <StatusFooter meta={meta} />
    </>
  );
}

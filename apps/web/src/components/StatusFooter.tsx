/**
 * StatusFooter.tsx — the footer under every result: the status chip and the facts that qualify the number.
 *
 * Why it exists: design §1.3 says every result carries `computed_at`, `data_until` and the in-progress
 * count, and the build prompt says never show a number without its footer. This renders the §2.3 footer:
 * the status chip, the elapsed time, the watermark as wall-clock in the project timezone, the timezone
 * itself, and — only when they are non-zero — the adjusted-clock share, the in-progress bucket count and
 * the persons-merged-since count. A zero is omitted rather than shown, because a "0 in progress" chip
 * would be noise, not honesty.
 *
 * What it must never do: render a segment the meta does not justify, or show the watermark in the
 * viewer's timezone instead of the project's.
 */
import type { JSX } from 'react';
import type { ResultMeta } from '@vantage/contracts';
import { formatClock, formatElapsed } from '../lib/format.js';
import { statusView } from '../lib/status.js';
import { Chip, StatusChip } from './Chip.js';

function Sep(): JSX.Element {
  return <span className="sep" />;
}

export function StatusFooter({ meta }: { meta: ResultMeta }): JSX.Element {
  const view = statusView(meta);
  const adjustedPct = Math.round(meta.ts_adjusted_share * 100);
  return (
    <div className="status-foot">
      <StatusChip meta={meta} />
      {/* `complete` carries its own elapsed in the chip; every other status shows it as its own fact. */}
      {meta.status !== 'complete' && (
        <>
          <Sep />
          {formatElapsed(meta.elapsed_ms)}
        </>
      )}
      {meta.data_until && (
        <>
          <Sep />
          data until {formatClock(meta.data_until, meta.timezone)}
        </>
      )}
      <Sep />
      tz {meta.timezone}
      {adjustedPct > 0 && (
        <>
          <Sep />
          <Chip tone="faint" title="Events whose client clock disagreed with the upload time by more than 60 s were shifted by the measured skew.">
            ↺ {adjustedPct} % of events on adjusted clocks
          </Chip>
        </>
      )}
      {meta.incomplete_buckets > 0 && (
        <>
          <Sep />
          <Chip tone="warn">◐ {meta.incomplete_buckets} buckets in progress</Chip>
        </>
      )}
      {meta.persons_merged_since > 0 && (
        <>
          <Sep />
          persons merged since: {meta.persons_merged_since}
        </>
      )}
      <span className="sr">{view.detail}</span>
    </div>
  );
}

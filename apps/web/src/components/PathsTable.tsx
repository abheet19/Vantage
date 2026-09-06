/**
 * PathsTable.tsx — the ranked transitions table with flow bars (03-UI §4, ported from prototype §10).
 *
 * Why it exists: paths is a ranked list of transitions, not a sankey — each row is a step, the two events,
 * how many walks took it, its share of the start walks, the median gap, and a small flow bar sized (in
 * `lib/paths.ts`) against the commonest transition. The "showing top 50 of N" chip tells the reader how
 * much of the truth is on screen when the top-50 cut bit (design §3.4).
 *
 * What it must never do: draw a flow bar wider than the busiest path, or hide the top-50 cut — the chip is
 * how a partial view stays honest.
 */
import type { JSX } from 'react';
import type { PathsResult } from '@vantage/contracts';
import { formatCount, formatDuration, formatRatio } from '../lib/format.js';
import { flowWidth, maxCount } from '../lib/paths.js';
import { Chip } from './Chip.js';

export function TruncationChip({ result }: { result: PathsResult }): JSX.Element {
  const shown = result.transitions?.length ?? 0;
  const total = result.total_transitions;
  const cut = total > shown;
  return (
    <Chip tone={cut ? 'warn' : 'faint'} role="status">
      {cut ? `▤ Showing top ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}` : `${total.toLocaleString('en-US')} transitions`}
    </Chip>
  );
}

export function PathsTable({ result }: { result: PathsResult }): JSX.Element | null {
  const transitions = result.transitions;
  if (!transitions || transitions.length === 0) return null;
  const max = maxCount(transitions);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data" data-testid="paths-table">
        <thead>
          <tr>
            <th className="r">#</th>
            <th>Step</th>
            <th>From → to</th>
            <th className="r">Walks</th>
            <th className="r">% of start</th>
            <th className="r">Median gap</th>
            <th>Flow</th>
          </tr>
        </thead>
        <tbody>
          {transitions.map((t, i) => (
            <tr key={`${t.step}-${t.from}-${t.to}-${i}`} data-testid="paths-row">
              <td className="r">{i + 1}</td>
              <td className="r">{t.step}</td>
              <td>
                <code title={t.from}>{t.from}</code>
                <span className="arrow">→</span>
                <code title={t.to}>{t.to}</code>
              </td>
              <td className="r">{formatCount(t.count)}</td>
              <td className="r">{formatRatio(t.pct_of_start)}</td>
              <td className="r">{formatDuration(t.median_gap_s)}</td>
              <td>
                <span className="pct" aria-hidden="true">
                  <i style={{ width: `${flowWidth(t.count, max)}%`, minWidth: 4 }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

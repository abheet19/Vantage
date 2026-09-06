/**
 * RetentionHeatmap.tsx — the cohort triangle heatmap (03-UI §4, ported from prototype §9).
 *
 * Why it exists: retention is a grid of cohorts × periods, and the honest rendering of it is a table on a
 * GLOBAL sequential colour scale (`heatLevel`), with the cells that may still receive events hatched and
 * dashed (`in_progress`, computed in SQL — the UI never guesses it) and a tooltip and per-cell ARIA so the
 * number is legible to eye and screen reader alike. An empty cohort shows "—", never 0 %. The colour scale
 * is the same for every cell, so two cohorts with equal retention look equal (design §1.3, §5).
 *
 * What it must never do: scale a cell against its own row, show a percentage for an empty cohort, or mark a
 * cell in progress on anything but the `in_progress` the API computed.
 */
import { useState, type JSX } from 'react';
import type { RetentionResult } from '@vantage/contracts';
import { cellAria, cellText, heatLevel } from '../lib/retention.js';

/** The naive local bucket start (`2026-08-03T00:00:00`) as a short calendar label; parsed as UTC so the process zone never shifts it. */
function bucketLabel(bucket: string): string {
  const date = new Date(`${bucket.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(date);
}

interface Tip {
  x: number;
  y: number;
  text: string;
  inProgress: boolean;
}

export function RetentionHeatmap({ result }: { result: RetentionResult }): JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null);
  const cohorts = result.cohorts;
  if (!cohorts || cohorts.length === 0) return null;
  const periods = Math.max(...cohorts.map((c) => c.cells.length));
  const ns = Array.from({ length: periods }, (_, n) => n);

  return (
    <div className="heat-wrap" onMouseLeave={() => setTip(null)}>
      <table className="heat" aria-label="Retention heatmap, global 0 to 100 percent scale">
        <thead>
          <tr>
            <th className="coh">Cohort</th>
            {ns.map((n) => (
              <th key={n} scope="col">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort.bucket}>
              <th className="coh" scope="row">
                {bucketLabel(cohort.bucket)}
                <small>{cohort.size.toLocaleString('en-US')}</small>
              </th>
              {cohort.cells.map((cell) => {
                const label = cellAria(bucketLabel(cohort.bucket), result.unit, cell.n, cell);
                return (
                  <td
                    key={cell.n}
                    className={`l${heatLevel(cell.pct)}${cell.in_progress ? ' prog' : ''}`}
                    tabIndex={0}
                    aria-label={label}
                    data-testid="heat-cell"
                    onMouseEnter={(e) => setTip({ x: e.currentTarget.offsetLeft + 24, y: e.currentTarget.offsetTop - 8, text: label, inProgress: cell.in_progress })}
                    onFocus={(e) => setTip({ x: e.currentTarget.offsetLeft + 24, y: e.currentTarget.offsetTop - 8, text: label, inProgress: cell.in_progress })}
                  >
                    {cellText(cell)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {tip && (
        <div className="tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.text}</b>
          {tip.inProgress && <div className="w">This period has not ended — the number will still change.</div>}
        </div>
      )}
    </div>
  );
}

/** The 0–100 % colour legend and the hatched in-progress swatch (03-UI §4). */
export function HeatLegend(): JSX.Element {
  return (
    <span className="legend" data-testid="heat-legend">
      0 %<i style={{ background: 'var(--s0)' }} /><i style={{ background: 'var(--s1)' }} /><i style={{ background: 'var(--s2)' }} /><i style={{ background: 'var(--s3)' }} /><i style={{ background: 'var(--s4)' }} /><i style={{ background: 'var(--s5)' }} />100 %
      <span style={{ marginLeft: 8 }} />
      <i className="hatch" />in progress
    </span>
  );
}

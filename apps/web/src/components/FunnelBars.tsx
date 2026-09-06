/**
 * FunnelBars.tsx — the horizontal step bars (03-UI §4), one per funnel step.
 *
 * Why it exists: this is the result rendering for a funnel — each step's count, its share of the previous
 * step and of the first, in tabular mono, with a bar whose width is that share of the first step and a
 * hatched drop-off for the remainder. The three numbers come from `funnelRows`, which derives them from
 * the counts rather than trusting the wire (LLD §9 S5). Step colours cycle the six categorical tokens.
 */
import type { JSX } from 'react';
import type { FunnelStep } from '@vantage/contracts';
import { formatCount, formatRatio } from '../lib/format.js';
import { funnelRows } from '../lib/funnel.js';

const CATEGORICAL = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];

export function FunnelBars({ steps }: { steps: readonly FunnelStep[] }): JSX.Element {
  const rows = funnelRows(steps);
  return (
    <div className="funnel" data-testid="funnel-bars">
      {rows.map((row, i) => {
        const colour = `var(${CATEGORICAL[i % CATEGORICAL.length]})`;
        return (
          <div className="frow" key={`${row.event}-${i}`}>
            <div className="name">
              <span className="sw" style={{ background: colour }} />
              <code title={row.event}>{row.event}</code>
            </div>
            <div className="track">
              <div className="fill" style={{ width: `${row.fillPct}%`, background: colour }} />
              <div className="drop" style={{ width: `${100 - row.fillPct}%` }} />
            </div>
            <div className="nums">
              <div>
                <b>{formatCount(row.persons)}</b>
                <small>persons</small>
              </div>
              <div>
                <span>{row.pctOfPrevious === null ? '—' : formatRatio(row.pctOfPrevious)}</span>
                <small>of prev</small>
              </div>
              <div>
                <span>{formatRatio(row.pctOfStart)}</span>
                <small>of start</small>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

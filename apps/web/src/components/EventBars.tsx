/**
 * EventBars.tsx — the top-events bar chart (03-UI §4 house style, mirrors FunnelBars).
 *
 * Why it exists: the event catalog leads with a table, but the honest first read of it is which events
 * this project actually receives and in what proportion. This is that picture: a horizontal bar per event,
 * ranked by count, each bar's length its share of the busiest event, with the real count and that event's
 * share of all events beside it. It mirrors FunnelBars exactly — the same `.frow` row (swatch + mono name +
 * track + fill), the same six categorical tokens — so the two charts read as one system.
 *
 * What it must never do: invent a count (every number is `count` straight from the catalog), scale a bar
 * against anything but the shared maximum, or claim a percentage of an empty whole (formatPercent handles
 * that, returning the em dash).
 */
import type { JSX } from 'react';
import type { CatalogEvent } from '@vantage/contracts';
import { formatCount, formatPercent } from '../lib/format.js';

const CATEGORICAL = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];

/** How many events the bar chart shows before the long tail is left to the table below. */
export const EVENT_BARS_TOP_N = 8;

export function EventBars({ events, total }: { events: readonly CatalogEvent[]; total: number }): JSX.Element | null {
  if (events.length === 0) return null;
  const ranked = [...events].sort((a, b) => b.count - a.count).slice(0, EVENT_BARS_TOP_N);
  const max = ranked[0]?.count ?? 0;
  return (
    <div className="eventbars" data-testid="event-bars">
      {ranked.map((e, i) => {
        const colour = `var(${CATEGORICAL[i % CATEGORICAL.length]})`;
        // A settled bar is its share of the busiest event; a floor keeps a tiny event visible.
        const fillPct = max > 0 ? Math.max(1.5, (e.count / max) * 100) : 0;
        return (
          <div className="frow" key={e.event}>
            <div className="name">
              <span className="sw" style={{ background: colour }} />
              <code title={e.event}>{e.event}</code>
            </div>
            <div className="track">
              <div className="fill" style={{ width: `${fillPct}%`, background: colour }} />
            </div>
            <div className="nums">
              <div>
                <b>{formatCount(e.count)}</b>
                <small>events</small>
              </div>
              <div>
                <span>{formatPercent(e.count, total)}</span>
                <small>of all</small>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * TrendChart.tsx — a purpose-built SVG chart over the trend's buckets (03-UI §4; no chart library, per brief).
 *
 * Why it exists: the trend is one event per time bucket, and its honest picture is bars (or, with a
 * breakdown, one line per series on a shared axis) where the buckets that may still receive events are
 * dashed — the same `in_progress` the SQL computed, never a guess. The geometry lives in `lib/trend.ts`, so
 * this component only places what that returns and colours it. A breakdown draws the commonest series (plus
 * "other") each in a categorical colour, with a legend; without one, the single series is bars.
 *
 * What it must never do: draw an in-progress bucket the same as a settled one, or scale one series against
 * another's max (every series shares `axisMax`).
 */
import type { JSX } from 'react';
import type { TrendResult, TrendSeries } from '@vantage/contracts';
import { axisMax, bars, centers } from '../lib/trend.js';

const CATEGORICAL = ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6'];
const PLOT = { padL: 8, padR: 8, padT: 8, padB: 26, height: 240 };

/** The naive local bucket start as a short label, parsed as UTC so the process zone never shifts it. */
function shortBucket(bucket: string): string {
  const date = new Date(`${bucket.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return bucket;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short' }).format(date);
}

/** Show every bucket's label when there is room, otherwise thin them so they do not collide. */
function labelStride(count: number): number {
  return count <= 16 ? 1 : Math.ceil(count / 12);
}

function seriesColour(i: number): string {
  return `var(${CATEGORICAL[i % CATEGORICAL.length]})`;
}

export function TrendChart({ result }: { result: TrendResult }): JSX.Element | null {
  const points = result.points;
  if (!points || points.length === 0) return null;
  const buckets = points.map((p) => p.bucket);
  const width = Math.max(360, points.length * 44);
  const plotW = width - PLOT.padL - PLOT.padR;
  const plotH = PLOT.height - PLOT.padT - PLOT.padB;
  const series = result.breakdown?.series ?? null;
  const allValues = series ? series.flatMap((s) => s.points.map((p) => p.value)) : points.map((p) => p.value);
  const max = axisMax(allValues);
  const stride = labelStride(points.length);
  const xs = centers(points.length, plotW);

  return (
    <div className="trendchart" data-testid="trend-chart">
      {series && (
        <div className="trendlegend" data-testid="trend-legend">
          {series.map((s, i) => (
            <span key={i}>
              <i style={{ background: seriesColour(i) }} />
              {s.other ? 'other' : (s.key ?? 'unset')}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${PLOT.height}`} preserveAspectRatio="none" role="img" aria-label={`Trend of ${result.measure} by ${result.unit}, ${points.length} buckets`}>
        <g transform={`translate(${PLOT.padL},${PLOT.padT})`}>
          <line className="ax" x1={0} y1={plotH} x2={plotW} y2={plotH} />
          {series ? <SeriesLines series={series} plotW={plotW} plotH={plotH} max={max} /> : <Bars values={points.map((p) => p.value)} progress={points.map((p) => p.in_progress)} plotW={plotW} plotH={plotH} max={max} />}
        </g>
        {points.map((p, i) =>
          i % stride === 0 ? (
            <text key={i} x={PLOT.padL + xs[i]!} y={PLOT.height - 8} textAnchor="middle">
              {shortBucket(p.bucket)}
            </text>
          ) : null,
        )}
      </svg>
      <span className="sr">{`Maximum ${max} per ${result.unit}. Buckets: ${buckets.map((b, i) => `${shortBucket(b)} ${points[i]!.value}${points[i]!.in_progress ? ' (in progress)' : ''}`).join(', ')}.`}</span>
    </div>
  );
}

function Bars({ values, progress, plotW, plotH, max }: { values: number[]; progress: boolean[]; plotW: number; plotH: number; max: number }): JSX.Element {
  const rects = bars(values, plotW, plotH, max);
  return (
    <>
      {rects.map((r, i) => (
        <g key={i}>
          <rect className="bar" data-testid="trend-bar" x={r.x} y={r.y} width={r.width} height={r.height} rx={2} fill={seriesColour(0)} opacity={progress[i] ? 0.4 : 1} />
          {progress[i] && <rect className="prog" data-testid="trend-bar-prog" x={r.x} y={r.y} width={r.width} height={r.height} rx={2} stroke={seriesColour(0)} />}
        </g>
      ))}
    </>
  );
}

/** A polyline through the given point indices at their absolute band centres; empty for fewer than two indices. */
function pathThrough(indices: number[], xs: number[], values: number[], plotH: number, max: number): string {
  if (indices.length < 2) return '';
  const y = (v: number) => (max > 0 ? plotH - (v / max) * plotH : plotH);
  return indices.map((idx, k) => `${k === 0 ? 'M' : 'L'}${xs[idx]!.toFixed(1)} ${y(values[idx]!).toFixed(1)}`).join(' ');
}

function SeriesLines({ series, plotW, plotH, max }: { series: TrendSeries[]; plotW: number; plotH: number; max: number }): JSX.Element {
  return (
    <>
      {series.map((s, i) => {
        const values = s.points.map((p) => p.value);
        const xs = centers(values.length, plotW);
        const firstProg = s.points.findIndex((p) => p.in_progress);
        // The solid line covers the settled buckets; the dashed tail joins from the last settled bucket to the end.
        const solidIdx = Array.from({ length: firstProg === -1 ? values.length : firstProg }, (_, k) => k);
        const dashedIdx = firstProg === -1 ? [] : Array.from({ length: values.length - firstProg + 1 }, (_, k) => Math.max(0, firstProg - 1) + k).filter((idx) => idx < values.length);
        const colour = seriesColour(i);
        const solid = pathThrough(solidIdx, xs, values, plotH, max);
        const dashed = pathThrough(dashedIdx, xs, values, plotH, max);
        return (
          <g key={i}>
            {solid && <path className="line" data-testid="trend-line" d={solid} stroke={colour} />}
            {dashed && <path className="line prog" data-testid="trend-line-prog" d={dashed} stroke={colour} />}
          </g>
        );
      })}
    </>
  );
}

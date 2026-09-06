/**
 * trend.ts — the pure geometry of the trend chart, so bar and line positions are computed and tested here,
 * not improvised inside an SVG render.
 *
 * Why it exists: the trend is drawn without a chart library (the build brief), so the value→pixel maths is
 * ours to get right — a wrong bar height is a number the reader cannot defend. `axisMax` rounds the top of
 * the scale to a 1/2/5 step so the axis is readable; `bars` and `linePath` place marks in a plot box whose
 * origin the caller offsets. Everything is a total function of its inputs; an empty series is an empty
 * layout, never a throw.
 *
 * What it must never do: place a mark outside the plot box, or scale against anything but the shared max
 * (every series in a breakdown is drawn against the same axis, or the lines would lie about each other).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The top of the value axis: the smallest 1/2/5 × 10^k at or above the largest value, and at least 1. */
export function axisMax(values: readonly number[]): number {
  const max = values.reduce((m, v) => Math.max(m, Number.isFinite(v) ? v : 0), 0);
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5]) {
    if (step * pow >= max) return step * pow;
  }
  return 10 * pow;
}

/** The band width one bucket occupies across the plot. */
export function band(count: number, plotW: number): number {
  return count > 0 ? plotW / count : plotW;
}

/** One bar per value, 62 % of its band wide, height proportional to `max`; coordinates are within the plot box (y = 0 at its top). */
export function bars(values: readonly number[], plotW: number, plotH: number, max: number): Rect[] {
  const w = band(values.length, plotW);
  const barW = w * 0.62;
  return values.map((v, i) => {
    const height = max > 0 ? Math.max(0, (v / max) * plotH) : 0;
    return { x: i * w + (w - barW) / 2, y: plotH - height, width: barW, height };
  });
}

/** The x of each bucket's centre, for line marks and axis ticks. */
export function centers(count: number, plotW: number): number[] {
  const w = band(count, plotW);
  return Array.from({ length: count }, (_, i) => (i + 0.5) * w);
}

/** An SVG path over the values as a polyline through their band centres; a lone `M` for one point, empty for none. */
export function linePath(values: readonly number[], plotW: number, plotH: number, max: number): string {
  if (values.length === 0) return '';
  const xs = centers(values.length, plotW);
  const y = (v: number) => (max > 0 ? plotH - (v / max) * plotH : plotH);
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs[i]!.toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
}

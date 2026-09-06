import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TrendChart } from '../src/components/TrendChart.js';
import { trendResult } from './fixtures.js';

describe('TrendChart', () => {
  it('renders one bar per bucket and marks the in-progress bucket with a dashed outline', () => {
    render(<TrendChart result={trendResult({ inProgressLast: true })} />);
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
    expect(screen.getAllByTestId('trend-bar')).toHaveLength(3);
    // Exactly the last bucket is in progress → exactly one dashed overlay.
    expect(screen.getAllByTestId('trend-bar-prog')).toHaveLength(1);
  });

  it('a settled trend draws no dashed overlay', () => {
    render(<TrendChart result={trendResult()} />);
    expect(screen.queryByTestId('trend-bar-prog')).toBeNull();
  });

  it('a breakdown draws a line per series with a legend, not bars', () => {
    render(<TrendChart result={trendResult({ breakdown: true })} />);
    expect(screen.getByTestId('trend-legend')).toBeInTheDocument();
    expect(screen.getAllByTestId('trend-line').length).toBeGreaterThanOrEqual(2); // free + other
    expect(screen.queryByTestId('trend-bar')).toBeNull();
  });

  it('renders nothing when there are no points', () => {
    const { container } = render(<TrendChart result={{ ...trendResult(), points: null }} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

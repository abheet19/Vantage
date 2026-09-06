import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResultView } from '../src/components/ResultView.js';
import { countResult, emptyFunnel, funnelResult, pathsResult, retentionResult, timedOutFunnel, trendResult } from './fixtures.js';

describe('ResultView renders the body by status, never by the 200 alone', () => {
  it('a complete funnel shows the bars, the KPIs and a complete footer', () => {
    const { container } = render(<ResultView result={funnelResult()} />);
    expect(screen.getByTestId('funnel-bars')).toBeInTheDocument();
    expect(container.textContent).toContain('converted start → finish');
    expect(container.textContent).toContain('● Complete');
  });

  it('an empty result shows the calm card and no funnel bars', () => {
    const { container } = render(<ResultView result={emptyFunnel()} />);
    expect(screen.getByTestId('state-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('funnel-bars')).toBeNull();
    expect(container.textContent).toContain('No events matched');
  });

  it('a timed-out result shows the red stopped card and no number', () => {
    render(<ResultView result={timedOutFunnel()} />);
    expect(screen.getByTestId('state-timeout')).toBeInTheDocument();
    expect(screen.queryByTestId('funnel-bars')).toBeNull();
  });

  it('empty and timed-out do not share a rendering', () => {
    const empty = render(<ResultView result={emptyFunnel()} />).container.querySelector('.card-state')?.className;
    const timeout = render(<ResultView result={timedOutFunnel()} />).container.querySelector('.card-state')?.className;
    expect(empty).not.toEqual(timeout);
  });

  it('a count result shows persons and events KPIs', () => {
    render(<ResultView result={countResult(13, 20)} />);
    expect(screen.getByTestId('count-kpis')).toHaveTextContent('13');
    expect(screen.getByTestId('count-kpis')).toHaveTextContent('20');
  });

  it('a retention result renders the heatmap on the Ask screen (S6)', () => {
    render(<ResultView result={retentionResult(3)} />);
    expect(screen.getByRole('table', { name: /Retention heatmap/ })).toBeInTheDocument();
    expect(screen.getAllByTestId('heat-cell').length).toBe(9); // 3 cohorts × 3 cells
    expect(screen.getByTestId('heat-legend')).toBeInTheDocument();
  });

  it('a trend result renders the SVG chart with a bar per bucket (S6)', () => {
    render(<ResultView result={trendResult()} />);
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
    expect(screen.getAllByTestId('trend-bar').length).toBe(3);
  });

  it('a paths result renders the ranked transitions table and the truncation chip (S6)', () => {
    render(<ResultView result={pathsResult({ total: 8 })} />);
    expect(screen.getByTestId('paths-table')).toBeInTheDocument();
    expect(screen.getAllByTestId('paths-row').length).toBe(2);
    expect(screen.getByText(/Showing top 2 of 8/)).toBeInTheDocument();
  });
});

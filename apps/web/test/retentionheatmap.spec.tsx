import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeatLegend, RetentionHeatmap } from '../src/components/RetentionHeatmap.js';
import { retentionResult } from './fixtures.js';

describe('RetentionHeatmap', () => {
  it('renders one cell per cohort × period, each with an aria label and a continuous global-scale teal fill', () => {
    render(<RetentionHeatmap result={retentionResult(2)} />);
    const cells = screen.getAllByTestId('heat-cell');
    expect(cells).toHaveLength(6); // 2 cohorts × 3 cells
    // The fill is a continuous teal alpha (round(pct×85) %), the SAME scale for every cohort — not six buckets.
    // n=0 is 100 % → 85 %; n=1 is 40 % → 34 %; n=2 is 0 % → 0 %.
    expect(cells[0]!.style.background).toBe('color-mix(in srgb, var(--teal) 85%, transparent)');
    expect(cells[1]!.style.background).toBe('color-mix(in srgb, var(--teal) 34%, transparent)');
    expect(cells[2]!.style.background).toBe('color-mix(in srgb, var(--teal) 0%, transparent)');
    expect(cells[0]).toHaveAttribute('aria-label', expect.stringContaining('week 0: 100 %'));
  });

  it('marks in-progress cells distinctly (hatched) and settled cells not', () => {
    render(<RetentionHeatmap result={retentionResult(1, { inProgressLastCell: true })} />);
    const cells = screen.getAllByTestId('heat-cell');
    expect(cells[2]).toHaveClass('prog'); // the last cell is in progress
    expect(cells[0]).not.toHaveClass('prog');
    expect(cells[2]).toHaveAttribute('aria-label', expect.stringContaining('(in progress)'));
  });

  it('shows a tooltip on hover, warning when the period has not ended', () => {
    render(<RetentionHeatmap result={retentionResult(1, { inProgressLastCell: true })} />);
    const cells = screen.getAllByTestId('heat-cell');
    fireEvent.mouseEnter(cells[2]!);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('in progress');
    expect(tip.querySelector('.w')).not.toBeNull();
  });

  it('renders nothing when there are no cohorts', () => {
    const { container } = render(<RetentionHeatmap result={{ ...retentionResult(0), cohorts: null }} />);
    expect(container.querySelector('table')).toBeNull();
  });

  it('the legend shows the 0–100 % ramp and the hatched in-progress swatch', () => {
    const { container } = render(<HeatLegend />);
    expect(container.querySelector('.hatch')).not.toBeNull();
    expect(container.textContent).toContain('in progress');
  });
});

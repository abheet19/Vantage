import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeatLegend, RetentionHeatmap } from '../src/components/RetentionHeatmap.js';
import { retentionResult } from './fixtures.js';

describe('RetentionHeatmap', () => {
  it('renders one cell per cohort × period, each with an aria label and a global-scale colour class', () => {
    render(<RetentionHeatmap result={retentionResult(2)} />);
    const cells = screen.getAllByTestId('heat-cell');
    expect(cells).toHaveLength(6); // 2 cohorts × 3 cells
    // n=0 is 100 % → level 5; n=1 is 40 % → level 2 (floor(0.4×6)); n=2 is 0 % → level 0 (the same scale for every cohort).
    expect(cells[0]).toHaveClass('l5');
    expect(cells[1]).toHaveClass('l2');
    expect(cells[2]).toHaveClass('l0');
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

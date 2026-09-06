import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PathsTable, TruncationChip } from '../src/components/PathsTable.js';
import { pathsResult } from './fixtures.js';

describe('PathsTable', () => {
  it('renders one row per transition with the step, the two events, the count and the share', () => {
    render(<PathsTable result={pathsResult()} />);
    expect(screen.getByTestId('paths-table')).toBeInTheDocument();
    const rows = screen.getAllByTestId('paths-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('signup');
    expect(rows[0]!.textContent).toContain('view_pricing');
    expect(rows[0]!.textContent).toContain('14.3 %'); // 2 / 14 of start
  });

  it('renders nothing when there are no transitions', () => {
    const { container } = render(<PathsTable result={{ ...pathsResult(), transitions: null }} />);
    expect(container.querySelector('table')).toBeNull();
  });

  it('the truncation chip says "top N of M" when the cut bit, and the plain count otherwise', () => {
    const cut = render(<TruncationChip result={pathsResult({ total: 1284 })} />);
    expect(cut.container.textContent).toContain('Showing top 2 of 1,284');
    const whole = render(<TruncationChip result={pathsResult({ total: 2 })} />);
    expect(whole.container.textContent).toContain('2 transitions');
  });
});

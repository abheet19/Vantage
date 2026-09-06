import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FunnelBars } from '../src/components/FunnelBars.js';
import { funnelResult } from './fixtures.js';

describe('FunnelBars', () => {
  it('renders one row per step with the event name and person count', () => {
    const steps = funnelResult().steps!;
    const { container } = render(<FunnelBars steps={steps} />);
    expect(container.querySelectorAll('.frow')).toHaveLength(3);
    expect(screen.getByText('signup')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows the computed % of previous / % of start (46.2 % and 23.1 % for the demo funnel)', () => {
    const steps = funnelResult().steps!;
    const { container } = render(<FunnelBars steps={steps} />);
    const text = container.textContent ?? '';
    expect(text).toContain('46.2 %'); // 6/13 both of-previous and of-start on step 2
    expect(text).toContain('50.0 %'); // 3/6 of-previous on step 3
    expect(text).toContain('23.1 %'); // 3/13 of-start on step 3
  });

  it('shows an em dash for step 1 % of previous, never a fabricated 100 %', () => {
    const steps = funnelResult().steps!;
    const { container } = render(<FunnelBars steps={steps} />);
    const firstRow = container.querySelectorAll('.frow')[0];
    expect(firstRow?.textContent).toContain('—');
  });

  it('makes the first bar full-width and the last bar the narrowest', () => {
    const steps = funnelResult().steps!;
    const { container } = render(<FunnelBars steps={steps} />);
    const fills = [...container.querySelectorAll('.fill')].map((el) => (el as HTMLElement).style.width);
    expect(fills[0]).toBe('100%');
    expect(parseFloat(fills[2] ?? '0')).toBeLessThan(parseFloat(fills[1] ?? '0'));
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Rail } from '../src/components/Rail.js';
import { ROUTES } from '../src/routes.js';

describe('Rail', () => {
  it('renders exactly the routes this slice ships, none leading nowhere', () => {
    render(<Rail route="ask" navigate={() => undefined} open onToggle={() => undefined} />);
    for (const r of ROUTES) expect(screen.getByTitle(`${r.label} (${r.key})`)).toBeInTheDocument();
    // S6 shipped Retention, Paths and Trend, so they are now in the rail.
    expect(screen.getByText('Retention')).toBeInTheDocument();
    expect(screen.getByText('Paths')).toBeInTheDocument();
    expect(screen.getByText('Trend')).toBeInTheDocument();
  });

  it('marks the current route with aria-current=page', () => {
    render(<Rail route="funnel" navigate={() => undefined} open onToggle={() => undefined} />);
    expect(screen.getByTitle('Funnel (2)')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTitle('Ask (1)')).not.toHaveAttribute('aria-current');
  });

  it('navigates on click', async () => {
    const navigate = vi.fn();
    render(<Rail route="ask" navigate={navigate} open onToggle={() => undefined} />);
    await userEvent.click(screen.getByTitle('Retention (3)'));
    expect(navigate).toHaveBeenCalledWith('retention');
  });
});

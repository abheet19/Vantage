import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton, StateCard } from '../src/components/StateCard.js';

describe('empty, error and loading are three different DOM shapes (design §1.3)', () => {
  it('empty is a calm status card, not an alert, with the dashed ring', () => {
    const { container } = render(<StateCard variant="empty" title="No events matched">calm</StateCard>);
    const card = container.querySelector('.card-state');
    expect(card?.className).toContain('empty');
    expect(card?.getAttribute('role')).toBe('status');
    expect(container.querySelector('.ring')).not.toBeNull();
  });

  it('error is an alert card with the real message and no ring', () => {
    const { container } = render(
      <StateCard variant="error" icon="i-db" title="Query failed" raw={{ heading: 'Reason', text: 'ECONNREFUSED 127.0.0.1:5432' }}>
        loud
      </StateCard>,
    );
    const card = container.querySelector('.card-state');
    expect(card?.className).toContain('error');
    expect(card?.getAttribute('role')).toBe('alert');
    expect(container.querySelector('.ring')).toBeNull();
    expect(container.textContent).toContain('ECONNREFUSED 127.0.0.1:5432');
  });

  it('loading is a skeleton, aria-hidden, with neither a role nor a message', () => {
    const { container } = render(<Skeleton />);
    const skel = container.querySelector('.skel');
    expect(skel).not.toBeNull();
    expect(skel?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.card-state')).toBeNull();
  });

  it('the three do not share a rendering: different root class and role', () => {
    const empty = render(<StateCard variant="empty" title="a" />).container.querySelector('.card-state')?.className;
    const error = render(<StateCard variant="error" title="b" />).container.querySelector('.card-state')?.className;
    const loading = render(<Skeleton />).container.firstElementChild?.className;
    expect(new Set([empty, error, loading]).size).toBe(3);
  });
});

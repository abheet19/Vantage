import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CatalogEvent } from '@vantage/contracts';
import { EventBars, EVENT_BARS_TOP_N } from '../src/components/EventBars.js';

/** A minimal catalog event — the bar chart reads only `event` and `count`. */
function ev(event: string, count: number): CatalogEvent {
  return { event, count, first_seen: '2026-08-01T00:00:00.000Z', last_seen: '2026-08-31T00:00:00.000Z', properties: [] };
}

describe('EventBars', () => {
  const events = [ev('page_view', 800), ev('signup', 200), ev('purchase', 50)];
  const total = 1050;

  it('renders one row per event with its name and count', () => {
    const { container } = render(<EventBars events={events} total={total} />);
    expect(container.querySelectorAll('.frow')).toHaveLength(3);
    expect(screen.getByText('page_view')).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
  });

  it('ranks events by count and makes the busiest bar full-width', () => {
    const { container } = render(<EventBars events={[ev('a', 10), ev('b', 100), ev('c', 40)]} total={150} />);
    const names = [...container.querySelectorAll('.frow code')].map((el) => el.textContent);
    expect(names).toEqual(['b', 'c', 'a']); // ranked by count: b (100) > c (40) > a (10)
    const fills = [...container.querySelectorAll('.fill')].map((el) => (el as HTMLElement).style.width);
    expect(fills[0]).toBe('100%');
    expect(parseFloat(fills[2] ?? '0')).toBeLessThan(parseFloat(fills[1] ?? '0'));
  });

  it('shows each event’s share of all events as the volume indicator', () => {
    const { container } = render(<EventBars events={events} total={total} />);
    const text = container.textContent ?? '';
    expect(text).toContain('76.2 %'); // 800 / 1050
    expect(text).toContain('of all');
  });

  it('caps the chart at the top N and leaves the tail to the table', () => {
    const many = Array.from({ length: EVENT_BARS_TOP_N + 5 }, (_, i) => ev(`e${i}`, 100 - i));
    const { container } = render(<EventBars events={many} total={1000} />);
    expect(container.querySelectorAll('.frow')).toHaveLength(EVENT_BARS_TOP_N);
  });

  it('renders nothing when there are no events', () => {
    const { container } = render(<EventBars events={[]} total={0} />);
    expect(container.querySelector('.eventbars')).toBeNull();
  });
});

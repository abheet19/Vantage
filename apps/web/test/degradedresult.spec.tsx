import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ResultMeta, ResultStatus } from '@vantage/contracts';
import { DegradedResult, isSettled } from '../src/components/DegradedResult.js';

const meta = (status: ResultStatus): ResultMeta => ({ status, computed_at: '2026-09-05T00:00:00.000Z', data_until: null, elapsed_ms: 5, incomplete_buckets: 0, ts_adjusted_share: 0, persons_merged_since: 0, timezone: 'UTC', row_cap: 10_000 });

describe('isSettled', () => {
  it('is true only for the statuses that carry a number', () => {
    expect(isSettled('complete')).toBe(true);
    expect(isSettled('truncated')).toBe(true);
    expect(isSettled('empty')).toBe(false);
    expect(isSettled('timed_out')).toBe(false);
    expect(isSettled('refused')).toBe(false);
    expect(isSettled('refused_by_database')).toBe(false);
  });
});

describe('DegradedResult renders the three degraded states distinctly', () => {
  it('empty is a calm status card naming the noun, never an alert', () => {
    render(<DegradedResult meta={meta('empty')} noun="cohorts" />);
    const card = screen.getByTestId('state-empty');
    expect(card).toHaveAttribute('role', 'status');
    expect(card.textContent).toContain('No cohorts');
  });

  it('timed_out is a red stopped alert', () => {
    render(<DegradedResult meta={meta('timed_out')} noun="buckets" />);
    const card = screen.getByTestId('state-timeout');
    expect(card).toHaveAttribute('role', 'alert');
    expect(card.textContent).toContain('Stopped after 5 s');
  });

  it('a database refusal is a red refused alert', () => {
    render(<DegradedResult meta={meta('refused_by_database')} noun="transitions" />);
    const card = screen.getByTestId('state-refused');
    expect(card).toHaveAttribute('role', 'alert');
    expect(card.textContent).toContain('Refused by the database');
  });

  it('empty and timed_out do not share a rendering', () => {
    const empty = render(<DegradedResult meta={meta('empty')} noun="x" />).container.querySelector('.card-state')?.className;
    const timeout = render(<DegradedResult meta={meta('timed_out')} noun="x" />).container.querySelector('.card-state')?.className;
    expect(empty).not.toEqual(timeout);
  });
});

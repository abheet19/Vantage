import type { ResultStatus } from '@vantage/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, StatusChip } from '../src/components/Chip.js';
import { meta } from './fixtures.js';

const ALL: ResultStatus[] = ['complete', 'empty', 'timed_out', 'truncated', 'refused', 'refused_by_database'];

describe('StatusChip renders each of the six statuses distinctly', () => {
  it('produces a distinct text for every status (snapshot)', () => {
    const texts = ALL.map((status) => {
      const { container } = render(<StatusChip meta={meta(status)} />);
      const chip = container.querySelector('.chip');
      return chip?.textContent?.trim() ?? '';
    });
    expect(texts).toMatchInlineSnapshot(`
      [
        "● Complete · 0.41 s",
        "○ No events matched",
        "■ Stopped after 5 s",
        "▤ Showing top 10,000",
        "⊘ Refused",
        "⊘ Refused by the database",
      ]
    `);
    expect(new Set(texts).size).toBe(ALL.length);
  });

  it('marks the alert statuses with role=alert and the calm ones with role=status', () => {
    render(<StatusChip meta={meta('timed_out')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped after 5 s');
    render(<StatusChip meta={meta('empty')} />);
    expect(screen.getByRole('status')).toHaveTextContent('No events matched');
  });

  it('carries the tone class so colour, not only text, separates them', () => {
    const { container: ok } = render(<StatusChip meta={meta('complete')} />);
    const { container: bad } = render(<StatusChip meta={meta('timed_out')} />);
    expect(ok.querySelector('.chip')?.className).toContain('ok');
    expect(bad.querySelector('.chip')?.className).toContain('bad');
  });
});

describe('Chip', () => {
  it('renders children with the given tone', () => {
    const { container } = render(<Chip tone="warn">hello</Chip>);
    expect(container.querySelector('.chip.warn')).toHaveTextContent('hello');
  });
});

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusFooter } from '../src/components/StatusFooter.js';
import { meta } from './fixtures.js';

describe('StatusFooter', () => {
  it('shows the complete chip (with elapsed), the watermark in the project tz and the timezone', () => {
    const { container } = render(<StatusFooter meta={meta('complete')} />);
    const text = container.textContent ?? '';
    expect(text).toContain('● Complete · 0.41 s');
    expect(text).toContain('data until 09:12'); // 03:42Z in Asia/Kolkata
    expect(text).toContain('tz Asia/Kolkata');
  });

  it('shows elapsed as its own segment for a non-complete status', () => {
    const { container } = render(<StatusFooter meta={meta('empty')} />);
    const text = container.textContent ?? '';
    expect(text).toContain('○ No events matched');
    expect(text).toContain('0.41 s');
  });

  it('adds the adjusted-clock, in-progress and merged segments only when non-zero', () => {
    const { container: quiet } = render(<StatusFooter meta={meta('complete')} />);
    expect(quiet.textContent).not.toContain('adjusted clocks');
    expect(quiet.textContent).not.toContain('in progress');
    expect(quiet.textContent).not.toContain('persons merged');

    const { container: loud } = render(
      <StatusFooter meta={meta('complete', { ts_adjusted_share: 0.03, incomplete_buckets: 7, persons_merged_since: 1 })} />,
    );
    expect(loud.textContent).toContain('↺ 3 % of events on adjusted clocks');
    expect(loud.textContent).toContain('◐ 7 buckets in progress');
    expect(loud.textContent).toContain('persons merged since: 1');
  });

  it('omits the watermark segment when data_until is null', () => {
    const { container } = render(<StatusFooter meta={meta('timed_out')} />);
    expect(container.textContent).not.toContain('data until');
  });
});

import type { ResultStatus } from '@vantage/contracts';
import { describe, expect, it } from 'vitest';
import { DECISION_VIEW, statusView } from '../src/lib/status.js';
import { meta } from './fixtures.js';

const ALL: ResultStatus[] = ['complete', 'empty', 'timed_out', 'truncated', 'refused', 'refused_by_database'];

describe('statusView (the §2.3 vocabulary)', () => {
  it('gives every one of the six statuses a distinct symbol and label', () => {
    const symbols = ALL.map((s) => statusView(meta(s)).symbol);
    const labels = ALL.map((s) => statusView(meta(s)).label);
    // symbols may repeat (both refusals use ⊘) but no two statuses share BOTH symbol and label.
    const pairs = ALL.map((s) => `${statusView(meta(s)).symbol} ${statusView(meta(s)).label}`);
    expect(new Set(pairs).size).toBe(ALL.length);
    expect(symbols).toContain('●');
    expect(labels).toContain('No events matched');
  });

  it('puts the elapsed time only in the complete label', () => {
    expect(statusView(meta('complete', { elapsed_ms: 410 })).label).toBe('Complete · 0.41 s');
    expect(statusView(meta('empty')).label).toBe('No events matched');
  });

  it('names the real cap for truncated', () => {
    expect(statusView(meta('truncated', { row_cap: 10_000 })).label).toBe('Showing top 10,000');
  });

  it('marks timed_out and both refusals as alerts, the rest as status', () => {
    expect(statusView(meta('timed_out')).role).toBe('alert');
    expect(statusView(meta('refused')).role).toBe('alert');
    expect(statusView(meta('refused_by_database')).role).toBe('alert');
    expect(statusView(meta('complete')).role).toBe('status');
    expect(statusView(meta('empty')).role).toBe('status');
  });

  it('tones empty as dim and complete as ok, so they never read alike', () => {
    expect(statusView(meta('empty')).tone).toBe('dim');
    expect(statusView(meta('complete')).tone).toBe('ok');
    expect(statusView(meta('timed_out')).tone).toBe('bad');
  });
});

describe('DECISION_VIEW (ask refusals that produced no result)', () => {
  it('covers refused, refused_by_database and error distinctly', () => {
    expect(DECISION_VIEW.refused.title).toBe('Refused');
    expect(DECISION_VIEW.refused_by_database.title).toBe('Refused by the database');
    expect(DECISION_VIEW.error.symbol).toBe('■');
    const titles = [DECISION_VIEW.refused.title, DECISION_VIEW.refused_by_database.title, DECISION_VIEW.error.title];
    expect(new Set(titles).size).toBe(3);
  });
});

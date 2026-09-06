import { describe, expect, it } from 'vitest';
import { formatClock, formatCount, formatDateTime, formatDuration, formatElapsed, formatPercent, formatRatio, toLocalDate } from '../src/lib/format.js';

describe('formatCount', () => {
  it('groups thousands in en-US', () => {
    expect(formatCount(4812)).toBe('4,812');
    expect(formatCount(0)).toBe('0');
  });
  it('is an em dash for a missing or non-finite value, never NaN', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(undefined)).toBe('—');
    expect(formatCount(Number.NaN)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('renders a share to one decimal with a space before the sign', () => {
    expect(formatPercent(6, 13)).toBe('46.2 %');
  });
  it('is an em dash when the whole is zero or missing, never a fabricated 0 %', () => {
    expect(formatPercent(3, 0)).toBe('—');
    expect(formatPercent(3, null)).toBe('—');
    expect(formatPercent(null, 10)).toBe('—');
  });
});

describe('formatRatio', () => {
  it('renders a 0..1 ratio as a percentage', () => {
    expect(formatRatio(0.5)).toBe('50.0 %');
    expect(formatRatio(1)).toBe('100.0 %');
  });
  it('is an em dash for null', () => {
    expect(formatRatio(null)).toBe('—');
  });
});

describe('formatElapsed', () => {
  it('renders milliseconds as seconds to two decimals', () => {
    expect(formatElapsed(410)).toBe('0.41 s');
    expect(formatElapsed(9)).toBe('0.01 s');
  });
  it('is an em dash for a missing value', () => {
    expect(formatElapsed(null)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('shows the two largest non-zero units', () => {
    expect(formatDuration(194_400)).toBe('2 d 6 h');
    expect(formatDuration(3_660)).toBe('1 h 1 m');
    expect(formatDuration(45)).toBe('45 s');
  });
  it('renders exactly zero as 0 s (a real answer) and a negative or missing value as an em dash', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(-1)).toBe('—');
    expect(formatDuration(null)).toBe('—');
  });
});

describe('formatClock / formatDateTime / toLocalDate honour the project timezone', () => {
  const instant = '2026-08-31T03:42:00.000Z'; // 09:12 in Asia/Kolkata (+05:30)
  it('renders the watermark in the project tz, not the runner tz', () => {
    expect(formatClock(instant, 'Asia/Kolkata')).toBe('09:12');
    expect(formatClock(instant, 'UTC')).toBe('03:42');
  });
  it('adds seconds when asked', () => {
    expect(formatClock(instant, 'UTC', true)).toBe('03:42:00');
  });
  it('turns an instant into a local calendar date in the tz', () => {
    expect(toLocalDate('2026-08-31T20:00:00.000Z', 'Asia/Kolkata')).toBe('2026-09-01');
    expect(toLocalDate('2026-08-31T20:00:00.000Z', 'UTC')).toBe('2026-08-31');
  });
  it('renders a full date-time label', () => {
    expect(formatDateTime(instant, 'UTC')).toContain('2026');
    expect(formatDateTime(instant, 'UTC')).toContain('03:42');
  });
  it('is an em dash for a null or unparseable instant', () => {
    expect(formatClock(null, 'UTC')).toBe('—');
    expect(formatClock('not-a-date', 'UTC')).toBe('—');
    expect(toLocalDate(null, 'UTC')).toBeNull();
    expect(formatDateTime(undefined, 'UTC')).toBe('—');
  });
});

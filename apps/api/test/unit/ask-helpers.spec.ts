/**
 * ask-helpers.spec.ts — the two small pure helpers the ask path leans on: today's date in the project timezone (the
 * prompt's `today`), and making model text storable before it reaches the audit log.
 */
import { describe, expect, it } from 'vitest';
import { localDate } from '../../src/modules/ask/ask.service.js';
import { storable } from '../../src/modules/audit/audit.service.js';
import { isIntlTimezone } from '../../src/modules/projects/projects.service.js';

describe('localDate', () => {
  it('is the calendar date in the project timezone, so 18:45Z on Aug 31 is Sep 1 in Asia/Kolkata and Aug 31 in UTC (V5)', () => {
    const instant = new Date('2026-08-31T18:45:00Z');
    expect(localDate(instant, 'Asia/Kolkata')).toBe('2026-09-01');
    expect(localDate(instant, 'UTC')).toBe('2026-08-31');
    expect(localDate(instant, 'Pacific/Apia')).toBe('2026-09-01');
    expect(localDate(instant, 'America/Los_Angeles')).toBe('2026-08-31');
  });

  it('is always YYYY-MM-DD, zero-padded', () => {
    expect(localDate(new Date('2026-01-05T00:00:00Z'), 'UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(localDate(new Date('2026-01-05T00:00:00Z'), 'UTC')).toBe('2026-01-05');
  });

  it('throws RangeError for a zone Intl does not know — which is why the ask path builds the prompt inside its try, and why project creation checks Intl too', () => {
    expect(() => localDate(new Date(), 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});

describe('isIntlTimezone', () => {
  it('accepts IANA zones, rejects nonsense, and rejects at least one name PostgreSQL ships (Factory, posixrules, localtime, leapseconds)', () => {
    expect(isIntlTimezone('Asia/Kolkata')).toBe(true);
    expect(isIntlTimezone('UTC')).toBe(true);
    expect(isIntlTimezone('Mars/Olympus_Mons')).toBe(false);
    expect(isIntlTimezone('')).toBe(false);
    expect(['Factory', 'posixrules', 'localtime', 'leapseconds'].some((z) => !isIntlTimezone(z))).toBe(true);
  });
});

describe('storable', () => {
  it('replaces U+0000 and lone surrogates with U+FFFD and leaves everything else alone', () => {
    expect(storable('a\u0000b')).toBe('a\uFFFDb');
    expect(storable('x\uD800y')).toBe('x\uFFFDy');
    expect(storable('plain “text” — with émoji 🎉')).toBe('plain “text” — with émoji 🎉');
    expect(storable('')).toBe('');
  });
});

/**
 * harness.spec.ts — the test harness points the app at the throwaway database's roles, never at `vantage`.
 */
import { describe, expect, it } from 'vitest';
import { dbOptions } from '../helpers/app.js';

describe('test harness', () => {
  it('dbOptions connects RW as vantage_app and RO as vantage_reader on vantage_test', () => {
    expect(dbOptions().rwUrl).toMatch(/vantage_app.*\/vantage_test$/);
    expect(dbOptions().roUrl).toMatch(/vantage_reader.*\/vantage_test$/);
  });
});

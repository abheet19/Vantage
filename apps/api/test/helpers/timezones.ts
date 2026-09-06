/**
 * timezones.ts (test helper) — a zone name PostgreSQL ships that this Node's `Intl` rejects.
 *
 * Why it exists: `projects.timezone` is checked against `pg_timezone_names` by a CHECK constraint, and the ask path
 * spells "today" with `Intl.DateTimeFormat`; the two authorities disagree on a few names (`Factory`, `posixrules`,
 * `localtime`, `leapseconds`). Two suites need one such name — project creation must refuse it, and a project that
 * already carries one must still be audited — so the lookup lives here rather than in either spec.
 *
 * What it must never do: guess — it reads the live catalog and asks Intl, and fails loudly when the two agree on every candidate.
 */
import { isIntlTimezone } from '../../src/modules/projects/projects.service.js';
import type { TestApp } from './app.js';

export async function intlRejectedZone(t: TestApp): Promise<string> {
  const names = (await t.owner.query<{ name: string }>(`SELECT name FROM pg_timezone_names WHERE name IN ('Factory', 'posixrules', 'localtime', 'leapseconds') ORDER BY name`)).rows.map((r) => r.name);
  const zone = names.find((n) => !isIntlTimezone(n));
  if (!zone) throw new Error(`this PostgreSQL and this Node agree on every candidate zone (${names.join(', ')}); the test needs one they disagree on`);
  return zone;
}

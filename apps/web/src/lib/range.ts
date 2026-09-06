/**
 * range.ts — the default date range a builder seeds from the event catalog's span.
 *
 * Why it exists: a builder should start over the data that exists, so the range runs from the first event
 * to the last. But the grammar caps a range at `QUERY_LIMITS.rangeDays` (366), and a project with an old
 * stray event (the fixture's 2025 view_pricing) would otherwise seed a range the API rejects — every Run
 * a 422 before the screen ever shows a number. So the span is clamped to the most recent 366 days: the
 * `to` is the newest event, the `from` no earlier than 366 days before it.
 *
 * What it must never do: seed a range longer than the grammar allows, or depend on the process timezone
 * (the calendar maths runs on UTC midnights, which is pure).
 */
import type { EventCatalog } from '@vantage/contracts';
import { QUERY_LIMITS, daysBetween } from '@vantage/contracts';
import { toLocalDate } from './format.js';

/** Add (or subtract) whole days to a `YYYY-MM-DD` date, in UTC so it cannot depend on the machine zone. */
function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The catalog's span as two local dates, clamped to the newest `QUERY_LIMITS.rangeDays` so the seeded range is always runnable. */
export function catalogRange(catalog: EventCatalog): { from: string; to: string } {
  const firsts = catalog.events.map((e) => e.first_seen).sort();
  const lasts = catalog.events.map((e) => e.last_seen).sort();
  const to = toLocalDate(lasts[lasts.length - 1], catalog.timezone) ?? '2026-08-31';
  let from = toLocalDate(firsts[0], catalog.timezone) ?? '2026-08-01';
  if (daysBetween(from, to) > QUERY_LIMITS.rangeDays) from = addDays(to, -QUERY_LIMITS.rangeDays);
  return { from, to };
}

/**
 * format.ts — pure formatting helpers for every number and instant the UI shows.
 *
 * Why it exists: 03-UI §2 puts `tabular-nums` on every number and shows elapsed as "0.41 s", the
 * watermark as a wall-clock time in the project timezone, and a median duration as "2 d 6 h". Those are
 * decisions, not incidental `toString()` output, so they live in one tested place: a wrong elapsed or a
 * watermark rendered in the browser's timezone instead of the project's would quietly misinform, which
 * design §1.3 forbids. Everything here is a total function — a null or an unformattable input returns the
 * em dash "—", never a thrown error inside a render.
 */

/** Group digits in en-US so 4812 reads 4,812; a non-finite input is the em dash rather than "NaN". */
export function formatCount(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

/** A share of a whole as "23.7 %"; a zero or missing whole has no honest percentage, so it is "—" (design §1.3: never a fabricated 0 %). */
export function formatPercent(part: number | null | undefined, whole: number | null | undefined): string {
  if (typeof part !== 'number' || typeof whole !== 'number' || !Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return '—';
  return `${((100 * part) / whole).toFixed(1)} %`;
}

/** A ratio already in 0..1 (or null) as a percentage string; used where the API pre-computed the share. */
export function formatRatio(ratio: number | null | undefined): string {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? `${(100 * ratio).toFixed(1)} %` : '—';
}

/** `meta.elapsed_ms` as seconds to two decimals, e.g. 9 → "0.01 s", 410 → "0.41 s" (03-UI §2.3 footer). */
export function formatElapsed(ms: number | null | undefined): string {
  return typeof ms === 'number' && Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : '—';
}

/**
 * A duration in seconds as the two largest non-zero units, "2 d 6 h" / "45 m" / "30 s" (03-UI KPI copy).
 * Median time to convert is a `percentile_cont` result and can be fractional seconds; below a minute it
 * shows whole seconds, and exactly zero is "0 s", not "—" (zero is a real answer here).
 */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== 'number' || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const s = Math.round(totalSeconds);
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  const minutes = Math.floor((s % 3_600) / 60);
  const seconds = s % 60;
  const parts: Array<[number, string]> = [[days, 'd'], [hours, 'h'], [minutes, 'm'], [seconds, 's']];
  const nonZero = parts.filter(([value]) => value > 0);
  if (nonZero.length === 0) return '0 s';
  return nonZero.slice(0, 2).map(([value, unit]) => `${value} ${unit}`).join(' ');
}

/** An ISO instant as HH:MM (optionally HH:MM:SS) in the given IANA timezone; the watermark and history times honour the project tz, never the viewer's (design §1.3). */
export function formatClock(iso: string | null | undefined, timezone: string, withSeconds = false): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      ...(withSeconds ? { second: '2-digit' } : {}),
      hour12: false,
    }).format(date);
  } catch {
    // An IANA zone Intl rejects (projects are validated against it on create, but a hand-set one could slip): fall back to the raw instant rather than throw inside a render.
    return iso;
  }
}

/** An ISO instant as the calendar date "YYYY-MM-DD" in the given timezone; used to seed the funnel's date-range inputs from the catalog's span. */
export function toLocalDate(iso: string | null | undefined, timezone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    // en-CA renders as YYYY-MM-DD, which is exactly the DateRange contract's local-date shape.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return null;
  }
}

/** An ISO instant as "12 Aug 2026, 09:12" in the project tz; used for created-at and last-seen labels. */
export function formatDateTime(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return iso;
  }
}

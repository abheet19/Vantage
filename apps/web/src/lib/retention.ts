/**
 * retention.ts — the pure geometry the retention heatmap trusts, so a cell's colour and its ARIA text are
 * decided in one tested place rather than inside a render.
 *
 * Why it exists: 03-UI §4 puts the heatmap on a GLOBAL sequential scale (`--s0..--s5`), 0–100 %, never a
 * per-row scale that would make two cohorts with the same retention look different. `heatLevel` is that
 * one mapping; `cellAria` is the sentence a screen reader gets (design §5, verbatim shape). A cell with no
 * cohort members has no honest percentage, so it is level 0 and reads "—", never a fabricated 0 % (design
 * §1.3).
 *
 * What it must never do: scale a cell against its own row, or invent a percentage for an empty cohort.
 */
import type { RetentionCell } from '@vantage/contracts';

/** 0..5 on the global 0–100 % scale; a null (empty-cohort) percentage is the lowest level and shows as "—". */
export function heatLevel(pct: number | null): number {
  if (pct === null || !Number.isFinite(pct)) return 0;
  return Math.max(0, Math.min(5, Math.floor(pct * 6)));
}

/** The compact number a cell shows: the retained percentage as a whole number, or "—" for an empty cohort. */
export function cellText(cell: Pick<RetentionCell, 'pct'>): string {
  return cell.pct === null || !Number.isFinite(cell.pct) ? '—' : `${Math.round(cell.pct * 100)}`;
}

/** "Aug 12 cohort, day 3: 41 % (in progress)" (03-UI §5) — the label every cell carries for a screen reader. */
export function cellAria(bucketLabel: string, unit: string, n: number, cell: RetentionCell): string {
  const pct = cell.pct === null ? 'no members' : `${Math.round(cell.pct * 100)} %`;
  const period = n === 0 ? `${unit} 0` : `${unit} ${n}`;
  return `${bucketLabel} cohort, ${period}: ${pct}${cell.in_progress ? ' (in progress)' : ''}`;
}

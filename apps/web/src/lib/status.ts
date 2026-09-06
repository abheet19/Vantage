/**
 * status.ts — the §2.3 status vocabulary as data, so every number in the UI wears the same voice.
 *
 * Why it exists: design §1.3 and the build prompt's "honest degradation" rule say `empty`, `timed_out`
 * and a real error must never render the same, and each of the six `ResultMeta.status` values has one
 * fixed symbol, tone, ARIA role and copy in 03-UI §2.3. Encoding that once — rather than in each screen
 * — is what makes the rule enforceable and testable (the status-chip test asserts all six render
 * distinctly). `refused` and `timed_out` are alerts (§3 of 03-UI); the rest are polite status regions.
 *
 * What it must never do: invent a status outside the six, or let a partial result borrow the `complete`
 * voice — the label for `complete` is the only one that carries a number (the elapsed time).
 */
import type { AskDecision, ResultMeta, ResultStatus } from '@vantage/contracts';
import { formatElapsed } from './format.js';

export type Tone = 'ok' | 'warn' | 'bad' | 'dim' | 'faint' | 'info';

export interface StatusView {
  /** The leading glyph, part of the §2.3 chip text. */
  symbol: string;
  tone: Tone;
  /** `alert` for the two states a reader must not miss (`timed_out`, both refusals); `status` otherwise. */
  role: 'status' | 'alert';
  /** The chip text after the symbol; only `complete` carries the elapsed number. */
  label: string;
  /** The sentence a card shows beneath the chip (empty for `complete`, which needs no card). */
  detail: string;
}

/** The fixed part of each status: symbol, tone, role, detail sentence (03-UI §2.3, copy verbatim). */
const VOCAB: Record<ResultStatus, Omit<StatusView, 'label'> & { label: string }> = {
  complete: { symbol: '●', tone: 'ok', role: 'status', label: 'Complete', detail: '' },
  empty: { symbol: '○', tone: 'dim', role: 'status', label: 'No events matched', detail: 'No events matched these steps in this range.' },
  timed_out: { symbol: '■', tone: 'bad', role: 'alert', label: 'Stopped after 5 s', detail: 'Showing nothing rather than a partial answer. Narrow the date range or add a filter.' },
  truncated: { symbol: '▤', tone: 'warn', role: 'status', label: 'Showing top rows', detail: 'More rows than the cap; showing the first, whole groups only.' },
  refused: { symbol: '⊘', tone: 'bad', role: 'alert', label: 'Refused', detail: 'The model’s output is not a query the grammar can express.' },
  refused_by_database: { symbol: '⊘', tone: 'bad', role: 'alert', label: 'Refused by the database', detail: 'This should be impossible; it has been logged as a bug.' },
};

/** The chip/card view for a result's status; `complete` gains its elapsed number and `truncated` its real cap. */
export function statusView(meta: ResultMeta): StatusView {
  const base = VOCAB[meta.status];
  if (meta.status === 'complete') return { ...base, label: `Complete · ${formatElapsed(meta.elapsed_ms)}` };
  if (meta.status === 'truncated') return { ...base, label: `Showing top ${meta.row_cap.toLocaleString('en-US')}` };
  return base;
}

/** The refusal/error view for an ask `decision` that produced no result — the query card renders a card, not a footer. */
export interface DecisionView {
  symbol: string;
  tone: Tone;
  title: string;
  detail: string;
}

export const DECISION_VIEW: Record<Exclude<AskDecision, 'ran'>, DecisionView> = {
  refused: { symbol: '⊘', tone: 'bad', title: 'Refused', detail: 'The model’s output is not a query the grammar can express.' },
  refused_by_database: { symbol: '⊘', tone: 'bad', title: 'Refused by the database', detail: 'This should be impossible; it has been logged as a bug.' },
  error: { symbol: '■', tone: 'bad', title: 'Something went wrong', detail: 'The model, the catalog read or the database failed before a number existed.' },
};

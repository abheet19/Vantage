/**
 * Chip.tsx — the §2.3 status chip, one component wherever a number's trustworthiness is shown.
 *
 * Why it exists: 03-UI §2.3 makes the chip the shared voice for status, and §5 requires word + icon +
 * colour together with `role="status"` normally and `role="alert"` for the states a reader must not miss.
 * `StatusChip` reads its symbol, tone, role and label from `statusView`, so all six statuses render
 * distinctly by construction (the unit test asserts it). `Chip` is the same shell for the secondary chips
 * (a model label, adjusted-clock share) that are not one of the six.
 */
import type { JSX, ReactNode } from 'react';
import type { ResultMeta } from '@vantage/contracts';
import { statusView, type Tone } from '../lib/status.js';

export function Chip({ tone = 'dim', role, title, children }: { tone?: Tone; role?: 'status' | 'alert'; title?: string; children: ReactNode }): JSX.Element {
  return (
    <span className={`chip ${tone}`} {...(role ? { role } : {})} {...(title ? { title } : {})}>
      {children}
    </span>
  );
}

export function StatusChip({ meta }: { meta: ResultMeta }): JSX.Element {
  const view = statusView(meta);
  return (
    <Chip tone={view.tone} role={view.role}>
      {view.symbol} {view.label}
    </Chip>
  );
}

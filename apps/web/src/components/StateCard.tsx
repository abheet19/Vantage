/**
 * StateCard.tsx — the empty / timeout / refused / error / no-data cards (03-UI §3.1 S9, §12).
 *
 * Why it exists: the build prompt's honest-degradation rule needs empty, timed-out and error to be three
 * visibly different things. This is the one card that renders all of them, driven by `variant`, so they
 * share structure but never a rendering: `empty` is a dashed, calm, grey card with a ring; `timeout` and
 * `refused`/`error` are bordered red with `role="alert"`; a refusal shows the model's raw output beneath.
 *
 * What it must never do: render `empty` and `error` with the same border/tone — that is the exact
 * confusion design §1.3 forbids.
 */
import type { JSX, ReactNode } from 'react';
import { Icon, type IconName } from './Icons.js';

export type StateVariant = 'empty' | 'timeout' | 'refused' | 'error';

export function StateCard({
  variant,
  title,
  chip,
  icon,
  children,
  raw,
  actions,
}: {
  variant: StateVariant;
  title: string;
  chip?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
  raw?: { heading: string; text: string };
  actions?: ReactNode;
}): JSX.Element {
  const role = variant === 'empty' ? 'status' : 'alert';
  return (
    <div className={`card-state ${variant}`} role={role} data-testid={`state-${variant}`}>
      <div className="t">
        {variant === 'empty' ? <span className="ring">○</span> : icon ? <Icon name={icon} style={{ color: 'var(--bad)' }} /> : null}
        <h2>{title}</h2>
        {chip}
      </div>
      {children && <p>{children}</p>}
      {raw && (
        <div className="raw">
          <h3>{raw.heading}</h3>
          <pre>{raw.text}</pre>
        </div>
      )}
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

/** The result-panel loading state (03-UI §3.1: skeletons for result panels only, never for the query card). */
export function Skeleton(): JSX.Element {
  return (
    <div className="skel" data-testid="skeleton" aria-hidden="true">
      <i className="h" />
      <i className="h w80" />
      <i className="h w60" />
      <i className="w40" />
    </div>
  );
}

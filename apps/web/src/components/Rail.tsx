/**
 * Rail.tsx — the left navigation rail (glass, 68 px collapsed / 206 px expanded), matched to vantage.html.
 *
 * The approved artifact renders the seven analysis/history screens in the body and folds a single Settings
 * entry plus the Collapse control into a footer group; the current page is marked with an accent-soft pill
 * and an amber icon (not a left bar). Every route still comes from `routes.ts`, so there is no entry that
 * leads nowhere. The brand is the artifact's inline amber rounded-square chevron.
 */
import { Fragment, type JSX } from 'react';
import { ROUTES, type RouteId } from '../routes.js';
import { Icon, type IconName } from './Icons.js';

const SETTINGS_ID: RouteId = 'settings';
const BODY_ROUTES = ROUTES.filter((r) => r.id !== SETTINGS_ID);
const SETTINGS_ROUTE = ROUTES.find((r) => r.id === SETTINGS_ID)!;
// The three folded screens all light the Settings entry.
const SETTINGS_ACTIVE = new Set<RouteId>(['settings', 'projects', 'mcp', 'health']);

export function Rail({ route, navigate, open, onToggle }: { route: RouteId; navigate: (id: RouteId) => void; open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <nav className="rail glass" aria-label="Screens">
      <button className="brand rail-mark" onClick={onToggle} title={open ? 'Collapse rail' : 'Expand rail'} aria-label="Toggle rail">
        <svg className="mark" width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="24" height="24" rx="7" fill="var(--accent)" />
          <path d="M7 8.5L13 18.5L19 8.5" stroke="var(--accent-ink)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 18.5V8.5" stroke="var(--accent-ink)" strokeWidth="2.1" strokeLinecap="round" opacity="0.55" />
        </svg>
        <b className="word lbl">Vantage</b>
      </button>

      {BODY_ROUTES.map((r) => (
        <Fragment key={r.id}>
          <button
            className="nav rail-item"
            onClick={() => navigate(r.id)}
            title={`${r.label} (${r.key})`}
            {...(route === r.id ? { 'aria-current': 'page' as const } : {})}
          >
            <Icon name={r.icon as IconName} />
            <span className="lbl label">{r.label}</span>
            <span className="key kbd">{r.key}</span>
          </button>
        </Fragment>
      ))}

      <div className="spacer rail-spacer" />
      <div className="rail-foot">
        <button
          className="nav rail-item"
          onClick={() => navigate(SETTINGS_ROUTE.id)}
          title={`${SETTINGS_ROUTE.label} (${SETTINGS_ROUTE.key})`}
          {...(SETTINGS_ACTIVE.has(route) ? { 'aria-current': 'page' as const } : {})}
        >
          <Icon name={SETTINGS_ROUTE.icon as IconName} />
          <span className="lbl label">{SETTINGS_ROUTE.label}</span>
          <span className="key kbd">{SETTINGS_ROUTE.key}</span>
        </button>
        <button className="nav rail-item" onClick={onToggle} title={open ? 'Collapse rail' : 'Expand rail'}>
          <Icon name="i-menu" />
          <span className="lbl label">Collapse</span>
        </button>
      </div>
    </nav>
  );
}

/**
 * Rail.tsx — the left navigation rail (glass, 64 px collapsed / 220 px expanded), ported from the prototype §4.
 *
 * Why it exists: 03-UI §4 puts the screens in a glass rail with keyboard numbers and a current-page
 * marker. It renders exactly the routes this slice ships (routes.ts), so there is no entry that leads
 * nowhere. The brand button and the footer button both toggle the rail's width.
 */
import type { JSX } from 'react';
import { ROUTES, type RouteId } from '../routes.js';
import { Icon, type IconName } from './Icons.js';

export function Rail({ route, navigate, open, onToggle }: { route: RouteId; navigate: (id: RouteId) => void; open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <nav className="rail glass" aria-label="Screens">
      <button className="brand" onClick={onToggle} title={open ? 'Collapse rail' : 'Expand rail'} aria-label="Toggle rail">
        <span className="mark">
          <Icon name="i-ask" />
        </span>
        <b className="lbl">Vantage</b>
      </button>
      {ROUTES.map((r) => (
        <button
          key={r.id}
          className="nav"
          onClick={() => navigate(r.id)}
          title={`${r.label} (${r.key})`}
          {...(route === r.id ? { 'aria-current': 'page' as const } : {})}
        >
          <Icon name={r.icon as IconName} />
          <span className="lbl">{r.label}</span>
          <span className="key lbl">{r.key}</span>
        </button>
      ))}
      <div className="spacer" />
      <button className="nav" onClick={onToggle} title={open ? 'Collapse rail' : 'Expand rail'}>
        <Icon name="i-menu" />
        <span className="lbl">Collapse</span>
      </button>
    </nav>
  );
}

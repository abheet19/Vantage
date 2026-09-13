/**
 * Rail.tsx — the left navigation rail (glass, 64 px collapsed / 220 px expanded), ported from the prototype §4.
 *
 * Why it exists: 03-UI §4 puts the screens in a glass rail with keyboard numbers and a current-page
 * marker. It renders exactly the routes this slice ships (routes.ts), so there is no entry that leads
 * nowhere. The brand button and the footer button both toggle the rail's width.
 *
 * GLASS REDESIGN: a hairline `.sep` (already defined in app.css, previously unused) now separates the
 * seven analysis/history screens from the three configuration ones (Projects, MCP, Health) — a purely
 * visual grouping, not a route change, so every route, title and keyboard number is exactly as before. The
 * footer also carries a small ecosystem link to github.com/abheet19, the standing home for every project
 * in this portfolio (Vantage included).
 */
import { Fragment, type JSX } from 'react';
import { ROUTES, type RouteId } from '../routes.js';
import { Icon, type IconName } from './Icons.js';

const SEP_BEFORE: RouteId = 'projects';

export function Rail({ route, navigate, open, onToggle }: { route: RouteId; navigate: (id: RouteId) => void; open: boolean; onToggle: () => void }): JSX.Element {
  return (
    <nav className="rail glass" aria-label="Screens">
      <button className="brand" onClick={onToggle} title={open ? 'Collapse rail' : 'Expand rail'} aria-label="Toggle rail">
        <img className="mark" src="/brand/mark.svg" alt="" />
        <b className="lbl">Vantage</b>
      </button>
      {ROUTES.map((r) => (
        <Fragment key={r.id}>
          {r.id === SEP_BEFORE && <div className="sep" aria-hidden="true" />}
          <button
            className="nav"
            onClick={() => navigate(r.id)}
            title={`${r.label} (${r.key})`}
            {...(route === r.id ? { 'aria-current': 'page' as const } : {})}
          >
            <Icon name={r.icon as IconName} />
            <span className="lbl">{r.label}</span>
            <span className="key lbl">{r.key}</span>
          </button>
        </Fragment>
      ))}
      <div className="spacer" />
      <a
        className="nav ecosystem"
        href="https://github.com/abheet19"
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Vantage is part of the abheet19 project ecosystem — open GitHub"
        title="Part of the abheet19 ecosystem"
      >
        <Icon name="i-merge" />
        <span className="lbl">abheet19</span>
      </a>
      <button className="nav" onClick={onToggle} title={open ? 'Collapse rail' : 'Expand rail'}>
        <Icon name="i-menu" />
        <span className="lbl">Collapse</span>
      </button>
    </nav>
  );
}

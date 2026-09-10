/**
 * App.tsx — the shell: ground glows, glass rail, glass command bar, and the current screen (03-UI §4).
 *
 * Why it exists: it ports the prototype's app shell (the L0 ground, the L2 rail and command bar, the L1
 * main) and switches the ten screens on the hash route. Keyboard 1–9 and 0 jump screens (03-UI §4; the
 * tenth screen takes 0), ignored while typing in a field. The rail's open/collapsed width is remembered.
 */
import { lazy, Suspense, useEffect, useState, type ComponentType, type JSX } from 'react';
import { CommandBar } from './components/CommandBar.js';
import { IconSprite } from './components/Icons.js';
import { Rail } from './components/Rail.js';
import { useHashRoute } from './lib/router.js';
import { ROUTES, type RouteId } from './routes.js';
import { AskView } from './views/AskView.js';

// Ask owns the first meaningful paint; secondary views load only when their route is selected.
const routeView = <T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T) =>
  lazy(async () => ({ default: (await load())[name] }));

const VIEWS: Record<RouteId, ComponentType> = {
  ask: AskView,
  funnel: routeView(() => import('./views/FunnelView.js'), 'FunnelView'),
  retention: routeView(() => import('./views/RetentionView.js'), 'RetentionView'),
  paths: routeView(() => import('./views/PathsView.js'), 'PathsView'),
  trend: routeView(() => import('./views/TrendView.js'), 'TrendView'),
  events: routeView(() => import('./views/EventsView.js'), 'EventsView'),
  history: routeView(() => import('./views/HistoryView.js'), 'HistoryView'),
  projects: routeView(() => import('./views/ProjectsView.js'), 'ProjectsView'),
  mcp: routeView(() => import('./views/McpView.js'), 'McpView'),
  health: routeView(() => import('./views/HealthView.js'), 'HealthView'),
};

const RAIL_KEY = 'vantage.rail-open';

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function App(): JSX.Element {
  const { route, navigate } = useHashRoute();
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, railOpen ? '1' : '0');
    } catch {
      // storage disabled: the rail state just does not persist.
    }
  }, [railOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const match = ROUTES.find((r) => r.key === e.key);
      if (match) {
        e.preventDefault();
        navigate(match.id);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const CurrentView = VIEWS[route];

  return (
    <>
      <IconSprite />
      <div className="ground" aria-hidden="true" />
      <div className={`app${railOpen ? ' rail-open' : ''}`}>
        <Rail route={route} navigate={navigate} open={railOpen} onToggle={() => setRailOpen((o) => !o)} />
        <CommandBar />
        <main className="main" id="main">
          <Suspense fallback={<div className="screen" aria-busy="true" aria-label="Loading view" />}>
            <CurrentView />
          </Suspense>
        </main>
      </div>
    </>
  );
}

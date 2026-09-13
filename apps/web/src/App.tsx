/**
 * App.tsx — the shell: ground glows, glass rail, glass command bar, and the current screen (03-UI §4).
 *
 * Why it exists: it ports the prototype's app shell (the L0 ground, the L2 rail and command bar, the L1
 * main) and switches the ten screens on the hash route. Keyboard 1–9 and 0 jump screens (03-UI §4; the
 * tenth screen takes 0), ignored while typing in a field. The rail's open/collapsed width is remembered.
 *
 * GLASS REDESIGN ADDITIONS: a Ctrl/Cmd+K command palette (searchable navigation over the same `ROUTES`
 * the rail renders, plus two state-free actions) and a small toast region for transient feedback (project
 * switch, palette actions). Both are owned here, once, so nothing downstream keeps a second copy of
 * palette-open or toast state that could drift from this one.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type JSX } from 'react';
import { CommandBar } from './components/CommandBar.js';
import { CommandPalette } from './components/CommandPalette.js';
import { Icon, IconSprite } from './components/Icons.js';
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
let toastSeq = 0;

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<ReadonlyArray<{ id: number; message: string }>>([]);
  const toastTimers = useRef(new Set<number>());

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

  // Ctrl/Cmd+K opens the command palette from anywhere, including while a field has focus; Escape closes
  // it. Both are independent of the digit-shortcut listener above, which already bails on a held modifier.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A tiny, dependency-free toast: text-only feedback (no interactive control lives inside a toast), so it
  // never competes with the shell's own controls for keyboard focus or an accessible name.
  const toast = useCallback((message: string) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, message }]);
    const timer = window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      toastTimers.current.delete(timer);
    }, 2400);
    toastTimers.current.add(timer);
  }, []);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const CurrentView = VIEWS[route];

  return (
    <>
      <IconSprite />
      <div className="ground" aria-hidden="true" />
      <div className={`app${railOpen ? ' rail-open' : ''}`}>
        <Rail route={route} navigate={navigate} open={railOpen} onToggle={() => setRailOpen((o) => !o)} />
        <CommandBar onOpenPalette={() => setPaletteOpen(true)} toast={toast} />
        <main className="main" id="main">
          <Suspense fallback={<div className="screen" aria-busy="true" aria-label="Loading view" />}>
            <CurrentView />
          </Suspense>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} navigate={navigate} toast={toast} />
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className="toast glass" key={t.id}>
            <Icon name="i-check" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * SettingsView.tsx — Workspace settings, the parts of Vantage configured once (03-UI glass-redesign match).
 *
 * Why it exists: the approved artifact folds the three configuration screens — Projects & ingest, MCP and
 * Health — behind a single Settings rail entry with an internal three-tab sub-nav. This is that shell. It
 * mounts the real `ProjectsView`, `McpView` and `HealthView` unchanged, so every route, form action, API
 * call and data flow those screens carry is preserved; the tabs simply choose which one is shown. Each tab
 * is a first-class route (`#/projects`, `#/mcp`, `#/health`), so deep links, the rail's Settings entry and
 * the command palette all resolve to the right pane, and the browser back button works.
 */
import { type JSX, lazy, Suspense } from 'react';
import { useHashRoute } from '../lib/router.js';
import { SETTINGS_TABS, type RouteId, type SettingsTabId } from '../routes.js';

const ProjectsView = lazy(async () => ({ default: (await import('./ProjectsView.js')).ProjectsView }));
const McpView = lazy(async () => ({ default: (await import('./McpView.js')).McpView }));
const HealthView = lazy(async () => ({ default: (await import('./HealthView.js')).HealthView }));

function activeTab(route: RouteId): SettingsTabId {
  return SETTINGS_TABS.some((t) => t.id === route) ? (route as SettingsTabId) : 'projects';
}

export function SettingsView(): JSX.Element {
  const { route, navigate } = useHashRoute();
  const tab = activeTab(route);

  return (
    <section className="screen" aria-labelledby="h-settings">
      <div className="screen-head">
        <div>
          <span className="eyebrow">08 · Settings</span>
          <h1 id="h-settings">Workspace settings</h1>
          <p>Projects, the MCP tool set, and system health — the parts of Vantage you configure once and rarely open again.</p>
        </div>
      </div>

      <div className="panel glass settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {SETTINGS_TABS.map((t) => (
            <button key={t.id} onClick={() => navigate(t.id)} {...(t.id === tab ? { 'aria-current': 'true' as const } : {})}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <Suspense fallback={<div className="skel" aria-busy="true"><i className="h" /><i className="h w80" /><i className="w40" /></div>}>
            {tab === 'projects' && <ProjectsView />}
            {tab === 'mcp' && <McpView />}
            {tab === 'health' && <HealthView />}
          </Suspense>
        </div>
      </div>
    </section>
  );
}

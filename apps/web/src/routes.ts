/**
 * routes.ts — the screens the SPA ships, in rail order, each with its keyboard number and icon.
 *
 * GLASS REDESIGN "vantage.html" MATCH: the rail now shows EIGHT items — the seven analysis/history
 * screens (Ask…History, keys 1–7) and a single Settings screen (key 0) — matching the approved artifact.
 * Settings folds the three configuration screens (Projects & ingest, MCP, Health) behind an internal
 * three-tab sub-nav, so no feature, route or backend wiring is lost: `projects`, `mcp` and `health` remain
 * first-class route ids (deep links, cross-links and the command palette still resolve them), each rendered
 * inside the Settings shell with its tab pre-selected. `ROUTES` is what the rail renders; `SETTINGS_TABS`
 * is what the Settings sub-nav renders; `ROUTE_IDS` (both sets) is what the router validates.
 */
export const ROUTES = [
  { id: 'ask', label: 'Ask', icon: 'i-ask', key: '1' },
  { id: 'funnel', label: 'Funnel', icon: 'i-funnel', key: '2' },
  { id: 'retention', label: 'Retention', icon: 'i-ret', key: '3' },
  { id: 'paths', label: 'Paths', icon: 'i-paths', key: '4' },
  { id: 'trend', label: 'Trend', icon: 'i-trend', key: '5' },
  { id: 'events', label: 'Events', icon: 'i-events', key: '6' },
  { id: 'history', label: 'History', icon: 'i-hist', key: '7' },
  { id: 'settings', label: 'Settings', icon: 'i-cog', key: '0' },
] as const;

/** The three configuration screens folded into Settings, in sub-nav order; each is still its own route id. */
export const SETTINGS_TABS = [
  { id: 'projects', label: 'Projects & ingest' },
  { id: 'mcp', label: 'MCP' },
  { id: 'health', label: 'Health' },
] as const;

export type RailRouteId = (typeof ROUTES)[number]['id'];
export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];
export type RouteId = RailRouteId | SettingsTabId;

const IDS = new Set<string>([...ROUTES.map((r) => r.id), ...SETTINGS_TABS.map((t) => t.id)]);
const DEFAULT_ROUTE: RouteId = 'ask';

/** True when the route is one of the three screens folded into Settings. */
export function isSettingsRoute(id: RouteId): id is SettingsTabId {
  return SETTINGS_TABS.some((t) => t.id === id);
}

/** The route named by a location hash (`#/funnel` → `funnel`), or the default when it names nothing this slice ships. */
export function routeFromHash(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '');
  return IDS.has(id) ? (id as RouteId) : DEFAULT_ROUTE;
}

/**
 * routes.ts — the screens the SPA ships, in rail order, each with its keyboard number and icon.
 *
 * Why it exists: 03-UI §4 gives the left rail its screens and keyboard numbers. S6 added Retention, Paths
 * and Trend to the six S5 shipped; S8 adds MCP — the last 03-UI screen, deferred from S5 — so the rail now
 * holds all ten in the design's order (Ask, Funnel, Retention, Paths, …, MCP, Health) with Trend beside its
 * sibling builders. Ten screens exceed the digits 1–9, so Health takes `0` (the last key on the row); every
 * entry has a screen behind it, and this list is the single source the rail renders and the router validates.
 */
export const ROUTES = [
  { id: 'ask', label: 'Ask', icon: 'i-ask', key: '1' },
  { id: 'funnel', label: 'Funnel', icon: 'i-funnel', key: '2' },
  { id: 'retention', label: 'Retention', icon: 'i-ret', key: '3' },
  { id: 'paths', label: 'Paths', icon: 'i-paths', key: '4' },
  { id: 'trend', label: 'Trend', icon: 'i-trend', key: '5' },
  { id: 'events', label: 'Events', icon: 'i-events', key: '6' },
  { id: 'history', label: 'History', icon: 'i-hist', key: '7' },
  { id: 'projects', label: 'Projects', icon: 'i-proj', key: '8' },
  { id: 'mcp', label: 'MCP', icon: 'i-mcp', key: '9' },
  { id: 'health', label: 'Health', icon: 'i-health', key: '0' },
] as const;

export type RouteId = (typeof ROUTES)[number]['id'];

const IDS = new Set<string>(ROUTES.map((r) => r.id));
const DEFAULT_ROUTE: RouteId = 'ask';

/** The route named by a location hash (`#/funnel` → `funnel`), or the default when it names nothing this slice ships. */
export function routeFromHash(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, '');
  return IDS.has(id) ? (id as RouteId) : DEFAULT_ROUTE;
}

/**
 * router.ts — a hash router in one hook, so the SPA needs no routing dependency (LLD §8 S5: "a tiny hash router").
 *
 * Why it exists: the six screens are switched by `location.hash`; `useHashRoute` reads it, subscribes to
 * `hashchange`, and hands back a `navigate` that sets it. Deep links and the back button work for free,
 * and Playwright can drive the app by URL.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { type RouteId, routeFromHash } from '../routes.js';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useHashRoute(): { route: RouteId; navigate: (id: RouteId) => void } {
  const route = useSyncExternalStore(subscribe, () => routeFromHash(window.location.hash));
  const navigate = useCallback((id: RouteId) => {
    window.location.hash = `#/${id}`;
  }, []);
  return { route, navigate };
}

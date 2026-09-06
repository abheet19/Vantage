/**
 * hooks.ts — the read hooks for the catalog, ask history and health, with loading/error/reload state.
 *
 * Why it exists: Events, Funnel, History and Health all follow the same shape — fetch once per project (or
 * once), show a skeleton while loading, an error card with the real message on failure, and a Retry that
 * re-fetches. `useResource` is that shape in one place; the three named hooks bind it to the client calls.
 * Failures are `ApiError`, so a 503 `TIMED_OUT`/`BUSY` from a slow read renders as an error state distinct
 * from an empty one (design §1.3).
 */
import { useCallback, useEffect, useState } from 'react';
import type { AskRow, EventCatalog } from '@vantage/contracts';
import { ApiError, api, type HealthReport } from '../api/client.js';

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
}

function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[]): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    load(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(err instanceof ApiError ? err : new ApiError('network', 'the request failed'));
        setLoading(false);
      });
    return () => controller.abort();
    // `load` closes over exactly `deps`, which the caller lists; re-running keys on those plus the reload nonce.
  }, [nonce, ...deps]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

export function useCatalog(projectId: string): Resource<EventCatalog> {
  return useResource(() => api.catalog(projectId), [projectId]);
}

export function useAsks(projectId: string): Resource<AskRow[]> {
  return useResource(() => api.asks(projectId), [projectId]);
}

export function useHealth(): Resource<HealthReport> {
  return useResource(() => api.health(), []);
}

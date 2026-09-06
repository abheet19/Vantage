/**
 * ProjectContext.tsx — the selected project, shared by the command bar and every view.
 *
 * Why it exists: the query routes take a `project` uuid (there is no auth on them — the API is loopback,
 * design A4/D4), so the SPA must know which project it is asking about. This loads `GET /v1/projects`
 * once, remembers the choice in `localStorage`, and hands views the current project (its id and, crucially,
 * its timezone, which every footer and clock is rendered in). The load state is exposed so first-run —
 * no projects yet — points the user at the Projects screen instead of a broken Ask box (03-UI S9).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import type { ProjectRow } from '@vantage/contracts';
import { ApiError, api } from '../api/client.js';

interface ProjectState {
  projects: ProjectRow[];
  current: ProjectRow | null;
  loading: boolean;
  error: ApiError | null;
  selectProject: (id: string) => void;
  reload: () => void;
}

const Context = createContext<ProjectState | null>(null);
const STORAGE_KEY = 'vantage.project';

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function ProjectProvider({ children }: { children: ReactNode }): JSX.Element {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => readStored());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    api
      .listProjects()
      .then((rows) => {
        if (!live) return;
        setProjects(rows);
        setCurrentId((id) => (id && rows.some((r) => r.project_id === id) ? id : (rows[0]?.project_id ?? null)));
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof ApiError ? err : new ApiError('network', 'could not load projects'));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  const selectProject = useCallback((id: string) => {
    setCurrentId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // A private window with storage disabled: the choice simply does not persist across reloads.
    }
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const current = useMemo(() => projects.find((p) => p.project_id === currentId) ?? null, [projects, currentId]);
  const value = useMemo<ProjectState>(() => ({ projects, current, loading, error, selectProject, reload }), [projects, current, loading, error, selectProject, reload]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProject(): ProjectState {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useProject must be used within a ProjectProvider');
  return ctx;
}

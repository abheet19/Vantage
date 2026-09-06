import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAsks, useCatalog, useHealth } from '../src/lib/hooks.js';
import { CATALOG, jsonResponse, stubFetch } from './net.js';

afterEach(() => vi.unstubAllGlobals());

describe('useCatalog', () => {
  it('loads the catalog and clears the loading flag', async () => {
    stubFetch({ '/v1/events/catalog': () => jsonResponse(CATALOG) });
    const { result } = renderHook(() => useCatalog(CATALOG.project));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.events).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a 503 as an ApiError, not as empty data', async () => {
    stubFetch({ '/v1/events/catalog': () => jsonResponse({ code: 'TIMED_OUT', message: 'the read timed out' }, 503) });
    const { result } = renderHook(() => useCatalog(CATALOG.project));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();
    expect(result.current.error?.message).toContain('timed out');
  });

  it('reload re-fetches', async () => {
    const fetchMock = stubFetch({ '/v1/events/catalog': () => jsonResponse(CATALOG) });
    const { result } = renderHook(() => useCatalog(CATALOG.project));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    act(() => result.current.reload());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('ignores a response that arrives after the hook has unmounted (aborts in flight)', async () => {
    let resolve: (r: Response) => void = () => undefined;
    stubFetch({ '/v1/events/catalog': () => new Promise<Response>((r) => (resolve = r)) });
    const { result, unmount } = renderHook(() => useCatalog(CATALOG.project));
    expect(result.current.loading).toBe(true);
    unmount();
    resolve(jsonResponse(CATALOG));
    await Promise.resolve();
    // no assertion on state after unmount — the point is the aborted guard runs and nothing throws.
  });
});

describe('useAsks', () => {
  it('loads the ask history', async () => {
    stubFetch({ '/v1/asks': () => jsonResponse([]) });
    const { result } = renderHook(() => useAsks(CATALOG.project));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual([]);
  });
});

describe('useHealth', () => {
  it('loads the health report', async () => {
    stubFetch({ '/health': () => jsonResponse({ ok: true, pools: { rw: 'up', ro: 'up' }, migration: { version: 4 }, self_test: { ok: true } }) });
    const { result } = renderHook(() => useHealth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.ok).toBe(true);
  });
});

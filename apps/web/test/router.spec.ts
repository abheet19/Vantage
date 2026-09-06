import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useHashRoute } from '../src/lib/router.js';

beforeEach(() => {
  window.location.hash = '';
});

describe('useHashRoute', () => {
  it('defaults to ask when the hash names nothing the app ships', () => {
    window.location.hash = '#/nonesuch';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe('ask');
  });

  it('resolves the MCP screen (S8 shipped the last deferred 03-UI screen)', () => {
    window.location.hash = '#/mcp';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe('mcp');
  });

  it('resolves an S6 screen the app now ships', () => {
    window.location.hash = '#/paths';
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe('paths');
  });

  it('navigates by setting the hash and reflects the change', async () => {
    const { result } = renderHook(() => useHashRoute());
    expect(result.current.route).toBe('ask');
    act(() => result.current.navigate('funnel'));
    expect(window.location.hash).toBe('#/funnel');
    await waitFor(() => expect(result.current.route).toBe('funnel'));
  });
});

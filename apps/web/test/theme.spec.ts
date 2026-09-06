import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTheme } from '../src/lib/theme.js';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-flat');
});
afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-flat');
});

describe('useTheme', () => {
  it('writes data-theme on mount and flips it on toggle', () => {
    const { result } = renderHook(() => useTheme());
    const first = document.documentElement.getAttribute('data-theme');
    expect(first).toBe('dark'); // jsdom has no matchMedia match, so the default is dark
    act(() => result.current.toggleTheme());
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('vantage.theme')).toBe('light');
  });

  it('sets and clears data-flat on the reduce-transparency toggle', () => {
    const { result } = renderHook(() => useTheme());
    expect(document.documentElement.hasAttribute('data-flat')).toBe(false);
    act(() => result.current.toggleFlat());
    expect(document.documentElement.getAttribute('data-flat')).toBe('1');
    act(() => result.current.toggleFlat());
    expect(document.documentElement.hasAttribute('data-flat')).toBe(false);
  });
});

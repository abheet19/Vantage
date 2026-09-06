/**
 * Icons.tsx — the 16 px / 1.5 px-stroke icon sprite, ported from docs/prototype/vantage.html, trimmed to
 * the symbols the shipped screens use (S8 adds i-mcp for the MCP screen/rail and i-merge for the identity
 * notice). `IconSprite` is rendered once at the app root; `Icon` references a symbol by name, exactly as
 * the prototype's `<svg class="i"><use href="#…"/></svg>`.
 */
import type { JSX } from 'react';

export type IconName =
  | 'i-ask' | 'i-funnel' | 'i-ret' | 'i-paths' | 'i-trend' | 'i-events' | 'i-hist' | 'i-proj' | 'i-health' | 'i-menu'
  | 'i-copy' | 'i-play' | 'i-edit' | 'i-chev' | 'i-chevd' | 'i-x' | 'i-check'
  | 'i-warn' | 'i-info' | 'i-eye' | 'i-lock' | 'i-rotate' | 'i-sun' | 'i-db' | 'i-plus' | 'i-mcp' | 'i-merge';

export function Icon({ name, className = 'i', style }: { name: IconName; className?: string; style?: JSX.IntrinsicElements['svg']['style'] }): JSX.Element {
  return (
    <svg className={className} style={style} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}

export function IconSprite(): JSX.Element {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-ask" viewBox="0 0 16 16"><path d="M8 2.5l1.2 3.3L12.5 7l-3.3 1.2L8 11.5 6.8 8.2 3.5 7l3.3-1.2z" /><path d="M12.5 11.5l.5 1.3 1.3.5-1.3.5-.5 1.2-.5-1.2-1.3-.5 1.3-.5z" /></symbol>
      <symbol id="i-funnel" viewBox="0 0 16 16"><path d="M2.5 3.5h11L9.5 8.5v4l-3 1.5v-5.5z" /></symbol>
      <symbol id="i-ret" viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M2.5 6.5h11M6.5 6.5v7M10 6.5v7" /></symbol>
      <symbol id="i-paths" viewBox="0 0 16 16"><path d="M3 8h3a2 2 0 0 0 2-2V4M3 8h3a2 2 0 0 1 2 2v2" /><circle cx="12" cy="4" r="1.5" /><circle cx="12" cy="12" r="1.5" /><path d="M8 4h2.5M8 12h2.5" /></symbol>
      <symbol id="i-trend" viewBox="0 0 16 16"><path d="M2.5 11.5l3.5-4 2.5 2 4.5-5.5" /><path d="M10.5 4h2.5v2.5" /></symbol>
      <symbol id="i-events" viewBox="0 0 16 16"><path d="M2.5 4.5h11M2.5 8h7M2.5 11.5h9" /></symbol>
      <symbol id="i-hist" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3.2l2.2 1.3" /></symbol>
      <symbol id="i-proj" viewBox="0 0 16 16"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" /><path d="M2.5 6.5h11M5.5 3.5v3" /></symbol>
      <symbol id="i-health" viewBox="0 0 16 16"><path d="M2.5 8h3l1.5-4 2 8 1.5-4h3" /></symbol>
      <symbol id="i-menu" viewBox="0 0 16 16"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></symbol>
      <symbol id="i-copy" viewBox="0 0 16 16"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></symbol>
      <symbol id="i-play" viewBox="0 0 16 16"><path d="M4.5 3v10l8-5z" /></symbol>
      <symbol id="i-edit" viewBox="0 0 16 16"><path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" /></symbol>
      <symbol id="i-chev" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" /></symbol>
      <symbol id="i-chevd" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" /></symbol>
      <symbol id="i-x" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" /></symbol>
      <symbol id="i-check" viewBox="0 0 16 16"><path d="M3 8.5l3 3 7-7" /></symbol>
      <symbol id="i-warn" viewBox="0 0 16 16"><path d="M8 2.5l6 11H2z" /><path d="M8 6.5v3M8 11.5v.1" /></symbol>
      <symbol id="i-info" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" /><path d="M8 7.5v3.5M8 5.2v.1" /></symbol>
      <symbol id="i-eye" viewBox="0 0 16 16"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></symbol>
      <symbol id="i-lock" viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></symbol>
      <symbol id="i-rotate" viewBox="0 0 16 16"><path d="M13 8a5 5 0 1 1-1.5-3.6" /><path d="M13 2.5v3h-3" /></symbol>
      <symbol id="i-sun" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></symbol>
      <symbol id="i-db" viewBox="0 0 16 16"><ellipse cx="8" cy="4" rx="5.5" ry="2" /><path d="M2.5 4v8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2V4M2.5 8c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" /></symbol>
      <symbol id="i-plus" viewBox="0 0 16 16"><path d="M8 3v10M3 8h10" /></symbol>
      <symbol id="i-mcp" viewBox="0 0 16 16"><path d="M5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 12.5h1M11 3.5h1a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-1" /><path d="M6 8h4" /></symbol>
      <symbol id="i-merge" viewBox="0 0 16 16"><circle cx="4" cy="4" r="1.5" /><circle cx="4" cy="12" r="1.5" /><circle cx="12" cy="8" r="1.5" /><path d="M4 5.5v5M4 6c0 2 6 1 6.5 2M4 10c0-2 6-1 6.5-2" /></symbol>
    </svg>
  );
}

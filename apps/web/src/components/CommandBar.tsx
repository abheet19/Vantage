/**
 * CommandBar.tsx — the top glass bar: project switcher, the always-visible project timezone, theme controls.
 *
 * Matched to vantage.html: a project button (teal status dot + name + chevron) that opens a click POPOVER
 * of name + timezone rows (not a native <select> overlay); a rounded timezone chip with a clock icon (every
 * number below is computed in that zone, design §1.3); the command-palette trigger; and two compact 32 px
 * icon buttons for the manual light and reduce-transparency toggles (F10), using aria-pressed for their on
 * state. The palette trigger and switch toast are optional props so `<CommandBar />` still renders standalone.
 */
import { useEffect, useRef, useState, type JSX } from 'react';
import { useTheme } from '../lib/theme.js';
import { useProject } from '../state/ProjectContext.js';
import { Icon } from './Icons.js';

export function CommandBar({ onOpenPalette, toast }: { onOpenPalette?: () => void; toast?: (message: string) => void }): JSX.Element {
  const { projects, current, selectProject } = useProject();
  const { theme, flat, toggleTheme, toggleFlat } = useTheme();
  const [open, setOpen] = useState(false);
  const switchRef = useRef<HTMLDivElement>(null);

  // Close the popover on any outside click or Escape — the same dismiss the prototype's document listener does.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent): void {
      if (switchRef.current && !switchRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <header className="cmd topbar glass">
      <div className="proj-switch" ref={switchRef}>
        <button
          type="button"
          className="proj proj-btn"
          title="Switch project"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          disabled={projects.length === 0}
        >
          <span className="dot proj-dot" />
          <span className="proj-name">{current ? current.name : 'No project'}</span>
          <Icon name="i-chevd" className="i chev" style={{ color: 'var(--ink-3)' }} />
        </button>
        {open && projects.length > 0 && (
          <div className="proj-menu glass" role="menu" aria-label="Projects">
            {projects.map((p) => (
              <button
                key={p.project_id}
                type="button"
                role="menuitemradio"
                aria-checked={p.project_id === current?.project_id}
                className={`proj-row${p.project_id === current?.project_id ? ' active' : ''}`}
                onClick={() => {
                  selectProject(p.project_id);
                  setOpen(false);
                  if (p.project_id !== current?.project_id) toast?.(`Switched to ${p.name}`);
                }}
              >
                <span className="name">{p.name}</span>
                <span className="tz">{p.timezone}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <span className="tz-chip" title="Project timezone — always visible; every number is computed in it">
        <Icon name="i-clock" />
        <span className="mono">{current ? current.timezone : '—'}</span>
      </span>
      <span className="grow topbar-spacer" />
      <button type="button" className="cmdk-trigger" onClick={() => onOpenPalette?.()} aria-label="Open command palette" title="Jump to a screen or run an action">
        <Icon name="i-search" />
        <span className="cmd-label">Jump to…</span>
        <kbd className="kbd">Ctrl K</kbd>
      </button>
      <button className="icon-btn" onClick={toggleTheme} aria-pressed={theme === 'dark'} aria-label="Toggle light theme" title="Toggle theme">
        <Icon name="i-sun" />
      </button>
      <button className="icon-btn" onClick={toggleFlat} aria-pressed={flat} aria-label="Reduce transparency" title="Disables backdrop blur on glass">
        <Icon name="i-contrast" />
      </button>
    </header>
  );
}

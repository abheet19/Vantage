/**
 * CommandBar.tsx — the top glass bar: project switcher, the always-visible project timezone, theme controls.
 *
 * Matched to vantage.html: a project button (teal status dot + name + chevron) with the real `<select>`
 * overlaid so switching still needs no popover code; a rounded timezone chip with a clock icon (every number
 * below is computed in that zone, design §1.3); the command-palette trigger; and two compact 32 px icon
 * buttons for the manual light and reduce-transparency toggles (F10), using aria-pressed for their on state.
 * The palette trigger and switch toast are optional props so `<CommandBar />` still renders standalone.
 */
import type { JSX } from 'react';
import { useTheme } from '../lib/theme.js';
import { useProject } from '../state/ProjectContext.js';
import { Icon } from './Icons.js';

export function CommandBar({ onOpenPalette, toast }: { onOpenPalette?: () => void; toast?: (message: string) => void }): JSX.Element {
  const { projects, current, selectProject } = useProject();
  const { theme, flat, toggleTheme, toggleFlat } = useTheme();
  return (
    <header className="cmd topbar glass">
      <div className="proj-switch">
        <div className="proj proj-btn" title="Switch project">
          <span className="dot proj-dot" />
          <span className="proj-name">{current ? current.name : 'No project'}</span>
          <Icon name="i-chevd" className="i chev" style={{ color: 'var(--ink-3)' }} />
          <select
            aria-label="Switch project"
            value={current?.project_id ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              selectProject(id);
              const picked = projects.find((p) => p.project_id === id);
              if (picked) toast?.(`Switched to ${picked.name}`);
            }}
            disabled={projects.length === 0}
          >
            {projects.length === 0 && <option value="">No project</option>}
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
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
      <button className="icon-btn" onClick={toggleTheme} aria-pressed={theme === 'light'} aria-label="Toggle light theme" title="Toggle theme">
        <Icon name="i-sun" />
      </button>
      <button className="icon-btn" onClick={toggleFlat} aria-pressed={flat} aria-label="Reduce transparency" title="Disables backdrop blur on glass">
        <Icon name="i-contrast" />
      </button>
    </header>
  );
}

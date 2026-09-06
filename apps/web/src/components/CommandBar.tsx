/**
 * CommandBar.tsx — the top glass bar: project switcher, the always-visible project timezone, theme toggles.
 *
 * Why it exists: 03-UI §4 keeps the project, its timezone and the theme controls in a glass command bar.
 * The timezone is shown at all times because every number below is computed in it (design §1.3); the
 * switcher is a real `<select>` overlaid on the pill, so changing project needs no popover code. The two
 * toggles are the manual light and reduce-transparency switches (F10).
 */
import type { JSX } from 'react';
import { useTheme } from '../lib/theme.js';
import { useProject } from '../state/ProjectContext.js';
import { Icon } from './Icons.js';

export function CommandBar(): JSX.Element {
  const { projects, current, selectProject } = useProject();
  const { theme, flat, toggleTheme, toggleFlat } = useTheme();
  return (
    <header className="cmd glass">
      <div className="proj" title="Switch project">
        <span className="dot" />
        {current ? current.name : 'No project'}
        <Icon name="i-chevd" style={{ color: 'var(--ink-3)' }} />
        <select aria-label="Switch project" value={current?.project_id ?? ''} onChange={(e) => selectProject(e.target.value)} disabled={projects.length === 0}>
          {projects.length === 0 && <option value="">No project</option>}
          {projects.map((p) => (
            <option key={p.project_id} value={p.project_id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <span className="pill tz" title="Project timezone — always visible; every number is computed in it">
        <Icon name="i-info" />
        {current ? current.timezone : '—'}
      </span>
      <span className="grow" />
      <button className="toggle" onClick={toggleTheme} aria-pressed={theme === 'light'}>
        <Icon name="i-sun" />
        Light
        <span className="sw" />
      </button>
      <button className="toggle" onClick={toggleFlat} aria-pressed={flat} title="Disables backdrop blur on glass">
        Reduce transparency
        <span className="sw" />
      </button>
    </header>
  );
}

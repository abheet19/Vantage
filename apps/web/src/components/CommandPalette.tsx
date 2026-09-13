/**
 * CommandPalette.tsx — Ctrl/Cmd+K "jump to a screen or run an action" overlay (glass redesign addition).
 *
 * Why it exists: the approved glass redesign's Ask-adjacent chrome includes a command palette, and it is a
 * genuine improvement over ten keyboard numbers a new user has to discover on their own — this is the
 * discoverable, searchable front door to the same navigation (`routes.ts` is the single source, so there is
 * no entry here that the rail does not already have) plus two small, state-free actions. It never touches
 * project or query state, so it cannot desync from the rest of the shell; the two toggles that DO carry
 * state (theme, reduce-transparency) stay owned by `CommandBar`/`useTheme` alone rather than being
 * duplicated here with a second, easily-stale copy of the same boolean.
 *
 * What it must never do: render while a second, independent copy of shell state (theme, project) that could
 * drift from the command bar's own copy — which is exactly why those two toggles are not listed here.
 */
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ROUTES, type RouteId } from '../routes.js';
import { Icon, type IconName } from './Icons.js';

interface Item {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  navigate,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  navigate: (id: RouteId) => void;
  toast: (message: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const nav: Item[] = ROUTES.map((r) => ({
      id: `route-${r.id}`,
      label: r.label,
      hint: `Go to · ${r.key}`,
      icon: r.icon as IconName,
      run: () => navigate(r.id),
    }));
    const actions: Item[] = [
      {
        id: 'route-projects',
        label: 'Projects & ingest',
        hint: 'Settings',
        icon: 'i-proj',
        run: () => navigate('projects'),
      },
      {
        id: 'route-mcp',
        label: 'MCP',
        hint: 'Settings',
        icon: 'i-mcp',
        run: () => navigate('mcp'),
      },
      {
        id: 'route-health',
        label: 'Health',
        hint: 'Settings',
        icon: 'i-health',
        run: () => navigate('health'),
      },
      {
        id: 'action-copy-link',
        label: 'Copy link to this screen',
        hint: window.location.hash || '#/ask',
        icon: 'i-copy',
        run: () => {
          const clipboard = navigator.clipboard as Clipboard | undefined;
          if (!clipboard) {
            toast('Clipboard is unavailable here');
            return;
          }
          clipboard
            .writeText(window.location.href)
            .then(() => toast('Link copied'))
            .catch(() => toast('Could not copy the link'));
        },
      },
      {
        id: 'action-github',
        label: 'Open Vantage on GitHub',
        hint: 'github.com/abheet19',
        icon: 'i-merge',
        run: () => {
          window.open('https://github.com/abheet19/Vantage', '_blank', 'noopener,noreferrer');
        },
      },
    ];
    return [...nav, ...actions];
  }, [navigate, toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.label.toLowerCase().includes(q) || it.hint.toLowerCase().includes(q));
  }, [items, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  function commit(item: Item | undefined): void {
    if (!item) return;
    item.run();
    onClose();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(filtered[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  const activeItem = filtered[active];

  return (
    <div
      className="cmdk-scrim"
      hidden={!open}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cmdk-modal glass" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk-row">
          <Icon name="i-search" />
          <input
            ref={inputRef}
            className="cmdk-input"
            role="combobox"
            aria-expanded={open}
            aria-controls="cmdk-listbox"
            aria-autocomplete="list"
            {...(activeItem ? { 'aria-activedescendant': `cmdk-opt-${activeItem.id}` } : {})}
            placeholder="Jump to a screen or run an action…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <ul className="cmdk-list" id="cmdk-listbox" role="listbox" aria-label="Screens and actions">
          {filtered.length === 0 && <li className="cmdk-empty">No matches</li>}
          {filtered.map((it, i) => (
            <li
              key={it.id}
              id={`cmdk-opt-${it.id}`}
              role="option"
              aria-selected={i === active}
              className={`cmdk-item${i === active ? ' sel' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(it);
              }}
            >
              <Icon name={it.icon} />
              <span className="t">{it.label}</span>
              <span className="k">{it.hint}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

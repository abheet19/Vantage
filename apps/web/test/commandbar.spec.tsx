import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectRow } from '@vantage/contracts';
import { CommandBar } from '../src/components/CommandBar.js';
import { ProjectProvider } from '../src/state/ProjectContext.js';
import { PROJECT, PROJECT_2, jsonResponse, stubFetch } from './net.js';

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
  vi.unstubAllGlobals();
});

function renderBar(props: Partial<ComponentProps<typeof CommandBar>> = {}, projects: ProjectRow[] = [PROJECT]) {
  stubFetch({ '/v1/projects': () => jsonResponse(projects) });
  return render(
    <ProjectProvider>
      <CommandBar {...props} />
    </ProjectProvider>,
  );
}

describe('CommandBar', () => {
  it('shows the current project name and its timezone, always', async () => {
    renderBar();
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('August fixture'));
    expect(screen.getByText('Asia/Kolkata')).toBeInTheDocument();
  });

  it('toggles the theme by flipping data-theme on the document', async () => {
    renderBar();
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('August fixture'));
    const before = document.documentElement.getAttribute('data-theme');
    await userEvent.click(screen.getByRole('button', { name: /light/i }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).not.toBe(before));
  });

  it('toggles reduce-transparency by setting data-flat', async () => {
    renderBar();
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('August fixture'));
    await userEvent.click(screen.getByRole('button', { name: /reduce transparency/i }));
    await waitFor(() => expect(document.documentElement.getAttribute('data-flat')).toBe('1'));
  });

  it('opens the command palette via its trigger when a handler is wired', async () => {
    const onOpenPalette = vi.fn();
    renderBar({ onOpenPalette });
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('August fixture'));
    await userEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    expect(onOpenPalette).toHaveBeenCalledOnce();
  });

  it('does nothing when the palette trigger has no handler wired', async () => {
    renderBar();
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('August fixture'));
    await userEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
    // no-op: reaching here without a thrown error is the assertion.
  });

  it('switching projects toasts the new project name when a toast handler is wired', async () => {
    const toast = vi.fn();
    renderBar({ toast }, [PROJECT, PROJECT_2]);
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('August fixture'));
    await userEvent.selectOptions(screen.getByLabelText('Switch project'), PROJECT_2.project_id);
    expect(toast).toHaveBeenCalledWith('Switched to Growth sandbox');
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('Growth sandbox'));
  });

  it('switching projects without a toast handler still switches', async () => {
    renderBar({}, [PROJECT, PROJECT_2]);
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('August fixture'));
    await userEvent.selectOptions(screen.getByLabelText('Switch project'), PROJECT_2.project_id);
    await waitFor(() => expect(screen.getByTitle('Switch project')).toHaveTextContent('Growth sandbox'));
  });
});

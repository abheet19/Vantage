import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandBar } from '../src/components/CommandBar.js';
import { ProjectProvider } from '../src/state/ProjectContext.js';
import { PROJECT, jsonResponse, stubFetch } from './net.js';

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

function renderBar() {
  stubFetch({ '/v1/projects': () => jsonResponse([PROJECT]) });
  return render(
    <ProjectProvider>
      <CommandBar />
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
});

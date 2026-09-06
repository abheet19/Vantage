import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WithProject } from '../src/components/WithProject.js';
import { ProjectProvider } from '../src/state/ProjectContext.js';
import { PROJECT, jsonResponse, stubFetch } from './net.js';

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});
afterEach(() => vi.unstubAllGlobals());

function renderGuard() {
  return render(
    <ProjectProvider>
      <WithProject>{(project) => <div data-testid="child">{project.name}</div>}</WithProject>
    </ProjectProvider>,
  );
}

describe('WithProject renders loading, error and empty as three different things', () => {
  it('shows a skeleton while the projects list is loading', () => {
    let resolve: (r: Response) => void = () => undefined;
    stubFetch({ '/v1/projects': () => new Promise<Response>((r) => (resolve = r)) });
    const { container } = renderGuard();
    expect(container.querySelector('.skel')).not.toBeNull();
    expect(screen.queryByTestId('child')).toBeNull();
    resolve(jsonResponse([PROJECT]));
  });

  it('shows the error card with the real message when the list cannot be loaded', async () => {
    stubFetch({ '/v1/projects': () => jsonResponse({ code: 'TIMED_OUT', message: 'the read timed out' }, 503) });
    renderGuard();
    await waitFor(() => expect(screen.getByTestId('state-error')).toBeInTheDocument());
    expect(screen.getByTestId('state-error')).toHaveTextContent('the read timed out');
  });

  it('shows the empty card pointing at Projects when there are no projects', async () => {
    stubFetch({ '/v1/projects': () => jsonResponse([]) });
    renderGuard();
    await waitFor(() => expect(screen.getByTestId('state-empty')).toBeInTheDocument());
    expect(screen.getByTestId('state-empty')).toHaveTextContent('No project yet');
  });

  it('renders the child with the chosen project once loaded', async () => {
    stubFetch({ '/v1/projects': () => jsonResponse([PROJECT]) });
    renderGuard();
    await waitFor(() => expect(screen.getByTestId('child')).toHaveTextContent('August fixture'));
  });
});

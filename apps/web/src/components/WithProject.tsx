/**
 * WithProject.tsx — gate a screen on a selected project, rendering the three first-run/failure states.
 *
 * Why it exists: Ask, Funnel, Events and History are meaningless without a project, and 03-UI S9 wants
 * loading, error and empty to be three different things. This renders a skeleton while projects load, the
 * red error card (with the real message and Retry) if the list could not be fetched, and the calm empty
 * card pointing at Projects when there are none — then hands the chosen project to its children.
 */
import type { JSX } from 'react';
import type { ProjectRow } from '@vantage/contracts';
import { useHashRoute } from '../lib/router.js';
import { useProject } from '../state/ProjectContext.js';
import { Icon } from './Icons.js';
import { Skeleton, StateCard } from './StateCard.js';

export function WithProject({ children }: { children: (project: ProjectRow) => JSX.Element }): JSX.Element {
  const { current, loading, error, reload } = useProject();
  const { navigate } = useHashRoute();

  if (loading) {
    return (
      <div className="panel">
        <Skeleton />
      </div>
    );
  }
  if (error) {
    return (
      <StateCard
        variant="error"
        icon="i-db"
        title="Could not reach the API"
        raw={{ heading: 'Error', text: error.message }}
        actions={
          <>
            <button type="button" className="btn primary" onClick={reload}>
              <Icon name="i-rotate" />
              Retry
            </button>
            <button type="button" className="btn" onClick={() => navigate('health')}>
              Open Health
            </button>
          </>
        }
      >
        Vantage could not load your projects. Nothing is cached; nothing is shown until the API answers.
      </StateCard>
    );
  }
  if (!current) {
    return (
      <StateCard
        variant="empty"
        title="No project yet"
        actions={
          <button type="button" className="btn primary" onClick={() => navigate('projects')}>
            Open Projects &amp; ingest
          </button>
        }
      >
        Create a project and send one batch of events, then Ask, Funnel and Events come to life.
      </StateCard>
    );
  }
  return children(current);
}

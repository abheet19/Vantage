/**
 * HealthView.tsx — process health, and the empty ≠ error ≠ loading trio (03-UI S9).
 *
 * Why it exists: design §1.3's honesty rule applies to the process too. This polls `GET /health`; when
 * both pools are up, the migration matches and the boot self-test passed, it shows the green check with
 * the version — otherwise the red error card with the driver's real message and a Retry, never a blank or
 * a spinner-forever. Beneath it, the trio renders empty, error and loading side by side, so the promise
 * that these three never share a rendering is visible (and snapshot-tested).
 *
 * What it must never do: report healthy on a partial body, or render the error and empty states alike.
 */
import type { JSX } from 'react';
import { Chip } from '../components/Chip.js';
import { Icon } from '../components/Icons.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { useHealth } from '../lib/hooks.js';

function LiveHealth(): JSX.Element {
  const { data, loading, error, reload } = useHealth();

  if (loading) {
    return (
      <div className="panel">
        <div className="panel-h">
          <h2>Process health</h2>
          <Chip tone="dim" role="status">
            ◌ Checking
          </Chip>
        </div>
        <Skeleton />
      </div>
    );
  }

  const down = error !== null || !data || data.ok !== true;
  if (down) {
    const message = error?.message ?? data?.message ?? 'The API reported it is not healthy.';
    const pools = data ? `rw: ${data.pools.rw} · ro: ${data.pools.ro}` : 'both pools unknown';
    return (
      <StateCard
        variant="error"
        icon="i-db"
        title="Database unreachable"
        chip={<Chip tone="bad" role="alert">■ Error</Chip>}
        raw={{ heading: 'Reason', text: `${message}\n  pools → ${pools}` }}
        actions={
          <>
            <button type="button" className="btn primary" onClick={reload}>
              <Icon name="i-rotate" />
              Retry
            </button>
          </>
        }
      >
        Vantage could not confirm the database is up. Nothing is cached; nothing is shown until it answers.
      </StateCard>
    );
  }

  return (
    <div className="panel check ok" data-testid="health-ok">
      <span className="ic">
        <Icon name="i-check" />
      </span>
      <div>
        <b>Healthy</b>
        <div className="small muted">
          read/write pool {data.pools.rw} · read-only pool {data.pools.ro}
          {data.migration ? ` · schema v${data.migration.version}` : ''} · boot self-test {data.self_test?.ok ? 'passed' : 'unknown'}
          {data.release_sha ? ` · release ${data.release_sha.slice(0, 7)}` : ' · local build'}
        </div>
      </div>
      <span className="grow" />
      <button className="btn sm" onClick={reload}>
        <Icon name="i-rotate" />
        Re-check
      </button>
    </div>
  );
}

export function HealthView(): JSX.Element {
  return (
    <section className="screen" aria-labelledby="h-health">
      <div className="screen-head">
        <div>
          <h1 id="h-health">Health</h1>
          <p>Process health, then the failure states. Empty, error and loading are three different things and never share a rendering.</p>
        </div>
      </div>
      <div className="stack">
        <LiveHealth />
        <h3>Empty ≠ error ≠ loading</h3>
        <div className="trio">
          <div className="panel">
            <div className="panel-h">
              <h2>Empty</h2>
              <Chip tone="dim" role="status">
                ○ No events matched
              </Chip>
            </div>
            <div style={{ padding: 16 }}>
              <StateCard variant="empty" title="No events matched">
                A fact about the data, not a failure. Calm, grey, dashed.
              </StateCard>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <h2>Error</h2>
              <Chip tone="bad" role="alert">
                ■ Error
              </Chip>
            </div>
            <div style={{ padding: 16 }}>
              <StateCard variant="error" icon="i-db" title="Query failed" raw={{ heading: 'Reason', text: 'connect ECONNREFUSED 127.0.0.1:5432' }}>
                Red, loud, with the real message and a way out.
              </StateCard>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <h2>Loading</h2>
              <Chip tone="dim">◌ Running</Chip>
            </div>
            <Skeleton />
          </div>
        </div>
      </div>
    </section>
  );
}

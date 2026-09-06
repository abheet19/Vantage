/**
 * PathsView.tsx — build a paths spec by hand and run it, no model involved (03-UI S4).
 *
 * Why it exists: the top transitions after a start event, on live data, without a question. The start-event
 * picker comes from `GET /v1/events/catalog` (design §4.2); steps and session gap are the rest of the
 * grammar. Run posts a `PathsSpec` to `/v1/paths`; a complete result renders as the ranked transitions
 * table with flow bars and the "showing top 50 of N" chip, empty/timed-out/refused as their own cards, and
 * the exact SQL sits in the collapsible right panel.
 *
 * What it must never do: choose a start event the catalog does not list, or keep a previous table visible
 * while a new run is in flight.
 */
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import type { EventCatalog, PathsResult, PathsSpec, ProjectRow } from '@vantage/contracts';
import { ApiError, api } from '../api/client.js';
import { Chip } from '../components/Chip.js';
import { DegradedResult, isSettled } from '../components/DegradedResult.js';
import { Icon } from '../components/Icons.js';
import { PathsTable, TruncationChip } from '../components/PathsTable.js';
import { SqlView } from '../components/Sql.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { StatusFooter } from '../components/StatusFooter.js';
import { WithProject } from '../components/WithProject.js';
import { catalogRange } from '../lib/range.js';
import { useCatalog } from '../lib/hooks.js';

type Run = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; result: PathsResult } | { kind: 'error'; error: ApiError };

function Builder({ project, catalog }: { project: ProjectRow; catalog: EventCatalog }): JSX.Element {
  const names = useMemo(() => catalog.events.map((e) => e.event), [catalog]);
  const [start, setStart] = useState(() => (names.includes('signup') ? 'signup' : (names[0] ?? '')));
  const [steps, setSteps] = useState(3);
  const [gap, setGap] = useState(30);
  const [range, setRange] = useState(() => catalogRange(catalog));
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [collapsed, setCollapsed] = useState(false);
  const token = useRef(0);

  const canRun = names.includes(start);

  const spec = useMemo<PathsSpec>(
    () => ({ kind: 'paths', project: project.project_id, range, where: [], start, steps, session_gap_minutes: gap }),
    [project.project_id, range, start, steps, gap],
  );

  const execute = useCallback(() => {
    if (!canRun) return;
    const mine = ++token.current;
    setRun({ kind: 'loading' });
    api
      .paths(spec)
      .then((result) => {
        if (mine === token.current) setRun({ kind: 'done', result });
      })
      .catch((err: unknown) => {
        if (mine === token.current) setRun({ kind: 'error', error: err instanceof ApiError ? err : new ApiError('network', 'the paths query failed') });
      });
  }, [canRun, spec]);

  return (
    <div className={`cols${collapsed ? ' collapsed' : ''}`}>
      <div className="stack">
        <div className="panel">
          <div className="panel-h">
            <h2>Transitions</h2>
            <span className="grow" />
            <button className="btn primary" onClick={execute} disabled={!canRun || run.kind === 'loading'}>
              <Icon name="i-play" />
              {run.kind === 'loading' ? 'Running…' : 'Run paths'}
            </button>
          </div>
          <div className="builder">
            <div className="field">
              <label>Start event</label>
              <select value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start event">
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Steps</label>
              <div className="in">
                <input type="number" min={1} max={5} value={steps} onChange={(e) => setSteps(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} aria-label="Steps" />
                <span className="small faint" style={{ marginLeft: 'auto' }}>
                  max 5
                </span>
              </div>
            </div>
            <div className="field">
              <label>Session gap (minutes)</label>
              <div className="in">
                <input type="number" min={1} max={1440} value={gap} onChange={(e) => setGap(Math.max(1, Math.min(1440, Number(e.target.value) || 1)))} aria-label="Session gap minutes" />
              </div>
            </div>
            <div className="field">
              <label>From</label>
              <div className="in">
                <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="Range start" />
              </div>
            </div>
            <div className="field">
              <label>To</label>
              <div className="in">
                <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="Range end" />
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Ranked transitions</h2>
            <span className="grow" />
            {run.kind === 'done' && run.result.transitions && <TruncationChip result={run.result} />}
          </div>
          {run.kind === 'idle' && <div className="ran-nothing">Pick a start event and run to see the transitions and their SQL.</div>}
          {run.kind === 'loading' && <Skeleton />}
          {run.kind === 'done' && <PathsBody result={run.result} />}
          {run.kind === 'error' && (
            <div style={{ padding: 16 }}>
              <StateCard variant="error" icon="i-db" title="The paths query could not run" raw={{ heading: 'Error', text: run.error.message }} actions={<button type="button" className="btn primary" onClick={execute}><Icon name="i-rotate" />Retry</button>}>
                The request was rejected or the database could not answer. Nothing partial is shown.
              </StateCard>
            </div>
          )}
        </div>
      </div>

      <aside className="panel side">
        <div className="panel-h">
          <h2 style={{ color: 'var(--accent)' }}>SQL</h2>
          <Chip tone="faint">{run.kind === 'done' ? `$1…$${run.result.params.length} bound` : 'compiler output'}</Chip>
          <button className="btn sm ghost collapse" onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand SQL panel' : 'Collapse SQL panel'} aria-pressed={collapsed}>
            <Icon name="i-chev" />
          </button>
        </div>
        <div className="panel-b">
          {run.kind === 'done' ? <SqlView sql={run.result.sql} params={run.result.params} /> : <pre className="sqlpre faint">Run the paths query to see the exact SQL and its bound parameters.</pre>}
        </div>
      </aside>
    </div>
  );
}

function PathsBody({ result }: { result: PathsResult }): JSX.Element {
  if (!isSettled(result.meta.status)) return <DegradedResult meta={result.meta} noun="transitions" />;
  return (
    <>
      <PathsTable result={result} />
      <StatusFooter meta={result.meta} />
    </>
  );
}

function PathsScreen({ project }: { project: ProjectRow }): JSX.Element {
  const { data, loading, error, reload } = useCatalog(project.project_id);
  if (loading) {
    return (
      <div className="panel">
        <Skeleton />
      </div>
    );
  }
  if (error) {
    return (
      <StateCard variant="error" icon="i-db" title="Could not load events" raw={{ heading: 'Error', text: error.message }} actions={<button type="button" className="btn primary" onClick={reload}><Icon name="i-rotate" />Retry</button>}>
        The event catalog could not be read, so the start-event picker cannot be built.
      </StateCard>
    );
  }
  if (!data || data.events.length === 0) {
    return (
      <StateCard variant="empty" title="No events yet">
        This project has no events, so there are no paths to trace. Send a batch from Projects &amp; ingest first.
      </StateCard>
    );
  }
  return <Builder key={project.project_id} project={project} catalog={data} />;
}

export function PathsView(): JSX.Element {
  return (
    <section className="screen" aria-labelledby="h-paths">
      <div className="screen-head">
        <div>
          <h1 id="h-paths">Paths</h1>
          <p>Top transitions between consecutive events per person, within a session gap, up to five steps from a start event. A ranked table, not a sankey.</p>
        </div>
      </div>
      <WithProject>{(project) => <PathsScreen project={project} />}</WithProject>
    </section>
  );
}

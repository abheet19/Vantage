/**
 * RetentionView.tsx — build a retention spec by hand and run it, no model involved (03-UI S3).
 *
 * Why it exists: the cohort heatmap on live data, reachable without a question. Event pickers come from
 * `GET /v1/events/catalog`, so only real names can be chosen (design §4.2). Run posts a `RetentionSpec` to
 * `/v1/retention`; a complete grid renders as the global-scale heatmap with hatched in-progress cells, and
 * empty/timed-out/refused render as their own distinct cards (design §1.3). The exact SQL sits in the
 * collapsible right panel — the same compiler output every surface shows.
 *
 * What it must never do: choose an event the catalog does not list, or keep a previous grid visible while a
 * new run is in flight (the run token clears it).
 */
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import type { EventCatalog, ProjectRow, RetentionResult, RetentionSpec } from '@vantage/contracts';
import { ApiError, api } from '../api/client.js';
import { Chip } from '../components/Chip.js';
import { DegradedResult, isSettled } from '../components/DegradedResult.js';
import { HeatLegend, RetentionHeatmap } from '../components/RetentionHeatmap.js';
import { Icon } from '../components/Icons.js';
import { SqlView } from '../components/Sql.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { StatusFooter } from '../components/StatusFooter.js';
import { WithProject } from '../components/WithProject.js';
import { catalogRange } from '../lib/range.js';
import { useCatalog } from '../lib/hooks.js';

type Unit = 'day' | 'week' | 'month';
type Mode = 'on' | 'on_or_after';
type Run = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; result: RetentionResult } | { kind: 'error'; error: ApiError };

const UNITS: ReadonlyArray<{ id: Unit; label: string }> = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];
const MODES: ReadonlyArray<{ id: Mode; label: string }> = [
  { id: 'on', label: 'On' },
  { id: 'on_or_after', label: 'On or after' },
];

function firstOf(names: string[], preferred: string): string {
  return names.includes(preferred) ? preferred : (names[0] ?? '');
}

function Builder({ project, catalog }: { project: ProjectRow; catalog: EventCatalog }): JSX.Element {
  const names = useMemo(() => catalog.events.map((e) => e.event), [catalog]);
  const [start, setStart] = useState(() => firstOf(names, 'signup'));
  const [returnEvent, setReturnEvent] = useState(() => firstOf(names, 'view_pricing'));
  const [unit, setUnit] = useState<Unit>('day');
  const [periods, setPeriods] = useState(14);
  const [mode, setMode] = useState<Mode>('on');
  const [range, setRange] = useState(() => catalogRange(catalog));
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [collapsed, setCollapsed] = useState(false);
  const token = useRef(0);

  const canRun = names.includes(start) && names.includes(returnEvent);

  const spec = useMemo<RetentionSpec>(
    () => ({ kind: 'retention', project: project.project_id, range, where: [], start: { event: start, where: [] }, return: { event: returnEvent, where: [] }, unit, periods, mode }),
    [project.project_id, range, start, returnEvent, unit, periods, mode],
  );

  const execute = useCallback(() => {
    if (!canRun) return;
    const mine = ++token.current;
    setRun({ kind: 'loading' });
    api
      .retention(spec)
      .then((result) => {
        if (mine === token.current) setRun({ kind: 'done', result });
      })
      .catch((err: unknown) => {
        if (mine === token.current) setRun({ kind: 'error', error: err instanceof ApiError ? err : new ApiError('network', 'the retention query failed') });
      });
  }, [canRun, spec]);

  return (
    <div className={`cols${collapsed ? ' collapsed' : ''}`}>
      <div className="stack">
        <div className="panel">
          <div className="panel-h">
            <h2>Cohorts</h2>
            <span className="grow" />
            <button className="btn primary" onClick={execute} disabled={!canRun || run.kind === 'loading'}>
              <Icon name="i-play" />
              {run.kind === 'loading' ? 'Running…' : 'Run retention'}
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
              <label>Return event</label>
              <select value={returnEvent} onChange={(e) => setReturnEvent(e.target.value)} aria-label="Return event">
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Unit</label>
              <div className="seg">
                {UNITS.map((u) => (
                  <button key={u.id} aria-pressed={unit === u.id} onClick={() => setUnit(u.id)}>
                    {u.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Periods</label>
              <div className="in">
                <input type="number" min={1} max={30} value={periods} onChange={(e) => setPeriods(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} aria-label="Periods" />
              </div>
            </div>
            <div className="field">
              <label>Mode</label>
              <div className="seg">
                {MODES.map((m) => (
                  <button key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
                    {m.label}
                  </button>
                ))}
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
            <div className="field">
              <label>Timezone</label>
              <div className="in">
                <code>{project.timezone}</code>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Heatmap</h2>
            <span className="grow" />
            {run.kind === 'done' && run.result.cohorts && <HeatLegend />}
          </div>
          {run.kind === 'idle' && <div className="ran-nothing">Set the cohort and run to see the heatmap and its SQL.</div>}
          {run.kind === 'loading' && <Skeleton />}
          {run.kind === 'done' && <RetentionBody result={run.result} />}
          {run.kind === 'error' && (
            <div style={{ padding: 16 }}>
              <StateCard variant="error" icon="i-db" title="The retention query could not run" raw={{ heading: 'Error', text: run.error.message }} actions={<button type="button" className="btn primary" onClick={execute}><Icon name="i-rotate" />Retry</button>}>
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
          {run.kind === 'done' ? <SqlView sql={run.result.sql} params={run.result.params} /> : <pre className="sqlpre faint">Run the retention query to see the exact SQL and its bound parameters.</pre>}
        </div>
      </aside>
    </div>
  );
}

/** Renders the grid for `complete`/`truncated`, and the shared calm/red cards for the other statuses. */
function RetentionBody({ result }: { result: RetentionResult }): JSX.Element {
  if (!isSettled(result.meta.status)) return <DegradedResult meta={result.meta} noun="cohorts" />;
  return (
    <>
      <RetentionHeatmap result={result} />
      <StatusFooter meta={result.meta} />
    </>
  );
}

function RetentionScreen({ project }: { project: ProjectRow }): JSX.Element {
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
        The event catalog could not be read, so the pickers cannot be built.
      </StateCard>
    );
  }
  if (!data || data.events.length === 0) {
    return (
      <StateCard variant="empty" title="No events yet">
        This project has no events, so there is nothing to retain. Send a batch from Projects &amp; ingest first.
      </StateCard>
    );
  }
  return <Builder key={project.project_id} project={project} catalog={data} />;
}

export function RetentionView(): JSX.Element {
  return (
    <section className="screen" aria-labelledby="h-retention">
      <div className="screen-head">
        <div>
          <h1 id="h-retention">Retention</h1>
          <p>Cohorts by first start-event day in the project timezone; a cell is retained if the return event happened in that period. Hatched cells are periods that have not ended.</p>
        </div>
      </div>
      <WithProject>{(project) => <RetentionScreen project={project} />}</WithProject>
    </section>
  );
}

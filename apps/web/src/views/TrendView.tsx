/**
 * TrendView.tsx — build a trend spec by hand and run it, no model involved (03-UI, S6 trend chart).
 *
 * Why it exists: an event counted per time bucket, drawn on live data without a question. The event picker
 * comes from `GET /v1/events/catalog` (design §4.2); measure, unit, breakdown and range are the rest of the
 * grammar. Run posts a `TrendSpec` to `/v1/trend`; a complete series renders as the SVG chart (bars, or one
 * line per breakdown series), empty/timed-out/refused as their own cards, and the exact SQL sits in the
 * collapsible right panel.
 *
 * What it must never do: choose an event the catalog does not list, or keep a previous chart visible while a
 * new run is in flight.
 */
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import type { EventCatalog, ProjectRow, TrendResult, TrendSpec } from '@vantage/contracts';
import { ApiError, api } from '../api/client.js';
import { Chip } from '../components/Chip.js';
import { DegradedResult, isSettled } from '../components/DegradedResult.js';
import { Icon } from '../components/Icons.js';
import { SqlView } from '../components/Sql.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { StatusFooter } from '../components/StatusFooter.js';
import { TrendChart } from '../components/TrendChart.js';
import { WithProject } from '../components/WithProject.js';
import { catalogRange } from '../lib/range.js';
import { useCatalog } from '../lib/hooks.js';

type Measure = 'events' | 'persons';
type Unit = 'hour' | 'day' | 'week' | 'month';
type Run = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; result: TrendResult } | { kind: 'error'; error: ApiError };

const MEASURES: ReadonlyArray<{ id: Measure; label: string }> = [
  { id: 'events', label: 'Events' },
  { id: 'persons', label: 'Unique persons' },
];
const UNITS: ReadonlyArray<{ id: Unit; label: string }> = [
  { id: 'hour', label: 'Hour' },
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

function Builder({ project, catalog }: { project: ProjectRow; catalog: EventCatalog }): JSX.Element {
  const names = useMemo(() => catalog.events.map((e) => e.event), [catalog]);
  const [event, setEvent] = useState(() => (names.includes('signup') ? 'signup' : (names[0] ?? '')));
  const [measure, setMeasure] = useState<Measure>('events');
  const [unit, setUnit] = useState<Unit>('day');
  const [breakdown, setBreakdown] = useState('');
  const [range, setRange] = useState(() => catalogRange(catalog));
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [collapsed, setCollapsed] = useState(false);
  const token = useRef(0);

  const canRun = names.includes(event);

  const spec = useMemo<TrendSpec>(() => {
    const key = breakdown.trim();
    return { kind: 'trend', project: project.project_id, range, where: [], event: { event, where: [] }, measure, unit, ...(key ? { breakdown: key } : {}) };
  }, [project.project_id, range, event, measure, unit, breakdown]);

  const execute = useCallback(() => {
    if (!canRun) return;
    const mine = ++token.current;
    setRun({ kind: 'loading' });
    api
      .trend(spec)
      .then((result) => {
        if (mine === token.current) setRun({ kind: 'done', result });
      })
      .catch((err: unknown) => {
        if (mine === token.current) setRun({ kind: 'error', error: err instanceof ApiError ? err : new ApiError('network', 'the trend query failed') });
      });
  }, [canRun, spec]);

  return (
    <div className={`cols${collapsed ? ' collapsed' : ''}`}>
      <div className="stack">
        <div className="panel">
          <div className="panel-h">
            <h2>Series</h2>
            <span className="grow" />
            <button className="btn primary" onClick={execute} disabled={!canRun || run.kind === 'loading'}>
              <Icon name="i-play" />
              {run.kind === 'loading' ? 'Running…' : 'Run trend'}
            </button>
          </div>
          <div className="builder">
            <div className="field">
              <label>Event</label>
              <select value={event} onChange={(e) => setEvent(e.target.value)} aria-label="Event">
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Measure</label>
              <div className="seg">
                {MEASURES.map((m) => (
                  <button key={m.id} aria-pressed={measure === m.id} onClick={() => setMeasure(m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
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
              <label>Breakdown by property (optional)</label>
              <div className="in">
                <input type="text" value={breakdown} placeholder="e.g. plan" onChange={(e) => setBreakdown(e.target.value)} aria-label="Breakdown property key" />
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
            <h2>Chart</h2>
            <Chip tone="faint">
              {measure} · by {unit}
            </Chip>
          </div>
          {run.kind === 'idle' && <div className="ran-nothing">Pick an event and run to see the trend and its SQL.</div>}
          {run.kind === 'loading' && <Skeleton />}
          {run.kind === 'done' && <TrendBody result={run.result} />}
          {run.kind === 'error' && (
            <div style={{ padding: 16 }}>
              <StateCard variant="error" icon="i-db" title="The trend query could not run" raw={{ heading: 'Error', text: run.error.message }} actions={<button type="button" className="btn primary" onClick={execute}><Icon name="i-rotate" />Retry</button>}>
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
          {run.kind === 'done' ? <SqlView sql={run.result.sql} params={run.result.params} /> : <pre className="sqlpre faint">Run the trend query to see the exact SQL and its bound parameters.</pre>}
        </div>
      </aside>
    </div>
  );
}

function TrendBody({ result }: { result: TrendResult }): JSX.Element {
  if (!isSettled(result.meta.status)) return <DegradedResult meta={result.meta} noun="buckets" />;
  return (
    <>
      <TrendChart result={result} />
      <StatusFooter meta={result.meta} />
    </>
  );
}

function TrendScreen({ project }: { project: ProjectRow }): JSX.Element {
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
        This project has no events, so there is nothing to trend. Send a batch from Projects &amp; ingest first.
      </StateCard>
    );
  }
  return <Builder key={project.project_id} project={project} catalog={data} />;
}

export function TrendView(): JSX.Element {
  return (
    <section className="screen" aria-labelledby="h-trend">
      <div className="screen-head">
        <div>
          <h1 id="h-trend">Trend</h1>
          <p>One event counted per time bucket in the project timezone — as events or unique persons, with an optional property breakdown. The dashed tail is a bucket that has not ended.</p>
        </div>
      </div>
      <WithProject>{(project) => <TrendScreen project={project} />}</WithProject>
    </section>
  );
}

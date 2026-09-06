/**
 * FunnelView.tsx — build a funnel spec by hand and run it, no model involved (03-UI S2).
 *
 * Why it exists: the same compiler and SQL the Ask screen shows, reachable without a question. Step
 * pickers are populated from `GET /v1/events/catalog`, so only real event names can be chosen (design
 * §4.2: the grammar, not a prompt, is the boundary — here the UI simply cannot offer an invented name).
 * Run posts a `FunnelSpec` to `/v1/funnel`; the result renders through the shared `ResultView` (so empty,
 * timed-out and complete look the same as on Ask) and the exact SQL sits in the collapsible right panel.
 *
 * What it must never do: send a step the catalog does not list, or keep a previous result visible while a
 * new run is in flight (the run token clears it).
 */
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import type { EventCatalog, FunnelResult, FunnelSpec, ProjectRow } from '@vantage/contracts';
import { ApiError, api } from '../api/client.js';
import { Chip } from '../components/Chip.js';
import { Icon } from '../components/Icons.js';
import { ResultView } from '../components/ResultView.js';
import { SqlView } from '../components/Sql.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { WithProject } from '../components/WithProject.js';
import { toLocalDate } from '../lib/format.js';
import { useCatalog } from '../lib/hooks.js';

type Order = 'sequential' | 'strict' | 'any';
type Unit = 'minutes' | 'hours' | 'days';
type Run = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; result: FunnelResult } | { kind: 'error'; error: ApiError };

const ORDERS: ReadonlyArray<{ id: Order; label: string }> = [
  { id: 'sequential', label: 'Sequential' },
  { id: 'strict', label: 'Strict' },
  { id: 'any', label: 'Any' },
];

/** The catalog's overall span as two local dates, so the range starts wherever the data does. */
function defaultRange(catalog: EventCatalog): { from: string; to: string } {
  const firsts = catalog.events.map((e) => e.first_seen).sort();
  const lasts = catalog.events.map((e) => e.last_seen).sort();
  const from = toLocalDate(firsts[0], catalog.timezone) ?? '2026-08-01';
  const to = toLocalDate(lasts[lasts.length - 1], catalog.timezone) ?? '2026-08-31';
  return { from, to };
}

function Builder({ project, catalog }: { project: ProjectRow; catalog: EventCatalog }): JSX.Element {
  const names = useMemo(() => catalog.events.map((e) => e.event), [catalog]);
  const [steps, setSteps] = useState<string[]>(() => {
    const preferred = ['signup', 'create_project', 'invite_teammate'].filter((n) => names.includes(n));
    return preferred.length >= 2 ? preferred : names.slice(0, Math.max(2, Math.min(2, names.length)));
  });
  const [order, setOrder] = useState<Order>('sequential');
  const [windowValue, setWindowValue] = useState(14);
  const [windowUnit, setWindowUnit] = useState<Unit>('days');
  const [range, setRange] = useState(() => defaultRange(catalog));
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [collapsed, setCollapsed] = useState(false);
  const token = useRef(0);

  const canRun = steps.length >= 2 && steps.every((s) => names.includes(s));

  const spec = useMemo<FunnelSpec>(
    () => ({
      kind: 'funnel',
      project: project.project_id,
      range,
      where: [],
      steps: steps.map((event) => ({ event, where: [] })),
      order,
      window: { value: windowValue, unit: windowUnit },
    }),
    [project.project_id, range, steps, order, windowValue, windowUnit],
  );

  const execute = useCallback(() => {
    if (!canRun) return;
    const mine = ++token.current;
    setRun({ kind: 'loading' });
    api
      .funnel(spec)
      .then((result) => {
        if (mine === token.current) setRun({ kind: 'done', result });
      })
      .catch((err: unknown) => {
        if (mine === token.current) setRun({ kind: 'error', error: err instanceof ApiError ? err : new ApiError('network', 'the funnel failed') });
      });
  }, [canRun, spec]);

  const setStep = (i: number, event: string) => setSteps((s) => s.map((v, j) => (j === i ? event : v)));
  const addStep = () => setSteps((s) => (s.length < 10 ? [...s, names[0] ?? ''] : s));
  const removeStep = (i: number) => setSteps((s) => (s.length > 2 ? s.filter((_, j) => j !== i) : s));

  return (
    <div className={`cols${collapsed ? ' collapsed' : ''}`}>
      <div className="stack">
        <div className="panel">
          <div className="panel-h">
            <h2>Steps</h2>
            <Chip tone="faint">
              {steps.length} of 10
            </Chip>
            <span className="grow" />
            <button className="btn primary" onClick={execute} disabled={!canRun || run.kind === 'loading'}>
              <Icon name="i-play" />
              {run.kind === 'loading' ? 'Running…' : 'Run funnel'}
            </button>
          </div>
          <div className="steps" style={{ paddingTop: 16 }}>
            {steps.map((event, i) => (
              <div className="step" key={i}>
                <span className="n" style={{ background: `var(--c${(i % 6) + 1})` }}>
                  {i + 1}
                </span>
                <select value={event} onChange={(e) => setStep(i, e.target.value)} aria-label={`Step ${i + 1} event`}>
                  {names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button className="x" aria-label={`Remove step ${i + 1}`} onClick={() => removeStep(i)} disabled={steps.length <= 2}>
                  <Icon name="i-x" />
                </button>
              </div>
            ))}
            <button className="addstep" onClick={addStep} disabled={steps.length >= 10 || names.length === 0}>
              <Icon name="i-plus" />
              Add step · {names.length} events available
            </button>
          </div>
          <div className="builder" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="field">
              <label>Order</label>
              <div className="seg">
                {ORDERS.map((o) => (
                  <button key={o.id} aria-pressed={order === o.id} onClick={() => setOrder(o.id)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Conversion window</label>
              <div className="in">
                <input type="number" min={1} max={90} value={windowValue} onChange={(e) => setWindowValue(Math.max(1, Math.min(90, Number(e.target.value) || 1)))} aria-label="Window value" />
                <select value={windowUnit} onChange={(e) => setWindowUnit(e.target.value as Unit)} aria-label="Window unit">
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
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
                <span className="small faint" style={{ marginLeft: 'auto' }}>
                  project
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Result</h2>
            <Chip tone="faint">
              {order} · {windowValue} {windowUnit}
            </Chip>
          </div>
          {run.kind === 'idle' && <div className="ran-nothing">Set the steps and run to see the funnel and its SQL.</div>}
          {run.kind === 'loading' && <Skeleton />}
          {run.kind === 'done' && <ResultView result={run.result} />}
          {run.kind === 'error' && (
            <div style={{ padding: 16 }}>
              <StateCard variant="error" icon="i-db" title="The funnel could not run" raw={{ heading: 'Error', text: run.error.message }} actions={<button type="button" className="btn primary" onClick={execute}><Icon name="i-rotate" />Retry</button>}>
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
          {run.kind === 'done' ? <SqlView sql={run.result.sql} params={run.result.params} /> : <pre className="sqlpre faint">Run the funnel to see the exact SQL and its bound parameters.</pre>}
        </div>
      </aside>
    </div>
  );
}

function FunnelScreen({ project }: { project: ProjectRow }): JSX.Element {
  const { data, loading, error, reload } = useCatalog(project.project_id);
  // Re-key the builder on project so its steps/range reset when the project switches.
  const builderKey = project.project_id;

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
        The event catalog could not be read, so the step pickers cannot be built.
      </StateCard>
    );
  }
  if (!data || data.events.length === 0) {
    return (
      <StateCard variant="empty" title="No events yet">
        This project has no events, so there is nothing to funnel. Send a batch from Projects &amp; ingest first.
      </StateCard>
    );
  }
  return <Builder key={builderKey} project={project} catalog={data} />;
}

export function FunnelView(): JSX.Element {
  return (
    <section className="screen" aria-labelledby="h-funnel">
      <div className="screen-head">
        <div>
          <h1 id="h-funnel">Funnel</h1>
          <p>
            Build the spec by hand. Event pickers come from the catalog, so only real names can be chosen. The SQL on the right is the same compiler output the Ask screen shows.
          </p>
        </div>
      </div>
      <WithProject>{(project) => <FunnelScreen project={project} />}</WithProject>
    </section>
  );
}

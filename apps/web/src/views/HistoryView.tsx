/**
 * HistoryView.tsx — Ask history, the reviewer's screen (03-UI S6).
 *
 * Why it exists: design §4.2 L4 makes the audit log browsable — every ask is written before its result is
 * shown. This renders `GET /v1/asks`: one row per ask (time, question, decision, status, elapsed), and an
 * expanded row shows the model's raw output, the spec that survived and the SQL that ran. It is what makes
 * F2 verifiable — a refused ask leaves a row here with the raw output and no SQL.
 *
 * What it must never do: redact or reshape a row (the log is shown as written), or hide the decision — the
 * decision colour and word are the point.
 */
import { useState, type JSX } from 'react';
import type { AskRow, ProjectRow } from '@vantage/contracts';
import { Chip } from '../components/Chip.js';
import { Icon } from '../components/Icons.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { WithProject } from '../components/WithProject.js';
import { formatClock, formatElapsed } from '../lib/format.js';
import { highlightJson, highlightSql } from '../lib/highlight.js';
import { useAsks } from '../lib/hooks.js';

function AccordionBody({ row }: { row: AskRow }): JSX.Element {
  return (
    <div className="hist-body-in">
      <div className="cell raw">
        <h3>Raw model output</h3>
        <pre>{row.raw_output ?? '(none)'}</pre>
      </div>
      <div className="cell spec">
        <h3>Spec</h3>
        <pre dangerouslySetInnerHTML={{ __html: row.spec ? highlightJson(JSON.stringify(row.spec, null, 2)) : '(no spec — refused before one existed)' }} />
      </div>
      <div className="cell sql">
        <h3>SQL</h3>
        <pre dangerouslySetInnerHTML={{ __html: row.sql ? highlightSql(row.sql) : '(nothing ran)' }} />
      </div>
      <div className="small faint mono">
        adapter {row.adapter}
        {row.model ? ` · model ${row.model}` : ''}
        {row.error_code ? ` · ${row.error_code}` : ''}
      </div>
    </div>
  );
}

type Filter = 'all' | 'ran' | 'refused';
const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ran', label: 'Ran' },
  { id: 'refused', label: 'Refused' },
];

function HistoryTable({ project, rows }: { project: ProjectRow; rows: AskRow[] }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'ran' ? r.decision === 'ran' : r.decision !== 'ran'));
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Asks · newest first</h2>
        <Chip tone="faint">{rows.length} asks</Chip>
        <span className="grow" />
        <span className="small faint">expand a row for raw output · spec · SQL</span>
      </div>
      <div className="panel-b">
        <div className="hist-filters" role="group" aria-label="Filter asks by decision">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="chipbtn" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="hist-cols" aria-hidden="true">
          <span style={{ width: 64 }}>Time</span>
          <span className="grow">Question</span>
          <span style={{ width: 64 }}>Decision</span>
          <span style={{ width: 64 }}>Status</span>
          <span style={{ width: 56 }}>Elapsed</span>
          <span style={{ width: 14 }} />
        </div>
        <div className="hist-list">
          {shown.map((row) => {
            const isOpen = open === row.ask_id;
            const ran = row.decision === 'ran';
            return (
              <div className="hist-row" key={row.ask_id} data-open={isOpen}>
                <button type="button" className="hist-row-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : row.ask_id)}>
                  <span className="hist-time">{formatClock(row.asked_at, project.timezone, true)}</span>
                  <span className="hist-q">{row.question}</span>
                  <span className={`hist-dec pill ${ran ? 'good' : 'bad'} dot`} style={{ width: 64, justifyContent: 'center' }}>
                    {row.decision}
                  </span>
                  <span className="hist-status">{row.status ?? (ran ? 'complete' : '—')}</span>
                  <span className="hist-elapsed">{formatElapsed(row.elapsed_ms)}</span>
                  <Icon name="i-chev" className="i hist-chev" />
                </button>
                <div className="hist-body">
                  <div className="inner">{isOpen && <AccordionBody row={row} />}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function HistoryScreen({ project }: { project: ProjectRow }): JSX.Element {
  const { data, loading, error, reload } = useAsks(project.project_id);
  if (loading) {
    return (
      <div className="panel">
        <Skeleton />
      </div>
    );
  }
  if (error) {
    return (
      <StateCard variant="error" icon="i-db" title="Could not load Ask history" raw={{ heading: 'Error', text: error.message }} actions={<button type="button" className="btn primary" onClick={reload}><Icon name="i-rotate" />Retry</button>}>
        The audit log could not be read.
      </StateCard>
    );
  }
  if (!data || data.length === 0) {
    return (
      <StateCard variant="empty" title="No asks yet">
        Ask a question on the Ask screen and it is written here — whether it ran or was refused — before its result is shown.
      </StateCard>
    );
  }
  return <HistoryTable project={project} rows={data} />;
}

export function HistoryView(): JSX.Element {
  return (
    <section className="screen" aria-labelledby="h-history">
      <div className="screen-head">
        <div>
          <span className="eyebrow">07 · History</span>
          <h1 id="h-history">Ask history</h1>
          <p>Every ask is written before its result is shown: the question, the model’s raw text, the spec that survived, the SQL that ran, and how it ended. This is what you hand to a reviewer.</p>
        </div>
      </div>
      <WithProject>{(project) => <HistoryScreen project={project} />}</WithProject>
    </section>
  );
}

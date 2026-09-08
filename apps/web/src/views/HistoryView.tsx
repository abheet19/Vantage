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
import { Fragment, useState, type JSX } from 'react';
import type { AskRow, ProjectRow } from '@vantage/contracts';
import { Chip } from '../components/Chip.js';
import { Icon } from '../components/Icons.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { WithProject } from '../components/WithProject.js';
import { formatClock, formatElapsed } from '../lib/format.js';
import { highlightJson, highlightSql } from '../lib/highlight.js';
import { useAsks } from '../lib/hooks.js';

function ExpandedRow({ row }: { row: AskRow }): JSX.Element {
  return (
    <tr className="expand">
      <td colSpan={6}>
        <div className="grid3">
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
        </div>
        <div className="small faint mono" style={{ marginTop: 12 }}>
          adapter {row.adapter}
          {row.model ? ` · model ${row.model}` : ''}
          {row.error_code ? ` · ${row.error_code}` : ''}
        </div>
      </td>
    </tr>
  );
}

function HistoryTable({ project, rows }: { project: ProjectRow; rows: AskRow[] }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="panel">
      <div className="panel-h">
        <h2>Asks · newest first</h2>
        <Chip tone="faint">{rows.length} asks</Chip>
        <span className="grow" />
        <span className="small faint">expand a row for raw output · spec · SQL</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th className="r">Time</th>
              <th>Question</th>
              <th>Decision</th>
              <th>Status</th>
              <th className="r">Elapsed</th>
              <th aria-label="Expand" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpen = open === row.ask_id;
              return (
                <Fragment key={row.ask_id}>
                  <tr className="clickable" onClick={() => setOpen(isOpen ? null : row.ask_id)}>
                    <td className="r">{formatClock(row.asked_at, project.timezone, true)}</td>
                    <td>{row.question}</td>
                    <td>
                      <span className={`dec ${row.decision}`}>{row.decision}</span>
                    </td>
                    <td>{row.status ?? '—'}</td>
                    <td className="r">{formatElapsed(row.elapsed_ms)}</td>
                    <td className="r">
                      <button type="button" className="table-action" aria-label={`Details for ${row.question}`} aria-expanded={isOpen}>
                        <Icon name={isOpen ? 'i-chevd' : 'i-chev'} />
                      </button>
                    </td>
                  </tr>
                  {isOpen && <ExpandedRow row={row} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
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
          <h1 id="h-history">Ask history</h1>
          <p>Every ask is written before its result is shown: the question, the model’s raw text, the spec that survived, the SQL that ran, and how it ended. This is what you hand to a reviewer.</p>
        </div>
      </div>
      <WithProject>{(project) => <HistoryScreen project={project} />}</WithProject>
    </section>
  );
}

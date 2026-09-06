/**
 * QueryCard.tsx — the hero object: question → spec → SQL → result → footer, read top to bottom (design §1).
 *
 * Why it exists: 03-UI §3.1 S1 stacks the plain-English question, the violet spec block (with Edit spec),
 * the amber SQL block (Copy, the real `sql` and `params`) and the result so the eye reads
 * question → structure → proof before it reaches a number. A refusal replaces the spec/SQL/result with the
 * red card and the model's raw output, and "nothing ran" (design §4.2 L1: seeing the refusal is the demo).
 * Edit spec → change the window → re-run posts the edited spec to `/v1/{funnel,count,retention}` and shows
 * the SQL diff against the previous run (03-UI F3).
 *
 * What it must never do: claim the result answers the question — it says only what ran (the adversarial
 * case of a model misreading the question); or show a stale result under a new run's status (each re-run
 * replaces the current result and its footer together).
 */
import { useCallback, useMemo, useState, type JSX } from 'react';
import { type AskResponse, type InsightResult, QuerySpec } from '@vantage/contracts';
import { ApiError, api } from '../api/client.js';
import { highlightJson } from '../lib/highlight.js';
import { Chip } from './Chip.js';
import { CopyButton } from './CopyButton.js';
import { Icon } from './Icons.js';
import { ResultView } from './ResultView.js';
import { SqlView } from './Sql.js';
import { StateCard } from './StateCard.js';

const WINDOWS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 14, label: '14 days' },
  { value: 7, label: '7 days' },
  { value: 1, label: '1 day' },
];

interface Run {
  spec: QuerySpec;
  result: InsightResult;
}

function pretty(spec: unknown): string {
  return JSON.stringify(spec, null, 2);
}

/** The "ran" branch: spec + SQL + result, with Edit spec → re-run and the SQL diff. */
function RanCard({ initial }: { initial: Run }): JSX.Element {
  const [run, setRun] = useState<Run>(initial);
  const [diffBase, setDiffBase] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [specText, setSpecText] = useState(() => pretty(initial.spec));
  const [specError, setSpecError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sql = run.result.sql;
  const params = run.result.params;
  const specJson = useMemo(() => pretty(run.spec), [run.spec]);

  const setWindow = useCallback((value: number) => {
    setSpecText((text) => {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        parsed['window'] = { value, unit: 'days' };
        return pretty(parsed);
      } catch {
        return text;
      }
    });
  }, []);

  const rerun = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(specText);
    } catch {
      setSpecError('The edited spec is not valid JSON.');
      return;
    }
    const check = QuerySpec.safeParse(parsed);
    if (!check.success) {
      const issue = check.error.issues[0];
      setSpecError(`Not a valid spec: ${issue ? `${issue.path.join('.') || '(root)'} — ${issue.message}` : 'unknown error'}`);
      return;
    }
    const spec = check.data;
    if (spec.kind === 'trend' || spec.kind === 'paths') {
      setSpecError('Trend and paths specs cannot be run in this build; they arrive in slice S6.');
      return;
    }
    setBusy(true);
    setSpecError(null);
    try {
      const result: InsightResult = spec.kind === 'funnel' ? await api.funnel(spec) : spec.kind === 'count' ? await api.count(spec) : await api.retention(spec);
      setDiffBase(run.result.sql);
      setRun({ spec, result });
      setEditing(false);
    } catch (err) {
      setSpecError(err instanceof ApiError ? err.message : 'The re-run failed.');
    } finally {
      setBusy(false);
    }
  }, [specText, run.result.sql]);

  return (
    <>
      {/* spec block (violet) */}
      <div className="qblock spec">
        <div className="bar" />
        <div className="body">
          <div className="bh">
            <h3>Spec · {run.spec.kind}</h3>
            <Chip tone="faint">the query that ran, not a guaranteed answer</Chip>
            {!editing && (
              <button type="button" className="btn sm violet" onClick={() => { setSpecText(pretty(run.spec)); setEditing(true); }}>
                <Icon name="i-edit" />
                Edit spec
              </button>
            )}
          </div>
          {!editing ? (
            <pre dangerouslySetInnerHTML={{ __html: highlightJson(specJson) }} />
          ) : (
            <div>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="small muted">Conversion window</span>
                <span className="win">
                  {WINDOWS.map((w) => (
                    <button type="button" key={w.value} onClick={() => setWindow(w.value)}>
                      {w.label}
                    </button>
                  ))}
                </span>
                <span className="grow" />
                <button type="button" className="btn sm primary" onClick={() => void rerun()} disabled={busy}>
                  <Icon name="i-play" />
                  {busy ? 'Running…' : 'Re-run'}
                </button>
                <button type="button" className="btn sm ghost" onClick={() => { setEditing(false); setSpecError(null); }}>
                  Cancel
                </button>
              </div>
              <textarea className="specedit" aria-label="Edit spec JSON" spellCheck={false} value={specText} onChange={(e) => setSpecText(e.target.value)} />
              {specError && <div className="specerr" role="alert">{specError}</div>}
            </div>
          )}
        </div>
      </div>
      {/* SQL block (amber) */}
      <div className="qblock sql">
        <div className="bar" />
        <div className="body">
          <div className="bh">
            <h3>SQL · what actually ran</h3>
            <Chip tone="faint">role vantage_reader · READ ONLY · timeout 5 s</Chip>
            <span className="grow" />
            <CopyButton text={sql} />
          </div>
          <SqlView sql={sql} params={params} {...(diffBase !== null ? { diffAgainst: diffBase } : {})} className="sqlpre" />
        </div>
      </div>
      {/* result */}
      <div className="slide">
        <ResultView result={run.result} />
      </div>
    </>
  );
}

export function QueryCard({ question, response, onRetry }: { question: string; response: AskResponse; onRetry: () => void }): JSX.Element {
  const { decision, spec, result, raw_output, error } = response;
  return (
    <div className="panel qcard" data-testid="query-card">
      {/* question */}
      <div className="qblock">
        <div className="bar" />
        <div className="body">
          <div className="question">
            <span className="lead">Question</span>
            {question}
          </div>
          <div className="small faint" style={{ marginTop: 8 }}>
            Vantage shows the query that ran — read the spec and SQL to see exactly what it asked.
          </div>
        </div>
      </div>

      {decision === 'ran' && spec && result ? (
        <RanCard initial={{ spec, result }} />
      ) : decision === 'refused' ? (
        <div>
          <StateCard variant="refused" title="Refused" chip={<Chip tone="bad" role="alert">⊘ Refused</Chip>} raw={{ heading: 'Raw model output', text: raw_output ?? '(the model returned nothing)' }}>
            The model’s output is not a query the grammar can express. No SQL was compiled; no connection was used. It is logged to Ask history.
          </StateCard>
          <div className="ran-nothing">
            <Icon name="i-lock" />
            Nothing ran · 0 statements · 0 rows read
          </div>
        </div>
      ) : decision === 'refused_by_database' ? (
        <StateCard variant="refused" icon="i-db" title="Refused by the database" chip={<Chip tone="bad" role="alert">⊘ Refused by the database</Chip>} {...(error ? { raw: { heading: 'Error', text: `${error.code}: ${error.message}` } } : {})}>
          A read the reader role is not granted was attempted. This should be impossible; it has been logged as a bug.
        </StateCard>
      ) : (
        <StateCard
          variant="error"
          icon="i-warn"
          title="Something went wrong"
          chip={<Chip tone="bad" role="alert">■ Error</Chip>}
          {...(error ? { raw: { heading: 'Error', text: `${error.code}: ${error.message}` } } : {})}
          actions={<button type="button" className="btn primary" onClick={onRetry}><Icon name="i-rotate" />Retry</button>}
        >
          The model, the catalog read or the database failed before a number existed. Nothing partial is shown.
        </StateCard>
      )}
    </div>
  );
}

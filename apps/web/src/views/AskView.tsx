/**
 * AskView.tsx — the hero screen: ask a question, watch it become a spec, SQL and a number (03-UI S1, F1/F2).
 *
 * Why it exists: this is `POST /v1/ask` wired to the query card. It never infers success from the 200 —
 * it reads `decision` and hands the whole response to the card, which renders the run or the refusal.
 * Before each ask it clears the previous response and shows a result-panel skeleton (never a skeleton over
 * the question), so a slow or failing ask can never leave a stale number under a new status (LLD §9 S5). A
 * transport failure (the API down mid-request) becomes the red error card with Retry, distinct from an
 * `empty` result (design §1.3).
 *
 * What it must never do: submit a question the API would 422 (it disables Ask for an empty one) or keep a
 * superseded response on screen (a request token drops out-of-order answers).
 */
import { useCallback, useRef, useState, type JSX } from 'react';
import type { AskResponse, ProjectRow } from '@vantage/contracts';
import { ApiError, api } from '../api/client.js';
import { Chip } from '../components/Chip.js';
import { Icon } from '../components/Icons.js';
import { QueryCard } from '../components/QueryCard.js';
import { Skeleton, StateCard } from '../components/StateCard.js';
import { WithProject } from '../components/WithProject.js';

const EXAMPLES: readonly string[] = [
  'Of the people who signed up in August, how many created a project within a week, and how many of those invited someone?',
  'How many people signed up in August?',
  'Show the strict funnel from signup to create_project to invite_teammate for August',
];

type Phase = { kind: 'idle' } | { kind: 'loading'; question: string } | { kind: 'done'; question: string; response: AskResponse } | { kind: 'error'; question: string; error: ApiError };

function AskScreen({ project }: { project: ProjectRow }): JSX.Element {
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const token = useRef(0);

  const run = useCallback(
    (question: string) => {
      const q = question.trim();
      if (!q) return;
      const mine = ++token.current;
      setPhase({ kind: 'loading', question: q });
      api
        .ask({ project: project.project_id, question: q })
        .then((response) => {
          if (mine === token.current) setPhase({ kind: 'done', question: q, response });
        })
        .catch((err: unknown) => {
          if (mine === token.current) setPhase({ kind: 'error', question: q, error: err instanceof ApiError ? err : new ApiError('network', 'the ask failed') });
        });
    },
    [project.project_id],
  );

  return (
    <>
      <div className="ask glass" role="search">
        <Icon name="i-ask" style={{ color: 'var(--accent)' }} />
        <input
          className="q"
          aria-label="Ask a question"
          placeholder="Ask about signups, projects, invitations…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') run(input);
          }}
        />
        <button className="go" onClick={() => run(input)} disabled={input.trim().length === 0}>
          <Icon name="i-play" />
          Ask
        </button>
      </div>
      <div className="chips glass">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            className="ex"
            onClick={() => {
              setInput(ex);
              run(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>

      {phase.kind === 'loading' && (
        <div className="panel qcard" data-testid="ask-loading">
          <div className="qblock">
            <div className="bar" />
            <div className="body">
              <div className="question">
                <span className="lead">Question</span>
                {phase.question}
              </div>
            </div>
          </div>
          <Skeleton />
          <div className="status-foot">
            <Chip tone="dim" role="status">
              ◌ Running
            </Chip>
            <span className="sep" />
            role vantage_reader
            <span className="sep" />
            statement_timeout 5 s
          </div>
        </div>
      )}

      {phase.kind === 'done' && <QueryCard question={phase.question} response={phase.response} onRetry={() => run(phase.question)} />}

      {phase.kind === 'error' && (
        <StateCard
          variant="error"
          icon="i-db"
          title="The ask could not reach the API"
          raw={{ heading: 'Error', text: phase.error.message }}
          actions={
            <button type="button" className="btn primary" onClick={() => run(phase.question)}>
              <Icon name="i-rotate" />
              Retry
            </button>
          }
        >
          The request did not complete. Nothing partial is shown, and nothing was assumed to have run.
        </StateCard>
      )}
    </>
  );
}

export function AskView(): JSX.Element {
  return (
    <section className="screen" aria-labelledby="h-ask">
      <div className="screen-head">
        <div>
          <h1 id="h-ask">Ask</h1>
          <p>A plain-English question becomes a typed spec, the spec becomes SQL, the SQL becomes a number. Read it in that order.</p>
        </div>
      </div>
      <WithProject>{(project) => <AskScreen project={project} />}</WithProject>
    </section>
  );
}

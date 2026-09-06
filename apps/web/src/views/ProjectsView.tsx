/**
 * ProjectsView.tsx — create and list projects, rotate a key, show how to ingest, and try an ingest live (03-UI S7).
 *
 * Why it exists: an operator needs a project (and its one-time API key) before anything can be ingested or
 * asked. This creates a project via `POST /v1/projects`, showing the returned `api_key` exactly once (the
 * database keeps only its sha256 — projects.ts), with the curl / PowerShell / JS ingest snippet carrying that
 * key. A **rotate** control mints a NEW key and shows it once (the old one stops working) — rotation cannot
 * reveal the stored key, because only its sha256 exists, so the card that appears is always a fresh key, never
 * a recovered one. The "Try it" panel posts a small batch through the very `POST /v1/events` path the snippet
 * shows (F7: accepted / duplicate counts render; sending twice dedupes), and `POST /v1/identify` merges the
 * two demo persons the batch created (F8: the merge notice). Query routes need no key, so the key appears only
 * where ingest does.
 *
 * What it must never do: claim to reveal a stored key — only a freshly created or rotated key is shown, once;
 * or put the key anywhere but the Authorization header (client.ts), never a URL.
 */
import { useCallback, useMemo, useState, type JSX } from 'react';
import type { IdentifyResponse, IngestBatch, IngestResponse, ProjectCreated } from '@vantage/contracts';
import { ApiError, api } from '../api/client.js';
import { Chip } from '../components/Chip.js';
import { CopyButton } from '../components/CopyButton.js';
import { Icon } from '../components/Icons.js';
import { formatDateTime } from '../lib/format.js';
import { useProject } from '../state/ProjectContext.js';

/** The loopback API the operator runs (LLD D4); the SPA reaches it through Vite's proxy, but a terminal snippet needs the real origin. */
const API_BASE = 'http://127.0.0.1:4100';

/** Two demo distinct ids so the batch creates two persons the Identify action can then merge (F8). */
const ANON_ID = 'anon_demo';
const USER_ID = 'user_demo';

/** A small, fixed batch: stable insert_ids so a second send dedupes to duplicates (F7), and two distinct ids to merge (F8). */
const TEST_BATCH: IngestBatch = {
  events: [
    { event: 'signup', distinct_id: ANON_ID, insert_id: 'vantage-demo-1', properties: { plan: 'team' } },
    { event: 'create_project', distinct_id: ANON_ID, insert_id: 'vantage-demo-2' },
    { event: 'signup', distinct_id: USER_ID, insert_id: 'vantage-demo-3', properties: { plan: 'free' } },
  ],
};

type Tab = 'curl' | 'ps' | 'js';

function ingestSnippet(tab: Tab, key: string): string {
  const apiKey = key || '<YOUR_API_KEY>';
  if (tab === 'curl') {
    return [
      `curl -X POST ${API_BASE}/v1/events \\`,
      `  -H "authorization: Bearer ${apiKey}" \\`,
      `  -H "content-type: application/json" \\`,
      `  -d '{"events":[{"event":"signup","distinct_id":"user_1","insert_id":"evt_1","properties":{"plan":"team"}}]}'`,
    ].join('\n');
  }
  if (tab === 'ps') {
    return [
      `$body = @{ events = @(@{ event = 'signup'; distinct_id = 'user_1'; insert_id = 'evt_1'; properties = @{ plan = 'team' } }) } | ConvertTo-Json -Depth 6`,
      `Invoke-RestMethod -Method Post -Uri ${API_BASE}/v1/events \``,
      `  -Headers @{ Authorization = 'Bearer ${apiKey}' } -ContentType application/json -Body $body`,
    ].join('\n');
  }
  return [
    `await fetch("${API_BASE}/v1/events", {`,
    `  method: "POST",`,
    `  headers: { authorization: "Bearer ${apiKey}", "content-type": "application/json" },`,
    `  body: JSON.stringify({ events: [`,
    `    { event: "signup", distinct_id: "user_1", insert_id: crypto.randomUUID(), properties: { plan: "team" } },`,
    `  ] }),`,
    `});`,
  ].join('\n');
}

export function ProjectsView(): JSX.Element {
  const { projects, current, reload, selectProject } = useProject();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [created, setCreated] = useState<ProjectCreated | null>(null);
  const [rotated, setRotated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('curl');

  // The "Try it" panel: results of the two authenticated calls, and any error either returned.
  const [ingestResp, setIngestResp] = useState<IngestResponse | null>(null);
  const [identifyResp, setIdentifyResp] = useState<IdentifyResponse | null>(null);
  const [tryBusy, setTryBusy] = useState<'idle' | 'ingest' | 'identify'>('idle');
  const [tryError, setTryError] = useState<string | null>(null);

  const keyForSnippet = created?.api_key ?? '';
  const snippet = useMemo(() => ingestSnippet(tab, keyForSnippet), [tab, keyForSnippet]);

  const create = useCallback(async () => {
    if (name.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({ name: name.trim(), timezone: timezone.trim() });
      setCreated(project);
      setRotated(false);
      setName('');
      setIngestResp(null);
      setIdentifyResp(null);
      setTryError(null);
      reload();
      selectProject(project.project_id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the project.');
    } finally {
      setBusy(false);
    }
  }, [name, timezone, reload, selectProject]);

  const rotate = useCallback(
    async (projectId: string) => {
      setBusy(true);
      setError(null);
      try {
        const project = await api.rotateKey(projectId);
        setCreated(project);
        setRotated(true);
        setIngestResp(null);
        setIdentifyResp(null);
        setTryError(null);
        selectProject(projectId);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not rotate the key.');
      } finally {
        setBusy(false);
      }
    },
    [selectProject],
  );

  const sendBatch = useCallback(async () => {
    if (!created?.api_key) return;
    setTryBusy('ingest');
    setTryError(null);
    try {
      setIngestResp(await api.ingest(created.api_key, TEST_BATCH));
    } catch (err) {
      setTryError(err instanceof ApiError ? err.message : 'The batch could not be sent.');
    } finally {
      setTryBusy('idle');
    }
  }, [created]);

  const runIdentify = useCallback(async () => {
    if (!created?.api_key) return;
    setTryBusy('identify');
    setTryError(null);
    try {
      setIdentifyResp(await api.identify(created.api_key, { anonymous_id: ANON_ID, user_id: USER_ID }));
    } catch (err) {
      setTryError(err instanceof ApiError ? err.message : 'Identify failed.');
    } finally {
      setTryBusy('idle');
    }
  }, [created]);

  return (
    <section className="screen" aria-labelledby="h-projects">
      <div className="screen-head">
        <div>
          <h1 id="h-projects">Projects &amp; ingest</h1>
          <p>One project per product. The API key only ingests; queries need no key. The same event delivered twice counts once.</p>
        </div>
      </div>

      <div className="cols" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <div className="stack">
          <div className="panel">
            <div className="panel-h">
              <h2>New project</h2>
              <Chip tone="faint">POST /v1/projects</Chip>
            </div>
            <div className="panel-b stack" style={{ gap: 12 }}>
              <div className="field">
                <label htmlFor="proj-name">Name</label>
                <div className="in">
                  <input id="proj-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Demo product" />
                </div>
              </div>
              <div className="field">
                <label htmlFor="proj-tz">Timezone (IANA)</label>
                <div className={`in${error ? ' err' : ''}`}>
                  <input id="proj-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Kolkata" />
                </div>
              </div>
              {error && (
                <div className="specerr" role="alert">
                  {error}
                </div>
              )}
              <div className="row">
                <button className="btn primary" onClick={() => void create()} disabled={busy || name.trim().length === 0}>
                  <Icon name="i-plus" />
                  {busy ? 'Working…' : 'Create project'}
                </button>
              </div>
            </div>
          </div>

          {created && (
            <div className="panel pcard" data-testid="created-key">
              <div className="row">
                <span className="dot" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--c4)' }} />
                <span className="name">{created.name}</span>
                <Chip tone="faint">{created.project_id.slice(0, 13)}…</Chip>
                {rotated && <Chip tone="warn">key rotated</Chip>}
              </div>
              <div className="notice warn" style={{ margin: 0 }}>
                <Icon name="i-lock" />
                <div>
                  <b>Copy this API key now.</b> It is shown once; the database keeps only its sha256, so it cannot be revealed again. {rotated ? 'The previous key has stopped working.' : 'Rotate it below if it ever leaks.'}
                </div>
              </div>
              <div className="keys">
                <div className="keyrow">
                  <Icon name="i-lock" className="i faint" />
                  <code data-testid="api-key">{created.api_key}</code>
                </div>
                <span className="grow" />
                <CopyButton text={created.api_key} label="Copy key" />
                <button className="btn sm" onClick={() => void rotate(created.project_id)} disabled={busy} data-testid="rotate-current">
                  <Icon name="i-rotate" />
                  Rotate key
                </button>
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-h">
              <div className="tabs">
                <button aria-selected={tab === 'curl'} onClick={() => setTab('curl')}>
                  curl
                </button>
                <button aria-selected={tab === 'ps'} onClick={() => setTab('ps')}>
                  PowerShell
                </button>
                <button aria-selected={tab === 'js'} onClick={() => setTab('js')}>
                  JS
                </button>
              </div>
            </div>
            <div className="panel-b">
              <div className="snippet">
                <CopyButton text={snippet} className="btn sm copy" />
                <pre data-testid="ingest-snippet">{snippet}</pre>
              </div>
              {!created && <p className="small faint" style={{ marginTop: 8 }}>Create a project above to drop its real key into this snippet.</p>}
            </div>
          </div>

          <div className="panel" data-testid="try-it">
            <div className="panel-h">
              <h2>Try it</h2>
              <Chip tone="faint">POST /v1/events · /v1/identify</Chip>
            </div>
            <div className="panel-b stack" style={{ gap: 12 }}>
              {!created ? (
                <p className="small faint" style={{ margin: 0 }}>Create or rotate a project above to get a key, then send a batch through the real ingest path.</p>
              ) : (
                <>
                  <p className="small faint" style={{ margin: 0 }}>
                    Sends three events (two demo persons) with this project's key through <code>POST /v1/events</code> — the same path the snippet shows. Send twice to watch <code>UNIQUE (project_id, insert_id)</code> absorb the retry.
                  </p>
                  <div className="row">
                    <button className="btn sm primary" onClick={() => void sendBatch()} disabled={tryBusy !== 'idle'} data-testid="send-batch">
                      <Icon name="i-play" />
                      {tryBusy === 'ingest' ? 'Sending…' : 'Send test batch'}
                    </button>
                    <button className="btn sm" onClick={() => void runIdentify()} disabled={tryBusy !== 'idle' || !ingestResp} data-testid="identify" title={ingestResp ? 'Merge anon_demo into user_demo' : 'Send the batch first so both persons exist'}>
                      <Icon name="i-merge" />
                      {tryBusy === 'identify' ? 'Identifying…' : 'Identify anon → user'}
                    </button>
                  </div>
                  {tryError && (
                    <div className="specerr" role="alert">
                      {tryError}
                    </div>
                  )}
                  {ingestResp && (
                    <div className="resp" data-testid="ingest-resp">
                      <div className="kpi acc">
                        <div className="v" data-testid="accepted">{ingestResp.accepted}</div>
                        <div className="l">accepted</div>
                      </div>
                      <div className="kpi dup">
                        <div className="v" data-testid="duplicates">{ingestResp.duplicates}</div>
                        <div className="l">duplicates (same insert_id)</div>
                      </div>
                      <div className="kpi">
                        <div className="v">{ingestResp.too_old}</div>
                        <div className="l">too old</div>
                      </div>
                    </div>
                  )}
                  {ingestResp && ingestResp.duplicates > 0 && (
                    <div className="notice warn" role="status" style={{ margin: 0 }}>
                      <Icon name="i-info" />
                      <div>
                        <b>Ignored {ingestResp.duplicates} duplicate event(s).</b> A retry was absorbed by <code>UNIQUE (project_id, insert_id)</code>; the events count once.
                      </div>
                    </div>
                  )}
                  {identifyResp && (
                    <div className="notice info" role="status" style={{ margin: 0 }} data-testid="merge-notice">
                      <Icon name="i-merge" />
                      <div>
                        {identifyResp.merged ? (
                          <>
                            <b>Merged persons.</b> <code>{ANON_ID}</code> and <code>{USER_ID}</code> were both known; {identifyResp.distinct_ids_moved} distinct id(s) repointed to the surviving person (<code>{identifyResp.person_id.slice(0, 13)}…</code>). Recorded in <code>person_merges</code>. Funnels over this range will change by 1 person.
                          </>
                        ) : (
                          <>
                            <b>No merge needed.</b> <code>{ANON_ID}</code> and <code>{USER_ID}</code> already resolve to the one person (<code>{identifyResp.person_id.slice(0, 13)}…</code>); nothing was repointed.
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-h">
            <h2>Projects</h2>
            <Chip tone="faint">{projects.length}</Chip>
            <span className="grow" />
            <button className="btn sm" onClick={reload}>
              <Icon name="i-rotate" />
              Refresh
            </button>
          </div>
          {projects.length === 0 ? (
            <div className="ran-nothing">No projects yet — create one on the left.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Timezone</th>
                  <th className="r">Created</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.project_id} className={`clickable${current?.project_id === p.project_id ? ' sel' : ''}`} onClick={() => selectProject(p.project_id)}>
                    <td>{p.name}</td>
                    <td>
                      <code>{p.timezone}</code>
                    </td>
                    <td className="r">{formatDateTime(p.created_at, p.timezone)}</td>
                    <td className="r">
                      <button
                        className="btn sm ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void rotate(p.project_id);
                        }}
                        disabled={busy}
                        title="Mint a new key for this project (the old one stops working)"
                      >
                        <Icon name="i-rotate" />
                        Rotate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}

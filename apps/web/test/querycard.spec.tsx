import type { AskResponse, FunnelSpec, InsightResult, PathsSpec, QuerySpec, TrendSpec } from '@vantage/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryCard } from '../src/components/QueryCard.js';
import { funnelResult, pathsResult, timedOutFunnel, trendResult } from './fixtures.js';

const SPEC: FunnelSpec = {
  kind: 'funnel',
  project: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  range: { from: '2026-08-01', to: '2026-08-31' },
  where: [],
  steps: [
    { event: 'signup', where: [] },
    { event: 'create_project', where: [] },
    { event: 'invite_teammate', where: [] },
  ],
  order: 'sequential',
  window: { value: 14, unit: 'days' },
};

function ranResponse(): AskResponse {
  return {
    ask_id: '22222222-2222-4222-8222-222222222222',
    decision: 'ran',
    raw_output: JSON.stringify(SPEC),
    spec: SPEC,
    result: funnelResult({ sql: "SELECT 1\ninterval '14 days'\nFROM e" }),
    error: null,
  };
}

function ranInsightResponse(spec: QuerySpec, result: InsightResult): AskResponse {
  return {
    ask_id: '66666666-6666-4666-8666-666666666666',
    decision: 'ran',
    raw_output: JSON.stringify(spec),
    spec,
    result,
    error: null,
  };
}

const TREND_SPEC: TrendSpec = {
  kind: 'trend',
  project: SPEC.project,
  range: SPEC.range,
  where: [],
  event: { event: 'signup', where: [] },
  measure: 'events',
  unit: 'day',
};

const PATHS_SPEC: PathsSpec = {
  kind: 'paths',
  project: SPEC.project,
  range: SPEC.range,
  where: [],
  start: 'signup',
  steps: 3,
  session_gap_minutes: 30,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('QueryCard — the ran case', () => {
  it('stacks question → spec → SQL → result in that order', () => {
    const { container } = render(<QueryCard question="the demo question" response={ranResponse()} onRetry={() => undefined} />);
    const html = container.innerHTML;
    const spec = html.indexOf('qblock spec');
    const sql = html.indexOf('qblock sql');
    const result = container.querySelector('[data-testid="funnel-bars"]');
    expect(spec).toBeGreaterThan(-1);
    expect(sql).toBeGreaterThan(spec);
    expect(result).not.toBeNull();
    expect(screen.getByTestId('sql-text').textContent).toContain("interval '14 days'");
  });

  it('frames the output as the query that ran, never as an answer to the question', () => {
    const { container } = render(<QueryCard question="misread me" response={ranResponse()} onRetry={() => undefined} />);
    expect(container.textContent).toContain('the query that ran');
    expect(container.textContent).not.toContain('answer to your question');
  });

  it('Edit spec → change the window → re-run shows a SQL diff and the new SQL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(funnelResult({ sql: "SELECT 1\ninterval '7 days'\nFROM e" })), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<QueryCard question="q" response={ranResponse()} onRetry={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: /edit spec/i }));
    await userEvent.click(screen.getByRole('button', { name: '7 days' }));
    await userEvent.click(screen.getByRole('button', { name: /re-run/i }));

    await waitFor(() => expect(screen.getByTestId('sql-text').textContent).toContain("interval '7 days'"));
    expect(fetchMock).toHaveBeenCalledWith('/v1/funnel', expect.objectContaining({ method: 'POST' }));
    const pre = screen.getByTestId('sql-text');
    expect(pre.querySelector('.add')).not.toBeNull();
    expect(pre.querySelector('.del')).not.toBeNull();
  });

  it('a re-run that times out replaces the previous number — no stale count under the new footer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(timedOutFunnel()), { status: 200, headers: { 'content-type': 'application/json' } })));
    render(<QueryCard question="q" response={ranResponse()} onRetry={() => undefined} />);
    expect(screen.getByTestId('funnel-bars')).toBeInTheDocument(); // the first run's number is on screen
    await userEvent.click(screen.getByRole('button', { name: /edit spec/i }));
    await userEvent.click(screen.getByRole('button', { name: /re-run/i }));
    await waitFor(() => expect(screen.getByTestId('state-timeout')).toBeInTheDocument());
    expect(screen.queryByTestId('funnel-bars')).toBeNull(); // the stale number is gone, not sitting under a "stopped" footer
  });

  it('refuses to re-run an edited spec that is not valid JSON, and does not call the API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<QueryCard question="q" response={ranResponse()} onRetry={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: /edit spec/i }));
    fireEvent.change(screen.getByLabelText('Edit spec JSON'), { target: { value: 'not json' } });
    await userEvent.click(screen.getByRole('button', { name: /re-run/i }));
    expect(screen.getByRole('alert')).toHaveTextContent('not valid JSON');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the API error inline when a valid re-run is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 'BUSY', message: 'the reader is busy' }), { status: 503, headers: { 'content-type': 'application/json' } })));
    render(<QueryCard question="q" response={ranResponse()} onRetry={() => undefined} />);
    await userEvent.click(screen.getByRole('button', { name: /edit spec/i }));
    await userEvent.click(screen.getByRole('button', { name: /re-run/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('the reader is busy'));
  });

  it.each([
    { name: 'trend', route: '/v1/trend', spec: TREND_SPEC, result: trendResult() },
    { name: 'paths', route: '/v1/paths', spec: PATHS_SPEC, result: pathsResult() },
  ])('re-runs an edited $name spec through its matching endpoint', async ({ route, spec, result }) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<QueryCard question="q" response={ranInsightResponse(spec, result)} onRetry={() => undefined} />);

    await userEvent.click(screen.getByRole('button', { name: /edit spec/i }));
    await userEvent.click(screen.getByRole('button', { name: /re-run/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(route, expect.objectContaining({ method: 'POST' })));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('QueryCard — refusals and errors', () => {
  it('a refused ask shows the raw model output and that nothing ran', () => {
    const response: AskResponse = {
      ask_id: '33333333-3333-4333-8333-333333333333',
      decision: 'refused',
      raw_output: 'DROP TABLE events;',
      spec: null,
      result: null,
      error: { code: 'NOT_JSON', message: 'not a query the grammar can express' },
    };
    const { container } = render(<QueryCard question="drop the events table" response={response} onRetry={() => undefined} />);
    expect(screen.getByTestId('state-refused')).toBeInTheDocument();
    expect(container.textContent).toContain('DROP TABLE events;');
    expect(container.textContent).toContain('Nothing ran');
    expect(container.querySelector('[data-testid="funnel-bars"]')).toBeNull();
  });

  it('a refused_by_database ask shows the red refused-by-database card', () => {
    const response: AskResponse = {
      ask_id: '55555555-5555-4555-8555-555555555555',
      decision: 'refused_by_database',
      raw_output: null,
      spec: null,
      result: null,
      error: { code: 'REFUSED_BY_DATABASE', message: 'permission denied for table events' },
    };
    const { container } = render(<QueryCard question="q" response={response} onRetry={() => undefined} />);
    expect(screen.getByTestId('state-refused')).toHaveTextContent('Refused by the database');
    expect(container.textContent).toContain('permission denied for table events');
  });

  it('an error ask shows the message and a Retry that calls back', async () => {
    const onRetry = vi.fn();
    const response: AskResponse = {
      ask_id: '44444444-4444-4444-8444-444444444444',
      decision: 'error',
      raw_output: null,
      spec: null,
      result: null,
      error: { code: 'INTERNAL', message: 'the catalog read failed' },
    };
    render(<QueryCard question="q" response={response} onRetry={onRetry} />);
    expect(screen.getByTestId('state-error')).toHaveTextContent('the catalog read failed');
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

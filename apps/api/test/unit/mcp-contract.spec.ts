/**
 * mcp-contract.spec.ts — the MCP contract without a database: the eight names and annotations (V13's static half), descriptions
 * with no imperative addressed to the model (design §5.3), the JSON Schema each Zod object becomes on the wire, the compact
 * `content` text with the SQL fenced, the error mapper's closed set of codes, and the `VANTAGE_EXPOSE_PLANS` reader (D3).
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { MCP_TOOLS, MCP_TOOL_ANNOTATIONS, MCP_TOOL_NAMES, McpToolError, type FunnelResult, type PathsResult, type RetentionResult, type ResultMeta, type TrendResult } from '@vantage/contracts';
import { describe, expect, it, vi } from 'vitest';
import { BusyError } from '../../src/infra/query-runner.js';
import { McpToolFailure, toToolError } from '../../src/modules/mcp/mcp-errors.js';
import { loadMcpOptions } from '../../src/modules/mcp/mcp-options.js';
import { apiVersion, toolDefinition } from '../../src/modules/mcp/mcp-server.factory.js';
import { errorText, renderText } from '../../src/modules/mcp/mcp-text.js';

const META: ResultMeta = { status: 'complete', computed_at: '2026-09-05T10:00:00.000Z', data_until: '2026-08-31T18:45:00.000Z', elapsed_ms: 9, incomplete_buckets: 0, ts_adjusted_share: 0, persons_merged_since: 1, timezone: 'Asia/Kolkata', row_cap: 10_000 };
const FUNNEL: FunnelResult = {
  steps: [{ event: 'signup', persons: 13, pct_of_previous: null, pct_of_start: 1 }, { event: 'create_project', persons: 8, pct_of_previous: 8 / 13, pct_of_start: 8 / 13 }],
  median_time_to_convert_s: 91_500,
  breakdown: null,
  sql: 'WITH e AS (SELECT 1)\nSELECT 1',
  params: ['11111111-1111-4111-8111-111111111111', '2026-08-01'],
  meta: META,
};

describe('the tool table (design §5.1, LLD §6)', () => {
  it('lists exactly the eight names, in the design order, once each', () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES]);
    expect(new Set(MCP_TOOL_NAMES).size).toBe(8);
    expect(MCP_TOOL_NAMES).not.toContain('run_sql');
    expect(MCP_TOOL_NAMES).not.toContain('ask');
  });

  it('every tool is advertised read-only, non-destructive, idempotent and closed-world', () => {
    expect(MCP_TOOL_ANNOTATIONS).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    for (const t of MCP_TOOLS) expect(toolDefinition(t).annotations).toEqual(MCP_TOOL_ANNOTATIONS);
  });

  it.each(MCP_TOOLS.map((t) => [t.name, t.description]))('%s has a fixed declarative description with no imperative addressed to the model', (_name, description) => {
    expect(description.length).toBeGreaterThan(40);
    expect(description).not.toMatch(/\b(you|your|must|should|always|ignore|instructions?|please|do not|don't)\b/i);
    expect(description).not.toMatch(/<[a-z]+>|\u200B|\u00A0/); // no markup, no zero-width or non-breaking characters hiding text
  });

  it('run_trend and run_paths describe the query they run (S6 delivered them; no NOT_IMPLEMENTED left)', () => {
    expect(MCP_TOOLS.find((t) => t.name === 'run_trend')!.description).toMatch(/trend/i);
    expect(MCP_TOOLS.find((t) => t.name === 'run_paths')!.description).toMatch(/transitions/i);
    for (const t of MCP_TOOLS) expect(t.description).not.toContain('NOT_IMPLEMENTED');
  });
});

describe('the wire definition of each tool', () => {
  it.each(MCP_TOOLS.map((t) => [t.name, t]))('%s converts to JSON Schema draft-07 objects with the name, description and annotations', (_name, tool) => {
    const def = toolDefinition(tool);
    expect(def.name).toBe(tool.name);
    expect(def.description).toBe(tool.description);
    expect(def.inputSchema['type']).toBe('object');
    expect(def.outputSchema?.['type']).toBe('object');
    expect(def.inputSchema).not.toHaveProperty('$schema');
    expect(JSON.parse(JSON.stringify(def))).toEqual(def);
  });

  it('run_funnel advertises the grammar: steps 2..10, order and window enums, project as a uuid, unknown keys forbidden', () => {
    const schema = toolDefinition(MCP_TOOLS[3]).inputSchema as { properties: Record<string, Record<string, unknown>>; additionalProperties?: boolean; required?: string[] };
    expect(schema.properties['steps']).toMatchObject({ type: 'array', minItems: 2, maxItems: 10 });
    expect(schema.properties['order']).toMatchObject({ enum: ['sequential', 'strict', 'any'] });
    expect(schema.properties['project']).toMatchObject({ type: 'string', format: 'uuid' });
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(['kind', 'project', 'range', 'steps']));
    expect(schema.required).not.toContain('order'); // defaulted on input
  });

  it('explain_query advertises the five kinds as one object-typed union', () => {
    const schema = toolDefinition(MCP_TOOLS[7]).inputSchema as { type: string; oneOf?: unknown[]; anyOf?: unknown[] };
    expect(schema.type).toBe('object');
    expect((schema.oneOf ?? schema.anyOf)?.length).toBe(5);
  });

  it('the server version is the api package version', () => {
    expect(apiVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('content text', () => {
  it('a funnel prints the step counts, the median, the footer, the SQL fenced and the params', () => {
    const text = renderText('run_funnel', FUNNEL);
    expect(text).toContain('funnel · signup 13 → create_project 8 · median 91500 s');
    expect(text).toContain('status complete · tz Asia/Kolkata · data until 2026-08-31T18:45:00.000Z · 9 ms · 1 merge(s) since range start');
    expect(text).toContain('```sql\nWITH e AS (SELECT 1)\nSELECT 1\n```');
    expect(text).toContain('params: ["11111111-1111-4111-8111-111111111111","2026-08-01"]');
  });

  it('a timed-out funnel prints the status word, never a zero', () => {
    const text = renderText('run_funnel', { ...FUNNEL, steps: null, median_time_to_convert_s: null, meta: { ...META, status: 'timed_out', data_until: null } });
    expect(text).toContain('no step counts (timed_out)');
    expect(text).toContain('median n/a');
    expect(text).toContain('data until no events');
    expect(text).not.toMatch(/\b0 persons\b/);
  });

  it('a breakdown prints its groups with "other" and "unset" named', () => {
    const text = renderText('run_funnel', { ...FUNNEL, breakdown: { key: 'plan', groups: [{ value: 'pro', other: false, persons: [5, 3] }, { value: null, other: false, persons: [2, 1] }, { value: null, other: true, persons: [1, 0] }] } });
    expect(text).toContain('breakdown by plan: pro [5, 3]; unset [2, 1]; other [1, 0]');
  });

  it('a retention grid prints twelve cohorts then a count of the rest, flags in-progress cells', () => {
    const cohorts = Array.from({ length: 15 }, (_, i) => ({ bucket: `2026-08-${String(i + 1).padStart(2, '0')}`, size: 3, cells: [{ n: 0, retained: 3, pct: 1, in_progress: false }, { n: 1, retained: 1, pct: 1 / 3, in_progress: i === 14 }] }));
    const r: RetentionResult = { unit: 'day', cohorts, sql: 'SELECT 1', params: [], meta: META };
    const text = renderText('run_retention', r);
    expect(text).toContain('retention by day · 15 cohort(s)');
    expect(text).toContain('2026-08-01 (3): 3 1');
    expect(text).toContain('… 3 more cohort(s)');
    expect(text).not.toContain('2026-08-15 (3): 3 1*');
    expect(renderText('run_retention', { ...r, cohorts: null, meta: { ...META, status: 'empty' } })).toContain('no cohorts (empty)');
  });

  it('projects, events and a description print one line per item; an empty instance says so', () => {
    expect(renderText('list_projects', { projects: [] })).toBe('no projects');
    expect(renderText('list_projects', { projects: [{ project: 'p', name: 'Acme', timezone: 'UTC', events: 2, persons: 1, first_event: null, last_event: null }] })).toBe('Acme · p · tz UTC · 2 events · 1 persons · — → —');
    expect(renderText('list_events', { project: 'p', timezone: 'UTC', events: [{ event: 'signup', count: 4, first_seen: 'a', last_seen: 'b' }] })).toBe('project p · tz UTC · 1 event name(s)\nsignup · 4 · a → b');
    expect(renderText('describe_event', { project: 'p', event: 'signup', count: 4, properties: [{ key: 'plan', types: ['string', 'null'], cardinality_sample: 2 }] })).toBe('signup · 4 events · 1 property key(s)\nplan: string|null (2 distinct in sample)');
  });

  it('an explanation fences the SQL and, when present, the plan', () => {
    expect(renderText('explain_query', { sql: 'SELECT 1', params: [1] })).toBe('```sql\nSELECT 1\n```\nparams: [1]');
    expect(renderText('explain_query', { sql: 'SELECT 1', params: [], plan: 'Result  (cost=0.00..0.01 rows=1 width=4)' })).toContain('```text\nResult');
  });

  it('a trend prints the buckets and, when present, its breakdown; a paths prints the ranked transitions with "top N of M"', () => {
    const trend: TrendResult = {
      measure: 'events',
      unit: 'day',
      points: [{ bucket: '2026-08-03T00:00:00', value: 2, in_progress: false }, { bucket: '2026-08-05T00:00:00', value: 1, in_progress: true }],
      breakdown: null,
      sql: 'WITH e AS (SELECT 1)\nSELECT 1',
      params: [1],
      meta: META,
    };
    const tText = renderText('run_trend', trend);
    expect(tText).toContain('trend by day · events · 2 bucket(s)');
    expect(tText).toContain('2026-08-05T00:00:00: 1*'); // the * marks the in-progress bucket
    expect(tText).toContain('```sql\nWITH e AS (SELECT 1)\nSELECT 1\n```');

    const paths: PathsResult = {
      start: 'signup',
      starts: 14,
      transitions: [{ step: 1, from: 'signup', to: 'view_pricing', count: 2, pct_of_start: 2 / 14, median_gap_s: 930 }],
      total_transitions: 8,
      sql: 'WITH e AS (SELECT 1)\nSELECT 1',
      params: [1],
      meta: META,
    };
    const pText = renderText('run_paths', paths);
    expect(pText).toContain('paths from signup · showing top 1 of 8 · 14 start walk(s)');
    expect(pText).toContain('1. signup → view_pricing · 2 (14% of start)');
  });

  it('errors print code, message and the path when there is one', () => {
    expect(errorText({ code: 'INVALID_SPEC', message: 'Too big', path: ['steps', 0, 'event'] })).toBe('INVALID_SPEC: Too big (at steps.0.event)');
    expect(errorText({ code: 'BUSY', message: 'later' })).toBe('BUSY: later');
  });
});

describe('the error mapper (LLD §6 codes)', () => {
  const logger = { error: vi.fn() };

  it('passes a handler decision through unchanged', () => {
    const failure = { code: 'NOT_FOUND' as const, message: 'no such project' };
    expect(toToolError(new McpToolFailure(failure), logger)).toBe(failure);
  });

  it("maps the runner's BusyError and the read services' 503 BUSY / TIMED_OUT to the same codes, keeping their message; any other 503 is INTERNAL", () => {
    expect(toToolError(new BusyError('full'), logger)).toEqual({ code: 'BUSY', message: 'full; the same call can be retried' });
    expect(toToolError(new ServiceUnavailableException({ code: 'BUSY', message: 'full' }), logger)).toEqual({ code: 'BUSY', message: 'full' });
    expect(toToolError(new ServiceUnavailableException({ code: 'TIMED_OUT', message: 'slow' }), logger)).toEqual({ code: 'TIMED_OUT', message: 'slow' });
    expect(toToolError(new ServiceUnavailableException({ code: 'OTHER' }), logger).code).toBe('INTERNAL');
    expect(toToolError(new ServiceUnavailableException({ code: 'NOT_FOUND', message: 'not a read fault' }), logger).code).toBe('INTERNAL');
  });

  it('maps a pool connect timeout to BUSY and a statement_timeout (57014) to TIMED_OUT', () => {
    expect(toToolError(new Error('timeout exceeded when trying to connect'), logger).code).toBe('BUSY');
    expect(toToolError(Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }), logger).code).toBe('TIMED_OUT');
  });

  it('anything else is INTERNAL with a fixed message, and the real error is logged', () => {
    logger.error.mockClear();
    const pgLike = Object.assign(new Error('relation "events" does not exist for user vantage_reader'), { code: '42P01' });
    expect(toToolError(pgLike, logger)).toEqual({ code: 'INTERNAL', message: 'internal error' });
    expect(toToolError('a string', logger)).toEqual({ code: 'INTERNAL', message: 'internal error' });
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(String(logger.error.mock.calls[0]?.[0])).toContain('42P01');
  });

  it('every mapped error fits the McpToolError contract', () => {
    for (const err of [new BusyError('x'), new Error('boom'), new McpToolFailure({ code: 'INVALID_SPEC', message: 'm', path: ['kind'] })]) {
      expect(McpToolError.safeParse(toToolError(err, logger)).success).toBe(true);
    }
  });
});

describe('loadMcpOptions (D3)', () => {
  it('hides plans unless VANTAGE_EXPOSE_PLANS is exactly 1', () => {
    expect(loadMcpOptions({})).toEqual({ exposePlans: false });
    expect(loadMcpOptions({ VANTAGE_EXPOSE_PLANS: '' })).toEqual({ exposePlans: false });
    expect(loadMcpOptions({ VANTAGE_EXPOSE_PLANS: '0' })).toEqual({ exposePlans: false });
    expect(loadMcpOptions({ VANTAGE_EXPOSE_PLANS: '1' })).toEqual({ exposePlans: true });
  });

  it('refuses a value it cannot read as yes or no, so a typo never means off by accident', () => {
    expect(() => loadMcpOptions({ VANTAGE_EXPOSE_PLANS: 'true' })).toThrow(/must be 0 or 1/);
  });
});

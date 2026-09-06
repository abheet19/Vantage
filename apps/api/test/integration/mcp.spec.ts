/**
 * mcp.spec.ts — the MCP surface through the SDK's own client over the in-memory transport pair, against the fixture on a
 * real PostgreSQL: V13 (the list is exactly the eight tools with their annotations; an undeclared tool is JSON-RPC -32601),
 * every tool round-trips and its structured content passes its `outputSchema`, `run_funnel` returns the SAME numbers and
 * the SAME SQL as `POST /v1/funnel`, the LLD §6 error contract (`INVALID_SPEC` with the Zod path and the limit, `NOT_FOUND`
 * with no enumeration), D3 (`plan` only with the flag), V14 on data (two projects with identical event
 * names never leak across any tool), the denied paths (1 000 steps, a `sql` key, a flood → some BUSY, none hang) and the
 * interrupted path (a client gone mid-query leaves the server serving the next one). The LLD §9 S4 rows are `attack:` tests.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ErrorCode, McpError, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Test } from '@nestjs/testing';
import { ExplainQueryOutput, FunnelResult, ListEventsOutput, ListProjectsOutput, MCP_TOOL_ANNOTATIONS, MCP_TOOL_NAMES, McpToolError, PathsResult, RetentionResult, TrendResult, type EventCatalog } from '@vantage/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RO_POOL_MAX } from '../../src/infra/database.module.js';
import { CLOCK } from '../../src/infra/tokens.js';
import { MCP_OPTIONS, type McpOptions } from '../../src/modules/mcp/mcp-options.js';
import { McpServerFactory } from '../../src/modules/mcp/mcp-server.factory.js';
import { McpRootModule } from '../../src/modules/mcp/mcp.module.js';
import { loadFixture, type LoadResult } from '../fixture/load.js';
import { bearer, createTestApp, dbOptions, type TestApp, type TestProject } from '../helpers/app.js';

let t: TestApp;
let kolkata: LoadResult;
let utc: LoadResult;
/** A third project with the same event names and its own, tiny numbers — a leak from either fixture project is unmistakable. */
let small: TestProject;
let mcp: Awaited<ReturnType<typeof bootMcp>>;
const options: McpOptions = { exposePlans: false };

const AUGUST = { from: '2026-08-01', to: '2026-08-31' };
const STEPS = [{ event: 'signup' }, { event: 'create_project' }, { event: 'invite_teammate' }];
const funnelSpec = (project: string, over: Record<string, unknown> = {}) => ({ kind: 'funnel', project, range: AUGUST, steps: STEPS, ...over });
const retentionSpec = (project: string, over: Record<string, unknown> = {}) => ({ kind: 'retention', project, range: AUGUST, start: { event: 'signup' }, return: { event: 'view_pricing' }, unit: 'day', periods: 14, ...over });
const trendSpec = (project: string) => ({ kind: 'trend', project, range: AUGUST, event: { event: 'signup' } });
const pathsSpec = (project: string) => ({ kind: 'paths', project, range: AUGUST, start: 'signup' });

/** The same Nest wiring `mcp.ts` boots, on the test database, with the HTTP app's pinned clock so `computed_at` is comparable. */
async function bootMcp() {
  const moduleRef = await Test.createTestingModule({ imports: [McpRootModule.forRoot(dbOptions(), options)] })
    .overrideProvider(CLOCK)
    .useValue(t.clock)
    .overrideProvider(MCP_OPTIONS)
    .useValue(options)
    .compile();
  await moduleRef.init();
  return { moduleRef, factory: moduleRef.get(McpServerFactory) };
}

interface Session {
  client: Client;
  server: Server;
  clientTransport: InMemoryTransport;
  call(name: string, args?: unknown): Promise<CallToolResult>;
  close(): Promise<void>;
}

/** One client connected to one fresh server over a linked in-memory pair — what Claude Desktop is to `dist/mcp.js`, minus the pipes. */
async function connect(): Promise<Session> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = mcp.factory.create();
  await server.connect(serverTransport);
  const client = new Client({ name: 'vantage-test', version: '0.0.0' });
  await client.connect(clientTransport);
  await client.listTools(); // caches the output schemas, so the SDK client validates every structuredContent below against them
  return {
    client,
    server,
    clientTransport,
    call: (name, args = {}) => client.callTool({ name, arguments: args as Record<string, unknown> }) as Promise<CallToolResult>,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The error shape travels as the second text block (see `errorResult` in the factory); an error never carries structuredContent. */
const error = (r: CallToolResult) => {
  expect(r.isError).toBe(true);
  expect(r.structuredContent).toBeUndefined();
  return McpToolError.parse(JSON.parse((r.content[1] as { text: string }).text));
};
const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;
/** A result with the one field that legitimately differs between two runs removed. */
const comparable = <T extends { meta: { elapsed_ms: number } }>(r: T) => ({ ...r, meta: { ...r.meta, elapsed_ms: 0 } });

const holdLock = async () => {
  const owner = await t.owner.connect();
  await owner.query('BEGIN');
  await owner.query('LOCK TABLE events IN ACCESS EXCLUSIVE MODE');
  return async () => {
    await owner.query('ROLLBACK');
    owner.release();
  };
};

beforeAll(async () => {
  t = await createTestApp();
  kolkata = await loadFixture(t);
  utc = await loadFixture(t, { timezone: 'UTC' });
  small = await t.createProject('small', 'UTC');
  await t.http
    .post('/v1/events')
    .set(bearer(small))
    .send({ events: [{ event: 'signup', distinct_id: 'a', insert_id: 'a1', timestamp: '2026-08-10T10:00:00Z', properties: { plan: 'pro' } }, { event: 'signup', distinct_id: 'b', insert_id: 'b1', timestamp: '2026-08-11T10:00:00Z' }] })
    .expect(200);
  mcp = await bootMcp();
});
afterAll(async () => {
  await mcp.moduleRef.close();
  await t.close();
});

describe('V13: the surface is closed', () => {
  it('tools/list is exactly the eight names of design §5.1, each read-only, non-destructive, idempotent and closed-world, each with an object input schema and an output schema', async () => {
    const s = await connect();
    try {
      const { tools } = await s.client.listTools();
      expect(tools.map((x) => x.name)).toEqual([...MCP_TOOL_NAMES]);
      for (const tool of tools) {
        expect(tool.annotations).toEqual(MCP_TOOL_ANNOTATIONS);
        expect(tool.inputSchema.type).toBe('object');
        expect(tool.outputSchema?.['type']).toBe('object');
        expect(tool.description).toBeTruthy();
      }
    } finally {
      await s.close();
    }
  });

  it('attack: tools/call for run_sql or delete_events is JSON-RPC -32601 Method not found, and the message names nothing else', async () => {
    const s = await connect();
    try {
      for (const name of ['run_sql', 'delete_events', 'ask']) {
        const err = await s.call(name, { sql: 'DROP TABLE events' }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(McpError);
        expect((err as McpError).code).toBe(ErrorCode.MethodNotFound);
        expect((err as McpError).message).not.toMatch(/run_funnel|list_projects/);
      }
    } finally {
      await s.close();
    }
  });

  it('the server names itself vantage with the api package version', async () => {
    const s = await connect();
    try {
      expect(s.client.getServerVersion()).toMatchObject({ name: 'vantage', version: expect.stringMatching(/^\d+\.\d+\.\d+/) });
    } finally {
      await s.close();
    }
  });
});

describe('every tool round-trips against the fixture', () => {
  let s: Session;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s.close();
  });

  it('list_projects returns the three projects with counts that match their catalogs, and a first/last event', async () => {
    const r = await s.call('list_projects');
    expect(r.isError).toBeFalsy();
    const out = ListProjectsOutput.parse(r.structuredContent);
    const byId = new Map(out.projects.map((p) => [p.project, p]));
    for (const p of [kolkata.project, utc.project]) {
      const catalog = (await t.http.get(`/v1/events/catalog?project=${p.project_id}`).expect(200)).body as EventCatalog;
      const row = byId.get(p.project_id)!;
      expect(row.events).toBe(catalog.events.reduce((n, e) => n + e.count, 0));
      expect(row.timezone).toBe(p.timezone);
      expect(row.persons).toBeGreaterThan(10);
      expect(row.first_event).not.toBeNull();
      expect(row.last_event).not.toBeNull();
    }
    expect(byId.get(small.project_id)).toMatchObject({ name: 'small', timezone: 'UTC', events: 2, persons: 2, first_event: '2026-08-10T10:00:00.000Z', last_event: '2026-08-11T10:00:00.000Z' });
    expect(text(r)).toContain(`small · ${small.project_id} · tz UTC · 2 events · 2 persons`);
  });

  it('list_events returns the catalog names with counts and first/last seen; since filters on last_seen', async () => {
    const r = await s.call('list_events', { project: kolkata.project.project_id });
    const out = ListEventsOutput.parse(r.structuredContent);
    const catalog = (await t.http.get(`/v1/events/catalog?project=${kolkata.project.project_id}`).expect(200)).body as EventCatalog;
    expect(out.project).toBe(kolkata.project.project_id);
    expect(out.timezone).toBe('Asia/Kolkata');
    expect(out.events).toEqual(catalog.events.map((e) => ({ event: e.event, count: e.count, first_seen: e.first_seen, last_seen: e.last_seen })));
    expect(out.events.map((e) => e.event)).toEqual(expect.arrayContaining(['signup', 'create_project', 'invite_teammate', 'view_pricing']));
    expect(text(r)).toContain('signup · ');

    const none = ListEventsOutput.parse((await s.call('list_events', { project: kolkata.project.project_id, since: '2031-01-01' })).structuredContent);
    expect(none.events).toEqual([]);
    const all = ListEventsOutput.parse((await s.call('list_events', { project: kolkata.project.project_id, since: '2026-01-01' })).structuredContent);
    expect(all.events.length).toBe(out.events.length);
  });

  it('describe_event returns the property keys with types and a sample cardinality, never a value', async () => {
    const r = await s.call('describe_event', { project: small.project_id, event: 'signup' });
    expect(r.structuredContent).toEqual({ project: small.project_id, event: 'signup', count: 2, properties: [{ key: 'plan', types: ['string'], cardinality_sample: 1 }] });
    expect(JSON.stringify(r)).not.toContain('pro"');
    expect(text(r)).toBe('signup · 2 events · 1 property key(s)\nplan: string (1 distinct in sample)');
  });

  it('describe_event for a name never recorded is NOT_FOUND', async () => {
    const r = await s.call('describe_event', { project: kolkata.project.project_id, event: 'purchase' });
    expect(r.isError).toBe(true);
    expect(error(r)).toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('"purchase"') });
  });

  it('run_funnel returns the SAME numbers and the SAME sql as POST /v1/funnel (13 → 8 → 4, median 91 500 s), and its text fences that sql', async () => {
    const spec = funnelSpec(kolkata.project.project_id);
    const http = (await t.http.post('/v1/funnel').send(spec).expect(200)).body as FunnelResult;
    const r = await s.call('run_funnel', spec);
    expect(r.isError).toBeFalsy();
    const out = FunnelResult.parse(r.structuredContent);
    expect(out.steps?.map((x) => x.persons)).toEqual([13, 8, 4]);
    expect(out.median_time_to_convert_s).toBe(91_500);
    expect(out.sql).toBe(http.sql);
    expect(out.params).toEqual(http.params);
    expect(comparable(out)).toEqual(comparable(http));
    expect(text(r)).toContain('funnel · signup 13 → create_project 8 → invite_teammate 4 · median 91500 s');
    expect(text(r)).toContain(`\`\`\`sql\n${http.sql}\n\`\`\``);
  });

  it('run_funnel in strict order and with a breakdown agrees with HTTP too (defaults applied identically)', async () => {
    for (const over of [{ order: 'strict' }, { order: 'any', window: { value: 7, unit: 'days' } }, { breakdown: 'plan' }]) {
      const spec = funnelSpec(kolkata.project.project_id, over);
      const http = (await t.http.post('/v1/funnel').send(spec).expect(200)).body as FunnelResult;
      const out = FunnelResult.parse((await s.call('run_funnel', spec)).structuredContent);
      expect(comparable(out)).toEqual(comparable(http));
    }
  });

  it('run_retention returns the SAME grid and sql as POST /v1/retention', async () => {
    const spec = retentionSpec(kolkata.project.project_id);
    const http = (await t.http.post('/v1/retention').send(spec).expect(200)).body as RetentionResult;
    const r = await s.call('run_retention', spec);
    const out = RetentionResult.parse(r.structuredContent);
    expect(comparable(out)).toEqual(comparable(http));
    expect(out.cohorts?.length).toBeGreaterThan(0);
    expect(text(r)).toContain('retention by day');
    expect(text(r)).toContain('```sql');
  });

  it('run_trend returns the SAME numbers and sql as POST /v1/trend, and its text fences that sql', async () => {
    const spec = trendSpec(kolkata.project.project_id);
    const http = (await t.http.post('/v1/trend').send(spec).expect(200)).body as TrendResult;
    const r = await s.call('run_trend', spec);
    expect(r.isError).toBeFalsy();
    const out = TrendResult.parse(r.structuredContent);
    expect(comparable(out)).toEqual(comparable(http));
    expect((out.points ?? []).reduce((n, p) => n + p.value, 0)).toBe(14); // the 14 August signups
    expect(text(r)).toContain('trend by day · events');
    expect(text(r)).toContain('```sql');
  });

  it('run_paths returns the SAME transitions and sql as POST /v1/paths', async () => {
    const spec = pathsSpec(kolkata.project.project_id);
    const http = (await t.http.post('/v1/paths').send(spec).expect(200)).body as PathsResult;
    const r = await s.call('run_paths', spec);
    const out = PathsResult.parse(r.structuredContent);
    expect(comparable(out)).toEqual(comparable(http));
    expect(out.start).toBe('signup');
    expect(text(r)).toContain('paths from signup');
    expect(text(r)).toContain('```sql');
  });

  it('explain_query returns the sql and params run_funnel would use, for funnel, retention, trend, paths and count, without running anything', async () => {
    const trend = ExplainQueryOutput.parse((await s.call('explain_query', trendSpec(kolkata.project.project_id))).structuredContent);
    expect(trend.sql).toMatch(/^WITH e AS/);
    const pathsExp = ExplainQueryOutput.parse((await s.call('explain_query', pathsSpec(kolkata.project.project_id))).structuredContent);
    expect(pathsExp.sql).toContain('sessionised');
    const spec = funnelSpec(kolkata.project.project_id);
    const ran = FunnelResult.parse((await s.call('run_funnel', spec)).structuredContent);
    const explained = ExplainQueryOutput.parse((await s.call('explain_query', spec)).structuredContent);
    expect(explained.sql).toBe(ran.sql);
    expect(explained.params).toEqual(ran.params);
    expect(explained.params[0]).toBe(kolkata.project.project_id);
    const count = ExplainQueryOutput.parse((await s.call('explain_query', { kind: 'count', project: kolkata.project.project_id, range: AUGUST, event: { event: 'signup' } })).structuredContent);
    expect(count.sql).toMatch(/^WITH|^SELECT/);
    const retention = ExplainQueryOutput.parse((await s.call('explain_query', retentionSpec(kolkata.project.project_id))).structuredContent);
    expect(retention.sql).toContain('cohort');
  });

  it('D3: explain_query has no plan without VANTAGE_EXPOSE_PLANS=1, and a PostgreSQL text plan with it', async () => {
    const spec = funnelSpec(kolkata.project.project_id);
    const hidden = ExplainQueryOutput.parse((await s.call('explain_query', spec)).structuredContent);
    expect(hidden).not.toHaveProperty('plan');
    options.exposePlans = true;
    try {
      const r = await s.call('explain_query', spec);
      const shown = ExplainQueryOutput.parse(r.structuredContent);
      expect(shown.plan).toMatch(/cost=\d/);
      expect(shown.plan).toMatch(/events/);
      expect(text(r)).toContain('```text\n');
    } finally {
      options.exposePlans = false;
    }
  });
});

describe('the LLD §6 error contract', () => {
  let s: Session;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s.close();
  });

  it("run_funnel with { kind: 'retention' } is INVALID_SPEC at path kind, with no sql anywhere in the answer", async () => {
    const r = await s.call('run_funnel', retentionSpec(kolkata.project.project_id));
    expect(r.isError).toBe(true);
    expect(error(r)).toMatchObject({ code: 'INVALID_SPEC', path: ['kind'] });
    expect(JSON.stringify(r)).not.toMatch(/WITH e AS|SELECT/);
    expect(text(r)).toMatch(/^INVALID_SPEC: /);
  });

  it('11 steps is INVALID_SPEC at steps naming 10; 367 days is INVALID_SPEC at range naming 366 — so a model can self-correct in one round', async () => {
    const eleven = await s.call('run_funnel', funnelSpec(kolkata.project.project_id, { steps: Array.from({ length: 11 }, () => ({ event: 'signup' })) }));
    expect(error(eleven)).toMatchObject({ code: 'INVALID_SPEC', path: ['steps'], message: expect.stringContaining('10') });
    const year = await s.call('run_funnel', funnelSpec(kolkata.project.project_id, { range: { from: '2025-08-29', to: '2026-08-31' } }));
    expect(error(year)).toMatchObject({ code: 'INVALID_SPEC', path: ['range'], message: expect.stringContaining('366') });
  });

  it('a project that is not a uuid is INVALID_SPEC at project; arguments that are not an object are refused by the protocol layer before any handler runs', async () => {
    expect(error(await s.call('run_funnel', funnelSpec('../../etc/passwd')))).toMatchObject({ code: 'INVALID_SPEC', path: ['project'] });
    const err = await s.call('list_events', ['a', 'b']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect(String((err as McpError).message)).toContain('expected record');
  });

  it('an unknown project is NOT_FOUND on every project-taking tool, and the message enumerates nothing', async () => {
    const ghost = randomUUID();
    const known = [kolkata.project.project_id, utc.project.project_id, small.project_id];
    for (const [name, args] of [
      ['list_events', { project: ghost }],
      ['describe_event', { project: ghost, event: 'signup' }],
      ['run_funnel', funnelSpec(ghost)],
      ['run_retention', retentionSpec(ghost)],
      ['run_trend', trendSpec(ghost)],
      ['run_paths', pathsSpec(ghost)],
      ['explain_query', funnelSpec(ghost)],
    ] as const) {
      const r = await s.call(name, args);
      expect(r.isError).toBe(true);
      const e = error(r);
      expect(e.code).toBe('NOT_FOUND');
      for (const id of known) expect(e.message).not.toContain(id);
      expect(JSON.stringify(r)).not.toMatch(/WITH e AS|SELECT/);
    }
  });

  it('an empty result for a KNOWN project is a result with status empty, not NOT_FOUND', async () => {
    const r = await s.call('run_funnel', funnelSpec(small.project_id, { range: { from: '2020-01-01', to: '2020-01-31' } }));
    expect(r.isError).toBeFalsy();
    const out = FunnelResult.parse(r.structuredContent);
    expect(out.meta.status).toBe('empty');
    expect(out.steps).toBeNull();
    expect(text(r)).toContain('no step counts (empty)');
  });
});

describe('V14 on data: two projects with identical event names never leak across any tool', () => {
  let s: Session;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s.close();
  });

  it('the small project sees only its own two signups in list_events, describe_event, run_funnel and list_projects', async () => {
    const events = ListEventsOutput.parse((await s.call('list_events', { project: small.project_id })).structuredContent);
    expect(events.events).toEqual([{ event: 'signup', count: 2, first_seen: '2026-08-10T10:00:00.000Z', last_seen: '2026-08-11T10:00:00.000Z' }]);
    expect((await s.call('describe_event', { project: small.project_id, event: 'signup' })).structuredContent).toMatchObject({ count: 2 });
    const funnel = FunnelResult.parse((await s.call('run_funnel', funnelSpec(small.project_id, { steps: [{ event: 'signup' }, { event: 'create_project' }] }))).structuredContent);
    expect(funnel.steps?.map((x) => x.persons)).toEqual([2, 0]);
    expect(funnel.params[0]).toBe(small.project_id);
    expect(funnel.meta.timezone).toBe('UTC');
  });

  it('the two fixture projects differ exactly where their timezones make them differ, and each statement is bound to its own id', async () => {
    const k = FunnelResult.parse((await s.call('run_funnel', funnelSpec(kolkata.project.project_id))).structuredContent);
    const u = FunnelResult.parse((await s.call('run_funnel', funnelSpec(utc.project.project_id))).structuredContent);
    expect(k.params[0]).toBe(kolkata.project.project_id);
    expect(u.params[0]).toBe(utc.project.project_id);
    expect(k.sql).toBe(u.sql); // same statement text — only the bound project differs
    expect(k.meta.timezone).toBe('Asia/Kolkata');
    expect(u.meta.timezone).toBe('UTC');
    const kRet = RetentionResult.parse((await s.call('run_retention', retentionSpec(kolkata.project.project_id))).structuredContent);
    const uRet = RetentionResult.parse((await s.call('run_retention', retentionSpec(utc.project.project_id))).structuredContent);
    // P08 signs up on Sep 1 in Kolkata and Aug 31 in UTC: the UTC project has one more August cohort member.
    expect(uRet.cohorts!.reduce((n, c) => n + c.size, 0)).toBe(kRet.cohorts!.reduce((n, c) => n + c.size, 0) + 1);
  });
});

describe('denied and interrupted paths', () => {
  it('attack: a 1 000-step spec is INVALID_SPEC before any SQL exists', async () => {
    const s = await connect();
    try {
      const r = await s.call('run_funnel', funnelSpec(kolkata.project.project_id, { steps: Array.from({ length: 1_000 }, (_, i) => ({ event: `e${i}` })) }));
      expect(error(r)).toMatchObject({ code: 'INVALID_SPEC', path: ['steps'] });
      expect(JSON.stringify(r)).not.toContain('SELECT');
    } finally {
      await s.close();
    }
  });

  it('attack: a spec smuggling a sql key is INVALID_SPEC at sql (strict objects), for run_funnel and explain_query alike', async () => {
    const s = await connect();
    try {
      for (const name of ['run_funnel', 'explain_query'] as const) {
        const r = await s.call(name, funnelSpec(kolkata.project.project_id, { sql: 'DROP TABLE events' }));
        expect(error(r)).toMatchObject({ code: 'INVALID_SPEC', path: ['sql'] });
      }
    } finally {
      await s.close();
    }
  });

  it('attack: 200 concurrent run_funnel calls against a locked table — some are BUSY at once, none hang, every one settles, the server keeps serving', async () => {
    const s = await connect();
    const release = await holdLock();
    const started = Date.now();
    try {
      const calls = Array.from({ length: 200 }, () => s.call('run_funnel', funnelSpec(kolkata.project.project_id)).then((r) => ({ r, at: Date.now() - started })));
      await new Promise((r) => setTimeout(r, 1_000)); // the first four hold connections against the lock, eight fill the queue, the rest must be refused now
      await release();
      const settled = await Promise.all(calls);
      const busy = settled.filter(({ r }) => r.isError && error(r).code === 'BUSY');
      const ok = settled.filter(({ r }) => !r.isError);
      expect(busy.length).toBeGreaterThanOrEqual(1);
      expect(ok.length).toBeGreaterThanOrEqual(RO_POOL_MAX);
      expect(busy.length + ok.length).toBe(200);
      for (const { at } of busy) expect(at).toBeLessThan(3_000);
      for (const { r } of ok) expect(FunnelResult.parse(r.structuredContent).meta.status).toBe('complete');
      expect(Date.now() - started).toBeLessThan(20_000);
      // The server still serves after the flood. list_projects returns every project (single operator,
      // by design), and this suite shares one database with the others, so assert our own projects are
      // present rather than an exact global count.
      const after = ListProjectsOutput.parse((await s.call('list_projects')).structuredContent).projects.map((p) => p.project);
      expect(after).toContain(kolkata.project.project_id);
    } finally {
      await release().catch(() => undefined);
      await s.close();
    }
  }, 60_000);

  it('a client that disconnects mid-query leaves the server alive: the query stays bounded and the next client is served', async () => {
    const a = await connect();
    const release = await holdLock();
    const inFlight = a.call('run_funnel', funnelSpec(kolkata.project.project_id)).then(() => 'answered', () => 'rejected');
    await new Promise((r) => setTimeout(r, 300));
    await a.clientTransport.close(); // the client is gone while its statement waits on the lock
    await release();
    expect(await inFlight).toBe('rejected');
    const b = await connect();
    try {
      const r = await b.call('run_funnel', funnelSpec(kolkata.project.project_id));
      expect(FunnelResult.parse(r.structuredContent).steps?.map((x) => x.persons)).toEqual([13, 8, 4]);
    } finally {
      await b.close();
      await a.server.close().catch(() => undefined);
    }
  }, 30_000);
});

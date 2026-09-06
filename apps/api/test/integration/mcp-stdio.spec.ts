/**
 * mcp-stdio.spec.ts — the e2e the owner asked for (00-GATES.md, LLD §7 extension): `node apps/api/dist/mcp.js` spawned
 * over REAL stdio with the test database in its environment, driven by the SDK `Client` — first through a raw transport
 * that keeps every byte the child writes to stdout so the suite can prove nothing but JSON-RPC ever goes there, then
 * through the SDK's own `StdioClientTransport`, the way Claude Desktop and Claude Code connect. `list_projects` and
 * `run_funnel` return the fixture's numbers; a client that vanishes mid-query leaves a child that exits 0 and a fresh
 * child that answers; a refused boot exits 1 with the reason on stderr and nothing on stdout. Children are killed by pid.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema, type CallToolResult, type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { FunnelResult, ListProjectsOutput, MCP_TOOL_NAMES } from '@vantage/contracts';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadFixture, type LoadResult } from '../fixture/load.js';
import { createTestApp, type TestApp } from '../helpers/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..');
const MCP_JS = path.join(repoRoot, 'apps', 'api', 'dist', 'mcp.js');

let t: TestApp;
let fixture: LoadResult;
const children: ChildProcess[] = [];

/** The environment Claude Desktop's config would carry, on the test database; nothing else Vantage-shaped leaks in from the developer's shell. */
function childEnv(over: Record<string, string> = {}): Record<string, string> {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => !k.startsWith('VANTAGE_') && v !== undefined)) as Record<string, string>;
  return { ...base, VANTAGE_DATABASE_URL_RW: inject('dbRwUrl'), VANTAGE_DATABASE_URL_RO: inject('dbRoUrl'), VANTAGE_EXPOSE_PLANS: '0', ...over };
}

function spawnServer(env = childEnv()): ChildProcess {
  const child = spawn(process.execPath, [MCP_JS], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  children.push(child);
  return child;
}

const exited = (child: ChildProcess, ms = 15_000): Promise<number | null> =>
  new Promise((resolve, reject) => {
    if (child.exitCode !== null) return resolve(child.exitCode);
    const timer = setTimeout(() => reject(new Error(`child ${child.pid} did not exit within ${ms} ms`)), ms);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

/**
 * A client transport over a child we spawned ourselves, so the raw stdout stays observable. The SDK's `ReadBuffer` splits
 * the stream into messages exactly as its own stdio transport does.
 */
class RawStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  readonly stdout: string[] = [];
  readonly stderr: string[] = [];
  private readonly buffer = new ReadBuffer();

  constructor(readonly child: ChildProcess) {}

  async start(): Promise<void> {
    this.child.stdout!.on('data', (chunk: Buffer) => {
      this.stdout.push(chunk.toString('utf8'));
      this.buffer.append(chunk);
      for (let m = this.buffer.readMessage(); m !== null; m = this.buffer.readMessage()) this.onmessage?.(m);
    });
    this.child.stderr!.on('data', (chunk: Buffer) => this.stderr.push(chunk.toString('utf8')));
    this.child.once('exit', () => this.onclose?.());
  }

  send(message: JSONRPCMessage): Promise<void> {
    return new Promise((resolve, reject) => this.child.stdin!.write(serializeMessage(message), (err) => (err ? reject(err) : resolve())));
  }

  async close(): Promise<void> {
    this.child.stdin!.end();
  }
}

async function connectRaw(child: ChildProcess): Promise<{ client: Client; transport: RawStdioTransport; call(name: string, args?: Record<string, unknown>): Promise<CallToolResult> }> {
  const transport = new RawStdioTransport(child);
  const client = new Client({ name: 'vantage-stdio-test', version: '0.0.0' });
  await client.connect(transport);
  await client.listTools();
  return { client, transport, call: (name, args = {}) => client.callTool({ name, arguments: args }) as Promise<CallToolResult> };
}

const funnelSpec = (project: string) => ({ kind: 'funnel', project, range: { from: '2026-08-01', to: '2026-08-31' }, steps: [{ event: 'signup' }, { event: 'create_project' }, { event: 'invite_teammate' }] });

beforeAll(async () => {
  // `tsc -b` emits even when a concurrently edited slice has a type error (TypeScript ≥ 5.6); gate 1 judges the types, this
  // suite judges the built stdio server, so only the artefact is required here.
  const tsc = spawnSync(process.execPath, [path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'), '-b', 'packages/contracts', 'apps/api'], { cwd: repoRoot, encoding: 'utf8' });
  if (!existsSync(MCP_JS)) throw new Error(`build produced no ${MCP_JS}:\n${tsc.stdout}${tsc.stderr}`);
  t = await createTestApp();
  fixture = await loadFixture(t);
}, 240_000);

afterAll(async () => {
  for (const child of children) if (child.exitCode === null && child.pid) process.kill(child.pid);
  await t.close();
});

describe('dist/mcp.js over real stdio', () => {
  it('serves tools/list, list_projects and run_funnel with the fixture numbers; writes only JSON-RPC to stdout and its logs to stderr; exits 0 when stdin ends', async () => {
    const child = spawnServer();
    const { client, transport, call } = await connectRaw(child);

    const { tools } = await client.listTools();
    expect(tools.map((x) => x.name)).toEqual([...MCP_TOOL_NAMES]);
    expect(client.getServerVersion()?.name).toBe('vantage');

    const projects = ListProjectsOutput.parse((await call('list_projects')).structuredContent);
    expect(projects.projects.map((p) => p.project)).toContain(fixture.project.project_id);

    const funnel = await call('run_funnel', funnelSpec(fixture.project.project_id));
    expect(funnel.isError).toBeFalsy();
    const out = FunnelResult.parse(funnel.structuredContent);
    expect(out.steps?.map((s) => s.persons)).toEqual([13, 8, 4]);
    expect(out.median_time_to_convert_s).toBe(91_500);
    expect(out.sql).toMatch(/^WITH e AS/);
    expect(out.params[0]).toBe(fixture.project.project_id);

    await client.close();
    expect(await exited(child)).toBe(0);

    const lines = transport.stdout.join('').split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThanOrEqual(4); // initialize, tools/list ×2, two tool calls
    for (const line of lines) expect(JSONRPCMessageSchema.safeParse(JSON.parse(line)).success).toBe(true);
    const stderr = transport.stderr.join('');
    expect(stderr).toContain('serving over stdio; plans hidden');
    expect(stderr).toContain('shutting down');
  }, 60_000);

  it("the SDK's own StdioClientTransport — what Claude Desktop uses — connects, lists the eight tools and gets the funnel", async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_JS], env: childEnv(), stderr: 'pipe' });
    const client = new Client({ name: 'claude-desktop-stand-in', version: '0.0.0' });
    await client.connect(transport);
    try {
      expect(transport.pid).toBeTypeOf('number');
      const { tools } = await client.listTools();
      expect(tools.map((x) => x.name)).toEqual([...MCP_TOOL_NAMES]);
      const funnel = (await client.callTool({ name: 'run_funnel', arguments: funnelSpec(fixture.project.project_id) })) as CallToolResult;
      expect(FunnelResult.parse(funnel.structuredContent).steps?.map((s) => s.persons)).toEqual([13, 8, 4]);
    } finally {
      const pid = transport.pid;
      await client.close();
      if (pid) await new Promise((r) => setTimeout(r, 500));
    }
  }, 60_000);

  it('interrupted: the client vanishes mid-query — the child finishes its bounded statement, exits 0, and a fresh child serves the next client', async () => {
    const owner = await t.owner.connect();
    await owner.query('BEGIN');
    await owner.query('LOCK TABLE events IN ACCESS EXCLUSIVE MODE');
    const first = spawnServer();
    try {
      const { call, transport } = await connectRaw(first);
      const inFlight = call('run_funnel', funnelSpec(fixture.project.project_id)).then(() => 'answered', () => 'rejected');
      await new Promise((r) => setTimeout(r, 500));
      first.stdin!.destroy(); // Claude Desktop quit while the statement waits on the lock
      await new Promise((r) => setTimeout(r, 500));
      await owner.query('ROLLBACK');
      expect(await inFlight).toBe('rejected');
      expect(await exited(first, 20_000)).toBe(0);
      expect(transport.stderr.join('')).toContain('shutting down');
    } finally {
      owner.release();
    }
    const second = spawnServer();
    const { client, call } = await connectRaw(second);
    expect(FunnelResult.parse((await call('run_funnel', funnelSpec(fixture.project.project_id))).structuredContent).steps?.map((s) => s.persons)).toEqual([13, 8, 4]);
    await client.close();
    expect(await exited(second)).toBe(0);
  }, 60_000);

  it('a refused boot (wrong reader password) exits 1 with the reason on stderr and writes nothing to stdout', async () => {
    const bad = new URL(inject('dbRoUrl'));
    bad.password = 'wrong';
    const child = spawnServer(childEnv({ VANTAGE_DATABASE_URL_RO: bad.toString() }));
    const stdout: string[] = [];
    const stderr: string[] = [];
    child.stdout!.on('data', (c: Buffer) => stdout.push(c.toString()));
    child.stderr!.on('data', (c: Buffer) => stderr.push(c.toString()));
    expect(await exited(child, 30_000)).toBe(1);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('vantage mcp refused to start');
  }, 40_000);

  it('a missing database URL exits 1 naming the variable, before any protocol traffic', async () => {
    const env = childEnv();
    delete env['VANTAGE_DATABASE_URL_RO'];
    const child = spawnServer(env);
    const stderr: string[] = [];
    child.stderr!.on('data', (c: Buffer) => stderr.push(c.toString()));
    expect(await exited(child)).toBe(1);
    expect(stderr.join('')).toContain('VANTAGE_DATABASE_URL_RO');
  }, 20_000);
});

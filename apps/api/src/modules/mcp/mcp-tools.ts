/**
 * mcp-tools.ts — the eight tool handlers: validated input in, contract output out, failures as `McpToolFailure`.
 *
 * Why it exists: the MCP surface is a second front door to the same read path the HTTP routes use, and it
 * must be exactly that — `run_funnel` calls `InsightsService.funnel` with the very spec `POST /v1/funnel`
 * would receive, so the numbers and the SQL are identical by construction (design §8, 1:05). Project
 * binding is the spec's own `project` field validated as a uuid; the tools add one thing HTTP does not:
 * an unknown project is `NOT_FOUND` rather than an honest `empty`, because an MCP client has
 * `list_projects` and a model that can self-correct in one round (LLD §6). That check runs AFTER the
 * query for the `run_*` tools, on the `empty` path only, so a saturated pool is refused by the insights
 * service's admission rule before this module touches a connection.
 *
 * Every `run_*` tool calls the same `InsightsService` method its HTTP route does, so a client learns the
 * grammar and is handed the same numbers and the same SQL by construction (S6 added `run_trend` and
 * `run_paths`, so all five query kinds run through here now).
 *
 * What it must never do: reach a model, the write pool or a statement `compile()` did not seal; enumerate
 * projects in a `NOT_FOUND`; or return a value for a status that says there is none.
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  QUERY_LIMITS,
  type DescribeEventOutput,
  type EventCatalog,
  type ExplainQueryOutput,
  type FunnelResult,
  type FunnelSpec,
  type McpToolInput,
  type McpToolName,
  type McpToolOutput,
  type PathsResult,
  type PathsSpec,
  type QuerySpec,
  type RetentionResult,
  type RetentionSpec,
  type TrendResult,
  type TrendSpec,
} from '@vantage/contracts';
import { compile, type CompileCtx } from '../../domain/index.js';
import { CatalogService } from '../events/catalog.service.js';
import { InsightsService } from '../insights/insights.service.js';
import { McpToolFailure } from './mcp-errors.js';
import { MCP_OPTIONS, type McpOptions } from './mcp-options.js';
import { McpReads } from './mcp-reads.js';
import { PlanReader } from './plan-reader.js';

/** One handler per tool, typed from the contract table: the compiler refuses a handler whose shape drifts from its schema. */
export type McpToolHandlers = { [K in McpToolName]: (input: McpToolInput<K>) => Promise<McpToolOutput<K>> };

@Injectable()
export class McpTools {
  constructor(
    @Inject(InsightsService) private readonly insights: InsightsService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(McpReads) private readonly reads: McpReads,
    @Inject(PlanReader) private readonly plans: PlanReader,
    @Inject(MCP_OPTIONS) private readonly options: McpOptions,
  ) {}

  handlers(): McpToolHandlers {
    return {
      list_projects: async () => ({ projects: await this.reads.projectSummaries() }),
      list_events: (input) => this.listEvents(input),
      describe_event: (input) => this.describeEvent(input),
      run_funnel: (spec) => this.runFunnel(spec),
      run_retention: (spec) => this.runRetention(spec),
      run_trend: (spec) => this.runTrend(spec),
      run_paths: (spec) => this.runPaths(spec),
      explain_query: (spec) => this.explainQuery(spec),
    };
  }

  private async listEvents(input: McpToolInput<'list_events'>): Promise<McpToolOutput<'list_events'>> {
    const catalog = await this.knownCatalog(input.project);
    const since = input.since === undefined ? null : Date.parse(`${input.since}T00:00:00Z`);
    const events = catalog.events
      .filter((e) => since === null || Date.parse(e.last_seen) >= since)
      .map((e) => ({ event: e.event, count: e.count, first_seen: e.first_seen, last_seen: e.last_seen }));
    return { project: catalog.project, timezone: catalog.timezone, events };
  }

  private async describeEvent(input: McpToolInput<'describe_event'>): Promise<DescribeEventOutput> {
    const catalog = await this.knownCatalog(input.project);
    const event = catalog.events.find((e) => e.event === input.event);
    if (!event) throw new McpToolFailure({ code: 'NOT_FOUND', message: `no event named ${JSON.stringify(input.event)} has been recorded in this project; list_events has the names that exist` });
    return { project: catalog.project, event: event.event, count: event.count, properties: event.properties };
  }

  private async runFunnel(spec: FunnelSpec): Promise<FunnelResult> {
    const result = await this.insights.funnel(spec);
    if (result.meta.status === 'empty') await this.assertKnown(spec.project);
    return result;
  }

  private async runRetention(spec: RetentionSpec): Promise<RetentionResult> {
    const result = await this.insights.retention(spec);
    if (result.meta.status === 'empty') await this.assertKnown(spec.project);
    return result;
  }

  private async runTrend(spec: TrendSpec): Promise<TrendResult> {
    const result = await this.insights.trend(spec);
    if (result.meta.status === 'empty') await this.assertKnown(spec.project);
    return result;
  }

  private async runPaths(spec: PathsSpec): Promise<PathsResult> {
    const result = await this.insights.paths(spec);
    if (result.meta.status === 'empty') await this.assertKnown(spec.project);
    return result;
  }

  private async explainQuery(spec: QuerySpec): Promise<ExplainQueryOutput> {
    const project = await this.reads.findProject(spec.project);
    if (!project) throw notFound(spec.project);
    const ctx: CompileCtx = { projectId: project.project_id, timezone: project.timezone, rowCap: QUERY_LIMITS.rowCap };
    const c = compile(spec, ctx);
    const out: ExplainQueryOutput = { sql: c.sql, params: [...c.params] };
    if (this.options.exposePlans) out.plan = await this.plans.explain(c);
    return out;
  }

  /** The catalog for a project the server knows; an empty catalog is checked against `projects` before it is believed. */
  private async knownCatalog(projectId: string): Promise<EventCatalog> {
    const catalog = await this.catalog.catalog(projectId);
    if (catalog.events.length === 0) await this.assertKnown(projectId);
    return catalog;
  }

  private async assertKnown(projectId: string): Promise<void> {
    if ((await this.reads.findProject(projectId)) === null) throw notFound(projectId);
  }
}

function notFound(projectId: string): McpToolFailure {
  return new McpToolFailure({ code: 'NOT_FOUND', message: `project ${projectId} is not known to this server; list_projects has the ids that exist` });
}

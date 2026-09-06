/**
 * mcp.ts — the MCP tool contract: the eight tool names, their input and output schemas, their fixed
 * descriptions, the shared annotations and the error shape (design §5.1, LLD §6).
 *
 * Why it exists: the MCP client's own model does the English → spec step, so the tool schemas ARE the
 * grammar it must fit (design A2). Every `run_*` input is the very `*Spec` the HTTP route validates and
 * every output is the very `*Result` it returns — one Zod object is the DTO, the MCP `inputSchema` and
 * the web's type, so the three can never drift (LLD §3.1). The descriptions live here too because the
 * web's MCP screen (03-UI S8) renders the same tool list the server advertises, and because design §5.3
 * requires them to be fixed English sentences with no imperative addressed to the model — a test holds
 * every sentence in this table to that.
 *
 * What it must never do: carry a `run_sql` or `ask` tool (there is nothing to call — design §5.1), grow a
 * field a compiler would interpolate, or let an error leave as anything but `McpToolError`.
 *
 * Two departures from the LLD §6 table, recorded in §11: `describe_event` returns no `examples` — the
 * catalog contract (E27) carries no property value at all, so there is nothing to fence; and an error
 * result carries `McpToolError` as a JSON text block rather than as `structuredContent`, because the
 * protocol binds `structuredContent` to the tool's `outputSchema` and the SDK client — Claude Desktop's
 * — rejects an error-shaped one. S6 delivered the `run_trend`/`run_paths` compilers, so their output
 * schemas are now `TrendResult`/`PathsResult` and `NOT_IMPLEMENTED` has left the error code list.
 */
import { z } from 'zod';
import { CATALOG_LIMITS, CatalogProperty } from './catalog.js';
import { DATE_BOUNDS, FunnelSpec, PathsSpec, QuerySpec, RetentionSpec, TrendSpec, daysBetween } from './query-spec.js';
import { FunnelResult, PathsResult, RetentionResult, TrendResult } from './results.js';

export const MCP_SERVER_NAME = 'vantage';

export const MCP_TOOL_NAMES = ['list_projects', 'list_events', 'describe_event', 'run_funnel', 'run_retention', 'run_trend', 'run_paths', 'explain_query'] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** Every tool reads and nothing else (design §5.1); a client that honours hints needs no confirmation for any of them. */
export const MCP_TOOL_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

/** Why an MCP tool call did not produce a result; `path` is the Zod path for `INVALID_SPEC`, so a well-behaved model can self-correct in one round (LLD §6). */
export const McpErrorCode = z.enum(['INVALID_SPEC', 'NOT_FOUND', 'TIMED_OUT', 'BUSY', 'INTERNAL']);
export type McpErrorCode = z.infer<typeof McpErrorCode>;

export const McpToolError = z.object({
  code: McpErrorCode,
  message: z.string(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});
export type McpToolError = z.infer<typeof McpToolError>;

const ProjectId = z.string().uuid();

/** The same bounds as `DateRange` (E39): a `since` the SQL cannot represent is refused here, not by PostgreSQL. */
const LocalDate = z.string().date().refine((d) => daysBetween(DATE_BOUNDS.min, d) >= 0 && daysBetween(d, DATE_BOUNDS.max) >= 0, {
  message: `date must be between ${DATE_BOUNDS.min} and ${DATE_BOUNDS.max}`,
});

export const ListProjectsInput = z.strictObject({});
export type ListProjectsInput = z.infer<typeof ListProjectsInput>;

export const ProjectSummary = z.object({
  project: ProjectId,
  name: z.string(),
  timezone: z.string(),
  events: z.number().int().min(0),
  persons: z.number().int().min(0),
  first_event: z.string().datetime().nullable(),
  last_event: z.string().datetime().nullable(),
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ListProjectsOutput = z.object({ projects: z.array(ProjectSummary) });
export type ListProjectsOutput = z.infer<typeof ListProjectsOutput>;

export const ListEventsInput = z.strictObject({ project: ProjectId, since: LocalDate.optional() });
export type ListEventsInput = z.infer<typeof ListEventsInput>;

export const EventSummary = z.object({ event: z.string(), count: z.number().int().min(0), first_seen: z.string().datetime(), last_seen: z.string().datetime() });
export type EventSummary = z.infer<typeof EventSummary>;

export const ListEventsOutput = z.object({ project: ProjectId, timezone: z.string(), events: z.array(EventSummary).max(CATALOG_LIMITS.events) });
export type ListEventsOutput = z.infer<typeof ListEventsOutput>;

export const DescribeEventInput = z.strictObject({ project: ProjectId, event: z.string().min(1).max(200) });
export type DescribeEventInput = z.infer<typeof DescribeEventInput>;

export const DescribeEventOutput = z.object({
  project: ProjectId,
  event: z.string(),
  count: z.number().int().min(0),
  properties: z.array(CatalogProperty).max(CATALOG_LIMITS.keysPerEvent),
});
export type DescribeEventOutput = z.infer<typeof DescribeEventOutput>;

export const ExplainQueryOutput = z.object({ sql: z.string(), params: z.array(z.unknown()), plan: z.string().optional() });
export type ExplainQueryOutput = z.infer<typeof ExplainQueryOutput>;

export interface McpToolContract {
  readonly name: McpToolName;
  /** A fixed declarative sentence or two: what the tool returns and over what. Never an instruction to the caller's model (design §5.3). */
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
}

/**
 * The advertised surface, in the order design §5.1 lists it. `tools/list` is built from this table and
 * nothing else, so V13 ("the tool list equals the eight names") is a fact about one constant. The tuple
 * is `as const` so a server implementation can be typed per tool (`McpToolInput<'run_funnel'>` IS
 * `FunnelSpec`) without a second table.
 */
export const MCP_TOOLS = [
  {
    name: 'list_projects',
    description: 'The projects this Vantage instance holds: id, name, timezone, event and person counts, first and last event. Every other tool takes a project id from this list.',
    inputSchema: ListProjectsInput,
    outputSchema: ListProjectsOutput,
  },
  {
    name: 'list_events',
    description: `The event names recorded in one project with their counts and first/last occurrence, commonest first, at most ${CATALOG_LIMITS.events} names; with "since", only names seen on or after that UTC date. Event names in query specs are compared exactly against these.`,
    inputSchema: ListEventsInput,
    outputSchema: ListEventsOutput,
  },
  {
    name: 'describe_event',
    description: `The property keys seen on one event's ${CATALOG_LIMITS.sampleRows} most recent occurrences, each with the JSON types observed and a distinct-value count over that sample. Property values are not part of the answer.`,
    inputSchema: DescribeEventInput,
    outputSchema: DescribeEventOutput,
  },
  {
    name: 'run_funnel',
    description: 'A funnel over one project inside a read-only transaction: persons per step, share of the previous step and of the start, median time to convert, the exact SQL with its parameters, and a status footer that says how far the numbers can be trusted.',
    inputSchema: FunnelSpec,
    outputSchema: FunnelResult,
  },
  {
    name: 'run_retention',
    description: 'A retention grid over one project inside a read-only transaction: one cohort per bucket of first start events, retained counts and shares per period, whether a period is still in progress, the exact SQL with its parameters, and a status footer.',
    inputSchema: RetentionSpec,
    outputSchema: RetentionResult,
  },
  {
    name: 'run_trend',
    description: 'A trend over one project inside a read-only transaction: the count of an event, or the number of distinct persons, per time bucket, with an optional property breakdown capped at 50 values plus "other", the exact SQL with its parameters, and a status footer.',
    inputSchema: TrendSpec,
    outputSchema: TrendResult,
  },
  {
    name: 'run_paths',
    description: 'The top transitions between consecutive events per person over one project inside a read-only transaction: from a start event, within a session gap, up to five steps, ranked by count with the share of the start-event walks and a median gap, plus how many transitions exist in all, the exact SQL and a status footer.',
    inputSchema: PathsSpec,
    outputSchema: PathsResult,
  },
  {
    name: 'explain_query',
    description: 'The exact SQL and parameters Vantage would run for any query spec, without running it. A PostgreSQL plan is included only when the server was started with VANTAGE_EXPOSE_PLANS=1.',
    inputSchema: QuerySpec,
    outputSchema: ExplainQueryOutput,
  },
] as const satisfies readonly McpToolContract[];

type ToolNamed<K extends McpToolName> = Extract<(typeof MCP_TOOLS)[number], { name: K }>;
/** The validated argument a tool's handler receives: the output type of its `inputSchema` (defaults applied). */
export type McpToolInput<K extends McpToolName> = z.output<ToolNamed<K>['inputSchema']>;
/** What a tool's handler returns; `structuredContent` is validated against the same schema before it leaves. */
export type McpToolOutput<K extends McpToolName> = z.output<ToolNamed<K>['outputSchema']>;

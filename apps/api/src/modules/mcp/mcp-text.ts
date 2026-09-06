/**
 * mcp-text.ts — the `content` text of every tool result: compact, with the SQL in a fenced block.
 *
 * Why it exists: an MCP result carries `structuredContent` for programs and `content` for people and
 * models that read text (LLD §6: "`content` mirrors `structuredContent` as compact text with the SQL in
 * a fenced block, because the SQL is the product"). These functions are pure — validated output in, one
 * string out — so the exact text a client shows can be asserted without a database. Numbers are printed
 * as the result carries them; nothing is rounded or summarised in a way the status footer would not
 * defend (`timed_out` and `empty` print as those words, never as zeros).
 *
 * What it must never do: add a sentence addressed to the model, or print a number the structured result
 * does not contain.
 */
import type { DescribeEventOutput, ExplainQueryOutput, FunnelResult, ListEventsOutput, ListProjectsOutput, McpToolError, McpToolName, McpToolOutput, PathsResult, ResultMeta, RetentionResult, TrendResult } from '@vantage/contracts';

/** Cohorts and buckets and transitions printed in full before the rest is summarised; a long series is data, not reading. */
const COHORT_LINES = 12;
const TREND_LINES = 24;
const PATHS_LINES = 20;

const fence = (language: string, body: string) => `\`\`\`${language}\n${body}\n\`\`\``;
const params = (values: readonly unknown[]) => `params: ${JSON.stringify(values)}`;

function footer(meta: ResultMeta): string {
  const until = meta.data_until ?? 'no events';
  const flags = [meta.incomplete_buckets > 0 ? `${meta.incomplete_buckets} bucket(s) in progress` : null, meta.persons_merged_since > 0 ? `${meta.persons_merged_since} merge(s) since range start` : null].filter((f) => f !== null);
  return [`status ${meta.status}`, `tz ${meta.timezone}`, `data until ${until}`, `${meta.elapsed_ms} ms`, ...flags].join(' · ');
}

function funnelText(r: FunnelResult): string {
  const steps = r.steps ? r.steps.map((s) => `${s.event} ${s.persons}`).join(' → ') : `no step counts (${r.meta.status})`;
  const median = r.median_time_to_convert_s === null ? 'median n/a' : `median ${r.median_time_to_convert_s} s`;
  const groups = r.breakdown ? `\nbreakdown by ${r.breakdown.key}: ${r.breakdown.groups.map((g) => `${g.other ? 'other' : (g.value ?? 'unset')} [${g.persons.join(', ')}]`).join('; ')}` : '';
  return `funnel · ${steps} · ${median}${groups}\n${footer(r.meta)}\n${fence('sql', r.sql)}\n${params(r.params)}`;
}

function retentionText(r: RetentionResult): string {
  const cohorts = r.cohorts ?? [];
  const shown = cohorts.slice(0, COHORT_LINES).map((c) => `${c.bucket} (${c.size}): ${c.cells.map((cell) => `${cell.retained}${cell.in_progress ? '*' : ''}`).join(' ')}`);
  const rest = cohorts.length > COHORT_LINES ? [`… ${cohorts.length - COHORT_LINES} more cohort(s)`] : [];
  const head = r.cohorts ? `retention by ${r.unit} · ${cohorts.length} cohort(s) · retained per period (* = period still in progress)` : `retention by ${r.unit} · no cohorts (${r.meta.status})`;
  return [head, ...shown, ...rest, footer(r.meta), fence('sql', r.sql), params(r.params)].join('\n');
}

function trendText(r: TrendResult): string {
  const points = r.points ?? [];
  const shown = points.slice(0, TREND_LINES).map((pt) => `${pt.bucket}: ${pt.value}${pt.in_progress ? '*' : ''}`);
  const rest = points.length > TREND_LINES ? [`… ${points.length - TREND_LINES} more bucket(s)`] : [];
  const head = r.points ? `trend by ${r.unit} · ${r.measure} · ${points.length} bucket(s) (* = bucket still in progress)` : `trend by ${r.unit} · ${r.measure} · no buckets (${r.meta.status})`;
  const groups = r.breakdown ? [`breakdown by ${r.breakdown.key}: ${r.breakdown.series.map((s) => `${s.other ? 'other' : (s.key ?? 'unset')} [${s.points.reduce((n, pt) => n + pt.value, 0)}]`).join('; ')}`] : [];
  return [head, ...shown, ...rest, ...groups, footer(r.meta), fence('sql', r.sql), params(r.params)].join('\n');
}

function pathsText(r: PathsResult): string {
  const transitions = r.transitions ?? [];
  const shown = transitions.slice(0, PATHS_LINES).map((tr) => `${tr.step}. ${tr.from} → ${tr.to} · ${tr.count} (${tr.pct_of_start === null ? '—' : `${Math.round(tr.pct_of_start * 100)}%`} of start)`);
  const rest = transitions.length > PATHS_LINES ? [`… ${transitions.length - PATHS_LINES} more shown row(s)`] : [];
  const head = r.transitions ? `paths from ${r.start} · showing top ${transitions.length} of ${r.total_transitions} · ${r.starts ?? 0} start walk(s)` : `paths from ${r.start} · no transitions (${r.meta.status})`;
  return [head, ...shown, ...rest, footer(r.meta), fence('sql', r.sql), params(r.params)].join('\n');
}

function projectsText(o: ListProjectsOutput): string {
  if (o.projects.length === 0) return 'no projects';
  return o.projects.map((p) => `${p.name} · ${p.project} · tz ${p.timezone} · ${p.events} events · ${p.persons} persons · ${p.first_event ?? '—'} → ${p.last_event ?? '—'}`).join('\n');
}

function eventsText(o: ListEventsOutput): string {
  const lines = o.events.map((e) => `${e.event} · ${e.count} · ${e.first_seen} → ${e.last_seen}`);
  return [`project ${o.project} · tz ${o.timezone} · ${o.events.length} event name(s)`, ...lines].join('\n');
}

function describeText(o: DescribeEventOutput): string {
  const lines = o.properties.map((p) => `${p.key}: ${p.types.join('|')} (${p.cardinality_sample} distinct in sample)`);
  return [`${o.event} · ${o.count} events · ${o.properties.length} property key(s)`, ...lines].join('\n');
}

function explainText(o: ExplainQueryOutput): string {
  const plan = o.plan === undefined ? [] : [fence('text', o.plan)];
  return [fence('sql', o.sql), params(o.params), ...plan].join('\n');
}

export function errorText(e: McpToolError): string {
  const at = e.path && e.path.length > 0 ? ` (at ${e.path.join('.')})` : '';
  return `${e.code}: ${e.message}${at}`;
}

/** `output` has passed the tool's `outputSchema` before it arrives here, which is what makes the per-tool cast below true. */
export function renderText<K extends McpToolName>(name: K, output: McpToolOutput<K>): string {
  switch (name) {
    case 'list_projects':
      return projectsText(output as ListProjectsOutput);
    case 'list_events':
      return eventsText(output as ListEventsOutput);
    case 'describe_event':
      return describeText(output as DescribeEventOutput);
    case 'run_funnel':
      return funnelText(output as FunnelResult);
    case 'run_retention':
      return retentionText(output as RetentionResult);
    case 'run_trend':
      return trendText(output as TrendResult);
    case 'run_paths':
      return pathsText(output as PathsResult);
    case 'explain_query':
      return explainText(output as ExplainQueryOutput);
  }
}

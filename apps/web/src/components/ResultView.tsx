/**
 * ResultView.tsx — render an insight result's body according to its `meta.status`, never the 200 alone.
 *
 * Why it exists: the build prompt's rule 4 — every number carries its `meta.status`, and `empty`,
 * `timed_out` and an error must render as three different things — lives here. A `complete`/`truncated`
 * result shows its number (funnel bars, a count KPI, or, until S6, an honest retention summary) with the
 * footer; `empty` is the calm grey card; `timed_out` is the red stopped card; `refused_by_database` (a
 * result-level L3 alarm) is the red refused card. The previous result must be cleared before a new status
 * shows (LLD §9 S5), which the parent does by keying on the request — this component is pure over one
 * result.
 *
 * What it must never do: show a funnel bar or a KPI for any status but `complete`/`truncated` — a number
 * under an `empty` or `timed_out` footer is the stale-number bug the adversarial pass hunts.
 */
import type { JSX } from 'react';
import type { CountResult, FunnelResult, InsightResult, PathsResult, RetentionResult, TrendResult } from '@vantage/contracts';
import { formatCount, formatDuration, formatRatio } from '../lib/format.js';
import { overallConversion } from '../lib/funnel.js';
import { FunnelBars } from './FunnelBars.js';
import { PathsTable, TruncationChip } from './PathsTable.js';
import { RetentionHeatmap, HeatLegend } from './RetentionHeatmap.js';
import { StateCard } from './StateCard.js';
import { StatusFooter } from './StatusFooter.js';
import { TrendChart } from './TrendChart.js';

function isFunnel(r: InsightResult): r is FunnelResult {
  return 'steps' in r;
}
function isRetention(r: InsightResult): r is RetentionResult {
  return 'cohorts' in r;
}
function isTrend(r: InsightResult): r is TrendResult {
  return 'points' in r;
}
function isPaths(r: InsightResult): r is PathsResult {
  return 'transitions' in r;
}

function Kpi({ value, label }: { value: string; label: string }): JSX.Element {
  return (
    <div className="kpi">
      <div className="v">{value}</div>
      <div className="l">{label}</div>
    </div>
  );
}

function FunnelBody({ result }: { result: FunnelResult }): JSX.Element | null {
  const steps = result.steps;
  if (!steps || steps.length === 0) return null;
  return (
    <>
      <FunnelBars steps={steps} />
      <div className="kpis">
        <Kpi value={formatRatio(overallConversion(steps))} label="converted start → finish" />
        <Kpi value={formatDuration(result.median_time_to_convert_s)} label="median time to convert" />
        <Kpi value={formatCount(steps[0]?.persons ?? 0)} label="persons · from each person’s first step-1 in the range" />
      </div>
    </>
  );
}

function CountBody({ result }: { result: CountResult }): JSX.Element {
  return (
    <div className="kpis" data-testid="count-kpis">
      <Kpi value={formatCount(result.persons)} label="persons" />
      <Kpi value={formatCount(result.events)} label="events" />
    </div>
  );
}

function RetentionBody({ result }: { result: RetentionResult }): JSX.Element {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
        <HeatLegend />
      </div>
      <RetentionHeatmap result={result} />
    </>
  );
}

function TrendBody({ result }: { result: TrendResult }): JSX.Element {
  return <TrendChart result={result} />;
}

function PathsBody({ result }: { result: PathsResult }): JSX.Element {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 16px 0' }}>
        <TruncationChip result={result} />
      </div>
      <PathsTable result={result} />
    </>
  );
}

/** The number for a `complete`/`truncated` result, dispatched by shape. */
function Body({ result }: { result: InsightResult }): JSX.Element | null {
  if (isFunnel(result)) return <FunnelBody result={result} />;
  if (isRetention(result)) return <RetentionBody result={result} />;
  if (isTrend(result)) return <TrendBody result={result} />;
  if (isPaths(result)) return <PathsBody result={result} />;
  return <CountBody result={result} />;
}

export function ResultView({ result }: { result: InsightResult }): JSX.Element {
  const { meta } = result;

  if (meta.status === 'empty') {
    return (
      <>
        <StateCard variant="empty" title="No events matched">
          No events matched these steps in this range. If a step name looks invented, check it against Events.
        </StateCard>
        <StatusFooter meta={meta} />
      </>
    );
  }
  if (meta.status === 'timed_out') {
    return (
      <>
        <StateCard variant="timeout" title="Stopped after 5 s">
          Showing nothing rather than a partial answer. Narrow the date range or add a filter.
        </StateCard>
        <StatusFooter meta={meta} />
      </>
    );
  }
  if (meta.status === 'refused' || meta.status === 'refused_by_database') {
    return (
      <>
        <StateCard variant="refused" icon="i-db" title="Refused by the database">
          This should be impossible; it has been logged as a bug.
        </StateCard>
        <StatusFooter meta={meta} />
      </>
    );
  }
  // complete or truncated: show the number.
  return (
    <>
      <Body result={result} />
      <StatusFooter meta={meta} />
    </>
  );
}

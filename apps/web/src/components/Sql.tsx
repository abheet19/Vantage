/**
 * Sql.tsx — the exact SQL a query produced, syntax-coloured, with its bound parameters listed beneath.
 *
 * Why it exists: the SQL is the artefact of this whole product (design §8: "the SQL is the artefact, not
 * the chart"). This shows the statement verbatim (only wrapped in token spans by `highlight.ts`, which
 * escapes first) and lists `params` as `$1 = …`, so the reader sees the parameterisation that keeps the
 * boundary structural. When `diffAgainst` is set (Edit spec → re-run, 03-UI F3) it renders a line diff
 * instead, so the change between two runs is visible.
 *
 * What it must never do: interpolate a value into the SQL text, or hide a parameter — the whole point is
 * that nothing the model or the user typed became an identifier.
 */
import type { JSX } from 'react';
import { diffSqlLines, highlightSql } from '../lib/highlight.js';

function paramLabel(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (value === null) return 'null';
  return JSON.stringify(value) ?? String(value);
}

export function SqlView({ sql, params, diffAgainst, className = 'sqlpre' }: { sql: string; params: readonly unknown[]; diffAgainst?: string; className?: string }): JSX.Element {
  const html = diffAgainst !== undefined ? diffSqlLines(diffAgainst, sql) : highlightSql(sql);
  return (
    <>
      <pre className={className} data-testid="sql-text" dangerouslySetInnerHTML={{ __html: html }} />
      {params.length > 0 && (
        <div className="small faint mono" data-testid="sql-params" style={{ marginTop: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {params.map((value, i) => `$${i + 1} = ${paramLabel(value)}`).join('   ')}
        </div>
      )}
    </>
  );
}

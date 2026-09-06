/**
 * highlight.ts — SQL and JSON syntax colouring and a line diff, ported from docs/prototype/vantage.html §1.
 *
 * Why it exists: the query card shows the spec (violet JSON) and the SQL (amber) with the prototype's
 * token colours, and Edit-spec → re-run highlights the changed SQL lines (03-UI F3). The prototype does
 * this by building HTML strings; the port keeps that, and keeps its first move — escape `& < >` before
 * anything else — so the SQL and spec, which are values from our own API, cannot inject markup. The
 * output is fed to a single `dangerouslySetInnerHTML` inside a `<pre>`; the text content is unchanged, so
 * the SQL panel still shows the exact statement the API returned.
 *
 * What it must never do: highlight text it did not escape first, or change the characters of the SQL —
 * only wrap tokens in spans.
 */

/** Escape the three characters that could start markup; everything else is left as-is (prototype `esc`). */
export function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

const SQL_TOKENS =
  /(--[^\n]*)|('[^']*')|(\$\d+)|\b(WITH|SELECT|FROM|JOIN|ON|WHERE|AND|GROUP BY|ORDER BY|AS|LEFT|CROSS|DISTINCT|FILTER|WITHIN GROUP|IN|USING|LIMIT|OVER|PARTITION BY|INTERVAL|AT TIME ZONE|LAG|LEAD|NOT|NULL|DESC|ASC)\b/g;

/** Comments, quoted literals, `$n` parameters and keywords wrapped in the prototype's token spans. */
export function highlightSql(sql: string): string {
  return esc(sql).replace(SQL_TOKENS, (_m, comment, str, param, keyword) =>
    comment ? `<span class="c">${comment}</span>`
      : str ? `<span class="s">${str}</span>`
      : param ? `<span class="n">${param}</span>`
      : `<span class="kw">${keyword}</span>`,
  );
}

/** Keys, strings, numbers and literals coloured for the spec block (prototype `hlJson`). */
export function highlightJson(text: string): string {
  return esc(text).replace(/("[^"]*")(\s*:)?|(-?\b\d+(\.\d+)?\b)|\b(true|false|null)\b/g, (_m, str, colon, num, _dec, lit) =>
    str ? (colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`)
      : num ? `<span class="n">${num}</span>`
      : `<span class="n">${lit}</span>`,
  );
}

/** Mark the lines that differ between two SQL texts: unchanged lines are highlighted, changed lines get a del (old) then an add (new) band (prototype `diffSql`). */
export function diffSqlLines(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) {
      out.push(highlightSql(b[i] ?? ''));
    } else {
      if (a[i] !== undefined) out.push(`<span class="del">${highlightSql(a[i] as string)}</span>`);
      if (b[i] !== undefined) out.push(`<span class="add">${highlightSql(b[i] as string)}</span>`);
    }
  }
  return out.join('\n').replace(/<\/span>\n<span class="(add|del)">/g, '</span><span class="$1">');
}

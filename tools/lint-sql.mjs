// lint-sql.mjs — `no-template-curly-in-sql` (LLD §10): no `${}` inside any SQL template literal in domain.
//
// Why it exists: the compilers in `apps/api/src/domain` are the ONLY producers of SQL for the query
// path, and the whole L2 argument is that identifiers are literals in the source and every value is a
// `$n` parameter. One `${spec.event}` inside a query string would turn "values, never identifiers" into
// string concatenation. The TypeScript compiler's own parser finds the template literals — a hand-rolled
// scanner was fooled by a quote inside a regex literal — and the SQL test is case-insensitive over the
// verbs that read or write rows, so `select …` hides nothing that `SELECT …` would not.
//
// What it must never do: accept an allowlist. If a compiler genuinely needs a dynamic fragment (it
// does not — the design has none), that is an LLD change, not a lint exception.
//
// Usage: node tools/lint-sql.mjs [directory]   (default: apps/api/src/domain)

import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { walk } from './lib/walk.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = process.argv[2] ? resolve(process.argv[2]) : join(root, 'apps', 'api', 'src', 'domain');

const SQL = /\b(select|with|insert|update|delete)\b/i;

/** 1-based lines of every template literal in `src` that interpolates a value and whose literal text reads like SQL. */
function sqlInterpolationLines(file, src) {
  const source = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lines = [];
  const visit = (node) => {
    if (ts.isTemplateExpression(node)) {
      const literalText = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
      if (SQL.test(literalText)) lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

const files = walk(target, (name) => name.endsWith('.ts') && !name.endsWith('.d.ts'));
const violations = files.flatMap((f) => {
  const rel = relative(root, f).split(sep).join('/');
  return sqlInterpolationLines(f, readFileSync(f, 'utf8')).map((line) => `${rel}:${line}: template literal containing SQL uses \${} interpolation`);
});

if (violations.length) {
  console.error(`✗ lint-sql: ${violations.length} violation(s) of no-template-curly-in-sql:`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`✓ lint-sql: ${files.length} domain file(s); no SQL template literal interpolates a value.`);

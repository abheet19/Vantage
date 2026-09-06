// check-web-coverage.mjs — enforce the web's per-area coverage floors on every OS (LLD/03-UI S5).
//
// Why it exists: like the API gate (tools/check-coverage-gate.mjs), vitest's per-glob thresholds match
// against path.relative() output, which has backslashes on Windows, so the per-area floors would silently
// pass there. This reads coverage-web/coverage-summary.json (written by `vitest run -c vitest.web.config.ts
// --coverage`), normalises every path to posix, and fails the build if any area is below its floor: the
// pure helpers at 90/85 lines/branches, the impure hooks (router/theme/data hooks) and every component at
// 70/60. A missing summary is a failed run, not a pass.
//
// Usage: node tools/check-web-coverage.mjs

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const summaryPath = join(root, 'coverage-web', 'coverage-summary.json');

/** Pure helpers held highest; hooks and components at the S5 floor. First matching glob wins, most specific first. */
const AREAS = [
  { glob: 'apps/web/src/lib/format.ts', lines: 90, branches: 80 },
  { glob: 'apps/web/src/lib/status.ts', lines: 90, branches: 80 },
  { glob: 'apps/web/src/lib/funnel.ts', lines: 90, branches: 80 },
  { glob: 'apps/web/src/lib/highlight.ts', lines: 90, branches: 80 },
  { glob: 'apps/web/src/lib/**/*.ts', lines: 70, branches: 60 },
  { glob: 'apps/web/src/components/**/*.{ts,tsx}', lines: 70, branches: 60 },
];

/** A brace/star glob → a posix regex: `**\/` is any run of directories, `*` never crosses a slash, `{a,b}` is an alternation. */
function globToRegExp(glob) {
  let body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  body = body.replace(/\\\{([^}]*)\\\}/g, (_m, inner) => `(?:${inner.split(',').join('|')})`);
  body = body.replace(/\*\*\//g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '(?:.*/)?');
  return new RegExp(`^${body}$`);
}

const AREA_RES = AREAS.map((a) => ({ ...a, re: globToRegExp(a.glob) }));
const posix = (file) => (isAbsolute(file) ? relative(root, file) : file).split(sep).join('/').split('\\').join('/');

if (!existsSync(summaryPath)) {
  console.error(`✗ check-web-coverage: no summary at ${posix(summaryPath)} — the web tests failed upstream, or coverage was not run.`);
  process.exit(1);
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const failures = [];
let checked = 0;

for (const [file, metrics] of Object.entries(summary)) {
  if (file === 'total') continue;
  const rel = posix(file);
  const area = AREA_RES.find((a) => a.re.test(rel));
  if (!area) continue;
  checked += 1;
  const lines = metrics.lines?.pct ?? 0;
  const branches = metrics.branches?.pct ?? 0;
  if (lines < area.lines) failures.push(`${rel}: lines ${lines}% < ${area.lines}% [${area.glob}]`);
  if (branches < area.branches) failures.push(`${rel}: branches ${branches}% < ${area.branches}% [${area.glob}]`);
}

if (checked === 0) {
  console.error('✗ check-web-coverage: the summary named no web helper or component files — coverage include is misconfigured.');
  process.exit(1);
}
if (failures.length) {
  console.error(`✗ check-web-coverage: ${failures.length} area(s) below floor:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ check-web-coverage: ${checked} web files meet their per-area floors (helpers 90/80, components & hooks 70/60).`);

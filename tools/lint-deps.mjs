// lint-deps.mjs — enforces LLD §1's dependency direction; the build fails on a violation.
//
// Why it exists: the boundaries that make Vantage's security argument true are directory boundaries —
// domain is pure, `modules/ask` cannot reach the write pool, `modules/insights` cannot reach a model —
// and a boundary that only lives in a diagram erodes one convenient import at a time. This script
// reads import specifiers (and, for three rules, identifiers) with no type information, so it runs in
// under a second and needs no build. Rules for `ask`, `insights` and `web` are written now, before
// those directories exist, so the first file in them is already checked. The `seal(` rule (S3 hardening)
// closes the one door the type-level brand leaves open: `seal` must be exported for the compilers, so
// the linter is what keeps every other file — tests included — from constructing a `Compiled`.
//
// What it must never do: be silenced per-file. There is no ignore comment on purpose; an exception is
// an LLD change.
//
// Usage: node tools/lint-deps.mjs [root]   (default: the repository; a test passes a scratch tree)

import { readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walk } from './lib/walk.mjs';

const root = process.argv[2] ? resolve(process.argv[2]) : resolve(fileURLToPath(new URL('..', import.meta.url)));
const isSource = (name) => /\.(ts|tsx|mts|js|mjs)$/.test(name) && !name.endsWith('.d.ts');

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function importsOf(src) {
  const out = [];
  const re = /(?:import|export)\s*(?:[^'"`;]*?\s*from\s*)?['"]([^'"]+)['"]|(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of src.matchAll(re)) out.push(m[1] ?? m[2]);
  return out;
}

const posix = (p) => relative(root, p).split(sep).join('/');

/** Each rule: which files, and a function (file, imports, source) → violation messages. */
const rules = [
  {
    name: 'contracts depends on zod only',
    files: (f) => f.startsWith('packages/contracts/src/'),
    check: (_f, imports) => imports.filter((s) => s !== 'zod' && !s.startsWith('.')).map((s) => `imports "${s}" (only zod and relative files allowed)`),
  },
  {
    name: 'domain is PURE: never infra, never Nest, never pg, never modules',
    files: (f) => f.startsWith('apps/api/src/domain/'),
    check: (_f, imports, src) => {
      const bad = imports.filter((s) => /^@nestjs\b|^pg\b|^express\b|\/infra\/|\/modules\/|^uuid\b/.test(s)).map((s) => `imports "${s}"`);
      if (/\bDate\.now\s*\(/.test(src)) bad.push('calls Date.now() — the clock is a parameter in domain');
      if (/\bnew\s+Date\s*\(\s*\)/.test(src)) bad.push('calls new Date() with no argument — the clock is a parameter in domain');
      if (/\bMath\.random\s*\(/.test(src) || /\brandomUUID\s*\(/.test(src) || /\brandomBytes\s*\(/.test(src)) bad.push('draws randomness — mint/ids are parameters in domain');
      if (/\bprocess\.env\b/.test(src)) bad.push('reads process.env');
      return bad;
    },
  },
  {
    name: 'infra never imports modules',
    files: (f) => f.startsWith('apps/api/src/infra/'),
    check: (_f, imports) => imports.filter((s) => /\/modules\//.test(s)).map((s) => `imports "${s}"`),
  },
  {
    name: 'modules/ask never touches the RW pool',
    files: (f) => f.startsWith('apps/api/src/modules/ask/'),
    check: (_f, imports, src) => {
      const bad = /\bPG_RW\b/.test(src) ? ['mentions PG_RW — the ask path cannot reach the write pool (LLD §1, V7d)'] : [];
      bad.push(...imports.filter((s) => /^pg\b/.test(s) || /database\.module|\/transaction\.js$/.test(s)).map((s) => `imports "${s}" — the ask path writes only through AuditService (V7d)`));
      return bad;
    },
  },
  {
    name: 'only modules/ask imports an LlmPort adapter (design §6.3)',
    files: (f) => f.startsWith('apps/api/src/') && !f.startsWith('apps/api/src/infra/llm/') && !f.startsWith('apps/api/src/modules/ask/'),
    check: (_f, imports) => imports.filter((s) => /\/infra\/llm\//.test(s)).map((s) => `imports "${s}" — nothing but modules/ask may reach a model`),
  },
  {
    name: 'modules/insights never imports an LlmPort',
    files: (f) => f.startsWith('apps/api/src/modules/insights/'),
    check: (_f, imports, src) => {
      const bad = imports.filter((s) => /llm|anthropic|ollama|\/ask\//i.test(s)).map((s) => `imports "${s}"`);
      if (/\b(LlmPort|LLM_PORT|AnthropicLlm|OllamaLlm|NoneLlm)\b/.test(src)) bad.push('mentions an LlmPort symbol — the model cannot be reached from the query path (LLD §1)');
      return bad;
    },
  },
  {
    name: 'only domain/compile seals a Compiled (V7b)',
    files: (f) => f.startsWith('apps/') && !f.startsWith('apps/api/src/domain/compile/'),
    check: (_f, imports, src) => {
      const bad = imports.filter((s) => /\/compile\/types(\.js)?$/.test(s)).map((s) => `imports "${s}" — the brand's constructor is private to domain/compile; import from compile/index.js`);
      if (/\bseal\s*\(/.test(src)) bad.push('calls seal( — only the compilers in domain/compile may produce a Compiled (V7b)');
      return bad;
    },
  },
  {
    name: 'web depends on contracts only, never api internals',
    files: (f) => f.startsWith('apps/web/src/'),
    check: (_f, imports) => imports.filter((s) => /@vantage\/api|apps\/api|\.\.\/\.\.\/api/.test(s)).map((s) => `imports "${s}"`),
  },
];

const files = [...walk(join(root, 'apps'), isSource), ...walk(join(root, 'packages'), isSource)].map((f) => ({ abs: f, rel: posix(f) }));
const violations = [];
for (const { abs, rel } of files) {
  const src = stripComments(readFileSync(abs, 'utf8'));
  const imports = importsOf(src);
  for (const rule of rules) {
    if (!rule.files(rel)) continue;
    for (const msg of rule.check(rel, imports, src)) violations.push(`${rel}: ${msg}  [${rule.name}]`);
  }
}

if (violations.length) {
  console.error(`✗ lint-deps: ${violations.length} dependency-direction violation(s):`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`✓ lint-deps: ${files.length} files respect the LLD §1 dependency direction.`);

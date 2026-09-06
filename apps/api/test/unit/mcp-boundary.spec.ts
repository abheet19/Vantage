/**
 * mcp-boundary.spec.ts — the MCP surface cannot reach a model or the write pool, as a test over the source (design §5.3, LLD §1).
 *
 * `tools/lint-deps.mjs` belonged to the S3 hardening session while S4 was built, so the rule for `modules/mcp` lives here:
 * no file under `apps/api/src/modules/mcp` or the stdio entrypoint mentions `PG_RW`, imports `pg`, names an LlmPort or
 * imports `infra/llm`. The test also proves it can fail, by running the same check on a synthetic violating file.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const MCP_DIR = path.join(SRC, 'modules', 'mcp');
const ENTRYPOINT = path.join(SRC, 'mcp.ts');

/** Each rule is a regex over comment-stripped source and the sentence it violates. */
const RULES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'mentions PG_RW — the MCP surface cannot reach the write pool', pattern: /\bPG_RW\b/ },
  { name: "imports 'pg' — the module holds only what the read-only token hands it", pattern: /from\s+['"]pg['"]|import\(\s*['"]pg['"]\s*\)|require\(\s*['"]pg['"]\s*\)/ },
  { name: 'names an LlmPort symbol — no model is reachable from the MCP path', pattern: /\b(LlmPort|LLM_PORT|LLM_ADAPTER|AnthropicLlm|OllamaLlm|NoneLlm|selectLlm)\b/ },
  { name: 'imports infra/llm — only modules/ask may reach an adapter', pattern: /infra\/llm\// },
  { name: 'imports modules/ask or modules/audit — the MCP path neither asks a model nor writes an audit row', pattern: /modules\/(ask|audit)\/|\.\.\/(ask|audit)\// },
  { name: 'imports transaction or createPool — pools come from the DI token, and only the RO one', pattern: /from\s+['"][^'"]*\/transaction\.js['"]|\bcreatePool\b/ },
];

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function violations(file: string, src: string): string[] {
  const code = stripComments(src);
  return RULES.filter((r) => r.pattern.test(code)).map((r) => `${path.basename(file)}: ${r.name}`);
}

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? sourcesUnder(p) : name.endsWith('.ts') ? [p] : [];
  });
}

describe('modules/mcp and the stdio entrypoint cannot reach a model or the write pool', () => {
  const files = [...sourcesUnder(MCP_DIR), ENTRYPOINT];

  it('covers the module (at least the factory, the tools, the module and the entrypoint)', () => {
    const names = files.map((f) => path.basename(f));
    expect(names).toEqual(expect.arrayContaining(['mcp-server.factory.ts', 'mcp-tools.ts', 'mcp.module.ts', 'mcp.ts']));
  });

  it.each(RULES.map((r) => [r.name]))('no file %s', (name) => {
    const rule = RULES.find((r) => r.name === name)!;
    const offenders = files.filter((f) => rule.pattern.test(stripComments(readFileSync(f, 'utf8')))).map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('the module is wired from InsightsModule and EventsModule only, never from a writer', () => {
    const module = stripComments(readFileSync(path.join(MCP_DIR, 'mcp.module.ts'), 'utf8'));
    expect(module).toMatch(/imports:\s*\[InsightsModule,\s*EventsModule\]/);
    expect(module).not.toMatch(/IngestModule|IdentityModule|ProjectsModule|AskModule|AuditModule/);
  });

  it('the check itself fails a synthetic file that imports pg, mentions PG_RW or reaches an adapter', () => {
    const bad = `import pg from 'pg';\nimport { PG_RW } from '../../infra/tokens.js';\nimport { LLM_PORT } from '../../infra/llm/port.js';\nexport const x = [pg, PG_RW, LLM_PORT];\n`;
    expect(violations('evil.ts', bad)).toEqual([
      'evil.ts: mentions PG_RW — the MCP surface cannot reach the write pool',
      "evil.ts: imports 'pg' — the module holds only what the read-only token hands it",
      'evil.ts: names an LlmPort symbol — no model is reachable from the MCP path',
      'evil.ts: imports infra/llm — only modules/ask may reach an adapter',
    ]);
    expect(violations('ok.ts', `// PG_RW only in a comment\nimport { PG_RO } from '../../infra/tokens.js';\nexport const y = PG_RO;\n`)).toEqual([]);
  });
});

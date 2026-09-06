/**
 * lint-deps.spec.ts — V7(d) as a test of the linter itself: on a scratch tree, an import path from modules/ask to PG_RW,
 * to pg, or from the query path to an LlmPort adapter fails the build with the rule named; the clean tree passes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LINT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tools', 'lint-deps.mjs');

interface LintRun {
  status: number;
  output: string;
}

/** Runs the linter with a scratch repository root holding `files` (paths relative to that root). */
function lint(files: Record<string, string>): LintRun {
  const root = mkdtempSync(path.join(tmpdir(), 'vantage-lint-deps-'));
  try {
    for (const [rel, src] of Object.entries(files)) {
      const abs = path.join(root, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, src);
    }
    try {
      return { status: 0, output: execFileSync(process.execPath, [LINT, root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, output: `${e.stdout}${e.stderr}` };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const CLEAN_ASK = `import { AuditService } from '../audit/audit.service.js';\nimport { LLM_PORT } from '../../infra/llm/port.js';\nexport const ok = [AuditService, LLM_PORT];\n`;

describe('tools/lint-deps.mjs (V7d)', () => {
  it('fails a synthetic modules/ask → PG_RW import, naming the rule', () => {
    const r = lint({ 'apps/api/src/modules/ask/evil.ts': `import { PG_RW } from '../../infra/tokens.js';\nexport const x = PG_RW;\n` });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/modules\/ask\/evil\.ts: mentions PG_RW — the ask path cannot reach the write pool/);
  });

  it('fails modules/ask importing pg or the database module directly — the only writer it may use is AuditService', () => {
    const r = lint({
      'apps/api/src/modules/ask/pool.ts': `import pg from 'pg';\nexport const p = new pg.Pool();\n`,
      'apps/api/src/modules/ask/db.ts': `import { createPool } from '../../infra/database.module.js';\nexport const c = createPool;\n`,
    });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/pool\.ts: imports "pg" — the ask path writes only through AuditService/);
    expect(r.output).toMatch(/db\.ts: imports "\.\.\/\.\.\/infra\/database\.module\.js"/);
  });

  it('fails any file outside modules/ask (and infra/llm itself) that imports an LlmPort adapter — design §6.3 as a rule', () => {
    const r = lint({
      'apps/api/src/modules/insights/leak.ts': `import { NoneLlm } from '../../infra/llm/none.js';\nexport const l = NoneLlm;\n`,
      'apps/api/src/modules/ingest/leak.ts': `import { LLM_PORT } from '../../infra/llm/port.js';\nexport const l = LLM_PORT;\n`,
    });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/insights\/leak\.ts: imports "\.\.\/\.\.\/infra\/llm\/none\.js" — nothing but modules\/ask may reach a model/);
    expect(r.output).toMatch(/insights\/leak\.ts: mentions an LlmPort symbol/);
    expect(r.output).toMatch(/ingest\/leak\.ts: imports "\.\.\/\.\.\/infra\/llm\/port\.js"/);
  });

  it('fails any file outside domain/compile that imports compile/types.js or calls the sealer — the brand’s constructor is private (V7b)', () => {
    // The sealer's name and its module are spelled in two halves so this test file does not itself trip the rule it exercises.
    const SEAL = ['se', 'al'].join('');
    const TYPES = ['compile', 'types.js'].join('/');
    const r = lint({
      'apps/api/src/infra/forge.ts': `import { ${SEAL} } from '../domain/${TYPES}';\nexport const c = ${SEAL}('count', {}, {}, {});\n`,
      'apps/api/test/unit/forge.spec.ts': `import { ${SEAL} } from '../../src/domain/${TYPES}';\nexport const c = ${SEAL};\n`,
      'apps/api/src/domain/compile/count.ts': `import { ${SEAL} } from './types.js';\nexport const ok = ${SEAL}('count', {}, {}, {});\n`,
    });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/infra\/forge\.ts: imports "\.\.\/domain\/compile\/types\.js" — the brand's constructor is private to domain\/compile/);
    expect(r.output).toMatch(new RegExp(`infra/forge\\.ts: calls ${SEAL}\\( — only the compilers in domain/compile may produce a Compiled`));
    expect(r.output).toMatch(/test\/unit\/forge\.spec\.ts: imports "\.\.\/\.\.\/src\/domain\/compile\/types\.js"/);
    expect(r.output).not.toMatch(/count\.ts/);
  });

  it('passes a tree where modules/ask imports the port and AuditService, and infra/llm imports its own files', () => {
    const r = lint({
      'apps/api/src/modules/ask/ask.service.ts': CLEAN_ASK,
      'apps/api/src/infra/llm/select.ts': `import { NoneLlm } from './none.js';\nexport const s = NoneLlm;\n`,
    });
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/2 files respect the LLD §1 dependency direction/);
  });
});

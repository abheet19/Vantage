/**
 * compiled-brand.spec.ts — V7(b) at the type level and at run time: `Compiled` is branded by a private symbol only
 * `compile()`'s sealers can set, so a hand-made statement is a compile error (the `@ts-expect-error` lines fail
 * `npm run typecheck` if the brand ever weakens), a runtime forgery or a spread copy is rejected by `isCompiled` before
 * `QueryRunner.run` touches a pool, a sealed statement cannot be edited anywhere inside (S3 hardening: `c.meta.sql =
 * 'DROP …'` used to succeed), and `tools/lint-deps.mjs` fails a file outside `domain/compile` that imports the sealer.
 */
import { CountSpec, QUERY_LIMITS } from '@vantage/contracts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { compileCount, isCompiled, type Compiled, type CompileCtx, type Statement } from '../../src/domain/compile/index.js';
import { FixedClock } from '../../src/infra/clock.js';
import { QueryRunner } from '../../src/infra/query-runner.js';
import { PROJECT_ID } from '../helpers/arbitraries.js';

const LINT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tools', 'lint-deps.mjs');
/** The sealer's name and its module, each spelled in two halves so this test file does not itself trip the lint rule it exercises. */
const SEAL = ['se', 'al'].join('');
const TYPES = ['compile', 'types.js'].join('/');

const ctx: CompileCtx = { projectId: PROJECT_ID, timezone: 'UTC', rowCap: QUERY_LIMITS.rowCap };
const meta: Statement = { sql: 'SELECT 1', params: [] };
const compiled = () => compileCount(CountSpec.parse({ kind: 'count', project: PROJECT_ID, range: { from: '2026-08-01', to: '2026-08-31' }, event: { event: 'signup', where: [{ key: 'plan', op: 'in', value: ['free', 'team'] }] } }), ctx);
const fakePool = () => ({ idleCount: 1, totalCount: 0, waitingCount: 0, connect: vi.fn() }) as unknown as pg.Pool;

describe('Compiled is a branded type (V7b)', () => {
  it('a hand-made object with every public field is not a Compiled — the brand is a private symbol', () => {
    // @ts-expect-error: no code outside domain/compile can produce the brand, so this literal does not type-check
    const forged: Compiled = { sql: 'DROP TABLE events', params: [], kind: 'count', ctx, meta };
    expect(isCompiled(forged)).toBe(false);
  });

  it('QueryRunner.run does not accept a Statement, only a Compiled', async () => {
    const pool = fakePool();
    const runner = new QueryRunner(pool, new FixedClock(new Date('2026-09-05T00:00:00Z')));
    const statement: Statement = { sql: 'SELECT 1', params: [] };
    // @ts-expect-error: a Statement lacks the brand; the runner's parameter type refuses it
    await expect(runner.run(statement, (rows) => rows)).rejects.toThrow(/not produced by compile\(\)/);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('what compile() returns carries the brand and is frozen all the way down: the object, ctx, params, meta and its params', () => {
    const c = compiled();
    expect(isCompiled(c)).toBe(true);
    expect([c, c.ctx, c.params, c.meta, c.meta.params].every((part) => Object.isFrozen(part))).toBe(true);
    expect(isCompiled(JSON.parse(JSON.stringify(c)))).toBe(false);
  });

  it('attack: every mutation of a sealed statement throws (strict mode) and changes nothing — sql, meta.sql, ctx.rowCap, params, meta.params', () => {
    const c = compiled();
    const mutable = c as unknown as { sql: string; meta: { sql: string; params: unknown[] }; ctx: { rowCap: number }; params: unknown[] };
    expect(() => (mutable.sql = 'DROP TABLE events')).toThrow(TypeError);
    expect(() => (mutable.meta.sql = 'DROP TABLE events')).toThrow(TypeError);
    expect(() => (mutable.ctx.rowCap = 1e9)).toThrow(TypeError);
    expect(() => mutable.params.push('x')).toThrow(TypeError);
    expect(() => (mutable.params[0] = 'other-project')).toThrow(TypeError);
    expect(() => mutable.meta.params.push('x')).toThrow(TypeError);
    expect(c.meta.sql).not.toContain('DROP');
    expect(c.ctx.rowCap).toBe(QUERY_LIMITS.rowCap);
    expect(c.params[0]).toBe(PROJECT_ID);
    expect(isCompiled(c)).toBe(true);
  });

  it('attack: a spread copy of a compiled statement with its SQL swapped is NOT compiled — the brand is identity, not shape', async () => {
    const c = compiled();
    const swapped: Compiled = { ...c, sql: 'DROP TABLE events' };
    expect(isCompiled(swapped)).toBe(false);
    expect(isCompiled({ ...c })).toBe(false);
    expect(isCompiled(Object.create(c) as object)).toBe(false);
    const pool = fakePool();
    const runner = new QueryRunner(pool, new FixedClock(new Date('2026-09-05T00:00:00Z')));
    await expect(runner.run(swapped, (rows) => rows)).rejects.toThrow(/not produced by compile\(\)/);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('attack: a file outside domain/compile that imports the brand module and calls the sealer fails lint-deps on a scratch tree, both violations named', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vantage-seal-lint-'));
    try {
      const forge = path.join(root, 'apps', 'api', 'src', 'modules', 'insights', 'forge.ts');
      mkdirSync(path.dirname(forge), { recursive: true });
      writeFileSync(forge, `import { ${SEAL} } from '../../domain/${TYPES}';\nexport const c = ${SEAL}('count', { projectId: 'p', timezone: 'UTC', rowCap: 1 }, { sql: 'DROP TABLE events', params: [] }, { sql: 'SELECT 1', params: [] });\n`);
      const clean = path.join(root, 'apps', 'api', 'src', 'domain', 'compile', 'count.ts');
      mkdirSync(path.dirname(clean), { recursive: true });
      writeFileSync(clean, `import { ${SEAL} } from './types.js';\nexport const ok = ${SEAL}('count', {}, {}, {});\n`);
      let status = 0;
      let output = '';
      try {
        output = execFileSync(process.execPath, [LINT, root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (err) {
        const e = err as { status: number; stdout: string; stderr: string };
        status = e.status;
        output = `${e.stdout}${e.stderr}`;
      }
      expect(status).toBe(1);
      expect(output).toMatch(/insights\/forge\.ts: imports "\.\.\/\.\.\/domain\/compile\/types\.js" — the brand's constructor is private to domain\/compile/);
      expect(output).toMatch(new RegExp(`insights/forge\\.ts: calls ${SEAL}\\( — only the compilers in domain/compile may produce a Compiled`));
      expect(output).not.toMatch(/count\.ts/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

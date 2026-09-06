/**
 * lint-sql.spec.ts — the SQL-interpolation lint catches both reviewer bypasses: lowercase verbs, and a quote inside a regex literal.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const LINT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'tools', 'lint-sql.mjs');

interface LintRun {
  status: number;
  output: string;
}

/** Runs the lint against a scratch directory holding `files`, returning the exit status and the combined output. */
function lint(files: Record<string, string>): LintRun {
  const dir = mkdtempSync(path.join(tmpdir(), 'vantage-lint-sql-'));
  try {
    for (const [name, src] of Object.entries(files)) writeFileSync(path.join(dir, name), src);
    try {
      return { status: 0, output: execFileSync(process.execPath, [LINT, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, output: `${e.stdout}${e.stderr}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const BYPASS_LOWERCASE = `export const q = (id: string) => \`select * from events where project_id = \${id}\`;\n`;
const BYPASS_REGEX_QUOTE = `export const quote = /'/;\nexport const q = (col: string) => \`SELECT \${col} FROM events\`;\n`;
const CLEAN = `export const sql = \`SELECT count(*) FROM events WHERE project_id = $1\`;\nexport const label = (n: number) => \`\${n} rows\`;\nexport const re = /"/;\n`;

describe('tools/lint-sql.mjs', () => {
  it('flags a lowercase `select … ${id}` (bypass 1: the verb test is case-insensitive)', () => {
    const r = lint({ 'lower.ts': BYPASS_LOWERCASE });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/lower\.ts:1: template literal containing SQL uses \$\{\} interpolation/);
  });

  it('flags an interpolated SQL literal that follows a regex containing a quote (bypass 2: a real parser, not a scanner)', () => {
    const r = lint({ 'regex.ts': BYPASS_REGEX_QUOTE });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/regex\.ts:2: template literal/);
  });

  it('passes a directory whose SQL literals interpolate nothing and whose interpolations are not SQL', () => {
    const r = lint({ 'clean.ts': CLEAN });
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/1 domain file\(s\); no SQL template literal interpolates a value/);
  });

  it('also catches UPDATE and DELETE, and reports every file', () => {
    const r = lint({ 'clean.ts': CLEAN, 'upd.ts': 'export const u = (t: string) => `update ${t} set x = 1`;\n', 'del.ts': 'export const d = (t: string) => `DELETE FROM ${t}`;\n' });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/2 violation\(s\)/);
    expect(r.output).toMatch(/upd\.ts:1/);
    expect(r.output).toMatch(/del\.ts:1/);
    expect(r.output).not.toMatch(/clean\.ts/);
  });
});

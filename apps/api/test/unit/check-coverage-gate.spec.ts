/**
 * check-coverage-gate.spec.ts — the per-area enforcer reads a coverage summary with Windows or posix absolute paths alike,
 * fails an area below its floor by name, fails an area that matched nothing, and passes when every floor is met.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const TOOL = path.join(ROOT, 'tools', 'check-coverage-gate.mjs');

interface Run {
  status: number;
  output: string;
}

const metric = (covered: number, total: number) => ({ total, covered, skipped: 0, pct: total === 0 ? 100 : (100 * covered) / total });
const file = (linesPct: number, branchesPct: number) => ({
  lines: metric(linesPct, 100),
  branches: metric(branchesPct, 100),
  functions: metric(100, 100),
  statements: metric(linesPct, 100),
});

/** Writes `summary` to a scratch file and runs the enforcer on it, probe skipped (the probe is exercised by `npm run coverage` itself). */
function run(summary: Record<string, unknown>): Run {
  const dir = mkdtempSync(path.join(tmpdir(), 'vantage-cov-gate-'));
  try {
    const p = path.join(dir, 'coverage-summary.json');
    writeFileSync(p, JSON.stringify(summary));
    try {
      return { status: 0, output: execFileSync(process.execPath, [TOOL, '--skip-probe', '--summary', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, output: `${e.stdout}${e.stderr}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** One well-covered file per area, addressed the way a Windows run writes paths (backslashes, absolute). */
function windowsSummary(over: Record<string, unknown> = {}): Record<string, unknown> {
  const win = (rel: string) => path.win32.join(ROOT.replace(/\//g, '\\'), ...rel.split('/'));
  return {
    total: file(99, 99),
    [win('packages/contracts/src/ask.ts')]: file(99, 99),
    [win('apps/api/src/domain/prompt.ts')]: file(99, 99),
    [win('apps/api/src/modules/ask/ask.service.ts')]: file(99, 99),
    [win('apps/api/src/infra/llm/none.ts')]: file(99, 99),
    ...over,
  };
}

describe('tools/check-coverage-gate.mjs', () => {
  it('passes a summary whose paths use backslashes when every area meets its floor — the matching no longer depends on the OS', () => {
    const r = run(windowsSummary());
    expect(r.status).toBe(0);
    expect(r.output).toMatch(/every LLD §7 per-area floor is met/);
    expect(r.output).toMatch(/apps\/api\/src\/domain\/\*\*\/\*\.ts \(1 files\): lines 99\.00%, branches 99\.00%/);
  });

  it('fails when one area is below its floor, naming the area and the metric', () => {
    const r = run(windowsSummary({ [path.win32.join(ROOT, 'apps', 'api', 'src', 'domain', 'parse-spec.ts')]: file(40, 10) }));
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/✗ apps\/api\/src\/domain\/\*\*\/\*\.ts \(2 files\): lines 69\.50% < 95%, branches 54\.50% < 90%/);
    expect(r.output).toMatch(/1 per-area floor\(s\) not met/);
  });

  it('fails when an area matches no file at all — a dead glob is a dead gate', () => {
    const summary = windowsSummary();
    delete summary[path.win32.join(ROOT.replace(/\//g, '\\'), 'apps', 'api', 'src', 'infra', 'llm', 'none.ts')];
    const r = run(summary);
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/apps\/api\/src\/infra\/\*\*\/\*\.ts: matched no file/);
  });

  it('accepts posix absolute paths too', () => {
    const posix = (rel: string) => `${ROOT.replace(/\\/g, '/')}/${rel}`;
    const r = run({
      total: file(99, 99),
      [posix('packages/contracts/src/ask.ts')]: file(99, 99),
      [posix('apps/api/src/domain/prompt.ts')]: file(99, 99),
      [posix('apps/api/src/modules/ask/ask.service.ts')]: file(99, 99),
      [posix('apps/api/src/infra/llm/none.ts')]: file(99, 99),
    });
    expect(r.status).toBe(0);
  });

  it('fails when the summary file does not exist, saying that the tests failed upstream rather than pointing at a missing file', () => {
    let status = 0;
    let output: string;
    try {
      output = execFileSync(process.execPath, [TOOL, '--skip-probe', '--summary', path.join(tmpdir(), 'does-not-exist.json')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      status = e.status;
      output = `${e.stdout}${e.stderr}`;
    }
    expect(status).toBe(1);
    expect(output).toMatch(/no coverage summary at .*does-not-exist\.json/);
    expect(output).toMatch(/the tests failed upstream — fix them first/);
  });
});

// check-coverage-gate.mjs — proves the coverage gate is alive, then enforces the per-area floors on every OS.
//
// Why it exists: the S1 hostile review found that vitest's per-glob thresholds never fired on Windows —
// vitest matches its glob keys against `path.relative()` output, which has backslashes there, with a
// picomatch that only converts them when told to (`pm(glob)` is called with no options), so every glob
// matched zero files and every per-area gate silently passed. A dead gate looks exactly like a green
// one. This tool runs after `vitest run --coverage` (the suite runs once) and does two things: (1) it
// spawns vitest on one tiny unit file with an impossible global line threshold and asserts a non-zero
// exit — if that ever exits 0, thresholds are not being enforced and the build fails saying so; (2) it
// reads `coverage/coverage-summary.json`, normalises every path to posix, and checks the LLD §7 per-area
// floors from `coverage-thresholds.mjs` itself, so the per-area gate no longer depends on vitest's
// matching. The global floor in `vitest.config.ts` still fires natively everywhere.
//
// What it must never do: run the whole suite again, or accept a missing summary as a pass. A missing
// summary is named for what it usually is — tests failed upstream, so vitest never wrote it — because
// `npm run coverage` chains the two with `&&` and this tool only runs after a green suite.
//
// Usage: node tools/check-coverage-gate.mjs [--summary path] [--skip-probe]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PER_AREA } from './coverage-thresholds.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const summaryPath = args.includes('--summary') ? resolve(args[args.indexOf('--summary') + 1]) : join(root, 'coverage', 'coverage-summary.json');
const skipProbe = args.includes('--skip-probe');

const METRICS = ['lines', 'branches', 'functions', 'statements'];

/** An area glob → a regex over posix paths: a double star before a slash is any directory run (or none); a single star never crosses a slash. */
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*\*\//g, '\0').replace(/\*/g, '[^/]*').replace(/\0/g, '(?:.*/)?');
  return new RegExp(`^${body}$`);
}

const posix = (file) => (isAbsolute(file) ? relative(root, file) : file).split(sep).join('/').split('\\').join('/');

/**
 * Proves vitest's threshold check can fail a run: one small unit file, an impossible global threshold, a
 * throwaway reports directory. Exit 0 here means the gate mechanism is dead, whatever the real run said.
 */
function probeGateIsAlive() {
  const reports = mkdtempSync(join(tmpdir(), 'vantage-coverage-probe-'));
  try {
    const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
    const r = spawnSync(
      process.execPath,
      [vitest, 'run', '--project', 'api-unit', 'test/unit/status.spec.ts', '--coverage', '--coverage.thresholds.lines=101', '--coverage.reporter=text', `--coverage.reportsDirectory=${reports}`],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const output = `${r.stdout}${r.stderr}`;
    const thresholdError = /does not meet global threshold \(101%\)/.test(output);
    if (r.status === 0 || !thresholdError) {
      console.error('✗ check-coverage-gate: the coverage gate is DEAD — an impossible threshold (lines 101%) did not fail the run.');
      console.error(output.split('\n').slice(-25).join('\n'));
      process.exit(1);
    }
    console.log('✓ check-coverage-gate: probe — an impossible threshold fails the run (the gate is alive).');
  } finally {
    rmSync(reports, { recursive: true, force: true });
  }
}

/** Aggregates the summary's per-file counts into each area and compares with its floor. */
function enforcePerArea() {
  if (!existsSync(summaryPath)) {
    console.error(`✗ check-coverage-gate: no coverage summary at ${summaryPath}.`);
    console.error('  vitest writes coverage-summary.json only after a run in which every test passed (coverage.reportOnFailure is off), so either');
    console.error('  the tests failed upstream — fix them first; this gate has not judged anything — or `vitest run --coverage` has not been run yet.');
    process.exit(1);
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const files = Object.entries(summary).filter(([key]) => key !== 'total');
  const failures = [];
  for (const [glob, floors] of Object.entries(PER_AREA)) {
    const re = globToRegExp(glob);
    const matched = files.filter(([file]) => re.test(posix(file)));
    if (matched.length === 0) {
      failures.push(`${glob}: matched no file in the summary — the include list or the glob is wrong`);
      continue;
    }
    const totals = Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]));
    for (const [, cov] of matched) for (const m of METRICS) {
      totals[m].covered += cov[m].covered;
      totals[m].total += cov[m].total;
    }
    const pct = (m) => (totals[m].total === 0 ? 100 : (100 * totals[m].covered) / totals[m].total);
    const report = METRICS.filter((m) => m in floors).map((m) => `${m} ${pct(m).toFixed(2)}%${pct(m) < floors[m] ? ` < ${floors[m]}%` : ''}`);
    const failed = METRICS.some((m) => m in floors && pct(m) < floors[m]);
    (failed ? failures : []).push(`${glob} (${matched.length} files): ${report.join(', ')}`);
    console.log(`${failed ? '✗' : '✓'} ${glob} (${matched.length} files): ${report.join(', ')}`);
  }
  if (failures.length) {
    console.error(`✗ check-coverage-gate: ${failures.length} per-area floor(s) not met:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log('✓ check-coverage-gate: every LLD §7 per-area floor is met.');
}

if (!skipProbe) probeGateIsAlive();
enforcePerArea();

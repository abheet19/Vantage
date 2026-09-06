/**
 * vitest.config.ts — three projects, one coverage gate that FAILS the build.
 *
 * Why it exists: LLD §7 names the coverage gates per area (domain 95/90, contracts 95/90, modules
 * 85/75, infra 80/70) and Gate 4 says a report is not a gate. The numbers live in
 * `tools/coverage-thresholds.mjs` and are enforced twice: vitest's GLOBAL floor fires natively on every
 * OS; its per-glob thresholds are kept but only fire on POSIX paths (vitest feeds `path.relative()`
 * output, backslashes on Windows, to a picomatch without the `windows` option, and offers no posix or
 * normalisation setting — `perFile` is a different knob), so `tools/check-coverage-gate.mjs` re-checks
 * the per-area floors from the `json-summary` reporter's output after the run and first proves the gate
 * can fail at all. The integration project runs files serially: the self-test suite widens a role on the
 * shared test database, and a parallel file booting at that moment would refuse for the right reason at
 * the wrong time.
 *
 * What it must never do: lower a threshold to make a build pass, or point `@vantage/contracts` at a
 * built `dist` — tests run against source so a stale build cannot hide a broken contract.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { GLOBAL, PER_AREA } from './tools/coverage-thresholds.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const alias = { '@vantage/contracts': path.join(root, 'packages/contracts/src/index.ts') };

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'contracts', root: path.join(root, 'packages/contracts'), include: ['test/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: { name: 'api-unit', root: path.join(root, 'apps/api'), include: ['test/unit/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'api-integration',
          root: path.join(root, 'apps/api'),
          include: ['test/integration/**/*.spec.ts'],
          globalSetup: ['test/db/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: path.join(root, 'coverage'),
      include: ['packages/contracts/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['apps/api/src/main.ts', 'apps/api/src/migrate.ts', 'apps/api/src/fixture-load.ts'],
      thresholds: { ...GLOBAL, ...PER_AREA },
    },
  },
});

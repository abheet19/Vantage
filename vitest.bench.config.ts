/**
 * vitest.bench.config.ts — the CI performance guard, run on its own (`npm run bench`), never in `npm run check`.
 *
 * Why it is separate: generating a million rows and running three heavy queries is too slow for the per-commit
 * gate, so LLD §7.4's bench runs as its own CI job and on demand locally. It reuses the integration harness's
 * global-setup (embedded PostgreSQL 17, or CI's service via VANTAGE_TEST_DB) and points `@vantage/contracts` at
 * source, exactly as vitest.config.ts's api-integration project does; it declares no coverage — the bench asserts
 * time, not lines.
 *
 * What it must never do: lower a budget to pass (the budgets live in the spec and derive from LLD §7.4), or run
 * files in parallel (the boot self-test the harness runs mutates the shared test database).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const alias = { '@vantage/contracts': path.join(root, 'packages/contracts/src/index.ts') };

export default defineConfig({
  resolve: { alias },
  test: {
    name: 'api-bench',
    root: path.join(root, 'apps/api'),
    include: ['test/bench/**/*.spec.ts'],
    globalSetup: ['test/db/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});

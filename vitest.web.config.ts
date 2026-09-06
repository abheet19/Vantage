/**
 * vitest.web.config.ts — the web's component/unit suite, separate from the API/contracts suite.
 *
 * Why it is its own config: the web runs in jsdom and its coverage floors (03-UI/LLD S5: components
 * ≥ 70/60, pure helpers ≥ 90) are lower than the API's global 90/80, so mixing them into the API run
 * would either drag that global down or hold the web to a bar the slice does not ask for. This config
 * measures only the web's helpers and components (views are covered by the Playwright e2e, not here) with
 * `all: true`, so an untested file counts as 0 rather than vanishing from the report. Per-area floors are
 * enforced by `tools/check-web-coverage.mjs` on posix-normalised paths — the same reason the API gate
 * exists, since vitest's per-glob thresholds do not fire on Windows paths.
 *
 * What it must never do: point `@vantage/contracts` at a built `dist` (tests run against source), or lower
 * a floor to pass.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(root, 'apps/web');

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@vantage/contracts': path.join(root, 'packages/contracts/src/index.ts') } },
  test: {
    name: 'web',
    root: web,
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.spec.tsx', 'test/**/*.spec.ts'],
    setupFiles: [path.join(web, 'test/setup.ts')],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text', 'json-summary'],
      reportsDirectory: path.join(root, 'coverage-web'),
      include: ['src/lib/**/*.ts', 'src/components/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
    },
  },
});

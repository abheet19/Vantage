/**
 * playwright.config.ts — the web's end-to-end suite against the real API and a real PostgreSQL (LLD §7, S5).
 *
 * Why it exists: the S5 flows (F1 ask → SQL → funnel → complete; F2 hostile → refused; F3 edit → re-run
 * diff; F5 empty ≠ error) are only proven against the running system. `global-setup.ts` boots an embedded
 * PostgreSQL 17 (or CI's service via VANTAGE_TEST_DB), migrates it, loads the hand-computed fixture, and
 * starts the built API on a fixed loopback port; `webServer` serves the production build through Vite's
 * preview, whose proxy points at that same port. Assertions wait on text/role, never fixed timeouts, and
 * Chromium is the only browser installed.
 */
import { defineConfig, devices } from '@playwright/test';

/** The API and preview ports the harness pins, so the preview's proxy target is known before the API boots. */
export const API_PORT = 4123;
export const PREVIEW_PORT = 5175;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: [['line']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PREVIEW_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run preview',
    url: `http://127.0.0.1:${PREVIEW_PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    env: { VANTAGE_API_URL: `http://127.0.0.1:${API_PORT}` },
  },
});

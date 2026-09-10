/**
 * release-cta.spec.ts — broad release smoke for every discoverable browser control.
 *
 * The feature-specific specs prove analytics semantics. This file guards the shell and the controls that
 * are easy to leave visually present but unwired: every route, both display toggles, the rail, every manual
 * query builder, SQL-panel disclosure, event/history row actions, snippets, refresh, copy, and the narrow
 * viewport. It runs against the same built API and disposable PostgreSQL fixture as the rest of the suite.
 */
import { expect, test, type Page } from '@playwright/test';

const ROUTES = [
  { nav: /^Ask\b/, heading: 'Ask' },
  { nav: /^Funnel\b/, heading: 'Funnel' },
  { nav: /^Retention\b/, heading: 'Retention' },
  { nav: /^Paths\b/, heading: 'Paths' },
  { nav: /^Trend\b/, heading: 'Trend' },
  { nav: /^Events\b/, heading: 'Events' },
  { nav: /^History\b/, heading: 'Ask history' },
  { nav: /^Projects\b/, heading: 'Projects & ingest' },
  { nav: /^MCP\b/, heading: 'MCP' },
  { nav: /^Health\b/, heading: 'Health' },
] as const;

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('all ten routes and global shell controls are wired', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Screens' });

  for (const route of ROUTES) {
    await nav.getByRole('button', { name: route.nav }).click();
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
  }

  const theme = page.getByRole('button', { name: 'Toggle light theme' });
  const themeBefore = await page.locator('html').getAttribute('data-theme');
  await theme.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', themeBefore ?? '');

  const transparency = page.getByRole('button', { name: 'Reduce transparency' });
  await transparency.click();
  await expect(page.locator('html')).toHaveAttribute('data-flat', '1');
  await transparency.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-flat');

  const rail = page.locator('.app');
  await page.getByRole('button', { name: 'Toggle rail' }).click();
  await expect(rail).toHaveClass(/rail-open/);
  await page.getByRole('button', { name: /^Collapse/ }).click();
  await expect(rail).not.toHaveClass(/rail-open/);
  expect(errors).toEqual([]);
});

test('manual analytics, disclosure, table, refresh, and copy controls work', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors = collectPageErrors(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.goto('/#/funnel');
  await page.getByRole('button', { name: /Add step/ }).click();
  await expect(page.getByLabel('Step 4 event')).toBeVisible();
  await page.getByLabel('Remove step 4').click();
  await page.getByRole('button', { name: 'Strict' }).click();
  await expect(page.getByRole('button', { name: 'Strict' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Run funnel' }).click();
  await expect(page.getByTestId('funnel-bars')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse SQL panel' }).click();
  await expect(page.getByRole('button', { name: 'Expand SQL panel' })).toBeVisible();

  await page.goto('/#/retention');
  await page.getByRole('button', { name: 'Week' }).click();
  await page.getByRole('button', { name: 'On or after' }).click();
  await page.getByLabel('Periods').fill('6');
  await page.getByRole('button', { name: 'Run retention' }).click();
  await expect(page.getByRole('table', { name: /Retention heatmap/ })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse SQL panel' }).click();

  await page.goto('/#/paths');
  await page.getByLabel('Steps').fill('4');
  await page.getByLabel('Session gap minutes').fill('60');
  await page.getByRole('button', { name: 'Run paths' }).click();
  await expect(page.getByTestId('paths-table')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse SQL panel' }).click();

  await page.goto('/#/trend');
  await page.getByRole('button', { name: 'Unique persons' }).click();
  await page.getByRole('button', { name: 'Month' }).click();
  await page.getByLabel('Breakdown property key').fill('plan');
  await page.getByRole('button', { name: 'Run trend' }).click();
  await expect(page.getByRole('img', { name: /Trend of persons by month/ })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse SQL panel' }).click();

  await page.goto('/#/events');
  const event = page.locator('.events-table .table-action').first();
  await event.click();
  await expect(event).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/');
  await page.getByRole('button', { name: /Of the people who signed up in August/ }).click();
  await expect(page.getByTestId('query-card')).toBeVisible();
  await page.goto('/#/history');
  const details = page.getByRole('button', { name: /Details for/ }).first();
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');

  await page.goto('/#/projects');
  await page.getByRole('button', { name: 'PowerShell' }).click();
  await expect(page.getByTestId('ingest-snippet')).toContainText('Invoke-RestMethod');
  await page.getByRole('button', { name: 'JS' }).click();
  await expect(page.getByTestId('ingest-snippet')).toContainText('fetch');
  await page.locator('.snippet').getByRole('button', { name: 'Copy' }).click();
  await expect(page.locator('.snippet').getByRole('button', { name: 'Copied' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh' }).click();

  await page.goto('/#/health');
  await page.getByRole('button', { name: 'Re-check' }).click();
  await expect(page.getByTestId('health-ok')).toBeVisible();
  expect(errors).toEqual([]);
});

test('320 px shell keeps every route reachable and its semantics intact', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Screens' });

  for (const route of ROUTES) {
    await nav.getByRole('button', { name: route.nav }).click();
    await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  const semantics = await page.evaluate(() => {
    const visible = (element: HTMLElement): boolean => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const controls = Array.from(document.querySelectorAll<HTMLElement>('button, a, input, select, textarea')).filter(visible);
    const nameless = controls.filter((element) => {
      const labels = element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement ? element.labels?.length ?? 0 : 0;
      return !(element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.textContent?.trim() || labels || element.title);
    });
    const ids = Array.from(document.querySelectorAll<HTMLElement>('[id]'), (element) => element.id);
    return { nameless: nameless.length, duplicateIds: ids.length - new Set(ids).size, mains: document.querySelectorAll('main').length, h1s: document.querySelectorAll('h1').length };
  });
  expect(semantics).toEqual({ nameless: 0, duplicateIds: 0, mains: 1, h1s: 1 });
  expect(errors).toEqual([]);
});

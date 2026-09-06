/**
 * retention-paths.spec.ts — F6: the cohort heatmap and the paths transitions table, end to end.
 *
 * Open Retention, run it, and see the triangle heatmap on the global scale with a hover tooltip; over 30
 * periods the recent cohorts' later cells are still in progress and render hatched (from `in_progress` in
 * SQL, never a guess). Open Paths, run it, and see the ranked transitions table with the "showing top N"
 * chip. Assertions wait on DOM/role, never fixed timeouts (LLD §7 note).
 */
import { expect, test } from '@playwright/test';

test('F6a: Retention renders the cohort heatmap with hatched in-progress cells and a hover tooltip', async ({ page }) => {
  await page.goto('/#/retention');
  await expect(page.getByRole('button', { name: 'Run retention' })).toBeVisible();

  // The fixture window, and 30 periods so the newest cohorts' later cells reach past the wall clock and are still in progress.
  await page.getByLabel('Range start').fill('2026-08-01');
  await page.getByLabel('Range end').fill('2026-08-31');
  await page.getByLabel('Periods').fill('30');
  await page.getByRole('button', { name: 'Run retention' }).click();

  const heatmap = page.getByRole('table', { name: /Retention heatmap/ });
  await expect(heatmap).toBeVisible();
  await expect(page.getByTestId('heat-legend')).toBeVisible();

  // Recent cells that have not ended are hatched (class prog).
  const hatched = page.locator('table.heat td.prog');
  await expect(hatched.first()).toBeVisible();

  // Hovering a cell shows the tooltip.
  await page.getByTestId('heat-cell').first().hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
});

test('F6b: Paths renders the ranked transitions table with the top-N chip', async ({ page }) => {
  await page.goto('/#/paths');
  await expect(page.getByRole('button', { name: 'Run paths' })).toBeVisible();

  await page.getByLabel('Range start').fill('2026-08-01');
  await page.getByLabel('Range end').fill('2026-08-31');
  await page.getByLabel('Steps').fill('5');
  await page.getByRole('button', { name: 'Run paths' }).click();

  await expect(page.getByTestId('paths-table')).toBeVisible();
  const rows = page.getByTestId('paths-row');
  await expect(rows.first()).toBeVisible();
  // The fixture's commonest transition is signup → view_pricing.
  await expect(rows.first()).toContainText('signup');
  await expect(rows.first()).toContainText('view_pricing');
  // The chip reports how much of the truth is on screen (the fixture has 8 transitions, all shown).
  await expect(page.getByText(/^\d+ transitions$|^▤ Showing top/)).toBeVisible();
});

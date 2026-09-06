/**
 * edit-spec.spec.ts — F3: Edit spec → change the conversion window → re-run → new bound value and numbers.
 *
 * The window is a bound parameter, not a SQL literal (compile/funnel.ts), so changing it from 7 to 14 days
 * changes the numbers and the `$n` the SQL panel lists — proof that the value is parameterised, never
 * interpolated. The re-run renders through the diff view; the diff-highlight path itself is unit-tested.
 */
import { expect, test } from '@playwright/test';

test('F3: editing the window to 14 days re-runs with the new bound value and stays complete', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Of the people who signed up in August/ }).click();

  const card = page.getByTestId('query-card');
  await expect(card.getByTestId('funnel-bars')).toBeVisible();
  await expect(card.getByTestId('sql-params')).toContainText("'7 days'");

  await card.getByRole('button', { name: /Edit spec/ }).click();
  await card.getByRole('button', { name: '14 days' }).click();
  await card.getByRole('button', { name: /Re-run/ }).click();

  // the new window reached the database as a bound parameter, and the result is still honestly complete
  await expect(card.getByTestId('sql-params')).toContainText("'14 days'");
  await expect(card.getByTestId('funnel-bars')).toBeVisible();
  await expect(card.getByRole('status').filter({ hasText: 'Complete' })).toBeVisible();
});

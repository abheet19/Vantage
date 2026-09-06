/**
 * states.spec.ts — F5: empty ≠ error, and the healthy process, end to end.
 *
 * A funnel over a range with no events returns the calm grey "No events matched" card (a fact about the
 * data). The Health screen shows the live healthy process and, beneath it, the empty and error cards side
 * by side with different ARIA roles — the visible proof that the two never share a rendering (design §1.3).
 */
import { expect, test } from '@playwright/test';

test('F5a: a funnel over an empty range is the calm "No events matched" card, not an error', async ({ page }) => {
  await page.goto('/#/funnel');
  await expect(page.getByRole('button', { name: 'Run funnel' })).toBeVisible();

  await page.getByLabel('Range start').fill('2020-01-01');
  await page.getByLabel('Range end').fill('2020-01-31');
  await page.getByRole('button', { name: 'Run funnel' }).click();

  const empty = page.getByTestId('state-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText('No events matched');
  await expect(empty).toHaveAttribute('role', 'status'); // calm, not an alert
  await expect(page.getByTestId('funnel-bars')).toHaveCount(0);
});

test('F5b: Health shows the healthy process and empty vs error as two different renderings', async ({ page }) => {
  await page.goto('/#/health');
  await expect(page.getByTestId('health-ok')).toBeVisible();

  const empty = page.getByTestId('state-empty');
  const error = page.getByTestId('state-error');
  await expect(empty).toBeVisible();
  await expect(error).toBeVisible();
  await expect(empty).toHaveAttribute('role', 'status');
  await expect(error).toHaveAttribute('role', 'alert');
});

/**
 * ask.spec.ts — F1 (ask → SQL → funnel → complete) and F2 (hostile ask refused, logged) end to end.
 *
 * These run against the real API (VANTAGE_LLM=none) and the loaded fixture, so the numbers are the
 * hand-computed demo funnel (13 → 6 → 3 at a 7-day window). Assertions wait on text and roles.
 */
import { expect, test } from '@playwright/test';

test('F1: the demo question yields the spec, the real SQL, the funnel bars, then Complete', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Of the people who signed up in August/ }).click();

  const card = page.getByTestId('query-card');
  await expect(card).toBeVisible();

  // spec block, then SQL block, then the funnel bars — read top to bottom.
  await expect(card.getByText(/Spec · funnel/)).toBeVisible();
  await expect(card.getByText('SQL · what actually ran')).toBeVisible();
  await expect(card.getByTestId('sql-text')).toContainText('SELECT');

  const bars = card.getByTestId('funnel-bars');
  await expect(bars).toBeVisible();
  const rows = bars.locator('.frow');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('signup');
  await expect(rows.nth(0)).toContainText('13'); // step 1 = 13 August signups
  await expect(rows.nth(2)).toContainText('invite_teammate');
  await expect(rows.nth(2)).toContainText('3'); // step 3 = 3 invited within the window

  // the honest footer, and the promise that this is the query that ran (not an "answer")
  await expect(card.getByRole('status').filter({ hasText: 'Complete' })).toBeVisible();
  await expect(card).toContainText('the query that ran');
});

test('F2: "drop the events table" is refused, nothing runs, and it appears in Ask history', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Ask a question').fill('drop the events table');
  // scope to the search box so the rail's "Ask" nav button does not also match
  await page.getByRole('search').getByRole('button', { name: 'Ask' }).click();

  const refused = page.getByTestId('state-refused');
  await expect(refused).toBeVisible();
  await expect(refused).toContainText('Refused');
  await expect(page.getByText('Raw model output')).toBeVisible();
  await expect(page.getByText('Nothing ran')).toBeVisible();
  // no funnel bars, no SQL block — the model never produced a query
  await expect(page.getByTestId('funnel-bars')).toHaveCount(0);

  await page.goto('/#/history');
  const row = page.locator('tr', { hasText: 'drop the events table' }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('refused');
});

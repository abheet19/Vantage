/**
 * projects.spec.ts — F7 (ingest with duplicates) and F8 (identify / merge notice) end to end.
 *
 * These create a real project through POST /v1/projects, then post a batch through the very POST /v1/events
 * path the on-screen snippet shows (with that project's real key in the Authorization header) and assert the
 * real accepted/duplicate counts, and merge the two demo persons the batch created. Nothing here is stubbed.
 */
import { expect, test } from '@playwright/test';

/** Create a fresh project on the Projects screen and return once its one-time key card is showing. */
async function createProject(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.goto('/#/projects');
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByTestId('api-key')).toBeVisible();
}

test('F7: sending a batch shows accepted counts, and a second send dedupes to duplicates', async ({ page }) => {
  await createProject(page, `ingest ${Date.now()}`);

  await page.getByTestId('send-batch').click();
  const resp = page.getByTestId('ingest-resp');
  await expect(resp).toBeVisible();
  await expect(page.getByTestId('accepted')).toHaveText('3'); // the fixed 3-event demo batch, all new
  await expect(page.getByTestId('duplicates')).toHaveText('0');

  // send the identical batch again — UNIQUE (project_id, insert_id) absorbs every row
  await page.getByTestId('send-batch').click();
  await expect(page.getByTestId('accepted')).toHaveText('0');
  await expect(page.getByTestId('duplicates')).toHaveText('3');
  await expect(page.getByText(/Ignored 3 duplicate event/)).toBeVisible();
});

test('F8: identify merges the two demo persons and shows the merge notice', async ({ page }) => {
  await createProject(page, `identity ${Date.now()}`);

  // the batch creates anon_demo and user_demo as two persons; identify then merges them
  await page.getByTestId('send-batch').click();
  await expect(page.getByTestId('accepted')).toHaveText('3');

  await page.getByTestId('identify').click();
  const notice = page.getByTestId('merge-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Merged persons');
  await expect(notice).toContainText('person_merges');
});

test('F7b: rotating the key mints a new one, shown once', async ({ page }) => {
  await createProject(page, `rotate ${Date.now()}`);
  const first = await page.getByTestId('api-key').textContent();
  expect(first).toMatch(/^vk_/);

  await page.getByTestId('rotate-current').click();
  await expect(page.getByText('key rotated')).toBeVisible();
  const second = await page.getByTestId('api-key').textContent();
  expect(second).toMatch(/^vk_/);
  expect(second).not.toBe(first); // a fresh key, never the old one recovered
});

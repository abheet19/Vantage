/** Phone regression for the application shell and the Events explorer. The Events grid once carried
 * an inline desktop template, leaving both panels clipped side by side even though the page itself
 * reported no overflow. */
import { expect, test } from '@playwright/test';

test('phone layout keeps shell actions usable and stacks both Events panels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/events');

  const panels = page.locator('.events-cols > .panel');
  await expect(panels).toHaveCount(2);
  await expect(panels.nth(0)).toContainText('Event names');
  await expect(panels.nth(1)).toContainText('Properties');

  const layout = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('.events-cols');
    const boxes = Array.from(document.querySelectorAll<HTMLElement>('.events-cols > .panel'), (el) => el.getBoundingClientRect());
    const tracks = grid === null ? [] : getComputedStyle(grid).gridTemplateColumns.split(' ');
    return {
      pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
      oneTrack: tracks.length === 1,
      stacked: boxes.length === 2 && boxes[1]!.top >= boxes[0]!.bottom,
      panelsInside: boxes.every(({ left, right }) => left >= 0 && right <= window.innerWidth),
    };
  });
  expect(layout).toEqual({ pageOverflows: false, oneTrack: true, stacked: true, panelsInside: true });

  await page.goto('/');
  await page.getByRole('button', { name: /Of the people who signed up in August/ }).click();
  await expect(page.getByTestId('query-card')).toBeVisible();
  await expect(page.getByTestId('funnel-bars')).toBeVisible();
});

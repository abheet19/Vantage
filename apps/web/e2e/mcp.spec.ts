/**
 * mcp.spec.ts — F9 (MCP install → tool call) end to end.
 *
 * The MCP screen is static setup text: the claude_desktop_config.json block, the Claude Code one-liner, the
 * eight tools with readOnlyHint badges, and a clearly-labelled ILLUSTRATIVE transcript. F9's transcript is
 * not a live tool call, so this asserts the config/tools/command render and that the copy buttons work — not
 * that a query ran. The live tool call is the Claude Desktop demo, out of the browser's reach by design.
 */
import { expect, test } from '@playwright/test';

test('F9: the MCP screen renders the config, the eight tools, and an example transcript; copy works', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/mcp');

  const config = page.getByTestId('mcp-config');
  await expect(config).toBeVisible();
  await expect(config).toContainText('"mcpServers"');
  await expect(config).toContainText('"vantage"');

  await expect(page.getByTestId('mcp-command')).toContainText('claude mcp add vantage');

  // eight read-only tools, each badged
  const tools = page.getByTestId('mcp-tools');
  await expect(tools.locator('.tool')).toHaveCount(8);
  await expect(tools.getByText('run_funnel')).toBeVisible();
  await expect(tools.getByText('readOnlyHint').first()).toBeVisible();

  // the transcript is present and honestly labelled — not passed off as live
  await expect(page.getByText(/example — not a live call/)).toBeVisible();
  await expect(page.getByText(/Illustrative\./)).toBeVisible();

  // the config copy button copies the config text to the clipboard
  await config.locator('..').getByRole('button', { name: /Copy/ }).click();
  await expect(page.getByRole('button', { name: /Copied/ })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('"mcpServers"');
});

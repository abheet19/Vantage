// capture-hero.mjs — drives the LIVE Vantage deployment headlessly and writes the README hero stills.
//
// It points at the public site (no local server), selects the hand-checked "August fixture" project,
// asks the flagship example question, and shoots two frames:
//   docs/media/vantage-ask.png    — the "SQL · what actually ran" panel: the role vantage_reader ·
//                                    READ ONLY · timeout 5 s badge over the parameterised SELECT
//   docs/media/vantage-funnel.png — the funnel bars (13 → 8 → 4) the question produced
//
// Run:  node tools/capture-hero.mjs           (uses https://vantage-abheet.fly.dev)
//       VANTAGE_URL=http://127.0.0.1:4200 node tools/capture-hero.mjs   (against a local web build)
//
// Reproducible: headless Chromium at a crisp 1600×1000 @2x, dark. It sets the project in localStorage
// before load so the fixture is always the one queried. GIFs are attempted only if ffmpeg is found.

import { chromium } from 'playwright';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MEDIA = join(ROOT, 'docs', 'media');
const BASE = (process.env.VANTAGE_URL ?? 'https://vantage-abheet.fly.dev').replace(/\/$/, '');
const PROJECT = process.env.VANTAGE_PROJECT ?? 'ccd65ac9-f16c-4076-a04a-df3149e67a3a'; // "August fixture"
const VIEWPORT = { width: 1600, height: 1000 };
const DSF = 2;

mkdirSync(MEDIA, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Screenshot one whole element crisply (Playwright scrolls a tall element to capture all of it),
 * regardless of the viewport height — the SQL panel and the funnel are both taller/wider than a fold. */
async function shotElement(page, locator, out) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(300);
  await locator.screenshot({ path: out });
}

function report(path) {
  const kb = (statSync(path).size / 1024).toFixed(0);
  console.log(`  wrote ${path} (${kb} KB)`);
}

async function main() {
  console.log(`Vantage hero capture → ${BASE}  (project ${PROJECT})`);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DSF, colorScheme: 'dark' });
  // Pin the project the SPA opens with, before any app code runs.
  await context.addInitScript((id) => {
    try {
      localStorage.setItem('vantage.project', id);
    } catch {
      /* storage disabled: the app falls back to the first project */
    }
  }, PROJECT);
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    // The Ask screen and its example chips.
    await page.locator('.ask .q').waitFor({ state: 'visible', timeout: 30000 });
    await page.locator('.chips .ex').first().waitFor({ state: 'visible', timeout: 30000 });
    await sleep(500);

    // Ask the flagship example: August signups → created a project within a week → invited someone.
    await page.locator('.chips .ex').first().click();

    // Wait for the answer: the query card, its SQL panel, and the funnel bars.
    await page.locator('[data-testid="query-card"]').waitFor({ state: 'visible', timeout: 45000 });
    await page.locator('[data-testid="sql-text"]').waitFor({ state: 'visible', timeout: 45000 });
    await page.locator('[data-testid="funnel-bars"]').waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
    await sleep(1200);

    // 1) The security money-shot: the "SQL · what actually ran" header + the
    //    role vantage_reader · READ ONLY · timeout 5 s badge over the parameterised SELECT.
    //    The SQL panel is taller than a fold and the command bar is sticky, so instead of a full-element
    //    shot (which the bar overlaps) we position the panel header just below the bar and clip the
    //    viewport from there — the header, the badge and the $1..$8 parameterisation all read at once.
    const vp = page.viewportSize() ?? VIEWPORT;
    const bar = await page.locator('header.cmd').boundingBox();
    const barH = bar?.height ?? 64;
    await page.locator('.qblock.sql .bh').scrollIntoViewIfNeeded();
    await page.evaluate((h) => {
      const el = document.querySelector('.qblock.sql .bh');
      if (el) window.scrollBy(0, el.getBoundingClientRect().top - h - 14);
    }, barH);
    await sleep(400);
    const panel = await page.locator('.qblock.sql').boundingBox();
    const askOut = join(MEDIA, 'vantage-ask.png');
    const cx = Math.max(0, (panel?.x ?? 0) - 8);
    const cy = barH + 4;
    await page.screenshot({
      path: askOut,
      clip: { x: cx, y: cy, width: Math.min(vp.width - cx, (panel?.width ?? vp.width) + 16), height: vp.height - cy - 6 },
    });
    report(askOut);

    // 2) The funnel bars (13 → 8 → 4).
    const funnel = page.locator('[data-testid="funnel-bars"]');
    const funnelOut = join(MEDIA, 'vantage-funnel.png');
    await shotElement(page, funnel, funnelOut);
    report(funnelOut);
  } finally {
    await context.close();
    await browser.close();
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

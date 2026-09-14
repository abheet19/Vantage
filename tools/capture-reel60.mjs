// capture-reel60.mjs — drives the LIVE Vantage deployment and records a smooth 60fps demo reel.
//
// It points at the public site (no local server), pins the hand-checked "August fixture" project, and
// films the whole pitch as one continuous motion through the REDESIGNED glass UI:
//
//   1. the Ask screen, with the example questions sitting under the search box
//   2. an example question is clicked — it fills the box and Ask fires
//   3. the answer lands and the reel eases down it: the typed QuerySpec (violet) ─►
//      the exact SQL that actually ran (role vantage_reader · READ ONLY · timeout 5 s, $1…$n) ─►
//      the funnel the question produced and the number at the end of it
//   4. a glance at the Funnel screen and the Retention screen — the other analyses, run live
//
// Playwright records the session as .webm at the 1280×800 viewport; ffmpeg then trims the cold-start
// lead-in and emits two files:
//   docs/media/vantage-reel.mp4  — H.264, ~1280px wide, motion-interpolated to a true 60fps (minterpolate)
//   docs/media/vantage-demo.gif  — a smaller looping GIF for the README (palettegen/paletteuse)
//
// Run:  node tools/capture-reel60.mjs                                   (uses https://vantage-abheet.fly.dev)
//       VANTAGE_URL=http://127.0.0.1:4200 node tools/capture-reel60.mjs (against a local web build)
//       VANTAGE_PROJECT=<uuid> node tools/capture-reel60.mjs            (a different project)
//       FFMPEG=/path/to/ffmpeg node tools/capture-reel60.mjs           (if ffmpeg is not on PATH)
//
// The live site auto-stops (fly) and may cold-start, so a warm-up request is made and generous timeouts
// are used before recording begins.

/* global localStorage, document, getComputedStyle, Element -- these appear inside page.evaluate /
   addInitScript bodies, which run in the browser context, not in Node. */
import { chromium } from 'playwright';
import { mkdirSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MEDIA = join(ROOT, 'docs', 'media');
const OUT_MP4 = join(MEDIA, 'vantage-reel.mp4');
const OUT_GIF = join(MEDIA, 'vantage-demo.gif');

const BASE = (process.env.VANTAGE_URL ?? 'https://vantage-abheet.fly.dev').replace(/\/$/, '');
const PROJECT = process.env.VANTAGE_PROJECT ?? 'ccd65ac9-f16c-4076-a04a-df3149e67a3a'; // "August fixture"
const VIEWPORT = { width: 1280, height: 800 };
const DSF = 2; // crisp capture; the recorded .webm is still VIEWPORT-sized (CSS px)

mkdirSync(MEDIA, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Find an ffmpeg to encode with. Prefers $FFMPEG, then PATH, then the known winget install path. */
function findFfmpeg() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    /* not on PATH */
  }
  const winget =
    'C:/Users/abhee/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.1-full_build/bin/ffmpeg.exe';
  try {
    execSync(`"${winget}" -version`, { stdio: 'ignore' });
    return winget;
  } catch {
    throw new Error('ffmpeg not found — set $FFMPEG to its full path.');
  }
}

/** Warm the auto-stopped fly machine before recording, so no cold-start lands inside the reel. */
async function warmup() {
  console.log('  warming the live site (fly may cold-start)…');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.locator('.ask .q').waitFor({ state: 'visible', timeout: 120000 }).catch(() => {});
    console.log('  warm.');
  } finally {
    await browser.close();
  }
}

async function main() {
  const ffmpeg = findFfmpeg();
  console.log(`Vantage 60fps reel → ${BASE}  (project ${PROJECT}, ffmpeg: ${ffmpeg})`);

  await warmup();

  const tmp = mkdtempSync(join(tmpdir(), 'vantage-reel-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DSF,
    colorScheme: 'dark', // the dark glass theme is the default and reads best in a reel
    recordVideo: { dir: tmp, size: VIEWPORT },
  });
  // Pin the project the SPA opens with, before any app code runs.
  await context.addInitScript((id) => {
    try {
      localStorage.setItem('vantage.project', id);
    } catch {
      /* storage disabled: the app falls back to its first project */
    }
  }, PROJECT);

  const t0 = Date.now(); // recording begins ~here
  const page = await context.newPage();

  // The dashboard scrolls its own main container, not <body>. Find it once the answer is on screen.
  const findScroller = () =>
    page.evaluate(() => {
      const card = document.querySelector('[data-testid="query-card"]');
      for (let el = card; el instanceof Element; el = el.parentElement) {
        if (el.scrollHeight > el.clientHeight + 8) {
          const oy = getComputedStyle(el).overflowY;
          if (oy === 'auto' || oy === 'scroll') {
            el.setAttribute('data-demo-scroller', '1');
            return 'element';
          }
        }
      }
      return 'window';
    });

  /** Ease the scroller so `selector` sits `topPad` px below the top of the scroll area. */
  const scrollTo = async (kind, selector, topPad, steps = 22, msPerStep = 16) => {
    const [from, to] = await page.evaluate(
      ([sel, pad, k]) => {
        const scroller = k === 'element' ? document.querySelector('[data-demo-scroller]') : document.scrollingElement;
        const target = document.querySelector(sel);
        if (!scroller || !target) return [0, 0];
        const sTop = k === 'element' ? scroller.getBoundingClientRect().top : 0;
        const delta = target.getBoundingClientRect().top - sTop - pad;
        const max = scroller.scrollHeight - scroller.clientHeight;
        return [scroller.scrollTop, Math.max(0, Math.min(max, scroller.scrollTop + delta))];
      },
      [selector, topPad, kind],
    );
    if (Math.abs(to - from) < 4) return;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // ease-in-out
      await page.evaluate(
        ([y, k]) => {
          const scroller = k === 'element' ? document.querySelector('[data-demo-scroller]') : document.scrollingElement;
          if (scroller) scroller.scrollTop = y;
        },
        [from + (to - from) * eased, kind],
      );
      await sleep(msPerStep);
    }
  };

  // ── Land on Ask ────────────────────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('.ask .q').waitFor({ state: 'visible', timeout: 120000 });
  await page.locator('.chips .ex').first().waitFor({ state: 'visible', timeout: 120000 });
  await sleep(700); // let fonts and the glass blur settle

  const tStart = Date.now(); // the interesting motion starts here — the cold lead-in is trimmed to this
  await sleep(1200); // hold on the Ask screen so a still frame reads on its own

  // ── Click the flagship example question → it fills the box and Ask fires ─────────────────────────
  await page.locator('.chips .ex').first().hover().catch(() => {});
  await sleep(350);
  await page.locator('.chips .ex').first().click();
  await sleep(500); // the box shows the question, the running skeleton animates in

  // ── The answer lands ─────────────────────────────────────────────────────────────────────────────
  await page.locator('[data-testid="query-card"]').waitFor({ state: 'visible', timeout: 120000 });
  await page.locator('[data-testid="sql-text"]').waitFor({ state: 'visible', timeout: 120000 });
  console.log(`  answer landed in ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
  await sleep(900); // the answer blocks animate in

  const scroller = await findScroller();
  console.log(`  scroll container: ${scroller}`);
  await sleep(1400); // the question + head of the answer

  // The typed QuerySpec — the grammar the model filled, not SQL.
  await scrollTo(scroller, '.qblock.spec', 90);
  await sleep(1800);

  // The money shot: SQL · what actually ran — the read-only role/timeout badge over the SELECT.
  await scrollTo(scroller, '.qblock.sql', 60);
  await sleep(2000);

  // Nudge down so the bound $1…$n parameters are on screen under the statement.
  if (await page.locator('[data-testid="sql-params"]').count()) {
    await scrollTo(scroller, '[data-testid="sql-params"]', 360);
    await sleep(1600);
  }

  // The payoff: the funnel bars and the number the question produced.
  if (await page.locator('[data-testid="funnel-bars"]').count()) {
    await scrollTo(scroller, '[data-testid="funnel-bars"]', 150);
    await sleep(2400);
  }

  // ── A glance at the other analyses: Funnel, then Retention, run live ─────────────────────────────
  const glance = async (title) => {
    const item = page.locator(`.rail-item[title^="${title}"]`).first();
    if (!(await item.count())) return;
    await item.click();
    await sleep(900); // the screen swaps in
    const run = page.locator('.screen .btn.primary').first();
    // The primary action is the Run button; click it once it is enabled (the fixture has events).
    if (await run.count()) {
      try {
        await run.waitFor({ state: 'visible', timeout: 8000 });
        if (await run.isEnabled()) {
          await run.click();
          await page.locator('[data-testid="sql-text"]').first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
        }
      } catch {
        /* leave the empty state on screen if it will not run */
      }
    }
    await sleep(2200); // hold on the result
  };

  await glance('Funnel');
  await glance('Retention');

  await sleep(600);
  const tEnd = Date.now();

  const video = page.video();
  await context.close(); // flushes the .webm
  await browser.close();
  const webm = await video.path();

  const trimStart = Math.max(0, (tStart - t0) / 1000 - 0.3);
  const duration = (tEnd - tStart) / 1000 + 0.5;
  console.log(`  webm ${webm} — trim from ${trimStart.toFixed(2)}s for ${duration.toFixed(2)}s`);

  // ── MP4: motion-interpolate to a true 60fps, H.264, ~1280px wide ─────────────────────────────────
  const mp4Vf =
    'minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,scale=1280:-2:flags=lanczos,format=yuv420p';
  const mp4Args = [
    '-y', '-ss', trimStart.toFixed(2), '-t', duration.toFixed(2), '-i', webm,
    '-vf', mp4Vf, '-r', '60',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-movflags', '+faststart',
    '-an', OUT_MP4,
  ];
  console.log('  encoding 60fps MP4 (minterpolate)…');
  let r = spawnSync(ffmpeg, mp4Args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg (mp4) exited ${r.status}`);

  // ── GIF: smaller, looping, for the README (built from the smooth MP4) ────────────────────────────
  // Kept deliberately light (15 fps · 760px) so it stays a few MB and renders inline on GitHub; the
  // crisp full-motion story lives in the 60fps MP4 linked beside it.
  const gifFilter =
    'fps=13,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3';
  const gifArgs = ['-y', '-i', OUT_MP4, '-filter_complex', gifFilter, '-loop', '0', OUT_GIF];
  console.log('  encoding looping GIF…');
  r = spawnSync(ffmpeg, gifArgs, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg (gif) exited ${r.status}`);

  rmSync(tmp, { recursive: true, force: true });
  const mb = (p) => (statSync(p).size / 1024 / 1024).toFixed(2);
  console.log(`  wrote ${OUT_MP4} (${mb(OUT_MP4)} MB, 60fps)`);
  console.log(`  wrote ${OUT_GIF} (${mb(OUT_GIF)} MB)`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

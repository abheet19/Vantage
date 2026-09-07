// capture-reel.mjs — drives the LIVE Vantage deployment and records a short LinkedIn-ready demo reel.
//
// It lands on the Ask screen for the hand-checked "August fixture" project, clicks the flagship example
// question, and lets the answer animate through its stages: the typed spec → the "SQL · WHAT ACTUALLY
// RAN" panel (role vantage_reader · READ ONLY · timeout 5 s over a parameterised SELECT) → the funnel
// bars. That ask → SQL → number motion is the whole pitch. Playwright records the session as .webm;
// ffmpeg then trims to the chip-click and converts it to a looping GIF with a generated palette. If the
// answer takes longer than ~9.5 s to arrive, the clip is gently sped up to keep the GIF under ~10 s.
//
// Run:  node tools/capture-reel.mjs           (uses https://vantage-abheet.fly.dev)
//       VANTAGE_URL=http://127.0.0.1:4200 node tools/capture-reel.mjs   (against a local web build)
//       FFMPEG=/path/to/ffmpeg node tools/capture-reel.mjs             (if ffmpeg is not on PATH)
//
// Output: docs/media/vantage-demo.gif  (~1000px wide, ~12 fps, looping, well under 6 MB).

/* global localStorage -- referenced inside an addInitScript body, which runs in the browser context, not Node. */
import { chromium } from 'playwright';
import { mkdirSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MEDIA = join(ROOT, 'docs', 'media');
const BASE = (process.env.VANTAGE_URL ?? 'https://vantage-abheet.fly.dev').replace(/\/$/, '');
const PROJECT = process.env.VANTAGE_PROJECT ?? 'ccd65ac9-f16c-4076-a04a-df3149e67a3a'; // "August fixture"
const VIEWPORT = { width: 1280, height: 800 };
const DSF = 2;
const OUT = join(MEDIA, 'vantage-demo.gif');
const TARGET_SECONDS = 9.5; // if the clip runs longer, gently speed it up to fit under ~10 s

mkdirSync(MEDIA, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Find an ffmpeg to convert webm → gif. Prefers $FFMPEG, then PATH, then the winget install path. */
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

async function main() {
  const ffmpeg = findFfmpeg();
  console.log(`Vantage reel capture → ${BASE}  (project ${PROJECT}, ffmpeg: ${ffmpeg})`);

  const tmp = mkdtempSync(join(tmpdir(), 'vantage-reel-'));
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DSF,
    colorScheme: 'dark',
    recordVideo: { dir: tmp, size: VIEWPORT },
  });
  // Pin the project the SPA opens with, before any app code runs.
  await context.addInitScript((id) => {
    try {
      localStorage.setItem('vantage.project', id);
    } catch {
      /* storage disabled: the app falls back to the first project */
    }
  }, PROJECT);

  const t0 = Date.now(); // recording begins ~here
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('.ask .q').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('.chips .ex').first().waitFor({ state: 'visible', timeout: 30000 });
  await sleep(700);

  const tStart = Date.now(); // the ask → SQL → number motion starts here — trim the lead-in to this point
  await page.locator('.chips .ex').first().click();

  // Let the answer land: the query card, its SQL panel, then the funnel bars.
  await page.locator('[data-testid="query-card"]').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('[data-testid="sql-text"]').waitFor({ state: 'visible', timeout: 60000 });
  await sleep(900); // hold on the SQL · WHAT ACTUALLY RAN panel so the read-only badge reads
  await page.locator('[data-testid="funnel-bars"]').waitFor({ state: 'visible', timeout: 60000 }).catch(() => {});
  await page.locator('[data-testid="funnel-bars"]').scrollIntoViewIfNeeded().catch(() => {});
  await sleep(1600); // hold on the funnel bars

  const tEnd = Date.now();
  const video = page.video();
  await context.close(); // flushes the .webm
  await browser.close();
  const webm = await video.path();

  const trimStart = Math.max(0, (tStart - t0) / 1000 - 0.3);
  const rawDuration = (tEnd - tStart) / 1000 + 0.6;
  // Gently speed up only if the source is longer than the target, so the GIF stays under ~10 s.
  const speed = rawDuration > TARGET_SECONDS ? TARGET_SECONDS / rawDuration : 1;
  console.log(
    `  webm ${webm} — trim from ${trimStart.toFixed(2)}s for ${rawDuration.toFixed(2)}s` +
      (speed < 1 ? ` (sped ${speed.toFixed(2)}× → ~${(rawDuration * speed).toFixed(1)}s)` : ''),
  );

  const setpts = speed < 1 ? `setpts=${speed.toFixed(4)}*PTS,` : '';
  const filter =
    `${setpts}fps=13,scale=1000:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`;
  const args = ['-y', '-ss', trimStart.toFixed(2), '-t', rawDuration.toFixed(2), '-i', webm, '-filter_complex', filter, '-loop', '0', OUT];
  const r = spawnSync(ffmpeg, args, { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg exited ${r.status}`);

  rmSync(tmp, { recursive: true, force: true });
  const mb = (statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log(`  wrote ${OUT} (${mb} MB)`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

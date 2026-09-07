// record-demo.mjs — records the README hero GIF against the LIVE Vantage deployment.
//
// The story it tells is the whole pitch, in one motion:
//
//   1. the flagship question sits in the Ask box                    (a still that works on its own)
//   2. Ask is pressed and the answer lands                          (the wait is trimmed, not faked)
//   3. the typed spec scrolls up — the grammar the model filled     (violet block)
//   4. SQL · what actually ran holds on screen                      (the money shot: role
//      vantage_reader · READ ONLY · timeout 5 s over a parameterised SELECT, $1…$9)
//   5. the funnel bars and the number it produced                   (the payoff)
//
// Every frame is a real screenshot of the real deployment answering a real question against the
// hand-checked "August fixture" project. Nothing is mocked, staged or re-timed to flatter the app;
// the only editing is cutting dead waiting time and holding on the frames that matter.
//
// Frames are captured as PNGs at deviceScaleFactor 2 (2560px wide) and downscaled to 1000px by
// tools/frames-to-gif.py, so the SQL text stays crisp rather than mushy. Pillow assembles the GIF —
// ffmpeg is deliberately not a dependency.
//
// Run:
//   node tools/record-demo.mjs                                    # against https://vantage-abheet.fly.dev
//   VANTAGE_URL=http://127.0.0.1:4200 node tools/record-demo.mjs  # against a local web build
//   VANTAGE_PROJECT=<uuid> node tools/record-demo.mjs             # a different project
//
// Output: docs/demo/vantage-demo.gif

/* global localStorage, document, getComputedStyle, Element -- these appear inside page.evaluate/addInitScript
   bodies, which run in the browser context, not in Node. */
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT_DIR = join(ROOT, 'docs', 'demo');
const OUT = join(OUT_DIR, 'vantage-demo.gif');

const BASE = (process.env.VANTAGE_URL ?? 'https://vantage-abheet.fly.dev').replace(/\/$/, '');
const PROJECT = process.env.VANTAGE_PROJECT ?? 'ccd65ac9-f16c-4076-a04a-df3149e67a3a'; // "August fixture"
const QUESTION =
  process.env.VANTAGE_QUESTION ??
  'Of the people who signed up in August, how many created a project within a week, and how many of those invited someone?';

const VIEWPORT = { width: 1280, height: 800 };
const DEVICE_SCALE = 2; // capture at 2560px so the downscale to 1000px keeps SQL legible
const PYTHON = process.env.PYTHON ?? 'python';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const frameDir = join(tmpdir(), `vantage-demo-frames-${Date.now()}`);
  mkdirSync(frameDir, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });

  /** @type {{file: string, ms: number}[]} */
  const frames = [];
  let n = 0;

  console.log(`Vantage hero demo → ${BASE}  (project ${PROJECT})`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    colorScheme: 'dark', // the dark theme is what ships as the default and reads far better in a README
  });
  // Pin the project the SPA opens with, before any app code runs.
  await context.addInitScript((id) => {
    try {
      localStorage.setItem('vantage.project', id);
    } catch {
      /* storage disabled: the app falls back to its first project */
    }
  }, PROJECT);

  const page = await context.newPage();

  /** Screenshot the viewport as one frame, held on screen for `ms`. */
  const shoot = async (ms = 110) => {
    const file = join(frameDir, `f${String(n++).padStart(4, '0')}.png`);
    await page.screenshot({ path: file });
    frames.push({ file, ms });
    return file;
  };
  /**
   * Hold on the current state for (up to) `ms` — but as real continuous capture, not one frame
   * silently stretched. Screenshots every ~110ms for the (capped) duration, so anything still
   * moving on screen (an in-view animation, a highlight) is actually filmed. No beat is allowed
   * to run past ~1.4s: frames-to-gif.py will merge an unbroken run of identical screenshots back
   * down to one frame anyway, so the cap comes from how much real time we sample, not from
   * pretending a single screenshot lasted longer than it did.
   */
  const hold = async (ms, sampleMs = 110, cap = 1400) => {
    const total = Math.min(ms, cap);
    const steps = Math.max(1, Math.round(total / sampleMs));
    for (let i = 0; i < steps; i++) {
      await shoot(Math.round(total / steps));
      if (i < steps - 1) await sleep(total / steps);
    }
  };

  // Scrolling in this app happens inside the scroll container that holds the answer, not on <body>.
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

  /** Ease the page down so that `selector` sits `topPad` px below the top of the viewport. */
  const scrollTo = async (kind, selector, topPad, steps, msPerStep) => {
    const [from, to] = await page.evaluate(
      ([sel, pad, k]) => {
        const scroller =
          k === 'element' ? document.querySelector('[data-demo-scroller]') : document.scrollingElement;
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
          const scroller =
            k === 'element' ? document.querySelector('[data-demo-scroller]') : document.scrollingElement;
          if (scroller) scroller.scrollTop = y;
        },
        [from + (to - from) * eased, kind],
      );
      await shoot(msPerStep);
    }
  };

  // ── 1. Land, and put the flagship question in the box ────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('.ask .q').waitFor({ state: 'visible', timeout: 60000 });
  await page.locator('.chips .ex').first().waitFor({ state: 'visible', timeout: 60000 });
  await sleep(600); // let fonts and the glass blur settle

  // Fill the real input via a real input event. The question is put in whole rather than typed out
  // one character at a time so that FRAME 0 — the still GitHub shows before the GIF plays — is the
  // readable question rather than an empty box.
  await page.locator('.ask .q').fill(QUESTION);
  await sleep(350);
  await shoot();
  await hold(1500); // let the reader read the question

  // ── 2. Ask, and wait out the model + the query ───────────────────────────────────────────────
  const askedAt = Date.now();
  await page.locator('.ask .go').click();

  // Sample the loading state a handful of times, then stop paying for frames: nobody wants to watch
  // a skeleton. The real answer still has to arrive before we continue — the wait is cut, not faked.
  for (let i = 0; i < 7; i++) {
    if (await page.locator('[data-testid="query-card"]').isVisible().catch(() => false)) break;
    await shoot(120);
    await sleep(90);
  }
  await page.locator('[data-testid="query-card"]').waitFor({ state: 'visible', timeout: 120000 });
  await page.locator('[data-testid="sql-text"]').waitFor({ state: 'visible', timeout: 120000 });
  console.log(`  answer landed in ${((Date.now() - askedAt) / 1000).toFixed(1)}s (trimmed in the GIF)`);
  await sleep(700); // the answer blocks animate in

  const scroller = await findScroller();
  console.log(`  scroll container: ${scroller}`);

  // ── 3. The answer, and the typed spec the model filled ───────────────────────────────────────
  await shoot();
  await hold(2100); // question + the head of the spec

  await scrollTo(scroller, '.qblock.spec', 90, 10, 110);
  await hold(1900); // read the spec: kind, steps, window — the grammar, not SQL

  // ── 4. The money shot: SQL · what actually ran ───────────────────────────────────────────────
  await scrollTo(scroller, '.qblock.sql', 60, 11, 110);
  await hold(3400); // the read-only badge and the parameterised SELECT

  // Nudge down so the $1…$9 bound parameters are on screen under the statement.
  await scrollTo(scroller, '[data-testid="sql-params"]', 380, 7, 110);
  await hold(2400);

  // ── 5. The payoff: the funnel bars and the number ────────────────────────────────────────────
  const funnel = page.locator('[data-testid="funnel-bars"]');
  if (await funnel.count()) {
    await scrollTo(scroller, '[data-testid="funnel-bars"]', 150, 9, 110);
    await hold(3600); // the bars, the conversion percentages and the summary tiles
  }

  await context.close();
  await browser.close();

  // ── 6. Assemble ──────────────────────────────────────────────────────────────────────────────
  const manifest = join(frameDir, 'frames.json');
  writeFileSync(manifest, JSON.stringify({ out: OUT, width: 1000, frames }, null, 2));
  const total = frames.reduce((a, f) => a + f.ms, 0);
  console.log(`  ${frames.length} frames, ${(total / 1000).toFixed(1)}s → ${OUT}`);

  const r = spawnSync(PYTHON, [join(HERE, 'frames-to-gif.py'), manifest], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`frames-to-gif.py exited ${r.status} (is Pillow installed?)`);

  if (process.env.VANTAGE_KEEP_FRAMES) console.log(`  frames kept in ${frameDir}`);
  else rmSync(frameDir, { recursive: true, force: true });
  console.log(`  wrote ${OUT} (${(statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

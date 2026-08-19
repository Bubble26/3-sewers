#!/usr/bin/env node
/**
 * Motion critique tool. Steps a scenario deterministically, grabs frames, and lays them out
 * as ONE numbered contact sheet so a critic can judge timing/animation in a single image read.
 *
 *   node tools/film.mjs contact --frames 12 --step 0.05 --out shots/film
 *   node tools/film.mjs deep_fly --frames 16 --step 0.12 --w 480 --h 270
 */
import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const scenario = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true) || 'contact';
const FRAMES = Number(flag('frames', 12));
const STEP = Number(flag('step', 0.06));
const OUT = flag('out', 'shots/film');
const W = Number(flag('w', 520)), H = Number(flag('h', 292));
const COLS = Number(flag('cols', 4));

const { srv, port } = await listen(0);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 240000 });
await page.evaluate(async (n) => { await globalThis.__SB.scenario(n); }, scenario);

const frames = [];
for (let i = 0; i < FRAMES; i++) {
  await page.evaluate((s) => { globalThis.__SB.advance(s); globalThis.__SB.renderOnce(); }, STEP);
  const buf = await page.screenshot({ type: 'jpeg', quality: 82 });
  frames.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
}
await mkdir(OUT, { recursive: true });

const sheet = await browser.newPage({ viewport: { width: COLS * W + (COLS + 1) * 8, height: Math.ceil(FRAMES / COLS) * (H + 26) + 40 } });
await sheet.setContent(`<style>
 body{margin:0;background:#14120f;font:12px system-ui;color:#e9dfc7;padding:8px}
 .g{display:grid;grid-template-columns:repeat(${COLS},${W}px);gap:8px}
 figure{margin:0} img{display:block;width:${W}px;height:${H}px}
 figcaption{padding:3px 0;letter-spacing:.04em}
 h1{font:600 14px system-ui;margin:0 0 8px}
</style><h1>${scenario} — ${FRAMES} frames @ ${STEP}s (${(STEP * 1000).toFixed(0)}ms apart), read left→right, top→bottom</h1>
<div class="g">${frames.map((f, i) => `<figure><img src="${f}"><figcaption>t+${((i + 1) * STEP).toFixed(2)}s</figcaption></figure>`).join('')}</div>`);
const out = join(OUT, `${scenario}-strip.png`);
await sheet.screenshot({ path: out, fullPage: true });
console.log(JSON.stringify({ strip: out, frames: FRAMES, step: STEP, errors, pageErrors: await page.evaluate(() => globalThis.__SB.errors) }, null, 2));
await browser.close(); srv.close();

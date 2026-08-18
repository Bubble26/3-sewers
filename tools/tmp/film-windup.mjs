import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const FRAMES = Number(argv[0] || 16), STEP = Number(argv[1] || 0.14), OUT = argv[2] || 'shots/pitching-r1';
const W = Number(argv[3]||430), H = Number(argv[4]||300), COLS = 4;
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const START = Number(argv[5] ?? 0);
await page.evaluate((v) => { globalThis.__SB_WINDUP_AT(v < 0 ? null : v); }, START);
if (START < 0) await page.evaluate(() => { globalThis.__SB_WINDUP_AT(0); });
await page.evaluate(async () => { await globalThis.__SB.scenario('pitch_windup'); });
const frames = [], caps = [];
for (let i = 0; i < FRAMES; i++) {
  await page.evaluate((s) => { globalThis.__SB.advance(s); globalThis.__SB.renderOnce(); }, STEP);
  const info = await page.evaluate(() => {
    const A = globalThis.__SB.app, P = A.pitching;
    return { t: +(P.t||0).toFixed(2), ph: P.phase, sim: A.sim.state.phase, rel: +(P.releaseT||0).toFixed(2), apex: +(P.apexT||0).toFixed(2), d: P.deliveryName };
  });
  caps.push(info);
  frames.push(`data:image/jpeg;base64,${(await page.screenshot({ type:'jpeg', quality:84 })).toString('base64')}`);
}
await mkdir(OUT, { recursive: true });
const sheet = await browser.newPage({ viewport: { width: COLS*W + (COLS+1)*8, height: Math.ceil(FRAMES/COLS)*(H+28)+40 } });
await sheet.setContent(`<style>body{margin:0;background:#14120f;font:11px system-ui;color:#e9dfc7;padding:8px}.g{display:grid;grid-template-columns:repeat(${COLS},${W}px);gap:8px}figure{margin:0}img{display:block;width:${W}px;height:${H}px}figcaption{padding:3px 0}h1{font:600 13px system-ui;margin:0 0 8px}</style>
<h1>pitch_windup — ${FRAMES} @ ${STEP}s · release at ${caps[0].rel}s, apex ${caps[0].apex}s, clip ${caps[0].d}</h1>
<div class="g">${frames.map((f,i)=>`<figure><img src="${f}"><figcaption>${i+1}: t=${caps[i].t} ${caps[i].ph}/${caps[i].sim}</figcaption></figure>`).join('')}</div>`);
const out = join(OUT, 'windup-strip.png');
await sheet.screenshot({ path: out, fullPage: true });
console.log(JSON.stringify({ out, errs, caps }, null, 1));
await browser.close(); srv.close();

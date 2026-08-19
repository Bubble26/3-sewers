// rfilm.mjs <stagedKey> <settleStart> <step> <frames> [--out dir] [--w 640] [--h 360] [--crop x,y,w,h]
// Films one of baserunning's STAGED setups from an arbitrary point on the play clock.
import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const a = process.argv.slice(2);
const flag = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
const [key, start, step, frames] = a;
const OUT = flag('out', 'shots/_rfilm');
const W = Number(flag('w', 700)), H = Number(flag('h', 394)), COLS = Number(flag('cols', 4));
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push('[' + m.type() + '] ' + m.text()); });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const shots = [];
const dbg = [];
for (let i = 0; i < Number(frames); i++) {
  const t = Number(start) + i * Number(step);
  const d = await page.evaluate(([k, tt]) => {
    const SB = globalThis.__SB;
    const br = SB.app.baserunning;
    const st = SB.app.__staged || {};
    const over = { settle: 0 };
    const s = br.restage(k, k === 'slide' ? { settle: 1.15, prompt: { until: tt } } : { settle: tt });
    SB.renderOnce();
    return s;
  }, [key, t]);
  dbg.push({ t: +t.toFixed(2), ...d });
  const buf = await page.screenshot({ type: 'jpeg', quality: 84 });
  shots.push(`data:image/jpeg;base64,${buf.toString('base64')}`);
}
await mkdir(OUT, { recursive: true });
const sheet = await browser.newPage({ viewport: { width: COLS * W + (COLS + 1) * 8, height: Math.ceil(shots.length / COLS) * (H + 24) + 40 } });
await sheet.setContent(`<style>body{margin:0;background:#14120f;font:12px system-ui;color:#e9dfc7;padding:8px}.g{display:grid;grid-template-columns:repeat(${COLS},${W}px);gap:8px}figure{margin:0}img{display:block;width:${W}px;height:${H}px}figcaption{padding:2px 0}</style><h1 style="font:600 13px system-ui;margin:0 0 6px">${key} @ ${start}+${step}</h1><div class=g>` + shots.map((s, i) => `<figure><img src="${s}"><figcaption>t=${(Number(start) + i * Number(step)).toFixed(2)}</figcaption></figure>`).join('') + '</div>');
await sheet.screenshot({ path: `${OUT}/${key}-strip.png`, fullPage: true });
console.log(JSON.stringify({ out: `${OUT}/${key}-strip.png`, errs, dbg }, null, 1));
await browser.close(); srv.close();

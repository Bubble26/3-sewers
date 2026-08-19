import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const OUT = flag('out', 'shots/an');
const W = Number(flag('w', 1600)), H = Number(flag('h', 900));
const names = argv.filter(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.replace('--','') !== 'out' && argv[argv.indexOf(a)-1]?.replace('--','') !== 'w' && argv[argv.indexOf(a)-1]?.replace('--','') !== 'h');
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => { if (m.type()==='error'||m.type()==='warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push('[pageerror] ' + e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 180000 });
await mkdir(OUT, { recursive: true });
const list = names.length ? names : await page.evaluate(() => globalThis.__SB.listScenarios());
const errs = [];
for (const n of list) {
  try {
    await page.evaluate(async (x) => { await globalThis.__SB.scenario(x); }, n);
    await page.waitForTimeout(150);
    await page.evaluate(() => globalThis.__SB.renderOnce());
    await page.screenshot({ path: join(OUT, `${n}.png`) });
  } catch (e) { errs.push(`${n}: ${e.message}`); }
}
errs.push(...await page.evaluate(() => globalThis.__SB.errors));
await writeFile(join(OUT,'report.json'), JSON.stringify({ errs, logs }, null, 2));
console.log(JSON.stringify({ errs, logs }, null, 2));
await browser.close(); srv.close();

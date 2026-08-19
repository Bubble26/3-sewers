import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const OUT = flag('out', 'shots/bd-tmp');
const wanted = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type()==='error'||m.type()==='warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 180000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 240000 });
await mkdir(OUT, { recursive: true });
const list = wanted.length ? wanted : await page.evaluate(() => globalThis.__SB.listScenarios());
const errs = [];
for (const name of list) {
  try {
    await page.evaluate(async (n) => { await globalThis.__SB.scenario(n); }, name);
    await page.waitForTimeout(120);
    await page.evaluate(() => globalThis.__SB.renderOnce());
    await page.screenshot({ path: join(OUT, `${name}.png`) });
  } catch (e) { errs.push(`${name}: ${e.message}`); }
}
errs.push(...(await page.evaluate(() => globalThis.__SB.errors)));
console.log(JSON.stringify({ out: OUT, errors: errs, console: logs }, null, 2));
await browser.close(); srv.close();
process.exit(errs.length ? 1 : 0);

import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
import { mkdir } from 'node:fs/promises';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = process.argv[2];
const ACES = process.argv[3] === 'aces';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
if (ACES) await page.addInitScript(() => { globalThis.__SB_NOFX = true; });
const logs=[]; page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')logs.push(m.text())});
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 30000 });
await mkdir(OUT, { recursive: true });
for (const n of process.argv.slice(4)) {
  await page.evaluate(async (x) => { await globalThis.__SB.scenario(x); }, n);
  await page.waitForTimeout(120);
  await page.evaluate(() => globalThis.__SB.renderOnce());
  await page.screenshot({ path: `${OUT}/${n}.png` });
}
console.log('errors', await page.evaluate(()=>globalThis.__SB.errors), logs);
await browser.close(); srv.close();

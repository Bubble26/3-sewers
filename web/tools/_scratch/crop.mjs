// scratch: screenshot a clipped region of a scenario at 1600x900, upscaled by rendering big
import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const [scenario, x, y, w, h, out, js] = process.argv.slice(2);
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
await page.evaluate(async (n) => { await globalThis.__SB.scenario(n); }, scenario);
if (js) await page.evaluate(new Function(js));
await page.waitForTimeout(150);
await page.evaluate(() => globalThis.__SB.renderOnce());
await page.screenshot({ path: out, clip: { x: +x, y: +y, width: +w, height: +h } });
console.log('ok', out);
await browser.close(); srv.close();

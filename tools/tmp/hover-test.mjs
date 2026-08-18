import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready);
await page.evaluate(async () => { await globalThis.__SB.scenario('team_select'); });
const a = await page.screenshot();
await page.mouse.move(1090, 650);          // DUCHESS chip
await page.evaluate(() => globalThis.__SB.renderOnce());
const b = await page.screenshot();
console.log('hover to a different chip changed frame:', Buffer.compare(a, b) !== 0);
await browser.close(); srv.close();

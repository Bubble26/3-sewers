import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const shots = JSON.parse(process.argv[2]);
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready);
await page.evaluate(async () => { await globalThis.__SB.scenario('pitch'); });
for (const s of shots) {
  await page.evaluate(([p, l]) => { globalThis.__SB.camera(p, l); globalThis.__SB.renderOnce(); }, [s.pos, s.look]);
  await page.screenshot({ path: `/tmp/claude-0/-home-user-logicposter/17cacca2-f2c6-5c69-86e2-c4687d2b4fbf/scratchpad/look-${s.name}.png` });
}
console.log(JSON.stringify(await page.evaluate(() => globalThis.__SB.errors)));
await browser.close(); srv.close();

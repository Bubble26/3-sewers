#!/usr/bin/env node
// Ad-hoc camera prober: node cam.mjs <scenario> <out.png> px py pz lx ly lz fov
import { chromium } from 'playwright';
import { listen } from '/home/user/logicposter/stickball/tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const a = process.argv.slice(2);
const scen = a[0], out = a[1];
const cam = a.slice(2).map(Number);
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type()==='error'||m.type()==='warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 180000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 240000 });
await page.evaluate(async (n) => { await globalThis.__SB.scenario(n); }, scen);
await page.evaluate((c) => {
  const app = globalThis.__SB.app;
  app.camera.position.set(c[0], c[1], c[2]);
  app.camera.lookAt(c[3], c[4], c[5]);
  app.camera.fov = c[6]; app.camera.updateProjectionMatrix();
  globalThis.__SB.renderOnce();
}, cam);
await page.waitForTimeout(80);
await page.evaluate(() => globalThis.__SB.renderOnce());
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, logs }));
await browser.close(); srv.close();

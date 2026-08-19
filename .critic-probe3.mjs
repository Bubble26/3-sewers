import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const res = performance.getEntriesByType('resource').map(e=>({n:e.name.split('/').slice(-2).join('/'), d:+e.duration.toFixed(1), s:+e.startTime.toFixed(0)}));
  res.sort((a,b)=>b.d-a.d);
  const marks = performance.getEntriesByType('mark').map(m=>({n:m.name,t:+m.startTime.toFixed(0)}));
  return { top: res.slice(0,15), total: res.length, marks, boot: globalThis.__SB?.bootMs ?? null, now: +performance.now().toFixed(0) };
});
console.log(JSON.stringify(r,null,1));
// now time an audio-free boot for attribution
await browser.close(); srv.close();

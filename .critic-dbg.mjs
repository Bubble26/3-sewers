import { chromium } from 'playwright';
import { listen } from '/home/user/logicposter/stickball/tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
page.on('console', m => console.log(`[console.${m.type()}] ${m.text()}`));
page.on('pageerror', e => console.log(`[pageerror] ${e.message}\n${e.stack||''}`));
page.on('requestfailed', r => console.log(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', r => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`); });
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.log('DOMCONTENTLOADED ok');
} catch (e) { console.log('goto dcl failed: ' + e.message); }
await page.waitForTimeout(15000);
const st = await page.evaluate(() => ({ ready: globalThis.__SB?.ready, has: !!globalThis.__SB, errors: globalThis.__SB?.errors, rs: document.readyState })).catch(e=>({evalErr:String(e)}));
console.log('STATE ' + JSON.stringify(st));
const pending = await page.evaluate(() => performance.getEntriesByType('resource').filter(r=>r.responseEnd===0).map(r=>r.name)).catch(()=>[]);
console.log('PENDING ' + JSON.stringify(pending));
await browser.close(); srv.close();

import { chromium } from 'playwright';
import { listen } from '/home/user/logicposter/stickball/tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const pending = new Set();
page.on('request', r => pending.add(r.url()));
page.on('requestfinished', r => pending.delete(r.url()));
page.on('requestfailed', r => { console.log('FAILED', r.url(), r.failure()?.errorText); pending.delete(r.url()); });
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('console', m => console.log('[console.'+m.type()+']', m.text().slice(0,300)));
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,500)));
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  console.log('DOMCONTENTLOADED ok');
} catch (e) { console.log('goto err', e.message.slice(0,200)); }
await page.waitForTimeout(15000);
console.log('PENDING:', [...pending]);
const ready = await page.evaluate(() => ({ hasSB: !!globalThis.__SB, ready: globalThis.__SB?.ready, errors: globalThis.__SB?.errors })).catch(e=>'eval failed: '+e.message);
console.log('SB:', JSON.stringify(ready));
await browser.close(); srv.close();

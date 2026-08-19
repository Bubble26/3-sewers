import { chromium } from 'playwright';
import { listen } from '/home/user/logicposter/stickball/tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
const logs=[]; page.on('console',m=>logs.push(`[${m.type()}] ${m.text()}`.slice(0,300))); page.on('pageerror',e=>logs.push('[pageerror] '+e.message));
const t0=Date.now();
try {
  await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('domcontentloaded at', Date.now()-t0);
  await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 120000 });
  console.log('ready at', Date.now()-t0);
  const info = await page.evaluate(() => ({
    hasAudio: !!globalThis.__SB?.app?.audio,
    keys: Object.keys(globalThis.__SB?.app?.audio ?? {}),
    hasRenderOffline: typeof globalThis.__SB?.app?.audio?.renderOffline === 'function',
    cues: globalThis.__SB?.app?.audio?.listCues?.() ?? null,
  }));
  console.log(JSON.stringify(info, null, 2));
} catch(e){ console.log('ERR', e.message.slice(0,400)); }
console.log('LOGS', JSON.stringify(logs.slice(0,30), null, 2));
await browser.close(); srv.close();

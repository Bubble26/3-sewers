import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', m => console.log('[console]', m.type(), m.text()));
if (process.env.ACES) await page.addInitScript(() => { globalThis.__SB_ACES = true; });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 30000 });
console.log(await page.evaluate(() => {
  const app = globalThis.__SB.app;
  const art = app.systems.find(s => s.name === 'art');
  const r = app.stage.renderer;
  return {
    hasArt: !!art, enabled: art?.enabled, fxOk: art?.fx?.ok,
    toneMapping: r.toneMapping, exposure: r.toneMappingExposure,
    renderOverrideOwner: app.systems.find(s => s.renderOverride)?.name,
    quality: app.flags.quality,
    rtType: art?.fx?.rt?.texture?.type, samples: art?.fx?.rt?.samples,
  };
}));
await browser.close(); srv.close();

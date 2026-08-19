import { chromium } from 'playwright';
import { listen } from './serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready);
const sample = () => page.evaluate(() => {
  const outs = [];
  for (const el of document.querySelectorAll('canvas')) {
    let nz = -1;
    try { const g = el.getContext('2d'); const d = g.getImageData(0,0,el.width,el.height).data;
      nz=0; for (let i=3;i<d.length;i+=4*197) if (d[i]>8) nz++; } catch(e) { nz = -2; }
    outs.push(`${el.id||'(noid)'}:${el.width}x${el.height}:${nz}`);
  }
  return { canvases: outs, phase: globalThis.__SB.app.fielding.debug.phase };
});
for (const n of ['throw_prompt','field_error']) {
  await page.evaluate(async (x) => { await globalThis.__SB.scenario(x); }, n);
  console.log(n, 'after scenario', JSON.stringify(await sample()));
  await page.waitForTimeout(120);
  console.log(n, 'after wait   ', JSON.stringify(await sample()));
  await page.evaluate(() => globalThis.__SB.renderOnce());
  console.log(n, 'after render ', JSON.stringify(await sample()));
}
await browser.close(); srv.close();

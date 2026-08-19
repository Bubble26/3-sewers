import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded' });
const out = await page.evaluate(async () => {
  const P = await import('/src/render/palette.js');
  const bad = P.audit();
  const bands = {};
  for (const [k, v] of Object.entries(P.FACADE)) {
    if (typeof v !== 'number') continue;
    const r = P.ramp(v);
    bands[k] = [P.lstar(v).toFixed(1), P.lstar(r.shade).toFixed(1), P.lstar(r.bounce).toFixed(1), P.lstar(r.ink).toFixed(1)];
  }
  for (const [k, v] of Object.entries(P.PAVEMENT)) {
    const r = P.ramp(v);
    bands[k] = [P.lstar(v).toFixed(1), P.lstar(r.shade).toFixed(1), P.lstar(r.bounce).toFixed(1), P.lstar(r.ink).toFixed(1)];
  }
  return { bad, bands, accents: P.accentRun(9, 5).map(c => P.css(c)) };
});
console.log('AUDIT:', out.bad.length ? out.bad : 'clean');
console.log('bands lit/shade/bounce/ink:');
for (const [k, v] of Object.entries(out.bands)) console.log(' ', k.padEnd(14), v.join(' / '));
console.log('accentRun(9):', out.accents.join(' '));
await browser.close(); srv.close();

import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready);
const out = await page.evaluate(async () => {
  const m = await import('./src/chars/roster.js');
  const acc = {};
  for (const k of m.ROSTER) acc[k.art.accent] = (acc[k.art.accent]||0)+1;
  const skin = {};
  for (const k of m.ROSTER) skin[k.art.skin] = (skin[k.art.skin]||0)+1;
  const home = {};
  for (const k of m.ROSTER) home[k.home] = (home[k.home]||0)+1;
  return {
    audit: m.auditRoster(),
    n: m.ROSTER.length,
    girls: m.ROSTER.filter(k=>k.sex==='g').length,
    ages: [...new Set(m.ROSTER.map(k=>k.age))].sort((a,b)=>a-b),
    fams: [...new Set(m.ROSTER.map(k=>k.art.fam))],
    shared: m.SHARED_NICKS,
    skin, home,
    topPick: m.ROSTER.map(k=>[k.nick, Math.round(m.pickValue(k)*10)/10]).sort((a,b)=>b[1]-a[1]).slice(0,4),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); srv.close();

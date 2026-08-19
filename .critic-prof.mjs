import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
await cdp.send('Profiler.start');
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 180000 });
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map(n=>[n.id,n]));
const self = new Map();
const total = profile.samples.length;
for (const s of profile.samples) {
  const n = byId.get(s); if(!n) continue;
  const f = n.callFrame;
  const key = (f.url||'(native)').split('/').slice(-2).join('/') + ' :: ' + (f.functionName||'(anon)');
  self.set(key, (self.get(key)||0)+1);
}
const dt = (profile.endTime - profile.startTime)/1e6;
const rows = [...self.entries()].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,v])=>`${(v/total*dt).toFixed(2)}s  ${(v/total*100).toFixed(1)}%  ${k}`);
// also aggregate by file
const byFile = new Map();
for (const [k,v] of self) { const f = k.split(' :: ')[0]; byFile.set(f,(byFile.get(f)||0)+v); }
console.log('TOTAL PROFILE SECONDS', dt.toFixed(1));
console.log('--- BY FILE ---');
console.log([...byFile.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18).map(([k,v])=>`${(v/total*dt).toFixed(2)}s  ${(v/total*100).toFixed(1)}%  ${k}`).join('\n'));
console.log('--- BY FUNCTION ---');
console.log(rows.join('\n'));
await browser.close(); srv.close();

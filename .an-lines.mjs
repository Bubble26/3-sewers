import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs=[]; page.on('pageerror', e=>logs.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil:'domcontentloaded', timeout:180000 });
await page.waitForFunction(()=>globalThis.__SB&&globalThis.__SB.ready,null,{timeout:180000});
const out = await page.evaluate(async () => {
  await globalThis.__SB.scenario('pitch');
  const an = globalThis.__SB.app.announcer;
  const B = an.bank;
  const res = { leftovers: [], girl: [], boy: [], repeats: [], sizes: {} };
  const p = globalThis.__SB.app.get('players');
  const flat = [];
  for (const [gk, g] of Object.entries({ DOT: B.DOT, GOOCH: B.GOOCH, CHATTER: B.CHATTER })) {
    for (const [k, arr] of Object.entries(g)) {
      if (!Array.isArray(arr)) continue;
      res.sizes[gk + '.' + k] = arr.length;
      for (const t of arr) { if (typeof t === 'string') flat.push([gk + '.' + k, t]); }
    }
  }
  for (const t of B.NARRATOR) flat.push(['NARRATOR', t]);
  const GIRL = { id: 'kathleen', name: 'Kathleen Doyle', nick: 'Legs', sex: 'g', accent: 'bottleGreen', voice: {} };
  const proto = Object.getPrototypeOf(an);
  const realBatter = Object.getOwnPropertyDescriptor(proto, 'batter');
  for (const sex of ['b', 'g']) {
    if (sex === 'g') Object.defineProperty(an, 'batter', { get: () => GIRL, configurable: true });
    an._lastFielder = null;
    for (const [k, t] of flat) {
      const subj = /\.(great|error|collision)$/.test(k) ? 'fielder' : 'batter';
      const filled = an.fillSelf(an.fill(t, subj), an.batter);
      if (/[{}]/.test(filled)) res.leftovers.push(k + ' :: ' + filled);
      if (sex === 'g' && /\b(he|him|his|He|His)\b/.test(filled)) res.girl.push(k + ' :: ' + filled);
      if (sex === 'b') res.boy.push(0);
    }
    if (sex === 'g') delete an.batter;
  }
  res.boy = res.boy.length;
  void realBatter;
  // bag behaviour: draw 4x each bank size and look for back-to-back repeats
  for (const [k, arr] of Object.entries(B.DOT)) {
    if (!Array.isArray(arr) || typeof arr[0] !== 'string') continue;
    let last = null;
    for (let i = 0; i < arr.length * 4; i++) {
      const v = an.lib.pick('T' + k, arr);
      if (v === last) res.repeats.push(k + ' :: ' + v);
      last = v;
    }
  }
  res.total = Object.values(res.sizes).reduce((a, b) => a + b, 0);
  return res;
});
await browser.close(); srv.close();
console.log(JSON.stringify({leftovers: out.leftovers, girlCount: out.girl.length, girl: out.girl, repeats: out.repeats, total: out.total}, null, 1).slice(0, 5000));

import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const out = await page.evaluate(async () => {
  const SB = globalThis.__SB, THREE = SB.app.THREE;
  await SB.scenario('anim_run');
  const p = SB.app.get('players');
  const k = p.kids.filter(x => x.group.visible)[0];
  const rows = [];
  const wp = (n) => { const o = k.rig.get(n); const v = new THREE.Vector3(); o.getWorldPosition(v); return v; };
  let prevL = wp('footL'), prevR = wp('footR');
  for (let i = 0; i < 40; i++) {
    SB.advance(1/60);
    const L = wp('footL'), R = wp('footR');
    rows.push({ i, ly: +L.y.toFixed(2), ry: +R.y.toFixed(2),
      ldx: +(L.x - prevL.x).toFixed(3), rdx: +(R.x - prevR.x).toFixed(3), spd: +k.speed.toFixed(1) });
    prevL = L; prevR = R;
  }
  return rows;
});
// planted foot = the lower one; its per-frame world dx should be ~0
let worst = 0, n = 0, sum = 0;
for (const r of out) {
  const planted = r.ly <= r.ry ? r.ldx : r.rdx;
  const y = Math.min(r.ly, r.ry);
  if (y < 0.35) { n++; sum += Math.abs(planted); worst = Math.max(worst, Math.abs(planted)); }
}
console.log(JSON.stringify(out.slice(0, 16)));
console.log('planted frames', n, 'mean |dx| per frame (ft)', (sum/Math.max(1,n)).toFixed(3), 'worst', worst.toFixed(3), 'travel/frame at 17.5ft/s =', (17.5/60).toFixed(3));
await browser.close(); srv.close();

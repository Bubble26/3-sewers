import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const out = await page.evaluate(async () => {
  const SB = globalThis.__SB;
  await SB.scenario('anim_swing');
  const p = SB.app.get('players');
  const k = p.kids.find(x => x.group.visible && x.rig.get('stick'));
  const rows = [];
  const V = SB.app.THREE.Vector3;
  for (let i = 0; i < 14; i++) {
    SB.advance(1/30); SB.renderOnce();
    const tip = k.rig.get('stickTip');
    const w = new V(0, k.rig.stickLength*0.5, 0).applyMatrix4(tip.matrixWorld);
    const root = k.group.position;
    rows.push({ t: +(k.anim.t).toFixed(2), clip: k.anim.cur.name,
      dx: +(w.x-root.x).toFixed(2), dy: +(w.y).toFixed(2), dz: +(w.z-root.z).toFixed(2),
      chestRy: +(k.rig.get('chest').rotation.y*57.3).toFixed(0), gripRz: +(k.rig.get('grip').rotation.z*57.3).toFixed(0) });
  }
  return { yaw: +(k.group.rotation.y).toFixed(2), cam: SB.app.camera.position.toArray().map(v=>+v.toFixed(1)), rows };
});
console.log(JSON.stringify(out.cam), 'yaw', out.yaw);
for (const r of out.rows) console.log(JSON.stringify(r));
await browser.close(); srv.close();

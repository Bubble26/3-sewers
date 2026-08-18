import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 900, height: 506 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const info = await page.evaluate(async () => {
  const SB = globalThis.__SB, THREE = SB.app.THREE;
  await SB.scenario('anim_idle');
  const p = SB.app.get('players');
  const kids = p.kids.filter(k=>k.group.visible);
  // freeze everything at pure rest
  p.update = () => {};
  for (const k of kids) { k.group.rotation.y += Math.PI; k.cycle = null; k.anim.stopLayers(); k.rig.apply({}); k.rig.jiggles.length = 0; }
  SB.renderOnce();
  const out = kids.map(k => {
    const h = k.rig.get('head');
    const q = new THREE.Quaternion(); h.getWorldQuaternion(q);
    const f = new THREE.Vector3(0,0,-1).applyQuaternion(q);
    return { yaw:+k.group.rotation.y.toFixed(2), headEuler: h.rotation.toArray().slice(0,3).map(v=>+(v*57.3).toFixed(0)),
             fy: +f.y.toFixed(2), name: k.name };
  });
  return out;
});
await page.screenshot({ path: 'shots/ab-rest-flip.png' });
console.log(JSON.stringify(info));
await browser.close(); srv.close();

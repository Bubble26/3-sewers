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
  await SB.scenario('anim_swing');
  const p = SB.app.get('players');
  const cam = SB.app.camera.position;
  return p.kids.filter(k=>k.group.visible).map((k) => {
    const h = k.rig.get('head');
    const q = new THREE.Quaternion(); h.getWorldQuaternion(q);
    const f = new THREE.Vector3(0,0,-1).applyQuaternion(q);      // assumed face dir
    const up = new THREE.Vector3(0,1,0).applyQuaternion(q);
    const hp = new THREE.Vector3(); h.getWorldPosition(hp);
    const toCam = cam.clone().sub(hp).normalize();
    return { clip: k.anim.cur.name, t:+k.anim.t.toFixed(2),
      faceDotCam: +f.dot(toCam).toFixed(2), pitchDeg: +(Math.asin(THREE.MathUtils.clamp(f.y,-1,1))*57.3).toFixed(0),
      upY: +up.y.toFixed(2),
      headEuler: [h.rotation.x,h.rotation.y,h.rotation.z].map(v=>+(v*57.3).toFixed(0)),
      neckEuler: [k.rig.get('neck').rotation.x, k.rig.get('neck').rotation.y].map(v=>+(v*57.3).toFixed(0)),
      chestEuler: [k.rig.get('chest').rotation.x, k.rig.get('chest').rotation.y].map(v=>+(v*57.3).toFixed(0)) };
  });
});
console.log(out.map(o=>JSON.stringify(o)).join('\n'));
await browser.close(); srv.close();

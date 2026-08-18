import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 60000 });
console.log(JSON.stringify(await page.evaluate(async () => {
  const SB = globalThis.__SB; await SB.scenario('anim_idle');
  const app = SB.app, p = app.get('players'), THREE = app.THREE;
  const out = [];
  const camPos = app.camera.position;
  for (const k of p.kids) {
    if (!k.group.visible) continue;
    // world-space direction the face decal points
    const head = k.rig.get('head');
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(k.group.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const toCam = new THREE.Vector3(camPos.x - k.pos.x, 0, camPos.z - k.pos.y).normalize();
    out.push({ x: +k.pos.x.toFixed(1), z: +k.pos.y.toFixed(1), rotY: +k.group.rotation.y.toFixed(2), dot: +f.dot(toCam).toFixed(2) });
  }
  return { cam: [ +camPos.x.toFixed(1), +camPos.y.toFixed(1), +camPos.z.toFixed(1) ], kids: out };
}), null, 1));
await browser.close(); srv.close();

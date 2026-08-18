import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 900, height: 506 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
await page.evaluate(async () => {
  const m = await import('/src/chars/anim.js');
  m.Rig.SECONDARY_OFF = true;
  await globalThis.__SB.scenario('anim_idle');
  globalThis.__SB.renderOnce();
});
await page.screenshot({ path: 'shots/ab-nolag.png' });
const info = await page.evaluate(() => {
  const SB = globalThis.__SB, THREE = SB.app.THREE;
  const p = SB.app.get('players');
  const cam = SB.app.camera.position;
  return p.kids.filter(k=>k.group.visible).slice(0,3).map(k=>{
    const h = k.rig.get('head'), c = k.rig.get('brim');
    const q = new THREE.Quaternion(); h.getWorldQuaternion(q);
    const f = new THREE.Vector3(0,0,-1).applyQuaternion(q);
    const hp = new THREE.Vector3(); h.getWorldPosition(hp);
    return { dot: +f.dot(cam.clone().sub(hp).normalize()).toFixed(2), pitch: +(Math.asin(f.y)*57.3).toFixed(0),
      capPos: c ? c.position.toArray().map(v=>+v.toFixed(2)) : null, capRot: c ? c.rotation.toArray().slice(0,3).map(v=>+(v*57.3).toFixed(0)) : null,
      headY: +hp.y.toFixed(2), camY: +cam.y.toFixed(2) };
  });
});
console.log(JSON.stringify(info));
await browser.close(); srv.close();

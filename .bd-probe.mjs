import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 180000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 240000 });
await page.evaluate(async () => { await globalThis.__SB.scenario('stage_wide'); });
const out = await page.evaluate(() => {
  const app = globalThis.__SB.app, THREE = app.THREE;
  const res = [];
  app.scene.traverse((o) => {
    if (!o.name || !o.name.startsWith('backdrop:')) return;
    if (o.isGroup) {
      const b = new THREE.Box3().setFromObject(o);
      res.push({ name: o.name, kids: o.children.length, pos: o.position.toArray().map(v=>+v.toFixed(2)),
        min: b.isEmpty()?null:b.min.toArray().map(v=>Math.round(v)), max: b.isEmpty()?null:b.max.toArray().map(v=>Math.round(v)) });
    }
  });
  const st = app.get('street');
  return { groups: res, tris: st?.tris, layers: (st?.layers||[]).map(l=>({k:l.key,z:l.z,base:l.base.toArray()})), cam: { p: app.camera.position.toArray().map(v=>+v.toFixed(1)), fov: app.camera.fov } };
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); srv.close();

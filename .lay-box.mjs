import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 240000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 240000 });
const out = await page.evaluate(async () => {
  const SB = globalThis.__SB, app = SB.app, THREE = app.THREE;
  await SB.scenario('pitch');
  const P = app.get('players');
  const rep = [];
  for (const [role, k] of [['batter', P.batter], ['pitcher', P.pitcher], ['catcher', P.catcher]]) {
    k.group.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(k.group);
    const parts = [];
    k.group.traverse((o) => {
      if (!o.geometry) return;
      const bb = new THREE.Box3().setFromObject(o);
      if (bb.max.y > b.max.y - 0.35 || bb.min.y < b.min.y + 0.35) {
        parts.push(`${o.name || o.type} y[${bb.min.y.toFixed(2)},${bb.max.y.toFixed(2)}] vis=${o.visible}`);
      }
    });
    rep.push({ role, name: k.name, tall: k.group.userData.metrics?.tall,
      y0: +b.min.y.toFixed(2), y1: +b.max.y.toFixed(2), h: +(b.max.y - b.min.y).toFixed(2), parts });
  }
  return rep;
});
for (const r of out) { console.log(`${r.role} ${r.name} tall=${r.tall} box y[${r.y0},${r.y1}] h=${r.h}`); r.parts.forEach(p => console.log('    ' + p)); }
await browser.close(); srv.close();

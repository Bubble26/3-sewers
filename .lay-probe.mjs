// scratch placement rig: for both locked framings, report every body's NDC x/y and frame
// height, sorted across the frame, plus any body standing inside a prop's collider.
import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit', timeout: 240000 });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 240000 });
const CANDS = process.env.CANDS || '[]';
await page.addInitScript((c) => { globalThis.__CANDS = c; }, CANDS);
await page.evaluate((c) => { globalThis.__CANDS = c; }, CANDS);
const out = await page.evaluate(async () => {
  const SB = globalThis.__SB, app = SB.app, THREE = app.THREE, L = app.layout;
  const P = app.get('players');
  const byHome = new Map();
  for (const k of P.kids) if (k.home) byHome.set(k.home, k);
  const cols = (app.world?.colliders || []).map((c) => ({
    name: c.name, x0: c.box.min.x, x1: c.box.max.x, z0: c.box.min.z, z1: c.box.max.z, y1: c.box.max.y,
  })).filter((c) => c.x1 > -24 && c.x0 < 24 && c.z1 > -10 && c.z0 < 72);
  const bodies = [...L.all(), ...L.BENCH.map((b, i) => Object.assign(b, { id: 'bench' + (i + 1), label: 'BENCH' }))];
  // candidate spots to audition, as [id, x, z, y]
  const CANDS = JSON.parse(globalThis.__CANDS || '[]');
  const hits = [];
  for (const b of bodies) for (const c of cols) {
    if (b.x > c.x0 - 0.9 && b.x < c.x1 + 0.9 && b.z > c.z0 - 0.9 && b.z < c.z1 + 0.9 && (b.y || 0) < c.y1 - 1.2) {
      hits.push(`${b.id} (${b.x},${b.z}) inside "${c.name}" x[${c.x0.toFixed(1)},${c.x1.toFixed(1)}] z[${c.z0.toFixed(1)},${c.z1.toFixed(1)}]`);
    }
  }
  const res = {};
  for (const fr of ['batting', 'field']) {
    await SB.scenario('layout_positions');
    const cam = app.get('cameras');
    cam.pin = fr; cam.cut(fr, true); cam.write();
    app.camera.updateMatrixWorld(true);
    const box = new THREE.Box3(), v = new THREE.Vector3();
    const rows = [];
    for (const b of bodies) {
      const k = byHome.get(b) || byHome.get(L.spot(b.id));
      if (!k) continue;
      k.group.updateWorldMatrix(true, true);
      box.makeEmpty(); box.setFromObject(k.group);
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const top = v.set(cx, box.max.y, cz).project(app.camera).clone();
      const bot = new THREE.Vector3(cx, box.min.y, cz).project(app.camera);
      rows.push({ id: b.id, x: +((top.x + bot.x) / 2).toFixed(2), y: +((top.y + bot.y) / 2).toFixed(2),
        pct: +(Math.abs(top.y - bot.y) / 2 * 100).toFixed(1) });
    }
    for (const [id, cx, cz, cy = 0, h = 4.9] of CANDS) {
      const top = v.set(cx, (cy || 0) + h, cz).project(app.camera).clone();
      const bot = new THREE.Vector3(cx, cy || 0, cz).project(app.camera);
      rows.push({ id: '?' + id, x: +((top.x + bot.x) / 2).toFixed(2), y: +((top.y + bot.y) / 2).toFixed(2),
        pct: +(Math.abs(top.y - bot.y) / 2 * 100).toFixed(1) });
    }
    rows.sort((a, b2) => a.x - b2.x);
    res[fr] = { fov: +app.camera.fov.toFixed(1), rows };
  }
  return { hits, res };
});
for (const fr of ['batting', 'field']) {
  const r = out.res[fr];
  console.log(`\n=== ${fr}  fov ${r.fov} ===`);
  let prev = null;
  for (const k of r.rows) {
    const gap = prev == null ? '' : `  gap ${(k.x - prev).toFixed(2)}`;
    console.log(`  ${k.id.padEnd(9)} x ${String(k.x).padStart(6)}  y ${String(k.y).padStart(6)}  ${String(k.pct).padStart(5)}%${gap}`);
    prev = k.x;
  }
}
console.log('\nOVERLAPS:'); out.hits.forEach((h) => console.log('  ' + h)); if (!out.hits.length) console.log('  none');
await browser.close(); srv.close();

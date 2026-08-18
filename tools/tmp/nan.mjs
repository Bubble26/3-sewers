import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
const logs=[]; page.on('console', m=>logs.push(m.text()));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const out = await page.evaluate(async (scn) => {
  await globalThis.__SB.scenario(scn);
  const bad = [];
  globalThis.__SB.app.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const p = o.geometry.attributes.position;
    if (!p) return;
    const a = p.array;
    for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { bad.push({ name: o.name || o.type, parent: o.parent && o.parent.name, i, v: a[i], n: a.length }); return; }
    if (!Number.isFinite(o.position.x + o.position.y + o.position.z)) bad.push({ name: 'posNaN:' + (o.name||o.type) });
    if (!Number.isFinite(o.scale.x + o.scale.y + o.scale.z)) bad.push({ name: 'scaleNaN:' + (o.name||o.type) });
  });
  return bad.slice(0, 10);
}, process.argv[2] || 'anim_run');
console.log(JSON.stringify(out), logs.filter(l=>/NaN|error/i.test(l)).slice(0,3));
await browser.close(); srv.close();

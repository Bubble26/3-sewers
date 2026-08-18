import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB && globalThis.__SB.ready, null, { timeout: 30000 });
await page.evaluate(() => globalThis.__SB.scenario('style_sheet'));
console.log(JSON.stringify(await page.evaluate(() => {
  const app = globalThis.__SB.app;
  const art = app.systems.find(s => s.name === 'art');
  const view = art && art.constructor ? null : null;
  const mod = globalThis.__SB_STYLE;
  const scene = app.__styleScene || null;
  // find via ART.overrideView
  const ov = (app.systems.find(s=>s.name==='art'));
  return { keys: Object.keys(ov||{}) };
}), null, 2));
// use module import through page: fetch the materials module
console.log(JSON.stringify(await page.evaluate(async () => {
  const m = await import('/src/render/materials.js');
  const s = m.buildStyleSet();
  const out = { shadows: [], outlines: 0, meshes: 0 };
  s.scene.traverse((o) => {
    if (!o.isMesh) return;
    out.meshes++;
    if (o.userData.isOutline) out.outlines++;
    const c = o.material && o.material.color && o.material.color.getHexString ? o.material.color.getHexString() : null;
    if (c === '3e4658') {
      o.updateWorldMatrix(true, false);
      const p = new (globalThis.THREE_V || Object).constructor;
      out.shadows.push({ hex: c, opacity: o.material.opacity, visible: o.visible, ro: o.renderOrder,
        wpos: [o.matrixWorld.elements[12].toFixed(2), o.matrixWorld.elements[13].toFixed(2), o.matrixWorld.elements[14].toFixed(2)],
        alphaMap: !!o.material.alphaMap, transparent: o.material.transparent, parent: o.parent?.type });
    }
  });
  return out;
}), null, 2));
await browser.close(); srv.close();

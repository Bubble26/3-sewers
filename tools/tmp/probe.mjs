import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
page.on('pageerror', e=>console.log('PAGEERR', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const out = await page.evaluate(async () => {
  await globalThis.__SB.scenario('anim_idle');
  const p = globalThis.__SB.app.get('players');
  const c = globalThis.__SB.app.camera;
  return {
    cam: [c.position.toArray(), c.fov],
    n: p.kids.length,
    mode: p.mode,
    rigKeys: Object.keys(p.kids[0].group.userData.rig || {}),
    bound: [...p.kids[0].rig.joints.keys()],
    baseIsKid: p.kids[0].rig.get('base') === p.kids[0].group,
    kids: p.kids.slice(0,6).map(k => ({ name: k.name, vis: k.group.visible, gp: k.group.position.toArray().map(v=>+v.toFixed(2)), pos: [k.pos.x, k.pos.y], parent: k.group.parent && k.group.parent.type, cyc: !!k.cycle, clip: k.anim.cur && k.anim.cur.name })),
    scen: globalThis.__SB.listScenarios(),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); srv.close();

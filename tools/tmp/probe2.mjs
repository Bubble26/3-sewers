import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 400, height: 240 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const out = await page.evaluate(async () => {
  const A = globalThis.__SB.app, P = A.pitching, pl = A.get('players');
  await globalThis.__SB.scenario('pitch_windup');
  const k = pl.pitcher, rig = k.rig;
  const names = [...rig.joints.keys()];
  const wp = (n) => { const o = rig.get(n); if (!o) return null; o.updateWorldMatrix(true,false); const v = new A.THREE.Vector3().setFromMatrixPosition(o.matrixWorld); return [ +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2) ]; };
  const rot = (n) => { const o = rig.get(n); if (!o) return null; return [o.rotation.x, o.rotation.y, o.rotation.z].map(r => +(r*57.3).toFixed(1)); };
  return {
    joints: names, mirror: rig.mirror, height: rig.height, posScale: rig.posScale,
    clip: k.anim.cur?.name, clipT: +k.anim.t.toFixed(3), lock: +k.lock.toFixed(2), state: k.state,
    P: { t:+P.t.toFixed(3), setDur:+P.setDur.toFixed(3), apexT:+P.apexT.toFixed(3), rel:+P.releaseT.toFixed(3), d:P.deliveryName },
    world: { base: wp('base'), head: wp('head'), kneeL: wp('kneeL'), footL: wp('footL'), kneeR: wp('kneeR'), footR: wp('footR'), handR: wp('handR'), handL: wp('handL') },
    rots: { legL: rot('legL'), kneeL: rot('kneeL'), legR: rot('legR'), chest: rot('chest'), armR: rot('armR'), hips: rot('hips') },
    held: [ +P.held.position.x.toFixed(2), +P.held.position.y.toFixed(2), +P.held.position.z.toFixed(2) ], heldVis: P.held.visible,
    kidPos: [k.pos.x, k.pos.y], face: +k.face.toFixed(2), groupY: +k.group.rotation.y.toFixed(2),
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); srv.close();

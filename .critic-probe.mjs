import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('[pageerror] '+e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 240000 });
for (const sc of ['cam_batting','cam_field','pitch','contact']) {
  const out = await page.evaluate(async (n) => {
    await globalThis.__SB.scenario(n);
    const { app } = globalThis.__SB, THREE = app.THREE, cam = app.camera;
    const P = app.get('players');
    const leadFor = (g) => g === P?.batter?.group ? 'BATTER' : g === P?.pitcher?.group ? 'PITCHER' : g === P?.catcher?.group ? 'CATCHER' : '';
    const rows = []; const seen = new Set();
    app.scene.traverse((o) => {
      if (seen.has(o)) return;
      const isKid = o.userData?.isKid || /^kid[:.]|^(batter|pitcher|catcher|fielder|runner)/i.test(o.name||'');
      if (!isKid) return;
      for (let a=o.parent;a;a=a.parent) if (seen.has(a)) return;
      seen.add(o);
      o.updateWorldMatrix(true,true);
      const box = new THREE.Box3().setFromObject(o);
      if (box.isEmpty()) return;
      const cx=(box.min.x+box.max.x)/2, cz=(box.min.z+box.max.z)/2;
      const top=new THREE.Vector3(cx,box.max.y,cz).project(cam);
      const bot=new THREE.Vector3(cx,box.min.y,cz).project(cam);
      const wp=o.getWorldPosition(new THREE.Vector3());
      const p=wp.clone().project(cam);
      rows.push({ n:o.name, role:leadFor(o), pct:+(Math.abs((top.y-bot.y)/2*100)).toFixed(1),
        ndcx:+p.x.toFixed(2), ndcy:+p.y.toFixed(2), wz:+wp.z.toFixed(1), wx:+wp.x.toFixed(1),
        onFrame: Math.abs(p.x)<=1 && Math.abs(p.y)<=1 });
    });
    rows.sort((a,b)=>a.pct-b.pct);
    const cs = app.get('cameras');
    return { fov:+cam.fov.toFixed(2), pos:cam.position.toArray().map(v=>+v.toFixed(1)),
      dist: cs?.solutions?.[cs.framing]?.dist?.toFixed(1), framing: cs?.framing, manual: cs?.manual,
      pitchDeg: cs?.solutions?.[cs.framing]?.pitch?.toFixed(1),
      visible: rows.filter(r=>r.onFrame).length, total: rows.length, rows };
  }, sc);
  console.log('### '+sc+'  fov='+out.fov+' pos='+JSON.stringify(out.pos)+' dist='+out.dist+' pitch='+out.pitchDeg+' framing='+out.framing+' manual='+out.manual+'  inFrame='+out.visible+'/'+out.total);
  for (const r of out.rows) console.log('   '+(r.onFrame?'  ':'OFF')+' '+String(r.n).padEnd(14)+String(r.role).padEnd(8)+' pct='+String(r.pct).padStart(5)+'  ndc=('+r.ndcx+','+r.ndcy+')  world z='+r.wz+' x='+r.wx);
}
await browser.close(); srv.close();

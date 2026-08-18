import { chromium } from 'playwright';
import { listen } from './serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const out = await page.evaluate(async () => {
  const THREE = await import('three');
  const m = await import('/src/chars/rig.js');
  const w = await import('/src/chars/wardrobe.js');
  const rows = [];
  for (const k of w.KIDS) {
    const kid = m.buildKidFromSpec(k.id);
    const mt = kid.userData.metrics;
    const head = kid.userData.parts.head;
    head.updateWorldMatrix(true, true);
    const bb = new THREE.Box3().setFromObject(head);
    rows.push({ id: k.id, fam: k.fam, heads: mt.heads, headPct: mt.headPct, sh: mt.shoulderVsHead,
      hand: mt.handVsHead, shoe: mt.shoeVsHead, leg: mt.legHeads, tall: +mt.tall.toFixed(2),
      headW: +(bb.max.x - bb.min.x).toFixed(2) });
  }
  const eb = new w.Body();
  const probe = { hh: 0 };
  const kid = m.buildKidFromSpec('eugene');
  const head = kid.userData.parts.head;
  const dbg = [];
  head.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); const b=o.geometry.boundingBox; dbg.push({ n:(o.parent&&o.parent.name)||o.name, v:o.geometry.attributes.position.count, x:[+b.min.x.toFixed(2),+b.max.x.toFixed(2)] }); } });
  const eb2 = new w.Body();
  w.buildEars(eb2, { ears: 2.15, hh: 1.4217, hw: 1.246, skinColor: 0x888888, earShade: 0x444444 });
  const eg = eb2.merge(); eg.computeBoundingBox();
  probe.earBox = [+eg.boundingBox.min.x.toFixed(3), +eg.boundingBox.max.x.toFixed(3)];
  probe.nGeo = 4;
  const fam = w.FAMILIES.ears;
  const ectx = { ears: fam.ears, hh: kid.userData.metrics.headH, hw: 0, skinColor: 0xff0000, earShade: 0x00ff00 };
  return { rows, probe, famEars: fam.ears, headHW: kid.userData.metrics.headHW || null, dbg: dbg.slice(0,3) };
});
console.log('id        fam        heads head%  sh/hd hand shoe legHd tall headW(incl hair/ears)');
console.log('PROBE', JSON.stringify(out.probe), 'famEars', out.famEars, 'dbg', JSON.stringify(out.dbg));
for (const r of out.rows) console.log(`${r.id.padEnd(9)} ${r.fam.padEnd(10)} ${String(r.heads).padEnd(5)} ${String(r.headPct).padEnd(6)} ${String(r.sh).padEnd(5)} ${String(r.hand).padEnd(4)} ${String(r.shoe).padEnd(4)} ${String(r.leg).padEnd(5)} ${r.tall} ${r.headW}`);
const hs = out.rows.map(r=>r.heads);
console.log('\nheads span', Math.min(...hs).toFixed(2), '->', Math.max(...hs).toFixed(2), '=', (Math.max(...hs)-Math.min(...hs)).toFixed(2));
const buckets = {};
for (const h of hs) { const b = (Math.floor(h/0.2)*0.2).toFixed(1); buckets[b]=(buckets[b]||0)+1; }
console.log('0.2 buckets (all 30):', JSON.stringify(buckets));
const nine = ['sal','irving','sidney','eugene','ethel','abie','otto','reese','cheech'];
const nb = {}; for (const id of nine) { const h = out.rows.find(r=>r.id===id).heads; const b=(Math.floor(h/0.2)*0.2).toFixed(1); nb[b]=(nb[b]||0)+1; }
console.log('lineup nine buckets:', JSON.stringify(nb));
await browser.close(); srv.close();

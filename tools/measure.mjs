#!/usr/bin/env node
/**
 * Stage-model conformance check (docs/DESIGN-BIBLE.md §17).
 *
 * Screenshots prove what a frame looks like; this proves whether it is legal. It measures every
 * kid's on-screen height, the ball's on-screen diameter, and the camera's lens, and fails the
 * build when the frame breaks the stage rules — which is how "the fielders are too small"
 * stops being an opinion and starts being an exit code.
 *
 *   node tools/measure.mjs                 # every scenario
 *   node tools/measure.mjs pitch contact   # a subset
 *   node tools/measure.mjs --json          # machine-readable only
 */
import { chromium } from 'playwright';
import { listen } from './serve.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const W = 1600, H = 900;

// docs/DESIGN-BIBLE.md §17.3
const LIMITS = {
  fovMax: 26,
  kidMinPct: 12,        // every kid in play
  leadMinPct: 18,       // batter / pitcher / catcher
  leadMaxPct: 26,
  ballMinPx: 9,
};

const { srv, port } = await listen(0);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });

const wanted = argv.filter((a) => !a.startsWith('--'));
const scenarios = wanted.length ? wanted : await page.evaluate(() => globalThis.__SB.listScenarios());

const report = { limits: LIMITS, scenarios: [], violations: [] };

for (const name of scenarios) {
  let m;
  try {
    await page.evaluate(async (n) => { await globalThis.__SB.scenario(n); }, name);
    m = await page.evaluate(({ H }) => {
      const { app } = globalThis.__SB, THREE = app.THREE, cam = app.camera;
      const screenHeight = (obj) => {
        const box = new THREE.Box3();
        obj.updateWorldMatrix(true, true);
        box.setFromObject(obj);
        if (box.isEmpty()) return null;
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        const top = new THREE.Vector3(cx, box.max.y, cz).project(cam);
        const bot = new THREE.Vector3(cx, box.min.y, cz).project(cam);
        // behind the camera projects nonsensically; treat as offscreen
        if (Math.abs(top.z) > 1 && Math.abs(bot.z) > 1) return null;
        return Math.abs((top.y - bot.y) / 2 * H);
      };
      const onScreen = (obj) => {
        const p = obj.getWorldPosition(new THREE.Vector3()).project(cam);
        return p.z < 1 && p.x > -1.25 && p.x < 1.25 && p.y > -1.4 && p.y < 1.4;
      };

      const kids = [];
      const seen = new Set();
      app.scene.traverse((o) => {
        if (!o.isObject3D || seen.has(o)) return;
        const isKid = o.userData?.isKid || /^kid[:.]|^(batter|pitcher|catcher|fielder|runner)/i.test(o.name || '');
        if (!isKid) return;
        let a = o.parent; while (a) { if (seen.has(a)) return; a = a.parent; }
        seen.add(o);
        const px = screenHeight(o);
        if (px == null || !onScreen(o)) return;
        kids.push({ name: o.name || 'kid', px: Math.round(px), pct: +(px / H * 100).toFixed(1),
          lead: /batter|pitcher|catcher/i.test(o.name || '') || !!o.userData?.isLead });
      });

      let ballPx = null;
      const bv = app.get('ballview');
      const ballMesh = bv?.mesh ?? app.scene.getObjectByName('ball');
      if (ballMesh && ballMesh.visible) {
        const r = app.T?.ball?.radius ?? 0.18;
        const c = ballMesh.getWorldPosition(new THREE.Vector3());
        const a = c.clone().project(cam);
        const b = c.clone().add(new THREE.Vector3(0, r * 2, 0)).project(cam);
        ballPx = Math.abs((a.y - b.y) / 2 * H);
      }
      return {
        fov: cam.isPerspectiveCamera ? cam.fov : null,
        ortho: !!cam.isOrthographicCamera,
        kids: kids.sort((x, y) => x.px - y.px),
        ballPx: ballPx == null ? null : Math.round(ballPx),
      };
    }, { H });
  } catch (e) {
    report.violations.push({ scenario: name, rule: 'scenario threw', detail: e.message });
    continue;
  }

  const v = [];
  if (m.fov != null && m.fov > LIMITS.fovMax) v.push(`lens too wide: fov ${m.fov}° > ${LIMITS.fovMax}° (§17.2)`);
  for (const k of m.kids) {
    if (k.pct < LIMITS.kidMinPct) v.push(`${k.name} is ${k.pct}% of frame, floor is ${LIMITS.kidMinPct}% (§17.3)`);
    else if (k.lead && (k.pct < LIMITS.leadMinPct || k.pct > LIMITS.leadMaxPct)) v.push(`${k.name} (lead) is ${k.pct}%, wanted ${LIMITS.leadMinPct}–${LIMITS.leadMaxPct}% (§17.3)`);
  }
  if (m.ballPx != null && m.ballPx < LIMITS.ballMinPx) v.push(`ball is ${m.ballPx}px, floor is ${LIMITS.ballMinPx}px (§17.3)`);

  report.scenarios.push({ scenario: name, fov: m.fov, ortho: m.ortho, kids: m.kids.length, ballPx: m.ballPx,
    smallestKid: m.kids[0] ?? null, violations: v });
  v.forEach((detail) => report.violations.push({ scenario: name, detail }));
}

await browser.close(); srv.close();

if (argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const s of report.scenarios) {
    const worst = s.smallestKid ? `${s.smallestKid.pct}% (${s.smallestKid.name})` : 'no kids';
    console.log(`${s.violations.length ? 'FAIL' : 'ok  '}  ${s.scenario.padEnd(20)} fov ${String(s.fov ?? 'ortho').padStart(5)}  kids ${String(s.kids).padStart(2)}  smallest ${worst}`);
    for (const v of s.violations) console.log(`        ${v}`);
  }
  console.log(`\n${report.violations.length} violation(s) across ${report.scenarios.length} scenario(s)`);
}
process.exit(report.violations.length ? 1 : 0);

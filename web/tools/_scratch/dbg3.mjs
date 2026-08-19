import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
console.log(JSON.stringify(await page.evaluate(async () => {
  const SB = globalThis.__SB, sim = SB.sim, app = SB.app;
  await SB.scenario('swing_timing');
  const sys = app.systems.find(s => s.name === 'batting');
  const V = (v) => v ? [ +v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2) ] : null;
  const proj = (v) => { const p = v.clone().project(app.camera); return [Math.round((p.x*0.5+0.5)*1600), Math.round((1-(p.y*0.5+0.5))*900)]; };
  const mark = sys.marks[sim.hop ? sim.hop.type : 'fast'];
  return {
    phase: sim.state.phase, pitchT: +sim.pitchT.toFixed(3),
    hop: sim.hop ? { type: sim.hop.type, tBounce: +sim.hop.tBounce.toFixed(3), flight: +sim.hop.flight.toFixed(3), thrown: +sim.hop.thrown.toFixed(3), bounce: V(sim.hop.bounce), yCross: +sim.hop.yCross.toFixed(2) } : null,
    ball: V(sim.ball.pos), ballScreen: proj(sim.ball.pos), ballLive: sim.ball.live,
    markVisible: mark.visible, markPos: V(mark.position), markScreen: proj(mark.position), markT: +sys.markT.toFixed(2), markOp: mark.material.opacity,
    trailDots: sys.trail.dots.length, trailVisible: sys.trail.mesh.visible,
    cam: V(app.camera.position), fov: app.camera.fov,
  };
}), null, 1));
await browser.close(); srv.close();

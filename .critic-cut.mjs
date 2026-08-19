import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', e => console.log('[pageerror] '+e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'commit' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 240000 });
const r = await page.evaluate(async () => {
  const { app } = globalThis.__SB, THREE = app.THREE;
  const bus = app.bus;
  const log = [];
  bus.on('*', (e) => log.push([+app.time.toFixed(3), e]));
  await globalThis.__SB.scenario('contact');
  const cs = app.get('cameras');
  const rows = [];
  const snap = (tag) => {
    const cam = app.camera, b = app.sim.ball;
    const p = b.pos.clone().project(cam);
    rows.push({ tag, t:+app.time.toFixed(2), framing: cs.framing, fov:+cam.fov.toFixed(2),
      camY:+cam.position.y.toFixed(2), camZ:+cam.position.z.toFixed(2), tilt:+(cs.tilt*180/Math.PI).toFixed(2),
      ballNdc:[+p.x.toFixed(2),+p.y.toFixed(2)], ballPos:b.pos.toArray().map(v=>+v.toFixed(1)), inFlight:b.inFlight, phase:app.sim.state.phase });
  };
  snap('after-setup');
  for (let i=0;i<40;i++){ globalThis.__SB.advance(1/30); snap('f'+i); }
  return { log: log.slice(-40), rows, evLog: app.bus.log.map(x=>x.evt) };
});
console.log('EVENTS: ' + JSON.stringify(r.evLog.slice(-30)));
for (const x of r.rows) console.log(`${String(x.tag).padEnd(10)} t=${String(x.t).padStart(5)} ${x.framing.padEnd(8)} fov=${x.fov} camY=${x.camY} camZ=${x.camZ} tilt=${x.tilt} phase=${x.phase.padEnd(8)} ballNDC=(${x.ballNdc}) ballPos=${JSON.stringify(x.ballPos)} flight=${x.inFlight}`);
await browser.close(); srv.close();

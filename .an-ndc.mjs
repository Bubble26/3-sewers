import { chromium } from 'playwright';
import { listen } from './tools/serve.mjs';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil:'domcontentloaded', timeout:180000 });
await page.waitForFunction(()=>globalThis.__SB&&globalThis.__SB.ready,null,{timeout:180000});
const out = await page.evaluate(async () => {
  const S = globalThis.__SB, app = S.app, T = app.T;
  const res = [];
  for (const [vy, vz, vx] of [[52,66,-5],[34,52,9],[26,44,9],[20,38,9]]) {
    await S.scenario('pitch');
    app.sim.reset(4242); app.clock.advance(0.9);
    app.sim.ball.pos.set(2,4,T.street.plateZ+2);
    app.sim.ball.vel.set(vx,vy,vz);
    app.sim.ball.inFlight = true; app.sim.ball.live = true;
    app.sim.state.phase='in_play'; app.sim.playT=0;
    const row = { vy, vz, vx, pts: [] };
    for (let i=0;i<5;i++){
      app.clock.advance(0.25); app.clock.render();
      const v = app.sim.ball.pos.clone().project(app.camera);
      row.pts.push([ +( (v.x*0.5+0.5)*1600 ).toFixed(0), +((-v.y*0.5+0.5)*900).toFixed(0), +app.sim.ball.pos.y.toFixed(1) ]);
    }
    res.push(row);
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close(); srv.close();

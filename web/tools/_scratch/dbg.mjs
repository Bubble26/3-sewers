import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type()==='error'||m.type()==='warning') console.log('['+m.type()+']', m.text()); });
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
const out = await page.evaluate(async () => {
  const SB = globalThis.__SB, sim = SB.sim;
  SB.reset(1920);
  const log = [];
  const core = sim.core;
  let last = ''; let seenEv = null;
  for (let i = 0; i < 60 * 60; i++) {
    if (sim.state.phase === 'pitch' && sim.pitchT >= sim.swingWindow().ideal - 0.02 && sim.swingAt < 0) sim.swing();
    SB.advance(1/60);
    const k = `${sim.state.phase}`;
    if (k !== last) { last = k; }
    if (sim.lastEv && sim.lastEv !== seenEv) { seenEv = sim.lastEv; log.push('EV ' + JSON.stringify({k:sim.lastEv.kind, r:sim.lastEv.result, runs:sim.lastEv.runs}) + ` | same=${sim.core===core} live outs=${sim.core.outs} s=${sim.core.strikes} score=${sim.core.score} batIdx=${sim.core.batIdx} snapScore=${sim.lastEv.snap?sim.lastEv.snap.score:'-'} snapOuts=${sim.lastEv.snap?sim.lastEv.snap.outs:'-'} state=${sim.state.score.away}-${sim.state.score.home}`); }
  }
  return { log, errors: SB.errors.slice(0,5), userSide: core.userSide, lineups: core.lineups.map(l=>l.length) };
});
console.log(out.log.slice(0, 40).join('\n'));
console.log('errors', out.errors, 'userSide', out.userSide, 'lineups', out.lineups);
await browser.close(); srv.close();

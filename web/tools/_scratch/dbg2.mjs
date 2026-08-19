import { chromium } from 'playwright';
import { listen } from '../serve.mjs';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-angle=swiftshader','--use-gl=angle','--enable-unsafe-swiftshader','--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
console.log(JSON.stringify(await page.evaluate(async () => {
  const SB = globalThis.__SB, sim = SB.sim, app = SB.app;
  const out = [];
  for (const seed of [4242, 1925]) {
    for (const rate of [1, 4.4, 8]) {
      sim.humanBatsFirst();
      sim.windupRate = rate;
      sim.reset(seed);
      let t = 0, rel = -1;
      for (let i = 0; i < 400 && sim.state.phase !== 'pitch'; i++) { SB.advance(1/60); t += 1/60; }
      rel = t;
      const w = sim.hop ? sim.swingWindow() : null;
      out.push({ seed, rate, releaseAt: +rel.toFixed(3), kind: sim.pitchKind,
        flight: sim.pitch ? +sim.pitch.flight.toFixed(3) : null,
        hop: sim.hop ? { type: sim.hop.type, tB: +sim.hop.tBounce.toFixed(3), tb: sim.hop.tb, yCross: +sim.hop.yCross.toFixed(2), apex: +sim.hop.apex.toFixed(2), rest: +sim.hop.restitution.toFixed(2) } : null,
        window: w ? { open: +(rel + w.open).toFixed(3), ideal: +(rel + w.ideal).toFixed(3), close: +(rel + w.close).toFixed(3) } : null });
    }
  }
  return out;
}), null, 1));
await browser.close(); srv.close();

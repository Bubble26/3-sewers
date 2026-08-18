import { chromium } from 'playwright';
import { listen } from '../serve.mjs';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { srv, port } = await listen(0);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });

const out = await page.evaluate(() => {
  const A = globalThis.__SB.app;
  const P = A.pitching;
  const pl = A.get('players');
  const info = {
    pitcherSpec: pl?.pitcher?.spec?.id, pitcherName: pl?.pitcher?.spec?.name,
    catcher: pl?.catcher?.spec?.id, batter: pl?.batter?.spec?.id,
    profile: P ? { id: P.ai.profile.id, arsenal: P.ai.profile.arsenal, slot: P.ai.profile.slot, setTime: P.ai.profile.setTime } : null,
    setDur: P?.setDur, apexT: P?.apexT, releaseT: P?.releaseT, windupDur: P?.windupDur,
    deliveryName: P?.deliveryName,
    handR: !!pl?.pitcher?.rig?.get?.('handR'),
    pitchScale: pl?.pitcher?.scale,
  };
  // throw a dozen pitches and log them
  const rows = [];
  A.sim.reset(1926);
  for (let i = 0; i < 14; i++) {
    let guard = 0;
    while (A.sim.state.phase === 'wind_up' && guard++ < 400) A.clock.advance(1 / 60);
    const p = A.sim.pitch;
    if (p) rows.push({
      kind: p.id, mph: p.speedMph, flight: +p.flight.toFixed(3), apex: +p.apex.toFixed(2),
      brk: p.breakIn, aim: [+p.aim.x.toFixed(2), +p.aim.y.toFixed(2)],
      cross: [+p.cross.x.toFixed(2), +p.cross.y.toFixed(2)], strike: p.strike,
      grooved: p.grooved, wild: p.wild, p0: [+p.p0.x.toFixed(2), +p.p0.y.toFixed(2), +p.p0.z.toFixed(2)],
    });
    guard = 0;
    while (A.sim.state.phase === 'pitch' && guard++ < 400) A.clock.advance(1 / 60);
    guard = 0;
    while (A.sim.state.phase === 'in_play' && guard++ < 600) A.clock.advance(1 / 60);
  }
  return { info, rows, juice: P?.juice, rattle: P?.rattle, errors: globalThis.__SB.errors };
});
console.log(JSON.stringify(out, null, 1));
console.log(logs.join('\n'));
await browser.close(); srv.close();

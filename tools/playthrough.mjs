#!/usr/bin/env node
/**
 * Plays a whole game headlessly and reports what happened. This is the softlock detector and
 * the pacing meter: if an at-bat never ends, if nobody ever scores, if a phase gets stuck, or
 * if the event stream stops making sense, it shows up here.
 *
 *   node tools/playthrough.mjs                 # one game, seed 1920
 *   node tools/playthrough.mjs --seeds 5       # five games on different seeds
 *   node tools/playthrough.mjs --swing auto    # swing policy: auto | never | always
 *   node tools/playthrough.mjs --shots 6       # also grab N screenshots spread through the game
 */
import { chromium } from 'playwright';
import { listen } from './serve.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = Number(flag('seeds', 1));
const POLICY = flag('swing', 'auto');
const SHOTS = Number(flag('shots', 0));
const OUT = flag('out', 'shots/playthrough');
const MAX_SECONDS = Number(flag('max', 600));

const { srv, port } = await listen(0);
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?harness=1`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__SB?.ready, null, { timeout: 30000 });
if (SHOTS) await mkdir(OUT, { recursive: true });

const games = [];
for (let g = 0; g < SEEDS; g++) {
  const seed = 1920 + g * 7;
  const shotPlan = [];
  const result = await page.evaluate(async ({ seed, POLICY, MAX_SECONDS }) => {
    const SB = globalThis.__SB;
    const sim = SB.sim, bus = SB.app.bus;
    const events = [];
    const off = bus.on('*', (evt, payload) => {
      events.push({ t: +sim.constructor && 0, evt, payload: JSON.parse(JSON.stringify(payload ?? {}, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v))) });
    });
    SB.reset(seed);

    const step = 1 / 60;
    let simTime = 0, guard = 0, lastPhase = '', phaseStuck = 0;
    const phaseTimes = {};
    const stalls = [];

    while (sim.state.phase !== 'over' && simTime < MAX_SECONDS && guard++ < MAX_SECONDS * 60) {
      // swing policy
      if (sim.state.phase === 'pitch' && POLICY !== 'never') {
        const tt = sim.timeToPlate ?? 0.9;
        const want = POLICY === 'always' ? 0 : tt * (0.86 + 0.28 * ((guard % 7) / 7));
        if (sim.pitchT >= want && sim.swingAt < 0) sim.swing();
      }
      SB.advance(step);
      simTime += step;
      phaseTimes[sim.state.phase] = (phaseTimes[sim.state.phase] || 0) + step;
      if (sim.state.phase === lastPhase) { phaseStuck += step; } else { lastPhase = sim.state.phase; phaseStuck = 0; }
      if (phaseStuck > 20) { stalls.push({ phase: sim.state.phase, at: Math.round(simTime) }); phaseStuck = 0; }
    }
    off();
    const counts = {};
    for (const e of events) counts[e.evt] = (counts[e.evt] || 0) + 1;
    return {
      seed,
      finished: sim.state.phase === 'over',
      simSeconds: Math.round(simTime),
      score: sim.state.score,
      inning: sim.state.inning,
      eventCounts: counts,
      phaseTimes: Object.fromEntries(Object.entries(phaseTimes).map(([k, v]) => [k, Math.round(v)])),
      stalls,
      tail: events.slice(-25),
      errors: SB.errors.slice(),
    };
  }, { seed, POLICY, MAX_SECONDS });
  games.push(result);
  if (SHOTS) {
    await page.evaluate(() => globalThis.__SB.renderOnce());
    await page.screenshot({ path: join(OUT, `game${g}-end.png`) });
  }
}

const report = {
  policy: POLICY,
  games: games.map((g) => ({ ...g, tail: undefined })),
  pageErrors,
  verdict: games.every((g) => g.finished && !g.stalls.length) ? 'ok' : 'PROBLEM',
  detail: games.map((g) => ({ seed: g.seed, tail: g.tail })),
};
if (SHOTS) await writeFile(join(OUT, 'playthrough.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close(); srv.close();
process.exit(report.verdict === 'ok' && !pageErrors.length ? 0 : 1);

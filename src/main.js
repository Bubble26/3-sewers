import { app, bootApp } from './app.js';
import './boot/modules.js';
import { listScenarios, getScenario } from './core/scenarios.js';
import { rng } from './core/rng.js';

const HARNESS = new URLSearchParams(location.search).has('harness');
const canvas = document.getElementById('game');
bootApp(canvas, { harness: HARNESS });

const errors = [];
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
for (const level of ['error', 'warn']) {
  const orig = console[level].bind(console);
  console[level] = (...a) => { errors.push(`[${level}] ` + a.map(String).join(' ')); orig(...a); };
}

globalThis.__SB = {
  version: '0.2.0',
  app,
  get stage() { return app.stage; },
  get sim() { return app.sim; },
  get clock() { return app.clock; },
  errors,
  listScenarios,
  reset(seed = 1920) { app.sim.reset(seed); },
  advance(sec) { app.clock.advance(sec); },
  renderOnce() { app.clock.render(); },
  pause() { app.clock.paused = true; },
  resume() { app.clock.paused = false; },
  input(action, value) {
    if (action === 'swing') app.sim.swing();
    for (const s of app.systems) if (s.onInput) s.onInput(action, value, app);
  },
  camera(pos, look) { app.camera.position.set(...pos); app.camera.lookAt(...look); },
  async scenario(name) {
    const s = getScenario(name);
    if (!s) throw new Error('unknown scenario ' + name);
    rng.reset(s.seed ?? 1920);
    for (const sys of app.systems) if (sys.onScenario) sys.onScenario(name, app);
    await s.setup({ app, sim: app.sim, stage: app.stage, clock: app.clock });
    if (s.settle) app.clock.advance(s.settle);
    app.clock.render();
    return true;
  },
  ready: true,
};

document.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); app.sim.swing(); } });
canvas.addEventListener('pointerdown', () => app.sim.swing());

if (!HARNESS) app.clock.start(); else { app.clock.paused = true; app.clock.render(); }
document.body.dataset.booted = '1';

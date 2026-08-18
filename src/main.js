import * as THREE from 'three';
import { Clock } from './core/clock.js';
import { bus } from './core/bus.js';
import { rng } from './core/rng.js';
import { T } from './core/tuning.js';
import { registerScenario, listScenarios, getScenario } from './core/scenarios.js';
import { Stage } from './render/stage.js';
import { buildLighting } from './render/lighting.js';
import { buildStreet } from './world/street.js';
import { buildKid } from './chars/rig.js';
import { ROSTER } from './chars/roster.js';
import { Sim } from './game/sim.js';
import { HUD } from './ui/hud.js';
import { audio } from './audio/engine.js';
import { Puffs } from './fx/particles.js';

const params = new URLSearchParams(location.search);
const HARNESS = params.has('harness');

const canvas = document.getElementById('game');
const stage = new Stage(canvas);
buildLighting(stage.scene);
buildStreet(stage.scene);

const sim = new Sim();
const puffs = new Puffs(stage.scene);
const hud = new HUD(document.getElementById('ui'));

// Ball
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(T.ball.radius, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.7 })
);
ballMesh.castShadow = true;
stage.scene.add(ballMesh);

// Players
const batter = buildKid(ROSTER[0].colors); batter.position.set(-2.2, 0, T.street.plateZ - 0.6); stage.scene.add(batter);
const pitcher = buildKid(ROSTER[1].colors); pitcher.position.set(0, 0, T.street.moundZ); pitcher.rotation.y = Math.PI; stage.scene.add(pitcher);
const fielders = [];
for (let i = 0; i < 4; i++) {
  const f = buildKid(ROSTER[(i + 2) % ROSTER.length].colors);
  f.position.set(-16 + i * 11, 0, 78 + (i % 2) * 24);
  f.rotation.y = Math.PI;
  stage.scene.add(f); fielders.push(f);
}

bus.on('bat:contact', (p) => { audio.crack(); puffs.burst(new THREE.Vector3(0, 3, T.street.plateZ + 1), 10, 4); });
bus.on('strike', () => audio.whiff());
bus.on('ball:bounce', (p) => puffs.burst(p.pos, 5, 2.2));

function update(dt) {
  sim.update(dt);
  ballMesh.position.copy(sim.ball.pos);
  ballMesh.visible = sim.ball.live || sim.ball.inFlight;
  puffs.update(dt);
  hud.update(sim.state);
}
function render() { stage.render(); }

const clock = new Clock(update, render);
sim.reset(1920);

// ---- scenarios -------------------------------------------------------------
registerScenario('pitch', { seed: 1920, setup: () => { sim.reset(1920); }, settle: 0.6 });
registerScenario('contact', {
  seed: 4242,
  setup: () => { sim.reset(4242); clock.advance(0.9); sim.swing(); },
  settle: 0.35,
});
registerScenario('deep_fly', {
  seed: 77,
  setup: () => {
    sim.reset(77); clock.advance(0.9);
    sim.ball.pos.set(0, 3, T.street.plateZ + 1);
    sim.ball.vel.set(6, 46, 74);
    sim.ball.inFlight = true; sim.state.phase = 'in_play'; sim.playT = 0;
  },
  settle: 1.1,
});
registerScenario('wide', {
  seed: 1, setup: () => { sim.reset(1); stage.camera.position.set(46, 34, -26); stage.camera.lookAt(0, 6, 46); }, settle: 0.3,
});

// ---- debug / harness API ---------------------------------------------------
const errors = [];
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
const origErr = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); origErr(...a); };

globalThis.__SB = {
  version: '0.1.0',
  THREE, stage, sim, clock, bus, rng, T, puffs,
  errors,
  listScenarios,
  reset(seed = 1920) { sim.reset(seed); },
  advance(sec) { clock.advance(sec); },
  renderOnce() { render(); },
  pause() { clock.paused = true; },
  resume() { clock.paused = false; },
  input(action) { if (action === 'swing') sim.swing(); },
  camera(pos, look) { stage.camera.position.set(...pos); stage.camera.lookAt(...look); },
  async scenario(name) {
    const s = getScenario(name);
    if (!s) throw new Error('unknown scenario ' + name);
    rng.reset(s.seed ?? 1920);
    s.setup({ stage, sim, clock, THREE });
    if (s.settle) clock.advance(s.settle);
    render();
    return true;
  },
  ready: true,
};

document.addEventListener('keydown', (e) => { if (e.code === 'Space') { e.preventDefault(); sim.swing(); } });
canvas.addEventListener('pointerdown', () => sim.swing());

if (!HARNESS) clock.start(); else { clock.paused = true; render(); }
document.body.dataset.booted = '1';

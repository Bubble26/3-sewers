import * as THREE from 'three';
import { Clock } from './core/clock.js';
import { bus } from './core/bus.js';
import { rng } from './core/rng.js';
import { T } from './core/tuning.js';
import { Stage } from './render/stage.js';
import { Sim } from './game/sim.js';

/**
 * The app object every system receives. Systems are the unit of parallel work:
 * one feature = one module = one system, registered from its own file.
 *
 *   import { registerSystem } from '../app.js';
 *   registerSystem({
 *     name: 'street',
 *     order: 10,                    // lower runs first
 *     init(app) {},                 // build meshes, subscribe to app.bus
 *     update(dt, app) {},           // fixed-timestep sim tick
 *     lateUpdate(dt, app) {},       // after everything else (cameras, HUD)
 *     dispose(app) {},
 *   });
 *
 * Then add exactly one import line to src/boot/modules.js. Touch nothing else.
 */
const systems = [];
let booted = false;

export const app = {
  THREE, bus, rng, T,
  stage: null, sim: null, clock: null,
  scene: null, camera: null,
  systems,
  flags: { harness: false, reducedMotion: false, quality: 'high' },
  get(name) { return systems.find((s) => s.name === name); },
  time: 0,
};

export function registerSystem(sys) {
  if (!sys || !sys.name) throw new Error('system needs a name');
  if (systems.some((s) => s.name === sys.name)) {
    console.warn(`system "${sys.name}" registered twice — keeping the first`);
    return sys;
  }
  sys.order = sys.order ?? 100;
  systems.push(sys);
  if (booted && sys.init) sys.init(app);
  return sys;
}

export function bootApp(canvas, { harness = false } = {}) {
  app.stage = new Stage(canvas);
  app.scene = app.stage.scene;
  app.camera = app.stage.camera;
  app.sim = new Sim();
  app.flags.harness = harness;

  systems.sort((a, b) => a.order - b.order);
  for (const s of systems) { if (s.init) { try { s.init(app); } catch (e) { console.error(`init ${s.name}`, e); } } }
  booted = true;

  const update = (dt) => {
    app.time += dt;
    app.sim.update(dt);
    for (const s of systems) if (s.update) { try { s.update(dt, app); } catch (e) { console.error(`update ${s.name}`, e); } }
    for (const s of systems) if (s.lateUpdate) { try { s.lateUpdate(dt, app); } catch (e) { console.error(`lateUpdate ${s.name}`, e); } }
  };
  const render = () => {
    for (const s of systems) if (s.preRender) { try { s.preRender(app); } catch (e) { console.error(`preRender ${s.name}`, e); } }
    const r = systems.find((s) => s.renderOverride);
    if (r) r.renderOverride(app); else app.stage.render();
  };

  app.clock = new Clock(update, render);
  app.sim.reset(1920);
  return app;
}

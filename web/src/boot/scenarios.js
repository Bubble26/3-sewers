import { registerScenario } from '../core/scenarios.js';
import { app } from '../app.js';
import { T } from '../core/tuning.js';

// Baseline scenarios. Feature pieces add their own next to their module
// (call registerScenario there and import it from modules.js).
registerScenario('pitch', { seed: 1920, setup: () => { app.sim.reset(1920); }, settle: 0.6 });

registerScenario('contact', {
  seed: 4242,
  setup: () => { app.sim.reset(4242); app.clock.advance(0.9); app.sim.swing(); },
  settle: 0.35,
});

registerScenario('deep_fly', {
  seed: 77,
  setup: () => {
    app.sim.reset(77); app.clock.advance(0.9);
    app.sim.ball.pos.set(0, 3, T.street.plateZ + 1);
    app.sim.ball.vel.set(6, 46, 74);
    app.sim.ball.inFlight = true; app.sim.state.phase = 'in_play'; app.sim.playT = 0;
  },
  settle: 1.1,
});

registerScenario('wide', {
  seed: 1,
  setup: () => { app.sim.reset(1); app.camera.position.set(46, 34, -26); app.camera.lookAt(0, 6, 46); },
  settle: 0.3,
});

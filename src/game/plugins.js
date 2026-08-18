/**
 * Gameplay slots.
 *
 * The sim owns the at-bat state machine and nothing else. Every actual gameplay decision is
 * delegated to a slot, and each slot is filled by exactly one module owned by exactly one
 * piece — so the pitching, batting, physics, fielding, baserunning and rules pieces can all
 * be built in parallel without ever editing the same file.
 *
 *   import { provide } from './plugins.js';
 *   provide('pitching', { ...implementation });
 *
 * Every slot is optional. Where a slot is empty the sim uses the placeholder behaviour in
 * src/game/defaults.js, so the game always runs end to end even mid-wave.
 *
 * ── Slot contracts ─────────────────────────────────────────────────────────────
 *
 * pitching
 *   beginWindup(sim)                 start the delivery; set sim.timer if you want a custom length
 *   updateWindup(dt, sim) -> bool    true when the ball leaves the hand
 *   release(sim)                     position sim.ball.pos/vel, set sim.pitchTarget {x,y,z}, sim.pitchKind
 *   updatePitch(dt, sim)             per-step flight while the pitch is travelling (spin, break)
 *
 * batting
 *   onSwingInput(sim, kind)          player pressed swing; record timing on sim.swingAt
 *   updateSwing(dt, sim)             drive the swing arc
 *   evaluateContact(sim)             -> null for a miss, else { quality, power, angleDeg, sprayRad, kind }
 *
 * ballphysics
 *   step(dt, ball, sim)              integrate a batted ball, including caroms off the world
 *   settled(ball, sim) -> bool       true once the ball has come to rest / been retrieved
 *
 * fielding
 *   onBallInPlay(sim, launch)        assign chasers
 *   update(dt, sim)                  -> null while the play is live, else { kind: 'out'|'hit', bases, detail }
 *
 * baserunning
 *   onContact(sim)                   runners break
 *   update(dt, sim)                  move runners
 *   advance(sim, bases)              force the bookkeeping advance (walks, home runs)
 *
 * rules
 *   isStrike(sim, target) -> bool    zone judgement for a taken pitch
 *   onResult(sim, result)            street rules: fouls off the fire escape, do-overs, CAR!, ghost runners
 *   nextBatter(sim)
 */
export const gameplay = {
  pitching: null,
  batting: null,
  ballphysics: null,
  fielding: null,
  baserunning: null,
  rules: null,
};

const SLOTS = Object.keys(gameplay);

export function provide(slot, impl) {
  if (!SLOTS.includes(slot)) throw new Error(`unknown gameplay slot "${slot}"`);
  if (gameplay[slot]) console.warn(`gameplay slot "${slot}" filled twice — keeping the first`);
  else gameplay[slot] = impl;
  return impl;
}

/** Call a slot method, falling back to the placeholder implementation. */
export function slot(name, method, fallback) {
  const impl = gameplay[name];
  if (impl && typeof impl[method] === 'function') return impl[method].bind(impl);
  return fallback;
}

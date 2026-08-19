import * as THREE from 'three';
import { T } from '../core/tuning.js';
import { rng } from '../core/rng.js';

/**
 * Placeholder gameplay. These keep the game playable end to end while the real pitching,
 * batting, physics, fielding, baserunning and rules pieces are being built. Every one of
 * them is meant to be replaced by a slot implementation — see src/game/plugins.js.
 */
export const defaults = {
  beginWindup(sim) { sim.timer = 0.9; },

  updateWindup(dt, sim) { sim.timer -= dt; return sim.timer <= 0; },

  release(sim) {
    sim.ball.pos.set(rng.range(-0.7, 0.7), T.pitch.releaseHeight, T.street.moundZ);
    const target = new THREE.Vector3(rng.range(-1.4, 1.4), rng.range(1.8, 3.4), T.street.plateZ);
    sim.ball.vel.copy(target).sub(sim.ball.pos).normalize().multiplyScalar(T.pitch.speed);
    sim.pitchTarget = target;
    sim.pitchKind = 'straight';
  },

  updatePitch(dt, sim) {
    sim.ball.pos.addScaledVector(sim.ball.vel, dt);
    sim.ball.vel.y -= T.pitch.arcGravity * dt * 0.35;
  },

  onSwingInput(sim) { if (sim.swingAt < 0) sim.swingAt = sim.pitchT; },

  evaluateContact(sim) {
    const err = Math.abs(sim.swingAt - sim.timeToPlate);
    const quality = Math.max(0, 1 - err / T.bat.contactWindow);
    if (quality <= 0) return null;
    return {
      quality,
      power: 52 + quality * 62 + rng.range(-6, 6),
      angleDeg: THREE.MathUtils.lerp(52, 24, quality) + rng.range(-6, 6),
      sprayRad: rng.range(-0.45, 0.45) * (1.2 - quality),
      kind: quality > 0.7 ? 'square' : 'glance',
    };
  },

  stepBall(dt, ball, sim) {
    ball.vel.y -= T.ball.gravity * dt;
    ball.vel.multiplyScalar(1 - T.ball.drag * dt);
    ball.pos.addScaledVector(ball.vel, dt);
    if (ball.pos.y <= T.ball.radius) {
      ball.pos.y = T.ball.radius;
      ball.vel.y = Math.abs(ball.vel.y) * T.ball.bounce;
      ball.vel.x *= 0.7; ball.vel.z *= 0.7;
      return { bounced: true };
    }
    return null;
  },

  // Resolves a live ball by how far it got — stands in for real fielders.
  resolvePlay(sim) {
    const dist = sim.ball.pos.length();
    if (dist > 210) return { kind: 'hit', bases: 4, detail: 'over the roof' };
    if (dist > 150) return { kind: 'hit', bases: 3, detail: 'off the far wall' };
    if (dist > 110) return { kind: 'hit', bases: 2, detail: 'past everybody' };
    if (dist > 62 && rng.chance(0.55)) return { kind: 'hit', bases: 1, detail: 'through the gap' };
    return { kind: 'out', bases: 0, detail: 'fielded' };
  },

  isStrike(sim, target) {
    return Math.abs(target.x) < 1.1 && target.y > 1.9 && target.y < 3.3;
  },
};

import * as THREE from 'three';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { rng } from '../core/rng.js';
import { newGame } from './state.js';

// Minimal but complete at-bat loop: pitch -> swing window -> ball physics -> result.
export class Sim {
  constructor() {
    this.state = newGame();
    this.ball = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), live: false, inFlight: false };
    this.timer = 0;
    this.swingAt = -1;
    this.pitchT = 0;
  }
  reset(seed = 1920) { rng.reset(seed); this.state = newGame(); this.timer = 0; this.beginAtBat(); }

  beginAtBat() {
    this.state.phase = 'wind_up';
    this.timer = 0.9;
    this.ball.live = false; this.ball.inFlight = false;
    bus.emit('atbat:begin', { batter: this.state.batterIdx });
  }
  throwPitch() {
    const s = this.state;
    s.phase = 'pitch';
    this.pitchT = 0;
    this.ball.live = true; this.ball.inFlight = false;
    this.ball.pos.set(rng.range(-0.7, 0.7), T.pitch.releaseHeight, T.street.moundZ);
    const target = new THREE.Vector3(rng.range(-1.4, 1.4), rng.range(1.8, 3.4), T.street.plateZ);
    this.ball.vel.copy(target).sub(this.ball.pos).normalize().multiplyScalar(T.pitch.speed);
    this.pitchTarget = target;
    bus.emit('pitch:thrown', { speed: T.pitch.speed });
  }
  swing() {
    const s = this.state;
    if (s.phase !== 'pitch' || this.swingAt >= 0) return;
    this.swingAt = this.pitchT;
    bus.emit('bat:swing', {});
  }
  contact() {
    const s = this.state;
    // Timing error -> launch angle + power falloff.
    const err = Math.abs(this.swingAt - this.timeToPlate);
    const quality = Math.max(0, 1 - err / T.bat.contactWindow);
    if (quality <= 0) return this.strike('swinging');
    const power = 52 + quality * 62 + rng.range(-6, 6);
    const angle = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(52, 24, quality) + rng.range(-6, 6));
    const spray = rng.range(-0.45, 0.45) * (1.2 - quality);
    this.ball.pos.set(0, 3.0, T.street.plateZ + 1);
    this.ball.vel.set(Math.sin(spray) * power * Math.cos(angle), Math.sin(angle) * power, Math.cos(spray) * power * Math.cos(angle));
    this.ball.inFlight = true;
    s.phase = 'in_play';
    this.playT = 0;
    bus.emit('bat:contact', { quality, power });
  }
  strike(kind) {
    const s = this.state;
    s.strikes++;
    bus.emit('strike', { kind, count: s.strikes });
    if (s.strikes >= T.game.strikes) return this.out('strikeout');
    this.afterPitch();
  }
  ball4() {
    const s = this.state;
    s.balls++;
    bus.emit('ball', { count: s.balls });
    if (s.balls >= T.game.balls) { this.advanceRunners(1); s.balls = 0; s.strikes = 0; this.nextBatter(); return; }
    this.afterPitch();
  }
  out(kind) {
    const s = this.state;
    s.outs++; s.balls = 0; s.strikes = 0;
    bus.emit('out', { kind, outs: s.outs });
    if (s.outs >= T.game.outsPerInning) return this.endHalf();
    this.nextBatter();
  }
  hit(basesGained) {
    const s = this.state;
    s.balls = 0; s.strikes = 0;
    this.advanceRunners(basesGained);
    bus.emit('hit', { bases: basesGained });
    this.nextBatter();
  }
  advanceRunners(n) {
    const s = this.state;
    for (let i = 2; i >= 0; i--) {
      if (s.bases[i]) {
        const to = i + n;
        s.bases[i] = null;
        if (to >= 3) this.scoreRun(); else s.bases[to] = true;
      }
    }
    if (n >= 4) this.scoreRun(); else s.bases[n - 1] = true;
  }
  scoreRun() {
    const s = this.state;
    const t = s.half === 'top' ? 'away' : 'home';
    s.score[t]++;
    bus.emit('run', { team: t, score: { ...s.score } });
  }
  endHalf() {
    const s = this.state;
    s.outs = 0; s.balls = 0; s.strikes = 0; s.bases = [null, null, null];
    if (s.half === 'top') s.half = 'bottom'; else { s.half = 'top'; s.inning++; }
    bus.emit('half:end', { inning: s.inning, half: s.half });
    if (s.inning > T.game.innings) { s.phase = 'over'; bus.emit('game:over', { score: { ...s.score } }); return; }
    this.beginAtBat();
  }
  nextBatter() { this.state.batterIdx = (this.state.batterIdx + 1) % 4; this.beginAtBat(); }
  afterPitch() { this.swingAt = -1; this.beginAtBat(); }

  get timeToPlate() {
    return (T.street.moundZ - T.street.plateZ) / T.pitch.speed;
  }

  update(dt) {
    const s = this.state;
    if (s.phase === 'over') return;
    if (s.phase === 'wind_up') {
      this.timer -= dt;
      if (this.timer <= 0) { this.swingAt = -1; this.throwPitch(); }
      return;
    }
    if (s.phase === 'pitch') {
      this.pitchT += dt;
      this.ball.pos.addScaledVector(this.ball.vel, dt);
      this.ball.vel.y -= T.pitch.arcGravity * dt * 0.35;
      if (this.ball.pos.z <= T.street.plateZ + 0.4) {
        if (this.swingAt >= 0) this.contact();
        else {
          const inZone = Math.abs(this.pitchTarget.x) < 1.1 && this.pitchTarget.y > 1.9 && this.pitchTarget.y < 3.3;
          inZone ? this.strike('looking') : this.ball4();
        }
      }
      return;
    }
    if (s.phase === 'in_play') {
      this.playT += dt;
      this.ball.vel.y -= T.ball.gravity * dt;
      this.ball.vel.multiplyScalar(1 - T.ball.drag * dt * 60 * 0.016);
      this.ball.pos.addScaledVector(this.ball.vel, dt);
      if (this.ball.pos.y <= T.ball.radius) {
        this.ball.pos.y = T.ball.radius;
        this.ball.vel.y = Math.abs(this.ball.vel.y) * T.ball.bounce;
        this.ball.vel.x *= 0.7; this.ball.vel.z *= 0.7;
        bus.emit('ball:bounce', { pos: this.ball.pos.clone() });
      }
      if (this.playT > 2.4) {
        const dist = this.ball.pos.length();
        if (dist > 210) this.hit(4);
        else if (dist > 150) this.hit(3);
        else if (dist > 110) this.hit(2);
        else if (dist > 62 && rng.chance(0.55)) this.hit(1);
        else this.out('fielded');
        this.ball.inFlight = false;
      }
    }
  }
}

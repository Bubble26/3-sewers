import * as THREE from 'three';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { rng } from '../core/rng.js';
import { newGame } from './state.js';
import { gameplay, slot } from './plugins.js';
import { defaults } from './defaults.js';

/**
 * The at-bat state machine. It owns phases, the count, outs and innings, and it owns nothing
 * else: every gameplay decision is delegated to a slot in src/game/plugins.js so each piece
 * of the game can be built and judged on its own.
 *
 * Phases: idle -> wind_up -> pitch -> in_play -> (resolve) -> wind_up ... -> over
 */
export class Sim {
  constructor() {
    this.state = newGame();
    this.ball = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), live: false, inFlight: false };
    this.timer = 0;
    this.swingAt = -1;
    this.pitchT = 0;
    this.playT = 0;
    this.pitchTarget = new THREE.Vector3();
    this.pitchKind = 'straight';
    this.lastContact = null;
  }

  reset(seed = 1920) {
    rng.reset(seed);
    this.state = newGame();
    this.timer = 0; this.pitchT = 0; this.playT = 0; this.swingAt = -1;
    this.lastContact = null;
    this.ball.live = false; this.ball.inFlight = false;
    this.ball.pos.set(0, T.pitch.releaseHeight, T.street.moundZ);
    this.ball.vel.set(0, 0, 0);
    this.beginAtBat();
  }

  get timeToPlate() { return (T.street.moundZ - T.street.plateZ) / T.pitch.speed; }
  get batter() { return this.state.batterIdx; }

  // ── flow ──────────────────────────────────────────────────────────────────
  beginAtBat() {
    this.state.phase = 'wind_up';
    this.swingAt = -1;
    this.pitchT = 0;
    this.ball.live = false; this.ball.inFlight = false;
    slot('pitching', 'beginWindup', defaults.beginWindup)(this);
    bus.emit('atbat:begin', { batter: this.state.batterIdx, count: { balls: this.state.balls, strikes: this.state.strikes } });
  }

  throwPitch() {
    this.state.phase = 'pitch';
    this.pitchT = 0;
    this.ball.live = true; this.ball.inFlight = false;
    slot('pitching', 'release', defaults.release)(this);
    bus.emit('pitch:thrown', { kind: this.pitchKind, target: this.pitchTarget.clone() });
  }

  swing(kind = 'normal') {
    if (this.state.phase !== 'pitch') return;
    slot('batting', 'onSwingInput', defaults.onSwingInput)(this, kind);
    bus.emit('bat:swing', { kind });
  }

  contact() {
    const hit = slot('batting', 'evaluateContact', defaults.evaluateContact)(this);
    if (!hit) return this.strike('swinging');

    const angle = THREE.MathUtils.degToRad(hit.angleDeg);
    const spray = hit.sprayRad;
    this.ball.pos.set(0, 3.0, T.street.plateZ + 1);
    this.ball.vel.set(
      Math.sin(spray) * hit.power * Math.cos(angle),
      Math.sin(angle) * hit.power,
      Math.cos(spray) * hit.power * Math.cos(angle),
    );
    this.ball.inFlight = true;
    this.lastContact = hit;
    this.state.phase = 'in_play';
    this.playT = 0;
    bus.emit('bat:contact', hit);
    gameplay.fielding?.onBallInPlay?.(this, hit);
    gameplay.baserunning?.onContact?.(this);
  }

  // ── outcomes ──────────────────────────────────────────────────────────────
  strike(kind) {
    const s = this.state;
    s.strikes++;
    bus.emit('strike', { kind, count: s.strikes });
    if (s.strikes >= T.game.strikes) return this.out('strikeout');
    this.beginAtBat();
  }

  ballCalled() {
    const s = this.state;
    s.balls++;
    bus.emit('ball', { count: s.balls });
    if (s.balls >= T.game.balls) { bus.emit('walk', {}); return this.reachBase(1, 'walk'); }
    this.beginAtBat();
  }

  out(kind) {
    const s = this.state;
    s.outs++; s.balls = 0; s.strikes = 0;
    bus.emit('out', { kind, outs: s.outs });
    if (s.outs >= T.game.outsPerInning) return this.endHalf();
    this.nextBatter();
  }

  reachBase(bases, kind) {
    const s = this.state;
    s.balls = 0; s.strikes = 0;
    (gameplay.baserunning?.advance ?? this.advanceRunners.bind(this))(this, bases);
    bus.emit('hit', { bases, kind });
    this.nextBatter();
  }

  advanceRunners(_sim, n) {
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
    const team = s.half === 'top' ? 'away' : 'home';
    s.score[team]++;
    bus.emit('run', { team, score: { ...s.score } });
  }

  endHalf() {
    const s = this.state;
    s.outs = 0; s.balls = 0; s.strikes = 0; s.bases = [null, null, null];
    if (s.half === 'top') s.half = 'bottom'; else { s.half = 'top'; s.inning++; }
    bus.emit('half:end', { inning: s.inning, half: s.half });
    if (s.inning > T.game.innings) { s.phase = 'over'; bus.emit('game:over', { score: { ...s.score } }); return; }
    this.beginAtBat();
  }

  nextBatter() {
    (gameplay.rules?.nextBatter ?? ((sim) => { sim.state.batterIdx = (sim.state.batterIdx + 1) % 9; }))(this);
    this.beginAtBat();
  }

  resolvePlay(result) {
    gameplay.rules?.onResult?.(this, result);
    this.ball.inFlight = false;
    this.state.lastEvent = result.detail || result.kind;
    if (result.kind === 'out') this.out(result.detail || 'fielded');
    else if (result.kind === 'foul') this.strike('foul');
    else if (result.kind === 'do_over') this.beginAtBat();
    else this.reachBase(result.bases, result.detail);
  }

  // ── tick ──────────────────────────────────────────────────────────────────
  update(dt) {
    const s = this.state;
    if (s.phase === 'over' || s.phase === 'idle') return;

    if (s.phase === 'wind_up') {
      if (slot('pitching', 'updateWindup', defaults.updateWindup)(dt, this)) this.throwPitch();
      return;
    }

    if (s.phase === 'pitch') {
      this.pitchT += dt;
      slot('pitching', 'updatePitch', defaults.updatePitch)(dt, this);
      gameplay.batting?.updateSwing?.(dt, this);
      if (this.ball.pos.z <= T.street.plateZ + 0.4) {
        if (this.swingAt >= 0) this.contact();
        else if (slot('rules', 'isStrike', defaults.isStrike)(this, this.pitchTarget)) this.strike('looking');
        else this.ballCalled();
      }
      return;
    }

    if (s.phase === 'in_play') {
      this.playT += dt;
      const step = slot('ballphysics', 'step', defaults.stepBall);
      const ev = step(dt, this.ball, this);
      if (ev?.bounced) bus.emit('ball:bounce', { pos: this.ball.pos.clone(), surface: ev.surface || 'street' });
      if (ev?.carom) bus.emit('ball:carom', { pos: this.ball.pos.clone(), surface: ev.carom });

      const fielded = gameplay.fielding?.update?.(dt, this);
      if (fielded) return this.resolvePlay(fielded);

      const settled = gameplay.ballphysics?.settled?.(this.ball, this) ?? this.playT > 2.4;
      if (settled) return this.resolvePlay(defaults.resolvePlay(this));
    }
  }
}

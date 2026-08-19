import * as THREE from 'three';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { rng } from '../core/rng.js';
import { newGame } from './state.js';
import { gameplay, slot } from './plugins.js';
import { defaults } from './defaults.js';
import { liveMatch, HALF, PITCH_TYPES } from './core.js';

/**
 * ============================================================================
 * THE AT-BAT — one machine, ONE RULEBOOK
 * ============================================================================
 *
 * There used to be two rulebooks in this repo and the running game used the wrong
 * one. `src/game/core.js` is a ported, soak-tested stickball engine — perfect/good/
 * weak contact bands, the foul-off that will not die, walks, the street verdicts,
 * `applyHit`, `checkHalf` — and the app called exactly one function out of it
 * (`classifyInPlay`) after deciding everything else for itself with a different set
 * of numbers. A full playthrough produced 0-0 in eleven half-innings: 59 strikes,
 * 53 balls, 18 outs, not one ball in play. Every one of those bands was dead code.
 *
 * This file now owns nothing but the CLOCK. Every judgement — is that a strike, did
 * he get it, how far did it go, who scored, is the half over — is `core.js`, called
 * in the same order `tools/soak.mjs` calls it:
 *
 *      core.beginPitch(p)                        the pitch that was actually thrown
 *      core.cpuSwing(p)  |  a human press        who is at bat decides which
 *      core.resolveSwing(errMs) | core.resolveNoSwing()
 *      core.checkHalf()
 *
 * so the game a player sees and the game the soak validates are the same game, run
 * off the same PRNG. The only thing this file adds on the human side is how a button
 * press becomes `errMs`, which is the batting piece's job (`src/game/batting.js`) and
 * is input interpretation, not a rule.
 *
 * ── phases ──────────────────────────────────────────────────────────────────
 *   wind_up   the pitcher's theatre (pitching slot), preceded by a beat
 *   pitch     ball in the air, ONE BOUNCE off the block, swing window live
 *   in_play   the verdict is already decided; the ball is flying to prove it
 *   over      somebody's mother has won
 *
 * ── who is at bat ───────────────────────────────────────────────────────────
 * The core's `userSide` is 1 — the gang bat last, the way the home side always has.
 * In the other half the CPU bats itself through `core.cpuSwing`, which is bit for bit
 * the soak's batter. A human press is honoured on either side, because the harness
 * and the scenarios press whenever they please and refusing them helps nobody.
 */

const P = T.play;

/** Zero a match's state without touching lineups, positions or roster (team select owns those). */
function resetMatch(c) {
  c.inning = 1;
  c.half = HALF.TOP;
  c.outs = 0; c.balls = 0; c.strikes = 0;
  c.score = [0, 0];
  c.bases = ['', '', ''];
  c.batIdx = [0, 0];
  c.gameOver = false;
  c.finalNote = '';
  c.faced = [{}, {}];
  c.pendingPitch = {};
  c.pendingThrow = {};
  return c;
}

/** Which of the core's three hop families a thrown pitch belongs to, when nobody better says. */
const FALLBACK_HOP = { heat: 'fast', skip: 'fast', slow: 'spinner', wobble: 'spinner', loft: 'drop', easy: 'drop' };

/** What the block yells for a given play. The announcer piece may say it better. */
function detailOf(ev) {
  if (ev.window) return 'THROUGH THE WINDOW';
  if (ev.result === 'hr') return `${ev.sewers} SEWER${ev.sewers > 1 ? 'S' : ''}`;
  if (ev.fireEscape) return 'off the fire escape';
  if (ev.flivver) return 'off the flivver';
  if (ev.result === 'double') return 'in for two';
  if (ev.result === 'single') return 'a clean single';
  return ev.result || 'a hit';
}

export class Sim {
  constructor() {
    this.core = liveMatch;
    this.state = newGame();
    this.ball = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), spin: new THREE.Vector3(), live: false, inFlight: false };
    this.timer = 0;
    this.beat = 0;              // the pause between pitches, before the ritual starts
    this.tailT = 0;             // the ball still travelling to the mitt after a taken pitch
    this.freeze = 0;            // hitstop: the ball stops, the block does not
    this.swingAt = -1;          // the press, in seconds since release (-1 = nobody swung)
    this.swingKind = 'normal';
    this.jumpedAt = -1;         // a press before the window opened — he is committed and wrong
    this.cpuAt = -1;            // when the CPU kid's hands come round
    this.cpuErrMs = 0;
    this.pressBy = '';          // 'human' | 'cpu'
    this.lastErrMs = null;
    this.pitchT = 0;
    this.playT = 0;
    this.pitch = null;          // the pitching piece's solved trajectory
    this.hop = null;            // the batting piece's hop plan for it
    this.pitchTarget = new THREE.Vector3(0, 2.6, T.street.plateZ);
    this.pitchKind = 'heat';
    this.corePitch = null;
    this.lastContact = null;
    this.lastPlay = null;
    this.pendingEv = null;
    this.lastEv = null;
    this.windupRate = 1;        // >1 rushes the pitcher's theatre (scenarios only)
  }

  // ── setup ─────────────────────────────────────────────────────────────────
  reset(seed = 1920) {
    rng.reset(seed);
    resetMatch(this.core);
    this.core.rng = rng;                 // one PRNG for the whole app: same seed, same ball game
    this.timer = 0; this.beat = 0; this.tailT = 0; this.freeze = 0;
    this.pitchT = 0; this.playT = 0;
    this.swingAt = -1; this.jumpedAt = -1; this.cpuAt = -1; this.cpuErrMs = 0; this.pressBy = '';
    this.pitch = null; this.hop = null; this.corePitch = null;
    this.lastContact = null; this.lastPlay = null; this.pendingEv = null; this.lastEv = null;
    this.lastErrMs = null;
    this.state = newGame();
    this.ball.live = false; this.ball.inFlight = false;
    this.ball.pos.set(0, T.pitch.releaseHeight, T.street.moundZ);
    this.ball.vel.set(0, 0, 0);
    this.ball.spin.set(0, 0, 0);
    gameplay.batting?.onReset?.(this);
    this.syncState();
    this.beginAtBat();
  }

  /** The live pitch's crossing time. Everything that animates to contact reads this. */
  get timeToPlate() {
    if (this.pitch && this.pitch.flight > 0) return this.pitch.flight;
    return (T.street.moundZ - T.street.plateZ) / T.pitch.speed;
  }

  get batter() { return this.state.batterIdx; }
  get batterId() { return this.core.batterId(); }
  humanBatting() { return this.core.humanBatting(); }

  /** The swing window for the live pitch, in seconds since release. */
  swingWindow() {
    const h = this.hop;
    if (h) return { open: h.windowOpen, close: h.windowClose, ideal: h.idealPress };
    const ideal = this.timeToPlate - 0.05;
    return { open: ideal - P.swingEarly, close: ideal + P.swingLate, ideal };
  }

  /** True while a press would be accepted. Nothing on screen leaks this — see batting.js. */
  windowLive() {
    if (this.state.phase !== 'pitch') return false;
    const w = this.swingWindow();
    return this.pitchT >= w.open && this.pitchT <= w.close;
  }

  /** Put the human's side at the plate. Scenarios use it; the game never needs to. */
  setHumanAtBat() {
    if (this.core.humanBatting()) return;
    this.core.half = this.core.userSide === 0 ? HALF.TOP : HALF.BOT;
    this.syncState();
  }

  // ── mirror the core into the shape the HUD and the character piece read ───
  syncState() {
    const c = this.core, s = this.state;
    s.inning = c.inning;
    s.half = c.half === HALF.TOP ? 'top' : 'bottom';
    s.outs = c.outs; s.balls = c.balls; s.strikes = c.strikes;
    s.score.away = c.score[0]; s.score.home = c.score[1];
    s.bases = [c.bases[0] || null, c.bases[1] || null, c.bases[2] || null];
    const side = c.battingSide();
    const order = c.lineups[side] || [];
    s.batterIdx = order.length ? c.batIdx[side] % order.length : 0;
  }

  // ── flow ──────────────────────────────────────────────────────────────────
  beginAtBat(beat = 0) {
    if (this.core.gameOver) return this.finish();
    this.state.phase = 'wind_up';
    this.swingAt = -1; this.jumpedAt = -1; this.cpuAt = -1; this.cpuErrMs = 0; this.pressBy = '';
    this.pitchT = 0;
    this.pitch = null; this.hop = null; this.corePitch = null;
    this.pendingEv = null;
    this.ball.inFlight = false;
    this.beat = beat;
    this.syncState();
    bus.emit('atbat:begin', {
      batter: this.state.batterIdx,
      who: this.batterId,
      human: this.humanBatting(),
      count: { balls: this.state.balls, strikes: this.state.strikes },
    });
    if (beat <= 0) this.startWindup();
    return null;
  }

  startWindup() {
    this.ball.live = false;
    this.tailT = 0;
    slot('pitching', 'beginWindup', defaults.beginWindup)(this);
    if (this.windupRate > 1) this.timer /= this.windupRate;
  }

  throwPitch() {
    this.state.phase = 'pitch';
    this.pitchT = 0;
    this.ball.live = true; this.ball.inFlight = false;
    slot('pitching', 'release', defaults.release)(this);

    // The pitch the RULES see. Type, lane and intent come off the trajectory that was
    // actually thrown; quality is the core's own draw, off the core's own PRNG, in the
    // same order tools/soak.mjs draws it.
    const hop = gameplay.batting?.planHop?.(this) ?? null;
    this.hop = hop;
    const cross = this.pitch ? this.pitch.cross : this.pitchTarget;
    const lane = cross.x < -0.55 ? -1 : cross.x > 0.55 ? 1 : 0;
    const type = hop ? hop.type : (FALLBACK_HOP[this.pitchKind] || PITCH_TYPES[0]);
    const aimStrike = this.pitch ? !!this.pitch.strike
      : (Math.abs(cross.x) < 1.1 && cross.y > 1.9 && cross.y < 3.3);
    this.corePitch = this.core.beginPitch({ lane, type, quality: this.core.pitchQuality(), aimStrike });

    // The CPU kid decides now and his hands come round later, so the swing you SEE is
    // the swing the rules resolved.
    if (!this.humanBatting()) {
      const sw = this.core.cpuSwing(this.corePitch);
      if (sw.swing) {
        this.cpuErrMs = sw.errMs;
        const w = this.swingWindow();
        this.cpuAt = THREE.MathUtils.clamp(w.ideal + sw.errMs / 1000, w.open, w.close);
      }
    }

    bus.emit('pitch:thrown', {
      kind: this.pitchKind,
      target: cross.clone(),
      hop: hop ? { type: hop.type, at: +hop.tBounce.toFixed(3), read: hop.tb, crossY: +hop.yCross.toFixed(2) } : null,
      lane, aimStrike, quality: +this.corePitch.quality.toFixed(2),
      human: this.humanBatting(),
    });
  }

  finish() {
    if (this.state.phase === 'over') return null;
    this.state.phase = 'over';
    this.ball.live = false; this.ball.inFlight = false;
    this.syncState();
    bus.emit('game:over', { score: { ...this.state.score }, note: this.core.finalNote, text: this.core.winnerText() });
    return null;
  }

  // ── input ─────────────────────────────────────────────────────────────────
  /**
   * A press. `swing()` is the whole input surface — keyboard, mouse and touch all land
   * here (src/game/batting.js binds them; main.js binds Space and the canvas).
   */
  swing(kind = 'normal') {
    if (this.state.phase !== 'pitch') return false;
    if (this.swingAt >= 0 || this.jumpedAt >= 0) return false;
    const w = this.swingWindow();
    this.swingKind = kind;
    if (this.pitchT < w.open) {
      // He jumped. The stick is already coming and the ball has not got here — that is a
      // swing and a miss with extra steps, and it is why mashing does not work.
      this.jumpedAt = this.pitchT;
      gameplay.batting?.onSwingInput?.(this, kind, true);
      bus.emit('bat:swing', { kind: 'jump', at: this.pitchT, early: +(w.open - this.pitchT).toFixed(3), human: true });
      bus.emit('bat:jump', { early: +(w.open - this.pitchT).toFixed(3), who: this.batterId });
      return false;
    }
    if (this.pitchT > w.close) return false;
    this.swingAt = this.pitchT;
    this.pressBy = 'human';
    gameplay.batting?.onSwingInput?.(this, kind, false);
    bus.emit('bat:swing', {
      kind, at: this.pitchT, human: true,
      sinceBounce: this.hop ? +(this.pitchT - this.hop.tBounce).toFixed(3) : null,
      windowT: +((this.pitchT - w.open) / Math.max(1e-4, w.close - w.open)).toFixed(3),
    });
    return true;
  }

  // ── resolving one pitch ───────────────────────────────────────────────────
  resolvePitch() {
    const c = this.core;
    let ev;
    if (this.swingAt >= 0) {
      const errMs = this.pressBy === 'human'
        ? (gameplay.batting?.errMsFor?.(this, this.swingAt) ?? (this.swingAt - this.swingWindow().ideal) * 1000)
        : this.cpuErrMs;
      this.lastErrMs = errMs;
      ev = c.resolveSwing(errMs);
    } else if (this.jumpedAt >= 0) {
      const errMs = (this.jumpedAt - this.swingWindow().ideal) * 1000;
      this.lastErrMs = errMs;
      ev = c.resolveSwing(errMs);
    } else {
      this.lastErrMs = null;
      ev = c.resolveNoSwing();
    }
    if (c.pendingThrow.play) c.autoThrow();     // no human fielding piece yet: take the sure one
    this.lastEv = ev;
    gameplay.batting?.onVerdict?.(this, ev);
    return this.handle(ev);
  }

  /**
   * One resolved pitch, announced. The core has already moved everybody; this turns its
   * event into the bus traffic the rest of the game was built against.
   */
  handle(ev) {
    const before = { ...this.state.score };

    if (ev.kind === 'in_play') return this.putInPlay(ev);

    this.syncState();
    switch (ev.kind) {
      case 'strike':
        bus.emit('strike', { kind: 'looking', count: ev.count.s });
        break;
      case 'whiff':
        bus.emit('strike', { kind: 'swinging', count: ev.count.s });
        break;
      case 'foul':
        bus.emit('strike', { kind: 'foul', count: ev.count.s });
        break;
      case 'ball':
        bus.emit('ball', { count: ev.count.b });
        break;
      case 'strikeout':
        bus.emit('strike', { kind: 'swinging', count: ev.count.s });
        bus.emit('out', { kind: 'strikeout', outs: this.state.outs, who: ev.snap ? ev.snap.batter : '' });
        break;
      case 'walk':
        bus.emit('ball', { count: ev.count.b });
        bus.emit('walk', { who: ev.snap ? ev.snap.batter : '' });
        bus.emit('hit', { bases: 1, kind: 'walk' });
        break;
      default:
        break;
    }
    this.scoreDiff(before);
    return this.afterEvent(ev);
  }

  /** Runs post when the runner touches, not when the rule fires. One 'run' per run. */
  scoreDiff(before) {
    const s = this.state;
    for (const team of ['away', 'home']) {
      for (let i = before[team]; i < s.score[team]; i++) {
        bus.emit('run', { team, score: { ...s.score } });
      }
    }
  }

  /** Half-inning bookkeeping, then the next pitch after a beat the moment deserves. */
  afterEvent(ev) {
    const h = this.core.checkHalf();
    if (h.changed) {
      this.syncState();
      bus.emit('half:end', { inning: this.state.inning, half: this.state.half });
    }
    if (h.cheese) bus.emit('street:cheese', { seconds: h.cheeseLen });
    if (h.over || this.core.gameOver) return this.finish();
    this.syncState();

    const beat = h.cheese ? h.cheeseLen
      : ev.kind === 'in_play' ? 1.05
      : (ev.kind === 'strikeout' || ev.kind === 'walk') ? 0.85
      : 0.34;
    this.beginAtBat(beat);
    return ev;
  }

  // ── the ball in play ──────────────────────────────────────────────────────
  /**
   * The verdict is already in. The flight is how the block finds out: carry, lane and
   * loft off the core's own play, turned into a launch by the batting piece.
   */
  putInPlay(ev) {
    const hit = gameplay.batting?.launch?.(this, ev)
      ?? { quality: ev.quality ?? 0.5, power: 60, angleDeg: 26, sprayRad: 0, kind: 'square' };
    this.lastContact = hit;
    this.lastPlay = ev;
    this.pendingEv = ev;
    this.ball.inFlight = true;
    this.ball.live = true;
    this.state.phase = 'in_play';
    this.playT = 0;
    this.freeze = hit.hitstop ?? 0;
    if (this.freeze > 0) bus.emit('bat:hitstop', { seconds: this.freeze, quality: hit.quality });
    bus.emit('bat:contact', hit);
    gameplay.fielding?.onBallInPlay?.(this, hit);
    gameplay.baserunning?.onContact?.(this);
    return ev;
  }

  /** The ball has come to rest (or somebody caught it). Announce what the core decided. */
  announcePlay() {
    const ev = this.pendingEv;
    this.pendingEv = null;
    this.ball.inFlight = false;
    if (!ev) {                              // a scenario threw a ball with no at-bat behind it
      this.state.phase = 'wind_up';
      this.beat = 0.6;
      return null;
    }
    const before = { ...this.state.score };
    this.syncState();
    this.state.lastEvent = ev.result || ev.kind;

    if (ev.window) bus.emit('street:window', { batter: ev.batter, lane: ev.lane, carry: ev.carry });
    if (ev.sewers) bus.emit('street:sewers', { batter: ev.batter, sewers: ev.sewers, window: !!ev.window });
    if (ev.fireEscape) bus.emit('street:fire_escape', { batter: ev.batter, lane: ev.lane });
    if (ev.flivver) bus.emit('street:flivver', { batter: ev.batter, lane: ev.lane });

    if (ev.result && ev.result.startsWith('out')) {
      bus.emit('out', { kind: ev.result, outs: this.state.outs, who: ev.batter, fielder: ev.fielder });
    } else if (ev.bases > 0) {
      bus.emit('hit', {
        bases: ev.bases, kind: ev.result, who: ev.batter,
        sewers: ev.sewers || 0, window: !!ev.window, fireEscape: !!ev.fireEscape, flivver: !!ev.flivver,
        detail: detailOf(ev),
      });
    }
    this.scoreDiff(before);
    return this.afterEvent(ev);
  }

  // ── tick ──────────────────────────────────────────────────────────────────
  update(dt) {
    const s = this.state;
    if (s.phase === 'over' || s.phase === 'idle') return;

    if (this.freeze > 0) {                  // hitstop: the ball is nailed to the air, briefly
      this.freeze -= dt;
      gameplay.batting?.updateFx?.(dt, this);
      return;
    }

    if (s.phase === 'wind_up') {
      if (this.tailT > 0) this.flyTail(dt);
      gameplay.batting?.updateFx?.(dt, this);
      if (this.beat > 0) {
        this.beat -= dt;
        if (this.beat <= 0) this.startWindup();
        return;
      }
      if (slot('pitching', 'updateWindup', defaults.updateWindup)(dt * this.windupRate, this)) this.throwPitch();
      return;
    }

    if (s.phase === 'pitch') {
      this.pitchT += dt;
      slot('pitching', 'updatePitch', defaults.updatePitch)(dt, this);
      gameplay.batting?.shapeFlight?.(dt, this);       // the one bounce off the block
      gameplay.batting?.updateSwing?.(dt, this);
      gameplay.batting?.updateFx?.(dt, this);
      const w = this.swingWindow();
      if (this.cpuAt >= 0 && this.swingAt < 0 && this.jumpedAt < 0 && this.pitchT >= this.cpuAt) {
        this.swingAt = this.cpuAt;
        this.pressBy = 'cpu';
        gameplay.batting?.onSwingInput?.(this, 'normal', false);
        bus.emit('bat:swing', {
          kind: 'normal', at: this.cpuAt, human: false,
          sinceBounce: this.hop ? +(this.cpuAt - this.hop.tBounce).toFixed(3) : null,
        });
        return;
      }
      const due = this.swingAt >= 0 ? this.swingAt + 0.05
        : this.jumpedAt >= 0 ? Math.min(w.close, this.jumpedAt + 0.05)
        : w.close;
      if (this.pitchT >= due) {
        this.tailT = this.swingAt >= 0 ? 0 : 0.30;     // a taken pitch still has to reach the mitt
        this.resolvePitch();
      }
      return;
    }

    if (s.phase === 'in_play') {
      this.playT += dt;
      gameplay.batting?.updateFx?.(dt, this);
      const step = slot('ballphysics', 'step', defaults.stepBall);
      const ev = step(dt, this.ball, this);
      if (ev?.bounced) bus.emit('ball:bounce', { pos: this.ball.pos.clone(), surface: ev.surface || 'street' });
      if (ev?.carom) bus.emit('ball:carom', { pos: this.ball.pos.clone(), surface: ev.carom });

      const fielded = gameplay.fielding?.update?.(dt, this);
      if (fielded) return this.announcePlay();

      const settled = gameplay.ballphysics?.settled?.(this.ball, this) ?? this.playT > 2.4;
      if (settled) return this.announcePlay();
    }
  }

  /** After a taken pitch the ball keeps going into the mitt. Cheap, and the eye wants it. */
  flyTail(dt) {
    this.tailT -= dt;
    this.ball.live = this.tailT > 0;
    if (!this.pitch || !this.pitch.path) return;
    this.pitchT += dt;
    this.pitch.path(Math.min(this.pitchT, this.pitch.flight), this.ball.pos);
    gameplay.batting?.shapeFlight?.(dt, this, true);
    this.ball.pos.z -= Math.max(0, this.pitchT - this.pitch.flight) * 34;
  }
}

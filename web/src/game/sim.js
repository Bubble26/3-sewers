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
    /**
     * A fielding piece that wants to put the human throw prompt on screen sets this
     * true; the sim then leaves `core.pendingThrow` alone through the flight and only
     * settles it (via `autoThrow`) if the play ends with nobody having answered.
     */
    this.deferThrow = false;
    /**
     * SCENARIOS ONLY. Seconds either side of the ideal press at which the sim presses
     * for itself, so a deterministic still or film strip can be taken of an early, an
     * on-time and a late swing without the harness having to guess when the ball will
     * arrive. Never set during play; the game reads a human's hands or `core.cpuSwing`.
     */
    this.autoPress = null;
    /**
     * SCENARIOS ONLY. Seconds after `reset()` at which the pitch must leave the hand.
     * The wind-up is a ritual owned by the pitching piece and its length is that piece's
     * business, so a scenario that says "advance 0.9 s, then swing" is written against a
     * number it does not control — which is exactly how `contact` came to screenshot a
     * called ball. When this is set the sim reads `sim.timer` (the pitching contract:
     * seconds of theatre still to run) every tick and rates the wind-up so release lands
     * on the beat asked for, whatever the ritual's length happens to be this week. It is
     * cleared the moment the ball is released, so only the first pitch is steered.
     */
    this.releaseAt = null;
    this.simT = 0;              // seconds since reset — the clock `releaseAt` is measured on
    this.__forcePlay = null;    // the decided play, handed to the fielding slot at the crack
    this.shown = { away: 0, home: 0 };   // runs already announced on the bus
  }

  // ── setup ─────────────────────────────────────────────────────────────────
  reset(seed = 1920) {
    rng.reset(seed);
    resetMatch(this.core);
    this.core.rng = rng;                 // one PRNG for the whole app: same seed, same ball game
    this.timer = 0; this.beat = 0; this.tailT = 0; this.freeze = 0;
    this.pitchT = 0; this.playT = 0; this.simT = 0;
    this.swingAt = -1; this.jumpedAt = -1; this.cpuAt = -1; this.cpuErrMs = 0; this.pressBy = '';
    this.pitch = null; this.hop = null; this.corePitch = null;
    this.lastContact = null; this.lastPlay = null; this.pendingEv = null; this.lastEv = null;
    this.lastErrMs = null;
    this.shown = { away: 0, home: 0 };
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
    if (this.hop) return this.hop.flight;          // the hop owns the tempo (batting.js)
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

  /**
   * Put the human's side at the plate. A reset always opens on the top half, so this is
   * simply "the player has the visitors this time". Scenarios use it so a shot of the
   * batting game is a shot of the batting game; the running game never needs it and
   * keeps the ported default, which is that the gang bat last.
   */
  setHumanAtBat() {
    this.core.userSide = this.core.battingSide();
    this.syncState();
  }

  /** Same thing, but valid to call BEFORE a reset (scenario hooks run before setup). */
  humanBatsFirst() { this.core.userSide = HALF.TOP; }

  // ── mirror the core into the shape the HUD and the character piece read ───
  /**
   * `full = false` leaves the SCOREBOARD alone — runs and outs post when the play is
   * announced, not at the crack, because a scoreboard that knows before the runner has
   * touched the bag is a scoreboard nobody believes.
   */
  syncState(full = true) {
    const c = this.core, s = this.state;
    s.inning = c.inning;
    s.half = c.half === HALF.TOP ? 'top' : 'bottom';
    s.balls = c.balls; s.strikes = c.strikes;
    if (full) {
      s.outs = c.outs;
      s.score.away = c.score[0]; s.score.home = c.score[1];
    }
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
    if (this.releaseAt !== null) this.windupRate = 1;    // re-derived every tick, below
    else if (this.windupRate > 1) this.timer /= this.windupRate;
  }

  throwPitch() {
    this.state.phase = 'pitch';
    this.releaseAt = null;          // it steers the first pitch only; the rest run at speed
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
      // SCENARIOS ONLY. With a press already booked (`autoPress`), a stray early press —
      // a scenario that says "advance 0.9 s, then swing" against a wind-up whose length it
      // does not own — is dropped rather than charged as a jump, and the booked press
      // still lands. Never true in play: `autoPress` is null the whole time a human plays.
      if (this.autoPress !== null) return false;
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
    // A close grounder can leave the core waiting on a throw. Unless a fielding piece
    // has claimed the prompt (`sim.deferThrow`), take the sure one now so the verdict
    // handed downstream is complete.
    if (c.pendingThrow.play && !this.deferThrow) c.autoThrow();
    this.lastEv = ev;
    gameplay.batting?.onVerdict?.(this, ev);
    return this.handle(ev);
  }

  /**
   * One resolved pitch, announced. The core has already moved everybody; this turns its
   * event into the bus traffic the rest of the game was built against.
   */
  handle(ev) {
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
    this.postRuns();
    return this.afterEvent(ev);
  }

  /**
   * Runs post when the play is announced, not when the rule fires, and one 'run' goes
   * out per run. Measured against what has actually been ANNOUNCED rather than against
   * the last frame's state, so a mid-play scoreboard sync can never swallow one.
   */
  postRuns() {
    const s = this.state;
    for (const team of ['away', 'home']) {
      while (this.shown[team] < s.score[team]) {
        this.shown[team] += 1;
        bus.emit('run', { team, score: { ...s.score } });
      }
      this.shown[team] = s.score[team];
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
    this.syncState(false);          // bases and batter now; runs and outs when it lands
    this.freeze = hit.hitstop ?? 0;
    if (this.freeze > 0) bus.emit('bat:hitstop', { seconds: this.freeze, quality: hit.quality });
    bus.emit('bat:contact', hit);
    // THE VERDICT IS ALREADY TRUE. src/game/fielding.js choreographs a play toward a
    // known ending and takes it from `sim.__forcePlay`; handing it the core's own play
    // is what stops it re-judging the same batted ball through core.js's `rules` bridge,
    // which would draw fresh randomness AND write the sim's lagging state back over the
    // core. One ball, one verdict, one rulebook.
    this.__forcePlay = ev;
    gameplay.fielding?.onBallInPlay?.(this, hit);
    this.__forcePlay = null;
    gameplay.baserunning?.onContact?.(this);
    return ev;
  }

  /** The ball has come to rest (or somebody caught it). Announce what the core decided. */
  announcePlay() {
    const ev = this.pendingEv;
    this.pendingEv = null;
    this.ball.inFlight = false;
    if (this.core.pendingThrow.play) this.core.autoThrow();   // nobody answered the prompt
    if (!ev) {                              // a scenario threw a ball with no at-bat behind it
      this.state.phase = 'wind_up';
      this.beat = 0.6;
      return null;
    }
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
    this.postRuns();
    return this.afterEvent(ev);
  }

  // ── tick ──────────────────────────────────────────────────────────────────
  update(dt) {
    const s = this.state;
    if (s.phase === 'over' || s.phase === 'idle') return;
    this.simT += dt;

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
      // A scenario that has booked a release time rates the ritual to land on it. `timer`
      // is the pitching piece's own contract — seconds of theatre left — so this converges
      // on the asked-for beat however long that piece's wind-up is.
      if (this.releaseAt !== null) {
        const rem = this.releaseAt - this.simT;
        this.windupRate = rem > dt ? THREE.MathUtils.clamp(this.timer / rem, 1, 90) : 90;
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
      if (this.autoPress !== null && this.swingAt < 0 && this.jumpedAt < 0
          && this.pitchT >= THREE.MathUtils.clamp(w.ideal + this.autoPress, w.open + 0.004, w.close - 0.004)) {
        this.swing('normal');
        return;
      }
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
    if (!this.hop) return;
    this.pitchT += dt;
    gameplay.batting?.shapeFlight?.(dt, this, true);
    this.ball.pos.z -= Math.max(0, this.pitchT - this.hop.flight) * 30;
    this.ball.pos.y = Math.max(0.9, this.ball.pos.y);
  }
}

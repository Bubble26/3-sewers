/**
 * core.js — THE RULES OF THE BLOCK.
 * ============================================================================
 * A port, not an invention. Every rule in here came from a finished, soak-tested
 * stickball engine written in GDScript for the project `3-sewers`, which lives in
 * docs/godot-reference/match_core.gd. Read docs/PORT-SPEC.md for why we ported it
 * instead of writing our own, then read that file next to this one: the method
 * names below are deliberately one-to-one with theirs so the two can be diffed by
 * a human in an afternoon.
 *
 * What is ported: the pitch, the swing and its perfect/good/weak thresholds, the
 * foul-off, the in-play model (carry / lane / loft), the smashed window, sewer-graded
 * home runs, the fire-escape ground-rule double, the flivver carom, the race to
 * first, the human throw prompt, walks, strikeouts, the half-inning and game flow,
 * and all twelve roster quirks.
 *
 * What is NOT ported: their renderer, their palette, their field coordinates and
 * their roster. Our kids are in src/chars/roster.js and they are better written.
 *
 * ── house rules for anyone editing this file ────────────────────────────────
 * 1. PURE LOGIC. No THREE, no DOM, no rendering, no timers. It has to run in plain
 *    node for tools/soak.mjs, which is what makes the soak test possible at all.
 * 2. EVERY random draw goes through an RNG from src/core/rng.js, in the same order
 *    as the source. Determinism is the whole point: same seed, same ball game.
 * 3. EVERY constant lives in T.play in src/core/tuning.js, with the measurement
 *    comments that justify it. Read those comments before you retune anything.
 * 4. If you change a rule, run `node tools/soak.mjs`. It plays their twelve kids
 *    through these rules as a control — that run has to stay on their published
 *    13.8 runs a game, 3.6 sewer shots and a window about every 13 games — and then
 *    plays our sixteen, which score about two runs a game less because our block is
 *    deeper and its hitting is split on purpose. Move the control and you have
 *    broken the port; move only the block and you have changed the game.
 */

import { RNG, rng as sharedRng } from '../core/rng.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { provide, gameplay } from './plugins.js';
import { ROSTER, playRoster, pickValue, CAPTAINS } from '../chars/roster.js';

const P = T.play;

export const HALF = { TOP: 0, BOT: 1 };

/* ============================================================================
   Small maths the port needs. Godot has these built in; we do not.
   ========================================================================= */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Godot's `rng.randfn` — a normal draw, Box–Muller, off our own PRNG. */
export function gauss(r, mean, sd) {
  let u = 0;
  while (u === 0) u = r.next();          // log(0) is a bad afternoon
  const v = r.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Descending sort by a scoring function, stable (Godot's is not; ours is kinder). */
const byDesc = (ids, score) => [...ids].sort((a, b) => score(b) - score(a));

/* ============================================================================
   THE ONE BOUNCE
   ----------------------------------------------------------------------------
   Every pitch in stickball bounces once off the cobbles before the plate, and
   reading that hop is the batting game. The rules core resolves a swing from a
   timing error in milliseconds; these helpers are how a press on a real clock
   becomes that number, so the pitching piece, the batting piece and the soak
   test all agree on when "now" was.

   The constants are in T.play (pitchTimes / pitchTB), and the arithmetic that
   recovers their published table is:

     hand -> plate     = pitchTimes[type]          0.52 / 0.58 / 0.62
     bounce -> plate   = pitchTB[type]             0.30 / 0.42 / 0.58
     hand -> bounce    = the difference            0.22 / 0.16 / 0.04
     ideal press       = 50ms before it crosses
     press after bounce= pitchTB - 0.05            0.25 / 0.37 / 0.53  <- their table
     the gaps          = 120ms and 160ms           <- the measurement that matters

   Those two gaps are the fix for the defect recorded in T.play: a blind fixed
   rhythm used to beat reading the pitch, because the three ideal presses sat
   inside one contact window. Narrow the gaps and the mechanic the game is named
   after becomes decoration again.

   One oddity, flagged rather than silently fixed: read this way the drop bounces
   40ms after release (0.62 - 0.58), which sits badly next to "lobs high, falling".
   The other reading — pitchTB as release-to-bounce — puts the gaps at 60ms and
   120ms and contradicts their own published table, so it is not the reading that
   survives. Whoever builds the actual flight should re-measure against the table,
   not against the constant, and say what they find here.
   ========================================================================= */

export const PITCH_TYPES = ['fast', 'spinner', 'drop'];
/** The six posts a stickball side fields (their POS_LIST). Our stage stages eight. */
export const POSITIONS = P.positions;
const PRESS_LEAD = 0.05;                 // a press lands 50ms before the ball crosses

export function pitchTiming(type) {
  const k = P.pitchTimes[type] ? type : 'fast';
  const toPlate = P.pitchTimes[k];
  const bounceToPlate = P.pitchTB[k];
  return {
    type: k,
    toPlate,                                       // release -> plate
    bounceAt: toPlate - bounceToPlate,             // release -> the one bounce
    bounceToPlate,                                 // the read window
    idealPress: toPlate - PRESS_LEAD,              // release -> the perfect tap
    pressAfterBounce: bounceToPlate - PRESS_LEAD,  // 0.25 / 0.37 / 0.53
    rest: P.bounceRest[type],                      // how much comes back off the stone
    kick: P.spinKick[type],                        // sideways off the hop
    windowOpens: toPlate - PRESS_LEAD - P.swingEarly,
    windowCloses: toPlate - PRESS_LEAD + P.swingLate,
  };
}

/** Swing timing error in ms, the number the rules core actually resolves. */
export function errMsForPress(type, pressT) {
  return (pressT - pitchTiming(type).idealPress) * 1000;
}

/**
 * The separability check, kept executable so a retune cannot quietly undo the
 * measurement. Returns the gaps between the three ideal presses in ms, next to
 * the width of the perfect-contact window they have to beat.
 */
export function pressGaps(con = 6) {
  const t = PITCH_TYPES.map((k) => pitchTiming(k).pressAfterBounce * 1000);
  return {
    presses: t,
    gaps: [t[1] - t[0], t[2] - t[1]],
    perfectWindowMs: 2 * (P.contact.perfectBase + con * P.contact.perfectPerCon),
  };
}

/* ============================================================================
   MatchCore — the game itself
   ========================================================================= */

export class MatchCore {
  constructor({ rng = null } = {}) {
    this.rng = rng || sharedRng;   // the live game shares the app's PRNG; the soak seeds its own
    this.roster = {};
    this.lineups = [[], []];       // [away ids, home ids]
    this.positions = [{}, {}];     // side -> { pos: id }
    this.userSide = 1;             // the human bats the bottom half, like the home side always did
    this.inningsTotal = P.innings;

    this.inning = 1;
    this.half = HALF.TOP;
    this.outs = 0;
    this.balls = 0;
    this.strikes = 0;
    this.score = [0, 0];
    this.bases = ['', '', ''];     // 1B, 2B, 3B — kid ids, '' is empty
    this.batIdx = [0, 0];
    this.gameOver = false;
    this.finalNote = '';
    this.faced = [{}, {}];         // pitching side -> { batter id: times seen }
    this.pendingPitch = {};
    this.pendingThrow = {};
  }

  /** setup(). `user` is 0 (away), 1 (home) or -1 for a CPU-vs-CPU game. */
  setup(away, home, rosterIn, user = 1, nInn = P.innings, seedV = 0) {
    this.roster = rosterIn;
    this.lineups = [away.slice(), home.slice()];
    this.userSide = user;
    this.inningsTotal = nInn;
    if (seedV !== 0) this.rng = new RNG(seedV);
    for (let side = 0; side < 2; side++) this.positions[side] = this.assignPositions(this.lineups[side]);
    return this;
  }

  /**
   * Who plays where. Best two arms take the manhole and the plate, best two gloves
   * take short and first, and the two quickest kids go up the street — which is
   * exactly how a side gets picked when nobody is writing anything down.
   */
  assignPositions(ids) {
    let pool = ids.slice();
    const out = {};
    pool = byDesc(pool, (id) => this.stat(id, 'ARM'));
    out.P = pool.shift();
    out.C = pool.shift();
    pool = byDesc(pool, (id) => this.stat(id, 'GLV'));
    out.SS = pool.shift();
    out['1B'] = pool.shift();
    pool = byDesc(pool, (id) => this.stat(id, 'SPD'));
    out.LF = pool.shift();
    out.RF = pool.shift();
    // Short sides happen on a real block: with fewer than six kids somebody covers two
    // spots and everybody shouts about which two. Their engine assumed six; ours does
    // not, because our team-select lets you play four a side if that is who showed up.
    let spare = 0;
    for (const pos of P.positions) if (!out[pos]) out[pos] = ids[spare++ % ids.length];
    return out;
  }

  /** _s(): a card value, with the one quirk that changes a card outright. */
  stat(id, key) {
    let v = Math.trunc(this.roster[id][key]);
    if (key === 'PWR' && this.roster[id].quirk === 'boughten') v += 1;   // store-bought lumber
    return v;
  }

  // ── state helpers ─────────────────────────────────────────────────────────
  battingSide() { return this.half === HALF.TOP ? 0 : 1; }
  fieldingSide() { return 1 - this.battingSide(); }
  humanBatting() { return this.battingSide() === this.userSide; }
  batterId() {
    const side = this.battingSide();
    return this.lineups[side][this.batIdx[side] % this.lineups[side].length];
  }
  pitcherId() { return this.positions[this.fieldingSide()].P; }
  catcherId() { return this.positions[this.fieldingSide()].C; }
  kidName(id) { return this.roster[id] ? this.roster[id].name : id; }
  quirkOf(id) { return this.roster[id] ? this.roster[id].quirk : 'none'; }

  snapshot() {
    return {
      inning: this.inning, half: this.half, outs: this.outs, balls: this.balls,
      strikes: this.strikes, score: this.score.slice(), bases: this.bases.slice(),
      batter: this.batterId(), pitcher: this.pitcherId(), over: this.gameOver,
      batSide: this.battingSide(),
    };
  }

  /** _con(): the eye the batter is actually swinging with, right now. */
  con(id) {
    let c = this.stat(id, 'CON');
    // Beans on the bag calls the count out loud and the whole side hits sharper.
    for (const b of this.bases) {
      if (b !== '' && b !== id && this.quirkOf(b) === 'on_house') c += P.contact.onHouseCon;
    }
    if (this.quirkOf(id) === 'eagle_eye' && this.strikes === 2) c += P.contact.eagleEyeCon;
    return c;
  }

  /** pitch_quality(): how much the pitch punishes a mistimed swing. */
  pitchQuality() {
    const q = P.quality;
    const p = this.pitcherId();
    let v = q.base + this.stat(p, 'ARM') * q.perArm;
    if (this.quirkOf(p) === 'spinner') v += q.spinner;
    if (this.quirkOf(this.catcherId()) === 'rifle') v += q.rifle;
    if (this.quirkOf(p) === 'southpaw') {
      const f = this.faced[this.fieldingSide()];
      if ((f[this.batterId()] || 0) === 0) v += q.southpawFirstLook;
    }
    return clamp(v + this.rng.range(-q.jitter, q.jitter), q.min, q.max);
  }

  // ── pitching ──────────────────────────────────────────────────────────────
  makeCpuPitch() {
    const lane = [-1, 0, 1][this.rng.int(0, 2)];
    const aimStrike = this.rng.next() < (this.strikes < 2 ? P.cpu.aimStrike : P.cpu.aimStrikeTwoStrikes);
    return {
      lane,
      type: PITCH_TYPES[this.rng.int(0, 2)],
      quality: this.pitchQuality(),
      aimStrike,
    };
  }

  beginPitch(p) {
    this.pendingPitch = p;
    const f = this.faced[this.fieldingSide()];
    const b = this.batterId();
    f[b] = (f[b] || 0) + 1;
    return p;
  }

  /** A CPU kid's decision and his timing error, in ms. */
  cpuSwing(p) {
    const c = this.con(this.batterId());
    const swingProb = p.aimStrike
      ? P.cpu.swingAtStrike
      : clamp(P.cpu.swingAtBallBase - c * P.cpu.swingAtBallPerCon, P.cpu.swingAtBallMin, P.cpu.swingAtBallMax);
    if (!(this.rng.next() < swingProb)) return { swing: false };
    const sigma = Math.max(P.cpu.sigmaFloor, P.cpu.sigmaBase - c * P.cpu.sigmaPerCon + p.quality * P.cpu.sigmaPerQuality);
    return { swing: true, errMs: gauss(this.rng, 0, sigma) };
  }

  /** He watched it go by. The ump is a kid on a stoop and misses one in ten. */
  resolveNoSwing() {
    const isStrike = this.pendingPitch.aimStrike && this.rng.next() < P.umpire.calledStrike;
    const ev = { kind: isStrike ? 'strike' : 'ball', swung: false };
    if (isStrike) this.strikes += 1; else this.balls += 1;
    return this.afterPitch(ev);
  }

  /**
   * He swung. `errMs` is how far off the ideal press he was — negative early,
   * positive late. Quality of the pitch scales the mistake: a good arm makes the
   * same error hurt more.
   */
  resolveSwing(errMs) {
    const K = P.contact;
    const b = this.batterId();
    const c = this.con(b);
    const q = this.pendingPitch.quality;
    const eff = Math.abs(errMs) * (K.effBase + K.effPerQuality * q);
    const perfectT = K.perfectBase + c * K.perfectPerCon;
    const goodT = K.goodBase + c * K.goodPerCon;
    const weakT = K.weakBase + c * K.weakPerCon;

    // Miss it entirely, or wave at a pitch that was never a strike.
    if (eff > weakT || (!this.pendingPitch.aimStrike && eff > goodT)) {
      this.strikes += 1;
      return this.afterPitch({ kind: 'whiff', swung: true });
    }

    let quality;
    if (eff <= perfectT) quality = this.rng.range(K.perfectQ[0], K.perfectQ[1]);
    else if (eff <= goodT) quality = this.rng.range(K.goodQ[0], K.goodQ[1]);
    else quality = this.rng.range(K.weakQ[0], K.weakQ[1]);

    // Weak contact fouls off — the at-bat that will not die.
    if (quality < 0.5 && this.rng.next() < K.foulChance) {
      if (this.strikes < 2) this.strikes += 1;
      return this.afterPitch({ kind: 'foul', swung: true });
    }
    return this.afterPitch(this.inPlay(b, quality, Math.sign(errMs)));
  }

  /** _after_pitch(): stamp the count on the event, then see if it ended the at-bat. */
  afterPitch(ev) {
    ev.count = { b: this.balls, s: this.strikes };
    if (ev.kind === 'whiff' || ev.kind === 'strike') {
      if (this.strikes >= P.strikesK) {
        ev.kind = 'strikeout';
        this.out();
        this.nextBatter();
      }
    } else if (ev.kind === 'ball') {
      if (this.balls >= P.ballsWalk) {
        ev.kind = 'walk';
        ev.moves = this.walkMoves();
        this.nextBatter();
      }
    }
    ev.snap = this.snapshot();
    return ev;
  }

  // ── the ball in play ──────────────────────────────────────────────────────
  /**
   * _in_play(). Split in two so the running game can ask for a verdict without the
   * bookkeeping (see the rules slot at the bottom of this file). Every random draw
   * happens in classifyInPlay, in the source's order; commitPlay only moves kids
   * around, so the split cannot change a single outcome.
   */
  inPlay(b, quality, pull) {
    const play = this.classifyInPlay(b, quality, pull);
    this.commitPlay(play);
    return play;
  }

  classifyInPlay(b, quality, pull) {
    const I = P.inplay;
    const S = P.streetRules;
    const pwr = this.stat(b, 'PWR');
    if (this.quirkOf(b) === 'wallop') quality = Math.max(quality, I.wallopFloor);

    let carry = clamp(
      quality * (I.carryBase + pwr * I.carryPerPwr) + this.rng.range(I.carryJitter[0], I.carryJitter[1]),
      I.carryMin, I.carryMax,
    );
    if (this.quirkOf(b) === 'three_sewers' && quality > I.threeSewersAt) carry += I.threeSewersBonus;

    const lane = clamp(
      pull * this.rng.range(I.lanePull[0], I.lanePull[1]) + this.rng.range(-I.laneJitter, I.laneJitter),
      -1.0, 1.0,
    );

    let loft = 'ground';
    if (quality > I.flyAt) loft = this.rng.next() < I.flyOdds ? 'fly' : 'line';
    else if (quality > I.midAt) {
      loft = this.rng.next() < I.midLineOdds ? 'line' : (this.rng.next() < I.midFlyOdds ? 'fly' : 'ground');
    }

    const play = {
      kind: 'in_play', batter: b, carry, lane, loft, quality,
      window: false, fireEscape: false, flivver: false, sewers: 0,
      result: '', fielder: '', runs: 0, moves: [], needsThrow: null,
      bases: 0, margin: 0,
    };

    // THE WINDOW. A deep pull-side fly puts one through Mrs. Kowalski's glass —
    // a home run you sprint away from, and the only one graded at three sewers
    // without anybody measuring it.
    if (loft === 'fly' && carry > S.windowCarry && lane < S.windowLane && this.rng.next() < S.windowOdds) {
      play.window = true;
      play.result = 'hr';
      play.sewers = 3;
      play.bases = 4;
      return play;
    }

    // Past the castings on the fly. Graded out loud, in sewers.
    if (loft !== 'ground' && carry >= S.sewerCarry) {
      let s = 1;
      if (carry >= S.sewerThree) s = 3;
      else if (carry >= S.sewerTwo) s = 2;
      const pos = lane < 0 ? 'LF' : 'RF';
      if (loft === 'fly' && s >= 1 && carry < S.sewerTwo && this.rng.next() < this.catchProb(pos)) {
        play.result = 'out_fly';
        play.fielder = pos;
        return play;
      }
      play.result = 'hr';
      play.sewers = s;
      play.bases = 4;
      return play;
    }

    // THE FIRE ESCAPE. It rattles down the ironwork rung by rung and the batter
    // is standing on second by the time it hits the areaway. Ground-rule double.
    if (loft === 'fly' && carry > S.fireEscapeCarry && Math.abs(lane) > S.fireEscapeLane
        && this.rng.next() < S.fireEscapeOdds) {
      play.fireEscape = true;
      play.result = 'double';
      play.bases = 2;
      return play;
    }

    // THE FLIVVER. Off the parked Ford's fender — live, and it goes somewhere silly.
    if (Math.abs(lane) > S.flivverLane && carry > S.flivverCarry && this.rng.next() < S.flivverOdds) {
      play.flivver = true;
    }

    const fpos = this.nearestFielder(carry, lane, loft);
    play.fielder = fpos;

    if (loft === 'fly') {
      if (this.rng.next() < this.catchProb(fpos)) { play.result = 'out_fly'; return play; }
      play.result = carry > P.gloves.flyDoubleCarry ? 'double' : 'single';
      play.bases = play.result === 'double' ? 2 : 1;
      return play;
    }

    if (loft === 'line') {
      if (this.rng.next() < this.catchProb(fpos) * P.gloves.lineCatchScale) { play.result = 'out_line'; return play; }
      const two = carry > P.gloves.lineDoubleCarry && this.rng.next() < P.gloves.lineDoubleOdds;
      play.result = two ? 'double' : 'single';
      play.bases = two ? 2 : 1;
      return play;
    }

    // A grounder is a footrace to the stoop. margin > 0 means the kid beat it.
    const R = P.race;
    const spd = this.stat(b, 'SPD');
    let margin = (spd * R.perSpd) - (carry * R.perCarry) - this.glvTeam() * R.perTeamGlv
      + this.rng.range(-R.jitter, R.jitter);
    if (this.quirkOf(b) === 'headfirst') margin += R.headfirst;
    play.margin = margin;

    // On a genuinely close one the human fielding side gets the call themselves.
    if (this.fieldingSide() === this.userSide && margin > R.promptLo && margin < R.promptHi) {
      play.needsThrow = { targets: this.throwTargets(), best: '1B', deadline: R.throwDeadline };
      return play;
    }
    if (margin < 0.0) { play.result = 'out_ground'; return play; }
    play.result = 'single';
    play.bases = 1;
    return play;
  }

  /** The bookkeeping half of _in_play(): outs, bases, runs. Draws no randomness itself. */
  commitPlay(play) {
    if (play.needsThrow) { this.pendingThrow = { play, margin: play.margin }; return play; }
    if (play.result.startsWith('out')) { this.out(); this.nextBatter(); return play; }
    if (play.bases > 0) this.applyHit(play, play.bases);
    return play;
  }

  // ── the throw the human makes ─────────────────────────────────────────────
  resolveThrow(choice) {
    if (!this.pendingThrow.play) return null;    // nothing was pending; nobody threw anything
    const play = this.pendingThrow.play;
    const margin = this.pendingThrow.margin;
    this.pendingThrow = {};
    play.needsThrow = null;
    if (choice === '1B' && margin < P.race.outAtFirst) {
      play.result = 'out_ground';
      play.thrown = '1B';
      this.out();
      this.nextBatter();
    } else if (choice === 'home' && this.bases[2] !== '' && margin < P.race.outAtHome) {
      play.result = 'out_home';
      play.thrown = 'home';
      const runnerOut = this.bases[2];
      this.bases[2] = '';
      this.out();
      play.moves = [{ id: runnerOut, from: 2, to: 3, out: true }];
      if (this.outs < 3) this.applyHit(play, 1);
    } else {
      play.result = 'single';
      play.thrown = choice;
      this.applyHit(play, 1);
    }
    play.snap = this.snapshot();
    return play;
  }

  /** Nobody threw it anywhere. Everybody is safe and somebody is getting yelled at. */
  throwTimeout() { return this.resolveThrow('none'); }

  /** What the fielding side is allowed to throw at, given who is standing where. */
  throwTargets() {
    const t = ['1B'];
    if (this.bases[2] !== '') t.push('home');
    if (this.bases[0] !== '') t.push('2B');
    return t;
  }

  /**
   * The CPU's version of the same call — ours, not theirs, because their sim never
   * had a CPU on the fielding side of a prompt. Cut the run off at the plate if it
   * is genuinely gettable, otherwise take the sure one at first.
   */
  autoThrow() {
    if (!this.pendingThrow.play) return null;
    const m = this.pendingThrow.margin;
    const choice = (this.bases[2] !== '' && m < P.race.outAtHome) ? 'home' : '1B';
    return this.resolveThrow(choice);
  }

  // ── gloves ────────────────────────────────────────────────────────────────
  nearestFielder(carry, lane, loft) {
    const F = P.gloves;
    if (carry > F.deepAt || loft === 'fly') return lane < 0 ? 'LF' : 'RF';
    if (lane < F.ssLane) return 'SS';
    if (lane > F.firstLane) return '1B';
    return carry < F.pitcherCarry ? 'P' : 'SS';
  }

  catchProb(pos) {
    const F = P.gloves;
    const id = this.positions[this.fieldingSide()][pos];
    let p = F.catchBase + this.stat(id, 'GLV') * F.catchPerGlv;
    if (this.teamHasQuirk(this.fieldingSide(), 'spit_shine')) p += F.spitShine;
    return clamp(p, F.catchMin, F.catchMax);
  }

  /** How good the infield is at cutting a grounder off, averaged over the three who try. */
  glvTeam() {
    let t = 0;
    for (const pos of ['1B', 'SS', 'P']) t += this.stat(this.positions[this.fieldingSide()][pos], 'GLV');
    return t / 3.0;
  }

  teamHasQuirk(side, q) {
    for (const id of this.lineups[side]) if (this.quirkOf(id) === q) return true;
    return false;
  }

  // ── advancement ───────────────────────────────────────────────────────────
  /**
   * _apply_hit(). "to": 0/1/2 are the bases, 3 is home. Lead runner first, so
   * nobody gets moved onto a bag that has not cleared yet.
   */
  applyHit(play, nBases, includeBatter = true) {
    const moves = play.moves || [];
    let runs = play.runs || 0;
    const side = this.battingSide();
    const b = play.batter;

    for (const i of [2, 1, 0]) {
      if (this.bases[i] === '') continue;
      const rid = this.bases[i];
      this.bases[i] = '';
      let dest = i + nBases;
      if (dest < 3 && this.stat(rid, 'SPD') >= P.run.stretchSpd && this.rng.next() < P.run.stretchOdds) {
        dest += 1;                        // the quick ones never stop at the bag
      }
      if (dest >= 3) { runs += 1; moves.push({ id: rid, from: i, to: 3 }); }
      else { this.bases[dest] = rid; moves.push({ id: rid, from: i, to: dest }); }
    }

    if (includeBatter) {
      let bd = nBases;
      if (play.result === 'hr') bd = 4;
      else if (this.quirkOf(b) === 'extra' && bd < 3 && this.rng.next() < P.run.extraOdds) {
        bd += 1;                          // she rounds it without looking and takes the next one
        play.stretched = true;
        if (bd === 2) play.result = 'double';
      }
      if (bd >= 4) { runs += 1; moves.push({ id: b, from: -1, to: 3 }); }
      else { this.bases[bd - 1] = b; moves.push({ id: b, from: -1, to: bd - 1 }); }
      this.nextBatter();
    }

    this.score[side] += runs;
    play.runs = runs;
    play.moves = moves;
    return play;
  }

  /** A walk pushes only what it has to. Ball four is not a hit and never was. */
  walkMoves() {
    const moves = [];
    const b = this.batterId();
    if (this.bases[0] !== '') {
      if (this.bases[1] !== '') {
        if (this.bases[2] !== '') {
          this.score[this.battingSide()] += 1;
          moves.push({ id: this.bases[2], from: 2, to: 3 });
        }
        this.bases[2] = this.bases[1];
        moves.push({ id: this.bases[1], from: 1, to: 2 });
      }
      this.bases[1] = this.bases[0];
      moves.push({ id: this.bases[0], from: 0, to: 1 });
    }
    this.bases[0] = b;
    moves.push({ id: b, from: -1, to: 0 });
    return moves;
  }

  nextBatter() {
    this.balls = 0;
    this.strikes = 0;
    this.batIdx[this.battingSide()] += 1;
  }

  out() {
    this.outs += 1;
    this.balls = 0;
    this.strikes = 0;
  }

  // ── inning flow ───────────────────────────────────────────────────────────
  /** Call after every resolved event. Returns { changed, cheese, cheeseLen, over }. */
  checkHalf() {
    const r = { changed: false, cheese: false, cheeseLen: P.cheese.len, over: false };
    if (this.outs < 3) {
      if (this.walkoff()) { r.over = true; this.gameOver = true; this.finalNote = 'WALK-OFF!'; }
      return r;
    }
    this.outs = 0; this.balls = 0; this.strikes = 0;
    this.bases = ['', '', ''];
    r.changed = true;

    if (this.half === HALF.TOP) {
      if (this.inning >= this.inningsTotal && this.score[1] > this.score[0]) {
        this.gameOver = true; r.over = true;
        this.finalNote = 'CALLED IT EARLY — GANG AHEAD';
        return r;
      }
      this.half = HALF.BOT;
    } else {
      if (this.inning >= this.inningsTotal) {
        if (this.score[0] !== this.score[1]) { this.gameOver = true; r.over = true; return r; }
        if (this.inning >= this.inningsTotal + P.extraInnings) {
          this.gameOver = true; r.over = true;
          this.finalNote = 'CALLED ON ACCOUNT OF SUPPER';
          return r;
        }
      }
      this.half = HALF.TOP;
      this.inning += 1;
    }

    // CHEESE IT! — the beat cop rounds the corner between halves. A lookout on
    // either side sees him first, so it happens half as often and clears faster.
    let chance = P.cheese.chance;
    if (this.teamHasQuirk(0, 'lookout') || this.teamHasQuirk(1, 'lookout')) {
      chance = P.cheese.lookoutChance;
      r.cheeseLen = P.cheese.lookoutLen;
    }
    r.cheese = this.rng.next() < chance;
    return r;
  }

  walkoff() {
    return this.half === HALF.BOT && this.inning >= this.inningsTotal && this.score[1] > this.score[0];
  }

  winnerText() {
    if (this.score[0] === this.score[1]) return 'TIE GAME';
    return this.score[1] > this.score[0] ? 'GANG WINS!' : 'VISITORS TAKE IT';
  }

  /**
   * One whole CPU-vs-CPU pitch, exactly the sequence tests/sim_test.gd runs.
   * Returns the event. The caller still calls checkHalf().
   */
  playPitch() {
    const p = this.makeCpuPitch();
    this.beginPitch(p);
    const sw = this.cpuSwing(p);
    const ev = sw.swing ? this.resolveSwing(sw.errMs) : this.resolveNoSwing();
    if (this.pendingThrow.play) this.autoThrow();
    return ev;
  }
}

/* ============================================================================
   Two teams off one block
   ========================================================================= */

/**
 * Two sides, picked the way they are actually picked. The two captains take a hand
 * each on the broom handle (DESIGN-BIBLE moment 11), Kathleen picks first because
 * she owns the ball and therefore owns the afternoon, and each captain's very first
 * pick is an ARM, because you cannot play at all without somebody to throw. After
 * that it is straight down the block in descending order of who can hit
 * (PERIOD-REFERENCE section 1.8), snaking — 1st, 2nd 3rd, 4th 5th — which is the
 * only reason anybody ever agrees to pick second.
 *
 * Batting order is pick order, because of course it is.
 *
 * This is not decoration: a plain alternating split of an alphabetical list put every
 * batting quirk on one side and both good arms on the other, and the visitors won 255
 * of 300 games. Picked this way it is 240-159 with 61% of games inside three runs.
 */
export function pickSides(ids = blockIds()) {
  const caps = CAPTAINS.filter((id) => ids.includes(id));
  const sides = [[caps[0]], [caps[1]]];          // 0 = visitors (bat first), 1 = the gang
  let pool = ids.filter((id) => !caps.includes(id));
  const card = playRoster(ROSTER);
  const arm = (id) => (card[id] ? card[id].ARM : 0);

  for (const side of [1, 0]) {                   // Kathleen owns the ball, Kathleen picks first
    const best = [...pool].sort((a, b) => arm(b) - arm(a) || pickValue(b) - pickValue(a) || (a < b ? -1 : 1))[0];
    sides[side].push(best);
    pool = pool.filter((id) => id !== best);
  }
  pool.sort((a, b) => pickValue(b) - pickValue(a) || (a < b ? -1 : 1));
  const SNAKE = [0, 1, 1, 0];
  pool.forEach((id, i) => sides[SNAKE[i % 4]].push(id));
  return sides;
}

/** Kept as the old name too — one call site, no reason to make anybody hunt for it. */
export const splitSides = pickSides;

/** Every kid on the block, in a stable order, as the core's card dictionary. */
export function blockRoster() { return playRoster(ROSTER); }
export function blockIds() { return ROSTER.map((k) => k.id).sort(); }

/**
 * A ready-to-play match between two halves of the block. Pass `away`/`home` to use
 * sides somebody else picked — which is what the team-select screen should do the
 * day it becomes authoritative; see setLiveLineups below.
 */
export function newMatch({ seed = 0, user = 1, innings = P.innings, rng = null, away = null, home = null } = {}) {
  const sides = (away && home) ? [away, home] : pickSides(blockIds());
  return new MatchCore({ rng }).setup(sides[0], sides[1], blockRoster(), user, innings, seed);
}

/* ============================================================================
   THE RULES SLOT
   ----------------------------------------------------------------------------
   src/game/sim.js owns the at-bat state machine and delegates every judgement to
   a slot (see src/game/plugins.js). This is that slot, so the running game and
   tools/soak.mjs decide a batted ball with the same code, off the same tuning,
   through the same PRNG. The street verdicts — the window, the sewers, the fire
   escape, the flivver, the race to first — are all decided here, and announced on
   the bus so audio and fx can hang off them.
   ========================================================================= */

const live = newMatch({ rng: sharedRng, user: 1 });
export { live as liveMatch };

/**
 * The seam for the team-select screen (src/ui/teamselect.js): when the two captains
 * have finished choosing up sides, hand the two lists of kid ids here and the rules
 * core plays that game instead of the one it picked for itself. `user` is which side
 * the player has — 1 for the gang, who bat last.
 */
export function setLiveLineups(away, home, user = 1) {
  live.setup(away, home, blockRoster(), user, P.innings, 0);
  live.rng = sharedRng;
  return live;
}

/** sim tracks base occupancy only; the core wants kids. Nearest honest guess. */
function syncFromSim(sim) {
  const s = sim.state;
  live.half = s.half === 'top' ? HALF.TOP : HALF.BOT;
  live.inning = s.inning;
  live.outs = s.outs;
  live.balls = s.balls;
  live.strikes = s.strikes;
  live.score = [s.score.away, s.score.home];
  const side = live.battingSide();
  const order = live.lineups[side];
  live.batIdx[side] = s.batterIdx;
  for (let i = 0; i < 3; i++) {
    live.bases[i] = s.bases[i] ? order[(s.batterIdx - 1 - i + order.length * 2) % order.length] : '';
  }
  return live.batterId();
}

const BASES_FOR = { single: 1, double: 2, triple: 3, hr: 4 };

/** What the block yells when it happens. The announcer piece may say it better. */
const DETAIL = {
  out_fly: 'caught on the fly',
  out_line: 'speared on a line',
  out_ground: 'thrown out at the stoop',
  out_home: 'cut down at the plate',
  single: 'a clean single',
  double: 'in for two',
};


export const rules = {
  /**
   * A taken pitch. The zone is the zone, but the ump is a kid on a stoop with a
   * candy in his cheek and he misses one in ten — which is the ported rule, and
   * the reason arguments happen.
   */
  isStrike(sim, target) {
    const inZone = Math.abs(target.x) < 1.1 && target.y > 1.9 && target.y < 3.3;
    return inZone && sharedRng.next() < P.umpire.calledStrike;
  },

  /**
   * A batted ball has come to rest. Re-judge it through the ported in-play model so
   * the street rules exist in the running game too, and hand the verdict back to
   * the sim by mutating the result it was about to use.
   */
  onResult(sim, result) {
    const hit = sim.lastContact;
    if (!hit || result.kind === 'foul' || result.kind === 'do_over') return;

    const batter = syncFromSim(sim);
    const pull = Math.sign(hit.sprayRad || 0);
    const q = Number.isFinite(hit.quality) ? clamp(hit.quality, 0, 1) : 0.5;
    const play = live.classifyInPlay(batter, q, pull);
    sim.lastPlay = play;   // the whole verdict, for the HUD, the announcer and the fx

    const street = play.window || play.fireEscape || play.result === 'hr';
    const fielderCalledIt = !!gameplay.fielding && result.kind === 'out';
    if (!street && fielderCalledIt) return;      // a real fielding piece keeps its own out

    if (play.window) bus.emit('street:window', { batter, lane: play.lane, carry: play.carry });
    if (play.sewers) bus.emit('street:sewers', { batter, sewers: play.sewers, window: play.window });
    if (play.fireEscape) bus.emit('street:fire_escape', { batter, lane: play.lane });
    if (play.flivver) bus.emit('street:flivver', { batter, lane: play.lane });
    if (play.needsThrow) bus.emit('street:throw', { targets: play.needsThrow.targets, deadline: play.needsThrow.deadline });

    if (play.needsThrow) {                        // nobody to prompt yet: take the sure one
      play.needsThrow = null;
      play.result = play.margin < P.race.outAtFirst ? 'out_ground' : 'single';
      play.bases = play.result === 'single' ? 1 : 0;
    }

    if (play.result.startsWith('out')) {
      result.kind = 'out';
      result.bases = 0;
      result.detail = DETAIL[play.result] || 'fielded';
    } else {
      result.kind = 'hit';
      result.bases = BASES_FOR[play.result] || play.bases || 1;
      result.detail = play.window ? 'THROUGH THE WINDOW'
        : play.result === 'hr' ? `${play.sewers} SEWER${play.sewers > 1 ? 'S' : ''}`
        : play.fireEscape ? 'off the fire escape'
        : play.flivver ? "off the flivver"
        : DETAIL[play.result] || 'a hit';
    }
    result.play = play;
  },

  nextBatter(sim) {
    sim.state.batterIdx = (sim.state.batterIdx + 1) % live.lineups[live.battingSide()].length;
  },
};

provide('rules', rules);

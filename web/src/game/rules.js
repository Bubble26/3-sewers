/**
 * rules.js — THE STREET RULEBOOK THE CORE DOES NOT COVER.
 * ============================================================================
 * `src/game/core.js` is the ported, soak-tested rules engine and it owns every
 * number that decides a batted ball: the window, the sewer grades, the fire
 * escape, the flivver, the race to first. **Nothing in this file may change any
 * of them**, and `node tools/soak.mjs` is the proof — soak imports core.js and
 * never imports this file, so a change in here that moved a published baseline
 * would be a change in the wrong file.
 *
 * What this file adds is the half of a street game that a baseball engine has no
 * concept of: the game gets INTERRUPTED, and it has to come back.
 *
 *   CHEESE IT     the beat cop rounds the corner. Everything stops mid-sentence,
 *                 the sticks go behind backs, and thirty seconds later (four, in
 *                 our compressed clock) the game picks up the same sentence.
 *                 PERIOD-REFERENCE §1.9 has the shout; the Godot sibling uses it
 *                 rather than CAR, and it is funnier and more period.
 *   CAR!          traffic. Same machinery, different weather system, and the
 *                 pitch that was in the air when it happened is a DO-OVER.
 *   DO-OVER       the block's universal undo. The count stands, the batter stays,
 *                 nobody agrees whose fault it was.
 *   FRAAAAN-KIEEE a mother wins. A kid goes upstairs and does not come back, and
 *                 his side plays a man short for the rest of the afternoon.
 *   GHOST MAN     a short side leaves a runner as chalk. He advances exactly as
 *                 far as the batter and he never scores without an argument.
 *   ON THE ROOF   the ball is gone, somebody has to go up for it, and the block
 *                 is one spaldeen poorer than it was a minute ago.
 *
 * ── HOW AN INTERRUPT WORKS, because it is the load-bearing idea ─────────────
 * The sim already owns a hold: `sim.freeze`, its four-frame hitstop. An interrupt
 * is that hold, held open. We top `sim.freeze` up every tick, which stops the
 * at-bat state machine dead — the pitch clock, the swing window, the fielding
 * update and the half-inning bookkeeping all live behind that early return — and
 * we let it go when the cop turns the far corner. Nothing is torn down and
 * nothing is rebuilt, so "resume gracefully" is not a feature, it is the absence
 * of one.
 *
 * Two rules keep it honest:
 *   1. We never interrupt after the batter has committed (`sim.swingAt >= 0`).
 *      A swing you already made is a swing, cop or no cop.
 *   2. We never interrupt a ball in flight. `in_play` DEFERS: the cop is noted,
 *      the play finishes on its own terms, and he arrives between pitches. A
 *      street game genuinely does stop for the cop; a rules engine that yanks
 *      four runners off the basepaths mid-throw produces a bug, not a joke.
 *
 * ── house rules ────────────────────────────────────────────────────────────
 * * All randomness is a private RNG (`srng`) seeded per reset, so adding this
 *   file cannot shift the stream `core.js` draws its ball games from.
 * * This file decides; `src/game/moments.js` stages. Everything here ends in a
 *   `bus.emit`, and nothing here touches a camera, a mesh or a sound.
 * * It does NOT fill the `rules` gameplay slot — core.js already does, and a
 *   second `provide('rules')` would warn, and a warning is a failed build.
 */

import { RNG } from '../core/rng.js';
import { bus } from '../core/bus.js';
import { registerSystem, app as APP } from '../app.js';
import { liveMatch, HALF } from './core.js';
import { CAPTAINS } from '../chars/roster.js';

/* ============================================================================
   TUNING
   ----------------------------------------------------------------------------
   These want to live in src/core/tuning.js next to T.play.cheese. That file is
   owned by another piece this wave, so they sit here, in one table, with the
   arithmetic that produced them — same discipline, wrong postcode. Moving them
   is a one-line change and it is in the report as such.

   The frequencies are all quoted per GAME, against the measured 45 at-bats and
   6 half-innings that `node tools/playthrough.mjs` reports for a three-inning
   game, because "0.045 a chance" means nothing to anybody reading this later.
   ========================================================================= */

export const STREET = {
  /** CHEESE IT — the beat cop. ~1.4 a game: twice is a routine, once is a story. */
  cop: {
    chance: 0.075,          // per at-bat. Measured: 0.048 gave a cop in one game of three,
                            // which is not a running gag, it is a rumour. 0.075 gives 1-2 a game.
    cooldown: 6,            // at-bats before he can come round again
    firstAt: 3,             // never in the first three at-bats: let the game start
    len: 4.6,               // seconds of held game. DESIGN-BIBLE §9.6 says thirty; thirty
    lookoutLen: 2.9,        // seconds of dead air is a punishment, so the beat is compressed
    lookoutChance: 0.040,   // quirk 'lookout' (Ears): sees him a block off, half as often
    betweenHalves: 0.55,    // core.js also rolls one at a half-inning; take this share of them
  },
  /** CAR! — a Model T at eight miles an hour. ~0.9 a game, and it costs a pitch. */
  car: {
    chance: 0.026,
    cooldown: 9,
    firstAt: 5,
    len: 3.9,
  },
  /**
   * FRAAAAN-KIEEE! — a mother wins. Once a game at most, never in the first
   * inning, and rolled AT AN AT-BAT rather than between halves. That is not a
   * detail: `core.checkHalf()` empties the bases before the break, so a call
   * rolled there could never catch a kid standing on one — measured over three
   * games, the ghost man (§9.8) therefore never once appeared, because the only
   * thing that creates him is a runner going upstairs. Rolled mid-inning he is
   * on a bag about half the time, which is exactly the frequency that moment
   * wants: memorable, and not every game.
   */
  mother: {
    fromInning: 2,
    chance: 0.095,          // per at-bat from the 2nd -> ~1 a game, capped at 1
    len: 3.2,
    maxPerGame: 1,
  },
  /** The ghost man. A side at or under this many kids plays one. */
  ghost: {
    shortSide: 6,           // eight a side is the shipped game; a call-up makes it seven,
    // and a block that loses two is short enough that the runner on second is chalk
    argueChance: 0.62,      // §9.8: he never scores on a judgement call without a fight
  },
  /** Somebody has to go up for it. */
  roof: { len: 2.4, trip: 2.0 },
  /**
   * THE THREE HAZARDS THE BALL DOES NOT ALWAYS FIND ON ITS OWN.
   *
   * Measured over three full games with `tools/playthrough.mjs`, the physical
   * ball hit the deli's plate glass, the ash cans and the catch-basin grate
   * either once or not at all — because those are three small boxes in sixty
   * feet of street and a batted ball is not aiming at them. Three of
   * DESIGN-BIBLE §9's twelve moments were therefore unreachable in a real game,
   * which makes them cutscenes rather than moments.
   *
   * So the block decides as well as the geometry: after a ball has been played,
   * the verdict's own lane and loft say whether it was the KIND of ball that
   * finds one, and then it is a roll. These do not change a single outcome —
   * nobody is out, nobody advances, no run scores — they say where the ball went
   * on its way to being retrieved, which is precisely the half of a street game
   * the rules core has no concept of.
   *
   * Rates are per qualifying ball, quoted against the ~26 balls in play a game.
   */
  hazard: {
    glass: { chance: 0.17, cooldown: 6, lane: -0.28 },   // ~1.2 a game: pull side, in the air
    sewer: { chance: 0.17, cooldown: 8 },                // ~1 a game: a grounder to the gutter
    ashcan: { chance: 0.15, cooldown: 5, lane: 0.55 },   // ~1.4 a game: a hot one into the cans
  },
  /** How many spaldeens the block owns on a Tuesday. Property is the first joke (§8.1). */
  balls: { start: 3 },
};

/* ============================================================================
   STATE — one object, exported, and hung on `app.street` for probes and critics
   ========================================================================= */

export const street = {
  /** The live interrupt, or null. { kind, t, len, doOver, from } */
  hold: null,
  /** An interrupt that arrived while the ball was in the air. */
  pending: null,
  /** at-bats since each interrupt kind last fired, so nothing stacks up. */
  since: { cop: 99, car: 99, glass: 99, sewer: 99, ashcan: 99 },
  atBats: 0,
  doOvers: 0,
  /** kid ids whose mother has won. They are still on the card; they are not on the block. */
  gone: new Set(),
  mothers: 0,
  /** side -> true once that side is playing short. */
  short: [false, false],
  /** base index (0..2) -> { id, side } for a runner who is chalk. */
  ghosts: new Map(),
  /** spaldeens left in the cigar box. */
  balls: STREET.balls.start,
  roofTrips: 0,
  /** kid id -> best sewer grade he has hit today. Moment §9.2's permanent label. */
  sewerMen: new Map(),
  /** every street verdict this game, in order, for the report and the HUD. */
  ledger: [],
};

const srng = new RNG(19250922);

/** Public read-out: `__SB.app.street.report()` in the console, or from a probe. */
function report() {
  return {
    atBats: street.atBats,
    doOvers: street.doOvers,
    mothers: street.mothers,
    gone: [...street.gone],
    short: street.short.slice(),
    ghosts: [...street.ghosts.entries()].map(([b, g]) => ({ base: b, ...g })),
    balls: street.balls,
    roofTrips: street.roofTrips,
    sewerMen: [...street.sewerMen.entries()].map(([id, s]) => ({ id, sewers: s })),
    ledger: street.ledger.slice(-24),
  };
}

function note(kind, detail = {}) {
  street.ledger.push({ kind, at: `${liveMatch.half === HALF.TOP ? 'T' : 'B'}${liveMatch.inning}`, ...detail });
  if (street.ledger.length > 120) street.ledger.shift();
}

function reset(seed = 19250922) {
  srng.reset(seed >>> 0);
  street.hold = null;
  street.pending = null;
  for (const k of Object.keys(street.since)) street.since[k] = 99;
  street.atBats = 0;
  street.doOvers = 0;
  street.gone.clear();
  street.mothers = 0;
  street.short = [false, false];
  street.ghosts.clear();
  street.balls = STREET.balls.start;
  street.roofTrips = 0;
  street.sewerMen.clear();
  street.ledger.length = 0;
  const sim = APP.sim;
  if (sim) { sim.windupRate = 1; if (sim.freeze > 0.2) sim.freeze = 0; }
}

/* ============================================================================
   THE INTERRUPT ENGINE
   ========================================================================= */

const LIVE = new Set(['wind_up', 'pitch', 'in_play']);

/** Can the block be stopped right now without lying to anybody? */
function interruptible(sim) {
  if (!sim || street.hold) return false;
  const p = sim.state.phase;
  if (!LIVE.has(p)) return false;
  if (p === 'in_play') return false;                 // the ball is in the air: defer, never yank
  if (p === 'pitch' && (sim.swingAt >= 0 || sim.jumpedAt >= 0)) return false;  // he is committed
  return true;
}

/**
 * Stop the block.
 *
 * `kind` is the weather system: 'cop' | 'car' | 'mother' | 'roof' | 'glass'.
 * `doOver` kills the pitch that was in the air and gives it back — the count
 * stands, the batter stays, and the pitcher throws it again.
 *
 * Returns true if the block actually stopped.
 */
export function interrupt(kind, { seconds = 3.0, doOver = false, why = '', defer = true, ...extra } = {}) {
  const sim = APP.sim;
  if (!sim) return false;
  if (sim.state.phase === 'in_play' || street.hold) {
    // Note it and take him at the top of the next at-bat. A cop who waits for the
    // play to finish is out of character and it is the only decent thing the block
    // will admit he has ever done.
    //
    // `defer: false` is for the interrupts that are ABOUT the ball in flight — the
    // pane that booms, the grate that swallows it. Those have already had their beat
    // by the time the play ends, so re-firing them two pitches later would be a
    // second, quieter copy of a joke that has been told.
    if (defer && !street.hold && !street.pending) street.pending = { kind, seconds, doOver, why, extra };
    return false;
  }
  if (!interruptible(sim)) return false;

  const wasPitch = sim.state.phase === 'pitch';
  street.hold = {
    kind, t: 0, len: seconds,
    doOver: doOver && wasPitch,
    from: sim.state.phase,
  };
  sim.freeze = Math.max(sim.freeze, seconds + 0.5);   // topped up every tick below
  note(kind, { why });
  bus.emit('street:interrupt', {
    kind, seconds, doOver: street.hold.doOver, phase: street.hold.from, why, ...extra,
  });
  return true;
}

/** The far corner. Let the block go. */
function release() {
  const h = street.hold;
  street.hold = null;
  const sim = APP.sim;
  if (!sim) return;
  sim.freeze = 0;

  if (h.doOver) {
    street.doOvers += 1;
    sim.ball.live = false;
    sim.ball.inFlight = false;
    sim.tailT = 0;
    sim.state.phase = 'wind_up';
    note('do_over', { why: h.kind });
    bus.emit('street:do_over', {
      kind: h.kind,
      count: { balls: sim.state.balls, strikes: sim.state.strikes },
      who: safeBatter(),
    });
    bus.emit('street:resume', { kind: h.kind, doOver: true });
    sim.beginAtBat(0.9);          // his own machinery, his own beat, his own event
    return;
  }
  bus.emit('street:resume', { kind: h.kind, doOver: false });
}

function safeBatter() { try { return liveMatch.batterId(); } catch { return ''; } }
function safeName(id) { try { return liveMatch.roster[id]?.nick || liveMatch.kidName(id); } catch { return id || ''; } }

/* ============================================================================
   THE RULES THEMSELVES
   ========================================================================= */

/** Whoever is on the block and playing. A kid whose mother has won is not. */
function onBlock(side) {
  const line = liveMatch.lineups[side] || [];
  return line.filter((id) => !street.gone.has(id));
}

function sideIsShort(side) { return onBlock(side).length <= STREET.ghost.shortSide; }

/**
 * CHEESE IT / CAR! — rolled once per at-bat, off our own PRNG.
 *
 * The lookout quirk is honoured exactly as core.js honours it between halves:
 * a kid with 'lookout' on either side hears the whistle a block off, so it
 * happens half as often and clears in two thirds of the time.
 */
function rollTraffic() {
  const sim = APP.sim;
  if (!sim || street.hold || street.pending) return;
  const C = STREET.cop;
  const lookout = hasLookout();
  if (street.atBats >= C.firstAt && street.since.cop >= C.cooldown
      && srng.chance(lookout ? C.lookoutChance : C.chance)) {
    street.since.cop = 0;
    cheeseIt(lookout);
    return;
  }
  const K = STREET.car;
  if (street.atBats >= K.firstAt && street.since.car >= K.cooldown && srng.chance(K.chance)) {
    street.since.car = 0;
    carComing();
  }
}

function hasLookout() {
  try {
    return liveMatch.teamHasQuirk(0, 'lookout') || liveMatch.teamHasQuirk(1, 'lookout');
  } catch { return false; }
}

/** The whole of moment §9.6, as a rule. The staging is src/game/moments.js. */
export function cheeseIt(lookout = hasLookout()) {
  const C = STREET.cop;
  const seconds = lookout ? C.lookoutLen : C.len;
  const spotter = lookoutKid();
  if (!interrupt('cop', { seconds, doOver: false, why: 'the beat cop', spotter })) return false;
  bus.emit('street:cheese_it', {
    seconds, lookout, spotter,
    holder: safeBatter(),
    // The one kid left holding the ball with nowhere on earth to put it.
    caught: catcherId(),
  });
  return true;
}

/** Moment §9.1. A klaxon two blocks off, and the pitch is a do-over. */
export function carComing() {
  const K = STREET.car;
  if (!interrupt('car', { seconds: K.len, doOver: true, why: 'a Model T' })) return false;
  bus.emit('street:car', { seconds: K.len, who: safeBatter() });
  return true;
}

function lookoutKid() {
  try {
    for (const side of [0, 1]) for (const id of liveMatch.lineups[side]) {
      if (liveMatch.quirkOf(id) === 'lookout' && !street.gone.has(id)) return id;
    }
  } catch { /* no roster yet */ }
  return '';
}
function catcherId() { try { return liveMatch.catcherId(); } catch { return ''; } }

/**
 * FRAAAAN-KIEEE! — moment §9.10.
 *
 * Rolled at a half-inning break from the second inning on. She calls the side
 * that just batted, because a kid who has just made an out is the funniest kid
 * on the block to lose. If he was standing on a bag when she called, he leaves a
 * GHOST behind him (§9.8) — which is the whole reason ghost runners exist, and
 * the two moments are one moment.
 */
function rollMother() {
  const M = STREET.mother;
  if (street.mothers >= M.maxPerGame) return;
  if (liveMatch.inning < M.fromInning) return;
  if (street.hold || street.pending) return;
  if (!srng.chance(M.chance)) return;
  const side = liveMatch.battingSide();
  const eligible = (id) => id && !CAPTAINS.includes(id) && !street.gone.has(id);
  // She calls whoever is standing on a bag, because the whole street can see him
  // and because a kid who has just got himself into scoring position is the
  // funniest kid on the block to lose. He leaves a ghost. If nobody is on, she
  // takes the best hitter, which is the same joke one beat earlier.
  const onBag = liveMatch.bases.filter(eligible);
  if (onBag.length) return callUpstairs(onBag[onBag.length - 1], side);
  const pool = onBlock(side).filter(eligible);
  if (pool.length <= 2) return;
  const called = pool.slice().sort((a, b) => {
    const s = (id) => { try { return liveMatch.stat(id, 'PWR') + liveMatch.stat(id, 'CON'); } catch { return 0; } };
    return s(b) - s(a) || (a < b ? -1 : 1);
  })[0];
  return callUpstairs(called, side);
}

/** She won. He goes up, and he is not coming back down. */
export function callUpstairs(id, side = sideOf(id)) {
  if (!id || street.gone.has(id)) return false;
  const bag = liveMatch.bases.indexOf(id);
  street.gone.add(id);
  street.mothers += 1;
  street.short[side] = sideIsShort(side);
  note('mother', { who: id });
  interrupt('mother', { seconds: STREET.mother.len, doOver: false, why: 'his mother' });
  bus.emit('street:mother', {
    who: id, name: safeName(id), side,
    short: street.short[side],
    onBase: bag,
    left: onBlock(side).length,
  });
  if (bag >= 0) ghostOn(bag, id, side, 'upstairs');
  else if (street.short[side]) bus.emit('street:short', { side, left: onBlock(side).length });
  return true;
}

function sideOf(id) {
  try {
    for (const s of [0, 1]) if ((liveMatch.lineups[s] || []).includes(id)) return s;
  } catch { /* no lineups */ }
  return liveMatch.battingSide();
}

/**
 * GHOST MAN ON SECOND — moment §9.8.
 *
 * The rule, exactly as a block plays it: the ghost advances the same number of
 * bases the batter does, he cannot be thrown out because there is nothing to
 * throw at, and when he is claimed to have scored, somebody argues about it. He
 * is chalk, so `src/game/moments.js` draws him; nothing here knows that.
 *
 * We do not take the runner off the core's bases — he is still a runner and he
 * still scores — we only mark the bag as chalk. That is the whole difference
 * between a fiction the block agrees on and a rules change, and only one of them
 * is allowed in this file.
 */
export function ghostOn(base, id, side = liveMatch.battingSide(), why = 'short') {
  if (base < 0 || base > 2) return false;
  street.ghosts.set(base, { id, side, why, name: safeName(id) });
  note('ghost', { base, who: id, why });
  bus.emit('street:ghost', { base, who: id, name: safeName(id), side, why });
  return true;
}

/** A ghost only exists while somebody is standing on that bag. */
function reconcileGhosts() {
  if (!street.ghosts.size) return;
  const bases = liveMatch.bases;
  for (const [base, g] of [...street.ghosts.entries()]) {
    const occupant = bases[base];
    if (occupant === g.id) continue;               // still his bag
    street.ghosts.delete(base);
    if (!occupant) {
      // he came home, or he was rubbed out. Either way the block has opinions.
      const scored = g.id && !bases.includes(g.id);
      bus.emit('street:ghost_gone', {
        base, who: g.id, name: g.name, scored,
        argue: scored && srng.chance(STREET.ghost.argueChance),
      });
    } else if (street.short[g.side]) {
      // the bag changed hands and the side is still short: the ghost moves up with it
      street.ghosts.set(base, { ...g, id: occupant, name: safeName(occupant) });
    }
  }
}

/**
 * THE THREE HAZARDS. Called once per ball in play, after the verdict is known.
 *
 * `sim.lastEv` is the core's own play object — carry, lane, loft, result — so the
 * kind of ball decides which hazard is even possible and the roll decides
 * whether it happened. Everything here is announced and nothing here is
 * adjudicated: `street:glass` is the pane that BOOMS and holds, not a broken
 * one; core.js owns the broken one and it is a home run.
 */
function rollHazards() {
  const sim = APP.sim;
  const ev = sim && sim.lastEv;
  if (!ev || ev.kind !== 'in_play' || street.hold || street.pending) return;
  const H = STREET.hazard;
  const lane = ev.lane ?? 0;
  const loft = ev.loft || 'ground';
  for (const k of ['glass', 'sewer', 'ashcan']) street.since[k] += 1;

  // THE WINDOW THAT DOES NOT BREAK (§9.5). Pull side, in the air, off the deli's
  // plate glass — and core.js has already decided this ball is not the one that
  // goes through, because that one is a home run and it is not here.
  if (loft !== 'ground' && lane < H.glass.lane && !ev.window
      && street.since.glass >= H.glass.cooldown && srng.chance(H.glass.chance)) {
    street.since.glass = 0;
    note('glass');
    bus.emit('street:glass', { batter: ev.batter, lane, carry: ev.carry });
    return;
  }
  // DOWN THE SEWER (§9.3). A grounder that gets past everybody finds the grate.
  if (loft === 'ground' && street.since.sewer >= H.sewer.cooldown && srng.chance(H.sewer.chance)) {
    street.since.sewer = 0;
    street.balls = Math.max(0, street.balls - 1);
    note('down_sewer', { balls: street.balls });
    bus.emit('street:down_sewer', {
      batter: ev.batter, lane, side: Math.sign(lane) || 1, balls: street.balls,
    });
    return;
  }
  // THE ASH CAN LID (§9.7). A hot one into the cans at the curb.
  if (loft !== 'fly' && Math.abs(lane) > H.ashcan.lane
      && street.since.ashcan >= H.ashcan.cooldown && srng.chance(H.ashcan.chance)) {
    street.since.ashcan = 0;
    note('ashcan');
    bus.emit('street:ashcan', { batter: ev.batter, lane, side: Math.sign(lane) || 1 });
  }
}

/**
 * ON THE ROOF — the rule the core has no concept of.
 *
 * `src/game/ballphysics.js` already puts the ball up there and ends the play; it
 * has no opinion about what that COSTS. This is the cost: the block is a
 * spaldeen down, somebody has to go up the fire escape after it, and if the box
 * under the stoop is empty the afternoon is over — which is the property joke
 * (§8.1) with a number attached to it.
 */
function ballOnRoof(p) {
  street.roofTrips += 1;
  street.balls = Math.max(0, street.balls - 1);
  const climber = climberId();
  note('roof', { balls: street.balls });
  bus.emit('street:roof', {
    balls: street.balls,
    climber,
    name: safeName(climber),
    last: street.balls === 0,
    side: p?.side ?? 1,
    pos: p?.pos ?? null,
  });
  if (street.balls === 0) bus.emit('street:last_ball', { climber, name: safeName(climber) });
  interrupt('roof', { seconds: STREET.roof.len, doOver: false, why: 'the roof' });
}

/** Whoever is nearest the fire escape and least able to say no. */
function climberId() {
  try {
    const side = liveMatch.fieldingSide();
    const pool = onBlock(side);
    if (!pool.length) return '';
    // the quickest kid, because he is the one who gets told to go
    return pool.slice().sort((a, b) => liveMatch.stat(b, 'SPD') - liveMatch.stat(a, 'SPD') || (a < b ? -1 : 1))[0];
  } catch { return ''; }
}

/** The permanent label a sewer shot buys you (§9.2). */
function markSewers(p) {
  const id = p?.batter;
  if (!id) return;
  const s = Math.max(1, p.sewers | 0);
  const was = street.sewerMen.get(id) || 0;
  if (s <= was) return;
  street.sewerMen.set(id, s);
  note('sewers', { who: id, sewers: s });
  bus.emit('street:sewer_man', { who: id, name: safeName(id), sewers: s, first: was === 0 });
}

/* ============================================================================
   THE SYSTEM
   ========================================================================= */

let wired = false;

function wire() {
  if (wired) return;
  wired = true;

  bus.on('atbat:begin', () => {
    street.atBats += 1;
    street.since.cop += 1;
    street.since.car += 1;
    reconcileGhosts();
    // an interrupt that had to wait for the ball to come down arrives now
    if (street.pending && !street.hold) {
      const p = street.pending; street.pending = null;
      if (p.kind === 'cop') cheeseIt();
      else if (p.kind === 'car') carComing();
      else interrupt(p.kind, { seconds: p.seconds, doOver: p.doOver, why: p.why, ...(p.extra || {}) });
      return;
    }
    rollMother();
    if (!street.hold) rollTraffic();
  });

  bus.on('half:end', () => { reconcileGhosts(); });

  // core.js rolls its own cop between halves (T.play.cheese). Take a share of
  // those and give them the full beat instead of a silent pause; leave the rest
  // as the pause it already was, so the two never double up on one break.
  bus.on('street:cheese', () => {
    if (street.hold || street.pending) return;
    if (!srng.chance(STREET.cop.betweenHalves)) return;
    street.since.cop = 0;
    cheeseIt();
  });

  bus.on('ball:roof', ballOnRoof);
  bus.on('street:sewers', markSewers);
  // one roll per ball in play, on whichever of the two the sim announces
  bus.on('hit', (p) => { if (p?.kind !== 'walk') rollHazards(); });
  bus.on('out', (p) => { if (p?.kind !== 'strikeout') rollHazards(); });

  bus.on('game:over', () => { street.hold = null; street.pending = null; });
}

export default registerSystem({
  name: 'streetrules',
  // after the gameplay slots (18..62) and before the fx/announcer that stage them
  order: 64,

  init(app) {
    app.street = street;
    street.report = report;
    street.interrupt = interrupt;
    street.cheeseIt = cheeseIt;
    street.car = carComing;
    street.callUpstairs = callUpstairs;
    street.ghostOn = ghostOn;
    street.STREET = STREET;
    wire();
  },

  update(dt, app) {
    const sim = app.sim;
    // sim.reset() builds a NEW state object, and tools/playthrough.mjs resets without
    // ever going through a scenario. Watching the object identity is the only signal
    // this file gets that a fresh ball game has started, and it is a reliable one.
    if (sim && sim.state !== street._stateRef) { street._stateRef = sim.state; reset(19250922); }
    const h = street.hold;
    if (!h) return;
    if (!sim || sim.state.phase === 'over') { street.hold = null; return; }
    h.t += dt;
    if (h.t >= h.len) { release(); return; }
    // hold the sim's own hitstop open. Nothing is torn down, so nothing has to be
    // rebuilt when we let it go.
    sim.freeze = Math.max(sim.freeze, 0.5);
  },

  onScenario(name, app) {
    reset(19250922);
    street._stateRef = app.sim ? app.sim.state : null;
  },
});

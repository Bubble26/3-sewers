import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { provide } from './plugins.js';
import { registerScenario } from '../core/scenarios.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { rng, RNG } from '../core/rng.js';
import { getKid, ROSTER } from '../chars/roster.js';
import { CLIPS } from '../chars/clips.js';
import { clip } from '../chars/anim.js';
import { CHALK, INK, CLOTH, hexCSS } from '../render/palette.js';
import { MAT, ballMesh } from '../render/materials.js';

/**
 * ============================================================================
 * PITCHING — what a twelve-year-old can actually throw, and what he says he can
 * ============================================================================
 *
 * This is not an arsenal. It is five things a kid does with a pink rubber ball at
 * forty-two feet, and the fifth one is cheating:
 *
 *    HUMMER      hard and flat. Backspin fights the drop, so it looks like it rises.
 *    SLOW ONE    the same windup, two thirds of the speed, and a late sag.
 *    WOBBLER     thrown with the fingernails. No spin, so the air pushes it around.
 *    LOFTER      up over everybody's head and down out of the sun.
 *    SKIPPER     one big bounce off the Belgian block, on purpose (PERIOD §1.4).
 *
 * plus LITTLE EASY NOW, which is not a pitch, it is a favour, and every kid on this
 * block has thrown one to somebody's little brother.
 *
 * ── how a pitch is made ──────────────────────────────────────────────────────
 * 1. `choose()` picks a TYPE and an AIM. Both come out of the roster: a kid's arm and
 *    nerve set his control, his `arm.quirk` sets his ritual and his release slot, and
 *    the BATTER's `secret` sets what the pitcher tries to exploit. Sal genuinely cannot
 *    hit a slow ball, and every pitcher on this street has noticed.
 * 2. `solve()` turns (release point, aim, type) into a real trajectory with real break —
 *    ballistic, solved backwards from where it has to arrive, plus a per-type
 *    acceleration and, for the wobbler, a wander term. Never a speed number.
 * 3. The DELIVERY plays: set → look-in → rock back → gather → LEG KICK (held) →
 *    stride → release → recover, at the frame counts in DESIGN-BIBLE §12.
 * 4. The ball leaves the pitcher's actual hand, on the frame the clip says it does.
 *
 * ── what other pieces get ────────────────────────────────────────────────────
 * Batting reads   `sim.pitch` — flight time, the crossing point, `path(t)`, and `tell`,
 *                 which is the thing a good hitter is allowed to read and when.
 * The announcer reads `sim.pitch.spoken` / `.crow` / `.note`, and the bus events
 *                 `pitch:selected`, `pitch:tell`, `pitch:groove`, `pitch:wild`,
 *                 `pitcher:gassed`, `pitcher:rattled`.
 * The HUD reads   `APP.pitching.juice` — the egg cream on the stoop step: the foam head
 *                 collapses first (that is when the plate starts wandering), then the
 *                 level drops. Drawing the glass belongs to the HUD piece; the
 *                 *consequence* of it emptying is enforced here.
 *
 * Nothing in here writes to another piece's file. The delivery clips are registered into
 * the shared CLIPS table under a `pitch:` prefix so they cannot collide with the
 * animation piece's own names.
 */

/* ============================================================================
   0. Tuning
   Gameplay constants live in src/core/tuning.js; this block is the pitching piece's
   own dials, kept in one place for the same reason. Anything already in T is read
   from T rather than restated.
   ========================================================================= */

export const PT = {
  // the delivery, in seconds. DESIGN-BIBLE §12: anticipation 8–14 frames,
  // windup 24–40, and the leg-kick apex is a HELD pose.
  set: 0.34,              // stand on the manhole, ball behind the hip
  lookIn: 0.28,           // find the catcher, take the sign, nod
  windup: 0.90,           // rock back → gather → kick → stride → release
  releaseAt: 0.94,        // fraction of the windup at which the ball leaves the hand
  apexAt: 0.48,           // fraction at which the leg kick tops out
  apexHold: 0.13,         // seconds the apex is held — the pose the street imitates
  recover: 0.95,

  // the strike zone, matched to defaults.isStrike so a taken pitch is judged the same
  // way whether or not the rules piece has filled its slot yet.
  zone: { halfW: 1.10, lo: 1.90, hi: 3.30 },
  plateZ: T.street.plateZ,
  moundZ: T.street.moundZ,

  release: { height: 4.35, side: 0.85, stride: 2.4 },

  control: { base: 0.62, rattle: 0.95, gas: 0.85, wildAt: 2.4 },
  juice: { pitches: 34, foamFrac: 0.28, hardCost: 1.35 },
  rattle: { decay: 0.16, walk: 0.22, hit: 0.30, run: 0.26, hardHit: 0.34, max: 1 },

  ring: { feet: 1.72, ink: 0.14 },
};

/** Where a pitch is allowed to be aimed, as fractions of the zone. */
const SPOTS = {
  heart: [0.00, 0.50], letters: [0.00, 0.94], knees: [0.00, 0.08],
  inside: [-0.78, 0.52], outside: [0.78, 0.52],
  inLow: [-0.72, 0.14], outLow: [0.72, 0.14],
  upIn: [-0.62, 0.92], upOut: [0.62, 0.92],
  // off the plate on purpose — a kid still has to be shown chasing something
  chaseOut: [1.42, 0.30], chaseUp: [0.10, 1.48], chaseLow: [-0.28, -0.42],
};

const spotToWorld = (s) => new THREE.Vector3(
  s[0] * PT.zone.halfW,
  PT.zone.lo + s[1] * (PT.zone.hi - PT.zone.lo),
  PT.plateZ,
);

/* ============================================================================
   1. The arsenal
   ========================================================================= */

/**
 * Each type carries its own physics AND its own theatre. `lift` is how hard the spin
 * fights gravity (1 = no help at all, 0.4 = a good four-seam), `side` is the lateral
 * acceleration in ft/s², `delivery` names the windup clip, and `tell` is what a hitter
 * is allowed to read off the apex pose — which is the whole reason hitting is a skill.
 */
export const PITCHES = {
  heat: {
    id: 'heat', label: 'HUMMER', spoken: 'a hummer', crow: "That's a hummer!",
    note: 'hard and flat, and he knows it',
    flight: 0.70, lift: 0.42, side: 0.9, wildness: 1.00, cost: PT.juice.hardCost,
    spin: [-26, 0, 0], face: 'determined',
    delivery: 'pitch:heat',
    tell: { cue: 'high kick, arm hidden behind the ear', at: 0.31, read: 0.86 },
  },
  slow: {
    id: 'slow', label: 'SLOW ONE', spoken: 'the slow one', crow: 'Little easy now!',
    note: 'same windup, two thirds of the speed',
    flight: 0.96, lift: 0.86, side: -1.6, wildness: 0.86, cost: 0.9,
    spin: [-9, 3, 0], face: 'smug',
    delivery: 'pitch:slow',
    tell: { cue: 'the same kick, but the arm never catches up', at: 0.24, read: 0.42 },
  },
  wobble: {
    id: 'wobble', label: 'WOBBLER', spoken: 'the wobbler', crow: 'Where\'s it goin\'?',
    note: 'fingernails. Nobody knows. Him included.',
    flight: 1.02, lift: 1.00, side: 0, wildness: 1.9, cost: 0.75,
    spin: [0.4, 0.3, 0], face: 'squint', wander: { amp: 0.92, f1: 2.7, f2: 4.3 },
    delivery: 'pitch:wobble',
    tell: { cue: 'stiff wrist, fingertips showing, no kick at all', at: 0.30, read: 0.74 },
  },
  loft: {
    id: 'loft', label: 'LOFTER', spoken: 'a lofter', crow: 'Out of the sun!',
    note: 'over the laundry line, down on your head',
    flight: 1.44, lift: 1.00, side: 0, wildness: 1.25, cost: 0.6,
    spin: [7, 0, 0], face: 'grin',
    delivery: 'pitch:loft',
    tell: { cue: 'leans back, no stride, the arm comes up not through', at: 0.26, read: 0.30 },
  },
  skip: {
    id: 'skip', label: 'SKIPPER', spoken: 'the skipper', crow: 'One big bounce!',
    note: 'one big bounce off the block, on purpose',
    flight: 0.80, lift: 1.00, side: 0, wildness: 1.15, cost: 1.05,
    spin: [-34, 0, 0], face: 'taunt',
    bounce: { z: 10.2, at: 0.71, e: 0.58, mu: 0.82 },
    delivery: 'pitch:skip',
    tell: { cue: 'aims at the road, chin down, short stride', at: 0.28, read: 0.62 },
  },
  easy: {
    id: 'easy', label: 'LITTLE EASY NOW', spoken: 'a gift', crow: 'Little easy now.',
    note: 'not a pitch — a favour',
    flight: 1.16, lift: 0.92, side: 0, wildness: 0.25, cost: 0.5,
    spin: [-4, 0, 0], face: 'grin',
    delivery: 'pitch:easy', grooved: true,
    tell: { cue: 'he is grinning before he lets go', at: 0.22, read: 0.16 },
  },
};

export const PITCH_ORDER = ['heat', 'slow', 'wobble', 'loft', 'skip'];

/* ============================================================================
   2. Who is on the mound
   ========================================================================= */

/** Kids the roster says do not pitch. Their quirk line is the whole reason. */
const NEVER_PITCH = new Set(['filomena']);

/**
 * The pre-pitch ritual, one per kid, straight off `kid.arm.quirk`. Every one of these
 * is an existing clip in the animation piece's vocabulary — the pitching piece names
 * which one, it does not author bodies that belong to somebody else.
 */
const RITUAL = {
  sal: { clip: 'fidget_pants', extra: 0.26, say: 'nine rubs on the thigh, and the block counts along' },
  kathleen: { clip: 'fidget_chatter', extra: 0.10, announce: true, say: 'she tells you what is coming' },
  irving: { clip: null, extra: 0.00, slot: 'side', say: 'sidearm, from somewhere off the curb' },
  bessie: { clip: 'fidget_chatter', extra: 0.06, talks: true, say: 'talks the whole way through' },
  rose: { clip: 'fidget_chatter', extra: 0.22, say: 'counts to three. Always three.' },
  otto: { clip: 'fidget_spit', extra: 0.16, say: 'blows on his fingers. In August.' },
  stash: { clip: 'fidget_look', extra: 0.18, say: 'checks the third-floor window' },
  eugene: { clip: 'fidget_pigeon', extra: 0.16, hide: true, say: 'hides it behind his hip — the pigeon gives it away' },
  ethel: { clip: 'fidget_stretch', extra: 0.20, say: 'windmills the arm. Twice.' },
  jesus: { clip: 'fidget_pebble', extra: 0.17, loves: 'skip', say: 'bounces it off the block first, just to hear it' },
  luz: { clip: null, extra: 0.12, ace: true, say: 'the windup every kid on this block has tried to copy' },
  ling: { clip: 'fidget_stocking', extra: 0.14, say: 'wipes it on her sleeve and hands it back cleaner' },
  maureen: { clip: 'fidget_look', extra: 0.40, say: 'will not throw until everybody is set' },
  tommy: { clip: 'fidget_stretch', extra: 0.10, heat: true, say: 'the catcher stands up and backs off two steps' },
  dom: { clip: 'fidget_look', extra: 0.30, say: 'has never been allowed to pitch, and is doing it anyway' },
};

/**
 * A kid's pitching identity, derived — never invented. Arm sets velocity and how much
 * of the arsenal he has earned; nerve sets what happens when the street gets loud.
 */
export function profileOf(ref) {
  const kid = getKid(ref);
  const s = kid.stats;
  const rit = RITUAL[kid.id] || { clip: 'fidget_cap', extra: 0.12, say: kid.arm.quirk };
  const young = kid.age <= 9;

  // what he can throw. Everybody has a fastball and a lob; the rest is earned.
  const arsenal = ['heat', 'loft'];
  if (s.arm >= 2 || kid.age >= 10) arsenal.push('slow');
  if (s.arm >= 3 || rit.loves === 'skip') arsenal.push('skip');
  if (s.arm >= 3 && s.nerve >= 3) arsenal.push('wobble');
  if (rit.loves && !arsenal.includes(rit.loves)) arsenal.push(rit.loves);

  return {
    id: kid.id, kid,
    nick: kid.nick, name: kid.name,
    quirk: kid.arm.quirk,
    ritual: rit,
    slot: rit.slot || (s.arm >= 4 ? 'over' : s.arm >= 2 ? 'three' : 'push'),
    arsenal,
    // 0..1 dials
    velocity: THREE.MathUtils.clamp(0.42 + s.arm * 0.16 - (young ? 0.16 : 0), 0.3, 1.06),
    poise: THREE.MathUtils.clamp((s.arm + s.nerve) / 8, 0.2, 1),
    guts: s.nerve / 4,
    stamina: THREE.MathUtils.clamp(0.5 + s.arm * 0.14 + (kid.age - 10) * 0.05, 0.35, 1.1),
    ace: !!rit.ace,
    announces: !!rit.announce,
    forbidden: NEVER_PITCH.has(kid.id),
    setTime: PT.set + rit.extra,
  };
}

/**
 * What the pitcher thinks he knows about the kid at the plate. Everything here is read
 * off the roster's own `secret` and `stats` — this is the block's gossip, not a table
 * somebody made up.
 */
export function readBatter(ref) {
  const kid = getKid(ref);
  const s = kid.stats;
  const out = { id: kid.id, attack: null, avoid: null, groove: 0, why: '' };

  if (kid.secret?.label === 'CANNOT HIT SLOW') { out.attack = 'slow'; out.why = 'cannot hit a slow ball. Not one.'; }
  else if (kid.secret?.label === 'FOULS THEM OFF') { out.avoid = 'heat'; out.why = 'she will foul off nine of them and take your arm with her'; }
  else if (s.power >= 4 && s.contact <= 2) { out.attack = 'wobble'; out.why = 'swings from the heels at everything thrown'; }
  else if (s.contact >= 4 && s.power <= 2) { out.avoid = 'slow'; out.why = 'she will just poke it somewhere'; }
  else if (s.power >= 4 && s.contact >= 4) { out.avoid = 'heat'; out.why = 'nobody has got her out since Easter'; }

  // the little kid. Everybody grooves one to the little kid.
  const little = (kid.age <= 9 ? 0.45 : 0) + (s.power + s.contact <= 4 ? 0.3 : 0);
  out.groove = THREE.MathUtils.clamp(little, 0, 0.75);
  return out;
}

/* ============================================================================
   3. Flight — a real trajectory, solved backwards from where it has to arrive
   ========================================================================= */

const G = T.ball.gravity;

/** Ballistic solve: the launch velocity that puts p0 on p1 in `tf` under accel `a`. */
function launchFor(p0, p1, tf, a) {
  return new THREE.Vector3(
    (p1.x - p0.x - 0.5 * a.x * tf * tf) / tf,
    (p1.y - p0.y - 0.5 * a.y * tf * tf) / tf,
    (p1.z - p0.z) / tf,
  );
}

/** The wobbler's wander: two incommensurate swings that do NOT settle before the plate. */
function wanderAt(p, t) {
  const w = p.type.wander;
  if (!w) return null;
  const u = t / p.flight;
  const ramp = u * u * (3 - 2 * u);        // nothing at the hand, everything at the plate
  return {
    x: w.amp * ramp * Math.sin(6.2831 * w.f1 * t + p.phase),
    y: w.amp * 0.62 * ramp * Math.sin(6.2831 * w.f2 * t + p.phase * 1.7),
  };
}

/**
 * Where the ball is, `t` seconds after it left the hand. One function, used by the
 * flight update, by the batting piece to solve the pitch, and by the chalk diagram —
 * so the picture a critic looks at is literally the path the game flies.
 */
export function pathAt(p, t, out = new THREE.Vector3()) {
  const tt = THREE.MathUtils.clamp(t, 0, p.flight);
  if (p.legs) {
    // the skipper: throw, bounce off the Belgian block, hop
    const A = p.legs[0], B = p.legs[1];
    if (tt <= A.tf) {
      out.set(
        A.p0.x + A.v.x * tt,
        A.p0.y + A.v.y * tt - 0.5 * G * tt * tt,
        A.p0.z + A.v.z * tt,
      );
    } else {
      const s = tt - A.tf;
      out.set(
        B.p0.x + B.v.x * s,
        B.p0.y + B.v.y * s - 0.5 * G * s * s,
        B.p0.z + B.v.z * s,
      );
    }
    return out;
  }
  out.set(
    p.p0.x + p.v.x * tt + 0.5 * p.a.x * tt * tt,
    p.p0.y + p.v.y * tt + 0.5 * p.a.y * tt * tt,
    p.p0.z + p.v.z * tt,
  );
  const w = wanderAt(p, tt);
  if (w) { out.x += w.x; out.y += w.y; }
  return out;
}

const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
/** Velocity by central difference — exact enough, and it never disagrees with the path. */
export function velAt(p, t, out = new THREE.Vector3()) {
  const h = 1 / 240;
  pathAt(p, t - h, _pa); pathAt(p, t + h, _pb);
  return out.copy(_pb).sub(_pa).multiplyScalar(1 / (2 * h));
}

/**
 * Build the whole trajectory. `aim` is where the pitcher MEANT it; `cross` is where it
 * actually gets to, after his control has had its say. Both are kept: the chalk ring
 * shows the intent to batter and pitcher alike, and the rules judge the reality.
 */
export function solve(type, p0, cross, opts = {}) {
  const dist = Math.max(6, p0.z - PT.plateZ);
  const scale = dist / (PT.moundZ - PT.plateZ);
  const flight = Math.max(0.22, type.flight * scale / (opts.speed ?? 1));

  const p = {
    type, id: type.id, label: type.label, spoken: type.spoken, crow: type.crow, note: type.note,
    p0: p0.clone(), cross: cross.clone(), aim: (opts.aim || cross).clone(),
    flight, phase: opts.phase ?? 0, grooved: !!opts.grooved,
    spin: new THREE.Vector3(...(type.spin || [0, 0, 0])),
  };

  if (type.bounce) {
    const b = type.bounce;
    const tA = flight * b.at, tB = flight - tA;
    const r = T.ball.radius;
    const bz = THREE.MathUtils.clamp(b.z, 3.5, dist * 0.55);
    const bx = THREE.MathUtils.lerp(p0.x, cross.x, 0.72);
    const hit = new THREE.Vector3(bx, r, PT.plateZ + bz);
    const vA = launchFor(p0, hit, tA, { x: 0, y: -G, z: 0 });
    const vyImpact = vA.y - G * tA;
    const vB = new THREE.Vector3(
      (cross.x - hit.x) / tB,
      -vyImpact * b.e,
      (PT.plateZ - hit.z) / tB,
    );
    p.legs = [{ p0: p0.clone(), v: vA, tf: tA }, { p0: hit, v: vB, tf: tB }];
    p.bounceAt = hit;
    p.bounceT = tA;
    // the hop settles wherever the block sends it — that is the pitch
    p.cross.set(hit.x + vB.x * tB, hit.y + vB.y * tB - 0.5 * G * tB * tB, PT.plateZ);
  } else {
    p.a = new THREE.Vector3((type.side || 0) * (opts.hand ?? 1), -G * (type.lift ?? 1), 0);
    // the wander is added on top, so the ballistic part has to arrive short of it
    const target = cross.clone();
    if (type.wander) {
      const w = { x: type.wander.amp * Math.sin(6.2831 * type.wander.f1 * flight + p.phase),
        y: type.wander.amp * 0.62 * Math.sin(6.2831 * type.wander.f2 * flight + p.phase * 1.7) };
      target.x -= w.x; target.y -= w.y;
    }
    p.v = launchFor(p0, target, flight, p.a);
  }

  // the read-outs everybody else wants
  p.speedMph = Math.round((dist / flight) * 0.6818);
  p.apex = apexOf(p);
  p.breakIn = breakOf(p);
  p.rise = +(p.apex - p0.y).toFixed(2);
  p.drop = +(p.apex - p.cross.y).toFixed(2);
  p.path = (t, out) => pathAt(p, t, out);
  p.tell = { ...type.tell, at: (type.tell?.at ?? 0.3) };
  return p;
}

/**
 * The break: how far the ball is from the straight line between the hand and the plate,
 * at the point where it is furthest from it, in inches. A speed number tells a hitter
 * nothing; this is the number that means "it moved".
 */
function breakOf(p) {
  const a = p.p0, b = p.cross;
  let bx = 0, by = 0, best = -1;
  for (let i = 1; i < 12; i++) {
    const u = i / 12;
    pathAt(p, u * p.flight, _pa);
    const k = (_pa.z - a.z) / ((b.z - a.z) || 1);
    const dx = _pa.x - (a.x + (b.x - a.x) * k);
    const dy = _pa.y - (a.y + (b.y - a.y) * k);
    const d = dx * dx + dy * dy;
    if (d > best) { best = d; bx = dx; by = dy; }
  }
  return { x: Math.round(bx * 12), y: Math.round(by * 12), total: Math.round(Math.sqrt(best) * 12) };
}

function apexOf(p) {
  let hi = -1e9;
  for (let i = 0; i <= 24; i++) { const y = pathAt(p, (i / 24) * p.flight, _pa).y; if (y > hi) hi = y; }
  return hi;
}

/* ============================================================================
   4. The pitcher's head — selection, aim, gas and nerves
   ========================================================================= */

export class PitcherAI {
  constructor() {
    this.profile = profileOf('luz');
    this.juice = { level: 1, foam: 1 };
    this.rattle = 0;
    this.thrown = 0;
    this.lastId = null;
    this.sameCount = 0;
  }

  /** Whoever the players system put on the manhole is who we model. */
  adopt(kidRef) {
    const p = profileOf(kidRef);
    if (p.id === this.profile.id) return this.profile;
    this.profile = p;
    this.juice = { level: 1, foam: 1 };
    this.rattle = 0; this.thrown = 0; this.lastId = null; this.sameCount = 0;
    return p;
  }

  get gas() { return 1 - this.juice.level; }

  /** The egg cream: the foam head collapses first, then the level drops (§11). */
  drain(cost = 1) {
    const per = 1 / (PT.juice.pitches * this.profile.stamina);
    const d = per * cost;
    if (this.juice.foam > 0) {
      const f = Math.min(this.juice.foam, d / PT.juice.foamFrac);
      this.juice.foam -= f;
      const left = d - f * PT.juice.foamFrac;
      if (left > 0) this.juice.level = Math.max(0, this.juice.level - left);
    } else {
      this.juice.level = Math.max(0, this.juice.level - d);
    }
    if (this.juice.foam <= 0.001 && !this._foamGone) {
      this._foamGone = true;
      bus.emit('pitcher:gassed', { who: this.profile.id, stage: 'foam', juice: { ...this.juice } });
    }
    if (this.juice.level <= 0.22 && !this._flat) {
      this._flat = true;
      bus.emit('pitcher:gassed', { who: this.profile.id, stage: 'flat', juice: { ...this.juice } });
    }
  }

  shake(amount, why) {
    const before = this.rattle;
    this.rattle = THREE.MathUtils.clamp(this.rattle + amount * (1.4 - this.profile.guts), 0, PT.rattle.max);
    if (this.rattle > 0.55 && before <= 0.55) bus.emit('pitcher:rattled', { who: this.profile.id, why, rattle: this.rattle });
  }

  /** How far off the spot he is, in feet, one sigma. */
  scatter(type) {
    return PT.control.base * (1.35 - this.profile.poise)
      * (1 + PT.control.rattle * this.rattle)
      * (1 + PT.control.gas * this.gas)
      * (type.wildness ?? 1);
  }

  /**
   * Pick the pitch and the spot. Order matters: the favour first (a kid will not throw
   * a wobbler at somebody's eight-year-old brother), then the count, then the gossip.
   */
  choose(sim) {
    const st = sim.state;
    if (this.forced && PITCHES[this.forced]) {
      const t = PITCHES[this.forced];
      const b = getKid(st.batterIdx % ROSTER.length);
      return this.finish({ type: t, spot: this.forcedSpot || SPOTS.knees, grooved: !!t.grooved }, sim, readBatter(b), b);
    }
    const batter = getKid(st.batterIdx % ROSTER.length);
    const read = readBatter(batter);
    const pr = this.profile;
    const behind = st.balls >= 3 || (st.balls - st.strikes) >= 2;
    const ahead = st.strikes >= 2 && st.balls <= 1;

    // ── the favour ──────────────────────────────────────────────────────────
    let groove = read.groove;
    if (pr.id === 'sal' && batter.id === 'dom') groove = 1;      // his own brother, every time
    if (st.strikes >= 2) groove *= 0.55;                          // not with two on him
    if (this.rattle > 0.5) groove *= 0.4;
    if (rng.chance(groove)) {
      const p = { type: PITCHES.easy, spot: SPOTS.heart, grooved: true, why: `${batter.nick} is eight` };
      return this.finish(p, sim, read, batter);
    }

    // ── what he has, weighted by the count and by what he has heard ─────────
    const bag = pr.arsenal.filter((id) => PITCHES[id]);
    const w = {};
    for (const id of bag) {
      let k = 1;
      if (id === 'heat') k = 1.5 + pr.velocity * 0.9 + (behind ? 1.4 : 0) - this.gas * 1.1;
      if (id === 'slow') k = 1.0 + (ahead ? 0.9 : 0) + this.gas * 0.8;
      if (id === 'wobble') k = 0.7 + (ahead ? 0.7 : 0) - (behind ? 0.6 : 0);
      if (id === 'loft') k = 0.55 + this.gas * 1.3 - (behind ? 0.3 : 0);
      if (id === 'skip') k = 0.6 + (ahead ? 1.1 : 0) - (behind ? 0.9 : 0);
      if (id === read.attack) k += 2.2;
      if (id === read.avoid) k -= 1.4;
      if (pr.ritual.loves === id) k += 0.9;
      if (pr.ritual.heat && id === 'heat') k += 1.3;
      if (id === this.lastId) k -= 0.55 * this.sameCount;
      w[id] = Math.max(0.05, k);
    }
    let total = 0; for (const id of bag) total += w[id];
    let roll = rng.range(0, total), pick = bag[0];
    for (const id of bag) { roll -= w[id]; if (roll <= 0) { pick = id; break; } }
    const type = PITCHES[pick];

    // ── the spot ────────────────────────────────────────────────────────────
    let spot;
    if (behind) spot = st.balls >= 3 ? SPOTS.heart : SPOTS.letters;
    else if (ahead) spot = rng.pick([SPOTS.chaseOut, SPOTS.chaseLow, SPOTS.chaseUp, SPOTS.outLow, SPOTS.upIn]);
    else spot = rng.pick([SPOTS.knees, SPOTS.inside, SPOTS.outside, SPOTS.outLow, SPOTS.inLow, SPOTS.letters]);
    if (type.bounce) spot = rng.pick([SPOTS.knees, SPOTS.chaseLow, SPOTS.inLow]);
    if (type.id === 'loft') spot = rng.pick([SPOTS.letters, SPOTS.heart, SPOTS.chaseUp]);

    return this.finish({ type, spot, grooved: false, why: read.why }, sim, read, batter);
  }

  finish(choice, sim, read, batter) {
    const type = choice.type;
    this.sameCount = type.id === this.lastId ? this.sameCount + 1 : 0;
    this.lastId = type.id;
    const aim = spotToWorld(choice.spot);
    return {
      type, aim, grooved: choice.grooved, read, batter,
      why: choice.why || read.why,
      announced: this.profile.announces,
      scatter: choice.grooved ? PT.control.base * 0.3 : this.scatter(type),
      speed: (choice.grooved ? 0.82 : 1) * (0.86 + this.profile.velocity * 0.24) * (1 - this.gas * 0.16),
    };
  }
}

/* ============================================================================
   5. The delivery — clips, authored here, registered under a `pitch:` prefix
   ========================================================================= */

/** Arm slots, at release. Follows the animation piece's convention: armR throws. */
const SLOT = {
  over: { rx: 158, rz: -8, elb: 8, lean: -42, head: 22 },
  three: { rx: 130, rz: -30, elb: 16, lean: -34, head: 20 },
  side: { rx: 92, rz: -62, elb: 30, lean: -16, head: 12 },
  push: { rx: 104, rz: -20, elb: 40, lean: -22, head: 16 },
  up: { rx: 116, rz: -6, elb: 22, lean: 10, head: -14 },       // the lofter: leans back
};

/**
 * One delivery, built from six knobs. Every variant keeps the same beat structure —
 * anticipation, gather, a HELD leg-kick apex, the stride with the arm still back, the
 * release, the fall-off — and differs in the places a hitter is supposed to be reading:
 * how high the knee gets, how far the hands go over the head, the arm slot, the tempo.
 */
function delivery(name, k) {
  const d = k.dur ?? PT.windup;
  const s = SLOT[k.slot] || SLOT.three;
  const kick = k.kick ?? 1;             // 0 = no leg lift at all, 1.2 = over the belt
  const hands = k.hands ?? 1;           // how far over the head the coil goes
  const turn = k.turn ?? 1;             // how much the shoulders close off
  const apex = PT.apexAt * d;
  const hold = (k.hold ?? PT.apexHold);
  const rel = PT.releaseAt * d;

  return clip(name, {
    dur: d,
    events: [
      { t: apex, name: 'apex' },
      { t: rel, name: 'release' },
    ],
    keys: [
      // 0 — set. On the manhole, ball behind the hip.
      { t: 0, ease: 'out', pose: {
        chest: { rx: -8, ry: 6 }, neck: { rx: 6, ry: -4 },
        armL: { rx: 46, rz: 22 }, elbL: [84, 0, 0], armR: { rx: 40, rz: -18 }, elbR: [76, 0, 0],
        kneeL: [-12, 0, 0], kneeR: [-10, 0, 0], legL: { rz: -6 }, legR: { rz: 6 },
      } },
      // 1 — ANTICIPATION: everything goes the wrong way first (10 frames)
      { t: 0.17 * d, ease: 'out', pose: {
        chest: { rx: 12 + 4 * hands, ry: 8 * turn }, neck: { rx: 16 },
        armL: { rx: 60 + 104 * hands, rz: 14 }, elbL: [30 + 54 * (1 - hands), 0, 0],
        armR: { rx: 58 + 102 * hands, rz: -14 }, elbR: [30 + 50 * (1 - hands), 0, 0],
        kneeL: [-8, 0, 0], kneeR: [-24, 0, 0], legR: { rx: -10 },
        base: { py: 0.06 * hands, sy: 0.03 }, brim: [-9 * hands, 0, 0],
      } },
      // 2 — gather. Hands down to the chest, the knee starts up.
      { t: 0.33 * d, ease: 'hold', pose: {
        chest: { rx: -6, ry: 20 * turn }, neck: { rx: 4, ry: -22 * turn },
        armL: { rx: 66, rz: 26 }, elbL: [110, 0, 0], armR: { rx: 60, rz: -22 }, elbR: [106, 0, 0],
        legL: { rx: 30 * kick }, kneeL: [-56 * kick, 0, 0], kneeR: [-14, 0, 0],
        base: { py: -0.04 },
      } },
      // 3 — LEG KICK APEX. The pose the whole street imitates.
      { t: apex, ease: 'out', pose: {
        hips: { ry: 22 * turn, rz: -7 * kick },
        chest: { rx: 6 + (k.lean ?? 0), ry: 46 * turn }, neck: { rx: 8, ry: -52 * turn },
        armL: { rx: 58, rz: 34 }, elbL: [126, 0, 0], armR: { rx: -34 - 20 * hands, rz: -34 }, elbR: [96, 0, 0],
        legL: { rx: 118 * kick, rz: 12 }, kneeL: [-124 * kick, 0, 0], footL: [30 * kick, 0, 0],
        legR: { rx: -6, rz: 3 }, kneeR: [-5, 0, 0], footR: [-14 * kick, 0, 0],
        base: { py: 0.20 * kick, sy: 0.06, sx: -0.03, sz: -0.03 }, brim: [-9, 0, 0], shirt: [-12, 0, 0],
      } },
      // 3b — held. Only the hair, the brim and the shirttail move.
      { t: apex + hold, ease: 'hold', pose: {
        hips: { ry: 26 * turn, rz: -9 * kick },
        chest: { rx: 8 + (k.lean ?? 0), ry: 52 * turn }, neck: { rx: 10, ry: -58 * turn },
        armL: { rx: 60, rz: 36 }, elbL: [130, 0, 0], armR: { rx: -40 - 22 * hands, rz: -36 }, elbR: [100, 0, 0],
        legL: { rx: 124 * kick, rz: 14 }, kneeL: [-130 * kick, 0, 0], footL: [34 * kick, 0, 0],
        legR: { rx: -6, rz: 3 }, kneeR: [-3, 0, 0], footR: [-16 * kick, 0, 0],
        base: { py: 0.23 * kick, sy: 0.07, sx: -0.035, sz: -0.035 }, brim: [-4, 0, 0], shirt: [-6, 0, 0],
      } },
      // 4 — stride. Front foot reaches, the arm is STILL BACK. That is the separation.
      { t: 0.82 * d, ease: 'drive', pose: {
        hips: { ry: 8 * turn },
        chest: { rx: -10 + (k.lean ?? 0) * 0.6, ry: 32 * turn }, neck: { rx: 4, ry: -42 * turn },
        armL: { rx: 84, rz: 26 }, elbL: [70, 0, 0], armR: { rx: -112, rz: -26 + s.rz * 0.35 }, elbR: [66, 0, 0],
        legL: { rx: 54 * (k.stride ?? 1), rz: 14 }, kneeL: [-26, 0, 0], footL: [-14, 0, 0],
        legR: { rx: -24 }, kneeR: [-28, 0, 0],
        base: { py: -0.18, pz: -0.40 * (k.stride ?? 1) }, shirt: [-18, 0, 0],
      } },
      // 5 — RELEASE. Arm slot decides what this looks like, and it is the tell.
      { t: rel, ease: 'whip', pose: {
        chest: { rx: s.lean, ry: -24 * turn }, neck: { rx: s.head, ry: -10 },
        armL: { rx: 22, rz: 30 }, elbL: [46, 0, 0], armR: { rx: s.rx * 0.86, rz: s.rz }, elbR: [s.elb + 18, 0, 0],
        legL: { rx: 34 * (k.stride ?? 1), rz: 10 }, kneeL: [-10, 0, 0],
        legR: { rx: -46 }, kneeR: [-64, 0, 0],
        base: { py: -0.26, pz: -0.66 * (k.stride ?? 1) }, shirt: [26, 0, 0], brim: [14, 0, 0],
      } },
      // 6 — fall off. Follow-through and overlap, never a snap back to rest.
      { t: d, ease: 'whip', pose: {
        chest: { rx: s.lean - 6, ry: -30 * turn }, neck: { rx: s.head + 4, ry: -8 },
        armL: { rx: 14, rz: 32 }, elbL: [40, 0, 0], armR: { rx: s.rx, rz: s.rz * 0.8 }, elbR: [s.elb, 0, 0],
        legL: { rx: 30 * (k.stride ?? 1), rz: 10 }, kneeL: [-6, 0, 0],
        legR: { rx: -58 }, kneeR: [-78, 0, 0],
        base: { py: -0.30, pz: -0.74 * (k.stride ?? 1) }, shirt: [34, 0, 0], brim: [20, 0, 0],
      } },
    ],
  });
}

/**
 * The look-in. One second long and always played at whatever speed fills the set beat,
 * so a kid who counts to three and a kid who just throws use the same body.
 */
function lookInClip() {
  return clip('pitch:lookin', {
    dur: 1.0, ease: 'hold',
    events: [{ t: 0.62, name: 'nod' }],
    keys: [
      { t: 0.0, pose: { chest: { rx: -8, ry: 6 }, neck: { rx: 6, ry: -4 },
        armL: { rx: 46, rz: 22 }, elbL: [84, 0, 0], armR: { rx: 30, rz: -26 }, elbR: [58, 0, 0],
        kneeL: [-12, 0, 0], kneeR: [-10, 0, 0] } },
      // hides the ball behind the hip and looks up the block
      { t: 0.30, ease: 'hold', pose: { chest: { rx: -6, ry: 16 }, neck: { rx: -4, ry: -30 },
        armL: { rx: 40, rz: 20 }, elbL: [70, 0, 0], armR: { rx: -22, rz: -12 }, elbR: [64, 0, 0],
        kneeL: [-14, 0, 0], kneeR: [-8, 0, 0], base: { py: -0.04 }, brim: [-5, 0, 0] } },
      // finds the catcher
      { t: 0.62, ease: 'snap', pose: { chest: { rx: -10, ry: 2 }, neck: { rx: 10, ry: 4 },
        armL: { rx: 44, rz: 22 }, elbL: [80, 0, 0], armR: { rx: -18, rz: -10 }, elbR: [70, 0, 0],
        kneeL: [-16, 0, 0], kneeR: [-12, 0, 0], base: { py: -0.06 }, brim: [4, 0, 0] } },
      // the nod, and set
      { t: 0.80, ease: 'snap', pose: { chest: { rx: -12, ry: 4 }, neck: { rx: 20, ry: 2 },
        armL: { rx: 46, rz: 22 }, elbL: [84, 0, 0], armR: { rx: -14, rz: -10 }, elbR: [74, 0, 0],
        kneeL: [-16, 0, 0], kneeR: [-12, 0, 0], base: { py: -0.07 } } },
      { t: 1.0, ease: 'settle', pose: { chest: { rx: -8, ry: 6 }, neck: { rx: 8, ry: -2 },
        armL: { rx: 46, rz: 22 }, elbL: [84, 0, 0], armR: { rx: 34, rz: -20 }, elbR: [74, 0, 0],
        kneeL: [-13, 0, 0], kneeR: [-11, 0, 0], base: { py: -0.03 } } },
    ],
  });
}

let clipsReady = false;
function registerClips() {
  if (clipsReady) return;
  clipsReady = true;
  const add = (name, c) => { if (!CLIPS[name]) CLIPS[name] = c; };
  add('pitch:lookin', lookInClip());
  add('pitch:heat', delivery('pitch:heat', { dur: 0.88, slot: 'over', kick: 1.12, hands: 1.0, turn: 1.0, stride: 1.1 }));
  add('pitch:slow', delivery('pitch:slow', { dur: 0.94, slot: 'three', kick: 1.05, hands: 0.95, turn: 0.95, stride: 0.72 }));
  add('pitch:wobble', delivery('pitch:wobble', { dur: 1.00, slot: 'push', kick: 0.28, hands: 0.35, turn: 0.7, stride: 0.8, hold: 0.2 }));
  add('pitch:loft', delivery('pitch:loft', { dur: 1.08, slot: 'up', kick: 0.5, hands: 0.75, turn: 0.6, stride: 0.42, lean: 16, hold: 0.22 }));
  add('pitch:skip', delivery('pitch:skip', { dur: 0.84, slot: 'side', kick: 0.72, hands: 0.6, turn: 1.15, stride: 1.25, lean: -10 }));
  add('pitch:easy', delivery('pitch:easy', { dur: 1.02, slot: 'push', kick: 0.2, hands: 0.25, turn: 0.4, stride: 0.35, lean: 8, hold: 0.26 }));
}

/* ============================================================================
   6. The chalk ring — the whole mind-game, rendered as one shape (§11)
   ========================================================================= */

const vrng = new RNG(8125);
const css = (h) => hexCSS(h);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

/**
 * The chalk ring: BYB's grey pitch-location circle, redrawn as something a kid actually
 * has in his pocket (§11). Hand-wobbled, broken, scuffed, and carrying BOTH treatments
 * from §2.5 — a fat ink line with the chalk laid inside it — so it clears 3:1 against
 * the road, against brick, and against a kid's shirt, which no single value does.
 */
function ringTexture() {
  const S = 320;
  const [c, g] = makeCanvas(S, S);
  const R = new RNG(4413);
  const mid = S / 2, rad = S * 0.355;
  const stroke = (color, width, gaps, wob) => {
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
    let a = R.range(0, 1);
    while (a < 6.2831) {
      const len = R.range(0.55, 1.5);
      g.beginPath();
      const steps = 12;
      for (let i = 0; i <= steps; i++) {
        const t = a + (len * i) / steps;
        const rr = rad + Math.sin(t * 3.1 + 0.7) * S * wob + Math.sin(t * 7.3) * S * wob * 0.4;
        const x = mid + Math.cos(t) * rr, y = mid + Math.sin(t) * rr * 0.985;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      a += len + R.range(0.015, gaps);
    }
  };
  // ink first, wide; chalk laid inside it. Both, always, at every size.
  stroke(css(INK), S * 0.070, 0.055, 0.009);
  stroke(css(CHALK), S * 0.032, 0.10, 0.009);
  // four crosshair ticks, the way a kid marks a spot he means
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const a = i * 1.5708 + 0.36;
    const x0 = mid + Math.cos(a) * rad * 0.52, y0 = mid + Math.sin(a) * rad * 0.52;
    const x1 = mid + Math.cos(a) * rad * 0.80, y1 = mid + Math.sin(a) * rad * 0.80;
    g.strokeStyle = css(INK); g.lineWidth = S * 0.040;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = css(CHALK); g.lineWidth = S * 0.018;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  // scuff: chalk on stone is already half gone
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    g.globalAlpha = R.range(0.08, 0.42);
    g.beginPath();
    g.ellipse(R.range(0, S), R.range(0, S), R.range(2, 8), R.range(2, 6), R.range(0, 3), 0, 6.3);
    g.fill();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** The chalk X the skipper is aimed at, laid flat on the block. */
function crossTexture() {
  const S = 128;
  const [c, g] = makeCanvas(S, S);
  const R = new RNG(9001);
  const bar = (x0, y0, x1, y1, color, w) => {
    g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const x = THREE.MathUtils.lerp(x0, x1, t) + R.range(-2, 2);
      const y = THREE.MathUtils.lerp(y0, y1, t) + R.range(-2, 2);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  };
  bar(22, 22, 106, 106, css(INK), 15); bar(106, 22, 22, 106, css(INK), 15);
  bar(22, 22, 106, 106, css(CHALK), 8); bar(106, 22, 22, 106, css(CHALK), 8);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 40; i++) {
    g.globalAlpha = R.range(0.1, 0.6);
    g.beginPath(); g.ellipse(R.range(0, S), R.range(0, S), R.range(2, 7), R.range(2, 6), 0, 0, 6.3); g.fill();
  }
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * A torn card with the pitch's name inked on it, the way this block writes anything
 * down (§11: four chalk tallies on a torn card). Used by the chalk diagram, where a
 * critic has to be able to READ it at 1600×900 — so the title owns the card.
 */
function cardTexture(title, sub, num) {
  const W = 560, H = 350;
  const [c, g] = makeCanvas(W, H);
  const R = new RNG(1700 + title.length * 37 + num * 11);

  // torn paper: four hand-walked edges, never a rectangle
  const path = () => {
    g.beginPath();
    const pts = [[14, 14], [W - 14, 14], [W - 14, H - 14], [14, H - 14]];
    for (let e = 0; e < 4; e++) {
      const [x0, y0] = pts[e], [x1, y1] = pts[(e + 1) % 4];
      const n = 22;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const nx = -(y1 - y0), ny = (x1 - x0), l = Math.hypot(nx, ny) || 1;
        const j = R.range(-4.5, 4.5);
        const x = x0 + (x1 - x0) * t + (nx / l) * j;
        const y = y0 + (y1 - y0) * t + (ny / l) * j;
        if (e === 0 && i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
    }
    g.closePath();
  };
  g.fillStyle = css(CLOTH[0]); path(); g.fill();
  g.strokeStyle = css(INK); g.lineWidth = 5; path(); g.stroke();

  const F = '"DejaVu Serif","Liberation Serif","FreeSerif",serif';
  g.textBaseline = 'alphabetic';

  // the numeral, chalked on an inked disc
  g.fillStyle = css(INK);
  g.beginPath(); g.ellipse(78, 104, 50, 50, 0, 0, 6.3); g.fill();
  g.fillStyle = css(CHALK);
  g.font = `700 74px ${F}`; g.textAlign = 'center';
  g.fillText(String(num), 78, 130);

  // the name, fitted, hand-set glyph by glyph so it wobbles like lettering
  g.textAlign = 'left';
  g.fillStyle = css(INK);
  let size = 88;
  g.font = `700 ${size}px ${F}`;
  while (g.measureText(title).width > W - 190 && size > 30) { size -= 3; g.font = `700 ${size}px ${F}`; }
  let x = 150;
  for (const ch of title) {
    g.save();
    g.translate(x, 132 + R.range(-2.5, 2.5));
    g.rotate(R.range(-0.018, 0.018));
    g.fillText(ch, 0, 0);
    g.restore();
    x += g.measureText(ch).width + size * 0.02;
  }

  // a hand-drawn rule, then the note
  g.strokeStyle = css(0x6b5545); g.lineWidth = 4;
  g.beginPath();
  for (let i = 0; i <= 14; i++) g[i ? 'lineTo' : 'moveTo'](40 + i * ((W - 80) / 14), 180 + R.range(-2, 2));
  g.stroke();

  g.font = `italic 400 44px ${F}`;
  g.fillStyle = css(0x4a3a30);
  const words = sub.split(' ');
  let line = '', y = 228, lines = 0;
  for (const wd of words) {
    const test = line ? `${line} ${wd}` : wd;
    if (g.measureText(test).width > W - 76 && line) { g.fillText(line, 38, y); y += 50; line = wd; if (++lines >= 2) break; }
    else line = test;
  }
  if (line && lines < 3) g.fillText(line, 38, y);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ============================================================================
   7. The system — bodies, the ring, the ball in the hand
   ========================================================================= */

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

const pitching = {
  name: 'pitching',
  order: 26,

  init(app) {
    registerClips();
    this.ai = new PitcherAI();
    this.phase = 'idle';
    this.t = 0;
    this.choice = null;
    this.delivery = null;
    this.staged = null;
    this.ringT = 0;
    this.markT = 0;
    this.ringWanted = false;
    this.movedCam = false;

    // ── the chalk ring: shared information, batter and pitcher alike ────────
    const rg = new THREE.PlaneGeometry(1, 1);
    this.ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
      map: ringTexture(), transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, color: 0xffffff, fog: false,
    }));
    this.ring.scale.setScalar(PT.ring.feet);
    this.ring.renderOrder = 6;
    this.ring.position.set(0, 2.6, PT.plateZ);
    this.ring.rotation.z = 0.05;
    app.scene.add(this.ring);

    // the chalk X the skipper is thrown at
    this.mark = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({
      map: crossTexture(), transparent: true, opacity: 0, depthWrite: false, fog: true,
    }));
    this.mark.rotation.x = -Math.PI / 2;
    this.mark.rotation.z = 0.22;
    this.mark.position.set(0, 0.05, 10);
    this.mark.renderOrder = 5;
    app.scene.add(this.mark);

    // the ball in the hand, before it is anywhere else
    this.held = ballMesh(T.ball.radius * 1.12, 'worn');
    this.held.visible = false;
    app.scene.add(this.held);

    app.pitching = this;

    // things that rattle a twelve-year-old
    bus.on('hit', (p) => this.ai.shake(p.bases >= 3 ? PT.rattle.hardHit : PT.rattle.hit, 'hit'));
    bus.on('walk', () => this.ai.shake(PT.rattle.walk, 'walk'));
    bus.on('run', () => this.ai.shake(PT.rattle.run, 'run'));
    bus.on('strike', () => { this.ai.rattle = Math.max(0, this.ai.rattle - 0.09); });
    bus.on('out', () => { this.ai.rattle = Math.max(0, this.ai.rattle - 0.16); });
  },

  /** Housekeeping between scenarios: the chalk diagram belongs to exactly one of them. */
  onScenario(name) {
    if (diagram) diagram.group.visible = name === 'pitch_types';
    this.markT = 0;
    this.ringT = name === 'pitch_types' ? 0 : this.ringT;
  },

  /** The kid the players system actually seated on the manhole. */
  pitcherKid() {
    const pl = APP.get('players');
    const k = pl && pl.pitcher;
    if (!k) return null;
    return k;
  },

  /** Show a named pitch on the next delivery. Used by the showcase scenarios. */
  force(id, spot) { this.ai.forced = id || null; this.ai.forcedSpot = spot || null; return this; },

  /** Public: the roster record of whoever is pitching. */
  pitcher() { return this.ai.profile.kid; },
  get juice() { return this.ai.juice; },
  get rattle() { return this.ai.rattle; },
  get types() { return PITCHES; },
  get zone() { return PT.zone; },

  /** Public: everything the batting piece needs to solve the pitch it is facing. */
  timing(sim = APP.sim) {
    const p = sim.pitch;
    if (!p) return { flight: sim.timeToPlate, ready: false, decideBy: sim.timeToPlate * 0.45 };
    return {
      ready: true,
      flight: p.flight,
      elapsed: sim.pitchT,
      remaining: Math.max(0, p.flight - sim.pitchT),
      decideBy: p.flight * 0.52,
      cross: p.cross,
      aim: p.aim,
      window: T.pitch.plateWindow,
    };
  },

  /** Public: the line the announcer says. */
  describe(p = APP.sim.pitch) {
    if (!p) return '';
    if (p.grooved) return `${this.ai.profile.nick} lays one in — ${p.crow}`;
    return `${p.spoken}, ${p.note}`;
  },

  // ── staging the body ─────────────────────────────────────────────────────
  stage(what) {
    if (this.staged === what) return;
    this.staged = what;
    const k = this.pitcherKid();
    if (!k) return;
    try {
      if (what === 'lookin') {
        const dur = this.setDur;
        k.act('pitch:lookin', { state: 'pitch', lock: dur + 0.05, fade: 0.16, speed: 1 / Math.max(0.2, dur) });
        const rit = this.ai.profile.ritual;
        if (rit.clip && CLIPS[rit.clip]) k.flavour(rit.clip, { amp: 0.85, life: Math.min(dur * 0.9, 1.1) });
        k.setFace(this.ai.rattle > 0.55 ? 'shock' : 'squint', dur);
      } else if (what === 'windup') {
        const cl = CLIPS[this.deliveryName] || CLIPS.windup;
        k.act(this.deliveryName, { state: 'pitch', lock: cl.dur + 0.02, fade: 0.07 });
        k.setFace(this.choice.type.face, cl.dur + 0.3);
      }
    } catch (e) { /* the players piece is mid-rebuild; the sim keeps running */ }
  },

  /** Put the held ball in the throwing hand, wherever that hand currently is. */
  syncHeld(visible) {
    const k = this.pitcherKid();
    this.held.visible = false;
    if (!visible || !k) return;
    const hand = k.rig?.get?.('handR') || k.rig?.get?.('elbR');
    if (!hand) return;
    hand.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(hand.matrixWorld);
    // just clear of the wrist, on the outside of the fist
    _w.set(0, -0.20 * (k.scale || 1), 0).applyMatrix4(hand.matrixWorld);
    this.held.position.lerpVectors(_v, _w, 0.55);
    this.held.visible = true;
  },

  /**
   * Where the ball leaves. Taken off the throwing SHOULDER plus an arm's reach in the
   * direction the slot points, not off the hand mesh — by the frame the sim asks, the
   * hand has already swung through and down, and a ball that starts at a kid's knee
   * looks like a bowling delivery.
   */
  releasePoint(out = new THREE.Vector3()) {
    const k = this.pitcherKid();
    const pr = this.ai.profile;
    const scale = (k && k.scale) || 0.85;
    const H = 4.9 * scale;                     // this kid's height, in feet
    const reach = H * 0.46;
    const sh = H * 0.78;                       // shoulder
    const S = { over: 0.94, three: 0.74, side: 0.10, push: 0.46, up: 0.82 }[pr.slot] ?? 0.74;
    const lat = Math.sqrt(Math.max(0, 1 - S * S));
    out.set(
      -(H * 0.13 + reach * lat * 0.62),        // the throwing side
      sh + reach * S,
      PT.moundZ - PT.release.stride,
    );
    if (k) { out.x += k.pos.x; out.z = k.pos.y - PT.release.stride; }
    out.y = THREE.MathUtils.clamp(out.y, 2.9, 6.2);
    return out;
  },

  lateUpdate(dt, app) {
    // the ring is up for exactly as long as a pitch is a live question
    const ph = app.sim.state.phase;
    this.ringWanted = !!this.choice && (ph === 'wind_up' || ph === 'pitch');
    const want = this.ringWanted ? 1 : 0;
    this.ringT = THREE.MathUtils.clamp(this.ringT + (want ? dt / 0.16 : -dt / 0.30), 0, 1);
    const m = this.ring.material;
    m.opacity = 0.94 * this.ringT;
    this.ring.visible = this.ringT > 0.01;
    if (this.ring.visible && this.choice) {
      const shake = this.ai.rattle * 0.16;
      const ph = app.time * 7.3;
      this.ring.position.set(
        this.choice.aim.x + Math.sin(ph) * shake,
        this.choice.aim.y + Math.cos(ph * 1.37) * shake,
        PT.plateZ + 0.06,
      );
      const pop = 1 + 0.22 * (1 - this.ringT) + 0.03 * Math.sin(app.time * 3.1);
      this.ring.scale.setScalar(PT.ring.feet * pop);
    }
    this.mark.material.opacity = 0.85 * this.markT;
    this.mark.visible = this.markT > 0.01;
    this.markT = Math.max(0, (this.markT || 0) - dt / 0.9);

    if (app.sim.state.phase === 'wind_up' && this.phase !== 'idle') this.syncHeld(true);
    else this.held.visible = false;
  },
};

registerSystem(pitching);

/* ============================================================================
   8. The slot
   ========================================================================= */

const impl = {
  /**
   * The whole delivery is staged here: which kid, which pitch, which spot, and how long
   * the theatre runs. `sim.timer` is the contract; the phase machine below is ours.
   */
  beginWindup(sim) {
    const P = APP.pitching;
    if (!P) { sim.timer = 0.9; return; }
    const k = P.pitcherKid();
    if (k && k.spec && k.spec.id) P.ai.adopt(k.spec.id);

    const choice = P.ai.choose(sim);
    P.choice = choice;
    P.setDur = P.ai.profile.setTime + PT.lookIn;
    P.deliveryName = CLIPS[choice.type.delivery] ? choice.type.delivery : 'windup';
    const dur = (CLIPS[P.deliveryName] || CLIPS.windup).dur;
    P.windupDur = dur;
    P.releaseT = P.setDur + dur * PT.releaseAt;
    P.apexT = P.setDur + dur * PT.apexAt;
    P.phase = 'lookin';
    P.staged = null;
    P.t = 0;
    P.told = false;
    sim.timer = P.releaseT;

    sim.pitchKind = choice.type.id;
    bus.emit('pitch:selected', {
      who: P.ai.profile.id, nick: P.ai.profile.nick,
      kind: choice.type.id, label: choice.type.label, spoken: choice.type.spoken,
      aim: choice.aim.clone(), grooved: choice.grooved,
      announced: choice.announced, why: choice.why,
      ritual: P.ai.profile.ritual.say,
      juice: { ...P.ai.juice }, rattle: P.ai.rattle,
    });
    if (choice.grooved) bus.emit('pitch:groove', { to: choice.batter?.id, from: P.ai.profile.id, crow: choice.type.crow });
    // Kathleen says out loud what she is about to throw. It is not a trick and it still works.
    if (choice.announced) bus.emit('pitch:called', { by: P.ai.profile.id, label: choice.type.label });
  },

  updateWindup(dt, sim) {
    const P = APP.pitching;
    if (!P) { sim.timer -= dt; return sim.timer <= 0; }
    P.t += dt;
    if (P.phase === 'lookin') {
      P.stage('lookin');
      if (P.t >= P.setDur) { P.phase = 'windup'; P.stage('windup'); }
    } else if (P.phase === 'windup') {
      P.stage('windup');
      if (!P.told && P.t >= P.apexT + (P.choice?.type?.tell?.at ?? 0.3) * 0.2) {
        P.told = true;
        bus.emit('pitch:tell', {
          kind: P.choice.type.id, cue: P.choice.type.tell.cue,
          read: P.choice.type.tell.read, before: Math.max(0, P.releaseT - P.t),
        });
      }
    }
    sim.timer = Math.max(0, P.releaseT - P.t);
    return P.t >= P.releaseT;
  },

  /**
   * The ball leaves the hand. Everything downstream — the batting piece's timing, the
   * rules piece's zone call, the announcer's line — is decided right here.
   */
  release(sim) {
    const P = APP.pitching;
    if (!P || !P.choice) { return fallbackRelease(sim); }
    const c = P.choice;
    const p0 = P.releasePoint();

    // where it actually goes: the spot, plus whatever his arm has left
    const sc = c.scatter;
    const hand = p0.x > 0 ? -1 : 1;
    const cross = new THREE.Vector3(
      c.aim.x + rng.range(-1, 1) * sc * 1.15,
      c.aim.y + rng.range(-1, 1) * sc * (P.ai.rattle > 0.6 ? 1.35 : 0.9),
      PT.plateZ,
    );
    cross.y = THREE.MathUtils.clamp(cross.y, 0.35, 7.2);
    cross.x = THREE.MathUtils.clamp(cross.x, -6.5, 6.5);

    const p = solve(c.type, p0, cross, {
      aim: c.aim, speed: c.speed, grooved: c.grooved, hand,
      phase: rng.range(0, 6.2831),
    });
    p.who = P.ai.profile.id;
    p.nick = P.ai.profile.nick;
    p.announced = c.announced;
    p.wild = Math.abs(p.cross.x - c.aim.x) > PT.control.wildAt || Math.abs(p.cross.y - c.aim.y) > PT.control.wildAt;
    p.rattle = P.ai.rattle;
    p.juice = { ...P.ai.juice };
    p.strike = Math.abs(p.cross.x) < PT.zone.halfW && p.cross.y > PT.zone.lo && p.cross.y < PT.zone.hi;

    sim.pitch = p;
    sim.pitchKind = p.id;
    sim.pitchTarget = p.cross.clone();
    sim.ball.pos.copy(p0);
    velAt(p, 0, sim.ball.vel);
    sim.ball.spin.copy(p.spin);

    P.flight = p.flight;
    P.ai.thrown++;
    P.ai.drain(c.type.cost);
    P.ai.rattle = Math.max(0, P.ai.rattle - PT.rattle.decay);
    P.phase = 'flight';
    P.held.visible = false;

    if (p.legs) {
      P.mark.position.set(p.bounceAt.x, 0.05, p.bounceAt.z);
      P.markT = 1;
    }
    if (p.wild) bus.emit('pitch:wild', { who: p.who, kind: p.id, off: p.cross.clone().sub(p.aim) });
    bus.emit('pitch:release', {
      kind: p.id, label: p.label, spoken: p.spoken, note: p.note,
      mph: p.speedMph, flight: p.flight, apex: p.apex, breakIn: p.breakIn,
      cross: p.cross.clone(), aim: p.aim.clone(), strike: p.strike,
      grooved: p.grooved, wild: p.wild, who: p.who,
    });
    return p;
  },

  /** Fly it. Analytic, so a replay and a live pitch agree to the foot. */
  updatePitch(dt, sim) {
    const P = APP.pitching;
    const p = sim.pitch;
    if (!p) { sim.ball.pos.addScaledVector(sim.ball.vel, dt); sim.ball.vel.y -= T.pitch.arcGravity * dt * 0.35; return; }
    const t = sim.pitchT;
    pathAt(p, t, sim.ball.pos);
    velAt(p, t, sim.ball.vel);
    if (p.bounceT !== undefined && !p.bounced && t >= p.bounceT) {
      p.bounced = true;
      bus.emit('ball:bounce', { pos: p.bounceAt.clone(), surface: 'block', pitch: p.id });
    }
  },

  // ── extras other pieces may call, all optional ──────────────────────────
  timing(sim) { return APP.pitching ? APP.pitching.timing(sim) : null; },
  describe(p) { return APP.pitching ? APP.pitching.describe(p) : ''; },
  path: pathAt,
};

function fallbackRelease(sim) {
  sim.ball.pos.set(0, PT.release.height, PT.moundZ - PT.release.stride);
  const target = new THREE.Vector3(0, 2.6, PT.plateZ);
  sim.ball.vel.copy(target).sub(sim.ball.pos).normalize().multiplyScalar(T.pitch.speed);
  sim.pitchTarget = target;
  sim.pitchKind = 'heat';
  return null;
}

provide('pitching', impl);

/* ============================================================================
   9. The diagram — WHAT HE'S GOT, chalked in the air over the block
   ========================================================================= */

let diagram = null;

/** Where the chalk diagram is hung: broadside across the block, past the manhole. */
const DIA = { z: 38, half: 20.5 };

function chalkDot() { return new THREE.SphereGeometry(0.072, 7, 5); }

/**
 * WHAT HE'S GOT — the five paths, chalked in the air across the block so you can see
 * them side on. These are not drawings of the pitches: `solve()` and `pathAt()` are the
 * same functions the live pitch flies, so a critic is looking at the real trajectories.
 * The dots are laid down at a FIXED time interval, which makes the spacing a speedometer:
 * the hummer's chalk is strung out, the lofter's is bunched up.
 */
function buildDiagram(app) {
  if (diagram) return diagram;
  const g = new THREE.Group();
  g.name = 'pitch_types_diagram';
  // built along +Z like a real pitch, then swung broadside: release at -X, plate at +X
  // +X is screen-LEFT from a camera looking up the street, so the hand goes at +X
  const lane = new THREE.Group();
  lane.rotation.y = Math.PI / 2;
  lane.position.set(-DIA.half, 0, DIA.z);
  g.add(lane);

  const geo = chalkDot();
  const dotMat = MAT.chalk({ fog: true });
  const inkMat = MAT.outline(INK, 1.9);
  // one chalk mark every 1/150 s of flight: the spacing IS the speed. The hummer comes
  // out as a strung-out dashed line, the lofter as a near-solid one.
  const STEP = 1 / 150;

  const rows = PITCH_ORDER.map((id, i) => {
    const type = PITCHES[id];
    // strictly coplanar: five curves out of nearly one hand is a diagram, five curves at
    // five depths is a cloud. They separate through the middle of the flight, which is
    // where the eye reads a pitch anyway. The small spread at the hand is the arm slot.
    const p0 = new THREE.Vector3(0, [4.55, 4.35, 3.90, 4.25, 4.45][i], PT.moundZ - PT.release.stride);
    const cross = new THREE.Vector3(0, [3.25, 2.25, 2.80, 3.05, 1.50][i], PT.plateZ);
    const p = solve(type, p0, cross, { aim: cross, hand: 1, phase: 1.1 + i * 1.7 });
    return { id, type, p, i };
  });

  for (const r of rows) {
    const n = Math.min(260, Math.max(12, Math.round(r.p.flight / STEP)));
    const dots = new THREE.InstancedMesh(geo, dotMat, n);
    const ink = new THREE.InstancedMesh(geo, inkMat, n);
    const d = new THREE.Object3D();
    for (let k = 0; k < n; k++) {
      pathAt(r.p, (k + 0.5) * (r.p.flight / n), _v);
      d.position.copy(_v);
      d.scale.setScalar(0.84 + 0.26 * Math.sin(k * 1.7));  // hand-laid, never machined
      d.updateMatrix();
      dots.setMatrixAt(k, d.matrix);
      ink.setMatrixAt(k, d.matrix);
    }
    dots.instanceMatrix.needsUpdate = true; ink.instanceMatrix.needsUpdate = true;
    dots.frustumCulled = false; ink.frustumCulled = false;
    dots.renderOrder = 4; ink.renderOrder = 3;
    lane.add(ink); lane.add(dots);

    // a real ball sitting on the path, at the moment that pitch is most itself
    const at = r.type.bounce ? r.type.bounce.at + 0.14 : r.id === 'loft' ? 0.42 : 0.58;
    const b = ballMesh(T.ball.radius * 1.55, 'new');
    pathAt(r.p, at * r.p.flight, _v);
    b.position.copy(_v);
    lane.add(b);
    r.ballLocal = _v.clone();
    r.apexLocal = (() => {
      let best = null, hi = -1e9;
      for (let k = 0; k <= 30; k++) { pathAt(r.p, (k / 30) * r.p.flight, _w); if (_w.y > hi) { hi = _w.y; best = _w.clone(); } }
      return best;
    })();
  }

  // the chalk ring at the plate end — the same shape the batter sees every pitch
  const zone = new THREE.Mesh(new THREE.PlaneGeometry(PT.ring.feet, PT.ring.feet), new THREE.MeshBasicMaterial({
    map: ringTexture(), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  zone.position.set(-DIA.half - 0.5, 2.55, DIA.z);
  zone.renderOrder = 7;
  g.add(zone);

  // five torn cards in a row above the lane, each with a chalk leader to its own arc
  for (const r of rows) {
    const tex = cardTexture(r.type.label, r.type.note, r.i + 1);
    const H = 3.15, W = H * (560 / 350);
    const card = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    );
    const cx = DIA.half - 4.2 - r.i * 8.2;
    const cy = 15.4 + (r.i % 2 ? 1.25 : 0);
    card.position.set(cx, cy, DIA.z - 1.4);
    card.renderOrder = 8;
    card.userData.billboard = true;
    card.userData.tilt = (r.i % 2 ? 1 : -1) * 0.032;
    g.add(card);

    // the leader: chalk ticks straight down from the card to its own arc
    const hit = nearestOnPath(r.p, cx);
    const to = new THREE.Vector3(cx, hit + 0.5, DIA.z - 0.2);
    const from = new THREE.Vector3(cx, cy - H * 0.5 - 0.15, DIA.z - 0.2);
    const nn = Math.max(2, Math.min(14, Math.round((from.y - to.y) / 0.52)));
    const lead = new THREE.InstancedMesh(geo, dotMat, nn);
    const leadInk = new THREE.InstancedMesh(geo, inkMat, nn);
    const d3 = new THREE.Object3D();
    for (let k = 0; k < nn; k++) {
      const u = (k + 1) / (nn + 1);
      d3.position.lerpVectors(from, to, u);
      d3.scale.setScalar(0.62);
      d3.updateMatrix();
      lead.setMatrixAt(k, d3.matrix); leadInk.setMatrixAt(k, d3.matrix);
    }
    lead.instanceMatrix.needsUpdate = true; leadInk.instanceMatrix.needsUpdate = true;
    lead.renderOrder = 4; leadInk.renderOrder = 3;
    lead.frustumCulled = false; leadInk.frustumCulled = false;
    g.add(leadInk); g.add(lead);
  }

  diagram = { group: g, rows };
  app.scene.add(g);
  g.visible = false;
  return diagram;
}

/** The height of a diagram path at a world x, so a leader can drop straight onto it. */
function nearestOnPath(p, worldX) {
  let bestY = 4, bestD = 1e9;
  for (let k = 0; k <= 60; k++) {
    pathAt(p, (k / 60) * p.flight, _w);
    const wx = -DIA.half + w2x(_w);
    const d = Math.abs(wx - worldX);
    if (d < bestD) { bestD = d; bestY = _w.y; }
  }
  return bestY;
}
/** local z (down the lane) becomes world +X after the lane is swung broadside */
const w2x = (v) => v.z;

function faceCards(app) {
  if (!diagram) return;
  for (const o of diagram.group.children) {
    if (o.userData.billboard) {
      o.lookAt(app.camera.position);
      o.rotateZ(o.userData.tilt || 0);
    }
  }
}

/* ============================================================================
   10. Scenarios
   ========================================================================= */

/** WHAT HE'S GOT — the whole arsenal in one frame, chalked broadside across the block. */
registerScenario('pitch_types', {
  seed: 1925,
  setup: () => {
    const app = APP;
    app.sim.reset(1925);
    const d = buildDiagram(app);
    d.group.visible = true;
    app.pitching.ringT = 0;
    app.pitching.markT = 0;
    app.sim.state.phase = 'idle';
    app.sim.ball.live = false; app.sim.ball.inFlight = false;
    app.camera.fov = 37;
    app.camera.position.set(0.4, 12.2, -7.5);
    app.camera.lookAt(0, 7.4, DIA.z);
    app.camera.updateProjectionMatrix();
    faceCards(app);
  },
  settle: 0.2,
});

/** The delivery, held at the leg-kick apex — the pose the whole street imitates. */
// how far into the delivery the still is taken; the film tool overrides it to 0
let WINDUP_OFFSET = null;
const WINDUP_AT = () => (WINDUP_OFFSET !== null ? WINDUP_OFFSET
  : (APP.pitching.apexT ?? 0.9) + PT.apexHold * 0.5);
globalThis.__SB_WINDUP_AT = (v) => { WINDUP_OFFSET = v; };

registerScenario('pitch_windup', {
  seed: 1926,
  setup: () => {
    const app = APP;
    app.pitching.force('heat', SPOTS.upIn);
    app.sim.reset(1926);
    app.pitching.force(null);
    app.clock.advance(WINDUP_AT());
    app.camera.fov = 46;
    app.camera.position.set(17.4, 9.2, 41.6);
    app.camera.lookAt(-1.2, 3.1, PT.moundZ + 1.2);
    app.camera.updateProjectionMatrix();
  },
  settle: 0,
});

/** Mid-flight: the ball in the air, the chalk ring waiting for it, the kid recovering. */
registerScenario('pitch_aim', {
  seed: 1927,
  setup: () => {
    const app = APP;
    app.pitching.force('heat', SPOTS.outLow);
    app.sim.reset(1927);
    app.pitching.force(null);
    const P = app.pitching;
    app.clock.advance((P.releaseT ?? 1.6) + 0.02);
    const f = app.sim.pitch ? app.sim.pitch.flight : 0.7;
    app.clock.advance(f * 0.38);
    app.camera.fov = 40;
    app.camera.position.set(6.4, 7.0, -13.2);
    app.camera.lookAt(-1.0, 3.3, 26);
    app.camera.updateProjectionMatrix();
  },
  settle: 0,
});

export default pitching;
export { impl as pitchingSlot };

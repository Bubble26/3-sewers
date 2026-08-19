import * as THREE from 'three';
import { app, registerSystem } from '../app.js';
import { provide } from './plugins.js';
import { registerScenario } from '../core/scenarios.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { rng } from '../core/rng.js';
import { CHALK, INK, PAVEMENT } from '../render/palette.js';
import { MAT, chalkTexture, slabText, slabWidth, LAYER } from '../render/materials.js';
import { PITCH_TYPES, pitchTiming, blockRoster } from './core.js';

/**
 * ============================================================================
 * BATTING — THE HOP IS THE WHOLE GAME
 * ============================================================================
 *
 * Real stickball is played with a pink rubber ball on Belgian block, and a pitcher
 * who wants a strike bounces it once in front of the plate on purpose. That single
 * hop is the mechanic this game is named for, and it is the only thing a hitter has
 * to read: how high it comes off the stone, how far it hooks, and — above all —
 * HOW LONG IT THEN TAKES TO GET TO HIM.
 *
 *      type      bounce -> plate    crosses at     press after the bounce
 *      fast          300 ms           1.93 ft            250 ms
 *      spinner       420 ms           2.84 ft            370 ms
 *      drop          580 ms           4.08 ft            530 ms
 *
 * Those are three numbers a player learns with his hands, and they are 120 ms and
 * 160 ms apart on purpose.
 *
 * ── the two findings this file is not allowed to undo ────────────────────────
 * Recorded in `T.play` and in `docs/PORT-SPEC.md`, both measured the expensive way:
 *
 *  1. THE HOP MUST CARRY INFORMATION. Fast and spinner once rebounded 1.4% apart —
 *     the read was decoration. The tuned values put the worst pair 0.76 ball
 *     diameters apart 100 ms after the bounce and 0.98 at 133 ms. `separability()`
 *     below re-measures that on OUR flight in OUR feet, every time anybody asks.
 *
 *  2. A BLIND RHYTHM MUST NOT BEAT A READ. A simulated player who ignored the ball
 *     and tapped a fixed 310 ms after every bounce scored 56.6% perfect contact
 *     against 71.5% for reading properly, because the three ideal presses spanned
 *     100 ms inside a 108 ms contact window. The gaps are now 120 ms and 160 ms,
 *     wider than that window. THE GAPS ARE NOT TO BE CLOSED.
 *
 * ── the hole that guarantee still had, and the fix ──────────────────────────
 * 108 ms was measured at an AVERAGE eye. The perfect window is
 * `2*(45 + 2.5*EYE) / (0.78 + 0.55*quality)` raw milliseconds, and our block's best
 * eye is EYE 9, +3 for Rosie's two-strike quirk and +1 for Beans on a bag — EYE 13,
 * which against a soft-armed pitcher opens the window to **174 ms**, far wider than
 * the 120 ms gap. Rosie and Fanny could cover fast AND spinner off one fixed rhythm,
 * exactly the defect the gaps exist to prevent. `rhythmAudit()` measures it for all
 * sixteen kids.
 *
 * The fix is not a narrower window and it is not a wider gap. It is this:
 *
 *      **A PRESS THAT FITS TWO PITCHES IS NOT A READ.**
 *
 * A press claims a pitch — the one whose ideal press it sits nearest. If the runner-up
 * fits nearly as well (within the batter's own perfect half-window), the press
 * identified nothing, and a swing that identified nothing cannot be perfect: the error
 * handed to the rules core is floored just outside the perfect band. The consequence
 * falls exactly where the defect is — late on a fast one, early on a spinner — and it
 * is free everywhere else, so a hitter who reads the hop is never touched by it.
 *
 * This is INPUT INTERPRETATION, not a rule: it lives entirely in how a button press
 * becomes an `errMs`. The rules the core applies to that `errMs` are byte-identical to
 * the ones `tools/soak.mjs` validates, and the CPU kid — who is looking at the ball,
 * not at a button — goes through `core.cpuSwing` untouched. There is one rulebook.
 *
 * ── and a third defect in the same family, avoided rather than fixed ─────────
 * The obvious way to draw a swing window is a prompt that lights 180 ms before the
 * ideal press. Do not: it lights 70 ms after the bounce on a fast one, 190 ms on a
 * spinner and 350 ms on a drop, so the prompt IS the read, handed over for free, and
 * the hop goes back to being decoration. Nothing in this file lights before the ball
 * arrives. The window is enforced silently; what the player gets is the ball, its
 * chalk-dust trail, the bounce mark on the stone, and — after the fact — a chalk word
 * telling him what he just did. `swing_timing` draws the window for a critic; the
 * game never does.
 *
 * ── what was found while porting the flight (core.js asked for this) ─────────
 * `core.js` flagged an apparent contradiction: read as bounce->plate, `PITCH_TB` puts
 * the drop's bounce 40 ms after release, which sits badly next to "lobs high". It
 * asked whoever built the flight to re-measure against the published table instead of
 * the constant. Done, and the table wins outright:
 *
 *   BOUNCE_REST is not a restitution coefficient. It is the rebound apex as a
 *   fraction of PITCH_ARC_H. Take arc = 280 px = 8.05 ft and g = 1500 px/s² =
 *   43.1 ft/s², and the three apexes 0.24/0.36/0.55 of it give crossing heights of
 *   1.93 / 2.84 / 4.08 ft at 300 / 420 / 580 ms — which is 67 / 99 / 142 world px,
 *   the published table to the pixel, and "low and flat at the top of its hop" /
 *   "mid hop" / "lobs high, falling" to the word.
 *
 *   Nothing in the read depends on PITCH_TIMES at all. So PITCH_TB is honoured
 *   exactly and the pre-bounce leg is however long the delivery that was actually
 *   thrown needs, which is why a drop is a lob and a fast one is fired down at the
 *   stone: a second tell, before the bounce, for free.
 */

/* ============================================================================
   0. Tuning
   Gameplay constants live in src/core/tuning.js; every number below is either read
   from T or is this piece's own dial, kept in one exported table for the same
   reason (the pitching piece keeps `PT` the same way).
   ========================================================================= */

const P = T.play;
const { clamp, lerp, degToRad } = THREE.MathUtils;

export const BT = {
  /** Their world was 2D pixels, ours is feet. One bridge, from T.play.worldPxPerFoot. */
  px: P.worldPxPerFoot,                    // 34.8 px per foot
  g: P.ballG / P.worldPxPerFoot,           // 43.1 ft/s² — their gravity, in our units
  arc: P.pitchArcH / P.worldPxPerFoot,     // 8.05 ft — PITCH_ARC_H, the throw's arc off the block

  /** A pitcher aiming high arcs it higher into the stone; every rebound scales with him. */
  arcPerAim: 1.35,
  /**
   * The floor is set BY the measurement: below it the worst pair falls under 0.76 ball
   * diameters at 100 ms and the hop stops being a tell. `separability()` proves it.
   */
  arcMin: 7.60,
  arcMax: 9.70,

  pressLead: 0.05,          // core's PRESS_LEAD: a press lands 50 ms before the ball crosses
  minPreBounce: 0.20,       // the ball has to be visibly in the air before it hits the block
  ballDia: T.ball.radius * 2,

  /** How far up the street a `carry` lands, in feet. Anchored on the sewers (95 ft apart). */
  carryNear: 5, carrySewer: 100, carryPerCarry: 528.6, carryMax: 330,
  loft: { fly: [30, 47], line: [12, 24], ground: [-4, 9] },
  spray: 0.34,              // radians of pull at lane = 1

  hitstop: { square: 0.105, glance: 0.062, nubber: 0.030, at: [0.85, 0.5] },
  dust: { bounce: 7, contact: 13 },

  trail: { dots: 22, every: 1 / 45, life: 0.42, size: 0.19 },
  verdictLife: 1.05,
  arcLife: 0.20,
  markLife: 1.30,
};

/** 250 / 370 / 530 ms — read straight off the rules core so the two can never drift. */
export const IDEAL_AFTER = Object.fromEntries(
  PITCH_TYPES.map((k) => [k, pitchTiming(k).pressAfterBounce * 1000]),
);

/** Which family a thrown pitch belongs to before the flight is allowed to argue. */
const WANT = { heat: 'fast', skip: 'fast', slow: 'spinner', wobble: 'spinner', loft: 'drop', easy: 'drop' };
const DEMOTE = { drop: 'spinner', spinner: 'fast', fast: 'fast' };

/* ============================================================================
   1. THE HOP — pure maths, no THREE, no rendering. Everything measurable is here.
   ========================================================================= */

/**
 * You cannot lob a long read out of a short throw. A drop needs 580 ms of read AND
 * enough air before the stone to look like a throw; if the delivery is too quick for
 * that, the block gets the next family down. This keeps `PITCH_TB` exact — and the
 * press gaps with it — on every flight the pitching piece can produce.
 */
export function hopType(pitchId, flight) {
  let k = WANT[pitchId] || 'spinner';
  for (let i = 0; i < 3; i++) {
    if (flight - P.pitchTB[k] >= BT.minPreBounce) return k;
    const next = DEMOTE[k];
    if (next === k) return k;
    k = next;
  }
  return k;
}

/**
 * The whole pitch, as the batter has to read it.
 *   tBounce   release -> the one bounce
 *   tb        bounce -> the plate (PITCH_TB: 300 / 420 / 580 ms — the read window)
 *   apex      how high it comes back off the stone (BOUNCE_REST x arc)
 *   yCross    where it is when it gets to you: 1.93 / 2.84 / 4.08 ft at the tuned arc
 */
export function hopPlan({ pitchId = 'heat', flight = 0.7, releaseY = 4.35, aimY = 2.6 } = {}) {
  const type = hopType(pitchId, flight);
  const tb = P.pitchTB[type];
  const tBounce = Math.max(0.08, Math.min(flight - tb, flight * 0.86));
  const arc = clamp(BT.arc + (aimY - 2.6) * BT.arcPerAim, BT.arcMin, BT.arcMax);
  const apex = P.bounceRest[type] * arc;
  const vy1 = Math.sqrt(2 * BT.g * apex);                       // straight up off the stone
  const yCross = vy1 * tb - 0.5 * BT.g * tb * tb;
  const r = T.ball.radius;
  // the throw that gets it there: solved backwards from the bounce, so a drop is a lob
  // and a fast one is fired down at the stone, which is a tell before the bounce
  const vyA = (r - releaseY + 0.5 * BT.g * tBounce * tBounce) / tBounce;
  const vImpact = Math.abs(vyA - BT.g * tBounce);
  const idealPress = flight - BT.pressLead;
  return {
    type, tb, tBounce, flight, arc, apex, vy1, yCross, releaseY,
    vyA, vImpact, restitution: vy1 / Math.max(1e-4, vImpact),
    kick: P.spinKick[type] / BT.px,                              // ft/s sideways off the hop
    idealPress,
    pressAfterBounce: IDEAL_AFTER[type] / 1000,
    windowOpen: idealPress - P.swingEarly,
    windowClose: idealPress + P.swingLate,
  };
}

/** Height of the ball `t` seconds after release, on this plan. */
export function hopY(plan, t) {
  const r = T.ball.radius;
  if (t <= plan.tBounce) return Math.max(r, plan.releaseY + plan.vyA * t - 0.5 * BT.g * t * t);
  const s = t - plan.tBounce;
  return Math.max(r * 0.6, plan.vy1 * s - 0.5 * BT.g * s * s);
}

/** Vertical speed at `t`, so trails and squash agree with the path. */
export function hopVY(plan, t) {
  if (t <= plan.tBounce) return plan.vyA - BT.g * t;
  return plan.vy1 - BT.g * (t - plan.tBounce);
}

/* ---------------------------------------------------------------------------
   1a. THE MEASUREMENTS. These exist so a retune cannot quietly undo either
   finding. Both are pure and run in plain node.
   ------------------------------------------------------------------------ */

/**
 * FINDING 1, re-measured on our flight. Worst-pair separation after the bounce, in
 * ball diameters, at the two instants the source names.
 */
export function separability(aimY = 2.6) {
  const plans = PITCH_TYPES.map((k) => hopPlan({ pitchId: { fast: 'heat', spinner: 'slow', drop: 'loft' }[k], flight: P.pitchTB[k] + 0.34, aimY }));
  const at = (s) => {
    let worst = Infinity, pair = '';
    for (let i = 0; i < plans.length; i++) {
      for (let j = i + 1; j < plans.length; j++) {
        const d = Math.abs(plans[i].vy1 - plans[j].vy1) * s / BT.ballDia;
        if (d < worst) { worst = d; pair = `${plans[i].type}/${plans[j].type}`; }
      }
    }
    return { worst, pair };
  };
  return {
    aimY,
    crossFt: plans.map((p) => +p.yCross.toFixed(2)),
    crossPx: plans.map((p) => Math.round(p.yCross * BT.px)),
    at100: at(0.100),
    at133: at(0.133),
    need: { at100: 0.76, at133: 0.98 },
    pass: at(0.100).worst >= 0.76 && at(0.133).worst >= 0.98,
  };
}

/** The three ideal presses and the gaps between them, next to the window they must beat. */
export function pressGapsHere(con = 6, quality = 0.65) {
  const t = PITCH_TYPES.map((k) => IDEAL_AFTER[k]);
  const K = P.contact;
  const eff = K.effBase + K.effPerQuality * quality;
  return {
    presses: t,
    gaps: [t[1] - t[0], t[2] - t[1]],
    perfectWindowMs: 2 * (K.perfectBase + con * K.perfectPerCon) / eff,
  };
}

/** The perfect half-window a given eye actually gets, in real milliseconds of press error. */
export function halfPerfectMs(con, quality) {
  const K = P.contact;
  return (K.perfectBase + con * K.perfectPerCon) / (K.effBase + K.effPerQuality * quality);
}

/**
 * How a press becomes the number the rules core resolves — the whole human input model,
 * pure so `rhythmAudit()` can measure it without a browser.
 *
 * `afterMs` is milliseconds since the bounce. Ambiguity is the fix described at the top
 * of this file: if the runner-up pitch fits this press within the batter's own perfect
 * half-window, nothing was identified and nothing can be perfect.
 */
export function pressErrMs(type, afterMs, con, quality) {
  const raw = afterMs - IDEAL_AFTER[type];
  const half = halfPerfectMs(con, quality);
  let rival = Infinity;
  for (const k of PITCH_TYPES) if (k !== type) rival = Math.min(rival, Math.abs(afterMs - IDEAL_AFTER[k]));
  const ambiguous = rival - Math.abs(raw) < half;
  if (!ambiguous) return raw;
  const floor = half * 1.06 + 2;
  return (raw < 0 ? -1 : 1) * Math.max(Math.abs(raw), floor);
}

/** Band a given error lands in, by the core's own thresholds. Used only for measurement. */
function bandOf(errMs, con, quality) {
  const K = P.contact;
  const eff = Math.abs(errMs) * (K.effBase + K.effPerQuality * quality);
  if (eff > K.weakBase + con * K.weakPerCon) return 'whiff';
  if (eff <= K.perfectBase + con * K.perfectPerCon) return 'perfect';
  if (eff <= K.goodBase + con * K.goodPerCon) return 'good';
  return 'weak';
}

/**
 * FINDING 2, re-measured for every kid on the block — the proof the brief asks for.
 *
 * For each batter, at his sharpest (two strikes with the eagle-eye quirk, a runner on
 * for Beans, and the softest arm on the block, which is the widest his window ever
 * gets), we search EVERY fixed delay after the bounce in 1 ms steps and report the best
 * one a blind player could pick. Then we play a reader with human-sized noise. If any
 * fixed rhythm ever gets perfect contact on more than one of the three pitches, the
 * guarantee is broken and `pass` is false.
 */
export function rhythmAudit({ roster = blockRoster(), sigmaMs = 45, quality = 0.20, seed = 7 } = {}) {
  const R = new (rng.constructor)(seed);
  const gauss = () => {
    let u = 0, v = 0;
    while (u <= 1e-9) u = R.next();
    v = R.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * v);
  };
  const kids = Object.values(roster).map((k) => {
    const con = Math.min(13, k.CON + (k.quirk === 'eagle_eye' ? P.contact.eagleEyeCon : 0) + P.contact.onHouseCon);
    return { id: k.id, name: k.nick || k.name, con };
  });

  const rows = kids.map((kid) => {
    // the best blind rhythm available to this kid, searched not guessed
    let best = { delay: 0, perfect: 0, contact: 0, covers: [] };
    for (let d = 120; d <= 700; d++) {
      let perfect = 0, contact = 0;
      const covers = [];
      for (const k of PITCH_TYPES) {
        const b = bandOf(pressErrMs(k, d, kid.con, quality), kid.con, quality);
        if (b === 'perfect') { perfect++; covers.push(k); }
        if (b !== 'whiff') contact++;
      }
      if (perfect > best.perfect || (perfect === best.perfect && contact > best.contact)) {
        best = { delay: d, perfect, contact, covers };
      }
    }
    // a reader: he knows which pitch it is and his hands are off by sigma
    let rp = 0, rc = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) {
      const k = PITCH_TYPES[i % 3];
      const press = IDEAL_AFTER[k] + gauss() * sigmaMs;
      const b = bandOf(pressErrMs(k, press, kid.con, quality), kid.con, quality);
      if (b === 'perfect') rp++;
      if (b !== 'whiff') rc++;
    }
    // and the blind player, tapping his best fixed delay with the same hands
    let bp = 0, bc = 0;
    for (let i = 0; i < N; i++) {
      const k = PITCH_TYPES[i % 3];
      const press = best.delay + gauss() * sigmaMs;
      const b = bandOf(pressErrMs(k, press, kid.con, quality), kid.con, quality);
      if (b === 'perfect') bp++;
      if (b !== 'whiff') bc++;
    }
    return {
      id: kid.id, name: kid.name, eye: kid.con,
      halfWindowMs: +halfPerfectMs(kid.con, quality).toFixed(1),
      bestBlindDelay: best.delay,
      blindCovers: best.covers,
      blindPerfectPitches: best.perfect,
      readPerfectPct: +(100 * rp / N).toFixed(1),
      blindPerfectPct: +(100 * bp / N).toFixed(1),
      readContactPct: +(100 * rc / N).toFixed(1),
      blindContactPct: +(100 * bc / N).toFixed(1),
    };
  });

  return {
    sigmaMs, quality,
    gaps: pressGapsHere(6, quality).gaps,
    rows,
    worstBlindCoverage: Math.max(...rows.map((r) => r.blindPerfectPitches)),
    minReadAdvantage: Math.min(...rows.map((r) => r.readPerfectPct - r.blindPerfectPct)),
    pass: rows.every((r) => r.blindPerfectPitches <= 1 && r.readPerfectPct > r.blindPerfectPct),
  };
}

/* ============================================================================
   2. THE LAUNCH — the core has already decided; this is how the block finds out
   ========================================================================= */

/** How far up the street a carry lands. Anchored on the castings: 95 ft apart (§1.3). */
function carryToFeet(carry) {
  const S = P.streetRules;
  if (carry <= S.sewerCarry) return lerp(BT.carryNear, BT.carrySewer, clamp((carry - 0.05) / (S.sewerCarry - 0.05), 0, 1));
  return Math.min(BT.carryMax, BT.carrySewer + (carry - S.sewerCarry) * BT.carryPerCarry);
}

/**
 * The speed that carries `dist` feet at `angle`, under the same quadratic drag the
 * spaldeen actually flies with. Solved rather than guessed, because a ball that stops
 * fifteen feet short of the casting it was graded past is a lie on screen.
 */
function solveSpeed(dist, angle, y0 = 3.0) {
  const k = T.ball.drag * 0.28 + 0.0038;    // matched to ballphysics' scaled quadratic drag
  const g = T.ball.gravity;
  const range = (v) => {
    let x = 0, y = y0, vx = v * Math.cos(angle), vy = v * Math.sin(angle);
    for (let i = 0; i < 900; i++) {
      const sp = Math.hypot(vx, vy) || 1e-6;
      vx -= k * sp * vx / 120; vy -= (k * sp * vy + g) / 120;
      x += vx / 120; y += vy / 120;
      if (y <= 0) return x;
    }
    return x;
  };
  let lo = 12, hi = 190;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (range(mid) < dist) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ============================================================================
   3. CHALK — everything this piece draws is chalk, dust or ink (DESIGN-BIBLE §11)
   ========================================================================= */

function bounceFast(g, R, s) {
  const c = s / 2;
  g.lineWidth = s * 0.05;
  for (let i = 0; i < 3; i++) {
    g.globalAlpha = 0.9 - i * 0.2;
    g.beginPath();
    g.ellipse(c, c, s * (0.20 + i * 0.10), s * (0.055 + i * 0.028), 0, 0, 6.3);
    g.stroke();
  }
  g.globalAlpha = 0.85;
  for (let i = 0; i < 9; i++) {
    const a = R.range(-0.5, 0.5);
    g.beginPath();
    g.moveTo(c + Math.cos(a) * s * 0.22, c + Math.sin(a) * s * 0.07);
    g.lineTo(c + Math.cos(a) * s * (0.34 + R.range(0, 0.1)), c + Math.sin(a) * s * 0.10);
    g.stroke();
  }
  g.globalAlpha = 1;
}

function bounceSpinner(g, R, s) {
  const c = s / 2;
  g.lineWidth = s * 0.05;
  for (let i = 0; i < 3; i++) {
    g.globalAlpha = 0.9 - i * 0.2;
    g.beginPath();
    g.ellipse(c, c, s * (0.17 + i * 0.09), s * (0.10 + i * 0.05), 0.3, 0, 6.3);
    g.stroke();
  }
  // the hook: it does not come off the stone the way it went on
  g.globalAlpha = 0.95;
  g.lineWidth = s * 0.055;
  g.beginPath();
  g.moveTo(c - s * 0.06, c + s * 0.04);
  g.quadraticCurveTo(c + s * 0.18, c + s * 0.16, c + s * 0.40, c - s * 0.02);
  g.stroke();
  g.beginPath();
  g.moveTo(c + s * 0.40, c - s * 0.02);
  g.lineTo(c + s * 0.31, c + s * 0.06);
  g.moveTo(c + s * 0.40, c - s * 0.02);
  g.lineTo(c + s * 0.30, c - s * 0.09);
  g.stroke();
  g.globalAlpha = 1;
}

function bounceDrop(g, R, s) {
  const c = s / 2;
  g.lineWidth = s * 0.055;
  for (let i = 0; i < 4; i++) {
    g.globalAlpha = 0.92 - i * 0.18;
    g.beginPath();
    g.arc(c, c, s * (0.11 + i * 0.075), 0, 6.3);
    g.stroke();
  }
  g.globalAlpha = 0.9;
  for (let i = 0; i < 12; i++) {
    const a = R.range(0, 6.283);
    const r0 = s * 0.17, r1 = s * (0.28 + R.range(0, 0.13));
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    g.stroke();
  }
  g.globalAlpha = 1;
}

const BOUNCE_DRAW = { fast: bounceFast, spinner: bounceSpinner, drop: bounceDrop };

/** A word, hand-lettered in chalk on a torn scrap of air. Period lettering, §6.1. */
function chalkWordTexture(text, { size = 512, seed = 11, sub = '' } = {}) {
  const key = `bat:word:${text}:${sub}:${seed}`;
  return chalkTexture(Object.assign((g, R, s) => {
    const h = s * (sub ? 0.30 : 0.40);
    const w = slabWidth(text, h);
    slabText(g, text, (s - w) / 2, s * (sub ? 0.52 : 0.60), h, { color: CHALK, seed, tracking: 0.20 });
    if (sub) {
      const h2 = s * 0.15;
      const w2 = slabWidth(sub, h2);
      g.globalAlpha = 0.8;
      slabText(g, sub, (s - w2) / 2, s * 0.76, h2, { color: CHALK, seed: seed + 5, tracking: 0.26 });
      g.globalAlpha = 1;
    }
  }, { name: key }), { size, seed });
}

/** A camera-facing chalk plane that pops, holds and fades. */
class ChalkPop {
  constructor(scene, { w = 4.4, h = 4.4 } = {}) {
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), MAT.chalkMark(chalkWordTexture('OK'), { opacity: 1 }));
    this.mesh.material = this.mesh.material.clone();
    this.mesh.material.depthTest = false;
    this.mesh.renderOrder = 40;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.base = new THREE.Vector3();
    this.t = 0; this.life = 0;
    scene.add(this.mesh);
  }
  say(text, pos, { sub = '', life = BT.verdictLife, scale = 1, seed = 11 } = {}) {
    this.mesh.material.map = chalkWordTexture(text, { seed, sub });
    this.mesh.material.needsUpdate = true;
    this.base.copy(pos);
    this.t = 0; this.life = life; this.scale = scale;
    this.mesh.visible = true;
  }
  update(dt, camera) {
    if (!this.mesh.visible) return;
    this.t += dt;
    const u = this.t / this.life;
    if (u >= 1) { this.mesh.visible = false; return; }
    const pop = u < 0.12 ? lerp(0.55, 1.14, u / 0.12) : u < 0.22 ? lerp(1.14, 1.0, (u - 0.12) / 0.10) : 1.0;
    this.mesh.scale.setScalar(pop * this.scale);
    this.mesh.position.copy(this.base).addScaledVector(UP, Math.min(1.4, this.t * 2.1));
    this.mesh.material.opacity = u > 0.68 ? 1 - (u - 0.68) / 0.32 : 1;
    if (camera) this.mesh.quaternion.copy(camera.quaternion);
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The dotted chalk arc the ball leaves behind it. This is the READ, drawn: in a still
 * frame the bounce and the shape of the rebound are unmistakable, which is the whole
 * reason BYB drew its pitches as arcs and not as a dot.
 */
class DustTrail {
  constructor(scene) {
    const n = BT.trail.dots;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4 * 4), 4));
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, fog: false,
      blending: THREE.NormalBlending,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.dots = [];
    this.acc = 0;
    this.col = new THREE.Color(CHALK);
  }
  clear() { this.dots.length = 0; this.mesh.visible = false; }
  push(pos, dt, big = false) {
    this.acc += dt;
    if (this.acc < BT.trail.every) return;
    this.acc = 0;
    this.dots.unshift({ p: pos.clone(), age: 0, big });
    while (this.dots.length > BT.trail.dots) this.dots.pop();
  }
  update(dt, camera) {
    for (const d of this.dots) d.age += dt;
    while (this.dots.length && this.dots[this.dots.length - 1].age > BT.trail.life) this.dots.pop();
    const n = this.dots.length;
    if (!n || !camera) { this.mesh.visible = false; return; }
    const pos = this.mesh.geometry.attributes.position;
    const col = this.mesh.geometry.attributes.color;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < BT.trail.dots; i++) {
      const d = this.dots[Math.min(i, n - 1)];
      const fade = i < n ? clamp(1 - d.age / BT.trail.life, 0, 1) : 0;
      const s = BT.trail.size * (d.big ? 1.55 : 1) * (0.45 + 0.55 * fade);
      a.copy(right).multiplyScalar(s); b.copy(up).multiplyScalar(s);
      const o = i * 4;
      pos.setXYZ(o + 0, d.p.x - a.x - b.x, d.p.y - a.y - b.y, d.p.z - a.z - b.z);
      pos.setXYZ(o + 1, d.p.x + a.x - b.x, d.p.y + a.y - b.y, d.p.z + a.z - b.z);
      pos.setXYZ(o + 2, d.p.x + a.x + b.x, d.p.y + a.y + b.y, d.p.z + a.z + b.z);
      pos.setXYZ(o + 3, d.p.x - a.x + b.x, d.p.y - a.y + b.y, d.p.z - a.z + b.z);
      const al = i < n ? fade * 0.72 : 0;
      for (let v = 0; v < 4; v++) col.setXYZW(o + v, this.col.r, this.col.g, this.col.b, al);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
    this.mesh.visible = true;
  }
}

/** The stick's own smear: a chalk crescent through the contact zone, four frames long. */
function swingArcMesh() {
  const g = new THREE.RingGeometry(1.55, 3.55, 26, 1, Math.PI * 0.06, Math.PI * 0.78);
  const m = new THREE.MeshBasicMaterial({
    color: CHALK, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 14;
  mesh.visible = false;
  return mesh;
}

/* ============================================================================
   4. THE SLOT
   ========================================================================= */

const _v = new THREE.Vector3();

const impl = {
  /** Called from sim.throwPitch, the instant the ball leaves the hand. */
  planHop(sim) {
    const p = sim.pitch;
    const flight = p && p.flight > 0 ? p.flight : sim.timeToPlate;
    const plan = hopPlan({
      pitchId: sim.pitchKind,
      flight,
      releaseY: p ? p.p0.y : T.pitch.releaseHeight,
      aimY: p ? p.cross.y : 2.6,
    });
    plan.dir = p && p.p0.x >= 0 ? -1 : 1;                  // the hook goes with his arm
    if (p && p.path) {
      p.path(plan.tBounce, _v);
      plan.bounce = new THREE.Vector3(_v.x, T.ball.radius, _v.z);
      // Hand the pitching piece its own bounce back, retimed onto the tuned read window,
      // so `ball:bounce` fires once, at the right instant, from the file that owns it.
      p.bounceT = plan.tBounce;
      p.bounceAt = plan.bounce.clone();
      p.bounced = false;
    } else {
      plan.bounce = new THREE.Vector3(0, T.ball.radius, T.street.plateZ + 14);
    }
    plan.markDone = false;
    return plan;
  },

  /** The hop itself: pitching owns where it goes, this owns how it gets there. */
  shapeFlight(dt, sim, tail = false) {
    const h = sim.hop;
    if (!h) return;
    const t = sim.pitchT;
    const b = sim.ball;
    b.pos.y = hopY(h, t);
    if (t > h.tBounce) {
      const s = t - h.tBounce;
      b.pos.x += h.dir * h.kick * s;
      b.vel.x += h.dir * h.kick;
    }
    b.vel.y = hopVY(h, t);
    if (!tail) system.onFlight(sim, h, t, dt);
  },

  onSwingInput(sim, kind, jumped) {
    system.onSwing(sim, kind, !!jumped);
  },

  /**
   * The human input model. Everything about how a press becomes a rules-core error is
   * in `pressErrMs`; this only reads the batter's real eye and the real pitch quality
   * out of the core so the two can never fall out of step.
   */
  errMsFor(sim, pressT) {
    const h = sim.hop;
    if (!h) return (pressT - (sim.timeToPlate - BT.pressLead)) * 1000;
    const afterMs = (pressT - h.tBounce) * 1000;
    const con = sim.core.con(sim.core.batterId());
    const q = sim.corePitch ? sim.corePitch.quality : 0.65;
    return pressErrMs(h.type, afterMs, con, q);
  },

  /** The verdict is in — say it in chalk before the ball has landed. */
  onVerdict(sim, ev) { system.onVerdict(sim, ev); },

  onReset(sim) { system.onReset(sim); },

  /**
   * Turn the core's verdict into a ball you can watch. carry decides how far up the
   * street it lands, loft decides the angle, lane decides the spray — and the speed is
   * SOLVED for that distance so a two-sewer shot genuinely clears the second casting.
   */
  launch(sim, ev) {
    const q = clamp(ev.quality ?? 0.5, 0, 1);
    const loft = ev.loft || 'line';
    const band = BT.loft[loft] || BT.loft.line;
    const angle = degToRad(lerp(band[0], band[1], q * 0.7 + rng.range(0, 0.3)));
    const spray = (ev.lane ?? 0) * BT.spray + rng.range(-0.04, 0.04);

    let speed;
    if (loft === 'ground') {
      speed = lerp(26, 78, clamp(ev.carry / 0.9, 0, 1));
    } else {
      speed = solveSpeed(carryToFeet(ev.carry ?? 0.4), Math.max(0.12, angle));
    }

    const b = sim.ball;
    const contactZ = T.street.plateZ + 1.1;
    const contactY = clamp(sim.hop ? sim.hop.yCross : 2.8, 1.5, 4.4);
    b.pos.set(clamp(sim.hop ? sim.hop.dir * 0.4 : 0, -1.4, 1.4), contactY, contactZ);
    b.vel.set(
      Math.sin(spray) * speed * Math.cos(angle),
      Math.sin(angle) * speed,
      Math.cos(spray) * speed * Math.cos(angle),
    );

    const kind = q >= 0.85 ? 'square' : q >= 0.5 ? 'glance' : 'nubber';
    const hit = {
      quality: q, power: speed, angleDeg: angle * 57.2957795, sprayRad: spray, kind,
      carry: ev.carry, lane: ev.lane, loft, sewers: ev.sewers || 0,
      window: !!ev.window, fireEscape: !!ev.fireEscape, flivver: !!ev.flivver,
      distFt: Math.round(carryToFeet(ev.carry ?? 0.4)),
      hitstop: q >= BT.hitstop.at[0] ? BT.hitstop.square : q >= BT.hitstop.at[1] ? BT.hitstop.glance : BT.hitstop.nubber,
      pos: b.pos.clone(),
    };
    system.onContact(sim, hit);
    return hit;
  },
};

provide('batting', impl);

/* ============================================================================
   5. THE SYSTEM — dust, chalk, the stick's smear, and the diagrams
   ========================================================================= */

const system = registerSystem({
  name: 'batting',
  order: 62,

  init(app) {
    this.group = new THREE.Group();
    this.group.name = 'batting_fx';
    app.scene.add(this.group);

    this.trail = new DustTrail(this.group);
    this.pop = new ChalkPop(this.group, { w: 5.0, h: 5.0 });
    this.arc = swingArcMesh();
    this.group.add(this.arc);
    this.arcT = 0;

    // the scuff the ball leaves on the stone, one per hop family
    this.marks = {};
    for (const k of PITCH_TYPES) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 3.6),
        MAT.chalkMark(chalkTexture(BOUNCE_DRAW[k], { size: 256, seed: 40 + PITCH_TYPES.indexOf(k) }), { opacity: 0.9 }).clone(),
      );
      m.material = m.material.clone();
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.035;
      m.renderOrder = LAYER.chalk;
      m.visible = false;
      this.marks[k] = m;
      this.group.add(m);
    }
    this.markT = 0; this.markKind = 'fast';

    this.chart = null;         // hop_read
    this.timing = null;        // swing_timing
    this.app = app;
    this.bindInput(app);

    // one line in the console-free world: the two measurements, on the app object,
    // so a critic can call them from the harness without reading this file.
    app.batting = {
      BT, hopPlan, hopY, hopType, pressErrMs, IDEAL_AFTER,
      separability, rhythmAudit, pressGaps: pressGapsHere, halfPerfectMs,
      window: () => app.sim.swingWindow(),
    };
  },

  /* ---- input: keyboard, mouse, touch --------------------------------------
   * main.js already binds Space and a pointerdown on the canvas. These are the rest
   * of the surface: the keys a kid actually rests a hand on, a mouse for browsers
   * with no Pointer Events, and a real touchstart so a phone does not wait 300 ms
   * for a synthesised click. */
  bindInput(app) {
    const swing = (kind) => { if (app.sim) app.sim.swing(kind); };
    const KEYS = new Set(['Enter', 'KeyJ', 'KeyK', 'KeyZ', 'KeyX', 'ArrowUp', 'NumpadEnter']);
    this._onKey = (e) => {
      if (e.repeat || !KEYS.has(e.code)) return;
      e.preventDefault();
      swing(e.code === 'KeyK' || e.code === 'KeyX' ? 'power' : 'normal');
    };
    document.addEventListener('keydown', this._onKey);

    const canvas = app.stage?.renderer?.domElement || document.getElementById('game');
    if (canvas && typeof window !== 'undefined' && !('PointerEvent' in window)) {
      this._onTouch = (e) => { e.preventDefault(); swing('normal'); };
      canvas.addEventListener('touchstart', this._onTouch, { passive: false });
      this._onMouse = () => swing('normal');
      canvas.addEventListener('mousedown', this._onMouse);
    }
  },

  dispose() {
    document.removeEventListener('keydown', this._onKey);
  },

  /* ---- gameplay hooks ---------------------------------------------------- */
  onReset() {
    this.trail.clear();
    this.markT = 0;
    this.arcT = 0;
    this.pop.mesh.visible = false;
    for (const k in this.marks) this.marks[k].visible = false;
  },

  /** Every frame of the pitch: the chalk arc, and the moment it hits the stone. */
  onFlight(sim, h, t, dt) {
    const b = sim.ball;
    if (t < 0.02) this.trail.clear();
    this.trail.push(b.pos, dt, false);
    if (!h.markDone && t >= h.tBounce) {
      h.markDone = true;
      this.showMark(h);
      this.trail.push(b.pos, BT.trail.every, true);
      if (this.app.puffs) this.app.puffs.burst(h.bounce, BT.dust.bounce, 2.6);
      bus.emit('hop:bounce', {
        type: h.type, at: +h.tBounce.toFixed(3), read: h.tb,
        pos: h.bounce.clone(), apex: +h.apex.toFixed(2), crossY: +h.yCross.toFixed(2),
        kick: +(h.kick * h.dir).toFixed(2), press: IDEAL_AFTER[h.type],
      });
    }
  },

  showMark(h) {
    for (const k in this.marks) this.marks[k].visible = false;
    const m = this.marks[h.type] || this.marks.fast;
    m.position.set(h.bounce.x, 0.035, h.bounce.z);
    m.rotation.z = h.dir > 0 ? 0 : Math.PI;
    m.visible = true;
    m.material.opacity = 0.95;
    this.markT = BT.markLife;
    this.markKind = h.type;
  },

  onSwing(sim, kind, jumped) {
    const h = sim.hop;
    const y = jumped ? 3.0 : clamp(h ? h.yCross : 2.8, 1.6, 4.3);
    this.arc.position.set(2.0, y, T.street.plateZ + 1.0);
    this.arc.rotation.set(0, jumped ? -0.9 : -0.35, jumped ? 0.55 : 0.16);
    this.arc.scale.setScalar(jumped ? 0.82 : 1.0);
    this.arc.visible = true;
    this.arcT = BT.arcLife;
    this.arcJump = jumped;
  },

  onContact(sim, hit) {
    if (this.app.puffs) this.app.puffs.burst(hit.pos, BT.dust.contact, hit.quality > 0.8 ? 6 : 3.4);
    this.trail.clear();
  },

  /**
   * What he just did, in chalk, at the plate. This is the ONLY timing feedback in the
   * game and it is strictly after the fact, so it teaches the three press times without
   * ever handing one over before the ball has arrived.
   */
  onVerdict(sim, ev) {
    const err = sim.lastErrMs;
    const at = new THREE.Vector3(3.2, 5.4, T.street.plateZ + 0.6);
    const t = sim.hop ? sim.hop.type.toUpperCase() : '';
    if (ev.kind === 'in_play' && ev.quality >= 0.85) {
      this.pop.say('ON IT!', at, { sub: t, seed: 3, scale: 1.12 });
    } else if (ev.kind === 'in_play' && ev.quality < 0.5) {
      this.pop.say('OFF THE END', at, { sub: t, seed: 4, scale: 0.86 });
    } else if (ev.kind === 'foul') {
      this.pop.say('FOUL', at, { sub: 'DOWN THE BLOCK', seed: 5, scale: 0.92 });
    } else if (ev.kind === 'whiff' || ev.kind === 'strikeout') {
      if (err === null) this.pop.say('MISSED IT', at, { seed: 6, scale: 0.92 });
      else this.pop.say(err < 0 ? 'TOO SOON' : 'TOO LATE', at, { sub: `${Math.abs(Math.round(err))} MS`, seed: 6, scale: 0.92 });
    } else if (ev.kind === 'in_play') {
      this.pop.say('GOT A PIECE', at, { sub: t, seed: 7, scale: 0.9 });
    }
  },

  /* ---- per-frame --------------------------------------------------------- */
  update(dt, app) {
    if (this.markT > 0) {
      this.markT -= dt;
      const m = this.marks[this.markKind];
      if (m) {
        m.material.opacity = 0.95 * clamp(this.markT / (BT.markLife * 0.55), 0, 1);
        if (this.markT <= 0) m.visible = false;
      }
    }
    if (this.arcT > 0) {
      this.arcT -= dt;
      const u = 1 - this.arcT / BT.arcLife;
      this.arc.material.opacity = (this.arcJump ? 0.5 : 0.85) * Math.sin(Math.PI * clamp(u, 0, 1));
      this.arc.rotation.z += dt * (this.arcJump ? 9 : 15);
      if (this.arcT <= 0) this.arc.visible = false;
    }
  },

  lateUpdate(dt, app) {
    this.trail.update(dt, app.camera);
    this.pop.update(dt, app.camera);
  },

  /**
   * The `contact` scenario in src/boot/scenarios.js was written against a 0.9 s windup;
   * the pitching piece's delivery is now a full ritual and takes closer to 1.5 s, so the
   * press that scenario makes would land before the ball had left the hand. Rather than
   * edit a file this piece does not own, the delivery is run at speed for that shot only.
   */
  onScenario(name, app) {
    app.sim.windupRate = name === 'contact' ? 4.4 : 1;
    if (name === 'contact') app.sim.setHumanAtBat();
    if (this.chart) this.chart.visible = false;
    if (this.timing) this.timing.visible = false;
    this.onReset();
  },
});

/* ============================================================================
   6. SCENARIOS — the evidence
   ========================================================================= */

/** Run the at-bat forward to the release, fast, then to a chosen press. */
function toPress(seed, offsetSec, { rate = 8 } = {}) {
  const sim = app.sim;
  sim.reset(seed);
  sim.setHumanAtBat();
  sim.windupRate = rate;
  let guard = 0;
  while (sim.state.phase !== 'pitch' && guard++ < 900) app.clock.advance(1 / 60);
  sim.windupRate = 1;
  if (sim.state.phase !== 'pitch') return null;
  const w = sim.swingWindow();
  const want = clamp(w.ideal + offsetSec, w.open + 0.004, w.close - 0.004);
  guard = 0;
  while (sim.state.phase === 'pitch' && sim.pitchT < want && guard++ < 300) app.clock.advance(1 / 60);
  sim.swing();
  return w;
}

/** Stop the ball dead just after the bounce, so a still frame shows the hop. */
function toBounce(seed, after = 0.10, { rate = 8 } = {}) {
  const sim = app.sim;
  sim.reset(seed);
  sim.setHumanAtBat();
  sim.windupRate = rate;
  let guard = 0;
  while (sim.state.phase !== 'pitch' && guard++ < 900) app.clock.advance(1 / 60);
  sim.windupRate = 1;
  if (!sim.hop) return;
  const want = sim.hop.tBounce + after;
  guard = 0;
  while (sim.state.phase === 'pitch' && sim.pitchT < want && guard++ < 300) app.clock.advance(1 / 60);
}

registerScenario('swing_timing', {
  seed: 1925,
  setup: () => { toBounce(1925, 0.14); buildTimingChart(app); },
  settle: 0,
});

registerScenario('hop_read', {
  seed: 1925,
  setup: () => {
    const sim = app.sim;
    sim.reset(1925);
    sim.setHumanAtBat();
    sim.state.phase = 'idle';
    sim.ball.live = false; sim.ball.inFlight = false;
    buildHopChart(app);
    app.camera.position.set(-27.0, 7.6, 14.0);
    app.camera.lookAt(1.0, 4.4, 13.0);
    app.camera.fov = 26;
    app.camera.updateProjectionMatrix();
  },
  settle: 0,
});

registerScenario('swing_early', { seed: 4242, setup: () => { toPress(4242, -0.15); }, settle: 0.30 });
registerScenario('swing_square', { seed: 4242, setup: () => { toPress(4242, 0.0); }, settle: 0.30 });
registerScenario('swing_late', { seed: 4242, setup: () => { toPress(4242, 0.11); }, settle: 0.30 });

/* ---------------------------------------------------------------------------
   6a. THE HOP CHART — three pitches, one frame, so a critic can see the tell
   ------------------------------------------------------------------------ */

const CHART_ID = { fast: 'heat', spinner: 'slow', drop: 'loft' };

function chartPlans() {
  return PITCH_TYPES.map((k) => {
    const plan = hopPlan({ pitchId: CHART_ID[k], flight: P.pitchTB[k] + 0.34, releaseY: 4.35, aimY: 2.6 });
    plan.dir = -1;
    return plan;
  });
}

function arcDots(plan, z0, zPlate) {
  const pts = [];
  const n = 46;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * plan.flight;
    const z = lerp(z0, zPlate, t / plan.flight);
    const s = Math.max(0, t - plan.tBounce);
    pts.push(new THREE.Vector3(plan.dir * plan.kick * s * 0.0, hopY(plan, t), z));
  }
  return pts;
}

function dotMesh(pts, { size = 0.13, alpha = 0.72, from = 0 } = {}) {
  const g = new THREE.BufferGeometry();
  const n = pts.length - from;
  const pos = new Float32Array(n * 4 * 3);
  const idx = [];
  const a = new THREE.Vector3(size, 0, 0), b = new THREE.Vector3(0, size, 0);
  for (let i = 0; i < n; i++) {
    const p = pts[i + from];
    const o = i * 12;
    pos.set([p.x - a.x, p.y - b.y, p.z, p.x + a.x, p.y - b.y, p.z, p.x + a.x, p.y + b.y, p.z, p.x - a.x, p.y + b.y, p.z], o);
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: CHALK, transparent: true, opacity: alpha, depthWrite: false, fog: false, side: THREE.DoubleSide,
  }));
  m.renderOrder = 16;
  return m;
}

function chartLabel(text, pos, size = 1.05, sub = '') {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 7.2, size * 7.2),
    MAT.chalkMark(chalkWordTexture(text, { seed: 21 + text.length, sub }), { opacity: 0.98 }));
  m.position.copy(pos);
  m.renderOrder = 18;
  return m;
}

function buildHopChart(app) {
  if (system.chart) { system.chart.visible = true; return system.chart; }
  const g = new THREE.Group();
  g.name = 'hop_chart';
  const zPlate = T.street.plateZ;
  const z0 = T.street.moundZ - 2.4;
  const plans = chartPlans();

  for (const plan of plans) {
    const pts = arcDots(plan, z0, zPlate);
    g.add(dotMesh(pts, { size: 0.115, alpha: 0.5 }));

    const zb = lerp(z0, zPlate, plan.tBounce / plan.flight);
    // the scuff on the stone, laid flat where it actually lands
    const mk = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4),
      MAT.chalkMark(chalkTexture(BOUNCE_DRAW[plan.type], { size: 256, seed: 60 + PITCH_TYPES.indexOf(plan.type) }), { opacity: 0.95 }));
    mk.rotation.x = -Math.PI / 2;
    mk.position.set(0, 0.04, zb);
    mk.renderOrder = LAYER.chalk;
    g.add(mk);

    // the ball, at 100 ms and at 133 ms after the bounce — the two instants the
    // separability measurement names
    for (const [s, r] of [[0.100, 0.20], [0.133, 0.30]]) {
      const t = plan.tBounce + s;
      const b = new THREE.Mesh(new THREE.SphereGeometry(T.ball.radius * (r > 0.25 ? 1.9 : 1.5), 14, 10),
        new THREE.MeshBasicMaterial({ color: r > 0.25 ? 0xF2828A : CHALK, transparent: true, opacity: r > 0.25 ? 1 : 0.55, fog: false }));
      b.position.set(0, hopY(plan, t), lerp(z0, zPlate, t / plan.flight));
      b.renderOrder = 19;
      g.add(b);
    }

    const label = { fast: 'FAST', spinner: 'SPINNER', drop: 'DROP' }[plan.type];
    g.add(chartLabel(label, new THREE.Vector3(0, plan.yCross + 1.6, zPlate + 3.4), 0.58,
      `${Math.round(IDEAL_AFTER[plan.type])} MS`));
    // where it gets to you, in chalk, at the plate
    g.add(chartLabel(`${plan.yCross.toFixed(1)} FT`, new THREE.Vector3(0, plan.yCross, zPlate - 2.2), 0.40));
  }

  const sep = separability();
  g.add(chartLabel('THE HOP IS THE TELL', new THREE.Vector3(0, 9.6, 20.0), 1.5,
    `${sep.at100.worst.toFixed(2)} BALLS AT 100 MS   ${sep.at133.worst.toFixed(2)} AT 133`));

  app.scene.add(g);
  system.chart = g;
  return g;
}

/* ---------------------------------------------------------------------------
   6b. THE WINDOW — chalked on the road, for a critic only. The game never draws it.
   ------------------------------------------------------------------------ */

function timingTexture(sim) {
  const h = sim.hop || hopPlan({});
  const key = `bat:timing:${h.type}`;
  return chalkTexture(Object.assign((g, R, s) => {
    const X = (ms) => s * (0.06 + 0.88 * clamp((ms + 120) / 820, 0, 1));
    const y = s * 0.58;
    g.lineCap = 'round';
    g.lineWidth = s * 0.012;
    g.globalAlpha = 0.75;
    g.beginPath(); g.moveTo(X(-120), y); g.lineTo(X(700), y); g.stroke();

    // the three ideal presses, in the order a kid learns them
    const NAMES = { fast: 'FAST', spinner: 'SPINNER', drop: 'DROP' };
    for (const k of PITCH_TYPES) {
      const x = X(IDEAL_AFTER[k]);
      const live = k === h.type;
      g.globalAlpha = live ? 1 : 0.5;
      g.lineWidth = s * (live ? 0.020 : 0.011);
      g.beginPath(); g.moveTo(x, y - s * (live ? 0.15 : 0.09)); g.lineTo(x, y + s * (live ? 0.15 : 0.09)); g.stroke();
      const t = NAMES[k];
      slabText(g, t, x - slabWidth(t, s * 0.055) / 2, y - s * 0.18, s * 0.055, { color: CHALK, seed: 9 });
      const n = String(Math.round(IDEAL_AFTER[k]));
      slabText(g, n, x - slabWidth(n, s * 0.05) / 2, y + s * 0.255, s * 0.05, { color: CHALK, seed: 12 });
    }

    // the window, for the pitch that is actually in the air
    const open = X(IDEAL_AFTER[h.type] - P.swingEarly * 1000);
    const close = X(IDEAL_AFTER[h.type] + P.swingLate * 1000);
    g.globalAlpha = 0.9;
    g.lineWidth = s * 0.030;
    g.beginPath(); g.moveTo(open, y + s * 0.075); g.lineTo(close, y + s * 0.075); g.stroke();
    for (const x of [open, close]) {
      g.lineWidth = s * 0.016;
      g.beginPath(); g.moveTo(x, y + s * 0.02); g.lineTo(x, y + s * 0.13); g.stroke();
    }
    const cap = 'SWING WINDOW  310 MS';
    slabText(g, cap, open, y + s * 0.36, s * 0.052, { color: CHALK, seed: 15 });

    const head = 'MS AFTER THE BOUNCE';
    slabText(g, head, s * 0.06, s * 0.14, s * 0.062, { color: CHALK, seed: 17 });
    const sub = `GAPS 120 AND 160 — NO ONE RHYTHM FITS TWO`;
    g.globalAlpha = 0.78;
    slabText(g, sub, s * 0.06, s * 0.90, s * 0.046, { color: CHALK, seed: 19 });
    g.globalAlpha = 1;
  }, { name: key }), { size: 1024, seed: 5 });
}

function buildTimingChart(app) {
  const sim = app.sim;
  if (system.timing) { app.scene.remove(system.timing); system.timing = null; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 40),
    MAT.chalkMark(timingTexture(sim), { opacity: 0.96 }).clone());
  m.material = m.material.clone();
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.05, T.street.plateZ + 18.0);
  m.renderOrder = LAYER.chalk + 1;
  m.name = 'swing_window_chart';
  app.scene.add(m);
  system.timing = m;
  return m;
}

export default system;

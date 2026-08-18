import { clip } from './anim.js';

/**
 * The whole animation vocabulary of the block, authored as pose keys.
 *
 * Reading the numbers: rotations are degrees on joints that rest pointing down -Y, so a
 * NEGATIVE rx swings a limb forward (+Z) and a POSITIVE rz swings it out toward +X. Kids face
 * +Z. `base` is the whole-body handle — py lifts, ry spins, sy squashes.
 *
 * Authoring rules, from docs/BYB-REFERENCE §5 and docs/DESIGN-BIBLE §12:
 *   • every action opens with anticipation — the weight goes the wrong way first;
 *   • every action contains at least three distinct, freezable poses;
 *   • every action ends with follow-through and a settle, never a snap back to rest;
 *   • holds are long and transitions are short (that is what `hold`/`snap` easing is for).
 */
export const CLIPS = {};
const C = (name, def) => (CLIPS[name] = clip(name, def));

// Batter grip angles live here rather than being sprinkled through the keys — the shaft angle
// is the single hardest thing to eyeball and it wants to be tuned in one place.
// The broom handle lives in body space, not in a hand: `grip` hangs off the shoulder girdle
// and the mitts are IK'd onto it (anim.js `solveHands`). Shaft rest is straight up, so a
// POSITIVE rz tips the barrel back over the rear (-X) shoulder and a NEGATIVE rz swings it out
// toward the pitcher (+X); a NEGATIVE rx lays it back behind the kid.
// These are CHEST-RELATIVE, and the chest turns underneath them: the barrel's trip round the
// body is mostly `chest.ry`, and `grip` only says where the stick sits relative to the shoulders.
// rz tips the shaft toward the rear (-X) shoulder; rx tips it back behind the kid (+Z).
const G = {
  carry: { rx: 34, rz: 54 },         // laid back on the rear shoulder between pitches
  cocked: { rx: 12, rz: 40 },        // up over the rear shoulder, near vertical
  loaded: { rx: 24, rz: 52 },        // deeper, wrapped further behind the head
  launch: { rx: 4, rz: 34 },         // hands go, barrel still lagging behind them
  contact: { rx: -74, rz: -28, px: 0.3, pz: -0.2 },   // extended through the ball
  wrap: { rx: 56, rz: -62 },         // wrapped clean round behind the front shoulder
  point: { rx: -28, rz: -52 },       // levelled out at the fire escape
};

// ── idles ───────────────────────────────────────────────────────────────────
// Three families so a line of kids never reads as one puppet duplicated.
C('idle', {
  dur: 3.1, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { base: { py: 0 }, hips: { rz: 2 }, chest: { rx: -3, rz: -2 }, neck: { ry: 5 }, armL: { rx: -5, rz: 6 }, armR: { rx: 3, rz: -7 }, elbL: [16, 0, 0], elbR: [22, 0, 0], kneeL: [-7, 0, 0], kneeR: [-4, 0, 0] } },
    { t: 0.9, ease: 'hold', pose: { base: { py: 0.045 }, hips: { rz: -3, ry: -4 }, chest: { rx: 1, rz: 3, ry: 2 }, neck: { ry: -8, rx: 3 }, armL: { rx: 2, rz: 8 }, armR: { rx: -4, rz: -5 }, elbL: [24, 0, 0], elbR: [14, 0, 0], kneeL: [-3, 0, 0], kneeR: [-9, 0, 0] } },
    { t: 1.7, pose: { base: { py: 0.01 }, hips: { rz: -4, ry: -3 }, chest: { rx: -4, rz: 2 }, neck: { ry: -12 }, armL: { rx: -3, rz: 7 }, armR: { rx: 1, rz: -6 }, elbL: [20, 0, 0], elbR: [18, 0, 0], kneeL: [-5, 0, 0], kneeR: [-8, 0, 0] } },
    { t: 2.4, ease: 'hold', pose: { base: { py: 0.05 }, hips: { rz: 3, ry: 3 }, chest: { rx: -0, rz: -3 }, neck: { ry: 8, rx: -2 }, armL: { rx: -6, rz: 5 }, armR: { rx: 5, rz: -8 }, elbL: [14, 0, 0], elbR: [26, 0, 0], kneeL: [-9, 0, 0], kneeR: [-3, 0, 0] } },
    { t: 3.1, pose: { base: { py: 0 }, hips: { rz: 2 }, chest: { rx: -3, rz: -2 }, neck: { ry: 5 }, armL: { rx: -5, rz: 6 }, armR: { rx: 3, rz: -7 }, elbL: [16, 0, 0], elbR: [22, 0, 0], kneeL: [-7, 0, 0], kneeR: [-4, 0, 0] } },
  ],
});

C('idle_slouch', {
  dur: 3.6, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { base: { py: -0.06 }, hips: { rz: -6 }, chest: { rx: -9, rz: 4 }, neck: { rx: -7, ry: -9 }, armL: { rx: -9, rz: 10 }, armR: { rx: -6, rz: -12 }, elbL: [30, 0, 0], elbR: [12, 0, 0], kneeL: [-16, 0, 0], kneeR: [-2, 0, 0], legL: { rz: -5 } } },
    { t: 1.3, ease: 'hold', pose: { base: { py: -0.02 }, hips: { rz: 6 }, chest: { rx: -6, rz: -5 }, neck: { rx: -4, ry: 12 }, armL: { rx: -4, rz: 8 }, armR: { rx: -10, rz: -9 }, elbL: [18, 0, 0], elbR: [28, 0, 0], kneeL: [-3, 0, 0], kneeR: [-15, 0, 0], legR: { rz: 5 } } },
    { t: 2.5, ease: 'hold', pose: { base: { py: -0.07 }, hips: { rz: -4 }, chest: { rx: -11, rz: 2 }, neck: { rx: -9, ry: -3 }, armL: { rx: -11, rz: 11 }, armR: { rx: -5, rz: -11 }, elbL: [26, 0, 0], elbR: [16, 0, 0], kneeL: [-14, 0, 0], kneeR: [-5, 0, 0] } },
    { t: 3.6, pose: { base: { py: -0.06 }, hips: { rz: -6 }, chest: { rx: -9, rz: 4 }, neck: { rx: -7, ry: -9 }, armL: { rx: -9, rz: 10 }, armR: { rx: -6, rz: -12 }, elbL: [30, 0, 0], elbR: [12, 0, 0], kneeL: [-16, 0, 0], kneeR: [-2, 0, 0], legL: { rz: -5 } } },
  ],
});

C('idle_bounce', {
  dur: 1.9, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { base: { py: 0.0, sy: -0.03, sx: 0.02, sz: 0.02 }, chest: { rx: -6 }, neck: { rx: 4 }, kneeL: [-22, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -12, rz: 9 }, armR: { rx: -12, rz: -9 }, elbL: [40, 0, 0], elbR: [40, 0, 0] } },
    { t: 0.42, ease: 'hold', pose: { base: { py: 0.16, sy: 0.04, sx: -0.02, sz: -0.02 }, chest: { rx: 2 }, neck: { rx: -2, ry: 7 }, kneeL: [-4, 0, 0], kneeR: [-4, 0, 0], armL: { rx: 4, rz: 12 }, armR: { rx: 4, rz: -12 }, elbL: [26, 0, 0], elbR: [26, 0, 0] } },
    { t: 0.95, ease: 'hold', pose: { base: { py: 0.0, sy: -0.03, sx: 0.02, sz: 0.02 }, chest: { rx: -6, ry: -5 }, neck: { rx: 4, ry: -6 }, kneeL: [-22, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -12, rz: 9 }, armR: { rx: -12, rz: -9 }, elbL: [40, 0, 0], elbR: [40, 0, 0] } },
    { t: 1.38, ease: 'hold', pose: { base: { py: 0.16, sy: 0.04, sx: -0.02, sz: -0.02 }, chest: { rx: 2, ry: 5 }, neck: { rx: -2, ry: -8 }, kneeL: [-4, 0, 0], kneeR: [-4, 0, 0], armL: { rx: 4, rz: 12 }, armR: { rx: 4, rz: -12 }, elbL: [26, 0, 0], elbR: [26, 0, 0] } },
    { t: 1.9, pose: { base: { py: 0.0, sy: -0.03, sx: 0.02, sz: 0.02 }, chest: { rx: -6 }, neck: { rx: 4 }, kneeL: [-22, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -12, rz: 9 }, armR: { rx: -12, rz: -9 }, elbL: [40, 0, 0], elbR: [40, 0, 0] } },
  ],
});

/** Fielder's ready crouch — hands on knees, weight rocking, watching the plate. */
C('ready', {
  dur: 2.2, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { base: { py: -0.34 }, hips: { rz: 3 }, chest: { rx: -26 }, neck: { rx: 22 }, legL: { rz: -13, rx: 6 }, legR: { rz: 13, rx: 6 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, armR: { rx: 30, rz: -20 }, elbL: [58, 0, 0], elbR: [58, 0, 0] } },
    { t: 0.8, ease: 'hold', pose: { base: { py: -0.44 }, hips: { rz: -4, ry: -5 }, chest: { rx: -30, ry: 4 }, neck: { rx: 26, ry: -5 }, legL: { rz: -14, rx: 8 }, legR: { rz: 14, rx: 4 }, kneeL: [-50, 0, 0], kneeR: [-40, 0, 0], armL: { rx: 36, rz: 22 }, armR: { rx: 26, rz: -18 }, elbL: [64, 0, 0], elbR: [54, 0, 0] } },
    { t: 1.5, ease: 'hold', pose: { base: { py: -0.3 }, hips: { rz: 4, ry: 4 }, chest: { rx: -22, ry: -4 }, neck: { rx: 20, ry: 6 }, legL: { rz: -12, rx: 4 }, legR: { rz: 12, rx: 8 }, kneeL: [-38, 0, 0], kneeR: [-50, 0, 0], armL: { rx: 24, rz: 18 }, armR: { rx: 34, rz: -22 }, elbL: [52, 0, 0], elbR: [62, 0, 0] } },
    { t: 2.2, pose: { base: { py: -0.34 }, hips: { rz: 3 }, chest: { rx: -26 }, neck: { rx: 22 }, legL: { rz: -13, rx: 6 }, legR: { rz: 13, rx: 6 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, armR: { rx: 30, rz: -20 }, elbL: [58, 0, 0], elbR: [58, 0, 0] } },
  ],
});

/** Catcher, squatting on his heels behind the plate. */
C('crouch', {
  dur: 2.6, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { base: { py: -1.02 }, chest: { rx: -20 }, neck: { rx: 18 }, legL: { rz: -30, rx: 42 }, legR: { rz: 30, rx: 42 }, kneeL: [-104, 0, 0], kneeR: [-104, 0, 0], footL: [30, 0, 0], footR: [30, 0, 0], armL: { rx: 46, rz: 26 }, armR: { rx: 22, rz: -30 }, elbL: [52, 0, 0], elbR: [40, 0, 0] } },
    { t: 1.1, ease: 'hold', pose: { base: { py: -1.06 }, chest: { rx: -23, ry: 5 }, neck: { rx: 21, ry: -6 }, legL: { rz: -31, rx: 44 }, legR: { rz: 29, rx: 40 }, kneeL: [-108, 0, 0], kneeR: [-102, 0, 0], footL: [32, 0, 0], footR: [28, 0, 0], armL: { rx: 52, rz: 28 }, armR: { rx: 18, rz: -26 }, elbL: [46, 0, 0], elbR: [46, 0, 0] } },
    { t: 2.6, pose: { base: { py: -1.02 }, chest: { rx: -20 }, neck: { rx: 18 }, legL: { rz: -30, rx: 42 }, legR: { rz: 30, rx: 42 }, kneeL: [-104, 0, 0], kneeR: [-104, 0, 0], footL: [30, 0, 0], footR: [30, 0, 0], armL: { rx: 46, rz: 26 }, armR: { rx: 22, rz: -30 }, elbL: [52, 0, 0], elbR: [40, 0, 0] } },
  ],
});

// ── idle fidgets (additive layers over any idle) ────────────────────────────
C('fidget_cap', {
  dur: 1.15,
  keys: [
    { t: 0, pose: {} },
    { t: 0.26, ease: 'out', pose: { armR: { rx: 104, rz: -16 }, elbR: [112, 0, 0], neck: { rx: -5 }, chest: { rz: -4 } } },
    { t: 0.44, ease: 'snap', pose: { armR: { rx: 112, rz: -12 }, elbR: [126, 0, 0], neck: { rx: -12 }, brim: [-16, 0, 0], head: { py: -0.05 } } },
    { t: 0.62, ease: 'hold', pose: { armR: { rx: 108, rz: -14 }, elbR: [120, 0, 0], neck: { rx: -8 }, brim: [-8, 0, 0] } },
    { t: 0.95, ease: 'out', pose: { armR: { rx: 12, rz: -8 }, elbR: [26, 0, 0], neck: { rx: 3 } } },
    { t: 1.15, ease: 'settle', pose: {} },
  ],
});

C('fidget_pebble', {
  dur: 1.5,
  keys: [
    { t: 0, pose: {} },
    { t: 0.3, ease: 'hold', pose: { neck: { rx: -26, ry: 10 }, chest: { rx: -10 }, hips: { rz: 5 }, legR: { rx: -16 }, kneeR: [-16, 0, 0] } },
    { t: 0.52, ease: 'antic', pose: { neck: { rx: -28 }, legR: { rx: -26 }, kneeR: [-44, 0, 0], hips: { rz: 6 } } },
    { t: 0.64, ease: 'whip', pose: { neck: { rx: -20 }, legR: { rx: 44 }, kneeR: [-4, 0, 0], footR: [16, 0, 0], hips: { rz: 7 }, chest: { rx: 4 }, armR: { rx: -18 } } },
    { t: 0.86, ease: 'hold', pose: { neck: { rx: -24, ry: -8 }, legR: { rx: 12 }, kneeR: [-22, 0, 0], hips: { rz: 4 } } },
    { t: 1.2, ease: 'out', pose: { neck: { rx: -8 }, legR: { rx: -0 }, kneeR: [-6, 0, 0] } },
    { t: 1.5, ease: 'settle', pose: {} },
  ],
});

C('fidget_chatter', {
  dur: 1.7, fps: 12,
  keys: [
    { t: 0, pose: {} },
    { t: 0.22, ease: 'out', pose: { chest: { rx: -18, ry: -8 }, neck: { rx: 12, ry: -6 }, armL: { rx: 84, rz: 30 }, elbL: [116, 0, 0], armR: { rx: 84, rz: -30 }, elbR: [116, 0, 0] } },
    { t: 0.42, ease: 'snap', pose: { chest: { rx: -26, ry: -10 }, neck: { rx: 20, ry: -6 }, base: { py: 0.06 }, armL: { rx: 92, rz: 32 }, elbL: [124, 0, 0], armR: { rx: 92, rz: -32 }, elbR: [124, 0, 0] } },
    { t: 0.58, ease: 'snap', pose: { chest: { rx: -16, ry: -8 }, neck: { rx: 8, ry: -4 }, base: { py: 0 }, armL: { rx: 84, rz: 30 }, elbL: [116, 0, 0], armR: { rx: 84, rz: -30 }, elbR: [116, 0, 0] } },
    { t: 0.76, ease: 'snap', pose: { chest: { rx: -28, ry: -12 }, neck: { rx: 22, ry: -8 }, base: { py: 0.08 }, armL: { rx: 96, rz: 34 }, elbL: [128, 0, 0], armR: { rx: 96, rz: -34 }, elbR: [128, 0, 0] } },
    { t: 0.94, ease: 'snap', pose: { chest: { rx: -18, ry: -8 }, neck: { rx: 10 }, base: { py: 0 }, armL: { rx: 86, rz: 30 }, elbL: [118, 0, 0], armR: { rx: 86, rz: -30 }, elbR: [118, 0, 0] } },
    { t: 1.16, ease: 'snap', pose: { chest: { rx: -30, ry: -12 }, neck: { rx: 24, ry: -10 }, base: { py: 0.09 }, armL: { rx: 98, rz: 34 }, elbL: [130, 0, 0], armR: { rx: 98, rz: -34 }, elbR: [130, 0, 0] } },
    { t: 1.42, ease: 'out', pose: { chest: { rx: -8 }, neck: { rx: 2 }, armL: { rx: 30, rz: 14 }, elbL: [50, 0, 0], armR: { rx: 30, rz: -14 }, elbR: [50, 0, 0] } },
    { t: 1.7, ease: 'settle', pose: {} },
  ],
});

C('fidget_pants', {
  dur: 1.1,
  keys: [
    { t: 0, pose: {} },
    { t: 0.24, ease: 'out', pose: { armL: { rx: 52, rz: 26 }, elbL: [86, 0, 0], armR: { rx: 52, rz: -26 }, elbR: [86, 0, 0], chest: { rx: -8 } } },
    { t: 0.38, ease: 'whip', pose: { armL: { rx: 36, rz: 22 }, elbL: [64, 0, 0], armR: { rx: 36, rz: -22 }, elbR: [64, 0, 0], base: { py: 0.13, sy: 0.04 }, chest: { rx: 6 }, shirt: [18, 0, 0], kneeL: [6, 0, 0], kneeR: [6, 0, 0] } },
    { t: 0.56, ease: 'hold', pose: { armL: { rx: 44, rz: 24 }, elbL: [74, 0, 0], armR: { rx: 44, rz: -24 }, elbR: [74, 0, 0], base: { py: 0.02, sy: -0.03 }, chest: { rx: -4 } } },
    { t: 0.86, ease: 'out', pose: { armL: { rx: 8, rz: 6 }, elbL: [20, 0, 0], armR: { rx: 8, rz: -6 }, elbR: [20, 0, 0] } },
    { t: 1.1, ease: 'settle', pose: {} },
  ],
});

C('fidget_spit', {
  dur: 1.45,
  keys: [
    { t: 0, pose: {} },
    { t: 0.24, ease: 'out', pose: { armL: { rx: 76, rz: 22 }, elbL: [104, 0, 0], armR: { rx: 76, rz: -22 }, elbR: [104, 0, 0], neck: { rx: -8 }, chest: { rx: -10 } } },
    { t: 0.4, ease: 'snap', pose: { armL: { rx: 82, rz: 20 }, elbL: [112, 0, 0], armR: { rx: 82, rz: -20 }, elbR: [112, 0, 0], neck: { rx: -16 }, chest: { rx: -16 } } },
    { t: 0.62, ease: 'snap', pose: { armL: { rx: 62, rz: 30 }, elbL: [96, 0, 0], armR: { rx: 62, rz: -30 }, elbR: [96, 0, 0], neck: { rx: -6 }, chest: { rx: -12, ry: -6 } } },
    { t: 0.78, ease: 'snap', pose: { armL: { rx: 62, rz: 20 }, elbL: [96, 0, 0], armR: { rx: 62, rz: -20 }, elbR: [96, 0, 0], chest: { rx: -12, ry: 6 } } },
    { t: 0.94, ease: 'snap', pose: { armL: { rx: 62, rz: 30 }, elbL: [96, 0, 0], armR: { rx: 62, rz: -30 }, elbR: [96, 0, 0], chest: { rx: -12, ry: -6 } } },
    { t: 1.14, ease: 'out', pose: { armL: { rx: 20, rz: 10 }, elbL: [34, 0, 0], armR: { rx: 20, rz: -10 }, elbR: [34, 0, 0], chest: { rx: -4 } } },
    { t: 1.45, ease: 'settle', pose: {} },
  ],
});

C('fidget_stocking', {
  dur: 1.35,
  keys: [
    { t: 0, pose: {} },
    { t: 0.3, ease: 'out', pose: { chest: { rx: -42, ry: 12 }, neck: { rx: 14 }, hips: { rx: -10 }, legR: { rx: 22 }, kneeR: [-36, 0, 0], armR: { rx: 66, rz: -10 }, elbR: [64, 0, 0] } },
    { t: 0.5, ease: 'snap', pose: { chest: { rx: -50, ry: 14 }, neck: { rx: 18 }, hips: { rx: -12 }, legR: { rx: 26 }, kneeR: [-40, 0, 0], armR: { rx: 78, rz: -8 }, elbR: [78, 0, 0], shirt: [-24, 0, 0] } },
    { t: 0.7, ease: 'hold', pose: { chest: { rx: -46, ry: 14 }, hips: { rx: -11 }, legR: { rx: 24 }, kneeR: [-38, 0, 0], armR: { rx: 70, rz: -8 }, elbR: [88, 0, 0] } },
    { t: 1.02, ease: 'out', pose: { chest: { rx: -12 }, neck: { rx: 2 }, legR: { rx: 6 }, kneeR: [-10, 0, 0], armR: { rx: 16 }, elbR: [26, 0, 0] } },
    { t: 1.35, ease: 'settle', pose: {} },
  ],
});

C('fidget_stretch', {
  dur: 1.7,
  keys: [
    { t: 0, pose: {} },
    { t: 0.34, ease: 'out', pose: { armL: { rx: -40, rz: 16 }, armR: { rx: -40, rz: -16 }, elbL: [50, 0, 0], elbR: [50, 0, 0], chest: { rx: -6 } } },
    { t: 0.6, ease: 'hold', pose: { armL: { rx: -172, rz: 12 }, armR: { rx: -172, rz: -12 }, elbL: [22, 0, 0], elbR: [22, 0, 0], chest: { rx: 16 }, neck: { rx: 26 }, base: { py: 0.14, sy: 0.06, sx: -0.03, sz: -0.03 } } },
    { t: 0.95, ease: 'hold', pose: { armL: { rx: -176, rz: 18 }, armR: { rx: -176, rz: -18 }, elbL: [16, 0, 0], elbR: [16, 0, 0], chest: { rx: 20 }, neck: { rx: 32 }, base: { py: 0.17, sy: 0.07, sx: -0.03, sz: -0.03 } } },
    { t: 1.3, ease: 'out', pose: { armL: { rx: -20, rz: 8 }, armR: { rx: -20, rz: -8 }, elbL: [30, 0, 0], elbR: [30, 0, 0], chest: { rx: -8 }, neck: { rx: -6 }, base: { py: -0.05, sy: -0.04, sx: 0.02, sz: 0.02 } } },
    { t: 1.7, ease: 'settle', pose: {} },
  ],
});

C('fidget_look', {
  dur: 1.4,
  keys: [
    { t: 0, pose: {} },
    { t: 0.28, ease: 'snap', pose: { neck: { ry: 56, rx: 4 }, chest: { ry: 16 }, brim: [0, 0, -10] } },
    { t: 0.62, ease: 'hold', pose: { neck: { ry: 60, rx: -4 }, chest: { ry: 18 } } },
    { t: 0.9, ease: 'snap', pose: { neck: { ry: -48, rx: 3 }, chest: { ry: -14 }, brim: [0, 0, 10] } },
    { t: 1.14, ease: 'hold', pose: { neck: { ry: -44 }, chest: { ry: -12 } } },
    { t: 1.4, ease: 'out', pose: {} },
  ],
});

C('fidget_tap', {
  dur: 1.1,
  keys: [
    { t: 0, pose: {} },
    { t: 0.2, ease: 'out', pose: { grip: { rx: 4, rz: 150 }, armL: { rx: 34, rz: 12 }, elbL: [40, 0, 0], neck: { rx: -14 } } },
    { t: 0.32, ease: 'whip', pose: { grip: { rx: 2, rz: 172 }, armL: { rx: 14, rz: 8 }, elbL: [16, 0, 0], neck: { rx: -18 } } },
    { t: 0.46, ease: 'out', pose: { grip: { rx: 4, rz: 148 }, armL: { rx: 32, rz: 12 }, elbL: [38, 0, 0], neck: { rx: -14 } } },
    { t: 0.58, ease: 'whip', pose: { grip: { rx: 2, rz: 172 }, armL: { rx: 14, rz: 8 }, elbL: [16, 0, 0], neck: { rx: -18 } } },
    { t: 0.84, ease: 'out', pose: { grip: { rx: 6, rz: 120 }, neck: { rx: -6 } } },
    { t: 1.1, ease: 'settle', pose: {} },
  ],
});

C('fidget_pigeon', {
  dur: 1.6,
  keys: [
    { t: 0, pose: {} },
    { t: 0.3, ease: 'snap', pose: { neck: { rx: 40, ry: -20 }, chest: { rx: 8 }, armR: { rx: 30, rz: -34 }, elbR: [40, 0, 0] } },
    { t: 0.66, ease: 'hold', pose: { neck: { rx: 44, ry: -26 }, chest: { rx: 10 }, armR: { rx: 34, rz: -38 }, elbR: [34, 0, 0], base: { py: 0.03 } } },
    { t: 1.0, ease: 'hold', pose: { neck: { rx: 40, ry: -12 }, chest: { rx: 6 }, armR: { rx: 20, rz: -30 }, elbR: [44, 0, 0] } },
    { t: 1.6, ease: 'out', pose: {} },
  ],
});

// ── the at-bat ──────────────────────────────────────────────────────────────
/**
 * Stance: traceable to the 1925 crouch-and-choke stickball stance seen in Bain Collection
 * street photographs — feet square to the curb, hands choked a fist up the handle, barrel
 * tipped back over the shoulder rather than held vertical. Deliberately wrong for baseball.
 */
C('stance', {
  dur: 2.5, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { hips: { ry: 14 }, chest: { ry: 17, rx: -12 }, neck: { ry: -44, rx: 20 }, legL: { rz: -14, rx: -6 }, legR: { rz: 15, rx: 8 }, kneeL: [-26, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -26, rz: -26 }, elbL: [88, 0, 0], armR: { rx: -8, rz: -46 }, elbR: [76, 0, 0], grip: G.cocked, base: { py: -0.17 } } },
    { t: 0.85, ease: 'hold', pose: { hips: { ry: 22, rz: 3 }, chest: { ry: 24, rx: -7 }, neck: { ry: -50, rx: 18 }, legL: { rz: -15, rx: -8 }, legR: { rz: 16, rx: 9 }, kneeL: [-30, 0, 0], kneeR: [-24, 0, 0], armL: { rx: -32, rz: -30 }, elbL: [94, 0, 0], armR: { rx: -12, rz: -50 }, elbR: [82, 0, 0], grip: { rx: G.cocked.rx + 10, rz: G.cocked.rz + 8 }, base: { py: -0.17 } } },
    { t: 1.7, ease: 'hold', pose: { hips: { ry: 16, rz: -2 }, chest: { ry: 18, rx: -5 }, neck: { ry: -44, rx: 22 }, legL: { rz: -13, rx: -5 }, legR: { rz: 14, rx: 7 }, kneeL: [-23, 0, 0], kneeR: [-20, 0, 0], armL: { rx: -22, rz: -24 }, elbL: [84, 0, 0], armR: { rx: -5, rz: -43 }, elbR: [72, 0, 0], grip: { rx: G.cocked.rx + 8, rz: G.cocked.rz - 6 }, base: { py: -0.15 } } },
    { t: 2.5, pose: { hips: { ry: 18 }, chest: { ry: 20, rx: -6 }, neck: { ry: -46, rx: 20 }, legL: { rz: -14, rx: -6 }, legR: { rz: 15, rx: 8 }, kneeL: [-26, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -26, rz: -26 }, elbL: [88, 0, 0], armR: { rx: -8, rz: -46 }, elbR: [76, 0, 0], grip: G.cocked, base: { py: -0.17 } } },
  ],
});

/** Bat waggle — additive over the stance, the thing that keeps a waiting batter alive. */
C('waggle', {
  dur: 0.92, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { grip: { rx: -0, rz: 0 }, armL: { rx: -0 }, elbL: [0, 0, 0] } },
    { t: 0.23, pose: { grip: { rx: 13, rz: 9 }, armL: { rx: -5, rz: -4 }, elbL: [7, 0, 0], chest: { ry: 3 } } },
    { t: 0.46, pose: { grip: { rx: -4, rz: 14 }, armL: { rx: 3, rz: -6 }, elbL: [-5, 0, 0], neck: { rx: -2 } } },
    { t: 0.69, pose: { grip: { rx: -11, rz: 4 }, armL: { rx: 5, rz: 2 }, elbL: [-8, 0, 0], chest: { ry: -3 } } },
    { t: 0.92, pose: { grip: { rx: -0, rz: 0 }, armL: { rx: -0 }, elbL: [0, 0, 0] } },
  ],
});

/**
 * The swing. Anticipation (weight back, hands deeper), stride (front foot plants while the
 * hands stay home — the separation is the whole thing), launch, contact held for the hitstop,
 * then a wrap follow-through that turns the head to track the ball.
 */
C('swing', {
  dur: 1.0,
  keys: [
    { t: 0.0, pose: { hips: { ry: 14 }, chest: { ry: 16, rx: -6 }, neck: { ry: -44, rx: 10 }, legL: { rz: -23, rx: -8 }, legR: { rz: 24, rx: 12 }, kneeL: [-34, 0, 0], kneeR: [-28, 0, 0], footL: [-8, 0, 0], armL: { rx: -26, rz: -26 }, elbL: [88, 0, 0], armR: { rx: -8, rz: -46 }, elbR: [76, 0, 0], grip: G.cocked, base: { py: -0.17 } } },
    // 1. LOAD — everything goes backwards first
    { t: 0.14, ease: 'out', pose: { hips: { ry: 34, rz: 5 }, chest: { ry: 40, rx: -8 }, neck: { ry: -58, rx: 12 }, legL: { rz: -24, rx: -18 }, legR: { rz: 26, rx: 26 }, kneeL: [-44, 0, 0], kneeR: [-36, 0, 0], footL: [-14, 0, 0], armL: { rx: -34, rz: -34 }, elbL: [98, 0, 0], armR: { rx: -16, rz: -56 }, elbR: [88, 0, 0], grip: G.loaded, base: { py: -0.24 }, shirt: [14, 0, 0] } },
    // 2. STRIDE — front foot goes out, hands stay behind
    { t: 0.27, ease: 'hold', pose: { hips: { ry: 30, rz: 4 }, chest: { ry: 42, rx: -9 }, neck: { ry: -60, rx: 12 }, legL: { rz: -24, rx: -20 }, legR: { rz: 30, rx: 46 }, kneeL: [-40, 0, 0], kneeR: [-14, 0, 0], footR: [22, 0, 0], footL: [-16, 0, 0], armL: { rx: -36, rz: -36 }, elbL: [100, 0, 0], armR: { rx: -18, rz: -58 }, elbR: [90, 0, 0], grip: G.loaded, base: { py: -0.26, pz: -0.12 } } },
    // 3. LAUNCH — hips fire, chest lags, barrel drops into the zone
    { t: 0.34, ease: 'drive', pose: { hips: { ry: -16, rz: 2 }, chest: { ry: 14, rx: -15 }, neck: { ry: -40, rx: 8 }, legL: { rz: -20, rx: -12 }, legR: { rz: 24, rx: 30 }, kneeL: [-32, 0, 0], kneeR: [-10, 0, 0], footL: [-26, 0, 0], armL: { rx: -18, rz: -22 }, elbL: [84, 0, 0], armR: { rx: 6, rz: -38 }, elbR: [70, 0, 0], grip: G.launch, base: { py: -0.2, pz: -0.06 } } },
    // 4. CONTACT — the freezable frame
    { t: 0.44, ease: 'inout', pose: { hips: { ry: -54, rz: -4 }, chest: { ry: -46, rx: -6 }, neck: { ry: -6, rx: 6 }, legL: { rz: -16, rx: 14, ry: 16 }, legR: { rz: 18, rx: 10 }, kneeL: [-40, 0, 0], kneeR: [-2, 0, 0], footL: [-48, 0, 0], armL: { rx: 34, rz: -8 }, elbL: [22, 0, 0], armR: { rx: 40, rz: -12 }, elbR: [18, 0, 0], grip: G.contact, base: { py: -0.24, sy: -0.06, sx: 0.03, sz: 0.03 } } },
    // 5. hold the contact pose — the hitstop reads here
    { t: 0.5, ease: 'hold', pose: { hips: { ry: -60, rz: -5 }, chest: { ry: -52, rx: -5 }, neck: { ry: -2, rx: 8 }, legL: { rz: -16, rx: 16, ry: 18 }, legR: { rz: 18, rx: 9 }, kneeL: [-44, 0, 0], kneeR: [-2, 0, 0], footL: [-52, 0, 0], armL: { rx: 38, rz: -6 }, elbL: [18, 0, 0], armR: { rx: 44, rz: -10 }, elbR: [14, 0, 0], grip: { rx: G.contact.rx + 8, rz: G.contact.rz - 4 }, base: { py: -0.22, sy: -0.04, sx: 0.02, sz: 0.02 } } },
    // 6. FOLLOW-THROUGH — bat wraps, back heel comes up, head tracks the ball
    { t: 0.66, ease: 'out', pose: { hips: { ry: -96, rz: -8 }, chest: { ry: -104, rx: 4 }, neck: { ry: 15, rx: 16 }, legL: { rz: -8, rx: 18, ry: -20 }, legR: { rz: 10, rx: 6 }, kneeL: [-56, 0, 0], kneeR: [-8, 0, 0], footL: [40, 0, 0], armL: { rx: 102, rz: 22 }, elbL: [104, 0, 0], armR: { rx: 96, rz: 8 }, elbR: [96, 0, 0], grip: G.wrap, base: { py: -0.1, sy: 0.03 }, shirt: [-22, 0, 0] } },
    { t: 0.82, ease: 'hold', pose: { hips: { ry: -104, rz: -6 }, chest: { ry: -112, rx: 2 }, neck: { ry: 20, rx: 18 }, legL: { rz: -8, rx: 20, ry: -24 }, legR: { rz: 10, rx: 4 }, kneeL: [-62, 0, 0], kneeR: [-6, 0, 0], footL: [46, 0, 0], armL: { rx: 108, rz: 26 }, elbL: [112, 0, 0], armR: { rx: 100, rz: 10 }, elbR: [104, 0, 0], grip: { rx: G.wrap.rx + 10, rz: G.wrap.rz - 6 }, base: { py: -0.12 } } },
    { t: 1.0, ease: 'settle', pose: { hips: { ry: -62 }, chest: { ry: -58, rx: -6 }, neck: { ry: 14 }, kneeL: [-26, 0, 0], kneeR: [-16, 0, 0], armL: { rx: 40, rz: -6 }, elbL: [58, 0, 0], armR: { rx: 34, rz: -18 }, elbR: [62, 0, 0], grip: { rx: 18, rz: 30 }, base: { py: -0.14 } } },
  ],
  events: [{ t: 0.44, name: 'contact' }, { t: 0.27, name: 'stride' }],
  meta: { contact: 0.44 },
});

/** Check swing — starts, thinks better of it, and yanks the hands back. */
C('swing_check', {
  dur: 0.86,
  keys: [
    { t: 0.0, pose: { hips: { ry: 14 }, chest: { ry: 16, rx: -6 }, neck: { ry: -44, rx: 14 }, kneeL: [-26, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -26, rz: -26 }, elbL: [88, 0, 0], armR: { rx: -8, rz: -46 }, elbR: [76, 0, 0], grip: G.cocked, base: { py: -0.14 } } },
    { t: 0.13, ease: 'out', pose: { hips: { ry: 32, rz: 5 }, chest: { ry: 42, rx: -15 }, neck: { ry: -58 }, legR: { rx: 20 }, kneeL: [-34, 0, 0], armL: { rx: -34, rz: -34 }, elbL: [98, 0, 0], grip: G.loaded, base: { py: -0.22 } } },
    { t: 0.26, ease: 'drive', pose: { hips: { ry: -4 }, chest: { ry: 18, rx: -16 }, neck: { ry: -34 }, legR: { rx: 34 }, kneeR: [-14, 0, 0], armL: { rx: -6, rz: -18 }, elbL: [70, 0, 0], armR: { rx: 14, rz: -34 }, elbR: [58, 0, 0], grip: { rx: 12, rz: 4 }, base: { py: -0.22, pz: -0.08 } } },
    // the abort: hands snap back, chest rocks away, chin tucks
    { t: 0.4, ease: 'snap', pose: { hips: { ry: -12 }, chest: { ry: 6, rx: -22 }, neck: { ry: -26, rx: -10 }, legR: { rx: 30 }, kneeR: [-18, 0, 0], armL: { rx: -28, rz: -30 }, elbL: [104, 0, 0], armR: { rx: -12, rz: -50 }, elbR: [92, 0, 0], grip: { rx: 52, rz: 64 }, base: { py: -0.26, pz: 0.06 } } },
    { t: 0.58, ease: 'hold', pose: { hips: { ry: -8 }, chest: { ry: 12, rx: -24 }, neck: { ry: -30, rx: -8 }, armL: { rx: -30, rz: -32 }, elbL: [106, 0, 0], armR: { rx: -14, rz: -52 }, elbR: [94, 0, 0], grip: { rx: 56, rz: 66 }, base: { py: -0.28, pz: 0.08 } } },
    { t: 0.86, ease: 'settle', pose: { hips: { ry: 14 }, chest: { ry: 20, rx: -13 }, neck: { ry: -44, rx: 14 }, kneeL: [-26, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -26, rz: -26 }, elbL: [88, 0, 0], armR: { rx: -8, rz: -46 }, elbR: [76, 0, 0], grip: G.cocked, base: { py: -0.14 } } },
  ],
});

/** The whiff that spins them around — root rotation, crossed-over feet, an off-balance settle. */
C('whiff', {
  dur: 1.55,
  keys: [
    { t: 0.0, pose: { hips: { ry: 14 }, chest: { ry: 16, rx: -6 }, neck: { ry: -44, rx: 14 }, kneeL: [-26, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -26, rz: -26 }, elbL: [88, 0, 0], armR: { rx: -8, rz: -46 }, elbR: [76, 0, 0], grip: G.cocked, base: { py: -0.14 } } },
    { t: 0.15, ease: 'out', pose: { hips: { ry: 34, rz: 5 }, chest: { ry: 46, rx: -16 }, neck: { ry: -60, rx: 18 }, legR: { rx: 26 }, kneeL: [-36, 0, 0], armL: { rx: -36, rz: -36 }, elbL: [100, 0, 0], grip: G.loaded, base: { py: -0.24 } } },
    { t: 0.3, ease: 'drive', pose: { hips: { ry: -40 }, chest: { ry: -24, rx: -10 }, neck: { ry: -14 }, kneeR: [-8, 0, 0], armL: { rx: 30, rz: -10 }, elbL: [26, 0, 0], armR: { rx: 36, rz: -14 }, elbR: [22, 0, 0], grip: G.contact, base: { py: -0.2, ry: 20 } } },
    { t: 0.46, ease: 'whip', pose: { hips: { ry: -70 }, chest: { ry: -84, rx: 8 }, neck: { ry: 20, rx: 10 }, legL: { rx: 30, ry: -30 }, kneeL: [-70, 0, 0], legR: { rx: -14 }, armL: { rx: 110, rz: 30 }, elbL: [96, 0, 0], armR: { rx: 100, rz: 18 }, elbR: [90, 0, 0], grip: G.wrap, base: { py: -0.06, ry: 160, sy: 0.04 } } },
    { t: 0.64, ease: 'out', pose: { hips: { ry: -40 }, chest: { ry: -56, rx: 14 }, neck: { ry: 46, rx: 8 }, legL: { rx: -26, ry: -40 }, kneeL: [-40, 0, 0], legR: { rx: 22, ry: 14 }, kneeR: [-26, 0, 0], armL: { rx: 70, rz: 46 }, elbL: [60, 0, 0], armR: { rx: 60, rz: -40 }, elbR: [54, 0, 0], grip: { rx: -22, rz: -124 }, base: { py: -0.18, ry: 300, sy: -0.05, sx: 0.03, sz: 0.03 } } },
    // off balance, arms out, one leg crossed over, held
    { t: 0.86, ease: 'hold', pose: { hips: { ry: -8, rz: 12 }, chest: { ry: -20, rx: 18, rz: 10 }, neck: { ry: 30, rx: -8 }, legL: { rx: -10, ry: -34, rz: 14 }, kneeL: [-22, 0, 0], legR: { rx: 16, rz: 10 }, kneeR: [-34, 0, 0], armL: { rx: 46, rz: 60 }, elbL: [40, 0, 0], armR: { rx: 40, rz: -62 }, elbR: [36, 0, 0], grip: { rx: -12, rz: -104 }, base: { py: -0.3, ry: 374, sy: -0.07, sx: 0.04, sz: 0.04 } } },
    { t: 1.12, ease: 'hold', pose: { hips: { rz: 6 }, chest: { rx: -18, rz: 4 }, neck: { rx: -14, ry: 18 }, kneeL: [-30, 0, 0], kneeR: [-26, 0, 0], armL: { rx: 14, rz: 26 }, elbL: [50, 0, 0], armR: { rx: 10, rz: -30 }, elbR: [46, 0, 0], grip: { rx: 16, rz: 24 }, base: { py: -0.2, ry: 360 } } },
    { t: 1.55, ease: 'settle', pose: { chest: { rx: -8 }, neck: { rx: -6, ry: -20 }, kneeL: [-18, 0, 0], kneeR: [-16, 0, 0], armL: { rx: -10, rz: 8 }, elbL: [40, 0, 0], armR: { rx: -8, rz: -10 }, elbR: [38, 0, 0], grip: G.carry, base: { py: -0.12, ry: 360 } } },
  ],
});

/** Signature moment: the called shot at the fire escape. Big, slow, held. */
C('point', {
  dur: 1.85,
  keys: [
    { t: 0.0, pose: { hips: { ry: 14 }, chest: { ry: 16, rx: -6 }, neck: { ry: -44, rx: 14 }, kneeL: [-26, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -26, rz: -26 }, elbL: [88, 0, 0], armR: { rx: -8, rz: -46 }, elbR: [76, 0, 0], grip: G.cocked, base: { py: -0.14 } } },
    { t: 0.2, ease: 'antic', pose: { hips: { ry: 24 }, chest: { ry: 30, rx: -18 }, neck: { ry: -50, rx: -8 }, kneeL: [-34, 0, 0], kneeR: [-30, 0, 0], armL: { rx: -34, rz: -30 }, elbL: [96, 0, 0], grip: { rx: 48, rz: 60 }, base: { py: -0.24 } } },
    { t: 0.42, ease: 'out', pose: { hips: { ry: -12 }, chest: { ry: -26, rx: 8 }, neck: { ry: -4, rx: 30 }, kneeL: [-12, 0, 0], kneeR: [-10, 0, 0], armL: { rx: 122, rz: 6 }, elbL: [16, 0, 0], armR: { rx: 30, rz: -50 }, elbR: [40, 0, 0], grip: { rx: 14, rz: -42 }, base: { py: 0.02 } } },
    // the hold — arm and stick out at the fire escape for the better part of a second
    { t: 0.66, ease: 'hold', pose: { hips: { ry: -16 }, chest: { ry: -32, rx: 12 }, neck: { ry: -2, rx: 36 }, kneeL: [-8, 0, 0], kneeR: [-6, 0, 0], armL: { rx: 138, rz: 10 }, elbL: [8, 0, 0], armR: { rx: 24, rz: -56 }, elbR: [34, 0, 0], grip: G.point, base: { py: 0.06, sy: 0.03 } } },
    { t: 1.18, ease: 'hold', pose: { hips: { ry: -18 }, chest: { ry: -34, rx: 13 }, neck: { ry: -6, rx: 38 }, kneeL: [-8, 0, 0], kneeR: [-6, 0, 0], armL: { rx: 142, rz: 12 }, elbL: [6, 0, 0], armR: { rx: 22, rz: -58 }, elbR: [32, 0, 0], grip: { rx: G.point.rx + 6, rz: G.point.rz + 4 }, base: { py: 0.07, sy: 0.03 } } },
    { t: 1.5, ease: 'out', pose: { hips: { ry: 10 }, chest: { ry: 12, rx: -8 }, neck: { ry: -36, rx: 4 }, kneeL: [-22, 0, 0], kneeR: [-18, 0, 0], armL: { rx: -10, rz: -18 }, elbL: [70, 0, 0], armR: { rx: -2, rz: -40 }, elbR: [66, 0, 0], grip: { rx: 28, rz: 40 }, base: { py: -0.1 } } },
    { t: 1.85, ease: 'settle', pose: { hips: { ry: 18 }, chest: { ry: 20, rx: -6 }, neck: { ry: -46, rx: 14 }, kneeL: [-26, 0, 0], kneeR: [-22, 0, 0], armL: { rx: -26, rz: -26 }, elbL: [88, 0, 0], armR: { rx: -8, rz: -46 }, elbR: [76, 0, 0], grip: G.cocked, base: { py: -0.14 } } },
  ],
});

/** Between pitches: stick on the shoulder, a kick at the dirt, a look up the block. */
C('bat_wait', {
  dur: 2.8, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { hips: { ry: 10, rz: 4 }, chest: { ry: 14, rx: -6 }, neck: { ry: -30 }, armL: { rx: -30, rz: -22 }, elbL: [96, 0, 0], armR: { rx: -6, rz: -12 }, elbR: [30, 0, 0], grip: G.carry, kneeL: [-10, 0, 0], kneeR: [-8, 0, 0] } },
    { t: 1.0, ease: 'hold', pose: { hips: { ry: 6, rz: -4 }, chest: { ry: 10, rx: -9 }, neck: { ry: -22, rx: -6 }, armL: { rx: -34, rz: -26 }, elbL: [102, 0, 0], armR: { rx: -10, rz: -16 }, elbR: [24, 0, 0], grip: { rx: G.carry.rx + 12, rz: G.carry.rz + 8 }, kneeL: [-6, 0, 0], kneeR: [-14, 0, 0] } },
    { t: 1.9, ease: 'hold', pose: { hips: { ry: 14, rz: 5 }, chest: { ry: 18, rx: -4 }, neck: { ry: -38, rx: 6 }, armL: { rx: -26, rz: -20 }, elbL: [90, 0, 0], armR: { rx: -2, rz: -10 }, elbR: [36, 0, 0], grip: { rx: G.carry.rx + 10, rz: G.carry.rz - 6 }, kneeL: [-14, 0, 0], kneeR: [-6, 0, 0] } },
    { t: 2.8, pose: { hips: { ry: 10, rz: 4 }, chest: { ry: 14, rx: -6 }, neck: { ry: -30 }, armL: { rx: -30, rz: -22 }, elbL: [96, 0, 0], armR: { rx: -6, rz: -12 }, elbR: [30, 0, 0], grip: G.carry, kneeL: [-10, 0, 0], kneeR: [-8, 0, 0] } },
  ],
});

// ── the pitcher ─────────────────────────────────────────────────────────────
C('pitch_set', {
  dur: 2.4, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { chest: { rx: -8, ry: 6 }, neck: { rx: 6, ry: -4 }, armL: { rx: 46, rz: 22 }, elbL: [84, 0, 0], armR: { rx: 40, rz: -18 }, elbR: [76, 0, 0], kneeL: [-12, 0, 0], kneeR: [-10, 0, 0], legL: { rz: -6 }, legR: { rz: 6 } } },
    { t: 1.1, ease: 'hold', pose: { chest: { rx: -11, ry: 9 }, neck: { rx: 9, ry: -7 }, armL: { rx: 52, rz: 24 }, elbL: [92, 0, 0], armR: { rx: 46, rz: -20 }, elbR: [84, 0, 0], kneeL: [-16, 0, 0], kneeR: [-8, 0, 0], base: { py: -0.06 } } },
    { t: 2.4, pose: { chest: { rx: -8, ry: 6 }, neck: { rx: 6, ry: -4 }, armL: { rx: 46, rz: 22 }, elbL: [84, 0, 0], armR: { rx: 40, rz: -18 }, elbR: [76, 0, 0], kneeL: [-12, 0, 0], kneeR: [-10, 0, 0], legL: { rz: -6 }, legR: { rz: 6 } } },
  ],
});

/**
 * Windup. 0.9 s end to end because that is exactly how long the sim holds `wind_up`, so the
 * ball leaves the hand on the same frame the sim says it does.
 */
C('windup', {
  dur: 0.9,
  keys: [
    { t: 0.0, pose: { chest: { rx: -8, ry: 6 }, armL: { rx: 46, rz: 22 }, elbL: [84, 0, 0], armR: { rx: 40, rz: -18 }, elbR: [76, 0, 0], kneeL: [-12, 0, 0], kneeR: [-10, 0, 0] } },
    // 1. rock back — hands over the head, weight onto the back foot
    { t: 0.16, ease: 'out', pose: { chest: { rx: 14, ry: 10 }, neck: { rx: 18 }, armL: { rx: 164, rz: 14 }, elbL: [30, 0, 0], armR: { rx: 160, rz: -14 }, elbR: [30, 0, 0], kneeL: [-8, 0, 0], kneeR: [-22, 0, 0], base: { py: 0.08, sy: 0.03 }, legR: { rx: -10 } } },
    // 2. gather — hands down to the chest, knee starts up
    { t: 0.3, ease: 'hold', pose: { chest: { rx: -6, ry: 20 }, neck: { rx: 4, ry: -22 }, armL: { rx: 66, rz: 26 }, elbL: [110, 0, 0], armR: { rx: 60, rz: -22 }, elbR: [106, 0, 0], legL: { rx: 30 }, kneeL: [-56, 0, 0], kneeR: [-14, 0, 0], base: { py: -0.04 } } },
    // 3. LEG KICK APEX — the held pose the whole street imitates
    { t: 0.44, ease: 'out', pose: { chest: { rx: 6, ry: 40 }, neck: { rx: 8, ry: -46 }, armL: { rx: 54, rz: 30 }, elbL: [126, 0, 0], armR: { rx: -26, rz: -30 }, elbR: [96, 0, 0], legL: { rx: 104, rz: 8 }, kneeL: [-112, 0, 0], footL: [24, 0, 0], legR: { rx: -4 }, kneeR: [-6, 0, 0], base: { py: 0.1, sy: 0.04, sx: -0.02, sz: -0.02 } } },
    { t: 0.56, ease: 'hold', pose: { chest: { rx: 8, ry: 46 }, neck: { rx: 10, ry: -52 }, armL: { rx: 56, rz: 32 }, elbL: [130, 0, 0], armR: { rx: -40, rz: -32 }, elbR: [100, 0, 0], legL: { rx: 110, rz: 10 }, kneeL: [-118, 0, 0], footL: [28, 0, 0], legR: { rx: -4 }, kneeR: [-4, 0, 0], base: { py: 0.12, sy: 0.05, sx: -0.02, sz: -0.02 } } },
    // 4. stride — front foot reaches, arm still back: the separation again
    { t: 0.72, ease: 'drive', pose: { chest: { rx: -10, ry: 30 }, neck: { rx: 4, ry: -40 }, armL: { rx: 80, rz: 24 }, elbL: [70, 0, 0], armR: { rx: -96, rz: -26 }, elbR: [70, 0, 0], legL: { rx: 46, rz: 12 }, kneeL: [-30, 0, 0], footL: [-10, 0, 0], legR: { rx: -20 }, kneeR: [-26, 0, 0], base: { py: -0.14, pz: -0.28 } } },
    // 5. RELEASE — over the top, chest bent, back leg lifting
    { t: 0.84, ease: 'whip', pose: { chest: { rx: -34, ry: -24 }, neck: { rx: 20, ry: -10 }, armL: { rx: 22, rz: 30 }, elbL: [46, 0, 0], armR: { rx: 128, rz: -12 }, elbR: [16, 0, 0], legL: { rx: 34, rz: 10 }, kneeL: [-10, 0, 0], legR: { rx: -46 }, kneeR: [-64, 0, 0], base: { py: -0.2, pz: -0.5 }, shirt: [24, 0, 0] } },
    { t: 0.9, ease: 'whip', pose: { chest: { rx: -40, ry: -30 }, neck: { rx: 24, ry: -8 }, armL: { rx: 14, rz: 32 }, elbL: [40, 0, 0], armR: { rx: 152, rz: -10 }, elbR: [10, 0, 0], legL: { rx: 30, rz: 10 }, kneeL: [-6, 0, 0], legR: { rx: -58 }, kneeR: [-78, 0, 0], base: { py: -0.22, pz: -0.55 } } },
  ],
  events: [{ t: 0.86, name: 'release' }, { t: 0.44, name: 'apex' }],
});

/** Recovery: the back leg swings around, the pitcher squares up as a fielder. */
C('pitch_recover', {
  dur: 0.95,
  keys: [
    { t: 0.0, pose: { chest: { rx: -40, ry: -30 }, neck: { rx: 24, ry: -8 }, armL: { rx: 14, rz: 32 }, elbL: [40, 0, 0], armR: { rx: 152, rz: -10 }, elbR: [10, 0, 0], legL: { rx: 30, rz: 10 }, legR: { rx: -58 }, kneeR: [-78, 0, 0], base: { py: -0.22, pz: -0.55 } } },
    { t: 0.22, ease: 'out', pose: { chest: { rx: -44, ry: -8 }, neck: { rx: 30, ry: -4 }, armL: { rx: 50, rz: 30 }, elbL: [70, 0, 0], armR: { rx: 104, rz: -24 }, elbR: [46, 0, 0], legL: { rx: 18 }, kneeL: [-16, 0, 0], legR: { rx: -30, ry: 34 }, kneeR: [-96, 0, 0], base: { py: -0.24, pz: -0.5 } } },
    { t: 0.46, ease: 'hold', pose: { chest: { rx: -34 }, neck: { rx: 26 }, armL: { rx: 48, rz: 26 }, elbL: [78, 0, 0], armR: { rx: 46, rz: -26 }, elbR: [76, 0, 0], legL: { rx: 12, rz: -12 }, kneeL: [-30, 0, 0], legR: { rx: 6, rz: 14 }, kneeR: [-34, 0, 0], base: { py: -0.3, pz: -0.3 } } },
    { t: 0.95, ease: 'settle', pose: { chest: { rx: -26 }, neck: { rx: 22 }, armL: { rx: 30, rz: 20 }, elbL: [58, 0, 0], armR: { rx: 30, rz: -20 }, elbR: [58, 0, 0], legL: { rz: -13, rx: 6 }, legR: { rz: 13, rx: 6 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], base: { py: -0.34 } } },
  ],
});

// ── locomotion ──────────────────────────────────────────────────────────────
/**
 * Run cycle. One full cycle (two steps) per clip, and players.js drives the clip's phase from
 * DISTANCE TRAVELLED divided by `meta.stride`, not from the wall clock — that is what keeps
 * the planted foot from skating no matter what speed the sim asks for.
 * Vertical bob is 0.36 ft on a 4.9 ft kid ≈ 7%, inside BYB's 6–10% band.
 */
const THIGH_F = 47, THIGH_B = -34;
C('run', {
  dur: 1.0, loop: true, ease: 'inout',
  meta: { stride: 6.8, cadence: 2.6 },
  keys: [
    // contact, left foot down
    { t: 0.0, ease: 'out', pose: { base: { py: -0.13, sy: -0.05, sx: 0.03, sz: 0.03 }, hips: { ry: 9, rx: -4 }, chest: { rx: -15, ry: -9 }, neck: { rx: 12, ry: 8 }, legL: { rx: THIGH_F }, kneeL: [-10, 0, 0], footL: [-24, 0, 0], legR: { rx: THIGH_B }, kneeR: [-30, 0, 0], footR: [16, 0, 0], armL: { rx: -54, rz: 12 }, elbL: [62, 0, 0], armR: { rx: 58, rz: -20 }, elbR: [86, 0, 0] } },
    // absorb
    { t: 0.11, ease: 'out', pose: { base: { py: -0.2, sy: -0.09, sx: 0.05, sz: 0.05 }, hips: { ry: 6, rx: -6 }, chest: { rx: -19, ry: -6 }, neck: { rx: 14, ry: 5 }, legL: { rx: 28 }, kneeL: [-24, 0, 0], footL: [-10, 0, 0], legR: { rx: -40 }, kneeR: [-58, 0, 0], footR: [22, 0, 0], armL: { rx: -40, rz: 12 }, elbL: [70, 0, 0], armR: { rx: 44, rz: -18 }, elbR: [92, 0, 0] } },
    // passing / drive
    { t: 0.24, ease: 'inout', pose: { base: { py: -0.02, sy: 0, sx: 0, sz: 0 }, hips: { ry: 2, rx: -5 }, chest: { rx: -17 }, neck: { rx: 12 }, legL: { rx: -4 }, kneeL: [-16, 0, 0], footL: [10, 0, 0], legR: { rx: -8 }, kneeR: [-104, 0, 0], footR: [30, 0, 0], armL: { rx: -14, rz: 14 }, elbL: [76, 0, 0], armR: { rx: 16, rz: -14 }, elbR: [80, 0, 0] } },
    // airborne — the two-frame float
    { t: 0.37, ease: 'out', pose: { base: { py: 0.21, sy: 0.06, sx: -0.03, sz: -0.03 }, hips: { ry: -5, rx: -4 }, chest: { rx: -14, ry: 8 }, neck: { rx: 11, ry: -7 }, legL: { rx: THIGH_B + 2 }, kneeL: [-34, 0, 0], footL: [24, 0, 0], legR: { rx: THIGH_F - 6 }, kneeR: [-66, 0, 0], footR: [4, 0, 0], armL: { rx: 30, rz: 18 }, elbL: [80, 0, 0], armR: { rx: -26, rz: -14 }, elbR: [66, 0, 0] } },
    // contact, right foot down
    { t: 0.5, ease: 'out', pose: { base: { py: -0.13, sy: -0.05, sx: 0.03, sz: 0.03 }, hips: { ry: -9, rx: -4 }, chest: { rx: -15, ry: 9 }, neck: { rx: 12, ry: -8 }, legR: { rx: THIGH_F }, kneeR: [-10, 0, 0], footR: [-24, 0, 0], legL: { rx: THIGH_B }, kneeL: [-30, 0, 0], footL: [16, 0, 0], armR: { rx: -54, rz: -12 }, elbR: [62, 0, 0], armL: { rx: 58, rz: 20 }, elbL: [86, 0, 0] } },
    { t: 0.61, ease: 'out', pose: { base: { py: -0.2, sy: -0.09, sx: 0.05, sz: 0.05 }, hips: { ry: -6, rx: -6 }, chest: { rx: -19, ry: 6 }, neck: { rx: 14, ry: -5 }, legR: { rx: 28 }, kneeR: [-24, 0, 0], footR: [-10, 0, 0], legL: { rx: -40 }, kneeL: [-58, 0, 0], footL: [22, 0, 0], armR: { rx: -40, rz: -12 }, elbR: [70, 0, 0], armL: { rx: 44, rz: 18 }, elbL: [92, 0, 0] } },
    { t: 0.74, ease: 'inout', pose: { base: { py: -0.02, sy: 0, sx: 0, sz: 0 }, hips: { ry: -2, rx: -5 }, chest: { rx: -17 }, neck: { rx: 12 }, legR: { rx: -4 }, kneeR: [-16, 0, 0], footR: [10, 0, 0], legL: { rx: -8 }, kneeL: [-104, 0, 0], footL: [30, 0, 0], armR: { rx: -14, rz: -14 }, elbR: [76, 0, 0], armL: { rx: 16, rz: 14 }, elbL: [80, 0, 0] } },
    { t: 0.87, ease: 'out', pose: { base: { py: 0.21, sy: 0.06, sx: -0.03, sz: -0.03 }, hips: { ry: 5, rx: -4 }, chest: { rx: -14, ry: -8 }, neck: { rx: 11, ry: 7 }, legR: { rx: THIGH_B + 2 }, kneeR: [-34, 0, 0], footR: [24, 0, 0], legL: { rx: THIGH_F - 6 }, kneeL: [-66, 0, 0], footL: [4, 0, 0], armR: { rx: 30, rz: -18 }, elbR: [80, 0, 0], armL: { rx: -26, rz: 14 }, elbL: [66, 0, 0] } },
    { t: 1.0, ease: 'out', pose: { base: { py: -0.13, sy: -0.05, sx: 0.03, sz: 0.03 }, hips: { ry: 9, rx: -4 }, chest: { rx: -15, ry: -9 }, neck: { rx: 12, ry: 8 }, legL: { rx: THIGH_F }, kneeL: [-10, 0, 0], footL: [-24, 0, 0], legR: { rx: THIGH_B }, kneeR: [-30, 0, 0], footR: [16, 0, 0], armL: { rx: -54, rz: 12 }, elbL: [62, 0, 0], armR: { rx: 58, rz: -20 }, elbR: [86, 0, 0] } },
  ],
  events: [{ t: 0.02, name: 'step' }, { t: 0.52, name: 'step' }],
});

/** Additive drive layer, weighted by how far the kid is from top speed. */
C('run_drive', {
  dur: 1.0, loop: true, ease: 'inout',
  keys: [
    { t: 0, pose: { chest: { rx: -20 }, neck: { rx: 16 }, hips: { rx: -8 }, base: { pz: -0.16 }, elbL: [22, 0, 0], elbR: [22, 0, 0] } },
    { t: 1, pose: { chest: { rx: -20 }, neck: { rx: 16 }, hips: { rx: -8 }, base: { pz: -0.16 }, elbL: [22, 0, 0], elbR: [22, 0, 0] } },
  ],
});

/** The hard stop: both feet plant, everything above the knees keeps going, then a held skid. */
C('run_stop', {
  dur: 0.9,
  keys: [
    { t: 0.0, pose: { base: { py: -0.13, sy: -0.05 }, chest: { rx: -16 }, legL: { rx: 40 }, kneeL: [-14, 0, 0], legR: { rx: -30 }, kneeR: [-40, 0, 0], armL: { rx: -40 }, armR: { rx: 40 }, elbL: [70, 0, 0], elbR: [70, 0, 0] } },
    { t: 0.12, ease: 'whip', pose: { base: { py: -0.4, sy: -0.13, sx: 0.07, sz: 0.07, pz: -0.2 }, chest: { rx: 26 }, neck: { rx: -14, ry: 14 }, legL: { rx: 56, rz: -12 }, kneeL: [-22, 0, 0], footL: [-34, 0, 0], legR: { rx: 18, rz: 16 }, kneeR: [-58, 0, 0], footR: [-22, 0, 0], armL: { rx: 70, rz: 44 }, elbL: [40, 0, 0], armR: { rx: 74, rz: -48 }, elbR: [36, 0, 0], shirt: [30, 0, 0] } },
    { t: 0.34, ease: 'hold', pose: { base: { py: -0.46, sy: -0.11, sx: 0.06, sz: 0.06, pz: -0.06 }, chest: { rx: 32, rz: 6 }, neck: { rx: -18, ry: 18 }, legL: { rx: 60, rz: -13 }, kneeL: [-26, 0, 0], footL: [-38, 0, 0], legR: { rx: 14, rz: 17 }, kneeR: [-64, 0, 0], footR: [-20, 0, 0], armL: { rx: 78, rz: 50 }, elbL: [34, 0, 0], armR: { rx: 82, rz: -54 }, elbR: [30, 0, 0] } },
    { t: 0.56, ease: 'out', pose: { base: { py: -0.3, sy: -0.05, sx: 0.03, sz: 0.03 }, chest: { rx: -8 }, neck: { rx: 4 }, legL: { rx: 20, rz: -10 }, kneeL: [-34, 0, 0], legR: { rx: 4, rz: 12 }, kneeR: [-40, 0, 0], armL: { rx: 30, rz: 24 }, elbL: [54, 0, 0], armR: { rx: 32, rz: -26 }, elbR: [52, 0, 0] } },
    { t: 0.9, ease: 'settle', pose: { base: { py: -0.34 }, chest: { rx: -26 }, neck: { rx: 22 }, legL: { rz: -13, rx: 6 }, legR: { rz: 13, rx: 6 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, elbL: [58, 0, 0], armR: { rx: 30, rz: -20 }, elbR: [58, 0, 0] } },
  ],
  events: [{ t: 0.12, name: 'skid' }],
});

/** Slide into a chalk base — leading leg out, trailing leg tucked, a long held skid. */
C('slide', {
  dur: 1.55,
  keys: [
    { t: 0.0, pose: { base: { py: -0.1 }, chest: { rx: -16 }, legL: { rx: 40 }, kneeL: [-14, 0, 0], legR: { rx: -30 }, kneeR: [-40, 0, 0], armL: { rx: -40 }, armR: { rx: 40 } } },
    // launch: hips drop, leading leg fires forward
    { t: 0.14, ease: 'whip', pose: { base: { py: -0.95, rx: 34, pz: -0.3 }, hips: { rx: 10 }, chest: { rx: -34, ry: -10 }, neck: { rx: 30 }, legL: { rx: 46 }, kneeL: [-8, 0, 0], footL: [-30, 0, 0], legR: { rx: -6, rz: 24 }, kneeR: [-116, 0, 0], armL: { rx: 128, rz: 34 }, elbL: [30, 0, 0], armR: { rx: 120, rz: -40 }, elbR: [26, 0, 0], shirt: [40, 0, 0] } },
    // the held skid — this is the poster frame
    { t: 0.34, ease: 'hold', pose: { base: { py: -1.14, rx: 40, pz: -0.16 }, hips: { rx: 12 }, chest: { rx: -40, ry: -14 }, neck: { rx: 36, ry: 10 }, legL: { rx: 52 }, kneeL: [-4, 0, 0], footL: [-34, 0, 0], legR: { rx: -10, rz: 26 }, kneeR: [-122, 0, 0], armL: { rx: 140, rz: 38 }, elbL: [24, 0, 0], armR: { rx: 132, rz: -44 }, elbR: [20, 0, 0] } },
    { t: 0.66, ease: 'hold', pose: { base: { py: -1.16, rx: 42, pz: -0.1 }, hips: { rx: 12 }, chest: { rx: -42, ry: -18 }, neck: { rx: 38, ry: 14 }, legL: { rx: 54 }, kneeL: [-2, 0, 0], footL: [-36, 0, 0], legR: { rx: -12, rz: 27 }, kneeR: [-124, 0, 0], armL: { rx: 146, rz: 40 }, elbL: [20, 0, 0], armR: { rx: 136, rz: -46 }, elbR: [18, 0, 0] } },
    // hand on the chalk, a beat of stillness
    { t: 0.92, ease: 'hold', pose: { base: { py: -1.1, rx: 36 }, chest: { rx: -34, ry: -22 }, neck: { rx: 34, ry: 20 }, legL: { rx: 44 }, kneeL: [-18, 0, 0], legR: { rx: -4, rz: 24 }, kneeR: [-110, 0, 0], armL: { rx: 150, rz: 26 }, elbL: [14, 0, 0], armR: { rx: 60, rz: -50 }, elbR: [60, 0, 0] } },
    // pick yourself up
    { t: 1.2, ease: 'out', pose: { base: { py: -0.72, rx: 16 }, chest: { rx: -40 }, neck: { rx: 34 }, legL: { rx: 34 }, kneeL: [-60, 0, 0], legR: { rx: 12, rz: 16 }, kneeR: [-80, 0, 0], armL: { rx: 70, rz: 20 }, elbL: [50, 0, 0], armR: { rx: 40, rz: -30 }, elbR: [64, 0, 0] } },
    { t: 1.55, ease: 'settle', pose: { base: { py: -0.12 }, chest: { rx: -10 }, neck: { rx: 6 }, kneeL: [-18, 0, 0], kneeR: [-16, 0, 0], armL: { rx: 6, rz: 12 }, elbL: [34, 0, 0], armR: { rx: 6, rz: -12 }, elbR: [34, 0, 0] } },
  ],
  events: [{ t: 0.14, name: 'dust' }],
});

/** Dive. Full extension held for a quarter second, then a landing squash and a slide-out. */
C('dive', {
  dur: 1.5,
  keys: [
    { t: 0.0, pose: { base: { py: -0.34 }, chest: { rx: -26 }, neck: { rx: 22 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, armR: { rx: 30, rz: -20 }, elbL: [58, 0, 0], elbR: [58, 0, 0] } },
    // coil
    { t: 0.12, ease: 'antic', pose: { base: { py: -0.66, sy: -0.1, sx: 0.06, sz: 0.06 }, chest: { rx: -40 }, neck: { rx: 30 }, legL: { rx: 22, rz: -16 }, legR: { rx: 22, rz: 16 }, kneeL: [-78, 0, 0], kneeR: [-78, 0, 0], armL: { rx: -24, rz: 22 }, armR: { rx: -24, rz: -22 }, elbL: [40, 0, 0], elbR: [40, 0, 0] } },
    // launch
    { t: 0.26, ease: 'whip', pose: { base: { py: 0.6, rx: -52, pz: -0.5, sy: 0.1, sx: -0.05, sz: -0.05 }, chest: { rx: -20, rz: -8 }, neck: { rx: 30 }, legL: { rx: -16, rz: -10 }, legR: { rx: -22, rz: 8 }, kneeL: [-30, 0, 0], kneeR: [-16, 0, 0], armL: { rx: 156, rz: 12 }, elbL: [10, 0, 0], armR: { rx: 150, rz: -18 }, elbR: [14, 0, 0], shirt: [46, 0, 0] } },
    // FULL EXTENSION — held
    { t: 0.4, ease: 'hold', pose: { base: { py: 0.78, rx: -70, pz: -0.8, sy: 0.12, sx: -0.06, sz: -0.06 }, chest: { rx: -12, rz: -10 }, neck: { rx: 34 }, legL: { rx: -10, rz: -12 }, legR: { rx: -16, rz: 10 }, kneeL: [-22, 0, 0], kneeR: [-10, 0, 0], armL: { rx: 172, rz: 10 }, elbL: [4, 0, 0], armR: { rx: 164, rz: -22 }, elbR: [8, 0, 0] } },
    { t: 0.6, ease: 'hold', pose: { base: { py: 0.74, rx: -74, pz: -0.9, sy: 0.12, sx: -0.06, sz: -0.06 }, chest: { rx: -10, rz: -12 }, neck: { rx: 36 }, legL: { rx: -8, rz: -12 }, legR: { rx: -14, rz: 10 }, kneeL: [-18, 0, 0], kneeR: [-8, 0, 0], armL: { rx: 176, rz: 8 }, elbL: [2, 0, 0], armR: { rx: 168, rz: -24 }, elbR: [6, 0, 0] } },
    // landing squash
    { t: 0.76, ease: 'whip', pose: { base: { py: -1.24, rx: -84, pz: -0.9, sy: -0.16, sx: 0.09, sz: 0.09 }, chest: { rx: -26, rz: -6 }, neck: { rx: 40 }, legL: { rx: -6, rz: -14 }, legR: { rx: -12, rz: 12 }, kneeL: [-34, 0, 0], kneeR: [-26, 0, 0], armL: { rx: 170, rz: 14 }, elbL: [16, 0, 0], armR: { rx: 150, rz: -30 }, elbR: [30, 0, 0] } },
    { t: 0.98, ease: 'hold', pose: { base: { py: -1.3, rx: -80, pz: -0.7 }, chest: { rx: -30, rz: -4, ry: -10 }, neck: { rx: 44, ry: 8 }, legL: { rx: -4, rz: -14 }, legR: { rx: -10, rz: 12 }, kneeL: [-40, 0, 0], kneeR: [-30, 0, 0], armL: { rx: 178, rz: 10 }, elbL: [10, 0, 0], armR: { rx: 120, rz: -34 }, elbR: [50, 0, 0] } },
    // up on an elbow, ball in the air
    { t: 1.2, ease: 'out', pose: { base: { py: -1.0, rx: -58, pz: -0.5 }, chest: { rx: -22, ry: -16 }, neck: { rx: 46, ry: 14 }, legL: { rx: 8, rz: -12 }, legR: { rx: -4, rz: 12 }, kneeL: [-66, 0, 0], kneeR: [-50, 0, 0], armL: { rx: 164, rz: 20 }, elbL: [30, 0, 0], armR: { rx: 74, rz: -40 }, elbR: [70, 0, 0] } },
    { t: 1.5, ease: 'settle', pose: { base: { py: -0.62, rx: -18 }, chest: { rx: -34 }, neck: { rx: 30 }, kneeL: [-76, 0, 0], kneeR: [-70, 0, 0], armL: { rx: 120, rz: 16 }, elbL: [40, 0, 0], armR: { rx: 40, rz: -28 }, elbR: [60, 0, 0] } },
  ],
  events: [{ t: 0.76, name: 'dust' }],
});

/** Jump catch — crouch, launch, stretch, an apex hold, then a landing squash. */
C('jump_catch', {
  dur: 1.25,
  keys: [
    { t: 0.0, pose: { base: { py: -0.34 }, chest: { rx: -26 }, neck: { rx: 22 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, armR: { rx: 30, rz: -20 }, elbL: [58, 0, 0], elbR: [58, 0, 0] } },
    { t: 0.12, ease: 'antic', pose: { base: { py: -0.78, sy: -0.13, sx: 0.08, sz: 0.08 }, chest: { rx: -40 }, neck: { rx: 32 }, legL: { rx: 20, rz: -14 }, legR: { rx: 20, rz: 14 }, kneeL: [-88, 0, 0], kneeR: [-88, 0, 0], armL: { rx: -42, rz: 18 }, armR: { rx: -42, rz: -18 }, elbL: [30, 0, 0], elbR: [30, 0, 0] } },
    { t: 0.28, ease: 'whip', pose: { base: { py: 1.5, sy: 0.14, sx: -0.07, sz: -0.07 }, chest: { rx: 10 }, neck: { rx: 34 }, legL: { rx: -8, rz: -8 }, legR: { rx: 14, rz: 8 }, kneeL: [-50, 0, 0], kneeR: [-16, 0, 0], armL: { rx: 178, rz: 8 }, elbL: [6, 0, 0], armR: { rx: 170, rz: -14 }, elbR: [14, 0, 0], shirt: [34, 0, 0] } },
    // apex — held
    { t: 0.42, ease: 'hold', pose: { base: { py: 1.86, sy: 0.1, sx: -0.05, sz: -0.05 }, chest: { rx: 16, rz: 4 }, neck: { rx: 40 }, legL: { rx: -14, rz: -8 }, legR: { rx: 22, rz: 8 }, kneeL: [-58, 0, 0], kneeR: [-12, 0, 0], armL: { rx: 182, rz: 6 }, elbL: [2, 0, 0], armR: { rx: 176, rz: -12 }, elbR: [8, 0, 0] } },
    { t: 0.56, ease: 'hold', pose: { base: { py: 1.78, sy: 0.08, sx: -0.04, sz: -0.04 }, chest: { rx: 14, rz: 2 }, neck: { rx: 38 }, legL: { rx: -18, rz: -8 }, legR: { rx: 18, rz: 8 }, kneeL: [-62, 0, 0], kneeR: [-16, 0, 0], armL: { rx: 180, rz: 8 }, elbL: [6, 0, 0], armR: { rx: 172, rz: -14 }, elbR: [12, 0, 0] } },
    // land + squash
    { t: 0.74, ease: 'whip', pose: { base: { py: -0.86, sy: -0.17, sx: 0.1, sz: 0.1 }, chest: { rx: -36 }, neck: { rx: 28 }, legL: { rx: 18, rz: -16 }, legR: { rx: 18, rz: 16 }, kneeL: [-92, 0, 0], kneeR: [-92, 0, 0], armL: { rx: 104, rz: 26 }, elbL: [56, 0, 0], armR: { rx: 96, rz: -30 }, elbR: [62, 0, 0], brim: [-22, 0, 0] } },
    { t: 0.9, ease: 'out', pose: { base: { py: -0.5, sy: -0.04, sx: 0.02, sz: 0.02 }, chest: { rx: -24 }, neck: { rx: 20 }, kneeL: [-60, 0, 0], kneeR: [-60, 0, 0], armL: { rx: 66, rz: 22 }, elbL: [64, 0, 0], armR: { rx: 60, rz: -24 }, elbR: [68, 0, 0] } },
    { t: 1.25, ease: 'settle', pose: { base: { py: -0.34 }, chest: { rx: -26 }, neck: { rx: 22 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, armR: { rx: 30, rz: -20 }, elbL: [58, 0, 0], elbR: [58, 0, 0] } },
  ],
  events: [{ t: 0.74, name: 'land' }],
});

/** Comic failure #1 — the bobble. Deliberately stepped at 12 fps for the stutter. */
C('fumble', {
  dur: 1.6, fps: 12,
  keys: [
    { t: 0.0, pose: { base: { py: -0.34 }, chest: { rx: -26 }, neck: { rx: 22 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 60, rz: 22 }, armR: { rx: 60, rz: -22 }, elbL: [70, 0, 0], elbR: [70, 0, 0] } },
    { t: 0.14, ease: 'pop', pose: { base: { py: -0.28 }, chest: { rx: -10, rz: -14 }, neck: { rx: 40, ry: 14 }, armL: { rx: 150, rz: 26 }, elbL: [24, 0, 0], armR: { rx: 60, rz: -30 }, elbR: [80, 0, 0] } },
    { t: 0.3, ease: 'pop', pose: { base: { py: -0.2, sy: 0.04 }, chest: { rx: 6, rz: 18 }, neck: { rx: 46, ry: -18 }, armL: { rx: 70, rz: 40 }, elbL: [76, 0, 0], armR: { rx: 158, rz: -20 }, elbR: [18, 0, 0], legL: { rx: 20 }, kneeL: [-40, 0, 0] } },
    { t: 0.46, ease: 'pop', pose: { base: { py: -0.44, sy: -0.06 }, chest: { rx: -30, rz: -20 }, neck: { rx: 20, ry: 22 }, armL: { rx: 166, rz: 34 }, elbL: [12, 0, 0], armR: { rx: 40, rz: -46 }, elbR: [90, 0, 0], legR: { rx: 26, rz: 20 }, kneeR: [-56, 0, 0] } },
    { t: 0.62, ease: 'pop', pose: { base: { py: -0.16, sy: 0.05 }, chest: { rx: 14, rz: 22 }, neck: { rx: 50, ry: -24 }, armL: { rx: 60, rz: 48 }, elbL: [86, 0, 0], armR: { rx: 172, rz: -14 }, elbR: [8, 0, 0], legL: { rx: 30, rz: -18 }, kneeL: [-48, 0, 0] } },
    { t: 0.8, ease: 'pop', pose: { base: { py: -0.6, sy: -0.1, sx: 0.06, sz: 0.06 }, chest: { rx: -46, rz: -6 }, neck: { rx: 34 }, armL: { rx: 150, rz: 20 }, elbL: [30, 0, 0], armR: { rx: 144, rz: -24 }, elbR: [34, 0, 0], kneeL: [-84, 0, 0], kneeR: [-84, 0, 0] } },
    // got it. probably. look at the crowd
    { t: 1.02, ease: 'pop', pose: { base: { py: -0.5 }, chest: { rx: -34 }, neck: { rx: 14, ry: -30 }, armL: { rx: 120, rz: 16 }, elbL: [58, 0, 0], armR: { rx: 114, rz: -18 }, elbR: [60, 0, 0], kneeL: [-70, 0, 0], kneeR: [-70, 0, 0] } },
    { t: 1.6, ease: 'settle', pose: { base: { py: -0.34 }, chest: { rx: -26 }, neck: { rx: 22, ry: -6 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, armR: { rx: 30, rz: -20 }, elbL: [58, 0, 0], elbR: [58, 0, 0] } },
  ],
});

/** The throw: crow-hop, a held coil, then a whip and a follow-through across the body. */
C('throw', {
  dur: 1.1,
  keys: [
    { t: 0.0, pose: { base: { py: -0.34 }, chest: { rx: -26 }, neck: { rx: 22 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, armR: { rx: 30, rz: -20 }, elbL: [58, 0, 0], elbR: [58, 0, 0] } },
    // coil back
    { t: 0.18, ease: 'out', pose: { base: { py: -0.2, pz: 0.2 }, hips: { ry: 26 }, chest: { rx: -6, ry: 40 }, neck: { rx: 10, ry: -44 }, legR: { rx: -20, rz: 10 }, kneeR: [-30, 0, 0], legL: { rx: 16 }, kneeL: [-26, 0, 0], armR: { rx: -108, rz: -26 }, elbR: [86, 0, 0], armL: { rx: 104, rz: 30 }, elbL: [22, 0, 0], shirt: [20, 0, 0] } },
    { t: 0.34, ease: 'hold', pose: { base: { py: -0.24, pz: 0.24 }, hips: { ry: 32 }, chest: { rx: -4, ry: 48 }, neck: { rx: 12, ry: -52 }, legR: { rx: -24, rz: 12 }, kneeR: [-34, 0, 0], legL: { rx: 30 }, kneeL: [-20, 0, 0], armR: { rx: -124, rz: -30 }, elbR: [96, 0, 0], armL: { rx: 116, rz: 34 }, elbL: [16, 0, 0] } },
    // whip through
    { t: 0.48, ease: 'whip', pose: { base: { py: -0.3, pz: -0.24 }, hips: { ry: -22 }, chest: { rx: -24, ry: -24 }, neck: { rx: 18, ry: -6 }, legL: { rx: 44 }, kneeL: [-12, 0, 0], legR: { rx: -24 }, kneeR: [-60, 0, 0], armR: { rx: 142, rz: -8 }, elbR: [16, 0, 0], armL: { rx: 20, rz: 34 }, elbL: [56, 0, 0] } },
    { t: 0.6, ease: 'out', pose: { base: { py: -0.36, pz: -0.3 }, hips: { ry: -34 }, chest: { rx: -40, ry: -40 }, neck: { rx: 26, ry: 8 }, legL: { rx: 38 }, kneeL: [-16, 0, 0], legR: { rx: -34, ry: 20 }, kneeR: [-86, 0, 0], armR: { rx: 80, rz: 46 }, elbR: [66, 0, 0], armL: { rx: -30, rz: 34 }, elbL: [46, 0, 0], shirt: [-26, 0, 0] } },
    { t: 0.8, ease: 'hold', pose: { base: { py: -0.42, pz: -0.24 }, hips: { ry: -40 }, chest: { rx: -46, ry: -46 }, neck: { rx: 30, ry: 14 }, legL: { rx: 30 }, kneeL: [-24, 0, 0], legR: { rx: -26, ry: 30 }, kneeR: [-94, 0, 0], armR: { rx: 54, rz: 54 }, elbR: [76, 0, 0], armL: { rx: -40, rz: 30 }, elbL: [40, 0, 0] } },
    { t: 1.1, ease: 'settle', pose: { base: { py: -0.34 }, chest: { rx: -26 }, neck: { rx: 22 }, kneeL: [-44, 0, 0], kneeR: [-44, 0, 0], armL: { rx: 30, rz: 20 }, armR: { rx: 30, rz: -20 }, elbL: [58, 0, 0], elbR: [58, 0, 0] } },
  ],
  events: [{ t: 0.48, name: 'release' }],
});

// ── celebrations and dejection ──────────────────────────────────────────────
/*
 * A note on why every cheer here stretches the arms.
 *
 * These kids are 3.2 head-heights tall (DESIGN-BIBLE §5.1) and their arms are barely longer
 * than their heads, so "arms straight up" puts the mitts level with the top of the cap and
 * disappears into the head silhouette — the pose reads as *standing there*, which is exactly
 * how the first pass of this scene looked on a contact sheet. Two fixes, both classic:
 * splay the arms into a wide V (rz 44-56) so the mitts clear the head left and right, and
 * STRETCH the arm chain (sy 0.18-0.34) on the up-beat so it reaches. Squash and stretch is
 * cheaper than anatomy and it is what a cel animator would have done.
 */

/*
 * Raising a kid's arms, and why it is done with rz rather than rx.
 *
 * These heads are 30% of the kid (DESIGN-BIBLE §5.1) and the arms are barely longer than the
 * head is tall, so rotating an arm up through the shoulder's rx axis parks the mitt directly
 * behind the cap and the pose vanishes — on the first contact sheet it read as two rabbit
 * ears. Stretching the arm only made the mitt a point. What works is taking the arm OUT to
 * the side (armL negative rz, armR positive: that shoulder sits at -X, so OUT is -rz) so the whole limb, and the mitt on the end of it, is silhouetted
 * against the background clear of the head, with a small rx to swing it forward of the
 * frontal plane so it still reads at a three-quarter angle. A gentle sy stretch is kept on
 * the up-beat only, for the snap.
 */

/** Both arms up and out in a wide V, bouncing on the toes, head thrown back. */
C('cheer_arms', {
  dur: 1.02, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: -0.10, sy: -0.07, sx: 0.04, sz: 0.04 }, hips: { rz: 4 }, chest: { rx: 6, rz: -4 }, neck: { rx: 14, ry: 6 }, armL: { rx: 16, rz: -104 }, armR: { rx: 16, rz: 104 }, elbL: [26, 0, 0], elbR: [26, 0, 0], legL: { rz: -9 }, legR: { rz: 9 }, kneeL: [-34, 0, 0], kneeR: [-34, 0, 0], footL: [8, 0, 0], footR: [8, 0, 0] } },
    { t: 0.17, ease: 'whip', pose: { base: { py: 0.30, sy: 0.11, sx: -0.055, sz: -0.055 }, hips: { rz: -3 }, chest: { rx: 20, rz: 5 }, neck: { rx: 24, ry: -8 }, armL: { rx: 8, rz: -146, sy: 0.14 }, armR: { rx: 8, rz: 146, sy: 0.14 }, elbL: [8, 0, 0], elbR: [8, 0, 0], legL: { rz: -5, rx: -6 }, legR: { rz: 5, rx: 6 }, kneeL: [-6, 0, 0], kneeR: [-6, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0], shirt: [34, 0, 0], brim: [10, 0, 0] } },
    { t: 0.34, ease: 'hold', pose: { base: { py: 0.24, sy: 0.08, sx: -0.04, sz: -0.04 }, hips: { rz: -5 }, chest: { rx: 18, rz: 8 }, neck: { rx: 22, ry: -14 }, armL: { rx: 12, rz: -140, sy: 0.12 }, armR: { rx: 4, rz: 152, sy: 0.12 }, elbL: [14, 0, 0], elbR: [4, 0, 0], legL: { rz: -6, rx: -4 }, legR: { rz: 6, rx: 4 }, kneeL: [-10, 0, 0], kneeR: [-8, 0, 0], footL: [-26, 0, 0], footR: [-26, 0, 0] } },
    { t: 0.51, ease: 'out', pose: { base: { py: -0.12, sy: -0.09, sx: 0.05, sz: 0.05 }, hips: { rz: 5 }, chest: { rx: 4, rz: -6 }, neck: { rx: 12, ry: 10 }, armL: { rx: 18, rz: -100 }, armR: { rx: 18, rz: 100 }, elbL: [30, 0, 0], elbR: [30, 0, 0], legL: { rz: -10 }, legR: { rz: 10 }, kneeL: [-38, 0, 0], kneeR: [-38, 0, 0], footL: [10, 0, 0], footR: [10, 0, 0], brim: [-14, 0, 0] } },
    { t: 0.68, ease: 'whip', pose: { base: { py: 0.28, sy: 0.11, sx: -0.055, sz: -0.055 }, hips: { rz: 3 }, chest: { rx: 20, rz: -5 }, neck: { rx: 24, ry: 14 }, armL: { rx: 4, rz: -152, sy: 0.14 }, armR: { rx: 12, rz: 140, sy: 0.14 }, elbL: [4, 0, 0], elbR: [14, 0, 0], legL: { rz: -5, rx: 6 }, legR: { rz: 5, rx: -6 }, kneeL: [-6, 0, 0], kneeR: [-6, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0], shirt: [-28, 0, 0] } },
    { t: 0.85, ease: 'hold', pose: { base: { py: 0.20, sy: 0.07, sx: -0.035, sz: -0.035 }, hips: { rz: 4 }, chest: { rx: 16, rz: -7 }, neck: { rx: 22, ry: 8 }, armL: { rx: 8, rz: -144, sy: 0.12 }, armR: { rx: 8, rz: 144, sy: 0.12 }, elbL: [10, 0, 0], elbR: [10, 0, 0], kneeL: [-12, 0, 0], kneeR: [-12, 0, 0], footL: [-22, 0, 0], footR: [-22, 0, 0] } },
    { t: 1.02, ease: 'out', pose: { base: { py: -0.10, sy: -0.07, sx: 0.04, sz: 0.04 }, hips: { rz: 4 }, chest: { rx: 6, rz: -4 }, neck: { rx: 14, ry: 6 }, armL: { rx: 16, rz: -104 }, armR: { rx: 16, rz: 104 }, elbL: [26, 0, 0], elbR: [26, 0, 0], legL: { rz: -9 }, legR: { rz: 9 }, kneeL: [-34, 0, 0], kneeR: [-34, 0, 0], footL: [8, 0, 0], footR: [8, 0, 0] } },
  ],
  events: [{ t: 0.02, name: 'face:yell' }, { t: 0.55, name: 'face:grin' }],
});

/** Straight up in the air, legs scissored. Deep load, real hang time, a landing that hurts. */
C('cheer_jump', {
  dur: 1.06, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: -0.62, sy: -0.15, sx: 0.09, sz: 0.09 }, chest: { rx: -26 }, neck: { rx: 14 }, legL: { rx: 14, rz: -16 }, legR: { rx: 14, rz: 16 }, kneeL: [-80, 0, 0], kneeR: [-80, 0, 0], armL: { rx: -52, rz: -14 }, armR: { rx: -52, rz: 14 }, elbL: [44, 0, 0], elbR: [44, 0, 0] } },
    // 1. the load, deeper still — everything goes down before it goes up
    { t: 0.10, ease: 'antic', pose: { base: { py: -0.88, sy: -0.21, sx: 0.13, sz: 0.13 }, chest: { rx: -42 }, neck: { rx: 22 }, legL: { rx: 20, rz: -18 }, legR: { rx: 20, rz: 18 }, kneeL: [-98, 0, 0], kneeR: [-98, 0, 0], armL: { rx: -76, rz: -10 }, armR: { rx: -76, rz: 10 }, elbL: [26, 0, 0], elbR: [26, 0, 0], brim: [-20, 0, 0] } },
    // 2. launch — stretched thin, arms fired up and out
    { t: 0.20, ease: 'whip', pose: { base: { py: 1.46, sy: 0.19, sx: -0.095, sz: -0.095 }, chest: { rx: 12 }, neck: { rx: 20 }, legL: { rx: 34, rz: -8 }, legR: { rx: -34, rz: 8 }, kneeL: [-64, 0, 0], kneeR: [-30, 0, 0], footL: [-30, 0, 0], footR: [-34, 0, 0], armL: { rx: 12, rz: -138, sy: 0.16 }, armR: { rx: 12, rz: 138, sy: 0.16 }, elbL: [12, 0, 0], elbR: [12, 0, 0], shirt: [40, 0, 0], brim: [22, 0, 0] } },
    // 3. APEX — held: one knee tucked up front, one heel kicked back, mitts wide of the cap
    { t: 0.32, ease: 'hold', pose: { base: { py: 1.94, sy: 0.10, sx: -0.05, sz: -0.05 }, chest: { rx: 18, rz: 5 }, neck: { rx: 24, ry: -10 }, legL: { rx: 62, rz: -12 }, legR: { rx: -46, rz: 12 }, kneeL: [-96, 0, 0], kneeR: [-24, 0, 0], footL: [-24, 0, 0], footR: [-36, 0, 0], armL: { rx: 6, rz: -152, sy: 0.16 }, armR: { rx: 6, rz: 152, sy: 0.16 }, elbL: [4, 0, 0], elbR: [4, 0, 0] } },
    { t: 0.45, ease: 'hold', pose: { base: { py: 1.84, sy: 0.08, sx: -0.04, sz: -0.04 }, chest: { rx: 16, rz: -5 }, neck: { rx: 22, ry: 12 }, legL: { rx: 46, rz: -12 }, legR: { rx: -56, rz: 12 }, kneeL: [-80, 0, 0], kneeR: [-18, 0, 0], footL: [-22, 0, 0], footR: [-36, 0, 0], armL: { rx: 10, rz: -146, sy: 0.14 }, armR: { rx: 2, rz: 156, sy: 0.14 }, elbL: [8, 0, 0], elbR: [2, 0, 0] } },
    // 4. the landing — squashed to 80% for three frames, cap over the eyes
    { t: 0.58, ease: 'whip', pose: { base: { py: -0.82, sy: -0.21, sx: 0.13, sz: 0.13 }, chest: { rx: -40 }, neck: { rx: 8 }, legL: { rx: 18, rz: -18 }, legR: { rx: 18, rz: 18 }, kneeL: [-100, 0, 0], kneeR: [-100, 0, 0], footL: [16, 0, 0], footR: [16, 0, 0], armL: { rx: 46, rz: -72 }, armR: { rx: 46, rz: 72 }, elbL: [62, 0, 0], elbR: [62, 0, 0], brim: [-26, 0, 0], shirt: [-34, 0, 0] } },
    { t: 0.70, ease: 'hold', pose: { base: { py: -0.74, sy: -0.16, sx: 0.09, sz: 0.09 }, chest: { rx: -32, rz: 4 }, neck: { rx: 12, ry: -6 }, legL: { rx: 16, rz: -17 }, legR: { rx: 16, rz: 17 }, kneeL: [-90, 0, 0], kneeR: [-90, 0, 0], armL: { rx: 36, rz: -58 }, armR: { rx: 36, rz: 58 }, elbL: [66, 0, 0], elbR: [66, 0, 0] } },
    { t: 1.06, ease: 'out', pose: { base: { py: -0.62, sy: -0.15, sx: 0.09, sz: 0.09 }, chest: { rx: -26 }, neck: { rx: 14 }, legL: { rx: 14, rz: -16 }, legR: { rx: 14, rz: 16 }, kneeL: [-80, 0, 0], kneeR: [-80, 0, 0], armL: { rx: -52, rz: -14 }, armR: { rx: -52, rz: 14 }, elbL: [44, 0, 0], elbR: [44, 0, 0] } },
  ],
  events: [{ t: 0.20, name: 'face:yell' }, { t: 0.58, name: 'land' }],
});

/** One arm straight up waving the whole block over, the other hand slapping the thigh. */
C('cheer_wave', {
  dur: 1.5, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: -0.04, sy: -0.03 }, hips: { rz: 5 }, chest: { rx: 4, rz: -8, ry: -6 }, neck: { rx: 16, ry: -8 }, armL: { rx: 10, rz: -150 }, elbL: [12, 0, 0], armR: { rx: 22, rz: 34 }, elbR: [44, 0, 0], kneeL: [-16, 0, 0], kneeR: [-22, 0, 0] } },
    { t: 0.24, ease: 'whip', pose: { base: { py: 0.06 }, hips: { rz: -4 }, chest: { rx: 8, rz: 10, ry: 8 }, neck: { rx: 20, ry: 10 }, armL: { rx: 10, rz: -126, sy: 0.12 }, elbL: [4, 0, 0], armR: { rx: 34, rz: 40 }, elbR: [56, 0, 0], kneeL: [-22, 0, 0], kneeR: [-14, 0, 0], shirt: [22, 0, 0] } },
    { t: 0.48, ease: 'whip', pose: { base: { py: 0.04 }, hips: { rz: 5 }, chest: { rx: 8, rz: -10, ry: -8 }, neck: { rx: 20, ry: -10 }, armL: { rx: 10, rz: -168, sy: 0.12 }, elbL: [8, 0, 0], armR: { rx: 20, rz: 30 }, elbR: [40, 0, 0], kneeL: [-14, 0, 0], kneeR: [-22, 0, 0], shirt: [-22, 0, 0] } },
    { t: 0.72, ease: 'whip', pose: { base: { py: 0.06 }, hips: { rz: -4 }, chest: { rx: 8, rz: 10, ry: 8 }, neck: { rx: 20, ry: 10 }, armL: { rx: 10, rz: -128, sy: 0.14 }, elbL: [2, 0, 0], armR: { rx: 36, rz: 42 }, elbR: [58, 0, 0], kneeL: [-24, 0, 0], kneeR: [-12, 0, 0] } },
    // a beat where the arm comes down and he shouts up at the fourth floor instead
    { t: 1.0, ease: 'out', pose: { base: { py: -0.06 }, hips: { rz: 6 }, chest: { rx: -6, rz: -6, ry: -14 }, neck: { rx: 28, ry: -18 }, armL: { rx: 40, rz: -86 }, elbL: [86, 0, 0], armR: { rx: 40, rz: 90 }, elbR: [90, 0, 0], kneeL: [-20, 0, 0], kneeR: [-20, 0, 0] } },
    { t: 1.22, ease: 'hold', pose: { base: { py: -0.08 }, hips: { rz: 6 }, chest: { rx: -8, rz: -5, ry: -16 }, neck: { rx: 30, ry: -20 }, armL: { rx: 44, rz: -92 }, elbL: [92, 0, 0], armR: { rx: 44, rz: 96 }, elbR: [94, 0, 0], kneeL: [-24, 0, 0], kneeR: [-18, 0, 0] } },
    { t: 1.5, ease: 'out', pose: { base: { py: -0.04, sy: -0.03 }, hips: { rz: 5 }, chest: { rx: 4, rz: -8, ry: -6 }, neck: { rx: 16, ry: -8 }, armL: { rx: 10, rz: -150 }, elbL: [12, 0, 0], armR: { rx: 22, rz: 34 }, elbR: [44, 0, 0], kneeL: [-16, 0, 0], kneeR: [-22, 0, 0] } },
  ],
  events: [{ t: 0.02, name: 'face:grin' }, { t: 1.02, name: 'face:yell' }],
});

/**
 * Being mobbed at the plate. Arms up and out in the V, and four smaller people shoving him
 * around: the root rolls and slides, the cap gets knocked, the head whips from one shoulder
 * to the other. The beat is deliberately off from the crew's jumps so the group never pulses
 * as one animation.
 */
C('mobbed', {
  dur: 1.5, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: 0.06, rz: 6, px: 0.10 }, hips: { rz: -5 }, chest: { rx: 10, rz: -8 }, neck: { rx: 18, ry: -16 }, armL: { rx: 14, rz: -116 }, armR: { rx: 14, rz: 116 }, elbL: [20, 0, 0], elbR: [20, 0, 0], kneeL: [-18, 0, 0], kneeR: [-24, 0, 0] } },
    { t: 0.22, ease: 'snap', pose: { base: { py: 0.34, rz: -9, px: -0.16, sy: 0.06, sx: -0.03, sz: -0.03 }, hips: { rz: 7 }, chest: { rx: 18, rz: 11 }, neck: { rx: 24, ry: 20 }, armL: { rx: 6, rz: -148, sy: 0.15 }, armR: { rx: 6, rz: 156, sy: 0.15 }, elbL: [6, 0, 0], elbR: [2, 0, 0], kneeL: [-8, 0, 0], kneeR: [-6, 0, 0], footL: [-24, 0, 0], footR: [-24, 0, 0], brim: [-20, 0, 0], shirt: [30, 0, 0] } },
    { t: 0.46, ease: 'snap', pose: { base: { py: 0.10, rz: 10, px: 0.18 }, hips: { rz: -8 }, chest: { rx: 8, rz: -13 }, neck: { rx: 16, ry: -24 }, armL: { rx: 18, rz: -122 }, armR: { rx: 10, rz: 134 }, elbL: [26, 0, 0], elbR: [14, 0, 0], kneeL: [-28, 0, 0], kneeR: [-10, 0, 0], brim: [14, 0, 0] } },
    { t: 0.72, ease: 'snap', pose: { base: { py: 0.42, rz: -6, px: -0.10, sy: 0.07, sx: -0.035, sz: -0.035 }, hips: { rz: 6 }, chest: { rx: 20, rz: 8 }, neck: { rx: 26, ry: 14 }, armL: { rx: 4, rz: -156, sy: 0.17 }, armR: { rx: 4, rz: 150, sy: 0.17 }, elbL: [2, 0, 0], elbR: [6, 0, 0], kneeL: [-6, 0, 0], kneeR: [-8, 0, 0], footL: [-26, 0, 0], footR: [-26, 0, 0], shirt: [-24, 0, 0] } },
    { t: 0.98, ease: 'snap', pose: { base: { py: 0.04, rz: 8, px: 0.14 }, hips: { rz: -6 }, chest: { rx: 10, rz: -10 }, neck: { rx: 18, ry: -18 }, armL: { rx: 16, rz: -128 }, armR: { rx: 12, rz: 120 }, elbL: [22, 0, 0], elbR: [16, 0, 0], kneeL: [-22, 0, 0], kneeR: [-16, 0, 0], brim: [-12, 0, 0] } },
    { t: 1.24, ease: 'snap', pose: { base: { py: 0.32, rz: -10, px: -0.18, sy: 0.05 }, hips: { rz: 8 }, chest: { rx: 16, rz: 12 }, neck: { rx: 24, ry: 22 }, armL: { rx: 8, rz: -144, sy: 0.14 }, armR: { rx: 8, rz: 158, sy: 0.14 }, elbL: [8, 0, 0], elbR: [4, 0, 0], kneeL: [-10, 0, 0], kneeR: [-6, 0, 0], footL: [-20, 0, 0], footR: [-20, 0, 0] } },
    { t: 1.5, ease: 'out', pose: { base: { py: 0.06, rz: 6, px: 0.10 }, hips: { rz: -5 }, chest: { rx: 10, rz: -8 }, neck: { rx: 18, ry: -16 }, armL: { rx: 14, rz: -116 }, armR: { rx: 14, rz: 116 }, elbL: [20, 0, 0], elbR: [20, 0, 0], kneeL: [-18, 0, 0], kneeR: [-24, 0, 0] } },
  ],
  events: [{ t: 0.02, name: 'face:yell' }, { t: 0.76, name: 'face:grin' }],
});

/**
 * The other half of the mob: a kid piling ON. Leans into the middle with both arms reaching
 * up and forward for a shoulder, and bounces on the spot. The lean lives in the chest, not
 * the root — tipping the whole kid over reads as falling down rather than crowding in, which
 * is exactly how the first pass of this clip looked on a contact sheet.
 */
C('mob_pile', {
  dur: 1.18, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: -0.30, pz: -0.18, rx: -5, sy: -0.08, sx: 0.05, sz: 0.05 }, hips: { rx: -6 }, chest: { rx: -20, rz: 6 }, neck: { rx: 26, ry: -8 }, armL: { rx: -96, rz: -40 }, armR: { rx: -96, rz: 40 }, elbL: [40, 0, 0], elbR: [40, 0, 0], legL: { rx: 22, rz: -12 }, legR: { rx: -14, rz: 12 }, kneeL: [-44, 0, 0], kneeR: [-56, 0, 0] } },
    { t: 0.16, ease: 'whip', pose: { base: { py: 0.66, pz: -0.36, rx: -9, sy: 0.13, sx: -0.065, sz: -0.065 }, hips: { rx: -9 }, chest: { rx: -8, rz: -6 }, neck: { rx: 30, ry: 10 }, armL: { rx: -128, rz: -56 }, armR: { rx: -128, rz: 56 }, elbL: [16, 0, 0], elbR: [16, 0, 0], legL: { rx: -18, rz: -10 }, legR: { rx: -26, rz: 10 }, kneeL: [-70, 0, 0], kneeR: [-84, 0, 0], footL: [-26, 0, 0], footR: [-26, 0, 0], shirt: [36, 0, 0], brim: [18, 0, 0] } },
    { t: 0.32, ease: 'hold', pose: { base: { py: 0.84, pz: -0.42, rx: -11, sy: 0.09, sx: -0.045, sz: -0.045 }, hips: { rx: -10 }, chest: { rx: -4, rz: 8 }, neck: { rx: 32, ry: -12 }, armL: { rx: -138, rz: -64 }, armR: { rx: -132, rz: 50 }, elbL: [10, 0, 0], elbR: [14, 0, 0], legL: { rx: -24, rz: -12 }, legR: { rx: -32, rz: 12 }, kneeL: [-82, 0, 0], kneeR: [-92, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0] } },
    { t: 0.50, ease: 'whip', pose: { base: { py: -0.44, pz: -0.22, rx: -4, sy: -0.15, sx: 0.09, sz: 0.09 }, hips: { rx: -4 }, chest: { rx: -32, rz: -8 }, neck: { rx: 20, ry: 14 }, armL: { rx: -66, rz: -34 }, armR: { rx: -66, rz: 34 }, elbL: [58, 0, 0], elbR: [58, 0, 0], legL: { rx: 26, rz: -14 }, legR: { rx: 20, rz: 14 }, kneeL: [-72, 0, 0], kneeR: [-76, 0, 0], brim: [-24, 0, 0], shirt: [-30, 0, 0] } },
    { t: 0.72, ease: 'out', pose: { base: { py: -0.22, pz: -0.26, rx: -7, sy: -0.05, sx: 0.03, sz: 0.03 }, hips: { rx: -7 }, chest: { rx: -16, rz: 5 }, neck: { rx: 28, ry: -6 }, armL: { rx: -108, rz: -46 }, armR: { rx: -108, rz: 46 }, elbL: [30, 0, 0], elbR: [30, 0, 0], legL: { rx: 18, rz: -12 }, legR: { rx: -10, rz: 12 }, kneeL: [-40, 0, 0], kneeR: [-50, 0, 0] } },
    { t: 1.18, ease: 'out', pose: { base: { py: -0.30, pz: -0.18, rx: -5, sy: -0.08, sx: 0.05, sz: 0.05 }, hips: { rx: -6 }, chest: { rx: -20, rz: 6 }, neck: { rx: 26, ry: -8 }, armL: { rx: -96, rz: -40 }, armR: { rx: -96, rz: 40 }, elbL: [40, 0, 0], elbR: [40, 0, 0], legL: { rx: 22, rz: -12 }, legR: { rx: -14, rz: 12 }, kneeL: [-44, 0, 0], kneeR: [-56, 0, 0] } },
  ],
  events: [{ t: 0.02, name: 'face:yell' }, { t: 0.50, name: 'land' }],
});

/** The home-run trot: slow, bouncy, chest out, one hand up to the fourth-floor windows. */
C('trot', {
  dur: 1.6, loop: true, ease: 'inout',
  meta: { stride: 5.2 },
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: -0.06, sy: -0.04, sx: 0.02, sz: 0.02 }, hips: { ry: 7 }, chest: { rx: 8, ry: -7 }, neck: { rx: 14, ry: 6 }, legL: { rx: 34 }, kneeL: [-22, 0, 0], footL: [-16, 0, 0], legR: { rx: -24 }, kneeR: [-48, 0, 0], armL: { rx: -26, rz: 14 }, elbL: [48, 0, 0], armR: { rx: 150, rz: -22 }, elbR: [30, 0, 0] } },
    { t: 0.24, ease: 'out', pose: { base: { py: 0.22, sy: 0.06, sx: -0.03, sz: -0.03 }, hips: { ry: -4 }, chest: { rx: 12, ry: 4 }, neck: { rx: 18, ry: -5 }, legL: { rx: -20 }, kneeL: [-40, 0, 0], legR: { rx: 30 }, kneeR: [-70, 0, 0], armL: { rx: 14, rz: 18 }, elbL: [56, 0, 0], armR: { rx: 158, rz: -16 }, elbR: [22, 0, 0] } },
    { t: 0.44, ease: 'out', pose: { base: { py: -0.08, sy: -0.05, sx: 0.03, sz: 0.03 }, hips: { ry: -7 }, chest: { rx: 8, ry: 7 }, neck: { rx: 14, ry: -6 }, legR: { rx: 34 }, kneeR: [-22, 0, 0], footR: [-16, 0, 0], legL: { rx: -24 }, kneeL: [-48, 0, 0], armR: { rx: 168, rz: -14 }, elbR: [14, 0, 0], armL: { rx: 12, rz: 16 }, elbL: [52, 0, 0] } },
    { t: 0.68, ease: 'out', pose: { base: { py: 0.22, sy: 0.06, sx: -0.03, sz: -0.03 }, hips: { ry: 4 }, chest: { rx: 12, ry: -4 }, neck: { rx: 18, ry: 5 }, legR: { rx: -20 }, kneeR: [-40, 0, 0], legL: { rx: 30 }, kneeL: [-70, 0, 0], armR: { rx: 176, rz: -10 }, elbR: [8, 0, 0], armL: { rx: -20, rz: 14 }, elbL: [44, 0, 0] } },
    { t: 0.88, ease: 'out', pose: { base: { py: -0.06, sy: -0.04, sx: 0.02, sz: 0.02 }, hips: { ry: 7 }, chest: { rx: 8, ry: -7 }, neck: { rx: 14, ry: 6 }, legL: { rx: 34 }, kneeL: [-22, 0, 0], footL: [-16, 0, 0], legR: { rx: -24 }, kneeR: [-48, 0, 0], armL: { rx: -26, rz: 14 }, elbL: [48, 0, 0], armR: { rx: 150, rz: -22 }, elbR: [30, 0, 0] } },
    { t: 1.12, ease: 'out', pose: { base: { py: 0.22, sy: 0.06, sx: -0.03, sz: -0.03 }, hips: { ry: -4 }, chest: { rx: 12, ry: 4 }, neck: { rx: 20, ry: -14 }, legL: { rx: -20 }, kneeL: [-40, 0, 0], legR: { rx: 30 }, kneeR: [-70, 0, 0], armL: { rx: 14, rz: 18 }, elbL: [56, 0, 0], armR: { rx: 178, rz: -26 }, elbR: [10, 0, 0] } },
    { t: 1.32, ease: 'out', pose: { base: { py: -0.08, sy: -0.05, sx: 0.03, sz: 0.03 }, hips: { ry: -7 }, chest: { rx: 8, ry: 7 }, neck: { rx: 14, ry: -16 }, legR: { rx: 34 }, kneeR: [-22, 0, 0], footR: [-16, 0, 0], legL: { rx: -24 }, kneeL: [-48, 0, 0], armR: { rx: 186, rz: -30 }, elbR: [6, 0, 0], armL: { rx: 12, rz: 16 }, elbL: [52, 0, 0] } },
    { t: 1.6, ease: 'out', pose: { base: { py: -0.06, sy: -0.04, sx: 0.02, sz: 0.02 }, hips: { ry: 7 }, chest: { rx: 8, ry: -7 }, neck: { rx: 14, ry: 6 }, legL: { rx: 34 }, kneeL: [-22, 0, 0], footL: [-16, 0, 0], legR: { rx: -24 }, kneeR: [-48, 0, 0], armL: { rx: -26, rz: 14 }, elbL: [48, 0, 0], armR: { rx: 150, rz: -22 }, elbR: [30, 0, 0] } },
  ],
});

/** Thumbing your nose — the period's own gesture, and the only taunt we need. */
C('taunt', {
  dur: 2.0, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { hips: { rz: 6 }, chest: { rx: -12, rz: -6 }, neck: { rx: 8, ry: -10 }, armL: { rx: 40, rz: 44 }, elbL: [96, 0, 0], armR: { rx: 40, rz: -44 }, elbR: [96, 0, 0], legL: { rz: -10 }, legR: { rz: 12 }, kneeL: [-10, 0, 0], kneeR: [-18, 0, 0] } },
    { t: 0.34, ease: 'snap', pose: { hips: { rz: 6 }, chest: { rx: -20, rz: -8 }, neck: { rx: 12, ry: -12 }, armL: { rx: 128, rz: 22 }, elbL: [120, 0, 0], armR: { rx: 40, rz: -44 }, elbR: [96, 0, 0], base: { py: 0.04 } } },
    { t: 0.56, ease: 'snap', pose: { hips: { rz: 5 }, chest: { rx: -24, rz: -6 }, neck: { rx: 16, ry: -14 }, armL: { rx: 132, rz: 30 }, elbL: [126, 0, 0], armR: { rx: 122, rz: -26 }, elbR: [118, 0, 0], base: { py: 0.07 } } },
    { t: 0.74, ease: 'snap', pose: { hips: { rz: 5 }, chest: { rx: -20, rz: -10 }, neck: { rx: 12, ry: -12 }, armL: { rx: 128, rz: 20 }, elbL: [118, 0, 0], armR: { rx: 128, rz: -34 }, elbR: [126, 0, 0], base: { py: 0.03 } } },
    { t: 0.92, ease: 'snap', pose: { hips: { rz: 5 }, chest: { rx: -26, rz: -6 }, neck: { rx: 18, ry: -16 }, armL: { rx: 134, rz: 32 }, elbL: [128, 0, 0], armR: { rx: 120, rz: -22 }, elbR: [114, 0, 0], base: { py: 0.08 } } },
    { t: 1.2, ease: 'out', pose: { hips: { rz: 7 }, chest: { rx: -10, rz: -4, ry: 12 }, neck: { rx: 6, ry: -22 }, armL: { rx: 34, rz: 46 }, elbL: [88, 0, 0], armR: { rx: 34, rz: -46 }, elbR: [88, 0, 0], base: { py: 0 } } },
    { t: 1.56, ease: 'hold', pose: { hips: { rz: -5 }, chest: { rx: -14, rz: 6, ry: -12 }, neck: { rx: 10, ry: 6 }, armL: { rx: 44, rz: 40 }, elbL: [100, 0, 0], armR: { rx: 44, rz: -40 }, elbR: [100, 0, 0] } },
    { t: 2.0, ease: 'out', pose: { hips: { rz: 6 }, chest: { rx: -12, rz: -6 }, neck: { rx: 8, ry: -10 }, armL: { rx: 40, rz: 44 }, elbL: [96, 0, 0], armR: { rx: 40, rz: -44 }, elbR: [96, 0, 0], legL: { rz: -10 }, legR: { rz: 12 }, kneeL: [-10, 0, 0], kneeR: [-18, 0, 0] } },
  ],
});

/** The sulk. Everything drops, the slump holds, and the recovery is slower than the collapse. */
C('sulk', {
  dur: 3.4, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: -0.22, sy: -0.04, sx: 0.02, sz: 0.02 }, hips: { rz: -5 }, chest: { rx: -26, rz: 4 }, neck: { rx: -30, ry: 8 }, armL: { rx: -12, rz: 10 }, elbL: [16, 0, 0], armR: { rx: -12, rz: -10 }, elbR: [16, 0, 0], kneeL: [-16, 0, 0], kneeR: [-14, 0, 0] } },
    { t: 1.0, ease: 'hold', pose: { base: { py: -0.26, sy: -0.05, sx: 0.03, sz: 0.03 }, hips: { rz: -6 }, chest: { rx: -30, rz: 5 }, neck: { rx: -34, ry: 12 }, armL: { rx: -14, rz: 11 }, elbL: [20, 0, 0], armR: { rx: -14, rz: -11 }, elbR: [20, 0, 0], kneeL: [-20, 0, 0], kneeR: [-12, 0, 0] } },
    // one half-hearted kick at the road
    { t: 1.5, ease: 'out', pose: { base: { py: -0.24 }, chest: { rx: -28 }, neck: { rx: -36 }, legR: { rx: 22 }, kneeR: [-26, 0, 0], footR: [14, 0, 0], armR: { rx: -16, rz: -12 } } },
    { t: 1.86, ease: 'hold', pose: { base: { py: -0.26 }, chest: { rx: -31 }, neck: { rx: -33, ry: -8 }, legR: { rx: -6 }, kneeR: [-12, 0, 0] } },
    { t: 2.6, ease: 'hold', pose: { base: { py: -0.2, sy: -0.03 }, hips: { rz: 5 }, chest: { rx: -24, rz: -4 }, neck: { rx: -28, ry: -10 }, armL: { rx: -10, rz: 12 }, elbL: [22, 0, 0], armR: { rx: -10, rz: -12 }, elbR: [22, 0, 0], kneeL: [-12, 0, 0], kneeR: [-18, 0, 0] } },
    { t: 3.4, pose: { base: { py: -0.22, sy: -0.04, sx: 0.02, sz: 0.02 }, hips: { rz: -5 }, chest: { rx: -26, rz: 4 }, neck: { rx: -30, ry: 8 }, armL: { rx: -12, rz: 10 }, elbL: [16, 0, 0], armR: { rx: -12, rz: -10 }, elbR: [16, 0, 0], kneeL: [-16, 0, 0], kneeR: [-14, 0, 0] } },
  ],
});

/**
 * Being mobbed at the plate. Arms up in the V, and four smaller people shoving him around:
 * the root rolls and slides, the cap gets knocked, the head whips from one shoulder to the
 * other. The stagger is deliberately off-beat from the crew's jumps so the group never
 * pulses as one animation.
 */
C('mobbed', {
  dur: 1.5, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: 0.06, rz: 6, px: 0.10 }, hips: { rz: -5 }, chest: { rx: 12, rz: -8 }, neck: { rx: 30, ry: -16 }, armL: { rx: 172, rz: 48, sy: 0.26 }, armR: { rx: 172, rz: -48, sy: 0.26 }, elbL: [14, 0, 0], elbR: [14, 0, 0], kneeL: [-18, 0, 0], kneeR: [-24, 0, 0] } },
    { t: 0.22, ease: 'snap', pose: { base: { py: 0.34, rz: -9, px: -0.16, sy: 0.06, sx: -0.03, sz: -0.03 }, hips: { rz: 7 }, chest: { rx: 20, rz: 11 }, neck: { rx: 38, ry: 20 }, armL: { rx: 188, rz: 40, sy: 0.34 }, armR: { rx: 188, rz: -56, sy: 0.34 }, elbL: [2, 0, 0], elbR: [2, 0, 0], kneeL: [-8, 0, 0], kneeR: [-6, 0, 0], footL: [-24, 0, 0], footR: [-24, 0, 0], brim: [-20, 0, 0], shirt: [30, 0, 0] } },
    { t: 0.46, ease: 'snap', pose: { base: { py: 0.10, rz: 10, px: 0.18 }, hips: { rz: -8 }, chest: { rx: 8, rz: -13 }, neck: { rx: 26, ry: -24 }, armL: { rx: 168, rz: 56, sy: 0.24 }, armR: { rx: 176, rz: -38, sy: 0.28 }, elbL: [22, 0, 0], elbR: [10, 0, 0], kneeL: [-28, 0, 0], kneeR: [-10, 0, 0], brim: [14, 0, 0] } },
    { t: 0.72, ease: 'snap', pose: { base: { py: 0.40, rz: -6, px: -0.10, sy: 0.07, sx: -0.035, sz: -0.035 }, hips: { rz: 6 }, chest: { rx: 22, rz: 8 }, neck: { rx: 40, ry: 14 }, armL: { rx: 190, rz: 44, sy: 0.36 }, armR: { rx: 190, rz: -52, sy: 0.36 }, elbL: [0, 0, 0], elbR: [0, 0, 0], kneeL: [-6, 0, 0], kneeR: [-8, 0, 0], footL: [-26, 0, 0], footR: [-26, 0, 0], shirt: [-24, 0, 0] } },
    { t: 0.98, ease: 'snap', pose: { base: { py: 0.04, rz: 8, px: 0.14 }, hips: { rz: -6 }, chest: { rx: 10, rz: -10 }, neck: { rx: 28, ry: -18 }, armL: { rx: 170, rz: 52, sy: 0.22 }, armR: { rx: 178, rz: -44, sy: 0.28 }, elbL: [18, 0, 0], elbR: [8, 0, 0], kneeL: [-22, 0, 0], kneeR: [-16, 0, 0], brim: [-12, 0, 0] } },
    { t: 1.24, ease: 'snap', pose: { base: { py: 0.30, rz: -10, px: -0.18, sy: 0.05 }, hips: { rz: 8 }, chest: { rx: 18, rz: 12 }, neck: { rx: 36, ry: 22 }, armL: { rx: 186, rz: 38, sy: 0.32 }, armR: { rx: 186, rz: -58, sy: 0.32 }, elbL: [4, 0, 0], elbR: [4, 0, 0], kneeL: [-10, 0, 0], kneeR: [-6, 0, 0], footL: [-20, 0, 0], footR: [-20, 0, 0] } },
    { t: 1.5, ease: 'out', pose: { base: { py: 0.06, rz: 6, px: 0.10 }, hips: { rz: -5 }, chest: { rx: 12, rz: -8 }, neck: { rx: 30, ry: -16 }, armL: { rx: 172, rz: 48, sy: 0.26 }, armR: { rx: 172, rz: -48, sy: 0.26 }, elbL: [14, 0, 0], elbR: [14, 0, 0], kneeL: [-18, 0, 0], kneeR: [-24, 0, 0] } },
  ],
  events: [{ t: 0.02, name: 'face:yell' }, { t: 0.76, name: 'face:grin' }],
});

/**
 * The other half of the mob: a kid piling ON. Leans hard into the middle, both arms forward
 * to grab a shoulder, bouncing on the spot. Read as a wedge pointing at the star.
 */
C('mob_pile', {
  dur: 1.18, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: -0.30, pz: -0.20, rx: -12, sy: -0.08, sx: 0.05, sz: 0.05 }, hips: { rx: -8 }, chest: { rx: -22, rz: 6 }, neck: { rx: 34, ry: -8 }, armL: { rx: 124, rz: 34, sy: 0.14 }, armR: { rx: 124, rz: -34, sy: 0.14 }, elbL: [40, 0, 0], elbR: [40, 0, 0], legL: { rx: 22, rz: -12 }, legR: { rx: -14, rz: 12 }, kneeL: [-44, 0, 0], kneeR: [-56, 0, 0] } },
    { t: 0.16, ease: 'whip', pose: { base: { py: 0.62, pz: -0.44, rx: -20, sy: 0.12, sx: -0.06, sz: -0.06 }, hips: { rx: -12 }, chest: { rx: -10, rz: -6 }, neck: { rx: 42, ry: 10 }, armL: { rx: 152, rz: 40, sy: 0.28 }, armR: { rx: 152, rz: -40, sy: 0.28 }, elbL: [18, 0, 0], elbR: [18, 0, 0], legL: { rx: -18, rz: -10 }, legR: { rx: -26, rz: 10 }, kneeL: [-70, 0, 0], kneeR: [-84, 0, 0], footL: [-26, 0, 0], footR: [-26, 0, 0], shirt: [36, 0, 0], brim: [18, 0, 0] } },
    { t: 0.32, ease: 'hold', pose: { base: { py: 0.78, pz: -0.50, rx: -24, sy: 0.08, sx: -0.04, sz: -0.04 }, hips: { rx: -14 }, chest: { rx: -6, rz: 8 }, neck: { rx: 46, ry: -12 }, armL: { rx: 162, rz: 46, sy: 0.30 }, armR: { rx: 158, rz: -36, sy: 0.30 }, elbL: [10, 0, 0], elbR: [14, 0, 0], legL: { rx: -24, rz: -12 }, legR: { rx: -32, rz: 12 }, kneeL: [-82, 0, 0], kneeR: [-92, 0, 0], footL: [-30, 0, 0], footR: [-30, 0, 0] } },
    { t: 0.50, ease: 'whip', pose: { base: { py: -0.42, pz: -0.24, rx: -10, sy: -0.14, sx: 0.09, sz: 0.09 }, hips: { rx: -6 }, chest: { rx: -32, rz: -8 }, neck: { rx: 26, ry: 14 }, armL: { rx: 96, rz: 30 }, armR: { rx: 96, rz: -30 }, elbL: [58, 0, 0], elbR: [58, 0, 0], legL: { rx: 26, rz: -14 }, legR: { rx: 20, rz: 14 }, kneeL: [-72, 0, 0], kneeR: [-76, 0, 0], brim: [-24, 0, 0], shirt: [-30, 0, 0] } },
    { t: 0.72, ease: 'out', pose: { base: { py: -0.22, pz: -0.28, rx: -14, sy: -0.05, sx: 0.03, sz: 0.03 }, hips: { rx: -9 }, chest: { rx: -18, rz: 5 }, neck: { rx: 36, ry: -6 }, armL: { rx: 132, rz: 36, sy: 0.16 }, armR: { rx: 132, rz: -36, sy: 0.16 }, elbL: [34, 0, 0], elbR: [34, 0, 0], legL: { rx: 18, rz: -12 }, legR: { rx: -10, rz: 12 }, kneeL: [-40, 0, 0], kneeR: [-50, 0, 0] } },
    { t: 1.18, ease: 'out', pose: { base: { py: -0.30, pz: -0.20, rx: -12, sy: -0.08, sx: 0.05, sz: 0.05 }, hips: { rx: -8 }, chest: { rx: -22, rz: 6 }, neck: { rx: 34, ry: -8 }, armL: { rx: 124, rz: 34, sy: 0.14 }, armR: { rx: 124, rz: -34, sy: 0.14 }, elbL: [40, 0, 0], elbR: [40, 0, 0], legL: { rx: 22, rz: -12 }, legR: { rx: -14, rz: 12 }, kneeL: [-44, 0, 0], kneeR: [-56, 0, 0] } },
  ],
  events: [{ t: 0.02, name: 'face:yell' }, { t: 0.50, name: 'land' }],
});

// ── signature moments ───────────────────────────────────────────────────────
/** CAR! Everything stops on one frame. Held for well over a second. */
C('freeze', {
  dur: 2.4,
  keys: [
    { t: 0.0, pose: {} },
    { t: 0.07, ease: 'pop', pose: { base: { py: 0.16, sy: 0.06, sx: -0.03, sz: -0.03 }, hips: { ry: 18 }, chest: { rx: 14, ry: 22 }, neck: { rx: 10, ry: 62 }, armL: { rx: 54, rz: 50 }, elbL: [70, 0, 0], armR: { rx: 50, rz: -54 }, elbR: [66, 0, 0], legL: { rx: 34 }, kneeL: [-56, 0, 0], footL: [24, 0, 0], legR: { rx: -10, rz: 10 }, kneeR: [-8, 0, 0], brim: [16, 0, 0] } },
    { t: 0.9, ease: 'hold', pose: { base: { py: 0.1, sy: 0.04, sx: -0.02, sz: -0.02 }, hips: { ry: 20 }, chest: { rx: 12, ry: 24 }, neck: { rx: 8, ry: 66 }, armL: { rx: 56, rz: 52 }, elbL: [72, 0, 0], armR: { rx: 52, rz: -56 }, elbR: [68, 0, 0], legL: { rx: 32 }, kneeL: [-58, 0, 0], footL: [22, 0, 0], legR: { rx: -10, rz: 10 }, kneeR: [-8, 0, 0] } },
    { t: 1.5, ease: 'hold', pose: { base: { py: -0.08 }, hips: { ry: 22 }, chest: { rx: -8, ry: 26 }, neck: { rx: -4, ry: 68 }, armL: { rx: 30, rz: 34 }, elbL: [64, 0, 0], armR: { rx: 28, rz: -38 }, elbR: [60, 0, 0], legL: { rx: 8 }, kneeL: [-26, 0, 0], legR: { rx: -6, rz: 10 }, kneeR: [-18, 0, 0] } },
    { t: 2.4, ease: 'hold', pose: { base: { py: -0.1 }, hips: { ry: 22 }, chest: { rx: -10, ry: 26 }, neck: { rx: -6, ry: 66 }, armL: { rx: 26, rz: 30 }, elbL: [60, 0, 0], armR: { rx: 24, rz: -34 }, elbR: [56, 0, 0], kneeL: [-24, 0, 0], kneeR: [-20, 0, 0] } },
  ],
});

/** Standing at the curb with the stick vertical, watching the Model T crawl past. */
C('curb_wait', {
  dur: 2.8, loop: true, ease: 'inout',
  keys: [
    { t: 0.0, pose: { chest: { rx: -6, ry: 10 }, neck: { ry: 46, rx: 4 }, armL: { rx: -4, rz: 10 }, elbL: [12, 0, 0], armR: { rx: -4, rz: -10 }, elbR: [12, 0, 0], grip: { rx: -4, rz: -6 }, kneeL: [-8, 0, 0], kneeR: [-12, 0, 0], hips: { rz: 4 } } },
    { t: 1.1, ease: 'hold', pose: { chest: { rx: -8, ry: 14 }, neck: { ry: 60, rx: -3 }, armL: { rx: -6, rz: 12 }, elbL: [16, 0, 0], armR: { rx: -2, rz: -12 }, elbR: [16, 0, 0], grip: { rx: -8, rz: -10 }, kneeL: [-14, 0, 0], kneeR: [-6, 0, 0], hips: { rz: -4 } } },
    { t: 2.0, ease: 'hold', pose: { chest: { rx: -5, ry: 8 }, neck: { ry: 36, rx: 6 }, armL: { rx: -2, rz: 9 }, elbL: [10, 0, 0], armR: { rx: -6, rz: -9 }, elbR: [10, 0, 0], grip: { rx: -2, rz: -4 }, kneeL: [-6, 0, 0], kneeR: [-14, 0, 0], hips: { rz: 5 } } },
    { t: 2.8, pose: { chest: { rx: -6, ry: 10 }, neck: { ry: 46, rx: 4 }, armL: { rx: -4, rz: 10 }, elbL: [12, 0, 0], armR: { rx: -4, rz: -10 }, elbR: [12, 0, 0], grip: { rx: -4, rz: -6 }, kneeL: [-8, 0, 0], kneeR: [-12, 0, 0], hips: { rz: 4 } } },
  ],
});

/** The argument, side A: the jabbing finger. Stepped, because shouting is staccato. */
C('argue_jab', {
  dur: 1.9, loop: true, fps: 12,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { pz: -0.16 }, hips: { rx: -6 }, chest: { rx: -22, ry: -6 }, neck: { rx: 18, ry: 4 }, armL: { rx: 60, rz: 30 }, elbL: [80, 0, 0], armR: { rx: 96, rz: -18 }, elbR: [56, 0, 0], legL: { rx: 16 }, kneeL: [-18, 0, 0], legR: { rx: -12 }, kneeR: [-22, 0, 0] } },
    { t: 0.2, ease: 'whip', pose: { base: { pz: -0.34 }, hips: { rx: -10 }, chest: { rx: -30, ry: -10 }, neck: { rx: 24, ry: 6 }, armL: { rx: 56, rz: 34 }, elbL: [76, 0, 0], armR: { rx: 142, rz: -10 }, elbR: [14, 0, 0] } },
    { t: 0.36, ease: 'out', pose: { base: { pz: -0.2 }, hips: { rx: -7 }, chest: { rx: -24, ry: -6 }, neck: { rx: 20 }, armR: { rx: 100, rz: -16 }, elbR: [60, 0, 0] } },
    { t: 0.52, ease: 'whip', pose: { base: { pz: -0.36 }, hips: { rx: -11 }, chest: { rx: -32, ry: -12 }, neck: { rx: 26, ry: 8 }, armR: { rx: 148, rz: -8 }, elbR: [10, 0, 0], armL: { rx: 50, rz: 38 }, elbL: [70, 0, 0] } },
    { t: 0.78, ease: 'hold', pose: { base: { pz: -0.24 }, hips: { rx: -8 }, chest: { rx: -26, ry: -4 }, neck: { rx: 22, ry: -4 }, armL: { rx: 66, rz: 34 }, elbL: [86, 0, 0], armR: { rx: 80, rz: -26 }, elbR: [72, 0, 0] } },
    { t: 1.06, ease: 'whip', pose: { base: { pz: -0.4 }, hips: { rx: -13 }, chest: { rx: -36, ry: -14 }, neck: { rx: 30, ry: 10 }, armL: { rx: 46, rz: 42 }, elbL: [64, 0, 0], armR: { rx: 152, rz: -6 }, elbR: [8, 0, 0] } },
    { t: 1.36, ease: 'out', pose: { base: { pz: -0.22 }, hips: { rx: -7 }, chest: { rx: -24, ry: -4 }, neck: { rx: 20, ry: -6 }, armL: { rx: 62, rz: 32 }, elbL: [82, 0, 0], armR: { rx: 90, rz: -22 }, elbR: [64, 0, 0] } },
    { t: 1.9, ease: 'out', pose: { base: { pz: -0.16 }, hips: { rx: -6 }, chest: { rx: -22, ry: -6 }, neck: { rx: 18, ry: 4 }, armL: { rx: 60, rz: 30 }, elbL: [80, 0, 0], armR: { rx: 96, rz: -18 }, elbR: [56, 0, 0], legL: { rx: 16 }, kneeL: [-18, 0, 0], legR: { rx: -12 }, kneeR: [-22, 0, 0] } },
  ],
});

/** The argument, side B: hands thrown up, appealing to the entire block. */
C('argue_appeal', {
  dur: 1.9, loop: true, fps: 12,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { pz: -0.1 }, chest: { rx: -14, ry: 6 }, neck: { rx: 10, ry: -6 }, armL: { rx: 74, rz: 46 }, elbL: [64, 0, 0], armR: { rx: 74, rz: -46 }, elbR: [64, 0, 0], kneeL: [-14, 0, 0], kneeR: [-14, 0, 0] } },
    { t: 0.26, ease: 'whip', pose: { base: { pz: 0.06, py: 0.06 }, chest: { rx: 12, ry: 10 }, neck: { rx: 26, ry: -8 }, armL: { rx: 150, rz: 54 }, elbL: [30, 0, 0], armR: { rx: 150, rz: -54 }, elbR: [30, 0, 0], kneeL: [-4, 0, 0], kneeR: [-4, 0, 0] } },
    { t: 0.5, ease: 'hold', pose: { base: { pz: 0.1, py: 0.04 }, chest: { rx: 16, ry: 14 }, neck: { rx: 30, ry: -12 }, armL: { rx: 158, rz: 58 }, elbL: [24, 0, 0], armR: { rx: 158, rz: -58 }, elbR: [24, 0, 0] } },
    { t: 0.76, ease: 'whip', pose: { base: { pz: -0.14 }, chest: { rx: -22, ry: 4 }, neck: { rx: 14, ry: -2 }, armL: { rx: 56, rz: 40 }, elbL: [82, 0, 0], armR: { rx: 56, rz: -40 }, elbR: [82, 0, 0], kneeL: [-22, 0, 0], kneeR: [-22, 0, 0] } },
    { t: 1.06, ease: 'whip', pose: { base: { pz: 0.04, py: 0.05 }, chest: { rx: 10, ry: 12 }, neck: { rx: 24, ry: -14 }, armL: { rx: 146, rz: 50 }, elbL: [34, 0, 0], armR: { rx: 146, rz: -50 }, elbR: [34, 0, 0] } },
    { t: 1.42, ease: 'out', pose: { base: { pz: -0.12 }, chest: { rx: -18, ry: 8 }, neck: { rx: 12, ry: -8 }, armL: { rx: 70, rz: 44 }, elbL: [70, 0, 0], armR: { rx: 70, rz: -44 }, elbR: [70, 0, 0] } },
    { t: 1.9, ease: 'out', pose: { base: { pz: -0.1 }, chest: { rx: -14, ry: 6 }, neck: { rx: 10, ry: -6 }, armL: { rx: 74, rz: 46 }, elbL: [64, 0, 0], armR: { rx: 74, rz: -46 }, elbR: [64, 0, 0], kneeL: [-14, 0, 0], kneeR: [-14, 0, 0] } },
  ],
});

/** A kid on the stoop who is not in the game, flipping cigarette cards at the wall. */
C('sit_flip', {
  dur: 2.4, loop: true,
  keys: [
    { t: 0.0, ease: 'out', pose: { base: { py: -1.28 }, chest: { rx: -16 }, neck: { rx: 12, ry: 10 }, legL: { rx: 78, rz: -16 }, kneeL: [-86, 0, 0], legR: { rx: 74, rz: 16 }, kneeR: [-92, 0, 0], armL: { rx: 30, rz: 26 }, elbL: [70, 0, 0], armR: { rx: 40, rz: -28 }, elbR: [76, 0, 0] } },
    { t: 0.4, ease: 'out', pose: { base: { py: -1.28 }, chest: { rx: -10, ry: 12 }, neck: { rx: 16, ry: 6 }, legL: { rx: 78, rz: -16 }, kneeL: [-86, 0, 0], legR: { rx: 74, rz: 16 }, kneeR: [-92, 0, 0], armL: { rx: 28, rz: 24 }, elbL: [66, 0, 0], armR: { rx: 94, rz: -22 }, elbR: [102, 0, 0] } },
    { t: 0.56, ease: 'whip', pose: { base: { py: -1.26 }, chest: { rx: -20, ry: -10 }, neck: { rx: 8, ry: -8 }, legL: { rx: 78, rz: -16 }, kneeL: [-86, 0, 0], legR: { rx: 74, rz: 16 }, kneeR: [-92, 0, 0], armL: { rx: 30, rz: 26 }, elbL: [70, 0, 0], armR: { rx: 140, rz: -12 }, elbR: [24, 0, 0] } },
    { t: 1.0, ease: 'hold', pose: { base: { py: -1.3 }, chest: { rx: -18, ry: -4 }, neck: { rx: 14, ry: -12 }, legL: { rx: 78, rz: -16 }, kneeL: [-86, 0, 0], legR: { rx: 74, rz: 16 }, kneeR: [-92, 0, 0], armL: { rx: 34, rz: 28 }, elbL: [74, 0, 0], armR: { rx: 56, rz: -30 }, elbR: [80, 0, 0] } },
    { t: 1.7, ease: 'hold', pose: { base: { py: -1.26 }, chest: { rx: -14, ry: 4 }, neck: { rx: 10, ry: 14 }, legL: { rx: 76, rz: -18 }, kneeL: [-82, 0, 0], legR: { rx: 76, rz: 14 }, kneeR: [-96, 0, 0], armL: { rx: 26, rz: 24 }, elbL: [64, 0, 0], armR: { rx: 44, rz: -26 }, elbR: [72, 0, 0] } },
    { t: 2.4, ease: 'out', pose: { base: { py: -1.28 }, chest: { rx: -16 }, neck: { rx: 12, ry: 10 }, legL: { rx: 78, rz: -16 }, kneeL: [-86, 0, 0], legR: { rx: 74, rz: 16 }, kneeR: [-92, 0, 0], armL: { rx: 30, rz: 26 }, elbL: [70, 0, 0], armR: { rx: 40, rz: -28 }, elbR: [76, 0, 0] } },
  ],
});

/* ============================================================================
   FACE TRACKS
   A kid whose face never changes is a puppet. Rather than bury the beat inside the pose
   keys, every clip that has a mood declares it here as (time, expression) pairs which are
   pushed onto the clip's own event list; players.js turns `face:*` events into a call to the
   character piece's setExpression(). Timing can be retuned without hunting through poses.
   ========================================================================= */
const FACE_TRACKS = {
  stance:        [[0.0, 'determined']],
  bat_wait:      [[0.0, 'neutral'], [1.4, 'smug']],
  swing:         [[0.0, 'determined'], [0.42, 'yell'], [0.72, 'grin']],
  swing_check:   [[0.0, 'determined'], [0.26, 'shock'], [0.6, 'squint']],
  whiff:         [[0.0, 'determined'], [0.3, 'yell'], [0.62, 'shock'], [1.1, 'disappointed']],
  point:         [[0.0, 'smug'], [0.42, 'taunt'], [1.5, 'determined']],
  windup:        [[0.0, 'determined'], [0.44, 'squint'], [0.84, 'yell']],
  pitch_recover: [[0.3, 'determined']],
  pitch_set:     [[0.0, 'squint']],
  run:           [[0.0, 'determined']],
  run_stop:      [[0.12, 'shock'], [0.6, 'squint']],
  trot:          [[0.0, 'smug'], [0.9, 'grin']],
  slide:         [[0.0, 'yell'], [0.34, 'determined'], [1.2, 'grin']],
  dive:          [[0.12, 'determined'], [0.26, 'yell'], [0.98, 'shock'], [1.3, 'grin']],
  jump_catch:    [[0.12, 'determined'], [0.28, 'yell'], [0.74, 'shock'], [1.0, 'grin']],
  fumble:        [[0.14, 'shock'], [0.8, 'yell'], [1.02, 'grin']],
  throw:         [[0.18, 'determined'], [0.48, 'yell'], [0.8, 'squint']],
  taunt:         [[0.0, 'taunt'], [1.2, 'smug']],
  sulk:          [[0.0, 'disappointed']],
  freeze:        [[0.07, 'shock'], [1.5, 'squint']],
  curb_wait:     [[0.0, 'squint']],
  argue_jab:     [[0.0, 'yell'], [0.78, 'determined'], [1.06, 'yell']],
  argue_appeal:  [[0.0, 'shock'], [0.26, 'yell'], [0.76, 'disappointed'], [1.06, 'yell']],
  crouch:        [[0.0, 'squint']],
  ready:         [[0.0, 'determined']],
  sit_flip:      [[0.0, 'neutral'], [1.0, 'smug']],
  idle_bounce:   [[0.0, 'grin']],
  idle_slouch:   [[0.0, 'neutral'], [2.5, 'squint']],
};
for (const key in FACE_TRACKS) {
  const cl = CLIPS[key];
  if (!cl) continue;
  for (const [t, ex] of FACE_TRACKS[key]) cl.events.push({ t, name: 'face:' + ex });
  cl.events.sort((a, b) => a.t - b.t);
}

/** Everything that counts as a celebration, for the reel and for the mob at the plate. */
export const CELEBRATIONS = ['cheer_arms', 'cheer_jump', 'cheer_wave', 'mob_pile'];

export const FIDGETS = [
  'fidget_cap', 'fidget_pebble', 'fidget_chatter', 'fidget_pants',
  'fidget_spit', 'fidget_stocking', 'fidget_stretch', 'fidget_look', 'fidget_pigeon',
];
export const IDLES = ['idle', 'idle_slouch', 'idle_bounce'];
export default CLIPS;

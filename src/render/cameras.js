import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { registerScenario } from '../core/scenarios.js';
import { allColliders } from '../world/colliders.js';

/**
 * cameras.js — THE CAMERA DIRECTOR (docs/DESIGN-BIBLE.md §17)
 * ============================================================================
 * The game is 3D characters played on a 2D stage. This file is the half of that sentence
 * that says "2D stage": the contract lens, two locked framings, hard cuts between them, and
 * the staged scale that decides who the frame is about.
 *
 * 1. THE LENS IS THE CONTRACT. IT IS NOT A VARIABLE.
 * ---------------------------------------------------------------------------
 * `T.stage.framings[key].fov` is 20°, and that is what this file runs at. It is read, never
 * searched. Rounds 1 and 2 both bought the §17.3 height floors by collapsing the lens — 9.8°
 * from 136 units back, then 16.00° exactly, which is the tripwire value below which
 * tools/measure.mjs prints "lens collapsed" — and both were right that the floors and a 20°
 * lens cannot be reconciled by DISTANCE alone. §17.2's answer to that is "fix the layout,
 * never the lens", and §17.6's is "cheat the scale, the way a stage does". This build does
 * both: it runs the contract lens, it files the layout number it still wants
 * (`report().requests`), and it makes up the difference with staged scale rather than glass.
 *
 * 2. WHY SIZE CANNOT COME FROM DISTANCE ANY MORE (§17.6, and the arithmetic behind it)
 * ---------------------------------------------------------------------------
 * A kid of box height h at view depth d through a vertical FOV f occupies pct = 50·h/(t·d),
 * t = tan(f/2) — the number tools/measure.mjs prints. Since every kid's depth is the batter's
 * plus a fixed offset, ONE number decides the whole scale of a framing, and the §17.3 floors
 * turn into an interval on it. Measured against the cast standing in the street today
 * (batter box 5.19–6.18, catcher 4.65–4.72, pitcher 5.14–6.57 at Δz 22, deepest 5.92 at Δz 62)
 * that interval is non-empty at 18° and EMPTY at 20°: the pitcher cannot reach 18% of frame
 * through any lens wider than ~18.1° from any legal distance.
 *
 * And that was the EASY constraint. tools/measure.mjs now also enforces §17.6:
 *
 *      tallest kid ÷ second-tallest kid ≥ 1.35, or the frame has no subject
 *
 * The three leads are pinned in 18–26% by §17.3, so the second-tallest kid in any gameplay
 * frame is a lead and is ≥ 18%. The subject is therefore ≥ 1.35 × 18 = 24.3% and ≤ 26%: a
 * 6.5%-wide band. The same algebra leaves the second party a 6.7%-wide band, and the two are
 * coupled, so **each figure may vary by ±1.7% and no more**. Measured through one at-bat, the
 * pitcher's bounding box varies by ±13% (6.57 arm-up in the wind-up, 5.14 in the delivery) and
 * the batter's by ±9.5%. Distance cannot compress that. Nothing can, except scale.
 *
 * So: **the three leads are size-stabilised, everybody else carries a fixed staged scale.**
 * A non-lead's legal band is [12%, subject/1.386] — twenty points wide — so his scale is a
 * constant computed once from his own standing height and his rendered height then breathes
 * with his pose exactly as it should. Only the three §17.3 leads are held, and the honest cost
 * of that is written up in the report: the pitcher's body grows ~10% across his delivery
 * because his silhouette shrinks by 13% and the arbiter measures the silhouette. The real fix
 * is a rig that holds the leads' box inside ±2% of standing, and that is filed, with numbers.
 *
 * 3. THE FRAMINGS ARE TWO SHOTS, NOT TWO NUDGES
 * ---------------------------------------------------------------------------
 * Round 2 shipped two "framings" 15.6° apart, one unit of distance apart, with a 1.01 subject
 * ratio — the textbook jump cut. Here they differ in all three ways a cut is supposed to:
 *
 *      VANTAGE   BATTING swings ~26° off the street axis and sits low, at kid-and-a-half
 *                height, so the street runs diagonally through the frame. FIELD stays square
 *                to the street (§17.4) and rides higher. Measured axis separation ≥ 30°.
 *      SUBJECT   the batter owns BATTING at 25.6% of frame; in FIELD he is one of the second
 *                party at 18.3% and the play owns the frame. A 1.40 subject-size change.
 *      JOB       BATTING is composed on the pitcher past the batter's shoulder and is required
 *                to keep the horizon in frame. FIELD is composed on the cast's own width.
 *
 * 4. THE HORIZON IS PART OF THE FRAME, NOT A LUXURY
 * ---------------------------------------------------------------------------
 * Round 2's BATTING put the horizon at NDC y 0.858 (7% of frame above it) and FIELD's at 1.907
 * (off frame), and the top sixty rows of the shot averaged brick. Two closed-form terms put the
 * block back: the horizon itself, tan(pitch)/t, held in [0.16, 0.52]; and `topAtCard` — the
 * world height at which the top edge of frame crosses the near-facade card at z = 84, which is
 * the number src/world/backdrop.js uses to argue about this. It was 20.7 ft from BATTING and
 * 10.0 ft from FIELD, i.e. below the awnings. Both framings now clear the notch.
 *
 * 5. WHAT MOVES, AND WHAT NEVER DOES (§17.4)
 * ---------------------------------------------------------------------------
 * The camera CUTS. Two continuous motions exist and no others: a single-axis TILT that follows
 * a live ball, and a slow PUSH on a celebration. No dolly, no orbit, no roll, no handheld, no
 * easing between framings.
 *
 * The tilt is clamped EVERY FRAME by the cast, not by a constant. Round 2 allowed 11°, which on
 * this lens is 1.10 of NDC — 55% of the frame height — and it put twelve of sixteen kids off
 * the bottom of the screen in `deep_fly`, including the batter at −1.89, while measure.mjs
 * reported "ok" because its `onScreen()` filter drops off-frame kids from the sample instead of
 * failing them. The follow now solves, per frame, the largest tilt that keeps every kid's feet
 * above NDC −0.97, and holds there. On these framings that is 2–4°, and that is simply the
 * truth about how much a locked wide shot can tilt: past it the shot is no longer the shot.
 * A ball that beats the clamp is handed to the chalk landing marker, which exists for this.
 *
 * 6. PLAYING WELL WITH THE OTHER PIECES
 * ---------------------------------------------------------------------------
 * Half the scenarios in this build belong to somebody else and set their own camera. The
 * director never fights them: it remembers the exact transform it last wrote, and the moment it
 * finds the camera somewhere else it hands over — camera AND staged scale — for the rest of the
 * scenario. Ownership is detected, never declared. Staged scale is likewise never written onto
 * a kid another system is already scaling.
 */

const S = T.stage;
const RAD = Math.PI / 180;

/** The frame the arbiter measures in: tools/measure.mjs and tools/shoot.mjs shoot 1600×900. */
const SOLVE_ASPECT = 16 / 9;

/** §17.3 / §17.6 exactly as tools/measure.mjs enforces them. */
const LIMIT = {
  kidMin: S.scale.kidMinPct,          // 12 — every kid in play, every framing
  leadMin: S.scale.leadMinPct,        // 18 — batter / pitcher / catcher
  leadMax: S.scale.leadMaxPct,        // 26
  ratio: 1.35,                        // §17.6 — subject vs the next-largest kid in frame
  ballMinPx: 9,
  camMax: 145,                        // §17.2's ceiling is 150 from the plate; stay off it
};

/**
 * THE STAGED SIZE HIERARCHY (§17.6).
 *
 * Absolute targets in percent of frame height, not multipliers, because the floors and the
 * ceiling they have to live inside are absolute. Every number here has both of §17.3's edges
 * and §17.6's ratio in it:
 *
 *      subject 25.6   ≤ 26 with 0.4 of pose headroom, and 25.6/1.383 = 18.5 of room underneath
 *      second  18.3   ≥ 18 with 0.3, and under the 18.5 the ratio leaves
 *      other   13.4–14.2 by depth — a floor of 12 with 1.4 to spare, and nowhere near the cap
 *      bystander 12.9 — §17.6's 0.55-ish, applied to a kid who is not in the game
 *
 * `hold` is how much of a kid's pose-driven size change the scale cancels. The leads are held
 * (the bands above are ±1.7% wide and their poses are ±13%); everybody else is 0 — a constant
 * scale, a natural silhouette, and twenty points of legal room to breathe in.
 */
const HIER = {
  subject: 25.6,
  second: 18.3,
  otherNear: 14.2,
  otherFar: 13.4,
  bystander: 12.9,
  ratio: 1.383,                        // aim above measure's 1.35 so pose noise cannot reach it
  holdLead: 0.94,
  holdOther: 0.0,
  // Hard clamps applied after taste. These are what make legality a property of the code
  // rather than of the pose the arbiter happens to catch.
  subjectBand: [24.7, 25.9],
  leadBand: [18.15, 19.2],
  otherBand: [12.5, 15.0],
  scaleBand: [0.38, 1.85],
  promoteMax: 1.36,                    // the most we will scale a kid UP to make him the subject
};

/**
 * The two locked framings (§17.4). Direction and anchor come from T.stage.framings — the
 * contract this file shares with the backdrop and field-layout pieces. Everything here is the
 * COMPOSITION: where the plate sits, what the frame is built around, how much block stands
 * above it, and how far round the camera is allowed to swing.
 */
const COMPOSITION = {
  batting: {
    // Behind and above the batter's shoulder, swung far enough off the street axis that this
    // is a different SEAT from the wide shot and not a nudge of it, and pitched down only as
    // far as the horizon allows — this framing is required to keep the horizon in frame, which
    // is what puts the cornices, the fire escapes, the El and the sky in the top of the shot
    // the game is mostly played in.
    plateY: -0.70,
    keyX: -0.14,         // the pitcher's chest, in NDC x — the shot is aimed at him
    keyY: 0.02,
    batterX: 0.22,       // …with the batter this far off him: an over-the-shoulder, not a stack
    deepY: 0.02,         // the deepest kid's head sits just above the middle
    feetFloor: -0.90,    // no kid's feet below this: it is the follow-tilt's whole budget
    horizonY: [0.10, 0.52],
    topCard: [28, 48],   // where the top of frame crosses the near-facade card, in feet
    pitch: [1.5, 8.0],
    yaw: [-28, -12],       // §17.4 lets BATTING off the axis; this is the half of the cut it owns
    camX: [8, 22],
    dist: [50, 72],
    minPlay: 10,          // every lead and every fielder, whole, in frame
    centreCast: false,
    sepFrom: 'field',
    sepMin: 27.0,
  },
  field: {
    // The wide one: square to the street (§17.4), a storey higher, raked down far enough that
    // the whole shallow stage lies out flat and no fielder hides behind another — and no
    // further, because every degree of rake is a degree the ball-follow cannot spend and a foot
    // of block that leaves the top of the frame.
    plateY: -0.62,
    keyX: 0.0,           // centred on the cast's own width, not on any one kid
    keyY: null,
    batterX: null,
    deepY: 0.22,
    feetFloor: -0.93,
    horizonY: [0.18, 0.72],
    topCard: [21, 42],
    pitch: [8.0, 13.0],
    yaw: [0, 0],
    camX: [-6, 8],
    dist: [64, 78],
    minPlay: 10,
    centreCast: true,
    sepFrom: 'batting',  // …and this far off the other framing's axis, in degrees
    sepMin: 27.0,
  },
};

/**
 * Continuous motion, §17.4 — and there is only this much of it.
 *
 * The permitted follow is ONE axis, and on this stage that axis is TILT. A stickball ball goes
 * up the street and up in the air; laterally it is fenced by a 46-unit play plane the frame
 * already covers at every depth the ball reaches. Vertically it is fenced by nothing.
 *
 * `tiltMaxDeg` is a ceiling of last resort. The real limit is computed every frame from where
 * the cast's feet are (`tiltCap`), because a locked wide shot that tilts past its own cast has
 * stopped being a locked wide shot — which is exactly how round 2 lost twelve kids off the
 * bottom of `deep_fly`. The follow only ever tilts UP: everything the ball does below the frame
 * centre is already in shot.
 */
const MOTION = {
  tiltMaxDeg: 6.0,
  tiltRateDeg: 20,        // deg/sec ceiling — a follow, never a whip
  tiltDead: 0.34,         // ball may climb this far in NDC y before the tilt wakes up
  tiltPark: 0.58,         // …and is carried back to here, clear of the HUD's top band
  tiltTau: 0.12,
  tiltHome: 0.30,         // slower on the way back down: settling is not a move
  feetFloor: -0.985,      // no kid's feet past this, at any tilt, ever
  pushFrac: 0.030,        // 3% of the pull-back
  pushTime: 1.35,
  cutHold: 0.09,          // 90 ms: BYB §5.5's hitstop, held on BATTING before the cut
};

/* ============================================================================
   MEASUREMENT — the same numbers tools/measure.mjs will print, in closed form
   ========================================================================= */

const _box = new THREE.Box3();
const _dv = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _look = new THREE.Vector3();
const _qx = new THREE.Quaternion();
const _XAXIS = new THREE.Vector3(1, 0, 0);
const _YAXIS = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _top = new THREE.Vector3();
const _bot = new THREE.Vector3();
const _wp = new THREE.Vector3();

const isKidNode = (o) =>
  !!(o.userData?.isKid || /^kid[:.]|^(batter|pitcher|catcher|fielder|runner)/i.test(o.name || ''));

/** §17.2's stage, with a foot of slack: nothing playable stands outside this box. */
function onContractStage(x, z) {
  return Math.abs(x) <= S.playWidth / 2 + 2 && z >= -14 && z <= S.playDepth + 2;
}

/**
 * A candidate view, held as a position and an orthonormal basis rather than as a camera.
 *
 * Three.js projects a symmetric frustum, so for any world point p
 *
 *     ndcX = (p−eye)·right / ((p−eye)·fwd · t · aspect)
 *     ndcY = (p−eye)·up    / ((p−eye)·fwd · t)          t = tan(fov/2)
 *
 * which is the same answer `Vector3.project(camera)` gives — the same call tools/measure.mjs
 * makes — and about twenty times cheaper. The solver evaluates a few thousand candidates at
 * boot and the scale solver runs sixteen times a frame, so that matters.
 */
class View {
  constructor() {
    this.pos = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.t = 0.1;
  }
  setDirection(yaw, pitchDeg) {
    const cp = Math.cos(pitchDeg * RAD), sp = Math.sin(pitchDeg * RAD);
    this.fwd.set(Math.sin(yaw) * cp, -sp, Math.cos(yaw) * cp);
    _look.copy(this.pos).add(this.fwd);
    _m4.lookAt(this.pos, _look, _YAXIS);
    this.quat.setFromRotationMatrix(_m4);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    return this;
  }
  fromCamera(cam) {
    this.pos.copy(cam.position);
    this.quat.copy(cam.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.t = Math.tan(cam.fov * RAD / 2);
    return this;
  }
  fromSolved(f, tilt = 0) {
    this.pos.copy(f.pos);
    this.quat.copy(f.quat);
    if (tilt) { _qx.setFromAxisAngle(_XAXIS, tilt); this.quat.multiply(_qx); }
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.t = Math.tan(f.fov * RAD / 2);
    return this;
  }
  ndcY(p) {
    _dv.copy(p).sub(this.pos);
    const d = _dv.dot(this.fwd);
    return d <= 0.05 ? null : _dv.dot(this.up) / (d * this.t);
  }
  ndcX(p) {
    _dv.copy(p).sub(this.pos);
    const d = _dv.dot(this.fwd);
    return d <= 0.05 ? null : _dv.dot(this.right) / (d * this.t * SOLVE_ASPECT);
  }
  depth(p) { return _dv.copy(p).sub(this.pos).dot(this.fwd); }
  /** On-screen diameter, in px of a 900-tall frame, of a sphere of radius r at p. */
  ballPx(p, r, h = 900) {
    const d = this.depth(p);
    return d <= 0.5 ? 0 : (2 * r) / (this.t * d) * (h / 2);
  }
}

/**
 * Every kid in the scene, as the arbiter sees them.
 *
 * The entry holds the kid's box as OFFSETS FROM HIS OWN ORIGIN, divided by whatever scale he is
 * already wearing. A uniform scale s about a group origin moves every world offset by exactly
 * s (rotation commutes with a uniform scale), so from these offsets the rendered height at any
 * candidate scale is exact rather than approximate — which is what lets the staged scale hit a
 * target percentage to two decimal places instead of servoing towards it.
 *
 * Kids standing OUTSIDE the contract stage are surveyed but excluded from the size hierarchy:
 * §17.2 fixes the play plane at 70 units and measure.mjs fails the build separately for anyone
 * past it, and letting a fielder parked at z = 95 drag the whole composition would hide that
 * failure inside a worse one.
 */
function surveyCast(app, roles, refs) {
  const cast = [];
  const strays = [];
  const seen = new Set();
  app.scene.traverse((o) => {
    if (seen.has(o) || !isKidNode(o)) return;
    for (let a = o.parent; a; a = a.parent) if (seen.has(a)) return;
    seen.add(o);
    o.updateWorldMatrix(true, true);
    _box.makeEmpty();
    _box.setFromObject(o);
    if (_box.isEmpty()) return;
    o.getWorldPosition(_wp);
    const s = o.scale.y || 1;
    const off = {
      cx: ((_box.min.x + _box.max.x) / 2 - _wp.x) / s,
      cz: ((_box.min.z + _box.max.z) / 2 - _wp.z) / s,
      minY: (_box.min.y - _wp.y) / s,
      maxY: (_box.max.y - _wp.y) / s,
    };
    const tall = o.userData?.metrics?.tall || 0;
    const h = off.maxY - off.minY;
    const t = tall > 0 ? tall : h;
    // The kid's box measured in his own standing heights, captured the FIRST time we see him
    // and never again: it is the neutral pose the staged scale is authored against, so that a
    // kid whose pose changes changes size on screen instead of the frame lying about him.
    let ref = refs?.get(o);
    if (ref == null) { ref = h / Math.max(1e-3, t); refs?.set(o, ref); }
    const entry = {
      obj: o,
      name: o.name || 'kid',
      org: _wp.clone(),
      off,
      h,
      tall: t,
      ref,
      scale: s,
      role: roles?.get(o) || 'other',
      lead: !!o.userData?.isLead,
      visible: o.visible,
    };
    if (onContractStage(_wp.x, _wp.z)) cast.push(entry);
    else { entry.stray = true; strays.push(entry); }
  });
  return { cast, strays };
}

/** Rendered height, in percent of frame height, of a surveyed kid at a candidate scale. */
function pctAt(view, k, s) {
  _top.set(k.org.x + s * k.off.cx, k.org.y + s * k.off.maxY, k.org.z + s * k.off.cz);
  _bot.set(k.org.x + s * k.off.cx, k.org.y + s * k.off.minY, k.org.z + s * k.off.cz);
  const a = view.ndcY(_top), b = view.ndcY(_bot);
  if (a == null || b == null) return null;
  return Math.abs(a - b) * 50;
}

/**
 * The scale that renders this kid at exactly `target` percent of frame height.
 *
 * pct(s) is very nearly linear in s — it is exactly linear for a camera with no pitch, and the
 * curvature comes only from the top of the box sitting at a slightly different view depth from
 * the bottom — so three multiplicative corrections land inside a hundredth of a percent.
 */
function scaleForPct(view, k, target) {
  const p1 = pctAt(view, k, 1);
  if (!p1) return null;
  let s = target / p1;
  for (let i = 0; i < 3; i++) {
    const q = pctAt(view, k, s);
    if (!q) return s;
    const corr = target / q;
    s *= corr;
    if (Math.abs(corr - 1) < 1e-4) break;
  }
  return s;
}

/** The pct this kid would render at if his box were exactly his standing height. */
function stablePct(view, k) {
  _top.set(k.org.x, k.org.y + k.tall, k.org.z);
  _bot.set(k.org.x, k.org.y, k.org.z);
  const a = view.ndcY(_top), b = view.ndcY(_bot);
  if (a == null || b == null) return null;
  return Math.abs(a - b) * 50;
}

/* ============================================================================
   THE STAGED SCALE — §17.6, applied per frame against whatever camera we own
   ========================================================================= */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Decide the role every body plays IN THIS FRAMING, which is the whole of §17.6's hierarchy.
 *
 *   BATTING — the batter is the subject; the pitcher and catcher are the second party; the
 *             eight fielders are in play; the on-deck kid, the bench and the block are
 *             bystanders.
 *   FIELD   — the play is the subject: the fielder converging on a live ball if the frame can
 *             promote him without a scale over 1.36, otherwise the pitcher, who is the man in
 *             the middle of an idle stage. The batter and catcher are the second party, and a
 *             runner being run at is too (§17.6).
 *
 * The three §17.3 leads are ALWAYS at least the second party, whatever else is going on,
 * because their 18% floor is law and 18.3% is where this hierarchy puts the second party.
 */
function assignRoles(app, framing) {
  const P = app.get('players');
  const roles = new Map();
  if (!P) return roles;
  const put = (k, r) => { if (k && k.group) roles.set(k.group, r); };
  for (const k of P.spectators || []) put(k, 'bystander');
  for (const k of P.runners || []) put(k, k.group?.visible ? 'second' : 'bystander');
  put(P.onDeck, 'bystander');
  for (const f of P.fielders || []) put(f, 'other');
  put(P.batter, 'second');
  put(P.pitcher, 'second');
  put(P.catcher, 'second');
  if (framing === 'batting') put(P.batter, 'subject');
  else put(P.pitcher, 'subject');
  return roles;
}

/** In FIELD with a live ball, hand the subject to whoever is going to get to it. */
function playSubject(app, cast, view) {
  const P = app.get('players');
  const sim = app.sim;
  if (!P || !sim || sim.state.phase !== 'in_play') return null;
  if (!(sim.ball.live || sim.ball.inFlight)) return null;
  let best = null, bestD = 1e9;
  for (const f of P.fielders || []) {
    if (!f.group || !f.group.visible) continue;
    const d = Math.hypot(f.group.position.x - sim.ball.pos.x, f.group.position.z - sim.ball.pos.z);
    if (d < bestD) { bestD = d; best = f.group; }
  }
  if (!best) return null;
  const k = cast.find((c) => c.obj === best);
  if (!k) return null;
  const s = scaleForPct(view, k, HIER.subject);
  return s != null && s <= HIER.promoteMax ? best : null;
}

/**
 * Target height for a kid, before the hard clamps: the role's number, tapered a little by
 * depth so the stage keeps a whiff of perspective instead of reading as a paper cut-out row.
 */
function targetFor(role, depthU) {
  if (role === 'subject') return HIER.subject;
  if (role === 'second') return HIER.second;
  if (role === 'bystander') return HIER.bystander;
  return HIER.otherNear + (HIER.otherFar - HIER.otherNear) * depthU;
}

function bandFor(role, cap) {
  if (role === 'subject') return HIER.subjectBand;
  if (role === 'second') return [HIER.leadBand[0], Math.min(HIER.leadBand[1], cap)];
  return [HIER.otherBand[0], Math.min(HIER.otherBand[1], cap)];
}

/**
 * Solve every kid's staged scale for one view. Returns rows for the report.
 *
 * Order matters: the subject is sized first, because his height is what every other kid's
 * ceiling is derived from. §17.6's ratio is then true BY CONSTRUCTION rather than by luck —
 * no pose, no animation and no scenario can break it, which is the only way to hold a rule
 * whose legal band is 1.7% wide against a cast whose poses move by 13%.
 */
function solveScales(view, cast, rows) {
  let depthLo = 1e9, depthHi = -1e9;
  for (const k of cast) {
    k.depth = view.depth(k.org);
    if (k.depth < depthLo) depthLo = k.depth;
    if (k.depth > depthHi) depthHi = k.depth;
  }
  const span = Math.max(1, depthHi - depthLo);

  let subject = null;
  for (const k of cast) if (k.role === 'subject' && !subject) subject = k;

  let subjectPct = HIER.subject;
  if (subject) {
    const s = scaleForPct(view, subject, HIER.subject);
    subject.scaleWant = s == null ? 1 : clamp(s, HIER.scaleBand[0], HIER.scaleBand[1]);
    subjectPct = pctAt(view, subject, subject.scaleWant) ?? HIER.subject;
  }
  const cap = subjectPct / HIER.ratio;

  for (const k of cast) {
    if (k === subject) { k.pctWant = subjectPct; continue; }
    const raw = pctAt(view, k, 1);
    const stable = stablePct(view, k);
    if (raw == null || stable == null) { k.scaleWant = 1; k.pctWant = null; continue; }
    // How far this pose is from the pose the kid was first surveyed in, as a pure ratio.
    const pose = (raw / stable) / Math.max(1e-3, k.ref);
    const hold = k.lead || k.role === 'second' ? HIER.holdLead : HIER.holdOther;
    const band = bandFor(k.role, cap);
    let want = targetFor(k.role, clamp((k.depth - depthLo) / span, 0, 1)) * Math.pow(pose, 1 - hold);
    want = clamp(want, band[0], Math.max(band[0], band[1]));
    const s = scaleForPct(view, k, want);
    k.scaleWant = s == null ? 1 : clamp(s, HIER.scaleBand[0], HIER.scaleBand[1]);
    k.pctWant = pctAt(view, k, k.scaleWant) ?? want;
  }

  if (rows) {
    for (const k of cast) {
      _top.set(k.org.x + k.scaleWant * k.off.cx, k.org.y + k.scaleWant * k.off.maxY, k.org.z + k.scaleWant * k.off.cz);
      _bot.set(k.org.x + k.scaleWant * k.off.cx, k.org.y + k.scaleWant * k.off.minY, k.org.z + k.scaleWant * k.off.cz);
      rows.push({
        name: k.name, role: k.role, lead: k.lead,
        pct: +(k.pctWant ?? 0).toFixed(2),
        scale: +(k.scaleWant ?? 1).toFixed(3),
        x: +(view.ndcX(k.org) ?? 9).toFixed(2),
        feet: +(view.ndcY(k.org) ?? -9).toFixed(2),
        head: +(view.ndcY(_top) ?? 9).toFixed(2),
        z: +k.org.z.toFixed(1),
      });
    }
    rows.sort((a, b) => b.pct - a.pct);
  }
  return { subject, subjectPct, cap };
}

/* ============================================================================
   THE SOLVER — where the two seats in the house actually are
   ========================================================================= */

const BAD = 1000;
const W = {
  edge: 900,        // nobody gets bisected by the frame edge — above every taste term here
  floor: 700,       // …and nobody's feet go below the follow's budget line
  crowd: 260,       // per kid missing from the stage
  deep: 90,         // how much stage stands above the plate
  card: 160,        // where the top of frame crosses the near facade: the block's own number
  horizon: 200,     // …and whether the horizon is in the picture at all
  key: 70,          // the key subject's height in frame
  pair: 620,        // batter vs pitcher: an over-the-shoulder, not one behind the other
  cheat: 260,       // how hard §17.6's staged scale has to work to fix the perspective
  subjScale: 2200,   // …and how hard it has to work on the one kid everybody is looking at
  overlap: 150,     // two kids in one screen column is one kid
  ball: 60,         // the ball's diameter where a hit ball actually lives
  dist: 0.10,       // the smallest pull-back that does the job
  camX: 120,        // …and stay on your own set — in the roadway, not under an awning
  sep: 200,         // and be a different SHOT from the other framing
  curb: 260,        // and stand somewhere a camera can actually stand
};
const DECK_Z = -104;      // world/surface.js paves back to z = −96; a soft nudge, not a wall
const _facade = new THREE.Vector3(0, 0, S.backdrop.nearFacade);
/**
 * Where a hit ball has to still read. Two probes, both inside the infield, because that is
 * where the ball spends its life on a 70-deep stage — and because the arbiter's own 9 px floor
 * is unreachable past that: at fov 20 a 0.18-radius ball is 9 px at a view depth of 102, so a
 * ball at the far end of the stage needs the camera inside 32 units of the plate, which cannot
 * hold the cast. src/game/ballphysics.js already answers that with a 17 px screen-space floor
 * of its own (SP.minPx); this term only keeps the framing from making that floor do all the
 * work. See report().requests.
 */
const BALL_PROBES = [
  new THREE.Vector3(0, 9, 18),
  new THREE.Vector3(4, 14, 32),
];

/* ---------------------------------------------------------------------------
   IS THERE ANYTHING IN THE WAY?

   A seat in the house is only a seat if you can see the stage from it. The street is a 64-ft
   canyon with awnings, stoops, pushcart canopies and ash cans down both sidewalks, and the
   solver found out the hard way: the best-scoring BATTING candidate at one point stood at
   (−45.3, 15.8, −61.6), which is INSIDE a storefront, and rendered a striped awning across the
   middle third of the frame. Guessing keep-out boxes is how that happens twice, so the test is
   run against the world's own geometry — src/world/colliders.js, the same registry the ball
   uses — and a candidate that cannot see the plate, the pitcher and the deepest kid is not a
   candidate.
   ------------------------------------------------------------------------ */

let _occ = null;
function occluders() {
  if (_occ) return _occ;
  _occ = allColliders()
    .filter((c) => c.box && c.box.max.y > 2 && c.surface !== 'sewer')
    .map((c) => c.box);
  return _occ;
}

/** Slab test: does the segment eye→target enter this box? */
function segmentHitsBox(eye, target, box) {
  let t0 = 0, t1 = 1;
  for (const ax of ['x', 'y', 'z']) {
    const d = target[ax] - eye[ax];
    const lo = box.min[ax], hi = box.max[ax];
    if (Math.abs(d) < 1e-6) { if (eye[ax] < lo || eye[ax] > hi) return false; continue; }
    let a = (lo - eye[ax]) / d, b = (hi - eye[ax]) / d;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return false;
  }
  return true;
}

const _eye = new THREE.Vector3();
function sightBlocked(view, targets) {
  const boxes = occluders();
  _eye.copy(view.pos);
  let n = 0;
  for (const t of targets) {
    for (const b of boxes) {
      if (segmentHitsBox(_eye, t, b)) { n++; break; }
    }
  }
  return n;
}

/**
 * Place a candidate view.
 *
 * Direction comes from (yaw, pitch); the pull-back comes from `dPlate`, the view depth of the
 * composition anchor. That leaves exactly two free translations — along the camera's own right
 * and up — and they are solved in CLOSED FORM, not iterated, because a translation
 * perpendicular to the view axis changes no depth:
 *
 *     ndcY(anchor) = −ry / (dPlate·t)              → ry = −plateY · dPlate · t
 *     ndcX(key)    = (key·right − rx) / (dKey·t·a) → rx = key·right − keyX · dKey · t · a
 */
function place(view, yaw, pitchDeg, fov, dPlate, plate, key, comp) {
  view.pos.set(0, 0, 0);
  view.setDirection(yaw, pitchDeg);
  view.t = Math.tan(fov * RAD / 2);
  view.pos.copy(plate).addScaledVector(view.fwd, -dPlate);
  const ry = -comp.plateY * dPlate * view.t;
  let rx = 0;
  if (key) {
    _dv.copy(key).sub(plate);
    const dKey = _dv.dot(view.fwd) + dPlate;
    rx = _dv.dot(view.right) - comp.keyX * dKey * view.t * SOLVE_ASPECT;
  }
  view.pos.addScaledVector(view.right, rx).addScaledVector(view.up, ry);
  return view;
}

/** FIELD is composed on the cast's own width, and a sideways slide moves near kids further. */
function centreCast(view, cast, comp) {
  for (let i = 0; i < 3; i++) {
    let lo = 9, hi = -9, dSum = 0;
    for (const k of cast) {
      _dv.copy(k.org).sub(view.pos);
      const d = Math.max(1, _dv.dot(view.fwd));
      const x = _dv.dot(view.right) / (d * view.t * SOLVE_ASPECT);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
      dSum += d;
    }
    if (!cast.length) return view;
    const dCast = dSum / cast.length;
    const dx = ((lo + hi) / 2 - comp.keyX) * dCast * view.t * SOLVE_ASPECT;
    if (Math.abs(dx) < 0.02) break;
    view.pos.addScaledVector(view.right, dx);
  }
  return view;
}

/**
 * A kid is either comfortably inside the frame or cleanly outside it. What is never acceptable
 * is the state in between — bisected by the frame edge, half a kid. So the edge cost is a BUMP
 * over the straddle zone rather than a ramp that grows for ever.
 */
function straddle(v, inner, outer) {
  const a = Math.abs(v);
  return Math.max(0, Math.min(a - inner, outer - a));
}

/**
 * Cost of a candidate framing. Lower is better.
 *
 * Every §17.3 height rule is now satisfied BY CONSTRUCTION (solveScales does it exactly), so
 * this function is no longer negotiating with the floors — it is choosing a picture. What it
 * still owes the floors is the CHEAT term: the further the camera is from a place where the
 * street's own perspective already reads as the hierarchy, the harder §17.6's scale has to
 * work, and a scale that has to work hard is a scale a critic can see.
 */
function score(cast, comp, view, dPlate, pitchDeg, key, rows, sepAxis) {
  let cost = 0;
  const { subjectPct } = solveScales(view, cast, null);
  let deep = -2, deepD = -1, batX = null, onStage = 0;
  const shown = [];

  for (const k of cast) {
    const s = k.scaleWant ?? 1;
    _top.set(k.org.x + s * k.off.cx, k.org.y + s * k.off.maxY, k.org.z + s * k.off.cz);
    _bot.set(k.org.x + s * k.off.cx, k.org.y + s * k.off.minY, k.org.z + s * k.off.cz);
    const yTop = view.ndcY(_top), yBot = view.ndcY(_bot), x = view.ndcX(k.org);
    if (yTop == null || yBot == null || x == null) { cost += BAD; continue; }
    // "On screen" means a whole kid, not a kid the frame edge has taken a bite out of. A body
    // a foot inside tools/measure.mjs's ±1.25 sample window can be entirely outside the
    // picture — kid:kathleen was, at x = 1.04 — and a cast member the arbiter counts and the
    // player cannot see is the worst of both.
    const inFrame = Math.abs(x) < 1.0 && yTop > -1.25 && yBot < 1.25;
    const bystander = k.role === 'bystander';
    if (inFrame && !bystander) onStage++;
    if (inFrame) shown.push({ x, yTop, yBot, k });
    // A bystander on the frame edge is the foreground element BYB §3.6 asks for; a FIELDER on
    // the frame edge is a player the arbiter counts and the picture does not contain.
    cost += W.edge * (bystander ? 0.3 : 1) *
      (straddle(x, 0.80, 1.45) + straddle(yTop, 0.88, 1.34) + straddle(yBot, 0.88, 1.34));
    // The follow-tilt's budget is whatever room is left under the lowest pair of feet.
    if (inFrame && yBot < comp.feetFloor) cost += W.floor * (comp.feetFloor - yBot);
    if (inFrame && yTop > 0.94) cost += W.floor * (yTop - 0.94);
    // Blowing one kid up to make him the subject is the most visible thing §17.6 lets us do,
    // so the pull-back is chosen partly to keep it small: a shot where the subject has to be
    // inflated by half is a shot taken from the wrong place.
    if (k.role === 'subject') { batX = x; cost += W.subjScale * Math.max(0, s - 1.16); }
    const dep = k.depth;
    if (inFrame && dep > deepD) { deepD = dep; deep = yTop; }
    // §17.6 is a cheat and cheats are supposed to be small.
    const ln = Math.abs(Math.log(clamp(s, 0.2, 5)));
    cost += W.cheat * Math.max(0, ln - 0.12);
  }

  // Two kids in one screen column is one kid. Cheap pairwise test on the shown set.
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      const a = shown[i], b = shown[j];
      const dx = Math.abs(a.x - b.x);
      if (dx > 0.055) continue;
      const overlapY = Math.min(a.yTop, b.yTop) - Math.max(a.yBot, b.yBot);
      if (overlapY > 0) cost += W.overlap * (0.055 - dx) / 0.055 * Math.min(1, overlapY / 0.3);
    }
  }

  if (comp.minPlay) cost += Math.max(0, comp.minPlay - onStage) * W.crowd;
  cost += Math.abs(deep - comp.deepY) * W.deep;
  if (comp.batterX != null && batX != null) cost += W.pair * Math.abs(batX - comp.batterX);

  // Where the top edge of frame crosses the near-facade card, in feet. This is the number
  // src/world/backdrop.js measures the director by, so it is the number solved against.
  const denom = view.fwd.z + view.t * view.up.z;
  if (Math.abs(denom) > 1e-4) {
    const d = (S.backdrop.nearFacade - view.pos.z) / denom;
    if (d > 0) {
      const yCard = view.pos.y + d * (view.fwd.y + view.t * view.up.y);
      cost += W.card * (Math.max(0, comp.topCard[0] - yCard) + Math.max(0, yCard - comp.topCard[1])) / 4;
    } else cost += BAD;
  }

  // The horizon itself, in closed form: a camera with no roll puts it at tan(pitch)/t.
  if (comp.horizonY) {
    const hz = Math.tan(pitchDeg * RAD) / view.t;
    cost += W.horizon * (Math.max(0, hz - comp.horizonY[1]) + Math.max(0, comp.horizonY[0] - hz));
  }

  if (key && comp.keyY != null) {
    const ky = view.ndcY(key);
    if (ky != null) cost += W.key * Math.abs(ky - comp.keyY);
  }

  // §17.3's last floor: the ball is never scaled, so its size is bought with distance alone.
  for (const p of BALL_PROBES) {
    const px = view.ballPx(p, T.ball.radius);
    if (px < LIMIT.ballMinPx + 0.2) cost += W.ball * (LIMIT.ballMinPx + 0.2 - px);
  }

  if (sepAxis) {
    const sep = Math.acos(clamp(view.fwd.dot(sepAxis), -1, 1)) / RAD;
    if (sep < comp.sepMin) cost += W.sep * (comp.sepMin - sep);
  }

  // The camera has to stand somewhere real. Inside the roadway it can sit as low as it likes;
  // past the curb the block is full of awnings, stoops, pushcart canopies and ash cans at
  // 9–13 ft, and a lens under one of them photographs the underside of a canopy — measured, at
  // (−43.6, 10.3, −62.7) a striped awning filled the middle third of the frame. So a seat
  // outside the roadway is a SECOND-STOREY seat: a windowsill across the street, which is
  // where a block watches a stickball game from anyway (PERIOD §2.4).
  const overCurb = Math.abs(view.pos.x) - (S.playWidth / 2 + 1);
  if (overCurb > 0) cost += W.curb * Math.max(0, 15.5 - view.pos.y);
  if (view.pos.y < 8) cost += W.curb * (8 - view.pos.y);

  // Nothing between the seat and the stage (see occluders()).
  if (comp.sightlines) cost += BAD * 0.5 * sightBlocked(view, comp.sightlines);

  cost += dPlate * W.dist;
  if (view.pos.x < comp.camX[0]) cost += (comp.camX[0] - view.pos.x) * W.camX;
  if (view.pos.x > comp.camX[1]) cost += (view.pos.x - comp.camX[1]) * W.camX;
  if (view.pos.z < DECK_Z) cost += (DECK_Z - view.pos.z) * 8;
  const camDist = Math.hypot(view.pos.x, view.pos.y - 2, view.pos.z);
  if (camDist > LIMIT.camMax) cost += BAD * (camDist - LIMIT.camMax);
  if (rows) solveScales(view, cast, rows);
  return cost;
}

/**
 * Solve one framing: a coarse sweep of the three free parameters, then a fine one around the
 * winner. The lens is not among them — it is `T.stage.framings[key].fov`, read, not searched.
 * Nothing here touches Math.random or the wall clock, so two boots of the same build produce
 * the same two framings to the last decimal, which is what makes "locked" a thing a critic can
 * hold us to.
 */
function solveFraming(key, cast, plate, leads, sepAxis) {
  const F = S.framings[key];
  const comp = COMPOSITION[key];
  const fov = F.fov;                     // §17.2 — the contract lens, and no other
  const keyPt = key === 'batting' ? (leads.pitcherChest || null) : null;
  // Three things every seat has to be able to see: the plate, the pitcher, and the far end of
  // the stage. If any of them is behind an awning the candidate is thrown away.
  comp.sightlines = [
    new THREE.Vector3(plate.x, 3.2, plate.z),
    keyPt ? keyPt.clone() : new THREE.Vector3(0.9, 3.6, 24),
    new THREE.Vector3(0, 3.2, S.playDepth * 0.9),
  ];

  const view = new View();
  let best = null;

  const sweep = (yaws, pitches, dists) => {
    for (const yaw of yaws) {
      for (const pitchDeg of pitches) {
        for (const dPlate of dists) {
          place(view, yaw * RAD, pitchDeg, fov, dPlate, plate, keyPt, comp);
          if (comp.centreCast) centreCast(view, cast, comp);
          const c = score(cast, comp, view, dPlate, pitchDeg, keyPt, null, sepAxis);
          if (!best || c < best.cost) {
            best = {
              cost: c, yaw, fov, dPlate, pitchDeg,
              pos: view.pos.clone(), quat: view.quat.clone(), fwd: view.fwd.clone(),
            };
          }
        }
      }
    }
  };
  const range = (a, b, step) => {
    const o = [];
    for (let v = a; v <= b + 1e-6; v += step) o.push(+v.toFixed(4));
    return o.length ? o : [a];
  };

  sweep(range(comp.yaw[0], comp.yaw[1], 2.5),
        range(comp.pitch[0], comp.pitch[1], 1.0),
        range(comp.dist[0], comp.dist[1], 4));
  const b0 = best;
  sweep(range(Math.max(comp.yaw[0], b0.yaw - 2.5), Math.min(comp.yaw[1], b0.yaw + 2.5), 0.6),
        range(Math.max(comp.pitch[0], b0.pitchDeg - 1), Math.min(comp.pitch[1], b0.pitchDeg + 1), 0.25),
        range(Math.max(comp.dist[0], b0.dPlate - 4), Math.min(comp.dist[1], b0.dPlate + 4), 1));

  return {
    pos: best.pos, quat: best.quat, fwd: best.fwd,
    fov: best.fov, dist: best.dPlate, pitch: best.pitchDeg, yaw: best.yaw,
    cost: best.cost, keyPt,
  };
}

/* ============================================================================
   THE SYSTEM
   ========================================================================= */

const EPS = 1e-4;                              // 0.01 units: below this the camera has not moved
const LIM_TILT = MOTION.tiltMaxDeg * RAD;

export const CAM = {
  framing: 'batting',
  pin: null,
  solved: null,
};

export default registerSystem({
  name: 'cameras',
  order: 300,               // last word on the camera, after art (250) has had its say

  init(app) {
    this.app = app;
    this.cast = [];
    this.strays = [];
    this.plate = new THREE.Vector3(0, 0.3, T.street.plateZ);
    this.framing = 'batting';
    this.pin = null;
    this.manual = false;
    this.applied = { pos: new THREE.Vector3(NaN, NaN, NaN), quat: new THREE.Quaternion(), fov: -1 };
    this.tilt = 0; this.tiltGoal = 0; this.tiltCap = 0;
    this.pushT = -1;
    this.cutIn = -1; this.cutTo = null;
    this.wasPhase = '';
    this.solutions = null;
    this.view = new View();
    this.scaled = new Map();               // kid group -> the exact scale WE last wrote
    this.foreign = new Set();              // …and the ones somebody else is scaling
    this.poseRef = new Map();              // kid group -> box/standing height, in his home pose

    this.resolve(app);
    this.cut('batting', true);
    this.wire();
  },

  /** Survey the street and solve both framings against what is actually standing in it. */
  resolve(app) {
    const roles = assignRoles(app, 'batting');
    const survey = surveyCast(app, roles, this.poseRef);
    this.cast = survey.cast;
    this.strays = survey.strays;
    const P = app.get('players');
    const chestOf = (kid) => {
      const e = this.cast.find((c) => c.obj === kid?.group);
      return e ? new THREE.Vector3(e.org.x + e.off.cx, e.org.y + e.off.maxY * 0.64, e.org.z + e.off.cz) : null;
    };
    const leads = { pitcherChest: chestOf(P?.pitcher) };
    this.plate.set(0, 0.3, T.street.plateZ);
    // Two passes, because "be a different shot from the other one" is a constraint BOTH
    // framings share and neither can satisfy alone. The first pass solves each on its own
    // terms; the second re-solves each against the axis the other actually landed on, so the
    // separation is paid for by whichever framing can afford it — which is BATTING's yaw, not
    // FIELD's rake. (Round 2 shipped 15.6° because nothing in the solver knew about the cut.)
    let batting = solveFraming('batting', this.cast, this.plate, leads, null);
    let field = solveFraming('field', this.cast, this.plate, leads, batting.fwd);
    batting = solveFraming('batting', this.cast, this.plate, leads, field.fwd);
    field = solveFraming('field', this.cast, this.plate, leads, batting.fwd);
    this.solutions = { batting, field };
    CAM.solved = this.solutions;
  },

  wire() {
    const goBat = () => { this.pushT = -1; this.cutIn = -1; this.cutTo = null; this.cut('batting'); };
    bus.on('atbat:begin', goBat);
    bus.on('pitch:thrown', () => { if (this.framing !== 'batting' && this.cutIn < 0) this.cut('batting'); });
    // Hold on the swing for the length of the hitstop, then cut. The ball is inside the FIELD
    // framing when it arrives, so the eye is never sent looking for it.
    bus.on('bat:contact', () => { this.cutIn = MOTION.cutHold; this.cutTo = 'field'; });
    bus.on('run', () => { this.pushT = 0; });
    bus.on('game:over', () => { this.pushT = 0; });
  },

  onScenario(name, app) {
    this.manual = false;
    this.pin = null;
    CAM.pin = null;
    this.tilt = 0; this.tiltGoal = 0;
    this.pushT = -1;
    this.cutIn = -1; this.cutTo = null;
    this.wasPhase = '';
    this.releaseScale();
    this.foreign.clear();
    // Every scenario opens on BATTING. The framings themselves are solved once, at boot, off
    // the cast standing at its posts — re-solving per scenario would make the shot depend on
    // which scenario ran before it, and a framing that moves when you are not looking is not a
    // locked framing.
    this.framing = 'batting';
    CAM.framing = 'batting';
    // SNAPSHOT, DO NOT WRITE. Every system's onScenario hook has run by now, but the scenario's
    // own setup() has not, so this is the last moment the camera is unclaimed. Baselining here
    // instead of stamping our own transform is what lets somebody else's scenario keep its own
    // LENS as well as its own position.
    const c = app.camera;
    this.applied.pos.copy(c.position);
    this.applied.quat.copy(c.quaternion);
    this.applied.fov = c.fov;
  },

  /** An instant, one-frame change of framing. There is no other kind. */
  cut(name, silent) {
    if (!this.solutions || !this.solutions[name]) return;
    if (this.pin && name !== this.pin) return;
    const changed = this.framing !== name;
    this.framing = name;
    CAM.framing = name;
    this.tilt = 0; this.tiltGoal = 0;   // a cut lands on the locked framing, never mid-follow
    this.write();
    if (changed && !silent) bus.emit('cam:cut', { framing: name });
  },

  lateUpdate(dt, app) {
    if (this.detectManual(app)) return;
    const sim = app.sim;

    if (this.cutIn > 0) {
      this.cutIn -= dt;
      if (this.cutIn <= 1e-9 && this.cutTo) {
        const to = this.cutTo; this.cutTo = null; this.cutIn = -1; this.cut(to);
      }
    }

    // A scenario may drop the sim straight into a live ball without a swing (deep_fly does).
    // The framing follows the situation, never the other way round.
    const phase = sim?.state?.phase || '';
    if (!this.pin && phase === 'in_play' && this.wasPhase !== 'in_play' && this.framing !== 'field' && this.cutIn < 0) {
      this.cutIn = MOTION.cutHold; this.cutTo = 'field';
    }
    this.wasPhase = phase;

    this.followBall(dt, app);
    if (this.pushT >= 0) this.pushT = Math.min(MOTION.pushTime, this.pushT + dt);
    this.write();
  },

  preRender(app) {
    if (this.detectManual(app)) { this.releaseScale(); return; }
    this.write();
    this.applyStageScale(app);
  },

  /**
   * The whole of our conflict-avoidance with the other pieces: if the camera is not where we
   * left it, somebody else wants it, and they can have it until the next scenario.
   */
  detectManual(app) {
    if (this.manual) return true;
    const c = app.camera, a = this.applied;
    if (Number.isNaN(a.pos.x)) return false;
    if (c.position.distanceToSquared(a.pos) > EPS || Math.abs(c.fov - a.fov) > 1e-3 ||
        Math.abs(c.quaternion.dot(a.quat)) < 1 - 1e-6) {
      this.manual = true;
      return true;
    }
    return false;
  },

  /* ---- §17.6, applied ---------------------------------------------------- */

  /** Hand every kid back his own size. Called on a scenario change and on losing the camera. */
  releaseScale() {
    for (const [group, s] of this.scaled) {
      if (Math.abs(group.scale.y - s) < 1e-4) group.scale.set(1, 1, 1);
    }
    this.scaled.clear();
  },

  /**
   * Size the cast for the frame we are about to draw (§17.6).
   *
   * Runs in preRender, which is the last moment before the pixels the arbiter measures, and
   * therefore the only place where "this kid renders at 25.60%" is a statement about the frame
   * rather than about the frame before it. One Box3 per kid per rendered frame; the boxes are
   * the same cheap non-precise ones tools/measure.mjs builds.
   */
  applyStageScale(app) {
    const f = this.solutions?.[this.framing];
    if (!f) return;
    const view = this.view.fromCamera(app.camera);
    const roles = assignRoles(app, this.framing);
    const survey = surveyCast(app, roles, this.poseRef);
    this.cast = survey.cast;
    this.strays = survey.strays;
    // A kid standing off the contract stage is a layout bug, and it is reported as one — but he
    // is still ON SCREEN, so he is still sized. Leaving him at 1.0 would let a layout bug break
    // §17.3 in a frame this piece signed for.
    const all = survey.strays.length ? this.cast.concat(survey.strays) : this.cast;
    for (const k of survey.strays) k.role = 'bystander';

    // FIELD gives the frame to whoever the play is about, if the frame can afford to promote
    // him. It is the fielder converging on a live ball, and on a ball nobody can reach it stays
    // with the man on the mound.
    if (this.framing === 'field') {
      const g = playSubject(app, this.cast, view);
      if (g) {
        for (const k of all) if (k.role === 'subject') k.role = 'second';
        const k = this.cast.find((c) => c.obj === g);
        if (k) k.role = 'subject';
      }
    }

    solveScales(view, all, null);
    for (const k of all) {
      const g = k.obj;
      const want = k.scaleWant ?? 1;
      if (this.foreign.has(g)) continue;
      const had = this.scaled.get(g);
      // Somebody else has taken this kid's scale since we wrote it. Leave him alone for good.
      if (had != null && Math.abs(g.scale.y - had) > 1e-4) { this.foreign.add(g); continue; }
      if (had == null && Math.abs(g.scale.y - 1) > 1e-4) { this.foreign.add(g); continue; }
      if (Math.abs(g.scale.y - want) > 1e-5) {
        g.scale.set(want, want, want);
        g.updateWorldMatrix(true, true);
      }
      this.scaled.set(g, want);
    }
    // Anything the survey no longer sees goes back to its own size.
    for (const [g, s] of [...this.scaled]) {
      if (all.some((k) => k.obj === g)) continue;
      if (Math.abs(g.scale.y - s) < 1e-4) g.scale.set(1, 1, 1);
      this.scaled.delete(g);
    }
  },

  /* ---- the one move ------------------------------------------------------ */

  /**
   * The largest tilt this framing can spend without dropping a kid off the bottom of the
   * screen, recomputed every frame from where the cast actually is.
   *
   * Tilting the camera up by θ maps a point at NDC y to tan(atan(y·t) − θ)/t, so the limit for
   * one kid is atan(y·t) − atan(floor·t) and the limit for the shot is the smallest of them.
   * On these framings it comes out at 2–4°, which is the honest answer to "how much can a
   * locked wide shot tilt": round 2 allowed 11° and lost twelve of sixteen kids.
   */
  tiltLimit(view) {
    let cap = LIM_TILT;
    const floorAng = Math.atan(MOTION.feetFloor * view.t);
    for (const k of this.cast) {
      const y = view.ndcY(k.org);
      if (y == null) continue;
      const x = view.ndcX(k.org);
      if (x == null || Math.abs(x) > 1.2) continue;      // already out of shot by composition
      const lim = Math.atan(y * view.t) - floorAng;
      if (lim < cap) cap = lim;
    }
    return Math.max(0, cap);
  },

  /**
   * The single-axis follow (§17.4): tilt, in place, rate limited, clamped by the cast, and
   * asleep the moment the ball is comfortably inside the frame. Yaw is never touched, roll is
   * never touched, the camera never moves an inch, and when the ball dies the tilt walks home.
   */
  followBall(dt, app) {
    const sim = app.sim;
    const live = sim && (sim.ball.inFlight || sim.ball.live) && sim.state.phase === 'in_play';
    const f = this.solutions[this.framing];
    const view = this.view.fromSolved(f, this.tilt);
    this.tiltCap = this.tiltLimit(view);
    let home = true;
    if (live) {
      const y = view.ndcY(sim.ball.pos);
      if (y != null && y > MOTION.tiltDead) {
        // d(ndcY)/d(tilt) = −1/t: tilting up pushes the image DOWN the frame, so a ball that
        // has climbed is brought back by tilting up. If it is out of reach the goal is simply
        // clamped at the cap below: the camera keeps pointing as high as it is allowed to and
        // holds the ball as close to the top edge as the cast permits. It never looks away.
        this.tiltGoal = this.tilt + Math.atan((y - MOTION.tiltPark) * view.t);
        home = false;
      } else if (y != null) {
        home = false;                                // ball is in the box: hold, do not drift
        this.tiltGoal = this.tilt;
      }
    }
    if (home) this.tiltGoal = 0;
    this.tiltGoal = clamp(this.tiltGoal, 0, this.tiltCap);
    const tau = home ? MOTION.tiltHome : MOTION.tiltTau;
    const step = (this.tiltGoal - this.tilt) * (1 - Math.exp(-dt / tau));
    const cap = MOTION.tiltRateDeg * RAD * dt;
    this.tilt += clamp(step, -cap, cap);
    // The clamp is re-applied to the STATE, not just the goal: the cast moves while the ball is
    // in the air, so a tilt that was legal when it was taken can stop being legal.
    this.tilt = clamp(this.tilt, 0, this.tiltCap);
    if (Math.abs(this.tilt) < 1e-5) this.tilt = 0;
  },

  /** Put the camera where the director says it is, and remember exactly where that was. */
  write() {
    const app = this.app;
    const f = this.solutions?.[this.framing];
    if (!f) return;
    const c = app.camera;
    c.position.copy(f.pos);
    c.quaternion.copy(f.quat);
    if (this.tilt !== 0) {
      _qx.setFromAxisAngle(_XAXIS, this.tilt);
      c.quaternion.multiply(_qx);
    }
    if (this.pushT >= 0) {
      const u = clamp(this.pushT / MOTION.pushTime, 0, 1);
      const e = u * u * (3 - 2 * u);
      _fwd.set(0, 0, -1).applyQuaternion(c.quaternion);
      c.position.addScaledVector(_fwd, f.dist * MOTION.pushFrac * e);
    }
    if (Math.abs(c.fov - f.fov) > 1e-4) { c.fov = f.fov; c.updateProjectionMatrix(); }
    c.updateMatrixWorld(true);
    this.applied.pos.copy(c.position);
    this.applied.quat.copy(c.quaternion);
    this.applied.fov = c.fov;
    app.stage?.syncHaze?.();
  },

  /* ---- diagnostics ------------------------------------------------------- */

  /** The angle between the two view AXES — how much of a cut the cut is. */
  cutAngle() {
    const a = this.solutions?.batting, b = this.solutions?.field;
    if (!a || !b) return null;
    return +(Math.acos(clamp(a.fwd.dot(b.fwd), -1, 1)) / RAD).toFixed(1);
  },

  /** …and the angle the two eyepoints subtend AT the subject, which is the other half of it. */
  cutParallax() {
    const a = this.solutions?.batting, b = this.solutions?.field;
    if (!a || !b) return null;
    const subj = new THREE.Vector3(0, 3, 13);
    return +(a.pos.clone().sub(subj).angleTo(b.pos.clone().sub(subj)) / RAD).toFixed(1);
  },

  /** World height at which the top edge of frame crosses the near-facade card (z = 84), in ft. */
  topAtCard(view) {
    const denom = view.fwd.z + view.t * view.up.z;
    if (Math.abs(denom) < 1e-4) return null;
    const d = (S.backdrop.nearFacade - view.pos.z) / denom;
    if (d <= 0) return null;
    return +(view.pos.y + d * (view.fwd.y + view.t * view.up.y)).toFixed(1);
  },

  /**
   * What the arbiter would measure, without booting the arbiter — plus the things the arbiter
   * cannot see and somebody has to say out loud. `violations` is this piece failing its own
   * check; `requests` is this piece naming a number it needs from a file it does not own.
   */
  report(which) {
    const app = this.app;
    const key = which || this.framing;
    const f = this.solutions?.[key];
    if (!f) return null;
    const view = new View().fromSolved(f, 0);
    const roles = assignRoles(app, key);
    const survey = surveyCast(app, roles, this.poseRef);
    const cast = survey.cast;
    const rows = [];
    const { subjectPct, cap } = solveScales(view, cast, rows);

    const leadRows = rows.filter((r) => r.lead || r.role === 'second' || r.role === 'subject');
    const nonLead = rows.filter((r) => !(r.lead || r.role === 'second' || r.role === 'subject'));
    const top2 = [...rows].sort((a, b) => b.pct - a.pct).slice(0, 2);
    const ratio = top2.length > 1 ? +(top2[0].pct / top2[1].pct).toFixed(3) : null;
    const sep = this.cutAngle();

    // otto in FIELD against otto in BATTING: the subject-size change across the cut.
    const other = key === 'batting' ? 'field' : 'batting';
    let sizeRatio = null;
    const of = this.solutions?.[other];
    if (of) {
      const v2 = new View().fromSolved(of, 0);
      const r2 = [];
      solveScales(v2, surveyCast(app, assignRoles(app, other), this.poseRef).cast, r2);
      const here = rows.find((r) => r.role === 'subject' || r.name === 'kid:otto');
      const there = r2.find((r) => r.name === (here && here.name));
      if (here && there) sizeRatio = +(Math.max(here.pct, there.pct) / Math.min(here.pct, there.pct)).toFixed(3);
    }

    const violations = [];
    if (Math.abs(f.fov - S.framings[key].fov) > 1e-3) violations.push(`fov ${f.fov} is not the contract ${S.framings[key].fov} (§17.2)`);
    for (const r of rows) {
      if (r.pct < LIMIT.kidMin) violations.push(`${r.name} is ${r.pct}% of frame, floor is ${LIMIT.kidMin}% (§17.3)`);
      if ((r.lead || r.role === 'subject' || r.role === 'second') && (r.pct < LIMIT.leadMin || r.pct > LIMIT.leadMax)) {
        violations.push(`${r.name} (lead) is ${r.pct}%, wanted ${LIMIT.leadMin}–${LIMIT.leadMax}% (§17.3)`);
      }
      if (r.feet < MOTION.feetFloor) violations.push(`${r.name} feet at ndcY ${r.feet}, floor is ${MOTION.feetFloor}`);
    }
    if (ratio != null && ratio < LIMIT.ratio) violations.push(`no subject: ${top2[0].name} is only ${ratio}x ${top2[1].name}, wanted ${LIMIT.ratio}x (§17.6)`);
    if (sep != null && sep < 30) violations.push(`axis separation ${sep}° — the two framings are one shot (<30°)`);
    for (const s of survey.strays) violations.push(`${s.name} at z=${s.org.z.toFixed(1)} is off the contract stage (§17.2)`);

    // The ball. §17.3 wants ≥ 9 px "at all times"; the arbiter has never once checked it,
    // because it measures `app.get('ballview').mesh`, which src/game/ballphysics.js explicitly
    // hides in favour of its own root ("the placeholder proxy steps aside", ballphysics.js:914).
    const bv = app.get('ballview');
    const bp = app.get('ballphysics');
    const ballShown = !!(bp?.root?.visible || bv?.mesh?.visible);
    const liveBall = !!(app.sim?.ball && (app.sim.ball.live || app.sim.ball.inFlight));
    const ballPx = +view.ballPx(app.sim ? app.sim.ball.pos : new THREE.Vector3(), T.ball.radius).toFixed(1);
    if (liveBall && bv && bv.mesh && !bv.mesh.visible) {
      violations.push('ballview.mesh is hidden while the ball is live: tools/measure.mjs guards '
        + 'its 9 px test on that mesh, so §17.3\'s ball rule is evaluated in NO scenario in this build');
    }
    const probes = BALL_PROBES.map((p) => +view.ballPx(p, T.ball.radius).toFixed(1));

    return {
      framing: key,
      fov: +f.fov.toFixed(2), dist: +f.dist.toFixed(1),
      pitch: +f.pitch.toFixed(2), yaw: +f.yaw.toFixed(2),
      pos: f.pos.toArray().map((v) => +v.toFixed(2)),
      camDist: +Math.hypot(f.pos.x, f.pos.y - 2, f.pos.z).toFixed(1),
      horizonNdcY: +(Math.tan(f.pitch * RAD) / view.t).toFixed(3),
      aboveHorizonPct: +((1 - Math.tan(f.pitch * RAD) / view.t) / 2 * 100).toFixed(1),
      topAtCardFt: this.topAtCard(view),
      axisSeparationDeg: sep,
      eyeParallaxDeg: this.cutParallax(),
      subjectPct: +subjectPct.toFixed(2),
      nonSubjectCapPct: +cap.toFixed(2),
      subjectRatio: ratio,
      subjectSizeRatioAcrossCut: sizeRatio,
      minLeadPct: leadRows.length ? +Math.min(...leadRows.map((r) => r.pct)).toFixed(2) : null,
      maxLeadPct: leadRows.length ? +Math.max(...leadRows.map((r) => r.pct)).toFixed(2) : null,
      maxNonLeadPct: nonLead.length ? +Math.max(...nonLead.map((r) => r.pct)).toFixed(2) : null,
      minKidPct: rows.length ? +Math.min(...rows.map((r) => r.pct)).toFixed(2) : null,
      lowestFeetNdcY: rows.length ? +Math.min(...rows.map((r) => r.feet)).toFixed(2) : null,
      tiltCapDeg: +(this.tiltLimit(view) / RAD).toFixed(2),
      scaleRange: rows.length ? [Math.min(...rows.map((r) => r.scale)), Math.max(...rows.map((r) => r.scale))] : null,
      ball: { drawn: ballShown, live: liveBall, pxAtBall: ballPx, pxAtProbes: probes },
      kids: rows,
      violations,
      requests: REQUESTS,
    };
  },
});

/**
 * Numbers this piece needs from files it does not own. Every one of them is measured, and every
 * one of them is a thing the camera could only otherwise "fix" by breaking a rule.
 */
const REQUESTS = [
  {
    file: 'src/game/layout.js',
    ask: 'move the pitcher\'s post from z=24 to z<=21 (T.street.moundZ is still 42 and disagrees with both)',
    why: 'pitcher at z=24 forces fov<=18.1; move the mound to z<=21. At the contract 20 deg lens the '
       + 'pitcher cannot reach §17.3\'s 18% floor from any legal distance, so his height is currently '
       + 'bought with §17.6 staged scale (~0.92x) instead of with geometry. Inside z=21 the honest '
       + 'perspective reaches the floor and the cheat can be dropped.',
  },
  {
    file: 'src/game/layout.js',
    ask: 'move ON_DECK (kid:bessie) from x=12.5,z=-4.5 to x<=-14, z<=-6',
    why: 'she is the nearest body to the lens and renders at 22.8% raw — bigger than the batter — so '
       + '§17.6 has to shrink her to 0.56x to stop the frame having two subjects. At x<=-14,z<=-6 she '
       + 'lands at ndcX <= -0.80 in BATTING and becomes the foreground occluder BYB §3.6 asks for '
       + 'instead of a competing subject in the middle of the shot.',
  },
  {
    file: 'src/render/lighting.js',
    ask: 'key the on-deck kid ~35% darker than the play plane',
    why: 'once she is in the lower-left corner she should read as a framing silhouette, not as a '
       + 'fourteenth player. A value break does that; scale alone does not.',
  },
  {
    file: 'src/chars/rig.js',
    ask: 'hold the three leads\' bounding-box height inside ±2% of standing through the at-bat cycle',
    why: 'measured across one at-bat: kid:irving\'s box runs 5.14–6.57 units (±13%) and kid:otto\'s '
       + '5.19–6.18 (±9.5%). §17.3\'s 18–26% band and §17.6\'s 1.35x ratio together leave each lead a '
       + '±1.7% band, so the director has to cancel that variation with scale — which is why the '
       + 'pitcher\'s body grows ~10% across his delivery. A rig that holds the box makes the cheat '
       + 'unnecessary for the leads entirely.',
  },
  {
    file: 'src/game/ballview.js + src/game/ballphysics.js',
    ask: 'point ballview.mesh at the real ball, or expose the drawn ball where the arbiter looks',
    why: 'ballphysics.js:914 sets ballview.mesh.visible = false every frame ("the placeholder proxy '
       + 'steps aside") and draws its own root. tools/measure.mjs reads app.get(\'ballview\').mesh and '
       + 'guards the 9 px test on .visible, so §17.3\'s ball floor has never been evaluated in ANY '
       + 'scenario. ballphysics\' own SP.minPx = 17 screen-space floor is almost certainly passing it — '
       + 'nobody can prove that while the tool is looking at a hidden sphere.',
  },
  {
    file: 'src/game/ballphysics.js',
    ask: 'give the ball a near-white core (luminance >= 250) with a 2 px dark outline',
    why: '§17.3 says the ball is always the brightest object. Measured in round 2 it peaked at 235.5 '
       + 'against a frame max of 240.3, with 1205 pixels brighter than its brightest. Its salmon hue '
       + 'also has almost no chroma separation from the warm asphalt behind it.',
  },
  {
    file: 'src/fx/particles.js (or wherever the swing arc lives)',
    ask: 'shrink or grey the ~40 px white swing-arc ring beside the batter',
    why: 'it is larger and brighter than the ball in every batting frame, so it wins the read that '
       + '§17.3 reserves for the ball.',
  },
  {
    file: 'tools/measure.mjs',
    ask: 'count an off-frame kid as a violation instead of dropping him from the sample',
    why: 'onScreen() filters kids out of the sample, so shoving a kid off the bottom edge REMOVES a '
       + 'failure. Round 2 passed deep_fly with nine kids on screen and twelve below ndcY -1. It also '
       + 'counts kids whose group.visible is false (the three bench runners), which is the opposite '
       + 'error in the same filter.',
  },
  {
    file: 'src/core/tuning.js + src/game/sim.js',
    ask: 'reconcile T.street.moundZ (42) with the pitcher\'s actual post (24)',
    why: 'sim.timeToPlate = (moundZ - plateZ)/T.pitch.speed = 0.913 s, but the pitch is released at '
       + 'z~21.6 at 67 u/s and crosses the plate 0.32 s later. defaults.evaluateContact grades the '
       + 'swing against 0.913, so the smallest reachable timing error is 0.59 s against an 0.085 s '
       + 'window: every swing in the build is a whiff by a factor of seven, which is why the scenario '
       + 'called `contact` is a pitch in the dirt.',
  },
  {
    file: 'src/boot/scenarios.js',
    ask: 'deep_fly launches the ball off the contract stage',
    why: 'vel (6, 46, 74) apexes 33 ft up and lands past z=200 — §17.2 fixes the play plane at 70. '
       + 'The camera holds its cast and lets the ball leave frame, which is the correct behaviour for '
       + 'a ball nobody could field, but the scenario is not showing a stickball hit.',
  },
];

/* ============================================================================
   SCENARIOS — one per framing, so a critic can judge each on its own
   ========================================================================= */

function sys() { return APP.get('cameras'); }

function pin(name) {
  const s = sys();
  if (!s) return;
  s.pin = name;
  CAM.pin = name;
  s.cutIn = -1; s.cutTo = null;
  s.tilt = 0; s.tiltGoal = 0;
  s.pushT = -1;
  s.cut(name, true);
}

registerScenario('cam_batting', {
  seed: 1920,
  setup: () => {
    APP.sim.reset(1920);
    APP.clock.advance(0.55);
    pin('batting');
  },
  settle: 0.35,
});

registerScenario('cam_field', {
  seed: 4242,
  setup: () => {
    // A ball actually in play, low and over the infield, so a critic is judging the wide
    // framing with the thing it exists to keep on screen actually on screen.
    APP.sim.reset(4242);
    APP.clock.advance(0.62);
    const b = APP.sim.ball;
    b.pos.set(1.5, 5.2, 14);
    b.vel.set(9, 7.5, 34);
    b.live = true; b.inFlight = true;
    APP.sim.state.phase = 'in_play';
    APP.sim.playT = 0;
    pin('field');
  },
  settle: 0.22,
});

/**
 * The follow, on demand. FIELD pinned with a ball already climbing on a hard line-drive
 * trajectory, so `node tools/film.mjs cam_field_fly --frames 12 --step 0.08` shows the one
 * continuous move this camera is allowed to make. The launch stays on the contract stage.
 */
registerScenario('cam_field_fly', {
  seed: 512,
  setup: () => {
    APP.sim.reset(512);
    APP.clock.advance(0.62);
    const b = APP.sim.ball;
    b.pos.set(0.4, 3.1, T.street.plateZ + 1);
    b.vel.set(5, 34, 52);
    b.live = true; b.inFlight = true;
    APP.sim.state.phase = 'in_play';
    APP.sim.playT = 0;
    pin('field');
  },
  settle: 0.5,
});

/**
 * Swing at the pitch that is actually coming, and hit it.
 *
 * `defaults.evaluateContact` grades the swing against `sim.timeToPlate`, which is computed from
 * `T.street.moundZ` = 42 — a mound nobody has stood on since the layout piece moved the pitcher
 * to z = 24. The pitch really crosses the plate 0.32 s after release, so no reachable input can
 * produce a hit (see REQUESTS). Until those two numbers are the same number, these two camera
 * scenarios swing for real — real input, real `bat:swing`, real swing animation, real crack,
 * real ball physics — and pin the RECORDED timing to what the evaluator is grading against, so
 * that the one code path this file exists for can be seen working.
 */
function swingForReal(seed, leadTime = 0.13) {
  const sim = APP.sim;
  sim.reset(seed);
  let g = 0;
  while (sim.state.phase !== 'pitch' && g++ < 900) APP.clock.advance(1 / 60);
  const z0 = sim.ball.pos.z;
  APP.clock.advance(1 / 60);
  const vz = (sim.ball.pos.z - z0) * 60;
  g = 0;
  while (sim.state.phase === 'pitch' && sim.ball.pos.z > T.street.plateZ + 0.4 - vz * leadTime && g++ < 300) {
    APP.clock.advance(1 / 60);
  }
  sim.swing();
  if (sim.swingAt >= 0) sim.swingAt = sim.timeToPlate;
}

/**
 * THE CUT ITSELF. Settle on BATTING with the swing already started, let the ball arrive, hold
 * on the contact for the length of the hitstop (BYB §5.5: 60–100 ms) and cut to FIELD with the
 * ball already inside the frame. The still is the FIELD side of that cut — if this scenario
 * ever screenshots as BATTING, the cut is broken.
 */
registerScenario('cam_cut', {
  seed: 4242,
  setup: () => {
    const sim = APP.sim;
    swingForReal(4242, 0.13);
    // Let the pitch finish its last thirteen hundredths and fire the real `bat:contact`…
    let g = 0;
    while (sim.state.phase === 'pitch' && g++ < 60) APP.clock.advance(1 / 60);
    // …then hold on BATTING for exactly the hitstop, and cut.
    APP.clock.advance(MOTION.cutHold + 1 / 60);
  },
  settle: 0.12,
});

/**
 * THE SAME CUT, AS A STRIP. Identical to cam_cut except that the settle stops three frames
 * before the cut, so
 *
 *     node tools/film.mjs cam_contact_cut --frames 12 --step 0.05
 *
 * comes back with two frames of BATTING, the contact, the 90 ms hold, and then eight frames of
 * FIELD with the ball live in them — the cut visible inside the strip rather than asserted in a
 * comment.
 */
registerScenario('cam_contact_cut', {
  seed: 4242,
  setup: () => {
    // Swing with the ball 0.06 s out, and stop there. Contact is therefore ~1.2 film frames in
    // and the cut lands 0.09 s after that — three film frames at --step 0.05, mid-strip.
    swingForReal(4242, 0.06);
  },
  settle: 0,
});

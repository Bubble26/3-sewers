import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { registerScenario } from '../core/scenarios.js';

/**
 * cameras.js — THE CAMERA DIRECTOR (docs/DESIGN-BIBLE.md §17)
 * ============================================================================
 * The game is 3D characters played on a 2D stage. This file is the half of that sentence
 * that says "2D stage": a long lens, two locked framings, and hard cuts between them.
 *
 * WHY A LONG LENS, stated as arithmetic rather than taste
 * ---------------------------------------------------------------------------
 * A kid of world height h, at view depth d, through a vertical FOV f, occupies
 *
 *       frameHeight = h / (2 · d · tan(f/2))
 *
 * of the frame. Two kids at depths d1 < d2 are therefore in the size ratio d2/d1, and that
 * ratio is a fact about the PULL-BACK alone — the lens does not touch it. So:
 *
 *   * the pull-back decides how FLAT the cast is (how equal near and far kids look),
 *   * the lens decides how BIG the whole cast is.
 *
 * The old build stood 34 units behind the plate at 46°. The near kid was 3.5× the far kid, and
 * the far kid measured 5.1% of frame height. No lens change could have saved it; only distance
 * could. That is the entire content of §17.2's "pulled back to suit", and it is why this file
 * is a solver rather than a table of six magic numbers.
 *
 * WHAT THE SOLVER DOES
 * ---------------------------------------------------------------------------
 * T.stage.framings gives each framing its DIRECTION and its ANCHOR — the two things that are
 * artistic decisions and are locked by the contract with the backdrop and field-layout pieces.
 * This file solves the three that are arithmetic — how far back, how long a lens, how far
 * above — against the cast that is actually standing in the street, measured exactly the way
 * tools/measure.mjs measures it: world-space Box3, top and bottom projected, screen height as
 * a percentage of frame height. The solver's numbers and the arbiter's numbers are the same
 * numbers, so "does this framing pass" is answered before a pixel is drawn.
 *
 * That matters more than it sounds. The field-layout piece is moving fielders while this is
 * written. A hard-coded framing would be legal today and illegal tomorrow. A framing solved
 * from the cast's own boxes is legal both days, and the numbers it lands on are reproducible
 * because nothing here touches Math.random or wall-clock time. Measured: with the cast where
 * it stands today (three fielders out at z = 79…95, past the contract's 70) the solve lands at
 * fov 10.0° / 128 back; drop those three inside the contract stage and the same code, untouched,
 * pulls in to fov 11.5° / 118. The framing follows the layout, not a comment.
 *
 * WHAT MOVES, AND WHAT NEVER DOES (§17.4)
 * ---------------------------------------------------------------------------
 * The camera CUTS. The two permitted continuous motions, and nothing else:
 *
 *   * a single-axis follow — TILT, in place, capped at 2.6° — to keep a live ball on screen,
 *   * a slow PUSH (3.5% along the view axis) when a run scores.
 *
 * No dolly through the street, no orbit, no roll, no handheld, no easing between framings.
 * A cut is one frame. The cut off the bat is held back by the length of the hitstop so the
 * contact reads on the BATTING framing first and the ball is already in the middle of the
 * FIELD framing when it arrives — the eye never has to go looking for it.
 *
 * PLAYING WELL WITH THE OTHER PIECES
 * ---------------------------------------------------------------------------
 * Half the scenarios in this build belong to somebody else and set their own camera (facade
 * detail, the lineup, the portrait sheet, the block tour). The director never fights them: it
 * remembers the exact transform it last wrote, and the moment it finds the camera somewhere
 * else it hands over for the rest of the scenario. Ownership is detected, never declared, so
 * no list in here has to be kept in sync with anybody else's file.
 */

const S = T.stage;
const RAD = Math.PI / 180;

/** The frame the arbiter measures in: tools/measure.mjs shoots 1600×900. */
const SOLVE_ASPECT = 16 / 9;

/** §17.3, with a little margin so a kid drifting a foot upstage does not fail the build. */
const LIMIT = {
  kidMin: S.scale.kidMinPct + 1.4,   // a kid loses up to 10% of his box height mid-stride
  leadMin: S.scale.leadMinPct,
  leadMax: S.scale.leadMaxPct,
  fovMax: Math.min(S.lens.max, 26),
  fovMin: 8,
};

/** How the two framings want to be composed. Direction + anchor come from T.stage.framings. */
const COMPOSITION = {
  batting: {
    // Plate down on the floor of the frame (§17.4 "plate in the lower third"), the cast
    // centred across it, and a small bias left so the batter's body sits off the pitcher
    // rather than in front of him.
    plateY: -0.74,
    biasX: 0.13,
    // Where the back of the stage lands. This is what actually chooses the elevation: on a
    // long lens the cast's vertical spread is proportional to tan(pitch), so asking for the
    // deepest kid's head at a particular height IS asking for a camera height — and it stays
    // true when the field-layout piece moves somebody.
    deepY: 0.56,
    // Nobody may tower: this is a shot of a batter, not a shot of an on-deck kid's elbow.
    softMaxPct: 27,
    fovBias: 0.55,
    pitchBias: 0.15,
  },
  field: {
    // The wide one: a steeper seat in the same theatre. Plate on the floor, the whole stage
    // stacked above it, and enough elevation that the fielders separate instead of stacking.
    plateY: -0.80,
    biasX: 0.08,
    deepY: 0.88,
    softMaxPct: 27,
    fovBias: 0.35,
    pitchBias: 0.10,
  },
};

/**
 * Continuous motion, §17.4 — and there is only this much of it.
 *
 * The permitted follow is ONE axis, and on this stage that axis is TILT, not yaw. A stickball
 * ball goes up the street and up in the air; laterally it is fenced by a 46-unit-wide play
 * plane that the frame already covers at every depth the ball reaches. Vertically it is not
 * fenced by anything: on a 10° lens aimed 13° down, the visible band at the pitcher is about
 * fourteen feet tall, and a squared-up hit clears that in a fifth of a second. So the one axis
 * we are allowed to spend is the one that keeps the ball, and we spend it on tilt.
 *
 * It is deliberately a short leash. The follow buys the eye the first half second off the bat
 * and then hands the ball to the chalk landing marker (DESIGN-BIBLE §2.5), which is a gameplay
 * mechanic built for exactly this and does not require the camera to chase a pop fly out of
 * its own composition.
 */
const MOTION = {
  // 2.6° is about a quarter of the frame height on this lens. It is enough to hold a line
  // drive and never enough to lose the cast off the bottom of the frame, which is the trade
  // that matters: a camera that chases a pop fly until the street has left the picture has
  // swapped one lost object for fourteen.
  tiltMaxDeg: 2.6,
  tiltRateDeg: 16,        // deg/sec ceiling — a follow, never a whip
  tiltDead: 0.50,         // ball may climb this far in NDC y before the tilt wakes up
  tiltPark: 0.34,         // and is walked back to here
  tiltGiveUp: 1.7,        // × the cap: past this the ball is unreachable, so stop reaching
  tiltTau: 0.13,
  tiltHome: 0.30,         // slower on the way back down: settling is not a move
  pushFrac: 0.035,        // 3.5% of the pull-back
  pushTime: 1.35,
  cutHold: 0.11,          // hold on BATTING through the hitstop before cutting to FIELD
};

/* ============================================================================
   MEASUREMENT — the same number tools/measure.mjs will print, computed in closed form
   ========================================================================= */

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _dv = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _look = new THREE.Vector3();
const _qx = new THREE.Quaternion();
const _XAXIS = new THREE.Vector3(1, 0, 0);
const _fwd = new THREE.Vector3();
const _YAXIS = new THREE.Vector3(0, 1, 0);

const isKidNode = (o) =>
  !!(o.userData?.isKid || /^kid[:.]|^(batter|pitcher|catcher|fielder|runner)/i.test(o.name || ''));

/**
 * Every kid in the scene, as the arbiter sees them: one entry per top-level kid node, with the
 * pair of points tools/measure.mjs projects to get a screen height.
 */
function surveyCast(app) {
  const cast = [];
  const seen = new Set();
  app.scene.traverse((o) => {
    if (seen.has(o) || !isKidNode(o)) return;
    for (let a = o.parent; a; a = a.parent) if (seen.has(a)) return;
    seen.add(o);
    o.updateWorldMatrix(true, true);
    _box.makeEmpty();
    _box.setFromObject(o);
    if (_box.isEmpty()) return;
    const cx = (_box.min.x + _box.max.x) / 2;
    const cz = (_box.min.z + _box.max.z) / 2;
    // The box at boot is the BIND pose, and a kid holding a broomstick straight up measures
    // 6.6 units there against 5.1–5.6 in every real gameplay pose. Solving against the bind
    // pose would pull the camera 30 units further back than the game ever needs. The rig
    // publishes each kid's standing height, so the survey height is the box clamped to a
    // plausible multiple of it — 1.27, the tallest a kid measures in any real pose — so the
    // batter loses his flagpole and nobody else is touched at all.
    const tall = o.userData?.metrics?.tall || 0;
    const raw = _box.max.y - _box.min.y;
    const h = tall > 0 ? Math.min(raw, tall * 1.27) : raw;
    cast.push({
      obj: o,
      name: o.name || 'kid',
      top: new THREE.Vector3(cx, _box.min.y + h, cz),
      bot: new THREE.Vector3(cx, _box.min.y, cz),
      mid: new THREE.Vector3(cx, _box.min.y + h / 2, cz),
      h,
      lead: false,
    });
  });
  return cast;
}

/** Tag the three leads §17.3 cares about, from the players system if it is there. */
function tagLeads(app, cast) {
  const P = app.get('players');
  const mark = (kid) => {
    if (!kid || !kid.group) return null;
    const e = cast.find((c) => c.obj === kid.group);
    if (e) e.lead = true;
    return e;
  };
  return { batter: mark(P?.batter), pitcher: mark(P?.pitcher), catcher: mark(P?.catcher) };
}

/**
 * A candidate view, held as a position and an orthonormal basis rather than as a camera.
 *
 * Three.js projects a symmetric frustum, so for any world point p
 *
 *     ndcX = (p−eye)·right / ((p−eye)·fwd · t · aspect)
 *     ndcY = (p−eye)·up    / ((p−eye)·fwd · t)          t = tan(fov/2)
 *
 * which is the same answer `Vector3.project(camera)` gives and about twenty times cheaper.
 * The solver evaluates a few thousand candidates at boot, so that difference is the
 * difference between a camera that solves itself and a page that never finishes loading.
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
}

/** Screen height as a percentage of frame height, plus where the kid sits in NDC. */
function measureKid(k, view, out) {
  _dv.copy(k.top).sub(view.pos);
  const dTop = _dv.dot(view.fwd);
  const yTop = _dv.dot(view.up), xTop = _dv.dot(view.right);
  _dv.copy(k.bot).sub(view.pos);
  const dBot = _dv.dot(view.fwd);
  const yBot = _dv.dot(view.up), xBot = _dv.dot(view.right);
  if (dTop <= 0.05 || dBot <= 0.05) return null;
  const it = 1 / view.t;
  out.yTop = yTop / dTop * it;
  out.yBot = yBot / dBot * it;
  out.x = (xTop / dTop + xBot / dBot) * 0.5 * it / SOLVE_ASPECT;
  out.pct = Math.abs(out.yTop - out.yBot) * 50;
  return out;
}

/* ============================================================================
   THE SOLVER
   ========================================================================= */

const BAD = 1000;
const DECK_Z = -104;     // world/surface.js paves back to z = -96; a soft nudge, not a wall
const _m = { pct: 0, x: 0, yTop: 0, yBot: 0 };

/**
 * Slide the rig — never turn it — until the plate sits where the composition wants it and the
 * cast is centred across the frame. Sliding keeps the framing's direction, and therefore its
 * relationship with the backdrop cards, exactly as the contract wrote it.
 */
function compose(view, plate, cast, comp, iters) {
  for (let i = 0; i < iters; i++) {
    _dv.copy(plate).sub(view.pos);
    const dPlate = Math.max(1, _dv.dot(view.fwd));
    const dy = (_dv.dot(view.up) / (dPlate * view.t) - comp.plateY) * dPlate * view.t;
    let lo = 9, hi = -9, dSum = 0;
    for (const k of cast) {
      _dv.copy(k.mid).sub(view.pos);
      const d = Math.max(1, _dv.dot(view.fwd));
      const x = _dv.dot(view.right) / (d * view.t * SOLVE_ASPECT);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
      dSum += d;
    }
    const dCast = cast.length ? dSum / cast.length : dPlate;
    const dx = cast.length ? ((lo + hi) / 2 - comp.biasX) * dCast * view.t * SOLVE_ASPECT : 0;
    if (Math.abs(dx) < 0.02 && Math.abs(dy) < 0.02) break;
    view.pos.addScaledVector(view.right, dx).addScaledVector(view.up, dy);
  }
  return view;
}

/**
 * Cost of a candidate framing. Lower is better; the BAD-weighted terms are the ones §17.3
 * calls law, and no amount of good composition is allowed to buy its way past them.
 */
function score(cast, comp, view, fov, dist, pitchDeg, detail) {
  let cost = 0;
  let deep = -2;
  for (const k of cast) {
    const m = measureKid(k, view, _m);
    if (!m) { cost += BAD; continue; }
    // §17.4 asks for a stage with the whole cast on it, so leaving somebody out of frame is a
    // failure of the framing, not a clever way to dodge the size floor.
    const outX = Math.max(0, Math.abs(m.x) - 0.88);
    const outY = Math.max(0, m.yTop - 0.96, -0.97 - m.yBot);
    if (outX > 0 || outY > 0) cost += BAD * 0.9 * (outX + outY);
    if (m.pct < LIMIT.kidMin) cost += BAD * (LIMIT.kidMin - m.pct);
    if (m.pct > comp.softMaxPct) cost += 40 * (m.pct - comp.softMaxPct);
    if (k.lead) {
      if (m.pct > LIMIT.leadMax) cost += BAD * 0.5 * (m.pct - LIMIT.leadMax);
      // The lower half of the band is SATURATED on purpose. With a 42 ft mound the pitcher
      // cannot reach 18% at any legal lens, and an uncapped term chases that impossible pixel
      // until the camera is 190 units back at an 8° lens — which is exactly what the first cut
      // of this solver did. Capped, it still pulls the batter and catcher into band, then
      // stops arguing and lets composition win.
      cost += 46 * Math.min(Math.max(0, LIMIT.leadMin - m.pct), 2.5);
    }
    if (m.yTop > deep) deep = m.yTop;
    if (detail) detail.push({ name: k.name, pct: +m.pct.toFixed(1), x: +m.x.toFixed(2), y: +((m.yTop + m.yBot) / 2).toFixed(2), lead: k.lead });
  }
  cost += Math.abs(deep - comp.deepY) * 150;             // how much stage stands above the plate
  cost += Math.abs(fov - S.lens.fov) * comp.fovBias;
  cost += Math.abs(pitchDeg - comp.basePitch) * comp.pitchBias;
  cost += dist * 0.30;                                   // the smallest pull-back that is legal
  // world/surface.js paves the roadway back to z = -96. Stand off the end of your own set and
  // the frame starts showing the back of the block, so the camera is nudged to stay on it.
  if (view.pos.z < DECK_Z) cost += (DECK_Z - view.pos.z) * 8;
  if (fov > LIMIT.fovMax) cost += BAD * (fov - LIMIT.fovMax);
  return cost;
}

/**
 * Solve one framing.
 *
 * The contract in T.stage.framings fixes the two things that are taste — which way the camera
 * looks along the street, and what it is pointed at. This solves the three that are arithmetic:
 * how far back, how long a lens, and how far above.
 *
 * Elevation is in the search because of a piece of geometry worth knowing. Put the camera at
 * height Y = (g+C)·tanθ, aimed at the ground g units up-street from the plate, and a kid
 * standing at street position z measures
 *
 *       pct = 50 · h / (t · (z + K))        K = C + (g + C)·tan²θ,  t = tan(fov/2)
 *
 * — so the ONLY thing that flattens near against far is K, and raising the camera raises K
 * exactly as effectively as walking backwards does. A 14° camera 90 units back flattens the
 * street as hard as an 8° camera 130 units back, and only one of those is still standing on
 * the paved street we modelled. The lens then sets the absolute size, and the pitch sets how
 * much of the frame the cast stacks up through — which is why `deepY` is the knob that
 * actually chooses the elevation.
 */
function solveFraming(key, cast, plate) {
  const F = S.framings[key];
  const comp = COMPOSITION[key];
  const anchor = new THREE.Vector3(...F.look);
  const base = new THREE.Vector3(...F.look).sub(new THREE.Vector3(...F.pos)).normalize();
  const baseYaw = Math.atan2(base.x, base.z);
  const basePitch = Math.asin(-base.y) / RAD;
  comp.basePitch = basePitch;

  const view = new View();
  let best = null;

  const sweep = (pitches, fovs, dists, iters) => {
    for (const pitchDeg of pitches) {
      view.pos.set(0, 0, 0);
      view.setDirection(baseYaw, pitchDeg);
      for (const fov of fovs) {
        view.t = Math.tan(fov * RAD / 2);
        for (const dist of dists) {
          view.pos.copy(anchor).addScaledVector(view.fwd, -dist);
          compose(view, plate, cast, comp, iters);
          const c = score(cast, comp, view, fov, dist, pitchDeg, null);
          if (!best || c < best.cost) {
            best = { cost: c, fov, dist, pitchDeg, pos: view.pos.clone(), quat: view.quat.clone(), fwd: view.fwd.clone() };
          }
        }
      }
    }
  };

  const range = (a, b, step) => { const o = []; for (let v = a; v <= b + 1e-6; v += step) o.push(+v.toFixed(4)); return o; };
  const pLo = Math.max(5, basePitch - 4), pHi = Math.min(30, basePitch + 15);

  sweep(range(pLo, pHi, 2.5), range(LIMIT.fovMin, LIMIT.fovMax, 1.5), range(38, 236, 9), 3);
  const p0 = best.pitchDeg, f0 = best.fov, d0 = best.dist;
  sweep(range(Math.max(pLo, p0 - 2.5), Math.min(pHi, p0 + 2.5), 0.5),
        range(Math.max(LIMIT.fovMin, f0 - 1.6), Math.min(LIMIT.fovMax, f0 + 1.6), 0.2),
        range(Math.max(26, d0 - 10), d0 + 10, 1.5), 5);

  return {
    pos: best.pos, quat: best.quat, fwd: best.fwd,
    fov: best.fov, dist: best.dist, pitch: best.pitchDeg, cost: best.cost, anchor,
  };
}

/* ============================================================================
   THE SYSTEM
   ========================================================================= */

const EPS = 1e-4;                              // 0.01 units: below this the camera has not moved
const LIM_TILT = MOTION.tiltMaxDeg * RAD;      // the follow's hard stop, in radians

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
    this.leads = {};
    this.plate = new THREE.Vector3(0, 0.3, T.street.plateZ);
    this.framing = 'batting';
    this.pin = null;
    this.manual = false;
    this.applied = { pos: new THREE.Vector3(NaN, NaN, NaN), quat: new THREE.Quaternion(), fov: -1 };
    this.tilt = 0; this.tiltGoal = 0;
    this.pushT = -1;
    this.cutIn = -1; this.cutTo = null;
    this.wasPhase = '';
    this.solutions = null;
    this.followView = new View();

    this.resolve(app);
    this.cut('batting', true);
    this.wire();
  },

  /** Survey the street and solve both framings against what is actually standing in it. */
  resolve(app) {
    this.cast = surveyCast(app);
    this.leads = tagLeads(app, this.cast);
    // The composition hangs off a point halfway between the plate and the batter's chest, so
    // the shot stays about the at-bat rather than about whichever side of the plate he stands.
    const bat = this.leads.batter;
    this.plate.set(0, 0.3, T.street.plateZ);
    if (bat) this.plate.set(bat.mid.x * 0.5, 0.3, bat.mid.z);
    this.solutions = {
      batting: solveFraming('batting', this.cast, this.plate),
      field: solveFraming('field', this.cast, this.plate),
    };
    CAM.solved = this.solutions;
  },

  wire() {
    const goBat = () => { this.pushT = -1; this.cutIn = -1; this.cutTo = null; this.cut('batting'); };
    bus.on('atbat:begin', goBat);
    bus.on('pitch:thrown', () => { if (this.framing !== 'batting' && this.cutIn < 0) this.cut('batting'); });
    // Hold on the swing for the length of the hitstop, then cut. The ball is dead centre of the
    // FIELD framing when it arrives, so the eye is never sent looking for it.
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
    // Every scenario opens on BATTING. The framings themselves are solved once, at boot, off
    // the cast standing at its posts — re-solving per scenario would make the shot depend on
    // which scenario ran before it, and a framing that moves when you are not looking is not a
    // locked framing.
    this.framing = 'batting';
    CAM.framing = 'batting';
    // SNAPSHOT, DO NOT WRITE. Every system's onScenario hook has run by now, but the scenario's
    // own setup() has not, so this is the last moment the camera is unclaimed. Baselining here
    // instead of stamping our own transform is what lets somebody else's scenario keep its own
    // LENS as well as its own position: the lineup, the face sheet and the block tour set a
    // camera in setup() without setting a fov, and a director that had already written 10°
    // would leave them shot through a telephoto built for a street 120 units away.
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
      if (this.cutIn <= 0 && this.cutTo) { const to = this.cutTo; this.cutTo = null; this.cutIn = -1; this.cut(to); }
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
    if (this.detectManual(app)) return;
    this.write();
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

  /**
   * The single-axis follow (§17.4): tilt, in place, rate limited, and asleep the moment the
   * ball is comfortably inside the frame. Yaw is never touched, roll is never touched, the
   * camera never moves an inch, and when the ball dies the tilt walks home on its own.
   */
  followBall(dt, app) {
    const sim = app.sim;
    const live = sim && (sim.ball.inFlight || sim.ball.live) && sim.state.phase === 'in_play';
    let home = true;
    if (live && !this.pin) {
      const f = this.solutions[this.framing];
      const view = this.followView;
      view.pos.copy(f.pos);
      view.quat.copy(f.quat);
      _qx.setFromAxisAngle(_XAXIS, this.tilt);
      view.quat.multiply(_qx);                       // local X: pitch only, no roll, no yaw
      view.up.set(0, 1, 0).applyQuaternion(view.quat);
      view.right.set(1, 0, 0).applyQuaternion(view.quat);
      view.fwd.set(0, 0, -1).applyQuaternion(view.quat);
      view.t = Math.tan(f.fov * RAD / 2);
      const y = view.ndcY(sim.ball.pos);
      if (y != null && Math.abs(y) > MOTION.tiltDead) {
        // d(ndcY)/d(tilt) = −1/t: tilting the camera up pushes the image DOWN the frame, so a
        // ball that has climbed to +ndc is brought back by tilting up, i.e. by a positive step.
        const want = MOTION.tiltPark * Math.sign(y);
        const need = this.tilt + Math.atan((y - want) * view.t);
        // A towering fly is out of reach of any move we are allowed to make. Rather than sit
        // pinned at the stop with the whole cast off the bottom of the frame, the camera lets
        // it go and settles back onto the stage, where the chalk landing marker is already
        // drawing the answer on the ground (DESIGN-BIBLE §2.5).
        if (Math.abs(need) < LIM_TILT * MOTION.tiltGiveUp) { this.tiltGoal = need; home = false; }
      } else if (y != null) {
        home = false;                                // ball is in the box: hold, do not drift
        this.tiltGoal = this.tilt;
      }
    }
    if (home) this.tiltGoal = 0;
    this.tiltGoal = THREE.MathUtils.clamp(this.tiltGoal, -LIM_TILT, LIM_TILT);
    const tau = home ? MOTION.tiltHome : MOTION.tiltTau;
    let step = (this.tiltGoal - this.tilt) * (1 - Math.exp(-dt / tau));
    const cap = MOTION.tiltRateDeg * RAD * dt;
    this.tilt += THREE.MathUtils.clamp(step, -cap, cap);
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
      const u = THREE.MathUtils.clamp(this.pushT / MOTION.pushTime, 0, 1);
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

  /** Diagnostics for the harness — what the arbiter would measure, without booting the arbiter. */
  report(which) {
    const key = which || this.framing;
    const f = this.solutions?.[key];
    if (!f) return null;
    const view = new View();
    view.pos.copy(f.pos);
    view.quat.copy(f.quat);
    view.fwd.copy(f.fwd);
    view.right.set(1, 0, 0).applyQuaternion(f.quat);
    view.up.set(0, 1, 0).applyQuaternion(f.quat);
    view.t = Math.tan(f.fov * RAD / 2);
    const rows = [];
    score(this.cast, COMPOSITION[key], view, f.fov, f.dist, f.pitch, rows);
    rows.sort((a, b) => a.pct - b.pct);
    return {
      framing: key, fov: +f.fov.toFixed(2), dist: +f.dist.toFixed(1), pitch: +f.pitch.toFixed(1),
      pos: f.pos.toArray().map((v) => +v.toFixed(2)),
      kids: rows,
    };
  },
});

/* ============================================================================
   SCENARIOS — one per framing, so a critic can judge each on its own
   ========================================================================= */

function pin(name) {
  const sys = APP.get('cameras');
  if (!sys) return;
  sys.pin = name;
  CAM.pin = name;
  sys.cutIn = -1; sys.cutTo = null;
  sys.tilt = 0; sys.tiltGoal = 0;
  sys.pushT = -1;
  sys.cut(name, true);
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
    // framing with the thing it exists to keep on screen actually on screen — and so
    // tools/measure.mjs has a ball to hold against the 9 px floor in §17.3.
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

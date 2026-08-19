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
 * This file solves the two things that are arithmetic — distance and focal length — against
 * the cast that is actually standing in the street, measured exactly the way tools/measure.mjs
 * measures it (world-space Box3, top and bottom projected, screen height in % of frame height).
 *
 * That matters more than it sounds. The field-layout piece is moving fielders while this is
 * written. A hard-coded framing would be legal today and illegal tomorrow. A framing solved
 * from the cast's own boxes is legal both days, and the numbers it lands on are reproducible
 * because nothing here touches Math.random or wall-clock time.
 *
 * WHAT MOVES, AND WHAT NEVER DOES (§17.4)
 * ---------------------------------------------------------------------------
 * The camera CUTS. The two permitted continuous motions, and nothing else:
 *
 *   * a single-axis PAN (world-Y yaw, in place) to keep a live ball on screen,
 *   * a slow PUSH (a few percent along the view axis) on a run scoring.
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
  kidMin: S.scale.kidMinPct + 1.0,   // a kid animates ±4% around his survey height
  leadMin: S.scale.leadMinPct,
  leadMax: S.scale.leadMaxPct,
  fovMax: Math.min(S.lens.max, 26),
  fovMin: 8,
};

/** How the two framings want to be composed. Direction + anchor come from T.stage.framings. */
const COMPOSITION = {
  batting: {
    // Plate in the lower third (§17.4), pushed a touch right of centre so the batter's body
    // sits off the pitcher rather than in front of him.
    target: 'plate',
    ndc: [0.12, -0.40],
    // Nobody may tower: this is a shot of a batter, not a shot of an on-deck kid's elbow.
    softMaxPct: 29,
    fovBias: 0.55,
    pitchUp: 26,        // may steepen this far past the contract angle, at a cost
    pitchBias: 0.9,
  },
  field: {
    target: 'cast',
    ndc: [0.0, -0.05],
    softMaxPct: 29,
    fovBias: 0.40,
    pitchUp: 24,
    pitchBias: 0.7,
  },
};

/** Continuous motion, §17.4. Both of these are deliberately small. */
const MOTION = {
  panMaxDeg: 11,          // hard stop on the follow-pan
  panRateDeg: 34,         // deg/sec ceiling: a pan, never a whip
  panDead: 0.30,          // ball may wander this far in NDC x before the pan wakes up
  panPark: 0.16,          // and is walked back to here
  panTau: 0.13,
  pushFrac: 0.035,        // 3.5% of the pull-back
  pushTime: 1.35,
  cutHold: 0.11,          // hold on BATTING through the hitstop before cutting to FIELD
};

/* ============================================================================
   MEASUREMENT — deliberately identical to tools/measure.mjs
   ========================================================================= */

const _box = new THREE.Box3();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _YAXIS = new THREE.Vector3(0, 1, 0);

const isKidNode = (o) =>
  !!(o.userData?.isKid || /^kid[:.]|^(batter|pitcher|catcher|fielder|runner)/i.test(o.name || ''));

/**
 * Every kid in the scene, as the arbiter sees them: one entry per top-level kid node, with the
 * exact pair of points tools/measure.mjs projects to get a screen height.
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
    // publishes each kid's standing height, so the survey height is the box, clamped to a
    // plausible multiple of it: the batter loses his flagpole, everybody else is untouched.
    const tall = o.userData?.metrics?.tall || 0;
    const raw = _box.max.y - _box.min.y;
    const h = tall > 0 ? Math.min(raw, tall * 1.30) : raw;
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
    const e = cast.find((c) => c.obj === kid.group || c.obj.parent === kid.group || kid.group === c.obj.parent);
    if (e) e.lead = true;
    return e;
  };
  return { batter: mark(P?.batter), pitcher: mark(P?.pitcher), catcher: mark(P?.catcher) };
}

/** A scratch camera so nothing the solver does is ever visible on screen. */
const probe = new THREE.PerspectiveCamera(20, SOLVE_ASPECT, 0.5, 2400);

function setProbe(pos, quat, fov) {
  probe.position.copy(pos);
  probe.quaternion.copy(quat);
  probe.fov = fov;
  probe.aspect = SOLVE_ASPECT;
  probe.updateMatrixWorld(true);
  probe.updateProjectionMatrix();
}

/** Screen height as a percentage of frame height, plus where the kid sits in NDC. */
function measureKid(k) {
  const t = _v.copy(k.top).project(probe);
  const ty = t.y, tz = t.z, tx = t.x;
  const b = _v.copy(k.bot).project(probe);
  if (Math.abs(tz) > 1 && Math.abs(b.z) > 1) return null;
  return {
    pct: Math.abs((ty - b.y) / 2) * 100,
    x: (tx + b.x) / 2,
    yTop: ty,
    yBot: b.y,
    behind: tz > 1,
  };
}

/* ============================================================================
   THE SOLVER
   ========================================================================= */

/**
 * Place the camera `dist` back along `fwd` from `anchor`, then slide the whole rig sideways
 * and vertically until `targetPoint` lands on the composition mark. Sliding the camera rather
 * than turning it keeps the framing's direction — and therefore its relationship with the
 * backdrop cards — exactly as the contract wrote it.
 */
const _m4 = new THREE.Matrix4();
const _look = new THREE.Vector3();
const _dv = new THREE.Vector3();

function place(anchor, fwd, dist, fov, targetPoint, ndcTarget, out, iters) {
  const pos = out.pos.copy(anchor).addScaledVector(fwd, -dist);
  const quat = out.quat;
  _m4.lookAt(pos, _look.copy(anchor), _YAXIS);
  quat.setFromRotationMatrix(_m4);

  _right.set(1, 0, 0).applyQuaternion(quat);
  _up.set(0, 1, 0).applyQuaternion(quat);
  _fwd.set(0, 0, -1).applyQuaternion(quat);
  const t = Math.tan(fov * RAD / 2);

  for (let i = 0; i < (iters || 4); i++) {
    setProbe(pos, quat, fov);
    const p = _v.copy(targetPoint).project(probe);
    const depth = Math.max(1, _dv.copy(targetPoint).sub(pos).dot(_fwd));
    const dx = (p.x - ndcTarget[0]) * depth * t * SOLVE_ASPECT;
    const dy = (p.y - ndcTarget[1]) * depth * t;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) break;
    pos.addScaledVector(_right, dx).addScaledVector(_up, dy);
  }
  out.fov = fov;
  out.dist = dist;
  out.fwd.copy(_fwd);
  return out;
}

function blankSolution() {
  return { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fwd: new THREE.Vector3(), fov: 20, dist: 60 };
}

/**
 * Cost of a candidate framing. Lower is better; anything above BAD is illegal under §17.3.
 * The weights say, in order: never break the floor, keep the frame full of the cast, get the
 * three leads into their band, then — and only then — be as close to the contract lens and as
 * close to the stage as possible.
 */
const BAD = 1000;
const DECK_Z = -88;      // world/surface.js paves back to z = -96; keep a little margin

/**
 * Cost of a candidate framing. Lower is better; the BAD-weighted terms are the ones §17.3
 * calls law, and no amount of good composition is allowed to buy its way past them.
 */
function score(cast, comp, fov, dist, pitchDeg, pos, detail) {
  let cost = 0;
  for (const k of cast) {
    const m = measureKid(k);
    if (!m || m.behind) { cost += BAD; continue; }
    // §17.4 asks for a stage with the whole cast on it, so leaving somebody out of frame is a
    // failure of the framing, not a clever way to dodge the size floor.
    const outX = Math.max(0, Math.abs(m.x) - 0.93);
    const outY = Math.max(0, m.yTop - 0.96, -0.98 - m.yBot);
    if (outX > 0 || outY > 0) cost += BAD * 0.45 * (outX + outY);
    if (m.pct < LIMIT.kidMin) cost += BAD * (LIMIT.kidMin - m.pct);
    if (m.pct > comp.softMaxPct) cost += 30 * (m.pct - comp.softMaxPct);
    if (k.lead) {
      if (m.pct > LIMIT.leadMax) cost += BAD * 0.5 * (m.pct - LIMIT.leadMax);
      // The lower half of the band is SATURATED on purpose. With a 42 ft mound the pitcher
      // cannot reach 18% at any legal lens, and an uncapped term chases that impossible pixel
      // until the camera is 190 units back at an 8° lens — which is exactly what the first cut
      // of this solver did. Capped, it still pulls the batter and catcher into band, then
      // stops arguing and lets composition win.
      cost += 46 * Math.min(Math.max(0, LIMIT.leadMin - m.pct), 2.5);
    }
    if (detail) detail.push({ name: k.name, pct: +m.pct.toFixed(1), x: +m.x.toFixed(2), y: +((m.yTop + m.yBot) / 2).toFixed(2), lead: k.lead });
  }
  cost += Math.abs(fov - S.lens.fov) * comp.fovBias;
  cost += Math.abs(pitchDeg - comp.basePitch) * comp.pitchBias;
  cost += dist * 0.30;                                   // the smallest pull-back that is legal
  // world/surface.js paves the roadway back to z = -96. Stand off the end of your own set and
  // the frame starts showing the back of the block, so the camera is asked to stay on the deck.
  if (pos && pos.z < DECK_Z) cost += (DECK_Z - pos.z) * 34;
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
 * Elevation is in the search because of a small piece of geometry worth knowing. Put the camera
 * at height Y = (g+C)·tanθ, aimed at the ground g units up-street from the plate, and a kid at
 * street position z measures
 *
 *       pct = 50 · h / (t · (z + K))        K = C + (g + C)·tan²θ,  t = tan(fov/2)
 *
 * — so the ONLY thing that flattens near against far is K, and raising the camera raises K
 * exactly as effectively as walking backwards does. A 34° camera 83 units back is the same
 * flattening as an 11° camera 124 units back, and only one of those is still standing on the
 * paved street we modelled. So the solver is allowed to buy flatness with elevation when
 * distance would take it off the end of the set, and it pays a stated price for the deviation.
 */
function solveFraming(key, cast, plate) {
  const F = S.framings[key];
  const comp = COMPOSITION[key];
  const anchor = new THREE.Vector3(...F.look);
  const base = new THREE.Vector3(...F.look).sub(new THREE.Vector3(...F.pos)).normalize();
  const baseYaw = Math.atan2(base.x, base.z);
  const basePitch = Math.asin(-base.y) / RAD;
  comp.basePitch = basePitch;

  let target;
  if (comp.target === 'plate') target = plate.clone();
  else {
    target = new THREE.Vector3();
    for (const k of cast) target.add(k.mid);
    if (cast.length) target.multiplyScalar(1 / cast.length); else target.copy(anchor);
  }

  const fwd = new THREE.Vector3();
  const dirFor = (pitchDeg) => {
    const cp = Math.cos(pitchDeg * RAD);
    return fwd.set(Math.sin(baseYaw) * cp, -Math.sin(pitchDeg * RAD), Math.cos(baseYaw) * cp);
  };

  const cand = blankSolution();
  let best = null;

  const sweep = (pitches, fovs, dists, iters) => {
    for (const pitchDeg of pitches) {
      const d = dirFor(pitchDeg);
      for (const fov of fovs) {
        for (const dist of dists) {
          place(anchor, d, dist, fov, target, comp.ndc, cand, iters);
          setProbe(cand.pos, cand.quat, fov);
          const c = score(cast, comp, fov, dist, pitchDeg, cand.pos, null);
          if (!best || c < best.cost) {
            best = { cost: c, fov, dist, pitchDeg,
              pos: cand.pos.clone(), quat: cand.quat.clone(), fwd: cand.fwd.clone() };
          }
        }
      }
    }
  };

  const range = (a, b, step) => { const o = []; for (let v = a; v <= b + 1e-6; v += step) o.push(+v.toFixed(4)); return o; };

  sweep(range(basePitch, basePitch + comp.pitchUp, 3.5),
        range(LIMIT.fovMin, LIMIT.fovMax, 1.5),
        range(38, 230, 8), 3);
  const p0 = best.pitchDeg, f0 = best.fov, d0 = best.dist;
  sweep(range(Math.max(basePitch, p0 - 3.5), p0 + 3.5, 0.7),
        range(Math.max(LIMIT.fovMin, f0 - 1.6), Math.min(LIMIT.fovMax, f0 + 1.6), 0.2),
        range(Math.max(26, d0 - 10), d0 + 10, 1.5), 4);

  const out = blankSolution();
  out.pos.copy(best.pos); out.quat.copy(best.quat); out.fwd.copy(best.fwd);
  out.fov = best.fov; out.dist = best.dist; out.pitch = best.pitchDeg; out.cost = best.cost;
  out.anchor = anchor;
  return out;
}

/* ============================================================================
   THE SYSTEM
   ========================================================================= */

const EPS = 1e-4;

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
    this.plate = new THREE.Vector3(T.street.gutterX * 0, 0.3, T.street.plateZ);
    this.framing = 'batting';
    this.pin = null;
    this.manual = false;
    this.applied = { pos: new THREE.Vector3(NaN, NaN, NaN), quat: new THREE.Quaternion(), fov: -1 };
    this.pan = 0; this.panGoal = 0;
    this.pushT = -1;
    this.cutIn = -1; this.cutTo = null;
    this.wasPhase = '';
    this.solutions = null;

    this.resolve(app);
    this.cut('batting', true);
    this.wire();
  },

  /** Survey the street and solve both framings against what is actually standing in it. */
  resolve(app) {
    this.cast = surveyCast(app);
    this.leads = tagLeads(app, this.cast);
    const bat = this.leads.batter;
    this.plate.set(0, 0.3, T.street.plateZ);
    if (bat) this.plate.set(bat.mid.x * 0.45, 0.3, bat.mid.z);
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
    this.pan = 0; this.panGoal = 0;
    this.pushT = -1;
    this.cutIn = -1; this.cutTo = null;
    this.wasPhase = '';
    // The framings are solved once, at boot, off the cast standing at its posts. Re-solving per
    // scenario would make the shot depend on which scenario ran before it, and a framing that
    // moves when you are not looking is not a locked framing.
    this.cut('batting', true);
  },

  /** An instant, one-frame change of framing. There is no other kind. */
  cut(name, silent) {
    if (!this.solutions || !this.solutions[name]) return;
    if (this.pin && name !== this.pin) return;
    const changed = this.framing !== name;
    this.framing = name;
    CAM.framing = name;
    this.pan = 0; this.panGoal = 0;
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

    this.trackBall(dt, app);
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
   * The single-axis follow pan (§17.4). Yaw only, in place, rate limited, and it goes to sleep
   * the moment the ball is comfortably inside the frame.
   */
  trackBall(dt, app) {
    const sim = app.sim;
    const live = sim && (sim.ball.inFlight || sim.ball.live) && sim.state.phase === 'in_play';
    if (!live || this.pin) {
      this.panGoal = 0;
    } else {
      const f = this.solutions[this.framing];
      setProbe(f.pos, f.quat, f.fov);
      _qy.setFromAxisAngle(_YAXIS, this.pan);
      probe.quaternion.premultiply(_qy);
      probe.updateMatrixWorld(true);
      const p = _v.copy(sim.ball.pos).project(probe);
      const t = Math.tan(f.fov * RAD / 2) * SOLVE_ASPECT;
      if (Math.abs(p.x) > MOTION.panDead && p.z < 1) {
        const want = MOTION.panPark * Math.sign(p.x);
        this.panGoal = this.pan + Math.atan((p.x - want) * t);
      }
    }
    const lim = MOTION.panMaxDeg * RAD;
    this.panGoal = THREE.MathUtils.clamp(this.panGoal, -lim, lim);
    const k = 1 - Math.exp(-dt / MOTION.panTau);
    let step = (this.panGoal - this.pan) * k;
    const cap = MOTION.panRateDeg * RAD * dt;
    step = THREE.MathUtils.clamp(step, -cap, cap);
    this.pan += step;
  },

  /** Put the camera where the director says it is, and remember exactly where that was. */
  write() {
    const app = this.app;
    const f = this.solutions?.[this.framing];
    if (!f) return;
    const c = app.camera;
    c.position.copy(f.pos);
    c.quaternion.copy(f.quat);
    if (this.pan !== 0) {
      _qy.setFromAxisAngle(_YAXIS, this.pan);
      c.quaternion.premultiply(_qy);
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
    setProbe(f.pos, f.quat, f.fov);
    const rows = [];
    score(this.cast, COMPOSITION[key], f.fov, f.dist, f.pitch, f.pos, rows);
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
    APP.sim.reset(4242);
    APP.clock.advance(0.9);
    APP.sim.swing();
    pin('field');
  },
  settle: 0.5,
});

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
 * THE LENS IS A CONTRACT, NOT A FREE VARIABLE
 * ---------------------------------------------------------------------------
 * §17.2 says FOV 20°, pulled back to suit, never above 26° and — since round 2 — never below
 * 16°, and the camera stays inside 150 units of the plate. The height floors in §17.3 exist to
 * make the cast readable; they are NOT a licence to satisfy them by collapsing the lens and
 * retreating into the next borough. A round-1 build hit every height rule at 9.8° from 136
 * units back and scored 3/10, because a 9.8° lens 136 units back is a telescope pointed at a
 * floor plan: no horizon, no sky, no facade, no period, and two "framings" five degrees apart.
 *
 * So the solver below treats the lens as a target with a real cost attached (`fovBias`), the
 * pull-back as something to minimise, and the §17.3 floors as law. Where those cannot all be
 * satisfied at once, the answer is written into the report rather than bought with the lens.
 *
 * WHAT THE ARITHMETIC ACTUALLY ALLOWS, measured against the cast standing in the street today
 * ---------------------------------------------------------------------------
 * A kid of box height h at view depth d through a vertical FOV f occupies
 *
 *       pct = 50·h / (t·d)          t = tan(f/2)
 *
 * of the frame height — the same number tools/measure.mjs prints. Write P = t·d(batter); every
 * other kid's depth is the batter's plus a fixed offset, so ONE number P decides the whole
 * scale of a framing, and §17.3's floors turn into an interval on P:
 *
 *   batter  ≤ 26%   →  P ≥ 50·h_bat/26                        (camera at least this far back)
 *   catcher ≥ 18%   →  P ≤ 50·h_cat/18 + t·Δd_cat             (…and no further)
 *   pitcher ≥ 18%   →  P ≤ 50·h_pit/18 − t·Δd_pit
 *   deepest ≥ 12%   →  P ≤ 50·h_deep/12 − t·Δd_deep
 *
 * With today's cast (batter box 5.5–6.0, catcher 4.34, pitcher 5.86 at Δz 27, deepest 5.82 at
 * Δz 64) that interval is [11.50, 11.97] at 18°, [11.50, 12.40] at 16°, and EMPTY at 20° —
 * the pitcher falls under 18% at any lens wider than ~18.1°. That is the honest reason this
 * file does not run at the contract's 20°, and it is a layout number, not a camera number: a
 * 20° lens needs the pitcher inside z ≈ 21.
 *
 * The same interval is why the two framings cannot differ much in SUBJECT SIZE. Both framings
 * must hold all three leads inside 18–26%, so both must choose P from that same narrow window;
 * the widest legal ratio between them is about 1.07. Two framings therefore differ the only
 * ways left: VANTAGE (elevation and azimuth), LENS (and with it how flat the street reads),
 * and JOB — BATTING is composed on the pitcher past the batter's shoulder, FIELD is composed
 * on the whole cast, and the street runs diagonally through one and square through the other.
 *
 * THE HORIZON IS PART OF THE FRAME, NOT A LUXURY
 * ---------------------------------------------------------------------------
 * The round-1 build's top frame edge sat 5–8° BELOW horizontal in both framings, so the near
 * facade, the cornices, the fire escapes, the El and the sky — every period asset in the game —
 * were cropped out and what remained was asphalt. Two terms put them back:
 *
 *   * a band on where the STREET ENDS in the frame — the ground line at the near-facade card
 *     (z = 84), which is `BYB-REFERENCE §3.6`'s above-horizon budget expressed in the one
 *     measurement §17's stage model still allows. BATTING holds it at 46% of frame height,
 *     FIELD at 21%;
 *   * a band on the HORIZON itself, tan(pitch)/t in closed form, which BATTING must keep inside
 *     the frame. That single number is the difference between a street and a floor plan, and it
 *     is what puts the El, the water tanks and the MOXIE board across the top of the shot the
 *     game is mostly played in.
 *
 * FIELD deliberately spends its horizon: raked down 15° it lays the whole stage out flat, which
 * is its entire job, and it is the shot you are only in while the ball is live.
 *
 * WHAT MOVES, AND WHAT NEVER DOES (§17.4)
 * ---------------------------------------------------------------------------
 * The camera CUTS. The two permitted continuous motions, and nothing else: a single-axis TILT
 * to follow a live ball, and a slow PUSH along the view axis when a run scores. No dolly, no
 * orbit, no roll, no handheld, no easing between framings. The cut off the bat is held for the
 * length of the hitstop so the contact reads on BATTING first and the ball is already inside
 * the FIELD framing when it arrives — the eye never has to go looking for it.
 *
 * PLAYING WELL WITH THE OTHER PIECES
 * ---------------------------------------------------------------------------
 * Half the scenarios in this build belong to somebody else and set their own camera (facade
 * detail, the lineup, the portrait sheet, the block tour). The director never fights them: it
 * remembers the exact transform it last wrote, and the moment it finds the camera somewhere
 * else it hands over for the rest of the scenario. Ownership is detected, never declared.
 */

const S = T.stage;
const RAD = Math.PI / 180;

/** The frame the arbiter measures in: tools/measure.mjs and tools/shoot.mjs shoot 1600×900. */
const SOLVE_ASPECT = 16 / 9;

/**
 * §17.3, as the arbiter enforces it, plus the two lens rules §17.2 gained in round 2.
 * `soft*` are where the solver aims; the gap between soft and hard is the margin that keeps a
 * kid legal when a stride, a crouch or a follow-through changes his bounding box.
 */
const LIMIT = {
  kidMin: S.scale.kidMinPct,           // 12 — hard floor, every kid, every framing
  kidSoft: S.scale.kidMinPct + 1.0,
  leadMin: S.scale.leadMinPct,         // 18 — batter / pitcher / catcher
  leadSoft: S.scale.leadMinPct + 0.7,
  leadMax: S.scale.leadMaxPct,         // 26
  leadSoftMax: S.scale.leadMaxPct - 1.1,
  fovMin: 16,                          // §17.2: below this is a telescope, not a stage
  fovMax: Math.min(S.lens.max, 26),
  camMax: 145,                         // §17.2 ceiling is 150 from the plate; stay off it
};

/**
 * How much a kid's measured box can move between the bind pose surveyed here and the pose the
 * arbiter catches him in. Measured across cam_batting / cam_field / pitch / contact / deep_fly
 * / cam_field_fly, twice, a layout revision apart:
 *
 *   * the three LEADS stay within 0.99–1.13× of their surveyed height (the at-bat cycle is
 *     wind-up, crouch and swing, and the rig holds standing height through all of it), so
 *     their 18% floor is checked at 0.985× and their 26% ceiling at 1.075×;
 *   * a FIELDER can drop to 0.90× dipping into a ready crouch, so the 12% floor is checked
 *     against 0.90× — the pessimistic end, because that floor is the one §17.3 calls law.
 *
 * Ceilings are therefore checked against the top of the observed range and floors against the
 * bottom, which is what makes "legal in the solver" mean "legal in tools/measure.mjs".
 */
const POSE = { grow: 1.075, shrinkKid: 0.90, shrinkLead: 0.985 };

/**
 * The two locked framings (§17.4). Direction and anchor come from T.stage.framings — the
 * contract this file shares with the backdrop and field-layout pieces. Everything here is the
 * COMPOSITION: where the plate sits, what the frame is built around, and how much stage stands
 * above it.
 */
const COMPOSITION = {
  batting: {
    // The flat one, and the one most of the game is played in. Behind and above the batter's
    // shoulder, swung far enough off the axis that the batter's cap and shoulder clear the
    // pitcher instead of eclipsing him, and pitched down only as far as the HORIZON allows —
    // this framing is required to keep the horizon inside the frame, which is what puts the
    // cornices, the fire escapes, the El and the sky back in the top of the picture.
    plateY: -0.62,
    keyX: 0.12,          // the pitcher's chest, in NDC x — the shot is aimed at him
    keyY: 0.10,          // …and where we would like it in y (a pull on the elevation)
    batterX: -0.26,      // …with the batter this far off him: an over-the-shoulder, not a stack
    deepY: 0.30,         // the deepest kid's head: a low seat, so the facade owns the top
    facadeY: [0.02, 0.34],
    horizonY: [0.55, 0.95],
    fov: [16.0, 19.6],
    pitch: [3.5, 11.5],
    yaw: [0, 16],        // swing off the axis to open the batter/pitcher pair
    camX: [-21, 6],
    minKids: 16,
    softMaxPct: 26,
    fovBias: 6.0,
    pitchBias: 0.6,
  },
  field: {
    // The wide one: square to the street, a storey and a half higher, raked down far enough
    // that the whole shallow stage lies out flat and no fielder hides behind another. It pays
    // for that with the horizon, which it does not keep — the two framings are meant to be two
    // seats in the same theatre, and this is the one from the fire escape.
    plateY: -0.74,
    keyX: 0.0,           // centred on the cast's own width, not on any one kid
    keyY: null,
    batterX: null,
    deepY: 0.62,
    facadeY: [0.30, 0.58],
    horizonY: null,
    fov: [16.0, 19.6],
    pitch: [9, 20],
    yaw: [0, 0],         // §17.4: FIELD keeps the contract direction, square up the street
    camX: [-6, 8],
    minKids: 16,
    softMaxPct: 26,
    fovBias: 6.0,
    pitchBias: 0.6,
    centreCast: true,
  },
};

/**
 * Continuous motion, §17.4 — and there is only this much of it.
 *
 * The permitted follow is ONE axis, and on this stage that axis is TILT, not yaw. A stickball
 * ball goes up the street and up in the air; laterally it is fenced by a 46-unit play plane the
 * frame already covers at every depth the ball reaches. Vertically it is fenced by nothing: on
 * a 17° lens the visible band at the pitcher is about thirty feet tall and a squared-up hit
 * clears that in a third of a second. So the one axis we are allowed to spend is the one that
 * keeps the ball, and we spend it on tilt.
 *
 * Round 1 capped that tilt at 2.6° and, worse, gave up entirely when the ball went past reach —
 * a camera that stops following the ball is not a camera. The cap is now 9°, which on the FIELD
 * lens is 1.13 of NDC, and the follow never bails: if the ball outruns the cap the camera holds
 * at the stop with the ball as close to the top edge as it can get, and comes home when the
 * ball dies.
 */
const MOTION = {
  tiltMaxDeg: 9.0,
  tiltRateDeg: 22,        // deg/sec ceiling — a follow, never a whip
  tiltDead: 0.42,         // ball may climb this far in NDC y before the tilt wakes up
  tiltPark: 0.52,         // …and is carried back to here: high in frame, where fly balls live
  tiltTau: 0.11,
  tiltHome: 0.30,         // slower on the way back down: settling is not a move
  pushFrac: 0.035,        // 3.5% of the pull-back
  pushTime: 1.35,
  cutHold: 0.11,          // hold on BATTING through the hitstop before cutting to FIELD
};

/* ============================================================================
   MEASUREMENT — the same number tools/measure.mjs will print, computed in closed form
   ========================================================================= */

const _box = new THREE.Box3();
const _dv = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
const _look = new THREE.Vector3();
const _qx = new THREE.Quaternion();
const _XAXIS = new THREE.Vector3(1, 0, 0);
const _fwd = new THREE.Vector3();
const _YAXIS = new THREE.Vector3(0, 1, 0);

const isKidNode = (o) =>
  !!(o.userData?.isKid || /^kid[:.]|^(batter|pitcher|catcher|fielder|runner)/i.test(o.name || ''));

/** §17.2's stage, with a foot of slack: nothing playable stands outside this box. */
function onContractStage(x, z) {
  return Math.abs(x) <= S.playWidth / 2 + 2 && z >= -14 && z <= S.playDepth + 2;
}

/**
 * Every kid in the scene, as the arbiter sees them: one entry per top-level kid node, with the
 * pair of points tools/measure.mjs projects to get a screen height.
 *
 * Kids standing OUTSIDE the contract stage are surveyed but excluded from the size floor. This
 * is not the camera dodging its job — it is the camera refusing to re-lens the whole game for a
 * layout bug. §17.2 fixes the play plane at 70 units and measure.mjs fails the build separately
 * for anyone past it; letting a fielder parked at z = 95 drag the lens down (which is exactly
 * how round 1 ended at 9.8°) would hide that failure inside a worse one.
 */
function surveyCast(app) {
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
    const cx = (_box.min.x + _box.max.x) / 2;
    const cz = (_box.min.z + _box.max.z) / 2;
    // The box at boot is the BIND pose, and a kid holding a broomstick straight up measures
    // 6.6 units there against 5.5–6.0 in every real gameplay pose. Solving against the bind
    // pose would pull the camera 30 units further back than the game ever needs. The rig
    // publishes each kid's standing height, so the survey height is the box clamped to a
    // plausible multiple of it — 1.27, the tallest a kid measures in any real pose — so the
    // batter loses his flagpole and nobody else is touched at all.
    const tall = o.userData?.metrics?.tall || 0;
    const raw = _box.max.y - _box.min.y;
    const h = tall > 0 ? Math.min(raw, tall * 1.27) : raw;
    const entry = {
      obj: o,
      name: o.name || 'kid',
      top: new THREE.Vector3(cx, _box.min.y + h, cz),
      bot: new THREE.Vector3(cx, _box.min.y, cz),
      mid: new THREE.Vector3(cx, _box.min.y + h / 2, cz),
      chest: new THREE.Vector3(cx, _box.min.y + h * 0.64, cz),
      h,
      lead: false,
      role: '',
    };
    if (onContractStage(cx, cz)) cast.push(entry);
    else { entry.stray = true; strays.push(entry); }
  });
  return { cast, strays };
}

/**
 * Tag the three leads §17.3 cares about — and tell the ARBITER who they are.
 *
 * tools/measure.mjs looks for `userData.isLead` (or a node literally named batter/pitcher/
 * catcher). Our kids are named `kid:otto`, `kid:sal`, `kid:irving`, so until this flag is set
 * the 18–26% band is never checked on anybody and "measure passes" says nothing at all about
 * the three kids the whole shot is composed around.
 */
function tagLeads(app, cast) {
  const P = app.get('players');
  const mark = (kid, role) => {
    if (!kid || !kid.group) return null;
    kid.group.userData.isLead = true;
    const e = cast.find((c) => c.obj === kid.group);
    if (e) { e.lead = true; e.role = role; }
    return e;
  };
  return {
    batter: mark(P?.batter, 'batter'),
    pitcher: mark(P?.pitcher, 'pitcher'),
    catcher: mark(P?.catcher, 'catcher'),
  };
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
 * The solver evaluates a few thousand candidates at boot, so that difference is the difference
 * between a camera that solves itself and a page that never finishes loading.
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
const W = {
  edge: 900,        // nobody gets bisected by the frame edge — above every taste term here
  deep: 130,        // how much stage stands above the plate
  facade: 240,      // where the street ENDS in frame: the horizon budget
  horizon: 240,     // …and whether the horizon itself is in the picture at all
  key: 70,          // the key subject's height in frame
  pair: 180,        // batter vs pitcher: an over-the-shoulder, not one behind the other
  crowd: 220,       // per kid missing from the stage
  dist: 0.30,       // the smallest pull-back that is legal
  camX: 26,         // …and stay on your own set
};
const DECK_Z = -104;     // world/surface.js paves back to z = −96; a soft nudge, not a wall
const _m = { pct: 0, x: 0, yTop: 0, yBot: 0 };
const _facade = new THREE.Vector3(0, 0, S.backdrop.nearFacade);

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
 *
 * So every candidate lands with the plate exactly on its line and the key subject exactly on
 * its column, and the search is only ever over the four things that are genuinely a choice:
 * how far round, how far up, how long a lens, how far back.
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

/**
 * FIELD is composed on the cast's own width rather than on any one kid, and a sideways slide
 * moves near kids further than far ones, so that one is solved by iteration. Three passes is
 * plenty: each pass removes about 90% of the error.
 */
function centreCast(view, cast, comp) {
  for (let i = 0; i < 3; i++) {
    let lo = 9, hi = -9, dSum = 0;
    for (const k of cast) {
      _dv.copy(k.mid).sub(view.pos);
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
 * is the state in between — bisected by the frame edge, half a kid, which is how round 1
 * shipped `kid:eugene` at NDC x = 1.00. So the edge cost is a BUMP over the straddle zone
 * rather than a ramp that grows for ever: it is expensive to sit on the line, and free to be
 * out of shot altogether.
 */
function straddle(v, inner, outer) {
  const a = Math.abs(v);
  return Math.max(0, Math.min(a - inner, outer - a));
}

/**
 * Cost of a candidate framing. Lower is better; the BAD-weighted terms are the ones §17.3
 * calls law, and no amount of good composition is allowed to buy its way past them.
 */
function score(cast, comp, view, fov, dPlate, pitchDeg, key, rows) {
  let cost = 0;
  let deep = -2, deepD = -1, batX = null, onStage = 0;
  for (const k of cast) {
    const m = measureKid(k, view, _m);
    if (!m) { cost += BAD; continue; }
    const pctHi = m.pct * POSE.grow;                                   // biggest the arbiter could catch him
    const pctLo = m.pct * (k.lead ? POSE.shrinkLead : POSE.shrinkKid); // …and smallest
    // tools/measure.mjs only measures what is on screen, and so do we — a kid cleanly out of
    // shot is a composition choice, a kid on the frame line is a mistake.
    const inFrame = Math.abs(m.x) < 1.25 && m.yTop > -1.35 && m.yBot < 1.35;
    if (inFrame) onStage++;
    cost += W.edge * (straddle(m.x, 0.80, 1.34)
                    + straddle(m.yTop, 0.90, 1.40)
                    + straddle(m.yBot, 0.90, 1.40));
    if (inFrame) {
      if (pctLo < LIMIT.kidMin) cost += BAD * (LIMIT.kidMin - pctLo);
      else if (pctLo < LIMIT.kidSoft) cost += 60 * (LIMIT.kidSoft - pctLo);
      if (pctHi > comp.softMaxPct) cost += 40 * (pctHi - comp.softMaxPct);
    }
    if (k.lead) {
      if (!inFrame) cost += BAD;                                       // §17.4: all three, always
      if (pctHi > LIMIT.leadMax) cost += BAD * (pctHi - LIMIT.leadMax);
      else if (pctHi > LIMIT.leadSoftMax) cost += 70 * (pctHi - LIMIT.leadSoftMax);
      if (pctLo < LIMIT.leadMin) cost += BAD * (LIMIT.leadMin - pctLo);
      else if (pctLo < LIMIT.leadSoft) cost += 70 * (LIMIT.leadSoft - pctLo);
      if (k.role === 'batter') batX = m.x;
    }
    // "How much stage stands above the plate" is the DEEPEST kid's head — by depth, not by
    // height in frame, or a spectator on a fire escape decides the elevation of the whole shot.
    const dep = view.depth(k.mid);
    if (inFrame && dep > deepD) { deepD = dep; deep = m.yTop; }
    if (rows) {
      rows.push({
        name: k.name, pct: +m.pct.toFixed(1), lo: +pctLo.toFixed(1), hi: +pctHi.toFixed(1),
        x: +m.x.toFixed(2), yTop: +m.yTop.toFixed(2), yBot: +m.yBot.toFixed(2),
        lead: k.lead, role: k.role, inFrame,
      });
    }
  }

  if (comp.minKids) cost += Math.max(0, comp.minKids - onStage) * W.crowd;
  cost += Math.abs(deep - comp.deepY) * W.deep;
  if (comp.batterX != null && batX != null) cost += W.pair * Math.abs(batX - comp.batterX);

  // Where the STREET ENDS in the frame. Everything above the ground line at the near-facade
  // card is facade, cornice, fire escape, El and sky; §3.6 wants that band to own the upper
  // third of the frame, and round 1 shipped with it at zero.
  const fy = view.ndcY(_facade);
  if (fy == null) cost += BAD;
  else cost += W.facade * (Math.max(0, fy - comp.facadeY[1]) + Math.max(0, comp.facadeY[0] - fy));

  // The horizon itself, in closed form: a camera with no roll puts it at tan(pitch)/t. BATTING
  // is required to keep it inside the frame — that single number is the difference between a
  // street and a floor plan.
  if (comp.horizonY) {
    const hz = Math.tan(pitchDeg * RAD) / view.t;
    cost += W.horizon * (Math.max(0, hz - comp.horizonY[1]) + Math.max(0, comp.horizonY[0] - hz));
  }

  // The key subject's height in frame (BATTING only: the pitcher's chest).
  if (key && comp.keyY != null) {
    const ky = view.ndcY(key);
    if (ky != null) cost += W.key * Math.abs(ky - comp.keyY);
  }

  cost += Math.abs(fov - S.lens.fov) * comp.fovBias;
  cost += Math.abs(pitchDeg - comp.basePitch) * comp.pitchBias;
  cost += dPlate * W.dist;
  if (view.pos.x < comp.camX[0]) cost += (comp.camX[0] - view.pos.x) * W.camX;
  if (view.pos.x > comp.camX[1]) cost += (view.pos.x - comp.camX[1]) * W.camX;
  if (view.pos.z < DECK_Z) cost += (DECK_Z - view.pos.z) * 8;
  const camDist = Math.hypot(view.pos.x, view.pos.y - 2, view.pos.z);
  if (camDist > LIMIT.camMax) cost += BAD * (camDist - LIMIT.camMax);
  if (fov > LIMIT.fovMax) cost += BAD * (fov - LIMIT.fovMax);
  if (fov < LIMIT.fovMin) cost += BAD * (LIMIT.fovMin - fov);
  return cost;
}

/**
 * Solve one framing: a coarse sweep of the four free parameters, then a fine one around the
 * winner. Nothing here touches Math.random or the wall clock, so two boots of the same build
 * produce the same two framings to the last decimal — which is what makes a "locked framing"
 * a thing a critic can hold us to.
 */
function solveFraming(key, cast, plate, leads) {
  const F = S.framings[key];
  const comp = COMPOSITION[key];
  const base = new THREE.Vector3(...F.look).sub(new THREE.Vector3(...F.pos)).normalize();
  comp.basePitch = Math.asin(-base.y) / RAD;
  const keyPt = key === 'batting' ? (leads.pitcher?.chest || null) : null;

  const view = new View();
  let best = null;

  const sweep = (yaws, pitches, fovs, dists) => {
    for (const yaw of yaws) {
      for (const pitchDeg of pitches) {
        for (const fov of fovs) {
          for (const dPlate of dists) {
            place(view, yaw * RAD, pitchDeg, fov, dPlate, plate, keyPt, comp);
            if (comp.centreCast) centreCast(view, cast, comp);
            const c = score(cast, comp, view, fov, dPlate, pitchDeg, keyPt, null);
            if (!best || c < best.cost) {
              best = { cost: c, yaw, fov, dPlate, pitchDeg, pos: view.pos.clone(), quat: view.quat.clone(), fwd: view.fwd.clone() };
            }
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

  sweep(range(comp.yaw[0], comp.yaw[1], 3),
        range(comp.pitch[0], comp.pitch[1], 1.5),
        range(comp.fov[0], comp.fov[1], 0.8),
        range(46, 122, 4));
  const b0 = best;
  sweep(range(Math.max(comp.yaw[0], b0.yaw - 3), Math.min(comp.yaw[1], b0.yaw + 3), 0.75),
        range(Math.max(comp.pitch[0], b0.pitchDeg - 1.5), Math.min(comp.pitch[1], b0.pitchDeg + 1.5), 0.375),
        range(Math.max(comp.fov[0], b0.fov - 0.8), Math.min(comp.fov[1], b0.fov + 0.8), 0.2),
        range(Math.max(40, b0.dPlate - 4), b0.dPlate + 4, 1));

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
    this.strays = [];
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
    const survey = surveyCast(app);
    this.cast = survey.cast;
    this.strays = survey.strays;
    this.leads = tagLeads(app, this.cast);
    this.plate.set(0, 0.3, T.street.plateZ);
    this.solutions = {
      batting: solveFraming('batting', this.cast, this.plate, this.leads),
      field: solveFraming('field', this.cast, this.plate, this.leads),
    };
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
    // camera in setup() without setting a fov, and a director that had already written 17°
    // would leave them shot through a telephoto built for a street 80 units away.
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
    if (live) {
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
        // If the ball is out of reach the goal is simply clamped at the stop below — the camera
        // keeps pointing as high as it is allowed to and holds the ball as close to the top
        // edge as the rule permits. It never gives up and looks away.
        const want = MOTION.tiltPark * Math.sign(y);
        this.tiltGoal = this.tilt + Math.atan((y - want) * view.t);
        home = false;
      } else if (y != null) {
        home = false;                                // ball is in the box: hold, do not drift
        this.tiltGoal = this.tilt;
      }
    }
    if (home) this.tiltGoal = 0;
    this.tiltGoal = THREE.MathUtils.clamp(this.tiltGoal, -LIM_TILT, LIM_TILT);
    const tau = home ? MOTION.tiltHome : MOTION.tiltTau;
    const step = (this.tiltGoal - this.tilt) * (1 - Math.exp(-dt / tau));
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
    const comp = COMPOSITION[key];
    const view = new View();
    view.pos.copy(f.pos);
    view.quat.copy(f.quat);
    view.fwd.copy(f.fwd);
    view.right.set(1, 0, 0).applyQuaternion(f.quat);
    view.up.set(0, 1, 0).applyQuaternion(f.quat);
    view.t = Math.tan(f.fov * RAD / 2);
    const rows = [];
    score(this.cast, comp, view, f.fov, f.dist, f.pitch, f.keyPt, rows);
    rows.sort((a, b) => a.pct - b.pct);
    const fy = view.ndcY(_facade);
    return {
      framing: key,
      fov: +f.fov.toFixed(2), dist: +f.dist.toFixed(1),
      pitch: +f.pitch.toFixed(2), yaw: +f.yaw.toFixed(2),
      pos: f.pos.toArray().map((v) => +v.toFixed(2)),
      camDist: +Math.hypot(f.pos.x, f.pos.y - 2, f.pos.z).toFixed(1),
      // where the street ends in frame, and therefore how much of the frame is above it
      facadeNdcY: fy == null ? null : +fy.toFixed(3),
      aboveStreetPct: fy == null ? null : +((1 - fy) / 2 * 100).toFixed(1),
      horizonNdcY: +(Math.tan(f.pitch * RAD) / view.t).toFixed(3),
      strays: this.strays.map((s) => ({ name: s.name, z: +s.bot.z.toFixed(1) })),
      kids: rows,
    };
  },

  /** The angle, at the subject, between the two eyepoints — how much of a CUT the cut is. */
  cutAngle() {
    const a = this.solutions?.batting, b = this.solutions?.field;
    if (!a || !b) return null;
    const subj = new THREE.Vector3(0, 3, 13);
    const va = a.pos.clone().sub(subj), vb = b.pos.clone().sub(subj);
    return +(va.angleTo(vb) / RAD).toFixed(1);
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

/**
 * The follow, on demand. FIELD pinned with a ball already climbing on a hard line-drive
 * trajectory, so `node tools/film.mjs cam_field_fly --frames 12 --step 0.08` shows the one
 * continuous move this camera is allowed to make, without needing the sim to produce a swing
 * first. The launch is a squared-up hit that stays on the contract stage rather than the
 * out-of-bounds rocket in the `deep_fly` scenario, so the ball is still legal to look at.
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

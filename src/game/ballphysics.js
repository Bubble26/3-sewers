import * as THREE from 'three';
import { app, registerSystem } from '../app.js';
import { bus } from '../core/bus.js';
import { rng } from '../core/rng.js';
import { T } from '../core/tuning.js';
import { registerScenario } from '../core/scenarios.js';
import { provide } from './plugins.js';
import { SURFACES, registerCollider, allColliders } from '../world/colliders.js';
import { GROUND, roadHeight, makeCanvas, canvasTexture } from '../world/props.js';
import { M, buildingTop } from '../world/facade.js';

/* =============================================================================
 * THE SPALDEEN
 *
 * A pink rubber ball is not a baseball and the whole game turns on the
 * difference.  It weighs seven-tenths of an ounce, it comes off a broom handle
 * faster than it has any right to, the air fights it hard, and when it lands on
 * sheet asphalt it comes back to a twelve-year-old's chest.  Everything below is
 * in feet and seconds, because one world unit is one foot.
 *
 * What is modelled:
 *   · quadratic drag, because a light ball is an aerodynamic object first
 *   · Magnus lift from real spin, and real spin *transfer* at every contact,
 *     so a ball that skids off the asphalt picks up topspin and then rolls
 *   · a per-surface restitution and friction pair read out of
 *     src/world/colliders.js, so the world tells the ball what it is made of
 *   · swept-sphere collision, sub-stepped fine enough that the ball cannot
 *     tunnel through a fire-escape rung 1.2 inches thick
 *
 * And the eight things the street does to a ball, which are the point:
 *   the sewer swallows it · a window booms, or breaks, and everything stops ·
 *   laundry kills it dead · an ash can lid clatters · a fender thunks and the
 *   ball squirts · an awning whumps and it slides off the front · the roof means
 *   somebody has to go up for it · and a fire escape rattles it down rung by
 *   rung, which is signature moment #4 and happens here for real, because the
 *   drop ladder is seven separate colliders between two stringers.
 * ========================================================================== */

/* --- tuning -----------------------------------------------------------------
 * These belong in src/core/tuning.js and will move there the moment this piece
 * is allowed to touch that file; until then they live in one exported table so
 * they are still a single place to turn a knob. */
export const SP = {
  radius: T.ball.radius,      // 0.18 ft collision radius
  drawR: 0.32,                // drawn a size larger than it is — BYB legibility
  mass: 0.0442,               // lb.  0.7 oz, the real weight of a pink rubber core

  gravity: T.ball.gravity,    // 32.2 ft/s²
  // ½ρCdA/m for the real object is 0.0139/ft, and that number caps the best
  // contact in the game at 110 ft — which deletes the two-sewer boast the whole
  // block is built on.  We keep the *shape* (quadratic) and scale the
  // coefficient, exactly the way Backyard exaggerates a real verb.
  dragTrue: 0.0139,
  airCheat: 0.36,
  get drag() { return this.dragTrue * this.airCheat; },
  magnus: 0.0022,             // a = k(ω × v); 140 rad/s at 110 ft/s ≈ 1g of lift
  spinDecay: 0.55,            // per second
  spinMax: 300,

  // The SURFACES table is written for a ball that does not bounce. A high-bounce
  // core multiplies it: asphalt 0.52 → 0.78, and a 6 ft drop returns 3.6 ft.
  liveliness: 1.5,
  restitutionCap: 0.90,

  rollFriction: 0.055,        // rolling resistance, ×g
  unstick: 1.05,              // ft/s of rebound below which the ball is "on the ground"
  maxStep: 0.11,              // ft of travel per substep — smaller than the ball
  maxSubsteps: 26,

  grateSlip: 26.0,            // below this normal speed a ball drops through bar grating
  windowBreak: 62,            // above this it is not a boom any more, it is a bill
  fenderKick: 0.42,           // how far sideways a Model T fender throws it
  hardImpact: 46,             // ft/s — the line between a tick and a wallop

  restSpeed: 4.0, restHold: 0.30,     // honestly stopped
  loiterSpeed: 9.0, loiterHold: 1.15, // rolling slowly with a fielder on it
  playCap: 7.5,                       // nobody chases a ball for longer than this

  minPx: 15,                  // the ball never draws smaller than this
  maxBump: 3.2,
  markerPx: 26,
  trailFrames: 7, trailSpeed: 52,
};

const UP = new THREE.Vector3(0, 1, 0);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* --- palette (design bible §2.4) ------------------------------------------ */
const PAL = {
  bodyNew: '#F2828A', bodyWorn: '#D4787A', bodySewer: '#B08472',
  shadeNew: '#D4787A', shadeWorn: '#B96C70', shadeSewer: '#96705F',
  seam: '#A85A5E', felt: '#C8C2A8',
  chalk: '#F6F0E2', ink: '#2A1D1A', shadow: '#3E4658',
};

/* =============================================================================
 * 1. THE STREET, AS A SET OF SURFACES
 *
 * src/world/colliders.js is the registry every piece is supposed to publish to.
 * The props and vehicles pieces already publish theirs on app.world.colliders in
 * their own shape, so we translate those in; the block above the sidewalk has no
 * colliders yet, so we register the canyon from the same published constants the
 * facade is built from (M.facadeX, M.lot, M.ground, M.floor) and from the lot
 * plan in src/world/street.js.  When those pieces register their own, this
 * bridge notices the duplicates by name and steps aside.
 * ========================================================================== */

// mirrors the hand-authored lot plan in src/world/street.js
const NORTH = { side: 1, z0: -15, st: [1, 6, 4, 6, 5, 6, 4, 6], fe: [0, 1, 1, 1, 1, 1, 0, 1], awn: [1, 1, 0, 0, 1, 1, 0, 1] };
const SOUTH = { side: -1, z0: 5, st: [6, 5, 4, 6, 5, 6, 4, 6], fe: [1, 1, 0, 1, 1, 1, 0, 1], awn: [1, 0, 0, 0, 0, 0, 0, 0] };
const TAXPAYER = { side: -1, z0: -46, z1: 5, h: 16 };
const FE_DECK = 3.1;         // statutory 4ft 6in projection, built at 3.1
const FE_RAIL = 2.9;
const LADDER_REST = 10.2;    // where the drop ladder hangs — out of a kid's reach

const KIND = {
  grate: 'sewer', post: 'iron', iron: 'iron', cans: 'tin', cart: 'wood',
  wood: 'wood', vehicle: 'car', panel: 'car',
};
const SCORING = { grate: 'sewer', vehicle: 'car' };

let worldReady = false;
const box = (x0, y0, z0, x1, y1, z1) =>
  new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)),
                 new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)));

function reg(name, b, surface, extra = {}) {
  return registerCollider({ name, box: b, surface, ...extra });
}

function bridgeProps(a) {
  const taken = new Set(allColliders().map((c) => c.name));
  for (const d of a?.world?.colliders ?? []) {
    if (!d.box || taken.has(d.name + '·' + d.kind)) continue;
    const surface = KIND[d.kind] || 'wood';
    reg(d.name, d.box, surface, {
      scoring: SCORING[d.kind] ?? null,
      sfx: d.sound || SURFACES[surface].sfx,
      tag: d.kind,
      // the props piece authored a restitution for a dead ball; keep its
      // *relative* judgement, let the surface table set the scale
      bias: d.restitution ? d.restitution / 0.45 : 1,
    });
  }
}

function eachLot(row, fn) {
  row.st.forEach((storeys, i) => fn({
    side: row.side, i, storeys,
    xf: row.side * M.facadeX, out: -row.side,
    z0: row.z0 + i * M.lot, z1: row.z0 + i * M.lot + M.lot,
    fe: !!row.fe[i], awn: !!row.awn[i],
  }));
}

function buildCanyon() {
  for (const row of [NORTH, SOUTH]) {
    eachLot(row, (lot) => {
      const top = buildingTop(lot.storeys);
      const back = lot.xf + (lot.side > 0 ? 12 : -12);
      reg(`facade ${lot.side > 0 ? 'N' : 'S'}${lot.i}`,
        box(lot.xf - lot.out * 0.1, 0, lot.z0, back, top, lot.z1), 'brick',
        { sfx: 'bounce_brick', tag: 'wall', roof: top, scoring: 'foul' });
    });
  }
  // the corner taxpayer, one storey, and the reason home plate is in the sun
  reg('taxpayer', box(-M.facadeX + 0.1, 0, TAXPAYER.z0, -M.facadeX - 12, TAXPAYER.h, TAXPAYER.z1),
    'brick', { sfx: 'bounce_brick', tag: 'wall', roof: TAXPAYER.h, scoring: 'foul' });
  // the block behind the batter, so a ball fouled straight back has a wall
  reg('facade N-back', box(M.facadeX - 0.1, 0, -46, M.facadeX + 12, 17.6, -15),
    'brick', { sfx: 'bounce_brick', tag: 'wall', roof: 17.6, scoring: 'foul' });

  // granite curb faces: the gutter is a trap and that is period-true
  for (const side of [1, -1]) {
    reg(`curb ${side > 0 ? 'E' : 'W'}`,
      box(side * 21.95, -0.5, -46, side * 23.3, 0.50, 190), 'belgian',
      { sfx: 'bounce_stone', tag: 'curb' });
  }
}

function buildFireEscapes() {
  for (const row of [NORTH, SOUTH]) {
    eachLot(row, (lot) => {
      if (!lot.fe) return;
      const o = lot.out, cz = lot.z0 + M.lot / 2;
      const bz0 = cz - 4.0, bz1 = cz + 4.0;
      const xIn = lot.xf + o * 0.05, xOut = lot.xf + o * FE_DECK;
      const tag = `fe ${lot.side > 0 ? 'N' : 'S'}${lot.i}`;
      const levels = [];
      for (let f = 1; f < lot.storeys; f++) levels.push(M.ground + (f - 1) * M.floor + 1.85);

      levels.forEach((y, idx) => {
        // the bar-grating deck. A spaldeen fits between the bars, so this one is
        // solid to a line drive and porous to a ball that has stopped hurrying.
        reg(`${tag} deck ${idx}`, box(xIn, y - 0.34, bz0, xOut, y + 0.02, bz1), 'iron',
          { sfx: 'clang_iron', tag: 'grate', scoring: 'foul', level: idx, fe: tag, cz });
        // the outer beam and railing — what a ball off the brick actually hits
        reg(`${tag} rail ${idx}`, box(xOut - o * 0.22, y, bz0, xOut, y + FE_RAIL, bz1), 'iron',
          { sfx: 'clang_iron', tag: 'rail', scoring: 'foul', level: idx, fe: tag });
      });

      // The drop ladder, resting at 10ft.  Seven rungs and two stringers: this is
      // the rattle, and it is geometry, not a scripted sequence.
      const y0 = levels[0];
      const la = lot.xf + o * (FE_DECK - 1.5), lb = lot.xf + o * (FE_DECK - 0.35);
      const zLo = cz + 3.2, zHi = cz - 1.2;
      for (let i = 0; i < 7; i++) {
        const t = (i + 0.5) / 7;
        const y = LADDER_REST + (y0 - LADDER_REST) * t, z = zLo + (zHi - zLo) * t;
        reg(`${tag} rung ${i}`, box(la, y, z - 0.16, lb, y + 0.10, z + 0.16), 'iron',
          { sfx: 'clang_iron', tag: 'rung', rung: i, scoring: 'foul', fe: tag });
      }
      for (const [xs, k] of [[la, 'a'], [lb, 'b']]) {
        reg(`${tag} stringer ${k}`, box(xs - 0.06, LADDER_REST - 0.2, zHi - 0.3, xs + 0.06, y0 + 0.5, zLo + 0.3),
          'iron', { sfx: 'clang_iron', tag: 'stringer', scoring: 'foul', fe: tag });
      }
    });
  }
}

function buildAwnings() {
  for (const row of [NORTH, SOUTH]) {
    eachLot(row, (lot) => {
      if (!lot.awn) return;
      const o = lot.out;
      reg(`awning ${lot.side > 0 ? 'N' : 'S'}${lot.i}`,
        box(lot.xf + o * 1.0, 7.35, lot.z0 + 1.2, lot.xf + o * 5.5, 8.55, lot.z1 - 1.2),
        'cloth', { sfx: 'canvas_whump', tag: 'awning', out: o, scoring: 'foul' });
    });
  }
}

function buildGlass() {
  // The plate glass on the deli, south side, close enough to home that a pulled
  // line drive can find it. One pane, deliberately: a broken window is a story,
  // and a story you can trip over twice an inning is not a story.
  reg('deli plate glass', box(-M.facadeX - 0.2, 2.0, 9.5, -M.facadeX + 0.35, 9.4, 25.5),
    'glass', { sfx: 'window_flex', tag: 'window', scoring: 'window' });
}

function registerWorld(a) {
  if (worldReady) return;
  worldReady = true;
  bridgeProps(a);
  buildCanyon();
  buildFireEscapes();
  buildAwnings();
  buildGlass();
  SOLID.length = 0; TRIGGER.length = 0;
  for (const c of allColliders()) (c.surface === 'sewer' ? TRIGGER : SOLID).push(c);
}
const SOLID = [], TRIGGER = [];

/* =============================================================================
 * 2. THE GROUND
 * The roadway is crowned — humped at the crown, dished at the gutter — so it is
 * solved analytically instead of with a box, which is also what makes a dying
 * roller drift to the gutter and find a catch basin on its own.
 * ========================================================================== */
const groundY = (x) => roadHeight(x);
function groundSlope(x) {
  return (roadHeight(x + 0.02) - roadHeight(x - 0.02)) / 0.04;
}

/* =============================================================================
 * 3. STATE
 * ========================================================================== */
const S = {
  impacts: 0, rest: 0, loiter: 0, grounded: false,
  fate: null, fateHold: 0, sink: 0,
  hold: 0,                       // ball-local hitstop, in seconds
  squash: 0, squashN: new THREE.Vector3(0, 1, 0),
  ignore: new Map(),
  trail: [], last: new THREE.Vector3(),
  predict: new THREE.Vector3(), predictOn: false, predictAge: 99,
  wear: 0, bounces: 0, apex: 0, contactZ: 0,
  lastSurface: null, lastFE: null, lastRung: -1,
};

function newPlay(ball) {
  S.impacts = 0; S.rest = 0; S.loiter = 0; S.grounded = false;
  S.fate = null; S.fateHold = 0; S.sink = 0; S.hold = 0; S.squash = 0;
  S.ignore.clear(); S.trail.length = 0; S.bounces = 0; S.apex = ball.pos.y;
  S.predictOn = false; S.predictAge = 99; S.lastFE = null; S.lastRung = -1;
  S.contactZ = ball.pos.z;
}

bus.on('bat:contact', (hit) => {
  const b = app.sim?.ball; if (!b) return;
  newPlay(b);
  // backspin off a round stick on a round ball: more loft, more spin
  const q = clamp(hit?.quality ?? 0.5, 0, 1);
  const vh = new THREE.Vector3(b.vel.x, 0, b.vel.z);
  if (vh.lengthSq() > 1e-4) {
    b.spin.copy(vh.normalize().cross(UP)).multiplyScalar(60 + q * 150);
    b.spin.addScaledVector(UP, -(hit?.sprayRad ?? 0) * 90);
  } else b.spin.set(0, 0, 0);
});

/* =============================================================================
 * 4. SWEPT-SPHERE COLLISION
 * ========================================================================== */
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _n = new THREE.Vector3();
const _from = new THREE.Vector3(), _to = new THREE.Vector3(), _acc = new THREE.Vector3();
const _vt = new THREE.Vector3(), _cp = new THREE.Vector3(), _vc = new THREE.Vector3();
const _dvt = new THREE.Vector3(), _dw = new THREE.Vector3(), _c = new THREE.Vector3();
const _lo = new THREE.Vector3(), _hi = new THREE.Vector3();

function sweepColliders(from, to, vel, r) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-9) return null;
  const ix = dx / len, iy = dy / len, iz = dz / len;
  _lo.set(Math.min(from.x, to.x) - r, Math.min(from.y, to.y) - r, Math.min(from.z, to.z) - r);
  _hi.set(Math.max(from.x, to.x) + r, Math.max(from.y, to.y) + r, Math.max(from.z, to.z) + r);

  let best = null;
  for (const col of SOLID) {
    if (S.ignore.has(col)) continue;
    const b = col.box;
    if (b.max.x < _lo.x || b.min.x > _hi.x || b.max.y < _lo.y || b.min.y > _hi.y ||
        b.max.z < _lo.z || b.min.z > _hi.z) continue;

    // ray against the box grown by the radius (Minkowski, square corners)
    let t0 = 0, t1 = len;
    let ok = true;
    for (const ax of AXES) {
      const o = from[ax], d = ax === 'x' ? ix : ax === 'y' ? iy : iz;
      const lo = b.min[ax] - r, hi = b.max[ax] + r;
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
      let a = (lo - o) / d, z = (hi - o) / d;
      if (a > z) { const s = a; a = z; z = s; }
      if (a > t0) t0 = a;
      if (z < t1) t1 = z;
      if (t1 < t0) { ok = false; break; }
    }
    if (!ok || t0 > len) continue;
    if (best && t0 >= best.d) continue;

    // the real normal: sphere centre at contact, against the *unexpanded* box
    _c.set(from.x + ix * t0, from.y + iy * t0, from.z + iz * t0);
    _n.set(
      _c.x - clamp(_c.x, b.min.x, b.max.x),
      _c.y - clamp(_c.y, b.min.y, b.max.y),
      _c.z - clamp(_c.z, b.min.z, b.max.z),
    );
    if (_n.lengthSq() < 1e-10) {           // centre inside: push out the near face
      const dxm = Math.min(_c.x - b.min.x, b.max.x - _c.x);
      const dym = Math.min(_c.y - b.min.y, b.max.y - _c.y);
      const dzm = Math.min(_c.z - b.min.z, b.max.z - _c.z);
      if (dym <= dxm && dym <= dzm) _n.set(0, _c.y - (b.min.y + b.max.y) / 2 >= 0 ? 1 : -1, 0);
      else if (dxm <= dzm) _n.set(_c.x - (b.min.x + b.max.x) / 2 >= 0 ? 1 : -1, 0, 0);
      else _n.set(0, 0, _c.z - (b.min.z + b.max.z) / 2 >= 0 ? 1 : -1);
    } else _n.normalize();
    if (vel.dot(_n) >= 0) continue;        // already leaving: not a collision
    best = { col, d: t0, t: t0 / len, nx: _n.x, ny: _n.y, nz: _n.z };
  }
  return best;
}
const AXES = ['x', 'y', 'z'];

/** the crowned roadway, swept */
function sweepGround(from, to, vel) {
  const f0 = from.y - SP.radius - groundY(from.x);
  const f1 = to.y - SP.radius - groundY(to.x);
  if (f0 > 0 && f1 > 0) return null;
  // resting exactly on the surface is not a collision unless it is coming down
  if (f0 <= 1e-4) return vel.y < 0 ? { t: 0 } : null;
  let a = 0, b = 1;
  for (let i = 0; i < 8; i++) {
    const m = (a + b) / 2;
    const x = from.x + (to.x - from.x) * m, y = from.y + (to.y - from.y) * m;
    if (y - SP.radius - groundY(x) > 0) a = m; else b = m;
  }
  return { t: a };
}

/* =============================================================================
 * 5. IMPACT — reflection, friction, spin transfer, and the story
 * ========================================================================== */
function ignoreFor(col, sec) { S.ignore.set(col, sec); }

function emitImpact(kind, col, surfName, n, speed, ball, extra = {}) {
  if (speed < 1.4) return;                  // a ball settling is not an event
  S.impacts++;
  S.lastSurface = surfName;
  const hard = speed > SP.hardImpact;
  if (hard) S.hold = Math.max(S.hold, 0.034);
  S.squash = Math.max(S.squash, clamp(speed / 120, 0.10, 0.45));
  S.squashN.set(n.x, n.y, n.z);
  bus.emit('ball:impact', {
    kind, surface: surfName, sfx: col?.sfx || SURFACES[surfName]?.sfx || 'bounce_asphalt',
    name: col?.name || 'street', tag: col?.tag || 'ground',
    pos: ball.pos.clone(), normal: n.clone(), speed, hard, index: S.impacts, ...extra,
  });
}

function restitutionOf(surfName, col) {
  const s = SURFACES[surfName];
  const bias = col?.bias ? clamp(col.bias, 0.6, 1.4) : 1;
  return clamp(s.restitution * SP.liveliness * bias, 0, SP.restitutionCap);
}

/** the whole of contact mechanics in one place: bounce, skid, and spin transfer */
function bounce(ball, n, e, mu) {
  const vn = ball.vel.dot(n);
  _vt.copy(ball.vel).addScaledVector(n, -vn);
  _cp.copy(n).multiplyScalar(-SP.radius);
  _vc.copy(ball.spin).cross(_cp).add(_vt);          // velocity of the contact patch
  const jn = -(1 + e) * vn;                          // Δv along the normal, per unit mass
  const need = (2 / 7) * _vc.length();
  if (need <= mu * jn) _dvt.copy(_vc).multiplyScalar(-2 / 7);            // grips: rolls out
  else _dvt.copy(_vc).normalize().multiplyScalar(-mu * jn);              // skids
  ball.vel.copy(_vt).add(_dvt).addScaledVector(n, vn + jn);
  _dw.copy(n).cross(_dvt).multiplyScalar(-2.5 / SP.radius);
  ball.spin.add(_dw).clampLength(0, SP.spinMax);
  return jn;
}

function finish(kind, hold, detail) {
  S.fate = { kind, detail };
  S.fateHold = hold;
  return S.fate;
}

function resolve(hit, ball, sim) {
  const col = hit.col;
  const surfName = col.surface;
  _n.set(hit.nx, hit.ny, hit.nz);
  const vn = ball.vel.dot(_n);
  if (vn >= 0) { ignoreFor(col, 0.08); return null; }
  const speed = -vn;

  /* — bar grating: a spaldeen is smaller than the slots, and once it has spent
       its first bounce it simply goes through and drops into the ladder well — */
  if (col.tag === 'grate' && speed < SP.grateSlip && _n.y > 0.5) {
    ignoreFor(col, 0.45);
    emitImpact('through', col, 'iron', _n, speed, ball, { through: true, level: col.level });
    bus.emit('ball:fire_escape', { phase: 'through_grating', level: col.level, pos: ball.pos.clone() });
    ball.vel.multiplyScalar(0.55);
    return { carom: 'iron' };
  }

  /* — plate glass: it booms, or it is a bill — */
  if (surfName === 'glass') {
    if (speed > SP.windowBreak) {
      emitImpact('break', col, 'glass', _n, speed, ball, { broke: true });
      bus.emit('ball:window', { broke: true, pos: ball.pos.clone(), name: col.name });
      ball.vel.multiplyScalar(0.12);
      ball.spin.multiplyScalar(0.2);
      finish('window_break', 2.0, 'through the window');
      return { carom: 'glass' };
    }
    // §9.5 — it flexes, it booms, and every kid on the block freezes for a beat
    emitImpact('boom', col, 'glass', _n, speed, ball, { broke: false });
    bus.emit('ball:window', { broke: false, pos: ball.pos.clone(), name: col.name });
    bounce(ball, _n, 0.30, 0.5);
    S.hold = Math.max(S.hold, 0.09);
    return { carom: 'glass' };
  }

  /* — laundry, and the awning's canvas: cloth kills a rubber ball dead — */
  if (surfName === 'cloth') {
    if (col.tag === 'awning') {
      emitImpact('whump', col, 'cloth', _n, speed, ball, {});
      bus.emit('ball:awning', { pos: ball.pos.clone(), name: col.name });
      bounce(ball, _n, 0.26, 0.80);
      // it does not bounce off canvas, it rolls off the front of it
      ball.vel.x += (col.out || 0) * Math.max(2.5, speed * 0.22);
      ball.vel.y = Math.min(ball.vel.y, 2.0);
      return { carom: 'cloth' };
    }
    emitImpact('deadened', col, 'cloth', _n, speed, ball, {});
    bus.emit('ball:laundry', { pos: ball.pos.clone(), name: col.name });
    ball.vel.set(0, Math.min(ball.vel.y, -0.4), 0);     // straight down, like that
    ball.spin.multiplyScalar(0.05);
    return { carom: 'cloth' };
  }

  const e = restitutionOf(surfName, col);
  const mu = SURFACES[surfName].friction;
  bounce(ball, _n, e, mu);

  /* — the flavour each object owes the block — */
  if (col.tag === 'cans') {
    // the lid comes off, and the second baseman fields the carom with it
    ball.vel.x += rng.range(-1, 1) * speed * 0.20;
    ball.vel.z += rng.range(-1, 1) * speed * 0.20;
    ball.vel.y += speed * 0.10;
    bus.emit('ball:ashcan', { pos: ball.pos.clone(), lid: speed > 14, speed });
  } else if (surfName === 'car') {
    // a fender is a curved sheet of tin: it thunks and the ball squirts sideways
    _w.copy(_n).cross(UP);
    if (_w.lengthSq() < 1e-6) _w.set(1, 0, 0);
    _w.normalize();
    const sgn = ((ball.pos.z * 7.13 + ball.pos.x * 3.7) % 2 < 1) ? 1 : -1;
    ball.vel.addScaledVector(_w, sgn * speed * SP.fenderKick);
    bus.emit('ball:fender', { pos: ball.pos.clone(), name: col.name, speed });
  } else if (col.tag === 'rung' || col.tag === 'stringer' || col.tag === 'rail' || col.tag === 'grate') {
    const rung = col.rung ?? -1;
    if (col.fe !== S.lastFE) { S.lastFE = col.fe; S.lastRung = -1; }
    bus.emit('ball:fire_escape', {
      phase: col.tag === 'rung' ? 'rung' : col.tag,
      rung, of: 7, pos: ball.pos.clone(), speed,
      // each rung a distinct pitch, ringing *down* the ladder
      pitch: rung >= 0 ? 1 - rung / 9 : 1,
    });
    S.lastRung = rung;
  }

  emitImpact('bounce', col, surfName, _n, speed, ball, {});
  if (_n.y > 0.62 && speed < SP.unstick) { S.grounded = false; }
  return _n.y > 0.7 ? { bounced: true, surface: surfName } : { carom: surfName };
}

function resolveGround(ball) {
  const x = ball.pos.x;
  const slope = groundSlope(x);
  _n.set(-slope, 1, 0).normalize();
  const vn = ball.vel.dot(_n);
  if (vn >= 0) return null;
  const speed = -vn;
  const walk = Math.abs(x) > GROUND.curbX;
  const surfName = walk ? 'belgian' : Math.abs(x) > 19.2 ? 'belgian' : 'asphalt';
  ball.pos.y = groundY(x) + SP.radius;
  bounce(ball, _n, restitutionOf(surfName, null), SURFACES[surfName].friction);
  S.bounces++;
  emitImpact('bounce', { name: walk ? 'sidewalk' : 'roadway', sfx: SURFACES[surfName].sfx, tag: 'ground' },
    surfName, _n, speed, ball, { bounce: S.bounces });
  if (ball.vel.y < SP.unstick) { S.grounded = true; ball.vel.y = 0; }
  else ball.pos.y += 0.004;                 // clear of the surface, so it cannot re-trigger
  return { bounced: true, surface: surfName };
}

/* --- the sewer: a trigger volume, not a wall ------------------------------ */
function sewerCheck(ball) {
  if (S.fate) return false;
  for (const col of TRIGGER) {
    const b = col.box;
    if (ball.pos.x < b.min.x - 0.1 || ball.pos.x > b.max.x + 0.1) continue;
    if (ball.pos.z < b.min.z - 0.1 || ball.pos.z > b.max.z + 0.1) continue;
    if (ball.pos.y > b.max.y + SP.radius + 0.25) continue;
    bus.emit('ball:impact', {
      kind: 'sewer', surface: 'sewer', sfx: col.sfx || 'sewer_swallow', name: col.name,
      tag: 'grate', pos: ball.pos.clone(), normal: UP.clone(), speed: ball.vel.length(),
      hard: false, index: ++S.impacts,
    });
    bus.emit('ball:sewer', { pos: ball.pos.clone(), name: col.name });
    ball.pos.x = (b.min.x + b.max.x) / 2;
    ball.pos.z = clamp(ball.pos.z, b.min.z + 0.4, b.max.z - 0.4);
    ball.vel.set(0, -1.2, 0);
    ball.spin.multiplyScalar(0.1);
    S.wear = 2;                       // and it comes back filthy, and stays filthy
    finish('sewer', 1.7, 'down the sewer');
    return true;
  }
  return false;
}

/* =============================================================================
 * 6. INTEGRATION
 * ========================================================================== */
function accel(out, vel, spin) {
  const s = vel.length();
  out.set(0, -SP.gravity, 0);
  if (s > 1e-4) out.addScaledVector(vel, -SP.drag * s);
  _v.copy(spin).cross(vel).multiplyScalar(SP.magnus);
  return out.add(_v);
}

function outOfPlay(ball) {
  const x = ball.pos.x, z = ball.pos.z;
  if (Math.abs(x) > M.facadeX + 0.6) {
    bus.emit('ball:roof', { pos: ball.pos.clone(), side: Math.sign(x) });
    return finish('roof', 1.4, 'on the roof');
  }
  if (z > 188 || z < -52 || ball.pos.y < -6) {
    bus.emit('ball:lost', { pos: ball.pos.clone() });
    return finish('lost', 0.9, 'up the block');
  }
  return null;
}

function substep(h, ball, sim) {
  let ev = null;

  accel(_acc, ball.vel, ball.spin);
  ball.vel.addScaledVector(_acc, h);
  ball.spin.multiplyScalar(Math.max(0, 1 - SP.spinDecay * h));

  if (S.grounded) {
    // riding the crown: gravity along the slope, rolling resistance, and the
    // spin the ball must have if it is rolling rather than sliding
    const slope = groundSlope(ball.pos.x);
    ball.vel.y = 0;
    ball.vel.x -= SP.gravity * slope * h;
    const sp = Math.hypot(ball.vel.x, ball.vel.z);
    if (sp > 1e-4) {
      const k = Math.max(0, 1 - (SP.rollFriction * SP.gravity * h) / sp);
      ball.vel.x *= k; ball.vel.z *= k;
    }
    _v.set(ball.vel.x, 0, ball.vel.z);
    _w.copy(UP).cross(_v).multiplyScalar(1 / SP.radius);
    ball.spin.lerp(_w, Math.min(1, h * 9));
  }

  let remaining = h, guard = 0;
  while (remaining > 1e-7 && guard++ < 4) {
    _from.copy(ball.pos);
    _to.copy(ball.pos).addScaledVector(ball.vel, remaining);
    const cHit = sweepColliders(_from, _to, ball.vel, SP.radius);
    const gHit = S.grounded ? null : sweepGround(_from, _to, ball.vel);
    const useGround = gHit && (!cHit || gHit.t <= cHit.t);
    const hit = useGround ? gHit : cHit;
    if (!hit) { ball.pos.copy(_to); break; }
    const tt = Math.max(0, hit.t - 1e-4);
    ball.pos.lerpVectors(_from, _to, tt);
    const r = useGround ? resolveGround(ball) : resolve(hit, ball, sim);
    if (r && !ev) ev = r;
    remaining *= (1 - tt);
    if (S.fate) break;
  }
  if (S.grounded) ball.pos.y = groundY(ball.pos.x) + SP.radius;
  if (!S.fate) sewerCheck(ball);
  if (!S.fate) outOfPlay(ball);
  S.apex = Math.max(S.apex, ball.pos.y);
  return ev;
}

/* =============================================================================
 * 7. THE SLOT
 * ========================================================================== */
function step(dt, ball, sim) {
  registerWorld(app);
  if (sim.playT <= dt * 1.01) newPlay(ball);

  for (const [c, t] of S.ignore) { const n = t - dt; if (n <= 0) S.ignore.delete(c); else S.ignore.set(c, n); }

  if (S.fate) {
    S.fateHold -= dt;
    if (S.fate.kind === 'sewer') { S.sink = Math.min(1, S.sink + dt * 3.2); ball.pos.y -= dt * 0.7; }
    else if (S.fate.kind === 'roof' || S.fate.kind === 'lost') {
      ball.pos.addScaledVector(ball.vel, dt);
      ball.vel.y -= SP.gravity * dt;
    }
    return null;
  }

  if (S.hold > 0) { S.hold -= dt; return null; }          // 2-frame hitstop on a wallop

  const speed = ball.vel.length();
  const sub = clamp(Math.ceil((speed * dt) / SP.maxStep), 1, SP.maxSubsteps);
  const h = dt / sub;
  let ev = null;
  for (let i = 0; i < sub; i++) {
    const r = substep(h, ball, sim);
    if (r && !ev) ev = r;
    if (S.fate || S.hold > 0) break;
  }

  // is it honestly over?
  const v = ball.vel.length();
  const low = ball.pos.y < groundY(ball.pos.x) + SP.radius * 3;
  S.rest = (v < SP.restSpeed && low) ? S.rest + dt : 0;
  S.loiter = (v < SP.loiterSpeed && low && S.bounces >= 2) ? S.loiter + dt : 0;
  if (S.squash > 0) S.squash = Math.max(0, S.squash - dt * 3.4);
  return ev;
}

function settled(ball, sim) {
  if (S.fate) return S.fateHold <= 0;
  if (S.rest > SP.restHold) return true;         // stopped
  if (S.loiter > SP.loiterHold) return true;     // a slow roller is a fielded ball
  if (sim.playT > SP.playCap) return true;       // nobody chases it forever
  return false;
}

provide('ballphysics', {
  step, settled,
  fate: () => S.fate,
  surfaces: SURFACES,
  predict: () => (S.predictOn ? S.predict.clone() : null),
});

/* =============================================================================
 * 8. THE BALL YOU CAN SEE
 *
 * §2.5 of the bible: the ball is drawn in three parts at every scale — an ink
 * outline, a chalk rim crescent on the upper-left third, and the body colour
 * between them — because no single colour clears 4.5:1 against a street built
 * of mid-value stone.  Plus the two redundant reads: a contact shadow that is
 * never grey, and a chalk landing marker that is a gameplay mechanic.
 * ========================================================================== */
const TAU = Math.PI * 2;

function bodyTexture(wear) {
  const size = 128, C = size / 2, R = 58;
  const { c, g } = makeCanvas(size, size);
  const body = [PAL.bodyNew, PAL.bodyWorn, PAL.bodySewer][wear];
  const shade = [PAL.shadeNew, PAL.shadeWorn, PAL.shadeSewer][wear];
  g.clearRect(0, 0, size, size);
  g.fillStyle = body;
  g.beginPath(); g.arc(C, C, R, 0, TAU); g.fill();
  // two-band toon shading, never a gradient
  g.save();
  g.beginPath(); g.arc(C, C, R, 0, TAU); g.clip();
  g.fillStyle = shade;
  g.beginPath(); g.arc(C + 30, C + 34, R * 1.02, 0, TAU); g.fill();
  // the moulded seam channel, and the felt that never quite came off
  g.strokeStyle = PAL.seam; g.lineWidth = 4.5; g.lineCap = 'round';
  g.beginPath();
  g.ellipse(C, C, R * 0.82, R * 0.30, -0.42, Math.PI * 0.08, Math.PI * 1.02);
  g.stroke();
  if (wear < 2) {
    g.fillStyle = PAL.felt;
    for (const [fx, fy, fr] of [[-24, -12, 3.2], [10, 6, 2.4], [30, 20, 2.0]]) {
      g.beginPath(); g.arc(C + fx, C + fy, fr, 0, TAU); g.fill();
    }
  } else {
    g.fillStyle = 'rgba(42,29,26,0.30)';
    for (const [fx, fy, fr] of [[-18, 14, 9], [16, -20, 7], [26, 26, 6]]) {
      g.beginPath(); g.arc(C + fx, C + fy, fr, 0, TAU); g.fill();
    }
  }
  g.restore();
  return canvasTexture(c);
}

function crescent(size, r, dx, dy, colour) {
  const { c, g } = makeCanvas(size, size);
  const C = size / 2;
  g.fillStyle = colour;
  g.beginPath(); g.arc(C, C, r, 0, TAU); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(C + dx, C + dy, r * 0.955, 0, TAU); g.fill();
  return c;
}

/** the half that does not spin: ink silhouette + chalk rim, upper-left third */
function rimTexture() {
  const size = 128, C = size / 2, R = 58;
  const { c, g } = makeCanvas(size, size);
  g.clearRect(0, 0, size, size);
  g.drawImage(crescent(size, R - 3.0, 15, 15, PAL.ink), 0, 0);      // the crescent's own ink
  g.drawImage(crescent(size, R - 6.0, 16.4, 16.4, PAL.chalk), 0, 0); // the chalk rim
  g.strokeStyle = PAL.ink; g.lineWidth = 6.5;
  g.beginPath(); g.arc(C, C, R - 2.6, 0, TAU); g.stroke();           // the outline, always
  return canvasTexture(c);
}

function shadowTexture() {
  const size = 128, C = size / 2;
  const { c, g } = makeCanvas(size, size);
  const grd = g.createRadialGradient(C, C, 2, C, C, C);
  grd.addColorStop(0, 'rgba(62,70,88,0.95)');
  grd.addColorStop(0.55, 'rgba(62,70,88,0.78)');
  grd.addColorStop(0.86, 'rgba(62,70,88,0.20)');
  grd.addColorStop(1, 'rgba(62,70,88,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  return canvasTexture(c);
}

/** chalk ring + ink outline: the landing marker is a mechanic, not decoration */
function markerTexture() {
  const size = 128, C = size / 2;
  const { c, g } = makeCanvas(size, size);
  g.clearRect(0, 0, size, size);
  g.lineCap = 'round';
  g.strokeStyle = PAL.ink; g.lineWidth = 13;
  g.beginPath(); g.arc(C, C, 46, 0, TAU); g.stroke();
  g.strokeStyle = PAL.chalk; g.lineWidth = 9;
  g.beginPath(); g.arc(C, C, 46, 0, TAU); g.stroke();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const x0 = C + Math.cos(a) * 22, y0 = C + Math.sin(a) * 22;
    const x1 = C + Math.cos(a) * 34, y1 = C + Math.sin(a) * 34;
    g.strokeStyle = PAL.ink; g.lineWidth = 9;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = PAL.chalk; g.lineWidth = 5;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  return canvasTexture(c);
}

function trailTexture() {
  const { c, g } = makeCanvas(64, 8);
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, 'rgba(246,240,226,0)');
  grd.addColorStop(0.55, 'rgba(246,240,226,0.24)');
  grd.addColorStop(1, 'rgba(246,240,226,0.62)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 8);
  return canvasTexture(c);
}

/* --- the predicted landing point ------------------------------------------ */
const _pp = new THREE.Vector3(), _pv = new THREE.Vector3(), _ps = new THREE.Vector3(), _pa = new THREE.Vector3();
function predictLanding(ball) {
  _pp.copy(ball.pos); _pv.copy(ball.vel); _ps.copy(ball.spin);
  const h = 1 / 45;
  for (let i = 0; i < 190; i++) {
    accel(_pa, _pv, _ps);
    _pv.addScaledVector(_pa, h);
    _ps.multiplyScalar(1 - SP.spinDecay * h);
    _pp.addScaledVector(_pv, h);
    if (Math.abs(_pp.x) > M.facadeX) return { ok: i > 3, pos: _pp.clone(), t: i * h };
    if (_pp.y - SP.radius <= groundY(_pp.x)) {
      _pp.y = groundY(_pp.x);
      return { ok: i > 3, pos: _pp.clone(), t: i * h };
    }
  }
  return { ok: false, pos: _pp.clone(), t: 99 };
}

/* =============================================================================
 * 9. THE SYSTEM
 * ========================================================================== */
const _cam = new THREE.Vector3(), _q = new THREE.Quaternion(), _size = new THREE.Vector2();
const _dir = new THREE.Vector3(), _side = new THREE.Vector3(), _tmp = new THREE.Vector3();

export default registerSystem({
  name: 'ballphysics',
  order: 32,

  init(a) {
    registerWorld(a);
    this.bodyTex = [bodyTexture(0), bodyTexture(1), bodyTexture(2)];

    const root = new THREE.Group();
    root.name = 'spaldeen';
    a.scene.add(root);
    this.root = root;

    // billboard → stretch → (spinning body + fixed rim)
    this.bill = new THREE.Object3D(); root.add(this.bill);
    this.stretch = new THREE.Object3D(); this.bill.add(this.stretch);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.body = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      map: this.bodyTex[0], transparent: true, depthWrite: false, toneMapped: false,
    }));
    this.rim = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      map: rimTexture(), transparent: true, depthWrite: false, toneMapped: false,
    }));
    this.body.renderOrder = 8; this.rim.renderOrder = 9;
    this.rim.position.z = 0.001;
    this.stretch.add(this.body); this.stretch.add(this.rim);

    // contact shadow — mandatory, never grey, never black
    this.shadow = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0.4,
    }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 4;
    a.scene.add(this.shadow);

    // chalk landing marker
    this.marker = new THREE.Mesh(quad, new THREE.MeshBasicMaterial({
      map: markerTexture(), transparent: true, depthWrite: false, toneMapped: false, opacity: 0,
    }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 5;
    a.scene.add(this.marker);

    // six frames of chalk-cream, fading to nothing, never a glow
    const N = SP.trailFrames;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
    const uv = new Float32Array(N * 2 * 2);
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      uv[i * 4] = u; uv[i * 4 + 1] = 0; uv[i * 4 + 2] = u; uv[i * 4 + 3] = 1;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const idx = [];
    for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setIndex(idx);
    this.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: trailTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 7;
    a.scene.add(this.trail);

    this.proxy = a.get('ballview');
  },

  onScenario() {
    S.wear = 0;
    S.trail.length = 0;
    S.predictOn = false;
  },

  lateUpdate(dt, a) {
    // one ball on the field: the placeholder proxy steps aside
    if (this.proxy?.mesh) this.proxy.mesh.visible = false;

    const ball = a.sim.ball;
    const live = ball.live || ball.inFlight;
    const cam = a.camera;
    this.root.visible = live;
    this.shadow.visible = live;
    this.trail.visible = false;
    this.marker.material.opacity = 0;

    if (!live) { S.trail.length = 0; return; }

    // sinking into the grate: the last thing you see is the pink going dark
    const sink = S.fate?.kind === 'sewer' ? S.sink : 0;

    // scale floor — the ball never draws under SP.minPx across
    a.stage.renderer.getSize(_size);
    const dist = Math.max(1, cam.position.distanceTo(ball.pos));
    const worldPerPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / Math.max(1, _size.y);
    const need = SP.minPx * 0.5 * worldPerPx;
    const r = clamp(Math.max(SP.drawR, need), SP.drawR, SP.drawR * SP.maxBump) * (1 - sink * 0.85);

    this.root.position.copy(ball.pos);
    this.bill.quaternion.copy(cam.quaternion);
    _q.copy(cam.quaternion).invert();

    // squash along the impact normal, stretch along the flight
    let ang = 0, s = 0;
    if (S.squash > 0.01) {
      _tmp.copy(S.squashN).applyQuaternion(_q);
      ang = Math.atan2(_tmp.y, _tmp.x);
      s = S.squash;
    } else if (ball.vel.lengthSq() > 900) {
      _tmp.copy(ball.vel).applyQuaternion(_q);
      ang = Math.atan2(_tmp.y, _tmp.x) + Math.PI / 2;      // stretch axis ⟂ to this
      s = Math.min(0.20, ball.vel.length() / 900);
    }
    this.stretch.rotation.z = ang;
    this.stretch.scale.set(1 / (1 + s), 1 + s, 1);

    const d = r * 2;
    this.body.scale.set(d, d, 1);
    this.rim.scale.set(d, d, 1);
    // the body carries the seam, so the spin has to be visible on it
    _tmp.copy(ball.spin).applyQuaternion(_q);
    this.spinAngle = (this.spinAngle ?? 0) - (_tmp.z * dt) - (Math.hypot(_tmp.x, _tmp.y) * dt * 0.35);
    this.body.rotation.z = this.spinAngle - ang;
    this.rim.rotation.z = -ang;

    if (S.wear !== this.shownWear) {
      this.shownWear = S.wear;
      this.body.material.map = this.bodyTex[S.wear];
      this.body.material.needsUpdate = true;
    }

    /* --- contact shadow --------------------------------------------------- */
    const gy = groundY(ball.pos.x);
    const height = Math.max(0, ball.pos.y - SP.radius - gy);
    const sr = (SP.drawR * 2.15 + height * 0.055) * clamp(need / SP.drawR, 1, 2.4);
    this.shadow.position.set(ball.pos.x, gy + 0.03, ball.pos.z);
    this.shadow.scale.set(sr * 2, sr * 2, 1);
    this.shadow.material.opacity = clamp(0.42 - height * 0.006, 0.14, 0.42) * (1 - sink);
    this.shadow.visible = live && Math.abs(ball.pos.x) < M.facadeX && sink < 0.9;

    /* --- landing marker --------------------------------------------------- */
    S.predictAge += dt;
    if (ball.inFlight && !S.fate && height > 2.5 && S.predictAge > 0.05) {
      const p = predictLanding(ball);
      S.predictAge = 0;
      S.predictOn = p.ok && p.t > 0.22;
      if (S.predictOn) S.predict.copy(p.pos);
    }
    if (S.predictOn && height > 3.0) {
      const md = Math.max(2.4, SP.markerPx * worldPerPx * (cam.position.distanceTo(S.predict) / dist));
      this.marker.position.set(S.predict.x, groundY(S.predict.x) + 0.05, S.predict.z);
      this.marker.scale.set(md, md, 1);
      this.marker.material.opacity = clamp((height - 3) * 0.22, 0, 0.92);
    }

    this.debug = { height, need: +need.toFixed(3), r: +r.toFixed(3), predictOn: S.predictOn,
      predict: S.predict.toArray().map((v) => +v.toFixed(1)), trail: S.trail.length,
      fate: S.fate?.kind ?? null, grounded: S.grounded, impacts: S.impacts };

    /* --- trail ------------------------------------------------------------ */
    const speed = ball.vel.length();
    if (ball.inFlight && speed > SP.trailSpeed && !S.fate) {
      S.trail.unshift(ball.pos.clone());
      while (S.trail.length > SP.trailFrames) S.trail.pop();
    } else if (S.trail.length) S.trail.pop();

    if (S.trail.length >= 3) {
      const pos = this.trail.geometry.attributes.position;
      const N = SP.trailFrames;
      for (let i = 0; i < N; i++) {
        const p = S.trail[Math.min(i, S.trail.length - 1)];
        const q = S.trail[Math.min(i + 1, S.trail.length - 1)];
        _dir.copy(q).sub(p);
        if (_dir.lengthSq() < 1e-8) _dir.set(0, 1, 0);
        _tmp.copy(cam.position).sub(p).normalize();
        _side.copy(_dir).cross(_tmp).normalize().multiplyScalar(r * (1 - i / (N + 1)) * 1.55 + 0.02);
        const k = N - 1 - i;      // u=1 is the head
        pos.setXYZ(k * 2, p.x + _side.x, p.y + _side.y, p.z + _side.z);
        pos.setXYZ(k * 2 + 1, p.x - _side.x, p.y - _side.y, p.z - _side.z);
      }
      pos.needsUpdate = true;
      this.trail.visible = true;
    }
  },
});

/* =============================================================================
 * 10. SCENARIOS — deterministic setups a critic can judge from a film strip
 * ========================================================================== */
function stage(seed, t = 1.79) {
  app.sim.reset(seed);
  app.clock.advance(t);
  app.sim.swing();
  app.clock.advance(0.06);
}

function launch(pos, vel, spin) {
  const b = app.sim.ball;
  b.pos.copy(pos); b.vel.copy(vel); b.spin.copy(spin || new THREE.Vector3());
  b.live = true; b.inFlight = true;
  app.sim.state.phase = 'in_play';
  app.sim.playT = 0;
  newPlay(b);
  S.trail.length = 0;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

registerScenario('carom_wall', {
  seed: 1925,
  setup: () => {
    stage(1925);
    // pulled hard down the right-hand side: off the brick above the cigar
    // store's awning, and back across the infield on one hop
    launch(V(0.6, 3.1, 1.5), V(56.5, 20.5, 67.0), V(-46, -30, 38));
    app.camera.position.set(-13.5, 13.0, -19.5);
    app.camera.lookAt(11.0, 9.0, 26.0);
  },
  settle: 0.80,
});

registerScenario('carom_fire_escape', {
  seed: 1931,
  setup: () => {
    stage(1931);
    // fouled off into the second-floor balcony of the cigar store: onto the
    // grating, through it, and down the drop ladder rung by rung
    launch(V(0.4, 3.2, 1.2), V(15.5, 46.7, 10.5), V(-10, 0, 18));
    app.camera.position.set(12.5, 17.5, 3.0);
    app.camera.lookAt(29.5, 12.6, 22.5);
  },
  settle: 2.62,
});

registerScenario('sewer_shot', {
  seed: 1927,
  setup: () => {
    stage(1927);
    // the boast the whole block is built on: clean past the second casting,
    // on the fly, two sewers, from the batter's own camera
    launch(V(0.0, 3.2, 1.5), V(5.5, 52.0, 103.0), V(-150, -18, 8));
    app.camera.position.set(0, 12, -34);
    app.camera.lookAt(0, 8, 40);
  },
  settle: 1.85,
});

registerScenario('down_the_sewer', {
  seed: 1929,
  setup: () => {
    stage(1929);
    // a grounder into the gutter, and the catch basin at the corner takes it
    launch(V(0.3, 2.4, 1.2), V(30.0, 4.0, 7.0), V(0, 0, -30));
    app.camera.position.set(9.0, 6.4, -6.5);
    app.camera.lookAt(20.4, 0.5, 8.0);
  },
  settle: 1.05,
});

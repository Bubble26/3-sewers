import * as THREE from 'three';

/**
 * The animation engine for the block's kids.
 *
 * Everything here is a *delta from the rig's rest pose*, which is what lets one mechanism do
 * three jobs at once: cross-fading between clips, stacking an additive fidget on top of an
 * idle, and letting gameplay code shove a joint around by hand.
 *
 *   const rig  = bindRig(buildKid(colors));      // adapts src/chars/rig.js into pivots
 *   const anim = new Animator(rig, CLIPS);
 *   anim.play('idle');                           // base layer, cross-faded
 *   anim.once('fidget_cap');                     // additive one-shot over the top
 *   anim.update(dt);                             // → rig.apply() → secondary motion
 *
 * The house style, straight out of docs/BYB-REFERENCE §5.1: a 12 fps *read* on a 60 fps
 * render. We buy that with easing shape rather than temporal quantisation — the `hold` and
 * `snap` curves sit on a pose for a third of a segment and then cross in four frames — so a
 * contact sheet shows distinct freezable poses while feet still track the ground continuously.
 * Clips that want a genuinely stuttery cartoon read (a bobble, an argument) ask for `fps: 12`.
 */

export const DEG = Math.PI / 180;
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export const EASE = {
  linear: (t) => t,
  sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inout: smoother,
  /** pose held ~28%, crosses in ~44%, holds again — the workhorse "cel" curve */
  hold: (t) => smoother(clamp01((t - 0.28) / 0.44)),
  /** a long hold and a four-frame cross: for snap-to poses */
  snap: (t) => smoother(clamp01((t - 0.58) / 0.24)),
  /** get there immediately, then sit on it */
  pop: (t) => smoother(clamp01(t / 0.26)),
  /** explosive out of the gate — swings, throws, whip */
  whip: (t) => 1 - Math.pow(1 - t, 4),
  /** loads slowly and then goes — anticipation into action */
  drive: (t) => t * t * t,
  /** overshoot and come back: follow-through */
  back: (t) => { const s = 1.85, u = t - 1; return u * u * ((s + 1) * u + s) + 1; },
  /** dip the wrong way first: anticipation */
  antic: (t) => { const s = 1.7; return t * t * ((s + 1) * t - s); },
  /** damped wobble into the destination */
  settle: (t) => 1 - Math.cos(t * 9.4) * Math.exp(-5.2 * t) * (1 - t),
  step: (t) => (t < 1 ? 0 : 1),
};

// ── clip format ─────────────────────────────────────────────────────────────
// A pose is { jointName: [rx,ry,rz] } in degrees, or the long form
// { rx,ry,rz, px,py,pz, sx,sy,sz }. Rotations are degrees, positions are feet,
// scales are additive deltas around 1 (sy:-0.15 ⇒ 85% height).
const CHN = 9;
const ZERO = new Float64Array(CHN);

function normPose(p) {
  const out = {};
  for (const k in p) {
    const v = p[k];
    const a = new Float64Array(CHN);
    if (Array.isArray(v)) {
      a[0] = (v[0] || 0) * DEG; a[1] = (v[1] || 0) * DEG; a[2] = (v[2] || 0) * DEG;
    } else {
      a[0] = (v.rx || 0) * DEG; a[1] = (v.ry || 0) * DEG; a[2] = (v.rz || 0) * DEG;
      a[3] = v.px || 0; a[4] = v.py || 0; a[5] = v.pz || 0;
      a[6] = v.sx || 0; a[7] = v.sy || 0; a[8] = v.sz || 0;
    }
    out[k] = a;
  }
  return out;
}

export function clip(name, def) {
  const raw = (def.keys || []).slice().sort((a, b) => a.t - b.t);
  if (!raw.length) throw new Error(`clip "${name}" has no keys`);
  const keys = raw.map((k) => ({ t: k.t, ease: k.ease || def.ease || 'hold', pose: normPose(k.pose || {}) }));
  const dur = Math.max(def.dur ?? keys[keys.length - 1].t, 1e-3);
  const segs = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    const names = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]);
    segs.push({
      t0: a.t, t1: b.t, span: b.t - a.t, ease: b.ease,
      joints: [...names].map((n) => ({ name: n, a: a.pose[n] || ZERO, b: b.pose[n] || ZERO })),
    });
  }
  if (!segs.length) {
    const a = keys[0];
    segs.push({ t0: 0, t1: dur, span: 0, ease: 'linear', joints: Object.keys(a.pose).map((n) => ({ name: n, a: a.pose[n], b: a.pose[n] })) });
  }
  return { name, dur, loop: !!def.loop, fps: def.fps || 0, segs, meta: def.meta || {}, events: def.events || [] };
}

/** Accumulate one clip's contribution into `acc` at weight `w`. */
export function sample(cl, time, w, acc) {
  if (!cl || w <= 1e-4) return;
  let t = cl.loop ? ((time % cl.dur) + cl.dur) % cl.dur : (time < 0 ? 0 : time > cl.dur ? cl.dur : time);
  if (cl.fps > 0) t = Math.floor(t * cl.fps + 1e-6) / cl.fps;
  const segs = cl.segs;
  let s = segs[segs.length - 1];
  for (let i = 0; i < segs.length; i++) { if (t < segs[i].t1 || i === segs.length - 1) { s = segs[i]; break; } }
  const u = s.span > 0 ? clamp01((t - s.t0) / s.span) : 1;
  const e = (EASE[s.ease] || EASE.hold)(u);
  for (let i = 0; i < s.joints.length; i++) {
    const j = s.joints[i];
    let d = acc[j.name];
    if (!d) d = acc[j.name] = new Float64Array(CHN);
    const a = j.a, b = j.b;
    for (let c = 0; c < CHN; c++) d[c] += (a[c] + (b[c] - a[c]) * e) * w;
  }
}

// ── secondary motion ────────────────────────────────────────────────────────
const _wp = new THREE.Vector3();
const _off = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tmp = new THREE.Vector3();

/**
 * A jiggle bone. Tracks its pivot's world position with a spring; the lag becomes a rotation.
 * This is what makes a cap brim, a shirttail, a hair tuft and the tip of a broom handle
 * arrive two to four frames after the body does.
 */
class Jiggle {
  constructor(obj, { k = 150, damp = 13, gain = 2.2, max = 0.75, sign = 1 } = {}) {
    this.obj = obj; this.k = k; this.damp = damp; this.gain = gain; this.max = max; this.sign = sign;
    this.spring = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.ready = false;
  }
  reset() { this.ready = false; this.vel.set(0, 0, 0); }
  update(dt) {
    const o = this.obj;
    _wp.setFromMatrixPosition(o.matrixWorld);
    if (!this.ready) { this.spring.copy(_wp); this.ready = true; return; }
    // semi-implicit spring, stepped so a big dt cannot explode it
    const steps = dt > 1 / 45 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      _tmp.copy(_wp).sub(this.spring).multiplyScalar(this.k * h);
      this.vel.add(_tmp).multiplyScalar(Math.max(0, 1 - this.damp * h));
      this.spring.addScaledVector(this.vel, h);
    }
    _off.copy(this.spring).sub(_wp);
    if (_off.lengthSq() > 16) _off.setLength(4);
    o.parent.getWorldQuaternion(_q).invert();
    _off.applyQuaternion(_q);
    const m = this.max;
    const rx = THREE.MathUtils.clamp(-_off.z * this.gain * this.sign, -m, m);
    const rz = THREE.MathUtils.clamp(_off.x * this.gain * this.sign, -m, m);
    o.rotation.x += rx;
    o.rotation.z += rz;
  }
}


const _qp = new THREE.Quaternion();
const _qd = new THREE.Quaternion();
const _qi = new THREE.Quaternion();

/**
 * Rotational overlap: a joint that arrives a few frames after its parent. This is what stops a
 * head from being welded to a spine and a cap from being welded to a head.
 */
class QLag {
  constructor(obj, { k = 26, max = 0.22 } = {}) {
    this.obj = obj; this.k = k; this.max = max;
    this.s = new THREE.Quaternion(); this.ready = false;
  }
  reset() { this.ready = false; }
  update(dt) {
    const p = this.obj.parent;
    if (!p) return;
    p.getWorldQuaternion(_qp);
    if (!this.ready) { this.s.copy(_qp); this.ready = true; return; }
    this.s.slerp(_qp, 1 - Math.exp(-this.k * Math.min(dt, 0.05)));
    _qd.copy(_qp).invert().multiply(this.s);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(_qd.w)));
    if (ang > this.max && ang > 1e-5) { _qi.identity(); _qd.slerp(_qi, 1 - this.max / ang); }
    this.obj.quaternion.premultiply(_qd);
  }
}

/**
 * A ribbon that trails a moving prop — the whip of the broom handle through the swing.
 * Two vertices per sample (a point up the shaft and the tip), faded by age, so the arc reads
 * as a smear rather than a line. Opacity is driven by how fast the tip is actually moving,
 * so it only appears when there is something to smear.
 */
export class Trail {
  constructor(parent, { samples = 16, color = 0xf6f0e2 } = {}) {
    this.n = samples;
    this.pts = new Float32Array(samples * 6);
    this.inner = new Float32Array(samples * 3);
    this.geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(samples * 2 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(samples * 2 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('color', this.col);
    const idx = [];
    for (let i = 0; i < samples - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      idx.push(a, b, c, b, d, c);
    }
    this.geo.setIndex(idx);
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
      side: THREE.DoubleSide, blending: THREE.NormalBlending, color, fog: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.hist = Array.from({ length: samples }, () => ({ a: new THREE.Vector3(), b: new THREE.Vector3() }));
    this.filled = 0;
    this.strength = 0;
    this.base = new THREE.Color(color);
  }
  clear() { this.filled = 0; this.strength = 0; this.mesh.visible = false; }
  /** push one sample; `a` is up the shaft, `b` is the tip, both in world space */
  push(a, b, strength) {
    for (let i = this.n - 1; i > 0; i--) { this.hist[i].a.copy(this.hist[i - 1].a); this.hist[i].b.copy(this.hist[i - 1].b); }
    this.hist[0].a.copy(a); this.hist[0].b.copy(b);
    this.filled = Math.min(this.filled + 1, this.n);
    this.strength = strength;
  }
  update() {
    if (this.filled < 3 || this.strength <= 0.02) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const p = this.pos.array, c = this.col.array;
    const inv = this.mesh.parent.matrixWorld;
    const m = new THREE.Matrix4().copy(inv).invert();
    for (let i = 0; i < this.n; i++) {
      const h = this.hist[Math.min(i, this.filled - 1)];
      _tmp.copy(h.a).applyMatrix4(m); p[i * 6 + 0] = _tmp.x; p[i * 6 + 1] = _tmp.y; p[i * 6 + 2] = _tmp.z;
      _tmp.copy(h.b).applyMatrix4(m); p[i * 6 + 3] = _tmp.x; p[i * 6 + 4] = _tmp.y; p[i * 6 + 5] = _tmp.z;
      const age = 1 - i / (this.n - 1);
      const f = age * age;
      c[i * 6 + 0] = this.base.r * f; c[i * 6 + 1] = this.base.g * f; c[i * 6 + 2] = this.base.b * f;
      c[i * 6 + 3] = this.base.r * f * 0.55; c[i * 6 + 4] = this.base.g * f * 0.55; c[i * 6 + 5] = this.base.b * f * 0.55;
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.mat.opacity = Math.min(0.46, this.strength);
  }
}

// ── the rig adapter ─────────────────────────────────────────────────────────
/**
 * Canonical joint names every clip may address. These are OUR names; `bindRig` maps them onto
 * whatever src/chars/rig.js is publishing today (it publishes `userData.rig` with its own
 * naming, and `userData.attach` for props), so the character piece can keep rebuilding the
 * body without touching a single clip.
 *
 *   base                     whole-body handle: lift, spin, squash/stretch
 *   hips chest neck head     spine  (chest is the waist bend, so a turn there twists the torso)
 *   armL elbL handL          arms, L = +X side       ... armR elbR handR
 *   legL kneeL footL         legs                    ... legR kneeR footR
 *   cap crutch               secondary elements, also spring-driven
 *   grip stick stickTip      the broom handle, when the kid is carrying one
 *
 * Limbs rest pointing down -Y. A NEGATIVE rx swings a limb forward (+Z) — so elbows bend
 * negative and knees bend positive — and a POSITIVE rz swings it out toward +X.
 */
export class Rig {
  constructor(root) {
    this.root = root;
    this.joints = new Map();
    this.jiggles = [];
    this.height = 4.9;
    this.posScale = 1;
    /**
     * +1 when the rig's face is on -Z (the convention every clip in clips.js is authored for),
     * -1 when it is on +Z. Detected from the geometry at bind time and applied to the rx / ry /
     * pz channels, so the character piece can flip its kids round without breaking a clip.
     */
    this.mirror = 1;
    this.acc = {};
  }
  bind(name, obj) {
    if (!obj) return null;
    this.joints.set(name, { obj, rp: obj.position.clone(), rr: obj.rotation.clone(), rs: obj.scale.clone() });
    return obj;
  }
  get(name) { const j = this.joints.get(name); return j ? j.obj : null; }
  addJiggle(name, cfg) { const o = this.get(name); if (o) this.jiggles.push(new Jiggle(o, cfg)); }
  addLag(name, cfg) { const o = this.get(name); if (o) this.jiggles.push(new QLag(o, cfg)); }
  resetSprings() { for (const j of this.jiggles) j.reset(); }
  clearAcc() {
    for (const k in this.acc) { const a = this.acc[k]; for (let i = 0; i < CHN; i++) a[i] = 0; }
    return this.acc;
  }
  apply(acc) {
    const ps = this.posScale, mz = this.mirror;
    for (const [name, j] of this.joints) {
      const a = acc[name];
      const o = j.obj;
      if (a) {
        o.position.set(j.rp.x + a[3] * ps, j.rp.y + a[4] * ps, j.rp.z + a[5] * ps * mz);
        o.rotation.set(j.rr.x + a[0] * mz, j.rr.y + a[1] * mz, j.rr.z + a[2], j.rr.order);
        o.scale.set(j.rs.x * (1 + a[6]), j.rs.y * (1 + a[7]), j.rs.z * (1 + a[8]));
      } else {
        o.position.copy(j.rp); o.rotation.copy(j.rr); o.scale.copy(j.rs);
      }
    }
  }
  updateSecondary(dt) { if (Rig.SECONDARY_OFF) return; for (const j of this.jiggles) j.update(dt); }

  /** Put both mitts on the handle. No-op for a kid who is not carrying one. */
  solveHands() {
    const ik = this.handIK;
    const stick = this.get('stick');
    if (!ik || !stick || !stick.visible) return;
    stick.updateWorldMatrix(true, false);
    for (const side of ['L', 'R']) {
      const sh = this.get('arm' + side), elb = this.get('elb' + side), hand = this.get('hand' + side);
      if (!sh || !elb || !hand) continue;
      const up = side === 'L' ? ik.lo : ik.hi;
      _t2.set(0, up, 0).applyMatrix4(stick.matrixWorld);
      const S = side === 'L' ? -1 : 1;
      _t3.set(S * ik.pole, -ik.pole * 0.8, -ik.pole * 0.55 * this.mirror);
      sh.parent.updateWorldMatrix(true, false);
      _t3.applyMatrix4(sh.parent.matrixWorld);
      solveTwoBone(sh, elb, hand, _t2, _t3);
    }
  }
}

/**
 * The neutral the clips are authored against — BYB's "ready": arms a little out, elbows soft,
 * knees soft, feet turned out. The rig ships each kid in a *characterful* rest pose (hands on
 * hips, arms crossed, scratching), which is exactly right for a still and exactly wrong as a
 * base for a run cycle, so animated kids get neutralised here. Their per-kid head quirk is
 * kept at half strength, because that one is character rather than pose.
 * Names below are OUR names: L is the -X side.
 */
const NEUTRAL = {
  armL: [0.10, 0, -0.26], armR: [0.10, 0, 0.26],
  elbL: [-0.20, 0, 0.08], elbR: [-0.20, 0, -0.08],
  handL: [0, 0, 0], handR: [0, 0, 0],
  legL: [0, -0.20, -0.15], legR: [0, 0.20, 0.15],
  kneeL: [0, 0, 0], kneeR: [0, 0, 0], footL: [0, 0, 0], footR: [0, 0, 0],
  chest: [-0.03, 0, 0], neck: [0, 0, 0],
};

const _bb = new THREE.Vector3();
let FACE_SIGN = 1;
/**
 * Which way is the kid's face? Read it off the geometry rather than trusting a convention: the
 * face decal is the one piece of a kid that is unambiguously on the front. Falls back to the
 * boots, which point the same way, and then to the house default.
 */
function detectFacing(rig) {
  const head = rig.get('head');
  const probe = (o) => {
    if (!o || !o.geometry) return 0;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    o.geometry.boundingBox.getCenter(_bb);
    return Math.abs(_bb.z) > 1e-3 ? Math.sign(_bb.z) : 0;
  };
  let z = 0;
  if (head) head.traverse((o) => { if (!z && o.isMesh && o.name === 'face') z = probe(o); });
  if (!z) {
    const f = rig.get('footL');
    if (f) f.traverse((o) => { if (!z && o.isMesh) z = probe(o); });
  }
  FACE_SIGN = z > 0 ? -1 : 1;
  return FACE_SIGN;
}

/** +1 when kids face -Z (clip-space forward), -1 when they face +Z. */
export function faceMirror() { return FACE_SIGN; }
/** The yaw that turns a kid at (x,z) to look along (dx,dz), whichever way the rig faces. */
export function headingTo(dx, dz) {
  return FACE_SIGN > 0 ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz);
}

/** Older/other rigs that publish a flat part map instead of `userData.joints`. */
const FALLBACK = {
  base: 'root', hips: 'hips', chest: 'torso', neck: 'neck', head: 'head', brim: 'cap', crutch: 'crutch',
  armL: 'armR', armR: 'armL', elbL: 'foreR', elbR: 'foreL', handL: 'handR', handR: 'handL',
  legL: 'legR', legR: 'legL', kneeL: 'shinR', kneeR: 'shinL', footL: 'footR', footR: 'footL',
};

const JOINT_NAMES = ['base', 'hips', 'chest', 'neck', 'head', 'brim', 'hair', 'shirt', 'crutch',
  'armL', 'armR', 'elbL', 'elbR', 'handL', 'handR',
  'legL', 'legR', 'kneeL', 'kneeR', 'footL', 'footR'];

/**
 * Adopt whatever skeleton src/chars/rig.js is publishing today. `userData.joints` is the
 * contract (canonical names, L = -X); `userData.parts` / `userData.rig` are accepted as a
 * fallback so this file keeps working if the character piece is mid-rebuild.
 */
export function bindRig(kid, opts = {}) {
  if (kid.userData.animRig) return kid.userData.animRig;
  const rig = new Rig(kid);
  const ud = kid.userData;
  const met = ud.metrics || {};
  const joints = ud.joints;
  const parts = ud.parts || ud.rig;

  if (joints) {
    for (const n of JOINT_NAMES) if (joints[n]) rig.bind(n, joints[n]);
  } else if (parts) {
    for (const n of JOINT_NAMES) { const t = FALLBACK[n]; if (t && parts[t]) rig.bind(n, parts[t]); }
  }
  if (!rig.get('base')) {
    // last resort: interpose our own handle so root motion never fights placement
    const b = new THREE.Group();
    b.name = 'animBase';
    while (kid.children.length) b.add(kid.children[0]);
    kid.add(b);
    rig.bind('base', b);
  }
  rig.mirror = detectFacing(rig);
  // neutralise the rest pose, then re-capture rest so clips read as authored
  for (const n in NEUTRAL) {
    const j = rig.joints.get(n);
    if (!j) continue;
    const v = NEUTRAL[n];
    j.obj.rotation.set(v[0] * rig.mirror, v[1] * rig.mirror, v[2]);
    j.rr.copy(j.obj.rotation);
  }
  const hd = rig.joints.get('head');
  if (hd) { hd.obj.rotation.set(hd.rr.x * 0.5, hd.rr.y * 0.5, hd.rr.z * 0.5); hd.rr.copy(hd.obj.rotation); }

  rig.height = met.tall || 4.9;
  rig.headH = met.headH || rig.height / 3.2;
  rig.posScale = rig.height / 4.9;
  rig.spec = ud.spec || null;

  // ── overlap: every kid carries at least one element that arrives late ──
  // The cap lag is deliberately small: these heads are 30% of the kid and the brim is wide,
  // so anything past ~8 degrees of forward tilt puts the brim across the eyes.
  rig.addLag('brim', { k: 17, max: 0.13 });
  rig.addLag('head', { k: 24, max: 0.13 });
  rig.addLag('chest', { k: 34, max: 0.10 });
  rig.addJiggle('hair', { k: 130, damp: 11, gain: 2.2, max: 0.8 });
  rig.addJiggle('shirt', { k: 105, damp: 10, gain: 2.0, max: 0.7 });
  if (rig.get('crutch')) rig.addJiggle('crutch', { k: 150, damp: 13, gain: 1.1, max: 0.4 });

  kid.userData.animRig = rig;
  return rig;
}

function inkShell(geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -1;
  return m;
}

const _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3(), _t3 = new THREE.Vector3();
const _t4 = new THREE.Vector3(), _t5 = new THREE.Vector3(), _t6 = new THREE.Vector3();
const _m1 = new THREE.Matrix4();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Analytic two-bone IK. The broom handle is authored in body space — which is the only way to
 * get a swing arc that actually reads — and the hands are then solved onto it, so the kid is
 * genuinely holding the stick in every frame instead of approximately holding it in most.
 */
function solveTwoBone(sh, elb, hand, targetWorld, poleWorld) {
  const parent = sh.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  _m1.copy(parent.matrixWorld).invert();
  const P = _t1.copy(sh.position);
  const T = _t2.copy(targetWorld).applyMatrix4(_m1);
  const pole = _t3.copy(poleWorld).applyMatrix4(_m1).sub(P);
  const l1 = Math.abs(elb.position.y) || 1;
  const l2 = Math.abs(hand.position.y) || 1;
  const v = _t4.copy(T).sub(P);
  let d = v.length();
  if (d < 1e-5) { v.set(0, -1, 0); d = 1; }
  d = clampN(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  v.setLength(d);
  const phi = Math.acos(clampN((d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
  const hy = -l1 - l2 * Math.cos(phi), hz = l2 * Math.sin(phi);
  const hn = _t5.set(0, hy, hz).normalize();
  const vn = _t6.copy(v).normalize();
  _qa.setFromUnitVectors(hn, vn);
  // twist about the target direction so the elbow ends up on the pole side
  _t5.set(0, -l1, 0).applyQuaternion(_qa);
  _t5.addScaledVector(vn, -_t5.dot(vn));
  _t3.addScaledVector(vn, -_t3.dot(vn));
  if (_t5.lengthSq() > 1e-7 && _t3.lengthSq() > 1e-7) {
    _t5.normalize(); _t3.normalize();
    const ang = Math.atan2(_t1.crossVectors(_t5, _t3).dot(vn), _t5.dot(_t3));
    _qb.setFromAxisAngle(vn, ang);
    _qa.premultiply(_qb);
  }
  sh.quaternion.copy(_qa);
  elb.rotation.set(-phi, 0, 0);
}

/**
 * Hang a broom handle in front of the kid's chest, in two pieces so the tip can lag the grip.
 * That lag is the whip. The shaft angle is a clip channel (`grip`), and both hands are IK'd
 * onto the handle every frame by `Rig.solveHands()`.
 */
export function attachStick(rig, o = {}) {
  if (rig.get('stick')) return rig.get('stick');
  const armL = rig.get('armL');
  const girdle = (armL && armL.parent) || rig.get('chest');
  if (!girdle) return null;
  const shX = armL ? Math.abs(armL.position.x) : rig.headH * 0.45;
  const shY = armL ? armL.position.y : rig.headH * 0.9;
  const length = o.length || rig.height * 0.84;
  const wood = o.color === undefined ? 0xb09468 : o.color;
  const tape = o.tape === undefined ? 0x4a4038 : o.tape;
  const ink = o.ink === undefined ? 0x2a1d1a : o.ink;
  const woodMat = new THREE.MeshBasicMaterial({ color: wood, toneMapped: false });
  const tapeMat = new THREE.MeshBasicMaterial({ color: tape, toneMapped: false });
  const inkMat = new THREE.MeshBasicMaterial({ color: ink, side: THREE.BackSide, toneMapped: false });

  const grip = new THREE.Group();
  grip.name = 'grip';
  // Kids face -Z, so the hands go in front; keep them at chest height or the mitts and the
  // handle end up parked across the face, which at this head size hides the whole performance.
  grip.position.set(-shX * 0.9, shY * 0.06, -shX * 1.15 * rig.mirror);
  girdle.add(grip);
  const stick = new THREE.Group(); stick.name = 'stick'; grip.add(stick);
  const half = length * 0.5;
  const r0 = length * 0.034, r1 = length * 0.027, ow = length * 0.013;

  const seg = (parent, rBot, rTop, len, y) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, 9);
    g.translate(0, y, 0);
    parent.add(new THREE.Mesh(g, woodMat));
    const gs = new THREE.CylinderGeometry(rTop + ow, rBot + ow, len + ow * 2, 9);
    gs.translate(0, y, 0);
    parent.add(inkShell(gs, inkMat));
  };
  seg(stick, r0, r1 * 1.05, half, half * 0.5);
  const tip = new THREE.Group(); tip.name = 'stickTip'; tip.position.y = half; stick.add(tip);
  seg(tip, r1 * 1.05, r1 * 0.88, half, half * 0.5);

  const wrapG = new THREE.CylinderGeometry(r0 * 1.3, r0 * 1.3, length * 0.26, 9);
  wrapG.translate(0, length * 0.09, 0);
  stick.add(new THREE.Mesh(wrapG, tapeMat));
  const wrapS = new THREE.CylinderGeometry(r0 * 1.3 + ow, r0 * 1.3 + ow, length * 0.26 + ow, 9);
  wrapS.translate(0, length * 0.09, 0);
  stick.add(inkShell(wrapS, inkMat));
  const knobG = new THREE.SphereGeometry(r0 * 1.6, 9, 7);
  knobG.scale(1, 0.7, 1);
  knobG.translate(0, -length * 0.05, 0);
  stick.add(new THREE.Mesh(knobG, tapeMat));
  const knobS = new THREE.SphereGeometry(r0 * 1.6 + ow, 9, 7);
  knobS.scale(1, 0.7, 1);
  knobS.translate(0, -length * 0.05, 0);
  stick.add(inkShell(knobS, inkMat));

  rig.bind('grip', grip); rig.bind('stick', stick); rig.bind('stickTip', tip);
  rig.addJiggle('stickTip', { k: 300, damp: 19, gain: 0.62, max: 0.34 });
  rig.stickLength = length;
  rig.handIK = { lo: length * 0.09, hi: length * 0.3, pole: shX * 2.2 };
  return stick;
}

// ── the animator ────────────────────────────────────────────────────────────
/**
 * Two-layer playback: a cross-faded base layer (idle → run → stance) and any number of
 * additive one-shots stacked over the top (a fidget, a flinch, a waggle). Additive layers
 * carry their own in/out envelope so a fidget breathes into an idle instead of popping.
 */
export class Animator {
  constructor(rig, clips) {
    this.rig = rig;
    this.clips = clips;
    this.cur = null; this.prev = null;
    this.t = 0; this.prevT = 0;
    this.fade = 1; this.fadeDur = 0.14;
    this.speed = 1;
    this.layers = [];
    this.onEvent = null;
    this._lastT = 0;
  }
  has(name) { return !!this.clips[name]; }
  /** Cross-fade the base layer to `name`. Returns the clip. */
  play(name, o = {}) {
    const cl = this.clips[name];
    if (!cl) return null;
    if (this.cur === cl && !o.restart) { if (o.speed !== undefined) this.speed = o.speed; return cl; }
    this.prev = this.cur; this.prevT = this.t;
    this.cur = cl; this.t = o.at || 0; this._lastT = this.t;
    this.fade = 0;
    this.fadeDur = o.fade === undefined ? 0.13 : Math.max(1e-3, o.fade);
    this.speed = o.speed === undefined ? 1 : o.speed;
    return cl;
  }
  /** Stack an additive one-shot over the base layer. */
  once(name, o = {}) {
    const cl = this.clips[name];
    if (!cl) return null;
    if (!o.stack && this.layers.some((l) => l.clip === cl)) return null;
    const lay = {
      clip: cl, t: 0, amp: o.amp === undefined ? 1 : o.amp,
      inT: o.in === undefined ? 0.11 : o.in,
      outT: o.out === undefined ? 0.16 : o.out,
      speed: o.speed === undefined ? 1 : o.speed,
      life: o.life === undefined ? cl.dur : o.life,
      w: 0,
    };
    this.layers.push(lay);
    return lay;
  }
  stopLayers() { this.layers.length = 0; }
  /** Progress of the base clip, 0..1, unlooped. */
  get phase() { return Math.min(1, this.t / this.cur.dur); }
  set phase(u) { this.t = u * (this.cur ? this.cur.dur : 1); }
  get finished() { return !this.cur || (!this.cur.loop && this.t >= this.cur.dur); }

  update(dt) {
    if (!this.cur) return;
    const step = dt * this.speed;
    this._lastT = this.t;
    this.t += step;
    this.prevT += dt;
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / this.fadeDur);
    const acc = this.rig.clearAcc();
    if (this.prev && this.fade < 1) sample(this.prev, this.prevT, 1 - this.fade, acc);
    sample(this.cur, this.t, this.fade, acc);
    if (this.fade >= 1) this.prev = null;

    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      l.t += dt * l.speed;
      const a = Math.min(1, l.t / Math.max(1e-3, l.inT));
      const b = Math.min(1, Math.max(0, (l.life - l.t) / Math.max(1e-3, l.outT)));
      l.w = smoother(clamp01(Math.min(a, b))) * l.amp;
      if (l.t > l.life + l.outT) { this.layers.splice(i, 1); continue; }
      sample(l.clip, l.t, l.w, acc);
    }
    this.fireEvents();
    this.rig.apply(acc);
    return acc;
  }
  fireEvents() {
    const cl = this.cur;
    if (!cl.events.length || !this.onEvent) return;
    const a = this._lastT, b = this.t;
    if (cl.loop) {
      const d = cl.dur, m = ((a % d) + d) % d, n = m + (b - a);
      for (const e of cl.events) { if ((e.t > m && e.t <= n) || (e.t + d > m && e.t + d <= n)) this.onEvent(e.name, e); }
    } else {
      for (const e of cl.events) if (e.t > a && e.t <= b) this.onEvent(e.name, e);
    }
  }
}

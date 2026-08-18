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
      vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.NormalBlending, color,
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
    this.mat.opacity = Math.min(0.62, this.strength);
  }
}

// ── the rig adapter ─────────────────────────────────────────────────────────
/**
 * Canonical joint names every clip may address:
 *
 *   base                     whole-body offset, spin and squash/stretch
 *   hips chest neck head     spine
 *   armL elbL handL          left arm (rig's -X side)     ... and armR elbR handR
 *   legL kneeL footL         left leg                     ... and legR kneeR footR
 *   brim hair shirt          secondary elements (also driven by springs)
 *   grip stick stickTip      the broom handle, when the kid is carrying one
 *
 * Limbs rest pointing down -Y, so a *negative* rx swings a limb forward (+Z) and a positive
 * rz swings it out to +X.
 */
export class Rig {
  constructor(root) {
    this.root = root;
    this.joints = new Map();
    this.jiggles = [];
    this.height = 4.9;
    this.hipY = 1.8;
    this.acc = {};
  }
  bind(name, obj) {
    if (!obj) return obj;
    this.joints.set(name, { obj, rp: obj.position.clone(), rr: obj.rotation.clone(), rs: obj.scale.clone() });
    return obj;
  }
  get(name) { const j = this.joints.get(name); return j ? j.obj : null; }
  addJiggle(name, cfg) { const o = this.get(name); if (o) this.jiggles.push(new Jiggle(o, cfg)); }
  resetSprings() { for (const j of this.jiggles) j.reset(); }
  clearAcc() {
    for (const k in this.acc) { const a = this.acc[k]; for (let i = 0; i < CHN; i++) a[i] = 0; }
    return this.acc;
  }
  apply(acc) {
    for (const [name, j] of this.joints) {
      const a = acc[name];
      const o = j.obj;
      if (a) {
        o.position.set(j.rp.x + a[3], j.rp.y + a[4], j.rp.z + a[5]);
        o.rotation.set(j.rr.x + a[0], j.rr.y + a[1], j.rr.z + a[2], j.rr.order);
        o.scale.set(j.rs.x * (1 + a[6]), j.rs.y * (1 + a[7]), j.rs.z * (1 + a[8]));
      } else {
        o.position.copy(j.rp); o.rotation.copy(j.rr); o.scale.copy(j.rs);
      }
    }
  }
  updateSecondary(dt) { for (const j of this.jiggles) j.update(dt); }
}

const capLen = (m) => { const p = m && m.geometry && m.geometry.parameters; return p ? (p.length || 0) + 2 * (p.radius || 0) : 0; };
const capRad = (m) => { const p = m && m.geometry && m.geometry.parameters; return p ? (p.radius || 0.19) : 0.19; };
const isCapsule = (m) => !!(m && m.isMesh && m.geometry && m.geometry.type === 'CapsuleGeometry');

function pivot(parent, name, x, y, z, order) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  if (order) g.rotation.order = order;
  parent.add(g);
  return g;
}

/** Re-cut a capsule mesh to a given pivot-to-pivot length, hanging from y=0 down -Y. */
function segment(mesh, len, r) {
  const g = new THREE.CapsuleGeometry(r, Math.max(0.02, len - 2 * r), 4, 10);
  if (mesh.geometry) mesh.geometry.dispose();
  mesh.geometry = g;
  mesh.position.set(0, -len / 2, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  return mesh;
}

const matOf = (m, fallback) => (m && m.material ? m.material : new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.85 }));
const colorOf = (m, fallback) => (m && m.material && m.material.color ? m.material.color.getHex() : fallback);

/**
 * Turn whatever src/chars/rig.js handed us into an articulated skeleton.
 *
 * If a future rig publishes `userData.joints` we adopt it wholesale and touch nothing. The
 * fallback path adapts the flat capsule rig: it splits each limb capsule at the elbow/knee,
 * hangs everything off hip and chest pivots, and adds the four things a run cycle cannot be
 * read without — mitts, boots, a cap brim and a shirttail.
 */
export function bindRig(kid, opts = {}) {
  if (kid.userData.rig) return kid.userData.rig;
  const rig = new Rig(kid);
  const ud = kid.userData;

  if (ud.joints) {
    for (const k in ud.joints) rig.bind(k, ud.joints[k]);
    if (!rig.get('base')) rig.bind('base', kid);
    kid.userData.rig = rig;
    return rig;
  }

  const head = ud.head || null;
  const armLm = ud.armL || null, armRm = ud.armR || null;
  const legLm = ud.legL || null, legRm = ud.legR || null;
  let torso = null;
  for (const c of kid.children) {
    if (c.isMesh && c !== head && c !== armLm && c !== armRm && c !== legLm && c !== legRm) { torso = c; break; }
  }

  const armLen = armLm ? capLen(armLm) : 1.28;
  const armR_ = armLm ? capRad(armLm) : 0.19;
  const legLen0 = legLm ? capLen(legLm) : 1.48;
  const legR_ = legLm ? capRad(legLm) : 0.19;
  const shoulderY = armLm ? armLm.position.y + armLen / 2 : 3.04;
  const shoulderX = armLm ? Math.abs(armLm.position.x) : 0.8;
  const hipY = legLm ? legLm.position.y + legLen0 / 2 : 1.79;
  const hipX = legLm ? Math.abs(legLm.position.x) : 0.32;
  const headY = head ? head.position.y : 3.9;
  const headR = (head && head.geometry && head.geometry.parameters && head.geometry.parameters.radius) || 1.05;
  const bootH = 0.24;
  const legLen = Math.max(0.8, hipY - bootH);           // long enough that the boots reach the road

  rig.hipY = hipY;
  rig.height = headY + headR;

  const skin = colorOf(head, 0xe8b48c);
  const shirtCol = colorOf(torso, 0xc94f3d);
  const capMesh = head ? head.children.find((c) => c.isMesh) : null;
  const capCol = colorOf(capMesh, 0x2b3a55);

  // --- spine -----------------------------------------------------------------
  const base = pivot(kid, 'base', 0, 0, 0, 'YXZ');
  const hips = pivot(base, 'hips', 0, hipY, 0, 'YXZ');
  const chest = pivot(hips, 'chest', 0, 0, 0, 'YXZ');
  const neck = pivot(chest, 'neck', 0, shoulderY - hipY + 0.08, 0, 'YXZ');
  rig.bind('base', base); rig.bind('hips', hips); rig.bind('chest', chest); rig.bind('neck', neck);

  if (torso) { chest.add(torso); torso.position.set(0, torso.position.y - hipY, 0); }

  const headPivot = pivot(neck, 'head', 0, 0, 0, 'YXZ');
  rig.bind('head', headPivot);
  if (head) { headPivot.add(head); head.position.set(0, headY - hipY - (shoulderY - hipY + 0.08), 0); }

  // --- cap brim: the primary overlap element -------------------------------
  let brim = null;
  if (head) {
    brim = pivot(head, 'brim', 0, 0.16, 0.46, 'YXZ');
    const bm = new THREE.Mesh(
      new THREE.BoxGeometry(headR * 1.42, 0.13, headR * 0.86),
      matOf(capMesh, capCol),
    );
    bm.position.set(0, 0, headR * 0.42);
    bm.castShadow = true;
    brim.add(bm);
    rig.bind('brim', brim);

    const hair = pivot(head, 'hair', 0, -0.05, -headR * 0.62, 'YXZ');
    const hm = new THREE.Mesh(new THREE.SphereGeometry(headR * 0.34, 10, 8), new THREE.MeshStandardMaterial({ color: opts.hair || 0x4a3226, roughness: 0.95 }));
    hm.scale.set(1.25, 0.72, 0.75);
    hm.position.set(0, -0.12, -0.1);
    hm.castShadow = true;
    hair.add(hm);
    rig.bind('hair', hair);
  }

  // --- shirttail: the second overlap element -------------------------------
  const shirt = pivot(hips, 'shirt', 0, 0.34, -0.34, 'YXZ');
  const sm = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.66, 0.14), matOf(torso, shirtCol));
  sm.position.set(0, -0.3, 0);
  sm.castShadow = true;
  shirt.add(sm);
  rig.bind('shirt', shirt);

  // --- arms ------------------------------------------------------------------
  const handMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.88 });
  const bootMat = new THREE.MeshStandardMaterial({ color: opts.boot || 0x3b2a20, roughness: 0.75 });
  const buildArm = (side, mesh) => {
    const S = side === 'L' ? -1 : 1;
    const sh = pivot(chest, 'arm' + side, S * shoulderX, shoulderY - hipY, 0);
    const half = armLen / 2;
    let upper = mesh;
    if (isCapsule(mesh)) { sh.add(mesh); segment(mesh, half, armR_); }
    else { upper = new THREE.Mesh(new THREE.CapsuleGeometry(armR_, half - 2 * armR_, 4, 10), new THREE.MeshStandardMaterial({ color: skin, roughness: 0.88 })); upper.position.y = -half / 2; upper.castShadow = true; sh.add(upper); }
    const elb = pivot(sh, 'elb' + side, 0, -half, 0);
    const fore = new THREE.Mesh(upper.geometry, upper.material);
    fore.position.set(0, -half / 2, 0);
    fore.castShadow = true;
    elb.add(fore);
    const hand = pivot(elb, 'hand' + side, 0, -half, 0);
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(armR_ * 1.75, 10, 8), handMat);
    mitt.scale.set(1, 1.12, 0.82);
    mitt.position.y = -armR_ * 0.9;
    mitt.castShadow = true;
    hand.add(mitt);
    rig.bind('arm' + side, sh); rig.bind('elb' + side, elb); rig.bind('hand' + side, hand);
  };
  buildArm('L', armLm);
  buildArm('R', armRm);

  // --- legs ------------------------------------------------------------------
  const buildLeg = (side, mesh) => {
    const S = side === 'L' ? -1 : 1;
    const hp = pivot(hips, 'leg' + side, S * hipX, 0, 0);
    const half = legLen / 2;
    let thigh = mesh;
    if (isCapsule(mesh)) { hp.add(mesh); segment(mesh, half, legR_); }
    else { thigh = new THREE.Mesh(new THREE.CapsuleGeometry(legR_, half - 2 * legR_, 4, 10), new THREE.MeshStandardMaterial({ color: 0xd2c3a6, roughness: 0.9 })); thigh.position.y = -half / 2; thigh.castShadow = true; hp.add(thigh); }
    const kn = pivot(hp, 'knee' + side, 0, -half, 0);
    const shin = new THREE.Mesh(thigh.geometry, thigh.material);
    shin.position.set(0, -half / 2, 0);
    shin.castShadow = true;
    kn.add(shin);
    const ft = pivot(kn, 'foot' + side, 0, -half, 0);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.5, bootH, 1.02), bootMat);
    boot.position.set(0, -bootH / 2, 0.24);
    boot.castShadow = true;
    ft.add(boot);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), bootMat);
    toe.scale.set(1, 0.52, 0.7);
    toe.position.set(0, -bootH / 2, 0.7);
    ft.add(toe);
    rig.bind('leg' + side, hp); rig.bind('knee' + side, kn); rig.bind('foot' + side, ft);
  };
  buildLeg('L', legLm);
  buildLeg('R', legRm);

  // springs: brim, hair and shirttail lag the body by two to four frames
  rig.addJiggle('brim', { k: 190, damp: 15, gain: 1.5, max: 0.5, sign: -1 });
  rig.addJiggle('hair', { k: 130, damp: 11, gain: 2.4, max: 0.85 });
  rig.addJiggle('shirt', { k: 110, damp: 10, gain: 2.0, max: 0.7 });

  kid.userData.rig = rig;
  return rig;
}

/**
 * Hang a broom handle off a kid's back hand. The shaft is two pieces so the tip can lag the
 * grip — that lag is the bat's whip, and it is the difference between a swing and a
 * rotating stick.
 */
export function attachStick(rig, { length = 3.35, color = 0xc9a469, tape = 0x2f2a26 } = {}) {
  if (rig.get('stick')) return rig.get('stick');
  const hand = rig.get('handL') || rig.get('handR') || rig.get('chest');
  if (!hand) return null;
  const grip = pivot(hand, 'grip', 0, -0.28, 0.06);
  const stick = pivot(grip, 'stick', 0, 0, 0);
  const woodMat = new THREE.MeshStandardMaterial({ color, roughness: 0.78 });
  const halfL = length * 0.5;
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, halfL, 8), woodMat);
  lower.position.y = -halfL / 2 + halfL;             // grows up +Y from the grip
  lower.castShadow = true;
  stick.add(lower);
  const tip = pivot(stick, 'stickTip', 0, halfL, 0);
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, halfL, 8), woodMat);
  upper.position.y = halfL / 2;
  upper.castShadow = true;
  tip.add(upper);
  const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.5, 8), new THREE.MeshStandardMaterial({ color: tape, roughness: 0.95 }));
  gripWrap.position.y = 0.06;
  stick.add(gripWrap);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ color: tape, roughness: 0.95 }));
  knob.position.y = -0.2;
  knob.scale.set(1, 0.7, 1);
  stick.add(knob);
  rig.bind('grip', grip); rig.bind('stick', stick); rig.bind('stickTip', tip);
  rig.addJiggle('stickTip', { k: 260, damp: 17, gain: 0.85, max: 0.42 });
  rig.stickLength = length;
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

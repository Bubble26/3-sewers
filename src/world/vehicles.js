import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { RNG } from '../core/rng.js';
import { soot } from '../render/palette.js';
import {
  roadHeight, hex, mixHex, makeCanvas, canvasTexture, slabText,
  mat, texMat, flat, outline, makeShadowPool, addCollider, Kit, kitXf as xf,
} from './props.js';

/* =============================================================================
 * VEHICLES — parked geometry the ball is meant to hit.
 *
 * Every one of these is a wall, a base or a backstop before it is scenery, so
 * they sit at the curb line where a carom comes back into play and never in
 * the corridor between the batter and the pitcher.
 *
 *   the black Ford at the right curb    = FIRST BASE, and it kicks left
 *   the ice wagon in short right        = a wall for half an inning
 *   the delivery truck at the left curb = the foul-side backstop
 * ========================================================================== */

function cyl(rt, rb, h, s = 12, open = false, t0 = 0, len = Math.PI * 2) {
  return new THREE.CylinderGeometry(rt, rb, h, s, 1, open, t0, len);
}
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }

function put(parent, geo, material, x, y, z, rot, sc) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  if (sc) m.scale.set(sc[0], sc[1], sc[2]);
  parent.add(m);
  return m;
}

/* --- paint --------------------------------------------------------------- */
/** dust, brush marks and chalky oxidation, white-based so a tint can ride it */
function paintTexture(seed, dusty = 0.55) {
  const { c, g } = makeCanvas(128, 128);
  const r = new RNG(seed);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  const grd = g.createLinearGradient(0, 128, 0, 46);
  grd.addColorStop(0, `rgba(226,212,186,${0.85 * dusty})`);
  grd.addColorStop(1, 'rgba(226,212,186,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 130; i++) {
    g.globalAlpha = r.range(0.03, 0.11);
    g.fillStyle = r.chance(0.5) ? '#ffffff' : '#6a6258';
    g.fillRect(r.range(0, 128), r.range(0, 128), r.range(6, 30), r.range(2, 7));
  }
  g.globalAlpha = 1;
  return canvasTexture(c);
}

/* --- one instanced pool for every wheel on the block ---------------------- */
function spokeDiscTexture() {
  const S = 256;
  const { c, g } = makeCanvas(S, S);
  g.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  g.fillStyle = '#8a6a44';
  g.beginPath(); g.arc(cx, cy, S * 0.46, 0, 7); g.fill();       // felloe
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 12; i++) {                                 // daylight between the spokes
    const a0 = (i + 0.16) / 12 * Math.PI * 2, a1 = (i + 0.84) / 12 * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a0) * S * 0.13, cy + Math.sin(a0) * S * 0.13);
    g.arc(cx, cy, S * 0.405, a0, a1);
    g.lineTo(cx + Math.cos(a1) * S * 0.13, cy + Math.sin(a1) * S * 0.13);
    g.arc(cx, cy, S * 0.13, a1, a0, true);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 12; i++) {                                 // shading down one side of each spoke
    const a = (i + 0.5) / 12 * Math.PI * 2;
    g.save(); g.translate(cx, cy); g.rotate(a);
    g.fillStyle = 'rgba(70,52,32,0.45)';
    g.fillRect(-S * 0.012, -S * 0.44, S * 0.024, S * 0.30);
    g.fillStyle = 'rgba(214,186,140,0.5)';
    g.fillRect(-S * 0.030, -S * 0.44, S * 0.014, S * 0.30);
    g.restore();
  }
  g.fillStyle = '#5a4a38'; g.beginPath(); g.arc(cx, cy, S * 0.15, 0, 7); g.fill();
  g.fillStyle = '#9a9188'; g.beginPath(); g.arc(cx, cy, S * 0.085, 0, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(cx - S * 0.02, cy - S * 0.025, S * 0.05, 0, 7); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

class WheelPool {
  constructor(scene, max = 32) {
    this.disc = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 24),
      texMat(spokeDiscTexture(), { transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }),
      max * 2);
    this.tyre = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1, 0.105, 5, 20), mat(0x2b2724), max);
    this.disc.frustumCulled = this.tyre.frustumCulled = false;
    this.disc.count = 0; this.tyre.count = 0;
    scene.add(this.disc); scene.add(this.tyre);
    this.i = 0; this.j = 0;
    this._m = new THREE.Matrix4();
    this._o = new THREE.Object3D();
  }
  /** parent's world matrix, local wheel centre, radius, thickness of the tyre */
  add(parentMatrix, x, y, z, rad, tyre = 0.11) {
    const o = this._o;
    o.position.set(x, y, z);
    o.rotation.set(0, 0, Math.PI / 2);
    o.scale.set(rad, 1, rad);
    o.updateMatrix();
    const world = this._m.multiplyMatrices(parentMatrix, o.matrix).clone();
    this.tyre.setMatrixAt(this.i++, world);
    this.tyre.count = this.i;
    // two discs, one each side, inset so the tyre reads as the outer edge
    for (const s of [1, -1]) {
      o.position.set(x + s * tyre * 0.55, y, z);
      o.rotation.set(0, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      o.scale.set(rad * 0.97, rad * 0.97, 1);
      o.updateMatrix();
      this.disc.setMatrixAt(this.j++, this._m.multiplyMatrices(parentMatrix, o.matrix).clone());
    }
    this.disc.count = this.j;
  }
  finish() { this.disc.instanceMatrix.needsUpdate = true; this.tyre.instanceMatrix.needsUpdate = true; }
}

/** a curved separate fender arching over a wheel */
function fenderGeo(rad, width, arc, t0) {
  return cyl(rad, rad, width, 14, true, t0, arc);
}

/* =============================================================================
 * The Ford Model T — tall, narrow and stubby.  128 in long, 66 in wide,
 * just under 7 ft with the top up.  Black, because from 1914 to 1925 it is.
 * Built as a Kit so both cars on the block cost one set of draw calls.
 * ========================================================================== */
const WB = 8.33, TRACK = 2.72, WRAD = 1.25;

function modelTKit(scene) {
  const kit = new Kit(scene);
  const tex = paintTexture(3);
  // NOTE: emissive is added after the instance tint, so the paint carries only
  // a token lift — otherwise every Ford on the block comes out white.
  const paint = texMat(tex, { lift: 0.10 });
  const paintSide = texMat(tex, { side: THREE.DoubleSide, lift: 0.10 });
  const trim = mat(0x847d72);
  const brass = mat(0x8a7444);
  const nickel = mat(0x7d786e);
  const canvasTop = mat(0x4a463c);
  const canvasSide = mat(0x565043);
  const leather = mat(0x5a4a3a);
  const glass = mat(0xb9cbd4, { transparent: true, opacity: 0.45 });

  const FA = WB / 2, RA = -WB / 2;           // front and rear axle centres

  /* fenders: big separate wings with a deep valley to the body, plus the
     running board that ties front to rear.  This is most of the silhouette. */
  const fFront = kit.part(fenderGeo(WRAD + 0.5, 1.05, Math.PI * 0.72, Math.PI * 0.14), paintSide, 0.032, true);
  const fRear = kit.part(fenderGeo(WRAD + 0.5, 1.05, Math.PI * 0.62, Math.PI * 0.2), paintSide, 0.032, true);
  const skirt = kit.part(box(0.9, 0.5, 2.2), paintSide, 0, true);
  for (const sx of [1, -1]) {
    kit.add(fFront, xf(sx * TRACK, WRAD + 0.1, FA, 0, 0, Math.PI / 2));
    kit.add(fRear, xf(sx * TRACK, WRAD + 0.1, RA, 0, 0, Math.PI / 2));
    kit.add(skirt, xf(sx * TRACK, 1.62, FA - 1.9, 0, 0, 0));
    kit.add(skirt, xf(sx * TRACK, 1.62, RA + 1.9, 0, 0, 0));
  }
  const runBoard = kit.part(box(1.05, 0.18, 4.2), trim, 0.03);
  const runLip = kit.part(box(0.16, 0.62, 4.2), trim, 0);
  for (const sx of [1, -1]) {
    kit.add(runBoard, xf(sx * 2.68, 1.66, 0));
    kit.add(runLip, xf(sx * 3.14, 1.9, 0));
  }

  /* the tub: high sides, a hard belt-line moulding, doors you can see */
  const tub = kit.part(box(4.5, 2.35, 6.3), paint, 0.06, true);
  kit.add(tub, xf(0, 2.98, -1.05));
  const belt = kit.part(box(4.62, 0.2, 6.4), trim, 0);
  kit.add(belt, xf(0, 4.10, -1.05));
  const doorLine = kit.part(box(0.1, 1.5, 0.11), trim, 0);
  for (const sx of [1, -1]) {
    kit.add(doorLine, xf(sx * 2.28, 3.3, 0.6));
    kit.add(doorLine, xf(sx * 2.28, 3.3, -2.1));
  }
  const seat = kit.part(box(3.9, 0.85, 1.15), leather, 0);
  kit.add(seat, xf(0, 4.0, -0.35)); kit.add(seat, xf(0, 4.0, -2.7));

  /* the tail and the spare on the back */
  const deck = kit.part(box(4.2, 1.1, 1.1), paint, 0.045, true);
  kit.add(deck, xf(0, 3.1, -4.55));
  const spareT = kit.part(new THREE.TorusGeometry(1.0, 0.13, 5, 18), mat(0x3a3630), 0.03);
  kit.add(spareT, xf(0, 3.3, -5.25));
  const spareD = kit.part(cyl(0.88, 0.88, 0.09, 16), mat(0x6a5540), 0);
  kit.add(spareD, xf(0, 3.3, -5.25, 0, 0, Math.PI / 2));

  /* hood, cowl and the tall vertical radiator shell — the front-end read */
  const hood = kit.part(box(2.95, 1.75, 2.7), paint, 0.05, true);
  kit.add(hood, xf(0, 3.42, 3.45));
  const hoodTop = kit.part(box(2.4, 0.24, 2.72), trim, 0);
  kit.add(hoodTop, xf(0, 4.33, 3.45));
  const cowl = kit.part(box(4.1, 1.9, 1.3), paint, 0.05, true);
  kit.add(cowl, xf(0, 3.2, 2.28));
  const shell = kit.part(box(2.62, 2.5, 0.4), nickel, 0.05);
  kit.add(shell, xf(0, 3.35, 4.92));
  const core = kit.part(box(2.2, 2.05, 0.16), mat(0x4e4a42), 0);
  kit.add(core, xf(0, 3.3, 5.12));
  const cap = kit.part(cyl(0.15, 0.15, 0.34, 8), brass, 0);
  kit.add(cap, xf(0, 4.72, 4.92));

  /* headlamps on their bar, big and brassy so the nose reads at 60 ft */
  const bar = kit.part(cyl(0.07, 0.07, 3.0, 6), nickel, 0);
  kit.add(bar, xf(0, 3.85, 5.05, 0, 0, Math.PI / 2));
  const lamp = kit.part(cyl(0.52, 0.42, 0.5, 12), brass, 0.035);
  const lens = kit.part(cyl(0.47, 0.47, 0.06, 12), mat(0xe0d9bc, { emissive: 0x6a6450 }), 0);
  for (const sx of [1, -1]) {
    kit.add(lamp, xf(sx * 1.42, 3.98, 5.0, Math.PI / 2, 0, 0));
    kit.add(lens, xf(sx * 1.42, 3.98, 5.28, Math.PI / 2, 0, 0));
  }

  /* flat two-piece windshield, standing straight up out of the cowl */
  const wind = kit.part(box(4.0, 1.7, 0.07), glass, 0);
  kit.add(wind, xf(0, 5.15, 1.68, -0.1, 0, 0));
  const wf = kit.part(box(4.2, 0.16, 0.18), canvasTop, 0);
  kit.add(wf, xf(0, 4.3, 1.76)); kit.add(wf, xf(0, 6.0, 1.58));
  const wmul = kit.part(box(0.14, 1.7, 0.18), canvasTop, 0);
  kit.add(wmul, xf(0, 5.15, 1.68));

  /* the squared-off canvas top: a real box, not a floating slab.  Quarter
     panels down to the belt line at the back, open at the doors. */
  const top = kit.part(box(4.85, 0.4, 6.0), canvasTop, 0.06);
  kit.add(top, xf(0, 6.75, -1.35));
  const quarter = kit.part(box(0.16, 1.9, 2.5), canvasSide, 0.035);
  for (const sx of [1, -1]) kit.add(quarter, xf(sx * 2.36, 5.6, -3.1));
  const curtain = kit.part(box(4.6, 2.0, 0.22), canvasSide, 0.04);
  kit.add(curtain, xf(0, 5.6, -4.32));
  const backLight = kit.part(box(1.5, 0.7, 0.1), glass, 0);
  kit.add(backLight, xf(0, 6.05, -4.45));
  const post = kit.part(box(0.17, 2.6, 0.17), canvasTop, 0);
  const rail = kit.part(box(0.12, 0.46, 6.0), canvasTop, 0);
  for (const sx of [1, -1]) {
    kit.add(post, xf(sx * 2.32, 5.4, 1.7, 0.06, 0, 0));
    kit.add(post, xf(sx * 2.32, 5.3, -1.1));
    kit.add(rail, xf(sx * 2.4, 6.45, -1.35));
  }
  return kit;
}

/* =============================================================================
 * Ford Model TT delivery truck — open cab, no doors, canvas side curtain,
 * and the whole side of the box is the advertisement.
 * ========================================================================== */
function truckPanelTexture() {
  const { c, g } = makeCanvas(1024, 512);
  const green = 0x1f4a35;
  g.fillStyle = hex(green); g.fillRect(0, 0, 1024, 512);
  const r = new RNG(808);
  for (let i = 0; i < 160; i++) {
    g.globalAlpha = r.range(0.03, 0.1);
    g.fillStyle = r.chance(0.5) ? '#3d6b52' : '#14301f';
    g.fillRect(r.range(0, 1024), r.range(0, 512), r.range(20, 180), r.range(3, 9));
  }
  g.globalAlpha = 0.30; g.fillStyle = '#10261a';
  for (let i = 1; i < 6; i++) g.fillRect(0, i * 85, 1024, 4);
  g.globalAlpha = 1;
  g.strokeStyle = '#c8a34e'; g.lineWidth = 3.5; g.strokeRect(46, 42, 932, 428);
  g.lineWidth = 1.6; g.strokeRect(60, 56, 904, 400);
  const gold = '#e6c469', shadow = '#8a2a22';
  slabText(g, 'GUCCIARDO BROS.', 512, 176, 76,
    { align: 'center', color: gold, weight: 0.21, condense: 0.8, jitter: 0.7, seed: 4, shadow: { dx: 6, dy: 7, color: shadow } });
  slabText(g, 'ICE & COAL', 512, 274, 64,
    { align: 'center', color: '#f2e8ce', weight: 0.22, condense: 0.78, jitter: 0.6, seed: 9, shadow: { dx: 5, dy: 6, color: shadow } });
  slabText(g, 'DELIVERED TO ALL FLOORS', 512, 346, 30,
    { align: 'center', color: gold, weight: 0.2, condense: 0.76, jitter: 0.6, seed: 14 });
  slabText(g, '2214 SECOND AVE', 512, 404, 30,
    { align: 'center', color: '#e6dfc6', weight: 0.2, condense: 0.76, jitter: 0.6, seed: 19 });
  slabText(g, 'TEL. HARLEM 4417', 512, 452, 28,
    { align: 'center', color: '#e6dfc6', weight: 0.2, condense: 0.76, jitter: 0.6, seed: 24 });
  return canvasTexture(c);
}

function buildTruck(pool) {
  const t = new THREE.Group();
  const green = 0x1f4a35;
  const tex = paintTexture(55, 0.7);
  const body = texMat(tex, { color: green });
  const bodySide = texMat(tex, { color: green, side: THREE.DoubleSide });
  const dark = mat(soot(green, 0.32));
  const panelMat = texMat(truckPanelTexture());
  const RAD = 1.36, TWB = 10.6, TTRACK = 2.9;

  t.userData.wheels = [];
  for (const dz of [TWB / 2, -TWB / 2]) {
    for (const sx of [1, -1]) {
      t.userData.wheels.push([sx * TTRACK, RAD, dz, RAD, 0.17]);
      const f = put(t, fenderGeo(RAD + 0.46, 1.0, Math.PI * 0.58, Math.PI * 0.2), bodySide,
        sx * TTRACK, RAD + 0.06, dz, [0, 0, Math.PI / 2]);
      outline(f, 0.03);
    }
  }
  put(t, box(5.4, 0.42, 15.5), dark, 0, 1.86, -0.5);
  const bodyMats = [panelMat, panelMat, body, body, body, body];
  const bx = new THREE.Mesh(box(5.8, 5.4, 9.4), bodyMats);
  bx.position.set(0, 4.8, -3.4); t.add(bx); outline(bx, 0.06);
  put(t, box(6.1, 0.32, 9.7), dark, 0, 7.62, -3.4);
  put(t, box(5.9, 0.3, 0.5), dark, 0, 2.2, -8.2);
  const cab = put(t, box(5.3, 2.7, 3.6), body, 0, 3.95, 2.4); outline(cab, 0.05);
  put(t, box(5.42, 0.24, 3.72), dark, 0, 5.4, 2.4);
  put(t, box(5.0, 0.9, 0.34), mat(0x3a2f26), 0, 4.2, 1.1);
  for (const sx of [1, -1]) {
    put(t, box(0.17, 3.0, 0.17), dark, sx * 2.55, 6.8, 3.9);
    put(t, box(0.17, 3.0, 0.17), dark, sx * 2.55, 6.8, 0.9);
    put(t, cyl(0.32, 0.32, 3.1, 8), mat(0x9a8f74), sx * 2.5, 8.0, 2.4, [Math.PI / 2, 0, 0]);
  }
  const roof = put(t, box(5.6, 0.34, 4.3), mat(0x2b2b27), 0, 8.3, 2.4); outline(roof, 0.045);
  const glass = mat(0xb9cbd4, { transparent: true, opacity: 0.5 });
  put(t, box(5.0, 2.0, 0.07), glass, 0, 6.7, 4.15, [-0.09, 0, 0]);
  const hood = put(t, box(3.4, 2.05, 4.2), body, 0, 3.85, 6.4); outline(hood, 0.05);
  put(t, box(3.46, 0.15, 4.22), dark, 0, 4.9, 6.4);
  const rad = put(t, box(3.1, 2.6, 0.36), mat(0x6f5f38), 0, 3.95, 8.7); outline(rad, 0.045);
  put(t, box(2.6, 2.1, 0.13), mat(0x2f2b26), 0, 3.95, 8.9);
  for (const sx of [1, -1]) {
    const l = put(t, cyl(0.46, 0.4, 0.44, 12), mat(0x8a7444), sx * 1.6, 4.6, 8.86, [Math.PI / 2, 0, 0]);
    outline(l, 0.03);
  }
  put(t, cyl(0.08, 0.08, 2.5, 6), mat(0x3a352e), 0, 1.35, 9.6, [0, 0, Math.PI / 2]);
  void pool;
  return t;
}

/* =============================================================================
 * The ice wagon, and the horse who is bored of standing in it.
 * ========================================================================== */
function buildIceWagon() {
  const w = new THREE.Group();
  const wood = mat(0x8a6a44);
  const woodDark = mat(0x5d472e);
  const panelTex = (() => {
    const { c, g } = makeCanvas(512, 256);
    g.fillStyle = hex(0xb8a88e); g.fillRect(0, 0, 512, 256);
    const r = new RNG(404);
    for (let i = 0; i < 130; i++) {
      g.globalAlpha = r.range(0.04, 0.13); g.fillStyle = r.chance(0.5) ? '#cdbfa4' : '#8f8069';
      g.fillRect(r.range(0, 512), r.range(0, 256), r.range(20, 120), r.range(3, 8));
    }
    g.globalAlpha = 0.26; g.fillStyle = '#7c6f5b';
    for (let i = 1; i < 5; i++) g.fillRect(0, i * 52, 512, 3);
    g.globalAlpha = 1;
    g.strokeStyle = '#8e7d5e'; g.lineWidth = 3; g.strokeRect(18, 16, 476, 224);
    slabText(g, 'PURE ICE', 256, 108, 76,
      { align: 'center', color: '#2f5a86', weight: 0.22, condense: 0.8, jitter: 0.8, seed: 6, shadow: { dx: 5, dy: 6, color: '#c9b98e' } });
    slabText(g, 'GUCCIARDO BROS.', 256, 166, 38,
      { align: 'center', color: '#8a2f24', weight: 0.21, condense: 0.76, jitter: 0.7, seed: 16 });
    slabText(g, '25 LB · 50 LB · 100 LB', 256, 212, 28,
      { align: 'center', color: '#3d3226', weight: 0.2, condense: 0.74, jitter: 0.7, seed: 11 });
    return canvasTexture(c);
  })();
  const panel = texMat(panelTex);

  w.userData.wheels = [];
  for (const [dz, rad] of [[3.5, 1.5], [-3.7, 2.05]]) {
    for (const sx of [1, -1]) w.userData.wheels.push([sx * 2.72, rad, dz, rad, 0.1]);
  }
  put(w, box(5.2, 0.42, 11.0), woodDark, 0, 2.35, -1.0);
  const bx = new THREE.Mesh(box(5.6, 4.6, 8.6), [panel, panel, wood, wood, wood, wood]);
  bx.position.set(0, 4.85, -2.2); w.add(bx); outline(bx, 0.06);
  put(w, box(5.95, 0.36, 9.0), woodDark, 0, 7.28, -2.2);
  const flap = put(w, box(5.0, 3.0, 0.1), mat(0x8d8371, { side: THREE.DoubleSide }),
    0, 6.0, -6.55, [0.3, 0, 0]);
  outline(flap, 0.035);
  put(w, box(4.9, 0.55, 2.0), mat(0xbba875), 0, 2.85, -5.5);
  for (const [ix, iz, ry] of [[-1.1, -5.5, 0.3], [0.95, -5.85, -0.2]]) {
    const ice = put(w, box(1.5, 1.35, 1.3), mat(0xbfd6de), ix, 3.75, iz, [0, ry, 0]);
    outline(ice, 0.035);
  }
  put(w, box(4.6, 0.3, 2.4), woodDark, 0, 2.6, -6.5, [0.5, 0, 0]);
  put(w, box(3.6, 0.55, 1.5), mat(0x4a3a28), 0, 4.7, 3.3);
  put(w, box(3.6, 1.5, 0.26), mat(0x4a3a28), 0, 5.5, 3.9);
  for (const sx of [1, -1]) put(w, cyl(0.11, 0.13, 7.6, 6), mat(0x9d7f52), sx * 1.5, 3.0, 7.4, [Math.PI / 2 - 0.06, 0, 0]);
  put(w, cyl(0.09, 0.09, 3.0, 6), mat(0x38332c), 0, 3.2, 10.9, [0, 0, Math.PI / 2]);
  // the tongs, left on the tailgate
  put(w, cyl(0.05, 0.05, 1.3, 5), mat(0x6a6158), -1.9, 3.3, -5.9, [0.5, 0.4, 0.9]);
  put(w, cyl(0.05, 0.05, 1.3, 5), mat(0x6a6158), -1.9, 3.3, -5.9, [0.5, -0.4, 0.4]);
  return w;
}

function buildHorse() {
  const h = new THREE.Group();
  const hide = mat(0x6d4a30), hideDark = mat(0x4e3520), mane = mat(0x2f231a);
  const barrel = put(h, new THREE.SphereGeometry(1.55, 14, 10), hide, 0, 4.5, 0, null, [1.0, 1.05, 1.75]);
  outline(barrel, 0.05);
  put(h, new THREE.SphereGeometry(1.35, 12, 9), hide, 0, 4.7, -1.6, null, [0.95, 1.0, 1.0]);
  const neck = put(h, cyl(0.7, 1.05, 2.6, 10), hide, 0, 5.55, 1.75, [0.6, 0, 0]);
  outline(neck, 0.045);
  const head = new THREE.Group(); head.position.set(0, 6.6, 2.95); h.add(head);
  const skull = put(head, new THREE.SphereGeometry(0.75, 12, 9), hide, 0, 0, 0, null, [0.85, 1.0, 1.15]);
  outline(skull, 0.045);
  const muzzle = put(head, new THREE.SphereGeometry(0.5, 10, 8), hideDark, 0, -0.5, 0.85, [0.2, 0, 0], [0.85, 0.8, 1.15]);
  outline(muzzle, 0.035);
  for (const sx of [1, -1]) {
    put(head, new THREE.SphereGeometry(0.15, 8, 6), flat(0x1c1712), sx * 0.6, 0.26, 0.34);
    const ear = put(head, cyl(0.02, 0.19, 0.62, 6), hide, sx * 0.36, 0.8, -0.1, [-0.2, 0, sx * 0.3]);
    outline(ear, 0.03);
  }
  const bag = put(head, cyl(0.52, 0.44, 1.25, 10), mat(0x9d8a63), 0, -0.9, 0.78, [0.2, 0, 0]);
  outline(bag, 0.035);
  for (let i = 0; i < 7; i++) {
    put(h, box(0.36, 0.5, 0.22), mane, 0, 6.3 - i * 0.15, 1.05 + i * 0.28, [0.58, 0, (i % 2 ? 0.22 : -0.22)]);
  }
  const legs = [[0.95, 1.35, 0], [-0.95, 1.35, 0], [0.95, -1.3, 0.24], [-0.95, -1.3, -0.08]];
  for (const [lx, lz, tilt] of legs) {
    const up = put(h, cyl(0.34, 0.24, 2.1, 8), hide, lx, 3.4, lz, [tilt, 0, 0]);
    outline(up, 0.04);
    const lo = put(h, cyl(0.2, 0.17, 2.3, 8), hide, lx, 1.35, lz + tilt * 1.2, [tilt * 0.4, 0, 0]);
    outline(lo, 0.035);
    put(h, cyl(0.29, 0.31, 0.44, 8), mat(0x2f2822), lx, 0.22, lz + tilt * 1.7);
  }
  put(h, new THREE.TorusGeometry(1.12, 0.11, 5, 14), mat(0x3c2c1e), 0, 5.3, 0.95, [1.2, 0, 0]);
  put(h, box(0.22, 0.22, 3.4), mat(0x3c2c1e), 0, 5.95, -0.4);
  const tail = new THREE.Group(); tail.position.set(0, 5.2, -2.6); h.add(tail);
  const tm = put(tail, cyl(0.28, 0.1, 3.0, 8), mane, 0, -1.3, -0.3, [0.25, 0, 0]);
  outline(tm, 0.04);
  h.userData.tail = tail;
  h.userData.head = head;
  return h;
}

/* =========================================================================== */

export function buildVehicles(app) {
  const scene = app.scene;
  const root = new THREE.Group();
  root.name = 'vehicles';
  scene.add(root);
  const shadows = makeShadowPool(scene, 48);
  const pool = new WheelPool(scene, 40);
  const anim = {};

  const ground = (x) => roadHeight(x) - 0.02;

  const register = (x, z, ry, name, sound, w, d, h) => {
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    const hx = c * w + s * d, hz = s * w + c * d;
    shadows.add(x, z, hx * 0.66, hz * 0.66, h * 0.45, 1);
    addCollider(app, {
      name, kind: 'vehicle', sound, restitution: 0.55,
      box: new THREE.Box3(new THREE.Vector3(x - hx, 0, z - hz), new THREE.Vector3(x + hx, h, z + hz)),
    });
  };

  // ---- the two Fords, one Kit, two paint jobs -----------------------------
  const kit = modelTKit(root);
  const CARS = [
    [18.4, 50, 0.02, 0x262320, 'ford (first base)'],           // FIRST BASE, and it kicks left
    [-18.4, 92, Math.PI + 0.03, 0x5e2b2f, 'maroon ford'],       // the repainted 1919 oddball
  ];
  for (const [x, z, ry, colour, name] of CARS) {
    const place = xf(x, ground(x), z, 0, ry, 0);
    kit.place(place, colour);
    for (const dz of [WB / 2, -WB / 2]) {
      for (const sx of [1, -1]) pool.add(place, sx * TRACK, WRAD, dz, WRAD, 0.13);
    }
    register(x, z, ry, name, 'tin_tonk', 3.2, 5.6, 7.0);
  }
  kit.build();
  app.world = app.world || {};
  app.world.firstBase = new THREE.Vector3(18.4, 0, 50);

  // ---- the ice-and-coal truck at the left curb ----------------------------
  {
    const t = buildTruck(pool);
    const x = -18.2, z = 26, ry = 0.04;
    t.position.set(x, ground(x), z); t.rotation.y = ry;
    root.add(t); t.updateWorldMatrix(true, false);
    for (const wdef of t.userData.wheels) pool.add(t.matrixWorld, ...wdef);
    register(x, z, ry, 'delivery truck', 'panel_boom', 3.3, 9.2, 8.6);
  }

  // ---- THE ICEMAN'S WAGON in short right: for half an inning it is a wall --
  {
    const w = buildIceWagon();
    const x = 14.8, z = 78, ry = -0.30;
    w.position.set(x, ground(x), z); w.rotation.y = ry;
    root.add(w); w.updateWorldMatrix(true, false);
    for (const wdef of w.userData.wheels) pool.add(w.matrixWorld, ...wdef);
    register(x, z, ry, 'ice wagon', 'wood_boom', 3.2, 7.2, 7.8);

    const horse = buildHorse();
    const hx = x + Math.sin(ry) * 13.0, hz = z + Math.cos(ry) * 13.0;
    horse.position.set(hx, ground(hx), hz);
    horse.rotation.y = ry;
    root.add(horse);
    shadows.add(hx, hz, 2.1, 3.3, 4.5, 1);
    anim.horse = horse;
  }

  pool.finish();
  shadows.finish();
  return { root, anim };
}

export default registerSystem({
  name: 'vehicles',
  order: 13,
  init(app) {
    const b = buildVehicles(app);
    this.root = b.root;
    this.anim = b.anim;
    this.t = 0;
  },
  update(dt) {
    this.t += dt;
    const h = this.anim.horse;
    if (h) {
      h.userData.tail.rotation.z = Math.sin(this.t * 1.7) * 0.42;
      h.userData.tail.rotation.x = Math.sin(this.t * 2.3 + 1) * 0.12;
      h.userData.head.rotation.x = Math.sin(this.t * 0.62) * 0.10 - 0.05;
      h.userData.head.rotation.y = Math.sin(this.t * 0.41) * 0.14;
    }
  },
});

void mixHex;

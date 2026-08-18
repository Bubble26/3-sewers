import * as THREE from 'three';
import { FACADE, PAVEMENT, AIR, CHALK, INK } from '../render/palette.js';
import { RNG } from '../core/rng.js';

/**
 * Tenement facade kit — the shared toolbox for the street-architecture piece.
 *
 *   · colour: every hex comes from src/render/palette.js and is pushed through `tc()`,
 *     which pre-compensates for whatever tone-mapping curve the renderer is running so the
 *     pixel that lands on screen is the value the Design Bible authored.
 *   · light: baked, not computed. `litOf()` is the real 3:50pm 22-Sep-1925 shadow solution
 *     for a 60ft canyon with a 16ft taxpayer on the south corner (DESIGN-BIBLE §3.2), so the
 *     roadway at the plate is in sun, the north facade wears a 16ft shadow line, and the
 *     south facade is in shade. That is the whole composition, and it is geometry, not taste.
 *   · geometry: everything is appended into a handful of `Builder`s and merged, so the whole
 *     block ships in ~7 draw calls.
 */

// ─── the block's dimensions, in feet (PERIOD-REFERENCE §2.1) ──────────────────
export const M = {
  roadHalf: 18,        // 36ft roadway
  walkY: 0.62,         // granite curb height
  facadeX: 30,         // 60ft canyon, facade to facade — the 1:1 section
  lot: 25,             // the unit of the whole city
  ground: 12,          // store/parlour floor is taller
  floor: 10.5,         // upper floor-to-floor
  corniceH: 2.8,
  corniceOut: 3.0,
  parapet: 2.4,
  depth: 42,           // how far into the block we bother modelling
};

export const storeyTop = (n) => M.ground + (n - 1) * M.floor;      // cornice springs here
export const buildingTop = (n) => storeyTop(n) + M.corniceH + M.parapet;

// ─── colour: sRGB ⇄ linear, and tone-map compensation ─────────────────────────
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hexToLin(hex) {
  return [s2l(((hex >> 16) & 255) / 255), s2l(((hex >> 8) & 255) / 255), s2l((hex & 255) / 255)];
}
export function linToCss(l) {
  const b = l.map((v) => Math.round(clamp01(l2s(clamp01(v))) * 255));
  return `#${b.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const ACES_IN = [[0.59719, 0.35458, 0.04823], [0.0760, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul3 = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

let TONE = { aces: true, exposure: 1.05 };
/** Told the truth about the renderer at boot so compensation matches reality. */
export function setTone(aces, exposure) { TONE = { aces, exposure }; CACHE.clear(); }

function acesForward(v) {
  const e = TONE.exposure / 0.6;
  let c = mul3(ACES_IN, [v[0] * e, v[1] * e, v[2] * e]);
  c = c.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081));
  return mul3(ACES_OUT, c).map(clamp01);
}

const CACHE = new Map();
/** Target display colour -> the linear value to author, so the frame lands on the palette. */
export function tc(hex) {
  const hit = CACHE.get(hex);
  if (hit) return hit;
  const target = hexToLin(hex);
  let c = target.slice();
  if (TONE.aces) {
    for (let i = 0; i < 24; i++) {
      const got = acesForward(c);
      let moved = 0;
      for (let k = 0; k < 3; k++) {
        const g = Math.max(got[k], 1e-5);
        const step = Math.min(4, Math.max(0.25, target[k] / g));
        const next = Math.min(4, c[k] * step);
        moved += Math.abs(next - c[k]);
        c[k] = next;
      }
      if (moved < 1e-5) break;
    }
  }
  CACHE.set(hex, c);
  return c;
}
/** Same compensation, as a css string, for canvas texture work. */
export function tcCss(hex) { return linToCss(tc(hex)); }

export const mixLin = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleLin = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export function mixHex(a, b, t) {
  const A = hexToLin(a), B = hexToLin(b);
  return linToCss(mixLin(A, B, t));
}
const lum = (l) => 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
/** Law 2: nothing in a field larger than a hairline drops below L* 28. */
export function floorLum(l, minY = 0.0565) {
  const y = lum(l);
  if (y >= minY || y <= 0) return l;
  return scaleLin(l, minY / y);
}

// ─── the light: 3:50pm EDT, Tuesday 22 September 1925 ─────────────────────────
// Sun altitude 33°, 28° off the north facade's normal, skewed west. Everything below is
// derived from those two numbers and the 16ft taxpayer on the south corner.
const SUN_H = [-0.883, -0.469];          // horizontal unit vector toward the sun (-x south, -z west)
const RISE = 0.649;                      // tan(33°): feet of rise per foot travelled horizontally
export const SUN_DIR = [-0.740, 0.545, -0.393];   // 3d unit vector toward the sun
const TAXPAYER = { z0: -46, z1: 5, h: 16 };       // the corner taxpayer that lets the sun in

/** Height of the south building line at z — the only thing that shadows this street. */
function southWall(z) {
  if (z < TAXPAYER.z0) return 0;              // the avenue: open sky
  if (z < TAXPAYER.z1) return TAXPAYER.h;     // one-storey taxpayer
  return 62;                                  // the tenement row
}

/** 0..1 — is this point in the sun? Soft over ~0.7ft so the terminator is 2-3px on screen. */
export function occlusion(x, y, z) {
  const d = (x + M.facadeX) / -SUN_H[0];          // distance to the south building line
  if (d <= 0) return 1;
  const zh = z + SUN_H[1] * d;
  const yh = y + RISE * d;
  const h = southWall(zh);
  return clamp01((yh - h) / 0.7 + 0.5);
}

/** Lambert term against the baked sun, times occlusion. 0 = shade band, 0.74 = full sun. */
export function litOf(n, x, y, z) {
  const ndl = n[0] * SUN_DIR[0] + n[1] * SUN_DIR[1] + n[2] * SUN_DIR[2];
  if (ndl <= 0.02) return 0;
  return ndl * occlusion(x, y, z);
}

/**
 * The hand-authored ramp (DESIGN-BIBLE §4.1): shade band, lit band, and a warm bounce.
 * `dark` is a deep-shade term for recesses; `bounce` warms upward-facing surfaces near grade.
 */
export function shadeLin(hex, lit, dark = 0, bounce = 0) {
  let c = tc(hex);
  if (lit > 0.01) {
    const t = Math.min(1, lit / 0.74);
    c = mixLin(c, tc(AIR.sunTint), 0.19 * t);
    c = scaleLin(c, 1 + 0.40 * t);
  } else {
    c = mixLin(c, tc(AIR.skyFill), 0.09);
  }
  if (bounce > 0) c = mixLin(c, tc(AIR.brickBounce), 0.22 * bounce);
  if (dark > 0) c = scaleLin(c, 1 - 0.34 * dark);
  return floorLum(c);
}

/** Coal haze: distance lightens, never darkens (DESIGN-BIBLE §2.3). */
export function haze(c, z) {
  const t = clamp01((z - 70) / 320) * 0.34;
  return t > 0 ? mixLin(c, tc(AIR.haze), t) : c;
}

export function lit3(hex, n, x, y, z, dark = 0, bounce = 0) {
  return haze(shadeLin(hex, litOf(n, x, y, z), dark, bounce), z);
}

// ─── geometry accumulation ────────────────────────────────────────────────────
const N_PX = [1, 0, 0], N_NX = [-1, 0, 0], N_PY = [0, 1, 0], N_NY = [0, -1, 0], N_PZ = [0, 0, 1], N_NZ = [0, 0, -1];
export const FACE_N = { px: N_PX, nx: N_NX, py: N_PY, ny: N_NY, pz: N_PZ, nz: N_NZ };

export class Builder {
  constructor(name) { this.name = name; this.p = []; this.n = []; this.c = []; this.u = []; }
  get count() { return this.p.length / 3; }

  vert(v, n, c, u) {
    this.p.push(v[0], v[1], v[2]);
    this.n.push(n[0], n[1], n[2]);
    this.c.push(c[0], c[1], c[2]);
    this.u.push(u[0], u[1]);
  }
  /** a,b,c,d counter-clockwise seen from the front. cols: one colour or four. uvs: four [u,v]. */
  quad(a, b, c, d, cols, uvs, n) {
    if (!n) {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const L = Math.hypot(cr[0], cr[1], cr[2]) || 1;
      n = [cr[0] / L, cr[1] / L, cr[2] / L];
    }
    const c4 = Array.isArray(cols[0]) ? cols : [cols, cols, cols, cols];
    const u4 = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.vert(a, n, c4[0], u4[0]); this.vert(b, n, c4[1], u4[1]); this.vert(c, n, c4[2], u4[2]);
    this.vert(a, n, c4[0], u4[0]); this.vert(c, n, c4[2], u4[2]); this.vert(d, n, c4[3], u4[3]);
  }

  /**
   * Axis-aligned box. `col` is a hex, or fn(faceName, normal, centre)->linear rgb.
   * `faces` is a string of the faces to emit; leaving hidden faces out is most of the budget.
   * `uvScale` maps world feet to texture tiles; `uvRect` pins every face into an atlas slot.
   */
  box(x0, y0, z0, x1, y1, z1, col, faces = 'px nx py ny pz nz', uvScale = 8, uvRect = null) {
    const F = {
      px: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], N_PX],
      nx: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], N_NX],
      py: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], N_PY],
      ny: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], N_NY],
      pz: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], N_PZ],
      nz: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], N_NZ],
    };
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    for (const key of faces.split(' ')) {
      const f = F[key]; if (!f) continue;
      const n = f[4];
      const c = typeof col === 'function' ? col(key, n, [cx, cy, cz]) : lit3(col, n, cx, cy, cz);
      let uvs = null;
      if (uvRect) uvs = rectUV(uvRect);
      else {
        const pts = [f[0], f[1], f[2], f[3]];
        const ax = Math.abs(n[0]) > 0.5 ? 2 : 0;            // which world axis is "u"
        uvs = pts.map((p) => [p[ax] / uvScale, p[1] / uvScale]);
        if (Math.abs(n[1]) > 0.5) uvs = pts.map((p) => [p[0] / uvScale, p[2] / uvScale]);
      }
      this.quad(f[0], f[1], f[2], f[3], c, uvs, n);
    }
  }

  toMesh(material, name) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = name || this.name;
    m.matrixAutoUpdate = false;
    return m;
  }
}

export const rectUV = (r) => [[r.u0, r.v0], [r.u1, r.v0], [r.u1, r.v1], [r.u0, r.v1]];
export const flipU = (r) => [[r.u1, r.v0], [r.u0, r.v0], [r.u0, r.v1], [r.u1, r.v1]];

// ─── the sign / sprite atlas ──────────────────────────────────────────────────
// Every painted thing on the block — sign bands, awnings, ghost signs, gold leaf, railings,
// gratings, the cat in the window — is drawn into one canvas and shipped as one draw call.
export class Atlas {
  constructor(size = 2048) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size; this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.clearRect(0, 0, size, size);
    this.x = 2; this.y = 2; this.rowH = 0;
    this.slots = new Map();
  }
  add(name, w, h, draw) {
    w = Math.ceil(w); h = Math.ceil(h);
    if (this.x + w + 4 > this.size) { this.x = 2; this.y += this.rowH + 4; this.rowH = 0; }
    const x = this.x, y = this.y;
    this.x += w + 4; this.rowH = Math.max(this.rowH, h);
    const g = this.ctx;
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y);
    try { draw(g, w, h); } catch (e) { g.restore(); throw e; }
    g.restore();
    const S = this.size, e = 0.35;
    const slot = { u0: (x + e) / S, u1: (x + w - e) / S, v0: 1 - (y + h - e) / S, v1: 1 - (y + e) / S, w, h };
    this.slots.set(name, slot);
    return slot;
  }
  has(name) { return this.slots.has(name); }
  get(name) {
    const s = this.slots.get(name);
    if (!s) throw new Error(`atlas slot "${name}" missing`);
    return s;
  }
  texture() {
    if (!this._tex) {
      this._tex = new THREE.CanvasTexture(this.canvas);
      this._tex.colorSpace = THREE.SRGBColorSpace;
      this._tex.anisotropy = 4;
      this._tex.minFilter = THREE.LinearMipmapLinearFilter;
      this._tex.magFilter = THREE.LinearFilter;
      this._tex.needsUpdate = true;
    }
    return this._tex;
  }
}

// ─── procedural brick ─────────────────────────────────────────────────────────
/**
 * Running bond, 8in x 2-1/4in face with 3/8in joints — 4.5 courses to the foot. Painted as
 * courses with per-brick value variation, never as noise. One tile covers 8ft x 8ft.
 */
export function brickTexture(baseHex, mortarHex, seed, opts = {}) {
  const PX = 512, FT = 8, px = PX / FT;             // 64 px per foot
  const cv = document.createElement('canvas');
  cv.width = PX; cv.height = PX;
  const g = cv.getContext('2d');
  const r = new RNG(seed);
  g.fillStyle = tcCss(mortarHex); g.fillRect(0, 0, PX, PX);

  const courseH = px * (2.625 / 12);                // 2-5/8in per course
  const brickW = px * (8.25 / 12);
  const base = hexToLin(baseHex);
  const rows = Math.ceil(PX / courseH) + 1;
  for (let row = 0; row < rows; row++) {
    const y = PX - (row + 1) * courseH;
    const off = (row % 2) * brickW * 0.5 - r.range(0, 2);
    for (let x = -brickW; x < PX + brickW; x += brickW) {
      const v = 1 + r.range(-0.13, 0.11);
      const warm = r.chance(0.10) ? 0.16 : 0;       // the odd overburnt header
      let c = scaleLin(base, v);
      if (warm) c = mixLin(c, hexToLin(0x6b4235), warm);
      if (r.chance(0.05)) c = mixLin(c, hexToLin(0xc8924e), 0.22);
      g.fillStyle = linToCss(c);
      const jx = r.range(-0.4, 0.4), jy = r.range(-0.3, 0.3);
      g.fillRect(x + off + jx, y + jy + 0.6, brickW - 1.5, courseH - 1.3);
    }
  }
  // drawn grime, not a filter: a few soot washes that follow the courses
  if (opts.grime !== false) {
    g.globalAlpha = 0.10;
    g.fillStyle = tcCss(0x3b322b);
    for (let i = 0; i < 5; i++) {
      const x = r.range(0, PX), w = r.range(18, 70);
      g.fillRect(x, r.range(0, PX * 0.6), w, r.range(30, 140));
    }
    g.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Painted-out party wall / stucco: a flat ground for a wall ad, with patchy repaint. */
export function washTexture(baseHex, seed) {
  const PX = 256;
  const cv = document.createElement('canvas'); cv.width = PX; cv.height = PX;
  const g = cv.getContext('2d');
  const r = new RNG(seed);
  const base = hexToLin(baseHex);
  g.fillStyle = tcCss(baseHex); g.fillRect(0, 0, PX, PX);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = linToCss(scaleLin(base, 1 + r.range(-0.09, 0.07)));
    g.fillRect(r.range(0, PX), r.range(0, PX), r.range(10, 60), r.range(6, 34));
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

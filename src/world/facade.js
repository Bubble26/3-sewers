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
  roadHalf: 22,        // roadway edge — GROUND.curbX in props.js, shared with the surface piece
  walkY: 0.55,         // top of the bluestone — GROUND.walkTop
  facadeX: 32,         // the building line — GROUND.walkOuter. A 64ft canyon against 60ft walls
  lot: 25,             // the unit of the whole city
  ground: 12,          // store/parlour floor is taller
  floor: 10.5,         // upper floor-to-floor
  corniceH: 3.2,
  corniceOut: 3.2,
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

/** The height of the terminator on a facade at x, and the z where the taxpayer's edge cuts it. */
export function shadowLine(x) {
  const d = (x + M.facadeX) / -SUN_H[0];
  return { y: 62 - RISE * d, z: TAXPAYER.z1 - SUN_H[1] * d };
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
    // A warm SHIFT, not a mix toward a bright colour: mixing lifts dark materials far more
    // than light ones and flattens the whole facade into one salmon value.
    const t = Math.min(1, lit / 0.74);
    c = [c[0] * (1 + 0.19 * t), c[1] * (1 + 0.02 * t), c[2] * (1 - 0.30 * t)];
    c = scaleLin(c, 0.95 + 0.47 * t);
  } else {
    c = mixLin(c, tc(AIR.skyFill), 0.11);
    c = scaleLin(c, 0.95);
  }
  if (bounce > 0) c = mixLin(c, tc(AIR.brickBounce), 0.22 * bounce);
  if (dark > 0) c = scaleLin(c, 1 - 0.55 * dark);
  return floorLum(c);
}

/**
 * The same ramp, as a plain multiplier, for geometry whose colour already lives in a texture.
 * Never tint a painted texture with shadeLin(white) — white has to be authored above 1.0 to
 * survive the tone curve, so it would brighten every sprite on the block by a third.
 */
export function texTint(lit, dark = 0, bounce = 0) {
  const t = Math.min(1, Math.max(0, lit) / 0.74);
  let k = lit > 0.01 ? 0.95 + 0.47 * t : 0.95;
  k *= 1 - 0.50 * dark;
  return lit > 0.01
    ? [k * (1 + 0.085 * t), k, k * (1 - 0.15 * t)]
    : [k * 0.945, k * 0.98, k * 1.075];
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
      let c = typeof col === 'function' ? col(key, n, [cx, cy, cz]) : lit3(col, n, cx, cy, cz);
      // In a shaded canyon the only light is the strip of sky overhead, so an up-facing surface
      // is far brighter than a vertical one and a soffit is far darker. Without this every
      // stoop, sill and cornice collapses into a single grey lump.
      let skyK = 1;
      if (key === 'py') skyK = litOf(n, cx, cy, cz) > 0.01 ? 1.10 : 1.34;
      else if (key === 'ny') skyK = 0.78;
      if (skyK !== 1) c = [c[0] * skyK, c[1] * skyK, c[2] * skyK];
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

  /** A vertical cylinder — chimney pots, barber poles, water tanks, newel caps. */
  cyl(cx, cz, r, y0, y1, sides, colFn, caps = 'py') {
    const step = (Math.PI * 2) / sides;
    for (let i = 0; i < sides; i++) {
      const a0 = i * step, a1 = (i + 1) * step;
      const p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r];
      const p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      const n = [Math.cos(a0 + step / 2), 0, Math.sin(a0 + step / 2)];
      const c = colFn(n, [(p0[0] + p1[0]) / 2, (y0 + y1) / 2, (p0[1] + p1[1]) / 2]);
      this.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]],
        c, [[0, 0], [1, 0], [1, 1], [0, 1]], n);
    }
    if (caps.includes('py')) {
      const c = colFn([0, 1, 0], [cx, y1, cz]);
      for (let i = 0; i < sides; i++) {
        const a0 = i * step, a1 = (i + 1) * step;
        this.quad([cx, y1, cz], [cx + Math.cos(a0) * r, y1, cz + Math.sin(a0) * r],
          [cx + Math.cos(a1) * r, y1, cz + Math.sin(a1) * r], [cx, y1, cz],
          c, [[0.5, 0.5], [0, 0], [1, 0], [0.5, 0.5]], [0, 1, 0]);
      }
    }
  }

  toMesh(material, name) {
    for (let i = 0; i < this.p.length; i++) if (!Number.isFinite(this.p[i])) throw new Error(`NaN pos in ${this.name} @${i} (${this.p.slice(i - 3, i + 3)})`);
    for (let i = 0; i < this.c.length; i++) if (!Number.isFinite(this.c[i])) throw new Error(`NaN col in ${this.name} @${i}`);
    for (let i = 0; i < this.u.length; i++) if (!Number.isFinite(this.u[i])) throw new Error(`NaN uv in ${this.name} @${i}`);
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
    if (this.y + h + 4 > this.size) throw new Error(`atlas full at "${name}" (${this.y + h} > ${this.size})`);
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
  const base = tc(baseHex);
  const rows = Math.ceil(PX / courseH) + 1;
  for (let row = 0; row < rows; row++) {
    const y = PX - (row + 1) * courseH;
    const off = (row % 2) * brickW * 0.5 - r.range(0, 2);
    for (let x = -brickW; x < PX + brickW; x += brickW) {
      const v = 1 + r.range(-0.13, 0.11);
      const warm = r.chance(0.10) ? 0.16 : 0;       // the odd overburnt header
      let c = scaleLin(base, v);
      if (warm) c = mixLin(c, tc(0x6b4235), warm);
      if (r.chance(0.05)) c = mixLin(c, tc(0xc8924e), 0.22);
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

/**
 * A flat panel hung on a facade at depth `d` out from the building line, wound so it always
 * faces the street. Every sign, awning, window pane and sprite on the block goes through here.
 */
export function panel(B, lot, d, za, zb, ya, yb, col, uv) {
  const x = lot.xf + lot.out * d;
  const A = lot.out < 0
    ? [[x, ya, za], [x, ya, zb], [x, yb, zb], [x, yb, za]]
    : [[x, ya, zb], [x, ya, za], [x, yb, za], [x, yb, zb]];
  B.quad(A[0], A[1], A[2], A[3], col, uv, [lot.out, 0, 0]);
}

/** Painted-out party wall / stucco: a flat ground for a wall ad, with patchy repaint. */
export function washTexture(baseHex, seed) {
  const PX = 256;
  const cv = document.createElement('canvas'); cv.width = PX; cv.height = PX;
  const g = cv.getContext('2d');
  const r = new RNG(seed);
  const base = tc(baseHex);
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

// ─── painted sprites: what lives in a window, and what iron looks like ────────
/**
 * A window is a hole, and a hole is darker than the wall around it. Ours reflects the sky in
 * its top third and the shaded facade opposite in the rest — which is what glass in a 64ft
 * canyon actually does, and it gives every opening a hard internal value break that survives
 * being 12 pixels tall.
 */
function glassPane(g, w, h, y0 = 0, y1 = 1) {
  const H = h * (y1 - y0), Y = h * y0;
  const gr = g.createLinearGradient(0, Y, 0, Y + H);
  gr.addColorStop(0, tcCss(0x8ea6c0));
  gr.addColorStop(0.26, tcCss(0x7d93ad));
  gr.addColorStop(0.30, tcCss(0x5d4b40));
  gr.addColorStop(1, tcCss(0x4c3d34));
  g.fillStyle = gr; g.fillRect(0, Y, w, H);
  // the reflected cornice line opposite, and a little glazing grime
  g.fillStyle = 'rgba(240,232,210,0.13)';
  g.beginPath(); g.moveTo(0, Y + H * 0.30); g.lineTo(w, Y + H * 0.22); g.lineTo(w, Y + H * 0.27); g.lineTo(0, Y + H * 0.36); g.fill();
  g.fillStyle = 'rgba(216,207,184,0.10)';
  for (let i = 0; i < 3; i++) g.fillRect(w * (0.14 + i * 0.3), Y, w * 0.05, H);
}
function roomBack(g, w, h, y0 = 0) {
  const Y = h * y0;
  const gr = g.createLinearGradient(0, Y, 0, h);
  gr.addColorStop(0, tcCss(0x413a33));
  gr.addColorStop(1, tcCss(0x4e443a));
  g.fillStyle = gr; g.fillRect(0, Y, w, h - Y);
}
function curtain(g, w, h, side = 0, amt = 0.30, y0 = 0) {
  const x = side ? w * (1 - amt) : 0, Y = h * y0;
  g.fillStyle = tcCss(0xc0b294);
  g.beginPath();
  g.moveTo(x, Y); g.lineTo(x + w * amt, Y);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    g.lineTo(x + w * amt * (1 - t * 0.22) + Math.sin(t * 7) * w * 0.03, Y + (h - Y) * t);
  }
  g.lineTo(x, h); g.closePath(); g.fill();
  g.fillStyle = 'rgba(70,60,48,0.26)';
  for (let i = 0; i < 5; i++) g.fillRect(x + w * amt * (i / 5) * 0.9, Y, w * 0.014, h - Y);
}
/** The lintel soffit throws a hard line across the top of every opening. */
function reveal(g, w, h) {
  g.fillStyle = 'rgba(28,20,16,0.55)'; g.fillRect(0, 0, w, h * 0.06);
  g.fillStyle = 'rgba(28,20,16,0.30)'; g.fillRect(0, h * 0.06, w, h * 0.04);
  g.fillStyle = 'rgba(28,20,16,0.22)'; g.fillRect(0, 0, w * 0.05, h);
}

export function registerFacadeSprites(atlas) {
  const W = 84, H = 160;
  atlas.add('win:sash', W, H, (g, w, h) => { glassPane(g, w, h); curtain(g, w, h, 1, 0.17); reveal(g, w, h); });
  atlas.add('win:shade', W, H, (g, w, h) => {
    glassPane(g, w, h);
    g.fillStyle = tcCss(0xb8a681); g.fillRect(0, 0, w, h * 0.40);          // a roller shade, half down
    g.fillStyle = tcCss(0x8a7a5c); g.fillRect(0, h * 0.40 - 3, w, 3);
    g.fillStyle = tcCss(0x8a7a5c); g.fillRect(w * 0.48, h * 0.40, 2, h * 0.05);
    reveal(g, w, h);
  });
  atlas.add('win:open', W, H, (g, w, h) => {
    roomBack(g, w, h, 0.44);
    glassPane(g, w, h, 0, 0.46);                                          // the raised lower sash
    curtain(g, w, h, 0, 0.32, 0.44);
    g.fillStyle = tcCss(0x2e2a26); g.fillRect(0, h * 0.44, w, 3.5);
    reveal(g, w, h);
  });
  atlas.add('win:lean', W, H, (g, w, h) => {         // §8.11 — elbows on a folded towel
    roomBack(g, w, h, 0.36);
    glassPane(g, w, h, 0, 0.38);
    g.fillStyle = tcCss(0x2e2a26); g.fillRect(0, h * 0.36, w, 3.5);
    g.fillStyle = tcCss(0x7c4f6b);
    g.beginPath(); g.ellipse(w * 0.5, h * 1.04, w * 0.44, h * 0.30, 0, Math.PI, 0); g.fill();
    g.fillStyle = tcCss(0xc08a5e);
    g.beginPath(); g.ellipse(w * 0.20, h * 0.885, w * 0.13, h * 0.055, 0.45, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.80, h * 0.885, w * 0.13, h * 0.055, -0.45, 0, 7); g.fill();
    g.fillStyle = tcCss(0xdfa377);
    g.beginPath(); g.ellipse(w * 0.5, h * 0.70, w * 0.19, h * 0.125, 0, 0, 7); g.fill();
    g.fillStyle = tcCss(0x4a3b30);
    g.beginPath(); g.ellipse(w * 0.5, h * 0.645, w * 0.205, h * 0.085, 0, Math.PI, 0); g.fill();
    g.fillStyle = tcCss(0x2a1d1a);
    g.beginPath(); g.ellipse(w * 0.42, h * 0.705, w * 0.022, h * 0.011, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.58, h * 0.705, w * 0.022, h * 0.011, 0, 0, 7); g.fill();
    g.fillStyle = tcCss(0xd8cfb8);                   // the folded towel on the sill
    g.fillRect(w * 0.06, h * 0.945, w * 0.88, h * 0.055);
    reveal(g, w, h);
  });
  atlas.add('win:cat', W, H, (g, w, h) => {
    roomBack(g, w, h, 0.44);
    glassPane(g, w, h, 0, 0.46); curtain(g, w, h, 1, 0.20, 0.44);
    g.fillStyle = tcCss(0x2e2a26); g.fillRect(0, h * 0.44, w, 3.5);
    g.fillStyle = tcCss(0x54483f);                   // a cat, sitting, unimpressed
    g.beginPath(); g.ellipse(w * 0.60, h * 0.925, w * 0.19, h * 0.105, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.60, h * 0.775, w * 0.12, h * 0.068, 0, 0, 7); g.fill();
    g.beginPath(); g.moveTo(w * 0.49, h * 0.745); g.lineTo(w * 0.53, h * 0.675); g.lineTo(w * 0.585, h * 0.745); g.fill();
    g.beginPath(); g.moveTo(w * 0.625, h * 0.745); g.lineTo(w * 0.68, h * 0.675); g.lineTo(w * 0.715, h * 0.745); g.fill();
    g.fillStyle = tcCss(0xe3a32b);
    g.fillRect(w * 0.545, h * 0.768, w * 0.035, h * 0.016);
    g.fillRect(w * 0.635, h * 0.768, w * 0.035, h * 0.016);
    g.strokeStyle = tcCss(0x54483f); g.lineWidth = 3;
    g.beginPath(); g.moveTo(w * 0.79, h * 0.955); g.quadraticCurveTo(w * 0.95, h * 0.88, w * 0.88, h * 0.75); g.stroke();
    reveal(g, w, h);
  });
  atlas.add('win:pot', W, H, (g, w, h) => {
    roomBack(g, w, h, 0.44);
    glassPane(g, w, h, 0, 0.46); curtain(g, w, h, 0, 0.26, 0.44);
    g.fillStyle = tcCss(0x2e2a26); g.fillRect(0, h * 0.44, w, 3.5);
    g.fillStyle = tcCss(0x9a7050);                   // a coffee can with a geranium in it
    g.fillRect(w * 0.32, h * 0.855, w * 0.34, h * 0.145);
    g.fillStyle = tcCss(0x7a5a3e); g.fillRect(w * 0.32, h * 0.855, w * 0.34, h * 0.022);
    g.fillStyle = tcCss(0x2f7f63);
    for (let i = 0; i < 6; i++) {
      g.beginPath(); g.ellipse(w * (0.34 + i * 0.06), h * (0.80 - (i % 2) * 0.035), w * 0.085, h * 0.042, i, 0, 7); g.fill();
    }
    g.fillStyle = tcCss(0xc8402f);
    g.beginPath(); g.ellipse(w * 0.50, h * 0.735, w * 0.115, h * 0.055, 0, 0, 7); g.fill();
    g.fillStyle = tcCss(0xd4694a);
    g.beginPath(); g.ellipse(w * 0.44, h * 0.722, w * 0.05, h * 0.026, 0, 0, 7); g.fill();
    reveal(g, w, h);
  });
  atlas.add('win:board', W, H, (g, w, h) => {        // §8.39 — something already broken
    glassPane(g, w, h);
    g.fillStyle = tcCss(0x8a7458);
    g.save(); g.translate(w * 0.5, h * 0.55); g.rotate(0.08); g.fillRect(-w * 0.58, -h * 0.14, w * 1.16, h * 0.28); g.restore();
    g.fillStyle = 'rgba(50,40,32,0.40)';
    g.save(); g.translate(w * 0.5, h * 0.55); g.rotate(0.08); g.fillRect(-w * 0.58, -h * 0.14, w * 1.16, h * 0.035); g.restore();
    reveal(g, w, h);
  });

  // the grating's shadow: white bars, so the vertex colour alone decides how dark it lands
  atlas.add('bars', 64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 8; i++) g.fillRect(i * 8 + 1.6, 0, 3.6, h);
  });
  // fire-escape deck: bar grating, so light passes through and it reads as lace
  atlas.add('grate', 64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = tcCss(0x6b6259);
    for (let i = 0; i < 8; i++) g.fillRect(0, i * 8 + 1.5, w, 3.4);
    g.fillStyle = tcCss(0x7a7168);
    for (let i = 0; i < 4; i++) g.fillRect(i * 16 + 5, 0, 2.2, h);
  });
  // laundry over the rail — the best free lighting moment on the block
  atlas.add('laundry', 132, 80, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const items = [[0.01, 0.26, 0xddd2b8], [0.30, 0.22, 0xcfc4a8], [0.55, 0.17, 0xc2b79c], [0.75, 0.24, 0xd8ccb0]];
    for (const [x, ww, col] of items) {
      g.fillStyle = tcCss(col);
      g.beginPath();
      g.moveTo(x * w, h * 0.06); g.lineTo((x + ww) * w, h * 0.02);
      g.lineTo((x + ww) * w - 2, h * 0.84);
      for (let i = 6; i >= 0; i--) g.lineTo(x * w + ww * w * (i / 6), h * (0.84 + Math.sin(i * 1.9) * 0.09));
      g.closePath(); g.fill();
      // folds, and the shaded half where it hangs inside the rail
      g.fillStyle = 'rgba(62,70,88,0.22)';
      for (let i = 0; i < 4; i++) g.fillRect((x + ww * (0.18 + i * 0.2)) * w, h * 0.06, w * 0.008, h * 0.78);
      g.fillStyle = 'rgba(62,70,88,0.16)';
      g.fillRect(x * w, h * 0.52, ww * w, h * 0.36);
    }
  });
  // sidewalk ironwork
  atlas.add('cellar', 96, 72, (g, w, h) => {        // §8.33 two steel leaves, diamond plate
    g.fillStyle = tcCss(0x7a5a46); g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(40,30,24,0.5)'; g.lineWidth = 1.4;
    for (let i = -h; i < w; i += 9) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
      g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
    }
    g.fillStyle = tcCss(0x4a3b30); g.fillRect(w / 2 - 2, 0, 4, h);
    g.fillStyle = tcCss(0x8a6a54); g.fillRect(w / 2 - 9, h * 0.44, 18, 7);
  });
  atlas.add('vault', 84, 42, (g, w, h) => {          // §8.32 sun-purpled prism lights
    g.fillStyle = tcCss(0x6e675e); g.fillRect(0, 0, w, h);
    for (let r0 = 0; r0 < 3; r0++) {
      for (let c = 0; c < 8; c++) {
        g.fillStyle = tcCss(r0 === 1 && c % 3 === 0 ? 0x8e7a92 : 0x9b84a6);
        g.beginPath(); g.arc(c * 12 + 6, r0 * 16 + 8, 4.4, 0, 7); g.fill();
      }
    }
  });
  // pigeons on the cornice — the block's own motion, and free period value
  atlas.add('pigeons', 128, 48, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const put = (x, s, flip, col) => {
      g.save(); g.translate(x, h); g.scale(flip ? -s : s, s);
      g.fillStyle = tcCss(col);
      g.beginPath(); g.ellipse(0, -13, 9, 7.5, -0.2, 0, 7); g.fill();       // body
      g.beginPath(); g.ellipse(-7, -22, 4.4, 4.4, 0, 0, 7); g.fill();       // head
      g.beginPath(); g.moveTo(6, -16); g.lineTo(17, -9); g.lineTo(5, -8); g.fill();  // tail
      g.fillStyle = tcCss(0x8a6a54);
      g.beginPath(); g.moveTo(-11, -22); g.lineTo(-14.5, -20.5); g.lineTo(-11, -19.5); g.fill();
      g.fillStyle = tcCss(0x4a4038);
      g.fillRect(-2, -6, 1.8, 6); g.fillRect(2, -6, 1.8, 6);
      g.restore();
    };
    put(18, 1.0, false, 0x6b6a68); put(52, 0.92, true, 0x565550);
    put(84, 1.05, false, 0x7a7168); put(112, 0.85, true, 0x63625e);
  });
  atlas.add('coop', 112, 56, (g, w, h) => {          // chicken wire on the pigeon loft
    g.clearRect(0, 0, w, h);
    g.strokeStyle = tcCss(0x8a8578); g.lineWidth = 1.2;
    for (let i = 0; i < w; i += 7) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); }
    for (let i = -h; i < w; i += 7) { g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke(); }
    g.fillStyle = tcCss(0x6b5a44);
    g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
  });
}

// ─── the tenement ─────────────────────────────────────────────────────────────
const WIN = { w: 3.0, h: 5.75, sill: 2.45, n: 4, first: 3.35, gap: 6.1 };

function windowRects(lot) {
  const out = [];
  for (let f = 1; f < lot.storeys; f++) {
    const base = M.ground + (f - 1) * M.floor;
    for (let i = 0; i < WIN.n; i++) {
      const cz = lot.z0 + WIN.first + i * WIN.gap;
      out.push({ z0: cz - WIN.w / 2, z1: cz + WIN.w / 2, y0: base + WIN.sill, y1: base + WIN.sill + WIN.h, h: WIN.h, f, i, base });
    }
  }
  return out;
}

function addSplit(list, v, lo, hi) { if (v > lo + 0.05 && v < hi - 0.05) list.push(v); }
const uniqSort = (a) => [...new Set(a.map((v) => Math.round(v * 1000) / 1000))].sort((x, y) => x - y);

/** Value modulation over the brick: sun band, shade band, soot climbing, haze at distance. */
function wallMul(lot, z, y, wins) {
  const lit = litOf(FACE_N[lot.front], lot.xf, y, z);
  const t = Math.min(1, lit / 0.74);
  let k = t > 0 ? 0.95 + 0.47 * t : 0.95;
  const tint = t > 0 ? [1 + 0.085 * t, 1, 1 - 0.15 * t] : [0.945, 0.98, 1.075];
  const top = storeyTop(lot.storeys);
  const s = clamp01((y - M.ground * 0.6) / Math.max(1, top - M.ground * 0.6));
  k *= 1 - 0.42 * s * s;                                  // soot goes up; the game happens down
  if (y > top - 3.2) k *= 1 - 0.30 * clamp01((y - (top - 3.2)) / 3.2);   // the cornice throws
  for (const w of wins) {                                 // drawn streaks below every sill
    if (w.noStreak) continue;
    if (z >= w.z0 - 0.2 && z <= w.z1 + 0.2 && y < w.y0 && y > w.y0 - 3.6) {
      k *= 1 - 0.13 * (1 - (w.y0 - y) / 3.6);
      break;
    }
  }
  k *= lot.grime;                                         // every building weathers differently
  k *= 1 + 0.22 * clamp01((z - 80) / 240);                 // coal haze lifts the far end
  return [k * tint[0], k * tint[1], k * tint[2]];
}

function wallGrid(B, lot, wins, yTop, yBot) {
  const z0 = lot.z0, z1 = z0 + M.lot;
  const cols = [z0, z1];
  const rows = [yBot, yTop];
  for (const w of wins) { addSplit(cols, w.z0, z0, z1); addSplit(cols, w.z1, z0, z1); addSplit(rows, w.y0, yBot, yTop); addSplit(rows, w.y1, yBot, yTop); addSplit(rows, w.y0 - 3.6, yBot, yTop); }
  addSplit(rows, M.ground, yBot, yTop);
  const SL = shadowLine(lot.xf);                                          // the canyon's own terminator
  addSplit(rows, SL.y - 0.36, yBot, yTop); addSplit(rows, SL.y + 0.36, yBot, yTop);
  addSplit(cols, SL.z - 0.36, z0, z1); addSplit(cols, SL.z + 0.36, z0, z1);
  addSplit(rows, yTop - 3.2, yBot, yTop);                                 // the cornice's own shadow
  const C = uniqSort(cols), R = uniqSort(rows);
  const inWin = (za, zb, ya, yb) => wins.some((w) => za >= w.z0 - 0.01 && zb <= w.z1 + 0.01 && ya >= w.y0 - 0.01 && yb <= w.y1 + 0.01);
  for (let i = 0; i < C.length - 1; i++) {
    for (let j = 0; j < R.length - 1; j++) {
      const za = C[i], zb = C[i + 1], ya = R[j], yb = R[j + 1];
      if (inWin(za, zb, ya, yb)) continue;
      const cols4 = [wallMul(lot, za, ya, wins), wallMul(lot, zb, ya, wins), wallMul(lot, zb, yb, wins), wallMul(lot, za, yb, wins)];
      const x = lot.xf;
      const uv = [[za / 8, ya / 8], [zb / 8, ya / 8], [zb / 8, yb / 8], [za / 8, yb / 8]];
      const P = lot.out < 0
        ? [[x, ya, za], [x, ya, zb], [x, yb, zb], [x, yb, za]]
        : [[x, ya, zb], [x, ya, za], [x, yb, za], [x, yb, zb]];
      const cc = lot.out < 0 ? cols4 : [cols4[1], cols4[0], cols4[3], cols4[2]];
      const uu = lot.out < 0 ? uv : [uv[1], uv[0], uv[3], uv[2]];
      B.quad(P[0], P[1], P[2], P[3], cc, uu, [lot.out, 0, 0]);
    }
  }
}

/** Window opening: reveal, lintel, sill, sash bars, and whatever is going on inside. */
function windowUnit(ctx, lot, w) {
  const T = ctx.b('trim'), S = ctx.b('sign');
  const A = ctx.atlas;
  const o = lot.out, xf = lot.xf;
  const xa = Math.min(xf, xf + o * 0.55), xb = Math.max(xf, xf + o * 0.55);
  const deep = 0.42;
  // reveal — the brick returns into the opening
  const rx = o < 0 ? [xf - 0.02, xf + deep] : [xf - deep, xf + 0.02];
  T.box(rx[0], w.y0, w.z0, rx[1], w.y1, w.z1,
    (f, n, c) => shadeLin(lot.brickHex, 0, 0.5), o < 0 ? 'pz nz py' : 'pz nz py');
  // what is in the window
  const sprite = A.get(w.sprite || 'win:sash');
  const px = xf - o * deep;
  const P = o < 0
    ? [[px, w.y0, w.z0], [px, w.y0, w.z1], [px, w.y1, w.z1], [px, w.y1, w.z0]]
    : [[px, w.y0, w.z1], [px, w.y0, w.z0], [px, w.y1, w.z0], [px, w.y1, w.z1]];
  const glassLit = texTint(litOf([o, 0, 0], xf, w.y0, w.z0) * 0.35, 0.12 + 0.10 * clamp01((w.y0 - 12) / 45));
  S.quad(P[0], P[1], P[2], P[3], glassLit, rectUV(sprite), [o, 0, 0]);
  // sash bars: 2-over-2, painted dark green or oxblood, never white
  const sashCol = (f, n, c) => shadeLin(lot.sashHex, litOf(n, c[0], c[1], c[2]) * 0.6, 0.15);
  const bx = [Math.min(px, px + o * 0.09), Math.max(px, px + o * 0.09)];
  T.box(bx[0], w.y0 + w.h * 0.5 - 0.10, w.z0, bx[1], w.y0 + w.h * 0.5 + 0.10, w.z1, sashCol, o < 0 ? 'nx py ny' : 'px py ny');
  T.box(bx[0], w.y0, (w.z0 + w.z1) / 2 - 0.07, bx[1], w.y1, (w.z0 + w.z1) / 2 + 0.07, sashCol, o < 0 ? 'nx pz nz' : 'px pz nz');
  T.box(bx[0], w.y1 - 0.16, w.z0, bx[1], w.y1, w.z1, sashCol, o < 0 ? 'nx ny' : 'px ny');
  // sill — brownstone, worn, projecting
  const sx = o < 0 ? [xf - 0.30, xf + 0.05] : [xf - 0.05, xf + 0.30];
  T.box(sx[0], w.y0 - 0.34, w.z0 - 0.35, sx[1], w.y0, w.z1 + 0.35,
    (f, n, c) => shadeLin(lot.stoneHex, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.55 : 0), `${lot.front} py ny pz nz`);
  // lintel — the most legible period signature on the whole facade
  const lx = o < 0 ? [xf - 0.36, xf + 0.05] : [xf - 0.05, xf + 0.36];
  T.box(lx[0], w.y1, w.z0 - 0.5, lx[1], w.y1 + 0.92, w.z1 + 0.5,
    (f, n, c) => shadeLin(lot.lintelHex, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.62 : 0), `${lot.front} py ny pz nz`);
  T.box(lx[0], w.y1 + 0.62, w.z0 - 0.66, lx[1], w.y1 + 0.92, w.z1 + 0.66,
    (f, n, c) => shadeLin(lot.lintelHex, litOf(n, c[0], c[1], c[2]) * 1.05, f === 'ny' ? 0.5 : 0), `${lot.front} py ny pz nz`);
}

function cornice(ctx, lot, top) {
  const T = ctx.b('trim'), W = ctx.b(lot.brickKey);
  const o = lot.out, xf = lot.xf, z0 = lot.z0, z1 = lot.z0 + M.lot;
  const X = (d0, d1) => (o < 0 ? [xf - d1, xf - d0] : [xf + d0, xf + d1]);
  const paint = lot.corniceHex;
  const SOOT = 0.42;                    // forty years of coal, worst right under the roofline
  const face = `${lot.front} py ny pz nz`;
  // bed mould
  let [a, b] = X(-0.05, 0.55);
  T.box(a, top, z0, b, top + 0.42, z1, (f, n, c) => shadeLin(paint, litOf(n, c[0], c[1], c[2]), SOOT + (f === 'ny' ? 0.5 : 0)), face);
  // scrolled brackets, 6-10 across 25ft — count varies building to building
  const nb = lot.brackets;
  for (let i = 0; i < nb; i++) {
    const cz = z0 + (i + 0.5) * (M.lot / nb);
    const [ba, bb] = X(-0.05, M.corniceOut * 0.82);
    T.box(ba, top + 0.42, cz - 0.30, bb, top + M.corniceH - 0.55, cz + 0.30,
      (f, n, c) => shadeLin(paint, litOf(n, c[0], c[1], c[2]), SOOT + (f === 'ny' ? 0.72 : f === 'pz' || f === 'nz' ? 0.3 : 0)), face);
    const [sa, sb] = X(M.corniceOut * 0.5, M.corniceOut * 0.9);
    T.box(sa, top + 0.9, cz - 0.42, sb, top + M.corniceH - 0.75, cz + 0.42,
      (f, n, c) => shadeLin(paint, litOf(n, c[0], c[1], c[2]) * 1.1, SOOT + (f === 'ny' ? 0.6 : 0)), face);
  }
  // dentil band
  if (lot.lod === 0) {
    for (let i = 0; i < 24; i++) {
      const cz = z0 + (i + 0.5) * (M.lot / 24);
      const [da, db] = X(0.5, 1.05);
      T.box(da, top + M.corniceH - 0.72, cz - 0.22, db, top + M.corniceH - 0.42, cz + 0.22,
        (f, n, c) => shadeLin(paint, litOf(n, c[0], c[1], c[2]), SOOT + (f === 'ny' ? 0.55 : 0)), face);
    }
  }
  // the shelf: 3ft of overhang and the darkest underside on the block
  const [ca, cb] = X(-0.05, M.corniceOut);
  T.box(ca, top + M.corniceH - 0.52, z0 - 0.12, cb, top + M.corniceH, z1 + 0.12,
    (f, n, c) => shadeLin(paint, litOf(n, c[0], c[1], c[2]), SOOT + (f === 'ny' ? 0.78 : 0)), face);
  const [ea, eb] = X(-0.05, M.corniceOut + 0.22);
  T.box(ea, top + M.corniceH, z0 - 0.16, eb, top + M.corniceH + 0.30, z1 + 0.16,
    (f, n, c) => shadeLin(paint, litOf(n, c[0], c[1], c[2]), SOOT + (f === 'ny' ? 0.5 : 0)), face);
  if (lot.pigeons) {
    const S = ctx.b('sign');
    const pu = ctx.atlas.get('pigeons');
    const px = o < 0 ? X(M.corniceOut - 0.9, M.corniceOut)[0] : X(M.corniceOut - 0.9, M.corniceOut)[1];
    const py0 = top + M.corniceH + 0.30, py1 = py0 + 1.55;
    const pz0 = z0 + M.lot * 0.24, pz1 = pz0 + 4.1;
    const P = o < 0
      ? [[px, py0, pz0], [px, py0, pz1], [px, py1, pz1], [px, py1, pz0]]
      : [[px, py0, pz1], [px, py0, pz0], [px, py1, pz0], [px, py1, pz1]];
    S.quad(P[0], P[1], P[2], P[3], texTint(litOf([o, 0, 0], lot.xf, py0, pz0)), rectUV(pu), [o, 0, 0]);
  }
  // parapet behind it, brick, with a stone coping
  const [pa, pb] = X(-0.05, 0.75);
  W.box(pa, top + M.corniceH, z0, pb, top + M.corniceH + M.parapet, z1,
    (f, n, c) => (f === lot.front || f === 'py' ? wallMul(lot, c[2], c[1], []) : [0.6, 0.6, 0.62]), `${lot.front} py`, 8);
  T.box(pa - 0.06, top + M.corniceH + M.parapet, z0, pb + 0.06, top + M.corniceH + M.parapet + 0.22, z1,
    (f, n, c) => shadeLin(lot.stoneHex, litOf(n, c[0], c[1], c[2]), 0), `${lot.front} py`);
}

/**
 * Fire escape: real iron, on the street facade, zig-zagged, inside the statutory 4ft 6in
 * projection, with the drop ladder resting at 10ft — out of a kid's reach, which is the
 * whole reason a ball on the second-floor balcony is an expedition.
 */
function fireEscape(ctx, lot) {
  const T = ctx.b('trim'), S = ctx.b('sign');
  const A = ctx.atlas;
  const o = lot.out, xf = lot.xf;
  const cz = lot.z0 + M.lot / 2;
  const bz0 = cz - 4.0, bz1 = cz + 4.0;
  const X = (d0, d1) => (o < 0 ? [xf - d1, xf - d0] : [xf + d0, xf + d1]);
  const iron = lot.ironHex;
  const col = (f, n, c) => shadeLin(iron, litOf(n, c[0], c[1], c[2]) * 0.55, f === 'ny' ? 0.34 : 0.12);
  const deck = 3.1;
  const levels = [];
  for (let f = 1; f < lot.storeys; f++) levels.push(M.ground + (f - 1) * M.floor + 1.85);

  levels.forEach((y, idx) => {
    const [xa, xb] = X(0.05, deck);
    // grating deck, so light passes through and it reads as lace
    const gu = rectUV(A.get('grate'));
    const lit = texTint(0.12, 0.22), dark = texTint(0, 0.40);
    for (let s = 0; s < 4; s++) {
      const za = bz0 + (bz1 - bz0) * (s / 4), zb = bz0 + (bz1 - bz0) * ((s + 1) / 4);
      S.quad([xa, y, za], [xb, y, za], [xb, y, zb], [xa, y, zb], lit, gu, [0, 1, 0]);
      S.quad([xa, y - 0.02, zb], [xb, y - 0.02, zb], [xb, y - 0.02, za], [xa, y - 0.02, za], dark, gu, [0, -1, 0]);
    }
    // the striped shadow the grating throws on the brick below it — drawn, never filtered
    {
      const sy = y - 1.30, sz = 0.95;
      if (litOf([o, 0, 0], xf, sy - 1, bz0) > 0.1) {
        const gs = A.get('bars');
        const uvR = [[gs.u0, gs.v1], [gs.u0, gs.v0], [gs.u1, gs.v0], [gs.u1, gs.v1]];
        const sx = xf + o * 0.04;
        const shadow = scaleLin(shadeLin(lot.brickHex, 0.30), 0.72);
        const P2 = o < 0
          ? [[sx, sy - 2.2, bz0 + sz], [sx, sy - 2.2, bz1 + sz], [sx, sy, bz1 + sz], [sx, sy, bz0 + sz]]
          : [[sx, sy - 2.2, bz1 + sz], [sx, sy - 2.2, bz0 + sz], [sx, sy, bz0 + sz], [sx, sy, bz1 + sz]];
        S.quad(P2[0], P2[1], P2[2], P2[3], shadow, uvR, [o, 0, 0]);
      }
    }
    // stringers and the outer beam
    T.box(xa, y - 0.30, bz0, xb, y - 0.02, bz0 + 0.16, col, 'px nx py ny pz nz');
    T.box(xa, y - 0.30, bz1 - 0.16, xb, y - 0.02, bz1, col, 'px nx py ny pz nz');
    const [oa, ob] = X(deck - 0.18, deck);
    T.box(oa, y - 0.34, bz0, ob, y - 0.02, bz1, col, 'px nx py ny pz nz');
    // railing: flat top rail, mid rail, pickets
    const rh = 2.9;
    const rails = [[y + rh - 0.12, y + rh], [y + rh * 0.52, y + rh * 0.52 + 0.08]];
    for (const [ra, rb] of rails) {
      T.box(oa, ra, bz0, ob, rb, bz1, col, 'px nx py ny pz nz');
      T.box(X(0.05, deck)[0], ra, bz0, X(0.05, deck)[1], rb, bz0 + 0.1, col, 'px nx py ny pz nz');
      T.box(X(0.05, deck)[0], ra, bz1 - 0.1, X(0.05, deck)[1], rb, bz1, col, 'px nx py ny pz nz');
    }
    const step = lot.lod === 0 ? 0.62 : 1.15;
    for (let z = bz0 + step * 0.5; z < bz1; z += step) {
      T.box(oa + 0.03, y, z - 0.045, ob - 0.03, y + rh, z + 0.045, col, 'px nx pz nz');
    }
    for (let d = 0.4; d < deck; d += step) {
      const [pa, pb] = X(d - 0.045, d + 0.045);
      T.box(pa, y, bz0 + 0.02, pb, y + rh, bz0 + 0.11, col, 'px nx pz nz');
      T.box(pa, y, bz1 - 0.11, pb, y + rh, bz1 - 0.02, col, 'px nx pz nz');
    }
    // corner posts
    for (const pz of [bz0, bz1 - 0.14]) {
      T.box(oa, y, pz, ob, y + rh, pz + 0.14, col, 'px nx pz nz');
    }
    // the stair to the level above, at alternating ends — never stacked
    if (idx < levels.length - 1) {
      const up = levels[idx + 1];
      const dir = idx % 2 ? 1 : -1;
      const sz0 = dir > 0 ? bz1 - 0.2 : bz0 + 0.2;
      const sz1 = sz0 + dir * 7.0;
      stairRun(T, X(0.35, deck - 0.35), y, up, sz0, sz1, col, lot);
    }
    // laundry over the rail, and a crate nobody has taken in
    if (lot.escapeProps && idx === lot.escapeProps.level) {
      const lu = A.get('laundry');
      const [la, lb] = X(deck - 0.12, deck - 0.06);
      const x = o < 0 ? la : lb;
      const P = o < 0
        ? [[x, y + 0.55, bz0 + 1.4], [x, y + 0.55, bz1 - 1.4], [x, y + 2.55, bz1 - 1.4], [x, y + 2.55, bz0 + 1.4]]
        : [[x, y + 0.55, bz1 - 1.4], [x, y + 0.55, bz0 + 1.4], [x, y + 2.55, bz0 + 1.4], [x, y + 2.55, bz1 - 1.4]];
      S.quad(P[0], P[1], P[2], P[3], texTint(litOf([o, 0, 0], xf, y + 1.5, cz)), rectUV(lu), [o, 0, 0]);
    }
    if (lot.escapeProps && idx === lot.escapeProps.crate) {
      const [ca, cb] = X(0.6, 2.0);
      T.box(ca, y, cz + 1.2, cb, y + 1.3, cz + 2.6, (f, n, c) => shadeLin(0x8a6a44, litOf(n, c[0], c[1], c[2])), 'px nx py pz nz');
    }
  });

  // drop ladder, resting at 10ft — the statute, and the reason kids jump for it
  const y0 = levels[0];
  const [la, lb] = X(deck - 1.5, deck - 0.35);
  stairRun(T, [la, lb], 10.2, y0, cz + 3.2, cz - 1.2, col, lot, true);
}

function stairRun(B, xs, yLo, yHi, zLo, zHi, col, lot, ladder = false) {
  const dz = zHi - zLo, dy = yHi - yLo;
  const n = ladder ? 7 : 11;
  const w = xs[1] - xs[0];
  // two stringers as sloping plates
  for (const t of [0, 1]) {
    const x = xs[0] + t * w;
    const c0 = col('px', [lot.out, 0, 0], [x, (yLo + yHi) / 2, (zLo + zHi) / 2]);
    B.quad([x, yLo, zLo], [x, yLo + 0.42, zLo], [x, yHi + 0.42, zHi], [x, yHi, zHi], c0, [[0, 0], [0, 1], [1, 1], [1, 0]], [t ? 1 : -1, 0, 0]);
    B.quad([x, yHi, zHi], [x, yHi + 0.42, zHi], [x, yLo + 0.42, zLo], [x, yLo, zLo], c0, [[0, 0], [0, 1], [1, 1], [1, 0]], [t ? -1 : 1, 0, 0]);
  }
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const y = yLo + dy * t, z = zLo + dz * t;
    B.box(xs[0], y, z - 0.16, xs[1], y + 0.10, z + 0.16, col, 'px nx py ny pz nz');
  }
  if (!ladder) {
    for (let i = 0; i <= 3; i++) {
      const t = i / 3;
      const y = yLo + dy * t, z = zLo + dz * t;
      B.box(xs[1] - 0.09, y, z - 0.05, xs[1], y + 2.7, z + 0.05, col, 'px nx pz nz');
    }
    B.quad([xs[1] - 0.05, yLo + 2.55, zLo], [xs[1] - 0.05, yLo + 2.7, zLo], [xs[1] - 0.05, yHi + 2.7, zHi], [xs[1] - 0.05, yHi + 2.55, zHi],
      col('px', [1, 0, 0], [xs[1], yLo + 2.6, zLo]), [[0, 0], [0, 1], [1, 1], [1, 0]], [1, 0, 0]);
  }
}

/** The stoop: the social organ of the block, and the seating for the whole crowd. */
function stoop(ctx, lot) {
  const T = ctx.b('trim'), W = ctx.b(lot.brickKey), S = ctx.b('sign');
  const o = lot.out, xf = lot.xf;
  const X = (d0, d1) => (o < 0 ? [xf - d1, xf - d0] : [xf + d0, xf + d1]);
  const cz = lot.z0 + M.lot * lot.stoopAt;
  const halfW = 2.75, cheek = 0.52;
  const risers = 7, rise = 0.68, tread = 0.85;
  const y0 = M.walkY;
  const parlour = y0 + risers * rise;
  const stone = lot.stoneHex;
  const scol = (f, n, c) => shadeLin(stone, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.5 : 0);

  // areaway: a sunken well either side of the stoop, guarded by iron
  for (const sgn of [-1, 1]) {
    const az0 = sgn < 0 ? lot.z0 + 0.4 : cz + halfW + cheek;
    const az1 = sgn < 0 ? cz - halfW - cheek : lot.z0 + M.lot - 0.4;
    if (az1 - az0 < 1) continue;
    // The well is dug inside the building line: the sidewalk out front belongs to another
    // piece and is a solid plane, so a pit on it would simply be roofed over.
    const IN = (d0, d1) => (o < 0 ? [xf + d0, xf + d1] : [xf - d1, xf - d0]);
    const [wa, wb] = IN(0, 4.4);
    T.box(wa, -4.2, az0, wb, -3.9, az1, () => shadeLin(0x8e877a, 0, 0.30), 'py');    // areaway floor
    const [ba, bb] = IN(4.15, 4.4);                                                  // the wall below grade
    W.box(ba, -3.9, az0, bb, y0 + 1.2, az1, () => [0.66, 0.64, 0.64], `${lot.front}`, 8);
    for (const ez of [az0, az1 - 0.3]) {                                             // dividing walls
      T.box(wa, -3.9, ez, wb, y0, ez + 0.3, () => shadeLin(stone, 0, 0.38), 'px nx pz nz py');
    }
    if (sgn > 0 && lot.basement) {                                                   // a basement shop
      const bx = o < 0 ? xf + 4.1 : xf - 4.1;
      const dz = (az0 + az1) / 2;
      const P = o < 0
        ? [[bx, -3.9, dz - 1.6], [bx, -3.9, dz + 1.6], [bx, 2.4, dz + 1.6], [bx, 2.4, dz - 1.6]]
        : [[bx, -3.9, dz + 1.6], [bx, -3.9, dz - 1.6], [bx, 2.4, dz - 1.6], [bx, 2.4, dz + 1.6]];
      S.quad(P[0], P[1], P[2], P[3], texTint(0, 0.26), rectUV(ctx.atlas.get(`glass:${lot.basement}`)), [o, 0, 0]);
      for (let i = 0; i < 4; i++) {                                                  // steps down under the stoop
        const [sa, sb] = IN(0.4 + i * 0.9, 4.4);
        T.box(sa, -3.9 + i * 1.1, dz - 1.8, sb, -3.9 + (i + 1) * 1.1, dz + 1.8, scol, `${lot.front} py`);
      }
    }
    const [ra, rb] = X(-0.15, 0.25);                                                 // low stone curb at the line
    T.box(ra, y0, az0, rb, y0 + 0.42, az1, scol, `${lot.front} py pz nz`);
    // railing: 5/8in bars at 5in centres, 34in tall
    const rc = (f, n, c) => shadeLin(lot.ironHex, litOf(n, c[0], c[1], c[2]) * 0.8, 0.1);
    T.box(ra + 0.05, y0 + 2.9, az0, rb - 0.05, y0 + 3.05, az1, rc, 'px nx py ny pz nz');
    for (let z = az0 + 0.25; z < az1; z += 0.44) {
      T.box(ra + 0.07, y0 + 0.42, z - 0.035, rb - 0.07, y0 + 2.9, z + 0.035, rc, 'px nx pz nz');
    }
  }

  // the steps, worn into a shallow dish in the middle of each tread
  for (let i = 0; i < risers; i++) {
    const [xa, xb] = X(0, (risers - i) * tread);
    T.box(xa, y0 + i * rise, cz - halfW, xb, y0 + (i + 1) * rise, cz + halfW, scol, `${lot.front} py pz nz`);
  }
  // cheek walls with a flat top — the preferred seat for a teenager too cool for the steps
  for (const sgn of [-1, 1]) {
    const z = cz + sgn * (halfW + cheek / 2);
    for (let i = 0; i < risers; i++) {
      const [xa, xb] = X(0, (risers - i) * tread);
      T.box(xa, y0, z - cheek / 2, xb, y0 + (i + 1) * rise + 0.34, z + cheek / 2, scol, `${lot.front} py pz nz`);
    }
    // iron rail following the slope
    const rc = (f, n, c) => shadeLin(lot.ironHex, litOf(n, c[0], c[1], c[2]) * 0.8, 0.1);
    for (let i = 0; i < risers; i++) {
      const [xa, xb] = X(0.15 + (risers - i - 1) * tread, 0.45 + (risers - i - 1) * tread);
      T.box(xa, y0 + (i + 1) * rise + 0.5, z - 0.05, xb, y0 + (i + 1) * rise + 3.0, z + 0.05, rc, 'px nx pz nz');
    }
    const [na, nb] = X(risers * tread - 0.55, risers * tread + 0.35);
    T.box(na, y0, z - 0.55, nb, y0 + 3.4, z + 0.55, scol, `${lot.front} py pz nz`);   // newel post
    T.box(na - 0.08, y0 + 3.4, z - 0.63, nb + 0.08, y0 + 3.62, z + 0.63, scol, `${lot.front} py pz nz`);
  }
  // landing and the double doors, with a transom and a bell panel
  const [la, lb] = X(0, 1.1);
  T.box(la, parlour - 0.3, cz - halfW - cheek, lb, parlour, cz + halfW + cheek, scol, `${lot.front} py pz nz`);
  const [da, db] = X(0.02, 0.36);
  T.box(da, parlour, cz - halfW + 0.1, db, parlour + 7.6, cz + halfW - 0.1,
    (f, n, c) => shadeLin(lot.doorHex, litOf(n, c[0], c[1], c[2]) * 0.5, 0.28), `${lot.front} py pz nz`);
  for (const dz of [-1, 1]) {                       // raised panels and a glass light in each leaf
    for (const [pa, pb] of [[0.55, 3.0], [3.5, 5.4]]) {
      T.box(da + o * 0.08, parlour + pa, cz + dz * 0.35 - 0.95, db + o * 0.08, parlour + pb, cz + dz * 0.35 + 0.95,
        (f, n, c) => shadeLin(lot.doorHex, 0, f === lot.front ? 0.16 : 0.42), `${lot.front} py ny pz nz`);
    }
    T.box(da + o * 0.06, parlour + 5.8, cz + dz * 0.35 - 0.9, db + o * 0.06, parlour + 7.1, cz + dz * 0.35 + 0.9,
      (f, n, c) => shadeLin(0x53565a, 0, 0.1), `${lot.front}`);
  }
  T.box(da - o * 0.06, parlour + 0.4, cz - 0.06, db - o * 0.06, parlour + 7.2, cz + 0.06,
    (f, n, c) => shadeLin(lot.doorHex, 0, 0.42), `${lot.front}`);
  const [ta, tb] = X(0.02, 0.2);
  const x = o < 0 ? ta : tb;
  const P = o < 0
    ? [[x, parlour + 7.6, cz - halfW], [x, parlour + 7.6, cz + halfW], [x, parlour + 9.0, cz + halfW], [x, parlour + 9.0, cz - halfW]]
    : [[x, parlour + 7.6, cz + halfW], [x, parlour + 7.6, cz - halfW], [x, parlour + 9.0, cz - halfW], [x, parlour + 9.0, cz + halfW]];
  S.quad(P[0], P[1], P[2], P[3], texTint(0, 0.18), rectUV(ctx.atlas.get('transom')), [o, 0, 0]);
  // door surround
  const [sa, sb] = X(0, 0.5);
  T.box(sa, parlour, cz - halfW - 0.45, sb, parlour + 9.5, cz - halfW, scol, `${lot.front} py pz nz`);
  T.box(sa, parlour, cz + halfW, sb, parlour + 9.5, cz + halfW + 0.45, scol, `${lot.front} py pz nz`);
  T.box(sa, parlour + 9.5, cz - halfW - 0.45, sb, parlour + 10.1, cz + halfW + 0.45, scol, `${lot.front} py ny pz nz`);
}

const X2 = (lot, d0, d1) => (lot.out < 0 ? [lot.xf - d1, lot.xf - d0] : [lot.xf + d0, lot.xf + d1]);

/** Chimney pots, water tanks, bulkheads, a coop — free period value over the cornice line. */
function roofFurniture(ctx, lot, top) {
  const T = ctx.b('trim'), W = ctx.b(lot.brickKey);
  const o = lot.out, xf = lot.xf;
  const roofY = top + M.corniceH - 0.4;
  const zc = lot.z0 + M.lot / 2;
  const inX = (d0, d1) => (o < 0 ? [xf + d0, xf + d1] : [xf - d1, xf - d0]);
  // flat tar roof
  const [ra, rb] = inX(0, M.depth);
  T.box(ra, roofY - 0.2, lot.z0, rb, roofY, lot.z0 + M.lot, (f, n, c) => shadeLin(0x5a4e46, 0.30), 'py');
  // chimney at the party wall, standing clear of the parapet, crowned with terracotta pots.
  // A cluster of pots against the sky is the strongest 1920s city silhouette there is.
  const parapetTop = top + M.corniceH + M.parapet;
  for (const cz of (lot.storeys >= 3 ? lot.chimneys : [])) {
    const [ca, cb] = inX(2.2, 5.4);
    const z = lot.z0 + cz * M.lot;
    const capY = parapetTop + lot.chimneyH;
    W.box(ca, roofY, z - 1.5, cb, capY, z + 1.5,
      (f, n, c) => (f === 'py' ? [0.6, 0.58, 0.57] : litOf(n, c[0], c[1], c[2]) > 0.3 ? [1.24, 1.2, 1.06] : [0.86, 0.87, 0.92]),
      `px nx py pz nz`, 8);
    T.box(ca - 0.14, capY, z - 1.64, cb + 0.14, capY + 0.34, z + 1.64,
      (f, n, c) => shadeLin(lot.stoneHex, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.4 : 0), 'px nx py pz nz');
    for (let i = 0; i < lot.pots; i++) {
      const px = (ca + cb) / 2 + (i % 2 ? 0.8 : -0.8);
      const pz = z - 0.75 + Math.floor(i / 2) * 0.9;
      T.cyl(px, pz, 0.44, capY + 0.34, capY + 2.0 + (i % 3) * 0.42, 7,
        (n2, c) => shadeLin(0xb8724a, litOf(n2, c[0], c[1], c[2])));
      T.cyl(px, pz, 0.30, capY + 2.0 + (i % 3) * 0.42, capY + 2.14 + (i % 3) * 0.42, 7,
        (n2, c) => shadeLin(0x6b4235, 0, 0.2));
    }
  }
  // roof-stair bulkhead
  if (lot.storeys >= 3) {
    const [ba, bb] = inX(9, 17);
    T.box(ba, roofY, zc - 3, bb, roofY + 8, zc + 3, (f, n, c) => shadeLin(0x6b5a44, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.4 : 0), 'px nx py pz nz');
  }
  // a painted board on the roof of a one-storey taxpayer, facing down the street
  if (lot.roofsign) {
    const S = ctx.b('sign');
    const sign = ctx.atlas.get('roofsign:1');
    const [sa, sb] = X2(lot, -0.1, 0.5);
    const px = lot.out < 0 ? sa : sb;
    const y0 = top + M.corniceH + M.parapet, y1 = y0 + 6.2;
    const za = lot.z0 + 2, zb = lot.z0 + M.lot - 2;
    const P = lot.out < 0
      ? [[px, y0, za], [px, y0, zb], [px, y1, zb], [px, y1, za]]
      : [[px, y0, zb], [px, y0, za], [px, y1, za], [px, y1, zb]];
    S.quad(P[0], P[1], P[2], P[3], texTint(litOf([lot.out, 0, 0], lot.xf, y0, za)), rectUV(sign), [lot.out, 0, 0]);
    for (const pz of [za + 1, (za + zb) / 2, zb - 1]) {
      T.box(Math.min(sa, sb) - 0.1, top + M.corniceH, pz - 0.16, Math.max(sa, sb) + 0.1, y1, pz + 0.16,
        () => shadeLin(0x4a4a44, 0.2), 'px nx pz nz');
    }
  }
  // water tank — only where city pressure cannot reach, so only on the tall buildings
  if (lot.tank) {
    const [ta, tb] = inX(13, 25);
    const tx = (ta + tb) / 2, tz = zc + lot.tankZ;
    const legY = roofY + 15;
    for (const dx of [-4.4, 4.4]) for (const dz of [-4.4, 4.4]) {
      T.box(tx + dx - 0.3, roofY, tz + dz - 0.3, tx + dx + 0.3, legY, tz + dz + 0.3,
        (f, n, c) => shadeLin(0x6b5a44, litOf(n, c[0], c[1], c[2]), 0.1), 'px nx pz nz');
    }
    for (const dz of [-4.4, 4.4]) {
      T.quad([tx - 4.4, roofY + 5, tz + dz], [tx + 4.4, legY - 1, tz + dz], [tx + 4.4, legY - 0.5, tz + dz], [tx - 4.4, roofY + 5.5, tz + dz],
        shadeLin(0x6b5a44, 0.2), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0, dz > 0 ? 1 : -1]);
    }
    T.cyl(tx, tz, 5.6, legY, legY + 11, 14, (n, c) => shadeLin(0x8e8579, litOf(n, c[0], c[1], c[2]) * 0.9), '');
    for (const hy of [legY + 1.2, legY + 5.5, legY + 9.6]) {
      T.cyl(tx, tz, 5.75, hy, hy + 0.35, 14, (n, c) => shadeLin(0x4a4038, litOf(n, c[0], c[1], c[2])), '');
    }
    // conical roof
    for (let i = 0; i < 14; i++) {
      const a0 = (i / 14) * Math.PI * 2, a1 = ((i + 1) / 14) * Math.PI * 2;
      const p0 = [tx + Math.cos(a0) * 5.9, legY + 11, tz + Math.sin(a0) * 5.9];
      const p1 = [tx + Math.cos(a1) * 5.9, legY + 11, tz + Math.sin(a1) * 5.9];
      const apex = [tx, legY + 14.2, tz];
      const n = [Math.cos(a0 + 0.22) * 0.7, 0.7, Math.sin(a0 + 0.22) * 0.7];
      T.quad(p0, p1, apex, apex, shadeLin(0x6b5a44, litOf(n, p0[0], p0[1], p0[2])), [[0, 0], [1, 0], [0.5, 1], [0.5, 1]], n);
    }
  }
  if (lot.coop) {
    const [ca, cb] = inX(6, 15);
    const S = ctx.b('sign');
    T.box(ca, roofY, zc - 5, cb, roofY + 4.5, zc + 5, (f, n, c) => shadeLin(0x8a6a44, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.3 : 0), 'px nx py pz nz');
    const cu = ctx.atlas.get('coop');
    const x = o < 0 ? ca - 0.05 : cb + 0.05;
    const P = o < 0
      ? [[x, roofY + 1, zc - 5], [x, roofY + 1, zc + 5], [x, roofY + 4.2, zc + 5], [x, roofY + 4.2, zc - 5]]
      : [[x, roofY + 1, zc + 5], [x, roofY + 1, zc - 5], [x, roofY + 4.2, zc - 5], [x, roofY + 4.2, zc + 5]];
    S.quad(P[0], P[1], P[2], P[3], texTint(0.4), rectUV(cu), [-o, 0, 0]);
  }
}

/** An exposed party wall where the next lot is lower — and the right place for a wall ad. */
function partyWall(ctx, lot, top) {
  const T = ctx.b('sign'), W = ctx.b('wallStone');
  const o = lot.out, xf = lot.xf;
  const z = lot.z0;
  const y0 = lot.exposedFrom, y1 = top + M.corniceH + M.parapet;
  if (y1 - y0 < 3) return;
  const [xa, xb] = o < 0 ? [xf, xf + M.depth] : [xf - M.depth, xf];
  const n = [0, 0, -1];
  const lit = litOf(n, xa, (y0 + y1) / 2, z);
  const k = 1 + 0.34 * Math.min(1, lit / 0.4);
  W.quad([xb, y0, z], [xa, y0, z], [xa, y1, z], [xb, y1, z],
    [k * 0.98, k * 0.99, k * 1.0], [[0, y0 / 8], [M.depth / 8, y0 / 8], [M.depth / 8, y1 / 8], [0, y1 / 8]], n);
  if (lot.ghost) {
    const slot = ctx.atlas.get(`ghost:${lot.ghost}`);
    const h = Math.min(y1 - y0 - 2, 34);
    const w = Math.min(M.depth - 5, h * (slot.w / slot.h));
    const ax = o < 0 ? xf + 2.5 : xf - 2.5 - w;
    // a wall dog worked from a swing stage, so the ad sits where the wall is, not at the top
    const ay = y1 - y0 > 34 ? y0 + (y1 - y0 - h) * 0.45 : y1 - 3.5 - h;
    T.quad([ax + w, ay, z - 0.06], [ax, ay, z - 0.06], [ax, ay + h, z - 0.06], [ax + w, ay + h, z - 0.06],
      texTint(lit), rectUV(slot), n);
  }
  if (y1 - y0 > 26 && !lot.bills) lot.bills = 'bills2';   // paper finds every blank wall
  if (lot.bills) {
    const slot = ctx.atlas.get(lot.bills);
    const ax = o < 0 ? xf + 1.2 : xf - 1.2 - 9;
    T.quad([ax + 9, y0 + 0.5, z - 0.06], [ax, y0 + 0.5, z - 0.06], [ax, y0 + 7.5, z - 0.06], [ax + 9, y0 + 7.5, z - 0.06],
      texTint(lit), rectUV(slot), n);
  }
}

/** One 25ft lot, built as a kit and varied — never an extruded prefab. */
export function buildTenement(ctx, lot) {
  const top = storeyTop(lot.storeys);
  const wins = windowRects(lot);
  for (const w of wins) w.sprite = lot.sprites[(w.f * 4 + w.i) % lot.sprites.length];
  wallGrid(ctx.b(lot.brickKey), lot, wins.concat(lot.holes || []), top, lot.ground === 'store' ? M.ground : 0);
  for (const w of wins) windowUnit(ctx, lot, w);
  // water table: a stone band separating store from dwelling
  const T = ctx.b('trim');
  const X = (d0, d1) => (lot.out < 0 ? [lot.xf - d1, lot.xf - d0] : [lot.xf + d0, lot.xf + d1]);
  const [wa, wb] = X(-0.05, 0.42);
  T.box(wa, M.ground - 0.55, lot.z0, wb, M.ground, lot.z0 + M.lot,
    (f, n, c) => shadeLin(lot.stoneHex, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.45 : 0), `${lot.front} py ny`);
  cornice(ctx, lot, top);
  if (lot.fireEscape) fireEscape(ctx, lot);
  if (lot.ground === 'stoop') stoop(ctx, lot);
  roofFurniture(ctx, lot, top);
  if (lot.exposedFrom != null) partyWall(ctx, lot, top);
}

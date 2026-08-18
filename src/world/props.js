import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { RNG } from '../core/rng.js';
import {
  CHALK, INK, PAVEMENT, FACADE, AIR, ACCENTS, CLOTH, BALL, soot, sunlit,
} from '../render/palette.js';

/* =============================================================================
 * THE STREET KIT
 * -----------------------------------------------------------------------------
 * Shared toolbox for the three files of the surface-and-props piece
 * (surface.js / props.js / vehicles.js). It lives here, in the leaf of the
 * little dependency chain, so surface.js -> {props, vehicles} -> props stays a
 * DAG and nothing has to be imported twice.
 *
 * Nothing in here reaches outside the piece.  All colour comes from
 * render/palette.js; all randomness from core/rng.js; all lettering is drawn
 * from the procedural slab face below, never from a system font.
 * ========================================================================== */

/** One place for every dimension the three files have to agree on. */
export const GROUND = {
  curbX: 22.0,        // roadway edge / curb face
  curbW: 1.3,         // granite curb stone width
  walkTop: 0.55,      // top of the bluestone sidewalk (matches world/street.js)
  walkOuter: 32.0,    // building line
  facadeX: 31.9,      // where a wall decal has to sit to graze the brick
  crown: 0.52,        // how proud the middle of the road stands over the gutter
  roadY: 0.03,        // the paving deck floats this far over y=0
};

/** The crowned profile of the roadway: humped in the middle, dished at the gutter. */
export function roadHeight(x) {
  const a = Math.abs(x);
  if (a <= 19) return GROUND.roadY + GROUND.crown * (1 - Math.pow(a / 19, 1.75));
  if (a <= 21) return GROUND.roadY - 0.075 * Math.sin(Math.PI * (a - 19) / 2);
  if (a <= GROUND.curbX) return GROUND.roadY;
  return GROUND.walkTop;
}

export const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;

export function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((Math.round(ar + (br - ar) * t) << 16) |
          (Math.round(ag + (bg - ag) * t) << 8) |
          Math.round(ab + (bb - ab) * t));
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  return { c, g };
}

export function canvasTexture(c, opt = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opt.aniso ?? 4;
  if (opt.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(opt.repeat[0], opt.repeat[1]);
  }
  t.needsUpdate = true;
  return t;
}

/* ---------------------------------------------------------------------------
 * CURB CHALK — a condensed fat Egyptian / French Clarendon, drawn from
 * skeleton polylines on a 6x10 box and slabbed at every terminal.  All caps.
 * Two renderings share the skeleton: painted slab, and soft broken chalk.
 * ------------------------------------------------------------------------ */
const G = {
  A: [[[0, 0], [3, 10], [6, 0]], [[1.15, 3.3], [4.85, 3.3]]],
  B: [[[1, 0], [1, 10]], [[1, 10], [4.1, 10], [5.4, 8.6], [5.3, 6.4], [4, 5.3], [1, 5.3]], [[1, 5.3], [4.4, 5.3], [5.8, 3.8], [5.6, 1.3], [4.3, 0], [1, 0]]],
  C: [[[5.5, 7.8], [4.3, 9.6], [2.3, 10], [1, 8.2], [0.6, 5], [1, 1.8], [2.3, 0], [4.3, 0.5], [5.5, 2.3]]],
  D: [[[1, 0], [1, 10]], [[1, 10], [3.8, 10], [5.6, 7.6], [5.6, 2.4], [3.8, 0], [1, 0]]],
  E: [[[5.6, 10], [1, 10], [1, 0], [5.6, 0]], [[1, 5.1], [4.5, 5.1]]],
  F: [[[5.6, 10], [1, 10], [1, 0]], [[1, 5.1], [4.5, 5.1]]],
  G: [[[5.5, 7.8], [4.3, 9.6], [2.3, 10], [1, 8.2], [0.6, 5], [1, 1.8], [2.3, 0], [4.6, 0.8], [5.5, 3], [5.5, 4.6], [3.3, 4.6]]],
  H: [[[1, 0], [1, 10]], [[5, 0], [5, 10]], [[1, 5.1], [5, 5.1]]],
  I: [[[3, 0], [3, 10]]],
  J: [[[5, 10], [5, 2.6], [3.9, 0.2], [1.8, 0.5], [0.9, 2.6]]],
  K: [[[1, 0], [1, 10]], [[5.6, 10], [1.5, 4.7]], [[2.5, 6.1], [5.8, 0]]],
  L: [[[1, 10], [1, 0], [5.6, 0]]],
  M: [[[0.6, 0], [0.6, 10], [3, 4.2], [5.4, 10], [5.4, 0]]],
  N: [[[0.8, 0], [0.8, 10], [5.2, 0.4], [5.2, 10]]],
  O: [[[3, 10], [1.1, 8.5], [0.6, 5], [1.1, 1.5], [3, 0], [4.9, 1.5], [5.4, 5], [4.9, 8.5], [3, 10]]],
  P: [[[1, 0], [1, 10]], [[1, 10], [4.2, 10], [5.6, 8.4], [5.5, 6], [4.2, 4.6], [1, 4.6]]],
  Q: [[[3, 10], [1.1, 8.5], [0.6, 5], [1.1, 1.5], [3, 0], [4.9, 1.5], [5.4, 5], [4.9, 8.5], [3, 10]], [[3.5, 2.6], [5.9, -0.4]]],
  R: [[[1, 0], [1, 10]], [[1, 10], [4.2, 10], [5.6, 8.4], [5.5, 6], [4.2, 4.6], [1, 4.6]], [[3.1, 4.6], [5.8, 0]]],
  S: [[[5.4, 8.3], [3.9, 9.9], [1.8, 9.7], [0.7, 8.1], [1.3, 6.1], [4.5, 4.6], [5.4, 2.6], [4.3, 0.4], [2, 0.2], [0.6, 1.7]]],
  T: [[[0.4, 10], [5.6, 10]], [[3, 10], [3, 0]]],
  U: [[[1, 10], [1, 2.4], [2.5, 0.2], [4.1, 0.4], [5, 2.4], [5, 10]]],
  V: [[[0.4, 10], [3, 0], [5.6, 10]]],
  W: [[[0.2, 10], [1.6, 0], [3, 5.8], [4.4, 0], [5.8, 10]]],
  X: [[[0.6, 10], [5.4, 0]], [[5.4, 10], [0.6, 0]]],
  Y: [[[0.6, 10], [3, 5.1], [5.4, 10]], [[3, 5.1], [3, 0]]],
  Z: [[[0.6, 10], [5.4, 10], [0.8, 0], [5.4, 0]]],
  0: [[[3, 10], [1.1, 8.5], [0.6, 5], [1.1, 1.5], [3, 0], [4.9, 1.5], [5.4, 5], [4.9, 8.5], [3, 10]], [[1.5, 2], [4.5, 8]]],
  1: [[[1.3, 7.9], [3, 10], [3, 0]], [[1.2, 0], [4.8, 0]]],
  2: [[[0.8, 8.3], [2.2, 10], [4.4, 9.7], [5.4, 8], [4.7, 5.5], [0.8, 0], [5.6, 0]]],
  3: [[[0.8, 9.1], [2.6, 10], [4.8, 9.3], [5.2, 7.5], [3.5, 5.4], [5.4, 3.6], [5, 1], [2.6, 0], [0.8, 0.9]]],
  4: [[[4.4, 0], [4.4, 10], [0.6, 3.1], [5.7, 3.1]]],
  5: [[[5.4, 10], [1.4, 10], [1, 5.6], [3.4, 6], [5.4, 4.5], [5.2, 1.8], [3, 0], [0.8, 0.9]]],
  6: [[[5, 9.3], [3, 10], [1.2, 8], [0.7, 4], [1.6, 1], [3.6, 0], [5.2, 1.6], [5, 4], [3, 5], [1, 4]]],
  7: [[[0.6, 10], [5.6, 10], [2.5, 0]]],
  8: [[[3, 5.2], [1.2, 6.6], [1, 8.6], [3, 10], [5, 8.6], [4.8, 6.6], [3, 5.2], [1, 3.8], [0.8, 1.6], [3, 0], [5.2, 1.6], [5, 3.8], [3, 5.2]]],
  9: [[[1, 0.7], [3, 0], [5, 2], [5.3, 6], [4.4, 9], [2.4, 10], [0.8, 8.4], [1, 6], [3, 5], [5, 6]]],
  '.': [[[2.7, 0.4], [3.3, 0.4]]],
  ',': [[[3.1, 0.6], [2.4, -1.6]]],
  "'": [[[3, 10], [2.6, 7.2]]],
  '-': [[[1, 4.8], [5, 4.8]]],
  '·': [[[2.7, 4.8], [3.3, 4.8]]],
  ':': [[[2.7, 7], [3.3, 7]], [[2.7, 1.4], [3.3, 1.4]]],
  '!': [[[3, 10], [3, 2.8]], [[2.7, 0.4], [3.3, 0.4]]],
  '/': [[[0.8, -0.8], [5.2, 10.6]]],
  '&': [[[5.7, 0], [1.6, 6.8], [2.2, 9.6], [4, 9.7], [4.3, 7.8], [0.9, 4], [0.8, 1.5], [2.6, 0], [4.6, 1.4], [5.6, 3.4]]],
  '¢': [[[4.9, 7.6], [3.9, 9], [2.2, 9.2], [1, 7.6], [0.7, 5], [1, 2.4], [2.2, 0.8], [3.9, 1], [4.9, 2.4]], [[3, 10.4], [3, -0.4]]],
  '(': [[[4.4, 10.4], [2.2, 7], [2.2, 3], [4.4, -0.4]]],
  ')': [[[1.6, 10.4], [3.8, 7], [3.8, 3], [1.6, -0.4]]],
  '*': [[[3, 9.6], [3, 6.2]], [[1.6, 9.2], [4.4, 6.6]], [[4.4, 9.2], [1.6, 6.6]]],
  ' ': [],
};

const GW = 6, GH = 10;

function glyphPaths(ch) { return G[ch] || G[ch.toUpperCase()] || G[' ']; }

/** width of a string in px at cap-height `size` */
export function slabWidth(text, size, tracking = 0.16) {
  const s = size / GH;
  return text.length * (GW * s + tracking * size) - tracking * size;
}

/**
 * Paint a string in CURB CHALK — painted-slab rendering.
 * opts: {color, weight (0..1 stroke fraction), align 'left'|'center'|'right',
 *        tracking, serif, shadow:{dx,dy,color}, jitter, seed, condense}
 */
export function slabText(g, text, x, y, size, opts = {}) {
  const col = opts.color ?? '#f6f0e2';
  const tracking = opts.tracking ?? 0.16;
  const condense = opts.condense ?? 1;
  const s = size / GH;
  const adv = GW * s * condense + tracking * size;
  const total = text.length * adv - tracking * size;
  let ox = x;
  if (opts.align === 'center') ox = x - total / 2;
  if (opts.align === 'right') ox = x - total;
  const lw = Math.max(1, size * (opts.weight ?? 0.2));
  const serif = opts.serif ?? size * 0.17;
  const jit = opts.jitter ?? 0;
  const r = new RNG(opts.seed ?? 7);

  const paint = (color, dx, dy) => {
    g.save();
    g.strokeStyle = color; g.fillStyle = color;
    g.lineWidth = lw; g.lineCap = 'round'; g.lineJoin = 'round';
    let px = ox;
    for (const ch of text) {
      const paths = glyphPaths(ch);
      const jr = jit ? (r.next() - 0.5) * jit * 0.03 : 0;
      const js = jit ? 1 + (r.next() - 0.5) * jit * 0.05 : 1;
      const jb = jit ? (r.next() - 0.5) * jit * 0.03 * size : 0;
      g.save();
      g.translate(px + dx + (GW * s * condense) / 2, y + dy + jb);
      g.rotate(jr);
      g.scale(condense * js, js);
      g.translate(-(GW * s) / 2, 0);
      for (const path of paths) {
        g.beginPath();
        for (let i = 0; i < path.length; i++) {
          const X = path[i][0] * s, Y = -path[i][1] * s;
          if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
        }
        g.stroke();
        if (serif > 0 && path.length > 1) {
          for (const [a, b] of [[0, 1], [path.length - 1, path.length - 2]]) {
            const p = path[a], q = path[b];
            const dxs = (q[0] - p[0]) * s, dys = (q[1] - p[1]) * s;
            const X = p[0] * s, Y = -p[1] * s;
            if (Math.abs(dys) >= Math.abs(dxs)) g.fillRect(X - serif, Y - lw / 2, serif * 2, lw);
            else g.fillRect(X - lw / 2, Y - serif, lw, serif * 2);
          }
        }
      }
      g.restore();
      px += adv;
    }
    g.restore();
  };

  if (opts.shadow) paint(opts.shadow.color, opts.shadow.dx, opts.shadow.dy);
  paint(col, 0, 0);
  return total;
}

/** A short broken dash-stroke that reads as soft schoolroom chalk. */
export function chalkStroke(g, pts, width, seed = 3, alpha = 0.85, color = '#f6f0e2') {
  const r = new RNG(seed);
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = color;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.round(len / Math.max(3, width * 1.6)));
    for (let s = 0; s < steps; s++) {
      if (r.next() < 0.13) continue;                 // a gap: the mark is half scuffed away
      const t0 = s / steps, t1 = (s + 1) / steps;
      const jx = (r.next() - 0.5) * width * 0.7, jy = (r.next() - 0.5) * width * 0.7;
      g.globalAlpha = alpha * r.range(0.42, 1.0);
      g.lineWidth = width * r.range(0.62, 1.15);
      g.beginPath();
      g.moveTo(x0 + (x1 - x0) * t0 + jx, y0 + (y1 - y0) * t0 + jy);
      g.lineTo(x0 + (x1 - x0) * t1 + jx, y0 + (y1 - y0) * t1 + jy);
      g.stroke();
    }
  }
  g.restore();
}

/** Lettering in chalk: the slab skeleton, drawn with the broken chalk brush. */
export function chalkText(g, text, x, y, size, opts = {}) {
  const tracking = opts.tracking ?? 0.2;
  const condense = opts.condense ?? 1;
  const s = size / GH;
  const adv = GW * s * condense + tracking * size;
  const total = text.length * adv - tracking * size;
  let px = x;
  if (opts.align === 'center') px = x - total / 2;
  if (opts.align === 'right') px = x - total;
  const w = Math.max(1.2, size * (opts.weight ?? 0.13));
  let seed = opts.seed ?? 11;
  for (const ch of text) {
    for (const path of glyphPaths(ch)) {
      const pts = path.map(([X, Y]) => [px + X * s * condense, y - Y * s]);
      chalkStroke(g, pts, w, seed++, opts.alpha ?? 0.9, opts.color ?? '#f6f0e2');
    }
    px += adv;
  }
  return total;
}

/** Slab lettering bent around an arc — cast-iron rim text. */
export function arcText(g, text, cx, cy, radius, midAngle, size, opts = {}) {
  const spread = opts.spread ?? 0.13;             // radians per glyph
  const flip = opts.flip ? -1 : 1;
  const n = text.length;
  let a = midAngle - ((n - 1) / 2) * spread;
  for (const ch of text) {
    g.save();
    g.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    g.rotate(a + (flip > 0 ? Math.PI / 2 : -Math.PI / 2));
    slabText(g, ch, 0, flip > 0 ? size * 0.5 : -size * 0.5, size,
      { ...opts, align: 'center', tracking: 0 });
    g.restore();
    a += spread;
  }
}

/* ---------------------------------------------------------------------------
 * Materials, outlines and the drawn contact shadow
 * ------------------------------------------------------------------------ */

export function mat(color, opt = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opt });
}

/** Flat ink, unaffected by light — for outline shells and cast-shadow decals. */
export function flat(color, opt = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opt });
}

const OUTLINE_CACHE = new Map();
export function outlineMat(thick = 0.05) {
  const key = thick.toFixed(3);
  if (OUTLINE_CACHE.has(key)) return OUTLINE_CACHE.get(key);
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide, fog: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.oThick = { value: thick };
    sh.vertexShader = 'uniform float oThick;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n\ttransformed += normalize( normal ) * oThick;'
    );
  };
  m.customProgramCacheKey = () => 'outline' + key;
  OUTLINE_CACHE.set(key, m);
  return m;
}

/** Give a mesh a 1-2 px ink outline by way of a back-face shell. */
export function outline(mesh, thick = 0.05) {
  const shell = new THREE.Mesh(mesh.geometry, outlineMat(thick));
  shell.renderOrder = (mesh.renderOrder || 0) - 1;
  mesh.add(shell);
  return mesh;
}

let SHADOW_TEX = null;
function shadowTexture() {
  if (SHADOW_TEX) return SHADOW_TEX;
  const { c, g } = makeCanvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.92)');
  grd.addColorStop(0.82, 'rgba(255,255,255,0.42)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  SHADOW_TEX = new THREE.CanvasTexture(c);
  SHADOW_TEX.colorSpace = THREE.SRGBColorSpace;
  return SHADOW_TEX;
}

/**
 * Mandatory under every prop and every vehicle: a soft blue-violet ellipse,
 * offset the way the 3:50pm sun throws it. One instanced draw call per module.
 */
export function makeShadowPool(scene, count = 160) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({
    map: shadowTexture(), color: AIR.shadowTint, transparent: true, opacity: 0.4,
    depthWrite: false, blending: THREE.NormalBlending,
  });
  const mesh = new THREE.InstancedMesh(geo, m, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.count = 0;
  scene.add(mesh);
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  let i = 0;
  return {
    mesh,
    /** x,z centre on the ground; h = how high the object stands; rx,rz = radii */
    add(x, z, rx, rz, h = 1, strength = 1, yBase = null) {
      if (i >= count) return;
      const y = (yBase == null ? roadHeight(x) : yBase) + 0.012;
      d.position.set(x + h * 0.30, y, z - h * 0.17);
      d.rotation.set(0, 0, 0);
      d.scale.set(rx * 2, 1, rz * 2);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      const k = Math.min(1, 0.55 + 0.45 * strength);
      col.setHex(0xffffff).multiplyScalar(k);
      mesh.setColorAt(i, col);
      i++; mesh.count = i;
    },
    finish() {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}

/** Anything the ball is allowed to bounce off. The physics piece reads this. */
export function addCollider(app, def) {
  app.world = app.world || {};
  app.world.colliders = app.world.colliders || [];
  app.world.colliders.push(def);
  return def;
}
export function addSewer(app, def) {
  app.world = app.world || {};
  app.world.sewers = app.world.sewers || [];
  app.world.sewers.push(def);
  return def;
}
function boxCollider(app, obj, name, kind, sound, restitution = 0.45) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj);
  return addCollider(app, { name, kind, sound, restitution, box });
}
export { boxCollider };

/* =============================================================================
 * THE PROPS
 * ========================================================================== */

const R = new RNG(90210);

/* --- canvas textures ------------------------------------------------------ */

function ironTexture(base, seed) {
  const { c, g } = makeCanvas(128, 128);
  const r = new RNG(seed);
  g.fillStyle = hex(base); g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 240; i++) {
    g.globalAlpha = r.range(0.05, 0.2);
    g.fillStyle = r.chance(0.5) ? hex(mixHex(base, FACADE.iron[2], 0.7)) : hex(soot(base, 0.25));
    const x = r.range(0, 128), y = r.range(0, 128), s = r.range(2, 9);
    g.fillRect(x, y, s, s * r.range(0.4, 1.4));
  }
  g.globalAlpha = 1;
  return canvasTexture(c, { repeat: [1, 1] });
}

function enamelSignTexture(lines, bg, fg, w = 256, h = 128) {
  const { c, g } = makeCanvas(w, h);
  g.fillStyle = hex(bg); g.fillRect(0, 0, w, h);
  g.strokeStyle = hex(fg); g.lineWidth = 3; g.globalAlpha = 0.8;
  g.strokeRect(5, 5, w - 10, h - 10);
  g.globalAlpha = 1;
  const step = h / (lines.length + 0.6);
  lines.forEach((ln, i) => {
    slabText(g, ln, w / 2, step * (i + 1.15), step * 0.6,
      { align: 'center', color: hex(fg), weight: 0.19, condense: 0.86, jitter: 0.6, seed: 31 + i });
  });
  return canvasTexture(c);
}

/* --- little geometry helpers --------------------------------------------- */

function lathe(profile, seg = 16) {
  return new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), seg);
}
function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
function cyl(rt, rb, h, s = 12) { return new THREE.CylinderGeometry(rt, rb, h, s); }

function put(parent, geo, material, x, y, z, rot) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  if (rot) m.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  parent.add(m);
  return m;
}

/* --- instanced kit -------------------------------------------------------- */

/**
 * Builds one InstancedMesh per part of a repeated prop, so ten ash cans cost
 * the same number of draw calls as one.
 */
class Kit {
  constructor(scene) { this.scene = scene; this.parts = []; this.placements = []; }
  part(geo, material, thick = 0) { const p = { geo, material, thick, xf: [] }; this.parts.push(p); return p; }
  /** local transform of a part inside one copy */
  add(part, m) { part.xf.push(m); }
  place(matrix) { this.placements.push(matrix); }
  build() {
    const d = new THREE.Object3D();
    for (const p of this.parts) {
      const n = p.xf.length * this.placements.length;
      if (!n) continue;
      const im = new THREE.InstancedMesh(p.geo, p.material, n);
      let sh = null;
      if (p.thick > 0) { sh = new THREE.InstancedMesh(p.geo, outlineMat(p.thick), n); sh.renderOrder = -1; }
      let i = 0;
      for (const place of this.placements) {
        for (const local of p.xf) {
          const m = new THREE.Matrix4().multiplyMatrices(place, local);
          im.setMatrixAt(i, m);
          if (sh) sh.setMatrixAt(i, m);
          i++;
        }
      }
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      this.scene.add(im);
      if (sh) { sh.instanceMatrix.needsUpdate = true; sh.frustumCulled = false; this.scene.add(sh); }
    }
    void d;
  }
}

function xf(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.scale.set(sx, sy, sz);
  o.updateMatrix();
  return o.matrix.clone();
}

/* =========================================================================== */

export function buildProps(app) {
  const scene = app.scene;
  const root = new THREE.Group();
  root.name = 'props';
  scene.add(root);

  const shadows = makeShadowPool(scene, 220);
  const anim = { laundry: [], barber: null, dog: null, cards: null, pigeon: null };

  const ironDark = mat(FACADE.iron[0]);
  const ironGreen = mat(0x2b3a30);
  const woodWarm = mat(0x8a6a44);
  const woodPale = mat(0xa9895e);
  const woodGrey = mat(0x8b7f6b);
  const stone = mat(PAVEMENT.curb);
  const galv = mat(0x8e8d86);
  const galvDark = mat(0x6f6e68);

  /* ------------------------------------------------------------------ *
   * Bishop's crook lamp posts — 13 ft of fluted cast iron, quarter-turn
   * crook with a scrolled tail, teardrop luminaire.  Third base is one.
   * ------------------------------------------------------------------ */
  {
    const kit = new Kit(root);
    const base = kit.part(lathe([[0, 0], [0.78, 0], [0.78, 0.32], [0.6, 0.42], [0.6, 0.95],
      [0.44, 1.12], [0.44, 1.5], [0.33, 1.62]], 14), ironGreen, 0.045);
    kit.add(base, xf(0, 0, 0));
    const shaft = kit.part(cyl(0.20, 0.30, 11.4, 12), ironGreen, 0.04);
    kit.add(shaft, xf(0, 1.62 + 5.7, 0));
    const garland = kit.part(lathe([[0.24, 0], [0.36, 0.12], [0.4, 0.3], [0.34, 0.5], [0.24, 0.6]], 14), ironGreen, 0.04);
    kit.add(garland, xf(0, 12.2, 0));
    // the crook: five short segments swinging a quarter turn out over the curb
    const crookSeg = kit.part(cyl(0.15, 0.16, 1.28, 8), ironGreen, 0.035);
    const steps = 7, rad = 3.1;
    for (let i = 0; i < steps; i++) {
      const a = (i + 0.5) / steps * (Math.PI / 2);
      kit.add(crookSeg, xf(-Math.sin(a) * rad, 13.05 + rad - Math.cos(a) * rad, 0, 0, 0, a));
    }
    const scroll = kit.part(new THREE.TorusGeometry(0.42, 0.1, 6, 14, Math.PI * 1.7), ironGreen, 0.035);
    kit.add(scroll, xf(-0.6, 13.5, 0, Math.PI / 2, 0, 0));
    const arm = kit.part(cyl(0.1, 0.1, 0.5, 8), ironGreen, 0.03);
    kit.add(arm, xf(-rad, 15.95, 0));
    const lamp = kit.part(lathe([[0, 0], [0.34, 0.14], [0.52, 0.5], [0.5, 1.0], [0.3, 1.28], [0, 1.32]], 14),
      new THREE.MeshLambertMaterial({ color: 0xd8cfae, emissive: 0x3a3220 }), 0.04);
    kit.add(lamp, xf(-rad, 14.35, 0));
    const collar = kit.part(cyl(0.2, 0.28, 0.3, 10), ironGreen, 0.03);
    kit.add(collar, xf(-rad, 15.68, 0));
    // enamel street-name plate
    const plateTex = enamelSignTexture(['E. 95 ST'], 0x22301f, 0xe6e2d4, 256, 96);
    const plate = kit.part(box(2.5, 0.62, 0.09), new THREE.MeshLambertMaterial({ map: plateTex }), 0);
    kit.add(plate, xf(0.0, 10.6, 0.28));

    const LAMPS = [
      [-GROUND.curbX - 1.1, 50, Math.PI * 0.5],     // THIRD BASE
      [GROUND.curbX + 1.1, 8, -Math.PI * 0.5],
      [GROUND.curbX + 1.1, 116, -Math.PI * 0.5],
      [-GROUND.curbX - 1.1, 132, Math.PI * 0.5],
    ];
    for (const [x, z, ry] of LAMPS) {
      kit.place(xf(x, GROUND.walkTop, z, 0, ry, 0));
      shadows.add(x + (x > 0 ? -0.4 : 0.4), z, 1.5, 1.1, 4, 1, GROUND.walkTop);
      addCollider(app, {
        name: 'lamppost', kind: 'post', sound: 'iron_ring', restitution: 0.55,
        box: new THREE.Box3(new THREE.Vector3(x - 0.5, 0, z - 0.5), new THREE.Vector3(x + 0.5, 13, z + 0.5)),
      });
    }
    kit.build();
    // third base gets its chalk X on the asphalt, drawn by surface.js
    app.world = app.world || {};
    app.world.thirdBase = new THREE.Vector3(-GROUND.curbX - 1.1, 0, 50);
  }

  /* ------------------------------------------------------------------ *
   * Johnny pumps — two, deliberately different paint, chipped to rust
   * ------------------------------------------------------------------ */
  const hydrantAt = (x, z, ry, colour) => {
    const grp = new THREE.Group();
    grp.position.set(x, GROUND.walkTop, z);
    grp.rotation.y = ry;
    const body = mat(colour);
    put(grp, box(1.55, 0.28, 1.55), stone, 0, 0.05, 0);                       // stone pad
    outline(put(grp, lathe([[0, 0], [0.62, 0], [0.62, 0.22], [0.42, 0.34], [0.42, 0.5]], 14), body, 0, 0.16, 0), 0.04);
    outline(put(grp, cyl(0.36, 0.42, 1.55, 12), body, 0, 1.42, 0), 0.04);      // barrel
    for (let i = 0; i < 8; i++) {                                              // flutes
      const a = i / 8 * Math.PI * 2;
      put(grp, cyl(0.05, 0.05, 1.5, 5), body, Math.cos(a) * 0.38, 1.42, Math.sin(a) * 0.38);
    }
    outline(put(grp, cyl(0.44, 0.36, 0.2, 12), body, 0, 2.26, 0), 0.035);
    outline(put(grp, lathe([[0, 0.44], [0.2, 0.42], [0.36, 0.28], [0.4, 0]], 14), body, 0, 2.34, 0), 0.04);
    put(grp, cyl(0.14, 0.16, 0.16, 5), mat(mixHex(colour, INK, 0.4)), 0, 2.82, 0);  // pentagon nut
    for (const s of [1, -1]) {                                                 // side outlets + chained caps
      outline(put(grp, cyl(0.19, 0.21, 0.42, 10), body, s * 0.5, 1.85, 0, [0, 0, Math.PI / 2]), 0.03);
      put(grp, cyl(0.2, 0.2, 0.09, 10), mat(mixHex(colour, 0x8a6a54, 0.55)), s * 0.72, 1.85, 0, [0, 0, Math.PI / 2]);
    }
    outline(put(grp, cyl(0.26, 0.28, 0.42, 10), body, 0, 1.62, 0.5, [Math.PI / 2, 0, 0]), 0.03);
    root.add(grp);
    shadows.add(x, z, 1.15, 0.9, 2.6, 1, GROUND.walkTop);
    addCollider(app, {
      name: 'hydrant', kind: 'post', sound: 'iron_ring', restitution: 0.5,
      box: new THREE.Box3(new THREE.Vector3(x - 0.8, 0, z - 0.8), new THREE.Vector3(x + 0.8, 3.1, z + 0.8)),
    });
    return grp;
  };
  hydrantAt(GROUND.curbX + 1.35, 30, -0.35, 0x7c3b2e);
  hydrantAt(-GROUND.curbX - 1.35, 104, 0.4, 0x9a9a96);

  /* ------------------------------------------------------------------ *
   * Gamewell fire alarm box, corner, ruby globe on top
   * ------------------------------------------------------------------ */
  {
    const x = GROUND.curbX + 1.5, z = 122;
    const grp = new THREE.Group();
    grp.position.set(x, GROUND.walkTop, z); grp.rotation.y = -Math.PI * 0.62;
    const red = mat(0x9c2f26);
    put(grp, lathe([[0, 0], [0.62, 0], [0.62, 0.2], [0.36, 0.34]], 12), mat(0x2b2724), 0, 0.05, 0);
    outline(put(grp, cyl(0.24, 0.32, 3.1, 10), red, 0, 1.6, 0), 0.04);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      put(grp, cyl(0.045, 0.045, 2.9, 4), red, Math.cos(a) * 0.28, 1.6, Math.sin(a) * 0.28);
    }
    const doorTex = (() => {
      const { c, g } = makeCanvas(256, 320);
      g.fillStyle = hex(0x9c2f26); g.fillRect(0, 0, 256, 320);
      g.globalAlpha = 0.25; g.fillStyle = '#000';
      g.fillRect(0, 0, 256, 22); g.fillRect(0, 298, 256, 22); g.globalAlpha = 1;
      const gold = '#d8b25a';
      slabText(g, 'FIRE ALARM', 128, 62, 32, { align: 'center', color: gold, weight: 0.21, condense: 0.8, jitter: 0.7, seed: 5 });
      const lines = ['FOR FIRE', 'BREAK THE GLASS', 'OPEN THE DOOR', 'PULL HOOK DOWN', 'ONCE AND LET GO'];
      lines.forEach((l, i) => slabText(g, l, 128, 108 + i * 30, 17,
        { align: 'center', color: '#e8e0cc', weight: 0.2, condense: 0.74, jitter: 0.5, seed: 9 + i }));
      slabText(g, 'BOX 428', 128, 296, 30, { align: 'center', color: gold, weight: 0.22, condense: 0.8, jitter: 0.6, seed: 21 });
      return canvasTexture(c);
    })();
    const bodyMats = [mat(0x8a2a22), mat(0x8a2a22), mat(0x8a2a22), mat(0x8a2a22),
      new THREE.MeshLambertMaterial({ map: doorTex }), mat(0x8a2a22)];
    const bx = new THREE.Mesh(box(1.2, 1.5, 0.7), bodyMats);
    bx.position.set(0, 3.9, 0); grp.add(bx); outline(bx, 0.045);
    put(grp, box(1.34, 0.16, 0.84), red, 0, 4.72, 0);
    put(grp, new THREE.SphereGeometry(0.28, 12, 9),
      new THREE.MeshLambertMaterial({ color: 0xa8202a, emissive: 0x4a0d10 }), 0, 5.02, 0);
    root.add(grp);
    shadows.add(x, z, 1.0, 0.9, 4, 1, GROUND.walkTop);
  }

  /* ------------------------------------------------------------------ *
   * Olive-drab pedestal mailbox
   * ------------------------------------------------------------------ */
  {
    const x = GROUND.curbX + 1.5, z = 74;
    const grp = new THREE.Group();
    grp.position.set(x, GROUND.walkTop, z); grp.rotation.y = -Math.PI * 0.46;
    const olive = mat(0x5a5b45);
    put(grp, lathe([[0, 0], [0.5, 0], [0.5, 0.16], [0.28, 0.26]], 12), mat(0x3d3e33), 0, 0.04, 0);
    put(grp, cyl(0.2, 0.26, 2.2, 10), olive, 0, 1.2, 0);
    const bodyTex = (() => {
      const { c, g } = makeCanvas(256, 192);
      g.fillStyle = hex(0x5a5b45); g.fillRect(0, 0, 256, 192);
      const r2 = new RNG(4);
      for (let i = 0; i < 200; i++) {                        // chalky chipped paint
        g.globalAlpha = r2.range(0.04, 0.16);
        g.fillStyle = r2.chance(0.6) ? '#6e6f55' : '#3f4034';
        g.fillRect(r2.range(0, 256), r2.range(0, 192), r2.range(3, 12), r2.range(2, 8));
      }
      g.globalAlpha = 1;
      slabText(g, 'U.S.MAIL', 128, 82, 34, { align: 'center', color: '#cdc9ae', weight: 0.22, condense: 0.8, jitter: 0.7, seed: 12 });
      slabText(g, 'LETTERS', 128, 126, 22, { align: 'center', color: '#cdc9ae', weight: 0.2, condense: 0.8, jitter: 0.7, seed: 15 });
      return canvasTexture(c);
    })();
    const bodyMat = new THREE.MeshLambertMaterial({ map: bodyTex });
    const b = put(grp, box(1.5, 1.5, 1.25), [olive, olive, olive, olive, bodyMat, olive], 0, 3.05, 0);
    outline(b, 0.045);
    put(grp, cyl(0.75, 0.75, 1.25, 14, 1, false, 0, Math.PI), olive, 0, 3.8, 0, [Math.PI / 2, 0, 0]);
    put(grp, box(1.1, 0.5, 0.14), mat(0x44452f), 0, 3.35, 0.66, [0.3, 0, 0]);
    root.add(grp);
    shadows.add(x, z, 1.05, 0.95, 3.6, 1, GROUND.walkTop);
  }

  /* ------------------------------------------------------------------ *
   * Ash cans — galvanised, dented, half full of clinker.  One lid is off
   * and leaning, because that is the one the second baseman fields with.
   * ------------------------------------------------------------------ */
  {
    const kit = new Kit(root);
    const canTex = ironTexture(0x8e8d86, 17);
    const canMat = new THREE.MeshLambertMaterial({ map: canTex, color: 0xffffff });
    const bodyGeo = cyl(0.86, 0.74, 2.16, 14);
    const body = kit.part(bodyGeo, canMat, 0.05);
    kit.add(body, xf(0, 1.08, 0));
    const ribs = kit.part(new THREE.TorusGeometry(0.84, 0.055, 5, 16), galvDark, 0);
    kit.add(ribs, xf(0, 0.7, 0, Math.PI / 2, 0, 0));
    kit.add(ribs, xf(0, 1.5, 0, Math.PI / 2, 0, 0));
    const handle = kit.part(new THREE.TorusGeometry(0.22, 0.05, 5, 10, Math.PI), galvDark, 0);
    kit.add(handle, xf(0.88, 1.55, 0, 0, Math.PI / 2, 0));
    kit.add(handle, xf(-0.88, 1.55, 0, 0, -Math.PI / 2, 0));
    const lid = kit.part(lathe([[0, 0.3], [0.4, 0.26], [0.74, 0.12], [0.9, 0], [0.9, -0.1]], 14), canMat, 0.05);
    kit.add(lid, xf(0, 2.16, 0));
    const CANS = [
      [GROUND.curbX + 1.0, 20, 0.3], [GROUND.curbX + 1.05, 22.1, -0.5], [GROUND.curbX + 2.4, 21.2, 0.9],
      [-GROUND.curbX - 1.0, 66, 0.2], [-GROUND.curbX - 1.1, 68.2, 1.1],
      [GROUND.curbX + 1.05, 92, -0.2], [GROUND.curbX + 2.5, 92.9, 0.6], [GROUND.curbX + 1.1, 94.3, 0.8],
      [-GROUND.curbX - 1.15, 20.5, -0.6],
    ];
    for (const [x, z, ry] of CANS) {
      kit.place(xf(x, GROUND.walkTop, z, 0, ry, 0));
      shadows.add(x, z, 1.15, 1.0, 2.2, 1, GROUND.walkTop);
    }
    kit.build();
    // the loose lid, leaning against the first can — signature moment #7
    const lidGeo = lathe([[0, 0.3], [0.4, 0.26], [0.74, 0.12], [0.9, 0], [0.9, -0.1]], 16);
    const loose = put(root, lidGeo, canMat, GROUND.curbX + 0.3, GROUND.walkTop + 0.85, 19.0, [1.15, 0.4, 0]);
    outline(loose, 0.05);
    shadows.add(GROUND.curbX + 0.35, 19.0, 0.95, 0.75, 0.9, 0.9, GROUND.walkTop);
    for (const [x, z] of [[GROUND.curbX + 1.5, 21], [-GROUND.curbX - 1.5, 67], [GROUND.curbX + 1.6, 93]]) {
      addCollider(app, {
        name: 'ash cans', kind: 'cans', sound: 'ashcan_lid', restitution: 0.35,
        box: new THREE.Box3(new THREE.Vector3(x - 2.0, 0, z - 2.0), new THREE.Vector3(x + 2.0, 2.6, z + 2.0)),
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Wooden crates, stacked and stencilled
   * ------------------------------------------------------------------ */
  {
    const crateTex = (label, sub) => {
      const { c, g } = makeCanvas(192, 160);
      g.fillStyle = hex(0xa9895e); g.fillRect(0, 0, 192, 160);
      const r2 = new RNG(label.length * 13 + 5);
      for (let i = 0; i < 5; i++) {                                    // slat gaps
        g.globalAlpha = 0.5; g.fillStyle = hex(0x6d5537);
        g.fillRect(0, 8 + i * 30, 192, 3);
      }
      for (let i = 0; i < 120; i++) {                                  // grain
        g.globalAlpha = r2.range(0.04, 0.13); g.fillStyle = r2.chance(0.5) ? '#6d5537' : '#c8a877';
        g.fillRect(r2.range(0, 192), r2.range(0, 160), r2.range(8, 50), 2);
      }
      g.globalAlpha = 1;
      slabText(g, label, 96, 78, 26, { align: 'center', color: '#4a3a26', weight: 0.2, condense: 0.75, jitter: 0.9, seed: 3 });
      slabText(g, sub, 96, 108, 16, { align: 'center', color: '#4a3a26', weight: 0.2, condense: 0.75, jitter: 0.9, seed: 8 });
      return canvasTexture(c);
    };
    const m1 = new THREE.MeshLambertMaterial({ map: crateTex('FLORIDA', 'ORANGES') });
    const m2 = new THREE.MeshLambertMaterial({ map: crateTex('DUGAN', 'BAKERS') });
    const m3 = new THREE.MeshLambertMaterial({ map: crateTex('SHEFFIELD', 'FARMS') });
    const geo = box(2.0, 1.35, 1.35);
    const CRATES = [
      [GROUND.walkOuter - 5.2, 24.0, 0.15, m1], [GROUND.walkOuter - 5.1, 24.2, -0.1, m2],
      [GROUND.walkOuter - 5.3, 25.6, 0.5, m3],
      [-GROUND.walkOuter + 4.6, 44.5, -0.3, m2], [-GROUND.walkOuter + 4.5, 44.6, 0.2, m1],
      [GROUND.walkOuter - 4.3, 62.5, 0.4, m3],
    ];
    let stackY = {};
    for (const [x, z, ry, m] of CRATES) {
      const key = Math.round(z);
      const y = GROUND.walkTop + 0.68 + (stackY[key] || 0);
      stackY[key] = (stackY[key] || 0) + 1.36;
      const c = put(root, geo, m, x, y, z, [0, ry, 0]);
      outline(c, 0.045);
      if (!stackY[key + 1]) shadows.add(x, z, 1.5, 1.15, 1.4, 1, GROUND.walkTop);
    }
  }

  /* ------------------------------------------------------------------ *
   * Newsstand — plywood and canvas, papers three deep under pipe weights
   * ------------------------------------------------------------------ */
  {
    const x = GROUND.walkOuter - 3.4, z = 60;
    const grp = new THREE.Group();
    grp.position.set(x, GROUND.walkTop, z); grp.rotation.y = -Math.PI / 2;
    const ply = mat(0x9a7c52);
    const carcass = put(grp, box(6.2, 6.4, 3.6), ply, 0, 3.2, 0); outline(carcass, 0.05);
    put(grp, box(6.6, 0.4, 4.2), mat(0x6f5a3c), 0, 6.5, 0);
    // striped canvas awning
    const stripeTex = (() => {
      const { c, g } = makeCanvas(256, 128);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#c9b78e' : '#7c4f3a';
        g.fillRect(i * 32, 0, 32, 128);
      }
      g.globalAlpha = 0.18; g.fillStyle = '#000'; g.fillRect(0, 96, 256, 32); g.globalAlpha = 1;
      return canvasTexture(c);
    })();
    const aw = put(grp, box(7.0, 0.16, 3.0), new THREE.MeshLambertMaterial({ map: stripeTex, side: THREE.DoubleSide }),
      0, 6.9, 2.3, [-0.30, 0, 0]);
    outline(aw, 0.04);
    // the paper rack
    const paperTex = (() => {
      const { c, g } = makeCanvas(512, 384);
      const heads = [['THE DAILY NEWS', 'NEW YORK·S PICTURE NEWSPAPER'],
        ['THE EVENING WORLD', 'FINAL'], ['THE SUN', 'TWO CENTS'],
        ['IL PROGRESSO', 'ITALO-AMERICANO'], ['THE EVENING GRAPHIC', 'LATE CITY'],
        ['FORWARD', 'NEW YORK']];
      const r2 = new RNG(66);
      for (let i = 0; i < 6; i++) {
        const cx = (i % 3) * 170 + 3, cy = Math.floor(i / 3) * 190 + 3;
        g.fillStyle = ['#ded4bb', '#d6cdb2', '#e2dac2'][i % 3];
        g.fillRect(cx, cy, 164, 184);
        g.globalAlpha = 0.35; g.fillStyle = '#6a5c46'; g.fillRect(cx, cy + 176, 164, 8); g.globalAlpha = 1;
        slabText(g, heads[i][0], cx + 82, cy + 30, 17,
          { align: 'center', color: '#2a2420', weight: 0.24, condense: 0.62, jitter: 0.4, seed: 40 + i });
        slabText(g, heads[i][1], cx + 82, cy + 46, 9,
          { align: 'center', color: '#4a4038', weight: 0.22, condense: 0.7, jitter: 0.4, seed: 60 + i });
        // a smudged picture front page and grey type
        g.fillStyle = '#8d8271'; g.fillRect(cx + 18, cy + 56, 128, 62);
        g.fillStyle = '#6d6353';
        for (let k = 0; k < 5; k++) g.fillRect(cx + 24 + r2.range(0, 40), cy + 62 + k * 11, r2.range(30, 90), 6);
        g.fillStyle = '#514a3f';
        for (let k = 0; k < 8; k++) g.fillRect(cx + 16, cy + 126 + k * 6, r2.range(60, 132), 2.5);
      }
      return canvasTexture(c);
    })();
    for (let row = 0; row < 3; row++) {
      const p = put(grp, box(5.6, 1.9, 0.12), new THREE.MeshLambertMaterial({ map: paperTex }),
        0, 2.2 + row * 1.55, 1.95 + row * 0.34, [-0.5, 0, 0]);
      p.material.map.repeat.set(1, 0.33); p.material.map.offset.set(0, row * 0.33);
      put(grp, cyl(0.07, 0.07, 5.7, 6), galvDark, 0, 2.2 + row * 1.55 - 0.5, 2.2 + row * 0.34, [0, 0, Math.PI / 2]);
    }
    put(grp, box(6.4, 0.9, 0.3), mat(0x6f5a3c), 0, 1.15, 1.75);
    // sign band
    const bandTex = enamelSignTexture(['NEWS · CIGARS · CANDY'], 0x2f2a22, 0xd8b25a, 512, 96);
    put(grp, box(6.3, 1.0, 0.12), new THREE.MeshLambertMaterial({ map: bandTex }), 0, 5.9, 1.86);
    root.add(grp);
    shadows.add(x, z, 3.4, 2.6, 6, 1, GROUND.walkTop);
  }

  /* ------------------------------------------------------------------ *
   * Pushcart — 6 x 3 ft, big iron-tyred wheels, parasol, produce
   * ------------------------------------------------------------------ */
  {
    const x = GROUND.curbX + 3.3, z = 44;
    const grp = new THREE.Group();
    grp.position.set(x, GROUND.walkTop, z); grp.rotation.y = -Math.PI * 0.56;
    const bedY = 2.5;
    const bed = put(grp, box(6.0, 0.9, 3.0), woodWarm, 0, bedY, 0); outline(bed, 0.05);
    put(grp, box(6.1, 0.55, 0.16), mat(0x6d5537), 0, bedY + 0.6, 1.5);
    put(grp, box(6.1, 0.55, 0.16), mat(0x6d5537), 0, bedY + 0.6, -1.5);
    for (const s of [1, -1]) {
      const w = put(grp, cyl(1.5, 1.5, 0.18, 16), mat(0x5e4a33), s * 1.65, 1.5, 0, [0, 0, Math.PI / 2]);
      outline(w, 0.045);
      put(grp, new THREE.TorusGeometry(1.5, 0.09, 5, 18), mat(0x4a423a), s * 1.72, 1.5, 0, [0, Math.PI / 2, 0]);
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        put(grp, box(0.1, 1.4, 0.1), woodPale, s * 1.65, 1.5 + Math.sin(a) * 0.7, Math.cos(a) * 0.7, [a + Math.PI / 2, 0, 0]);
      }
    }
    put(grp, cyl(0.11, 0.11, 3.2, 6), woodPale, -3.4, 2.2, 0.9, [0, 0, Math.PI / 2 - 0.16]);
    put(grp, cyl(0.11, 0.11, 3.2, 6), woodPale, -3.4, 2.2, -0.9, [0, 0, Math.PI / 2 - 0.16]);
    put(grp, cyl(0.09, 0.09, 2.3, 6), woodPale, 2.6, 1.15, 0, [0.25, 0, 0]);
    // produce, instanced
    const kit = new Kit(grp);
    const apples = kit.part(new THREE.SphereGeometry(0.24, 8, 6), mat(0xc8402f), 0);
    const greens = kit.part(new THREE.SphereGeometry(0.28, 8, 6), mat(0x8fa23c), 0);
    const golds = kit.part(new THREE.SphereGeometry(0.22, 8, 6), mat(0xe3a32b), 0);
    const rr = new RNG(313);
    for (let i = 0; i < 26; i++) {
      const px = rr.range(-2.6, 2.6), pz = rr.range(-1.15, 1.15), py = bedY + 0.6 + rr.range(0, 0.45);
      kit.add([apples, greens, golds][i % 3], xf(px, py, pz));
    }
    kit.place(xf(0, 0, 0));
    kit.build();
    // parasol
    put(grp, cyl(0.07, 0.07, 4.4, 6), woodPale, -1.6, 5.0, 0);
    const par = put(grp, cyl(0.06, 3.3, 0.9, 10, 1, true),
      new THREE.MeshLambertMaterial({ color: 0xd4694a, side: THREE.DoubleSide }), -1.6, 6.7, 0);
    outline(par, 0.04);
    // hanging scales
    put(grp, cyl(0.05, 0.05, 1.2, 5), galvDark, 1.9, 5.4, 0.4);
    put(grp, cyl(0.35, 0.35, 0.16, 12), galv, 1.9, 4.75, 0.4);
    root.add(grp);
    shadows.add(x, z, 3.2, 2.4, 4, 1, GROUND.walkTop);
    addCollider(app, {
      name: 'pushcart', kind: 'cart', sound: 'wood_knock', restitution: 0.4,
      box: new THREE.Box3(new THREE.Vector3(x - 3, 0, z - 3), new THREE.Vector3(x + 3, 3.6, z + 3)),
    });
  }

  /* ------------------------------------------------------------------ *
   * Areaway railing, with the stickball bat and two broom handles on it,
   * plus the milk bottles somebody left out on the step.
   * ------------------------------------------------------------------ */
  {
    const x = -GROUND.walkOuter + 2.2, z = 12;
    const grp = new THREE.Group();
    grp.position.set(x, GROUND.walkTop, z);
    const kit = new Kit(grp);
    const picket = kit.part(cyl(0.055, 0.055, 2.7, 5), ironDark, 0.03);
    for (let i = 0; i < 11; i++) kit.add(picket, xf(0, 1.35, -4.4 + i * 0.88));
    kit.place(xf(0, 0, 0));
    kit.build();
    put(grp, box(0.16, 0.16, 9.4), ironDark, 0, 2.7, 0);
    put(grp, box(0.12, 0.12, 9.4), ironDark, 0, 1.5, 0);
    for (const zz of [-4.6, 4.6]) put(grp, box(0.24, 3.0, 0.24), ironDark, 0, 1.5, zz);
    // the stick: a sawn-off broom handle, taped at the grip
    const stick = put(grp, cyl(0.09, 0.11, 3.4, 8), mat(0xc8a877), 0.42, 1.85, 1.2, [0.42, 0.1, 0]);
    outline(stick, 0.035);
    put(grp, cyl(0.115, 0.115, 0.7, 8), mat(0x4a3f36), 0.55, 0.85, 0.9, [0.42, 0.1, 0]);
    // two spare broom handles, one still with the broom on it
    put(grp, cyl(0.07, 0.08, 4.2, 6), mat(0xb59468), 0.5, 2.15, -1.6, [-0.34, 0, 0]);
    const br = put(grp, cyl(0.07, 0.08, 4.4, 6), mat(0xa88a60), 0.62, 2.2, -2.6, [-0.32, 0.14, 0]);
    put(grp, box(0.5, 0.9, 0.28), mat(0xbf9450), 0.62 + 0.1, 0.62, -3.3);
    void br;
    // milk bottles in a wire crate on the step
    const step = put(grp, box(2.4, 0.5, 3.6), mat(PAVEMENT.sidewalk), 1.3, 0.25, -6.6);
    void step;
    const kit2 = new Kit(grp);
    const glassMat = new THREE.MeshLambertMaterial({ color: 0xd9e2dc, transparent: true, opacity: 0.85 });
    const bottle = kit2.part(lathe([[0, 0], [0.2, 0], [0.2, 0.62], [0.11, 0.78], [0.11, 1.0], [0.13, 1.02], [0, 1.02]], 10), glassMat, 0.02);
    const cap = kit2.part(cyl(0.13, 0.13, 0.05, 8), flat(0xe8e2cc), 0);
    const rr = new RNG(77);
    for (let i = 0; i < 6; i++) {
      const bx = 0.75 + (i % 3) * 0.5, bz = -7.2 + Math.floor(i / 3) * 0.5;
      kit2.add(bottle, xf(bx, 0.5, bz, 0, rr.range(0, 3), 0));
      kit2.add(cap, xf(bx, 1.53, bz));
    }
    kit2.place(xf(0, 0, 0));
    kit2.build();
    const crate = put(grp, box(1.9, 0.7, 1.4), mat(0x6d5537), 1.3, 0.85, -6.95);
    crate.material = new THREE.MeshLambertMaterial({ color: 0x6d5537, transparent: true, opacity: 0.55 });
    root.add(grp);
    shadows.add(x + 0.6, z, 0.8, 5.0, 2.4, 0.8, GROUND.walkTop);
    shadows.add(x + 1.3, z - 6.8, 1.6, 2.0, 1.0, 0.9, GROUND.walkTop);
  }

  /* ------------------------------------------------------------------ *
   * Delivery bicycle leaning on the near lamp post
   * ------------------------------------------------------------------ */
  {
    const x = GROUND.curbX + 2.6, z = 9.4;
    const grp = new THREE.Group();
    grp.position.set(x, GROUND.walkTop, z);
    grp.rotation.set(0, -Math.PI * 0.42, 0.20);
    const frame = mat(0x35302b);
    for (const [dz, r] of [[1.0, 1.05], [-1.0, 1.05]]) {
      const w = put(grp, new THREE.TorusGeometry(r, 0.055, 5, 20), frame, 0, r, dz, [0, Math.PI / 2, 0]);
      outline(w, 0.03);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI;
        put(grp, cyl(0.018, 0.018, r * 2, 4), mat(0x8a8378), 0, r, dz, [a, Math.PI / 2, 0]);
      }
    }
    put(grp, cyl(0.07, 0.07, 2.2, 6), frame, 0, 1.5, 0, [Math.PI / 2 - 0.35, 0, 0]);
    put(grp, cyl(0.07, 0.07, 1.5, 6), frame, 0, 1.15, 0.55, [Math.PI / 2 + 0.6, 0, 0]);
    put(grp, cyl(0.07, 0.07, 1.6, 6), frame, 0, 1.5, -0.75, [0.42, 0, 0]);
    put(grp, box(0.5, 0.16, 0.9), mat(0x3a2f28), 0, 2.15, -0.55);
    put(grp, cyl(0.05, 0.05, 1.5, 6), frame, 0, 2.25, 1.05, [0, 0, Math.PI / 2]);
    const basket = put(grp, cyl(0.62, 0.5, 0.85, 10, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x9d7a45, side: THREE.DoubleSide }), 0, 1.85, 1.15);
    outline(basket, 0.03);
    put(grp, box(0.05, 0.5, 0.8), new THREE.MeshLambertMaterial({ map: enamelSignTexture(['GRISTEDE'], 0x2f4030, 0xd8cfae, 200, 90) }),
      0.06, 1.28, 0.15);
    root.add(grp);
    shadows.add(x, z, 0.7, 2.0, 1.6, 0.85, GROUND.walkTop);
  }

  /* ------------------------------------------------------------------ *
   * Barber pole on the right-hand storefront, slowly turning
   * ------------------------------------------------------------------ */
  {
    const x = GROUND.facadeX - 0.5, z = 88;
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    put(grp, box(0.16, 0.16, 1.5), ironDark, 0.2, 8.4, 0.55);
    put(grp, box(0.16, 1.7, 0.16), ironDark, 0.2, 7.7, 1.2);
    const poleTex = (() => {
      const { c, g } = makeCanvas(128, 128);
      g.fillStyle = '#e6e0cc'; g.fillRect(0, 0, 128, 128);
      g.lineWidth = 20; g.lineCap = 'butt';
      for (let i = -3; i < 6; i++) {
        g.strokeStyle = '#b8332c'; g.beginPath(); g.moveTo(i * 44 - 20, -10); g.lineTo(i * 44 + 60, 138); g.stroke();
        g.strokeStyle = '#2f4d84'; g.beginPath(); g.moveTo(i * 44 + 2, -10); g.lineTo(i * 44 + 82, 138); g.stroke();
      }
      return canvasTexture(c, { repeat: [1, 1] });
    })();
    const pole = put(grp, cyl(0.32, 0.32, 3.0, 12), new THREE.MeshLambertMaterial({ map: poleTex }), 0.2, 7.4, 1.2);
    outline(pole, 0.035);
    put(grp, lathe([[0, 0.34], [0.24, 0.28], [0.36, 0], [0.3, -0.12]], 12), mat(0xb8a271), 0.2, 8.9, 1.2);
    put(grp, lathe([[0, -0.34], [0.24, -0.28], [0.36, 0], [0.3, 0.12]], 12), mat(0xb8a271), 0.2, 5.9, 1.2);
    root.add(grp);
    anim.barber = pole;
  }

  /* ------------------------------------------------------------------ *
   * Laundry — a pulley line off a second-floor jamb to a line pole on the
   * sidewalk.  Along the facade, never across the roadway (the cat's
   * cradle over the game is a Hollywood invention and it is banned).
   * ------------------------------------------------------------------ */
  {
    const clothTex = (a, b) => {
      const { c, g } = makeCanvas(96, 128);
      g.fillStyle = hex(a); g.fillRect(0, 0, 96, 128);
      const r2 = new RNG(a & 255);
      for (let i = 0; i < 40; i++) {
        g.globalAlpha = r2.range(0.05, 0.14); g.fillStyle = hex(b);
        g.fillRect(0, r2.range(0, 128), 96, r2.range(2, 9));
      }
      g.globalAlpha = 1;
      return canvasTexture(c);
    };
    const cloths = [
      clothTex(CLOTH[3], 0xc8bda0), clothTex(CLOTH[0], 0xb9ab8c), clothTex(0xdfe4e0, 0xc2cac4),
      clothTex(CLOTH[1], 0xa89a7a), clothTex(0xe6e2d2, 0xc9c2ac),
    ];
    const rope = mat(0x8a7a5e);
    const makeLine = (side, z0, z1, y0, y1) => {
      const sx = side * (GROUND.facadeX - 0.35);
      const px = side * (GROUND.walkOuter - 8.5);
      const grp = new THREE.Group(); root.add(grp);
      const a = new THREE.Vector3(sx, y0, z0), b = new THREE.Vector3(px, y1, z1);
      // the pole
      put(grp, cyl(0.16, 0.24, y1, 7), mat(0x7b6544), px, y1 / 2, z1);
      put(grp, cyl(0.09, 0.09, 1.5, 6), mat(0x7b6544), px, y1 - 0.4, z1, [Math.PI / 2, 0, 0]);
      // the rope, sagging
      const seg = 10;
      const rr = new RNG(side * 5 + 91);
      for (let i = 0; i < seg; i++) {
        const t0 = i / seg, t1 = (i + 1) / seg;
        const p0 = a.clone().lerp(b, t0), p1 = a.clone().lerp(b, t1);
        p0.y -= Math.sin(Math.PI * t0) * 1.1; p1.y -= Math.sin(Math.PI * t1) * 1.1;
        const mid = p0.clone().add(p1).multiplyScalar(0.5);
        const len = p0.distanceTo(p1);
        const m = put(grp, cyl(0.035, 0.035, len, 4), rope, mid.x, mid.y, mid.z);
        m.lookAt(p1); m.rotateX(Math.PI / 2);
      }
      for (let i = 0; i < 5; i++) {
        const t = 0.16 + i * 0.17;
        const p = a.clone().lerp(b, t); p.y -= Math.sin(Math.PI * t) * 1.1;
        const w = 1.5 + rr.range(-0.3, 0.5), h = 2.2 + rr.range(-0.5, 1.0);
        const g2 = new THREE.Group();
        g2.position.set(p.x, p.y - 0.07, p.z);
        const sheet = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 5, 3),
          new THREE.MeshLambertMaterial({ map: cloths[(i + (side > 0 ? 2 : 0)) % cloths.length], side: THREE.DoubleSide }));
        sheet.position.y = -h / 2;
        sheet.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        g2.add(sheet);
        grp.add(g2);
        anim.laundry.push({ mesh: sheet, base: sheet.geometry.attributes.position.array.slice(), phase: rr.range(0, 6.2), amp: rr.range(0.06, 0.16) });
        // a peg
        put(g2, box(0.12, 0.3, 0.1), mat(0xc8a877), 0, 0.06, 0);
      }
    };
    makeLine(-1, 18, 30, 17.5, 15.5);
    makeLine(1, 100, 110, 18.5, 16.0);
  }

  /* ------------------------------------------------------------------ *
   * Window boxes — geraniums in coffee cans and a painted trough
   * ------------------------------------------------------------------ */
  {
    const kit = new Kit(root);
    const trough = kit.part(box(3.0, 0.75, 0.9), mat(0x4c6a48), 0.04);
    kit.add(trough, xf(0, 0, 0));
    const soil = kit.part(box(2.7, 0.16, 0.7), mat(0x4a3a2c), 0);
    kit.add(soil, xf(0, 0.42, 0));
    const bloom = kit.part(new THREE.SphereGeometry(0.28, 7, 5), mat(ACCENTS.red), 0);
    const leaf = kit.part(new THREE.SphereGeometry(0.3, 7, 5), mat(0x5f7a3a), 0);
    for (let i = 0; i < 4; i++) {
      kit.add(leaf, xf(-1.0 + i * 0.68, 0.55, 0, 0, 0, 0, 1.3, 0.6, 1));
      kit.add(bloom, xf(-1.0 + i * 0.68, 0.86, 0.05));
    }
    const BOXES = [
      [-GROUND.facadeX + 0.42, 13.6, 26, Math.PI / 2], [-GROUND.facadeX + 0.42, 13.6, 54, Math.PI / 2],
      [GROUND.facadeX - 0.42, 13.6, 40, -Math.PI / 2], [GROUND.facadeX - 0.42, 13.6, 96, -Math.PI / 2],
      [-GROUND.facadeX + 0.42, 24.2, 70, Math.PI / 2],
    ];
    for (const [x, y, z, ry] of BOXES) kit.place(xf(x, y, z, 0, ry, 0));
    kit.build();
  }

  /* ------------------------------------------------------------------ *
   * The chalked strike box on the flattest wall on the block, with the
   * strikeout tallies somebody kept beside it.
   * ------------------------------------------------------------------ */
  {
    const { c, g } = makeCanvas(512, 512);          // 8 ft x 8 ft of wall
    const PX = 512 / 8;
    g.clearRect(0, 0, 512, 512);
    const box20 = 20 / 12 * PX, box30 = 30 / 12 * PX;
    const bx = 256 - box20 / 2, by = 512 - (18 / 12 * PX) - box30;
    chalkStroke(g, [[bx, by], [bx + box20, by], [bx + box20, by + box30], [bx, by + box30], [bx, by]], 5.0, 21, 0.95);
    chalkStroke(g, [[bx + 6, by + 6], [bx + box20 - 6, by + 6], [bx + box20 - 6, by + box30 - 6], [bx + 6, by + box30 - 6], [bx + 6, by + 6]], 2.4, 33, 0.5);
    // a bullseye somebody added
    for (let i = 0; i < 14; i++) {
      const a0 = i / 14 * Math.PI * 2, a1 = (i + 0.8) / 14 * Math.PI * 2;
      chalkStroke(g, [[256 + Math.cos(a0) * 22, by + box30 / 2 + Math.sin(a0) * 22],
        [256 + Math.cos(a1) * 22, by + box30 / 2 + Math.sin(a1) * 22]], 3.0, 40 + i, 0.7);
    }
    chalkText(g, 'STRIKE', 256, by - 16, 26, { align: 'center', condense: 0.8, seed: 55, weight: 0.15 });
    // tally marks
    let tx = bx + box20 + 26;
    for (let i = 0; i < 12; i++) {
      const gx = tx + Math.floor(i / 5) * 34 + (i % 5) * 6;
      if (i % 5 === 4) chalkStroke(g, [[gx - 22, by + 40], [gx + 6, by + 8]], 3.4, 70 + i, 0.85);
      else chalkStroke(g, [[gx, by + 6], [gx - 2, by + 42]], 3.4, 70 + i, 0.85);
    }
    const tex = canvasTexture(c);
    const m = new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), m);
    p.position.set(-GROUND.facadeX + 0.06, 4.0, 4);
    p.rotation.y = Math.PI / 2;
    p.renderOrder = 3;
    root.add(p);
  }

  /* ------------------------------------------------------------------ *
   * Two Spaldeens: one in the gutter, one nobody has noticed by the curb
   * ------------------------------------------------------------------ */
  {
    const geo = new THREE.SphereGeometry(0.19, 10, 8);
    for (const [x, z, worn] of [[19.4, 12, false], [-20.6, 44, true]]) {
      const m = put(root, geo, mat(worn ? BALL.sewer : BALL.new), x, roadHeight(x) + 0.19, z);
      outline(m, 0.028);
      shadows.add(x, z, 0.28, 0.24, 0.2, 0.8);
    }
  }

  /* ------------------------------------------------------------------ *
   * The block's dog.  Nobody knows whose he is.
   * ------------------------------------------------------------------ */
  {
    const x = 15.5, z = 22;
    const grp = new THREE.Group();
    grp.position.set(x, roadHeight(x), z);
    grp.rotation.y = -1.05;
    const fur = mat(0xb08a5c), furDark = mat(0x8a6a44), cream = mat(0xdccdae);
    const body = put(grp, new THREE.SphereGeometry(0.62, 12, 9), fur, 0, 1.35, 0);
    body.scale.set(1.55, 1.0, 1.0); outline(body, 0.04);
    const head = put(grp, new THREE.SphereGeometry(0.5, 12, 9), fur, 1.15, 1.85, 0);
    head.scale.set(1.05, 1.0, 0.95); outline(head, 0.04);
    const snout = put(grp, new THREE.SphereGeometry(0.26, 10, 8), cream, 1.62, 1.68, 0);
    snout.scale.set(1.5, 0.8, 0.9); outline(snout, 0.03);
    put(grp, new THREE.SphereGeometry(0.12, 8, 6), flat(INK), 1.88, 1.74, 0);
    for (const s of [1, -1]) {
      put(grp, new THREE.SphereGeometry(0.085, 8, 6), flat(0x201a16), 1.42, 2.02, s * 0.24);
      put(grp, new THREE.SphereGeometry(0.045, 6, 5), flat(0xf2ead6), 1.46, 2.06, s * 0.26);
    }
    const earL = put(grp, new THREE.SphereGeometry(0.24, 8, 6), furDark, 1.02, 2.02, 0.42);
    earL.scale.set(0.5, 1.5, 0.9); earL.rotation.z = -0.35; outline(earL, 0.03);
    const earR = put(grp, new THREE.SphereGeometry(0.24, 8, 6), furDark, 1.02, 2.12, -0.42);
    earR.scale.set(0.5, 1.2, 0.9); earR.rotation.z = 0.5; outline(earR, 0.03);
    const patch = put(grp, new THREE.SphereGeometry(0.34, 9, 7), cream, -0.25, 1.42, 0.42);
    patch.scale.set(1.2, 0.7, 0.45);
    for (const [px, pz] of [[0.62, 0.34], [0.62, -0.34], [-0.68, 0.32], [-0.68, -0.32]]) {
      put(grp, cyl(0.14, 0.16, 0.95, 7), fur, px, 0.48, pz);
      put(grp, new THREE.SphereGeometry(0.19, 7, 5), fur, px + 0.05, 0.14, pz);
    }
    const tail = new THREE.Group(); tail.position.set(-0.9, 1.55, 0); grp.add(tail);
    const tm = put(tail, cyl(0.09, 0.14, 0.9, 6), fur, -0.25, 0.28, 0, [0, 0, 0.9]);
    outline(tm, 0.03);
    root.add(grp);
    shadows.add(x, z, 1.3, 0.75, 1.6, 1);
    anim.dog = { grp, tail, head };
  }

  /* ------------------------------------------------------------------ *
   * Coal-chute lids and the cellar doors, flush in the bluestone
   * ------------------------------------------------------------------ */
  {
    const kit = new Kit(root);
    const chuteTex = (() => {
      const { c, g } = makeCanvas(128, 128);
      g.fillStyle = hex(0x6a6158); g.beginPath(); g.arc(64, 64, 62, 0, 7); g.fill();
      g.strokeStyle = hex(0x3f382f); g.lineWidth = 4;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(64, 64, 10 + i * 9, 0, 7); g.stroke(); }
      g.strokeStyle = hex(0x9a9188); g.lineWidth = 2;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(64, 63, 10 + i * 9, 3.4, 5.9); g.stroke(); }
      slabText(g, 'COAL', 64, 72, 15, { align: 'center', color: hex(0x9a9188), weight: 0.22, condense: 0.8, seed: 2 });
      return canvasTexture(c);
    })();
    const disc = new THREE.CircleGeometry(0.85, 20); disc.rotateX(-Math.PI / 2);
    const lid = kit.part(disc, new THREE.MeshLambertMaterial({ map: chuteTex }), 0);
    kit.add(lid, xf(0, 0, 0));
    for (const [x, z] of [[GROUND.walkOuter - 2.4, 36], [-GROUND.walkOuter + 2.4, 70], [GROUND.walkOuter - 2.6, 100]]) {
      kit.place(xf(x, GROUND.walkTop + 0.012, z));
    }
    kit.build();

    for (const [side, z] of [[1, 100], [-1, 18]]) {
      const x = side * (GROUND.walkOuter - 3.0);
      const grp = new THREE.Group(); root.add(grp);
      grp.position.set(x, GROUND.walkTop, z);
      grp.rotation.y = side > 0 ? 0 : Math.PI;
      const doorMat = mat(0x53544a);
      put(grp, box(4.6, 0.24, 5.2), mat(soot(PAVEMENT.sidewalk, 0.28)), 0, 0.02, 0);
      for (const s of [1, -1]) {
        const d = put(grp, box(2.15, 0.2, 4.9), doorMat, s * 1.1, 0.32, 0, [0, 0, -s * 0.20]);
        outline(d, 0.035);
        for (let i = 0; i < 4; i++) put(grp, box(0.14, 0.1, 4.7), mat(0x3d3e35), s * (0.35 + i * 0.5), 0.44 - i * 0.02, 0, [0, 0, -s * 0.20]);
      }
      put(grp, cyl(0.09, 0.09, 0.5, 6), mat(0x2f302a), 0, 0.62, 1.4, [0, 0, Math.PI / 2]);
      shadows.add(x, z, 2.6, 2.8, 0.5, 0.7, GROUND.walkTop);
      addCollider(app, {
        name: 'cellar door', kind: 'wood', sound: 'wood_boom', restitution: 0.32,
        box: new THREE.Box3(new THREE.Vector3(x - 2.4, 0, z - 2.7), new THREE.Vector3(x + 2.4, GROUND.walkTop + 0.7, z + 2.7)),
      });
    }
  }

  shadows.finish();
  return { root, anim, shadows };
}

/* =========================================================================== */

export default registerSystem({
  name: 'props',
  order: 12,
  init(app) {
    const built = buildProps(app);
    this.root = built.root;
    this.anim = built.anim;
    this.t = 0;
  },
  update(dt) {
    this.t += dt;
    const a = this.anim;
    if (a.barber) a.barber.rotation.y -= dt * 1.6;
    for (const L of a.laundry) {
      const pos = L.mesh.geometry.attributes.position;
      const base = L.base;
      for (let i = 0; i < pos.count; i++) {
        const bx = base[i * 3], by = base[i * 3 + 1];
        const k = (by + 1.5);
        pos.array[i * 3 + 2] = Math.sin(this.t * 1.9 + L.phase + bx * 1.6 + by * 0.6) * L.amp * (0.4 + k * 0.5);
      }
      pos.needsUpdate = true;
    }
    if (a.dog) {
      a.dog.tail.rotation.z = Math.sin(this.t * 7.5) * 0.7;
      a.dog.tail.rotation.y = Math.sin(this.t * 7.5 + 1) * 0.4;
      a.dog.head.rotation.y = Math.sin(this.t * 0.9) * 0.35;
      a.dog.grp.position.y = roadHeight(a.dog.grp.position.x) + Math.abs(Math.sin(this.t * 3.4)) * 0.05;
    }
  },
});

/* --- the prop tour ------------------------------------------------------- */
registerScenario('props_tour', {
  seed: 2025,
  setup: ({ app }) => {
    app.sim.reset(2025);
    app.camera.fov = 40; app.camera.updateProjectionMatrix();
    app.camera.position.set(-19.5, 8.2, 6.5);
    app.camera.lookAt(16, 4.2, 52);
  },
  settle: 0.9,
});

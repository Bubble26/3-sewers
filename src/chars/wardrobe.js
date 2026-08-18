/**
 * wardrobe.js — the cloth, the caps, the boots, and the thirty kids who wear them.
 *
 * Owned by the character-art piece. Three things live here:
 *
 *   1. The shading kit. DESIGN-BIBLE §4.1 asks for a two-band toon ramp with a third bounce
 *      band, "per-material and hand-authored, never computed per pixel from a light vector".
 *      We bake exactly that into vertex colours at build time against a fixed authored key,
 *      so a kid's face uses the same three bands whichever way they are facing and whatever
 *      the lighting piece does this week. Outline colour is baked alongside it (§4.2: a
 *      darkened, saturated version of the fill it borders — never a uniform grey).
 *   2. The geometry kit — rounded boxes, lathed tubes, sphere sectors. Limbs are tubes,
 *      there is no muscle definition anywhere, and every garment gets exactly one
 *      exaggeration (§5.2), always volume or hem, never the body underneath.
 *   3. The nine silhouette families (§5.4) and the thirty kids built on them (§5.5).
 *
 * Every colour is imported from src/render/palette.js or derived from one with soot()/mix().
 * There is not a single free hex literal in this file, on purpose.
 */
import * as THREE from 'three';
import {
  INK, CHALK, SKIN, CLOTH, ACCENTS, TEAMS, AIR, PAVEMENT, FACADE, soot,
} from '../render/palette.js';

/* ============================================================================
   1. COLOUR
   ========================================================================= */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const rgbOf = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
export const hexOf = (r, g, b) => (Math.round(clamp(r, 0, 1) * 255) << 16)
  | (Math.round(clamp(g, 0, 1) * 255) << 8) | Math.round(clamp(b, 0, 1) * 255);
export const hexCSS = (h) => `#${(h >>> 0).toString(16).padStart(6, '0')}`;

export function mix(a, b, t) {
  const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b);
  return hexOf(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

function toHSL(hex) {
  const [r, g, b] = rgbOf(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const l = (mx + mn) / 2;
  const s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}
function fromHSL(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return hexOf(r + m, g + m, b + m);
}
/** Rotate a hue toward skylight blue by `deg` along the short arc. "+6° cool" of §4.1. */
function coolHue(h, deg) {
  let d = 220 - h;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return h + Math.sign(d) * Math.min(deg, Math.abs(d));
}

/** Band 2: the base at 0.72x luminance, hue rotated +6 cool. Terminator is hard. */
export function coolShade(hex, k = 0.72) {
  const [h, s, l] = toHSL(hex);
  return fromHSL(coolHue(h, 6), Math.min(1, s + 0.04), l * k);
}
/** Band 3: undersides catch a warm kick off the roadway — brickBounce at 25%, +6 L*. */
export function bounceOf(hex) {
  const [h, s, l] = toHSL(mix(hex, AIR.brickBounce, 0.25));
  return fromHSL(h, s, Math.min(1, l * 0.86 + 0.09));
}
/** §4.2 outline: same hue, L* down ~40 points, saturation up. Never grey, never flat ink. */
export function inkOf(hex) {
  const [h, s, l] = toHSL(hex);
  return fromHSL(h, Math.min(1, s * 1.18 + 0.10), Math.max(0.055, l * 0.30));
}

/* Cloth the palette does not name directly, all derived from it — never invented. */
export const WOOL = [
  soot(PAVEMENT.asphaltWarm, 0.20),                            // warm brown
  soot(PAVEMENT.asphaltShade, 0.06),                           // taupe
  mix(soot(PAVEMENT.asphaltShade, 0.28), AIR.shadowTint, 0.5), // faded navy
  soot(mix(PAVEMENT.belgianBlock, ACCENTS.olive, 0.42), 0.26), // olive
  soot(FACADE.brickShade, 0.30),                               // brown herringbone
  soot(PAVEMENT.curb, 0.30),                                   // heather grey
];
export const HAIR = [
  soot(SKIN[5], 0.58),                       // black
  soot(FACADE.brickShade, 0.40),             // dark brown
  soot(ACCENTS.tan, 0.36),                   // brown
  soot(ACCENTS.rust, 0.20),                  // ginger
  mix(ACCENTS.mustard, PAVEMENT.blockCrown, 0.5), // sandy blond
  soot(PAVEMENT.belgianBlock, 0.30),         // mousy
];
export const LEATHER = [
  soot(ACCENTS.tan, 0.42),
  soot(FACADE.brickShade, 0.44),
  soot(PAVEMENT.asphaltDark, 0.10),
];
export const SOCKWOOL = [
  soot(PAVEMENT.asphaltDark, 0.34),
  soot(ACCENTS.tan, 0.48),
  soot(PAVEMENT.curb, 0.42),
  mix(soot(PAVEMENT.asphaltShade, 0.40), AIR.shadowTint, 0.45),
];

/* ============================================================================
   2. THE BAND BAKER
   ========================================================================= */

// Authored key: high, front, over the kid's right shoulder (viewer's left).
const KEY = (() => { const v = [-0.50, 0.66, 0.56]; const n = Math.hypot(...v); return v.map((x) => x / n); })();

function bakeBands(geo, hex, opt) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const n = pos.count;
  const lit = rgbOf(hex);
  const shd = rgbOf(coolShade(hex, opt.shade ?? 0.72));
  const bnc = rgbOf(bounceOf(hex));
  const olc = rgbOf(inkOf(hex));
  const col = new Float32Array(n * 3), ocol = new Float32Array(n * 3);
  const term = opt.term ?? 0.05;
  for (let i = 0; i < n; i++) {
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    const d = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];
    const c = (ny < -0.52) ? bnc : (d > term ? lit : shd);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    ocol[i * 3] = olc[0]; ocol[i * 3 + 1] = olc[1]; ocol[i * 3 + 2] = olc[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('ocolor', new THREE.BufferAttribute(ocol, 3));
}

/** A collection of baked geometry that becomes exactly one mesh + one outline shell. */
export class Body {
  constructor() { this.geos = []; }
  /** geo must already be in final part-local space. */
  add(geo, hex, opt = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    bakeBands(g, hex, opt);
    this.geos.push(g);
    return this;
  }
  get empty() { return this.geos.length === 0; }
  /** Dirt is a character trait (§4.4.5): darken vertices inside a sphere. */
  smudge(x, y, z, r, hex = soot(FACADE.brickShade, 0.15), amount = 0.35) {
    const t = rgbOf(hex), r2 = r * r;
    for (const g of this.geos) {
      const p = g.attributes.position, c = g.attributes.color;
      for (let i = 0; i < p.count; i++) {
        const dx = p.getX(i) - x, dy = p.getY(i) - y, dz = p.getZ(i) - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        const k = amount * (1 - d2 / r2);
        c.setXYZ(i, c.getX(i) + (t[0] - c.getX(i)) * k, c.getY(i) + (t[1] - c.getY(i)) * k,
          c.getZ(i) + (t[2] - c.getZ(i)) * k);
      }
    }
    return this;
  }
  merge() {
    let total = 0;
    for (const g of this.geos) total += g.attributes.position.count;
    const P = new Float32Array(total * 3), N = new Float32Array(total * 3);
    const C = new Float32Array(total * 3), O = new Float32Array(total * 3);
    let o = 0;
    for (const g of this.geos) {
      P.set(g.attributes.position.array, o); N.set(g.attributes.normal.array, o);
      C.set(g.attributes.color.array, o); O.set(g.attributes.ocolor.array, o);
      o += g.attributes.position.count * 3;
      g.dispose();
    }
    this.geos.length = 0;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(P, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    out.setAttribute('color', new THREE.BufferAttribute(C, 3));
    out.setAttribute('ocolor', new THREE.BufferAttribute(O, 3));
    return out;
  }
}

/** Inverted-hull outline: weld, average normals, push out, draw back faces. */
export function outlineOf(geo, width) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, oc = geo.attributes.ocolor;
  const n = pos.count;
  const map = new Map(), acc = [], idx = new Int32Array(n);
  const q = (v) => Math.round(v * 500);
  for (let i = 0; i < n; i++) {
    const k = `${q(pos.getX(i))},${q(pos.getY(i))},${q(pos.getZ(i))}`;
    let j = map.get(k);
    if (j === undefined) { j = acc.length / 3; map.set(k, j); acc.push(0, 0, 0); }
    idx[i] = j;
    acc[j * 3] += nrm.getX(i); acc[j * 3 + 1] += nrm.getY(i); acc[j * 3 + 2] += nrm.getZ(i);
  }
  const P = new Float32Array(n * 3), C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = idx[i];
    let ax = acc[j * 3], ay = acc[j * 3 + 1], az = acc[j * 3 + 2];
    const len = Math.hypot(ax, ay, az) || 1;
    ax /= len; ay /= len; az /= len;
    P[i * 3] = pos.getX(i) + ax * width;
    P[i * 3 + 1] = pos.getY(i) + ay * width;
    P[i * 3 + 2] = pos.getZ(i) + az * width;
    C[i * 3] = oc.getX(i); C[i * 3 + 1] = oc.getY(i); C[i * 3 + 2] = oc.getZ(i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  return out;
}

const skinMat = () => new THREE.MeshBasicMaterial({ vertexColors: true });
export function partMesh(body, width, name) {
  const geo = body.merge();
  const g = new THREE.Group();
  g.name = name || 'part';
  const shell = new THREE.Mesh(outlineOf(geo, width), new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide,
  }));
  shell.renderOrder = -1;
  g.add(shell);
  g.add(new THREE.Mesh(geo, skinMat()));
  return g;
}

/* ============================================================================
   3. GEOMETRY KIT — every form is a tube, a ball or a rounded box.
   ========================================================================= */

export const G = {
  sphere: (r, w = 14, h = 10) => new THREE.SphereGeometry(r, w, h),
  /** Rounded box with analytic normals — the workhorse for boots, brims, torsos. */
  box(w, h, d, r = 0.05, seg = 3) {
    const g = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const p = g.attributes.position, nn = g.attributes.normal;
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
      const cx = clamp(p.getX(i), -hx, hx), cy = clamp(p.getY(i), -hy, hy), cz = clamp(p.getZ(i), -hz, hz);
      let ax = p.getX(i) - cx, ay = p.getY(i) - cy, az = p.getZ(i) - cz;
      const l = Math.hypot(ax, ay, az) || 1;
      ax /= l; ay /= l; az /= l;
      p.setXYZ(i, cx + ax * r, cy + ay * r, cz + az * r);
      nn.setXYZ(i, ax, ay, az);
    }
    return g;
  },
  cyl: (rt, rb, h, seg = 12, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open),
  /** Lathe from a [radius, y] profile. Ends pinch closed so the outline shell never gapes. */
  tube(profile, seg = 12) {
    const pts = [new THREE.Vector2(1e-3, profile[0][1])];
    for (const [r, y] of profile) pts.push(new THREE.Vector2(Math.max(r, 1e-3), y));
    pts.push(new THREE.Vector2(1e-3, profile[profile.length - 1][1]));
    return new THREE.LatheGeometry(pts, seg);
  },
  /** A half-disc slab lying in XZ, pointing +Z. Caps and hat brims. */
  brim(r, thick, seg = 16) {
    const g = new THREE.CylinderGeometry(r, r * 0.98, thick, seg, 1, false, -Math.PI / 2, Math.PI);
    return g;
  },
  ring: (r, tube, seg = 8, tub = 16, arc = Math.PI * 2) => new THREE.TorusGeometry(r, tube, seg, tub, arc),
};

/** The one deform function; head mesh and face decal both run through it so they agree. */
export function deformHead(geo, hs) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const t = clamp((0.25 - y) / 1.25, 0, 1);           // 0 at crown, 1 at chin
    const jaw = 1 - hs.jaw * t * t;
    const cheek = 1 + hs.cheek * Math.exp(-((y + 0.12) * (y + 0.12)) / 0.05);
    const crown = y > 0 ? 1 + hs.crown * (y * y) : 1;
    x *= hs.w * jaw * cheek;
    z *= hs.d * jaw * cheek * (z < 0 ? hs.backFlat : 1);
    y *= hs.h * crown;
    if (y < -0.5) y -= hs.chin * (-y - 0.5);
    p.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

/* ============================================================================
   4. GARMENTS — each gets exactly one exaggeration, always volume or hem (§5.2)
   ========================================================================= */

/**
 * The cap: our primary silhouette organ. Scaled to 1.15-1.4x the head's plan area,
 * sitting as a separate solid shape with a hard brim edge.
 * kind: 'newsboy' | 'flat' | 'adult' | 'none'
 */
export function buildCap(body, ctx) {
  const h = ctx.hat;
  if (!h || h.kind === 'none') return null;
  const hw = ctx.hw, hh = ctx.hh;
  const g = new THREE.Group();
  const sub = new Body();
  const col = h.color;

  if (h.kind === 'adult') {
    // Somebody's father's derby. Two sizes too big, sits on the ears.
    const crownR = hw * 0.50 * h.size;
    const crown = G.tube([[crownR * 0.86, 0], [crownR, hh * 0.10], [crownR * 0.99, hh * 0.30],
      [crownR * 0.80, hh * 0.40]], 14);
    sub.add(crown, col);
    const brim = G.cyl(hw * 0.92 * h.size, hw * 0.95 * h.size, hh * 0.035, 20);
    brim.translate(0, hh * 0.02, 0);
    brim.scale(1, 1, 0.94);
    sub.add(brim, col, { shade: 0.66 });
    const band = G.cyl(crownR * 1.02, crownR * 1.02, hh * 0.075, 16);
    band.translate(0, hh * 0.075, 0);
    sub.add(band, ctx.teamColor, { shade: 0.7 });
  } else {
    const flat = h.kind === 'flat';
    const rx = hw * 0.585 * h.size, rz = hw * 0.585 * h.size * (flat ? 1.06 : 1.0);
    const domeH = hh * (flat ? 0.20 : 0.30) * h.size;
    // Eight-panel dome: a squashed sphere-cap, drooping forward over the brim.
    const dome = G.sphere(1, 16, 9);
    const dp = dome.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      let x = dp.getX(i), y = dp.getY(i), z = dp.getZ(i);
      if (y < -0.12) y = -0.12 - (y + 0.12) * 0.12;      // flat underside
      const puff = flat ? 1 : 1 + 0.14 * Math.max(0, z);  // newsboy bags forward
      dp.setXYZ(i, x * rx * puff, y * domeH + domeH * 0.10, z * rz * puff);
    }
    dome.computeVertexNormals();
    sub.add(dome, col);
    // Button on the crown, the newsboy's tell.
    if (!flat) { const b = G.sphere(hw * 0.055, 8, 6); b.translate(0, domeH * 1.02, 0); sub.add(b, col); }
    // Hard brim edge — short and stiff, snapped down toward the brow.
    const brim = G.brim(rx * 0.99, hh * 0.032, 16);
    brim.scale(1, 1, flat ? 0.78 : 0.60);
    brim.translate(0, -hh * 0.005, rz * 0.10);
    const m = new THREE.Matrix4().makeRotationX(0.16);
    brim.applyMatrix4(m);
    sub.add(brim, col, { shade: 0.62 });
    // Team marker: a strip of dyed flannel round the cap band. <=15% of silhouette.
    if (ctx.teamOnCap) {
      const band = G.tube([[rx * 0.90, -hh * 0.03], [rx * 1.0, hh * 0.012], [rx * 0.97, hh * 0.055]], 16);
      band.scale(1, 1, rz / rx);
      sub.add(band, ctx.teamColor, { shade: 0.72 });
    }
  }
  const mesh = partMesh(sub, ctx.outline * 0.9, 'cap');
  g.add(mesh);
  g.position.y = ctx.capY;
  g.rotation.set(h.tiltX || 0, h.tiltY || 0, h.tiltZ || 0);
  return g;
}

/** Hair mass — the second-best blackout hook after head shape. */
export function buildHair(body, ctx) {
  const s = ctx.hair; if (!s || s.style === 'none') return;
  const hw = ctx.hw, hh = ctx.hh, c = s.color;
  const capped = ctx.hat && ctx.hat.kind !== 'none';
  if (s.style === 'bowl' || (capped && s.style !== 'pigtails' && s.style !== 'ponytail' && s.style !== 'puff' && s.style !== 'braids')) {
    // Under a cap only the fringe and the nape show.
    const fringe = G.tube([[hw * 0.50, 0], [hw * 0.525, -hh * 0.07], [hw * 0.47, -hh * 0.14]], 14);
    fringe.translate(0, hh * 0.24, 0);
    body.add(fringe, c);
    if (!capped) {
      const bowl = G.sphere(1, 14, 9);
      const bp = bowl.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const y = bp.getY(i);
        bp.setXYZ(i, bp.getX(i) * hw * 0.545, Math.max(y, -0.32) * hh * 0.56 + hh * 0.10, bp.getZ(i) * hw * 0.545);
      }
      bowl.computeVertexNormals();
      body.add(bowl, c);
    }
    return;
  }
  if (s.style === 'pigtails' || s.style === 'braids') {
    const base = G.sphere(1, 14, 9);
    const bp = base.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      bp.setXYZ(i, bp.getX(i) * hw * 0.56, Math.max(bp.getY(i), -0.45) * hh * 0.55 + hh * 0.06, bp.getZ(i) * hw * 0.56);
    }
    base.computeVertexNormals();
    body.add(base, c);
    for (const sx of [-1, 1]) {
      const len = s.style === 'braids' ? hh * 0.55 : hh * 0.34;
      const tail = G.tube([[hh * 0.11, 0], [hh * 0.135, -len * 0.45], [hh * 0.07, -len]], 10);
      tail.rotateZ(sx * 0.45);
      tail.translate(sx * hw * 0.52, hh * 0.04, -hw * 0.06);
      body.add(tail, c);
      if (s.ribbon) {
        const r = G.ring(hh * 0.10, hh * 0.036, 6, 12);
        r.rotateY(Math.PI / 2);
        r.rotateZ(sx * 0.45);
        r.translate(sx * hw * 0.575, hh * 0.10, -hw * 0.06);
        body.add(r, s.ribbon);
      }
    }
    return;
  }
  if (s.style === 'ponytail') {
    const base = G.sphere(1, 14, 9);
    const bp = base.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      bp.setXYZ(i, bp.getX(i) * hw * 0.555, Math.max(bp.getY(i), -0.4) * hh * 0.55 + hh * 0.06, bp.getZ(i) * hw * 0.555);
    }
    base.computeVertexNormals();
    body.add(base, c);
    const tail = G.tube([[hh * 0.10, 0], [hh * 0.155, -hh * 0.28], [hh * 0.06, -hh * 0.58]], 10);
    tail.rotateX(-0.5);
    tail.translate(0, hh * 0.14, -hw * 0.52);
    body.add(tail, c);
    if (s.ribbon) {
      const r = G.ring(hh * 0.105, hh * 0.036, 6, 12);
      r.rotateX(Math.PI / 2 - 0.5);
      r.translate(0, hh * 0.155, -hw * 0.54);
      body.add(r, s.ribbon);
    }
    return;
  }
  if (s.style === 'puff') {
    for (const [ox, oy, r] of [[0, 0.22, 0.60], [-0.44, 0.06, 0.36], [0.44, 0.06, 0.36], [0, -0.02, 0.30]]) {
      const p = G.sphere(hw * r, 12, 9);
      p.scale(1, 0.86, 0.94);
      p.translate(ox * hw, oy * hh + hh * 0.06, -hw * 0.04);
      body.add(p, c);
    }
    return;
  }
  if (s.style === 'pomp') {
    const base = G.sphere(1, 14, 9);
    const bp = base.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      bp.setXYZ(i, bp.getX(i) * hw * 0.555, Math.max(bp.getY(i), -0.3) * hh * 0.5 + hh * 0.10, bp.getZ(i) * hw * 0.555);
    }
    base.computeVertexNormals();
    body.add(base, c);
    const bulb = G.sphere(hh * 0.27, 12, 9);
    bulb.scale(1.05, 0.95, 0.8);
    bulb.translate(0, hh * 0.40, hw * 0.28);
    body.add(bulb, c);
    return;
  }
  // 'crop' / 'bob'
  const bob = G.sphere(1, 14, 10);
  const p2 = bob.attributes.position;
  const low = s.style === 'bob' ? -0.62 : -0.30;
  for (let i = 0; i < p2.count; i++) {
    const y = Math.max(p2.getY(i), low);
    p2.setXYZ(i, p2.getX(i) * hw * 0.56, y * hh * 0.55 + hh * 0.06, p2.getZ(i) * hw * 0.56 * (p2.getZ(i) > 0 ? 0.92 : 1.04));
  }
  bob.computeVertexNormals();
  body.add(bob, c);
}

/** Ears. Optional and usually under the cap — except on the one kid they define. */
export function buildEars(body, ctx) {
  const e = ctx.ears; if (!e) return;
  for (const sx of [-1, 1]) {
    const g = G.sphere(ctx.hh * 0.115 * e, 10, 8);
    g.scale(0.42, 1.05, 0.95);
    g.translate(sx * ctx.hw * 0.50, -ctx.hh * 0.02, -ctx.hw * 0.05);
    body.add(g, ctx.skinColor);
  }
}

/**
 * Knickers: a balloon ending in a hard horizontal buckle line at the knee.
 * Width at the seat ~1.3x hip width. The buckle break is unmistakable at 96 px.
 */
export function buildKnicker(body, ctx, side) {
  const { thighLen, hipR } = ctx;
  const seat = hipR * 1.30 * ctx.baggy;
  const g = G.tube([
    [hipR * 1.05, hipR * 0.5], [seat, -thighLen * 0.18], [seat * 0.98, -thighLen * 0.52],
    [seat * 0.80, -thighLen * 0.86], [hipR * 0.78, -thighLen * 0.96],
  ], 12);
  body.add(g, ctx.trouser);
  // The buckle band: a hard horizontal at the knee.
  const band = G.cyl(hipR * 0.80, hipR * 0.76, thighLen * 0.10, 12);
  band.translate(0, -thighLen * 1.0, 0);
  body.add(band, ctx.trouserDark, { shade: 0.66 });
  const buckle = G.box(hipR * 0.30, thighLen * 0.075, hipR * 0.18, 0.01, 1);
  buckle.translate(side * hipR * 0.10, -thighLen * 1.0, hipR * 0.74);
  body.add(buckle, ctx.buckle);
  if (ctx.patched) {
    const patch = G.box(hipR * 0.85, thighLen * 0.30, hipR * 0.30, hipR * 0.12, 2);
    patch.translate(0, -thighLen * 0.72, seat * 0.80);
    body.add(patch, ctx.patchColor);
  }
  body.smudge(0, -thighLen * 0.95, hipR * 0.7, hipR * 1.5, ctx.dirt, 0.34);
}

/** Long stockings — accordion sag above the boot, three folds, asymmetric L/R. */
export function buildStocking(body, ctx, side, sock) {
  const { shinLen, ankleH } = ctx;
  const r = ctx.hipR * 0.60;
  const sag = sock.sag;
  const prof = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = -shinLen * t;
    const wob = 1 + sag * 0.20 * Math.sin(t * Math.PI * 3 + sock.phase) * Math.min(1, t * 2.4);
    prof.push([r * (1 - 0.28 * t) * wob, y]);
  }
  const g = G.tube(prof, 12);
  body.add(g, sock.color);
  if (ctx.bareLeg) return;
  body.smudge(0, -shinLen * 0.2, r * 0.6, r * 2.2, ctx.dirt, 0.22);
}

/** Ankle boots — oversized, tongue out, one lace knotted where it broke. */
export function buildBoot(body, ctx, side) {
  const L = ctx.shoeLen, h = ctx.hh;
  const f = ctx.feet;
  if (f.kind === 'bare') {
    const foot = G.box(L * 0.44, h * 0.16, L * 1.0, h * 0.07, 3);
    foot.translate(0, -ctx.ankleH + h * 0.08, L * 0.18);
    body.add(foot, ctx.skinColor);
    for (let i = 0; i < 4; i++) {
      const t = G.sphere(L * 0.055 - i * L * 0.006, 7, 5);
      t.translate((-1.5 + i) * L * 0.10 * (side > 0 ? 1 : -1), -ctx.ankleH + h * 0.055, L * 0.62);
      body.add(t, ctx.skinColor);
    }
    body.smudge(0, -ctx.ankleH + h * 0.03, L * 0.3, L * 0.9, ctx.dirt, 0.5);
    return;
  }
  const upper = f.kind === 'keds' ? h * 0.16 : h * 0.30;
  const boot = G.box(L * 0.48, upper, L * 0.86, L * 0.14, 3);
  boot.translate(0, -ctx.ankleH + upper * 0.5, L * 0.10);
  body.add(boot, f.color);
  const toe = G.sphere(L * 0.26, 12, 8);
  toe.scale(0.92, 0.62, 1.15);
  toe.translate(0, -ctx.ankleH + L * 0.16, L * 0.40);
  body.add(toe, f.color);
  const sole = G.box(L * 0.54, h * 0.045, L * 0.96, L * 0.05, 2);
  sole.translate(0, -ctx.ankleH + h * 0.022, L * 0.13);
  body.add(sole, f.sole, { shade: 0.6 });
  if (f.kind !== 'keds') {
    const tongue = G.box(L * 0.22, upper * 0.7, L * 0.06, L * 0.03, 1);
    tongue.rotateX(-0.32);
    tongue.translate(0, -ctx.ankleH + upper * 0.72, L * 0.30);
    body.add(tongue, f.tongue);
    const knot = G.sphere(L * 0.058, 7, 5);
    knot.translate(side * L * 0.10, -ctx.ankleH + upper * 0.62, L * 0.34);
    body.add(knot, f.lace);
  }
  body.smudge(0, -ctx.ankleH + h * 0.04, L * 0.4, L * 0.8, ctx.dirt, 0.30);
}

/** Suspenders: two bold straps in a saturated colour, one off the shoulder on some kids. */
export function buildSuspenders(body, ctx) {
  const s = ctx.susp; if (!s || !s.on) return;
  const { torsoH, chestW, chestD } = ctx;
  const w = ctx.hh * 0.085;
  for (const side of [-1, 1]) {
    const off = s.offShoulder === (side < 0 ? 'L' : 'R');
    const x = side * chestW * 0.30;
    if (off) {
      // Fallen off the shoulder and hanging down the arm — free character, free asymmetry.
      const strap = G.box(w, torsoH * 0.55, ctx.hh * 0.032, w * 0.30, 2);
      strap.rotateZ(side * 0.34);
      strap.translate(side * chestW * 0.52, torsoH * 0.50, chestD * 0.56);
      body.add(strap, s.color);
    } else {
      const front = G.box(w, torsoH * 0.98, ctx.hh * 0.03, w * 0.3, 2);
      front.rotateZ(side * 0.10);
      front.translate(x, torsoH * 0.50, chestD * 0.72);
      body.add(front, s.color);
      const over = G.box(w, ctx.hh * 0.035, chestD * 1.5, w * 0.3, 2);
      over.translate(side * chestW * 0.34, torsoH * 0.99, 0);
      body.add(over, s.color, { shade: 0.7 });
    }
    const back = G.box(w, torsoH * 0.85, ctx.hh * 0.03, w * 0.3, 2);
    back.rotateZ(side * 0.22);
    back.translate(side * chestW * 0.20, torsoH * 0.52, -chestD * 0.70);
    body.add(back, s.color);
  }
}

/** A prop hook that breaks the outline. At least six on the field at any time. */
export function buildProp(body, ctx) {
  const p = ctx.prop; if (!p) return;
  const h = ctx.hh, { torsoH, chestW, chestD } = ctx;
  if (p === 'pigeon') {
    const bd = G.sphere(h * 0.20, 12, 9);
    bd.scale(0.78, 0.86, 1.25);
    bd.translate(chestW * 0.86, torsoH + h * 0.20, -h * 0.03);
    body.add(bd, mix(PAVEMENT.curb, AIR.skyFill, 0.35));
    const hd = G.sphere(h * 0.10, 10, 8);
    hd.translate(chestW * 0.86, torsoH + h * 0.36, h * 0.10);
    body.add(hd, mix(PAVEMENT.curb, AIR.skyFill, 0.5));
    const bk = G.cyl(h * 0.005, h * 0.028, h * 0.07, 6);
    bk.rotateX(Math.PI / 2);
    bk.translate(chestW * 0.86, torsoH + h * 0.35, h * 0.19);
    body.add(bk, ACCENTS.mustard);
    const tl = G.box(h * 0.10, h * 0.02, h * 0.20, h * 0.008, 1);
    tl.rotateX(-0.30);
    tl.translate(chestW * 0.86, torsoH + h * 0.20, -h * 0.24);
    body.add(tl, mix(PAVEMENT.curb, AIR.shadowTint, 0.3));
  } else if (p === 'newspaper') {
    const n = G.cyl(h * 0.075, h * 0.075, h * 0.52, 10);
    n.rotateZ(0.34); n.rotateX(0.18);
    n.translate(-chestW * 0.72, torsoH * 0.24, -chestD * 0.34);
    body.add(n, mix(CLOTH[0], PAVEMENT.curb, 0.35));
  } else if (p === 'slingshot') {
    const stem = G.cyl(h * 0.026, h * 0.03, h * 0.22, 8);
    stem.translate(-chestW * 0.42, torsoH * 0.10, -chestD * 0.85);
    body.add(stem, LEATHER[1]);
    for (const sx of [-1, 1]) {
      const arm = G.cyl(h * 0.020, h * 0.024, h * 0.17, 8);
      arm.rotateZ(sx * 0.42);
      arm.translate(-chestW * 0.42 + sx * h * 0.045, torsoH * 0.10 + h * 0.18, -chestD * 0.85);
      body.add(arm, LEATHER[1]);
    }
  } else if (p === 'hanger') {
    const hook = G.ring(h * 0.07, h * 0.016, 6, 12, Math.PI * 1.4);
    hook.rotateY(Math.PI / 2);
    hook.translate(chestW * 0.55, torsoH * 0.16, -chestD * 0.60);
    body.add(hook, PAVEMENT.manholeHigh);
    const bar = G.cyl(h * 0.014, h * 0.014, h * 0.30, 6);
    bar.rotateZ(Math.PI / 2);
    bar.translate(chestW * 0.55, torsoH * 0.03, -chestD * 0.60);
    body.add(bar, PAVEMENT.manholeHigh);
  } else if (p === 'cards') {
    for (let i = 0; i < 5; i++) {
      const c = G.box(h * 0.13, h * 0.19, h * 0.008, 0.004, 1);
      c.rotateZ(-0.34 + i * 0.17);
      c.translate(-chestW * 0.50 + i * h * 0.028, torsoH * 0.14 + h * 0.03, -chestD * 0.86);
      body.add(c, i % 2 ? CLOTH[3] : mix(CLOTH[1], ACCENTS.mustard, 0.35));
    }
  } else if (p === 'jar') {
    const j = G.cyl(h * 0.11, h * 0.10, h * 0.26, 12);
    j.translate(chestW * 0.60, torsoH * 0.22, chestD * 0.80);
    body.add(j, mix(AIR.skyLower, CLOTH[3], 0.4));
    const lid = G.cyl(h * 0.115, h * 0.115, h * 0.05, 12);
    lid.translate(chestW * 0.60, torsoH * 0.35, chestD * 0.80);
    body.add(lid, PAVEMENT.manholeHigh);
    const bug = G.sphere(h * 0.05, 8, 6);
    bug.translate(chestW * 0.60, torsoH * 0.16, chestD * 0.84);
    body.add(bug, ACCENTS.olive);
  } else if (p === 'harmonica') {
    const m = G.box(h * 0.30, h * 0.10, h * 0.06, h * 0.014, 1);
    m.rotateZ(0.12);
    m.translate(-chestW * 0.46, torsoH * 0.20, chestD * 0.84);
    body.add(m, PAVEMENT.manholeHigh);
  }
}

/* ============================================================================
   5. THE NINE SILHOUETTE FAMILIES (§5.4)
   Each is a shape. A kid is a shape plus a behaviour.
   ========================================================================= */

export const FAMILIES = {
  melon: {
    label: 'The Melon', heads: 3.10, tall: 4.46,
    head: { w: 1.10, h: 1.06, d: 1.04, jaw: 0.14, cheek: 0.10, crown: 0.16, chin: 0.02, backFlat: 1.0 },
    build: 0.50, baggy: 1.05,
    hat: { kind: 'newsboy', size: 0.80, tiltX: -0.14, tiltZ: 0.10 },   // a lid perched on a melon
    hair: 'bowl', top: 'shirt', legs: 'knickers', feet: 'boots', susp: true,
    note: 'huge round head, small cap perched on top like a lid',
  },
  fireplug: {
    label: 'The Fireplug', heads: 2.80, tall: 4.04,
    head: { w: 1.06, h: 0.94, d: 1.0, jaw: 0.05, cheek: 0.20, crown: 0.0, chin: 0.0, backFlat: 1.0 },
    build: 1.00, baggy: 1.16,
    hat: { kind: 'flat', size: 1.10, tiltX: 0.16, tiltZ: -0.05 },      // jammed to the eyebrows
    hair: 'crop', top: 'shirt', legs: 'knickers', feet: 'boots', susp: true,
    neck: 0.0, note: 'short and wide, barrel torso, zero neck, best hitter on the block',
  },
  beanpole: {
    label: 'The Beanpole', heads: 3.90, tall: 5.22,
    head: { w: 0.86, h: 1.10, d: 0.94, jaw: 0.30, cheek: -0.05, crown: 0.05, chin: 0.10, backFlat: 1.0 },
    build: 0.08, baggy: 0.86,
    hat: { kind: 'flat', size: 0.94, tiltX: -0.22, tiltY: 0.30 },
    hair: 'crop', top: 'shirt', legs: 'knickers', feet: 'boots', susp: true,
    highWater: 0.30, note: 'all leg, knickers riding high, four inches of bare shin',
  },
  sack: {
    label: 'The Sack', heads: 3.02, tall: 4.10,
    head: { w: 0.98, h: 1.0, d: 0.98, jaw: 0.16, cheek: 0.16, crown: 0.06, chin: 0.0, backFlat: 1.0 },
    build: 0.35, baggy: 1.10,
    hat: { kind: 'newsboy', size: 1.06, tiltX: 0.10, tiltZ: 0.14 },
    hair: 'bowl', top: 'handmedown', legs: 'knickers', feet: 'boots', susp: false,
    note: 'a small kid entirely inside an adult sweater — a bell with a cap on it',
  },
  ears: {
    label: 'The Ears', heads: 3.32, tall: 4.72,
    head: { w: 0.96, h: 1.02, d: 0.96, jaw: 0.22, cheek: 0.06, crown: 0.04, chin: 0.04, backFlat: 1.0 },
    build: 0.40, baggy: 1.0, ears: 2.15,
    hat: { kind: 'none' }, hair: 'crop', top: 'vest', legs: 'knickers', feet: 'boots', susp: true,
    note: 'the cap will not stay on over them — the only bare head in the field',
  },
  bandbox: {
    label: 'The Bandbox', heads: 3.22, tall: 4.62,
    head: { w: 0.94, h: 1.02, d: 0.96, jaw: 0.20, cheek: 0.04, crown: 0.02, chin: 0.0, backFlat: 1.0 },
    build: 0.34, baggy: 0.80,
    hat: { kind: 'flat', size: 0.92, tiltX: 0.0 }, hair: 'crop',
    top: 'shirt', legs: 'knickers', feet: 'keds', susp: false, tidy: true, bowtie: true,
    note: 'the one kid with money — the only perfectly tidy silhouette on the field',
  },
  ribbon: {
    label: 'The Ribbon', heads: 3.42, tall: 4.86,
    head: { w: 0.95, h: 1.02, d: 0.95, jaw: 0.22, cheek: 0.10, crown: 0.05, chin: 0.0, backFlat: 1.0 },
    build: 0.26, baggy: 0.92,
    hat: { kind: 'none' }, hair: 'ponytail', top: 'dress', legs: 'dress', feet: 'boots', susp: false,
    note: 'plays in a dropped-waist dress with the hem taken up, because she is faster than everybody',
  },
  barefoot: {
    label: 'The Barefoot', heads: 3.00, tall: 4.30,
    head: { w: 1.0, h: 1.0, d: 1.0, jaw: 0.20, cheek: 0.12, crown: 0.05, chin: 0.02, backFlat: 1.0 },
    build: 0.44, baggy: 1.06,
    hat: { kind: 'newsboy', size: 1.24, tiltX: 0.20, tiltZ: -0.16 },   // two sizes too big
    hair: 'bowl', top: 'shirt', legs: 'knickers', feet: 'bare', susp: true, bareLeg: true,
    note: 'no shoes at all, cuffs rolled — his feet are the largest objects in his outline',
  },
  brace: {
    label: 'The Brace', heads: 3.30, tall: 4.68,
    head: { w: 0.97, h: 1.02, d: 0.96, jaw: 0.20, cheek: 0.06, crown: 0.05, chin: 0.02, backFlat: 1.0 },
    build: 0.32, baggy: 0.98,
    hat: { kind: 'flat', size: 1.0, tiltX: -0.10, tiltY: -0.24 },
    hair: 'crop', top: 'shirt', legs: 'knickers', feet: 'boots', susp: true,
    brace: 'R', crutch: true,
    note: 'caliper brace and a wooden crutch, three ground contacts, and the best arm on the block',
  },
};

/* ============================================================================
   6. THE THIRTY (§5.5). Shape clause + behaviour clause, every one of them.
   ========================================================================= */

const A = Object.keys(ACCENTS);
const K = (id, name, nick, sex, fam, o = {}) => ({ id, name, nick, sex, fam, ...o });

export const KIDS = [
  // --- Melons ---------------------------------------------------------------
  K('otto', 'Otto Bauer', 'Melon', 'b', 'melon', { skin: 1, hair: 4, accent: 'mustard', slot: 'sweater', prop: 'harmonica', pose: 'pockets', team: 0, ex: 'grin', quirk: { freckles: 1, browThick: 1.15 } }),
  K('bessie', 'Bessie Katz', 'Beans', 'g', 'melon', { skin: 2, hair: 1, accent: 'plum', slot: 'ribbon', hairStyle: 'pigtails', prop: 'jar', pose: 'hipsHands', team: 1, ex: 'taunt', quirk: { tongue: 'L' } }),
  K('rocco', 'Rocco Panzera', 'Rocky', 'b', 'melon', { skin: 3, hair: 0, accent: 'bottleGreen', slot: 'suspenders', prop: null, pose: 'armsCrossed', team: 0, ex: 'determined', dh: 0.06 }),
  // --- Fireplugs ------------------------------------------------------------
  K('sal', 'Salvatore Marino', 'Socks', 'b', 'fireplug', { skin: 3, hair: 0, accent: 'red', slot: 'sweater', prop: 'newspaper', pose: 'batReady', team: 0, ex: 'determined', quirk: { browThick: 1.3, droopy: 'R' } }),
  K('filomena', 'Filomena Greco', 'Fanny', 'g', 'fireplug', { skin: 2, hair: 1, accent: 'claret', slot: 'sweater', hairStyle: 'braids', prop: null, pose: 'hipsHands', team: 1, ex: 'smug', dh: 0.05 }),
  K('butch', 'Willie Boyd', 'Butch', 'b', 'fireplug', { skin: 5, hair: 0, accent: 'indigo', slot: 'cap', prop: 'cards', pose: 'slouch', team: 1, ex: 'neutral', dh: -0.04 }),
  // --- Beanpoles ------------------------------------------------------------
  K('irving', 'Irving Lefkowitz', 'Skinny', 'b', 'beanpole', { skin: 1, hair: 5, accent: 'olive', slot: 'suspenders', prop: 'slingshot', pose: 'scratch', team: 0, ex: 'shock', quirk: { eyeSize: 1.1 } }),
  K('kathleen', 'Kathleen Doyle', 'Legs', 'g', 'beanpole', { skin: 0, hair: 3, accent: 'teal', slot: 'ribbon', hairStyle: 'ponytail', prop: null, pose: 'point', team: 1, ex: 'grin', dh: -0.06, quirk: { freckles: 2 } }),
  K('herman', 'Herman Muller', 'Stretch', 'b', 'beanpole', { skin: 1, hair: 4, accent: 'rust', slot: 'cap', prop: 'hanger', pose: 'ready', team: 0, ex: 'neutral', dh: 0.04 }),
  // --- Sacks ----------------------------------------------------------------
  K('sidney', 'Sidney Adler', 'Half-Pint', 'b', 'sack', { skin: 1, hair: 1, accent: 'periwinkle', slot: 'sweater', prop: null, pose: 'sleeves', team: 0, ex: 'disappointed', quirk: { eyeSize: 1.12 } }),
  K('connie', 'Concetta Ruffo', 'Connie', 'g', 'sack', { skin: 3, hair: 0, accent: 'mustard', slot: 'sweater', hairStyle: 'braids', prop: 'jar', pose: 'sleeves', team: 1, ex: 'grin', dh: 0.05 }),
  K('peggy', 'Peggy Nolan', 'Peanuts', 'g', 'sack', { skin: 0, hair: 3, accent: 'bottleGreen', slot: 'sweater', hairStyle: 'pigtails', prop: null, pose: 'sleeves', team: 0, ex: 'yell', dh: -0.05, quirk: { freckles: 2 } }),
  K('gertie', 'Gertrude Vogel', 'Gertie', 'g', 'sack', { skin: 1, hair: 4, accent: 'slateBlue', slot: 'sweater', hairStyle: 'bob', prop: 'cards', pose: 'sleeves', team: 1, ex: 'neutral', dh: 0.02 }),
  // --- Ears -----------------------------------------------------------------
  K('eugene', 'Eugene Marshall', 'Ears', 'b', 'ears', { skin: 5, hair: 0, accent: 'mustard', slot: 'vest', prop: 'pigeon', pose: 'ready', team: 0, ex: 'grin', quirk: { browThick: 1.1 } }),
  K('yetta', 'Yetta Zimmerman', 'Hooks', 'g', 'ears', { skin: 1, hair: 1, accent: 'claret', slot: 'vest', hairStyle: 'pigtails', prop: null, pose: 'point', team: 1, ex: 'taunt', dh: 0.06 }),
  K('danny', 'Danny Cassidy', 'Whitey', 'b', 'ears', { skin: 0, hair: 4, accent: 'indigo', slot: 'vest', prop: 'newspaper', pose: 'slouch', team: 0, ex: 'smug', dh: -0.05, quirk: { freckles: 3, droopy: 'L' } }),
  // --- Bandboxes ------------------------------------------------------------
  K('reese', 'Reese Worthington III', 'Specs', 'b', 'bandbox', { skin: 0, hair: 4, accent: 'plum', slot: 'bowtie', prop: null, pose: 'tidy', team: 1, ex: 'neutral', specs: true, quirk: { eyeSize: 0.94 } }),
  K('dorothy', 'Dorothy Vandermeer', 'Duchess', 'g', 'bandbox', { skin: 1, hair: 5, accent: 'periwinkle', slot: 'ribbon', hairStyle: 'bob', prop: null, pose: 'tidy', team: 0, ex: 'smug', dh: 0.04 }),
  K('milton', 'Milton Frank', 'Sonny', 'b', 'bandbox', { skin: 2, hair: 1, accent: 'teal', slot: 'bowtie', prop: 'harmonica', pose: 'tidy', team: 1, ex: 'grin', dh: -0.03 }),
  K('angela', 'Angela Bruno', 'Curly', 'g', 'bandbox', { skin: 3, hair: 0, accent: 'red', slot: 'ribbon', hairStyle: 'pigtails', prop: null, pose: 'hipsHands', team: 0, ex: 'determined', dh: 0.05 }),
  // --- Ribbons --------------------------------------------------------------
  K('ethel', 'Ethel Randolph', 'Speed', 'g', 'ribbon', { skin: 5, hair: 0, accent: 'mustard', slot: 'ribbon', hairStyle: 'puff', prop: null, pose: 'sprintset', team: 0, ex: 'determined', quirk: { browThick: 1.1 } }),
  K('carmen', 'Carmen Rivera', 'Chick', 'g', 'ribbon', { skin: 3, hair: 0, accent: 'rust', slot: 'ribbon', hairStyle: 'ponytail', prop: null, pose: 'hipsHands', team: 1, ex: 'taunt', dh: -0.05 }),
  K('maureen', 'Maureen Sheehan', 'Red', 'g', 'ribbon', { skin: 0, hair: 3, accent: 'bottleGreen', slot: 'ribbon', hairStyle: 'pigtails', prop: null, pose: 'point', team: 0, ex: 'yell', dh: 0.04, quirk: { freckles: 3 } }),
  K('rose', 'Rose Abramowitz', 'Rosie', 'g', 'ribbon', { skin: 2, hair: 1, accent: 'slateBlue', slot: 'ribbon', hairStyle: 'braids', prop: 'jar', pose: 'ready', team: 1, ex: 'grin', dh: -0.02 }),
  // --- Barefoot -------------------------------------------------------------
  K('cheech', 'Jesús Colón', 'Cheech', 'b', 'barefoot', { skin: 4, hair: 0, accent: 'olive', slot: 'suspenders', prop: 'slingshot', pose: 'scratch', team: 1, ex: 'grin', quirk: { tongue: 'R' } }),
  K('bootsie', 'Bernice Turner', 'Bootsie', 'g', 'barefoot', { skin: 5, hair: 0, accent: 'periwinkle', slot: 'suspenders', hairStyle: 'puff', prop: null, pose: 'hipsHands', team: 0, ex: 'taunt', dh: 0.05 }),
  K('tiny', 'Tommy Fitzgerald', 'Tiny', 'b', 'barefoot', { skin: 0, hair: 3, accent: 'red', slot: 'suspenders', prop: 'newspaper', pose: 'slouch', team: 1, ex: 'neutral', dh: 0.10, scale: 1.14, quirk: { freckles: 2 } }),
  // --- Braces ---------------------------------------------------------------
  K('abie', 'Abraham Silver', 'Hooks', 'b', 'brace', { skin: 1, hair: 1, accent: 'indigo', slot: 'sweater', prop: null, pose: 'crutch', team: 0, ex: 'determined', quirk: { browThick: 1.2 } }),
  K('luz', 'Luz Ortiz', 'Lefty', 'g', 'brace', { skin: 3, hair: 0, accent: 'tan', slot: 'ribbon', hairStyle: 'braids', prop: null, pose: 'crutch', team: 1, ex: 'smug', dh: 0.05 }),
  K('booker', 'Booker Hayes', 'Duke', 'b', 'brace', { skin: 4, hair: 0, accent: 'claret', slot: 'cap', prop: 'cards', pose: 'crutch', team: 0, ex: 'grin', dh: -0.04 }),
];

export const KIDS_BY_ID = new Map(KIDS.map((k) => [k.id, k]));

/** The nine families, one exemplar each, in the order the bible lists them. */
export const LINEUP_ORDER = ['otto', 'sal', 'irving', 'sidney', 'eugene', 'reese', 'ethel', 'cheech', 'abie'];

/** Deterministic pick for callers who only have a colour pair (legacy buildKid). */
export function specFromColors(colors = {}) {
  const h = ((colors.shirt || 0) * 31 + (colors.cap || 0) * 17 + (colors.pants || 0)) >>> 0;
  return KIDS[h % KIDS.length];
}

export function specFor(ref) {
  if (!ref && ref !== 0) return KIDS[0];
  if (typeof ref === 'number') return KIDS[((ref % KIDS.length) + KIDS.length) % KIDS.length];
  if (typeof ref === 'string') return KIDS_BY_ID.get(ref) || KIDS[0];
  return ref;
}

/** Resolve a kid spec + family preset into the full dimension/colour context the rig builds from. */
export function resolveKid(spec) {
  const fam = FAMILIES[spec.fam];
  const heads = fam.heads + (spec.dh || 0);
  const tall = fam.tall * (spec.scale || 1) + (spec.dh || 0) * 0.30;
  const hh = tall / heads;
  const accent = ACCENTS[spec.accent] || ACCENTS[A[0]];
  const team = spec.team ? TEAMS.away : TEAMS.home;
  const skinColor = SKIN[spec.skin ?? 1];
  const shirtCloth = CLOTH[(spec.skin ?? 1) % CLOTH.length];
  const trouser = WOOL[(spec.id.charCodeAt(0) + (spec.skin ?? 0)) % WOOL.length];
  return { fam, heads, tall, hh, accent, team, skinColor, shirtCloth, trouser };
}

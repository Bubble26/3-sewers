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

/**
 * Vertex colours are handed to the GPU in the LINEAR working space — three.js converts
 * material.color and textures for you and does not convert vertex colours. Baking sRGB
 * hex straight into a colour attribute is what makes an authored palette come out pale,
 * gold-rimmed and washed out, so every baked colour goes through here first.
 */
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const linOf = (h) => rgbOf(h).map(srgbToLinear);

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
  const [r, g, b] = rgbOf(hex);
  const dark = hexOf(r * k, g * k, b * k);          // exactly 0.72x luminance, hue held
  const [h, sa, l] = toHSL(mix(dark, AIR.shadowTint, 0.10));   // and 6 degrees toward skylight
  return fromHSL(coolHue(h, 6), Math.min(1, sa + 0.03), l);
}
/** Band 3: undersides catch a warm kick off the roadway — brickBounce at 25%, +6 L*. */
export function bounceOf(hex) {
  const [h, s, l] = toHSL(mix(hex, AIR.brickBounce, 0.25));
  return fromHSL(h, s, Math.min(1, l * 0.86 + 0.09));
}
/** §4.2 outline: same hue, L* down ~40 points, saturation up. Never grey, never flat ink. */
export function inkOf(hex) {
  const [h, s, l] = toHSL(hex);
  return fromHSL(h, Math.min(1, s * 1.25 + 0.12), Math.max(0.050, Math.min(0.26, l * 0.24)));
}

/* Cloth the palette does not name directly, all derived from it — never invented. */
// Dark wool trousers under an ecru shirt is the period's own value structure: the kids
// carry their contrast on their own bodies, light on top and dark below.
export const WOOL = [
  soot(PAVEMENT.asphaltWarm, 0.30),                            // warm brown
  soot(mix(PAVEMENT.asphaltShade, PAVEMENT.belgianBlock, 0.35), 0.26), // taupe
  mix(soot(PAVEMENT.asphaltShade, 0.34), AIR.shadowTint, 0.42), // faded navy
  soot(mix(PAVEMENT.belgianBlock, ACCENTS.olive, 0.42), 0.36), // olive
  soot(FACADE.brickShade, 0.30),                               // brown herringbone
  soot(PAVEMENT.curb, 0.40),                                   // heather grey
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
  soot(ACCENTS.tan, 0.46),
  soot(FACADE.brickShade, 0.42),
  soot(mix(ACCENTS.tan, FACADE.brickShade, 0.6), 0.56),
];
export const SOCKWOOL = [
  soot(PAVEMENT.asphaltDark, 0.42),
  soot(ACCENTS.tan, 0.46),
  soot(PAVEMENT.curb, 0.34),
  mix(soot(PAVEMENT.asphaltShade, 0.44), AIR.shadowTint, 0.40),
];

/* ============================================================================
   2. THE BAND BAKER
   ========================================================================= */

// Authored key: high, front, over the kid's right shoulder (viewer's left).
const KEY = (() => { const v = [-0.50, 0.66, 0.56]; const n = Math.hypot(...v); return v.map((x) => x / n); })();

function bakeBands(geo, hex, opt) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal;
  const n = pos.count;
  const lit = linOf(hex);
  const shd = linOf(coolShade(hex, opt.shade ?? 0.72));
  const bnc = linOf(bounceOf(hex));
  const olc = linOf(inkOf(hex));
  const col = new Float32Array(n * 3), ocol = new Float32Array(n * 3);
  const term = opt.term ?? 0.05;
  for (let i = 0; i < n; i++) {
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    const d = nx * KEY[0] + ny * KEY[1] + nz * KEY[2];
    const c = (ny < -0.52 || ny > 0.80) ? bnc : (d > term ? lit : shd);
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
    const t = linOf(hex), r2 = r * r;
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

export function partMesh(body, width, name) {
  const geo = body.merge();
  const g = new THREE.Group();
  g.name = name || 'part';
  const shell = new THREE.Mesh(outlineOf(geo, width), new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, toneMapped: false,
  }));
  shell.renderOrder = -1;
  g.add(shell);
  g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
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
  /**
   * Lathe from a [radius, y] profile. Ends pinch closed so the outline shell never gapes.
   * The profile is normalised to run UPWARD first: a lathe built from points that descend
   * comes out inside-out, which silently flips its normals — every band lands on the wrong
   * side and the outline hull grows inward instead of outward.
   */
  tube(profile, seg = 16) {
    const p = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
    const pts = [new THREE.Vector2(1e-3, p[0][1])];
    for (const [r, y] of p) pts.push(new THREE.Vector2(Math.max(r, 1e-3), y));
    pts.push(new THREE.Vector2(1e-3, p[p.length - 1][1]));
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
    // 1.15-1.4x the head's PLAN AREA is 1.07-1.18x its plan radius. A cap the wrong size
    // is the joke on two kids, so size drives width and how far down it drops, not both.
    const base = hw * 0.535 * (h.size ** 0.60);
    const rx = base, rz = base * (flat ? 1.08 : 1.02);
    const domeH = hh * (flat ? 0.35 : 0.41) * (0.86 + 0.14 * h.size);
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
    const m = new THREE.Matrix4().makeRotationX(0.105);
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
  const capped = !!(ctx.hat && ctx.hat.kind !== 'none');
  const tailed = s.style === 'pigtails' || s.style === 'braids' || s.style === 'ponytail';

  const fringe = () => {
    const f = G.tube([[hw * 0.505, hh * 0.20], [hw * 0.53, hh * 0.09], [hw * 0.47, hh * 0.01]], 16);
    body.add(f, c);
    const nape = G.sphere(1, 12, 8);
    const np = nape.attributes.position;
    for (let i = 0; i < np.count; i++) {
      np.setXYZ(i, np.getX(i) * hw * 0.50, Math.max(np.getY(i), -0.5) * hh * 0.16 - hh * 0.06,
        Math.min(np.getZ(i), -0.1) * hw * 0.54);
    }
    nape.computeVertexNormals();
    body.add(nape, c);
  };
  const round = (y) => {                 // sphere -> dome: hold the width higher up
    const a = Math.min(0.999, Math.abs(y));
    return Math.sqrt(Math.max(0, 1 - a ** 3)) / Math.max(0.05, Math.sqrt(1 - a * a));
  };
  const dome = (top, wide) => {
    const g = G.sphere(1, 16, 11);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = Math.max(p.getY(i), -0.45);
      const k = Math.min(1.5, round(p.getY(i)));
      p.setXYZ(i, p.getX(i) * hw * wide * k, y * hh * top + hh * 0.07, p.getZ(i) * hw * wide * k);
    }
    g.computeVertexNormals();
    body.add(g, c);
  };
  const tails = () => {
    if (s.style === 'ponytail') {
      const t = G.tube([[hh * 0.105, 0], [hh * 0.165, -hh * 0.28], [hh * 0.06, -hh * 0.60]], 10);
      t.rotateX(-0.55);
      t.translate(0, hh * 0.16, -hw * 0.52);
      body.add(t, c);
      if (s.ribbon) {
        const r = G.ring(hh * 0.11, hh * 0.038, 6, 12);
        r.rotateX(Math.PI / 2 - 0.55);
        r.translate(0, hh * 0.175, -hw * 0.54);
        body.add(r, s.ribbon);
      }
      return;
    }
    const len = s.style === 'braids' ? hh * 0.62 : hh * 0.38;
    for (const sx of [-1, 1]) {
      const t = G.tube([[hh * 0.115, 0], [hh * 0.145, -len * 0.45], [hh * 0.07, -len]], 10);
      t.rotateZ(sx * 0.48);
      t.translate(sx * hw * 0.50, hh * 0.02, -hw * 0.08);
      body.add(t, c);
      if (s.ribbon) {
        const r = G.ring(hh * 0.105, hh * 0.040, 6, 12);
        r.rotateY(Math.PI / 2);
        r.rotateZ(sx * 0.48);
        r.translate(sx * hw * 0.555, hh * 0.085, -hw * 0.08);
        body.add(r, s.ribbon);
      }
    }
  };
  const headband = () => {
    if (!s.ribbon) return;
    const band = G.tube([[hw * 0.575, hh * 0.10], [hw * 0.60, hh * 0.20], [hw * 0.55, hh * 0.27]], 16);
    body.add(band, s.ribbon);
    const bow = G.sphere(hh * 0.095, 10, 8);
    bow.scale(1.6, 0.9, 0.7);
    bow.translate(hw * 0.42, hh * 0.235, hw * 0.30);
    body.add(bow, s.ribbon);
  };

  if (capped) { fringe(); if (tailed) tails(); return; }

  if (s.style === 'pigtails' || s.style === 'braids') { dome(0.56, 0.565); tails(); return; }
  if (s.style === 'ponytail') { dome(0.56, 0.565); tails(); return; }
  if (s.style === 'puff') {
    headband();
    for (const [ox, oy, r] of [[0, 0.24, 0.62], [-0.46, 0.06, 0.38], [0.46, 0.06, 0.38], [0, -0.02, 0.32]]) {
      const p = G.sphere(hw * r, 12, 9);
      p.scale(1, 0.88, 0.94);
      p.translate(ox * hw, oy * hh + hh * 0.06, -hw * 0.04);
      body.add(p, c);
    }
    return;
  }
  if (s.style === 'pomp') {
    dome(0.52, 0.565);
    const bulb = G.sphere(hh * 0.28, 12, 9);
    bulb.scale(1.05, 0.95, 0.8);
    bulb.translate(0, hh * 0.42, hw * 0.28);
    body.add(bulb, c);
    return;
  }
  // 'bowl' / 'crop' / 'bob'
  headband();
  const low = s.style === 'bob' ? -0.66 : s.style === 'bowl' ? -0.34 : -0.26;
  const g = G.sphere(1, 16, 11);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = Math.max(p.getY(i), low);
    p.setXYZ(i, p.getX(i) * hw * 0.565, y * hh * 0.56 + hh * 0.06,
      p.getZ(i) * hw * 0.565 * (p.getZ(i) > 0 ? 0.94 : 1.04));
  }
  g.computeVertexNormals();
  body.add(g, c);
}

/** Ears. Optional and usually under the cap — except on the one kid they define. */
export function buildEars(body, ctx) {
  const e = ctx.ears; if (!e) return;
  const eh = ctx.hh * (0.115 + 0.062 * e);        // how tall
  const ew = ctx.hh * (0.026 + 0.052 * e);        // how far it sticks out
  for (const sx of [-1, 1]) {
    const g = G.sphere(1, 12, 9);
    g.scale(ew, eh, eh * 0.80);
    g.translate(sx * (ctx.hw * 0.42 + ew * 0.62), -ctx.hh * 0.015, -ctx.hw * 0.06);
    body.add(g, ctx.skinColor);
    const bowl = G.sphere(1, 10, 8);               // the shell, so it is an ear and not a fin
    bowl.scale(ew * 0.42, eh * 0.62, eh * 0.50);
    bowl.translate(sx * (ctx.hw * 0.42 + ew * 0.78), -ctx.hh * 0.015, -ctx.hw * 0.02);
    body.add(bowl, ctx.earShade);
  }
}

/**
 * Knickers: a balloon ending in a hard horizontal buckle line at the knee.
 * Width at the seat ~1.3x hip width. The buckle break is unmistakable at 96 px.
 */
export function buildKnicker(body, ctx, side) {
  const { thighLen, legR } = ctx;
  const seat = legR * 1.40 * ctx.baggy;
  const g = G.tube([
    [legR * 1.02, legR * 0.9], [seat, -thighLen * 0.20], [seat * 0.99, -thighLen * 0.54],
    [seat * 0.86, -thighLen * 0.88], [legR * 0.86, -thighLen * 0.97],
  ], 12);
  body.add(g, ctx.trouser);
  // The buckle band: a hard horizontal at the knee, and it is the whole point of knickers.
  const band = G.cyl(legR * 0.98, legR * 0.94, thighLen * 0.16, 12);
  band.translate(0, -thighLen * 1.02, 0);
  body.add(band, ctx.buckleBand, { shade: 0.60 });
  const buckle = G.box(legR * 0.34, thighLen * 0.085, legR * 0.20, 0.01, 1);
  buckle.translate(side * legR * 0.12, -thighLen * 1.01, legR * 0.86);
  body.add(buckle, ctx.buckle);
  if (ctx.patched) {
    const patch = G.box(legR * 0.66, thighLen * 0.24, legR * 0.26, legR * 0.15, 2);
    patch.translate(side * legR * 0.10, -thighLen * 0.80, seat * 0.86);
    body.add(patch, ctx.patchColor);
    for (let i = 0; i < 4; i++) {                       // four stitches, because somebody sewed it
      const st = G.sphere(legR * 0.048, 6, 5);
      st.translate(side * legR * 0.10 + (i - 1.5) * legR * 0.17, -thighLen * 0.68, seat * 0.92);
      body.add(st, ctx.patchStitch);
    }
  }
  body.smudge(0, -thighLen * 0.92, legR * 0.9, legR * 2.0, ctx.dirt, 0.34);
}

/** Long stockings — accordion sag above the boot, three folds, asymmetric L/R. */
export function buildStocking(body, ctx, side, sock, bareTop = 0) {
  const { shinLen } = ctx;
  const r = ctx.legR * 1.02;
  const sag = sock.sag;
  const top = -shinLen * bareTop;               // beanpole: four inches of bare shin
  const span = shinLen * (1 - bareTop);
  const prof = [];
  const N = 9;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = top - span * t;
    const wob = 1 + sag * 0.20 * Math.sin(t * Math.PI * 3 + sock.phase) * Math.min(1, t * 2.4);
    prof.push([r * (1.02 - 0.26 * t) * wob, y]);
  }
  body.add(G.tube(prof, 12), sock.color);
  // the darned cuff at the top of the stocking, a hard horizontal
  body.add(G.tube([[r * 1.10, top], [r * 1.14, top - shinLen * 0.05]], 12), soot(sock.color, 0.22));
  body.smudge(0, top - span * 0.2, r * 0.6, r * 2.2, ctx.dirt, 0.20);
}

/** Ankle boots — oversized, tongue out, one lace knotted where it broke. */
export function buildBoot(body, ctx, side) {
  const L = ctx.shoeLen, h = ctx.hh;
  // shoe LENGTH is 0.7-0.9 head-heights; the width follows the leg, not the length
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
  const upper = f.kind === 'keds' ? h * 0.19 : h * 0.36;
  const boot = G.box(L * 0.40, upper, L * 0.72, L * 0.13, 3);
  boot.translate(0, -ctx.ankleH + upper * 0.50, L * 0.04);
  body.add(boot, f.color);
  const toe = G.sphere(L * 0.23, 12, 9);
  toe.scale(0.88, 0.64, 1.16);
  toe.translate(0, -ctx.ankleH + L * 0.145, L * 0.33);
  body.add(toe, f.color);
  const sole = G.box(L * 0.42, h * 0.050, L * 0.86, L * 0.05, 2);
  sole.translate(0, -ctx.ankleH + h * 0.025, L * 0.09);
  body.add(sole, f.sole, { shade: 0.60 });
  if (f.kind !== 'keds') {
    const tongue = G.box(L * 0.20, upper * 0.78, L * 0.06, L * 0.03, 1);
    tongue.rotateX(-0.36);
    tongue.translate(0, -ctx.ankleH + upper * 0.76, L * 0.235);
    body.add(tongue, f.tongue);
    for (let i = 0; i < 3; i++) {          // laces, and one of them knotted where it broke
      const lace = G.box(L * 0.20, L * 0.026, L * 0.03, L * 0.012, 1);
      lace.translate(0, -ctx.ankleH + upper * (0.34 + i * 0.21), L * 0.26);
      body.add(lace, f.lace);
    }
    const knot = G.sphere(L * 0.055, 7, 5);
    knot.translate(side * L * 0.085, -ctx.ankleH + upper * 0.55, L * 0.29);
    body.add(knot, f.lace);
  }
  body.smudge(0, -ctx.ankleH + h * 0.04, L * 0.4, L * 0.8, ctx.dirt, 0.30);
}

/** Suspenders: two bold straps in a saturated colour, one off the shoulder on some kids. */
export function buildSuspenders(body, ctx) {
  const s = ctx.susp; if (!s || !s.on) return;
  const { torsoH, chestW, chestD } = ctx;
  const w = ctx.hh * 0.090;
  for (const side of [-1, 1]) {
    const off = s.offShoulder === (side < 0 ? 'R' : 'L');
    if (off) {
      // Fallen off the shoulder and hanging down the arm — free character, free asymmetry.
      const strap = G.box(w, torsoH * 0.56, ctx.hh * 0.034, w * 0.30, 2);
      strap.rotateZ(side * 0.40);
      strap.translate(side * chestW * 1.02, torsoH * 0.48, chestD * 0.62);
      body.add(strap, s.color);
    } else {
      const front = G.box(w, torsoH * 1.00, ctx.hh * 0.032, w * 0.3, 2);
      front.rotateZ(side * 0.13);
      front.translate(side * chestW * 0.50, torsoH * 0.50, chestD * 0.80);
      body.add(front, s.color);
      const over = G.box(w, ctx.hh * 0.038, chestD * 1.9, w * 0.3, 2);
      over.translate(side * chestW * 0.60, torsoH * 0.98, 0);
      body.add(over, s.color, { shade: 0.7 });
    }
    const back = G.box(w, torsoH * 0.88, ctx.hh * 0.032, w * 0.3, 2);
    back.rotateZ(side * 0.26);
    back.translate(side * chestW * 0.36, torsoH * 0.52, -chestD * 0.80);
    body.add(back, s.color);
  }
}

/** A prop hook that breaks the outline. At least six on the field at any time. */
export function buildProp(body, ctx) {
  const p = ctx.prop; if (!p) return;
  const h = ctx.hh, { torsoH, chestW, chestD } = ctx;
  const pigeonBody = mix(PAVEMENT.curb, AIR.skyFill, 0.35);
  if (p === 'pigeon') {
    const X = chestW * 1.05, Y = torsoH * 1.02;
    const bd = G.sphere(h * 0.27, 12, 9);
    bd.scale(0.74, 0.86, 1.24);
    bd.translate(X, Y + h * 0.24, -h * 0.02);
    body.add(bd, pigeonBody);
    const hd = G.sphere(h * 0.135, 10, 8);
    hd.translate(X, Y + h * 0.46, h * 0.14);
    body.add(hd, mix(pigeonBody, CHALK, 0.28));
    const bk = G.cyl(h * 0.004, h * 0.028, h * 0.08, 6);
    bk.rotateX(Math.PI / 2);
    bk.translate(X, Y + h * 0.445, h * 0.25);
    body.add(bk, ACCENTS.mustard);
    const eye = G.sphere(h * 0.020, 6, 5);
    eye.translate(X + h * 0.070, Y + h * 0.485, h * 0.13);
    body.add(eye, INK);
    const tl = G.box(h * 0.11, h * 0.022, h * 0.22, h * 0.008, 1);
    tl.rotateX(-0.34);
    tl.translate(X, Y + h * 0.24, -h * 0.32);
    body.add(tl, mix(pigeonBody, AIR.shadowTint, 0.35));
  } else if (p === 'newspaper') {
    const n = G.cyl(h * 0.070, h * 0.075, h * 0.56, 10);
    n.rotateZ(0.40); n.rotateX(0.20);
    n.translate(-chestW * 0.92, torsoH * 0.22, -chestD * 0.86);
    body.add(n, mix(CLOTH[0], PAVEMENT.curb, 0.30));
  } else if (p === 'slingshot') {
    const X = -chestW * 0.70, Z = -chestD * 1.02;
    const stem = G.cyl(h * 0.026, h * 0.030, h * 0.24, 8);
    stem.translate(X, torsoH * 0.12, Z);
    body.add(stem, LEATHER[1]);
    for (const sx of [-1, 1]) {
      const arm = G.cyl(h * 0.020, h * 0.024, h * 0.19, 8);
      arm.rotateZ(sx * 0.44);
      arm.translate(X + sx * h * 0.048, torsoH * 0.12 + h * 0.19, Z);
      body.add(arm, LEATHER[1]);
    }
  } else if (p === 'hanger') {
    const X = chestW * 0.94, Z = -chestD * 0.70;
    const hook = G.ring(h * 0.075, h * 0.016, 6, 12, Math.PI * 1.4);
    hook.rotateY(Math.PI / 2);
    hook.translate(X, torsoH * 0.20, Z);
    body.add(hook, PAVEMENT.manholeHigh);
    const bar = G.cyl(h * 0.014, h * 0.014, h * 0.34, 6);
    bar.rotateZ(Math.PI / 2);
    bar.translate(X, torsoH * 0.055, Z);
    body.add(bar, PAVEMENT.manholeHigh);
  } else if (p === 'cards') {
    for (let i = 0; i < 5; i++) {
      const c = G.box(h * 0.14, h * 0.20, h * 0.008, 0.004, 1);
      c.rotateZ(-0.38 + i * 0.19);
      c.translate(-chestW * 0.80 + i * h * 0.030, torsoH * 0.16 + h * 0.04, -chestD * 1.02);
      body.add(c, i % 2 ? CLOTH[3] : mix(CLOTH[1], ACCENTS.mustard, 0.35));
    }
  } else if (p === 'jar') {
    const X = chestW * 0.92;
    const j = G.cyl(h * 0.115, h * 0.105, h * 0.28, 12);
    j.translate(X, torsoH * 0.24, chestD * 0.94);
    body.add(j, mix(AIR.skyLower, CLOTH[3], 0.4));
    const lid = G.cyl(h * 0.12, h * 0.12, h * 0.05, 12);
    lid.translate(X, torsoH * 0.38, chestD * 0.94);
    body.add(lid, PAVEMENT.manholeHigh);
    const bug = G.sphere(h * 0.055, 8, 6);
    bug.translate(X, torsoH * 0.18, chestD * 0.99);
    body.add(bug, ACCENTS.olive);
  } else if (p === 'harmonica') {
    const m = G.box(h * 0.32, h * 0.11, h * 0.06, h * 0.014, 1);
    m.rotateZ(0.14);
    m.translate(-chestW * 0.74, torsoH * 0.22, chestD * 1.00);
    body.add(m, PAVEMENT.manholeHigh);
  }
}

/* ============================================================================
   5. THE NINE SILHOUETTE FAMILIES (§5.4)
   Each is a shape. A kid is a shape plus a behaviour.
   ========================================================================= */

export const FAMILIES = {
  melon: {
    label: 'The Melon', heads: 3.04, tall: 4.40,
    head: { w: 1.36, h: 1.14, d: 1.24, jaw: 0.04, cheek: 0.18, crown: 0.26, chin: 0.0, backFlat: 1.0 },
    build: 0.42, baggy: 1.05,
    hat: { kind: 'newsboy', size: 0.80, tiltX: -0.14, tiltZ: 0.10 },   // a lid perched on a melon
    hair: 'bowl', top: 'shirt', legs: 'knickers', feet: 'boots', susp: true,
    note: 'huge round head, small cap perched on top like a lid',
  },
  fireplug: {
    label: 'The Fireplug', heads: 2.74, tall: 3.96,
    head: { w: 1.10, h: 0.94, d: 1.04, jaw: 0.0, cheek: 0.26, crown: 0.0, chin: 0.0, backFlat: 1.0 },
    build: 0.94, baggy: 1.08,
    hat: { kind: 'flat', size: 1.06, tiltX: 0.11, tiltZ: -0.05 },      // jammed to the eyebrows
    hair: 'crop', top: 'shirt', legs: 'knickers', feet: 'boots', susp: true,
    neck: 0.0, note: 'short and wide, barrel torso, zero neck, best hitter on the block',
  },
  beanpole: {
    label: 'The Beanpole', heads: 3.96, tall: 5.36,
    head: { w: 0.85, h: 1.14, d: 0.90, jaw: 0.34, cheek: -0.06, crown: 0.04, chin: 0.14, backFlat: 1.0 },
    build: 0.00, baggy: 0.82,
    hat: { kind: 'flat', size: 0.94, tiltX: -0.22, tiltY: 0.30 },
    hair: 'crop', top: 'shirt', legs: 'knickers', feet: 'boots', susp: true,
    highWater: 0.30, note: 'all leg, knickers riding high, four inches of bare shin',
  },
  sack: {
    label: 'The Sack', heads: 3.02, tall: 4.06,
    head: { w: 1.02, h: 0.99, d: 1.00, jaw: 0.12, cheek: 0.20, crown: 0.06, chin: 0.0, backFlat: 1.0 },
    build: 0.30, baggy: 1.10,
    hat: { kind: 'newsboy', size: 1.06, tiltX: 0.10, tiltZ: 0.14 },
    hair: 'bowl', top: 'handmedown', legs: 'knickers', feet: 'boots', susp: false,
    note: 'a small kid entirely inside an adult sweater — a bell with a cap on it',
  },
  ears: {
    label: 'The Ears', heads: 3.32, tall: 4.72,
    head: { w: 0.93, h: 1.05, d: 0.94, jaw: 0.28, cheek: 0.04, crown: 0.03, chin: 0.06, backFlat: 1.0 },
    build: 0.40, baggy: 1.0, ears: 2.15,
    hat: { kind: 'none' }, hair: 'crop', top: 'vest', legs: 'knickers', feet: 'boots', susp: true,
    note: 'the cap will not stay on over them — the only bare head in the field',
  },
  bandbox: {
    label: 'The Bandbox', heads: 3.22, tall: 4.62,
    head: { w: 0.89, h: 1.08, d: 0.93, jaw: 0.26, cheek: 0.02, crown: 0.02, chin: 0.02, backFlat: 1.0 },
    build: 0.30, baggy: 0.74,
    hat: { kind: 'flat', size: 0.92, tiltX: 0.0 }, hair: 'crop',
    top: 'shirt', legs: 'knickers', feet: 'keds', susp: false, tidy: true, bowtie: true,
    note: 'the one kid with money — the only perfectly tidy silhouette on the field',
  },
  ribbon: {
    label: 'The Ribbon', heads: 3.42, tall: 4.86,
    head: { w: 0.92, h: 1.05, d: 0.93, jaw: 0.28, cheek: 0.12, crown: 0.06, chin: 0.0, backFlat: 1.0 },
    build: 0.20, baggy: 0.92,
    hat: { kind: 'none' }, hair: 'ponytail', top: 'dress', legs: 'dress', feet: 'boots', susp: false,
    note: 'plays in a dropped-waist dress with the hem taken up, because she is faster than everybody',
  },
  barefoot: {
    label: 'The Barefoot', heads: 3.00, tall: 4.30,
    head: { w: 1.07, h: 0.97, d: 1.02, jaw: 0.16, cheek: 0.18, crown: 0.05, chin: 0.0, backFlat: 1.0 },
    build: 0.52, baggy: 1.10,
    hat: { kind: 'newsboy', size: 1.15, tiltX: 0.15, tiltZ: -0.16 },   // two sizes too big
    hair: 'bowl', top: 'shirt', legs: 'knickers', feet: 'bare', susp: true, bareLeg: true,
    note: 'no shoes at all, cuffs rolled — his feet are the largest objects in his outline',
  },
  brace: {
    label: 'The Brace', heads: 3.30, tall: 4.68,
    head: { w: 0.96, h: 1.06, d: 0.95, jaw: 0.24, cheek: 0.06, crown: 0.06, chin: 0.04, backFlat: 1.0 },
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
  K('maureen', 'Maureen Sheehan', 'Red', 'g', 'ribbon', { skin: 0, hair: 3, accent: 'bottleGreen', slot: 'ribbon', hairStyle: 'pigtails', prop: null, pose: 'hipsHands', team: 0, ex: 'yell', dh: 0.04, quirk: { freckles: 3 } }),
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

import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { AIR, PAVEMENT, FACADE, CHALK, CLOTH, soot, sunlit } from '../render/palette.js';

/* =============================================================================
 * SKY — the strip of air over a 1:1 canyon, late September 1925
 * -----------------------------------------------------------------------------
 * Owned by the sky-light-atmosphere piece, together with render/lighting.js and
 * world/atmosphere.js.  This file is the *authority on the sun*: every other
 * module in the piece asks `SKY` where the sun is, how warm it is and what the
 * air is doing, so there is exactly one place a time-of-day change happens.
 *
 * Three things live here:
 *   1. TIME OF DAY — two authored presets ('afternoon', 'golden'), each a full
 *      set of sun geometry + air colours.  Rule 8 of the bible's DO-NOT list:
 *      "our light is authored".  These are not an ephemeris; they are two
 *      compositions chosen so the play plane stays in sun in both.
 *   2. THE DOME — a gradient sky with a hazy horizon and a forward-scatter
 *      brightening toward the sun, drawn once, unlit, un-tone-mapped, so the
 *      palette lands on screen exactly as authored.
 *   3. THE CLOUDS — hand-drawn fair-weather cumulus in three tone bands
 *      (sunlit crown / body / blue-violet belly), the way a 1925 travel poster
 *      would cut them, plus a few cirrus streaks.  They are backdrop material,
 *      so nothing in them exceeds coal-haze L* 83.3 and the ball's ink outline
 *      carries it against them at better than 10:1.
 *
 * Also exported, because both sibling files need them: SpriteBatch (one draw
 * call of camera-facing quads) and the canyon shadow solution `occlusionAt`.
 * ========================================================================== */

// ─── colour helpers ───────────────────────────────────────────────────────────
// Every hex in this file is derived from src/render/palette.js. `mix` is the
// only arithmetic allowed on them, and `soot`/`sunlit` come from the palette.
export function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((Math.round(ar + (br - ar) * t) << 16)
    | (Math.round(ag + (bg - ag) * t) << 8)
    | Math.round(ab + (bb - ab) * t));
}
export const css = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;
/** sRGB fractions, for raw ShaderMaterial uniforms that bypass colour management */
export const v3 = (hex) => new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
/** linear-space triple, for vertex-colour attributes */
const _c = new THREE.Color();
export function lin(hex) { _c.setHex(hex, THREE.SRGBColorSpace); return [_c.r, _c.g, _c.b]; }

// ─── the block's geometry, as the light needs it ──────────────────────────────
// These four numbers must agree with world/facade.js (M.facadeX and the corner
// taxpayer at DESIGN-BIBLE §3.2). They are repeated rather than imported so a
// half-written facade.js can never take the sky down with it.
export const CANYON = { facadeX: 32, taxZ0: -46, taxZ1: 5, taxH: 16, wallH: 62 };

const D2R = Math.PI / 180;

/* =============================================================================
 * 1. TIME OF DAY
 * ========================================================================== */

/**
 * Two presets. Both put home plate in direct sun — that is the whole point of
 * the 16ft corner taxpayer — and both keep ambient above 60% of key, because a
 * blue-shade street is a mood and this game has no tolerance for mood.
 *
 *   alt   sun altitude in degrees
 *   h     horizontal unit vector *toward* the sun (-x is south, -z is west)
 */
const PRESETS = {
  afternoon: {
    id: 'afternoon',
    caption: 'TEN OF FOUR',
    alt: 33, h: [-0.883, -0.469],          // 3:50pm EDT, Tue 22 Sep 1925 — facade.js bakes this
    sky: {
      zenith: soot(AIR.skyUpper, 0.26),
      upper: AIR.skyUpper,
      lower: AIR.skyLower,
      horizon: AIR.haze,
      glow: sunlit(AIR.haze, 0.26),
      glowK: 42, glowAmt: 0.5, scatter: 0.30,
    },
    cloud: {
      lit: AIR.haze,
      mid: mix(AIR.haze, AIR.skyLower, 0.40),
      shade: mix(AIR.skyLower, AIR.shadowTint, 0.44),
      cirrus: mix(AIR.haze, AIR.skyLower, 0.35),
      alpha: 0.95,
    },
    fog: { color: AIR.haze, near: 130, far: 660 },
    rig: {
      keyHex: sunlit(0xffffff, 0.28), keyI: 1.62,
      skyHex: mix(AIR.skyFill, AIR.haze, 0.30), groundHex: AIR.brickBounce, hemiI: 1.05,
      bounceHex: AIR.brickBounce, bounceI: 0.30,
      ambHex: mix(AIR.skyFill, AIR.brickBounce, 0.45), ambI: 0.22,
    },
    wash: {
      sunCol: sunlit(PAVEMENT.asphaltSun, 0.42), sunA: 0.20,
      shdCol: mix(PAVEMENT.asphaltShade, AIR.shadowTint, 0.62), shdA: 0.34,
      wallSunCol: sunlit(FACADE.brickSun, 0.38), wallSunA: 0.15,
      wallShdCol: mix(FACADE.brickShade, AIR.shadowTint, 0.58), wallShdA: 0.13,
      shaft: 0.055,
    },
  },

  golden: {
    id: 'golden',
    caption: 'LAST INNINGS',
    // ~5:15pm. The sun is lower and swung west, so kid shadows run two body
    // lengths across the road and the taxpayer's shade eats the south gutter —
    // but the plate keeps five feet of sun, on purpose. Authored, not computed.
    alt: 25, h: [-0.790, -0.613],
    sky: {
      zenith: mix(soot(AIR.skyUpper, 0.30), AIR.shadowTint, 0.22),
      upper: mix(AIR.skyUpper, AIR.sunTint, 0.16),
      lower: mix(AIR.skyLower, AIR.sunTint, 0.34),
      horizon: sunlit(AIR.haze, 0.52),
      glow: sunlit(AIR.haze, 0.72),
      glowK: 16, glowAmt: 0.72, scatter: 0.52,
    },
    cloud: {
      lit: sunlit(AIR.haze, 0.34),
      mid: mix(sunlit(AIR.haze, 0.34), FACADE.ochre, 0.34),
      shade: mix(AIR.skyLower, AIR.shadowTint, 0.62),
      cirrus: sunlit(AIR.haze, 0.44),
      alpha: 0.95,
    },
    fog: { color: sunlit(AIR.haze, 0.34), near: 100, far: 620 },
    rig: {
      keyHex: sunlit(0xffffff, 0.62), keyI: 1.55,
      skyHex: mix(AIR.skyFill, AIR.sunTint, 0.18), groundHex: sunlit(AIR.brickBounce, 0.30), hemiI: 1.02,
      bounceHex: sunlit(AIR.brickBounce, 0.34), bounceI: 0.40,
      ambHex: mix(AIR.skyFill, AIR.brickBounce, 0.55), ambI: 0.24,
    },
    wash: {
      sunCol: sunlit(PAVEMENT.blockCrown, 0.62), sunA: 0.30,
      shdCol: mix(PAVEMENT.asphaltShade, AIR.shadowTint, 0.74), shdA: 0.40,
      wallSunCol: sunlit(FACADE.ochre, 0.55), wallSunA: 0.30,
      wallShdCol: mix(FACADE.brickShade, AIR.shadowTint, 0.66), wallShdA: 0.16,
      shaft: 0.10,
    },
  },
};

/** Live sun state. Read it, never write it — call setTimeOfDay(). */
export const SKY = {
  tod: 'afternoon',
  P: PRESETS.afternoon,
  dir: new THREE.Vector3(-0.740, 0.545, -0.393),   // unit vector TOWARD the sun
  h: [-0.883, -0.469],
  rise: 0.649,                                      // tan(altitude)
  list: () => Object.keys(PRESETS),
};

function applyPreset(p) {
  const c = Math.cos(p.alt * D2R), s = Math.sin(p.alt * D2R);
  const hx = p.h[0], hz = p.h[1];
  const L = Math.hypot(hx, hz) || 1;
  SKY.P = p;
  SKY.tod = p.id;
  SKY.h = [hx / L, hz / L];
  SKY.rise = Math.tan(p.alt * D2R);
  SKY.dir.set(SKY.h[0] * c, s, SKY.h[1] * c).normalize();
}
applyPreset(PRESETS.afternoon);

/** The one control. Everything in the piece listens for the 'tod' event. */
export function setTimeOfDay(name) {
  const p = PRESETS[name] || PRESETS.afternoon;
  if (p.id === SKY.tod && SKY.P === p) { bus.emit('tod', { tod: p.id, preset: p }); return SKY; }
  applyPreset(p);
  bus.emit('tod', { tod: p.id, preset: p });
  return SKY;
}

/**
 * The canyon shadow solution, in JS. 0 = shade band, 1 = direct sun.
 * The south building line is the only thing that shadows this street: a 16ft
 * taxpayer on the corner lot, the 62ft tenement row behind it.
 */
export function occlusionAt(x, y, z, soft = 0.5) {
  const d = (x + CANYON.facadeX) / -SKY.h[0];
  if (d <= 0) return 1;
  const zh = z + SKY.h[1] * d;
  const yh = y + SKY.rise * d;
  const h = zh < CANYON.taxZ0 ? 0 : zh < CANYON.taxZ1 ? CANYON.taxH : CANYON.wallH;
  const v = (yh - h) / soft + 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/* =============================================================================
 * 2. SPRITE BATCH — every soft thing in the air, in one draw call
 * ========================================================================== */

export class SpriteBatch {
  constructor(scene, texture, capacity, opt = {}) {
    this.cap = capacity;
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new Float32Array(capacity * 12);
    this.aUv = new Float32Array(capacity * 8);
    this.aCol = new Float32Array(capacity * 16);
    const idx = new Uint16Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2;
      idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.aPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.aUv, 2).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.aCol, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 40, 40), 900);
    this.geo = g;
    this.mat = new THREE.MeshBasicMaterial({
      map: texture, transparent: true, vertexColors: true, depthWrite: false,
      side: THREE.DoubleSide, fog: false, toneMapped: false,
      blending: opt.blending || THREE.NormalBlending,
      depthTest: opt.depthTest !== false,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = opt.renderOrder ?? 0;
    this.mesh.name = opt.name || 'spritebatch';
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
  }

  begin(camera) {
    this.n = 0;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  }

  /** cx,cy,cz centre · w,h size in feet · uv rect · linear rgb + alpha · rot radians */
  push(cx, cy, cz, w, h, u0, v0, u1, v1, r, g, b, a, rot = 0, flip = false) {
    if (this.n >= this.cap || a <= 0.002) return;
    const i = this.n++;
    const co = Math.cos(rot), si = Math.sin(rot);
    const hw = w * 0.5, hh = h * 0.5;
    const R = this.right, U = this.up;
    const p = this.aPos, o = i * 12;
    const corner = (sx, sy, k) => {
      const dx = sx * hw * co - sy * hh * si;
      const dy = sx * hw * si + sy * hh * co;
      p[o + k] = cx + R.x * dx + U.x * dy;
      p[o + k + 1] = cy + R.y * dx + U.y * dy;
      p[o + k + 2] = cz + R.z * dx + U.z * dy;
    };
    corner(-1, -1, 0); corner(1, -1, 3); corner(1, 1, 6); corner(-1, 1, 9);
    const uv = this.aUv, q = i * 8;
    const a0 = flip ? u1 : u0, a1 = flip ? u0 : u1;
    uv[q] = a0; uv[q + 1] = v0;
    uv[q + 2] = a1; uv[q + 3] = v0;
    uv[q + 4] = a1; uv[q + 5] = v1;
    uv[q + 6] = a0; uv[q + 7] = v1;
    const c = this.aCol, m = i * 16;
    for (let k = 0; k < 4; k++) { c[m + k * 4] = r; c[m + k * 4 + 1] = g; c[m + k * 4 + 2] = b; c[m + k * 4 + 3] = a; }
  }

  end() {
    const n = this.n;
    this.geo.setDrawRange(0, n * 6);
    this.geo.attributes.position.addUpdateRange(0, n * 12);
    this.geo.attributes.uv.addUpdateRange(0, n * 8);
    this.geo.attributes.color.addUpdateRange(0, n * 16);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.uv.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

/* =============================================================================
 * 3. THE DOME
 * ========================================================================== */

const DOME_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DOME_FRAG = /* glsl */`
precision mediump float;
uniform vec3 uZenith, uUpper, uLower, uHorizon, uGlow, uSun;
uniform float uGlowK, uGlowAmt, uScatter;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float t = max(d.y, 0.0);
  // four stops, and the horizon stop is the coal-haze band: distance lightens.
  vec3 c = mix(uHorizon, uLower, smoothstep(0.0, 0.115, t));
  c = mix(c, uUpper, smoothstep(0.07, 0.40, t));
  c = mix(c, uZenith, smoothstep(0.36, 0.95, t));
  c = mix(c, uHorizon, smoothstep(0.0, -0.05, d.y));
  // forward scatter: the whole western quarter of the sky lifts toward the sun
  vec2 fd = normalize(vec2(d.x, d.z) + 1e-5);
  vec2 fs = normalize(vec2(uSun.x, uSun.z) + 1e-5);
  float az = max(dot(fd, fs), 0.0);
  float low = 1.0 - smoothstep(0.03, 0.46, t);
  float wide = pow(az, 2.6) * low * uScatter;
  float halo = pow(max(dot(d, uSun), 0.0), uGlowK) * uGlowAmt;
  c = mix(c, uGlow, clamp(wide + halo, 0.0, 0.86));
  gl_FragColor = vec4(c, 1.0);
}`;

function buildDome() {
  const geo = new THREE.SphereGeometry(760, 32, 20);
  const P = SKY.P.sky;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
    uniforms: {
      uZenith: { value: v3(P.zenith) }, uUpper: { value: v3(P.upper) },
      uLower: { value: v3(P.lower) }, uHorizon: { value: v3(P.horizon) },
      uGlow: { value: v3(P.glow) }, uSun: { value: SKY.dir.clone() },
      uGlowK: { value: P.glowK }, uGlowAmt: { value: P.glowAmt }, uScatter: { value: P.scatter },
    },
  });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'sky:dome';
  m.renderOrder = -1000;
  m.frustumCulled = false;
  return m;
}

/* =============================================================================
 * 4. THE CLOUDS
 * ========================================================================== */

const TILE = 256, TROWS = 2, TCOLS = 4;

/**
 * Fair-weather cumulus the way a 1925 poster cuts them: a flat base, a
 * scalloped crown, and exactly three tone bands with a hard edge between the
 * crown and the body. Nothing here goes above coal-haze L* 83.3.
 */
function cloudAtlas(P) {
  const c = document.createElement('canvas');
  c.width = TILE * TCOLS; c.height = TILE * TROWS;
  const g = c.getContext('2d');
  const rng = new RNG(19250922);
  const LIT = css(P.lit), MID = css(P.mid), SHD = css(P.shade), CIR = css(P.cirrus);

  const lobes = (n, w, h, baseY, spread) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1);
      const bell = Math.sin(Math.PI * (0.14 + 0.72 * u));
      out.push({
        x: (u - 0.5) * w * spread,
        y: baseY - bell * h * (0.38 + 0.52 * rng.next()),
        r: h * (0.30 + 0.34 * bell) * (0.78 + 0.44 * rng.next()),
      });
    }
    return out;
  };

  const drawCumulus = (ox, oy, n, w, h, spread) => {
    const baseY = oy + TILE * 0.70;
    const cx = ox + TILE * 0.5;
    const L = lobes(n, w, h, baseY, spread);
    const body = () => {
      g.beginPath();
      for (const l of L) { g.moveTo(cx + l.x + l.r, l.y); g.arc(cx + l.x, l.y, l.r, 0, Math.PI * 2); }
      g.rect(cx - w * 0.5 * spread, baseY - h * 0.30, w * spread, h * 0.30);
      g.closePath();
    };
    // 1. the body
    g.save();
    body(); g.fillStyle = MID; g.fill();
    // 2. clip to it, then lay the two other bands inside
    g.clip();
    // the blue-violet belly: the body pushed up and away from the sun
    g.save();
    g.translate(-h * 0.10, -h * 0.30);
    body(); g.fillStyle = SHD; g.fill();
    g.restore();
    // and the mid band back over it, leaving the belly as a rim
    g.save();
    g.translate(h * 0.06, -h * 0.44);
    body(); g.fillStyle = MID; g.fill();
    g.restore();
    // the sunlit crown, offset toward the sun (up and to the sprite's right)
    g.save();
    g.translate(h * 0.13, h * 0.20);
    body(); g.fillStyle = LIT; g.fill();
    g.restore();
    g.restore();
    // 3. a hand-cut edge: a thin lit rim on the top lobes only
    g.save();
    g.lineWidth = Math.max(2, h * 0.045);
    g.strokeStyle = LIT;
    g.lineCap = 'round';
    for (const l of L) {
      if (l.r < h * 0.24) continue;
      g.beginPath();
      g.arc(cx + l.x, l.y, l.r - g.lineWidth * 0.5, Math.PI * 1.06, Math.PI * 1.92);
      g.stroke();
    }
    g.restore();
  };

  const drawCirrus = (ox, oy, streaks) => {
    g.save();
    g.translate(ox, oy + TILE * 0.5);
    g.strokeStyle = CIR;
    g.lineCap = 'round';
    for (let i = 0; i < streaks; i++) {
      const y = (rng.next() - 0.5) * TILE * 0.5;
      const len = TILE * (0.42 + 0.5 * rng.next());
      const x0 = rng.range(6, TILE - len - 6);
      g.globalAlpha = 0.30 + 0.42 * rng.next();
      g.lineWidth = 2 + rng.next() * 7;
      g.beginPath();
      g.moveTo(x0, y);
      g.bezierCurveTo(x0 + len * 0.34, y - 9 - rng.next() * 12, x0 + len * 0.7, y + 5, x0 + len, y - 3 - rng.next() * 8);
      g.stroke();
    }
    g.restore();
  };

  drawCumulus(0, 0, 7, TILE * 0.92, TILE * 0.42, 0.86);
  drawCumulus(TILE, 0, 5, TILE * 0.76, TILE * 0.50, 0.72);
  drawCumulus(TILE * 2, 0, 9, TILE * 0.98, TILE * 0.34, 0.94);
  drawCumulus(TILE * 3, 0, 3, TILE * 0.50, TILE * 0.44, 0.52);
  drawCumulus(0, TILE, 6, TILE * 0.88, TILE * 0.30, 0.90);
  drawCumulus(TILE, TILE, 4, TILE * 0.62, TILE * 0.56, 0.60);
  drawCirrus(TILE * 2, TILE, 5);
  drawCirrus(TILE * 3, TILE, 4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

const TILE_UV = (col, row) => [col / TCOLS, 1 - (row + 1) / TROWS, (col + 1) / TCOLS, 1 - row / TROWS];

/** Where the clouds sit. Azimuth 0 is straight down the block, away from the batter. */
function makeClouds() {
  const r = new RNG(90125);
  const out = [];
  const put = (az, el, w, tile, dim = 1) => {
    const R = 620;
    const ce = Math.cos(el * D2R);
    out.push({
      pos: new THREE.Vector3(Math.sin(az * D2R) * R * ce, Math.sin(el * D2R) * R, Math.cos(az * D2R) * R * ce),
      w, h: w * (tile[4] || 0.55), uv: TILE_UV(tile[0], tile[1]), dim,
      drift: r.range(0.5, 1.4), phase: r.range(0, 6.28), flip: r.chance(0.5),
    });
  };
  // the two that sit in the canyon gap, where the gameplay camera can see them
  put(-5, 12.5, 210, [0, 0, 0, 0, 0.50]);
  put(9, 15.5, 150, [1, 0, 0, 0, 0.62]);
  put(2, 21.0, 118, [3, 0, 0, 0, 0.80], 0.94);
  // and the rest of the hemisphere, for the wide and roof-level shots
  put(-34, 17, 250, [2, 0, 0, 0, 0.40]);
  put(38, 13, 190, [0, 1, 0, 0, 0.36]);
  put(66, 22, 230, [1, 1, 0, 0, 0.82], 0.96);
  put(-72, 19, 200, [0, 0, 0, 0, 0.50], 0.96);
  put(128, 26, 260, [2, 0, 0, 0, 0.40], 0.92);
  put(-140, 15, 220, [1, 0, 0, 0, 0.62], 0.92);
  put(176, 20, 240, [0, 1, 0, 0, 0.36], 0.90);
  // cirrus, high and thin
  put(-18, 30, 320, [2, 1, 0, 0, 0.42], 0.85);
  put(46, 34, 300, [3, 1, 0, 0, 0.42], 0.85);
  put(-96, 28, 300, [2, 1, 0, 0, 0.42], 0.8);
  return out;
}

/* =============================================================================
 * The system
 * ========================================================================== */

export default registerSystem({
  name: 'sky',
  order: 3,

  init(app) {
    const P = SKY.P;
    this.dome = buildDome();
    app.scene.add(this.dome);

    this.cloudTex = { afternoon: null, golden: null };
    this.cloudTex[SKY.tod] = cloudAtlas(P.cloud);
    this.clouds = makeClouds();
    this.batch = new SpriteBatch(app.scene, this.cloudTex[SKY.tod], this.clouds.length + 2, {
      name: 'sky:clouds', renderOrder: -900,
    });
    this.t = 0;

    // the air itself: coal haze that LIGHTENS with distance (bible §2.3)
    if (!app.scene.fog) app.scene.fog = new THREE.Fog(P.fog.color, P.fog.near, P.fog.far);
    this.applyTod(P);

    bus.on('tod', ({ preset }) => this.applyTod(preset));
    app.sky = SKY;
    app.setTimeOfDay = setTimeOfDay;
  },

  applyTod(P) {
    const u = this.dome.material.uniforms;
    u.uZenith.value.copy(v3(P.sky.zenith));
    u.uUpper.value.copy(v3(P.sky.upper));
    u.uLower.value.copy(v3(P.sky.lower));
    u.uHorizon.value.copy(v3(P.sky.horizon));
    u.uGlow.value.copy(v3(P.sky.glow));
    u.uSun.value.copy(SKY.dir);
    u.uGlowK.value = P.sky.glowK;
    u.uGlowAmt.value = P.sky.glowAmt;
    u.uScatter.value = P.sky.scatter;

    if (!this.cloudTex[P.id]) this.cloudTex[P.id] = cloudAtlas(P.cloud);
    this.batch.mat.map = this.cloudTex[P.id];
    this.batch.mat.needsUpdate = true;
    this.cloudRGB = lin(0xffffff);
    this.cloudA = P.cloud.alpha;

    const scene = this.dome.parent;
    if (scene) {
      if (!scene.fog) scene.fog = new THREE.Fog(P.fog.color, P.fog.near, P.fog.far);
      scene.fog.color.setHex(P.fog.color, THREE.SRGBColorSpace);
      scene.fog.near = P.fog.near;
      scene.fog.far = P.fog.far;
      if (scene.background && scene.background.isColor) scene.background.setHex(P.sky.horizon, THREE.SRGBColorSpace);
      else scene.background = new THREE.Color().setHex(P.sky.horizon, THREE.SRGBColorSpace);
    }
  },

  onScenario() { this.t = 0; },

  update(dt) { this.t += dt; },

  preRender(app) {
    const cam = app.camera;
    this.dome.position.copy(cam.position);
    this.dome.updateMatrix();
    this.dome.updateMatrixWorld(true);

    const b = this.batch;
    b.begin(cam);
    const rgb = this.cloudRGB || lin(0xffffff);
    const A = this.cloudA ?? 0.95;
    for (const c of this.clouds) {
      // clouds drift, but at 600ft a real cloud moves about a foot a second:
      // this is a slow parallax, not a weather system.
      const dx = Math.sin(this.t * 0.013 * c.drift + c.phase) * 26;
      b.push(
        cam.position.x + c.pos.x + dx, c.pos.y, cam.position.z + c.pos.z,
        c.w, c.h, c.uv[0], c.uv[1], c.uv[2], c.uv[3],
        rgb[0] * c.dim, rgb[1] * c.dim, rgb[2] * c.dim, A, 0, c.flip,
      );
    }
    b.end();
  },
});

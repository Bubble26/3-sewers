import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { T } from '../core/tuning.js';
import { RNG } from '../core/rng.js';
import { registerScenario } from '../core/scenarios.js';
import { FACADE, PAVEMENT, AIR } from '../render/palette.js';
import {
  M, Builder, storeyTop, buildingTop, shadeLin, texTint, litOf, occlusion, lit3,
  rectUV, floorLum, tc, buildTenement,
} from './facade.js';
import { buildStorefront } from './storefronts.js';
import { EL, buildElevated } from './elevated.js';

/**
 * THE BACKDROP — the 2D half of "3D characters on a 2D stage" (DESIGN-BIBLE §17).
 *
 * The street is no longer a canyon you travel down. It is a SET: a shallow play plane
 * (T.stage.playDepth deep, T.stage.playWidth across) bounded by four bays of real tenement on
 * each side, and behind that nothing but flat CARDS standing at the five fixed depths in
 * T.stage.backdrop. Nobody stands behind a card. The play never enters one.
 *
 * A card is not a painted plane. It carries real shallow relief — sills, lintels, cornices,
 * fire escapes, awnings, lettered sign bands — because that relief is what catches the baked
 * 3:50pm light and is most of why the set reads hand-made instead of pasted on.
 *
 * ── how the tenement kit gets onto a card ────────────────────────────────────────────────
 * `src/world/facade.js` builds a facade in the x = const plane, running along z. A card needs
 * that same facade in the z = const plane, running along x. `RotBuilder` is a coordinate proxy
 * that yaws the whole kit 90° about Y on the way into the geometry buffers:
 *
 *      dest = ( ox - z_src , y , oz + x_src )
 *
 * so every line of tenement, storefront and signage code in the two kit modules is re-staged
 * rather than rewritten. Colour callbacks are handed *source* normals and *source* centres, so
 * each card is authored as one fully-sunlit north facade — a single, consistent light — and
 * then `relightCard()` re-grades the finished vertex colours in place for where the card
 * actually stands: how far it faces out of the sun, where the raking shadow of the near
 * buildings crosses it, and how much coal haze is in front of it.
 *
 * ── the composition ──────────────────────────────────────────────────────────────────────
 * From BATTING you see a band of shopfronts closing the street behind the pitcher, framed by
 * the wings, with nothing above the awnings to compete with the ball. From the wide FIELD
 * framing the near card drops to a one-storey taxpayer across the middle — the notch — and
 * over it the block recedes: mid tenements, far rooftops, the El, the skyline. Sun rakes down
 * from screen left, shade owns screen right, and the terminator crosses every card at the same
 * 36° so the whole set reads as one afternoon.
 */

const S = T.stage;
export const CARD_Z = S.backdrop;

// The five layers, near to far. `p` is T.stage.parallax; `ox` is the source-space origin that
// puts the card's lots where we want them in x while keeping every lot inside the fully-sunlit
// band of the baked light solution (source z < 39), so relightCard() starts from one value.
export const LAYERS = [
  { key: 'nearFacade', z: CARD_Z.nearFacade, p: S.parallax.nearFacade, ox: -40 },
  { key: 'midBlock', z: CARD_Z.midBlock, p: S.parallax.midBlock, ox: -80 },
  { key: 'farBlock', z: CARD_Z.farBlock, p: S.parallax.farBlock, ox: -150 },
  { key: 'elevated', z: CARD_Z.elevated, p: S.parallax.elevated, ox: 0 },
  { key: 'sky', z: CARD_Z.sky, p: S.parallax.sky, ox: 0 },
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ─── the rotation proxy ───────────────────────────────────────────────────────
// src px -> dst pz, src nx -> dst nz (the street-facing front becomes the camera-facing front).
const F_S2D = { px: 'pz', nx: 'nz', py: 'py', ny: 'ny', pz: 'nx', nz: 'px' };
const F_D2S = { pz: 'px', nz: 'nx', py: 'py', ny: 'ny', nx: 'pz', px: 'nz' };

class RotBuilder {
  constructor(dst, ox, oz) { this.dst = dst; this.ox = ox; this.oz = oz; }
  get count() { return this.dst.count; }
  P(p) { return [this.ox - p[2], p[1], this.oz + p[0]]; }
  N(n) { return [-n[2], n[1], n[0]]; }
  iP(p) { return [p[2] - this.oz, p[1], this.ox - p[0]]; }
  iN(n) { return [n[2], n[1], -n[0]]; }

  quad(a, b, c, d, cols, uvs, n) {
    this.dst.quad(this.P(a), this.P(b), this.P(c), this.P(d), cols, uvs, n ? this.N(n) : undefined);
  }

  box(x0, y0, z0, x1, y1, z1, col, faces = 'px nx py ny pz nz', uvScale = 8, uvRect = null) {
    const f = faces.split(' ').filter(Boolean).map((k) => F_S2D[k] || k).join(' ');
    let wrapped;
    if (typeof col === 'function') {
      wrapped = (k, n, c) => col(F_D2S[k] || k, this.iN(n), this.iP(c));
    } else {
      wrapped = (k, n, c) => { const s = this.iP(c); return lit3(col, this.iN(n), s[0], s[1], s[2]); };
    }
    this.dst.box(this.ox - z1, y0, this.oz + x0, this.ox - z0, y1, this.oz + x1,
      wrapped, f, uvScale, uvRect);
  }

  cyl(cx, cz, r, y0, y1, sides, colFn, caps = 'py') {
    this.dst.cyl(this.ox - cz, this.oz + cx, r, y0, y1, sides,
      (n, c) => colFn(this.iN(n), this.iP(c)), caps);
  }
}

// ─── the re-grade ─────────────────────────────────────────────────────────────
/** DESIGN-BIBLE §4.1's lit ramp, isolated so a finished vertex can be moved along it. */
function litRamp(l) {
  const t = clamp01(l / 0.74);
  const k = 0.95 + 0.47 * t;
  return [k * (1 + 0.19 * t), k * (1 + 0.02 * t), k * (1 - 0.30 * t)];
}
const BUILT = litRamp(0.74);                       // what every card is authored at
const SHADE = [0.95 * 0.945, 0.95 * 0.98, 0.95 * 1.075];   // the cool shade branch

function gradeFor(lit, occ) {
  const r = litRamp(lit);
  const w = clamp01(occ * 3.2);                    // ease into the cool branch at the terminator
  return [
    (r[0] * w + SHADE[0] * (1 - w)) / BUILT[0],
    (r[1] * w + SHADE[1] * (1 - w)) / BUILT[1],
    (r[2] * w + SHADE[2] * (1 - w)) / BUILT[2],
  ];
}

/** §2.3 — coal haze is a LIGHT. Distance lifts value and pulls chroma out, never darkens. */
function airK(c, z, gain) {
  const t = clamp01((z - 78) / 300) * gain;
  if (t <= 0.001) return c;
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const k = 1 + 0.17 * t;
  return [
    (c[0] + (Y * 1.05 - c[0]) * t * 0.62) * k,
    (c[1] + (Y * 1.00 - c[1]) * t * 0.62) * k,
    (c[2] + (Y * 0.92 - c[2]) * t * 0.62) * k,
  ];
}

/**
 * Move a finished card off the "fully sunlit facade" it was authored as and onto the light it
 * actually stands in: a front face turned `facing` out of the sun, crossed by the raking
 * shadow the near buildings throw, with haze in front of it.
 */
function relightCard(card, o = {}) {
  const facing = o.facing ?? 0.40;
  const shift = o.sunShift ?? 0;
  const shadeZ = o.shadeZ ?? card.z;
  const gain = o.haze ?? 1;
  for (const b of card.builders.values()) {
    const P = b.p, C = b.c;
    for (let i = 0; i < P.length; i += 3) {
      const occ = occlusion(P[i] + shift, P[i + 1], shadeZ);
      const g = gradeFor(facing * occ, occ);
      let c = [C[i] * g[0], C[i + 1] * g[1], C[i + 2] * g[2]];
      c = airK(c, P[i + 2], gain);
      if (c[0] + c[1] + c[2] < 2.4) c = floorLum(c);
      C[i] = c[0]; C[i + 1] = c[1]; C[i + 2] = c[2];
    }
  }
}

/** Haze only — for cards authored directly in world space (the El, the far masses). */
function hazeCard(card, gain) {
  for (const b of card.builders.values()) {
    const P = b.p, C = b.c;
    for (let i = 0; i < P.length; i += 3) {
      const c = airK([C[i], C[i + 1], C[i + 2]], P[i + 2], gain);
      C[i] = c[0]; C[i + 1] = c[1]; C[i + 2] = c[2];
    }
  }
}

// ─── a card ───────────────────────────────────────────────────────────────────
class Card {
  constructor(atlas, spec) {
    this.atlas = atlas;
    this.key = spec.key;
    this.z = spec.z;
    this.parallax = spec.p;
    this.ox = spec.ox;
    this.oz = spec.z - M.facadeX;
    this.builders = new Map();
    this.base = new THREE.Vector3(0, 0, 0);
    this._rot = new Map();
    /** world-space ctx (for masses authored where they stand) */
    this.ctx = { atlas, b: (k) => this.b(k) };
    /** card-space ctx: the facade kit, yawed onto the face of this card */
    this.rot = { atlas, b: (k) => this.rotB(k) };
  }
  b(k) {
    let x = this.builders.get(k);
    if (!x) { x = new Builder(`${this.key}:${k}`); this.builders.set(k, x); }
    return x;
  }
  rotB(k) {
    let r = this._rot.get(k);
    if (!r) { r = new RotBuilder(this.b(k), this.ox, this.oz); this._rot.set(k, r); }
    return r;
  }
  /** source z for a lot whose right-hand (screen-right) edge lands at dest x = xr */
  srcZ(xr) { return this.ox - (xr + M.lot); }
}

// ─── lots ─────────────────────────────────────────────────────────────────────
const BRICKS = { red: FACADE.brick, ochre: FACADE.ochre, brown: FACADE.brickSoot };
const SPRITES = ['win:sash', 'win:shade', 'win:open', 'win:cat', 'win:sash', 'win:lean',
  'win:pot', 'win:shade', 'win:sash', 'win:open', 'win:board', 'win:sash'];

/** A complete facade-kit lot, posed for a card: front to the camera, relief toward it. */
function cardLot(card, spec, r) {
  const ci = r.int(0, 2), si = r.int(0, 2), ii = r.int(0, 2);
  return {
    side: 1, xf: M.facadeX, out: -1, front: 'nx',
    z0: card.srcZ(spec.x), storeys: spec.st,
    brickName: spec.brick,
    brickKey: spec.brick === 'ochre' ? 'wallOchre' : spec.brick === 'brown' ? 'wallBrown' : 'wallRed',
    brickHex: BRICKS[spec.brick],
    ci, si, ii,
    corniceHex: FACADE.cornice[ci], sashHex: FACADE.sash[si], ironHex: FACADE.iron[ii],
    stoneHex: r.chance(0.5) ? 0x8a6a54 : 0x9a9184,
    lintelHex: r.chance(0.4) ? FACADE.cornice[ci] : (r.chance(0.5) ? 0x7d5a44 : 0x8a7f70),
    doorHex: [0x5a2a24, 0x2e4034, 0x3a2f28][r.int(0, 2)],
    bulkhead: [0x2e4034, 0x5a2a24, 0x332f2c][r.int(0, 2)],
    ground: spec.shop ? 'store' : 'stoop',
    shop: spec.shop || null,
    basement: null,
    fireEscape: !!spec.fe,
    stoopAt: 0.30 + r.range(0, 0.05),
    brackets: r.int(6, 9),
    grime: 0.88 + r.range(0, 0.16),
    chimneys: spec.st >= 3 ? [0.06, 0.94] : [],
    chimneyH: 2.4 + r.range(0, 2.6),
    pots: r.int(3, 6),
    tank: !!spec.tank, tankZ: r.range(-4, 4),
    coop: !!spec.coop,
    pigeons: !!spec.pigeons,
    ghost: null, bills: null, alley: false, roofsign: false,
    sprites: SPRITES.slice(r.int(0, 6)).concat(SPRITES),
    escapeProps: { level: r.int(0, 2), crate: r.int(0, 2) },
    exposedFrom: null,
    lod: 0,
  };
}

// ─── near facade card, z = 84 ─────────────────────────────────────────────────
// Tall on both flanks, a one-storey taxpayer across the middle. The low middle is the notch
// the whole rest of the set is seen through, and the tall flanks are what frames the plate.
const NEAR = [
  { x: 47, st: 5, brick: 'red', fe: 1, shop: 'tailor', tank: 1, pigeons: 1 },
  { x: 22, st: 4, brick: 'ochre', fe: 1, shop: 'deli' },
  { x: -3, st: 1, brick: 'red', shop: 'fivedime', sign: 1 },
  { x: -28, st: 1, brick: 'brown', shop: 'lunch' },
  { x: -53, st: 4, brick: 'brown', fe: 1, shop: 'laundry', tank: 1 },
  { x: -78, st: 5, brick: 'red', fe: 1, shop: 'shoe', coop: 1, pigeons: 1 },
];

function buildNearFacade(card) {
  const r = new RNG(19250922);
  for (const spec of NEAR) {
    const lot = cardLot(card, spec, r);
    buildTenement(card.rot, lot);
    if (lot.ground === 'store') buildStorefront(card.rot, lot);
    if (spec.sign) roofSign(card, lot, 1, 13.5, 6.4, 0.44);
    ghostOnFace(card, lot, spec.ghost, r);
  }
  plinth(card, -92, 86, 14, 34);
  apron(card, 84, CARD_Z.midBlock - 2, 92);
}

/**
 * A painted board on the parapet of a taxpayer — the one silhouette in the notch, and the
 * period's own way of using a low roof. Kept narrow so the vista past it stays open.
 */
function roofSign(card, lot, idx, w, h, at) {
  const B = card.rotB('sign'), Tb = card.rotB('trim');
  const slot = card.atlas.get(`roofsign:${idx}`);
  const top = buildingTop(lot.storeys);
  const cz = lot.z0 + M.lot * at;
  const x = lot.xf - 1.5;
  B.quad([x, top - 0.2, cz + w / 2], [x, top - 0.2, cz - w / 2],
    [x, top - 0.2 + h, cz - w / 2], [x, top - 0.2 + h, cz + w / 2],
    texTint(0.74), rectUV(slot), [-1, 0, 0]);
  for (const pz of [cz - w * 0.36, cz + w * 0.36]) {
    Tb.box(x, top - 2.4, pz - 0.16, x + 1.2, top - 0.2 + h * 0.94, pz + 0.16,
      () => shadeLin(0x4a4a44, 0.22), 'nx px pz nz');
  }
  Tb.box(x, top - 0.55, cz - w / 2, x + 1.1, top - 0.2, cz + w / 2,
    () => shadeLin(0x4a4a44, 0.3), 'nx py ny');
}

/** A wall dog's ad, worked straight onto the brick of the front elevation. */
function ghostOnFace(card, lot, key, r) {
  if (!key) return;
  const B = card.rotB('sign');
  const slot = card.atlas.get(`ghost:${key}`);
  const top = storeyTop(lot.storeys);
  const h = Math.min(top - 26, 26);
  if (h < 8) return;
  const w = Math.min(M.lot - 5, h * (slot.w / slot.h));
  const cz = lot.z0 + M.lot / 2;
  const y = top - 5 - h;
  const x = lot.xf - 0.22;
  B.quad([x, y, cz + w / 2], [x, y, cz - w / 2], [x, y + h, cz - w / 2], [x, y + h, cz + w / 2],
    texTint(0.74, 0.06), rectUV(slot), [-1, 0, 0]);
}

/** The card's own sidewalk: cards stand on nothing, so each one brings its ground with it. */
function plinth(card, xa, xb, front, back) {
  const B = card.rotB('trim');
  const za = card.ox - xb, zb = card.ox - xa;
  B.box(M.facadeX - front, 0, za, M.facadeX + back, 0.60, zb,
    (f, n, c) => shadeLin(PAVEMENT.sidewalk, f === 'py' ? 0.30 : 0.16, 0, f === 'py' ? 0.5 : 0), 'nx py');
  B.box(M.facadeX - front - 1.2, 0, za, M.facadeX - front, 0.62, zb,
    (f, n, c) => shadeLin(PAVEMENT.curb, f === 'py' ? 0.26 : 0.10, f === 'nx' ? 0.18 : 0), 'nx py');
}

/** Ground between two cards, out where src/world/surface.js does not pave. */
function apron(card, z0, z1, half) {
  const B = card.b('trim');
  const col = shadeLin(PAVEMENT.sidewalk, 0.24, 0.05, 0.35);
  for (const s of [-1, 1]) {
    const a = s * 30, b = s * half;
    B.quad([Math.min(a, b), 0.5, z0], [Math.max(a, b), 0.5, z0],
      [Math.max(a, b), 0.5, z1], [Math.min(a, b), 0.5, z1], col,
      [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
  }
}

// ─── mid block card, z = 130 ──────────────────────────────────────────────────
// The big mass of the composition: six full tenements with a street mouth cut through the
// middle, seen entirely above the near card's notch.
const MID = [
  { x: 24, st: 6, brick: 'red', fe: 1, tank: 1, ghost: 'castoria', shop: 'grocer', pigeons: 1 },
  { x: 49, st: 5, brick: 'brown', fe: 1 },
  { x: 74, st: 6, brick: 'ochre', fe: 1, tank: 1, ghost: 'goldDust' },
  { x: -55, st: 6, brick: 'brown', fe: 1, tank: 1, ghost: 'uneeda', shop: 'cigar' },
  { x: -80, st: 4, brick: 'red', fe: 1 },
  { x: -105, st: 6, brick: 'red', fe: 1, tank: 1, coop: 1, pigeons: 1 },
];

function buildMidBlock(card) {
  const r = new RNG(1925031);
  for (const spec of MID) {
    const lot = cardLot(card, spec, r);
    buildTenement(card.rot, lot);
    if (lot.ground === 'store') buildStorefront(card.rot, lot);
    ghostOnFace(card, lot, spec.ghost, r);
  }
  plinth(card, -132, 100, 12, 30);
  apron(card, 130, CARD_Z.farBlock - 2, 132);
}

// ─── far block card, z = 190, and the skyline card, z = 400 ───────────────────
/**
 * Distance is not the place for a facade kit. These are masses: a stepped roofline, painted
 * window rows, a cornice to say "not a housing block", tanks and pots against the sky.
 */
function massRow(card, o) {
  const Tb = card.b('trim'), Sb = card.b('sign'), A = card.atlas;
  const r = new RNG(o.seed);
  const uv = rectUV(A.get('farwall'));
  const runs = o.gap ? [[o.x0, o.gap[0]], [o.gap[1], o.x1]] : [[o.x0, o.x1]];
  let i = 0;
  for (const [a, b] of runs) {
    let x = a;
    while (x < b - 6) {
      const w = Math.min(o.wMin + r.range(0, o.wSpan), b - x);
      const h = o.hMin + r.range(0, o.hSpan) + o.crest * Math.max(0, 1 - Math.abs(x + w / 2) / o.crestW);
      const hex = r.chance(0.34) ? FACADE.ochre : r.chance(0.5) ? FACADE.brickSoot : FACADE.brick;
      const z = o.z + r.range(0, o.jitter || 0);
      Tb.box(x + 0.7, 0, z, x + w - 0.7, h, z + o.depth,
        (f, n, c) => shadeLin(hex, litOf(n, c[0], c[1], c[2]) * 0.94, f === 'ny' ? 0.4 : 0), 'nz px nx py');
      // painted window rows — at this distance a window is a rectangle of value, nothing more
      const rows = Math.max(1, Math.round(h / 42));
      for (let k = 0; k < rows; k++) {
        const y0 = 1.5 + (k / rows) * (h - 3), y1 = 1.5 + ((k + 1) / rows) * (h - 3);
        Sb.quad([x + w - 1.4, y0, z - 0.12], [x + 1.4, y0, z - 0.12],
          [x + 1.4, y1, z - 0.12], [x + w - 1.4, y1, z - 0.12],
          texTint(0.30 * clamp01((y0 - o.shadeTo) / 22 + 0.2), 0.05), uv, [0, 0, -1]);
      }
      // cornice
      Tb.box(x, h, z - 1.9, x + w, h + 2.1, z + 1.4,
        (f, n, c) => shadeLin(r.chance(0.5) ? 0x4c4a3c : 0x5b3b33, litOf(n, c[0], c[1], c[2]) * 0.9,
          f === 'ny' ? 0.5 : 0), 'nz py ny px nx');
      // a chimney stack, and on the taller ones a tank on stilts
      if (r.chance(0.72)) {
        const cx = x + w * r.range(0.2, 0.8);
        Tb.box(cx - 1.5, h + 2.1, z + 5, cx + 1.5, h + 2.1 + r.range(4, 9), z + 8,
          (f, n, c) => shadeLin(FACADE.brickSoot, litOf(n, c[0], c[1], c[2]), 0), 'nz px nx py');
      }
      if (h > o.hMin + o.hSpan * 0.55 && i % 3 === 1) {
        const tx = x + w * 0.5, tz = z + 13;
        for (const dx of [-4, 4]) {
          Tb.box(tx + dx - 0.34, h, tz - 0.34, tx + dx + 0.34, h + 12, tz + 0.34,
            () => shadeLin(0x5a4a3c, 0.18), 'nz px nx');
        }
        Tb.cyl(tx, tz, 5.2, h + 12, h + 21.5, 12,
          (n, c) => shadeLin(0x8e8579, litOf(n, c[0], c[1], c[2]) * 0.9), '');
        Tb.cyl(tx, tz, 5.4, h + 21, h + 22.2, 12, (n) => shadeLin(0x4a4038, 0.16), '');
        Tb.box(tx - 0.4, h + 22.2, tz - 0.4, tx + 0.4, h + 25.5, tz + 0.4, () => shadeLin(0x4a4038, 0.2), 'nz px nx py');
      }
      if (o.ghosts && i === o.ghosts.at) {
        const slot = A.get(`ghost:${o.ghosts.key}`);
        const gh = Math.min(h * 0.5, 30), gw = Math.min(w - 5, gh * (slot.w / slot.h));
        const gx = x + w * 0.5;
        Sb.quad([gx + gw / 2, h - 5 - gh, z - 0.28], [gx - gw / 2, h - 5 - gh, z - 0.28],
          [gx - gw / 2, h - 5, z - 0.28], [gx + gw / 2, h - 5, z - 0.28],
          texTint(0.34, 0.05), rectUV(slot), [0, 0, -1]);
      }
      x += w; i++;
    }
  }
}

function buildFarBlock(card) {
  massRow(card, {
    z: card.z, x0: -156, x1: 156, gap: [-36, 30], seed: 4177,
    wMin: 17, wSpan: 15, hMin: 30, hSpan: 20, crest: 13, crestW: 120,
    depth: 34, jitter: 7, shadeTo: 34, ghosts: { at: 2, key: 'uneeda' },
  });
  apron(card, 190, CARD_Z.elevated - 4, 156);
  hazeCard(card, 1.0);
}

/**
 * The skyline card. From a tenement cross street in 1925 you do not see a skyline — you see
 * the El. So this is barely there: three or four lofts and a stack, so pale they read as a
 * change in the haze rather than as buildings, and only above the El's deck.
 */
function buildSky(card) {
  const Tb = card.b('trim');
  const r = new RNG(90125);
  const towers = [
    [-215, 74, 96], [-150, 58, 118], [-96, 46, 84], [-38, 66, 132],
    [26, 52, 104], [82, 88, 148], [166, 62, 92], [232, 70, 110],
  ];
  for (const [x, w, h] of towers) {
    const hex = r.chance(0.5) ? FACADE.partyWall : FACADE.ochreShade;
    Tb.box(x, 0, card.z, x + w, h, card.z + 40,
      (f, n, c) => shadeLin(hex, litOf(n, c[0], c[1], c[2]) * 0.8, 0), 'nz px nx py');
    Tb.box(x - 1.6, h, card.z - 2, x + w + 1.6, h + 3.2, card.z + 2,
      (f, n, c) => shadeLin(hex, litOf(n, c[0], c[1], c[2]) * 0.7, f === 'ny' ? 0.3 : 0), 'nz py ny px nx');
    if (r.chance(0.5)) {
      const sx = x + w * r.range(0.25, 0.75);
      Tb.cyl(sx, card.z + 12, 3.4, h, h + r.range(16, 34), 10,
        (n, c) => shadeLin(0x6b5a4c, litOf(n, c[0], c[1], c[2]) * 0.7), '');
    }
  }
  hazeCard(card, 1.35);
}

// ─── build ────────────────────────────────────────────────────────────────────
/**
 * Build every card. Returns layer descriptors; the caller (src/world/street.js) owns the
 * materials and turns each layer's builders into one group of merged meshes.
 */
export function buildBackdrop(atlas) {
  const layers = [];
  for (const spec of LAYERS) {
    const card = new Card(atlas, spec);
    if (spec.key === 'nearFacade') {
      buildNearFacade(card);
      relightCard(card, { facing: 0.435, sunShift: 26, haze: 0.55 });
    } else if (spec.key === 'midBlock') {
      buildMidBlock(card);
      relightCard(card, { facing: 0.40, sunShift: 8, haze: 0.9 });
    } else if (spec.key === 'farBlock') {
      buildFarBlock(card);
    } else if (spec.key === 'elevated') {
      buildElevated(card.ctx);
      card.base.z = spec.z - (EL.nearCol + EL.farCol) / 2;
      hazeCard(card, 0.85);
    } else {
      buildSky(card);
    }
    layers.push(card);
  }
  return layers;
}

// ─── the system: the cards parallax on a cut, and nothing else moves ──────────
/**
 * §17.2 "cards may parallax when the camera cuts". A card at depth d already parallaxes by
 * 1/d for free; T.stage.parallax asks for a different rate, so each card slides with the
 * camera by exactly the difference. p = 0 (the sky) therefore locks to the camera entirely —
 * infinitely far — and p = 0.55 (the near facade) is left at its true perspective.
 */
export default registerSystem({
  name: 'backdrop',
  order: 12,

  init(app) {
    const street = app.get('street');
    this.layers = (street && street.layers) || [];
    this.ref = LAYERS[0];
  },

  lateUpdate(dt, app) {
    if (!this.layers || !this.layers.length) return;
    const cam = app.camera;
    const cz = cam.position.z, cx = cam.position.x;
    const d0 = this.ref.z - cz;
    if (d0 < 20) return;
    const norm = this.ref.p * d0;
    for (const L of this.layers) {
      if (!L.group) continue;
      const d = L.z - cz;
      const w = d > 0 ? (L.parallax * d) / norm : 1;
      L.group.position.x = L.base.x + cx * (1 - w);
      L.group.position.z = L.base.z;
      L.group.position.y = L.base.y;
    }
  },
});

// ─── scenarios ────────────────────────────────────────────────────────────────
const setCam = (app, pos, look, fov) => {
  app.camera.position.set(pos[0], pos[1], pos[2]);
  app.camera.lookAt(look[0], look[1], look[2]);
  app.camera.fov = fov;
  app.camera.updateProjectionMatrix();
};

/** The whole set from the front: play plane, wings, five cards, the El closing the far end. */
registerScenario('stage_wide', {
  seed: 1925,
  setup: ({ app }) => {
    app.sim.reset(1925);
    setCam(app, [0, 16.5, -60], [0, 15.6, 70], S.lens.fov);
  },
  settle: 0.4,
});

/** The same set from the wings, so a critic can count the cards and see they are cards. */
registerScenario('backdrop_layers', {
  seed: 1925,
  setup: ({ app }) => {
    app.sim.reset(1925);
    setCam(app, [176, 96, -52], [-6, 26, 168], 26);
  },
  settle: 0.4,
});

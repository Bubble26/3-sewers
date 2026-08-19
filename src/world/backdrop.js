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
const SHADE = [0.95 * 0.905, 0.95 * 0.955, 0.95 * 1.10];   // the cool shade branch

function gradeFor(lit, occ, bite) {
  const r = litRamp(lit);
  const w = clamp01(occ * 3.2);                    // ease into the cool branch at the terminator
  const s = 1 - bite * (1 - w);
  return [
    (r[0] * w + SHADE[0] * (1 - w)) / BUILT[0] * s,
    (r[1] * w + SHADE[1] * (1 - w)) / BUILT[1] * s,
    (r[2] * w + SHADE[2] * (1 - w)) / BUILT[2] * s,
  ];
}

/**
 * §2.3 — coal haze is a LIGHT. Distance lifts value and pulls chroma out, never darkens.
 *
 * Hand-set per card rather than derived from z, because the layers have to separate by a
 * readable step and the real 1/d falloff between 84 and 130 units is about two per cent. A
 * small term for the card's own depth keeps its roof furniture behind its face.
 */
function airK(c, z, base, cardZ) {
  const t = clamp01(base + clamp01((z - cardZ) / 70) * 0.045);
  if (t <= 0.001) return c;
  const Y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const k = 1 + 0.26 * t;
  return [
    (c[0] + (Y * 1.06 - c[0]) * t * 0.80) * k,
    (c[1] + (Y * 1.00 - c[1]) * t * 0.80) * k,
    (c[2] + (Y * 0.90 - c[2]) * t * 0.80) * k,
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
  const gain = o.air ?? 0.1;
  const bite = o.bite ?? 0.10;
  for (const b of card.builders.values()) {
    const P = b.p, C = b.c;
    for (let i = 0; i < P.length; i += 3) {
      const occ = occlusion(P[i] + shift, P[i + 1], shadeZ);
      const g = gradeFor(facing * occ, occ, bite);
      let c = [C[i] * g[0], C[i + 1] * g[1], C[i + 2] * g[2]];
      c = airK(c, P[i + 2], gain, card.z);
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
      const c = airK([C[i], C[i + 1], C[i + 2]], P[i + 2], gain, card.z);
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

/** A flat panel on a card's face, wound so it is never the back of a quad. */
function faceQuad(B, x, y0, y1, z0, z1, col, uv) {
  B.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], col, uv, [-1, 0, 0]);
}

// ─── near facade card, z = 84 ─────────────────────────────────────────────────
/**
 * The card the whole game is played against. Tall on both flanks so it frames the plate;
 * across the middle it drops to a one-storey taxpayer — the NOTCH — which is the only reason
 * the block behind it, the El and the sky are ever visible at all.
 *
 * Dead centre, on the axis the ball travels, is the quiet bay: no lettering, no glass, no
 * awning. Everywhere else on this card is loud, because a sign painter in 1925 covered every
 * square foot he was paid for; the one place he was not paid for is directly behind the
 * pitcher, and that is not a coincidence.
 */
const NEAR = [
  { x: 41, st: 5, brick: 'red', fe: 1, shop: 'tailor', tank: 1, pigeons: 1 },
  { x: 16, st: 4, brick: 'ochre', fe: 1, shop: 'ice' },
  { x: -9, st: 1, brick: 'red', bay: 1, roof: 'pots' },              // the quiet bay
  { x: -34, st: 1, brick: 'brown', shop: 'lunch', roof: 'sign' },
  { x: -59, st: 4, brick: 'brown', blind: 'uneeda', shop: 'laundry', tank: 1, coop: 1 },
];

function buildNearFacade(card) {
  const r = new RNG(19250922);
  for (const spec of NEAR) {
    const lot = cardLot(card, spec, r);
    if (spec.bay) lot.ground = 'store';                 // wallGrid starts at the water table
    if (spec.blind) lot.sprites = SPRITES.slice(0, 4);
    buildTenement(card.rot, lot);
    if (spec.bay) wagonBay(card, lot, r);
    else if (lot.ground === 'store') buildStorefront(card.rot, lot);
    if (spec.blind) blindWall(card, lot, spec.blind);
    if (spec.roof === 'sign') roofSign(card, lot, 1, 10.5, 4.4, 0.42);
    if (spec.roof === 'pots') parapetPots(card, lot, r);
  }
  plinth(card, -76, 78, 13, 34);
  curbDressing(card, r);
  apron(card, 84, CARD_Z.midBlock - 2, 92);
}

/** The brick multiplier facade.js's wallGrid would have used, for infill we author ourselves. */
function brickK(lot, y) {
  let k = 1.42;
  const top = storeyTop(lot.storeys);
  const s = clamp01((y - M.ground * 0.6) / Math.max(1, top - M.ground * 0.6));
  k *= 1 - 0.42 * s * s;
  k *= lot.grime;
  return [k * 1.085, k, k * 0.85];
}

/**
 * The quiet bay: a horse-and-wagon entrance in a blind brick wall, closed for the afternoon.
 * A segmental arch in stepped brick, two tongue-and-groove doors with strap hinges, a painted
 * board, a house number, and one bill posted on a door that says POST NO BILLS.
 */
function wagonBay(card, lot, r) {
  const W = card.rotB(lot.brickKey), Tb = card.rotB('trim'), Sb = card.rotB('sign');
  const A = card.atlas;
  const xf = lot.xf, z0 = lot.z0, z1 = z0 + M.lot;
  const cz = (z0 + z1) / 2;
  const half = 6.2, head = 11.0, spring = 8.6;
  const wall = (f, n, c) => brickK(lot, c[1]);

  // blind brick either side of the opening, and the spandrel over the arch
  W.box(xf, 0, z0, xf + 0.9, M.ground, cz - half, wall, 'nx', 8);
  W.box(xf, 0, cz + half, xf + 0.9, M.ground, z1, wall, 'nx', 8);
  W.box(xf, head + 1.4, cz - half, xf + 0.9, M.ground, cz + half, wall, 'nx', 8);

  // the opening: recessed, brown, never black (Law 2)
  const deep = 3.6;
  Tb.box(xf, 0, cz - half, xf + deep, head, cz + half,
    (f, n, c) => shadeLin(FACADE.brickShade, 0, 0.30), 'pz nz py ny', 8);
  Tb.box(xf + deep - 0.2, 0, cz - half, xf + deep, head, cz + half,
    () => shadeLin(0x6b4235, 0.10, 0.26), 'nx');
  // the two doors, standing closed, one of them hung a little low
  for (const [a, b, drop] of [[cz - half + 0.25, cz - 0.12, 0], [cz + 0.12, cz + half - 0.25, 0.18]]) {
    Tb.box(xf - 0.42, 0, a, xf - 0.18, spring + 0.4 - drop, b,
      (f, n, c) => shadeLin(lot.doorHex, litOf(n, c[0], c[1], c[2]) * 0.62, f === 'nx' ? 0 : 0.3), 'nx py pz nz');
    for (const hy of [1.2, spring - 1.1]) {
      Tb.box(xf - 0.52, hy - 0.16, a + 0.1, xf - 0.4, hy + 0.16, a + 2.6,
        (f, n, c) => shadeLin(lot.ironHex, litOf(n, c[0], c[1], c[2]) * 0.5, 0.12), 'nx py ny');
    }
  }
  // segmental arch head in stepped brick
  for (let i = 0; i < 11; i++) {
    const t = (i + 0.5) / 11;
    const a = (t - 0.5) * Math.PI * 0.92;
    const zz = cz + Math.sin(a) * half * 1.02;
    const yy = spring + Math.cos(a) * (head - spring) * 1.4;
    Tb.box(xf - 0.62, yy - 0.12, zz - 0.74, xf + 0.05, Math.min(yy + 1.6, head + 1.4), zz + 0.74,
      (f, n, c) => shadeLin(lot.stoneHex, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.42 : 0), 'nx py ny pz nz');
  }
  // a painted board over the arch, and the house number on the pier
  const board = A.get('band:ice');
  faceQuad(Sb, xf - 0.7, head + 1.7, head + 4.0, cz - 8.6, cz + 8.6, texTint(0.74), rectUV(board));
  Tb.box(xf - 0.75, head + 1.5, cz - 8.8, xf - 0.6, head + 4.2, cz + 8.8,
    () => shadeLin(0x332f2c, 0.12, 0.12), 'nx py ny pz nz');
  faceQuad(Sb, xf - 0.5, 8.4, 9.4, z0 + 0.8, z0 + 2.8, texTint(0.74), rectUV(A.get('numbers')));
  // one bill, pasted on the door that asks you not to
  faceQuad(Sb, xf - 0.46, 5.2, 5.9, cz + 0.7, cz + 3.6, texTint(0.74, 0.05), rectUV(A.get('postnobills')));
  // a gooseneck lamp over the arch
  Tb.box(xf - 0.4, head + 5.2, cz - 0.14, xf - 0.1, head + 5.5, cz + 0.14, () => shadeLin(0x3f3a36, 0.2), 'nx py pz nz');
  Tb.cyl(xf - 1.5, cz, 0.8, head + 4.5, head + 5.2, 8, (n, c) => shadeLin(0x4a4a44, litOf(n, c[0], c[1], c[2]) * 0.7), 'py');
}

/**
 * A blind end wall: the neighbour was pulled down years ago and a wall dog got there the week
 * after. The one big quiet field of colour on the card, and the eye's resting place.
 */
function blindWall(card, lot, key) {
  const W = card.rotB('wallStone'), Sb = card.rotB('sign');
  const A = card.atlas;
  const xf = lot.xf, z0 = lot.z0, z1 = z0 + M.lot;
  const y0 = M.ground + 1.2, y1 = storeyTop(lot.storeys) + 0.4;
  W.box(xf - 0.16, y0, z0 + 0.4, xf, y1, z1 - 0.4, () => [1.30, 1.31, 1.30], 'nx', 8);
  const slot = A.get(`ghost:${key}`);
  const h = Math.min(y1 - y0 - 3.5, 28);
  const w = Math.min(z1 - z0 - 4, h * (slot.w / slot.h));
  const cz = (z0 + z1) / 2, ay = y1 - 3 - h;
  faceQuad(Sb, xf - 0.24, ay, ay + h, cz - w / 2, cz + w / 2, texTint(0.74), rectUV(slot));
}

/**
 * A painted board on the parapet of a taxpayer — the period's own use for a low roof, and the
 * one silhouette event in the notch. Narrow, so the vista past it stays open.
 */
function roofSign(card, lot, idx, w, h, at) {
  const B = card.rotB('sign'), Tb = card.rotB('trim');
  const slot = card.atlas.get(`roofsign:${idx}`);
  const top = buildingTop(lot.storeys);
  const cz = lot.z0 + M.lot * at;
  const x = lot.xf - 1.4;
  faceQuad(B, x, top - 0.2, top - 0.2 + h, cz - w / 2, cz + w / 2, texTint(0.74), rectUV(slot));
  for (const pz of [cz - w * 0.34, cz + w * 0.34]) {
    Tb.box(x, top - 2.6, pz - 0.17, x + 1.4, top - 0.2 + h * 0.92, pz + 0.17,
      () => shadeLin(0x4a4a44, 0.24), 'nx px pz nz');
  }
  Tb.box(x - 0.1, top - 0.55, cz - w / 2 - 0.3, x + 1.0, top - 0.2, cz + w / 2 + 0.3,
    () => shadeLin(0x4a4a44, 0.32), 'nx py ny');
}

/** Chimney pots and a flagpole on a low parapet: cheap silhouette, and it breaks the band. */
function parapetPots(card, lot, r) {
  const Tb = card.rotB('trim');
  const top = buildingTop(lot.storeys);
  const z0 = lot.z0;
  const stack = z0 + M.lot * 0.16;
  Tb.box(lot.xf + 1.0, top - 3.2, stack - 1.7, lot.xf + 4.4, top + 3.0, stack + 1.7,
    (f, n, c) => shadeLin(FACADE.brickSoot, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.4 : 0), 'nx px pz nz py');
  for (let i = 0; i < 4; i++) {
    const px = lot.xf + 1.7 + (i % 2) * 1.7;
    const pz = stack - 0.9 + Math.floor(i / 2) * 1.5;
    Tb.cyl(px, pz, 0.46, top + 3.0, top + 4.7 + (i % 3) * 0.5, 7,
      (n, c) => shadeLin(0xb8724a, litOf(n, c[0], c[1], c[2])));
  }
  // a flagpole, because somebody put one up in 1918 and nobody has taken it down
  const fz = z0 + M.lot * 0.84;
  Tb.box(lot.xf - 0.6, top - 1.2, fz - 0.13, lot.xf - 0.34, top + 12.5, fz + 0.13,
    () => shadeLin(0x8e8579, 0.5), 'nx px pz nz');
  Tb.cyl(lot.xf - 0.47, fz, 0.34, top + 12.5, top + 13.1, 7, (n, c) => shadeLin(0xb8924a, litOf(n, c[0], c[1], c[2])));
}

/** The card's own sidewalk: cards stand on nothing, so each one brings its ground with it. */
function plinth(card, xa, xb, front, back) {
  const B = card.rotB('trim');
  const za = card.ox - xb, zb = card.ox - xa;
  B.box(M.facadeX - front, 0, za, M.facadeX + back, 0.60, zb,
    (f, n, c) => shadeLin(PAVEMENT.sidewalk, f === 'py' ? 0.32 : 0.16, 0, f === 'py' ? 0.55 : 0), 'nx py');
  B.box(M.facadeX - front - 1.3, 0, za, M.facadeX - front, 0.62, zb,
    (f, n, c) => shadeLin(PAVEMENT.curb, f === 'py' ? 0.26 : 0.10, f === 'nx' ? 0.16 : 0), 'nx py');
}

/**
 * What is standing on that sidewalk. Read at 120ft these are silhouettes and nothing else, so
 * they are barrels, crates, cans and one lamp standard — the four shapes a 1925 kerb had.
 */
function curbDressing(card, r) {
  const Tb = card.rotB('trim');
  const y = 0.60;
  const items = [
    [37, 'cans'], [28, 'lamp'], [21, 'crates'], [13, 'barrel'], [5, 'stack'],
    [-4, 'crates'], [-13, 'cans'], [-21, 'stack'], [-30, 'lamp'], [-40, 'barrel'],
    [-49, 'crates'], [-62, 'cans'],
  ];
  for (const [dx, kind] of items) {
    const z = card.ox - dx;               // source z for this dest x
    const x = M.facadeX - 6.5 - r.range(0, 2.2);
    if (kind === 'lamp') {
      Tb.box(x - 0.55, y, z - 0.55, x + 0.55, y + 0.8, z + 0.55, () => shadeLin(0x2e4034, 0.24, 0.1), 'nx px py pz nz');
      Tb.cyl(x, z, 0.34, y + 0.8, y + 12.4, 8, (n, c) => shadeLin(0x2e4034, litOf(n, c[0], c[1], c[2]) * 0.7, 0.06));
      Tb.cyl(x, z, 0.62, y + 12.4, y + 13.0, 8, (n, c) => shadeLin(0x2e4034, litOf(n, c[0], c[1], c[2]) * 0.7));
      Tb.box(x - 0.85, y + 13.0, z - 0.85, x + 0.85, y + 15.2, z + 0.85,
        (f, n, c) => shadeLin(0xd8cfb8, litOf(n, c[0], c[1], c[2]) * 0.9, 0), 'nx px py pz nz');
      Tb.box(x - 0.5, y + 15.2, z - 0.5, x + 0.5, y + 16.0, z + 0.5, () => shadeLin(0x2e4034, 0.2), 'nx px py pz nz');
    } else if (kind === 'cans') {
      for (let i = 0; i < 2 + r.int(0, 1); i++) {
        const cz = z - 1.6 + i * 2.3, cx = x + r.range(-0.6, 0.6);
        Tb.cyl(cx, cz, 1.02, y, y + 2.7, 10, (n, c) => shadeLin(0x8e877a, litOf(n, c[0], c[1], c[2]) * 0.8, 0.06));
        Tb.cyl(cx, cz, 1.1, y + 2.7, y + 3.0, 10, (n, c) => shadeLin(0x6e675c, litOf(n, c[0], c[1], c[2]) * 0.9));
      }
    } else if (kind === 'crates') {
      for (let i = 0; i < 4; i++) {
        const cz = z - 2.4 + (i % 2) * 3.4, cy = y + Math.floor(i / 2) * 2.15;
        const cx = x + r.range(-0.5, 0.5);
        Tb.box(cx - 1.6, cy, cz - 1.6, cx + 1.6, cy + 2.1, cz + 1.6,
          (f, n, c) => shadeLin(0x8a6a44, litOf(n, c[0], c[1], c[2]) * 0.92, f === 'ny' ? 0.4 : 0), 'nx px py pz nz');
        Tb.box(cx - 1.7, cy + 0.85, cz - 1.65, cx + 1.7, cy + 1.2, cz + 1.65,
          (f, n, c) => shadeLin(0x6b4235, litOf(n, c[0], c[1], c[2]) * 0.7, 0.14), 'nx px py');
      }
    } else if (kind === 'stack') {
      // sacks of coal, or of anything: the shape a 1925 sidewalk was actually cluttered with
      for (let i = 0; i < 5; i++) {
        const cx = x + r.range(-0.9, 0.9), cz = z - 2.6 + i * 1.35;
        const hh = 1.5 + r.range(0, 0.5), lift = i === 2 || i === 3 ? 1.5 : 0;
        Tb.box(cx - 1.25, y + lift, cz - 0.72, cx + 1.25, y + lift + hh, cz + 0.72,
          (f, n, c) => shadeLin(0x6e675c, litOf(n, c[0], c[1], c[2]) * 0.8, f === 'ny' ? 0.35 : 0.05), 'nx px py pz nz');
      }
    } else {
      Tb.cyl(x, z, 1.35, y, y + 3.4, 10, (n, c) => shadeLin(0x7a6244, litOf(n, c[0], c[1], c[2]) * 0.85, 0.05));
      Tb.cyl(x, z, 1.42, y + 1.5, y + 1.8, 10, (n, c) => shadeLin(0x4a4038, litOf(n, c[0], c[1], c[2]) * 0.6));
      Tb.cyl(x, z, 1.4, y + 3.4, y + 3.55, 10, (n, c) => shadeLin(0x5a4e46, litOf(n, c[0], c[1], c[2]) * 0.7));
    }
  }
}

/** Ground between two cards, out where src/world/surface.js does not pave. */
function apron(card, z0, z1, half) {
  const B = card.b('trim');
  const col = shadeLin(PAVEMENT.sidewalk, 0.22, 0.06, 0.3);
  for (const s of [-1, 1]) {
    const a = s * 30, b = s * half;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    B.quad([lo, 0.58, z1], [hi, 0.58, z1], [hi, 0.58, z0], [lo, 0.58, z0], col,
      [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
  }
}

// ─── mid block card, z = 130 ──────────────────────────────────────────────────
/**
 * The block behind the block: six full tenements, split by a street mouth whose edges are set
 * INBOARD of the notch's, so each one is visible past the card in front of it. That inward
 * step is the whole trick of a stage set — it buys depth the lens is not allowed to.
 */
const MID = [
  { x: 8, st: 5, brick: 'red', fe: 1, pigeons: 1 },
  { x: 33, st: 4, brick: 'brown', fe: 1, tank: 1 },
  { x: 58, st: 5, brick: 'ochre', fe: 1, tank: 1 },
  { x: 83, st: 4, brick: 'red', fe: 1, coop: 1 },
  { x: -61, st: 5, brick: 'brown', fe: 1, coop: 1, pigeons: 1 },
  { x: -86, st: 4, brick: 'red', fe: 1, tank: 1 },
  { x: -111, st: 5, brick: 'ochre', fe: 1, tank: 1 },
];

function buildMidBlock(card) {
  const r = new RNG(1925031);
  for (const spec of MID) {
    const lot = cardLot(card, spec, r);
    buildTenement(card.rot, lot);
  }
  plinth(card, -134, 116, 11, 28);
  apron(card, 130, CARD_Z.farBlock - 2, 134);
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
      const h = o.hMin + r.range(0, o.hSpan) + o.crest * clamp01((Math.abs(x + w / 2) - o.crestIn) / o.crestW);
      const hex = r.chance(0.34) ? FACADE.ochre : r.chance(0.5) ? FACADE.brickSoot : FACADE.brick;
      const z = o.z + r.range(0, o.jitter || 0);
      Tb.box(x + 0.7, 0, z, x + w - 0.7, h, z + o.depth,
        (f, n, c) => shadeLin(hex, litOf(n, c[0], c[1], c[2]) * 0.94, f === 'ny' ? 0.4 : 0), 'nz px nx py');
      // painted window rows — at this distance a window is a rectangle of value, nothing more
      const rows = Math.max(1, Math.round(h / 40));
      for (let k = 0; k < rows; k++) {
        const y0 = 2 + (k / rows) * (h - 4), y1 = 2 + ((k + 1) / rows) * (h - 4);
        Sb.quad([x + w - 1.5, y0, z - 0.12], [x + 1.5, y0, z - 0.12],
          [x + 1.5, y1, z - 0.12], [x + w - 1.5, y1, z - 0.12],
          texTint(0.34 * clamp01((y0 - o.shadeTo) / 24 + 0.25), 0.05), uv, [0, 0, -1]);
      }
      Tb.box(x, h, z - 2.0, x + w, h + 2.2, z + 1.4,
        (f, n, c) => shadeLin(r.chance(0.5) ? 0x4c4a3c : 0x5b3b33, litOf(n, c[0], c[1], c[2]) * 0.9,
          f === 'ny' ? 0.5 : 0), 'nz py ny px nx');
      if (r.chance(0.7)) {
        const cx = x + w * r.range(0.2, 0.8);
        Tb.box(cx - 1.5, h + 2.2, z + 5, cx + 1.5, h + 2.2 + r.range(4, 9), z + 8,
          (f, n, c) => shadeLin(FACADE.brickSoot, litOf(n, c[0], c[1], c[2]), 0), 'nz px nx py');
      }
      if (i % 2 === 1) {
        const tx = x + w * 0.5, tz = z + 13;
        for (const dx of [-4, 4]) {
          Tb.box(tx + dx - 0.34, h, tz - 0.34, tx + dx + 0.34, h + 11, tz + 0.34,
            () => shadeLin(0x5a4a3c, 0.18), 'nz px nx');
        }
        Tb.cyl(tx, tz, 5.0, h + 11, h + 20, 12,
          (n, c) => shadeLin(0x8e8579, litOf(n, c[0], c[1], c[2]) * 0.9), '');
        Tb.cyl(tx, tz, 5.2, h + 19.5, h + 20.7, 12, () => shadeLin(0x4a4038, 0.16), '');
        Tb.box(tx - 0.4, h + 20.7, tz - 0.4, tx + 0.4, h + 24, tz + 0.4, () => shadeLin(0x4a4038, 0.2), 'nz px nx py');
      }
      if (o.ghosts && i === o.ghosts.at) {
        const slot = A.get(`ghost:${o.ghosts.key}`);
        const gh = Math.min(h * 0.46, 26), gw = Math.min(w - 5, gh * (slot.w / slot.h));
        const gx = x + w * 0.5;
        Sb.quad([gx + gw / 2, h - 6 - gh, z - 0.28], [gx - gw / 2, h - 6 - gh, z - 0.28],
          [gx - gw / 2, h - 6, z - 0.28], [gx + gw / 2, h - 6, z - 0.28],
          texTint(0.42, 0.05), rectUV(slot), [0, 0, -1]);
      }
      x += w; i++;
    }
  }
}

function buildFarBlock(card) {
  massRow(card, {
    z: card.z, x0: -170, x1: 170, gap: [-39, 5], seed: 4177,
    wMin: 14, wSpan: 13, hMin: 24, hSpan: 17, crest: 15, crestIn: 40, crestW: 100,
    depth: 32, jitter: 6, shadeTo: 30, ghosts: { at: 4, key: 'goldDust' },
  });
  apron(card, 190, CARD_Z.elevated - 4, 170);
  hazeCard(card, 0.42);
}

/**
 * The skyline card. From a tenement cross street in 1925 you do not see a skyline — you see
 * the El. So this is barely there: a few lofts and two stacks, pale enough to read as a change
 * in the haze rather than as buildings, and only ever above the El's deck.
 */
function buildSky(card) {
  const Tb = card.b('trim');
  const r = new RNG(90125);
  const towers = [
    [-236, 78, 54], [-158, 62, 76], [-92, 50, 48], [-34, 70, 84],
    [40, 56, 60], [102, 84, 88], [200, 66, 52], [272, 74, 68],
  ];
  for (const [x, w, h] of towers) {
    const hex = r.chance(0.5) ? FACADE.partyWall : FACADE.ochreShade;
    Tb.box(x, 0, card.z, x + w, h, card.z + 40,
      (f, n, c) => shadeLin(hex, litOf(n, c[0], c[1], c[2]) * 0.8, 0), 'nz px nx py');
    Tb.box(x - 1.8, h, card.z - 2, x + w + 1.8, h + 3.4, card.z + 2,
      (f, n, c) => shadeLin(hex, litOf(n, c[0], c[1], c[2]) * 0.68, f === 'ny' ? 0.3 : 0), 'nz py ny px nx');
    if (r.chance(0.4)) {
      const sx = x + w * r.range(0.25, 0.75);
      Tb.cyl(sx, card.z + 12, 2.9, h, h + r.range(14, 26), 10,
        (n, c) => shadeLin(0x8a6a54, litOf(n, c[0], c[1], c[2]) * 0.6), '');
    }
  }
  // a steeple, because a skyline of boxes is a skyline nobody drew
  const sx = -6, sy = 74;
  Tb.box(sx - 7, 0, card.z + 4, sx + 7, sy, card.z + 22,
    (f, n, c) => shadeLin(FACADE.partyWall, litOf(n, c[0], c[1], c[2]) * 0.8, 0), 'nz px nx py');
  Tb.box(sx - 8.5, sy, card.z + 2, sx + 8.5, sy + 3, card.z + 24,
    (f, n, c) => shadeLin(FACADE.partyWall, litOf(n, c[0], c[1], c[2]) * 0.7, f === 'ny' ? 0.3 : 0), 'nz py ny px nx');
  for (let i = 0; i < 7; i++) {
    const t = i / 7, ww = 6.5 * (1 - t) + 0.9;
    Tb.box(sx - ww, sy + 3 + i * 4.6, card.z + 6 + t * 3, sx + ww, sy + 7.6 + i * 4.6, card.z + 20 - t * 3,
      (f, n, c) => shadeLin(FACADE.partyWall, litOf(n, c[0], c[1], c[2]) * (0.78 - t * 0.1), 0), 'nz px nx py');
  }
  hazeCard(card, 0.82);
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
      relightCard(card, { facing: 0.62, sunShift: 36, air: 0.07, bite: 0.16 });
    } else if (spec.key === 'midBlock') {
      buildMidBlock(card);
      relightCard(card, { facing: 0.54, sunShift: 30, air: 0.30, bite: 0.12 });
    } else if (spec.key === 'farBlock') {
      buildFarBlock(card);
    } else if (spec.key === 'elevated') {
      buildElevated(card.ctx);
      card.base.z = spec.z - (EL.nearCol + EL.farCol) / 2;
      hazeCard(card, 0.64);
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
    setCam(app, [0, 20, -74], [0, 19.1, 84], 24);
  },
  settle: 0.4,
});

/** The same set from the wings, so a critic can count the cards and see they are cards. */
registerScenario('backdrop_layers', {
  seed: 1925,
  setup: ({ app }) => {
    app.sim.reset(1925);
    setCam(app, [232, 138, -128], [-10, 24, 214], 22);
  },
  settle: 0.4,
});

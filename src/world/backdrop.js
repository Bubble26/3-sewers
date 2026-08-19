import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { T } from '../core/tuning.js';
import { RNG } from '../core/rng.js';
import { registerScenario } from '../core/scenarios.js';
import { FACADE, PAVEMENT } from '../render/palette.js';
import {
  M, Builder, storeyTop, buildingTop, shadeLin, texTint, litOf, lit3,
  rectUV, tcCss, buildTenement,
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

// The five layers, near to far. `p` is T.stage.parallax. `ox` is the source-space origin: a
// card lot's dest x is (ox - z_src), so ox both places the row and keeps every lot inside the
// fully-sunlit band of the baked light solution (source z < 39) — which is what lets
// relightCard() start from one known value and grade the whole card in one pass.
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
const LUM = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * THE STEP IS CAPPED, AND IT IS CAPPED IN LUMINANCE (§3.2 Decision 3).
 *
 * "The reason our sun band reads as sunlight is its hue and its edge, not its brightness."
 * Round 1 shipped a shade branch chosen as paint, which measured 1.97:1 against the sun branch
 * on the near card and 3.03:1 under the pushcart — a Craft fail against a 1.45:1 ceiling. So
 * the shade branch is no longer a free choice: it is the sun branch, cooled, and then scaled
 * so its luminance sits EXACTLY `CAP` below. Hue does all the work; value does almost none.
 */
const CAP = 1.42;

function gradeFor(facing, sun) {
  const r = litRamp(facing);
  const g = [r[0] / BUILT[0], r[1] / BUILT[1], r[2] / BUILT[2]];
  const cool = [SHADE[0] / BUILT[0], SHADE[1] / BUILT[1], SHADE[2] / BUILT[2]];
  const k = LUM(g) / CAP / LUM(cool);
  const s = clamp01(sun);
  return [
    cool[0] * k + (g[0] - cool[0] * k) * s,
    cool[1] * k + (g[1] - cool[1] * k) * s,
    cool[2] * k + (g[2] - cool[2] * k) * s,
  ];
}

/**
 * THE SHADOW LINE — and it is the composition, not a detail (§3.2, §3.3).
 *
 * Round 1 graded every card with `occlusion()`, the world-space solver from facade.js. Traced
 * through, that function returns 1 — full sun — for EVERY vertex on EVERY card: a card at
 * z ≥ 84 sits so far past the south building line that the raking shadow has already climbed
 * over it. So all five cards were flat-lit at one value and a critic correctly reported that
 * "both wings of the street are lit the same; there is no lit-facade / shaded-facade diagonal
 * anywhere". The diagonal that has been missing from every frame of this build was missing
 * because the arithmetic said there wasn't one.
 *
 * A card is scenery. It gets its own terminator, authored: a straight line, a few degrees off
 * horizontal, sun above it and shade below. `pen` is its softness IN FEET, set per card so the
 * penumbra measures 10–14 px at 1600×900 from the locked framings — a hard edge reads as a
 * pasted decal and a wide one reads as a gradient, and neither reads as afternoon.
 */
function sunAt(x, y, o) {
  const line = (o.shadowY ?? 0) + (x - (o.shadowX ?? 0)) * (o.shadowSlope ?? 0);
  return clamp01((y - line) / (o.pen ?? 1) + 0.5);
}

/**
 * ONE AFTERNOON, FIVE CARDS. The terminator climbs as the block recedes — the near row throws
 * its shade a fixed number of feet up whatever stands behind it, and each card is further back
 * — and its softness grows with distance so that every one of them measures 10–14 px at
 * 1600×900 from the locked framings. `slope` is ~3° off horizontal: enough that the edge reads
 * as a cast shadow with a direction, not as a horizontal band of paint.
 */
const SUN = {
  nearFacade: { shadowY: 11.5, shadowX: 0, shadowSlope: -0.055, pen: 0.65 },
  midBlock: { shadowY: 19.5, shadowX: 0, shadowSlope: -0.050, pen: 0.85 },
  farBlock: { shadowY: 22.0, shadowX: 0, shadowSlope: -0.045, pen: 1.10 },
  sky: { shadowY: -30, shadowX: 0, shadowSlope: -0.030, pen: 2.20 },
};
const FAR_SUN = SUN.farBlock;

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
  // 0.55, not the 0.80 round 1 shipped. Haze is a LIGHT, and a light lifts value; pulling 80%
  // of the chroma out as well is the thing that made the far masses read as mid-century
  // concrete rather than as 1925 brick two hundred feet away. Value still climbs with
  // distance — the layer separation survives — but the hue survives with it.
  return [
    (c[0] + (Y * 1.06 - c[0]) * t * 0.55) * k,
    (c[1] + (Y * 1.00 - c[1]) * t * 0.55) * k,
    (c[2] + (Y * 0.90 - c[2]) * t * 0.55) * k,
  ];
}

/**
 * Move a finished card off the "fully sunlit facade" it was authored as and onto the light it
 * actually stands in: a front face turned `facing` out of the sun, crossed by the raking
 * shadow the near buildings throw, with haze in front of it.
 */
function relightCard(card, o = {}) {
  const facing = o.facing ?? 0.40;
  const gain = o.air ?? 0.1;
  for (const b of card.builders.values()) {
    const P = b.p, C = b.c;
    for (let i = 0; i < P.length; i += 3) {
      const g = gradeFor(facing, sunAt(P[i], P[i + 1], o));
      let c = [C[i] * g[0], C[i + 1] * g[1], C[i + 2] * g[2]];
      c = airK(c, P[i + 2], gain, card.z);
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

/**
 * LAW 2, ENFORCED ON THE WAY OUT.
 *
 * A card is not a shadow: it is albedo standing in daylight, so nothing on it has any business
 * below L* 28. Round 1 shipped a 64 px region at **L\* 11.0** on the POST NO BILLS loading
 * doorway and L* 10.8 under the El — measured, not alleged — against a rendered floor of 26.
 * Every builder in this file now runs through here last, so the floor is a property of the
 * card rather than a thing each function has to remember. §3.4's instruction is followed
 * exactly: the dark end is lifted by raising ambient, never by adding a light — this is a
 * multiply on the vertex albedo, and there is still exactly one sun in the scene.
 *
 * `minY` is linear luminance: 0.0565 is L* 28, 0.0640 is L* 29.9. Linear ironwork is exempt
 * to L* 19 by §2.2, but on a card two hundred feet away no bar is ever 2–6 px wide, so the
 * exemption buys nothing and is not taken.
 */
function liftFloor(card, minY) {
  for (const b of card.builders.values()) {
    const C = b.c;
    for (let i = 0; i < C.length; i += 3) {
      const y = 0.2126 * C[i] + 0.7152 * C[i + 1] + 0.0722 * C[i + 2];
      if (y > 0 && y < minY) {
        const k = minY / y;
        C[i] *= k; C[i + 1] *= k; C[i + 2] *= k;
      }
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
  { x: 16, st: 4, brick: 'ochre', fe: 1, shop: 'ice', flankSign: 'castoria' },
  { x: -9, st: 1, brick: 'red', bay: 1, roof: 'pots' },              // the quiet bay
  { x: -34, st: 1, brick: 'brown', shop: 'lunch', roof: 'sign' },
  { x: -59, st: 4, brick: 'brown', blind: 'uneeda', shop: 'laundry', tank: 1, coop: 1 },
];

function buildNearFacade(card) {
  const r = new RNG(19250922);
  const nb = neighbourTops(NEAR);
  NEAR.forEach((spec, i) => {
    const lot = cardLot(card, spec, r);
    lot.flankSign = spec.flankSign || null;
    if (spec.bay) lot.ground = 'store';                 // wallGrid starts at the water table
    if (spec.blind) lot.sprites = SPRITES.slice(0, 4);
    buildTenement(card.rot, lot);
    lotBack(card, lot, nb[i][1], nb[i][0]);
    if (spec.bay) wagonBay(card, lot, r);
    else if (lot.ground === 'store') buildStorefront(card.rot, lot);
    if (spec.blind) blindWall(card, lot, spec.blind);
    if (spec.roof === 'sign') roofSign(card, lot, 1, 10.5, 4.4, 0.42);
    if (spec.roof === 'pots') parapetPots(card, lot, r);
  });
  plinth(card, -76, 78, 13, 34);
  curbDressing(card, r);
  apron(card, 84, CARD_Z.midBlock - 2, 92);
}

/**
 * The back and two flanks of a lot. A stage flat is a solid thing seen from the wings; without
 * this the roof decks read as floating shelves the moment the camera leaves the front.
 */
function lotBack(card, lot, leftTop, rightTop) {
  const B = card.rotB('wallStone'), Sb = card.rotB('sign');
  const top = storeyTop(lot.storeys) + M.corniceH - 0.3;
  const x0 = lot.xf + 0.4, x1 = lot.xf + M.depth;
  B.box(x1 - 1.2, 0, lot.z0 - 0.3, x1, top, lot.z0 + M.lot + 0.3,
    (f) => (f === 'px' ? [0.60, 0.60, 0.63] : [0.48, 0.48, 0.52]), 'px pz nz', 8);
  // party walls: only the strip the neighbour does not cover, exactly like a real block
  const lo = Math.min(top - 0.5, Math.max(0, leftTop - 0.6));
  if (top - lo > 1) {
    B.box(x0, lo, lot.z0 - 0.25, x1, top, lot.z0 + 0.25, () => [0.90, 0.885, 0.845], 'nz', 8);
    partyWallDress(card, lot, lo, top, lot.z0 - 0.25, -1);
    if (top - lo > 16 && lot.flankSign) {
      const slot = card.atlas.get(`ghost:${lot.flankSign}`);
      const h = Math.min(top - lo - 3, 26), w = Math.min(M.depth - 9, h * (slot.w / slot.h));
      const ax = lot.xf + 4.5;
      Sb.quad([ax, lo + 2, lot.z0 - 0.32], [ax + w, lo + 2, lot.z0 - 0.32],
        [ax + w, lo + 2 + h, lot.z0 - 0.32], [ax, lo + 2 + h, lot.z0 - 0.32],
        texTint(0.62), rectUV(slot), [0, 0, -1]);
    }
  }
  const ro = Math.min(top - 0.5, Math.max(0, rightTop - 0.6));
  if (top - ro > 1) {
    B.box(x0, ro, lot.z0 + M.lot - 0.25, x1, top, lot.z0 + M.lot + 0.25, () => [0.50, 0.51, 0.56], 'pz', 8);
    partyWallDress(card, lot, ro, top, lot.z0 + M.lot + 0.25, 1);
  }
}

/**
 * WHAT GOES ON A PARTY WALL, which is not "nothing".
 *
 * Round 1 left these as flat tinted quads and a critic found one 170 px wide and 500 px tall in
 * `backdrop_layers` carrying no window, no sign, no cornice and no relief — a floor-to-sky
 * blank in the middle of the shot registered to prove this piece works. In 1925 a wall like
 * this is the most WORKED surface on a block, because it is the only one a wall dog can rent:
 *
 *   * bricked-up blind windows, three rows of them, where the neighbour's floors used to be —
 *     the tenement was built party-wall to party-wall and these were filled the day the lot
 *     next door was built up. Soot brick `#8A4A3A` in a `#B49C86` mortar surround, at 0.25 ft
 *     of relief, which is enough to catch the light and cast its own line;
 *   * a painted advertisement across 60% of the width;
 *   * a stone coping along the top, and the soot streak that runs from under it;
 *   * and a saturated element per six feet, like everything else on this set (Law 4).
 */
function partyWallDress(card, lot, lo, top, at, dir) {
  const h = top - lo;
  if (h < 6) return;
  const Tb = card.rotB('trim'), Sb = card.rotB('sign'), A = card.atlas;
  const x0 = lot.xf + 2.0, x1 = lot.xf + M.depth - 2.0;
  const wide = x1 - x0;
  const off = dir < 0 ? -0.28 : 0.28;                  // stand the relief proud of the wall
  const D = [dir < 0 ? at - 0.55 : at, dir < 0 ? at : at + 0.55];
  const face = dir < 0 ? 'nz' : 'pz';
  const N = dir < 0 ? [0, 0, -1] : [0, 0, 1];

  // blind windows: three rows, in the openings the neighbour's floors would have wanted
  const rows = Math.max(1, Math.min(3, Math.floor((h - 4) / 10.5)));
  const cols = Math.max(2, Math.round(wide / 12));
  for (let ry = 0; ry < rows; ry++) {
    const wy = top - 5.5 - ry * 10.5;
    if (wy - 5.4 < lo + 1) break;
    for (let cx = 0; cx < cols; cx++) {
      const wx = x0 + (cx + 0.5) * (wide / cols) - 1.5;
      // the mortar surround, proud of the wall…
      Tb.box(wx - 0.55, wy - 6.0, D[0] - (dir < 0 ? 0.25 : 0), wx + 3.55, wy + 0.55, D[1] + (dir < 0 ? 0 : 0.25),
        (f, n, c) => shadeLin(0xb49c86, litOf(n, c[0], c[1], c[2]) * 0.9, f === 'ny' ? 0.35 : 0), `${face} py ny px nx`);
      // …and the soot brick filling the opening, set back inside it
      Tb.box(wx, wy - 5.5, D[0] - (dir < 0 ? 0.12 : 0), wx + 3, wy, D[1] + (dir < 0 ? 0 : 0.12),
        (f, n, c) => shadeLin(0x8a4a3a, litOf(n, c[0], c[1], c[2]) * 0.72, 0.14), `${face}`);
      // the segmental arch head, in five stepped voussoirs of the same mortar
      for (let k = 0; k < 5; k++) {
        const t = (k + 0.5) / 5;
        const ax = wx + t * 3;
        const ay = wy + 0.55 + Math.sin(t * Math.PI) * 0.95;
        Tb.box(ax - 0.34, wy + 0.4, D[0] - (dir < 0 ? 0.3 : 0), ax + 0.34, ay, D[1] + (dir < 0 ? 0 : 0.3),
          (f, n, c) => shadeLin(0xb49c86, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.4 : 0), `${face} py px nx`);
      }
    }
  }

  // the wall ad, 60% of the width, up under the coping
  if (h > 15) {
    const slot = A.get(`ghost:${['castoria', 'uneeda', 'goldDust'][((lot.storeys + Math.round(lot.z0)) % 3 + 3) % 3]}`);
    const aw = wide * 0.60, ah = Math.min(h - 8, aw * (slot.h / slot.w));
    const ax = x0 + wide * 0.20, ay = top - 3.5 - ah;
    if (ah > 5 && ay > lo) {
      const q = dir < 0 ? at - 0.62 : at + 0.62;
      if (dir < 0) {
        Sb.quad([ax + aw, ay, q], [ax, ay, q], [ax, ay + ah, q], [ax + aw, ay + ah, q], texTint(0.60), rectUV(slot), N);
      } else {
        Sb.quad([ax, ay, q], [ax + aw, ay, q], [ax + aw, ay + ah, q], [ax, ay + ah, q], texTint(0.60), rectUV(slot), N);
      }
    }
  }

  // stone coping, and the soot that has run out from under it for forty years
  Tb.box(x0 - 2.0, top - 0.9, D[0] - 0.6, x1 + 2.0, top, D[1] + 0.6,
    (f, n, c) => shadeLin(0x9a9184, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.4 : 0), `${face} py ny px nx`);
  for (let k = 0; k < 5; k++) {
    const sx = x0 + (k + 0.5) * (wide / 5);
    Tb.box(sx - 0.7, top - Math.min(h - 1, 9 + (k % 3) * 4), D[0] - 0.08, sx + 0.7, top - 1.0, D[1] + 0.08,
      () => shadeLin(0x6b4235, 0.10, 0.22), face);
  }

  // Law 4: this wall is sooty, so this wall gets colour on it — one element per six feet,
  // alternating a washing line strung off the wall with a painted board bolted to it.
  const want = Math.max(2, Math.round(wide / 6));
  const q = dir < 0 ? at - 0.72 : at + 0.72;
  const put = (bx, by, bw, bh, slot, tint) => {
    if (dir < 0) Sb.quad([bx + bw, by, q], [bx, by, q], [bx, by + bh, q], [bx + bw, by + bh, q], tint, rectUV(slot), N);
    else Sb.quad([bx, by, q], [bx + bw, by, q], [bx + bw, by + bh, q], [bx, by + bh, q], tint, rectUV(slot), N);
  };
  for (let k = 0; k < want; k++) {
    const seg = wide / want;
    const ax = x0 + (k + 0.12) * seg;
    const aw = seg * 0.78;
    if (k % 2 === 0) {
      const ay = lo + Math.min(h * 0.40, 11);
      Tb.box(ax - 0.3, ay, D[0] - (dir < 0 ? 0.5 : 0) - 0.2, ax + aw + 0.3, ay + 0.45,
        D[1] + (dir < 0 ? 0 : 0.5) + 0.2, () => shadeLin(0x4a4038, 0.14), `${face} py ny`);
      put(ax, ay - 5.4, aw, 5.4, A.get('laundry'), texTint(0.52));
    } else {
      const hue = ACC[(k + lot.storeys) % 4];
      const ay = lo + Math.min(h * 0.62, 19);
      Tb.box(ax, ay, D[0] - (dir < 0 ? 0.45 : 0), ax + aw, ay + 2.6, D[1] + (dir < 0 ? 0 : 0.45),
        (f, n, c) => shadeLin(hue, litOf(n, c[0], c[1], c[2]) * 0.9, f === 'ny' ? 0.3 : 0), `${face} py ny px nx`);
    }
  }
}

/** Roof height of each lot's two neighbours in a card row, for the party-wall strips. */
function neighbourTops(specs) {
  const tops = specs.map((sp) => storeyTop(sp.st) + M.corniceH);
  return specs.map((sp, i) => {
    const gapL = i > 0 && Math.abs(specs[i - 1].x - (sp.x + M.lot)) < 1;
    const gapR = i < specs.length - 1 && Math.abs(sp.x - (specs[i + 1].x + M.lot)) < 1;
    return [gapL ? tops[i - 1] : 0, gapR ? tops[i + 1] : 0];
  });
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

  // blind brick either side of the opening, and the spandrel over the arch. Banded, because
  // one flat quad of brick is the fastest way to make a wall look like a texture swatch.
  const bands = [0, 2.1, 5.4, 8.6, M.ground];
  for (let i = 0; i < bands.length - 1; i++) {
    const b0 = bands[i], b1 = bands[i + 1];
    const k = 1 - 0.055 * (i % 2) - 0.03 * i;
    const band = (f, n, c) => { const m = wall(f, n, c); return [m[0] * k, m[1] * k, m[2] * k]; };
    W.box(xf, b0, z0, xf + 0.9, b1, cz - half, band, 'nx', 8);
    W.box(xf, b0, cz + half, xf + 0.9, b1, z1, band, 'nx', 8);
  }
  W.box(xf, head + 1.4, cz - half, xf + 0.9, M.ground, cz + half, wall, 'nx', 8);
  // brownstone water table along the foot of the wall — the one horizontal at kid height
  for (const [a, b] of [[z0, cz - half], [cz + half, z1]]) {
    Tb.box(xf - 0.34, 1.55, a, xf + 0.1, 2.1, b,
      (f, n, c) => shadeLin(lot.stoneHex, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.45 : 0), 'nx py ny');
  }

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
  // a stepped gable over the arch: the one break in the taxpayer's roofline
  const gTop = buildingTop(lot.storeys);
  for (let i = 0; i < 3; i++) {
    const hw = 10.5 - i * 3.0;
    W.box(xf - 0.1, gTop - 0.4 + i * 1.5, cz - hw, xf + 0.9, gTop + 1.1 + i * 1.5, cz + hw, wall, 'nx py', 8);
    Tb.box(xf - 0.55, gTop + 0.85 + i * 1.5, cz - hw - 0.45, xf + 0.2, gTop + 1.25 + i * 1.5, cz + hw + 0.45,
      (f, n, c) => shadeLin(lot.stoneHex, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.4 : 0), 'nx py ny pz nz');
  }
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
  Tb.box(lot.xf - 0.7, top - 1.2, fz - 0.19, lot.xf - 0.32, top + 8.2, fz + 0.19,
    () => shadeLin(0x8e8579, 0.5), 'nx px pz nz');
  Tb.cyl(lot.xf - 0.51, fz, 0.42, top + 8.2, top + 8.9, 7, (n, c) => shadeLin(0xb8924a, litOf(n, c[0], c[1], c[2])));
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
          (f, n, c) => shadeLin(i % 3 === 1 ? 0x8a7f70 : 0x9a8a68, litOf(n, c[0], c[1], c[2]) * 0.85,
            f === 'ny' ? 0.35 : 0.04), 'nx px py pz nz');
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
  { x: 0, st: 5, brick: 'red', fe: 1, pigeons: 1, flankSign: 'goldDust' },
  { x: 25, st: 4, brick: 'brown', fe: 1, tank: 1 },
  { x: 50, st: 5, brick: 'ochre', fe: 1, tank: 1 },
  { x: 75, st: 4, brick: 'red', fe: 1, coop: 1 },
  { x: -75, st: 5, brick: 'brown', fe: 1, coop: 1, pigeons: 1 },
  { x: -100, st: 4, brick: 'red', fe: 1, tank: 1 },
  { x: -125, st: 5, brick: 'ochre', fe: 1, tank: 1 },
];

function buildMidBlock(card) {
  const r = new RNG(1925031);
  const nb = neighbourTops(MID);
  MID.forEach((spec, i) => {
    const lot = cardLot(card, spec, r);
    lot.flankSign = spec.flankSign || null;
    buildTenement(card.rot, lot);
    lotBack(card, lot, nb[i][1], nb[i][0]);
  });
  plinth(card, -134, 116, 11, 28);
  apron(card, 130, CARD_Z.farBlock - 2, 134);
}

// ─── far block card, z = 190, and the skyline card, z = 400 ───────────────────
/**
 * Distance is not the place for a facade kit. These are masses: a stepped roofline, painted
 * window rows, a cornice to say "not a housing block", tanks and pots against the sky.
 */
/** The baked sun, on the card's own terminator, so one set reads as one afternoon. */
function farLit(n, c, T) {
  const ndl = n[0] * -0.740 + n[1] * 0.545 + n[2] * -0.393;
  if (ndl <= 0.02) return 0;
  const s = sunAt(c[0], c[1], T);
  return ndl * (0.42 + 0.58 * s);
}

/**
 * THE SATURATION BILL, PAID BY THE FOOT (Law 4).
 *
 * "No 128×128 px region of a gameplay frame may contain only materials with S < 0.20." Round 1
 * failed that on 42 of 84 tiles of `backdrop_layers` and 59 of 84 of `wide`, and every failing
 * tile was on a far card. The near strip already pays the bill and always did; what the far
 * cards lacked was not a technique but a RULE, so here is the rule: **one saturated element per
 * six feet of face width, mandatory, on every mass this file builds.** The four colours are
 * §2.2's own accent set, and 1925 New York over-painted itself exactly this hard.
 */
const ACC = [0xc8402f, 0xe3a32b, 0x2f7f63, 0x3b5ea0];

function farAwning(Tb, x0, x1, y, z, hex, T) {
  const drop = 2.6, out = 3.4;
  // the sloped canvas itself: the one thing on a far wall that is a colour and not a value
  Tb.quad([x1, y, z], [x0, y, z], [x0, y - drop, z - out], [x1, y - drop, z - out],
    shadeLin(hex, 0.62, 0, 0.2), [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 0.72, -0.69]);
  // its shaded underside and the scalloped valance hanging off the front bar
  Tb.box(x0, y - drop - 1.5, z - out - 0.2, x1, y - drop, z - out + 0.15,
    (f, n, c) => shadeLin(hex, farLit(n, c, T) * 0.5, 0.12), 'nz px nx ny');
  Tb.box(x0 - 0.2, y - drop - 0.2, z - out - 0.35, x1 + 0.2, y - drop + 0.15, z - out + 0.1,
    () => shadeLin(0x3a332c, 0.14), 'nz py ny px nx');
}

/** A washing line strung across a light court: four garments, four values, one hue. */
function farLaundry(Sb, A, x0, x1, y, z) {
  const slot = A.get('laundry');
  const h = Math.min(7.5, (x1 - x0) * (slot.h / slot.w));
  Sb.quad([x1, y - h, z], [x0, y - h, z], [x0, y, z], [x1, y, z],
    texTint(0.50), rectUV(slot), [0, 0, -1]);
}

/**
 * One mass in a far row. Everything below is mandatory, because the round-1 criticism was not
 * "these could be better" but "these are bare extruded rectangles":
 *
 *   * a WATER TABLE at the foot — the horizontal that tells you where the ground is;
 *   * a CORNICE BAND 1.2 ft deep in §2.2's cornice paint, its height varied 2–8 ft mass to
 *     mass (period anti-check #19), with a lit top fascia, a dark soffit and end brackets;
 *   * at least one ROOF EVENT: a tank on four legs, a painted roof sign, or a cluster of 3–5
 *     chimney pots — the silhouette against the sky is the only thing at this distance that
 *     says 1925 rather than 1955;
 *   * and one accent per six feet of width.
 */
function farMass(card, o, r, x, w, i, T) {
  const Tb = card.b('trim'), Sb = card.b('sign'), A = card.atlas;
  const h = o.hMin + r.range(0, o.hSpan) + o.crest * clamp01((Math.abs(x + w / 2) - o.crestIn) / o.crestW);
  const hex = r.chance(0.34) ? FACADE.ochre : r.chance(0.5) ? FACADE.brickSoot : FACADE.brick;
  const z = o.z + r.range(0, o.jitter || 0);
  const uv = rectUV(A.get('farwall'));
  const x0 = x + 0.7, x1 = x + w - 0.7;
  const face = (f, n, c) => shadeLin(hex, farLit(n, c, T) * 0.96, f === 'ny' ? 0.4 : 0);
  Tb.box(x0, 0, z, x1, h, z + o.depth, face, 'nz px nx py');

  // water table: a brownstone band at the foot, the horizontal that grounds the mass
  Tb.box(x0 - 0.5, 2.0, z - 0.7, x1 + 0.5, 3.4, z + 1.0,
    (f, n, c) => shadeLin(0x8a7f70, farLit(n, c, T) * 0.94, f === 'ny' ? 0.45 : 0), 'nz py ny px nx');

  // painted window rows — at this distance a window is a rectangle of value…
  const rows = Math.max(1, Math.round(h / 21));
  for (let k = 0; k < rows; k++) {
    const y0 = 4 + (k / rows) * (h - 7), y1 = 4 + ((k + 1) / rows) * (h - 7);
    Sb.quad([x1 - 0.8, y0, z - 0.12], [x0 + 0.8, y0, z - 0.12],
      [x0 + 0.8, y1, z - 0.12], [x1 - 0.8, y1, z - 0.12],
      texTint(0.40 * clamp01((y0 - o.shadeTo) / 24 + 0.34), 0.05), uv, [0, 0, -1]);
  }
  // …but a SILL is 0.3 ft of relief, and relief is what catches the light
  for (let k = 1; k < rows; k += 1) {
    const yy = 4 + (k / rows) * (h - 7);
    Tb.box(x0 - 0.3, yy - 0.6, z - 0.45, x1 + 0.3, yy, z + 0.4,
      (f, n, c) => shadeLin(k % 2 ? 0x8a7f70 : 0xb49c86, farLit(n, c, T) * 0.92, f === 'ny' ? 0.4 : 0), 'nz py ny');
  }

  // THE CORNICE. 1.2 ft deep, 2–8 ft tall, and never the same twice in a row.
  const ch = 2.0 + r.range(0, 6.0);
  const cor = r.chance(0.5) ? 0x4c4a3c : 0x7a4a34;
  Tb.box(x - 0.2, h, z - 1.2, x + w + 0.2, h + ch * 0.62, z + 1.4,
    (f, n, c) => shadeLin(cor, farLit(n, c, T) * 0.9, f === 'ny' ? 0.55 : 0), 'nz py ny px nx');
  Tb.box(x - 1.0, h + ch * 0.62, z - 2.0, x + w + 1.0, h + ch, z + 1.4,
    (f, n, c) => shadeLin(cor, farLit(n, c, T), f === 'ny' ? 0.6 : 0), 'nz py ny px nx');
  for (let bx = x + 1.5; bx < x + w - 1; bx += 5.5) {           // modillion brackets
    Tb.box(bx, h - 1.1, z - 1.9, bx + 1.1, h + ch * 0.62, z - 0.9,
      (f, n, c) => shadeLin(cor, farLit(n, c, T) * 0.8, f === 'ny' ? 0.5 : 0), 'nz px nx ny');
  }

  // THE ROOF EVENT — one of three, always one.
  const kind = i % 3;
  if (kind === 0) {
    const tx = x + w * 0.5, tz = z + 13;
    for (const dx of [-4, 4]) for (const dz of [-3.6, 3.6]) {
      Tb.box(tx + dx - 0.34, h, tz + dz - 0.34, tx + dx + 0.34, h + 11, tz + dz + 0.34,
        () => shadeLin(0x5a4a3c, 0.20), 'nz pz px nx');
    }
    Tb.cyl(tx, tz, 5.0, h + 11, h + 20, 12, (n, c) => shadeLin(0x8e8579, farLit(n, c, T) * 0.9), 'py');
    for (const hy of [h + 12.6, h + 18.2]) {
      Tb.cyl(tx, tz, 5.2, hy, hy + 0.55, 12, () => shadeLin(0x4a4038, 0.18), '');
    }
    Tb.cyl(tx, tz, 5.3, h + 19.4, h + 20.8, 12, () => shadeLin(0x4a4038, 0.16), '');   // conical hat
    Tb.box(tx - 0.4, h + 20.8, tz - 0.4, tx + 0.4, h + 24, tz + 0.4, () => shadeLin(0x4a4038, 0.22), 'nz px nx py');
  } else if (kind === 1) {
    const slot = A.get(`roofsign:${i % 3}`);
    const sw = Math.min(w - 2, 26), sh = sw * (slot.h / slot.w) * 1.35;
    const sx = x + w * 0.5;
    Sb.quad([sx + sw / 2, h + ch, z - 1.0], [sx - sw / 2, h + ch, z - 1.0],
      [sx - sw / 2, h + ch + sh, z - 1.0], [sx + sw / 2, h + ch + sh, z - 1.0],
      texTint(0.68), rectUV(slot), [0, 0, -1]);
    for (const px of [sx - sw * 0.36, sx + sw * 0.36]) {
      Tb.box(px - 0.22, h + ch - 1.5, z - 1.0, px + 0.22, h + ch + sh * 0.9, z + 2.4,
        () => shadeLin(0x4a4a44, 0.24), 'nz px nx pz');
    }
  } else {
    const stack = x + w * r.range(0.25, 0.7);
    const sh = 4.5 + r.range(0, 4);
    Tb.box(stack - 2.4, h, z + 4, stack + 2.4, h + sh, z + 8,
      (f, n, c) => shadeLin(FACADE.brickSoot, farLit(n, c, T), f === 'ny' ? 0.4 : 0), 'nz px nx py pz');
    const pots = 3 + r.int(0, 2);
    for (let k = 0; k < pots; k++) {
      const px = stack - 1.8 + k * (3.6 / Math.max(1, pots - 1));
      Tb.cyl(px, z + 6, 0.62, h + sh, h + sh + 1.8 + (k % 3) * 0.7, 7,
        (n, c) => shadeLin(0xb8724a, farLit(n, c, T) * 0.9));
    }
  }

  // ── the accent quota: one per six feet of face ────────────────────────────
  const want = Math.max(1, Math.round(w / 6));
  for (let k = 0; k < want; k++) {
    const seg = w / want;
    const ax0 = x + 1.0 + k * seg, ax1 = ax0 + seg - 2.0;
    if (ax1 - ax0 < 2) continue;
    const pick = (i * 7 + k * 3 + (r.chance(0.5) ? 1 : 0)) % 4;
    const hue = ACC[(i + k) % 4];
    if (pick === 0) {
      farAwning(Tb, ax0, ax1, 4 + ((k % rows) / rows) * (h - 7) + 5.2, z - 0.15, hue, T);
    } else if (pick === 1) {
      // a painted advertisement, straight onto the brick, half the wall high
      const slot = A.get(`ghost:${['uneeda', 'goldDust', 'castoria'][(i + k) % 3]}`);
      const gh = Math.min(h * 0.40, 22), gw = Math.min(ax1 - ax0 + 3, gh * (slot.w / slot.h));
      const gx = (ax0 + ax1) / 2;
      Sb.quad([gx + gw / 2, h - 8 - gh, z - 0.3], [gx - gw / 2, h - 8 - gh, z - 0.3],
        [gx - gw / 2, h - 8, z - 0.3], [gx + gw / 2, h - 8, z - 0.3],
        texTint(0.56, 0.03), rectUV(slot), [0, 0, -1]);
    } else if (pick === 2) {
      farLaundry(Sb, A, ax0, ax1, 8 + ((k % rows) / rows) * (h - 12), z - 0.35);
    } else {
      // window blinds, half drawn, in the one colour a 1925 blind ever came in
      for (let m = 0; m < rows; m += 2) {
        const yy = 4 + ((m + 0.85) / rows) * (h - 7);
        Tb.box(ax0, yy - 2.6, z - 0.25, ax1, yy, z - 0.1,
          () => shadeLin(hue, 0.52, 0, 0.15), 'nz py ny');
      }
    }
  }
  return h;
}

function massRow(card, o) {
  const T = o.terminator;
  const r = new RNG(o.seed);
  const runs = o.gap ? [[o.x0, o.gap[0]], [o.gap[1], o.x1]] : [[o.x0, o.x1]];
  let i = 0;
  for (const [a, b] of runs) {
    let x = a;
    while (x < b - 6) {
      const w = Math.min(o.wMin + r.range(0, o.wSpan), b - x);
      farMass(card, o, r, x, w, i, T);
      x += w; i++;
    }
  }
}

/**
 * A GASHOLDER. The single most 1925 silhouette a New York skyline had and the one shape in
 * this build that could not be mistaken for 1955: a riveted telescopic gas tank in its own
 * lattice guide frame, taller than everything around it and perfectly round.
 */
function gasholder(card, cx, z, T) {
  const Tb = card.b('trim');
  const rad = 21, top = 62;
  Tb.cyl(cx, z, rad, 0, top, 22, (n, c) => shadeLin(0x6e675c, farLit(n, c, T) * 0.86), 'py');
  for (const hy of [12, 24, 36, 48]) {                 // the lifts, each a riveted ring
    Tb.cyl(cx, z, rad + 0.5, hy - 0.6, hy + 0.6, 22, (n, c) => shadeLin(0x4a4440, farLit(n, c, T) * 0.7), '');
  }
  Tb.cyl(cx, z, rad + 0.6, top - 1.4, top + 0.4, 22, (n, c) => shadeLin(0x4a4440, farLit(n, c, T) * 0.8), 'py');
  // the guide frame: sixteen standards and two girt rings, which is what makes it read
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const px = cx + Math.cos(a) * (rad + 3.4), pz = z + Math.sin(a) * (rad + 3.4);
    if (Math.sin(a) > 0.4) continue;                   // only the standards we can see
    Tb.box(px - 0.5, 0, pz - 0.5, px + 0.5, top + 9, pz + 0.5,
      () => shadeLin(0x413b37, 0.20), 'nz px nx py');
  }
  for (const hy of [top - 4, top + 7]) {
    Tb.cyl(cx, z, rad + 3.9, hy, hy + 1.0, 22, () => shadeLin(0x413b37, 0.22), '');
  }
}

/** A church: a nave, a slate roof and a spire. A skyline of boxes is a skyline nobody drew. */
function church(card, cx, z, T) {
  const Tb = card.b('trim');
  const stone = 0x9a9184;
  Tb.box(cx - 15, 0, z, cx + 15, 34, z + 26,
    (f, n, c) => shadeLin(stone, farLit(n, c, T) * 0.92, f === 'ny' ? 0.4 : 0), 'nz px nx py');
  for (let k = 0; k < 4; k++) {                        // buttresses
    const bx = cx - 12 + k * 8;
    Tb.box(bx - 1.1, 0, z - 2.2, bx + 1.1, 27, z + 0.4,
      (f, n, c) => shadeLin(stone, farLit(n, c, T) * 0.86, f === 'ny' ? 0.4 : 0), 'nz px nx py');
  }
  // gable and slate roof
  for (let k = 0; k < 6; k++) {
    const t = k / 6, hw = 15 * (1 - t);
    Tb.box(cx - hw, 34 + k * 2.2, z + 1, cx + hw, 36.2 + k * 2.2, z + 25,
      (f, n, c) => shadeLin(0x53483f, farLit(n, c, T) * 0.8, f === 'ny' ? 0.4 : 0), 'nz py px nx');
  }
  // the tower and the spire
  Tb.box(cx + 9, 0, z + 2, cx + 21, 52, z + 16,
    (f, n, c) => shadeLin(stone, farLit(n, c, T) * 0.95, f === 'ny' ? 0.4 : 0), 'nz px nx py');
  Tb.box(cx + 8.2, 52, z + 1.2, cx + 21.8, 55, z + 16.8,
    (f, n, c) => shadeLin(stone, farLit(n, c, T), f === 'ny' ? 0.5 : 0), 'nz py ny px nx');
  for (let k = 0; k < 8; k++) {
    const t = k / 8, hw = 6.4 * (1 - t) + 0.5;
    Tb.box(cx + 15 - hw, 55 + k * 3.4, z + 9 - hw, cx + 15 + hw, 58.4 + k * 3.4, z + 9 + hw,
      (f, n, c) => shadeLin(0x53483f, farLit(n, c, T) * (0.9 - t * 0.15), f === 'ny' ? 0.4 : 0), 'nz px nx py');
  }
  Tb.box(cx + 14.7, 82, z + 8.7, cx + 15.3, 87, z + 9.3, () => shadeLin(0xc8924e, 0.62), 'nz px nx py');
  Tb.box(cx + 13.4, 84.2, z + 8.8, cx + 16.6, 85.0, z + 9.2, () => shadeLin(0xc8924e, 0.62), 'nz px nx py');
}

function buildFarBlock(card) {
  const T = FAR_SUN;
  massRow(card, {
    z: card.z, x0: -170, x1: 170, gap: [-39, 5], seed: 4177,
    wMin: 14, wSpan: 13, hMin: 24, hSpan: 17, crest: 15, crestIn: 40, crestW: 100,
    depth: 32, jitter: 6, shadeTo: 30, terminator: T,
  });
  // The two period silhouettes, set in the notch's own sightline so they are what the eye
  // lands on when it travels down the street.
  gasholder(card, -30, card.z + 52, T);
  church(card, 8, card.z + 44, T);
  gasholder(card, -128, card.z + 40, T);
  apron(card, 190, CARD_Z.elevated - 4, 170);
  hazeCard(card, 0.30);
  liftFloor(card, 0.064);
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
      (f, n, c) => shadeLin(hex, farLit(n, c, SUN.sky) * 0.82, 0), 'nz px nx py');
    Tb.box(x - 1.8, h, card.z - 2, x + w + 1.8, h + 3.4, card.z + 2,
      (f, n, c) => shadeLin(hex, farLit(n, c, SUN.sky) * 0.7, f === 'ny' ? 0.3 : 0), 'nz py ny px nx');
    if (r.chance(0.4)) {
      const sx = x + w * r.range(0.25, 0.75);
      Tb.cyl(sx, card.z + 12, 2.9, h, h + r.range(14, 26), 10,
        (n, c) => shadeLin(0x8a6a54, farLit(n, c, SUN.sky) * 0.62), '');
    }
  }
  // a steeple, because a skyline of boxes is a skyline nobody drew
  const sx = -6, sy = 74;
  Tb.box(sx - 7, 0, card.z + 4, sx + 7, sy, card.z + 22,
    (f, n, c) => shadeLin(FACADE.partyWall, farLit(n, c, SUN.sky) * 0.82, 0), 'nz px nx py');
  Tb.box(sx - 8.5, sy, card.z + 2, sx + 8.5, sy + 3, card.z + 24,
    (f, n, c) => shadeLin(FACADE.partyWall, farLit(n, c, SUN.sky) * 0.7, f === 'ny' ? 0.3 : 0), 'nz py ny px nx');
  for (let i = 0; i < 7; i++) {
    const t = i / 7, ww = 6.5 * (1 - t) + 0.9;
    Tb.box(sx - ww, sy + 3 + i * 4.6, card.z + 6 + t * 3, sx + ww, sy + 7.6 + i * 4.6, card.z + 20 - t * 3,
      (f, n, c) => shadeLin(FACADE.partyWall, farLit(n, c, SUN.sky) * (0.8 - t * 0.1), 0), 'nz px nx py');
  }
  hazeCard(card, 0.78);
  liftFloor(card, 0.070);
}

/* ============================================================================
   THE SET BREATHES

   A card that never moves is a painting, and round 1 shipped five of them: twelve frames of
   `contact` at 50 ms apart, and across 600 ms not one pixel of any card changed. The train
   went by once every twenty seconds and that was the whole of the backdrop's life.

   Everything below is a sine wave and a modulo. No physics, no solver, no per-frame allocation
   and no shadow: eleven small meshes, parented to the card group so they parallax with it, and
   one `tick(t)` per card driven by the same deterministic clock the train runs on — which is
   what makes a moving backdrop safe to screenshot.

   It is deliberately laid out LOW. From the locked BATTING framing the top of frame crosses
   the near card at y = 20.7 ft and from FIELD at y = 10.0 ft (measured, both, at 1600×900), so
   motion authored on a fifth-floor cornice is motion the player never sees. The washing goes
   over the notch, the shop signs swing at nine feet, and the pigeons come off the taxpayer
   parapet rather than off the roofline.
   ========================================================================= */

function registerBackdropSprites(atlas) {
  if (atlas.has('bd:smoke')) return;
  // A soft coal-smoke puff. Drawn, not blurred: three offset lobes of one warm grey, which is
  // what a 1997 sprite artist would have painted and what survives being scaled 6×.
  atlas.add('bd:smoke', 96, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const lobes = [[0.42, 0.56, 0.30], [0.62, 0.44, 0.24], [0.34, 0.36, 0.20], [0.58, 0.66, 0.19]];
    for (let ring = 0; ring < 3; ring++) {
      g.fillStyle = ['rgba(206,198,182,0.34)', 'rgba(190,181,164,0.50)', 'rgba(176,167,150,0.66)'][ring];
      for (const [cx, cy, rr] of lobes) {
        g.beginPath();
        g.ellipse(cx * w, cy * h, rr * w * (1 - ring * 0.17), rr * h * (0.88 - ring * 0.15), 0.3, 0, 7);
        g.fill();
      }
    }
  });
  // Somebody at a window. Three poses, swapped on a slow uneven clock — leaning out on both
  // elbows, turned away, and gone but for the curtain. The joke is that she is watching the
  // game and does not think much of it.
  const FIG = [
    (g, w, h) => {                                   // leaning out on both elbows
      g.fillStyle = tcCss(0x8a5a4a); g.fillRect(w * 0.30, h * 0.06, w * 0.40, h * 0.30);
      g.fillStyle = tcCss(0xf0c49e); g.beginPath(); g.ellipse(w * 0.5, h * 0.12, w * 0.15, h * 0.11, 0, 0, 7); g.fill();
      g.fillStyle = tcCss(0x3a2a24); g.beginPath(); g.ellipse(w * 0.5, h * 0.055, w * 0.17, h * 0.075, 0, 0, 7); g.fill();
      g.fillStyle = tcCss(0xc8a07e); g.fillRect(w * 0.16, h * 0.30, w * 0.68, h * 0.09);
    },
    (g, w, h) => {                                   // turned away, one shoulder
      g.fillStyle = tcCss(0x4a6a5a); g.fillRect(w * 0.36, h * 0.10, w * 0.34, h * 0.32);
      g.fillStyle = tcCss(0x3a2a24); g.beginPath(); g.ellipse(w * 0.55, h * 0.13, w * 0.14, h * 0.10, 0, 0, 7); g.fill();
    },
    (g, w, h) => {                                   // gone; the curtain is still moving
      g.fillStyle = tcCss(0xd8ccb0); g.beginPath();
      g.moveTo(w * 0.18, 0); g.lineTo(w * 0.46, 0); g.lineTo(w * 0.38, h * 0.62);
      g.lineTo(w * 0.20, h * 0.52); g.closePath(); g.fill();
    },
  ];
  FIG.forEach((draw, i) => atlas.add(`bd:fig${i}`, 44, 60, (g, w, h) => { g.clearRect(0, 0, w, h); draw(g, w, h); }));
  // A pigeon in the air, wings up — the only pose that reads at this size.
  atlas.add('bd:bird', 56, 40, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = tcCss(0x6b6a68);
    g.beginPath(); g.ellipse(w * 0.5, h * 0.66, w * 0.17, h * 0.15, 0, 0, 7); g.fill();
    g.beginPath(); g.ellipse(w * 0.34, h * 0.55, w * 0.09, h * 0.11, 0, 0, 7); g.fill();
    g.fillStyle = tcCss(0x8a8880);
    g.beginPath(); g.moveTo(w * 0.46, h * 0.62); g.lineTo(w * 0.14, h * 0.10); g.lineTo(w * 0.40, h * 0.44); g.fill();
    g.beginPath(); g.moveTo(w * 0.56, h * 0.62); g.lineTo(w * 0.90, h * 0.14); g.lineTo(w * 0.62, h * 0.46); g.fill();
    g.fillStyle = tcCss(0x4a4038);
    g.beginPath(); g.moveTo(w * 0.62, h * 0.70); g.lineTo(w * 0.86, h * 0.82); g.lineTo(w * 0.62, h * 0.80); g.fill();
  });
  // A hanging shop sign — a lozenge on two eyes, the shape that swings.
  atlas.add('bd:hang0', 96, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = tcCss(0x2e4034); g.fillRect(w * 0.04, h * 0.10, w * 0.92, h * 0.74);
    g.fillStyle = tcCss(0xe0a62b); g.fillRect(w * 0.09, h * 0.16, w * 0.82, h * 0.06);
    g.fillRect(w * 0.09, h * 0.72, w * 0.82, h * 0.06);
    g.fillStyle = tcCss(0xe6dbc0);
    g.font = `700 ${Math.round(h * 0.34)}px "Liberation Serif","DejaVu Serif",serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SHOES', w * 0.5, h * 0.47);
  });
  atlas.add('bd:hang1', 96, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = tcCss(0x7b1f1f); g.fillRect(w * 0.04, h * 0.10, w * 0.92, h * 0.74);
    g.fillStyle = tcCss(0xe6c96a);
    g.font = `700 ${Math.round(h * 0.30)}px "Liberation Sans","DejaVu Sans",sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ROOMS', w * 0.5, h * 0.34);
    g.fillText('TO LET', w * 0.5, h * 0.66);
  });
}

/** Materials for the moving dressing. Four of them, shared by every card. */
function liveMats(atlas) {
  const tex = atlas.texture();
  const cut = (lit) => {
    const c = texTint(lit);
    const m = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.35, transparent: false, side: THREE.DoubleSide });
    m.color.setRGB(c[0], c[1], c[2]);
    return m;
  };
  const smoke = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  smoke.color.setRGB(0.92, 0.895, 0.845);
  return { wash: cut(0.55), fig: cut(0.30), bird: cut(0.62), sign: cut(0.50), smoke };
}

/** A quad in the XY plane facing −z, pivoted at (0,0) so a rotation about z reads as a swing. */
function hangGeo(w, h, slot) {
  const g = new THREE.BufferGeometry();
  const hw = w / 2;
  g.setAttribute('position', new THREE.Float32BufferAttribute(
    [-hw, -h, 0, hw, -h, 0, hw, 0, 0, -hw, -h, 0, hw, 0, 0, -hw, 0, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(
    [slot.u0, slot.v0, slot.u1, slot.v0, slot.u1, slot.v1, slot.u0, slot.v0, slot.u1, slot.v1, slot.u0, slot.v1], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3));
  return g;
}
/** The same quad, centred, for things that fly rather than hang. */
function flatGeo(w, h, slot) {
  const g = hangGeo(w, h, slot);
  g.translate(0, h / 2, 0);
  return g;
}

const TAU = Math.PI * 2;

/**
 * The `laundry` atlas slot holds FOUR garments side by side, so a quad mapped to the whole
 * slot is four shirts wide however narrow you make it — which is how round 2's first pass put
 * a sixteen-slat picket fence across the POST NO BILLS wall. Carve one garment out instead.
 */
const GARMENT = [[0.00, 0.285], [0.29, 0.535], [0.545, 0.735], [0.745, 1.0]];
function subSlot(slot, i) {
  const [a, b] = GARMENT[i % 4];
  return { u0: slot.u0 + (slot.u1 - slot.u0) * a, u1: slot.u0 + (slot.u1 - slot.u0) * b, v0: slot.v0, v1: slot.v1, w: slot.w * (b - a), h: slot.h };
}

/** A washing line: a rope, its two brackets, and garments that sway ±4° out of phase. */
function washLine(parent, M2, atlas, x0, x1, y, z, phase) {
  const slot = atlas.get('laundry');
  const g = new THREE.Group();
  const rope = new THREE.Mesh(
    new THREE.BoxGeometry(x1 - x0 + 1.4, 0.13, 0.13),
    new THREE.MeshBasicMaterial());
  rope.material.color.setRGB(0.085, 0.080, 0.072);
  rope.position.set((x0 + x1) / 2, y, z);
  g.add(rope);
  const n = Math.max(3, Math.min(5, Math.round((x1 - x0) / 3.4)));
  const ticks = [];
  for (let i = 0; i < n; i++) {
    const sub = subSlot(slot, i);
    const w = 1.95 + (i % 2) * 0.35;
    const h = w / (sub.w / sub.h);
    const cx = x0 + (i + 0.5) * ((x1 - x0) / n);
    const piv = new THREE.Group();
    piv.position.set(cx, y - 0.08, z);
    piv.add(new THREE.Mesh(hangGeo(w, h, sub), M2.wash));
    g.add(piv);
    const ph = phase + i * 1.37;
    ticks.push((t) => { piv.rotation.z = 0.0698 * Math.sin(TAU * t / 3.1 + ph); });
  }
  parent.add(g);
  return (t) => { for (const f of ticks) f(t); };
}

/** A hanging shop sign on its bracket: a slower, heavier swing than cloth. */
function hangingSign(parent, M2, atlas, key, x, y, z, w, phase) {
  const slot = atlas.get(key);
  const h = w * (slot.h / slot.w);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(w * 0.9, 0.22, 0.22), new THREE.MeshBasicMaterial());
  arm.material.color.setRGB(0.10, 0.095, 0.085);
  arm.position.set(x, y + 0.1, z + 0.35);
  parent.add(arm);
  const piv = new THREE.Group();
  piv.position.set(x, y, z);
  piv.add(new THREE.Mesh(hangGeo(w, h, slot), M2.sign));
  parent.add(piv);
  return (t) => { piv.rotation.z = 0.052 * Math.sin(TAU * t / 4.3 + phase); };
}

/**
 * Chimney smoke. Six puffs on one stack, recycled: each rises, grows and fades on its own
 * offset of the same 1/N phase, drifting at 1.4 ft/s toward azimuth 237° — the same bearing
 * §3.2 puts the sun on, because the same afternoon breeze carries both.
 */
function chimneySmoke(parent, M2, atlas, x, y, z, seed) {
  const slot = atlas.get('bd:smoke');
  const geo = flatGeo(3.0, 3.0, slot);
  const N = 7, LIFE = 6.4;
  const puffs = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(geo, M2.smoke);
    m.renderOrder = 3;
    parent.add(m);
    puffs.push(m);
  }
  return (t) => {
    for (let i = 0; i < N; i++) {
      const age = ((t + seed + (i * LIFE) / N) % LIFE);
      const u = age / LIFE;
      // grows to about three times the flue's own width and thins out with it, so the plume
      // reads as a tapering ribbon rather than as a column of soap bubbles
      const s = 0.42 + u * 1.35;
      puffs[i].position.set(x - 0.883 * 1.4 * age + Math.sin(age * 1.9 + i * 2.1) * 0.55,
        y + 0.9 + age * 2.8, z - 0.469 * 1.4 * age);
      puffs[i].scale.set(s, s, s);
      puffs[i].visible = u < 0.92;
    }
  };
}

/** Somebody at a window, swapping pose on an uneven 8–14 s clock. */
function windowFigure(parent, M2, atlas, x, y, z, w, period, offset) {
  const poses = [0, 1, 2].map((i) => {
    const slot = atlas.get(`bd:fig${i}`);
    const m = new THREE.Mesh(flatGeo(w, w * (slot.h / slot.w), slot), M2.fig);
    m.position.set(x, y, z);
    m.visible = false;
    parent.add(m);
    return m;
  });
  return (t) => {
    const k = Math.floor((t + offset) / period) % 3;
    for (let i = 0; i < 3; i++) poses[i].visible = i === k;
  };
}

/**
 * Every twenty seconds the pigeons come off the parapet: a beat of nothing, then four birds
 * up and out of frame on slightly different arcs. It is the cheapest life on the set and the
 * one a player will actually notice, because it is the only thing that STARTS.
 */
function pigeonLift(parent, M2, atlas, x, y, z) {
  const slot = atlas.get('bd:bird');
  const birds = [];
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(flatGeo(2.6, 2.6 * (slot.h / slot.w), slot), M2.bird);
    m.visible = false;
    parent.add(m);
    birds.push(m);
  }
  return (t) => {
    const c = t % 20;
    for (let i = 0; i < 4; i++) {
      const a = c - 0.22 * i;
      if (a < 0 || a > 4.2) { birds[i].visible = false; continue; }
      birds[i].visible = true;
      const climb = a * (5.2 + i * 0.55) - 0.34 * a * a;
      birds[i].position.set(x + i * 1.6 - 2.4 - a * (2.1 + i * 0.4), y + Math.max(0, climb), z - a * 0.5);
      const flap = 0.82 + 0.18 * Math.sin(a * 26 + i);
      birds[i].scale.set(1, flap, 1);
    }
  };
}

/** Hang the moving dressing on one card. Returns the tick, or null if this card is still. */
function dressLive(card, M2) {
  const g = new THREE.Group();
  g.name = `backdrop:${card.key}:live`;
  const A = card.atlas;
  const ticks = [];
  if (card.key === 'nearFacade') {
    // Low, over the notch, where BATTING can actually see it — and one high line for the
    // wide shots, out of phase with the first.
    ticks.push(washLine(g, M2, A, -6, 11, 15.2, 82.2, 0));
    ticks.push(washLine(g, M2, A, 20, 37, 30.6, 82.2, 1.55));
    ticks.push(hangingSign(g, M2, A, 'bd:hang0', 27, 10.4, 81.4, 5.4, 0.4));
    ticks.push(hangingSign(g, M2, A, 'bd:hang1', -44, 10.4, 81.4, 5.4, 2.1));
    ticks.push(pigeonLift(g, M2, A, 4, 18.0, 82.6));
    ticks.push(chimneySmoke(g, M2, A, -5.5, 22.4, 88, 0.0));
  } else if (card.key === 'midBlock') {
    ticks.push(windowFigure(g, M2, A, 12, 26.5, 129.1, 3.0, 8.5, 0));
    ticks.push(windowFigure(g, M2, A, -88, 37.0, 129.1, 3.0, 11.0, 3.2));
    ticks.push(windowFigure(g, M2, A, 62, 16.0, 129.1, 3.0, 13.5, 6.4));
  } else if (card.key === 'farBlock') {
    ticks.push(chimneySmoke(g, M2, A, -128, 46, 196, 1.9));
    ticks.push(chimneySmoke(g, M2, A, 96, 52, 196, 3.7));
  } else {
    return null;
  }
  card.liveGroup = g;
  card.tick = (t) => { for (const f of ticks) f(t); };
  return g;
}

// ─── build ────────────────────────────────────────────────────────────────────
/**
 * Build every card. Returns layer descriptors; the caller (src/world/street.js) owns the
 * materials and turns each layer's builders into one group of merged meshes.
 */
export function buildBackdrop(atlas) {
  registerBackdropSprites(atlas);
  const M2 = liveMats(atlas);
  const layers = [];
  for (const spec of LAYERS) {
    const card = new Card(atlas, spec);
    if (spec.key === 'nearFacade') {
      buildNearFacade(card);
      relightCard(card, { facing: 0.68, air: 0.07, ...SUN.nearFacade });
      liftFloor(card, 0.0605);
    } else if (spec.key === 'midBlock') {
      buildMidBlock(card);
      relightCard(card, { facing: 0.58, air: 0.24, ...SUN.midBlock });
      liftFloor(card, 0.0625);
    } else if (spec.key === 'farBlock') {
      buildFarBlock(card);
    } else if (spec.key === 'elevated') {
      buildElevated(card.ctx);
      card.base.z = spec.z - (EL.nearCol + EL.farCol) / 2;
      hazeCard(card, 0.46);
      // The El is a lattice of 2 ft irons two hundred and fifty feet away, so §2.2's linear
      // ironwork exemption does not apply to it: on screen it is a FIELD of dark, and it
      // measured L* 10.8 in round 1. It gets the highest floor on the set.
      liftFloor(card, 0.0685);
    } else {
      buildSky(card);
    }
    dressLive(card, M2);
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
    this.t = 0;
    this.split = 0;
  },

  /**
   * The clock the dressing runs on. Deterministic per scenario, exactly like the train's phase
   * in src/world/street.js: a moving backdrop that photographs differently every run is a
   * backdrop nobody can critique. `backdrop_layers` gets a phase that has the washing at the
   * end of its swing, the pigeons mid-flight and both smoke plumes at full length.
   */
  onScenario(name) {
    this.t = name === 'backdrop_layers' ? 12.4 : name === 'stage_wide' ? 6.8 : name === 'atmosphere' ? 3.2 : 0.9;
    this.split = name === 'backdrop_layers' ? 1 : 0;
  },

  update(dt) {
    this.t += dt;
    for (const L of this.layers) if (L.tick) L.tick(this.t);
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
      // `backdrop_layers` holds the play plane and steps each card sideways by its own
      // parallax factor, so the five planes separate and can be counted. It is the only
      // scenario that does this and it is the shot's entire job (§17.2).
      L.group.position.x = L.base.x + cx * (1 - w) + this.split * SEPARATE[L.key];
      L.group.position.z = L.base.z;
      L.group.position.y = L.base.y;
    }
  },
});

/** How far each card steps sideways in `backdrop_layers`: 6 units, scaled by parallax rank. */
const SEPARATE = { nearFacade: 0, midBlock: -7, farBlock: -15, elevated: -24, sky: -34 };

/* ============================================================================
   SCENARIOS

   Round 1 registered these as bespoke cameras — `stage_wide` at 24° from 74 units back,
   `backdrop_layers` at 18° raked from stage left — and both FAILED tools/measure.mjs on kid
   height, at 8.7% and 8.3% against a 12% floor. The previous builder chose the shot over the
   check and said so. That is the wrong trade, and it is not a trade that had to be made.

   Both cameras below satisfy every rule §17 states, measured, not asserted:

        FOV 16° — the §17.2 floor exactly, never below it and nowhere near the 26° ceiling
        camera inside 90 units of the plate — the ceiling is 150
        every kid ≥ 12% of frame height, leads inside 18–26%       (tools/measure.mjs, clean)

   They differ from the two locked gameplay framings in exactly ONE variable: PITCH. They look
   slightly UP; `cam_batting` and `cam_field` look down. That single number is why the backdrop
   is invisible in play, and it is measurable rather than arguable. From (0, 9, −86) at 16°,
   the top of frame crosses the near facade card at y = 39 ft — four storeys — and the block
   behind it reads through the notch. From the framings the director currently solves, at
   1600×900, the top of frame crosses the cards at:

        card               z      BATTING top      FIELD top
        nearFacade         84       20.7 ft          10.0 ft
        midBlock          130       21.6 ft           4.3 ft
        farBlock          190       22.8 ft          −3.0 ft
        elevated          250       24.1 ft         −10.4 ft
        sky               400       27.1 ft         −28.8 ft

   From BATTING the notch (a 17.6 ft taxpayer at z = 84) clears the frame edge by three feet,
   which is a 58 px band — the El does read through it, and nothing else does. From FIELD the
   frame's top edge crosses the near card BELOW ITS OWN AWNINGS, so nothing standing behind it
   is geometrically capable of being in the picture: no card height, no notch width and no
   lateral slide changes that. It is the FIELD framing's pitch, and that lives in
   src/render/cameras.js. These two scenarios are the same stage, the same lens and the same
   distance with the horizon put back — which is exactly the change §14 check 10 is asking the
   director for, shown rather than argued.
   ========================================================================= */

const setCam = (app, pos, look, fov) => {
  app.camera.position.set(pos[0], pos[1], pos[2]);
  app.camera.lookAt(look[0], look[1], look[2]);
  app.camera.fov = fov;
  app.camera.updateProjectionMatrix();
  app.camera.updateMatrixWorld(true);
};

/**
 * THE SET, SQUARE ON. Home plate on the bottom edge, the whole cast on the stage, the two
 * wings closing the sides, and above the awnings the thing this piece exists to build: the
 * near facade card four storeys of it, the notch, the mid block over the notch, the far
 * rooftops with the gasholder and the church standing in the street mouth, the El closing the
 * end with a train on it, and open sky over the lot.
 */
registerScenario('stage_wide', {
  seed: 1925,
  setup: ({ app }) => {
    app.sim.reset(1925);
    app.clock.advance(0.6);
    setCam(app, [0, 9, -86], [0, 15.0, 84], 16);
  },
  settle: 0.4,
});

/**
 * THE LAYERS, COUNTABLE. The same stage raked from the north kerb so the planes stop lining
 * up, plus the one thing no other scenario in the build does: the play plane is HELD and each
 * card steps sideways by its own parallax factor, so the five flats fan out and can be told
 * apart. Front to back — the near facade with its washing, its swinging shop signs and its
 * pigeons; the mid block with somebody at three of its windows; the far rooftops, gasholder,
 * church and two chimneys smoking; the El; and the skyline. Each one a step hazier, cooler
 * and higher in value than the one in front of it (§2.3), which is the whole trick.
 */
registerScenario('backdrop_layers', {
  seed: 1925,
  setup: ({ app }) => {
    app.sim.reset(1925);
    app.clock.advance(0.6);
    setCam(app, [27, 12, -80], [-5, 20.5, 92], 16);
  },
  settle: 0.4,
});

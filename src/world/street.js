import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { T } from '../core/tuning.js';
import { RNG } from '../core/rng.js';
import { registerScenario } from '../core/scenarios.js';
import { FACADE, soot } from '../render/palette.js';
import {
  M, Builder, Atlas, setTone, shadeLin, texTint, litOf, rectUV, buildingTop,
  brickTexture, washTexture, registerFacadeSprites, buildTenement,
} from './facade.js';
import { registerSignSprites, buildStorefront } from './storefronts.js';
import { registerElSprites, buildTrain } from './elevated.js';
import { buildBackdrop } from './backdrop.js';

/**
 * THE SET — one mid-block stretch of a New York cross street, September 1925, staged.
 *
 * DESIGN-BIBLE §17: the game is 3D characters on a 2D stage, so this file no longer builds a
 * street. It builds the two WINGS of a set — four bays of real tenement down each side of the
 * play plane, from the corner taxpayer at z=-46 to the end of the block at z=80 — and hands
 * everything past that to src/world/backdrop.js, which stands it up as flat cards at the five
 * fixed depths in T.stage.backdrop.
 *
 * What that buys: the wings are the only architecture a kid can ever stand next to, so they
 * get the full kit — stoops, fire escapes, storefronts, ghost signs, water tanks, pigeons —
 * at four bays instead of sixteen, and the budget that used to go on a canyon nobody could
 * read at 300ft goes into the cards instead.
 *
 * The 1:1 canyon survives, because it is the whole visual identity: 60ft facade to facade,
 * 60ft of building each side, and the 16ft taxpayer on the south corner that is the only
 * reason 3:50pm sun reaches home plate. Everything is merged into seven meshes per layer and
 * nothing here casts a shadow map: the light is baked, so the only shadows on the roadway are
 * the ones the kids and the ball throw.
 */

// The wings stop at z=80; src/world/backdrop.js stands the near facade card at z=84.

// ─── the lot plan ─────────────────────────────────────────────────────────────
// Hand-authored, because composition is not something you seed a random number generator for.
// Four bays a side. Every one of them is inside T.stage.playDepth of the plate, so every one
// of them is a wall a kid can be silhouetted against.
const NORTH = [
  { st: 1, brick: 'red', shop: 'grocer', roofsign: 1 },   // the north corner taxpayer
  { st: 6, brick: 'ochre', shop: 'cigar', fe: 1, ghost: 'goldDust' },
  { st: 4, brick: 'brown', stoop: 1, fe: 1, basement: 'shoe' },
  { st: 6, brick: 'red', shop: 'fivedime', fe: 1, ghost: 'castoria', tank: 1, coop: 1 },
];
const SOUTH = [
  { st: 6, brick: 'red', shop: 'deli', fe: 1, ghost: 'castoria', tank: 1 },
  { st: 5, brick: 'brown', stoop: 1, fe: 1, basement: 'tailor' },
  { st: 6, brick: 'red', shop: 'barber', fe: 1, ghost: 'uneeda', tank: 1 },
];
const NORTH_Z0 = -20, SOUTH_Z0 = 5;
const TAX = { z0: -46, z1: 5, h: 16 };     // the corner taxpayer, DESIGN-BIBLE §3.2

const CORNICE = FACADE.cornice;            // three paints
const SASH = FACADE.sash;                  // dark green, oxblood, near-black — never white
const IRON = FACADE.iron;
const BRICKS = { red: FACADE.brick, ochre: FACADE.ochre, brown: FACADE.brickSoot };
const SPRITES = ['win:sash', 'win:shade', 'win:open', 'win:cat', 'win:sash', 'win:lean', 'win:pot', 'win:shade', 'win:sash', 'win:open', 'win:board', 'win:sash'];

function makeLots() {
  const r = new RNG(19250922);
  const lots = [];
  const build = (row, side, z0base) => {
    row.forEach((spec, i) => {
      const prev = lots.length ? lots[lots.length - 1] : null;
      const sameRow = prev && prev.side === side;
      // no two adjacent buildings may share more than one of brick / cornice / sash / iron
      let ci, si, ii, guard = 0;
      do {
        ci = r.int(0, 2); si = r.int(0, 2); ii = r.int(0, 2);
        guard++;
      } while (sameRow && guard < 20 &&
        ((ci === prev.ci) + (si === prev.si) + (ii === prev.ii) + (spec.brick === prev.brickName) > 1));
      const lot = {
        side, i, xf: side * M.facadeX, out: -side, front: side > 0 ? 'nx' : 'px',
        z0: z0base + i * M.lot, storeys: spec.st,
        brickName: spec.brick,
        brickKey: spec.brick === 'ochre' ? 'wallOchre' : spec.brick === 'brown' ? 'wallBrown' : 'wallRed',
        brickHex: BRICKS[spec.brick],
        ci, si, ii,
        corniceHex: soot(CORNICE[ci], 0.22), sashHex: SASH[si], ironHex: IRON[ii],
        stoneHex: r.chance(0.5) ? 0x8a6a54 : 0x9a9184,
        lintelHex: r.chance(0.4) ? CORNICE[ci] : (r.chance(0.5) ? 0x7d5a44 : 0x8a7f70),
        doorHex: [0x5a2a24, 0x2e4034, 0x3a2f28][r.int(0, 2)],
        bulkhead: [0x2e4034, 0x5a2a24, 0x332f2c][r.int(0, 2)],
        ground: spec.shop ? 'store' : 'stoop',
        shop: spec.shop || null,
        basement: spec.basement || null,
        fireEscape: !!spec.fe,
        stoopAt: r.chance(0.5) ? 0.30 + r.range(0, 0.05) : 0.66 + r.range(0, 0.05),
        brackets: r.int(6, 9),
        grime: 0.88 + r.range(0, 0.18),
        chimneys: [0.05, 0.95], chimneyH: 2.6 + r.range(0, 2.6), pots: r.int(3, 6),
        tank: !!spec.tank, tankZ: r.range(-4, 4),
        coop: !!spec.coop,
        pigeons: (spec.st === 6 || !!spec.coop),
        ghost: spec.ghost || null,
        bills: spec.bills || null,
        alley: !!spec.alley,
        roofsign: !!spec.roofsign,
        sprites: SPRITES.slice(r.int(0, 6)).concat(SPRITES),
        escapeProps: { level: r.int(0, 2), crate: r.int(0, 2) },
        lod: 0,
      };
      lots.push(lot);
    });
  };
  build(NORTH, 1, NORTH_Z0);
  build(SOUTH, -1, SOUTH_Z0);
  // exposed party walls: where the lot to the west is lower, this wall faces the camera and,
  // because the sun is in the west, it is the brightest big surface on the block.
  for (const lot of lots) {
    const west = lots.find((l) => l.side === lot.side && Math.abs(l.z0 + M.lot - lot.z0) < 0.5);
    const wTop = west ? buildingTop(west.storeys) : (lot.side < 0 ? TAX.h : null);
    const top = buildingTop(lot.storeys);
    if (wTop != null && top - wTop > 4) lot.exposedFrom = wTop;
    else { lot.ghost = null; lot.bills = null; }
    lot.lod = 0;   // the whole block ships in six draw calls, so nothing is worth cutting
  }
  return lots;
}

// The roadway, curbs, sidewalks, chalk and sewer castings belong to src/world/surface.js.
// This piece starts at the building line and goes up. GROUND.walkOuter is that line.

/** The corner taxpayer: one storey, 16ft, and the reason home plate is in the sun. */
function buildTaxpayer(ctx) {
  const T = ctx.b('trim'), W = ctx.b('wallRed'), S = ctx.b('sign');
  const lotBase = {
    side: -1, xf: -M.facadeX, out: 1, front: 'px', storeys: 1,
    brickKey: 'wallRed', brickHex: FACADE.brick, stoneHex: 0x8e8579,
    corniceHex: FACADE.cornice[1], sashHex: FACADE.sash[0], ironHex: FACADE.iron[0],
    doorHex: 0x5a2a24, bulkhead: 0x2e4034, lod: 0,
  };
  const shops = ['fish', 'shoe'];
  for (let i = 0; i < 2; i++) {
    const lot = { ...lotBase, z0: TAX.z0 + 0.5 + i * M.lot, shop: shops[i], ground: 'store' };
    buildStorefront(ctx, lot);
  }
  // the wall above the shopfronts, its parapet and its roof sign
  W.quad([-M.facadeX, 12.15, TAX.z1], [-M.facadeX, 12.15, TAX.z0], [-M.facadeX, TAX.h, TAX.z0], [-M.facadeX, TAX.h, TAX.z1],
    [0.94, 0.95, 1.0], [[TAX.z1 / 8, 12.15 / 8], [TAX.z0 / 8, 12.15 / 8], [TAX.z0 / 8, TAX.h / 8], [TAX.z1 / 8, TAX.h / 8]], [1, 0, 0]);
  T.box(-M.facadeX - 0.05, TAX.h, TAX.z0, -M.facadeX + 0.65, TAX.h + 1.1, TAX.z1,
    (f, n, c) => shadeLin(FACADE.cornice[1], litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.5 : 0), 'px py ny pz nz');
  T.box(-M.facadeX - 0.05, 0, TAX.z0 - 0.6, -M.facadeX + 0.2, TAX.h + 1.1, TAX.z0,
    (f, n, c) => shadeLin(FACADE.brickShade, litOf(n, c[0], c[1], c[2])), 'px pz nz');
  // flat roof, seen from the stoops
  T.box(-M.facadeX - M.depth, TAX.h - 0.2, TAX.z0, -M.facadeX + 0.1, TAX.h, TAX.z1,
    () => shadeLin(0x5a4e46, 0.36), 'py');
  const sign = ctx.atlas.get('roofsign:0');
  const zc = (TAX.z0 + TAX.z1) / 2;
  S.quad([-M.facadeX + 0.7, TAX.h + 1.2, zc + 13], [-M.facadeX + 0.7, TAX.h + 1.2, zc - 13],
    [-M.facadeX + 0.7, TAX.h + 7.4, zc - 13], [-M.facadeX + 0.7, TAX.h + 7.4, zc + 13],
    texTint(0.30), rectUV(sign), [1, 0, 0]);
  for (const pz of [zc - 12, zc, zc + 12]) {
    T.box(-M.facadeX + 0.2, TAX.h, pz - 0.16, -M.facadeX + 0.7, TAX.h + 7.4, pz + 0.16,
      () => shadeLin(0x4a4a44, 0.2), 'px nx pz nz');
  }
}

/**
 * The wings are cut off at the end of the block, so each row finishes on a raw party wall
 * looking down the cross street. Painted out, papered, and — because the sun is in the west —
 * the brightest big plane on the north side and the deepest shade on the south.
 */
function blockEndWall(ctx, lots) {
  const W = ctx.b('wallStone'), S = ctx.b('sign');
  for (const side of [1, -1]) {
    const row = lots.filter((l) => l.side === side);
    const last = row[row.length - 1];
    if (!last) continue;
    const z = last.z0 + M.lot;
    const y1 = buildingTop(last.storeys);
    const xf = last.xf, o = last.out;
    const [xa, xb] = o < 0 ? [xf, xf + M.depth] : [xf - M.depth, xf];
    const n = [0, 0, 1];
    const lit = litOf(n, (xa + xb) / 2, y1 / 2, z);
    const k = 1 + 0.30 * Math.min(1, lit / 0.4);
    W.quad([xa, 0, z], [xb, 0, z], [xb, y1, z], [xa, y1, z],
      [k * 0.98, k * 0.99, k], [[0, 0], [M.depth / 8, 0], [M.depth / 8, y1 / 8], [0, y1 / 8]], n);
    const slot = ctx.atlas.get(side > 0 ? 'ghost:uneeda' : 'ghost:castoria');
    const h = Math.min(34, y1 - 16);
    const w = Math.min(M.depth - 8, h * (slot.w / slot.h));
    const ax = o < 0 ? xf + 4 : xf - 4 - w;
    const ay = y1 - 8 - h;
    S.quad([ax, ay, z + 0.07], [ax + w, ay, z + 0.07], [ax + w, ay + h, z + 0.07], [ax, ay + h, z + 0.07],
      texTint(lit), rectUV(slot), n);
  }
}

/** A horse-walk through the ground floor: the break in the wall, without a gap in the wall. */
function alleyArch(ctx, lot) {
  const T = ctx.b('trim'), W = ctx.b(lot.brickKey);
  const o = lot.out, xf = lot.xf;
  const cz = lot.z0 + M.lot * 0.5;
  const half = 4.4, headY = 10.6, springY = 8.2;
  const X = (d0, d1) => (o < 0 ? [xf - d1, xf - d0] : [xf + d0, xf + d1]);
  // the passage, receding into the block — dark, but never black
  const deep = 26;
  const inx = o < 0 ? [xf, xf + deep] : [xf - deep, xf];
  W.box(inx[0], 0, cz - half, inx[1], headY, cz + half,
    (f, n, c) => [0.42, 0.42, 0.46], `pz nz`, 8);
  T.box(inx[0], 0, cz - half, inx[1], 0.1, cz + half, () => shadeLin(0x6e5c4c, 0, 0.30), 'py');
  T.box(inx[0], headY - 0.2, cz - half, inx[1], headY, cz + half, () => shadeLin(0x4a4038, 0, 0.35), 'ny');
  // a lit wall at the far end so the slot reads as depth, not as a hole
  const fx = o < 0 ? xf + deep : xf - deep;
  T.box(Math.min(fx, fx + o * 0.4), 0, cz - half, Math.max(fx, fx + o * 0.4), headY, cz + half,
    () => shadeLin(FACADE.brickShade, 0.24), o < 0 ? 'nx' : 'px');
  // segmental arch head, in stepped brick
  for (let i = 0; i < 9; i++) {
    const t = (i + 0.5) / 9;
    const a = (t - 0.5) * Math.PI * 0.9;
    const zz = cz + Math.sin(a) * half * 1.02;
    const yy = springY + Math.cos(a) * (headY - springY) * 1.5;
    const [ax, bx] = X(-0.05, 0.55);
    T.box(ax, yy - 0.1, zz - 0.62, bx, Math.min(yy + 1.5, headY + 1.4), zz + 0.62,
      (f, n, c) => shadeLin(lot.stoneHex, litOf(n, c[0], c[1], c[2]), f === 'ny' ? 0.4 : 0), `${lot.front} py ny pz nz`);
  }
  // an iron gate, standing open, and a barrel nobody has moved since Tuesday
  const [ga, gb] = X(0.1, 0.24);
  for (let z = cz - half + 0.3; z < cz - half + 2.4; z += 0.42) {
    T.box(ga, 0, z, gb, 7.2, z + 0.07, () => shadeLin(lot.ironHex, 0.1, 0.15), 'px nx pz nz');
  }
  T.cyl(o < 0 ? xf + 3.4 : xf - 3.4, cz + 2.6, 1.05, 0, 2.9, 9,
    (n, c) => shadeLin(0x7a6244, litOf(n, c[0], c[1], c[2]) * 0.4, 0.2));
  return { z0: cz - half, z1: cz + half, y0: 0, y1: headY, noStreak: true };
}

// ─── the system ───────────────────────────────────────────────────────────────
// §17.4: the camera CUTS, it does not fly. These are locked framings, nothing more.
const DEFAULT_CAM = { pos: [0, 12, -34], look: [0, 4, 30], fov: 46 };
const BLOCK_CAM = { pos: [0, 40, -58], look: [0.5, 44, 84], fov: 20 };
const DETAIL_CAM = { pos: [-14, 9, 26], look: [32, 35, 62], fov: 26 };

export default registerSystem({
  name: 'street',
  order: 10,

  init(app) {
    const R = app.stage.renderer;
    setTone(R.toneMapping === THREE.ACESFilmicToneMapping, R.toneMappingExposure ?? 1);

    const atlas = new Atlas(2048);
    registerFacadeSprites(atlas);
    registerSignSprites(atlas);
    registerElSprites(atlas);

    const builders = new Map();
    const ctx = {
      atlas,
      b(key) {
        let bl = builders.get(key);
        if (!bl) { bl = new Builder(key); builders.set(key, bl); }
        return bl;
      },
    };

    // ── the wings ──────────────────────────────────────────────────────────
    const lots = makeLots();
    for (const lot of lots) {
      if (lot.alley) lot.holes = [alleyArch(ctx, lot)];
      buildTenement(ctx, lot);
      if (lot.ground === 'store') buildStorefront(ctx, lot);
    }
    buildTaxpayer(ctx);
    blockEndWall(ctx, lots);

    // ── the cards ──────────────────────────────────────────────────────────
    const layers = buildBackdrop(atlas);

    const atlasTex = atlas.texture();
    const mats = {
      wallRed: new THREE.MeshBasicMaterial({ map: brickTexture(FACADE.brick, FACADE.mortar, 11), vertexColors: true }),
      wallOchre: new THREE.MeshBasicMaterial({ map: brickTexture(FACADE.ochre, 0xbaa88c, 29), vertexColors: true }),
      wallBrown: new THREE.MeshBasicMaterial({ map: brickTexture(FACADE.brickSoot, 0x9c8a74, 47), vertexColors: true }),
      wallStone: new THREE.MeshBasicMaterial({ map: washTexture(FACADE.partyWall, 5), vertexColors: true }),
      trim: new THREE.MeshBasicMaterial({ vertexColors: true }),
      sign: new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 }),
    };
    this.mats = mats;

    const meshesOf = (map, tag, renderOrder) => {
      const out = [];
      for (const [key, b] of map) {
        if (!b.count) continue;
        const mesh = b.toMesh(mats[key] || mats.trim, `${tag}:${key}`);
        mesh.castShadow = false; mesh.receiveShadow = false;
        mesh.renderOrder = key === 'sign' ? (renderOrder ?? 1) : 0;
        out.push(mesh);
      }
      return out;
    };

    const group = new THREE.Group();
    group.name = 'street';
    let tris = 0;
    for (const m of meshesOf(builders, 'street')) { tris += m.geometry.attributes.position.count / 3; group.add(m); }
    app.scene.add(group);

    // Each card is one group so it can slide on a cut. Render far to near: the sky card is a
    // wall of haze and every layer in front of it is meant to paint over it.
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      const g = new THREE.Group();
      g.name = `backdrop:${L.key}`;
      for (const m of meshesOf(L.builders, `backdrop:${L.key}`)) {
        tris += m.geometry.attributes.position.count / 3;
        g.add(m);
      }
      g.position.copy(L.base);
      L.group = g;
      app.scene.add(g);
    }

    // the one moving thing at the end of the street
    const trainB = buildTrain(ctx);
    this.train = trainB.toMesh(mats.sign, 'street:train');
    this.train.matrixAutoUpdate = true;
    this.train.castShadow = false;
    const el = layers.find((L) => L.key === 'elevated');
    (el && el.group ? el.group : group).add(this.train);

    this.group = group;
    this.layers = layers;
    this.lots = lots;
    this.tris = Math.round(tris);
    this.t = 0;
  },

  onScenario(name, app) {
    // the train's phase is part of the frame, so it has to be deterministic per scenario
    this.t = name === 'stage_wide' || name === 'block_tour' ? 1.73 : name === 'backdrop_layers' ? 3.9 : 0;
  },

  update(dt, app) {
    this.t += dt;
    if (this.train) {
      // one train every couple of minutes, and it is the only thing in the backdrop that moves
      const x = ((this.t * 26 + 132) % 520) - 300;
      this.train.position.set(x, 0, 0);
    }
  },
});

// ─── scenarios ────────────────────────────────────────────────────────────────
function lock(app, cam) {
  app.camera.position.set(...cam.pos);
  app.camera.lookAt(...cam.look);
  app.camera.fov = cam.fov;
  app.camera.updateProjectionMatrix();
}

/** The block from a fourth-floor window: the set above the awnings — wings, notch, El, sky. */
registerScenario('block_tour', {
  seed: 1925,
  setup: ({ app }) => { app.sim.reset(1925); lock(app, BLOCK_CAM); },
  settle: 0.4,
});

/** Close on the wing relief, looking up: cornice, fire escape, sills, sign band, ghost. */
registerScenario('facade_detail', {
  seed: 1925,
  setup: ({ app }) => { app.sim.reset(1925); lock(app, DETAIL_CAM); },
  settle: 0.4,
});

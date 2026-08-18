import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { T } from '../core/tuning.js';
import { RNG } from '../core/rng.js';
import { registerScenario } from '../core/scenarios.js';
import { PAVEMENT, FACADE, AIR, CHALK, INK } from '../render/palette.js';
import {
  M, Builder, Atlas, setTone, tc, tcCss, hexToLin, linToCss, scaleLin, mixLin,
  shadeLin, texTint, litOf, occlusion, rectUV, panel, storeyTop, buildingTop, FACE_N,
  brickTexture, washTexture, registerFacadeSprites, buildTenement,
} from './facade.js';
import { SHOPS, registerSignSprites, buildStorefront } from './storefronts.js';
import { EL, registerElSprites, buildElevated, buildTrain } from './elevated.js';

/**
 * The block: one mid-block stretch of a New York cross street, September 1925.
 *
 * 60ft facade to facade, 60ft of building each side — the 1:1 canyon that is the whole visual
 * identity. Twenty-one 25ft lots, no gaps, party wall to party wall. A one-storey taxpayer on
 * the south corner behind the camera, which is what lets the 3:50pm sun onto home plate. The
 * Third Avenue El closing the far end.
 *
 * Everything is merged into seven meshes. Nothing here casts a shadow map: the light is baked,
 * so the only shadows on the roadway are the ones the kids and the ball throw.
 */

const ROAD_HALF = M.roadHalf;
const WALK = M.walkY;
const SEWER = 95;                 // §1.3 — sewers 95ft apart, and every boast in the game agrees

// ─── the lot plan ─────────────────────────────────────────────────────────────
// Hand-authored, because composition is not something you seed a random number generator for.
const NORTH = [
  { st: 5, brick: 'red', shop: 'grocer' },
  { st: 6, brick: 'ochre', shop: 'cigar', fe: 1 },
  { st: 4, brick: 'red', stoop: 1, fe: 1, basement: 'shoe' },
  { st: 6, brick: 'red', stoop: 1, fe: 1, ghost: 'castoria', tank: 1 },
  { st: 5, brick: 'ochre', shop: 'barber', fe: 1 },
  { st: 6, brick: 'red', shop: 'fivedime', fe: 1, coop: 1 },
  { st: 4, brick: 'ochre', stoop: 1, alley: 1, bills: 'bills' },
  { st: 6, brick: 'red', shop: 'lunch', fe: 1, ghost: 'uneeda', tank: 1 },
  { st: 5, brick: 'red', stoop: 1, fe: 1 },
  { st: 6, brick: 'ochre', shop: 'ice', fe: 1, tank: 1 },
];
const SOUTH = [
  { st: 6, brick: 'red', shop: 'deli', fe: 1, ghost: 'goldDust', tank: 1 },
  { st: 5, brick: 'ochre', stoop: 1, fe: 1, basement: 'tailor' },
  { st: 4, brick: 'red', shop: 'tailor' },
  { st: 6, brick: 'red', stoop: 1, fe: 1, ghost: 'uneeda', coop: 1 },
  { st: 5, brick: 'ochre', shop: 'laundry', fe: 1 },
  { st: 6, brick: 'red', stoop: 1, fe: 1, tank: 1 },
  { st: 4, brick: 'ochre', shop: 'shoe' },
  { st: 6, brick: 'red', shop: 'fish', fe: 1, ghost: 'castoria', tank: 1 },
  { st: 5, brick: 'red', stoop: 1, fe: 1 },
];
const NORTH_Z0 = -15, SOUTH_Z0 = 5;
const TAX = { z0: -46, z1: 5, h: 16 };     // the corner taxpayer, DESIGN-BIBLE §3.2

const CORNICE = FACADE.cornice;            // three paints
const SASH = FACADE.sash;                  // dark green, oxblood, near-black — never white
const IRON = FACADE.iron;
const BRICKS = { red: FACADE.brick, ochre: FACADE.ochre, brown: 0x8a5a46 };
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
        brickKey: spec.brick === 'ochre' ? 'wallOchre' : 'wallRed',
        brickHex: BRICKS[spec.brick],
        ci, si, ii,
        corniceHex: CORNICE[ci], sashHex: SASH[si], ironHex: IRON[ii],
        stoneHex: r.chance(0.5) ? 0x9a8f7e : 0x8e8579,
        lintelHex: r.chance(0.35) ? CORNICE[ci] : 0x8e8579,
        doorHex: [0x5a2a24, 0x2e4034, 0x3a2f28][r.int(0, 2)],
        bulkhead: [0x2e4034, 0x5a2a24, 0x332f2c][r.int(0, 2)],
        ground: spec.shop ? 'store' : 'stoop',
        shop: spec.shop || null,
        basement: spec.basement || null,
        fireEscape: !!spec.fe,
        stoopAt: 0.5 + r.range(-0.06, 0.06),
        brackets: r.int(6, 9),
        chimneys: [0.04, 0.96], chimneyH: 3.4 + r.range(0, 2.2), pots: r.int(3, 6),
        tank: !!spec.tank, tankZ: r.range(-4, 4),
        coop: !!spec.coop,
        ghost: spec.ghost || null,
        bills: spec.bills || null,
        alley: !!spec.alley,
        sprites: SPRITES.slice(r.int(0, 6)).concat(SPRITES),
        escapeProps: { level: r.int(0, 2), crate: r.int(0, 2) },
        lod: 0,
      };
      lot.lod = 0;
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
    lot.lod = lot.z0 > 130 ? 1 : 0;
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
const TOUR = {
  pos: [[19, 30, -42], [12, 17, 14], [-13, 21, 78], [-4, 15, 146], [0, 13, 196]],
  look: [[2, 17, 62], [-4, 14, 108], [27, 26, 150], [8, 26, 232], [0, 24, 262]],
  time: 13,
};
const DEFAULT_CAM = { pos: [0, 12, -34], look: [0, 4, 30] };

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

    const lots = makeLots();
    for (const lot of lots) {
      if (lot.alley) lot.holes = [alleyArch(ctx, lot)];
      buildTenement(ctx, lot);
      if (lot.ground === 'store') buildStorefront(ctx, lot);
    }
    buildTaxpayer(ctx);
    buildElevated(ctx);

    const atlasTex = atlas.texture();
    const mats = {
      wallRed: new THREE.MeshBasicMaterial({ map: brickTexture(FACADE.brick, FACADE.mortar, 11), vertexColors: true }),
      wallOchre: new THREE.MeshBasicMaterial({ map: brickTexture(FACADE.ochre, 0xbaa88c, 29), vertexColors: true }),
      wallStone: new THREE.MeshBasicMaterial({ map: washTexture(FACADE.partyWall, 5), vertexColors: true }),
      trim: new THREE.MeshBasicMaterial({ vertexColors: true }),
      sign: new THREE.MeshBasicMaterial({ map: atlasTex, vertexColors: true, alphaTest: 0.5 }),
    };

    const group = new THREE.Group();
    group.name = 'street';
    let tris = 0;
    for (const [key, b] of builders) {
      const mesh = b.toMesh(mats[key] || mats.trim, `street:${key}`);
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.renderOrder = key === 'sign' ? 1 : 0;
      tris += b.count / 3;
      group.add(mesh);
    }

    // the one moving thing at the end of the street
    const trainB = buildTrain(ctx);
    this.train = trainB.toMesh(mats.sign, 'street:train');
    this.train.matrixAutoUpdate = true;
    this.train.castShadow = false;
    group.add(this.train);

    app.scene.add(group);
    this.group = group;
    this.lots = lots;
    this.tris = Math.round(tris);
    this.t = 0;
    this.tour = -1;
    this.curvePos = new THREE.CatmullRomCurve3(TOUR.pos.map((p) => new THREE.Vector3(...p)));
    this.curveLook = new THREE.CatmullRomCurve3(TOUR.look.map((p) => new THREE.Vector3(...p)));
  },

  onScenario(name, app) {
    this.t = 0;
    if (name === 'block_tour') { this.tour = 0; this.applyTour(app, 0); }
    else {
      if (this.tour >= 0 || this.camDirty) {
        app.camera.position.set(...DEFAULT_CAM.pos);
        app.camera.lookAt(...DEFAULT_CAM.look);
      }
      this.tour = -1;
      this.camDirty = name === 'facade_detail' || name === 'wide';
    }
  },

  applyTour(app, u) {
    const p = this.curvePos.getPoint(Math.min(0.999, u));
    const l = this.curveLook.getPoint(Math.min(0.999, u));
    app.camera.position.copy(p);
    app.camera.lookAt(l);
    this.camDirty = true;
  },

  update(dt, app) {
    this.t += dt;
    if (this.train) {
      const x = ((this.t * 26 + 132) % 520) - 300;
      this.train.position.set(x, 0, 0);
    }
    if (this.tour >= 0) {
      this.tour += dt / TOUR.time;
      if (this.tour > 1) this.tour = 0;
      this.applyTour(app, this.tour);
    }
  },
});

// ─── scenarios ────────────────────────────────────────────────────────────────
registerScenario('block_tour', {
  seed: 1925,
  setup: ({ app }) => { app.sim.reset(1925); },
  settle: 0.4,
});

registerScenario('facade_detail', {
  seed: 1925,
  setup: ({ app }) => {
    app.sim.reset(1925);
    app.camera.position.set(-15.5, 25.5, 44);
    app.camera.lookAt(30, 28, 104);
  },
  settle: 0.4,
});

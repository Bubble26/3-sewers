import * as THREE from 'three';
import { FACADE, PAVEMENT, AIR } from '../render/palette.js';
import { RNG } from '../core/rng.js';
import { M, Builder, tcCss, hexToLin, linToCss, scaleLin, shadeLin, texTint, litOf, rectUV, FACE_N } from './facade.js';

/**
 * The far end of the block — the Third Avenue El (IRT), crossing the mouth of the street.
 *
 * PERIOD-REFERENCE §2.9: the El is a *presence at the end of the corridor*, never over the
 * game. Paired lattice columns at the curb lines, a deck low enough that the second-floor
 * windows look straight into passing trains, permanent brown twilight underneath, and a train
 * every couple of minutes. It is also what stops the view: from a tenement cross street in
 * 1925 you do not see a skyline, you see the El.
 */
export const EL = {
  nearCol: 254, farCol: 296,     // the two column lines, at the avenue's curbs
  deckY: 22.5,                   // underside — a low ceiling
  railY: 26.6,
  bay: 46,                       // longitudinal column spacing
  avenueNear: 236, avenueFar: 337,
  farRow: 337,                   // the frontage that closes the view
};

export function registerElSprites(atlas) {
  // an opaque white cell, for geometry that shares the atlas material but carries no art
  atlas.add('solid', 16, 16, (g, w, h) => { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h); });
  // riveted lattice web — real Els are mostly holes, and that is what reads at 300ft
  atlas.add('lattice', 48, 96, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = tcCss(0x4a4440);
    g.lineWidth = 6;
    for (let i = -1; i < 5; i++) {
      g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32 + 32); g.stroke();
      g.beginPath(); g.moveTo(w, i * 32); g.lineTo(0, i * 32 + 32); g.stroke();
    }
    g.fillStyle = tcCss(0x4a4440);
    g.fillRect(0, 0, 7, h); g.fillRect(w - 7, 0, 7, h);
  });
  // the side of an El car: windows lit against the gloom under the deck
  atlas.add('elcar', 448, 84, (g, w, h) => {
    g.fillStyle = tcCss(0x2f3a34); g.fillRect(0, 0, w, h);
    g.fillStyle = tcCss(0x243029); g.fillRect(0, h * 0.72, w, h * 0.28);
    g.fillStyle = tcCss(0x3a4740); g.fillRect(0, 0, w, h * 0.1);
    for (let i = 0; i < 9; i++) {
      const x = 24 + i * 54;
      g.fillStyle = tcCss(0xe8d9a8);
      g.fillRect(x, h * 0.22, 34, h * 0.40);
      g.fillStyle = tcCss(0x6b5a44);
      g.fillRect(x + 6, h * 0.28, 22, h * 0.22);            // a passenger, in silhouette
      g.fillStyle = tcCss(0x2f3a34);
      g.fillRect(x - 4, h * 0.22, 4, h * 0.40);
    }
    g.fillStyle = tcCss(0xe0d0a0);
    g.fillRect(w * 0.42, h * 0.06, w * 0.16, h * 0.09);
  });
  // a distant avenue facade: windows painted in, because at 350ft that is all a window is
  atlas.add('farwall', 112, 224, (g, w, h) => {
    const r = new RNG(88);
    g.fillStyle = tcCss(0x8a4a3a); g.fillRect(0, 0, w, h);
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 4; col++) {
        const lit = r.chance(0.18);
        g.fillStyle = tcCss(lit ? 0xc9b48b : 0x53483f);
        g.fillRect(10 + col * 30, 14 + row * 26, 15, 18);
        g.fillStyle = tcCss(0x6b6259);
        g.fillRect(8 + col * 30, 10 + row * 26, 19, 4);
      }
    }
    g.fillStyle = tcCss(0x6b4235); g.fillRect(0, 0, w, 10);
  });
}

function latticeColumn(ctx, x, z, y1) {
  const T = ctx.b('trim'), S = ctx.b('sign');
  const A = ctx.atlas;
  const half = 1.15;
  const iron = (f, n, c) => shadeLin(0x3f3a36, litOf(n, c[0], c[1], c[2]) * 0.8, 0.05);
  // four corner angles
  for (const dx of [-half, half]) {
    for (const dz of [-half, half]) {
      T.box(x + dx - 0.16, 0, z + dz - 0.16, x + dx + 0.16, y1, z + dz + 0.16, iron, 'px nx pz nz');
    }
  }
  // latticed web on all four faces
  const uv = rectUV(A.get('lattice'));
  const lit = texTint(0.18, 0.1);
  const rep = Math.max(1, Math.round(y1 / 5.5));
  for (let i = 0; i < rep; i++) {
    const a = (i / rep) * y1, b = ((i + 1) / rep) * y1;
    S.quad([x - half, a, z - half], [x + half, a, z - half], [x + half, b, z - half], [x - half, b, z - half], lit, uv, [0, 0, -1]);
    S.quad([x + half, a, z + half], [x - half, a, z + half], [x - half, b, z + half], [x + half, b, z + half], lit, uv, [0, 0, 1]);
    S.quad([x - half, a, z + half], [x - half, a, z - half], [x - half, b, z - half], [x - half, b, z + half], lit, uv, [-1, 0, 0]);
    S.quad([x + half, a, z - half], [x + half, a, z + half], [x + half, b, z + half], [x + half, b, z - half], lit, uv, [1, 0, 0]);
  }
  // wide cast base, bolted through the sidewalk, with its permanent oily halo
  T.box(x - half - 0.5, 0, z - half - 0.5, x + half + 0.5, 1.6, z + half + 0.5, iron, 'px nx py pz nz');
  T.box(x - half - 1.1, 0.02, z - half - 1.1, x + half + 1.1, 0.1, z + half + 1.1,
    () => shadeLin(0x4a4038, 0, 0.2), 'py');
}

/** The whole far end: the El, the avenue under it, and the frontage that closes the view. */
export function buildElevated(ctx) {
  const T = ctx.b('trim'), S = ctx.b('sign'), W = ctx.b('wallRed');
  const A = ctx.atlas;
  const r = new RNG(1925);
  const iron = (f, n, c) => shadeLin(0x413b37, litOf(n, c[0], c[1], c[2]) * 0.75, 0.05);

  for (let x = -184; x <= 184; x += EL.bay) {
    latticeColumn(ctx, x, EL.nearCol, EL.deckY);
    latticeColumn(ctx, x, EL.farCol, EL.deckY);
    // transverse girder, riveted plate, spanning the pair
    T.box(x - 1.4, EL.deckY, EL.nearCol - 1.4, x + 1.4, EL.deckY + 2.6, EL.farCol + 1.4, iron, 'px nx py ny pz nz');
    // knee braces
    for (const [z, s] of [[EL.nearCol, 1], [EL.farCol, -1]]) {
      T.quad([x - 1.2, EL.deckY - 5.5, z], [x - 1.2, EL.deckY, z + s * 5.5], [x - 1.2, EL.deckY, z], [x - 1.2, EL.deckY - 5.5, z],
        shadeLin(0x413b37, 0.1), [[0, 0], [1, 0], [1, 1], [0, 1]], [-1, 0, 0]);
      T.quad([x + 1.2, EL.deckY - 5.5, z], [x + 1.2, EL.deckY, z], [x + 1.2, EL.deckY, z + s * 5.5], [x + 1.2, EL.deckY - 5.5, z],
        shadeLin(0x413b37, 0.1), [[0, 0], [1, 0], [1, 1], [0, 1]], [1, 0, 0]);
    }
  }
  // longitudinal plate girders and the deck between them
  for (const z of [EL.nearCol, EL.farCol]) {
    T.box(-186, EL.deckY + 2.6, z - 1.5, 186, EL.railY, z + 1.5, iron, 'px nx py ny pz nz');
  }
  T.box(-186, EL.deckY + 2.2, EL.nearCol, 186, EL.deckY + 2.6, EL.farCol, iron, 'py ny');
  // ties and rails
  for (let x = -186; x < 186; x += 2.2) {
    T.box(x, EL.railY, EL.nearCol + 1.5, x + 1.1, EL.railY + 0.55, EL.farCol - 1.5,
      () => shadeLin(0x4a3b30, 0.25), 'py pz nz');
  }
  for (const z of [EL.nearCol + 7, EL.nearCol + 12, EL.farCol - 12, EL.farCol - 7]) {
    T.box(-186, EL.railY + 0.55, z - 0.2, 186, EL.railY + 1.05, z + 0.2,
      () => shadeLin(0x8a8578, 0.5), 'px nx py pz nz');
  }
  // guard rail along the deck edges
  for (const z of [EL.nearCol - 1.6, EL.farCol + 1.6]) {
    T.box(-186, EL.railY + 1.6, z - 0.12, 186, EL.railY + 1.8, z + 0.12, iron, 'px nx py ny pz nz');
    for (let x = -186; x < 186; x += 7) T.box(x, EL.railY, z - 0.09, x + 0.18, EL.railY + 1.8, z + 0.09, iron, 'px nx pz nz');
  }

  // the avenue frontage that closes the view: a wall of building, hazed and stepped
  let x = -190;
  let i = 0;
  while (x < 190) {
    const w = 22 + r.range(0, 16);
    const h = 42 + r.range(0, 34) + (Math.abs(x) < 40 ? 22 : 0);
    const d = 30;
    const brick = r.chance(0.3) ? 0xc8924e : 0x8a4a3a;
    W.box(x, 0, EL.farRow, x + w - 1.2, h, EL.farRow + d,
      (f, n, c) => {
        const k = f === 'nz' ? 1.0 : 0.82;
        return [k, k, k];
      }, 'nz py', 8);
    const uv = rectUV(A.get('farwall'));
    const rows = Math.max(1, Math.round(h / 40));
    for (let k = 0; k < rows; k++) {
      const a = (k / rows) * h, b = ((k + 1) / rows) * h;
      S.quad([x + w - 1.2, a, EL.farRow - 0.1], [x, a, EL.farRow - 0.1], [x, b, EL.farRow - 0.1], [x + w - 1.2, b, EL.farRow - 0.1],
        texTint(0.30), uv, [0, 0, -1]);
    }
    // cornice
    T.box(x - 0.6, h, EL.farRow - 2.2, x + w - 0.6, h + 2.2, EL.farRow + 1,
      () => shadeLin(r.chance(0.5) ? 0x4c4a3c : 0x7a4a34, 0.34), 'nz py ny pz');
    // a tank or two on the taller ones, where city pressure cannot reach
    if (h > 66 && i % 2 === 0) {
      const tx = x + w * 0.5, tz = EL.farRow + 12;
      for (const dx of [-4, 4]) for (const dz of [-4, 4]) {
        T.box(tx + dx - 0.3, h, tz + dz - 0.3, tx + dx + 0.3, h + 13, tz + dz + 0.3, () => shadeLin(0x6b5a44, 0.2), 'px nx pz nz');
      }
      T.cyl(tx, tz, 5.4, h + 13, h + 23, 12, (n, c) => shadeLin(0x8e8579, litOf(n, c[0], c[1], c[2]) * 0.8), '');
      T.cyl(tx, tz, 5.6, h + 22.4, h + 23.4, 12, (n, c) => shadeLin(0x4a4038, 0.2), '');
    }
    x += w; i++;
  }
  // the avenue roadway, in permanent brown twilight under the deck
  T.box(-190, 0.01, EL.avenueNear, 190, 0.03, EL.avenueFar, () => shadeLin(0x6e5c4c, 0, 0.22), 'py');
}

/** A train, as its own mesh, because it is the one thing at the end of the street that moves. */
export function buildTrain(ctx) {
  const B = new Builder('train');
  const A = ctx.atlas;
  const slot = A.get('elcar');
  const cars = 4, len = 47, gap = 2.5;
  for (let c = 0; c < cars; c++) {
    const x0 = c * (len + gap), x1 = x0 + len;
    const z0 = EL.nearCol + 4.5, z1 = EL.nearCol + 14.5;
    const y0 = EL.railY + 1.0, y1 = y0 + 9.2;
    const body = (f, n, cc) => shadeLin(0x2f3a34, litOf(n, cc[0], cc[1], cc[2]) * 0.8, f === 'ny' ? 0.3 : 0);
    const solid = A.get('solid');
    B.box(x0, y0, z0, x1, y1, z1, body, 'py ny pz nz px nx', 8, solid);
    // the lettered, lit side of the car
    B.quad([x1, y0 + 1.4, z0 - 0.05], [x0, y0 + 1.4, z0 - 0.05], [x0, y1 - 0.8, z0 - 0.05], [x1, y1 - 0.8, z0 - 0.05],
      texTint(0.22), rectUV(slot), [0, 0, -1]);
    // clerestory roof and trucks
    B.box(x0 + 1, y1, z0 + 1.6, x1 - 1, y1 + 1.1, z1 - 1.6, (f, n, cc) => shadeLin(0x3a4740, litOf(n, cc[0], cc[1], cc[2])), 'py pz nz px nx', 8, solid);
    for (const tx of [x0 + 7, x1 - 7]) {
      B.box(tx - 3, y0 - 1.1, z0 + 1.5, tx + 3, y0, z1 - 1.5, () => shadeLin(0x2a2724, 0, 0.2), 'py ny pz nz px nx', 8, solid);
    }
  }
  return B;
}

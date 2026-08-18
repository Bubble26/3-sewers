import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { T } from '../core/tuning.js';
import { RNG } from '../core/rng.js';
import { CHALK, INK, PAVEMENT, AIR, soot, sunlit } from '../render/palette.js';
import {
  GROUND, roadHeight, hex, mixHex, makeCanvas, canvasTexture,
  slabText, chalkText, chalkStroke, arcText, mat, texMat, outline, addCollider, addSewer,
} from './props.js';
import './props.js';
import './vehicles.js';

/* =============================================================================
 * THE PLAYING SURFACE
 *
 * Sheet asphalt, patched in mismatched shades, laid over an older Belgian
 * block base that surfaces through at the gutter line and in one worn-out
 * patch mid-block.  It is crowned — humped in the middle, dished at the
 * gutters — and the crown is the brightest ground in the frame, because that
 * is both what a scoured roadway looks like and what Law 1 asks for.
 *
 * Everything on it is painted in WORLD COORDINATES into a small number of
 * canvases, so a tar seam that crosses a texture boundary still lines up.
 * ========================================================================== */

const PLATE_Z = T.street.plateZ;          // home plate: a sewer casting
const SEWER_SPACING = 95;                 // §1.3 — one sewer, and it never moves
const HALF = 24;                          // the paved deck runs x -24..24

/* --- the wear pattern, authored once, painted into every deck ------------- */

/**
 * Lettering that lies on the ground.  The paving canvases map canvas +x to
 * world +x and canvas +y to world +z, but the game camera looks up the block
 * from behind home plate, where world +x runs to screen LEFT — so anything
 * written flat has to be turned through half a turn or it reads backwards.
 */
function groundText(g, text, px, py, size, opts = {}) {
  g.save();
  g.translate(px, py);
  g.rotate(Math.PI);
  chalkText(g, text, 0, 0, size, { align: 'center', ...opts });
  g.restore();
}

/** irregular blob path in world feet */
function blob(g, X, Z, cx, cz, rx, rz, r, wobble = 0.3, pts = 14) {
  g.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = i / pts * Math.PI * 2;
    const k = 1 + (r.next() - 0.5) * wobble * 2;
    const wx = cx + Math.cos(a) * rx * k, wz = cz + Math.sin(a) * rz * k;
    if (i === 0) g.moveTo(X(wx), Z(wz)); else g.lineTo(X(wx), Z(wz));
  }
  g.closePath();
}

/** a wandering polyline in world feet */
function wander(r, x0, z0, x1, z1, amp, steps = 14) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const nx = -(z1 - z0), nz = (x1 - x0);
    const l = Math.hypot(nx, nz) || 1;
    const w = Math.sin(t * Math.PI) * (r.next() - 0.5) * amp * 2;
    out.push([x0 + (x1 - x0) * t + (nx / l) * w, z0 + (z1 - z0) * t + (nz / l) * w]);
  }
  return out;
}

/**
 * Authored roadway colours.  Every one is derived from the master palette —
 * the pavement family pushed a little way toward the direct-sun tint, because
 * we bake the light in rather than shipping a physically-based renderer, and
 * a roadway lit by a strip of sky plus a warm bounce off sunlit brick is
 * warm taupe, not grey.
 */
const ROAD = {
  base: sunlit(PAVEMENT.asphaltShade, 0.16),
  warm: sunlit(PAVEMENT.asphaltWarm, 0.16),
  dark: sunlit(PAVEMENT.asphaltDark, 0.12),
  crown: sunlit(PAVEMENT.blockCrown, 0.16),
  block: sunlit(PAVEMENT.belgianBlock, 0.14),
  blockCrown: sunlit(PAVEMENT.blockCrown, 0.22),
  tar: soot(PAVEMENT.asphaltDark, 0.30),
  oil: soot(PAVEMENT.asphaltDark, 0.22),
};

/**
 * Belgian block: tooled granite setts about 5 in across the traffic direction
 * and 9 in along the course, laid in courses that run ACROSS the street, with
 * tar joints and a wear-polished crown on every high point.
 */
function belgianBlockField(g, X, Z, K, x0, x1, z0, z1, seed, polish = 0) {
  const r = new RNG(seed);
  const long = 0.78, thin = 0.42;                // across the street x along it
  g.save();
  g.beginPath(); g.rect(X(x0) - 1, Z(z0) - 1, (x1 - x0) * K + 2, (z1 - z0) * K + 2); g.clip();
  g.fillStyle = hex(soot(ROAD.block, 0.58));     // the tar in the joints
  g.fillRect(X(x0) - 1, Z(z0) - 1, (x1 - x0) * K + 2, (z1 - z0) * K + 2);
  let row = 0;
  for (let z = z0 - thin; z < z1; z += thin) {
    const off = (row % 2) * long * 0.5;
    for (let x = x0 - long; x < x1 + long; x += long) {
      const t = r.next();
      let c = mixHex(soot(ROAD.block, 0.22), ROAD.blockCrown, t * 0.95);
      if (polish > 0 && r.next() < polish) c = ROAD.blockCrown;
      c = mixHex(c, soot(ROAD.block, 0.42), r.range(0, 0.45));
      g.fillStyle = hex(c);
      const px = X(x + off) + 1, pz = Z(z) + 1;
      g.fillRect(px, pz, long * K - 1.8, thin * K - 1.8);
      g.fillStyle = `rgba(238,228,208,${0.10 + t * 0.20})`;   // polished silver crown
      g.fillRect(px + 1.2, pz + 1.2, long * K - 5, Math.max(1.2, thin * K * 0.30));
    }
    row++;
  }
  g.restore();
}

/** ragged asphalt torn back over the block, so the edge is never a rectangle */
function featherEdge(g, X, Z, K, x0, x1, z0, z1, seed, colour) {
  const r = new RNG(seed);
  g.fillStyle = hex(colour);
  const per = 90;
  for (let i = 0; i < per; i++) {
    const edge = i % 4;
    const wx = edge < 2 ? (edge ? x1 : x0) + r.range(-0.35, 0.35) : r.range(x0, x1);
    const wz = edge < 2 ? r.range(z0, z1) : (edge === 3 ? z1 : z0) + r.range(-0.35, 0.35);
    g.globalAlpha = r.range(0.65, 1.0);
    const rad = r.range(0.28, 1.05);
    blob(g, X, Z, wx, wz, rad, rad * r.range(0.7, 1.4), r, 0.6, 9);
    g.fill();
  }
  // and a couple of islands of asphalt still clinging in the middle
  for (let i = 0; i < 5; i++) {
    g.globalAlpha = r.range(0.5, 0.9);
    blob(g, X, Z, r.range(x0, x1), r.range(z0, z1), r.range(0.4, 1.3), r.range(0.4, 1.3), r, 0.5, 9);
    g.fill();
  }
  g.globalAlpha = 1;
}

/**
 * Paint one band of roadway.  minX/minZ + spans describe the world rectangle
 * this canvas covers; every feature below is expressed in feet.
 */
function paintRoad(g, S, minX, spanX, minZ, spanZ) {
  const K = S / spanX, KZ = S / spanZ;
  const X = (wx) => (wx - minX) * K;
  const Z = (wz) => (wz - minZ) * KZ;

  /* 1. base asphalt --------------------------------------------------- */
  g.fillStyle = hex(ROAD.base);
  g.fillRect(0, 0, S, S);
  {
    const r = new RNG(4001);
    for (let i = 0; i < 760; i++) {                 // mottle: warm and cool blotches
      const cx = r.range(-HALF, HALF), cz = r.range(-45, 165);
      g.globalAlpha = r.range(0.07, 0.20);
      g.fillStyle = hex(r.chance(0.58) ? ROAD.warm : ROAD.dark);
      blob(g, X, Z, cx, cz, r.range(0.9, 3.6), r.range(0.9, 3.6), r, 0.45, 9);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  /* 2. Belgian block, surfacing through where the asphalt has gone ---- */
  const FIELDS = [
    [-22.4, -18.6, -45, 165, 71, 0.14],            // the gutter line, both sides
    [18.6, 22.4, -45, 165, 73, 0.14],
    [-8.5, 5.5, 56, 78, 77, 0.42],                 // the worn-out patch mid-block
    [-5.5, 4.5, 36, 47, 85, 0.36],                 // and where the pitcher stands
    [-3.8, 2.4, -4.2, 4.6, 79, 0.52],              // scoured bare around home plate
    [-12.5, -6.5, 118, 130, 81, 0.3],
    [10.5, 15.0, 30, 39, 83, 0.22],
  ];
  for (const [a, b, c, d, seed, pol] of FIELDS) {
    belgianBlockField(g, X, Z, K, a, b, c, d, seed, pol);
    featherEdge(g, X, Z, K, a, b, c, d, seed + 500, ROAD.base);
  }

  /* 3. asphalt patches: cut, filled, and every one a different age ----- */
  {
    const r = new RNG(5150);
    const patches = [
      [-13, 20, 9, 12, ROAD.warm], [11, 34, 8, 10, ROAD.dark],
      [-9.5, 66, 7, 9, ROAD.warm], [14, 74, 7, 11, ROAD.warm],
      [-16, 96, 6, 13, ROAD.dark], [6, 104, 8, 10, ROAD.warm],
      [-20.2, 40, 3.4, 16, ROAD.dark], [20.2, 12, 3.4, 14, ROAD.dark],
      [20.2, 62, 3.2, 18, ROAD.warm], [-20.2, 118, 3.2, 16, ROAD.dark],
      [2, 28, 10, 13, ROAD.warm], [-2, 126, 10, 12, ROAD.dark],
      [9, 4, 7, 8, ROAD.warm], [-8, -22, 8, 9, ROAD.warm], [7, -30, 7, 9, ROAD.dark],
      [16, 140, 6, 10, ROAD.warm], [13, 16, 6, 9, ROAD.dark], [-14, 4, 5.5, 8, ROAD.dark],
      [17, 96, 5, 9, ROAD.warm], [-6, 84, 6.5, 8, ROAD.warm],
    ];
    for (const [cx, cz, rx, rz, col] of patches) {
      g.fillStyle = hex(col);
      blob(g, X, Z, cx, cz, rx, rz, r, 0.16, 13);
      g.fill();
      g.globalAlpha = 0.55;                              // the black lip of the joint
      g.strokeStyle = hex(ROAD.tar); g.lineWidth = Math.max(2, K * 0.14);
      g.stroke();
      g.globalAlpha = 0.34;                              // and the swept ridge beside it
      g.strokeStyle = hex(mixHex(col, ROAD.crown, 0.8)); g.lineWidth = Math.max(1.5, K * 0.07);
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  /* 4. the bright middle: the crown, scoured lightest of all --------- */
  {
    const grd = g.createLinearGradient(X(-12), 0, X(12), 0);
    grd.addColorStop(0.00, 'rgba(214,193,164,0)');
    grd.addColorStop(0.24, 'rgba(216,196,168,0.20)');
    grd.addColorStop(0.42, 'rgba(224,206,180,0.38)');
    grd.addColorStop(0.50, 'rgba(230,213,188,0.44)');
    grd.addColorStop(0.58, 'rgba(224,206,180,0.38)');
    grd.addColorStop(0.76, 'rgba(216,196,168,0.20)');
    grd.addColorStop(1.00, 'rgba(214,193,164,0)');
    g.fillStyle = grd;
    g.fillRect(X(-12), 0, 24 * K, S);
    // the two wheel tracks that scoured it, drawn as shapes and not as noise
    const r = new RNG(6006);
    for (const lane of [-6.6, 6.6]) {
      const pts = wander(r, lane, -45, lane + r.range(-0.8, 0.8), 165, 0.7, 24);
      g.strokeStyle = 'rgba(232,216,192,0.10)';
      g.lineWidth = K * 1.3; g.lineCap = 'round';
      g.beginPath();
      pts.forEach(([wx, wz], i) => (i ? g.lineTo(X(wx), Z(wz)) : g.moveTo(X(wx), Z(wz))));
      g.stroke();
      g.strokeStyle = 'rgba(240,228,206,0.10)';
      g.lineWidth = K * 0.4;
      g.stroke();
    }
  }

  /* 5. tar seams — fat black ribbons sealing every crack --------------- */
  {
    const r = new RNG(7007);
    const seams = [
      [-22, 4, 22, 9], [-22, 47, 22, 41], [-22, 88, 22, 95], [-22, 128, 22, 122],
      [-22, -24, 22, -19],
      [-6, -45, -2, 100], [10, -20, 13, 165], [-15, 12, -20, 74], [16, 24, 21, 88],
      [3, 20, -9, 46], [-11, 96, 7, 130],
    ];
    for (const [x0, z0, x1, z1] of seams) {
      const pts = wander(r, x0, z0, x1, z1, 1.5, 22);
      g.lineCap = 'round'; g.lineJoin = 'round';
      g.strokeStyle = hex(ROAD.tar);
      g.globalAlpha = 0.60;
      g.lineWidth = K * r.range(0.14, 0.26);
      g.beginPath();
      pts.forEach(([wx, wz], i) => (i ? g.lineTo(X(wx), Z(wz)) : g.moveTo(X(wx), Z(wz))));
      g.stroke();
      g.globalAlpha = 0.4;                               // the shine along the top of the bead
      g.strokeStyle = hex(mixHex(ROAD.tar, ROAD.crown, 0.55));
      g.lineWidth = K * 0.09;
      g.beginPath();
      pts.forEach(([wx, wz], i) => (i ? g.lineTo(X(wx) - 1.5, Z(wz) - 2.5) : g.moveTo(X(wx) - 1.5, Z(wz) - 2.5)));
      g.stroke();
      g.globalAlpha = 1;
    }
  }

  /* 6. oil — under everything that has ever been parked here ----------- */
  {
    const r = new RNG(8008);
    const spots = [[18.4, 50, 5.0, 7], [-18.4, 92, 5.0, 7], [-18.2, 26, 5.0, 9],
      [14.6, 78, 4.6, 6], [19, 12, 3.2, 4.4], [-19, 62, 3.0, 4.4], [0.5, 42, 2.0, 2.6]];
    const oil = hex(ROAD.oil);
    for (const [cx, cz, rx, rz] of spots) {
      g.save(); g.translate(X(cx), Z(cz)); g.scale(1, rz / rx); g.translate(-X(cx), -Z(cz));
      const grd = g.createRadialGradient(X(cx), Z(cz), 2, X(cx), Z(cz), rx * K);
      grd.addColorStop(0, 'rgba(74,64,55,0.5)');
      grd.addColorStop(0.55, 'rgba(80,70,60,0.26)');
      grd.addColorStop(1, 'rgba(84,74,62,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(X(cx), Z(cz), rx * K, 0, 7); g.fill();
      g.restore();
      for (let i = 0; i < 6; i++) {                      // individual drips, drawn as shapes
        g.globalAlpha = r.range(0.18, 0.4);
        g.fillStyle = oil;
        blob(g, X, Z, cx + r.range(-rx, rx), cz + r.range(-rz, rz), r.range(0.16, 0.5), r.range(0.16, 0.5), r, 0.4, 8);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // the ice wagon's water trail, running downhill to the gutter
    const trail = wander(r, 14.0, 71, 20.4, 40, 1.0, 16);
    g.strokeStyle = 'rgba(92,82,70,0.26)'; g.lineWidth = K * 0.9; g.lineCap = 'round';
    g.beginPath();
    trail.forEach(([wx, wz], i) => (i ? g.lineTo(X(wx), Z(wz)) : g.moveTo(X(wx), Z(wz))));
    g.stroke();
  }

  /* 7. the gutter: grit, cinders, straw, a cabbage leaf ---------------- */
  {
    const r = new RNG(9009);
    for (const side of [-1, 1]) {
      g.globalAlpha = 0.42;
      g.fillStyle = hex(mixHex(ROAD.dark, 0x8a7f66, 0.45));
      g.fillRect(X(side > 0 ? 19.0 : -22), 0, 3.0 * K, S);
      g.globalAlpha = 1;
      for (let i = 0; i < 620; i++) {
        const wx = side * r.range(18.9, 22), wz = r.range(-45, 165);
        const t = r.next();
        g.fillStyle = t < 0.42 ? '#9a8f7c' : t < 0.68 ? '#75695a' : t < 0.88 ? '#c8b78a' : '#8b9a5a';
        g.globalAlpha = r.range(0.35, 0.9);
        g.fillRect(X(wx), Z(wz), r.range(0.08, 0.34) * K, r.range(0.05, 0.2) * K);
      }
      for (let i = 0; i < 26; i++) {                     // what the pushcarts drop
        const wx = side * r.range(18.9, 21.9), wz = r.range(-45, 165);
        const t = r.next();
        g.globalAlpha = r.range(0.55, 0.95);
        g.fillStyle = t < 0.34 ? '#8fa23c' : t < 0.6 ? '#e3a32b' : t < 0.82 ? '#c8402f' : '#4e8ca8';
        blob(g, X, Z, wx, wz, r.range(0.16, 0.42), r.range(0.12, 0.3), r, 0.5, 8);
        g.fill();
      }
      g.globalAlpha = 1;
      // a torn sheet of newspaper against the curb
      g.globalAlpha = 0.9; g.fillStyle = '#d6ccb2';
      blob(g, X, Z, side * 20.4, side > 0 ? 34 : 108, 0.95, 0.75, r, 0.4, 9); g.fill();
      g.globalAlpha = 0.4; g.fillStyle = '#6d6353';
      for (let k = 0; k < 4; k++) g.fillRect(X(side * 20.4 - 0.6), Z((side > 0 ? 34 : 108) - 0.4 + k * 0.22), 1.1 * K, 0.06 * K);
      g.globalAlpha = 1;
    }
  }

  /* 8. puddles — the one place the street is allowed a specular ------- */
  {
    const r = new RNG(1212);
    for (const [cx, cz, rx, rz] of [[-20.2, 30, 1.8, 3.4], [20.4, 100, 1.5, 2.6], [-19.8, 84, 1.2, 2.0], [20.2, -18, 1.5, 2.4]]) {
      g.globalAlpha = 0.5; g.fillStyle = hex(soot(ROAD.dark, 0.18));
      blob(g, X, Z, cx, cz, rx, rz, r, 0.28, 16); g.fill();
      g.globalAlpha = 0.62; g.fillStyle = hex(AIR.skyLower);
      blob(g, X, Z, cx, cz, rx * 0.78, rz * 0.78, r, 0.3, 16); g.fill();
      g.globalAlpha = 0.7; g.fillStyle = '#dfeaf4';
      blob(g, X, Z, cx - rx * 0.2, cz - rz * 0.25, rx * 0.34, rz * 0.2, r, 0.35, 10); g.fill();
      g.globalAlpha = 1;
    }
  }

  /* 9. a painted-out old marking, and the ghost of it coming back ----- */
  {
    g.save();
    g.globalAlpha = 0.34; g.fillStyle = hex(mixHex(ROAD.warm, AIR.haze, 0.30));
    g.fillRect(X(-16), Z(110), 12 * K, 3.4 * K);
    g.globalAlpha = 0.24; g.fillStyle = hex(AIR.haze);
    g.fillRect(X(-15.2), Z(110.7), 10.4 * K, 0.55 * K);
    g.fillRect(X(-15.2), Z(112.2), 10.4 * K, 0.55 * K);
    g.globalAlpha = 0.17;
    g.translate(X(-10), Z(113.8)); g.rotate(Math.PI);
    slabText(g, 'SLOW', 0, 0, 1.9 * K,
      { align: 'center', color: hex(AIR.haze), weight: 0.2, condense: 0.8, jitter: 1, seed: 3 });
    g.restore();
    g.globalAlpha = 1;
  }

  /* 10. shoe scuffs radiating out of the batter's spot ---------------- */
  {
    const r = new RNG(1313);
    for (let i = 0; i < 70; i++) {
      const a = r.range(0, Math.PI * 2), d = r.range(1.2, 5.5);
      const wx = -1.6 + Math.cos(a) * d * 0.8, wz = PLATE_Z + Math.sin(a) * d;
      g.globalAlpha = r.range(0.07, 0.2);
      g.strokeStyle = r.chance(0.55) ? '#dccbaa' : '#665b4c';
      g.lineWidth = K * r.range(0.06, 0.16); g.lineCap = 'round';
      g.beginPath();
      g.moveTo(X(wx), Z(wz));
      g.lineTo(X(wx + Math.cos(a + 1.5) * 0.7), Z(wz + Math.sin(a + 1.5) * 0.7));
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /* 10b. the tooth of the surface: aggregate worn proud, and the fine map of
   *      cracks that a sheet-asphalt street breaks into.  Shapes, not noise. */
  {
    const r = new RNG(2727);
    for (let i = 0; i < 5200; i++) {
      const wx = r.range(-HALF, HALF), wz = r.range(-45, 165);
      const near = 1 - Math.min(1, Math.abs(wx) / 15);          // more exposed at the crown
      g.globalAlpha = r.range(0.06, 0.18) * (0.35 + near * 0.85);
      g.fillStyle = r.chance(0.55) ? hex(ROAD.crown) : hex(ROAD.tar);
      g.beginPath();
      g.ellipse(X(wx), Z(wz), r.range(0.03, 0.09) * K, r.range(0.024, 0.07) * K, r.range(0, 3.14), 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = hex(soot(ROAD.dark, 0.16));
    g.lineCap = 'round';
    for (let i = 0; i < 130; i++) {
      let wx = r.range(-HALF, HALF), wz = r.range(-45, 165), a = r.range(0, 6.3);
      g.globalAlpha = r.range(0.14, 0.4);
      g.lineWidth = Math.max(1, K * r.range(0.03, 0.09));
      g.beginPath(); g.moveTo(X(wx), Z(wz));
      for (let k = 0; k < 6; k++) {
        a += r.range(-0.8, 0.8);
        wx += Math.cos(a) * r.range(0.5, 1.6); wz += Math.sin(a) * r.range(0.5, 1.6);
        g.lineTo(X(wx), Z(wz));
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /* 11. CHALK — the whole diamond, scrawled and half scuffed away ------
   * Soft schoolroom chalk: thin, broken, and already half gone.  Each mark
   * gets a dark scuff laid under it so it never reads as painted line work,
   * which is the difference between a stickball street and a road marking.
   */
  {
    const CW = Math.max(2.2, K * 0.16);
    const line = (pts, seed, alpha = 0.85, w = CW) => {
      const px = pts.map(([wx, wz]) => [X(wx), Z(wz)]);
      chalkStroke(g, px.map(([a, b]) => [a + 2.5, b + 3]), w * 1.5, seed + 7, alpha * 0.28, hex(ROAD.tar));
      chalkStroke(g, px, w, seed, alpha);
    };

    // foul lines, 45 degrees off home toward the two curbs
    line([[-1.2, 1.2], [-21, 21]], 101, 0.92);
    line([[1.2, 1.2], [21, 21]], 103, 0.92);
    // first base: a big X on the asphalt beside the Ford's rear fender
    line([[16.4, 48], [20.4, 52]], 121, 0.95, CW * 1.7);
    line([[20.4, 48], [16.4, 52]], 123, 0.95, CW * 1.7);
    groundText(g, '1', X(18.4), Z(47.2), 1.4 * K, { seed: 125, weight: 0.15 });
    // third base: an X at the foot of the lamp post
    line([[-21.4, 48], [-17.4, 52]], 131, 0.95, CW * 1.7);
    line([[-17.4, 48], [-21.4, 52]], 133, 0.95, CW * 1.7);
    groundText(g, '3', X(-19.4), Z(47.2), 1.4 * K, { seed: 135, weight: 0.15 });
    // the pitcher's scratch, halfway to second
    line([[-2.2, 45], [2.2, 45]], 141, 0.85, CW * 1.2);
    // somebody's chalk ring for immies, and the initials of whoever won
    {
      const pts = [];
      for (let i = 0; i <= 26; i++) {
        const a = i / 26 * Math.PI * 2;
        pts.push([-14.5 + Math.cos(a) * 2.4, 14 + Math.sin(a) * 2.4]);
      }
      line(pts, 151, 0.7, CW * 0.85);
      groundText(g, 'S.M.', X(-14.5), Z(14.2), 1.1 * K, { seed: 153, weight: 0.14, alpha: 0.65 });
    }
    // a numbered box game left over by the curb
    {
      const bx = 14.6, bz = 22.0, side = 5.4;
      const sq = [[bx, bz], [bx + side, bz], [bx + side, bz + side], [bx, bz + side], [bx, bz]];
      line(sq, 161, 0.68, CW * 0.9);
      line([[bx, bz], [bx + side, bz + side]], 163, 0.45, CW * 0.7);
      line([[bx + side, bz], [bx, bz + side]], 165, 0.45, CW * 0.7);
      ['1', '2', '3', '4'].forEach((n, i) => groundText(g, n,
        X(bx + side * (0.28 + (i % 2) * 0.44)), Z(bz + side * (0.30 + Math.floor(i / 2) * 0.44)),
        1.0 * K, { seed: 170 + i, weight: 0.14, alpha: 0.6 }));
    }
    // the sewer tally somebody keeps at the crown, by the second casting
    line([[9.2, 88], [9.2, 91]], 181, 0.75, CW);
    line([[9.9, 88], [9.9, 91]], 183, 0.75, CW);
    groundText(g, 'M', X(9.6), Z(86.8), 1.2 * K, { seed: 185, weight: 0.15, alpha: 0.65 });
  }
}

/* --- geometry ------------------------------------------------------------- */

/** a plane that follows the crown of the road */
function crownedPlane(spanX, spanZ, cz, segX = 32, segZ = 32, lift = 0) {
  const geo = new THREE.PlaneGeometry(spanX, spanZ, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setY(i, roadHeight(p.getX(i)) + lift);
  }
  geo.computeVertexNormals();
  geo.translate(0, 0, cz);
  return geo;
}

function asphaltTileTexture() {
  const S = 512;
  const { c, g } = makeCanvas(S, S);
  const r = new RNG(31337);
  const K = S / 12;                                  // 12 ft tile
  g.fillStyle = hex(PAVEMENT.asphaltShade); g.fillRect(0, 0, S, S);
  const wrap = (fn) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); fn(); g.restore(); }
  };
  wrap(() => {
    const rr = new RNG(31337);
    for (let i = 0; i < 90; i++) {
      g.globalAlpha = rr.range(0.05, 0.16);
      g.fillStyle = hex(rr.chance(0.5) ? PAVEMENT.asphaltWarm : PAVEMENT.asphaltDark);
      g.beginPath();
      g.ellipse(rr.range(0, S), rr.range(0, S), rr.range(8, 46), rr.range(8, 40), rr.range(0, 3), 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  });
  wrap(() => {                                        // the fine crack map
    const rr = new RNG(9182);
    g.strokeStyle = 'rgba(64,56,48,0.5)'; g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let x = rr.range(0, S), y = rr.range(0, S), a = rr.range(0, 6.3);
      g.lineWidth = rr.range(1.4, 3.2);
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 7; k++) { a += rr.range(-0.7, 0.7); x += Math.cos(a) * K * 0.5; y += Math.sin(a) * K * 0.5; g.lineTo(x, y); }
      g.stroke();
    }
  });
  wrap(() => {                                        // aggregate showing at the crown
    const rr = new RNG(5511);
    for (let i = 0; i < 380; i++) {
      g.globalAlpha = rr.range(0.08, 0.3);
      g.fillStyle = rr.chance(0.6) ? '#b9a689' : '#6c6053';
      g.fillRect(rr.range(0, S), rr.range(0, S), rr.range(2.5, 6), rr.range(2, 5));
    }
    g.globalAlpha = 1;
  });
  void r;
  return canvasTexture(c, { repeat: [1, 1] });
}

function sidewalkTexture() {
  const S = 512;
  const { c, g } = makeCanvas(S, S);
  const r = new RNG(2468);
  const FT = S / 10;                                 // 10 ft tile
  g.fillStyle = hex(mixHex(PAVEMENT.sidewalk, AIR.shadowTint, 0.12)); g.fillRect(0, 0, S, S);
  // bluestone flags, roughly 4 ft, with two poured-concrete squares mixed in
  for (let iy = 0; iy < 2; iy++) {
    for (let ix = 0; ix < 2; ix++) {
      const x = ix * S / 2, y = iy * S / 2, w = S / 2, h = S / 2;
      const concrete = (ix + iy) % 3 === 1;
      const base = concrete ? mixHex(PAVEMENT.sidewalk, AIR.skyFill, 0.16) : mixHex(PAVEMENT.sidewalk, AIR.shadowTint, 0.13);
      g.fillStyle = hex(mixHex(base, r.chance(0.5) ? AIR.haze : soot(PAVEMENT.sidewalk, 0.3), r.range(0, 0.2)));
      g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.strokeStyle = 'rgba(74,68,58,0.55)'; g.lineWidth = 3.5;
      g.strokeRect(x + 2, y + 2, w - 4, h - 4);
      if (concrete) {                                  // tooled edge
        g.strokeStyle = 'rgba(226,220,204,0.4)'; g.lineWidth = 2;
        g.strokeRect(x + 10, y + 10, w - 20, h - 20);
      }
      for (let i = 0; i < 90; i++) {                   // wear, chips, grit
        g.globalAlpha = r.range(0.04, 0.14);
        g.fillStyle = r.chance(0.5) ? '#c2bcac' : '#6f695c';
        g.fillRect(x + r.range(4, w - 8), y + r.range(4, h - 8), r.range(3, 16), r.range(2, 7));
      }
      g.globalAlpha = 1;
    }
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

function curbTexture() {
  const S = 512;
  const { c, g } = makeCanvas(128, S);
  const r = new RNG(1357);
  g.fillStyle = hex(mixHex(PAVEMENT.curb, AIR.shadowTint, 0.10)); g.fillRect(0, 0, 128, S);
  for (let i = 0; i < 5; i++) {                        // 4 ft granite lengths
    const y = i * S / 5;
    g.strokeStyle = 'rgba(62,58,50,0.7)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke();
    g.fillStyle = hex(mixHex(mixHex(PAVEMENT.curb, AIR.shadowTint, 0.10), r.chance(0.5) ? AIR.haze : soot(PAVEMENT.curb, 0.3), r.range(0, 0.2)));
    g.fillRect(0, y + 3, 128, S / 5 - 6);
  }
  for (let i = 0; i < 300; i++) {                      // tooling marks and chips
    g.globalAlpha = r.range(0.05, 0.2);
    g.fillStyle = r.chance(0.5) ? '#cec7b6' : '#5f5a4d';
    g.fillRect(r.range(0, 128), r.range(0, S), r.range(2, 10), r.range(2, 4));
  }
  g.globalAlpha = 1;
  return canvasTexture(c, { repeat: [1, 1] });
}

/** the chalk the little kids left: potsy, initials, a hopscotch grid */
function sidewalkChalkTexture() {
  const S = 1024;                                     // 10 ft across x 20 ft along
  const { c, g } = makeCanvas(S / 2, S);
  const KX = (S / 2) / 10, KZ = S / 20;
  const P = (wx, wz) => [wx * KX, wz * KZ];
  const line = (pts, seed, a = 0.9, w = 5) => chalkStroke(g, pts.map(([x, z]) => P(x, z)), w, seed, a);
  // potsy: single, single, double, single, double, then SKY
  const cells = [
    [[3.4, 2.0], [5.6, 2.0], [5.6, 4.0], [3.4, 4.0]],
    [[3.4, 4.0], [5.6, 4.0], [5.6, 6.0], [3.4, 6.0]],
    [[2.2, 6.0], [4.4, 6.0], [4.4, 8.0], [2.2, 8.0]],
    [[4.4, 6.0], [6.6, 6.0], [6.6, 8.0], [4.4, 8.0]],
    [[3.4, 8.0], [5.6, 8.0], [5.6, 10.0], [3.4, 10.0]],
    [[2.2, 10.0], [4.4, 10.0], [4.4, 12.0], [2.2, 12.0]],
    [[4.4, 10.0], [6.6, 10.0], [6.6, 12.0], [4.4, 12.0]],
    [[3.4, 12.0], [5.6, 12.0], [5.6, 14.4], [3.4, 14.4]],
  ];
  cells.forEach((q, i) => {
    line([...q, q[0]], 200 + i, 0.85, 5);
    const cx = (q[0][0] + q[1][0]) / 2, cz = (q[0][1] + q[3][1]) / 2;
    groundText(g, String(i + 1), cx * KX, cz * KZ, 34, { seed: 220 + i, weight: 0.16 });
  });
  groundText(g, 'SKY', 4.5 * KX, 13.4 * KZ, 30, { seed: 240, weight: 0.16, alpha: 0.8 });
  // a tic-tac-toe somebody abandoned
  line([[7.4, 15.6], [9.4, 15.6]], 250, 0.7, 4);
  line([[7.4, 16.6], [9.4, 16.6]], 251, 0.7, 4);
  line([[8.0, 15.0], [8.0, 17.2]], 252, 0.7, 4);
  line([[8.7, 15.0], [8.7, 17.2]], 253, 0.7, 4);
  groundText(g, 'X', 7.7 * KX, 15.2 * KZ, 22, { seed: 254, weight: 0.16, alpha: 0.75 });
  groundText(g, 'O', 8.35 * KX, 16.2 * KZ, 22, { seed: 255, weight: 0.16, alpha: 0.75 });
  groundText(g, 'ROSA', 3.0 * KX, 18.2 * KZ, 40, { seed: 260, weight: 0.15, alpha: 0.8, condense: 0.9 });
  groundText(g, 'WAS HERE', 3.0 * KX, 19.2 * KZ, 24, { seed: 262, weight: 0.15, alpha: 0.7, condense: 0.9 });
  // somebody's little brother drew a cat.  It is not a good cat.
  {
    const cx = 7.9 * KX, cy = 4.6 * KZ, R2 = 26;
    const ring = [];
    for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2; ring.push([cx + Math.cos(a) * R2, cy + Math.sin(a) * R2]); }
    chalkStroke(g, ring, 4, 300, 0.8);
    chalkStroke(g, [[cx - 18, cy - 18], [cx - 24, cy - 38], [cx - 4, cy - 26]], 4, 301, 0.8);
    chalkStroke(g, [[cx + 18, cy - 18], [cx + 24, cy - 38], [cx + 4, cy - 26]], 4, 302, 0.8);
    chalkStroke(g, [[cx - 9, cy - 4], [cx - 9, cy - 5]], 6, 303, 0.9);
    chalkStroke(g, [[cx + 9, cy - 4], [cx + 9, cy - 5]], 6, 304, 0.9);
    chalkStroke(g, [[cx - 10, cy + 10], [cx, cy + 15], [cx + 10, cy + 10]], 4, 305, 0.8);
    chalkStroke(g, [[cx - 30, cy + 2], [cx + 30, cy + 2]], 3, 306, 0.55);
    chalkStroke(g, [[cx, cy + R2], [cx, cy + R2 + 40]], 4, 307, 0.8);
    chalkStroke(g, [[cx, cy + R2 + 40], [cx + 26, cy + R2 + 22]], 4, 308, 0.8);
  }
  return canvasTexture(c);
}

/* --- the manhole cover, which is home plate ------------------------------- */

function manholeTexture(kind) {
  const S = 1024;
  const { c, g } = makeCanvas(S, S);
  const C = S / 2, RAD = S * 0.487;
  const HI = hex(PAVEMENT.manholeHigh), LO = hex(0x3b322b), MID = hex(0x6b6259);
  const r = new RNG(kind === 'sewer' ? 606 : 707);

  g.clearRect(0, 0, S, S);
  g.save();
  g.beginPath(); g.arc(C, C, RAD, 0, 7); g.clip();
  g.fillStyle = LO; g.fillRect(0, 0, S, S);

  const relief = (path, fillCol) => {                 // one raised casting element
    g.save();
    g.translate(4, 5); g.fillStyle = 'rgba(20,15,11,0.95)'; path(); g.fill();   // recess shadow
    g.restore();
    g.save();
    g.translate(-3, -4); g.fillStyle = 'rgba(206,196,176,0.75)'; path(); g.fill(); // polished lip
    g.restore();
    g.fillStyle = fillCol; path(); g.fill();
  };

  if (kind === 'sewer') {
    // waffle field: raised squares with a deep recess between them
    const cell = S * 0.077;
    for (let iy = -7; iy <= 7; iy++) {
      for (let ix = -7; ix <= 7; ix++) {
        const x = C + ix * cell, y = C + iy * cell;
        if (Math.hypot(x - C, y - C) > RAD * 0.735) continue;
        const t = r.next();
        relief(() => { g.beginPath(); g.rect(x - cell * 0.38, y - cell * 0.38, cell * 0.76, cell * 0.76); },
          hex(mixHex(PAVEMENT.manholeHigh, PAVEMENT.manholeLow, 0.12 + t * 0.42)));
      }
    }
    // the centre boss
    relief(() => { g.beginPath(); g.arc(C, C, S * 0.115, 0, 7); }, MID);
    g.save(); g.translate(0, 0);
    slabText(g, '1898', C, C + S * 0.03, S * 0.062,
      { align: 'center', color: HI, weight: 0.2, condense: 0.8, shadow: { dx: 3, dy: 4, color: 'rgba(20,15,12,0.9)' }, jitter: 0.3, seed: 2 });
    g.restore();
    // the rim band and the lettering cast into it
    relief(() => {
      g.beginPath(); g.arc(C, C, RAD * 0.99, 0, 7);
      g.arc(C, C, RAD * 0.735, 0, 7, true);
    }, hex(mixHex(PAVEMENT.manholeHigh, PAVEMENT.manholeLow, 0.72)));
    arcText(g, 'BUREAU OF SEWERS', C, C, RAD * 0.862, -Math.PI / 2, S * 0.075,
      { color: HI, weight: 0.26, condense: 0.82, spread: 0.152, flip: false,
        serif: S * 0.014, shadow: { dx: 5, dy: 6, color: 'rgba(16,12,9,0.95)' } });
    arcText(g, 'J.B.&J.M.CORNELL N.Y.', C, C, RAD * 0.862, Math.PI / 2, S * 0.058,
      { color: HI, weight: 0.24, condense: 0.8, spread: 0.122, flip: true,
        serif: S * 0.011, shadow: { dx: 5, dy: 6, color: 'rgba(16,12,9,0.95)' } });
    // the pick holes
    for (const a of [0, Math.PI]) {
      g.fillStyle = 'rgba(18,14,11,0.95)';
      g.beginPath(); g.ellipse(C + Math.cos(a) * RAD * 0.5, C + Math.sin(a) * RAD * 0.5, S * 0.035, S * 0.02, a, 0, 7); g.fill();
    }
  } else {
    for (let i = 0; i < 7; i++) {
      relief(() => { g.beginPath(); g.arc(C, C, RAD * (0.16 + i * 0.093), 0, 7); g.arc(C, C, RAD * (0.11 + i * 0.093), 0, 7, true); },
        hex(mixHex(PAVEMENT.manholeHigh, 0x554b42, 0.4)));
    }
    relief(() => { g.beginPath(); g.arc(C, C, RAD * 0.985, 0, 7); g.arc(C, C, RAD * 0.79, 0, 7, true); },
      hex(mixHex(PAVEMENT.manholeHigh, 0x5b5148, 0.35)));
    arcText(g, 'THE NEW YORK EDISON CO.', C, C, RAD * 0.885, -Math.PI / 2, S * 0.05,
      { color: HI, weight: 0.2, condense: 0.76, spread: 0.104, shadow: { dx: 3, dy: 4, color: 'rgba(20,15,12,0.9)' } });
    slabText(g, 'ELECTRIC', C, C + S * 0.025, S * 0.07,
      { align: 'center', color: HI, weight: 0.2, condense: 0.78, shadow: { dx: 3, dy: 4, color: 'rgba(20,15,12,0.9)' }, jitter: 0.4, seed: 6 });
  }

  // a thousand feet have polished the high points along the traffic line
  const grd = g.createLinearGradient(0, S * 0.1, 0, S * 0.9);
  grd.addColorStop(0, 'rgba(226,218,202,0)');
  grd.addColorStop(0.45, 'rgba(238,230,212,0.44)');
  grd.addColorStop(0.6, 'rgba(238,230,212,0.30)');
  grd.addColorStop(1, 'rgba(226,218,202,0)');
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';

  // rust bloom in the recesses, drawn as shapes
  for (let i = 0; i < 40; i++) {
    g.globalAlpha = r.range(0.05, 0.16);
    g.fillStyle = r.chance(0.5) ? '#7a5236' : '#8d8478';
    const a = r.range(0, 6.3), d = r.range(0, RAD * 0.95);
    g.beginPath(); g.ellipse(C + Math.cos(a) * d, C + Math.sin(a) * d, r.range(6, 34), r.range(5, 24), a, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  g.restore();

  if (kind === 'sewer') {                              // the batter's chalk, smeared over the lid
    chalkStroke(g, [[S * 0.06, S * 0.2], [S * 0.2, S * 0.1]], 9, 301, 0.35);
    chalkStroke(g, [[S * 0.82, S * 0.86], [S * 0.94, S * 0.74]], 9, 303, 0.3);
    chalkStroke(g, [[S * 0.1, S * 0.8], [S * 0.26, S * 0.9]], 7, 305, 0.25);
  }
  return canvasTexture(c);
}

function buildManhole(scene, x, z, kind) {
  const grp = new THREE.Group();
  const y = roadHeight(x);
  grp.position.set(x, y, z);

  const frameGeo = new THREE.RingGeometry(1.09, 1.34, 40);
  frameGeo.rotateX(-Math.PI / 2);
  const frameTex = (() => {
    const { c, g } = makeCanvas(256, 256);
    const r = new RNG(kind === 'sewer' ? 88 : 89);
    g.fillStyle = hex(mixHex(PAVEMENT.manholeHigh, PAVEMENT.asphaltDark, 0.55)); g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 220; i++) {
      g.globalAlpha = r.range(0.06, 0.24);
      g.fillStyle = r.chance(0.5) ? '#b3a898' : '#4a423a';
      g.fillRect(r.range(0, 256), r.range(0, 256), r.range(3, 14), r.range(2, 8));
    }
    g.globalAlpha = 1;
    return canvasTexture(c);
  })();
  const frame = new THREE.Mesh(frameGeo, texMat(frameTex));
  frame.position.y = 0.005;
  grp.add(frame);

  // the lid: a real casting with a real bevel and a shallow dome
  const lidGeo = new THREE.CircleGeometry(1.083, 44);
  lidGeo.rotateX(-Math.PI / 2);
  const lp = lidGeo.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const d = Math.hypot(lp.getX(i), lp.getZ(i)) / 1.083;
    lp.setY(i, 0.055 * (1 - d * d));
  }
  lidGeo.computeVertexNormals();
  const lid = new THREE.Mesh(lidGeo, texMat(manholeTexture(kind), { transparent: true, lift: 0.16 }));
  lid.position.y = 0.055;
  lid.rotation.y = Math.PI;      // cast lettering faces the batter's camera
  grp.add(lid);
  const bevel = new THREE.Mesh(
    new THREE.CylinderGeometry(1.083, 1.15, 0.12, 40, 1, true),
    mat(0x4f463d)
  );
  bevel.position.y = 0.0;
  grp.add(bevel);
  outline(bevel, 0.03);
  scene.add(grp);
  return grp;
}

/* --- the catch basin the ball goes down ----------------------------------- */

function buildCatchBasin(app, scene, side, z) {
  const x = side * 20.6;
  const grp = new THREE.Group();
  grp.position.set(x, roadHeight(x), z);
  const iron = mat(0x4a423a);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.22, 3.4), iron);
  frame.position.y = -0.03; grp.add(frame);
  const voidMesh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 2.9), mat(0x2f2a26));
  voidMesh.position.y = -0.6; grp.add(voidMesh);
  // bars running lengthwise, 1-1/2 in slots — the ball fits, that is the point
  const bar = new THREE.BoxGeometry(0.18, 0.16, 2.9);
  const bars = new THREE.InstancedMesh(bar, iron, 7);
  const d = new THREE.Object3D();
  for (let i = 0; i < 7; i++) {
    d.position.set(-0.84 + i * 0.28, 0.03, 0);
    d.updateMatrix();
    bars.setMatrixAt(i, d.matrix);
  }
  bars.instanceMatrix.needsUpdate = true;
  grp.add(bars);
  for (const dz of [1.55, -1.55]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.2, 0.3), iron);
    e.position.set(0, 0.03, dz); grp.add(e);
  }
  scene.add(grp);
  addSewer(app, { name: 'catch basin', pos: new THREE.Vector3(x, 0, z), halfX: 1.0, halfZ: 1.5 });
  addCollider(app, {
    name: 'catch basin', kind: 'grate', sound: 'sewer_plink', restitution: 0.15,
    box: new THREE.Box3(new THREE.Vector3(x - 1.2, -0.2, z - 1.7), new THREE.Vector3(x + 1.2, 0.2, z + 1.7)),
  });
  return grp;
}

/* =========================================================================== */

export function buildSurface(app) {
  const scene = app.scene;
  const root = new THREE.Group();
  root.name = 'surface';
  scene.add(root);

  /* --- roadway decks, painted in world coordinates --------------------- */
  const BANDS = [
    { z0: -36, z1: 12, size: 1536 },
    { z0: 12, z1: 60, size: 1536 },
    { z0: 60, z1: 108, size: 1024 },
    { z0: 108, z1: 156, size: 640 },
  ];
  for (const b of BANDS) {
    const span = b.z1 - b.z0;
    const { c, g } = makeCanvas(b.size, b.size);
    paintRoad(g, b.size, -HALF, HALF * 2, b.z0, span);
    const tex = canvasTexture(c, { aniso: 8 });
    const geo = crownedPlane(HALF * 2, span, (b.z0 + b.z1) / 2, 40, Math.round(span / 1.5));
    const m = new THREE.Mesh(geo, texMat(tex));
    m.receiveShadow = true;
    root.add(m);
  }

  /* --- the rest of the street, tiling ---------------------------------- */
  {
    const tex = asphaltTileTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    for (const [z0, z1] of [[-96, -36], [156, 340]]) {
      const span = z1 - z0;
      const t2 = tex.clone();
      t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
      t2.repeat.set(4, span / 12);
      t2.needsUpdate = true;
      const geo = crownedPlane(HALF * 2, span, (z0 + z1) / 2, 24, Math.max(4, Math.round(span / 8)));
      const m = new THREE.Mesh(geo, texMat(t2));
      m.receiveShadow = true;
      root.add(m);
    }
  }

  /* --- curbs and sidewalks --------------------------------------------- */
  {
    const LEN = 420, CZ = 130;
    const curbTex = curbTexture();
    const walkTex = sidewalkTexture();
    for (const side of [-1, 1]) {
      // the granite curb: top strip and street face
      const topTex = curbTex.clone();
      topTex.wrapS = topTex.wrapT = THREE.RepeatWrapping;
      topTex.repeat.set(1, LEN / 20); topTex.needsUpdate = true;
      const top = new THREE.Mesh(new THREE.PlaneGeometry(GROUND.curbW, LEN), texMat(topTex));
      top.geometry.rotateX(-Math.PI / 2);
      top.position.set(side * (GROUND.curbX + GROUND.curbW / 2), GROUND.walkTop + 0.002, CZ);
      top.receiveShadow = true;
      root.add(top);

      const faceTex = curbTex.clone();
      faceTex.wrapS = faceTex.wrapT = THREE.RepeatWrapping;
      faceTex.repeat.set(LEN / 20, 1); faceTex.needsUpdate = true;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(LEN, 0.72), texMat(faceTex));
      face.position.set(side * GROUND.curbX, GROUND.walkTop - 0.36, CZ);
      face.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      root.add(face);

      // bluestone flags
      const wt = walkTex.clone();
      wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
      wt.repeat.set(0.94, LEN / 10); wt.needsUpdate = true;
      const walkW = GROUND.walkOuter - (GROUND.curbX + GROUND.curbW);
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(walkW, LEN), texMat(wt));
      walk.geometry.rotateX(-Math.PI / 2);
      walk.position.set(side * (GROUND.curbX + GROUND.curbW + walkW / 2), GROUND.walkTop + 0.004, CZ);
      walk.receiveShadow = true;
      root.add(walk);
    }
    // the little kids' chalk, on the right-hand walk where the camera sees it
    const chalkMat = texMat(sidewalkChalkTexture(), { transparent: true, depthWrite: false, lift: 0.5 });
    const chalkGeo = new THREE.PlaneGeometry(9.3, 20);
    chalkGeo.rotateX(-Math.PI / 2);
    const chalk = new THREE.Mesh(chalkGeo, chalkMat);
    chalk.position.set(GROUND.curbX + 1.3 + 4.65, GROUND.walkTop + 0.012, 40);
    chalk.renderOrder = 2;
    root.add(chalk);
  }

  /* --- the castings: home plate, second base, and the block's others ---- */
  const homeMesh = buildManhole(root, 0, PLATE_Z, 'sewer');
  buildManhole(root, 0.4, PLATE_Z + SEWER_SPACING, 'sewer');
  buildManhole(root, -0.6, PLATE_Z + SEWER_SPACING * 2, 'sewer');
  buildManhole(root, 7.4, 52, 'edison');
  buildManhole(root, -6.5, 24, 'edison');
  buildManhole(root, -9.2, 108, 'edison');
  app.world = app.world || {};
  app.world.homePlate = new THREE.Vector3(0, 0, PLATE_Z);
  app.world.secondBase = new THREE.Vector3(0.4, 0, PLATE_Z + SEWER_SPACING);
  app.world.sewerSpacing = SEWER_SPACING;
  addCollider(app, {
    name: 'manhole (home plate)', kind: 'iron', sound: 'manhole_boom', restitution: 0.5,
    box: new THREE.Box3(new THREE.Vector3(-1.5, 0, PLATE_Z - 1.5), new THREE.Vector3(1.5, 0.62, PLATE_Z + 1.5)),
  });

  /* --- catch basins the ball can vanish into --------------------------- */
  for (const [side, z] of [[1, 8], [-1, 8], [1, 88], [-1, 88], [1, 130]]) buildCatchBasin(app, root, side, z);

  /* --- the plate decal ------------------------------------------------
   * The camera lives on home plate, so the sixteen feet round it get their
   * own canvas at a hundred pixels to the foot: the chalked box, the heel
   * scuffs, the aggregate worn proud and the fine crack map.  Everything
   * here is drawn at a feature scale that survives a two-foot camera.
   */
  {
    const S = 1536, SPAN = 15;
    const { c, g } = makeCanvas(S, S);
    const K = S / SPAN;
    const X = (wx) => (wx + SPAN / 2) * K;
    const Z = (wz) => (wz - (PLATE_Z - SPAN / 2)) * K;
    const r = new RNG(1717);

    // aggregate worn proud of the binder, and the crack map around it
    for (let i = 0; i < 3400; i++) {
      const wx = r.range(-SPAN / 2, SPAN / 2), wz = PLATE_Z + r.range(-SPAN / 2, SPAN / 2);
      g.globalAlpha = r.range(0.05, 0.16);
      g.fillStyle = r.chance(0.55) ? hex(ROAD.crown) : hex(ROAD.tar);
      g.beginPath();
      g.ellipse(X(wx), Z(wz), r.range(0.018, 0.055) * K, r.range(0.014, 0.04) * K, r.range(0, 3.14), 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
    g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      let wx = r.range(-SPAN / 2, SPAN / 2), wz = PLATE_Z + r.range(-SPAN / 2, SPAN / 2), a = r.range(0, 6.3);
      g.globalAlpha = r.range(0.16, 0.42);
      g.strokeStyle = hex(soot(ROAD.dark, 0.2));
      g.lineWidth = Math.max(1.4, K * r.range(0.02, 0.06));
      g.beginPath(); g.moveTo(X(wx), Z(wz));
      for (let k = 0; k < 6; k++) {
        a += r.range(-0.9, 0.9);
        wx += Math.cos(a) * r.range(0.25, 0.9); wz += Math.sin(a) * r.range(0.25, 0.9);
        g.lineTo(X(wx), Z(wz));
      }
      g.stroke();
    }
    g.globalAlpha = 1;

    // heel scuffs, swept out of the batter's spot
    for (let i = 0; i < 44; i++) {
      const a = r.range(0, 6.3), d = r.range(1.4, 6.2);
      g.globalAlpha = r.range(0.08, 0.22);
      g.strokeStyle = r.chance(0.55) ? hex(ROAD.crown) : hex(soot(ROAD.dark, 0.15));
      g.lineWidth = K * r.range(0.04, 0.11);
      g.beginPath();
      g.moveTo(X(Math.cos(a) * d), Z(PLATE_Z + Math.sin(a) * d));
      g.lineTo(X(Math.cos(a) * d + Math.cos(a + 1.4) * 0.6), Z(PLATE_Z + Math.sin(a) * d + Math.sin(a + 1.4) * 0.6));
      g.stroke();
    }
    g.globalAlpha = 1;

    const line = (pts, seed, a = 0.9, w = K * 0.11) =>
      chalkStroke(g, pts.map(([wx, wz]) => [X(wx), Z(wz)]), w, seed, a);
    const scuffed = (pts, seed, a = 0.9, w = K * 0.11) => {
      chalkStroke(g, pts.map(([wx, wz]) => [X(wx) + 2.5, Z(wz) + 3]), w * 1.6, seed + 7, a * 0.26, hex(ROAD.tar));
      line(pts, seed, a, w);
    };
    // the batter's box, chalked once and mostly scrubbed off by his own feet
    scuffed([[-4.3, -2.6], [-4.3, 3.0], [-2.0, 3.2]], 401, 0.62);
    scuffed([[4.3, -2.6], [4.3, 3.0], [2.0, 3.2]], 403, 0.62);
    // the foul lines leaving home, and the arrow the kids scratched to second
    scuffed([[-1.2, 1.2], [-6.6, 6.7]], 405, 0.95, K * 0.14);
    scuffed([[1.2, 1.2], [6.6, 6.7]], 407, 0.95, K * 0.14);
    groundText(g, 'HOME', X(0), Z(-4.0), K * 1.0,
      { seed: 409, weight: 0.15, condense: 0.85, alpha: 0.8 });
    groundText(g, '1 SEWER', X(-4.8), Z(5.6), K * 0.62,
      { seed: 411, weight: 0.14, condense: 0.85, alpha: 0.55 });
    // the arrow up the block toward the second casting
    scuffed([[5.4, -4.6], [5.4, -2.2]], 413, 0.5, K * 0.09);
    scuffed([[4.9, -3.0], [5.4, -2.2], [5.9, -3.0]], 415, 0.5, K * 0.09);

    const geo = crownedPlane(SPAN, SPAN, PLATE_Z, 22, 22, 0.014);
    const m = new THREE.Mesh(geo, texMat(canvasTexture(c, { aniso: 8 }), { transparent: true, depthWrite: false, lift: 0.42 }));
    m.renderOrder = 1;
    root.add(m);
  }

  /* --- chalk on the curb: the block's own scorekeeping ----------------- */
  {
    const W = 256, H = 1024;                         // 3 ft across x 12 ft along
    const { c, g } = makeCanvas(W, H);
    // everything is written along the kerb, read by somebody standing in the road
    const along = (txt, at, size, opts) => {
      g.save();
      g.translate(W * 0.62, at * H);
      g.rotate(-Math.PI / 2);
      chalkText(g, txt, 0, 0, size, { align: 'center', ...opts });
      g.restore();
    };
    const tally = (at, n, seed) => {
      g.save();
      g.translate(W * 0.30, at * H);
      g.rotate(-Math.PI / 2);
      for (let i = 0; i < n; i++) {
        const gx = -70 + Math.floor(i / 5) * 66 + (i % 5) * 12;
        if (i % 5 === 4) chalkStroke(g, [[gx - 44, 22], [gx + 10, -22]], 6, seed + i, 0.85);
        else chalkStroke(g, [[gx, -26], [gx - 4, 24]], 6, seed + i, 0.85);
      }
      g.restore();
    };
    along('M. GRECO', 0.10, 46, { seed: 501, weight: 0.15, alpha: 0.9, condense: 0.85 });
    tally(0.22, 7, 510);
    along('2 SEWERS', 0.34, 34, { seed: 520, weight: 0.15, alpha: 0.75, condense: 0.85 });
    along('SAL', 0.52, 46, { seed: 530, weight: 0.15, alpha: 0.7, condense: 0.85 });
    tally(0.62, 4, 540);
    along('ROSA', 0.78, 40, { seed: 550, weight: 0.15, alpha: 0.65, condense: 0.85 });
    tally(0.88, 6, 560);
    const geo = new THREE.PlaneGeometry(GROUND.curbW, 12);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, texMat(canvasTexture(c), { transparent: true, depthWrite: false, lift: 0.5 }));
    m.position.set(GROUND.curbX + GROUND.curbW / 2, GROUND.walkTop + 0.014, 6);
    m.renderOrder = 2;
    root.add(m);
  }

  return { root, homeMesh };
}

/* =========================================================================== */

const DEFAULT_CAM = { pos: [0, 12, -34], look: [0, 4, 30], fov: 46 };
const MINE = new Set(['surface_detail', 'props_tour']);

export default registerSystem({
  name: 'surface',
  order: 11,
  init(app) {
    const built = buildSurface(app);
    this.root = built.root;
  },
  // our two scenarios move the camera, so put it back for everybody else's
  onScenario(name, app) {
    if (MINE.has(name)) return;
    app.camera.fov = DEFAULT_CAM.fov;
    app.camera.updateProjectionMatrix();
    app.camera.position.set(...DEFAULT_CAM.pos);
    app.camera.lookAt(...DEFAULT_CAM.look);
  },
});

registerScenario('surface_detail', {
  seed: 1925,
  setup: ({ app }) => {
    app.sim.reset(1925);
    app.camera.fov = 40;
    app.camera.updateProjectionMatrix();
    app.camera.position.set(-5.6, 6.2, -7.2);
    app.camera.lookAt(0.5, 0.10, 1.0);
  },
  settle: 0.5,
});

void CHALK; void INK; void mat; void outline;

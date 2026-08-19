/**
 * moments.js — THE BEATS A PLAYER TELLS A FRIEND ABOUT.
 * ============================================================================
 * `src/game/core.js` decides that a ball went through Mrs Kowalski's glass.
 * `src/game/rules.js` decides that the beat cop has rounded the corner. Neither
 * of them stages anything, and a verdict nobody staged is a line in a log.
 *
 * This file is the STAGE MANAGER. Its whole job is that a signature moment
 * arrives as ONE BEAT rather than as four systems that happened to fire in the
 * same tick — camera, effects, sound and booth on one timeline, with a setup
 * frame, a payoff frame, and a measured number of seconds between them
 * (DESIGN-BIBLE §8.2, and every gag below names its two frames in a comment).
 *
 * ── the division of labour, and it is strict ────────────────────────────────
 *   core.js    what happened          (never edited here)
 *   rules.js   what the block does about it, as bus events
 *   moments.js what it LOOKS and SOUNDS like, and in what order
 *
 * So this file never judges a ball, never moves a base and never touches the
 * count. It asks:
 *   • the camera director (src/render/cameras.js) for a framing and a push
 *   • the pigeon flock (src/world/atmosphere.js) to come off the cornice
 *   • the audio engine (src/audio/engine.js) for named period objects
 *   • the booth (src/audio/announcer.js) for Dot, the Gooch and the kids
 *   • src/chars/players.js for a pose, a face and a place to stand
 * and it draws, for itself, only the four things nobody else owns: the chalk
 * ghost, the chalk sewer tally on the curb, the ash-can lid, and the patrolman.
 *
 * ── the twelve (DESIGN-BIBLE §9) ────────────────────────────────────────────
 *  1 CAR!                    rules.js rolls it · staged below · `moment_car`
 *  2 The Sewer Shot          core.js decides it · staged below · `rule_sewers`
 *  3 Down the Sewer          ballphysics drops it · staged below · `moment_down_sewer`
 *  4 The Fire Escape Rattle  ballphysics rings it · staged below · `rule_fire_escape`
 *  5 The Window That Holds   ballphysics booms it · staged below · `rule_window`
 *  6 Cheese It               rules.js rolls it · staged below · `rule_cheese_it`
 *  7 The Ash Can Lid         ballphysics knocks it · lid drawn here · `moment_ashcan`
 *  8 Ghost Man on Second     rules.js rules it · drawn here · `rule_ghost`
 *  9 The Iceman's Wagon      parked by world/vehicles.js · staged below · `moment_wagon`
 * 10 FRAAAAN-KIEEE!          rules.js rolls it · staged below · `moment_frankie`
 * 11 The Hand-Over-Hand      fired at first pitch · staged below · `moment_hands`
 * 12 The Lights Come On      fired at the last half · staged below · `moment_lights`
 *
 * Which of them actually fire in a live game is measured, not asserted: run
 * `node tools/playthrough.mjs --seeds 3` and count the `moment:*` events. That
 * counter is the point of emitting a `moment:<name>` for every one of them.
 */

import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { T } from '../core/tuning.js';
import { registerScenario } from '../core/scenarios.js';
import { liveMatch } from './core.js';
import { street, STREET } from './rules.js';
import { BASES, groundAt } from './layout.js';

/* ============================================================================
   0. PALETTE AND HAND
   ----------------------------------------------------------------------------
   Every colour here is quoted from DESIGN-BIBLE §2 and nothing is eyeballed.
   Chalk is the only thing in the game allowed above L* 89 and ink the only
   thing below L* 19, so every mark this file draws is a two-sided read: an ink
   line under a chalk line, exactly as §2.5's five supporting reads require.
   ========================================================================= */

const CHALK = '#F6F0E2';        // L* 94.9
const INK = '#2A1D1A';          // L* 12.3
const COP_COAT = '#455072';     // L* 33.6 — navy serge, above the L* 28 material floor
const COP_COAT_LIT = '#5A6688';
const COP_SKIN = '#EFC199';
const COP_BRASS = '#E3A32B';
const COP_STICK = '#A85E2A';
const BLUSH = '#DE8062';
const SHADOW = '#3E4658';       // §2.7, the only shadow colour in the game
const TIN = '#9A9188';
const TIN_DARK = '#6E6A62';
const GLASS = '#A8C6E2';

const mrng = new RNG(19250922);

/* --- canvas helpers --------------------------------------------------------
   A chalk line is not a vector stroke: it is a stick of soft rock dragged over
   granite, so it breaks up, it is fattest where the hand pressed, and it leaves
   dust beside itself. All three are drawn rather than filtered (Law 3). */

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  return { c, g };
}

/** One chalk stroke through a list of points, with the ink underline that makes it read. */
function chalkPath(g, pts, { w = 7, alpha = 0.92, ink = true, jitter = 1.6, rnd = mrng, close = false } = {}) {
  const draw = (colour, width, a, off) => {
    g.save();
    g.globalAlpha = a;
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const jx = (rnd.next() - 0.5) * jitter, jy = (rnd.next() - 0.5) * jitter;
      const x = pts[i][0] + jx + off, y = pts[i][1] + jy + off;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    if (close) g.closePath();
    g.stroke();
    g.restore();
  };
  // the ink floor under the chalk ceiling: 1.5 px of outline either side, so the
  // mark survives a light sidewalk AND a dark shadow (§2.5)
  if (ink) draw(INK, w + 3, alpha * 0.55, 0);
  draw(colour(CHALK), w, alpha, 0);
  // dust: the chalk that did not stay on the line
  g.save();
  g.globalAlpha = alpha * 0.28;
  g.fillStyle = CHALK;
  for (let i = 0; i < pts.length; i++) {
    for (let k = 0; k < 3; k++) {
      const a = rnd.range(0, 6.283), r = rnd.range(w * 0.6, w * 1.9);
      g.fillRect(pts[i][0] + Math.cos(a) * r, pts[i][1] + Math.sin(a) * r, 1.6, 1.6);
    }
  }
  g.restore();
}
const colour = (c) => c;

/** Blocky chalk lettering. No font is loaded anywhere in this game (CONTRACT §1). */
const GLYPHS = {
  A: [[[0, 1], [0.5, 0], [1, 1]], [[0.18, 0.62], [0.82, 0.62]]],
  B: [[[0, 0], [0, 1]], [[0, 0], [0.8, 0.12], [0, 0.48]], [[0, 0.48], [0.9, 0.66], [0, 1]]],
  C: [[[1, 0.12], [0.2, 0], [0, 0.5], [0.2, 1], [1, 0.88]]],
  D: [[[0, 0], [0, 1]], [[0, 0], [0.9, 0.5], [0, 1]]],
  E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.52], [0.7, 0.52]]],
  F: [[[1, 0], [0, 0], [0, 1]], [[0, 0.5], [0.68, 0.5]]],
  G: [[[1, 0.1], [0.2, 0], [0, 0.5], [0.2, 1], [1, 0.9], [1, 0.58], [0.55, 0.58]]],
  H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.52], [1, 0.52]]],
  I: [[[0.5, 0], [0.5, 1]]],
  J: [[[0.9, 0], [0.9, 0.8], [0.45, 1], [0.05, 0.78]]],
  K: [[[0, 0], [0, 1]], [[0.95, 0], [0, 0.55]], [[0.25, 0.42], [1, 1]]],
  Q: [[[0.5, 0], [0, 0.42], [0.2, 1], [0.85, 0.92], [1, 0.35], [0.5, 0]], [[0.62, 0.72], [1, 1.05]]],
  L: [[[0, 0], [0, 1], [0.95, 1]]],
  M: [[[0, 1], [0, 0], [0.5, 0.5], [1, 0], [1, 1]]],
  N: [[[0, 1], [0, 0], [1, 1], [1, 0]]],
  O: [[[0.5, 0], [0, 0.42], [0.2, 1], [0.85, 0.92], [1, 0.35], [0.5, 0]]],
  P: [[[0, 1], [0, 0], [0.9, 0.14], [0, 0.52]]],
  R: [[[0, 1], [0, 0], [0.9, 0.14], [0, 0.52]], [[0.3, 0.5], [1, 1]]],
  S: [[[1, 0.08], [0.2, 0], [0, 0.42], [0.9, 0.6], [0.8, 1], [0, 0.92]]],
  T: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]],
  U: [[[0, 0], [0.05, 0.85], [0.5, 1], [0.95, 0.85], [1, 0]]],
  V: [[[0, 0], [0.5, 1], [1, 0]]],
  W: [[[0, 0], [0.2, 1], [0.5, 0.4], [0.8, 1], [1, 0]]],
  X: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]],
  Y: [[[0, 0], [0.5, 0.5], [1, 0]], [[0.5, 0.5], [0.5, 1]]],
  Z: [[[0, 0], [1, 0], [0, 1], [1, 1]]],
  '!': [[[0.5, 0], [0.5, 0.66]], [[0.5, 0.9], [0.5, 1]]],
  '?': [[[0.05, 0.16], [0.5, 0], [0.95, 0.3], [0.5, 0.6], [0.5, 0.72]], [[0.5, 0.94], [0.5, 1]]],
  '-': [[[0.1, 0.55], [0.9, 0.55]]],
  '1': [[[0.2, 0.2], [0.5, 0], [0.5, 1]]],
  '2': [[[0, 0.15], [0.5, 0], [1, 0.3], [0, 1], [1, 1]]],
  '3': [[[0, 0.05], [0.9, 0.16], [0.35, 0.5], [1, 0.72], [0.1, 1]]],
  '4': [[[0.75, 1], [0.75, 0], [0, 0.7], [1, 0.7]]],
  '5': [[[1, 0], [0.1, 0], [0, 0.45], [0.85, 0.55], [0.75, 1], [0, 0.92]]],
  '.': [[[0.5, 0.92], [0.5, 1]]],
  "'": [[[0.5, 0], [0.42, 0.28]]],
  ' ': [],
};

/**
 * `squash` narrows the ADVANCE without shortening the glyph, which is how road
 * lettering has always been painted: tall and thin on the ground so that it
 * comes back square to somebody standing up. Ours is chalked on a street seen at
 * eleven degrees, so 0.42 is the number that makes a 45-pixel-tall letter also
 * 45 pixels wide on screen. Without it the ledger is a smear.
 */
function chalkText(g, text, x, y, size, { w = Math.max(3, size * 0.13), gap = 0.32, alpha = 0.95, rnd = mrng, tilt = 0, squash = 1 } = {}) {
  let cx = x;
  const step = size * 0.62 * squash;
  for (const ch of text.toUpperCase()) {
    const strokes = GLYPHS[ch];
    if (strokes) {
      for (const s of strokes) {
        const pts = s.map(([u, v]) => {
          const px = cx + u * step;
          const py = y + v * size;
          // every mark sits 1-4 degrees off the frame axes (§11): the hand was not a plotter
          return [px + (v - 0.5) * size * tilt, py];
        });
        chalkPath(g, pts, { w, alpha, rnd, jitter: size * 0.035 });
      }
    }
    cx += step * (1 + gap);
  }
  return cx - x;
}

function texFrom(c, { srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function cardMesh(tex, w, h, { name = 'street:card', order = 6 } = {}) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
  );
  m.name = name;
  m.renderOrder = order;
  m.frustumCulled = false;
  return m;
}

/* ============================================================================
   1. THE CHALK GHOST  (§9.8)
   ----------------------------------------------------------------------------
   A kid drawn on the road in chalk, standing on the casting, with the same
   silhouette family as a real one so he reads as a KID and not as a symbol: cap,
   ears, dropped shoulders, knickers buckled under the knee, one sock down. Two
   frames, alternated at 4 Hz, because a ghost that does not fidget is a decal
   and §12 wants three visible poses out of everything.
   ========================================================================= */

/**
 * Chalk does not draw a wireframe. A kid chalked on asphalt is a FILLED shape
 * with a heavy edge, because that is what a stick of soft rock does when a
 * ten-year-old is pressing on it — and a wireframe at a hundred pixels reads as
 * a coat hanger, which is exactly what round 1 of this file shipped.
 *
 * So: every part is a shape, filled at 0.30 (he is translucent, §9.8), edged at
 * 0.95, with an ink line under the edge so he survives both a light sidewalk and
 * a dark shadow (§2.5). Two frames, alternated: he shifts his weight and his
 * near arm swings, which is the "small idle fidget" the reference asks for.
 */
function chalkShape(g, pts, { fill = 0.34, edge = 1, w = 6, rnd = mrng, ink = true, close = true } = {}) {
  const path = () => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    if (close) g.closePath();
  };
  if (fill > 0) { g.save(); g.globalAlpha = fill; g.fillStyle = CHALK; path(); g.fill(); g.restore(); }
  if (ink) {
    g.save(); g.globalAlpha = 0.42; g.strokeStyle = INK;
    g.lineWidth = w + 4; g.lineJoin = 'round'; g.lineCap = 'round'; path(); g.stroke(); g.restore();
  }
  g.save();
  g.globalAlpha = edge; g.strokeStyle = CHALK;
  g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round';
  path(); g.stroke();
  // the second pass a hand makes going back over a line it was not happy with
  g.globalAlpha = edge * 0.5; g.lineWidth = w * 0.55;
  g.translate(rnd.range(-2, 2), rnd.range(-2, 2));
  path(); g.stroke();
  g.restore();
}

function drawGhost(g, W, H, frame) {
  const rnd = new RNG(4711 + frame * 13);
  const cx = W * 0.5;
  const S = H / 108;                                  // 108 units of chalk, cap to heel
  const lean = frame ? 1.8 : -1.6;
  const swing = frame ? 5 : -4;
  const P = (x, y) => [cx + (x + lean * (1 - y / 100) * 0.6) * S, (y + 4) * S];
  const shape = (pts, o) => chalkShape(g, pts.map(([x, y]) => P(x, y)), { w: 5.4 * (S / 2.66), rnd, ...o });

  // legs and boots first: everything above overlaps them, the way chalk does
  shape([[-13, 62], [-15, 84], [-16, 92], [-6, 92], [-5, 84], [-3, 62]]);
  shape([[3, 62], [5 + swing * 0.4, 84], [6 + swing * 0.4, 92], [16 + swing * 0.4, 92], [15 + swing * 0.4, 84], [13, 62]]);
  shape([[-17, 90], [-19, 99], [-4, 99], [-5, 90]]);
  shape([[5 + swing * 0.4, 90], [4 + swing * 0.4, 99], [18 + swing * 0.4, 99], [17 + swing * 0.4, 90]]);
  // knickers: buckled under the knee, a size wrong, like everything on this block
  shape([[-16, 40], [-18, 64], [-1, 64], [0, 52], [1, 64], [17, 64], [15, 40]]);
  // the shirt
  shape([[-15, 30], [-17, 44], [16, 44], [14, 30], [7, 25], [-8, 25]]);
  // arms — the near one is the fidget
  shape([[-15, 31], [-22, 44], [-19 - swing, 58], [-13 - swing, 57], [-15, 45], [-10, 34]]);
  shape([[14, 31], [21, 44], [18 + swing, 57], [12 + swing, 56], [14, 45], [9, 34]]);
  // head, ears, and the cap that is the whole silhouette
  shape([[-10, 24], [-11, 13], [-6, 8], [5, 8], [10, 13], [9, 24], [4, 27], [-5, 27]]);
  shape([[-11, 17], [-14, 18], [-11, 22]], { fill: 0.24, w: 4 });
  shape([[9, 17], [12, 18], [9, 22]], { fill: 0.24, w: 4 });
  shape([[-11, 10], [-9, 3], [-2, 0], [6, 1], [10, 6], [10, 11]]);
  shape([[-13, 11], [11, 12], [9, 15], [-12, 14]]);      // the brim, pulled down over one eye
  // two dots and nothing else: a ghost has no expression to have
  g.save();
  g.globalAlpha = 0.9; g.fillStyle = CHALK;
  for (const [x, y] of [[-4, 19], [4, 19]]) { const p = P(x, y); g.beginPath(); g.arc(p[0], p[1], 2.4 * S, 0, 6.283); g.fill(); }
  g.restore();
  // the dust the stick left beside every line
  g.save();
  g.globalAlpha = 0.2; g.fillStyle = CHALK;
  for (let i = 0; i < 130; i++) g.fillRect(cx + rnd.range(-24, 24) * S, rnd.range(2, 104) * S, 1.8, 1.8);
  g.restore();
}

class ChalkGhost {
  constructor(scene) {
    // Drawn opaque into a scratch canvas and composited ONCE at 0.62, so the
    // chalk reads as one translucent figure instead of a pile of overlapping
    // fills that stack up to solid where the arms cross the shirt.
    this.frames = [0, 1].map((f) => {
      const scratch = canvas2d(256, 384);
      drawGhost(scratch.g, 256, 384, f);
      const { c, g } = canvas2d(256, 384);
      g.globalAlpha = 0.72;
      g.drawImage(scratch.c, 0, 0);
      return texFrom(c);
    });
    this.mesh = cardMesh(this.frames[0], 4.0, 6.0, { name: 'street:ghost', order: 7 });
    this.mesh.visible = false;
    // the mandatory contact shadow (§2.7) — chalk or not, he stands on the road
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 20),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(SHADOW), transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }),
    );
    this.shadow.name = 'street:ghost_shadow';
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = 4;
    this.shadow.visible = false;
    scene.add(this.mesh, this.shadow);
    this.t = 0;
    this.base = -1;
  }
  show(base) {
    const b = BASES[Math.max(0, Math.min(2, base))];
    this.base = base;
    const y = groundAt(b.x);
    this.y = y + 3.02;
    this.mesh.position.set(b.x, this.y, b.z);
    this.shadow.position.set(b.x, y + 0.03, b.z);
    this.mesh.visible = true;
    this.shadow.visible = true;
    this.t = 0;
  }
  hide() { this.mesh.visible = false; this.shadow.visible = false; this.base = -1; }
  update(dt, camera) {
    if (!this.mesh.visible) return;
    this.t += dt;
    // 4 Hz, so he reads at the twelves-per-second the rest of the game moves at
    const f = (Math.floor(this.t * 4) % 2) | 0;
    if (this.mesh.material.map !== this.frames[f]) { this.mesh.material.map = this.frames[f]; this.mesh.material.needsUpdate = true; }
    this.mesh.position.y = (this.y ?? 3.02) + Math.sin(this.t * 2.1) * 0.055;
    if (camera) this.mesh.quaternion.copy(camera.quaternion);
  }
}

/* ============================================================================
   2. THE CURB TALLY  (§9.2)
   ----------------------------------------------------------------------------
   "a chalk mark with the kid's initial goes on the curb." It is written on the
   road just inside the north gutter, where the block has been writing on the
   street all afternoon (src/world/surface.js already chalks the bases there),
   and it accumulates: one row per sewer shot, in the order they were hit, so by
   the third inning the curb is a scoreboard nobody agreed to keep.
   ========================================================================= */

/**
 * WHERE IT GOES, and why it is not on the curb stone itself.
 *
 * The reference says "on the curb". The curb stone is 0.36 units of granite and
 * a mark on its face measures eleven pixels at 1600x900 from either locked
 * framing — which is not a mark, it is a smudge. So the ledger is chalked on the
 * ROAD instead, on the south side between the plate and the ice wagon: measured
 * against both locked framings that is the largest piece of empty roadway in the
 * picture, it is inside frame in both, and nobody stands on it.
 *
 * And it is deliberately NOT trying to be legible from the seat. The ground plane
 * is seen at eleven degrees, so a letter drawn big enough to read comes back as a
 * two-hundred-pixel smear that fights the chalk base lines already painted there
 * — measured, three times, in this round. What goes on the road is what goes on a
 * real road: a tight cluster of initials and tally strokes that reads as SOMEBODY
 * HAS BEEN KEEPING SCORE HERE and grows all afternoon. The legible copy of the
 * same fact is the placard over the kid's head, two seconds later.
 */
const LEDGER = { x: -15.2, z: 6.0, w: 7.0, d: 12.0, rows: 5, cw: 256, ch: 448 };

class CurbTally {
  constructor(scene) {
    this.scene = scene;
    this.entries = [];
    this.mesh = null;
    this.build();
  }
  clear() { this.entries.length = 0; this.build(); }

  /** initial + one stroke per sewer, added to the bottom of the column. */
  add(initial, sewers) {
    this.entries.push({ initial: (initial || '?').slice(0, 1), sewers: Math.max(1, sewers | 0) });
    if (this.entries.length > LEDGER.rows) this.entries.shift();
    this.build();
    return this.mesh;
  }

  build() {
    const { c, g } = canvas2d(LEDGER.cw, LEDGER.ch);
    const rnd = new RNG(1925);
    if (this.entries.length) {
      // the heading, written once at the top of the afternoon and gone over twice
      this.entries.forEach((e, i) => {
        const y = 18 + i * 84;
        chalkText(g, e.initial, 16, y, 74, { w: 9, rnd, tilt: 0.05, squash: 0.6 });
        for (let k = 0; k < e.sewers; k++) {
          chalkPath(g, [[86 + k * 32 + rnd.range(-3, 3), y + 4], [78 + k * 32, y + 72]],
            { w: 9, rnd, alpha: 0.92, jitter: 2.4 });
        }
      });
    }
    const tex = texFrom(c);
    if (this.mesh) {
      this.mesh.material.map?.dispose();
      this.mesh.material.map = tex;
      this.mesh.material.needsUpdate = true;
      return;
    }
    // THE ROAD IS CROWNED. src/world/props.js `roadHeight` puts the middle of the
    // street half a unit above the gutter, so a flat decal laid at y=0.075 is
    // BURIED for two thirds of its width — which is exactly what round 1 shipped
    // and why the first tally was invisible. The plane is segmented and each
    // vertex is lifted onto the real road.
    const geo = new THREE.PlaneGeometry(LEDGER.w, LEDGER.d, 20, 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      // rotation.z = PI mirrors local x into world -x (see below), so the road is
      // sampled at the world x this vertex will actually land on.
      pos.setZ(i, groundAt(LEDGER.x - pos.getX(i)) + 0.022);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.95,
    }));
    this.mesh.name = 'street:tally';
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    // -90 about X lays it on the road; 180 about Z turns the writing the right way
    // round for a camera that looks UP the street with world +x on screen left.
    // Without the second rotation the block's own chalk came out mirrored.
    this.mesh.rotation.set(-Math.PI / 2, 0, Math.PI);
    this.mesh.position.set(LEDGER.x, 0, LEDGER.z);
    this.scene.add(this.mesh);
  }
}

/* ============================================================================
   3. THE TWO-SEWER MAN  (§9.2)
   ----------------------------------------------------------------------------
   "He is a two-sewer man for the rest of the game, and the label renders over
   his head." A torn strip of newsprint with the words chalked on it, pegged
   above the kid, because §11 says every HUD element is a depicted object with a
   nameable material and "a rectangle" is not an answer.
   ========================================================================= */

function drawLabel(g, W, H, text) {
  const rnd = new RNG(90210 + text.length);
  // the paper: torn top and bottom, never an axis-aligned rectangle (§11)
  g.save();
  g.beginPath();
  g.moveTo(7, 16);
  for (let x = 7; x <= W - 7; x += 21) g.lineTo(x, 13 + rnd.range(-6, 6));
  g.lineTo(W - 7, H - 15);
  for (let x = W - 7; x >= 7; x -= 25) g.lineTo(x, H - 13 + rnd.range(-7, 7));
  g.closePath();
  g.fillStyle = '#E7DCC2';                    // newsprint, L* 87 — under the chalk ceiling
  g.fill();
  g.lineWidth = 4.5; g.strokeStyle = INK; g.globalAlpha = 0.9; g.stroke();
  g.restore();
  // two pin-holes, because it is pegged to something
  g.save();
  g.globalAlpha = 0.5; g.fillStyle = INK;
  for (const x of [26, W - 26]) { g.beginPath(); g.arc(x, H * 0.5, 4, 0, 6.283); g.fill(); }
  g.restore();
  // THE LETTERING IS INK, not chalk. Chalk on newsprint is two near-identical
  // high values and it disappeared at ninety pixels; the rest of this game's
  // type is black hand-lettering on paper and the placard now matches it.
  const size = Math.min(H * 0.46, (W - 76) / (text.length * 0.62 * 1.32));
  const used = text.length * size * 0.62 * 1.32;
  const x0 = (W - used) / 2 + size * 0.12;
  const y0 = (H - size) / 2;
  g.save();
  g.strokeStyle = INK; g.lineWidth = Math.max(3, size * 0.19);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const step = size * 0.62;
  let cx = x0;
  for (const ch of text.toUpperCase()) {
    const strokes = GLYPHS[ch];
    if (strokes) for (const st of strokes) {
      g.beginPath();
      st.forEach(([u, v], i) => {
        const px = cx + u * step + (v - 0.5) * size * 0.05;
        const py = y0 + v * size;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      });
      g.stroke();
    }
    cx += step * 1.32;
  }
  g.restore();
  // one chalk stroke under it, because a kid could not resist
  chalkPath(g, [[x0 - 4, y0 + size + 12], [x0 + used, y0 + size + 8]], { w: 5, alpha: 0.7, rnd, ink: false });
}

class Placard {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.kid = null;
    this.text = '';
    this.t = 0;
  }
  set(text, kid, hold = Infinity) {
    this.hold = hold;
    if (this.mesh && this.text === text && this.kid === kid) { this.t = 0; return; }
    this.text = text; this.kid = kid;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.material.map?.dispose(); this.mesh.material.dispose(); this.mesh.geometry.dispose(); }
    const wpx = Math.round(Math.max(220, Math.min(640, 62 + text.length * 34)));
    const { c, g } = canvas2d(wpx, 150);
    drawLabel(g, wpx, 150, text);
    const wide = (wpx / 150) * 1.55;
    this.mesh = cardMesh(texFrom(c), wide, 1.55, { name: 'street:placard', order: 9 });
    this.scene.add(this.mesh);
    this.t = 0;
  }
  clear() {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.material.map?.dispose(); this.mesh.material.dispose(); this.mesh.geometry.dispose();
    this.mesh = null; this.kid = null; this.text = '';
  }
  update(dt, camera) {
    if (!this.mesh) return;
    this.t += dt;
    if (this.t > (this.hold ?? Infinity)) { this.clear(); return; }
    const k = this.kid;
    if (!k || !k.group || !k.group.visible) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    const p = k.group.position;
    // it swings a little on its pegs, and it arrives with a pop (§12 anticipation)
    const pop = Math.min(1, this.t / 0.22);
    const s = 0.7 + 0.3 * (pop < 1 ? 1.25 * pop : 1) + (pop >= 1 ? Math.sin(this.t * 3.1) * 0.012 : 0);
    this.mesh.position.set(p.x, p.y + 6.3 + Math.sin(this.t * 2.4) * 0.09, p.z);
    this.mesh.scale.setScalar(s);
    this.mesh.rotation.z = Math.sin(this.t * 1.7) * 0.035;
    if (camera) { this.mesh.quaternion.copy(camera.quaternion); this.mesh.rotateZ(Math.sin(this.t * 1.7) * 0.035); }
  }
}

/* ============================================================================
   4. THE PATROLMAN  (§9.6)
   ----------------------------------------------------------------------------
   "the adult is never a villain — he is a weather system with a hat" (§8.1), so
   he is drawn the way weather is drawn: big, slow, and completely uninterested.
   Two walk frames at 4 Hz, a bell-crown custodian helmet, a double-breasted
   navy serge blouse with two rows of brass, and a nightstick he never once
   swings. He crosses the block in four and a half seconds; the reference says
   thirty, and thirty seconds of held game is a punishment rather than a joke,
   so the walk is compressed and the joke is not.
   ========================================================================= */

/**
 * Round 1 of this file drew him out of straight lines and he came back a
 * nutcracker: symmetric, boxed, flat, and about as funny as a fire hydrant. So
 * he is redrawn the way the rest of the cast is built — silhouette first, curves
 * everywhere, head and hat at forty per cent of the body, and a belly.
 *
 * The read, in order: bell-crown helmet · walrus moustache · brass · belly ·
 * boots. If the first two do not land at eighty pixels the drawing has failed,
 * because those two are the entire character.
 */
function smooth(g, pts, close = true) {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = pts.length;
  g.beginPath();
  g.moveTo(...mid(pts[n - 1], pts[0]));
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    const m = mid(p, q);
    g.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  if (close) g.closePath();
}

function drawCop(g, W, H, frame) {
  const rnd = new RNG(1861 + frame * 31);
  const S = H / 116;
  const cx = W * 0.5;
  const bob = frame ? -0.9 : 0.4;                 // he rolls a little; a beat cop is not a soldier
  const P = (x, y) => [cx + x * S, (y + 8 + bob) * S];
  const part = (pts, fill, { line = INK, w = 2.6, alpha = 1, curve = true } = {}) => {
    g.save(); g.globalAlpha = alpha;
    const q = pts.map(([x, y]) => P(x, y));
    if (curve) smooth(g, q);
    else { g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (line) { g.lineWidth = w * S; g.strokeStyle = line; g.lineJoin = 'round'; g.stroke(); }
    g.restore();
  };
  const swing = frame ? 1 : -1;

  // the contact shadow he stands in (§2.7). Nothing in this game floats.
  g.save();
  g.globalAlpha = 0.36; g.fillStyle = SHADOW;
  g.beginPath(); g.ellipse(cx, (104 + bob) * S, 18 * S, 4.0 * S, 0, 0, 6.283); g.fill();
  g.restore();

  // ── legs and boots, under everything, because the coat hangs over them ──
  part([[-5, 70], [-11 + swing * 6, 84], [-12 + swing * 6, 94], [-2 + swing * 6, 94], [0, 82], [3, 70]], COP_COAT);
  part([[3, 70], [8 - swing * 6, 84], [9 - swing * 6, 94], [18 - swing * 6, 94], [13, 82], [9, 70]], COP_COAT_LIT);
  part([[-14 + swing * 6, 92], [-15 + swing * 6, 99], [-11 + swing * 6, 102], [-1 + swing * 6, 102], [1 + swing * 6, 96], [-2 + swing * 6, 92]], '#2E2A28');
  part([[8 - swing * 6, 92], [5 - swing * 6, 96], [7 - swing * 6, 102], [17 - swing * 6, 102], [21 - swing * 6, 99], [19 - swing * 6, 92]], '#2E2A28');

  // ── THE COAT. Shoulders narrow, belly wide, hem flared: a navy pear. ──
  part([[-15, 36], [-19, 48], [-21, 59], [-19, 70], [-17, 76], [17, 76], [19, 70], [21, 59], [19, 48], [15, 36],
    [8, 32], [-8, 32]], COP_COAT, { w: 3.0 });
  // the lit side. One sun, high, slightly behind the camera (§3.2) — so his right.
  g.save();
  g.globalAlpha = 0.55;
  const lit = [[2, 33], [6, 44], [8, 59], [6, 74], [17, 76], [19, 70], [21, 59], [19, 48], [15, 36], [8, 32]].map(([x, y]) => P(x, y));
  smooth(g, lit); g.fillStyle = COP_COAT_LIT; g.fill();
  g.restore();
  // the belt, the buckle, and the belly they are losing an argument with
  part([[-20, 60], [-20, 66], [20, 66], [20, 60]], '#39405C', { curve: false, w: 2.0 });
  part([[-4, 59], [-4, 67], [5, 67], [5, 59]], COP_BRASS, { curve: false, w: 2.0 });
  // two rows of brass, the only saturated thing on him, and Law 4's whole payment
  g.save();
  g.fillStyle = COP_BRASS; g.strokeStyle = INK; g.lineWidth = 1.4 * S;
  for (let i = 0; i < 5; i++) for (const x of [-8.4, 8.4]) {
    const p = P(x * (1 + i * 0.055), 38 + i * 5.6);
    g.beginPath(); g.arc(p[0], p[1], 2.3 * S, 0, 6.283); g.fill(); g.stroke();
  }
  g.restore();

  // ── arms. One hangs with the stick, one is folded behind his back. ──
  part([[-15, 38], [-22, 48], [-24, 59], [-20 - swing * 2, 66], [-14, 65], [-16, 55], [-12, 43]], COP_COAT, { w: 2.4 });
  part([[15, 38], [22, 48], [24, 57], [21 + swing * 2, 64], [15, 62], [17, 53], [12, 43]], COP_COAT_LIT, { w: 2.4 });
  part([[-21, 62], [-24, 68], [-19, 71], [-14, 68], [-15, 62]], COP_SKIN, { w: 2.2 });    // the bare hand
  // the nightstick on its leather thong. Never once swung, in eleven years.
  part([[-22 - swing, 68], [-25 - swing, 84], [-22 - swing, 88], [-18 - swing, 86], [-17 - swing, 69]], COP_STICK, { w: 2.0 });

  // ── collar, jowls, face ──
  // The face lives BELOW the brim, not behind it. Round 2 of this drawing put the
  // eyes at y=15 and then drew the brim over them, so he had no eyes at all —
  // which is the single fastest way to make a character read as furniture.
  part([[-11, 30], [-12, 24], [12, 24], [11, 30]], COP_COAT_LIT, { w: 2.2 });
  part([[-12, 30], [-13, 20], [-10, 13], [0, 10], [10, 13], [13, 20], [12, 30], [6, 34], [-6, 34]], COP_SKIN, { w: 2.6 });
  // under-brim shade: the whole reason a helmet reads as a helmet
  g.save();
  g.globalAlpha = 0.28;
  const sh = [[-13, 20], [-11, 13], [0, 10], [11, 13], [13, 20], [0, 21]].map(([x, y]) => P(x, y));
  smooth(g, sh); g.fillStyle = INK; g.fill();
  g.restore();
  g.save();                                                     // thick brows, permanently level
  g.strokeStyle = INK; g.lineWidth = 2.2 * S; g.lineCap = 'round';
  for (const x of [-5.4, 5.4]) {
    const p0 = P(x - 3, 19.6), p1 = P(x + 3, 18.8);
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
  }
  g.restore();
  g.save();                                                     // eyes, small and unimpressed
  g.fillStyle = INK;
  for (const x of [-5.0, 5.0]) { const p = P(x, 22.4); g.beginPath(); g.ellipse(p[0], p[1], 1.6 * S, 1.9 * S, 0, 0, 6.283); g.fill(); }
  g.restore();
  g.save();                                                     // cheeks, at 20% (§2.8)
  g.globalAlpha = 0.24; g.fillStyle = BLUSH;
  for (const x of [-9.0, 9.0]) { const p = P(x, 25); g.beginPath(); g.ellipse(p[0], p[1], 3.2 * S, 2.4 * S, 0, 0, 6.283); g.fill(); }
  g.restore();
  part([[-3.0, 24], [3.0, 24], [3.8, 27.6], [0, 29.2], [-3.8, 27.6]], '#DFA377', { w: 1.8 });   // the nose
  // THE WALRUS. Two lobes under the nose, and it is half his personality.
  part([[-11, 28.4], [-4, 27.6], [0, 29.6], [4, 27.6], [11, 28.4], [11.6, 32], [5.6, 34], [0, 31.6], [-5.6, 34], [-11.6, 32]],
    '#9A9188', { w: 2.2 });

  // ── THE BELL-CROWN HELMET. Everything above the brows is this hat. ──
  part([[-12, 14], [-13, 3], [-9, -6], [0, -11], [9, -6], [13, 3], [12, 14]], COP_COAT, { w: 3.0 });
  g.save();
  g.globalAlpha = 0.5;
  const hl = [[1, -10], [9, -6], [13, 3], [12, 14], [4, 14], [4, -9]].map(([x, y]) => P(x, y));
  smooth(g, hl); g.fillStyle = COP_COAT_LIT; g.fill();
  g.restore();
  part([[-18, 12], [-19, 15.5], [-13, 17.5], [0, 18.5], [13, 17.5], [19, 15.5], [18, 12], [0, 10]], COP_COAT, { w: 2.6 });
  g.save();                                                     // the brass shield, and the crown knob
  g.fillStyle = COP_BRASS; g.strokeStyle = INK; g.lineWidth = 1.8 * S;
  const bb = P(0, 3);
  g.beginPath();
  g.moveTo(bb[0], bb[1] - 5.6 * S); g.lineTo(bb[0] + 4.4 * S, bb[1] + 1.4 * S);
  g.lineTo(bb[0], bb[1] + 5.8 * S); g.lineTo(bb[0] - 4.4 * S, bb[1] + 1.4 * S);
  g.closePath(); g.fill(); g.stroke();
  const kn = P(0, -12.5);
  g.beginPath(); g.arc(kn[0], kn[1], 2.2 * S, 0, 6.283); g.fill(); g.stroke();
  g.restore();

  // serge has tooth. Drawn, never filtered (Law 3).
  g.save();
  g.globalAlpha = 0.09; g.fillStyle = INK;
  for (let i = 0; i < 170; i++) g.fillRect(cx + rnd.range(-22, 22) * S, rnd.range(28, 96) * S, 1.5, 1.5);
  g.restore();
}

/** Where the cop walks: up the north gutter, past the game, and round the far corner. */
const BEAT = { x0: 15.8, z0: 7.0, x1: 9.6, z1: 53.0, y: 0.10, h: 7.4 };

class Patrolman {
  constructor(scene) {
    this.frames = [0, 1].map((f) => {
      const { c, g } = canvas2d(240, 400);
      drawCop(g, 240, 400, f);
      return texFrom(c);
    });
    this.mesh = cardMesh(this.frames[0], BEAT.h * 0.60, BEAT.h, { name: 'street:cop', order: 8 });
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.u = 0;
    this.t = 0;
    this.on = false;
  }
  start() { this.on = true; this.u = 0; this.t = 0; this.mesh.visible = true; }
  stop() { this.on = false; this.mesh.visible = false; }
  update(dt, camera, len) {
    if (!this.on) return;
    this.t += dt;
    this.u = Math.min(1, this.t / Math.max(0.5, len));
    const e = this.u;                               // constant pace: he is not in a hurry
    const x = BEAT.x0 + (BEAT.x1 - BEAT.x0) * e;
    const z = BEAT.z0 + (BEAT.z1 - BEAT.z0) * e;
    this.mesh.position.set(x, groundAt(x) + BEAT.h * 0.5 - 0.1, z);
    const f = (Math.floor(this.t * 4.2) % 2) | 0;   // 12 fps feel on a 60 fps render (§12)
    if (this.mesh.material.map !== this.frames[f]) { this.mesh.material.map = this.frames[f]; this.mesh.material.needsUpdate = true; }
    // he fades out round the far corner rather than popping
    this.mesh.material.opacity = e > 0.9 ? Math.max(0, (1 - e) / 0.1) : 1;
    if (camera) this.mesh.quaternion.copy(camera.quaternion);
  }
}

/* ============================================================================
   5. THE ASH CAN LID  (§9.7)
   ----------------------------------------------------------------------------
   The lid spins off and wobbles flat with the full decaying wobble — which is a
   real physical thing (a Euler disc) and the single most satisfying sound-and-
   picture pair in the whole cartoon library. The wobble frequency RISES as the
   amplitude falls, which is the part everybody gets wrong.
   ========================================================================= */

class AshLid {
  constructor(scene) {
    const geo = new THREE.CylinderGeometry(1.05, 1.15, 0.14, 18, 1);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TIN), roughness: 0.62, metalness: 0.18 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'street:ashlid';
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.09, 6, 20),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(TIN_DARK), roughness: 0.7 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.02;
    this.mesh.add(rim);
    scene.add(this.mesh);
    this.t = -1;
    this.p = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.spin = 0;
  }
  pop(pos, power = 1) {
    this.t = 0;
    this.p.copy(pos);
    this.p.y = Math.max(0.9, this.p.y);
    this.v.set(mrng.range(-2.6, -1.2) * Math.sign(this.p.x || 1), 7.4 * power, mrng.range(-1.4, 2.2));
    this.spin = mrng.range(9, 15);
    this.mesh.visible = true;
  }
  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t < 0.95) {                            // the throw
      this.v.y -= 34 * dt;
      this.p.addScaledVector(this.v, dt);
      if (this.p.y < 0.16) { this.p.y = 0.16; this.v.y *= -0.32; this.v.multiplyScalar(0.7); }
      this.mesh.rotation.x += this.spin * dt;
      this.mesh.rotation.z += this.spin * 0.6 * dt;
    } else {
      // the wobble: amplitude decays, frequency climbs, and it goes flat at 3.1 s
      const u = (this.t - 0.95) / 2.15;
      if (u >= 1) { this.t = -1; this.mesh.visible = false; return; }
      const amp = (1 - u) * (1 - u) * 0.62;
      const freq = 7 + u * 30;
      this.p.y = 0.09 + amp * 0.5;
      this.mesh.rotation.x = amp * Math.sin(this.t * freq);
      this.mesh.rotation.z = amp * Math.cos(this.t * freq * 1.02);
      this.mesh.rotation.y += dt * (1 - u) * 4;
    }
    this.mesh.position.copy(this.p);
  }
}

/* ============================================================================
   6. GLASS  (§9.5)
   ----------------------------------------------------------------------------
   Shards for the pane that does break, and one woman's face at the pane that
   does not. Both are drawn; neither is a particle preset.
   ========================================================================= */

class Shards {
  constructor(scene, n = 26) {
    const { c, g } = canvas2d(64, 64);
    g.fillStyle = GLASS;
    g.beginPath(); g.moveTo(32, 2); g.lineTo(60, 40); g.lineTo(20, 62); g.closePath(); g.fill();
    g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
    const tex = texFrom(c);
    this.mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.5, 0.5), this.mat, n);
    this.mesh.name = 'street:shards';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.items = Array.from({ length: n }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, rv: 0, s: 1 }));
    this.d = new THREE.Object3D();
    this.write();
  }
  burst(pos, n = 20) {
    let k = 0;
    for (const it of this.items) {
      if (it.life > 0) continue;
      it.life = mrng.range(1.1, 1.9);
      it.p.copy(pos);
      it.v.set(mrng.range(-9, 9), mrng.range(1, 10), mrng.range(-13, -3));
      it.r = mrng.range(0, 6.28); it.rv = mrng.range(-9, 9);
      it.s = mrng.range(0.5, 1.5);
      if (++k >= n) break;
    }
  }
  update(dt) {
    let any = false;
    for (const it of this.items) {
      if (it.life <= 0) continue;
      any = true;
      it.life -= dt;
      it.v.y -= 40 * dt;
      it.p.addScaledVector(it.v, dt);
      if (it.p.y < 0.1) { it.p.y = 0.1; it.v.y *= -0.28; it.v.x *= 0.7; it.v.z *= 0.7; }
      it.r += it.rv * dt;
    }
    if (any || this.dirty) this.write();
    this.dirty = any;
  }
  write() {
    let i = 0;
    for (const it of this.items) {
      if (it.life > 0) {
        this.d.position.copy(it.p);
        this.d.rotation.set(it.r * 0.6, it.r, it.r * 0.3);
        this.d.scale.setScalar(it.s * Math.min(1, it.life * 2));
      } else {
        this.d.position.set(0, -999, 0);
        this.d.scale.setScalar(0.001);
        this.d.rotation.set(0, 0, 0);
      }
      this.d.updateMatrix();
      this.mesh.setMatrixAt(i++, this.d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/**
 * THE WOMAN AT THE GLASS. She is not angry yet; she is deciding.
 *
 * She arrives with her own window — sash, glass, sill and a folded towel — drawn
 * into the card, and that is not decoration. Round 1 put her bare face on the
 * facade at the impact point and she landed behind a fire escape, a laundry line
 * and the barber's awning, which between them are about nine feet of ironwork
 * and wet sheets. A self-contained window can stand a foot proud of all of it
 * and still read as a window, because everything that says "window" is in the
 * card rather than behind it.
 */
function drawWoman(g, W, H) {
  const S = H / 100, cx = W / 2;
  const P = (x, y) => [cx + x * S, y * S];
  const poly = (pts, fill, line = INK, w = 2.4) => {
    g.beginPath();
    pts.forEach(([x, y], i) => { const p = P(x, y); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (line) { g.lineWidth = w * S * 0.4; g.strokeStyle = line; g.lineJoin = 'round'; g.stroke(); }
  };
  // the opening: a sooted brick reveal, then the dark of the room behind her
  poly([[-30, 1], [30, 1], [30, 97], [-30, 97]], '#6B4235');
  poly([[-25, 5], [25, 5], [25, 90], [-25, 90]], '#40352F');

  // THE UPPER SASH, still down. Everything glassy happens up here and nothing
  // glassy happens over her face, because a translucent blue wash over a face is
  // how round 1 turned her into a ghost.
  g.save();
  g.globalAlpha = 0.4; g.fillStyle = GLASS;
  g.fillRect(...P(-25, 5), 50 * S, 23 * S);
  g.restore();
  g.save();
  g.globalAlpha = 0.5; g.strokeStyle = CHALK; g.lineWidth = 2.6 * S * 0.4; g.lineCap = 'round';
  const q0 = P(-19, 25), q1 = P(-3, 8);
  g.beginPath(); g.moveTo(q0[0], q0[1]); g.lineTo(q1[0], q1[1]); g.stroke();
  const r0 = P(6, 24), r1 = P(17, 10);
  g.beginPath(); g.moveTo(r0[0], r0[1]); g.lineTo(r1[0], r1[1]); g.stroke();
  g.restore();
  poly([[-26, 26], [26, 26], [26, 31], [-26, 31]], '#2E4034', INK, 2.2);       // the meeting rail

  // HER, leaning on the sill in the open lower half
  poly([[-21, 92], [-16, 62], [16, 62], [21, 92]], '#B03A5E');                 // claret housedress
  poly([[-9, 64], [-10, 52], [9, 52], [8, 64]], '#DFA377');                    // neck
  poly([[-12, 54], [-14, 42], [-8, 34], [8, 34], [14, 42], [12, 54], [6, 58], [-6, 58]], '#DFA377');
  poly([[-15, 44], [-14, 33], [0, 28], [14, 33], [15, 44], [9, 37], [-9, 37]], '#5B3B33');  // hair, pinned
  g.save();
  g.fillStyle = INK;
  for (const x of [-5, 5]) { const p = P(x, 45); g.beginPath(); g.ellipse(p[0], p[1], 2.0 * S, 2.4 * S, 0, 0, 6.283); g.fill(); }
  g.restore();
  g.save();                                                                     // brows: she is deciding
  g.strokeStyle = INK; g.lineWidth = 1.8 * S * 0.4; g.lineCap = 'round';
  for (const [x, d] of [[-5, -1], [5, 1]]) {
    const p0 = P(x - 3 * d, 41.4), p1 = P(x + 3 * d, 40.2);
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
  }
  const m0 = P(-5, 52), m1 = P(5, 52);
  g.lineWidth = 2.2 * S * 0.4;
  g.beginPath(); g.moveTo(m0[0], m0[1]); g.quadraticCurveTo(cx, 54.5 * S, m1[0], m1[1]); g.stroke();
  g.restore();
  g.save();                                                                     // cheeks (§2.8)
  g.globalAlpha = 0.24; g.fillStyle = BLUSH;
  for (const x of [-10, 10]) { const p = P(x, 49); g.beginPath(); g.ellipse(p[0], p[1], 3.6 * S, 2.6 * S, 0, 0, 6.283); g.fill(); }
  g.restore();
  poly([[-13, 76], [-8, 70], [8, 70], [13, 76], [12, 82], [-12, 82]], '#DFA377');   // her forearms, folded
  poly([[-23, 80], [-15, 75], [15, 75], [23, 80], [23, 88], [-23, 88]], '#E2D4B4'); // the folded towel

  // sill and frame, the outermost read
  poly([[-32, 88], [32, 88], [34, 98], [-34, 98]], '#7A4A34', INK, 3.0);
  g.save();
  g.strokeStyle = INK; g.lineWidth = 3.6 * S * 0.4;
  g.strokeRect(...P(-30, 1), 60 * S, 96 * S);
  g.restore();
}

class WindowFace {
  constructor(scene) {
    const { c, g } = canvas2d(240, 320);
    drawWoman(g, 240, 320);
    this.mesh = cardMesh(texFrom(c), 4.4, 5.9, { name: 'street:woman', order: 12 });
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.t = -1;
  }
  show(pos) {
    this.mesh.position.copy(pos || new THREE.Vector3(-24, 16, 30));
    this.mesh.visible = true;
    this.t = 0;
  }
  update(dt, camera) {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t > 4.2) { this.t = -1; this.mesh.visible = false; return; }
    const rise = Math.min(1, this.t / 0.5);
    this.mesh.material.opacity = this.t > 3.4 ? Math.max(0, (4.2 - this.t) / 0.8) : 1;
    this.mesh.scale.set(1, rise, 1);
    if (camera) this.mesh.quaternion.copy(camera.quaternion);
  }
}

/* ============================================================================
   7. THE BEAT SCHEDULER
   ----------------------------------------------------------------------------
   A moment is a list of [seconds, do]. It is ticked off the sim's own fixed
   timestep, so `__SB.advance(1.8)` lands on exactly the frame a critic asked
   for, and so a film strip of a moment is the same strip every time.
   ========================================================================= */

class Beats {
  constructor() { this.live = []; this.faults = []; }
  play(name, steps) {
    this.cancel(name);
    this.live.push({ name, t: 0, i: 0, steps: steps.filter(Boolean).sort((a, b) => a[0] - b[0]) });
  }
  cancel(name) { this.live = this.live.filter((b) => b.name !== name); }
  clear() { this.live.length = 0; }
  update(dt) {
    if (!this.live.length) return;
    for (const b of this.live) {
      b.t += dt;
      while (b.i < b.steps.length && b.t >= b.steps[b.i][0]) {
        const step = b.steps[b.i++];
        // A throw here would land in the app's console.error wrapper and fail the
        // build for the whole frame, so it is recorded instead and readable from
        // `__SB.app.moments.faults`. Nothing is swallowed; it is filed.
        try { step[1](); } catch (e) { this.faults.push(`${b.name}@${step[0]}: ${e && e.message}`); }
      }
    }
    this.live = this.live.filter((b) => b.i < b.steps.length);
  }
}

/* ============================================================================
   8. ASKING THE OTHER SYSTEMS FOR THINGS
   ----------------------------------------------------------------------------
   Every one of these is a REQUEST with a feature test in front of it. If a
   system is not in the build (a wave where somebody's file is half written, a
   scenario that does not boot audio) the moment quietly loses that layer and
   still plays. Nothing here reaches past a documented public surface.
   ========================================================================= */

const players = () => APP.get('players');
const cameras = () => APP.get('cameras');
const ann = () => APP.announcer;

function sfx(cue, o = {}) {
  const a = APP.audio;
  if (!a) return;
  if (cue === 'cop_whistle') whistleCue(a);      // src/audio/engine.js boots after us
  try { a.play(cue, o); } catch { /* no graph in this mode */ }
}
function sting(id) { if (id) bus.emit('roster:picked', { id }); }          // §7.3 per-kid instrument
function pigeons(x, y, z, r, urg) { try { APP.atmosphere?.flock?.scatter?.(x, y, z, r, urg); } catch { /* no flock */ } }
function puff(pos, n = 6, power = 2.4) { try { APP.puffs?.burst?.(pos, n, power); } catch { /* no puffs */ } }

function dot(text, kind = 'talk') { try { ann()?.dot?.interrupt?.([{ text, kind, grow: kind === 'shout' ? 1.12 : 1 }]); } catch { /* booth asleep */ } }
function gooch(text) { try { ann()?.gooch?.interrupt?.([{ text }]); } catch { /* booth asleep */ } }
function yell(text, body) { try { ann()?.chatter?.(text, { body, kind: 'shout' }); } catch { /* booth asleep */ } }
function says(text, body) { try { ann()?.chatter?.(text, { body }); } catch { /* booth asleep */ } }
function argue() { try { ann()?.argue?.(); } catch { /* booth asleep */ } }

/** Pin one of the two locked framings for the length of a moment (§17.4). */
function framing(which) {
  const c = cameras();
  if (!c || !c.solutions) return;
  c.pin = which;
  c.cutIn = -1; c.cutTo = null;
  c.tilt = 0; c.tiltGoal = 0;
  c.cut(which, true);
}
function unpin() {
  const c = cameras();
  if (!c) return;
  c.pin = null;
}
/** The slow push §17.4 allows on a celebration, asked for by its own name. */
function push() { const c = cameras(); if (c) c.pushT = 0; }

/**
 * Everybody this file is allowed to move.
 *
 * A kid standing on a bag is NOT on this list: src/game/baserunning.js has
 * borrowed that rig and steps it every frame from its own system, so a `goTo`
 * from here would be two directors pulling one body. Runners therefore do not
 * join the freeze, and that is a real seam rather than an oversight — it is in
 * the report.
 */
function cast() {
  const p = players();
  if (!p) return [];
  return p.kids.filter((k) => k && k.group && k.group.visible && !k.onBase);
}

/** Put everybody this file moved back on the mark src/game/layout.js gave him. */
function sendHome() {
  for (const k of cast()) {
    k.target = null; k.speed = 0; k.lock = 0;
    k.restClip = k.homeClip || k.idleClip;
    k.goHome?.();
    k.anim?.play?.(k.restClip, { fade: 0.2 });
  }
  const p = players();
  if (p?.batter) { p.batter.showStick(true); p.batter.anim.play('stance', { fade: 0.2 }); }
  if (p?.onDeck) { p.onDeck.showStick(true); p.onDeck.anim.play('bat_wait', { fade: 0.2 }); }
}
function kidBody(id) {
  const p = players();
  if (!p || !id) return null;
  return p.kids.find((k) => k.home && k.home.kid === id) || null;
}
function nick(id) { try { return liveMatch.roster[id]?.nick || id; } catch { return id; } }
function initialOf(id) { const n = nick(id); return (n || '?').slice(0, 1).toUpperCase(); }

/* ============================================================================
   9. THE MOMENTS
   ========================================================================= */

const beats = new Beats();
const M = {
  ghost: null, tally: null, placard: null, cop: null, lid: null, shards: null, woman: null,
  faults: beats.faults,
  fired: {},            // moment name -> how many times this game
  copLen: STREET.cop.len,
};

/**
 * Three of these fire more than five times in a game, and DESIGN-BIBLE §9 is
 * explicit that anything that does needs at least three variants or it stops
 * being a moment on the sixth viewing. Picked off our own PRNG, so the same seed
 * tells the same jokes in the same order.
 */
const LINES = {
  sewer1: [
    'One sewer, and the Gooch counted it out loud so nobody can shorten it later.',
    'One sewer. The Gooch has seen better. The Gooch has also seen worse.',
    'That is a sewer. A sewer is a sewer. The Gooch does not round up.',
  ],
  sewer2: [
    'Two sewers. The Gooch measured it. The Gooch does not measure for everybody.',
    'Two. And the Gooch walked it off himself, which he does not do in this heat.',
    'Two sewers, and the second one was not close. Put it on the curb.',
  ],
  sewer3: [
    'Three sewers. The Gooch has not measured three since the spring.',
    'Three. The Gooch would like everybody to remember where they were standing.',
    'Three sewers. The Gooch is going to sit down for a minute.',
  ],
  fender: [
    'Mr Esposito parks it there every Tuesday and every Tuesday he is amazed.',
    'Off the flivver. That fender has taken more of this game than anybody.',
    'The Gooch has told Mr Esposito. The Gooch has told him twice.',
  ],
  wagon: [
    'The Gooch works off that wagon. The Gooch would prefer you did not.',
    'Off the ice. Which is now a wall, and the wall is winning.',
    'That wagon has been a wall since eleven o\'clock and nobody has voted on it.',
  ],
  cans: [
    'Not legal. Nobody is objecting. The Gooch has stopped objecting to things.',
    'He fielded that with a lid. The Gooch is going to allow it.',
    'The lid is a glove now. Everything on this block is something else now.',
  ],
  rungs: [
    'Rung by rung. The Gooch could set his watch by that ladder.',
    'Every bar of it on the way down. That is a tune, that is.',
    'The Gooch counted eight rungs. There are six. The Gooch stands by it.',
  ],
  yells: {
    fender: ['OFF THE FENDER!', 'ESPOSITO! YOUR MACHINE!', 'It is LIVE! It is live off the fender!'],
    cans: ['He is fielding it with the LID!', 'THE LID! GET THE LID!', 'That is not a glove, that is a CAN!'],
    wagon: ['Off the ice wagon! It is a wall, it is a WALL!', 'The wagon is fair! The wagon is FAIR!', 'Dead off the box! Dead off the box!'],
  },
};
const pickLine = (bank) => bank[mrng.int(0, bank.length - 1)];

function fired(name, payload = {}) {
  M.fired[name] = (M.fired[name] || 0) + 1;
  bus.emit('moment:' + name, { n: M.fired[name], ...payload });
}

/* --- 6. CHEESE IT ----------------------------------------------------------
   SETUP  frame 0.0  a whistle two blocks off and one kid's head comes up
   PAYOFF frame 4.6  he turns the far corner and the block finishes the sentence
   ------------------------------------------------------------------------ */
function cheeseIt(p) {
  const len = p?.seconds ?? STREET.cop.len;
  M.copLen = len;
  const spotter = kidBody(p?.spotter) || cast()[0] || null;
  const holder = kidBody(p?.caught) || players()?.catcher || null;
  const bat = players()?.batter || null;
  const ss = players()?.fielders?.[3] || null;
  fired('cheese_it', { seconds: len, lookout: !!p?.lookout });

  beats.play('cop', [
    [0.00, () => {
      framing('field');
      sfx('cop_whistle', { gain: 0.9, dist: 120, pan: -0.35 });
      sfx('pigeons', { gain: 0.5, dist: 70, pan: -0.5, delay: 0.22, gate: 0 });
      pigeons(BEAT.x0, 1, BEAT.z0, 30, 1.4);
      if (spotter) { spotter.setFace('shock', 1.1); spotter.lookAt(BEAT.x0, BEAT.z0); }
      yell('CHEESE IT!', spotter);
    }],
    [0.24, () => {
      M.cop?.start();
      // THE FREEZE, and the whole read of it is that nine heads turn at once.
      // §13 asks for one synchronised group gag per venue; this is it, and it is
      // the difference between "some kids standing about" and "caught".
      for (const k of cast()) {
        k.target = null; k.speed = 0;
        k.act?.('freeze', { state: 'freeze', lock: Math.max(1.5, len - 2.6) });
        k.setFace?.('shock', 1.4);
        k.lookAt?.(BEAT.x0 + 1, BEAT.z0 + 4);
        k.snapFacing?.();
        k.showStick?.(false);            // every stick on the block goes behind a back
      }
    }],
    [1.75, () => {
      // …and then the innocent conversation, which is the actual joke
      for (const k of cast()) { k.lock = 0; k.act?.('idle_slouch', { state: 'idle', lock: len }); }
      // …and then nobody has ever seen a ball in their lives
      if (bat && ss) { bat.lookAt(ss.pos.x, ss.pos.y); ss.lookAt(bat.pos.x, bat.pos.y); }
      for (const k of cast()) if (k !== bat && k !== ss) { k.setFace?.('squint', 1.6); k.lookAt?.(k.pos.x + 4, k.pos.y + 30); }
      says('Some weather.', bat);
    }],
    [2.45, () => { says('Sure is.', ss); }],
    [2.95, () => {
      if (holder) { holder.setFace('shock', 1.6); holder.act?.('sulk', { state: 'sulk', lock: 1.4 }); }
      gooch('The Gooch counts one kid holding a ball and nowhere on this earth to put it.');
    }],
    [Math.max(2.9, len - 1.5), () => { dot('He is past the hydrant. He is past the hydrant.', 'talk'); }],
    [Math.max(3.4, len - 0.9), () => { sfx('cop_whistle', { gain: 0.42, dist: 190, pan: 0.4 }); }],
    [len - 0.05, () => {
      M.cop?.stop();
      unpin();
      sendHome();
    }],
    [len + 0.18, () => {
      // resumes MID-SENTENCE (§9.6). She was mid-word when he turned the corner.
      dot('— and as I was saying, the count is where we left it.', 'shout');
      says('Sez who? Play ball!', ss);
    }],
  ]);
}

/* --- 1. CAR! ---------------------------------------------------------------
   SETUP  frame 0.0  a klaxon two blocks off
   PAYOFF frame 3.9  a hand slaps the fender, a fist comes out the window, do-over
   ------------------------------------------------------------------------ */
function carComing(p) {
  const len = p?.seconds ?? STREET.car.len;
  const bat = players()?.batter || null;
  fired('car', { seconds: len });
  beats.play('car', [
    [0.00, () => {
      framing('field');
      sfx('klaxon', { gain: 0.62, dist: 150, pan: -0.55 });
      yell('CAR!', bat);
      pigeons(0, 1, 20, 26, 1.2);
    }],
    [0.30, () => {
      for (const k of cast()) {
        k.target = null; k.speed = 0;
        // everybody drags a base out of the road and gets on the curb
        const side = k.pos.x >= 0 ? 1 : -1;
        k.goTo?.(side * 19.5, k.pos.y + side * 1.5, { speed: T.run.speed, hard: true });
      }
      bat?.lookAt?.(0, -20);
    }],
    [1.30, () => {
      for (const k of cast()) { k.restClip = k.stick ? 'curb_wait' : 'idle_slouch'; k.act?.(k.restClip, { state: 'idle', lock: len }); }
      sfx('city_traffic', { gain: 0.5, dist: 40, pan: -0.2, gate: 0 });
      says('Hold it, hold it, HOLD it.', bat);
    }],
    [2.30, () => { sfx('thunk_fender', { gain: 0.85, dist: 22, pan: -0.3 }); says('Nice machine, mister!', cast()[3]); }],
    [2.70, () => { sfx('klaxon', { gain: 0.5, dist: 60, pan: 0.2 }); gooch('The Gooch has seen that fist before. The Gooch is not impressed by it.'); }],
    [len - 0.1, () => { unpin(); sendHome(); }],
  ]);
}

/** The block's universal undo, announced so the player knows the count survived. */
function doOver(p) {
  fired('do_over', { kind: p?.kind });
  beats.play('doover', [
    [0.10, () => { sfx('ui_bottlecaps', { gain: 0.7, dist: 8 }); }],
    [0.20, () => { dot('Do-over. Nobody argues with a do-over.', 'shout'); }],
    [1.20, () => { gooch('The Gooch would like a do-over on his whole afternoon.'); }],
  ]);
}

/* --- 2. THE SEWER SHOT -----------------------------------------------------
   SETUP  frame 0.0  the pigeons come off the cornice in a sheet
   PAYOFF frame 2.4  the Gooch has measured it and there is chalk on the curb
   ------------------------------------------------------------------------ */
function sewerShot(p) {
  const s = Math.max(1, p?.sewers | 0);
  const who = p?.batter || p?.who || '';
  const body = kidBody(who) || players()?.batter || null;
  fired('sewer_shot', { sewers: s, who });

  const count = [];
  for (let i = 0; i < s; i++) count.push([0.75 + i * 0.62, () => {
    sfx('manhole_boom', { gain: 0.34 + i * 0.06, dist: 30 + i * 22, pan: 0.1 * i });
    gooch(['One.', 'Two.', 'Three.'][i] || `${i + 1}.`);
  }]);

  beats.play('sewers', [
    [0.00, () => {
      pigeons(0, 14, 46, 40, 2.0);
      sfx('pigeons', { gain: 0.85, dist: 42, pan: 0.1, gate: 0 });
      push();
    }],
    [0.12, () => { sting(who); }],                 // §7.3: his instrument, on the trot
    ...count,
    [0.78 + s * 0.62, () => {
      gooch(pickLine(s >= 3 ? LINES.sewer3 : s === 2 ? LINES.sewer2 : LINES.sewer1));
    }],
    [1.15 + s * 0.62, () => {
      M.tally?.add(initialOf(who), s);
      sfx('ui_clack', { gain: 0.5, dist: 14, pan: 0.5 });
      says('His letter on the curb! Chalk it!', cast()[5]);
    }],
    [1.85 + s * 0.62, () => {
      if (s >= 2 && body) {
        // his own rig keeps the label for the afternoon; the batter's box is shared
        // by whoever is up, so a label hung there is only true for nine seconds
        M.placard?.set(`${s === 3 ? 'THREE' : 'TWO'}-SEWER ${nick(who)}`.toUpperCase(), body,
          kidBody(who) ? Infinity : 9);
      }
    }],
  ]);
}

/* --- 5. THE WINDOW ---------------------------------------------------------
   Two moments share one pane, and they are opposites.

   THE ONE THAT HOLDS (§9.5)
     SETUP  frame 0.0  a flat boom and one full beat of total silence
     PAYOFF frame 1.1  a woman's face at the glass, and the game doubles speed
   THE ONE THAT DOESN'T (§9.2's three-sewer special)
     SETUP  frame 0.0  glass, a dog, and nine kids leaving in nine directions
     PAYOFF frame 2.2  the street is empty and the ball is still rolling
   ------------------------------------------------------------------------ */
function windowHeld(p) {
  fired('window_held');
  const at = p?.pos ? p.pos.clone() : glassAt();
  const her = HER_WINDOW;
  street.interrupt?.('glass', { seconds: 1.5, doOver: false, defer: false, why: 'the glass held' });
  beats.play('glass', [
    [0.00, () => {
      // THE SILENCE. Everything on the mix goes down to a whisper for one beat,
      // which is the loudest thing this game ever does (§7.4, plate glass).
      duckWorld(0.06, 0.02);
      for (const k of cast()) {
        k.target = null; k.speed = 0;
        k.act?.('freeze', { state: 'freeze', lock: 1.8 });
        k.setFace?.('shock', 1.8);
        k.lookAt?.(at.x, at.z); k.snapFacing?.();
      }
      framing('field');
    }],
    [0.55, () => { M.woman?.show(her); }],
    [0.95, () => { duckWorld(1, 0.35); sfx('window_flex', { gain: 0.28, dist: 40, pan: -0.3 }); }],
    [1.55, () => {
      unpin();
      sendHome();
      // "the game resumes at double speed" — the pitcher's theatre, rushed, for
      // three at-bats. sim.windupRate is the sim's own knob for exactly this.
      if (APP.sim) { APP.sim.windupRate = 1.9; M.rushed = 3; }
      says('NOBODY MOVE. Everybody move.', players()?.batter);
    }],
  ]);
}

function windowBroke(p) {
  fired('window_broke');
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(-24, 15, 34);
  beats.play('smash', [
    [0.00, () => {
      M.shards?.burst(at, 22);
      pigeons(at.x, at.y, at.z, 44, 2.2);
      push();
      for (const k of cast()) k.setFace?.('shock', 1.2);
    }],
    [0.45, () => {
      for (const k of cast()) {
        k.target = null; k.speed = 0;
        const side = k.pos.x >= 0 ? 1 : -1;
        k.goTo?.(side * 20.5, k.pos.y + (mrng.next() - 0.5) * 12, { speed: T.run.speed * 1.15, hard: true });
      }
      yell('SCATTER!', players()?.catcher);
    }],
    [1.10, () => { says('IT WASN\'T ME! IT WAS HIM!', cast()[4]); }],
    [1.90, () => { M.tally?.add(initialOf(p?.batter || ''), 3); }],
    [2.40, () => { gooch('The Gooch saw nothing. The Gooch was looking at the ice.'); }],
    [3.30, () => { sendHome(); }],
  ]);
}

/**
 * Push the whole world down to a whisper and let it back UP TO WHERE IT WAS.
 * §7.4's "one full beat of total silence" after the plate glass booms. The mix
 * levels are captured on the way down rather than assumed, because restoring a
 * bus to 1.0 that was mixed at 0.58 is not a restore, it is a new mix.
 */
const MIX_HELD = new Map();
const HUSH = ['sfx', 'ambience', 'music', 'chatter'];
function duckWorld(level, ramp = 0.05) {
  const a = APP.audio;
  if (!a) return;
  const mix = a.mix || T.audio;
  if (!a.setBus || !mix || !mix.buses) return;
  for (const b of HUSH) {
    try {
      if (level < 1) {
        if (!MIX_HELD.has(b)) MIX_HELD.set(b, mix.buses[b]);
        a.setBus(b, MIX_HELD.get(b) * level, ramp);
      } else if (MIX_HELD.has(b)) {
        a.setBus(b, MIX_HELD.get(b), ramp);
        MIX_HELD.delete(b);
      }
    } catch { /* bus not in this mix */ }
  }
}

/* --- 4. THE FIRE ESCAPE RATTLE (§9.4) --------------------------------------
   SETUP  frame 0.0  it goes through the bar grating on the second floor
   PAYOFF frame 0.9  six rungs, each a distinct pitched clang, then the areaway
   ------------------------------------------------------------------------ */
let lastRattle = -99;
function fireEscape(p) {
  if (APP.time - lastRattle < 1.4) return;      // one rattle per ball, not one per collider
  lastRattle = APP.time;
  fired('fire_escape');
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(-22, 14, 26);
  const pan = at.x > 0 ? -0.45 : 0.45;
  const steps = [];
  for (let i = 0; i < 6; i++) {
    const t = 0.10 + i * 0.115 + i * i * 0.006;   // it accelerates: gravity is doing this
    steps.push([t, () => {
      // rung by rung, and each rung is a shorter bar, so each rung is HIGHER
      sfx('clang_iron', { gain: 0.86 - i * 0.09, dist: 26 + i * 2, pan, pitch: 0.78 + i * 0.085, gate: 0 });
      puff(new THREE.Vector3(at.x, Math.max(1.2, at.y - i * 2.1), at.z), 2, 1.1);
    }]);
  }
  beats.play('rattle', [
    ...steps,
    [0.94, () => { sfx('bounce_stone', { gain: 0.7, dist: 24, pan, speed: 0.86 }); }],
    [1.10, () => { says('IT IS ON THE SECOND FLOOR!', cast()[2]); }],
    [1.85, () => { if (mrng.chance(0.7)) gooch(pickLine(LINES.rungs)); }],
  ]);
}

/* --- the flivver (§10, Ninety-Fifth Street's third prop) --------------------
   The ball hits a fender THIRTY TIMES in a measured game — it is a parked car in
   a sixty-foot street and the block plays around it all afternoon. So the carom
   itself gets a tin tonk and a spring boing every time, and the full beat, with
   the klaxon and the Gooch, is rationed to the ones the RULES call a flivver
   carom. A moment that fires thirty times is a sound effect.                */
let lastFender = -99;
function fenderTouch(p) {
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(-18, 2, 18);
  puff(at, 4, 1.7);
  sfx('ui_boing', { gain: 0.34, dist: 22, pan: at.x > 0 ? -0.4 : 0.4, delay: 0.04, gate: 0.25 });
}
function flivver(p) {
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(-18, 2, 18);
  fenderTouch(p);
  if (APP.time - lastFender < 9) return;
  lastFender = APP.time;
  fired('flivver');
  beats.play('flivver', [
    [0.40, () => { sfx('klaxon', { gain: 0.34, dist: 30, pan: at.x > 0 ? -0.4 : 0.4 }); }],
    [0.70, () => { says(pickLine(LINES.yells.fender), cast()[6]); }],
    [1.55, () => { if (mrng.chance(0.7)) gooch(pickLine(LINES.fender)); }],
  ]);
}

/* --- 3. DOWN THE SEWER (§9.3) ---------------------------------------------- */
function downTheSewer(p) {
  fired('down_sewer');
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(16, 0.2, 12);
  street.interrupt?.('sewer', { seconds: 2.6, doOver: false, defer: false, why: 'down the grate' });
  beats.play('sewer', [
    [0.00, () => {
      framing('field');
      sfx('sewer_swallow', { gain: 0.95, pos: at, gate: 0 });
      sfx('klaxon', { gain: 0.22, dist: 170, pan: -0.5, delay: 1.35 });
    }],
    [0.35, () => {
      // Four kids on their knees round the grate, in an ARC and three and a half
      // units apart. Round 1 put five of them 1.6 apart on one line and they
      // fused into a single lump of knees — a kid is two units wide.
      const crew = cast().slice(0, 4);
      const side = Math.sign(at.x) || 1;
      crew.forEach((k, i) => {
        const a = -0.62 + i * 0.41;
        k.target = null; k.speed = 0;
        k.goTo?.(at.x - side * (2.2 + Math.cos(a) * 2.0), at.z + Math.sin(a) * 4.4, {
          speed: T.run.speed, hard: true,
          onArrive: (x) => { x.lookAt(at.x, at.z); x.act?.('crouch', { state: 'crouch', lock: 2.6 }); },
        });
      });
      yell('DOWN THE SEWER!', crew[0]);
    }],
    [1.40, () => { says('Who has got the coat hanger?', cast()[1]); }],
    [2.10, () => { argue(); }],
    [2.60, () => { unpin(); sendHome(); }],
  ]);
}

/* --- 7. THE ASH CAN LID (§9.7) --------------------------------------------- */
function ashCan(p) {
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(20, 1.4, 10);
  if (!p?.lid) { puff(at, 4, 1.6); return; }
  fired('ashcan');
  beats.play('ashcan', [
    [0.00, () => { M.lid?.pop(at, 1); puff(at, 7, 3.0); }],
    [0.95, () => { sfx('clatter_tin', { gain: 0.7, pos: at, gate: 0 }); }],
    [1.30, () => { says(pickLine(LINES.yells.cans), cast()[3]); }],
    [2.20, () => { if (mrng.chance(0.8)) gooch(pickLine(LINES.cans)); }],
  ]);
}

/* --- 8. GHOST MAN ON SECOND (§9.8) ----------------------------------------- */
function ghostOn(p) {
  fired('ghost', { base: p?.base });
  M.ghost?.show(p?.base ?? 1);
  const word = ['FIRST', 'SECOND', 'THIRD'][p?.base ?? 1] || 'SECOND';
  beats.play('ghost', [
    [0.10, () => { sfx('ui_clack', { gain: 0.42, dist: 16 }); }],
    [0.25, () => { yell(`GHOST MAN ON ${word}!`, cast()[2]); }],
    [1.20, () => { dot(`They are playing a ghost on ${word.toLowerCase()}. I want that in the record.`); }],
    [2.30, () => { gooch('The Gooch has been a ghost man on second. It is restful.'); }],
  ]);
}
function ghostGone(p) {
  M.ghost?.hide();
  if (!p?.scored) return;
  fired('ghost_argument');
  beats.play('ghostgone', [
    [0.15, () => { yell('HE SCORED! THE GHOST SCORED!', cast()[1]); }],
    [0.85, () => { if (p.argue) argue(); else dot('The ghost is in. I saw the ghost the whole way.'); }],
    [2.60, () => { gooch('Settled by volume, then seniority, then whoever owns the ball. As always.'); }],
  ]);
}

/**
 * A mother's two-syllable call from a fourth-floor window, "held long and
 * dropping" (§9.10). Any nickname on the block becomes one: the first vowel is
 * stretched, a dash goes in before the last syllable, and it ends on the long
 * fall. FANNY -> FAAAAAN-NYEEE!  ·  SOCKS -> SOOOOOCK-SEEE!
 */
function holler(name) {
  const n = String(name || 'Frankie').toUpperCase().replace(/[^A-Z]/g, '');
  if (n.length < 3) return `${n}EEEE!`;
  const v = Math.max(1, n.search(/[AEIOUY]/));
  const stretched = n.slice(0, v + 1) + n[v].repeat(4) + n.slice(v + 1);
  const cut = Math.max(v + 5, stretched.length - 2);
  return `${stretched.slice(0, cut)}-${stretched.slice(cut)}EEE!`;
}

/* --- 10. FRAAAAN-KIEEE! (§9.10) -------------------------------------------- */
function mother(p) {
  fired('mother', { who: p?.who });
  const body = kidBody(p?.who);
  const brother = players()?.stoopKid || null;
  const name = holler(p?.name || 'Frankie');
  beats.play('mother', [
    [0.00, () => {
      framing('field');
      sfx('mother_calling', { gain: 0.95, dist: 40, pan: 0.35, gate: 0 });
      for (const k of cast()) { k.target = null; k.speed = 0; k.lookAt?.(k.pos.x + 6, k.pos.y + 30); }
      dot(name, 'shout');
    }],
    [0.85, () => {
      if (body) { body.setFace('disappointed', 2.4); body.act?.('sulk', { state: 'sulk', lock: 1.6 }); }
      says('Aw, ma. AW, MA.', body);
    }],
    [1.75, () => {
      if (body) { body.showStick?.(false); body.goTo?.(21.5, Math.max(2, body.pos.y - 6), { speed: 9, gait: 'trot', hard: true }); }
      // …and the little brother, who has been on that stoop the entire game
      if (brother) { brother.lock = 0; brother.act?.('cheer_jump', { state: 'cheer', lock: 1.6 }); brother.setFace('grin', 3); }
    }],
    [2.40, () => { says('I am UP! I have been up since ELEVEN!', brother); }],
    [3.05, () => { gooch('The Gooch has met that mother. The Gooch went upstairs too.'); }],
    [3.60, () => { unpin(); sendHome(); if (body) body.group.visible = false; }],
  ]);
}

/* --- on the roof ----------------------------------------------------------- */
function onRoof(p) {
  fired('roof', { balls: p?.balls });
  const climber = kidBody(p?.climber) || cast()[4] || null;
  beats.play('roof', [
    [0.00, () => { sfx('pigeons', { gain: 0.7, dist: 66, pan: (p?.side ?? 1) * -0.5, gate: 0 }); }],
    [0.40, () => {
      if (climber) { climber.target = null; climber.goTo?.(20.2, 30, { speed: T.run.speed, hard: true }); }
      says('I went up last time! I went up LAST TIME!', climber);
    }],
    [1.30, () => {
      dot(p?.last ? 'That was the last one out of the box. That was the last one.' : 'On the roof. Somebody is going up.');
    }],
    [2.10, () => { gooch('Somebody is going up. It is not going to be the Gooch.'); }],
    [3.20, () => { sendHome(); }],
  ]);
}

/* --- 11. THE HAND-OVER-HAND (§9.11) ---------------------------------------- */
function handOverHand() {
  fired('hand_over_hand');
  const p = players();
  const a = p?.batter, b = p?.onDeck;
  beats.play('hands', [
    [0.00, () => {
      framing('batting');
      sfx('ui_clack', { gain: 0.6, dist: 10 });
      // The two captains stand nose to nose over the handle. `curb_wait` is the
      // only clip in the build that holds a stick VERTICAL, which is exactly the
      // pose this ritual is — so it is borrowed rather than faked.
      if (a) { a.target = null; a.at(2.2, 5.2); a.showStick(true); a.lookAt(-1.8, 5.6); a.snapFacing(); a.act('curb_wait', { state: 'ritual', lock: 3.6 }); }
      if (b) { b.target = null; b.at(-1.8, 5.6); b.showStick(true); b.lookAt(2.2, 5.2); b.snapFacing(); b.act('curb_wait', { state: 'ritual', lock: 3.6 }); }
      // and the block comes in to watch, because being picked is the ceremony
      cast().slice(2, 7).forEach((k, i) => {
        k.target = null;
        k.goTo?.(-9 + i * 4.4, 13 + (i % 2) * 2.4, { speed: 11, gait: 'trot', hard: true, onArrive: (x) => { x.lookAt(0, 5.4); x.act?.('ready', { state: 'watch', lock: 3.2 }); } });
      });
      dot('Fist over fist, and the block is counting.', 'shout');
    }],
    [0.55, () => { says('ONE.', a); a?.act?.('point', { state: 'point', lock: 0.45 }); }],
    [1.05, () => { says('TWO.', b); b?.act?.('point', { state: 'point', lock: 0.45 }); }],
    [1.55, () => { says('THREE.', a); a?.act?.('point', { state: 'point', lock: 0.45 }); }],
    [2.05, () => { says('FOUR — and that is the TIP.', b); b?.setFace?.('grin', 1.6); }],
    [2.70, () => { says('Swing it round your head three times, then.', a); b?.setFace?.('shock', 1.6); }],
    [3.60, () => { gooch('The Gooch has watched this ritual for eleven years and has never once seen it go smoothly.'); }],
    [4.30, () => { unpin(); sendHome(); }],
  ]);
}

/* --- 12. THE LIGHTS COME ON (§9.12) ---------------------------------------- */
function lightsComeOn() {
  fired('lights');
  beats.play('lights', [
    [0.00, () => { sfx('church_bells', { gain: 0.55, dist: 180, pan: 0.3, gate: 0 }); }],
    [0.60, () => { dot('The lights are coming on up the block. One more, and then everybody\'s mother wins.', 'shout'); }],
    [2.20, () => { sfx('mother_calling', { gain: 0.6, dist: 70, pan: -0.4, gate: 0 }); }],
    [3.00, () => { gooch('The Gooch can no longer see the ball. The Gooch has not been able to see the ball since the fourth.'); }],
  ]);
}

/* --- where the block's three hazards actually stand ------------------------
   The deli's plate glass, the catch-basin castings and the ash cans at the curb
   are real boxes in src/game/ballphysics.js and src/world/props.js. When the
   RULES fire one of them rather than the ball finding it, the beat still has to
   happen at the object, not at the origin — so these are the same coordinates
   those two files register, and if either moves this is wrong and it will look
   wrong immediately.                                                        */
const glassAt = () => new THREE.Vector3(-31.4, 6.0, 17.5);        // 'deli plate glass', x = -facadeX
/**
 * MRS KOWALSKI'S WINDOW. She is a person with an address, not a function of
 * where the ball went: the same sash, every time, second floor, south side,
 * forty-four feet up the block. Measured against both locked framings, that is
 * the only stretch of facade that is inside frame in BOTH — a window chosen off
 * the impact point projected to x=1740 from FIELD, which is a hundred and forty
 * pixels outside the picture, and the joke does not survive being off screen.
 */
const HER_WINDOW = new THREE.Vector3(-28.4, 15.6, 44);
const grateAt = (p) => new THREE.Vector3((p?.side ?? 1) * 17.0, 0.2, 11.0);
const canAt = (p) => new THREE.Vector3((p?.side ?? 1) * 19.6, 1.5, 9.0);

/* --- 9. THE ICEMAN'S WAGON (§9.9) ------------------------------------------ */
let lastWagon = -99;
function wagon(p) {
  // The ball finds the ice wagon's box a lot: it is a nine-foot wall standing in
  // short right (§9.9) and the block plays off it all afternoon. Twice a game is
  // a running gag; seven times is wallpaper. Measured, and rationed.
  if (APP.time - lastWagon < 45 || (M.fired.wagon || 0) >= 3) return;
  lastWagon = APP.time;
  fired('wagon');
  beats.play('wagon', [
    [0.00, () => { puff(p?.pos || new THREE.Vector3(-18, 2, 26), 6, 2.2); sfx('thud_wood', { gain: 0.8, pos: p?.pos, gate: 0 }); }],
    [0.50, () => { says(pickLine(LINES.yells.wagon), cast()[5]); }],
    [1.40, () => { gooch(pickLine(LINES.wagon)); }],
  ]);
}

/* ============================================================================
   10. A POLICE WHISTLE
   ----------------------------------------------------------------------------
   src/audio/sfx.js invites other pieces to add cues to the one graph, and the
   cop needs a sound nobody else in the game needs. A 1925 patrolman's whistle is
   a brass pea whistle: two close air-jet tones around 2.4 and 3.0 kHz that beat
   against each other, plus the pea itself chopping the tone at 25-40 Hz, which
   is the warble everybody recognises and nobody can describe.
   ========================================================================= */

function whistleCue(a) {
  if (!a?.registerCue || a.cue?.('cop_whistle')) return;
  a.registerCue('cop_whistle', {
    bus: 'sfx', gain: 0.85, dur: 1.15, dist: 60,
    note: 'brass pea whistle, two air-jet tones + a 30 Hz pea chop (moments.js)',
    build(ctx, out, t0, o) {
      const seconds = 0.92;
      const body = ctx.createGain();
      body.gain.setValueAtTime(0.0001, t0);
      body.gain.exponentialRampToValueAtTime(0.9, t0 + 0.035);   // air takes a moment to speak
      body.gain.setValueAtTime(0.9, t0 + seconds * 0.62);
      body.gain.exponentialRampToValueAtTime(0.0006, t0 + seconds);
      // the pea: an LFO chopping the tone, and it slows as the breath runs out
      const chop = ctx.createGain();
      chop.gain.value = 0.62;
      const lfo = ctx.createOscillator();
      lfo.type = 'triangle';
      lfo.frequency.setValueAtTime(34, t0);
      lfo.frequency.linearRampToValueAtTime(22, t0 + seconds);
      const lfoAmp = ctx.createGain();
      lfoAmp.gain.value = 0.38;
      lfo.connect(lfoAmp).connect(chop.gain);
      lfo.start(t0); lfo.stop(t0 + seconds + 0.05);
      for (const [f, g] of [[2420, 0.5], [3010, 0.42], [4830, 0.1]]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(f * 0.986, t0);
        osc.frequency.linearRampToValueAtTime(f, t0 + 0.06);
        osc.frequency.linearRampToValueAtTime(f * 0.982, t0 + seconds);
        const gg = ctx.createGain();
        gg.gain.value = g;
        osc.connect(gg).connect(chop);
        osc.start(t0); osc.stop(t0 + seconds + 0.05);
      }
      // the breath under it: filtered noise, because a whistle is a wind instrument
      const n = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * (seconds + 0.1)), ctx.sampleRate);
      const d = buf.getChannelData(0);
      let s = 1925;
      for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff - 1) * 0.4; }
      n.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 2900; bp.Q.value = 1.6;
      const ng = ctx.createGain();
      ng.gain.value = 0.16;
      n.connect(bp).connect(ng).connect(chop);
      n.start(t0); n.stop(t0 + seconds + 0.05);
      chop.connect(body).connect(out);
    },
  });
}

/* ============================================================================
   11. THE SYSTEM
   ========================================================================= */

let wired = false;

function wire() {
  if (wired) return;
  wired = true;

  // --- what rules.js decided
  bus.on('street:cheese_it', cheeseIt);
  bus.on('street:car', carComing);
  bus.on('street:do_over', doOver);
  bus.on('street:ghost', ghostOn);
  bus.on('street:ghost_gone', ghostGone);
  bus.on('street:mother', mother);
  bus.on('street:roof', onRoof);

  // --- the three hazards rules.js rolls off the core's own verdict
  bus.on('street:glass', (p) => windowHeld({ pos: glassAt(p) }));
  bus.on('street:down_sewer', (p) => downTheSewer({ pos: grateAt(p) }));
  bus.on('street:ashcan', (p) => ashCan({ pos: canAt(p), lid: true, speed: 22 }));

  // --- what core.js decided
  bus.on('street:sewers', sewerShot);
  bus.on('street:window', (p) => { if (!M.sawSmash) windowBroke(p); M.sawSmash = false; });
  bus.on('street:fire_escape', (p) => fireEscape(p));
  bus.on('street:flivver', (p) => flivver(p));

  // --- what the ball actually did (src/game/ballphysics.js)
  bus.on('ball:window', (p) => { if (p?.broke) { M.sawSmash = true; windowBroke(p); } else windowHeld(p); });
  bus.on('ball:fire_escape', (p) => { if (p?.phase !== 'through_grating') fireEscape(p); });
  bus.on('ball:sewer', downTheSewer);
  bus.on('ball:ashcan', ashCan);
  bus.on('ball:fender', fenderTouch);
  bus.on('ball:impact', (p) => { if (/wagon|ice|truck/i.test(p?.name || '')) wagon(p); });

  // --- the two that belong to the game rather than to the ball
  bus.on('atbat:begin', () => {
    // The ritual opens a GAME, not a screenshot. `onScenario` marks this build as
    // being driven by the harness, and a harness frame belonging to another piece
    // must never pick up our speech cards or our camera pin.
    if (street.atBats === 1 && !M.inScenario) beats.play('__hands', [[0.25, handOverHand]]);
    if (M.rushed > 0 && APP.sim) { M.rushed -= 1; if (M.rushed === 0) APP.sim.windupRate = 1; }
    // §9.12: the last INNING, not the last half. A three-inning game can be called
    // after the top of the third when the gang are ahead, so a bottom-half trigger
    // missed the ending in two games out of three — measured.
    const s = APP.sim?.state;
    if (s && !M.fired.lights && s.inning >= T.game.innings) lightsComeOn();
  });
}

export default registerSystem({
  name: 'moments',
  // after the gameplay slots and rules (64) and after the fx pool (60), before the
  // announcer (210) and the camera director (300) have their say on the same frame
  order: 66,

  init(app) {
    M.ghost = new ChalkGhost(app.scene);
    M.tally = new CurbTally(app.scene);
    M.placard = new Placard(app.scene);
    M.cop = new Patrolman(app.scene);
    M.lid = new AshLid(app.scene);
    M.shards = new Shards(app.scene);
    M.woman = new WindowFace(app.scene);
    M.rushed = 0;
    app.moments = M;
    M.beats = beats;
    M.play = (name, p) => {
      const table = {
        cheese_it: cheeseIt, car: carComing, sewers: sewerShot, window_held: windowHeld,
        window_broke: windowBroke, fire_escape: fireEscape, flivver, down_sewer: downTheSewer,
        ashcan: ashCan, ghost: ghostOn, mother, roof: onRoof, hands: handOverHand,
        lights: lightsComeOn, wagon,
      };
      table[name]?.(p);
    };
    whistleCue(app.audio);
    wire();
  },

  update(dt, app) {
    // A fresh ball game means fresh chalk. `sim.reset()` builds a new state object
    // and never announces itself, so watching that object's identity is how this
    // file finds out — the same signal src/game/rules.js uses, and the reason the
    // curb is not still carrying last game's tally in the first frame of this one.
    if (app.sim && app.sim.state !== M._stateRef) { M._stateRef = app.sim.state; this.newGame(app); }
    beats.update(dt);
    M.lid?.update(dt);
    M.shards?.update(dt);
    M.cop?.update(dt, app.camera, M.copLen);
  },

  lateUpdate(dt, app) {
    // billboards face the camera AFTER the director has moved it, or they lag a cut
    M.ghost?.update(dt, app.camera);
    M.placard?.update(dt, app.camera);
    M.woman?.update(dt, app.camera);
  },

  /** Everything this file has drawn on the street, taken back off it. */
  newGame(app) {
    beats.clear();
    beats.faults.length = 0;
    M.fired = {};
    M.rushed = 0;
    M.sawSmash = false;
    M.copLen = STREET.cop.len;
    lastRattle = -99; lastFender = -99; lastWagon = -99;
    M.ghost?.hide();
    M.tally?.clear();
    M.placard?.clear();
    M.cop?.stop();
    if (M.woman) { M.woman.t = -1; M.woman.mesh.visible = false; }
    if (M.lid) { M.lid.t = -1; M.lid.mesh.visible = false; }
    if (app?.sim) app.sim.windupRate = 1;
    duckWorld(1, 0.01);
  },

  onScenario(name, app) {
    M.inScenario = true;
    M._stateRef = app.sim ? app.sim.state : null;
    mrng.reset(19250922);
    beats.clear();
    beats.faults.length = 0;
    M.fired = {};
    M.rushed = 0;
    M.sawSmash = false;
    M.copLen = STREET.cop.len;
    lastRattle = -99; lastFender = -99; lastWagon = -99;
    M.ghost?.hide();
    M.tally?.clear();
    M.placard?.clear();
    M.cop?.stop();
    M.woman && (M.woman.t = -1, M.woman.mesh.visible = false);
    if (M.lid) { M.lid.t = -1; M.lid.mesh.visible = false; }
    if (app.sim) app.sim.windupRate = 1;
    duckWorld(1, 0.01);
    whistleCue(app.audio);
  },
});

/* ============================================================================
   12. SCENARIOS — one per moment, so a critic can judge each on its own
   ----------------------------------------------------------------------------
   Every one of them is the REAL path: the rule fires the real bus event and the
   real director stages it. Nothing below draws a diagram of a moment; it runs
   the moment and stops the clock in the middle of it.
   ========================================================================= */

/** Put the game somewhere sensible, then hand the moment its own event. */
function setUp(seed = 1920, warm = 0.55) {
  APP.sim.reset(seed);
  if (warm > 0) APP.clock.advance(warm);
}

registerScenario('rule_cheese_it', {
  seed: 1920,
  setup: () => {
    setUp(1920, 0.5);
    street.cheeseIt(false);
    // the SETUP frame: everybody frozen mid-stride, sticks behind backs, and the
    // hat already halfway up the block. The payoff (the innocent conversation) is
    // two seconds later and is what `tools/film.mjs rule_cheese_it` is for.
    APP.clock.advance(1.15);
  },
  settle: 0,
});

registerScenario('rule_window', {
  seed: 4242,
  setup: () => {
    setUp(4242, 0.5);
    // the pane that does NOT break: a flat boom, a frozen block, a woman deciding
    bus.emit('ball:window', { broke: false, pos: new THREE.Vector3(-31.4, 6.0, 17.5), name: 'deli plate glass' });
    APP.clock.advance(0.85);        // the beat of total silence, with her arriving at the sash
  },
  settle: 0,
});

registerScenario('rule_window_smash', {
  seed: 77,
  setup: () => {
    setUp(77, 0.5);
    bus.emit('ball:window', { broke: true, pos: new THREE.Vector3(-31.4, 6.0, 17.5), name: 'deli plate glass' });
    APP.clock.advance(0.95);
  },
  settle: 0,
});

registerScenario('rule_sewers', {
  seed: 1925,
  setup: () => {
    setUp(1925, 0.5);
    const who = liveMatch.batterId();
    bus.emit('street:sewers', { batter: who, sewers: 2, window: false });
    // …and one already on the curb from earlier in the afternoon
    M.tally?.add('F', 3);
    M.tally?.add('S', 1);
    APP.clock.advance(3.5);
  },
  settle: 0,
});

registerScenario('rule_ghost', {
  seed: 606,
  setup: () => {
    setUp(606, 0.5);
    const who = liveMatch.lineups[liveMatch.battingSide()][2];
    street.ghostOn(1, who, liveMatch.battingSide(), 'short');
    APP.clock.advance(1.4);
    framing('field');
  },
  settle: 0,
});

registerScenario('rule_do_over', {
  seed: 33,
  setup: () => {
    setUp(33, 0.9);
    street.car();
    APP.clock.advance(2.5);
  },
  settle: 0,
});

registerScenario('rule_roof', {
  seed: 88,
  setup: () => {
    setUp(88, 0.5);
    bus.emit('ball:roof', { pos: new THREE.Vector3(-20, 22, 40), side: -1 });
    APP.clock.advance(1.3);
  },
  settle: 0,
});

registerScenario('moment_fire_escape', {
  seed: 51,
  setup: () => {
    setUp(51, 0.5);
    bus.emit('ball:fire_escape', { pos: new THREE.Vector3(-21.4, 13.5, 28), level: 2 });
    APP.clock.advance(0.62);
  },
  settle: 0,
});

registerScenario('moment_ashcan', {
  seed: 61,
  setup: () => {
    setUp(61, 0.5);
    bus.emit('ball:ashcan', { pos: new THREE.Vector3(19.6, 1.5, 12), lid: true, speed: 22 });
    APP.clock.advance(1.05);
  },
  settle: 0,
});

registerScenario('moment_down_sewer', {
  seed: 71,
  setup: () => {
    setUp(71, 0.5);
    bus.emit('ball:sewer', { pos: new THREE.Vector3(17.0, 0.2, 11), name: 'grate N1' });
    APP.clock.advance(1.7);
  },
  settle: 0,
});

registerScenario('moment_frankie', {
  seed: 91,
  setup: () => {
    setUp(91, 0.5);
    const side = liveMatch.battingSide();
    const who = liveMatch.lineups[side][3];
    street.callUpstairs(who, side);
    APP.clock.advance(1.15);        // her shout is still on the wall and his shoulders have just dropped
  },
  settle: 0,
});

registerScenario('moment_car', {
  seed: 101,
  setup: () => {
    setUp(101, 0.9);
    street.car();
    APP.clock.advance(1.5);
  },
  settle: 0,
});

registerScenario('moment_hands', {
  seed: 111,
  setup: () => {
    setUp(111, 0.4);
    M.play('hands');
    APP.clock.advance(2.25);
  },
  settle: 0,
});

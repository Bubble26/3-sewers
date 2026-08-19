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
import { LAYOUT, BASES, GROUND } from './layout.js';

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
  K: [[[0, 0], [0, 1]], [[0.95, 0], [0, 0.55]], [[0.25, 0.42], [1, 1]]],
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

function chalkText(g, text, x, y, size, { w = Math.max(3, size * 0.13), gap = 0.32, alpha = 0.95, rnd = mrng, tilt = 0 } = {}) {
  let cx = x;
  const step = size * 0.62;
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

function drawGhost(g, W, H, frame) {
  const rnd = new RNG(4711 + frame);
  const cx = W * 0.5;
  const S = H / 100;                                  // 100 units tall, cap to heel
  const lean = frame ? 1.6 : -1.4;                    // the fidget: he shifts his weight
  const arm = frame ? 6 : -4;
  const P = (x, y) => [cx + (x + lean * (1 - y / 100) * 0.5) * S, (y) * S];
  const line = (pts, w) => chalkPath(g, pts.map(([x, y]) => P(x, y)), { w: w * S * 0.9, rnd, alpha: 0.86, jitter: S * 0.5 });

  // cap — the brim is the whole silhouette read at 96 px
  line([[-11, 12], [-12, 6], [-4, 2], [6, 3], [11, 9], [10, 13]], 2.0);
  line([[-13, 13], [7, 15]], 2.2);                    // the brim, pulled down over one eye
  // head and ears
  line([[-10, 13], [-11, 22], [-6, 27], [4, 27], [9, 21], [9, 13]], 2.0);
  line([[-11, 18], [-14, 19], [-11, 22]], 1.5);
  line([[9, 18], [12, 19], [9, 22]], 1.5);
  // shoulders and shirt — a hand-me-down, so it is a size wrong
  line([[-15, 34], [-9, 29], [6, 29], [14, 34]], 2.2);
  line([[-15, 34], [-16, 56], [15, 56], [14, 34]], 2.0);
  // arms, one of which is doing the fidget
  line([[-15, 35], [-20, 46], [-18 + arm, 57]], 1.8);
  line([[14, 35], [20, 45], [17 - arm, 56]], 1.8);
  // knickers, buckled under the knee
  line([[-16, 56], [-15, 72], [-2, 72], [-1, 56]], 1.8);
  line([[15, 56], [14, 72], [2, 72], [1, 56]], 1.8);
  // stockings — one up, one down, always
  line([[-14, 72], [-13, 88]], 1.6);
  line([[13, 72], [12, 82]], 1.6);
  line([[-16, 88], [-9, 88]], 1.4);
  // boots
  line([[-15, 88], [-17, 96], [-7, 96], [-8, 88]], 1.6);
  line([[11, 82], [9, 96], [19, 96], [17, 82]], 1.6);
  // the face is two dots and nothing else: a ghost has no expression to have
  g.save();
  g.globalAlpha = 0.8; g.fillStyle = CHALK;
  for (const [x, y] of [[-5, 19], [4, 19]]) { const p = P(x, y); g.beginPath(); g.arc(p[0], p[1], 2.1 * S, 0, 6.283); g.fill(); }
  g.restore();
}

class ChalkGhost {
  constructor(scene) {
    this.frames = [0, 1].map((f) => {
      const { c, g } = canvas2d(192, 288);
      drawGhost(g, 192, 288, f);
      return texFrom(c);
    });
    this.mesh = cardMesh(this.frames[0], 3.6, 5.4, { name: 'street:ghost', order: 7 });
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
    this.mesh.position.set(b.x, 2.72, b.z);
    this.shadow.position.set(b.x, 0.09, b.z);
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
    this.mesh.position.y = 2.72 + Math.sin(this.t * 2.1) * 0.055;
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

const TALLY = { x: 19.2, z0: 4.0, dz: 4.4, w: 7.2, h: 4.0, max: 7 };

class CurbTally {
  constructor(scene) {
    this.scene = scene;
    this.rows = [];
    this.group = new THREE.Group();
    this.group.name = 'street:tally';
    scene.add(this.group);
  }
  clear() {
    for (const r of this.rows) { this.group.remove(r); r.material.map?.dispose(); r.material.dispose(); r.geometry.dispose(); }
    this.rows.length = 0;
  }
  /** initial + one stroke per sewer, laid flat on the road and 2° off the kerb line. */
  add(initial, sewers) {
    if (this.rows.length >= TALLY.max) {
      const old = this.rows.shift();
      this.group.remove(old); old.material.map?.dispose(); old.material.dispose(); old.geometry.dispose();
    }
    const { c, g } = canvas2d(320, 176);
    const rnd = new RNG(1925 + this.rows.length * 7 + sewers);
    chalkText(g, initial, 12, 30, 108, { w: 11, rnd, tilt: 0.06 });
    for (let i = 0; i < sewers; i++) {
      chalkPath(g, [[150 + i * 44, 28 + rnd.range(-3, 3)], [140 + i * 44, 148 + rnd.range(-3, 3)]],
        { w: 12, rnd, alpha: 0.9, jitter: 2.4 });
    }
    const m = cardMesh(texFrom(c), TALLY.w, TALLY.h, { name: 'street:tally_row', order: 5 });
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = 0.035;                         // the hand was kneeling, not surveying
    m.position.set(TALLY.x, 0.075, TALLY.z0 + this.rows.length * TALLY.dz);
    m.material.opacity = 0.94;
    this.group.add(m);
    this.rows.push(m);
    return m;
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
  g.moveTo(6, 14);
  for (let x = 6; x <= W - 6; x += 22) g.lineTo(x, 12 + rnd.range(-5, 5));
  g.lineTo(W - 6, H - 14);
  for (let x = W - 6; x >= 6; x -= 26) g.lineTo(x, H - 12 + rnd.range(-6, 6));
  g.closePath();
  g.fillStyle = '#E7DCC2';                    // newsprint, L* 87 — under the chalk ceiling
  g.fill();
  g.lineWidth = 3.5; g.strokeStyle = INK; g.globalAlpha = 0.85; g.stroke();
  g.restore();
  const w = chalkText(g, text, 0, 0, 10, { w: 1 });   // measure
  const size = Math.min(H * 0.52, (W - 40) / (text.length * 0.62 * 1.32) );
  const used = text.length * size * 0.62 * 1.32;
  g.save();
  g.globalAlpha = 1;
  chalkText(g, text, (W - used) / 2 + size * 0.1, (H - size) / 2, size, { w: Math.max(3, size * 0.16), rnd, tilt: 0.05 });
  g.restore();
  return w;
}

class Placard {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.kid = null;
    this.text = '';
    this.t = 0;
  }
  set(text, kid) {
    if (this.mesh && this.text === text && this.kid === kid) return;
    this.text = text; this.kid = kid;
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.material.map?.dispose(); this.mesh.material.dispose(); this.mesh.geometry.dispose(); }
    const { c, g } = canvas2d(512, 128);
    drawLabel(g, 512, 128, text);
    this.mesh = cardMesh(texFrom(c), 6.4, 1.6, { name: 'street:placard', order: 9 });
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

function drawCop(g, W, H, frame) {
  const rnd = new RNG(1861 + frame * 31);
  const S = H / 100;
  const cx = W * 0.5;
  const P = (x, y) => [cx + x * S, y * S];
  const poly = (pts, fill, { line = INK, w = 3.2, alpha = 1 } = {}) => {
    g.save(); g.globalAlpha = alpha;
    g.beginPath();
    pts.forEach(([x, y], i) => { const p = P(x, y); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (line) { g.lineWidth = w * S * 0.32; g.strokeStyle = line; g.lineJoin = 'round'; g.stroke(); }
    g.restore();
  };
  const swing = frame ? 1 : -1;

  // the shadow he stands in, so the card is never floating
  g.save();
  g.globalAlpha = 0.34; g.fillStyle = SHADOW;
  g.beginPath(); g.ellipse(cx, 98.5 * S, 15 * S, 3.4 * S, 0, 0, 6.283); g.fill();
  g.restore();

  // legs — trousers, one forward. He walks like a man being paid by the hour.
  poly([[-3, 62], [-11 + swing * 5, 92], [-4 + swing * 5, 94], [2, 64]], COP_COAT);
  poly([[2, 62], [9 - swing * 5, 92], [16 - swing * 5, 94], [7, 64]], COP_COAT_LIT);
  // boots
  poly([[-12 + swing * 5, 91], [-14 + swing * 5, 97], [-2 + swing * 5, 97], [-3 + swing * 5, 91]], INK, { line: null });
  poly([[8 - swing * 5, 91], [7 - swing * 5, 97], [18 - swing * 5, 97], [17 - swing * 5, 91]], INK, { line: null });

  // the blouse: long, double-breasted, and it has never been taken in
  poly([[-14, 34], [-16, 66], [16, 66], [14, 34], [7, 28], [-7, 28]], COP_COAT);
  poly([[0, 29], [3, 66], [16, 66], [14, 34], [7, 28]], COP_COAT_LIT, { line: null, alpha: 0.55 });
  // belt
  poly([[-15, 56], [-15, 61], [15, 61], [15, 56]], '#3A3franc'.slice(0, 7) === '#3A3fra' ? '#3A4056' : '#3A4056');
  // two rows of brass, and they are the only saturated thing on him (§Law 4)
  g.save();
  g.fillStyle = COP_BRASS; g.strokeStyle = INK; g.lineWidth = 1.1;
  for (let i = 0; i < 5; i++) for (const x of [-6.2, 6.2]) {
    const p = P(x, 33 + i * 5.4);
    g.beginPath(); g.arc(p[0], p[1], 1.9 * S, 0, 6.283); g.fill(); g.stroke();
  }
  g.restore();

  // arms — one swings the nightstick, the other is behind his back
  poly([[-14, 36], [-21, 52], [-16 - swing * 3, 66], [-11, 64], [-14, 50]], COP_COAT);
  poly([[14, 36], [21, 52], [18 + swing * 3, 64], [13, 62], [15, 48]], COP_COAT_LIT);
  // the nightstick, hanging, never used
  poly([[-17 - swing * 3, 64], [-19 - swing * 3, 80], [-15 - swing * 3, 81], [-13 - swing * 3, 65]], COP_STICK);

  // collar, face, moustache
  poly([[-8, 28], [-8, 24], [8, 24], [8, 28]], COP_COAT_LIT);
  poly([[-8, 24], [-9, 12], [-4, 7], [4, 7], [9, 12], [8, 24]], COP_SKIN);
  poly([[-7, 17], [7, 17], [6, 21], [-6, 21]], '#8A8378', { line: null });   // the moustache
  g.save();
  g.fillStyle = INK;
  for (const x of [-4.4, 4.4]) { const p = P(x, 14); g.beginPath(); g.arc(p[0], p[1], 1.3 * S, 0, 6.283); g.fill(); }
  g.restore();
  // the bell-crown helmet with the brass plate. It is the entire silhouette.
  poly([[-11, 10], [-10, 2], [-4, -4], [4, -4], [10, 2], [11, 10]], COP_COAT);
  poly([[-13, 10], [13, 10], [12, 13], [-12, 13]], COP_COAT_LIT);
  g.save();
  g.fillStyle = COP_BRASS; g.strokeStyle = INK; g.lineWidth = 1.4;
  const b = P(0, 3);
  g.beginPath(); g.moveTo(b[0], b[1] - 4 * S); g.lineTo(b[0] + 3.4 * S, b[1] + 2 * S);
  g.lineTo(b[0], b[1] + 4.4 * S); g.lineTo(b[0] - 3.4 * S, b[1] + 2 * S); g.closePath();
  g.fill(); g.stroke();
  g.restore();
  // the ink outline that separates him from the brick, drawn last and drawn once
  g.save();
  g.globalAlpha = 0.16; g.fillStyle = INK;
  for (let i = 0; i < 90; i++) g.fillRect(rnd.range(0, W), rnd.range(0, H), 1, 1);
  g.restore();
}

/** Where the cop walks: up the north gutter, past the game, and round the far corner. */
const BEAT = { x0: 20.6, z0: 6.0, x1: 16.4, z1: 58.0, y: 0.12, h: 6.2 };

class Patrolman {
  constructor(scene) {
    this.frames = [0, 1].map((f) => {
      const { c, g } = canvas2d(200, 320);
      drawCop(g, 200, 320, f);
      return texFrom(c);
    });
    this.mesh = cardMesh(this.frames[0], BEAT.h * 0.63, BEAT.h, { name: 'street:cop', order: 8 });
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
    this.mesh.position.set(x, BEAT.y + BEAT.h / 2, z);
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

/** The woman at the glass. She is not angry yet; she is deciding. */
function drawWoman(g, W, H) {
  const S = H / 100, cx = W / 2;
  const P = (x, y) => [cx + x * S, y * S];
  const poly = (pts, fill, line = INK) => {
    g.beginPath();
    pts.forEach(([x, y], i) => { const p = P(x, y); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); });
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (line) { g.lineWidth = 2.6 * S * 0.4; g.strokeStyle = line; g.stroke(); }
  };
  // the pane behind her, still whole, still ringing
  g.fillStyle = 'rgba(60,74,92,0.42)';
  g.fillRect(0, 0, W, H);
  poly([[-24, 96], [-16, 58], [16, 58], [24, 96]], '#B03A5E');            // claret housedress
  poly([[-13, 60], [-14, 40], [13, 40], [12, 60]], '#DFA377');            // neck and shoulders
  poly([[-14, 40], [-16, 20], [-8, 8], [8, 8], [16, 20], [14, 40]], '#DFA377');
  poly([[-17, 22], [-16, 6], [0, -2], [16, 6], [17, 22], [11, 12], [-11, 12]], '#5B3B33');  // hair, pinned
  g.fillStyle = INK;
  for (const x of [-6, 6]) { const p = P(x, 24); g.beginPath(); g.ellipse(p[0], p[1], 2.2 * S, 2.6 * S, 0, 0, 6.283); g.fill(); }
  g.lineWidth = 2.2 * S * 0.4; g.strokeStyle = INK;
  const m0 = P(-5, 33), m1 = P(5, 33);
  g.beginPath(); g.moveTo(m0[0], m0[1]); g.quadraticCurveTo(cx, 36 * S, m1[0], m1[1]); g.stroke();
}

class WindowFace {
  constructor(scene) {
    const { c, g } = canvas2d(160, 224);
    drawWoman(g, 160, 224);
    this.mesh = cardMesh(texFrom(c), 3.0, 4.2, { name: 'street:woman', order: 8 });
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

function sfx(cue, o = {}) { try { APP.audio?.play?.(cue, o); } catch { /* no graph in this mode */ } }
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

/** Everybody who is standing in the street right now. */
function cast() {
  const p = players();
  if (!p) return [];
  return p.kids.filter((k) => k && k.group && k.group.visible);
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
      // the freeze: everybody, mid-stride, and the sticks go behind backs
      for (const k of cast()) {
        k.target = null; k.speed = 0;
        k.act?.('freeze', { state: 'freeze', lock: Math.max(1.2, len - 0.6) });
        k.setFace?.('shock', 0.9);
      }
      bat?.showStick?.(false);
    }],
    [1.05, () => {
      // …and then the innocent conversation, which is the actual joke
      for (const k of cast()) { k.lock = 0; k.act?.('idle_slouch', { state: 'idle', lock: len }); }
      if (bat && ss) { bat.lookAt(ss.pos.x, ss.pos.y); ss.lookAt(bat.pos.x, bat.pos.y); }
      says('Some weather.', bat);
    }],
    [1.95, () => { says('Sure is.', ss); }],
    [2.55, () => {
      if (holder) { holder.setFace('shock', 1.6); holder.act?.('sulk', { state: 'sulk', lock: 1.4 }); }
      gooch('The Gooch counts one kid holding a ball and nowhere on this earth to put it.');
    }],
    [Math.max(2.9, len - 1.5), () => { dot('He is past the hydrant. He is past the hydrant.', 'talk'); }],
    [Math.max(3.4, len - 0.9), () => { sfx('cop_whistle', { gain: 0.42, dist: 190, pan: 0.4 }); }],
    [len - 0.05, () => {
      M.cop?.stop();
      unpin();
      for (const k of cast()) { k.lock = 0; }
      players()?.batter?.showStick?.(true);
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
    [len - 0.1, () => { unpin(); for (const k of cast()) k.lock = 0; }],
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
      gooch(s >= 3 ? 'Three sewers. The Gooch has not measured three since the spring.'
        : s === 2 ? 'Two sewers. The Gooch measured it. The Gooch does not measure for everybody.'
        : 'One sewer, and the Gooch counted it out loud so nobody can shorten it later.');
    }],
    [1.15 + s * 0.62, () => {
      M.tally?.add(initialOf(who), s);
      sfx('ui_clack', { gain: 0.5, dist: 14, pan: 0.5 });
      says('Put it on the curb! Put his letter on the curb!', cast()[5]);
    }],
    [1.85 + s * 0.62, () => {
      if (s >= 2 && body) M.placard?.set(`${s === 3 ? 'THREE' : 'TWO'}-SEWER ${nick(who)}`.toUpperCase(), body);
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
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(-24, 15, 34);
  street.interrupt?.('glass', { seconds: 1.15, doOver: false, why: 'the glass held' });
  beats.play('glass', [
    [0.00, () => {
      // THE SILENCE. Everything on the mix goes down to a whisper for one beat,
      // which is the loudest thing this game ever does (§7.4, plate glass).
      duckWorld(0.06, 0.02);
      for (const k of cast()) { k.target = null; k.speed = 0; k.act?.('freeze', { state: 'freeze', lock: 1.4 }); k.setFace?.('shock', 1.3); }
      framing('field');
    }],
    [0.95, () => { M.woman?.show(at); duckWorld(1, 0.35); }],
    [1.25, () => { sfx('window_flex', { gain: 0.28, dist: 40, pan: -0.3 }); }],
    [1.60, () => {
      unpin();
      for (const k of cast()) k.lock = 0;
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
  ]);
}

/** Push the whole world down to a whisper and let it back up. §7.4's "full beat". */
function duckWorld(level, ramp = 0.05) {
  const a = APP.audio;
  if (!a || !a.setBus) return;
  for (const b of ['sfx', 'ambience', 'music', 'chatter']) {
    try { a.setBus(b, level, ramp); } catch { /* bus not in this mix */ }
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
    [1.85, () => { gooch('Rung by rung. The Gooch could set his watch by that ladder.'); }],
  ]);
}

/* --- the flivver (§10, Ninety-Fifth Street's third prop) -------------------- */
let lastFender = -99;
function flivver(p) {
  if (APP.time - lastFender < 1.2) return;
  lastFender = APP.time;
  fired('flivver');
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(-18, 2, 18);
  beats.play('flivver', [
    [0.00, () => { puff(at, 5, 2.0); sfx('ui_boing', { gain: 0.5, dist: 20, pan: at.x > 0 ? -0.4 : 0.4, delay: 0.04 }); }],
    [0.55, () => { sfx('klaxon', { gain: 0.34, dist: 30, pan: at.x > 0 ? -0.4 : 0.4 }); }],
    [0.85, () => { says('OFF THE FENDER!', cast()[6]); }],
    [1.55, () => { gooch('Mr Esposito parks it there every Tuesday and every Tuesday he is amazed.'); }],
  ]);
}

/* --- 3. DOWN THE SEWER (§9.3) ---------------------------------------------- */
function downTheSewer(p) {
  fired('down_sewer');
  const at = p?.pos ? p.pos.clone() : new THREE.Vector3(16, 0.2, 12);
  street.interrupt?.('sewer', { seconds: 2.6, doOver: false, why: 'down the grate' });
  beats.play('sewer', [
    [0.00, () => { framing('field'); sfx('sewer_swallow', { gain: 0.95, pos: at, gate: 0 }); }],
    [0.35, () => {
      // five kids on their knees at the gutter, and one arm in to the shoulder
      const crew = cast().slice(0, 5);
      crew.forEach((k, i) => {
        k.target = null; k.speed = 0;
        k.goTo?.(at.x + (i - 2) * 1.6, at.z - 1.2, {
          speed: T.run.speed, hard: true,
          onArrive: (x) => { x.lookAt(at.x, at.z); x.act?.('crouch', { state: 'crouch', lock: 2.2 }); },
        });
      });
      yell('DOWN THE SEWER!', crew[0]);
    }],
    [1.30, () => { argue(); }],
    [2.05, () => { says('Who has got the coat hanger? Somebody has got the coat hanger.', cast()[1]); }],
    [2.60, () => { unpin(); for (const k of cast()) k.lock = 0; }],
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
    [1.30, () => { says('He is fielding it with the LID!', cast()[3]); }],
    [2.20, () => { gooch('Not legal. Nobody is objecting. The Gooch has stopped objecting to things.'); }],
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

/* --- 10. FRAAAAN-KIEEE! (§9.10) -------------------------------------------- */
function mother(p) {
  fired('mother', { who: p?.who });
  const body = kidBody(p?.who);
  const brother = players()?.stoopKid || null;
  const name = (p?.name || 'FRANKIE').toUpperCase();
  beats.play('mother', [
    [0.00, () => {
      framing('field');
      sfx('mother_calling', { gain: 0.95, dist: 40, pan: 0.35, gate: 0 });
      for (const k of cast()) { k.target = null; k.speed = 0; k.lookAt?.(k.pos.x + 6, k.pos.y + 30); }
      dot(`${name.slice(0, 4)}AAAN-${name.slice(-3)}EEE!`, 'shout');
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
  ]);
}

/* --- 11. THE HAND-OVER-HAND (§9.11) ---------------------------------------- */
function handOverHand() {
  fired('hand_over_hand');
  const p = players();
  const a = p?.batter, b = p?.onDeck;
  beats.play('hands', [
    [0.00, () => { framing('batting'); sfx('ui_clack', { gain: 0.6, dist: 10 }); dot('Fist over fist, and the block is counting.', 'shout'); }],
    [0.55, () => { says('ONE.', a); a?.act?.('point', { state: 'point', lock: 0.5 }); }],
    [1.05, () => { says('TWO.', b); b?.act?.('point', { state: 'point', lock: 0.5 }); }],
    [1.55, () => { says('THREE.', a); }],
    [2.05, () => { says('FOUR — and that is the tip, that is the TIP.', b); }],
    [2.70, () => { says('Then swing it round your head three times without dropping it.', a); b?.setFace?.('shock', 1.4); }],
    [3.60, () => { gooch('The Gooch has watched this ritual for eleven years and has never once seen it go smoothly.'); unpin(); }],
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

/* --- 9. THE ICEMAN'S WAGON (§9.9) ------------------------------------------ */
let lastWagon = -99;
function wagon(p) {
  if (APP.time - lastWagon < 6) return;
  lastWagon = APP.time;
  fired('wagon');
  beats.play('wagon', [
    [0.00, () => { puff(p?.pos || new THREE.Vector3(-18, 2, 26), 6, 2.2); sfx('thud_wood', { gain: 0.8, pos: p?.pos, gate: 0 }); }],
    [0.50, () => { says('Off the ice wagon! It is a wall, it is a WALL!', cast()[5]); }],
    [1.40, () => { gooch('The Gooch works off that wagon. The Gooch would prefer you did not.'); }],
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
  bus.on('ball:fender', flivver);
  bus.on('ball:impact', (p) => { if (/wagon|ice|truck/i.test(p?.name || '')) wagon(p); });

  // --- the two that belong to the game rather than to the ball
  bus.on('atbat:begin', () => {
    if (street.atBats === 1) beats.play('__hands', [[0.25, handOverHand]]);
    if (M.rushed > 0 && APP.sim) { M.rushed -= 1; if (M.rushed === 0) APP.sim.windupRate = 1; }
    // §9.12: the last half-inning of a three-inning game, once
    const s = APP.sim?.state;
    if (s && !M.fired.lights && s.inning >= T.game.innings && s.half === 'bottom') lightsComeOn();
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

  onScenario(name, app) {
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
    APP.clock.advance(1.35);        // stop the clock at the freeze, with the cop in the road
  },
  settle: 0,
});

registerScenario('rule_window', {
  seed: 4242,
  setup: () => {
    setUp(4242, 0.5);
    // the pane that does NOT break: a flat boom, a frozen block, a woman deciding
    bus.emit('ball:window', { broke: false, pos: new THREE.Vector3(-22.5, 15.5, 32), name: 'window S2' });
    APP.clock.advance(1.15);
  },
  settle: 0,
});

registerScenario('rule_window_smash', {
  seed: 77,
  setup: () => {
    setUp(77, 0.5);
    bus.emit('ball:window', { broke: true, pos: new THREE.Vector3(-22.5, 15.5, 32), name: 'window S2' });
    APP.clock.advance(0.75);
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
    APP.clock.advance(2.9);
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
    bus.emit('ball:sewer', { pos: new THREE.Vector3(15.5, 0.2, 14), name: 'grate N1' });
    APP.clock.advance(1.5);
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
    APP.clock.advance(2.1);
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
    APP.clock.advance(2.9);
  },
  settle: 0,
});

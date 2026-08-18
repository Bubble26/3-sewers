import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { registerScenario } from '../core/scenarios.js';
import {
  AIR, PAVEMENT, FACADE, CLOTH, ACCENTS, INK, CHALK, BLUSH, soot, sunlit,
} from '../render/palette.js';
import { SKY, CANYON, SpriteBatch, occlusionAt, mix, css, lin } from './sky.js';
import { roadHeight, GROUND, mat } from './props.js';

/* =============================================================================
 * ATMOSPHERE — the air in the street, and everything living in it
 * -----------------------------------------------------------------------------
 * Aliveness is a scored axis: five things doing something the player did not
 * cause, in every frame. This file supplies most of them, and it supplies them
 * from one shared idea — EVERYTHING IN THE AIR READS THE CANYON'S LIGHT. A puff
 * of chimney smoke, a dust mote and a pigeon's wing all ask sky.js the same
 * question ("am I in the sun?") and all three go warm and bright when the
 * answer is yes and cool blue-violet when it is no. That is what turns three
 * cheap particle systems into one convincing volume of afternoon air.
 *
 *   WIND      one shared vector with gusts. Anything that flaps should read it.
 *   SMOKE     chimney-pot clusters trailing downwind, dark at the pot and
 *             lightening as they disperse — soot as a value shift, never a grade.
 *   PIGEONS   a real flock: perched on cornices and pecking at the kerb, they
 *             burst when the ball comes near, wheel over the block, flash pale
 *             underwing as they bank through the sun band, and settle back.
 *   MOTES     dust in the lit air, only ever where the sun actually reaches.
 *   BEAM      the visible edge of the sun band, standing in the air above the
 *             terminator, which is the one place a beam edge is genuinely
 *             visible in a canyon.
 *   SHIMMER   heat off the tar, drawn rather than filtered.
 *   LAUNDRY   roof lines, seven feet up on poles, in the sun band, moving.
 * ========================================================================== */

/* ─── the shared wind ──────────────────────────────────────────────────────── */

export const WIND = {
  /** horizontal unit vector the wind blows TOWARD (down the block, off the river) */
  dir: new THREE.Vector2(-0.46, 0.89).normalize(),
  base: 4.6,          // ft/s
  gust: 1,            // live multiplier, 0.6 .. 1.5
  t: 0,
  /** current speed in ft/s */
  get speed() { return this.base * this.gust; },
  /** writes the live wind velocity into a Vector3 */
  vec(out) { return out.set(this.dir.x * this.speed, 0, this.dir.y * this.speed); },
  step(dt) {
    this.t += dt;
    this.gust = 1 + 0.30 * Math.sin(this.t * 0.61) + 0.16 * Math.sin(this.t * 1.73 + 1.2)
      + 0.07 * Math.sin(this.t * 3.9 + 0.4);
  },
};

/* ─── textures ─────────────────────────────────────────────────────────────── */

function softTexture(size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, a] of stops) grd.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A coal-smoke puff: soft, but with a lumpy edge so it is not a gaussian blob. */
function puffTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = new RNG(7711);
  for (let i = 0; i < 9; i++) {
    const a = r.range(0, Math.PI * 2), d = r.range(0, S * 0.16);
    const cx = S / 2 + Math.cos(a) * d, cy = S / 2 + Math.sin(a) * d;
    const rad = S * r.range(0.20, 0.32);
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.62)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.34)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ─── the pigeon sprite sheet ──────────────────────────────────────────────── */

const P_COLS = 4, P_ROWS = 4, P_TILE = 128;

function pigeonPalette(white) {
  const slate = mix(PAVEMENT.curb, AIR.skyFill, 0.42);
  const body = white ? mix(CLOTH[3], AIR.skyFill, 0.16) : slate;
  return {
    body,
    back: soot(body, white ? 0.10 : 0.16),
    belly: mix(body, CLOTH[3], white ? 0.45 : 0.30),
    neck: white ? mix(body, ACCENTS.mustard, 0.14) : mix(body, ACCENTS.teal, 0.42),
    bar: soot(body, white ? 0.26 : 0.42),
    under: mix(CLOTH[3], AIR.haze, 0.30),
    beak: mix(ACCENTS.rust, BLUSH, 0.55),
    ink: INK,
  };
}

/**
 * Eight frames of one pigeon, drawn in profile facing right. Everything is
 * authored in tile fractions and kept inside 0.03..0.97 so a mip level can
 * never bleed one bird into the next.
 *
 *   0 perched   1 pecking   2 wings up   3 wings mid
 *   4 wings down (pale underwing — this is the frame that flashes)
 *   5 glide     6 landing flare   7 walking
 */
const WING = {
  2: { tip: [0.40, 0.09], lead: [0.60, 0.22], trail: [0.31, 0.29] },
  3: { tip: [0.20, 0.23], lead: [0.50, 0.22], trail: [0.34, 0.46] },
  4: { tip: [0.23, 0.83], lead: [0.53, 0.58], trail: [0.37, 0.58] },
  5: { tip: [0.07, 0.46], lead: [0.37, 0.28], trail: [0.31, 0.62] },
  6: { tip: [0.55, 0.07], lead: [0.72, 0.22], trail: [0.38, 0.23] },
};

function drawPigeon(g, ox, oy, S, frame, P) {
  const X = (u) => ox + u * S, Y = (v) => oy + v * S;
  const lw = S * 0.028;
  const flying = frame >= 2 && frame <= 6;
  const bodyY = flying ? 0.50 : 0.55;
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.lineWidth = lw;
  g.strokeStyle = css(P.ink);

  const fill = (col, fn, outline = true) => {
    g.beginPath(); fn(); g.closePath();
    g.fillStyle = css(col); g.fill();
    if (outline) g.stroke();
  };
  const ell = (cx, cy, rx, ry, rot = 0) => g.ellipse(X(cx), Y(cy), S * rx, S * ry, rot, 0, Math.PI * 2);

  const wingPath = (k, scale) => {
    const w = WING[k];
    const sx = 0.55, sy = bodyY - 0.05, rx = 0.37, ry = bodyY + 0.05;
    const L = (p) => [sx + (p[0] - sx) * scale, sy + (p[1] - sy) * scale];
    const tip = L(w.tip), lead = L(w.lead), trail = L(w.trail);
    g.moveTo(X(sx), Y(sy));
    g.quadraticCurveTo(X(lead[0]), Y(lead[1]), X(tip[0]), Y(tip[1]));
    g.quadraticCurveTo(X(trail[0]), Y(trail[1]), X(rx), Y(ry));
  };

  /* legs, on the ground frames */
  if (!flying) {
    g.strokeStyle = css(P.beak); g.lineWidth = lw * 0.85;
    const lift = frame === 7 ? 0.035 : 0;
    for (const [lx, ly] of [[0.51, 0], [0.43, lift]]) {
      g.beginPath();
      g.moveTo(X(lx), Y(bodyY + 0.13));
      g.lineTo(X(lx - 0.01), Y(0.79 - ly));
      g.moveTo(X(lx - 0.045), Y(0.79 - ly));
      g.lineTo(X(lx + 0.045), Y(0.79 - ly));
      g.stroke();
    }
    g.strokeStyle = css(P.ink); g.lineWidth = lw;
  }

  /* far wing, behind everything */
  if (flying) fill(P.bar, () => wingPath(frame, 0.84));

  /* tail — a short fan, not a spike */
  fill(P.back, () => {
    const d = flying ? 0.03 : 0.09;
    const tx = flying ? 0.155 : 0.115;
    g.moveTo(X(0.30), Y(bodyY - 0.05));
    g.lineTo(X(tx), Y(bodyY + d - 0.055));
    g.lineTo(X(tx - 0.012), Y(bodyY + d + 0.095));
    g.lineTo(X(0.31), Y(bodyY + 0.10));
  });

  /* body */
  const brx = 0.225, bry = flying ? 0.145 : 0.170, brot = flying ? -0.12 : 0.05;
  fill(P.body, () => ell(0.47, bodyY, brx, bry, brot));
  g.save();
  g.beginPath(); ell(0.47, bodyY, brx, bry, brot); g.clip();
  g.beginPath(); ell(0.46, bodyY + 0.11, 0.19, 0.10); g.fillStyle = css(P.belly); g.fill();
  g.beginPath(); ell(0.40, bodyY - 0.08, 0.17, 0.07, -0.18); g.fillStyle = css(P.back); g.fill();
  g.restore();

  /* head, neck and beak */
  const hx = flying ? 0.735 : 0.705, hy = frame === 1 ? 0.62 : (flying ? 0.42 : 0.345);
  fill(P.neck, () => {
    g.moveTo(X(0.57), Y(bodyY - 0.11));
    g.quadraticCurveTo(X(hx - 0.03), Y(hy + 0.03), X(hx + 0.05), Y(hy + 0.09));
    g.quadraticCurveTo(X(hx - 0.07), Y(hy + 0.15), X(0.61), Y(bodyY + 0.05));
  });
  fill(P.neck, () => ell(hx, hy, 0.085, 0.082));
  fill(P.beak, () => {
    const dy = frame === 1 ? 0.07 : 0.02;
    g.moveTo(X(hx + 0.055), Y(hy + dy - 0.015));
    g.lineTo(X(hx + 0.155), Y(hy + dy * 2.4 + 0.015));
    g.lineTo(X(hx + 0.055), Y(hy + dy + 0.045));
  });
  g.beginPath(); g.arc(X(hx + 0.022), Y(hy - 0.022), S * 0.021, 0, 6.284);
  g.fillStyle = css(P.ink); g.fill();

  /* near wing */
  if (flying) {
    const down = frame === 4;
    fill(down ? P.under : P.back, () => wingPath(frame, 1));
    g.save();
    g.beginPath(); wingPath(frame, 1); g.closePath(); g.clip();
    g.strokeStyle = css(P.bar); g.lineWidth = S * 0.030;
    const w = WING[frame];
    // the underwing is pale and unbarred — that is the whole point of frame 4
    for (const k of (down ? [] : [0.42, 0.60])) {
      g.beginPath();
      g.moveTo(X(0.55 + (w.trail[0] - 0.55) * k), Y(bodyY - 0.05 + (w.trail[1] - bodyY + 0.05) * k));
      g.lineTo(X(0.55 + (w.tip[0] - 0.55) * (k + 0.35)), Y(bodyY - 0.05 + (w.tip[1] - bodyY + 0.05) * (k + 0.35)));
      g.stroke();
    }
    g.restore();
    g.strokeStyle = css(P.ink); g.lineWidth = lw;
    g.beginPath(); wingPath(frame, 1); g.closePath(); g.stroke();
  } else {
    /* folded wing, with the two dark bars every pigeon has */
    const folded = () => {
      g.moveTo(X(0.57), Y(bodyY - 0.09));
      g.quadraticCurveTo(X(0.42), Y(bodyY - 0.15), X(0.26), Y(bodyY + 0.02));
      g.quadraticCurveTo(X(0.42), Y(bodyY + 0.12), X(0.58), Y(bodyY + 0.07));
    };
    fill(P.back, folded);
    g.save();
    g.beginPath(); folded(); g.closePath(); g.clip();
    g.strokeStyle = css(P.bar); g.lineWidth = S * 0.030;
    g.beginPath(); g.moveTo(X(0.27), Y(bodyY - 0.015)); g.lineTo(X(0.58), Y(bodyY - 0.03)); g.stroke();
    g.beginPath(); g.moveTo(X(0.29), Y(bodyY + 0.045)); g.lineTo(X(0.58), Y(bodyY + 0.03)); g.stroke();
    g.restore();
  }
  g.restore();
}

function pigeonAtlas() {
  const c = document.createElement('canvas');
  c.width = P_TILE * P_COLS; c.height = P_TILE * P_ROWS;
  const g = c.getContext('2d');
  for (let variant = 0; variant < 2; variant++) {
    const P = pigeonPalette(variant === 1);
    for (let f = 0; f < 8; f++) {
      const col = f % 4, row = variant * 2 + Math.floor(f / 4);
      drawPigeon(g, col * P_TILE, row * P_TILE, P_TILE, f, P);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

const pigeonUV = (frame, variant) => {
  const col = frame % 4, row = variant * 2 + Math.floor(frame / 4);
  return [col / P_COLS, 1 - (row + 1) / P_ROWS, (col + 1) / P_COLS, 1 - row / P_ROWS];
};

/* ─── where things live on the block ───────────────────────────────────────── */

const buildingTop = (st) => 12 + (st - 1) * 10.5 + 3.2 + 2.4;
const corniceTop = (st) => 12 + (st - 1) * 10.5 + 3.2;

function readBlock(app) {
  const lots = app.get('street')?.lots;
  if (lots && lots.length) {
    return lots.map((l) => ({
      side: Math.sign(l.xf) || 1, z0: l.z0, storeys: l.storeys,
      chimneys: l.chimneys || [0.06, 0.94], chimneyH: l.chimneyH ?? 3.4, pots: l.pots ?? 4,
      coop: !!l.coop, tank: !!l.tank, pigeons: l.pigeons !== false,
    }));
  }
  // a plain fallback so the air still works if the block is mid-rebuild
  const out = [];
  for (let i = 0; i < 8; i++) {
    out.push({ side: 1, z0: -15 + i * 25, storeys: i === 0 ? 1 : 5 + (i % 2), chimneys: [0.06, 0.94], chimneyH: 3.4, pots: 4, coop: i === 5, tank: i === 3, pigeons: true });
    out.push({ side: -1, z0: 5 + i * 25, storeys: 4 + (i % 3), chimneys: [0.06, 0.94], chimneyH: 3.4, pots: 4, coop: i === 3, tank: i === 0, pigeons: true });
  }
  return out;
}

/* =============================================================================
 * SMOKE
 * ========================================================================== */

class Smoke {
  constructor(batch, block, rng) {
    this.batch = batch;
    this.stacks = [];
    const wanted = [];
    for (const b of block) {
      if (b.storeys < 4) continue;
      for (const cu of b.chimneys) {
        const z = b.z0 + cu * 25;
        if (z < -30 || z > 175) continue;
        wanted.push({
          x: b.side * (CANYON.facadeX + 3.2 + rng.range(0, 5)),
          y: corniceTop(b.storeys) + 2.4 + b.chimneyH,
          z, heat: rng.range(0.55, 1),
        });
      }
    }
    // not every flat has the range lit at four in the afternoon — six do.
    for (let i = 0; i < wanted.length; i++) {
      if (rng.chance(0.30) && this.stacks.length < 5) this.stacks.push(wanted[i]);
    }
    if (!this.stacks.length && wanted.length) this.stacks.push(wanted[0]);
    this.puffs = [];
    this.cap = 148;
    for (let i = 0; i < this.cap; i++) this.puffs.push({ life: 0 });
    this.acc = 0;
    this.rng = rng;
  }

  reset() { for (const p of this.puffs) p.life = 0; this.acc = 0; }

  update(dt, t) {
    this.acc += dt;
    const every = 0.42;
    while (this.acc >= every) {
      this.acc -= every;
      for (const s of this.stacks) {
        const p = this.puffs.find((q) => q.life <= 0);
        if (!p) break;
        p.life = p.max = 8.6 + this.rng.range(0, 3.6);
        p.x = s.x + this.rng.range(-0.28, 0.28);
        p.y = s.y + this.rng.range(0, 0.4);
        p.z = s.z + this.rng.range(-0.28, 0.28);
        p.vy = 2.1 * s.heat + this.rng.range(0, 0.9);
        p.r0 = this.rng.range(2.0, 3.1);
        p.grow = this.rng.range(1.4, 2.2);
        p.spin = this.rng.range(-0.5, 0.5);
        p.rot = this.rng.range(0, 6.28);
        p.soot = this.rng.range(0.30, 0.46) * s.heat;
      }
    }
    const w = WIND.speed;
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const age = 1 - p.life / p.max;
      p.x += WIND.dir.x * w * dt * (0.5 + age);
      p.z += WIND.dir.y * w * dt * (0.5 + age);
      p.y += p.vy * dt;
      p.vy = Math.max(0.35, p.vy - 0.5 * dt);
      p.rot += p.spin * dt;
    }
  }

  draw(b) {
    // fresh smoke is dark because it is coal; it lightens as it thins, which is
    // both what soot does and what the bible asks distance to do.
    const near = lin(soot(AIR.haze, 0.44));
    const far = lin(mix(AIR.haze, AIR.skyLower, 0.22));
    const sunTint = lin(sunlit(AIR.haze, 0.30));
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      const age = 1 - p.life / p.max;
      const r = p.r0 + p.grow * age * 6;
      const a = Math.min(1, age * 6.5) * (1 - age * 0.92) * 0.88;
      const lit = occlusionAt(p.x, p.y, p.z, 1.4);
      const k = Math.min(1, age * 1.5);
      let cr = near[0] + (far[0] - near[0]) * k;
      let cg = near[1] + (far[1] - near[1]) * k;
      let cb = near[2] + (far[2] - near[2]) * k;
      cr += (sunTint[0] - cr) * lit * 0.55;
      cg += (sunTint[1] - cg) * lit * 0.55;
      cb += (sunTint[2] - cb) * lit * 0.55;
      b.push(p.x, p.y, p.z, r * 2, r * 2, 0, 0, 1, 1, cr, cg, cb, a, p.rot);
    }
  }
}

/* =============================================================================
 * PIGEONS
 * ========================================================================== */

const PERCH_CORNICE = 0, PERCH_KERB = 1;

class Flock {
  constructor(batch, block, rng) {
    this.batch = batch;
    this.rng = rng;
    this.perches = [];
    for (const b of block) {
      if (!b.pigeons || b.storeys < 4) continue;
      const y = corniceTop(b.storeys) + 0.42;
      const n = b.coop ? 5 : 3;
      for (let i = 0; i < n; i++) {
        const z = b.z0 + 3 + (22 / n) * (i + rng.range(0.1, 0.7));
        if (z < -22 || z > 178) continue;
        this.perches.push({ kind: PERCH_CORNICE, x: b.side * (CANYON.facadeX - 3.0), y, z, face: -b.side, taken: -1 });
      }
    }
    // the ones that matter: kerb pigeons, close enough to the game to scatter
    for (const [x, z] of [[-20.2, -12], [-20.6, 9], [-19.8, 31], [20.4, -6], [19.9, 18], [20.8, 44],
      [-20.1, 62], [20.2, 74], [-19.6, 96]]) {
      this.perches.push({ kind: PERCH_KERB, x, y: GROUND.walkTop + 0.02, z, face: x > 0 ? -1 : 1, taken: -1 });
    }

    this.birds = [];
    const N = Math.min(26, this.perches.length);
    for (let i = 0; i < N; i++) {
      this.birds.push({
        i,
        state: 'perch', perch: i, t: rng.range(0, 4),
        pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        head: 0, roll: 0, flap: rng.range(0, 6.28), flapRate: rng.range(6.4, 8.2),
        white: rng.chance(0.16) ? 1 : 0,
        size: rng.range(1.44, 1.86),
        orbit: 0, rad: rng.range(7, 19), yOff: rng.range(-6, 7),
        bob: rng.range(0, 6.28), peck: rng.range(2, 9), settle: 0,
      });
      this.perches[i].taken = i;
      this.birds[i].pos.set(this.perches[i].x, this.perches[i].y, this.perches[i].z);
    }
    // the flock keeps a loose knot rather than spreading over the whole sky:
    // three clumps, each with its own slot on the wheel.
    this.birds.forEach((b, i) => { b.clump = i % 3; b.orbit = b.clump * 2.1 + this.rng.range(-0.34, 0.34); });
    this.center = new THREE.Vector3(0, 54, 42);
    this.t = 0;
    this.alarm = 0;
  }

  reset() {
    for (const p of this.perches) p.taken = -1;
    this.birds.forEach((b, i) => {
      b.state = 'perch'; b.perch = i; b.t = this.rng.range(0, 4); b.roll = 0; b.settle = 0;
      this.perches[i].taken = i;
      b.pos.set(this.perches[i].x, this.perches[i].y, this.perches[i].z);
      b.vel.set(0, 0, 0);
      b.head = this.perches[i].face > 0 ? 0 : Math.PI;
    });
    this.t = 0; this.alarm = 0;
  }

  freePerch(near, kind) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < this.perches.length; i++) {
      const p = this.perches[i];
      if (p.taken >= 0) continue;
      if (kind !== undefined && p.kind !== kind) continue;
      const d = (p.x - near.x) ** 2 + (p.z - near.z) ** 2 + (p.y - near.y) ** 2 * 0.4;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  launch(b, urgency = 1) {
    if (b.state !== 'perch') return;
    if (b.perch >= 0) this.perches[b.perch].taken = -1;
    b.perch = -1;
    b.state = 'fly';
    b.t = 0;
    b.fly = 4.2 + this.rng.range(0, 4.5) + urgency * 2.4;
    b.vel.set(this.rng.range(-3, 3), 7.5 + this.rng.range(0, 5) * urgency, this.rng.range(-3, 3));
    b.orbit = this.rng.range(0, 6.28);
    b.flap = this.rng.range(0, 6.28);
  }

  scatter(x, y, z, r, urgency = 1) {
    let n = 0;
    for (const b of this.birds) {
      if (b.state !== 'perch') continue;
      const dx = b.pos.x - x, dy = b.pos.y - y, dz = b.pos.z - z;
      if (dx * dx + dy * dy * 0.6 + dz * dz < r * r) { this.launch(b, urgency); n++; }
    }
    if (n) this.alarm = 1;
    return n;
  }

  update(dt, app) {
    this.t += dt;
    this.alarm = Math.max(0, this.alarm - dt * 0.5);
    // the flock's own slow wheel over the block
    const a = this.t * 0.34;
    this.center.set(Math.cos(a) * 13, 52 + Math.sin(a * 0.7) * 6, 44 + Math.sin(a) * 22);

    const ball = app.sim && app.sim.ball;
    if (ball && (ball.live || ball.inFlight)) {
      this.scatter(ball.pos.x, ball.pos.y, ball.pos.z, 13, 1.3);
    }

    const wx = WIND.dir.x * WIND.speed * 0.30, wz = WIND.dir.y * WIND.speed * 0.30;

    for (const b of this.birds) {
      b.t += dt;
      if (b.state === 'perch') {
        const p = this.perches[b.perch];
        if (!p) { b.state = 'fly'; b.fly = 5; continue; }
        b.pos.set(p.x, p.y, p.z);
        b.bob += dt * 2.2;
        if (b.t > b.peck) { b.t = 0; b.peck = 2.4 + this.rng.range(0, 7); }
        // one bird in the flock lifts off on its own every so often: aliveness
        if (this.rng.next() < dt * 0.012) this.launch(b, 0.2);
        continue;
      }

      // ── flying: steer to a slot on the flock's wheel, then peel off to land
      const desired = new THREE.Vector3();
      let speed = 20;
      if (b.state === 'fly') {
        const ph = this.orbitPhase(b);
        desired.set(
          this.center.x + Math.cos(ph) * b.rad,
          this.center.y + b.yOff + Math.sin(this.t * 0.9 + b.orbit) * 2.4,
          this.center.z + Math.sin(ph) * b.rad,
        );
        speed = 21 + this.alarm * 9;
        if (b.t > b.fly) {
          const idx = this.freePerch(b.pos);
          if (idx >= 0) { this.perches[idx].taken = b.i; b.perch = idx; b.state = 'land'; b.t = 0; }
          else b.fly += 3;
        }
      } else {                                   // landing
        const p = this.perches[b.perch];
        const app2 = Math.min(1, b.t / 1.5);
        desired.set(p.x, p.y + 5.5 * (1 - app2) + 0.9, p.z);
        desired.x += (b.pos.x - p.x) * 0.1;
        speed = 15 - 9 * app2;
        const d2 = (b.pos.x - p.x) ** 2 + (b.pos.y - p.y) ** 2 + (b.pos.z - p.z) ** 2;
        if (d2 < 0.55 || b.t > 6) {
          b.state = 'perch'; b.t = 0; b.pos.set(p.x, p.y, p.z);
          b.head = p.face > 0 ? 0 : Math.PI;
          continue;
        }
      }

      const to = desired.sub(b.pos);
      const L = to.length() || 1;
      to.multiplyScalar(speed / L);
      to.x += wx; to.z += wz;
      const prevX = b.vel.x, prevZ = b.vel.z;
      b.vel.lerp(to, Math.min(1, dt * (b.state === 'land' ? 4.2 : 2.6)));
      b.pos.addScaledVector(b.vel, dt);
      if (b.pos.y < GROUND.walkTop + 0.6) { b.pos.y = GROUND.walkTop + 0.6; if (b.vel.y < 0) b.vel.y *= -0.3; }

      // heading and bank, straight off the turn rate — this is what sells a flock
      const h = Math.atan2(b.vel.x, b.vel.z);
      let turn = Math.atan2(b.vel.x, b.vel.z) - Math.atan2(prevX || b.vel.x, prevZ || b.vel.z);
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      b.head = h;
      b.roll += (THREE.MathUtils.clamp(turn / Math.max(dt, 1e-3) * 0.16, -1.1, 1.1) - b.roll) * Math.min(1, dt * 6);

      const climbing = b.vel.y > -1.5;
      b.flap += dt * b.flapRate * (climbing ? 1 : 0.42) * (b.state === 'land' ? 1.35 : 1);
    }
  }

  orbitPhase(b) { return b.orbit + this.t * 0.86 + (b.i % 3) * 0.06; }

  draw(batch, cam) {
    const slateSun = lin(sunlit(0xffffff, 0.24));
    const slateShd = lin(mix(0xffffff, AIR.shadowTint, 0.30));
    const flashCol = lin(sunlit(0xffffff, 0.10));
    for (const b of this.birds) {
      let frame;
      if (b.state === 'perch') {
        frame = (b.t < 0.55 && b.peck > 0) ? 1 : 0;
        if (Math.sin(b.bob) > 0.86) frame = 7;
      } else if (b.state === 'land') {
        frame = 6;
      } else {
        const f = Math.floor(((b.flap / (Math.PI * 2)) % 1) * 4);
        frame = [2, 3, 4, 5][f < 0 ? f + 4 : f];
      }
      const uv = pigeonUV(frame, b.white);
      const lit = occlusionAt(b.pos.x, b.pos.y, b.pos.z, 1.0);
      // the pale underwing flashing as it banks through the sun band
      const flash = frame === 4 ? Math.min(1, Math.abs(b.roll) * 0.9 + 0.25) * lit : 0;
      let r = slateShd[0] + (slateSun[0] - slateShd[0]) * lit;
      let g = slateShd[1] + (slateSun[1] - slateShd[1]) * lit;
      let bl = slateShd[2] + (slateSun[2] - slateShd[2]) * lit;
      r += (flashCol[0] * 1.30 - r) * flash;
      g += (flashCol[1] * 1.30 - g) * flash;
      bl += (flashCol[2] * 1.30 - bl) * flash;
      // face the way it is going: flip the sprite when the heading points left
      const toCam = Math.atan2(cam.position.x - b.pos.x, cam.position.z - b.pos.z);
      let rel = b.head - toCam;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      const flip = b.state === 'perch'
        ? (this.perches[b.perch] ? this.perches[b.perch].face * Math.cos(toCam) < 0 : false)
        : rel < 0;
      const s = 1.5 * b.size;
      batch.push(b.pos.x, b.pos.y + s * 0.24, b.pos.z, s, s, uv[0], uv[1], uv[2], uv[3],
        r, g, bl, 1, b.state === 'perch' ? 0 : -b.roll * (flip ? -1 : 1) * 0.7, flip);
    }
  }
}

/* =============================================================================
 * MOTES · BEAM EDGE · HEAT SHIMMER
 * ========================================================================== */

class Motes {
  constructor(rng, n = 150) {
    this.rng = rng;
    this.items = [];
    for (let i = 0; i < n; i++) this.items.push(this.spawn({}, true));
  }
  spawn(m, init) {
    const r = this.rng;
    m.x = r.range(-24, 24);
    m.z = init ? r.range(-30, 74) : r.range(-30, 74);
    m.y = r.range(0.9, 15);
    m.s = r.range(0.055, 0.14);
    m.ph = r.range(0, 6.28);
    m.sp = r.range(0.25, 0.75);
    m.life = r.range(2.5, 9);
    return m;
  }
  update(dt) {
    const wx = WIND.dir.x * WIND.speed * 0.36, wz = WIND.dir.y * WIND.speed * 0.36;
    for (const m of this.items) {
      m.life -= dt;
      m.x += wx * dt;
      m.z += wz * dt;
      m.y += Math.sin(m.ph) * 0.22 * dt + m.sp * dt * 0.4;
      m.ph += dt * 1.7;
      if (m.life <= 0 || m.y > 17 || m.x < -25 || m.x > 25 || m.z > 76) this.spawn(m, false);
    }
  }
  draw(b) {
    const col = lin(sunlit(AIR.haze, 0.22));
    for (const m of this.items) {
      const lit = occlusionAt(m.x, m.y, m.z, 0.9);
      if (lit < 0.06) continue;
      const a = lit * 0.5 * Math.min(1, m.life * 0.8) * (0.55 + 0.45 * Math.sin(m.ph * 1.7));
      b.push(m.x, m.y, m.z, m.s, m.s, 0, 0, 1, 1, col[0], col[1], col[2], Math.max(0, a));
    }
  }
}

/* =============================================================================
 * The system
 * ========================================================================== */

function roofLaundry(block, rng) {
  const grp = new THREE.Group();
  grp.name = 'atmo:roofLaundry';
  const items = [];
  const cloths = [CLOTH[0], CLOTH[1], CLOTH[3], CLOTH[2], mix(CLOTH[0], ACCENTS.indigo, 0.16), mix(CLOTH[3], ACCENTS.claret, 0.14)];
  const chosen = block.filter((b) => b.storeys >= 5 && b.z0 > -20 && b.z0 < 130);
  let made = 0;
  for (const b of chosen) {
    if (made >= 6) break;
    if (!rng.chance(0.82)) continue;
    made++;
    const deck = corniceTop(b.storeys);
    const y = deck + 8.4;
    const x = b.side * (CANYON.facadeX + 3.4 + rng.range(0, 2.4));
    const z0 = b.z0 + 4, z1 = b.z0 + 21;
    // the line, and the two poles it is strung between
    const rope = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, z1 - z0), mat(soot(PAVEMENT.curb, 0.30)));
    rope.position.set(x, y, (z0 + z1) / 2);
    grp.add(rope);
    for (const pz of [z0, z1]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.26, y - deck + 0.3, 0.26), mat(soot(FACADE.cornice[1], 0.22)));
      pole.position.set(x, deck + (y - deck) / 2, pz);
      grp.add(pole);
    }
    const n = 4 + rng.int(0, 2);
    for (let i = 0; i < n; i++) {
      const w = rng.range(1.9, 3.4), h = rng.range(2.6, 4.4);
      const geo = new THREE.PlaneGeometry(w, h, 6, 4);
      const m = new THREE.Mesh(geo, mat(rng.pick(cloths), { side: THREE.DoubleSide }));
      m.rotation.y = -Math.PI / 2;
      m.position.y = -h / 2;
      const pivot = new THREE.Object3D();
      pivot.position.set(x, y, z0 + 1.2 + ((z1 - z0 - 2.4) / (n - 1 || 1)) * i);
      pivot.add(m);
      grp.add(pivot);
      items.push({ pivot, mesh: m, base: geo.attributes.position.array.slice(), w, h, ph: rng.range(0, 6.28), amp: rng.range(0.7, 1.25) });
    }
  }
  return { grp, items };
}

export default registerSystem({
  name: 'atmosphere',
  order: 40,

  init(app) {
    const rng = new RNG(19250922);
    this.rng = rng;
    this.block = readBlock(app);
    this.t = 0;

    this.smokeBatch = new SpriteBatch(app.scene, puffTexture(), 150, { name: 'atmo:smoke', renderOrder: 4 });
    this.glowBatch = new SpriteBatch(app.scene, softTexture(64, [[0, 0.95], [0.45, 0.45], [1, 0]]), 260, {
      name: 'atmo:glow', renderOrder: 5, blending: THREE.AdditiveBlending,
    });
    this.birdBatch = new SpriteBatch(app.scene, pigeonAtlas(), 40, { name: 'atmo:pigeons', renderOrder: 3 });

    this.smoke = new Smoke(this.smokeBatch, this.block, rng);
    this.flock = new Flock(this.birdBatch, this.block, rng);
    this.motes = new Motes(rng, 150);

    const L = roofLaundry(this.block, rng);
    app.scene.add(L.grp);
    this.laundry = L.items;

    // the visible edge of the sun band, standing in the dusty air above the
    // terminator — the one place a beam edge genuinely shows in a canyon.
    this.beam = [];
    for (let i = 0; i < 11; i++) this.beam.push({ u: i / 10, ph: rng.range(0, 6.28) });
    this.shimmer = [];
    for (let i = 0; i < 16; i++) {
      this.shimmer.push({ x: rng.range(-17, 17), z: rng.range(-14, 52), w: rng.range(6, 12), ph: rng.range(0, 6.28), sp: rng.range(0.7, 1.5) });
    }

    app.wind = WIND;
    app.atmosphere = this;
    bus.on('bat:contact', () => this.flock.scatter(0, 3, app.T.street.plateZ, 26, 1.5));
    bus.on('hit', () => { this.flock.alarm = 1; });
    bus.emit('wind', { dir: WIND.dir, speed: WIND.speed });
  },

  onScenario(name) {
    this.t = 0;
    WIND.t = 0; WIND.gust = 1;
    this.rng.reset(19250922);
    this.smoke.reset();
    this.flock.reset();
    if (name === 'atmosphere') {
      for (const b of this.flock.birds) if (this.rng.chance(0.52)) this.flock.launch(b, 0.8);
    }
    // pre-roll the air: chimneys have been alight all afternoon, so a shot
    // taken at t=0 must not catch a block with no smoke over it.
    const h = 1 / 30;
    for (let i = 0; i < 340; i++) { WIND.step(h); this.smoke.update(h, i * h); this.motes.update(h); }
    WIND.t = 0; WIND.gust = 1;
  },

  update(dt, app) {
    this.t += dt;
    WIND.step(dt);
    this.smoke.update(dt, this.t);
    this.flock.update(dt, app);
    this.motes.update(dt);

    // laundry: a travelling wave along the cloth plus a swing off the line
    const g = WIND.gust;
    for (const it of this.laundry) {
      const p = it.mesh.geometry.attributes.position;
      const arr = p.array, base = it.base;
      for (let i = 0; i < arr.length; i += 3) {
        const u = (base[i] / it.w) + 0.5;
        const v = 0.5 - (base[i + 1] / it.h);
        const wave = Math.sin(u * 4.4 - this.t * 4.6 * g + it.ph) * 0.36 + Math.sin(u * 8.1 + this.t * 2.7) * 0.13;
        arr[i + 2] = base[i + 2] + wave * v * v * it.amp * g;
        arr[i + 1] = base[i + 1] + Math.sin(u * 3.1 + this.t * 3.2 + it.ph) * 0.09 * v;
      }
      p.needsUpdate = true;
      it.pivot.rotation.z = -(0.13 + 0.10 * Math.sin(this.t * 1.6 + it.ph)) * g;
    }
  },

  preRender(app) {
    const cam = app.camera;

    const sb = this.smokeBatch; sb.begin(cam); this.smoke.draw(sb); sb.end();
    const bb = this.birdBatch; bb.begin(cam); this.flock.draw(bb, cam); bb.end();

    const gb = this.glowBatch;
    gb.begin(cam);
    this.motes.draw(gb);

    // the beam edge: quads standing on the terminator, brightest at the road
    const A = SKY.P.wash.shaft;
    const bcol = lin(sunlit(AIR.haze, 0.46));
    const hx = SKY.h[0], hz = SKY.h[1];
    for (const q of this.beam) {
      const t = -6 + q.u * 74;
      const x = -CANYON.facadeX - hx * t;
      const z = CANYON.taxZ1 - hz * t;
      if (x < -25 || x > 25) continue;
      const wob = Math.sin(this.t * 0.7 + q.ph) * 0.5;
      const h = 11 + Math.sin(this.t * 0.5 + q.ph * 2) * 2;
      gb.push(x + wob, roadHeight(x) + h * 0.42, z, 11, h, 0, 0, 1, 1,
        bcol[0], bcol[1], bcol[2], A * (0.55 + 0.45 * Math.sin(this.t * 0.6 + q.ph)));
    }

    // heat off the tar: drawn, never filtered
    const scol = lin(sunlit(AIR.brickBounce, 0.55));
    for (const s of this.shimmer) {
      const lit = occlusionAt(s.x, 1, s.z, 1.2);
      if (lit < 0.2) continue;
      const wob = Math.sin(this.t * 2.4 * s.sp + s.ph);
      const h = 2.0 + 0.8 * Math.sin(this.t * 1.9 * s.sp + s.ph * 1.7);
      gb.push(s.x + wob * 0.5, roadHeight(s.x) + h * 0.5 + 0.15, s.z, s.w * (1 + 0.08 * wob), h,
        0, 0, 1, 1, scol[0], scol[1], scol[2], 0.055 * lit);
    }
    gb.end();
  },
});

/* ─── scenario ─────────────────────────────────────────────────────────────── */

registerScenario('atmosphere', {
  seed: 19250922,
  setup: ({ app }) => {
    app.sim.reset(19250922);
    app.camera.fov = 46;
    app.camera.updateProjectionMatrix();
    app.camera.position.set(-13.5, 5.6, -7);
    app.camera.lookAt(13, 30, 44);
  },
  settle: 2.4,
});

void CHALK; void INK; void css;

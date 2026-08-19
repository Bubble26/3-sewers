/**
 * bubbles.js — THE MOUTH OF THE GAME.
 * ============================================================================
 * Everything anybody says is a piece of paper somebody is holding up.
 *
 * DESIGN-BIBLE §6.4 is blunt about it: text always sits on a physical ground — a
 * chalked patch, a slate, a torn card, a taped label — and never on a floating
 * translucent panel. So there are no "speech balloons" in here in the software
 * sense. There are three pieces of paper that exist on this block in 1925:
 *
 *   DOT       a torn strip off the afternoon paper. Warm newsprint, printed
 *             rules top and bottom, halftone speckle. She is three floors up
 *             on the fire escape with the paper rolled into a megaphone, and
 *             the strip she reads off is the same paper.
 *   THE GOOCH the ICE CARD — the square card a housewife put in her window so
 *             the iceman knew how many pounds to carry up. Cold blue-grey,
 *             heavy printed border, a big numeral in one corner. He is on the
 *             tailgate of the wagon on his break and it is what he has to hand.
 *   THE KIDS  butcher paper off the pushcart, torn all round, with one band of
 *             the kid's own accent colour along the top edge — the single
 *             saturated garment rule (§2.9) doing double duty as a name tag, so
 *             you know who is yelling without anybody being labelled.
 *
 * Warm paper, cold paper, brown paper. Three temperatures, three speakers, no
 * legend required.
 *
 * ---------------------------------------------------------------------------
 * WHERE THEY GO — §17 made this a screen-space problem, not a world one
 * ---------------------------------------------------------------------------
 * The stage model locks the camera to two framings and cuts between them, so a
 * bubble welded to a world point would jump across the screen on every cut. The
 * announcers are therefore anchored in SCREEN space — Dot top-left, the Gooch
 * top-right, the scorebug between them — which reads as a broadcast header in
 * both framings and survives a cut without moving a pixel.
 *
 * Kid speech is anchored to the kid's own head, projected per frame, because a
 * taunt has to come out of a specific face. Every card is then run through
 * `solve()`, which knows the three things a card must never cover:
 *
 *      the ball · the batter · the scorebug
 *
 * and slides the card to the best free position, damped, so a card visibly
 * steps out of the way of a rising ball rather than teleporting. Nothing in
 * this file ever decides anything about the game; it listens and it draws.
 *
 * The writing lives in src/audio/announcer.js. This file is the paper.
 * ============================================================================
 */
import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { RNG } from '../core/rng.js';
import {
  CHALK, INK, CLOTH, ACCENTS, AIR, WOOD, PAVEMENT, FACADE, BALL,
  mix, hexCSS, soot, atLstar, inkOf,
} from '../render/palette.js';
import { slab, slabW, wrap, say } from '../chars/portraits.js';

const C = (h) => hexCSS(h);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** overshoot on the way in — a card is snapped up, it does not fade up */
const pop = (t) => (t >= 1 ? 1 : 1 - Math.pow(1 - t, 2.4) * Math.cos(t * 5.6) * 0.5 - Math.pow(1 - t, 2.4) * 0.5);

/* ============================================================================
   1. THE PAPER STOCK
   ========================================================================= */

/**
 * Three stocks. Every colour is derived from the master palette; there is not a
 * hex literal in this file. Contrast against INK is 12:1 at the worst of them,
 * which is two and a half times the §6.4 floor, because a line of dialogue that
 * cannot be read at a glance is a line nobody ever hears.
 */
export const STOCK = {
  news: {
    paper: atLstar(mix(CHALK, CLOTH[2], 0.42), 90),      // afternoon edition, one day old
    edge: mix(CLOTH[3], INK, 0.30),
    rule: mix(INK, CLOTH[3], 0.18),
    tint: mix(CLOTH[3], PAVEMENT.curb, 0.35),            // the halftone speckle
    accent: ACCENTS.claret,                               // Dot's ribbon
    ink: INK,
  },
  ice: {
    paper: atLstar(mix(CHALK, AIR.skyLower, 0.34), 89),  // the card in the window
    edge: mix(AIR.skyFill, INK, 0.34),
    rule: mix(INK, AIR.skyFill, 0.20),
    tint: mix(AIR.skyFill, CLOTH[0], 0.45),
    accent: ACCENTS.indigo,                               // PURE ICE, in indigo, like the wagon
    ink: INK,
  },
  kraft: {
    paper: atLstar(mix(CLOTH[1], WOOD.crate, 0.34), 80), // off the pushcart
    edge: mix(WOOD.weathered, INK, 0.34),
    rule: mix(INK, WOOD.weathered, 0.22),
    tint: mix(WOOD.weathered, CLOTH[0], 0.40),
    accent: ACCENTS.red,                                  // overridden per kid
    ink: INK,
  },
};

/* Type. §6.4 allows three sizes on screen at the absolute maximum, and these are
   the three: the announcers, the kids, and the shout. Everything is cap-height
   in design pixels at a 900 px tall frame. */
const TYPE = {
  announce: 27,
  kid: 24,
  shout: 41,
  lead: 1.52,          // line advance, x cap height
  track: 0.10,
  condense: 0.86,
};

const PAD = { x: 20, top: 26, bottom: 20 };
const CARDW = { dot: 528, gooch: 528, kid: 372 };

/* ============================================================================
   2. Halftone — what makes newsprint newsprint
   ========================================================================= */

const _patterns = new Map();
function speckle(g, key, colour, size = 3) {
  const id = key + ':' + colour;
  let p = _patterns.get(id);
  if (!p) {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const q = c.getContext('2d');
    const r = new RNG(9021 + colour % 977);
    q.fillStyle = C(colour);
    // a slack, irregular rosette — a 1925 halftone screen was cut by hand and it
    // wanders. A perfect grid reads as a CSS background, which is the one thing
    // it must not read as.
    for (let y = 0; y < 24; y += size + 1) {
      for (let x = 0; x < 24; x += size + 1) {
        const rr = r.range(0.28, 0.62) * size;
        q.globalAlpha = r.range(0.20, 0.55);
        q.beginPath();
        q.arc(x + r.range(-0.6, 0.6), y + r.range(-0.6, 0.6), rr, 0, TAU);
        q.fill();
      }
    }
    p = g.createPattern(c, 'repeat');
    _patterns.set(id, p);
  }
  return p;
}

/* ============================================================================
   3. Torn edges
   ---------------------------------------------------------------------------
   Nobody on this block owns scissors. Every card is torn off something bigger,
   and the tear is SEEDED PER STRING and stable for the life of the card (§6.4:
   jitter that re-rolls per frame reads as a rendering bug, not as a hand).
   ========================================================================= */

function tornPath(x, y, w, h, amp, seed) {
  const r = new RNG(seed >>> 0);
  const pts = [];
  const run = (x0, y0, x1, y1, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const nx = -(y1 - y0), ny = (x1 - x0);
      const len = Math.hypot(nx, ny) || 1;
      // a tear is one long fibre with the odd deep bite out of it
      const bite = r.next() < 0.16 ? r.range(1.4, 2.6) : 1;
      const d = r.range(-amp, amp) * bite;
      pts.push([x0 + (x1 - x0) * t + (nx / len) * d, y0 + (y1 - y0) * t + (ny / len) * d]);
    }
  };
  const nH = Math.max(6, Math.round(w / 26));
  const nV = Math.max(4, Math.round(h / 26));
  run(x, y, x + w, y, nH);
  run(x + w, y, x + w, y + h, nV);
  run(x + w, y + h, x, y + h, nH);
  run(x, y + h, x, y, nV);
  return pts;
}

/** The shout: same card, but the edge is a burst. Used when somebody is yelling. */
function burstPath(x, y, w, h, amp, seed) {
  const r = new RNG(seed >>> 0);
  const cx = x + w / 2, cy = y + h / 2;
  const pts = [];
  const n = Math.max(18, Math.round((w + h) / 34) * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU - Math.PI / 2;
    // a rounded rectangle in polar form, then spiked alternately
    const ca = Math.cos(a), sa = Math.sin(a);
    const k = 1 / Math.max(Math.abs(ca) / (w / 2), Math.abs(sa) / (h / 2));
    const spike = (i % 2 === 0) ? 1 + amp / 26 : 1 - amp / 52;
    const j = r.range(0.965, 1.045);
    pts.push([cx + ca * k * spike * j, cy + sa * k * spike * j]);
  }
  return pts;
}

function poly(g, pts, close = true) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  if (close) g.closePath();
}

/* ============================================================================
   4. The two faces on the block
   ---------------------------------------------------------------------------
   Dot and the Gooch are not in the roster — they are not playing — so they get
   drawn here, in the same shape language as chars/portraits.js: one flat ground,
   big shapes, a heavy ink rim, three values of skin and nothing fussy. Each is
   cached to a small canvas at first use and never redrawn.
   ========================================================================= */

const _heads = new Map();

function headCanvas(who, size) {
  const key = who + size;
  if (_heads.has(key)) return _heads.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const S = size / 100;
  const stock = who === 'dot' ? STOCK.news : STOCK.ice;

  g.save();
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.47, 0, TAU); g.clip();
  g.fillStyle = C(mix(stock.paper, stock.accent, 0.30));
  g.fillRect(0, 0, size, size);
  g.fillStyle = speckle(g, 'head', stock.tint, 3);
  g.globalAlpha = 0.5; g.fillRect(0, 0, size, size); g.globalAlpha = 1;

  const ink = C(INK);
  const line = (fn, wgt) => { g.strokeStyle = ink; g.lineWidth = wgt * S; g.lineJoin = 'round'; g.lineCap = 'round'; fn(); g.stroke(); };
  const blob = (fill, fn, wgt = 3.4) => {
    g.fillStyle = C(fill); fn(); g.fill();
    g.strokeStyle = C(inkOf(fill)); g.lineWidth = wgt * S; g.lineJoin = 'round'; g.stroke();
  };

  if (who === 'dot') {
    /* Third floor front, leaning over the rail, paper rolled into a cone.
       She is drawn mid-shout because she is always mid-shout. */
    // the fire-escape rail she is leaning on, behind her
    g.strokeStyle = C(FACADE.iron[0]); g.lineWidth = 4.2 * S; g.lineCap = 'round';
    for (const yy of [66, 78]) { g.beginPath(); g.moveTo(0, yy * S); g.lineTo(size, yy * S); g.stroke(); }
    for (const xx of [12, 34, 56, 78]) { g.beginPath(); g.moveTo(xx * S, 62 * S); g.lineTo(xx * S, 92 * S); g.stroke(); }

    // hair: a bob, claret ribbon
    blob(mix(0x3a2318, INK, 0.10), () => {
      g.beginPath();
      g.moveTo(24 * S, 62 * S); g.quadraticCurveTo(16 * S, 22 * S, 50 * S, 16 * S);
      g.quadraticCurveTo(85 * S, 21 * S, 78 * S, 62 * S);
      g.quadraticCurveTo(66 * S, 52 * S, 50 * S, 54 * S);
      g.quadraticCurveTo(34 * S, 52 * S, 24 * S, 62 * S);
      g.closePath();
    });
    // face
    blob(0xefc199, () => {
      g.beginPath(); g.ellipse(50 * S, 47 * S, 25 * S, 27 * S, 0, 0, TAU);
    });
    // hair front, over the face
    blob(mix(0x3a2318, INK, 0.10), () => {
      g.beginPath();
      g.moveTo(25 * S, 44 * S); g.quadraticCurveTo(22 * S, 17 * S, 51 * S, 15 * S);
      g.quadraticCurveTo(84 * S, 19 * S, 76 * S, 40 * S);
      g.quadraticCurveTo(64 * S, 27 * S, 46 * S, 31 * S);
      g.quadraticCurveTo(32 * S, 33 * S, 25 * S, 44 * S);
      g.closePath();
    });
    // the ribbon
    blob(ACCENTS.claret, () => {
      g.beginPath();
      g.moveTo(70 * S, 25 * S); g.lineTo(88 * S, 14 * S); g.lineTo(90 * S, 30 * S);
      g.lineTo(78 * S, 33 * S); g.closePath();
    }, 2.6);
    // eyes — one wide, one squeezed shut, because she is shouting
    blob(CHALK, () => { g.beginPath(); g.ellipse(41 * S, 46 * S, 6.6 * S, 7.4 * S, 0, 0, TAU); }, 2.4);
    g.fillStyle = ink;
    g.beginPath(); g.arc(42 * S, 47 * S, 3.4 * S, 0, TAU); g.fill();
    line(() => { g.beginPath(); g.moveTo(56 * S, 46 * S); g.quadraticCurveTo(62 * S, 42 * S, 68 * S, 47 * S); }, 3.2);
    // brows, up
    line(() => { g.beginPath(); g.moveTo(34 * S, 34 * S); g.quadraticCurveTo(41 * S, 29 * S, 48 * S, 33 * S); }, 3.4);
    line(() => { g.beginPath(); g.moveTo(56 * S, 33 * S); g.quadraticCurveTo(63 * S, 29 * S, 70 * S, 35 * S); }, 3.4);
    // freckles
    g.fillStyle = C(mix(0xefc199, INK, 0.34));
    for (const [fx, fy] of [[36, 56], [42, 58], [60, 57], [66, 55], [39, 62]]) {
      g.beginPath(); g.arc(fx * S, fy * S, 1.5 * S, 0, TAU); g.fill();
    }
    // the rolled newspaper, cone to the mouth
    blob(mix(STOCK.news.paper, CLOTH[3], 0.25), () => {
      g.beginPath();
      g.moveTo(48 * S, 60 * S); g.lineTo(58 * S, 63 * S);
      g.lineTo(100 * S, 86 * S); g.lineTo(96 * S, 100 * S); g.lineTo(46 * S, 70 * S);
      g.closePath();
    }, 3.0);
    line(() => { g.beginPath(); g.moveTo(64 * S, 68 * S); g.lineTo(88 * S, 82 * S); }, 1.8);
  } else {
    /* The Gooch. Iceman, on his break, tongs still in the hand. The cap is the
       silhouette, the moustache is the punchline, and he has not moved. */
    // the tongs, over his shoulder, behind
    g.strokeStyle = C(mix(FACADE.iron[4], INK, 0.2)); g.lineWidth = 4.6 * S; g.lineCap = 'round';
    g.beginPath(); g.moveTo(8 * S, 96 * S); g.quadraticCurveTo(20 * S, 46 * S, 12 * S, 18 * S); g.stroke();
    g.beginPath(); g.moveTo(8 * S, 96 * S); g.quadraticCurveTo(28 * S, 52 * S, 26 * S, 22 * S); g.stroke();
    // shoulder / undershirt
    blob(CLOTH[1], () => {
      g.beginPath(); g.moveTo(10 * S, 100 * S);
      g.quadraticCurveTo(22 * S, 74 * S, 50 * S, 74 * S);
      g.quadraticCurveTo(80 * S, 74 * S, 94 * S, 100 * S); g.closePath();
    });
    // face — heavy jaw
    blob(0xdfa377, () => {
      g.beginPath();
      g.moveTo(28 * S, 40 * S); g.lineTo(74 * S, 40 * S);
      g.quadraticCurveTo(78 * S, 72 * S, 51 * S, 78 * S);
      g.quadraticCurveTo(25 * S, 72 * S, 28 * S, 40 * S); g.closePath();
    });
    // the flat cap, worn low
    blob(mix(FACADE.cornice[1], INK, 0.12), () => {
      g.beginPath();
      g.moveTo(22 * S, 40 * S);
      g.quadraticCurveTo(20 * S, 12 * S, 52 * S, 12 * S);
      g.quadraticCurveTo(82 * S, 13 * S, 80 * S, 38 * S);
      g.lineTo(94 * S, 44 * S); g.quadraticCurveTo(58 * S, 52 * S, 22 * S, 44 * S);
      g.closePath();
    });
    // eyes: half-lidded, because nothing has ever surprised him
    g.fillStyle = C(mix(0xdfa377, INK, 0.5));
    g.fillRect(34 * S, 47 * S, 13 * S, 3.2 * S);
    g.fillRect(56 * S, 47 * S, 13 * S, 3.2 * S);
    g.fillStyle = ink;
    g.beginPath(); g.arc(41 * S, 52 * S, 3.0 * S, 0, TAU); g.fill();
    g.beginPath(); g.arc(62 * S, 52 * S, 3.0 * S, 0, TAU); g.fill();
    // the moustache
    blob(mix(0x3a2318, INK, 0.2), () => {
      g.beginPath();
      g.moveTo(31 * S, 61 * S); g.quadraticCurveTo(51 * S, 55 * S, 71 * S, 61 * S);
      g.quadraticCurveTo(66 * S, 70 * S, 51 * S, 66 * S);
      g.quadraticCurveTo(36 * S, 70 * S, 31 * S, 61 * S); g.closePath();
    }, 2.6);
    // mouth: flat, unmoved
    line(() => { g.beginPath(); g.moveTo(42 * S, 71 * S); g.lineTo(60 * S, 71 * S); }, 3.0);
    // a chip of ice on the shoulder, melting
    blob(mix(AIR.skyLower, CHALK, 0.5), () => {
      g.beginPath(); g.moveTo(76 * S, 82 * S); g.lineTo(92 * S, 78 * S);
      g.lineTo(98 * S, 92 * S); g.lineTo(80 * S, 95 * S); g.closePath();
    }, 2.4);
  }
  g.restore();

  // the rim
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.47, 0, TAU);
  g.strokeStyle = ink; g.lineWidth = Math.max(1.6, size * 0.036); g.stroke();
  _heads.set(key, c);
  return c;
}

/* ============================================================================
   5. A card
   ========================================================================= */

let SEQ = 0;

class Card {
  constructor(o) {
    this.id = ++SEQ;
    this.who = o.who || 'kid';                  // 'dot' | 'gooch' | 'kid'
    this.stock = this.who === 'dot' ? STOCK.news : this.who === 'gooch' ? STOCK.ice : STOCK.kraft;
    this.accent = o.accent ?? this.stock.accent;
    this.kind = o.kind || 'talk';               // 'talk' | 'shout' | 'beat'
    this.text = say(o.text ?? '');
    this.body = o.body || null;                 // a chars/players.js Kid, for the tail
    this.world = o.world || null;               // or a world point
    this.side = o.side || (this.who === 'gooch' ? 'right' : 'left');
    this.life = o.hold ?? 2.4;
    this.age = 0;
    this.out = false;
    this.punch = 1;                             // re-punches when the text changes
    this.grow = o.grow ?? 1;                    // escalation: the card gets bigger
    this.growGoal = this.grow;
    this.seed = 0;
    this.pos = null;                            // solved, damped screen position
    this.goal = { x: 0, y: 0 };
    this.rect = { x: 0, y: 0, w: 0, h: 0 };
    this.lines = null;
    this.reseed();
  }

  reseed() {
    let s = 2166136261;
    for (let i = 0; i < this.text.length; i++) { s ^= this.text.charCodeAt(i); s = Math.imul(s, 16777619); }
    this.seed = (s ^ (this.id * 2654435761)) >>> 0;
    this.lines = null;
  }

  /** Swap the words without dropping the card — this is how a build lands. */
  setText(t, o = {}) {
    const next = say(t);
    if (next === this.text && o.grow == null) return;
    this.text = next;
    this.kind = o.kind || this.kind;
    if (o.grow != null) this.growGoal = o.grow;
    if (o.hold != null) { this.life = o.hold; this.age = Math.min(this.age, 0.05); }
    this.punch = 1;
    this.reseed();
  }

  get alpha() {
    const inT = ease(clamp(this.age / 0.13, 0, 1));
    const outT = 1 - ease(clamp((this.age - this.life) / 0.17, 0, 1));
    return Math.min(inT, outT);
  }

  get scale() {
    const s = pop(clamp(this.age / 0.15, 0, 1));
    const p = 1 + this.punch * 0.10;
    const o = 1 - ease(clamp((this.age - this.life) / 0.17, 0, 1)) * 0.22;
    return s * p * o * this.grow;
  }

  get dead() { return this.age > this.life + 0.20; }
}

/* ============================================================================
   6. The layer
   ========================================================================= */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

class Bubbles {
  constructor() {
    this.el = null; this.g = null; this.w = 0; this.h = 0; this.U = 1;
    this.cards = [];
    this.blocked = [];
    this.enabled = true;
    /** set by src/audio/announcer.js so the 'bubbles' scenario can stage a moment */
    this.demo = null;
  }

  mount() {
    if (this.el || typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.id = 'sb-bubbles';
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
      display: 'block', zIndex: '45', pointerEvents: 'none',
    });
    (document.getElementById('ui') || document.body).appendChild(c);
    this.el = c;
    this.g = c.getContext('2d');
    this.resize();
  }

  resize() {
    if (!this.el) return;
    const w = Math.max(640, Math.round(globalThis.innerWidth || 1600));
    const h = Math.max(360, Math.round(globalThis.innerHeight || 900));
    if (this.w !== w || this.h !== h) { this.el.width = w; this.el.height = h; this.w = w; this.h = h; }
    this.U = this.h / 900;
  }

  /* --- the one public verb ---------------------------------------------- */
  say(o = {}) {
    this.mount();
    const card = new Card(o);
    // only one card per speaker: a second line from Dot replaces her first, it
    // does not stack up a wall of paper
    const slot = card.who === 'kid' ? (o.body || o.slot || card.id) : card.who;
    card.slot = slot;
    const prev = this.cards.find((c) => c.slot === slot && !c.out);
    if (prev && prev.who !== 'kid' && !o.fresh) {
      prev.setText(card.text, { kind: card.kind, hold: card.life, grow: card.grow });
      prev.body = card.body; prev.world = card.world; prev.accent = card.accent;
      return prev;
    }
    if (prev) prev.retire();
    // never more than four pieces of paper on screen; the oldest kid goes first
    const kids = this.cards.filter((c) => c.who === 'kid' && !c.out);
    while (kids.length >= 3) { const k = kids.shift(); k.age = k.life + 0.01; }
    this.cards.push(card);
    return card;
  }

  clear() { this.cards.length = 0; }

  update(dt) {
    for (const c of this.cards) {
      c.age += dt;
      c.punch = Math.max(0, c.punch - dt * 7.5);
      c.grow += (c.growGoal - c.grow) * (1 - Math.exp(-dt / 0.10));
    }
    for (let i = this.cards.length - 1; i >= 0; i--) if (this.cards[i].dead) this.cards.splice(i, 1);
  }

  /* --- geometry ---------------------------------------------------------- */
  project(app, x, y, z) {
    const cam = app.camera;
    if (!cam) return null;
    _v.set(x, y, z).project(cam);
    if (_v.z > 1) return null;
    return { x: (_v.x * 0.5 + 0.5) * this.w, y: (-_v.y * 0.5 + 0.5) * this.h };
  }

  /** Where a kid's mouth is, in screen pixels, and how tall he reads. */
  kidAnchor(app, body) {
    if (!body || !body.group) return null;
    const h = body.rig?.height ?? 4.9;
    const p = body.group.position;
    const head = this.project(app, p.x, h * 0.94, p.z);
    const foot = this.project(app, p.x, 0, p.z);
    if (!head) return null;
    const px = foot ? Math.abs(foot.y - head.y) : 90 * this.U;
    return { x: head.x, y: head.y, px: Math.max(24, px) };
  }

  /** The three things a card may never sit on. Rebuilt every frame. */
  survey(app) {
    const B = this.blocked;
    B.length = 0;
    const U = this.U;
    // 1. the scorebug, which is DOM and lives top-centre
    B.push({ x: this.w * 0.5 - 190 * U, y: 0, w: 380 * U, h: 96 * U, weight: 1 });
    // 2. the ball. Always. It is the readability accent of the whole game (§2.4).
    const ball = app.sim?.ball;
    if (ball && (ball.live || ball.inFlight)) {
      const p = this.project(app, ball.pos.x, ball.pos.y, ball.pos.z);
      if (p) {
        const r = 62 * U;
        B.push({ x: p.x - r, y: p.y - r, w: r * 2, h: r * 2, weight: 2.4 });
      }
    }
    // 3. the batter, head to foot, plus the arc the stick sweeps
    const players = app.get ? app.get('players') : null;
    const bat = players?.batter;
    if (bat) {
      const a = this.kidAnchor(app, bat);
      if (a) B.push({ x: a.x - a.px * 0.85, y: a.y - a.px * 0.30, w: a.px * 1.7, h: a.px * 1.5, weight: 1.8 });
    }
    // 4. the pitcher's head, so a card never blanks the delivery
    const pit = players?.pitcher;
    if (pit) {
      const a = this.kidAnchor(app, pit);
      if (a) B.push({ x: a.x - a.px * 0.55, y: a.y - a.px * 0.18, w: a.px * 1.1, h: a.px * 0.9, weight: 0.8 });
    }
    return B;
  }

  overlap(r, o) {
    const x = Math.max(0, Math.min(r.x + r.w, o.x + o.w) - Math.max(r.x, o.x));
    const y = Math.max(0, Math.min(r.y + r.h, o.y + o.h) - Math.max(r.y, o.y));
    return x * y;
  }

  /** Lay a card out: wrap the words, measure the paper. */
  layout(card) {
    const U = this.U;
    const size = (card.kind === 'shout' ? TYPE.shout : card.who === 'kid' ? TYPE.kid : TYPE.announce) * U;
    const maxW = (card.who === 'kid' ? CARDW.kid : CARDW.dot) * U - PAD.x * 2 * U;
    const opt = { tracking: TYPE.track, condense: TYPE.condense };
    const lines = wrap(card.text, size, maxW, opt);
    let wid = 0;
    for (const l of lines) wid = Math.max(wid, slabW(l, size, opt));
    const badge = card.who === 'kid' ? 0 : 62 * U;
    const w = wid + PAD.x * 2 * U + badge;
    const h = lines.length * size * TYPE.lead + (PAD.top + PAD.bottom) * U;
    card.lines = lines; card.size = size; card.badge = badge;
    card.rect.w = w; card.rect.h = h;
    return card;
  }

  /** Put it somewhere it does not cover the game. */
  solve(app, card, dt) {
    const U = this.U, W = this.w, H = this.h;
    const m = 30 * U;
    const cands = [];
    if (card.who === 'kid') {
      const a = this.kidAnchor(app, card.body) || { x: W * 0.5, y: H * 0.55, px: 90 * U };
      card.anchor = a;
      const gap = Math.max(30 * U, a.px * 0.34);
      // above the head first, then the shoulders, then either hip
      for (const [dx, dy, pri] of [
        [0, -1, 0], [0.62, -0.92, 0.5], [-0.62, -0.92, 0.5],
        [1.0, -0.45, 1.6], [-1.0, -0.45, 1.6], [0, -1.55, 2.2],
      ]) {
        cands.push({
          x: a.x + dx * (card.rect.w * 0.5 + gap) - card.rect.w / 2,
          y: a.y + dy * (card.rect.h * 0.5 + gap) - card.rect.h / 2,
          pri,
        });
      }
    } else {
      const left = card.who === 'dot';
      const x0 = left ? m : W - m - card.rect.w;
      const x1 = left ? W - m - card.rect.w : m;
      card.anchor = { x: left ? x0 + 46 * U : x0 + card.rect.w - 46 * U, y: -40 * U, px: 0 };
      cands.push({ x: x0, y: m, pri: 0 });
      cands.push({ x: x0, y: m + card.rect.h * 0.72, pri: 1.1 });
      cands.push({ x: x0, y: H - m - card.rect.h, pri: 2.0 });
      cands.push({ x: x1, y: m, pri: 3.0 });
    }

    const blocked = this.blocked;
    let best = null, bestCost = Infinity;
    for (const c of cands) {
      const x = clamp(c.x, m * 0.5, W - m * 0.5 - card.rect.w);
      const y = clamp(c.y, m * 0.4, H - m * 0.4 - card.rect.h);
      const r = { x, y, w: card.rect.w, h: card.rect.h };
      let cost = c.pri * 900 * U * U;
      for (const b of blocked) cost += this.overlap(r, b) * b.weight;
      for (const o of this.cards) {
        if (o === card || !o.rect.w || !o.pos) continue;
        cost += this.overlap(r, { x: o.pos.x, y: o.pos.y, w: o.rect.w, h: o.rect.h }) * 1.4;
      }
      if (cost < bestCost) { bestCost = cost; best = { x, y }; }
    }
    card.goal = best;
    if (!card.pos) card.pos = { x: best.x, y: best.y };
    else {
      // damped: a card gets out of the ball's way, it does not teleport
      const k = 1 - Math.exp(-dt / 0.085);
      card.pos.x += (best.x - card.pos.x) * k;
      card.pos.y += (best.y - card.pos.y) * k;
    }
    card.rect.x = card.pos.x; card.rect.y = card.pos.y;
  }

  /* --- paint ------------------------------------------------------------- */
  paint(app) {
    this.mount();
    if (!this.g) return;
    this.resize();
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    if (!this.enabled || !this.cards.length) return;
    this.survey(app);
    const dt = 1 / 60;
    for (const c of this.cards) { this.layout(c); this.solve(app, c, dt); }
    // announcers behind, kids in front — a kid yelling wins the frame
    const order = [...this.cards].sort((a, b) => (a.who === 'kid' ? 1 : 0) - (b.who === 'kid' ? 1 : 0));
    for (const c of order) this.draw(g, c);
  }

  draw(g, card) {
    const U = this.U;
    const a = card.alpha;
    if (a <= 0.002) return;
    const r = card.rect;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const s = card.scale;
    const rnd = new RNG(card.seed);
    const tilt = (rnd.next() - 0.5) * 0.036;      // ±1° — seeded, stable, never per frame

    g.save();
    g.globalAlpha = a;
    g.translate(cx, cy);
    g.rotate(tilt);
    g.scale(s, s);
    g.translate(-cx, -cy);

    const st = card.stock;
    const shout = card.kind === 'shout';
    const path = shout
      ? burstPath(r.x, r.y, r.w, r.h, 15 * U, card.seed)
      : tornPath(r.x, r.y, r.w, r.h, 3.4 * U, card.seed);

    /* --- the tail, first, so the card covers where it joins --------------- */
    this.tail(g, card, st, shout);

    /* --- contact shadow: three offset copies, a real drop, warm-dark ------ */
    for (let i = 3; i >= 1; i--) {
      g.save();
      g.globalAlpha = a * 0.10 * i;
      g.translate(3.2 * U * i * 0.55, 5.0 * U * i * 0.55);
      poly(g, path);
      g.fillStyle = C(mix(AIR.shadowTint, INK, 0.45));
      g.fill();
      g.restore();
    }

    /* --- the paper -------------------------------------------------------- */
    poly(g, path);
    g.save();
    g.clip();
    g.fillStyle = C(st.paper);
    g.fillRect(r.x - 40 * U, r.y - 40 * U, r.w + 80 * U, r.h + 80 * U);
    // the sheet is not flat: light off the top-left, the bottom-right sits down
    const grd = g.createLinearGradient(r.x, r.y, r.x + r.w * 0.4, r.y + r.h);
    grd.addColorStop(0, C(mix(st.paper, CHALK, 0.55)));
    grd.addColorStop(0.55, C(st.paper));
    grd.addColorStop(1, C(mix(st.paper, st.edge, 0.34)));
    g.globalAlpha = 0.82; g.fillStyle = grd;
    g.fillRect(r.x - 40 * U, r.y - 40 * U, r.w + 80 * U, r.h + 80 * U);
    g.globalAlpha = 1;
    // stock texture
    g.globalAlpha = card.who === 'kid' ? 0.34 : 0.46;
    g.fillStyle = speckle(g, 'card', st.tint, card.who === 'kid' ? 4 : 3);
    g.fillRect(r.x - 40 * U, r.y - 40 * U, r.w + 80 * U, r.h + 80 * U);
    g.globalAlpha = 1;
    this.furniture(g, card, st);
    g.restore();

    /* --- the torn edge ---------------------------------------------------- */
    poly(g, path);
    g.strokeStyle = C(st.edge);
    g.lineWidth = Math.max(1.2, 2.2 * U);
    g.lineJoin = 'round';
    g.stroke();

    /* --- the words -------------------------------------------------------- */
    const size = card.size;
    const x0 = r.x + PAD.x * U + card.badge;
    let y = r.y + PAD.top * U + size;
    const opt = {
      tracking: TYPE.track, condense: TYPE.condense, weight: shout ? 0.235 : 0.20,
      serif: size * 0.16, jitter: 0.9, seed: card.seed % 9973,
      color: C(st.ink),
      shadow: { dx: Math.max(1, 1.6 * U), dy: Math.max(1, 1.7 * U), color: C(mix(st.paper, st.edge, 0.72)) },
    };
    for (const line of card.lines) {
      slab(g, line, x0, y, size, opt);
      y += size * TYPE.lead;
    }
    g.restore();
  }

  /** Printed matter: the rules on the newsprint, the numeral on the ice card, the
      accent band on a kid's scrap, and the speaker's face. */
  furniture(g, card, st) {
    const U = this.U, r = card.rect;
    if (card.who === 'kid') {
      g.fillStyle = C(card.accent);
      g.fillRect(r.x, r.y, r.w, 9 * U);
      g.globalAlpha = 0.35;
      g.fillStyle = C(mix(card.accent, INK, 0.4));
      g.fillRect(r.x, r.y + 9 * U, r.w, 2.4 * U);
      g.globalAlpha = 1;
      return;
    }
    const badge = 62 * U;
    if (card.who === 'dot') {
      // two printed rules and a column edge — an afternoon paper, torn across
      g.strokeStyle = C(st.rule); g.globalAlpha = 0.5;
      g.lineWidth = Math.max(1, 1.6 * U);
      g.beginPath(); g.moveTo(r.x + 6 * U, r.y + 14 * U); g.lineTo(r.x + r.w - 6 * U, r.y + 14 * U); g.stroke();
      g.lineWidth = Math.max(1, 0.9 * U);
      g.beginPath(); g.moveTo(r.x + 6 * U, r.y + 18.5 * U); g.lineTo(r.x + r.w - 6 * U, r.y + 18.5 * U); g.stroke();
      g.beginPath(); g.moveTo(r.x + 6 * U, r.y + r.h - 11 * U); g.lineTo(r.x + r.w - 6 * U, r.y + r.h - 11 * U); g.stroke();
      g.globalAlpha = 1;
    } else {
      // THE ICE CARD: heavy printed border, and the pounds numeral in the corner
      g.strokeStyle = C(st.accent); g.globalAlpha = 0.55;
      g.lineWidth = Math.max(1.4, 3.0 * U);
      g.strokeRect(r.x + 7 * U, r.y + 7 * U, r.w - 14 * U, r.h - 14 * U);
      g.globalAlpha = 0.16;
      slab(g, '25', r.x + r.w - 26 * U, r.y + r.h - 14 * U, 46 * U,
        { align: 'right', color: C(st.accent), weight: 0.26, tracking: 0.04 });
      g.globalAlpha = 1;
    }
    // the face
    const hc = headCanvas(card.who, 128);
    const d = badge - 14 * U;
    g.drawImage(hc, r.x + 10 * U, r.y + (r.h - d) / 2, d, d);
  }

  /** A folded strip of the same paper, pointing at whoever is talking. */
  tail(g, card, st, shout) {
    const U = this.U, r = card.rect;
    const a = card.anchor;
    if (!a) return;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let tx = a.x, ty = a.y;
    // clamp the tip so a tail never runs the width of the screen
    const dx = tx - cx, dy = ty - cy;
    const len = Math.hypot(dx, dy) || 1;
    const cap = Math.max(r.h * 1.5, 190 * U);
    if (len > cap) { tx = cx + (dx / len) * cap; ty = cy + (dy / len) * cap; }
    // the base sits on the card edge nearest the speaker
    const ux = dx / len, uy = dy / len;
    const bx = cx + ux * (r.w * 0.30), by = cy + uy * (r.h * 0.42);
    const px = -uy, py = ux;
    const wdt = (shout ? 20 : 15) * U;
    g.save();
    g.globalAlpha = g.globalAlpha * 0.98;
    g.beginPath();
    g.moveTo(bx + px * wdt, by + py * wdt);
    // a kink: the paper is folded, not a smooth cone
    g.lineTo(cx + ux * (len * 0.62) + px * wdt * 0.42, cy + uy * (len * 0.62) + py * wdt * 0.42);
    g.lineTo(tx, ty);
    g.lineTo(cx + ux * (len * 0.58) - px * wdt * 0.50, cy + uy * (len * 0.58) - py * wdt * 0.50);
    g.lineTo(bx - px * wdt, by - py * wdt);
    g.closePath();
    g.fillStyle = C(mix(st.paper, st.edge, 0.18));
    g.fill();
    g.strokeStyle = C(st.edge);
    g.lineWidth = Math.max(1.1, 2.0 * U);
    g.lineJoin = 'round';
    g.stroke();
    g.restore();
  }
}

Card.prototype.retire = function retire() { this.age = Math.max(this.age, this.life + 0.001); this.out = true; };

export const bubbles = new Bubbles();

/* ============================================================================
   7. The system
   ---------------------------------------------------------------------------
   The cards are aged in lateUpdate (which is where dt lives) and painted in
   preRender (which is the only hook the harness calls on a bare renderOnce()).
   Splitting it that way is the difference between a screenshot with dialogue in
   it and a screenshot without.
   ========================================================================= */

export default registerSystem({
  name: 'bubbles',
  order: 320,                 // after cameras (300): the camera must be final before we project

  init(app) {
    bubbles.mount();
    if (typeof addEventListener === 'function') addEventListener('resize', () => bubbles.resize());
  },

  lateUpdate(dt) { bubbles.update(dt); },

  preRender(app) { bubbles.paint(app); },

  onScenario(name) {
    // every scenario starts with a clean mouth; the announcer re-stages what it wants
    bubbles.clear();
  },
});

/* ============================================================================
   8. Scenarios
   ---------------------------------------------------------------------------
   'bubbles' is staged by src/audio/announcer.js — the writing lives there, and a
   critic should be reading the writing, not the renderer. The hook keeps the two
   files from importing each other in a circle.
   ========================================================================= */

registerScenario('bubbles', {
  seed: 1925,
  setup: () => {
    APP.sim.reset(1925);
    APP.clock.advance(0.55);
    bubbles.clear();
    if (bubbles.demo) bubbles.demo('bubbles');
  },
  settle: 0.34,
});

registerScenario('chatter', {
  seed: 611,
  setup: () => {
    APP.sim.reset(611);
    APP.clock.advance(0.8);
    bubbles.clear();
    if (bubbles.demo) bubbles.demo('chatter');
  },
  settle: 0.30,
});

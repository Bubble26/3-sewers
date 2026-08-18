/**
 * teamselect.js — CHOOSIN' UP SIDES.
 * ============================================================================
 * Nobody on this block was ever handed a roster. Two captains stood in the road
 * and called names out loud in front of everybody, best hitter first, and the
 * last kid picked was somebody's little brother (PERIOD-REFERENCE §1.8). That is
 * the screen: the pool of kids laid out as cigarette cards on the flags, two
 * chalked columns for the two sides, a pointing hand, and an argument.
 *
 * The whole thing is drawn on the shared 2D surface from chars/portraits.js and
 * lettered in CURB CHALK from world/props.js. No DOM widgets, no system font, no
 * fetch. Keyboard, mouse and touch all drive the same cursor.
 *
 * Comedy is load-bearing here, per DESIGN-BIBLE §8: the four ingredients are
 * property (whose stick, whose ball), authority evaded (the cop's daughter), the
 * argument (which has a setup, a beat and a loser), and the little brother who
 * comes with the stick. Every gag has a setup frame and a payoff frame and the
 * seconds between them are in BEAT below.
 */
import { registerSystem, app } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { RNG } from '../core/rng.js';
import { bus } from '../core/bus.js';
import {
  CHALK, INK, PAVEMENT, FACADE, ACCENTS, CLOTH, AIR, soot,
} from '../render/palette.js';
import { mix, inkOf, hexCSS, LEATHER } from '../chars/wardrobe.js';
import { chalkStroke } from '../world/props.js';
import {
  screen, cardCanvas, bustCanvas, cardShadow, pavement, slab, chalk, slabW, wrap, say,
  fitSlab, fitChalk, chalkHead,
} from '../chars/portraits.js';
import { ROSTER, getKid, POOL, CAPTAINS, pickValue, STAT_KEYS } from '../chars/roster.js';

const C = (h) => hexCSS(h);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const back = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2);

/* Design space. Everything below is authored at 1600x900 and letterboxed. */
const DW = 1600, DH = 900;

/* Beat lengths, in seconds. A gag needs a setup frame and a payoff frame (§8.2). */
const BEAT = { consider: 0.95, call: 1.05, answer: 1.30, settle: 0.80, aside: 1.25 };

/* The pool's seating plan. Fixed for the whole draft, so kids never shuffle and a
   picked kid leaves a visible hole in the row he was standing in. */
const SEATS = [
  'filomena', 'ethel', 'eugene', 'tommy', 'rose',
  'stash', 'ling', 'otto', 'bessie', 'jesus',
  'irving', 'luz', 'maureen', 'dom',
];

/* ============================================================================
   The argument
   ========================================================================= */

const CALLS = [
  ['{N}.', 'I\'ll take {N}.', '{N}. C\'mere.', 'Gimme {N}.', '{N}, you\'re with me.'],
  ['{N}.', 'I\'ll have {N}.', '{N}, get over here.', 'I\'m takin\' {N}.', '{N}. Obviously.'],
];
const GRUMBLES = [
  'Aw, nuts.', 'Sez who!', 'Applesauce.', 'Banana oil!', 'I was gonna take him.',
  'Ah, ya bum.', 'Fine. FINE.', 'No fair!', 'Chase yourself.', 'Some captain.',
];

/** Written exchanges. Setup, beat, loser. Keyed by who is being called. */
const SCENES = {
  filomena: [['*', '...I was gonna say Fanny.'], ['*', 'You always get Fanny.']],
  luz: [['both', 'WHICH ONE!'], ['pick', 'The big one.']],
  ling: [['both', 'WHICH ONE!'], ['pick', 'The little one.']],
  tommy: [['*', "He can't hit nothin'."], ['pick', "He don't have to."]],
  maureen: [['*', "Her father's on the beat."], ['pick', "That's why."]],
  stash: [['*', "He's gotta go in at four."], ['pick', "It's ten after three."]],
  eugene: [['*', 'The bird comes too.'], ['pick', "The bird's better'n you."]],
  irving: [['*', "He can't catch."], ['pick', "He don't have to. He's got the arm."]],
  otto: [['*', 'Take the hat off him first.'], ['pick', 'It IS off him.']],
  bessie: [['*', "She'll argue for you."], ['pick', "She'll argue for herself."]],
  jesus: [['*', "He ain't got shoes."], ['pick', "He don't need 'em."]],
  ethel: [['*', 'She was slow when we named her.'], ['pick', "She ain't now."]],
  rose: [['*', 'She plays the piano.'], ['pick', 'With her WRISTS.']],
  dom: [['*', 'Do I gotta!'], ['pick', 'He comes with the stick.']],
};

/* ============================================================================
   The draft
   ========================================================================= */

function buildOrder(seed) {
  const r = new RNG(seed);
  const left = POOL.slice();
  const picks = [];
  let turn = 1;                       // Legs won the stick, hand over hand, and picks first
  while (left.length) {
    if (left.length === 1) { picks.push({ c: turn, id: left[0] }); break; }
    const bias = turn === 0 ? { power: 1.5, arm: 0.9 } : { speed: 1.4, fielding: 0.8 };
    let best = null, bv = -Infinity;
    for (const id of left) {
      if (id === 'dom') continue;     // nobody picks Junior until there is nobody else
      const k = getKid(id);
      let v = pickValue(k);
      for (const key in bias) v += k.stats[key] * bias[key];
      v += r.range(-0.7, 0.7);
      if (v > bv) { bv = v; best = id; }
    }
    if (!best) best = left[0];
    picks.push({ c: turn, id: best });
    left.splice(left.indexOf(best), 1);
    turn = 1 - turn;
  }
  return picks;
}

class Draft {
  constructor() { this.reset(1925); }

  reset(seed = 1925) {
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed ^ 0x9e37);
    this.picks = buildOrder(this.seed);
    this.i = 0;
    this.phase = 'consider';
    this.t = 0;
    this.teams = [[], []];
    this.taken = new Set();
    this.revealed = new Set();
    this.lines = [];             // the exchange currently in the ribbon
    this.scene = 0;              // which extra line of the scene has landed
    this.hover = this.current();
    this.cursor = { x: 0, y: 0, set: false };
    this.human = false;          // becomes true the moment somebody touches a control
    this.wait = 0;
    this.done = false;
    this.lastPicked = null;
    this.flash = 0;
    this.moods = new Map();
    this.pushLine();
  }

  current() { return this.picks[this.i] ? this.picks[this.i].id : null; }
  captain() { return this.picks[this.i] ? this.picks[this.i].c : 0; }
  seatIndex(id) { return SEATS.indexOf(id); }
  available() { return SEATS.filter((id) => !this.taken.has(id)); }

  /** The captain's own call, plus whatever the scene adds. */
  pushLine() {
    const id = this.current();
    if (!id) { this.lines = [{ who: 2, text: "That's everybody. PLAY BALL." }]; return; }
    const c = this.captain();
    const kid = getKid(id);
    const bank = CALLS[c];
    const call = bank[this.rng.int(0, bank.length - 1)].replace('{N}', kid.nick);
    this.lines = [{ who: c, text: call }];
    this.scene = 0;
  }

  advanceScene() {
    const id = this.current();
    if (!id) return;
    const sc = SCENES[id];
    if (!sc || this.scene >= sc.length) {
      if (this.scene === 0) {
        this.lines.push({ who: 1 - this.captain(), text: GRUMBLES[this.rng.int(0, GRUMBLES.length - 1)] });
        this.scene = 1;
      }
      return;
    }
    const [who, text] = sc[this.scene];
    const c = this.captain();
    this.lines.push({ who: who === 'pick' ? c : who === 'both' ? 3 : 1 - c, text });
    this.scene++;
  }

  /** Take the kid under the cursor instead of the one the captain would have taken. */
  choose(id) {
    if (!id || this.taken.has(id)) return false;
    if (this.phase !== 'consider') return false;
    this.picks[this.i] = { c: this.captain(), id };
    // whoever the captain would have taken next slides down the board
    const rest = this.picks.slice(this.i + 1).filter((p) => p.id !== id);
    const missing = SEATS.filter((s) => !this.taken.has(s) && s !== id && !rest.some((p) => p.id === s));
    for (const m of missing) rest.push({ c: 0, id: m });
    // nobody picks Junior until there is nobody else, no matter who is picking
    const junior = rest.findIndex((p) => p.id === 'dom');
    if (junior >= 0 && junior !== rest.length - 1) rest.push(...rest.splice(junior, 1));
    let turn = this.captain();
    for (const p of rest) { turn = 1 - turn; p.c = turn; }
    this.picks.length = this.i + 1;
    this.picks.push(...rest);
    this.pushLine();
    this.phase = 'call'; this.t = 0;
    return true;
  }

  commit() {
    const p = this.picks[this.i];
    if (!p) return;
    this.teams[p.c].push(p.id);
    this.taken.add(p.id);
    this.revealed.add(p.id);
    this.lastPicked = p.id;
    bus.emit('roster:picked', { id: p.id, team: p.c, order: this.i });
    this.i++;
    if (this.i >= this.picks.length) { this.done = true; this.lines = [{ who: 2, text: "That's everybody. PLAY BALL." }]; return; }
    this.pushLine();
  }

  update(dt) {
    if (this.done) { this.t += dt; return; }
    this.flash = Math.max(0, this.flash - dt);
    this.t += dt;
    const humanTurn = this.human && this.captain() === 0;
    switch (this.phase) {
      case 'consider':
        if (humanTurn) {
          this.wait += dt;
          if (this.wait < 11) return;      // he can take his time, but not all afternoon
          this.wait = 0;
        }
        if (this.t >= BEAT.consider) { this.t = 0; this.phase = 'call'; }
        break;
      case 'call':
        if (this.t >= BEAT.call) { this.t = 0; this.phase = 'answer'; this.advanceScene(); this.flash = 0.5; }
        break;
      case 'answer':
        if (this.t >= BEAT.answer) { this.t = 0; this.phase = 'settle'; this.advanceScene(); }
        break;
      case 'settle':
        if (this.t >= BEAT.settle) { this.t = 0; this.phase = 'consider'; this.wait = 0; this.commit(); }
        break;
      default: break;
    }
  }

  /** Deterministic jump, so a screenshot lands on a chosen frame every single time. */
  seek(pickIndex, phase = 'call', frac = 0.7) {
    this.reset(this.seed);
    while (this.i < pickIndex && !this.done) this.commit();
    this.phase = phase;
    this.t = BEAT[phase] * frac;
    if (phase === 'answer' || phase === 'settle') this.advanceScene();
    if (phase === 'settle') this.advanceScene();
    this.hover = this.current();
  }

  /** How a kid feels about all this, right now. */
  moodOf(id) {
    const cur = this.current();
    if (this.taken.has(id)) return 'grin';
    if (id === cur) {
      if (this.phase === 'consider') return 'hopeful';
      if (this.phase === 'call') return 'shock';
      return getKid(id).sex === 'g' ? 'smug' : 'yell';
    }
    if (id === 'dom') return this.i > 6 ? 'disappointed' : 'hopeful';
    const seat = this.seatIndex(id);
    const late = this.i - (SEATS.length - this.available().length);
    void late;
    if (this.available().length <= 4) return 'disappointed';
    return (seat + this.i) % 4 === 0 ? 'hopeful' : (getKid(id).art.ex || 'neutral');
  }
}

export const draft = new Draft();

/* ============================================================================
   Layout — authored at 1600x900, letterboxed to whatever the window is
   ========================================================================= */

const L = {
  header: { x: 0, y: 8, w: DW, h: 88 },
  colL: { x: 22, y: 104, w: 268, h: 764 },
  colR: { x: DW - 22 - 268, y: 104, w: 268, h: 764 },
  focus: { x: 322, y: 108, w: 240, h: 440 },
  notes: { x: 306, y: 560, w: 278, h: 206 },
  pool: { x: 606, y: 108, w: 690, cols: 5, rows: 3, gx: 12, gy: 13 },
  ribbon: { x: 600, y: 772, w: 700, h: 104 },
  hint: { x: 300, y: 858, w: 1000, h: 30 },
};
const CHIP = {
  w: (L.pool.w - L.pool.gx * (L.pool.cols - 1)) / L.pool.cols,
  h: Math.round((L.pool.w - L.pool.gx * (L.pool.cols - 1)) / L.pool.cols / 0.62),
};
L.pool.h = CHIP.h * L.pool.rows + L.pool.gy * (L.pool.rows - 1);

function seatBox(i) {
  const col = i % L.pool.cols, row = Math.floor(i / L.pool.cols);
  return {
    x: L.pool.x + col * (CHIP.w + L.pool.gx),
    y: L.pool.y + row * (CHIP.h + L.pool.gy),
    w: CHIP.w, h: CHIP.h,
  };
}
function slotBox(team, n) {
  const col = team === 0 ? L.colL : L.colR;
  const top = col.y + 108;
  const h = 84;
  return { x: col.x + 8, y: top + n * h, w: col.w - 16, h: h - 8 };
}

/* ============================================================================
   Ornaments
   ========================================================================= */

/** The pointing hand of every 1925 handbill. Our cursor, and it is not an arrow. */
function manicule(g, x, y, s, angle = 0) {
  g.save();
  g.translate(x, y); g.rotate(angle);
  const u = s / 100;
  const skinCol = C(mix(CLOTH[0], CHALK, 0.30));
  const ink = C(INK);
  g.lineJoin = 'round'; g.lineCap = 'round';

  // cuff — a wool sleeve, because the hand belongs to somebody
  g.fillStyle = C(mix(ACCENTS.indigo, INK, 0.30));
  g.strokeStyle = ink; g.lineWidth = 4.5 * u;
  g.beginPath();
  g.moveTo(-96 * u, -30 * u); g.lineTo(-52 * u, -26 * u);
  g.lineTo(-52 * u, 30 * u); g.lineTo(-96 * u, 34 * u); g.closePath();
  g.fill(); g.stroke();

  // fist
  g.fillStyle = skinCol;
  g.beginPath();
  g.moveTo(-56 * u, -28 * u);
  g.bezierCurveTo(-18 * u, -36 * u, 6 * u, -30 * u, 8 * u, -14 * u);
  g.lineTo(8 * u, 20 * u);
  g.bezierCurveTo(6 * u, 34 * u, -20 * u, 38 * u, -56 * u, 32 * u);
  g.closePath();
  g.fill(); g.stroke();

  // the pointing finger
  g.beginPath();
  g.moveTo(-8 * u, -22 * u);
  g.lineTo(58 * u, -20 * u);
  g.bezierCurveTo(76 * u, -20 * u, 76 * u, -2 * u, 58 * u, -2 * u);
  g.lineTo(-8 * u, 0);
  g.closePath();
  g.fill(); g.stroke();

  // thumb, tucked over the top
  g.beginPath();
  g.moveTo(-34 * u, -24 * u);
  g.bezierCurveTo(-24 * u, -44 * u, 4 * u, -44 * u, 10 * u, -26 * u);
  g.bezierCurveTo(2 * u, -18 * u, -22 * u, -16 * u, -34 * u, -24 * u);
  g.closePath();
  g.fill(); g.stroke();

  // knuckle creases: two short strokes, the engraver's whole vocabulary
  g.lineWidth = 3 * u;
  for (const k of [4, 18]) {
    g.beginPath();
    g.moveTo(-42 * u + k * u, 10 * u); g.lineTo(-30 * u + k * u, 12 * u);
    g.stroke();
  }
  g.restore();
}

/**
 * A striped canvas awning valance. Every ground-floor shop on the block had one
 * (PERIOD §2.6) and they are where a brown street keeps its chroma (Law 4).
 */
function awning(g, x, y, w, h) {
  const a = ACCENTS.red, b = mix(CLOTH[0], CHALK, 0.25);
  const stripe = w / 46;
  g.save();
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h * 0.62);
  for (let i = 46; i >= 0; i--) {
    const sx = x + i * stripe;
    g.quadraticCurveTo(sx + stripe * 0.5, y + h * 1.06, sx, y + h * 0.62);
  }
  g.closePath();
  g.save(); g.clip();
  for (let i = 0; i <= 46; i++) {
    g.fillStyle = C(i % 2 ? a : b);
    g.fillRect(x + i * stripe, y - 2, stripe + 1, h * 1.2);
  }
  // the awning is above the play plane, so it is the sooted end of the value ramp
  const gr = g.createLinearGradient(0, y, 0, y + h * 1.1);
  gr.addColorStop(0, 'rgba(42,29,26,0.42)');
  gr.addColorStop(1, 'rgba(42,29,26,0.04)');
  g.fillStyle = gr; g.fillRect(x, y - 2, w, h * 1.2);
  g.restore();
  g.strokeStyle = C(INK); g.lineWidth = 2.2; g.stroke();
  g.restore();
}

/** A torn scrap with a line on it. Text always sits on a physical ground (§6.4). */
function scrap(g, x, y, w, h, seed, tint) {
  const r = new RNG(seed);
  g.save();
  g.beginPath();
  const n = 18;
  g.moveTo(x, y);
  for (let i = 0; i <= n; i++) g.lineTo(x + (w * i) / n, y + r.range(-h * 0.028, h * 0.028));
  g.lineTo(x + w, y + h);
  for (let i = n; i >= 0; i--) g.lineTo(x + (w * i) / n, y + h + r.range(-h * 0.03, h * 0.03));
  g.closePath();
  g.fillStyle = C(tint || mix(CLOTH[0], CHALK, 0.30));
  g.fill();
  g.strokeStyle = C(mix(INK, CLOTH[0], 0.6)); g.lineWidth = 1.1; g.stroke();
  g.restore();
}

/** A speech balloon in the period's own idiom: chalk on the wall, not a UI bubble. */
function shout(g, x, y, text, size, o = {}) {
  const t = say(text);
  const w = slabW(t, size, { tracking: 0.12, condense: 0.86 }) + size * 1.2;
  const h = size * 2.0;
  const col = o.color || CHALK;
  g.save();
  g.globalAlpha = o.alpha ?? 1;
  const bx = x - w / 2, by = y - h;
  g.beginPath();
  g.moveTo(bx, by + h * 0.5);
  g.lineTo(bx + w * 0.06, by);
  g.lineTo(bx + w * 0.94, by + h * 0.06);
  g.lineTo(bx + w, by + h * 0.62);
  g.lineTo(bx + w * 0.56, by + h * 0.94);
  g.lineTo(bx + w * 0.5, by + h * 1.34);
  g.lineTo(bx + w * 0.38, by + h * 0.96);
  g.lineTo(bx + w * 0.05, by + h * 0.9);
  g.closePath();
  g.fillStyle = C(o.ground || mix(INK, FACADE.brickShade, 0.45));
  g.fill();
  g.strokeStyle = C(col); g.lineWidth = 1.6; g.globalAlpha = (o.alpha ?? 1) * 0.7; g.stroke();
  g.globalAlpha = o.alpha ?? 1;
  chalk(g, t, x, by + h * 0.66, size, {
    align: 'center', color: C(col), tracking: 0.12, condense: 0.86, weight: 0.15,
    seed: o.seed || 5, alpha: 0.98,
  });
  g.restore();
}

/* ============================================================================
   The painter
   ========================================================================= */

function paintSelect(g, W, H) {
  const S = Math.min(W / DW, H / DH);
  const ox = (W - DW * S) / 2, oy = (H - DH * S) / 2;

  // sidewalk, roadway, sidewalk: the picking happens in the road, and the two sides
  // get chalked on the flags where they always were (PERIOD §3.1)
  pavement(g, W, H, 19, { potsy: false });
  // each captain's half of the road, washed in his own colour of chalk. Law 4: no
  // 128px of a frame may be all low-saturation, and a brown street cannot pay that
  // bill on its own.
  for (const [side, id] of [[0, CAPTAINS[0]], [1, CAPTAINS[1]]]) {
    const acc = ACCENTS[getKid(id).art.accent];
    const x0 = side === 0 ? 0 : ox + 1298 * S;
    const w0 = side === 0 ? ox + 302 * S : W - (ox + 1298 * S);
    g.save();
    g.globalAlpha = 0.22;
    const wash = g.createLinearGradient(side === 0 ? 0 : x0 + w0, 0, side === 0 ? x0 + w0 : x0, 0);
    wash.addColorStop(0, C(acc));
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = wash; g.fillRect(x0, 0, w0, H);
    g.restore();
    chalkStroke(g, [[side === 0 ? x0 + w0 - 4 : x0 + 4, 0], [side === 0 ? x0 + w0 - 4 : x0 + 4, H]], 3.4, 500 + side, 0.40, C(CHALK));
  }
  // the crown of the road, brightest ground in the frame
  g.save();
  const cg = g.createLinearGradient(ox + 300 * S, 0, ox + 1300 * S, 0);
  cg.addColorStop(0, 'rgba(0,0,0,0)');
  cg.addColorStop(0.5, C(PAVEMENT.blockCrown));
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.20; g.fillStyle = cg;
  g.fillRect(ox + 300 * S, 0, 1000 * S, H);
  g.restore();

  g.save();
  g.translate(ox, oy); g.scale(S, S);
  paintContent(g);
  g.restore();
}

function paintContent(g) {
  const d = draft;
  const t = app.time || 0;

  /* ---- header ------------------------------------------------------------ */
  const hd = L.header;
  awning(g, 0, -6, DW, 46);
  scrap(g, DW * 0.30, hd.y, DW * 0.40, hd.h * 0.94, 3);
  for (const s of [0, 1]) {
    g.save();
    g.translate(DW * 0.30 + s * DW * 0.40, hd.y + hd.h * 0.40);
    g.rotate(s ? -0.20 : 0.20);
    g.globalAlpha = 0.66;
    g.fillStyle = C(mix(ACCENTS.mustard, CLOTH[0], 0.42));
    g.fillRect(-26, -22, 52, 44);
    g.restore();
  }
  fitSlab(g, "CHOOSIN' UP SIDES", DW / 2, hd.y + hd.h * 0.58, 42, DW * 0.36, {
    color: C(mix(FACADE.brickShade, INK, 0.30)), tracking: 0.12, condense: 0.90,
    weight: 0.20, serif: 7, jitter: 1.2, seed: 11,
    shadow: { dx: 2.4, dy: 2.8, color: C(mix(ACCENTS.red, INK, 0.5)) },
  });
  fitChalk(g, 'MULBERRY ST. · HALF PAST THREE · LOSER FIELDS FIRST', DW / 2, hd.y + hd.h * 0.70, 15, DW * 0.28, {
    color: C(mix(FACADE.brickShade, INK, 0.42)), tracking: 0.16, condense: 0.84, weight: 0.13, seed: 12, alpha: 0.95,
  });
  // somebody's chalk, from this morning, which nobody has rubbed out
  g.save();
  g.globalAlpha = 0.30;
  g.translate(DW * 0.093, DH * 0.945); g.rotate(-0.05);
  chalk(g, 'SOCKS IS A BUM', 0, 0, 22, { align: 'center', color: C(CHALK), tracking: 0.14, condense: 0.82, weight: 0.15, seed: 401, alpha: 0.9 });
  chalkStroke(g, [[-92, -8], [92, -12]], 3, 402, 0.9, C(CHALK));
  g.restore();

  /* ---- the two columns --------------------------------------------------- */
  paintColumn(g, 0);
  paintColumn(g, 1);

  /* ---- the pool ---------------------------------------------------------- */
  const cur = d.current();
  const focusId = (d.hover && !d.taken.has(d.hover) ? d.hover : cur) || d.lastPicked;
  for (let i = 0; i < SEATS.length; i++) {
    const id = SEATS[i];
    if (d.taken.has(id) && !(d.picks[d.i] && d.picks[d.i].id === id)) { paintGone(g, id, i); continue; }
    paintChip(g, id, i, t);
  }
  // the empty seat: one deliberate dead spot, and a joke about who else might turn up
  {
    const b = seatBox(SEATS.length);
    g.save();
    g.setLineDash([7, 7]);
    g.strokeStyle = C(mix(CHALK, PAVEMENT.sidewalk, 0.35)); g.lineWidth = 2; g.globalAlpha = 0.55;
    g.strokeRect(b.x, b.y, b.w, b.h);
    g.restore();
    for (const [k, line] of [[0, 'AND'], [1, 'WHOEVER'], [2, 'ELSE'], [3, 'SHOWS UP']]) {
      chalk(g, line, b.x + b.w / 2, b.y + b.h * 0.36 + k * 22, 16, {
        align: 'center', color: C(CHALK), tracking: 0.16, condense: 0.82, weight: 0.13, seed: 40 + k, alpha: 0.62,
      });
    }
  }

  /* ---- the kid on the clock, big ---------------------------------------- */
  if (focusId) {
    const f = L.focus;
    g.save();
    g.translate(f.x + f.w / 2, f.y + f.h / 2);
    g.rotate(-0.014);
    g.translate(-f.w / 2, -f.h / 2);
    cardShadow(g, 0, 0, f.w, f.h, 1.5);
    g.drawImage(cardCanvas(focusId, Math.round(f.w), Math.round(f.h), { detail: 'full', mood: d.moodOf(focusId) }), 0, 0);
    g.restore();
    if (d.done && focusId === d.lastPicked) {
      g.save();
      g.translate(f.x + f.w / 2, f.y + f.h + 30);
      g.rotate(-0.03);
      fitChalk(g, 'LAST PICKED. AS USUAL.', 0, 0, 24, f.w * 1.06, {
        color: C(mix(CHALK, ACCENTS.mustard, 0.35)), tracking: 0.13, condense: 0.82, weight: 0.15, seed: 610, alpha: 1,
      });
      g.restore();
    }
    paintNotes(g, focusId, d.done ? 46 : 0);
  }

  /* ---- the ribbon: the argument ------------------------------------------ */
  paintRibbon(g);

  /* ---- the curb: how you work it ---------------------------------------- */
  const hint = L.hint;
  fitChalk(g, "ARROWS: LOOK 'EM OVER · ENTER OR TAP: CALL HIS NAME · HE DON'T GET A SAY",
    DW / 2, hint.y + 22, 20, 990, {
      color: C(CHALK), tracking: 0.15, condense: 0.84, weight: 0.15, seed: 56, alpha: 1,
    });

  /* ---- the pointing hand ------------------------------------------------- */
  if (cur && !d.done) {
    const i = d.seatIndex(cur);
    const b = seatBox(i);
    const lift = d.phase === 'consider' ? 0 : 1;
    const px = b.x - 46 + Math.sin(t * 6) * 4;
    const py = b.y + b.h * 0.46;
    g.save();
    g.globalAlpha = d.phase === 'settle' ? 0.35 : 1;
    manicule(g, px, py, 76 + lift * 8, 0.04);
    g.restore();
    // the chalk ring the caller scuffs round his man
    if (d.phase !== 'consider') {
      const k = ease(clamp(d.t / 0.35, 0, 1));
      g.save();
      g.globalAlpha = 0.9 * (d.phase === 'settle' ? 1 - ease(d.t / BEAT.settle) : 1);
      const pts = [];
      for (let a = 0; a <= 34; a++) {
        const ang = (a / 34) * TAU * k - 0.6;
        pts.push([
          b.x + b.w / 2 + Math.cos(ang) * b.w * 0.66,
          b.y + b.h / 2 + Math.sin(ang) * b.h * 0.56,
        ]);
      }
      if (pts.length > 2) chalkStroke(g, pts, 4.5, 61, 0.9, C(CHALK));
      g.restore();
    }
  }
}

function paintColumn(g, team) {
  const d = draft;
  const col = team === 0 ? L.colL : L.colR;
  const capId = CAPTAINS[team];
  const cap = getKid(capId);
  const accent = ACCENTS[cap.art.accent];

  // the chalked column, ruled straight onto the flags
  g.save();
  g.globalAlpha = 0.9;
  chalkStroke(g, [[col.x, col.y + 96], [col.x + col.w, col.y + 96]], 3, 80 + team, 0.85, C(CHALK));
  chalkStroke(g, [[col.x + 2, col.y + 100], [col.x + 2, col.y + col.h - 12]], 2.4, 90 + team, 0.6, C(CHALK));
  g.restore();

  // captain's plate
  const ph = 84;
  g.save();
  g.fillStyle = C(accent);
  g.fillRect(col.x, col.y, col.w, ph);
  g.globalAlpha = 0.22; g.fillStyle = C(mix(accent, ACCENTS.red, 0.6));
  g.fillRect(col.x - 2, col.y - 2, col.w, ph);
  g.globalAlpha = 1;
  g.strokeStyle = C(inkOf(accent)); g.lineWidth = 2.4;
  g.strokeRect(col.x, col.y, col.w, ph);
  g.restore();
  const bust = bustCanvas(capId, 78, { mood: d.captain() === team && !d.done ? 'determined' : 'grin' });
  g.drawImage(bust, col.x + 6, col.y + 4, 74, 74);
  slab(g, cap.nick, col.x + 92, col.y + 40, 30, {
    color: C(mix(CHALK, CLOTH[0], 0.1)), tracking: 0.10, condense: 0.86, weight: 0.20, serif: 5,
    jitter: 1, seed: 100 + team, shadow: { dx: 1.8, dy: 2, color: C(inkOf(accent)) },
  });
  chalk(g, cap.owns === 'ball' ? 'OWNS THE BALL' : 'OWNS THE STICK', col.x + 92, col.y + 64, 15, {
    color: C(mix(CHALK, CLOTH[0], 0.2)), tracking: 0.14, condense: 0.82, weight: 0.14, seed: 110 + team, alpha: 0.95,
  });

  // Socks wrote a name down before he lost the stick. He has not rubbed it out.
  if (team === 0) {
    const y0 = col.y + 100;
    g.save();
    g.globalAlpha = 0.55;
    chalk(g, '1. FANNY', col.x + 22, y0 + 22, 21, {
      color: C(CHALK), tracking: 0.12, condense: 0.84, weight: 0.15, seed: 121, alpha: 0.8,
    });
    chalkStroke(g, [[col.x + 16, y0 + 16], [col.x + 150, y0 + 12]], 3.4, 122, 0.85, C(CHALK));
    chalkStroke(g, [[col.x + 18, y0 + 8], [col.x + 148, y0 + 20]], 2.6, 123, 0.7, C(CHALK));
    g.restore();
  }

  const startN = team === 0 ? 0.42 : 0;
  for (let n = 0; n < 7; n++) {
    const b = slotBox(team, n + startN);
    const id = d.teams[team][n];
    // the numbered rule for a slot nobody is standing in yet
    chalk(g, `${n + 1}.`, b.x + 4, b.y + b.h * 0.66, 19, {
      color: C(CHALK), tracking: 0.1, condense: 0.8, weight: 0.14, seed: 130 + n + team * 9, alpha: id ? 0.9 : 0.42,
    });
    chalkStroke(g, [[b.x + 34, b.y + b.h * 0.80], [b.x + b.w - 6, b.y + b.h * 0.80]], 2, 140 + n + team * 9, id ? 0.25 : 0.42, C(CHALK));
    if (!id) continue;
    const kid = getKid(id);
    // arriving: the chip flies out of the pool and lands in the column
    let ax = b.x + 36, ay = b.y + 2, sc = 1, al = 1;
    const isLast = d.teams[team].length - 1 === n && d.phase === 'consider' && d.t < 0.42 && d.i > 0;
    if (isLast) {
      const k = ease(d.t / 0.42);
      const from = seatBox(d.seatIndex(id));
      ax = from.x + (ax - from.x) * k;
      ay = from.y + (ay - from.y) * k;
      sc = 1 + (1 - k) * 1.1;
      al = 0.6 + 0.4 * k;
    }
    g.save();
    g.globalAlpha = al;
    const bw = 60 * sc;
    g.drawImage(bustCanvas(id, 64, { mood: 'grin' }), ax, ay - (sc - 1) * 20, bw, bw);
    slab(g, kid.nick, ax + bw + 8, b.y + b.h * 0.60, 21, {
      color: C(mix(INK, PAVEMENT.sidewalk, 0.10)), tracking: 0.10, condense: 0.80, weight: 0.18, serif: 3.4,
      jitter: 0.8, seed: 150 + n + team * 9,
    });
    if (kid.tag) {
      chalk(g, kid.tag, ax + bw + 8, b.y + b.h * 0.80, 12, {
        color: C(CHALK), tracking: 0.13, condense: 0.8, weight: 0.13, seed: 160 + n, alpha: 0.8,
      });
    }
    g.restore();
  }
}

/** Where a kid was standing before he got called. Chalked, and struck through. */
function paintGone(g, id, i) {
  const b = seatBox(i);
  const kid = getKid(id);
  const team = draft.teams[0].includes(id) ? 0 : 1;
  const accent = ACCENTS[getKid(CAPTAINS[team]).art.accent];
  g.save();
  g.globalAlpha = 0.40;
  chalkStroke(g, [
    [b.x + 5, b.y + 5], [b.x + b.w - 5, b.y + 7], [b.x + b.w - 7, b.y + b.h - 5], [b.x + 7, b.y + b.h - 7], [b.x + 5, b.y + 5],
  ], 2.4, 300 + i, 0.8, C(CHALK));
  g.restore();
  // the kid himself, in chalk, because a hole in the line-up should still be somebody
  chalkHead(g, kid, b.x + b.w * 0.5, b.y + b.h * 0.365, b.h * 0.30, { seed: 12 + i, alpha: 0.58 });
  g.save();
  chalk(g, kid.nick, b.x + b.w / 2, b.y + b.h * 0.80, 20, {
    align: 'center', color: C(CHALK), tracking: 0.10, condense: 0.80, weight: 0.15, seed: 320 + i, alpha: 0.78,
  });
  chalkStroke(g, [[b.x + 14, b.y + b.h * 0.755], [b.x + b.w - 14, b.y + b.h * 0.735]], 3.2, 340 + i, 0.85, C(CHALK));
  chalk(g, team === 0 ? 'SOCKS' : 'LEGS', b.x + b.w / 2, b.y + b.h * 0.94, 14, {
    align: 'center', color: C(mix(accent, CHALK, 0.5)), tracking: 0.14, condense: 0.8, weight: 0.14, seed: 360 + i, alpha: 0.95,
  });
  g.restore();
}

function paintChip(g, id, i, t) {
  const d = draft;
  const b = seatBox(i);
  const cur = d.current();
  const isCur = id === cur;
  const isHover = id === d.hover;
  const mood = d.moodOf(id);

  let dx = 0, dy = 0, rot = ((i * 37) % 11 - 5) * 0.0042, sc = 1, al = 1;
  // a kid who wants it stands up straighter
  if (mood === 'hopeful') dy -= 4 + Math.sin(t * 3.1 + i) * 2.2;
  if (mood === 'disappointed') { rot += 0.055; dy += 3; }
  if (isHover) dy -= 5;
  if (isCur) {
    if (d.phase === 'call') { dy -= 6 * ease(d.t / BEAT.call); sc = 1 + 0.05 * ease(d.t / BEAT.call); }
    if (d.phase === 'answer') { sc = 1.06; dy -= 8 + Math.sin(t * 22) * 1.6; }
    if (d.phase === 'settle') {
      const k = ease(d.t / BEAT.settle);
      const to = slotBox(d.captain(), d.teams[d.captain()].length + (d.captain() === 0 ? 0.42 : 0));
      dx = (to.x + 36 - b.x) * k; dy = (to.y - b.y) * k - 26 * Math.sin(k * Math.PI);
      sc = 1 - 0.35 * k; al = 1 - 0.35 * k; rot += k * 0.22;
    }
  }

  g.save();
  g.globalAlpha = al;
  g.translate(b.x + b.w / 2 + dx, b.y + b.h / 2 + dy);
  g.rotate(rot);
  g.scale(sc, sc);
  g.translate(-b.w / 2, -b.h / 2);
  cardShadow(g, 0, 0, b.w, b.h, isCur || isHover ? 1.25 : 0.85);
  g.drawImage(cardCanvas(id, Math.round(b.w), Math.round(b.h), { detail: 'chip', mood }), 0, 0);
  g.restore();

  // what he yells when his name gets called
  if (isCur && (d.phase === 'answer' || d.phase === 'settle')) {
    const kid = getKid(id);
    const line = kid.say.picked || 'ATTABOY!';
    const k = clamp((d.phase === 'answer' ? d.t : BEAT.answer) / 0.28, 0, 1);
    g.save();
    g.globalAlpha = d.phase === 'settle' ? 1 - ease(d.t / BEAT.settle) : 1;
    g.translate(b.x + b.w * 0.5 + dx, b.y - 6 + dy);
    g.scale(back(k), back(k));
    shout(g, 0, 0, line, 17, { color: CHALK, ground: mix(INK, ACCENTS[kid.art.accent], 0.30), seed: i + 3 });
    g.restore();
  }
  // both Leftys answer, every time
  if (d.phase !== 'consider' && (cur === 'luz' || cur === 'ling')) {
    const other = cur === 'luz' ? 'ling' : 'luz';
    if (id === other && !d.taken.has(other)) {
      const k = clamp((d.phase === 'call' ? d.t : BEAT.call) / 0.3, 0, 1);
      g.save();
      g.globalAlpha = 0.96;
      g.translate(b.x + b.w * 0.5, b.y - 6);
      g.scale(back(k), back(k));
      shout(g, 0, 0, 'WHICH ONE!', 17, { color: CHALK, ground: mix(INK, ACCENTS.periwinkle, 0.3), seed: 9 });
      g.restore();
    }
  }
  // Junior is not picked, and Junior knows it
  if (id === 'dom' && !d.taken.has('dom') && d.i >= 9 && d.phase === 'consider' && cur !== 'dom') {
    g.save();
    g.globalAlpha = 0.9;
    shout(g, b.x + b.w * 0.5, b.y - 6, "I'M RIGHT HERE.", 15, {
      color: mix(CHALK, PAVEMENT.sidewalk, 0.2), ground: mix(INK, ACCENTS.mustard, 0.2), seed: 17,
    });
    g.restore();
  }
}

function paintNotes(g, id, dy = 0) {
  const kid = getKid(id);
  const n = { ...L.notes, y: L.notes.y + dy, h: L.notes.h - dy };
  const all = [
    ['AT THE PLATE', kid.stance.note],
    ['ON THE MOUND', kid.arm.quirk],
    ['SWEARS BY', kid.charm],
  ].map(([label, text]) => [label, wrap(text, 12.5, n.w - 30, { tracking: 0.08, condense: 0.74 }).slice(0, 3)]);

  // measure, keep only the rows that fit, then cut the slate to those rows: an
  // overflowing slate and a half-empty slate are the same bug wearing two hats
  const rows = [];
  let need = 22 + 42;                      // top padding + the hidden-trait footer
  for (const row of all) {
    const cost = 14 + row[1].length * 14 + 13;
    if (need + cost > n.h) break;
    rows.push(row); need += cost;
  }
  const H = Math.max(96, need);

  g.save();
  g.fillStyle = C(mix(PAVEMENT.asphaltShade, INK, 0.34));
  g.beginPath();
  g.moveTo(n.x, n.y + 4); g.lineTo(n.x + n.w, n.y); g.lineTo(n.x + n.w - 3, n.y + H);
  g.lineTo(n.x + 2, n.y + H - 4); g.closePath();
  g.fill();
  g.strokeStyle = C(mix(LEATHER[0], INK, 0.40)); g.lineWidth = 5; g.stroke();
  g.restore();

  let y = n.y + 22;
  for (const [label, lines] of rows) {
    chalk(g, label, n.x + 15, y, 13, {
      color: C(mix(CHALK, ACCENTS.mustard, 0.45)), tracking: 0.16, condense: 0.76, weight: 0.14, seed: 170 + y, alpha: 1,
    });
    for (const line of lines) {
      y += 14;
      chalk(g, line, n.x + 15, y, 12.5, {
        color: C(CHALK), tracking: 0.08, condense: 0.74, weight: 0.12, seed: 180 + line.length, alpha: 0.88,
      });
    }
    y += 13;
  }
  const known = draft.revealed.has(id);
  chalkStroke(g, [[n.x + 13, n.y + H - 32], [n.x + n.w - 13, n.y + H - 34]], 2, 191, 0.45, C(CHALK));
  fitChalk(g, known ? kid.secret.label : 'NOBODY KNOWS THIS YET', n.x + n.w / 2, n.y + H - 11, 16, n.w - 30, {
    color: C(known ? mix(CHALK, ACCENTS.mustard, 0.55) : CHALK), tracking: 0.14, condense: 0.80,
    weight: 0.14, seed: 190, alpha: known ? 1 : 0.5,
  });
}

function paintRibbon(g) {
  const d = draft;
  const r = L.ribbon;
  scrap(g, r.x, r.y, r.w, r.h, 7, mix(CLOTH[1], PAVEMENT.blockCrown, 0.18));
  const lines = d.lines.slice(-3);
  let y = r.y + (lines.length > 2 ? 30 : 40);
  const step = lines.length > 2 ? 30 : 36;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const who = ln.who === 3 ? 'BOTH LEFTYS' : ln.who === 2 ? '' : getKid(CAPTAINS[ln.who]).nick.toUpperCase();
    const accent = ln.who === 3 ? ACCENTS.periwinkle : ln.who === 2 ? ACCENTS.mustard : ACCENTS[getKid(CAPTAINS[ln.who]).art.accent];
    const fade = i === lines.length - 1 ? 1 : 0.55;
    g.save();
    g.globalAlpha = fade;
    if (who) {
      slab(g, `${who}:`, r.x + 20, y, 21, {
        color: C(mix(accent, INK, 0.22)), tracking: 0.10, condense: 0.78, weight: 0.20, serif: 3.4, jitter: 0.6, seed: 200 + i,
      });
    }
    const lx = r.x + 20 + (who ? slabW(`${who}:`, 21, { tracking: 0.1, condense: 0.78 }) + 14 : 0);
    const size = 25;
    let cond = 0.80;
    while (slabW(ln.text, size, { tracking: 0.09, condense: cond }) > r.w - (lx - r.x) - 24 && cond > 0.55) cond -= 0.03;
    slab(g, ln.text, lx, y, size, {
      color: C(mix(INK, CLOTH[0], 0.10)), tracking: 0.09, condense: cond, weight: 0.18, serif: 4,
      jitter: 0.8, seed: 210 + i + ln.text.length,
    });
    g.restore();
    y += step;
  }
}

/* ============================================================================
   Input — keyboard, mouse and touch all move the same hand
   ========================================================================= */

function moveCursor(dx, dy) {
  const d = draft;
  const avail = d.available();
  if (!avail.length) return;
  let i = d.seatIndex(d.hover);
  if (i < 0) i = d.seatIndex(avail[0]);
  const cols = L.pool.cols;
  for (let guard = 0; guard < 40; guard++) {
    i += dx + dy * cols;
    if (i < 0) i += SEATS.length + 1;
    if (i >= SEATS.length) i -= SEATS.length + 1;
    i = clamp(i, 0, SEATS.length - 1);
    if (!d.taken.has(SEATS[i])) break;
  }
  d.hover = SEATS[i];
  d.human = true;
  d.wait = 0;
}

function hit(x, y) {
  const S = Math.min(screen.w / DW, screen.h / DH);
  const ox = (screen.w - DW * S) / 2, oy = (screen.h - DH * S) / 2;
  const dx = (x - ox) / S, dy = (y - oy) / S;
  for (let i = 0; i < SEATS.length; i++) {
    if (draft.taken.has(SEATS[i])) continue;
    const b = seatBox(i);
    if (dx >= b.x && dx <= b.x + b.w && dy >= b.y && dy <= b.y + b.h) return SEATS[i];
  }
  return null;
}

function callIt() {
  const d = draft;
  d.human = true;
  if (d.done) return;
  if (d.phase !== 'consider') { d.t = Math.max(d.t, BEAT[d.phase] * 0.96); return; }
  if (d.captain() !== 0) { d.t = BEAT.consider; return; }     // it is not your turn, but do not stall
  d.choose(d.hover && !d.taken.has(d.hover) ? d.hover : d.current());
}

/* ============================================================================
   Registration
   ========================================================================= */

let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  const el = screen.el;
  if (!el) return;
  el.addEventListener('pointermove', (e) => {
    if (screen.name !== 'team_select') return;
    const id = hit(...screen.at(e));
    if (id) { draft.hover = id; draft.human = true; draft.wait = 0; }
  });
  el.addEventListener('pointerdown', (e) => {
    if (screen.name !== 'team_select') return;
    e.preventDefault();
    const id = hit(...screen.at(e));
    if (id) { draft.hover = id; draft.human = true; draft.wait = 0; }
    callIt();
  });
  // capture phase, so the screen eats the key before the batter swings at it
  globalThis.addEventListener('keydown', (e) => {
    if (screen.name !== 'team_select') return;
    const k = e.key;
    let used = true;
    if (k === 'ArrowLeft' || k === 'a') moveCursor(-1, 0);
    else if (k === 'ArrowRight' || k === 'd') moveCursor(1, 0);
    else if (k === 'ArrowUp' || k === 'w') moveCursor(0, -1);
    else if (k === 'ArrowDown' || k === 's') moveCursor(0, 1);
    else if (k === 'Enter' || k === ' ' || k === 'Spacebar') callIt();
    else if (k === 'Tab') { draft.advanceScene(); draft.human = true; }
    else used = false;
    if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
}

export default registerSystem({
  name: 'teamselect',
  order: 206,
  init() { screen.mount(); bind(); },
  update(dt) {
    if (screen.name !== 'team_select') return;
    draft.update(dt);
    if (!draft.human || draft.captain() !== 0) draft.hover = draft.current();
  },
  onInput(action) {
    if (screen.name !== 'team_select') return;
    if (action === 'pick' || action === 'swing') callIt();
    else if (action === 'left') moveCursor(-1, 0);
    else if (action === 'right') moveCursor(1, 0);
    else if (action === 'up') moveCursor(0, -1);
    else if (action === 'down') moveCursor(0, 1);
  },
});

registerScenario('team_select', {
  seed: 1925,
  setup: () => {
    draft.reset(1925);
    // Pick eight: Socks calls for Lefty, and both Leftys turn around. Setup frame
    // and payoff frame, 1.05 s apart (§8.2), and by now both columns have a side.
    const at = draft.picks.findIndex((p) => p.id === 'luz' || p.id === 'ling');
    draft.seek(at >= 0 ? at : 7, 'answer', 0.55);
    screen.open('team_select', paintSelect);
  },
  settle: 0.02,
});

export { paintSelect };

/**
 * portraits.js — sixteen cigarette cards, drawn in code, at load, with no network.
 * ============================================================================
 * A 1925 kid knew what a ballplayer looked like from a card that came out of a
 * cigarette pack: a flat colour ground, a hand-worked portrait dropped on it, a
 * name plate, and small type underneath. That is the illustration language here —
 * T206 by way of DESIGN-BIBLE §2, §4 and §6.
 *
 * Everything is a 2D canvas:
 *   - the head silhouette runs the SAME deform arithmetic as wardrobe.deformHead(),
 *     so a kid's card and the kid on the street are the same shape, not two guesses;
 *   - the bust framing is driven by the kid's silhouette FAMILY (§5.4) — a Melon's
 *     head really does eat the frame, a Beanpole really is all neck, a Fireplug has
 *     none — because if the sixteen busts are interchangeable the roster is not a
 *     roster, it is a colour swatch;
 *   - every colour comes from render/palette.js and chars/wardrobe.js, no hex literals;
 *   - every letter is drawn by the CURB CHALK skeleton in world/props.js — there is
 *     not one system font anywhere in this file (§6.2, §6.3);
 *   - ink outlines are inkOf(fill): a darkened saturated version of the colour they
 *     border, never grey (§4.2);
 *   - the shade band is coolShade() and the underside kick is bounceOf(), the same
 *     three-band ramp the rig bakes (§4.1).
 *
 * Exports the drawing kit AND `screen`, the one full-page 2D surface that both this
 * module's `portrait_sheet` scenario and ui/teamselect.js's `team_select` draw onto,
 * so the game never has two overlays fighting for the same pixels.
 */
import { registerSystem } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { RNG } from '../core/rng.js';
import {
  CHALK, INK, SKIN, CLOTH, ACCENTS, AIR, PAVEMENT, FACADE, BALL, soot,
} from '../render/palette.js';
import {
  FAMILIES, HAIR, LEATHER, mix, inkOf, coolShade, bounceOf, hexCSS,
} from './wardrobe.js';
import { slabText, chalkText, chalkStroke } from '../world/props.js';
import { ROSTER, getKid, STAT_KEYS, STAT_LABEL, MAX_STAT } from './roster.js';

/* ============================================================================
   0. Type — the glyph set CURB CHALK actually owns
   ========================================================================= */

/**
 * props.js draws A-Z 0-9 and a short list of marks. Anything else comes out as a
 * hole in the word, so every string in the game goes through here on its way to a
 * canvas. Curly quotes flatten, accents drop, and the two marks the face does not
 * own become the two it does.
 */
export function say(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\?/g, '!')
    .replace(/;/g, ',')
    .replace(/[^A-Za-z0-9 .,'\-:!/&()*·]/g, '')
    .toUpperCase();
}

const CAP_UNITS = 6, EM_UNITS = 10;   // props.js draws on a 6x10 box
/** Width of a CURB CHALK string, honouring condense (props.slabWidth does not). */
export function slabW(text, size, o = {}) {
  const t = say(text);
  const tracking = o.tracking ?? 0.16, condense = o.condense ?? 1;
  if (!t.length) return 0;
  return t.length * (CAP_UNITS * (size / EM_UNITS) * condense + tracking * size) - tracking * size;
}
/** Draw a sanitised CURB CHALK string. Thin wrapper so no caller forgets say(). */
export function slab(g, text, x, y, size, o = {}) { return slabText(g, say(text), x, y, size, o); }
export function chalk(g, text, x, y, size, o = {}) { return chalkText(g, say(text), x, y, size, o); }

/** Break a sentence to a pixel width. Returns lines already sanitised. */
export function wrap(text, size, maxW, o = {}) {
  const words = say(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (slabW(test, size, o) > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Shrink a string until it fits, by condensing first and only then by size. */
export function fitSlab(g, text, cx, baseline, size, maxW, o = {}) {
  let cond = o.condense ?? 1, s = size;
  const tr = o.tracking ?? 0.10;
  while (slabW(text, s, { tracking: tr, condense: cond }) > maxW && cond > 0.52) cond -= 0.03;
  const w = slabW(text, s, { tracking: tr, condense: cond });
  if (w > maxW) s *= maxW / w;
  return slab(g, text, cx, baseline, s, { ...o, condense: cond, tracking: tr, align: 'center' });
}

/** Same fitting, in the chalk rendering. */
export function fitChalk(g, text, cx, baseline, size, maxW, o = {}) {
  let cond = o.condense ?? 0.84, s = size;
  const tr = o.tracking ?? 0.14;
  while (slabW(text, s, { tracking: tr, condense: cond }) > maxW && cond > 0.56) cond -= 0.03;
  const w = slabW(text, s, { tracking: tr, condense: cond });
  if (w > maxW) s *= maxW / w;
  return chalk(g, text, cx, baseline, s, { ...o, condense: cond, tracking: tr, align: 'center' });
}

/* ============================================================================
   1. Canvas kit
   ========================================================================= */

const TAU = Math.PI * 2;
const C = (h) => hexCSS(h);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** A closed Catmull-Rom through the points — every organic shape in this file. */
function blob(g, pts, tension = 0.5) {
  const n = pts.length;
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    g.bezierCurveTo(
      p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2, p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2,
      p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2, p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2,
      p2[0], p2[1],
    );
  }
  g.closePath();
}

/** An open Catmull-Rom — hair fringes, brims, straps. */
function curve(g, pts, tension = 0.5) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    g.bezierCurveTo(
      p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2, p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2,
      p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2, p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2,
      p2[0], p2[1],
    );
  }
}

/**
 * Fill a shape, band it with the cool shade on the shadow side and the warm bounce
 * underneath, then ink it. The whole shading model in one function (§4.1, §4.2).
 */
function solid(g, path, fill, o = {}) {
  g.save();
  path();
  g.fillStyle = C(fill);
  g.fill();
  const b = o.bounds;
  if (o.shade !== false && b) {
    g.save();
    path(); g.clip();
    const gr = g.createLinearGradient(b.x + b.w * 0.20, b.y, b.x + b.w * 1.04, b.y + b.h * 0.92);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(0.50, 'rgba(0,0,0,0)');
    gr.addColorStop(1, C(coolShade(fill, 0.80)));
    g.fillStyle = gr; g.globalAlpha = o.shadeAlpha ?? 0.9;
    g.fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    const gb = g.createLinearGradient(0, b.y + b.h * 0.74, 0, b.y + b.h + 1);
    gb.addColorStop(0, 'rgba(0,0,0,0)');
    gb.addColorStop(1, C(bounceOf(fill)));
    g.fillStyle = gb; g.globalAlpha = 0.5;
    g.fillRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    g.restore();
  }
  if (o.ink !== false) {
    path();
    g.strokeStyle = C(inkOf(fill));
    g.lineWidth = o.lw ?? 2;
    g.lineJoin = 'round';
    g.stroke();
  }
  g.restore();
}

/* ============================================================================
   2. The head, run through the rig's own arithmetic
   ========================================================================= */

/**
 * wardrobe.deformHead() in two dimensions. Same jaw / cheek / crown / chin dials,
 * same formulae, so the card and the kid agree about what his head looks like.
 */
function headOutline(hs, steps = 84, wobbleSeed = 0) {
  const pts = [];
  const wr = wobbleSeed ? new RNG(wobbleSeed) : null;
  // three low-frequency lobes plus a little grit: a head drawn by a hand, not swept
  const p1 = wr ? wr.range(0, TAU) : 0, p2 = wr ? wr.range(0, TAU) : 0;
  const a1 = wr ? wr.range(0.012, 0.030) : 0, a2 = wr ? wr.range(0.008, 0.020) : 0;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    const wob = wr ? 1 + a1 * Math.sin(a * 3 + p1) + a2 * Math.sin(a * 5 + p2) : 1;
    let x = Math.cos(a) * wob, y = Math.sin(a) * wob;
    const t = clamp((0.25 - y) / 1.25, 0, 1);
    const jaw = 1 - hs.jaw * t * t;
    const cheek = 1 + hs.cheek * Math.exp(-((y + 0.12) * (y + 0.12)) / 0.05);
    const crown = y > 0 ? 1 + hs.crown * (y * y) : 1;
    x *= hs.w * jaw * cheek;
    y *= hs.h * crown;
    if (y < -0.5) y -= hs.chin * (-y - 0.5);
    pts.push([x, -y]);       // canvas y grows downward
  }
  return pts;
}

/* ============================================================================
   3. Expressions — the table faces.js uses, drawn flat
   ========================================================================= */

const EXPR = {
  neutral: { brow: 'level', open: [1.00, 1.00], mouth: 'line', gaze: [0, 0.06] },
  grin: { brow: 'raised', open: [0.92, 0.92], mouth: 'grin', gaze: [0.05, 0.02] },
  determined: { brow: 'angry', open: [0.62, 0.62], mouth: 'grit', gaze: [0, 0.10] },
  shock: { brow: 'high', open: [1.32, 1.32], mouth: 'oh', gaze: [0, -0.06] },
  disappointed: { brow: 'sad', open: [0.50, 0.50], mouth: 'frown', gaze: [0, 0.45] },
  taunt: { brow: 'cocky', open: [0.95, 0.45], mouth: 'toothy', gaze: [0.42, 0.02] },
  yell: { brow: 'high', open: [0.50, 0.50], mouth: 'yell', gaze: [0, -0.08] },
  smug: { brow: 'cocky', open: [0.62, 0.62], mouth: 'smirk', gaze: [0.30, 0.10] },
  squint: { brow: 'angry', open: [0.28, 0.28], mouth: 'line', gaze: [0, 0.05] },
  hopeful: { brow: 'sad', open: [1.24, 1.24], mouth: 'grin', gaze: [0, -0.10] },
};
const BROWS = {
  level: [[0, 0, 0.16], [0, 0, 0.16]],
  raised: [[-0.42, -4, 0.30], [-0.42, 4, 0.30]],
  high: [[-0.80, -7, 0.42], [-0.80, 7, 0.42]],
  angry: [[0.20, 24, 0.02], [0.20, -24, 0.02]],
  sad: [[-0.16, -22, 0.06], [-0.16, 22, 0.06]],
  cocky: [[-0.66, -10, 0.34], [0.16, -16, 0.04]],
};

/* ============================================================================
   4. Framing — the nine families, as nine different busts
   ========================================================================= */

/**
 * headF   head height as a fraction of the portrait panel
 * cyF     where the head's centre sits in the panel
 * neck    neck length in head-heights (a Fireplug has none, a Beanpole is all neck)
 * shW     shoulder half-width in head widths
 * slope   how much the shoulders drop from the neck outward
 * capF    cap scale multiplier on top of the family's own hat size
 * capY    how far down the skull the cap is jammed (Fireplug: to the eyebrows)
 * tilt    resting head tilt in radians — free character, per family
 */
const BUST = {
  melon:    { headF: 0.50, cyF: 0.42, neck: 0.03, shW: 0.98, slope: 0.30, capF: 0.84, capY: 0.02, tilt: 0.06, dx: 0.00 },
  fireplug: { headF: 0.45, cyF: 0.45, neck: 0.00, shW: 1.30, slope: 0.13, capF: 1.02, capY: 0.18, tilt: -0.04, dx: 0.01 },
  beanpole: { headF: 0.36, cyF: 0.33, neck: 0.34, shW: 0.74, slope: 0.48, capF: 0.94, capY: -0.06, tilt: 0.09, dx: -0.02 },
  sack:     { headF: 0.42, cyF: 0.40, neck: 0.02, shW: 1.20, slope: 0.07, capF: 1.02, capY: 0.11, tilt: -0.08, dx: 0.02 },
  ears:     { headF: 0.40, cyF: 0.40, neck: 0.16, shW: 0.90, slope: 0.34, capF: 0, capY: 0, tilt: 0.04, dx: -0.01 },
  bandbox:  { headF: 0.39, cyF: 0.38, neck: 0.22, shW: 0.84, slope: 0.28, capF: 0.90, capY: 0.02, tilt: 0.0, dx: 0.00 },
  ribbon:   { headF: 0.40, cyF: 0.38, neck: 0.18, shW: 0.80, slope: 0.32, capF: 0, capY: 0, tilt: -0.07, dx: 0.02 },
  barefoot: { headF: 0.47, cyF: 0.44, neck: 0.04, shW: 1.12, slope: 0.19, capF: 1.16, capY: 0.15, tilt: 0.10, dx: -0.02 },
  brace:    { headF: 0.39, cyF: 0.38, neck: 0.16, shW: 0.86, slope: 0.30, capF: 0.98, capY: 0.06, tilt: -0.10, dx: 0.01 },
};

/**
 * Cap wool. PERIOD-REFERENCE §5.1 names four: heather grey-brown, olive, brown
 * herringbone and a faded navy. All four are MID value — a cap is not a black hole,
 * and thirteen black holes in a row is what a roster of caps turns into if you let it.
 */
const CAPWOOL = [
  mix(PAVEMENT.curb, FACADE.brickShade, 0.34),
  mix(ACCENTS.olive, PAVEMENT.asphaltShade, 0.52),
  mix(LEATHER[0], PAVEMENT.asphaltWarm, 0.50),
  mix(ACCENTS.indigo, PAVEMENT.curb, 0.52),
  mix(PAVEMENT.belgianBlock, FACADE.cornice[1], 0.45),
];

const HAIRDO = {
  crop: { back: 0.02, side: 0.06, fringe: 0.16, tail: null },
  bowl: { back: 0.06, side: 0.16, fringe: 0.34, tail: null },
  pigtails: { back: 0.05, side: 0.12, fringe: 0.30, tail: 'pig' },
  braids: { back: 0.05, side: 0.11, fringe: 0.26, tail: 'braid' },
  ponytail: { back: 0.07, side: 0.09, fringe: 0.24, tail: 'pony' },
  bob: { back: 0.11, side: 0.24, fringe: 0.38, tail: null },
  puff: { back: 0.22, side: 0.26, fringe: 0.14, tail: null },
};

/* ============================================================================
   5. The bust
   ========================================================================= */

/**
 * Draw a kid head-and-shoulders into the box {x,y,w,h}. `mood` overrides the
 * resting expression, which is how the picking screen makes a kid look hopeful
 * and then look robbed.
 */
export function drawPortrait(g, kidRef, box, o = {}) {
  const kid = getKid(kidRef);
  const a = kid.art;
  const fam = FAMILIES[a.fam] || FAMILIES.melon;
  const bs = BUST[a.fam] || BUST.melon;
  const hs = fam.head;
  const seed = kid.id.charCodeAt(0) * 31 + kid.id.length * 7;
  const r = new RNG(1000 + seed);
  const ex = EXPR[o.mood || a.ex || 'neutral'] || EXPR.neutral;
  const q = a.quirk || {};

  const scale = (a.scale || 1) ** 0.5;
  const hh = box.h * bs.headF * scale * (o.zoom ?? 1);
  const unit = hh / (2 * hs.h);
  const hw = hs.w * unit * 2 * (1 + hs.cheek * 0.30);
  const hatK = a.hat === 'none' ? { kind: 'none' } : (fam.hat || { kind: 'none' });
  const bareHead = hatK.kind === 'none' || bs.capF <= 0;
  // how far the cap rides above the skull, so the crown never gets clipped
  const capRise = (hatK.kind !== 'none' && bs.capF > 0)
    ? hh * (hatK.kind === 'newsboy' ? 0.40 : 0.30) * (hatK.size || 1) * bs.capF * 1.18 - hh * bs.capY
    : hh * 0.10;
  const cx = box.x + box.w / 2 + ((o.dx || 0) + bs.dx) * box.w;
  const cy = box.y + Math.max(box.h * bs.cyF, hh * 0.5 + capRise + box.h * 0.045) + (o.dy || 0) * box.h;
  const lw = Math.max(1.25, unit * 0.090);
  const tilt = bs.tilt + ((seed % 9) - 4) * 0.016;

  const skin = SKIN[a.skin ?? 1];
  const hairCol = HAIR[a.hair ?? 1];
  const accent = ACCENTS[a.accent] || ACCENTS.red;
  const shirt = CLOTH[(kid.id.charCodeAt(0) + (a.skin ?? 0)) % CLOTH.length];
  const hairBase = HAIRDO[a.hairStyle || fam.hair] || HAIRDO.crop;
  // no cap means the hair is doing the silhouette work, so give it more mass
  const hairdo = { ...hairBase, back: hairBase.back + (a.hat === 'none' ? 0.09 : 0), fringe: hairBase.fringe + (a.hat === 'none' ? 0.06 : 0) };
  const capCol = a.slot === 'cap' ? accent : CAPWOOL[(kid.id.charCodeAt(1) || 3) % CAPWOOL.length];

  g.save();
  g.lineCap = 'round';

  /* ---- shoulders and the one saturated garment (§2.9) --------------------- */
  const neckLen = hh * bs.neck;
  const shY = cy + hh * 0.50 + neckLen;
  const shW = hw * bs.shW;
  const bottom = box.y + box.h + hh * 0.30;
  const shTilt = -tilt * 0.5;

  const shoulderPts = (spread) => [
    [cx - shW * 0.34 * spread, shY - hh * 0.02 + shTilt * shW],
    [cx - shW * 0.86 * spread, shY + hh * bs.slope * 0.9 + shTilt * shW],
    [cx - shW * 1.14 * spread, bottom],
    [cx + shW * 1.14 * spread, bottom],
    [cx + shW * 0.86 * spread, shY + hh * bs.slope * 0.9 - shTilt * shW],
    [cx + shW * 0.34 * spread, shY - hh * 0.02 - shTilt * shW],
  ];
  const shBounds = { x: cx - shW * 1.2, y: shY - hh * 0.1, w: shW * 2.4, h: bottom - shY + hh * 0.1 };
  solid(g, () => blob(g, shoulderPts(1), 0.42), shirt, { bounds: shBounds, lw });
  // rolled sleeve cuffs at the very edge of the frame — ill-fitting, non-uniform (§5.2)
  g.save();
  g.strokeStyle = C(inkOf(shirt)); g.lineWidth = lw * 0.8;
  for (const s of [-1, 1]) {
    curve(g, [[cx + s * shW * 0.98, bottom - hh * 0.34], [cx + s * shW * 1.10, bottom - hh * 0.22]]);
    g.stroke();
  }
  g.restore();

  const wearsTop = a.slot === 'sweater' || a.slot === 'vest' || fam.top === 'dress' || fam.top === 'handmedown';
  if (wearsTop) {
    const deep = fam.top === 'handmedown' ? 0.02 : a.slot === 'vest' ? 0.30 : 0.16;
    const vY = shY + hh * deep;
    const garment = () => blob(g, [
      [cx - shW * 0.30, vY],
      [cx - shW * 0.90, vY + hh * 0.26],
      [cx - shW * 1.14, bottom],
      [cx + shW * 1.14, bottom],
      [cx + shW * 0.90, vY + hh * 0.26],
      [cx + shW * 0.30, vY],
    ], 0.42);
    solid(g, garment, accent, { bounds: { x: shBounds.x, y: vY, w: shBounds.w, h: bottom - vY }, lw });
    // ribbing at the neck opening: a knitted wool sweater, elbows gone
    g.save();
    garment(); g.clip();
    g.strokeStyle = C(coolShade(accent, 0.80)); g.lineWidth = lw * 0.6;
    for (let i = 0; i < 8; i++) {
      const x = cx - shW + (i / 7) * shW * 2;
      curve(g, [[x, vY + hh * 0.22], [x + shW * 0.03, bottom]]);
      g.stroke();
    }
    g.restore();
    // the ecru shirt still reads at the throat
    g.save();
    g.fillStyle = C(mix(shirt, CHALK, 0.12));
    g.strokeStyle = C(inkOf(shirt)); g.lineWidth = lw * 0.85;
    blob(g, [
      [cx - shW * 0.30, vY + hh * 0.01], [cx, vY + hh * 0.30], [cx + shW * 0.30, vY + hh * 0.01],
      [cx + shW * 0.16, vY - hh * 0.10], [cx - shW * 0.16, vY - hh * 0.10],
    ], 0.35);
    g.fill(); g.stroke();
    g.restore();
  } else {
    g.save();
    g.strokeStyle = C(inkOf(shirt)); g.lineWidth = lw;
    for (const s of [-1, 1]) {
      curve(g, [
        [cx + s * shW * 0.30, shY + hh * 0.02],
        [cx + s * shW * 0.12, shY + hh * 0.32],
        [cx + s * shW * 0.06, shY + hh * 0.66],
      ]);
      g.stroke();
    }
    g.restore();
  }

  if (a.slot === 'suspenders') {
    const off = kid.id.length % 3 === 0 ? 1 : kid.id.length % 3 === 1 ? -1 : 0;
    for (const s of [-1, 1]) {
      const drop = s === off ? hh * 0.22 : 0;
      const lean = s === off ? s * shW * 0.16 : 0;
      g.save();
      g.strokeStyle = C(accent); g.lineWidth = Math.max(2.4, unit * 0.17);
      curve(g, [
        [cx + s * shW * 0.46 + lean, shY + hh * 0.10 + drop],
        [cx + s * shW * 0.52 + lean, shY + hh * 0.48 + drop * 0.5],
        [cx + s * shW * 0.44, bottom],
      ]);
      g.stroke();
      g.strokeStyle = C(inkOf(accent)); g.lineWidth = Math.max(0.9, unit * 0.045);
      g.stroke();
      g.restore();
    }
  }
  if (fam.bowtie) {
    g.save();
    const by = shY + hh * 0.30;
    g.fillStyle = C(accent); g.strokeStyle = C(inkOf(accent)); g.lineWidth = lw * 0.8;
    blob(g, [
      [cx - hw * 0.30, by - hh * 0.09], [cx - hw * 0.08, by], [cx - hw * 0.30, by + hh * 0.09],
      [cx, by + hh * 0.03], [cx + hw * 0.30, by + hh * 0.09], [cx + hw * 0.08, by],
      [cx + hw * 0.30, by - hh * 0.09], [cx, by - hh * 0.03],
    ], 0.35);
    g.fill(); g.stroke();
    g.restore();
  }

  /* ---- the neck: a tapered column, inked, its foot lost under the collar -- */
  {
    const nw = hw * (0.15 + 0.05 * (1 - bs.neck));
    const nTop = cy + hh * 0.20, nBot = shY + hh * 0.18;
    const p = () => blob(g, [
      [cx - nw, nTop], [cx - nw * 1.14, (nTop + nBot) / 2], [cx - nw * 1.30, nBot],
      [cx + nw * 1.30, nBot], [cx + nw * 1.14, (nTop + nBot) / 2], [cx + nw, nTop],
    ], 0.35);
    solid(g, p, coolShade(skin, 0.90), { bounds: { x: cx - nw * 1.4, y: nTop, w: nw * 2.8, h: nBot - nTop }, lw: lw * 0.9 });
  }

  /* ---- everything above the collar rotates together ---------------------- */
  g.save();
  g.translate(cx, cy);
  g.rotate(tilt);
  g.translate(-cx, -cy);

  /* ears (behind the head) */
  const earK = fam.ears || 0;
  const er = hw * (earK ? 0.115 * earK : 0.105);
  for (const s of [-1, 1]) {
    const exx = cx + s * (hw * 0.46 + er * 0.34);
    const path = () => { g.beginPath(); g.ellipse(exx, cy + hh * 0.03, er * 0.74, er, s * 0.20, 0, TAU); };
    solid(g, path, skin, { bounds: { x: exx - er, y: cy - er, w: er * 2, h: er * 2.2 }, lw: lw * 0.9 });
    g.save();
    g.strokeStyle = C(coolShade(skin, 0.72)); g.lineWidth = lw * 0.8;
    g.beginPath(); g.ellipse(exx, cy + hh * 0.03, er * 0.34, er * 0.52, s * 0.20, -1.2, 1.6); g.stroke();
    g.restore();
  }

  /* hair behind */
  const hairBack = () => {
    const pts = headOutline(hs, 84, seed + 11).map(([x, y]) => [cx + x * unit * (1 + hairdo.back + 0.04), cy + y * unit * (1 + hairdo.back)]);
    blob(g, pts, 0.5);
  };
  if (hairdo.back > 0.03) {
    solid(g, hairBack, hairCol, { bounds: { x: cx - hw, y: cy - hh, w: hw * 2, h: hh * 2 }, lw });
    g.save();
    hairBack(); g.clip();
    g.strokeStyle = C(mix(hairCol, CHALK, 0.44)); g.lineWidth = Math.max(2.2, lw * 2.2);
    g.lineCap = 'round';
    curve(g, [
      [cx - hw * 0.56, cy - hh * 0.24], [cx - hw * 0.26, cy - hh * 0.56], [cx + hw * 0.22, cy - hh * 0.54],
    ]);
    g.stroke();
    g.strokeStyle = C(mix(hairCol, CHALK, 0.22)); g.lineWidth = Math.max(1.4, lw * 1.2);
    curve(g, [[cx + hw * 0.34, cy - hh * 0.44], [cx + hw * 0.50, cy - hh * 0.16]]);
    g.stroke();
    g.restore();
  }

  drawTails(g, { kid, a, cx, cy, hw, hh, hairdo, hairCol, accent, lw });

  /* the head */
  const headPts = headOutline(hs, 84, seed + 3).map(([x, y]) => [cx + x * unit, cy + y * unit]);
  const headPath = () => blob(g, headPts, 0.5);
  solid(g, headPath, skin, { bounds: { x: cx - hw * 0.62, y: cy - hh * 0.62, w: hw * 1.24, h: hh * 1.30 }, lw });

  /* hair in front */
  if (hairdo.fringe > 0.05) {
    g.save();
    headPath(); g.clip();
    const top = cy - hh * 0.50;
    const fr = hh * hairdo.fringe;
    const teeth = [];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const x = cx - hw * 0.60 + hw * 1.20 * u;
      teeth.push([x, top + fr * (0.50 + 0.50 * Math.abs(Math.sin(u * 7.1 + kid.id.length)))]);
    }
    const path = () => {
      g.beginPath();
      g.moveTo(cx - hw * 0.75, top - hh * 0.35);
      for (const p of teeth) g.lineTo(p[0], p[1]);
      g.lineTo(cx + hw * 0.75, top - hh * 0.35);
      g.closePath();
    };
    g.fillStyle = C(hairCol); path(); g.fill();
    g.globalAlpha = 0.55; g.fillStyle = C(coolShade(hairCol, 0.80));
    g.beginPath(); g.moveTo(cx + hw * 0.10, top - hh * 0.35);
    for (const p of teeth) if (p[0] > cx + hw * 0.05) g.lineTo(p[0], p[1]);
    g.lineTo(cx + hw * 0.75, top - hh * 0.35); g.closePath(); g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = C(inkOf(hairCol)); g.lineWidth = lw * 0.9;
    g.beginPath(); g.moveTo(teeth[0][0], teeth[0][1]);
    for (const p of teeth) g.lineTo(p[0], p[1]);
    g.stroke();
    g.restore();
  }

  if (!hairdo.tail && a.slot === 'ribbon') crownBow(g, { cx, cy, hw, hh, accent, lw });

  /* the face */
  drawFace(g, { kid, a, ex, q, cx, cy, hw, hh, skin, hairCol, shirt, lw, r });

  /* the cap: our primary silhouette organ */
  if (hatK.kind !== 'none' && bs.capF > 0) {
    drawCap(g, { hat: hatK, cx, cy, hw, hh, col: capCol, lw, capF: bs.capF, capY: bs.capY, band: o.teamBand, seed });
  }

  g.restore();     // head tilt

  /* the crutch, for the kid whose outline is a different shape entirely (§5.4) */
  if (fam.crutch) drawCrutch(g, { cx, cy, hw, hh, shY, shW, box, lw });

  /* the prop that breaks the outline (§5.4) */
  drawProp(g, a.prop, { cx, cy, hw, hh, shY, shW, skin, accent, lw, a, ex, box });

  g.restore();
}

function drawTails(g, { kid, a, cx, cy, hw, hh, hairdo, hairCol, accent, lw }) {
  if (hairdo.tail === 'pig' || hairdo.tail === 'braid') {
    for (const s of [-1, 1]) {
      const bx = cx + s * hw * 0.56, by = cy + hh * 0.02;
      const len = hh * (hairdo.tail === 'braid' ? 0.80 : 0.48);
      const path = () => blob(g, [
        [bx, by - hh * 0.12], [bx + s * hw * 0.26, by + len * 0.35],
        [bx + s * hw * 0.12, by + len], [bx - s * hw * 0.12, by + len * 0.88],
        [bx - s * hw * 0.11, by + len * 0.28],
      ], 0.5);
      solid(g, path, hairCol, { bounds: { x: bx - hw * 0.3, y: by - hh * 0.12, w: hw * 0.6, h: len * 1.2 }, lw: lw * 0.9 });
      if (hairdo.tail === 'braid') {
        g.save();
        g.strokeStyle = C(coolShade(hairCol, 0.70)); g.lineWidth = lw * 0.7;
        for (let i = 1; i <= 3; i++) {
          const yy = by + (len * i) / 4;
          g.beginPath(); g.moveTo(bx - hw * 0.09, yy); g.lineTo(bx + s * hw * 0.17, yy + len * 0.05); g.stroke();
        }
        g.restore();
      }
      if (a.slot === 'ribbon') {
        g.save();
        g.fillStyle = C(accent); g.strokeStyle = C(inkOf(accent)); g.lineWidth = lw * 0.8;
        blob(g, [
          [bx - hw * 0.16, by - hh * 0.07], [bx, by - hh * 0.16], [bx + hw * 0.16, by - hh * 0.07],
          [bx, by + hh * 0.03],
        ], 0.4);
        g.fill(); g.stroke();
        g.restore();
      }
    }
  } else if (hairdo.tail === 'pony') {
    const s = 1;
    const bx = cx + s * hw * 0.50, by = cy - hh * 0.14;
    const path = () => blob(g, [
      [bx, by], [bx + s * hw * 0.38, by + hh * 0.26], [bx + s * hw * 0.22, by + hh * 0.72],
      [bx - s * hw * 0.02, by + hh * 0.54], [bx - s * hw * 0.07, by + hh * 0.14],
    ], 0.55);
    solid(g, path, hairCol, { bounds: { x: bx - hw * 0.2, y: by, w: hw * 0.66, h: hh * 0.75 }, lw: lw * 0.9 });
    if (a.slot === 'ribbon') {
      g.save();
      g.fillStyle = C(accent); g.strokeStyle = C(inkOf(accent)); g.lineWidth = lw * 0.8;
      blob(g, [[bx - hw * 0.12, by], [bx + hw * 0.02, by - hh * 0.11], [bx + hw * 0.17, by + hh * 0.02], [bx + hw * 0.02, by + hh * 0.11]], 0.4);
      g.fill(); g.stroke();
      g.restore();
    }
  }
}

/** A hair ribbon straight on the crown, drawn after the fringe so nothing buries it. */
function crownBow(g, { cx, cy, hw, hh, accent, lw }) {
  g.save();
  const by = cy - hh * 0.42, bx = cx + hw * 0.26;
  g.fillStyle = C(accent); g.strokeStyle = C(inkOf(accent)); g.lineWidth = lw * 0.85;
  blob(g, [
    [bx - hw * 0.26, by - hh * 0.07], [bx - hw * 0.05, by + hh * 0.02], [bx - hw * 0.24, by + hh * 0.11],
    [bx, by + hh * 0.05], [bx + hw * 0.24, by + hh * 0.11], [bx + hw * 0.05, by + hh * 0.02],
    [bx + hw * 0.26, by - hh * 0.07], [bx, by - hh * 0.02],
  ], 0.35);
  g.fill(); g.stroke();
  g.beginPath(); g.arc(bx, by + hh * 0.015, hw * 0.045, 0, TAU);
  g.fillStyle = C(coolShade(accent, 0.72)); g.fill(); g.stroke();
  g.restore();
}

function drawFace(g, ctx) {
  const { kid, a, ex, q, cx, cy, hw, hh, skin, hairCol, shirt, lw, r } = ctx;
  // DESIGN-BIBLE 5.3: each eye 12-16% of head width, gap about one eye width,
  // sitting at or just below the head's horizontal midline. Everything else on
  // the face is anchored to the head, not to the eye, so a big head is not a
  // big-eyed head.
  const ew = hw * 0.082 * (q.eyeSize || 1);          // eye half-width
  const eyeY = cy + hh * 0.04;
  const eyeX = hw * 0.168;
  const openL = ex.open[0] * (q.droopy === 'L' ? 0.55 : 1);
  const openR = ex.open[1] * (q.droopy === 'R' ? 0.55 : 1);
  const gaze = ex.gaze;
  const pupil = soot(HAIR[0], 0.12);
  const lid = C(mix(hairCol, INK, 0.35));

  for (const [s, open] of [[-1, openL], [1, openR]]) {
    const x = cx + s * eyeX;
    const ry = ew * 1.20 * clamp(open, 0.07, 1.45);
    g.save();
    g.beginPath(); g.ellipse(x, eyeY, ew, ry, 0, 0, TAU);
    g.fillStyle = C(mix(CHALK, shirt, 0.16)); g.fill();
    g.save(); g.clip();
    const ix = x + gaze[0] * ew * 0.7, iy = eyeY + gaze[1] * ew * 0.95;
    g.beginPath(); g.ellipse(ix, iy, ew * 0.62, ew * 0.62, 0, 0, TAU);
    g.fillStyle = C(pupil); g.fill();
    g.beginPath(); g.ellipse(ix - ew * 0.24, iy - ew * 0.26, ew * 0.20, ew * 0.20, 0, 0, TAU);
    g.fillStyle = C(CHALK); g.fill();
    if (open < 0.95) {                                 // a solid upper lid, so a squint squints
      g.fillStyle = C(skin);
      g.fillRect(x - ew * 1.3, eyeY - ry - ew * 1.8, ew * 2.6, ew * 1.8);
      g.strokeStyle = lid; g.lineWidth = Math.max(1, lw * 0.9);
      g.beginPath(); g.moveTo(x - ew, eyeY - ry + ew * 0.02); g.lineTo(x + ew, eyeY - ry + ew * 0.02); g.stroke();
    }
    g.restore();
    g.beginPath(); g.ellipse(x, eyeY, ew, ry, 0, 0, TAU);
    g.strokeStyle = C(soot(inkOf(skin), 0.22)); g.lineWidth = Math.max(1, lw * 0.95); g.stroke();
    g.restore();
  }

  // brows: separate floating shapes, four named positions, asymmetric on purpose
  const bw = ew * 1.5;
  const bt = Math.max(1.6, hh * 0.020 * (q.browThick || 1));
  const bpos = BROWS[ex.brow] || BROWS.level;
  for (let i = 0; i < 2; i++) {
    const s = i === 0 ? -1 : 1;
    const [dy, tiltDeg, arch] = bpos[i];
    const x = cx + s * eyeX;
    const y = eyeY - hh * 0.095 + dy * ew * 1.1;
    g.save();
    g.translate(x, y); g.rotate((s * tiltDeg * Math.PI) / 180);
    g.strokeStyle = C(mix(hairCol, INK, 0.30)); g.lineWidth = bt; g.lineCap = 'round';
    curve(g, [[-bw * 0.5, arch * ew * 1.1], [0, -arch * ew * 0.7], [bw * 0.5, arch * ew * 0.4]]);
    g.stroke();
    g.restore();
  }

  // nose: a bump, a dot or a comma. Never a nose.
  g.save();
  g.strokeStyle = C(coolShade(skin, 0.66)); g.lineWidth = Math.max(1.4, lw * 1.1); g.lineCap = 'round';
  const nk = kid.id.charCodeAt(0) % 3;
  const ny = eyeY + hh * 0.115;
  const nr = hw * 0.045;
  if (nk === 0) { g.beginPath(); g.arc(cx, ny, nr, 0.20, Math.PI - 0.20); g.stroke(); }
  else if (nk === 1) {
    g.beginPath(); g.ellipse(cx + nr * 0.12, ny, nr * 0.78, nr * 0.62, 0, 0, TAU);
    g.fillStyle = C(coolShade(skin, 0.78)); g.fill(); g.stroke();
  } else { curve(g, [[cx - nr * 0.3, ny - nr], [cx + nr * 0.55, ny], [cx - nr * 0.45, ny + nr * 0.55]]); g.stroke(); }
  g.restore();

  g.save();
  g.globalAlpha = 0.24;
  for (const s of [-1, 1]) {
    g.beginPath(); g.ellipse(cx + s * hw * 0.30, eyeY + hh * 0.10, hw * 0.115, hw * 0.072, 0, 0, TAU);
    g.fillStyle = C(0xde8062); g.fill();
  }
  g.restore();

  if (q.freckles) {
    g.save();
    g.fillStyle = C(soot(0xde8062, 0.30)); g.globalAlpha = 0.75;
    const n = 4 + q.freckles * 2;
    for (let i = 0; i < n; i++) {
      const s = i % 2 ? 1 : -1;
      const fx = cx + s * hw * (0.12 + r.range(0.03, 0.22));
      const fy = ny - hh * 0.02 + r.range(-hh * 0.035, hh * 0.05);
      g.beginPath(); g.arc(fx, fy, Math.max(0.9, hw * 0.013), 0, TAU); g.fill();
    }
    g.restore();
  }

  drawMouth(g, ex.mouth, cx, eyeY + hh * 0.215, hw, hh, skin, lw, q);

  if (a.specs) {
    g.save();
    g.strokeStyle = C(mix(LEATHER[1], INK, 0.3)); g.lineWidth = Math.max(1.5, lw * 0.95);
    for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * eyeX, eyeY, ew * 1.7, 0, TAU); g.stroke(); }
    g.beginPath(); g.moveTo(cx - eyeX + ew * 1.4, eyeY); g.lineTo(cx + eyeX - ew * 1.4, eyeY); g.stroke();
    g.restore();
  }
}

function drawMouth(g, kind, cx, my, hw, hh, skin, lw, q) {
  const w = hw * 0.175;                      // half-width of the mouth
  const u = hh * 0.042;                      // the mouth's own unit
  const ink = C(soot(inkOf(skin), 0.16));
  const gum = C(soot(0xb03a5e, 0.34));
  const teeth = C(mix(CHALK, CLOTH[0], 0.20));
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = ink; g.lineWidth = Math.max(1.7, lw * 1.2);
  if (kind === 'line') { curve(g, [[cx - w, my], [cx, my + u * 0.5], [cx + w, my]]); g.stroke(); }
  else if (kind === 'frown') { curve(g, [[cx - w, my + u], [cx, my - u * 0.45], [cx + w, my + u]]); g.stroke(); }
  else if (kind === 'smirk') { curve(g, [[cx - w * 0.95, my + u * 0.65], [cx + w * 0.2, my + u * 0.25], [cx + w * 1.05, my - u * 0.85]]); g.stroke(); }
  else if (kind === 'grit') {
    g.beginPath();
    g.moveTo(cx - w, my - u * 0.55); g.lineTo(cx + w, my - u * 0.55);
    g.lineTo(cx + w, my + u * 0.70); g.lineTo(cx - w, my + u * 0.70); g.closePath();
    g.fillStyle = teeth; g.fill(); g.stroke();
    g.lineWidth = Math.max(0.9, lw * 0.55);
    for (let i = 1; i < 4; i++) {
      const x = cx - w + (2 * w * i) / 4;
      g.beginPath(); g.moveTo(x, my - u * 0.55); g.lineTo(x, my + u * 0.70); g.stroke();
    }
  } else if (kind === 'grin' || kind === 'toothy') {
    const drop = kind === 'toothy' ? u * 2.5 : u * 2.0;
    const path = () => {
      g.beginPath();
      g.moveTo(cx - w * 1.06, my - u * 0.45);
      g.quadraticCurveTo(cx, my + drop, cx + w * 1.06, my - u * 0.45);
      g.closePath();
    };
    path(); g.fillStyle = gum; g.fill(); g.stroke();
    g.save(); path(); g.clip();
    g.fillStyle = teeth;
    g.fillRect(cx - w * 1.2, my - u * 0.5, w * 2.4, drop * 0.42);
    g.restore();
    path(); g.stroke();
  } else if (kind === 'oh' || kind === 'yell') {
    const ry = u * (kind === 'yell' ? 2.0 : 1.4);
    const path = () => { g.beginPath(); g.ellipse(cx, my + ry * 0.36, w * 0.72, ry, 0, 0, TAU); };
    path(); g.fillStyle = gum; g.fill();
    g.save(); path(); g.clip();
    g.fillStyle = teeth; g.fillRect(cx - w * 1.2, my + ry * 0.36 - ry, w * 2.4, ry * 0.50);
    g.restore();
    path(); g.stroke();
  }
  if (q.tongue) {
    const s = q.tongue === 'L' ? -1 : 1;
    g.beginPath();
    g.ellipse(cx + s * w * 0.95, my + u * 0.9, u * 0.85, u * 0.62, s * 0.5, 0, TAU);
    g.fillStyle = C(0xd4694a); g.fill(); g.stroke();
  }
  g.restore();
}

function drawCap(g, { hat, cx, cy, hw, hh, col, lw, capF, capY, band, seed }) {
  const size = (hat.size || 1) * capF;
  const top = cy - hh * 0.50 + hh * capY;
  const tiltZ = (hat.tiltZ || 0) * 1.2;
  const newsboy = hat.kind === 'newsboy';
  // DESIGN-BIBLE §5.2: 1.15-1.4x the head's PLAN area, which is 1.07-1.18x across.
  const w = hw * 0.5 * (1.03 + size * 0.13);
  const crownH = hh * (newsboy ? 0.30 : 0.22) * size;
  g.save();
  g.translate(cx, top);
  g.rotate(tiltZ);

  // the brim first, so the crown's ink sits on top of it
  const bw = w * (newsboy ? 1.06 : 1.00);
  const brim = () => blob(g, [
    [-bw * 1.02, hh * 0.005],
    [-bw * 1.14, hh * 0.098],
    [-bw * 0.14, hh * 0.176],
    [bw * 0.88, hh * 0.092],
    [bw * 0.60, hh * -0.020],
  ], 0.30);
  solid(g, brim, coolShade(col, 0.60), { bounds: { x: -bw * 1.2, y: 0, w: bw * 2.4, h: hh * 0.19 }, lw: lw * 1.1 });
  g.save();
  g.strokeStyle = C(mix(col, CHALK, 0.42)); g.lineWidth = Math.max(1, lw * 0.75);
  curve(g, [[-bw * 1.10, hh * 0.090], [-bw * 0.14, hh * 0.166], [bw * 0.84, hh * 0.086]]);
  g.stroke();
  g.restore();

  const path = () => blob(g, [
    [-w * 1.02, hh * 0.030],
    [-w * 0.98, -crownH * 0.62],
    [-w * 0.34, -crownH * (newsboy ? 1.16 : 1.00)],
    [w * 0.40, -crownH * (newsboy ? 1.10 : 0.94)],
    [w * 1.00, -crownH * 0.46],
    [w * 1.02, hh * 0.040],
  ], 0.5);
  solid(g, path, col, { bounds: { x: -w, y: -crownH * 1.2, w: w * 2, h: crownH * 1.26 }, lw });
  g.save();
  path(); g.clip();
  // sun catches the crown: the cap is the top plane of the kid, so it is the lightest
  const gr = g.createLinearGradient(0, -crownH * 1.2, 0, hh * 0.04);
  gr.addColorStop(0, C(mix(col, CHALK, 0.34)));
  gr.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.globalAlpha = 0.85;
  g.fillRect(-w * 1.1, -crownH * 1.3, w * 2.2, crownH * 1.5);
  g.globalAlpha = 1;
  g.strokeStyle = C(coolShade(col, 0.70)); g.lineWidth = Math.max(0.9, lw * 0.55);
  for (const u of [-0.58, -0.18, 0.26, 0.66]) {
    curve(g, [[w * u, hh * 0.03], [w * u * 0.62, -crownH * 0.56], [w * u * 0.22, -crownH * 1.02]]);
    g.stroke();
  }
  const r = new RNG(seed + 41);
  g.globalAlpha = 0.30;
  for (let i = 0; i < 44; i++) {
    g.fillStyle = r.chance(0.5) ? C(mix(col, CHALK, 0.45)) : C(coolShade(col, 0.62));
    g.fillRect(r.range(-w, w), r.range(-crownH * 1.1, hh * 0.03), 1.4, 1.4);
  }
  g.restore();

  // the band where the crown meets the brim — the line that says "cap", not "beret"
  g.save();
  g.strokeStyle = C(band || coolShade(col, 0.74));
  g.lineWidth = Math.max(1.6, hh * (band ? 0.040 : 0.026));
  curve(g, [[-w * 0.98, hh * 0.010], [0, hh * 0.046], [w * 0.98, hh * 0.016]]);
  g.stroke();
  g.restore();

  if (newsboy) {
    g.beginPath(); g.arc(-w * 0.14, -crownH * 1.06, Math.max(1.8, hw * 0.05), 0, TAU);
    g.fillStyle = C(mix(col, CHALK, 0.20)); g.fill();
    g.strokeStyle = C(inkOf(col)); g.lineWidth = lw * 0.8; g.stroke();
  }
  g.restore();
}

/**
 * The caliper brace and the wooden crutch. He is never pitied, never explained and
 * never the subject of a joke (§5.4); on a card that means the crutch is simply
 * there, at the shoulder, the way a stick or a pigeon is there.
 */
function drawCrutch(g, { cx, cy, hw, hh, shY, shW, box, lw }) {
  const wood = mix(LEATHER[0], CLOTH[0], 0.38);
  const x = Math.max(box.x + box.w * 0.10, cx - shW * 0.92);
  g.save();
  g.translate(x, shY + hh * 0.10);
  g.rotate(-0.16);
  const w = hw * 0.085;
  const p = () => { g.beginPath(); g.rect(-w / 2, -hh * 0.30, w, hh * 2.2); };
  solid(g, p, wood, { bounds: { x: -w / 2, y: -hh * 0.3, w, h: hh * 1.4 }, lw: lw * 0.9 });
  // the padded top, wrapped in rag because it always is
  const pad = () => blob(g, [
    [-hw * 0.20, -hh * 0.30], [-hw * 0.22, -hh * 0.46], [0, -hh * 0.53],
    [hw * 0.22, -hh * 0.46], [hw * 0.20, -hh * 0.30],
  ], 0.45);
  solid(g, pad, mix(CLOTH[1], PAVEMENT.curb, 0.30), { bounds: { x: -hw * 0.24, y: -hh * 0.55, w: hw * 0.48, h: hh * 0.26 }, lw: lw * 0.9 });
  g.save();
  g.strokeStyle = C(mix(INK, CLOTH[1], 0.5)); g.lineWidth = lw * 0.6;
  for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-hw * 0.19, -hh * (0.40 + i * 0.055)); g.lineTo(hw * 0.19, -hh * (0.39 + i * 0.055)); g.stroke(); }
  g.restore();
  g.restore();
}

/** Prop hooks that break the outline. Six on the field at any time (§5.4). */
function drawProp(g, prop, ctx) {
  if (!prop) return;
  const { cx, cy, hw, hh, shY, shW, skin, accent, lw, box } = ctx;
  const inL = (x) => Math.max(box.x + box.w * 0.085, x);
  const inR = (x) => Math.min(box.x + box.w * 0.915, x);
  const mitt = hw * 0.34;
  const hand = (x, y, rot = 0) => {
    g.save();
    g.translate(x, y); g.rotate(rot);
    const p = () => blob(g, [[-mitt * 0.5, -mitt * 0.42], [mitt * 0.5, -mitt * 0.48], [mitt * 0.58, mitt * 0.36], [-mitt * 0.46, mitt * 0.42]], 0.55);
    solid(g, p, skin, { bounds: { x: -mitt * 0.6, y: -mitt * 0.5, w: mitt * 1.2, h: mitt }, lw: lw * 0.9 });
    g.restore();
  };

  if (prop === 'pigeon') {
    const x = inR(cx + shW * 0.86), y = shY + hh * 0.02, s = hw * 0.56;
    const body = mix(PAVEMENT.manholeHigh, AIR.shadowTint, 0.28);
    const p = () => blob(g, [
      [x - s * 0.42, y], [x - s * 0.20, y - s * 0.44], [x + s * 0.30, y - s * 0.40],
      [x + s * 0.54, y + s * 0.02], [x + s * 0.10, y + s * 0.32], [x - s * 0.30, y + s * 0.26],
    ], 0.5);
    solid(g, p, body, { bounds: { x: x - s * 0.5, y: y - s * 0.46, w: s, h: s * 0.82 }, lw: lw * 0.85 });
    g.save();
    g.fillStyle = C(mix(ACCENTS.teal, body, 0.35));
    g.beginPath(); g.ellipse(x - s * 0.08, y - s * 0.34, s * 0.20, s * 0.18, 0, 0, TAU); g.fill();
    g.strokeStyle = C(inkOf(body)); g.lineWidth = lw * 0.8; g.stroke();
    g.fillStyle = C(ACCENTS.mustard);
    g.beginPath(); g.moveTo(x - s * 0.26, y - s * 0.34); g.lineTo(x - s * 0.44, y - s * 0.29); g.lineTo(x - s * 0.26, y - s * 0.25); g.closePath(); g.fill();
    g.fillStyle = C(INK);
    g.beginPath(); g.arc(x - s * 0.11, y - s * 0.38, Math.max(0.9, s * 0.05), 0, TAU); g.fill();
    g.restore();
    return;
  }
  if (prop === 'harmonica') {
    // four bars between innings, and only four
    const my = cy + hh * 0.275, w = hw * 0.52, h = hh * 0.100;
    g.save();
    const p = () => { g.beginPath(); g.rect(cx - w / 2, my - h / 2, w, h); };
    solid(g, p, mix(PAVEMENT.manholeHigh, AIR.shadowTint, 0.2), { bounds: { x: cx - w / 2, y: my - h / 2, w, h }, lw: lw * 0.9 });
    g.strokeStyle = C(INK); g.lineWidth = Math.max(0.8, lw * 0.5);
    for (let i = 1; i < 9; i++) { const x = cx - w / 2 + (w * i) / 9; g.beginPath(); g.moveTo(x, my - h * 0.28); g.lineTo(x, my + h * 0.28); g.stroke(); }
    g.restore();
    hand(cx - w * 0.60, my + h * 1.5, -0.55);
    hand(cx + w * 0.60, my + h * 1.5, 0.55);
    return;
  }
  if (prop === 'jar') {
    const x = inR(cx + hw * 0.95), y = cy + hh * 0.30, w = hw * 0.38, h = hh * 0.42;
    const p = () => { g.beginPath(); g.rect(x - w / 2, y - h / 2, w, h); };
    g.save();
    g.globalAlpha = 0.72;
    solid(g, p, mix(AIR.skyLower, CHALK, 0.35), { bounds: { x: x - w / 2, y: y - h / 2, w, h }, lw: lw * 0.9 });
    g.restore();
    g.save();
    g.fillStyle = C(ACCENTS.olive);
    g.beginPath(); g.ellipse(x, y + h * 0.16, w * 0.24, h * 0.14, 0.4, 0, TAU); g.fill();
    g.fillStyle = C(mix(LEATHER[0], INK, 0.2));
    g.fillRect(x - w * 0.56, y - h * 0.60, w * 1.12, h * 0.16);
    g.strokeStyle = C(INK); g.lineWidth = lw * 0.7; g.strokeRect(x - w * 0.56, y - h * 0.60, w * 1.12, h * 0.16);
    g.restore();
    hand(x, y + h * 0.62, 0.15);
    return;
  }
  if (prop === 'cards') {
    const x = inR(cx + hw * 0.95), y = cy + hh * 0.26;
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate(x, y); g.rotate(-0.5 + i * 0.28);
      const w = hw * 0.26, h = hw * 0.40;
      g.fillStyle = C(mix(CLOTH[1], PAVEMENT.blockCrown, 0.2));
      g.strokeStyle = C(INK); g.lineWidth = lw * 0.7;
      g.fillRect(-w / 2, -h, w, h); g.strokeRect(-w / 2, -h, w, h);
      g.fillStyle = C([ACCENTS.red, ACCENTS.indigo, ACCENTS.mustard, ACCENTS.bottleGreen][i]);
      g.fillRect(-w * 0.32, -h * 0.86, w * 0.64, h * 0.4);
      g.restore();
    }
    hand(x, y + hw * 0.10, 0.1);
    return;
  }
  if (prop === 'newspaper') {
    // rolled, jammed through the suspenders, one corner already gone
    g.save();
    const x = inR(cx + shW * 0.80), y = shY + hh * 0.18;
    g.translate(x, y); g.rotate(-0.62);
    const w = hw * 0.20, h = hh * 0.92;
    const paper = mix(CLOTH[0], CHALK, 0.18);
    const p = () => { g.beginPath(); g.rect(-w / 2, -h / 2, w, h); };
    solid(g, p, paper, { bounds: { x: -w / 2, y: -h / 2, w, h }, lw: lw * 0.85 });
    g.save(); p(); g.clip();
    g.strokeStyle = C(mix(INK, paper, 0.45)); g.lineWidth = lw * 0.5;
    for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(-w / 2, (h / 8) * i); g.lineTo(w / 2, (h / 8) * i + 1); g.stroke(); }
    g.restore();
    g.beginPath(); g.ellipse(0, -h / 2, w * 0.5, w * 0.22, 0, 0, TAU);
    g.fillStyle = C(coolShade(paper, 0.86)); g.fill();
    g.strokeStyle = C(inkOf(paper)); g.lineWidth = lw * 0.8; g.stroke();
    g.restore();
    return;
  }
  if (prop === 'stick') {
    // the broom handle. Whoever owns the stick has status (PERIOD 5.5).
    g.save();
    const x = inL(cx - shW * 0.80), y = shY - hh * 0.18;
    g.translate(x, y); g.rotate(0.30);
    const w = hw * 0.115, h = hh * 2.4;
    const wood = mix(LEATHER[0], CLOTH[0], 0.42);
    const p = () => { g.beginPath(); g.rect(-w / 2, -h * 0.42, w, h); };
    solid(g, p, wood, { bounds: { x: -w / 2, y: -h * 0.42, w, h: h * 0.9 }, lw: lw * 0.9 });
    g.save(); p(); g.clip();
    g.strokeStyle = C(coolShade(wood, 0.72)); g.lineWidth = lw * 0.55;
    for (let i = 0; i < 5; i++) { const yy = -h * 0.42 + (h * i) / 5 + 6; g.beginPath(); g.moveTo(-w / 2, yy); g.lineTo(w / 2, yy + 5); g.stroke(); }
    g.restore();
    // black friction tape round the grip
    g.fillStyle = C(mix(INK, PAVEMENT.asphaltDark, 0.3));
    g.fillRect(-w * 0.58, h * 0.18, w * 1.16, hh * 0.20);
    g.restore();
    return;
  }
  if (prop === 'ball') {
    // a Spaldeen, held up. Whoever owns the ball owns the afternoon.
    const x = inR(cx + shW * 0.80), y = shY - hh * 0.10, rad = hw * 0.21;
    g.save();
    const p = () => { g.beginPath(); g.arc(x, y, rad, 0, TAU); };
    solid(g, p, BALL.new, { bounds: { x: x - rad, y: y - rad, w: rad * 2, h: rad * 2 }, lw: lw * 1.1 });
    g.strokeStyle = C(CHALK); g.lineWidth = Math.max(1.4, rad * 0.22); g.lineCap = 'round';
    g.beginPath(); g.arc(x, y, rad * 0.72, Math.PI * 1.05, Math.PI * 1.62); g.stroke();
    // three fingers over the front of it, so it is held and not floating
    g.strokeStyle = C(inkOf(skin)); g.lineWidth = Math.max(1.2, lw);
    for (let i = -1; i <= 1; i++) {
      const fy = y + rad * (0.20 + i * 0.42);
      g.beginPath();
      g.moveTo(x - rad * 0.86, fy + rad * 0.30);
      g.quadraticCurveTo(x - rad * 0.10, fy, x + rad * 0.62, fy - rad * 0.14);
      g.strokeStyle = C(inkOf(skin)); g.stroke();
      g.lineWidth = Math.max(2.4, lw * 2.4); g.strokeStyle = C(skin);
      g.stroke();
      g.lineWidth = Math.max(1.0, lw * 0.8); g.strokeStyle = C(inkOf(skin));
      g.stroke();
    }
    g.restore();
    return;
  }
  if (prop === 'slingshot') {
    g.save();
    const x = inR(cx + shW * 0.72), y = shY + hh * 0.26;
    g.translate(x, y); g.rotate(0.28);
    g.strokeStyle = C(mix(LEATHER[0], INK, 0.25)); g.lineWidth = Math.max(2, hw * 0.07); g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, hh * 0.30); g.lineTo(0, -hh * 0.06);
    g.moveTo(0, -hh * 0.06); g.lineTo(-hw * 0.20, -hh * 0.30);
    g.moveTo(0, -hh * 0.06); g.lineTo(hw * 0.20, -hh * 0.30);
    g.stroke();
    g.strokeStyle = C(mix(BALL.new, INK, 0.35)); g.lineWidth = Math.max(1.2, hw * 0.035);
    g.beginPath(); g.moveTo(-hw * 0.20, -hh * 0.30); g.lineTo(0, -hh * 0.14); g.lineTo(hw * 0.20, -hh * 0.30); g.stroke();
    g.restore();
  }
}

/**
 * The same kid, drawn in chalk on the flagstone: head, cap, ears, plaits. Used for
 * the hole a kid leaves in the pool when his name gets called, which is the only
 * way to show a draft emptying without the screen emptying with it.
 */
export function chalkHead(g, kidRef, cx, cy, size, o = {}) {
  const kid = getKid(kidRef);
  const a = kid.art;
  const fam = FAMILIES[a.fam] || FAMILIES.melon;
  const hs = fam.head;
  const hh = size, unit = hh / (2 * hs.h);
  const hw = hs.w * unit * 2 * (1 + hs.cheek * 0.30);
  const col = o.color || C(CHALK);
  const alpha = o.alpha ?? 0.55;
  const w = Math.max(1.8, size * 0.030);
  let seed = (o.seed || 1) * 7;
  const pts = headOutline(hs, 30, (o.seed || 1) * 17 + 3).map(([x, y]) => [cx + x * unit, cy + y * unit]);
  pts.push(pts[0]);
  chalkStroke(g, pts, w, seed++, alpha, col);
  // two dots and a line: how a nine-year-old draws a nine-year-old
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = col;
  for (const sgn of [-1, 1]) {
    g.beginPath();
    g.arc(cx + sgn * hw * 0.17, cy + hh * 0.02, Math.max(1.4, hw * 0.045), 0, TAU);
    g.fill();
  }
  g.restore();
  chalkStroke(g, [
    [cx - hw * 0.16, cy + hh * 0.20], [cx, cy + hh * 0.26], [cx + hw * 0.16, cy + hh * 0.20],
  ], w * 0.9, seed++, alpha, col);
  const hatK = a.hat === 'none' ? { kind: 'none' } : (fam.hat || { kind: 'none' });
  if (hatK.kind !== 'none') {
    const cw = hw * 0.60, top = cy - hh * 0.50 + hh * (BUST[a.fam] || BUST.melon).capY;
    const ch2 = hh * (hatK.kind === 'newsboy' ? 0.34 : 0.25);
    chalkStroke(g, [
      [cx - cw * 1.16, top + hh * 0.10], [cx - cw * 0.30, top - ch2], [cx + cw * 0.45, top - ch2 * 0.94],
      [cx + cw * 1.02, top + hh * 0.04],
    ], w, seed++, alpha, col);
    chalkStroke(g, [[cx - cw * 1.22, top + hh * 0.12], [cx - cw * 0.10, top + hh * 0.20], [cx + cw * 0.96, top + hh * 0.09]], w, seed++, alpha, col);
  }
  if (fam.ears > 1.2) {
    for (const sgn of [-1, 1]) {
      const ex = cx + sgn * hw * 0.56, ey = cy + hh * 0.03, er = hw * 0.16 * fam.ears;
      const ring = [];
      for (let i = 0; i <= 12; i++) { const t = (i / 12) * TAU; ring.push([ex + Math.cos(t) * er * 0.7, ey + Math.sin(t) * er]); }
      chalkStroke(g, ring, w * 0.85, seed++, alpha, col);
    }
  }
  const hd = HAIRDO[a.hairStyle || fam.hair];
  if (hd && (hd.tail === 'pig' || hd.tail === 'braid')) {
    for (const sgn of [-1, 1]) {
      chalkStroke(g, [
        [cx + sgn * hw * 0.52, cy - hh * 0.08], [cx + sgn * hw * 0.72, cy + hh * 0.24], [cx + sgn * hw * 0.58, cy + hh * 0.56],
      ], w * 0.9, seed++, alpha, col);
    }
  }
  return { hw, hh };
}

/* ============================================================================
   6. Paper — card stock, the halftone ground, the deckle
   ========================================================================= */

const STOCK = mix(CLOTH[1], PAVEMENT.blockCrown, 0.20);
const STOCK_HI = mix(CLOTH[3], CHALK, 0.12);

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** A flat colour ground with a printed dot screen over it: 1909 chromolithography. */
function halftone(g, x, y, w, h, base, dotCol, seed) {
  const r = new RNG(seed);
  g.save();
  g.fillStyle = C(base);
  g.fillRect(x, y, w, h);
  const pitch = Math.max(3.2, w * 0.026);
  g.fillStyle = C(dotCol);
  const cxr = x + w * 0.44, cyr = y + h * 0.34, rad = Math.hypot(w, h) * 0.60;
  for (let j = -1; j * pitch < h + pitch; j++) {
    for (let i = -1; i * pitch < w + pitch; i++) {
      const px = x + i * pitch + (j % 2 ? pitch * 0.5 : 0);
      const py = y + j * pitch;
      const d = Math.hypot(px - cxr, py - cyr) / rad;
      const s = clamp(d * 1.20 - 0.08, 0, 1) * pitch * 0.44 * r.range(0.78, 1.12);
      if (s < 0.35) continue;
      g.globalAlpha = 0.6;
      g.beginPath(); g.arc(px, py, s, 0, TAU); g.fill();
    }
  }
  g.restore();
}

function stockTexture(g, x, y, w, h, seed) {
  const r = new RNG(seed);
  g.save();
  for (let i = 0; i < Math.round(w * h * 0.008); i++) {
    g.globalAlpha = r.range(0.03, 0.11);
    g.fillStyle = r.chance(0.5) ? C(soot(STOCK, 0.35)) : C(STOCK_HI);
    g.fillRect(x + r.next() * w, y + r.next() * h, r.range(0.7, 2.0), r.range(0.7, 1.6));
  }
  for (let i = 0; i < 3; i++) {
    const px = x + r.range(0.1, 0.9) * w, py = y + r.range(0.1, 0.9) * h;
    const rad = r.range(w * 0.06, w * 0.18);
    const gr = g.createRadialGradient(px, py, 0, px, py, rad);
    gr.addColorStop(0, 'rgba(122,92,62,0.10)');
    gr.addColorStop(1, 'rgba(122,92,62,0)');
    g.globalAlpha = 1; g.fillStyle = gr;
    g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  g.restore();
}

/** Contact shadow under a card. Mandatory, tinted, never grey (§2.7). */
export function cardShadow(g, x, y, w, h, lift = 1) {
  g.save();
  const sp = Math.max(3, w * 0.030) * lift;
  const gr = g.createRadialGradient(x + w / 2, y + h * 0.97, w * 0.1, x + w / 2, y + h * 0.97, w * 0.90);
  gr.addColorStop(0, 'rgba(62,70,88,0.40)');
  gr.addColorStop(1, 'rgba(62,70,88,0)');
  g.fillStyle = gr;
  g.fillRect(x - w * 0.45, y + h * 0.5, w * 1.9, h * 0.85);
  g.globalAlpha = 0.32;
  g.fillStyle = C(AIR.shadowTint);
  rr(g, x + sp * 0.55, y + sp, w, h, w * 0.035);
  g.fill();
  g.restore();
}

/* ============================================================================
   7. The card
   ========================================================================= */

export const CARD_ASPECT = 0.545;         // 1.5in x 2.75in, near enough to a T206

/**
 * Chalk tally marks — the bible's own stat drawing. Four slots. A filled slot is a
 * bold chalk stroke; an empty one is a scuffed ghost, so the shape of a kid's line
 * reads before any word does.
 */
function tallies(g, x, y, w, h, n, seed, col) {
  const cell = w / MAX_STAT;
  for (let i = 0; i < MAX_STAT; i++) {
    const cx = x + cell * (i + 0.5);
    if (i < n) {
      chalkStroke(g, [[cx - cell * 0.17, y + h], [cx + cell * 0.13, y]], Math.max(2.0, h * 0.26), seed + i * 7, 1, col);
    } else {
      g.save();
      g.globalAlpha = 0.26;
      g.strokeStyle = col; g.lineWidth = Math.max(1, h * 0.10);
      g.beginPath(); g.moveTo(cx - cell * 0.14, y + h * 0.88); g.lineTo(cx + cell * 0.10, y + h * 0.12); g.stroke();
      g.restore();
    }
  }
}

/**
 * A card. detail:
 *   'full' — portrait, name, reputation, six chalk stat lines, footer
 *   'chip' — portrait and name plate only, for the pool on the picking screen
 */
export function drawCard(g, kidRef, x, y, w, h, o = {}) {
  const kid = getKid(kidRef);
  const a = kid.art;
  const accent = ACCENTS[a.accent] || ACCENTS.red;
  const detail = o.detail || (h < 250 ? 'chip' : 'full');
  const seed = kid.id.charCodeAt(0) * 13 + kid.id.length;
  const pad = w * 0.045;
  const R = w * 0.035;
  const pw = w - pad * 2, px = x + pad;

  g.save();

  rr(g, x, y, w, h, R);
  g.fillStyle = C(STOCK); g.fill();
  g.save(); rr(g, x, y, w, h, R); g.clip();
  stockTexture(g, x, y, w, h, seed);
  g.restore();

  /* portrait panel */
  const ph = detail === 'full' ? h * 0.452 : h * 0.700;
  const py = y + pad;
  g.save();
  rr(g, px, py, pw, ph, R * 0.5); g.clip();
  halftone(g, px, py, pw, ph, mix(accent, CLOTH[0], 0.34), mix(accent, INK, 0.30), seed + 5);
  g.fillStyle = C(mix(accent, PAVEMENT.blockCrown, 0.50));
  g.globalAlpha = 0.5;
  g.fillRect(px, py + ph * 0.72, pw, ph * 0.28);
  g.globalAlpha = 1;
  drawPortrait(g, kid, { x: px, y: py, w: pw, h: ph }, { mood: o.mood, zoom: o.zoom, teamBand: o.teamBand });
  g.restore();
  g.save();
  rr(g, px, py, pw, ph, R * 0.5);
  g.strokeStyle = C(INK); g.lineWidth = Math.max(1.2, w * 0.010); g.stroke();
  g.restore();

  /* name plate */
  const npY = py + ph + h * 0.012;
  const npH = detail === 'full' ? h * 0.092 : h * 0.135;
  g.save();
  rr(g, px, npY, pw, npH, R * 0.35);
  g.globalAlpha = 0.34;
  g.fillStyle = C(mix(accent, ACCENTS.red, 0.6));
  rr(g, px - 1.6, npY - 1.4, pw, npH, R * 0.35); g.fill();
  g.globalAlpha = 1;
  rr(g, px, npY, pw, npH, R * 0.35);
  g.fillStyle = C(accent); g.fill();
  g.strokeStyle = C(inkOf(accent)); g.lineWidth = Math.max(1, w * 0.008); g.stroke();
  g.restore();

  fitSlab(g, kid.nick, x + w / 2, npY + npH * 0.79, npH * 0.74, pw * 0.86, {
    color: C(mix(CHALK, CLOTH[0], 0.08)), tracking: 0.10, condense: 1, weight: 0.20,
    serif: npH * 0.13, jitter: 1, seed,
    shadow: { dx: npH * 0.06, dy: npH * 0.07, color: C(inkOf(accent)) },
  });

  if (detail === 'chip') {
    fitSlab(g, kid.tag ? `${kid.name} · ${kid.tag}` : kid.name, x + w / 2, y + h - h * 0.028, h * 0.036, pw * 0.96, {
      color: C(mix(INK, STOCK, 0.24)), tracking: 0.10, condense: 0.82, weight: 0.17, serif: h * 0.005, jitter: 0.5, seed: seed + 9,
    });
    g.restore();
    return;
  }

  /* ---- full card body ---------------------------------------------------- */
  const nameY = npY + npH + h * 0.042;
  fitSlab(g, kid.tag ? `${kid.name} · ${kid.tag}` : kid.name, x + w / 2, nameY, h * 0.032, pw * 0.98, {
    color: C(mix(INK, STOCK, 0.10)), tracking: 0.10, condense: 0.80, weight: 0.18,
    serif: h * 0.0045, jitter: 0.6, seed: seed + 1,
  });
  g.save();
  g.strokeStyle = C(mix(INK, STOCK, 0.52)); g.lineWidth = Math.max(0.8, w * 0.005);
  g.beginPath();
  g.moveTo(px + pw * 0.06, nameY + h * 0.014); g.lineTo(px + pw * 0.94, nameY + h * 0.014);
  g.stroke();
  g.restore();

  // the reputation: the one line you would say about him at the hydrant
  const repSize = h * 0.0285;
  const lead = repSize * 1.30;
  const repLines = wrap(kid.rep, repSize, pw * 0.98, { tracking: 0.09, condense: 0.78 }).slice(0, 4);
  let ry = nameY + h * 0.052;
  for (const line of repLines) {
    slab(g, line, x + w / 2, ry, repSize, {
      align: 'center', color: C(mix(INK, STOCK, 0.14)), tracking: 0.09, condense: 0.78, weight: 0.16,
      serif: repSize * 0.09, jitter: 0.5, seed: seed + line.length,
    });
    ry += lead;
  }

  // six chalk lines on a slate: two columns, three rows
  const slateY = y + h * 0.760;
  const slateH = h * 0.196;
  g.save();
  rr(g, px, slateY, pw, slateH, w * 0.02);
  g.fillStyle = C(mix(PAVEMENT.asphaltShade, INK, 0.30)); g.fill();
  g.strokeStyle = C(INK); g.lineWidth = Math.max(0.8, w * 0.005); g.stroke();
  g.restore();
  const cellW = pw / 2, rowH = (slateH - h * 0.024) / 3;
  for (let i = 0; i < STAT_KEYS.length; i++) {
    const key = STAT_KEYS[i];
    const col = i % 2, row = Math.floor(i / 2);
    const cx0 = px + col * cellW;
    const cy0 = slateY + h * 0.012 + row * rowH;
    const n = kid.stats[key];
    chalk(g, STAT_LABEL[key], cx0 + cellW * 0.06, cy0 + rowH * 0.80, rowH * 0.56, {
      color: C(CHALK), tracking: 0.08, condense: 0.72, weight: 0.14, seed: seed + key.length * 5, alpha: 0.94,
    });
    tallies(g, cx0 + cellW * 0.56, cy0 + rowH * 0.18, cellW * 0.38, rowH * 0.62, n,
      seed + key.charCodeAt(0), C(n === MAX_STAT ? mix(CHALK, ACCENTS.mustard, 0.40) : CHALK));
  }

  // the footer: age, block, and the set's card number
  fitSlab(g, `AGE ${kid.age} · ${kid.home} · MULBERRY ST.`, x + w / 2, y + h - h * 0.020, h * 0.0235, pw * 0.90, {
    color: C(mix(INK, STOCK, 0.36)), tracking: 0.12, condense: 0.76, weight: 0.16, serif: h * 0.003, jitter: 0.4, seed: seed + 2,
  });
  const num = (ROSTER.indexOf(kid) + 1).toString();
  const nr = w * (num.length > 1 ? 0.062 : 0.048);
  g.save();
  g.beginPath(); g.arc(px + pw - nr * 1.1, py + nr * 1.1, nr, 0, TAU);
  g.fillStyle = C(mix(STOCK, CHALK, 0.25)); g.fill();
  g.strokeStyle = C(INK); g.lineWidth = Math.max(1, w * 0.007); g.stroke();
  g.restore();
  slab(g, num, px + pw - nr * 1.1, py + nr * 1.1 + w * 0.021, w * 0.055, {
    align: 'center', color: C(mix(INK, STOCK, 0.10)), tracking: 0.02, condense: 0.72, weight: 0.20, serif: w * 0.009,
  });

  // an earned title runs across the corner, chalked on by whoever was keeping score
  if (kid.title) {
    g.save();
    g.translate(px + pw * 0.5, py + ph * 0.90);
    g.rotate(-0.075);
    g.globalAlpha = 0.62;
    g.fillStyle = C(mix(INK, FACADE.brickShade, 0.35));
    g.fillRect(-pw * 0.48, -h * 0.030, pw * 0.96, h * 0.042);
    g.globalAlpha = 1;
    fitChalk(g, kid.title, 0, 0, h * 0.033, pw * 0.94, {
      color: C(mix(CHALK, ACCENTS.mustard, 0.35)), tracking: 0.11, condense: 0.80, weight: 0.15, seed: seed + 8, alpha: 1,
    });
    g.restore();
  }

  g.restore();
}

/** The back of a card: the spares you keep in your pocket to flip against a wall. */
export function drawCardBack(g, x, y, w, h, seed = 3) {
  const R = w * 0.035;
  const r = new RNG(seed);
  g.save();
  rr(g, x, y, w, h, R);
  g.fillStyle = C(mix(STOCK, FACADE.brickShade, 0.10)); g.fill();
  g.save(); rr(g, x, y, w, h, R); g.clip();
  stockTexture(g, x, y, w, h, seed + 3);
  g.globalAlpha = 0.30;
  g.strokeStyle = C(mix(FACADE.brickShade, INK, 0.2)); g.lineWidth = Math.max(1, w * 0.008);
  for (let i = -8; i < 16; i++) {
    g.beginPath();
    g.moveTo(x + i * w * 0.14, y); g.lineTo(x + i * w * 0.14 + h * 0.5, y + h);
    g.stroke();
  }
  g.restore();
  g.globalAlpha = 1;
  rr(g, x + w * 0.09, y + h * 0.10, w * 0.82, h * 0.80, R * 0.6);
  g.strokeStyle = C(mix(FACADE.brickShade, INK, 0.30)); g.lineWidth = Math.max(1.2, w * 0.012); g.stroke();
  fitSlab(g, 'THE BLOCK', x + w / 2, y + h * 0.47, h * 0.07, w * 0.62, {
    color: C(mix(FACADE.brickShade, INK, 0.24)), tracking: 0.12, condense: 0.86, weight: 0.20, serif: h * 0.012, jitter: 1, seed,
  });
  fitSlab(g, 'ONE OF SIXTEEN', x + w / 2, y + h * 0.58, h * 0.036, w * 0.62, {
    color: C(mix(FACADE.brickShade, INK, 0.40)), tracking: 0.14, condense: 0.78, weight: 0.17, serif: h * 0.004, jitter: 0.6, seed: seed + 1,
  });
  void r;
  g.restore();
  cardEdge(g, x, y, w, h, seed);
}

/** Ink border and corner wear, drawn last so it sits over everything. */
export function cardEdge(g, x, y, w, h, seed = 1) {
  const R = w * 0.035;
  g.save();
  rr(g, x, y, w, h, R);
  g.strokeStyle = C(INK); g.lineWidth = Math.max(1.6, w * 0.013); g.stroke();
  rr(g, x + w * 0.021, y + w * 0.021, w - w * 0.042, h - w * 0.042, R * 0.6);
  g.strokeStyle = C(mix(INK, STOCK, 0.48)); g.lineWidth = Math.max(0.7, w * 0.004); g.stroke();
  const r = new RNG(seed);
  g.globalAlpha = 0.45;
  for (const [cx0, cy0] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    if (!r.chance(0.6)) continue;
    g.fillStyle = C(mix(STOCK, CHALK, 0.45));
    g.beginPath(); g.arc(cx0, cy0, r.range(w * 0.02, w * 0.05), 0, TAU); g.fill();
  }
  g.restore();
}

/* ============================================================================
   8. The cache — every card built once, at load, no network, no fetch
   ========================================================================= */

const CACHE = new Map();
export function cardCanvas(kidRef, w, h, o = {}) {
  const kid = getKid(kidRef);
  const key = `${kid.id}:${Math.round(w)}x${Math.round(h)}:${o.detail || ''}:${o.mood || ''}`;
  let c = CACHE.get(key);
  if (c) return c;
  c = canvas(w, h);
  const g = c.getContext('2d');
  drawCard(g, kid, 0, 0, w, h, o);
  cardEdge(g, 0, 0, w, h, kid.id.charCodeAt(0));
  CACHE.set(key, c);
  return c;
}

/** Portrait alone, no card — for a column chip or an announcer bug. */
export function bustCanvas(kidRef, size, o = {}) {
  const kid = getKid(kidRef);
  const key = `bust:${kid.id}:${size}:${o.mood || ''}`;
  let c = CACHE.get(key);
  if (c) return c;
  c = canvas(size, size);
  const g = c.getContext('2d');
  const accent = ACCENTS[kid.art.accent] || ACCENTS.red;
  g.save();
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.47, 0, TAU); g.clip();
  halftone(g, 0, 0, size, size, mix(accent, CLOTH[0], 0.36), mix(accent, INK, 0.30), kid.id.length * 11);
  drawPortrait(g, kid, { x: 0, y: -size * 0.04, w: size, h: size * 1.08 }, { ...o, zoom: 0.98 });
  g.restore();
  g.beginPath(); g.arc(size / 2, size / 2, size * 0.47, 0, TAU);
  g.strokeStyle = C(INK); g.lineWidth = Math.max(1.4, size * 0.035); g.stroke();
  CACHE.set(key, c);
  return c;
}

/* ============================================================================
   9. The screen — one 2D surface, shared with ui/teamselect.js
   ========================================================================= */

class Screen {
  constructor() { this.el = null; this.g = null; this.w = 0; this.h = 0; this.name = null; this.painter = null; }
  mount() {
    if (this.el) return;
    const c = document.createElement('canvas');
    c.id = 'sb-screen';
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
      display: 'none', zIndex: '60', touchAction: 'none', pointerEvents: 'none',
    });
    (document.getElementById('ui') || document.body).appendChild(c);
    this.el = c;
    this.g = c.getContext('2d');
  }
  open(name, painter) {
    this.mount();
    this.name = name; this.painter = painter;
    this.el.style.display = 'block';
    this.el.style.pointerEvents = 'auto';
    this.resize();
  }
  close() {
    this.name = null; this.painter = null;
    if (this.el) { this.el.style.display = 'none'; this.el.style.pointerEvents = 'none'; }
  }
  resize() {
    if (!this.el) return;
    const w = Math.max(640, Math.round(globalThis.innerWidth || 1600));
    const h = Math.max(360, Math.round(globalThis.innerHeight || 900));
    if (this.w !== w || this.h !== h) { this.el.width = w; this.el.height = h; this.w = w; this.h = h; }
  }
  at(e) {
    const r = this.el.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * this.w, ((e.clientY - r.top) / r.height) * this.h];
  }
  paint() {
    if (!this.painter || !this.el) return;
    this.resize();
    this.painter(this.g, this.w, this.h);
  }
}

export const screen = new Screen();

/* ============================================================================
   10. The ground both screens are drawn on
   ========================================================================= */

/**
 * The crown of the roadway: the brightest ground in the frame, warm taupe, worn to
 * Belgian block in patches (Law 1, §2.1). Cards get laid out on it the way a kid
 * lays cards out on it, and the chalk that is already there stays there.
 */
export function pavement(g, w, h, seed = 4, o = {}) {
  const r = new RNG(seed);
  const base = PAVEMENT.asphaltWarm;
  g.save();
  g.fillStyle = C(base); g.fillRect(0, 0, w, h);
  const vg = g.createRadialGradient(w * 0.5, h * 0.44, h * 0.10, w * 0.5, h * 0.52, h * 1.20);
  vg.addColorStop(0, C(PAVEMENT.blockCrown));
  vg.addColorStop(0.52, C(PAVEMENT.asphaltSun));
  vg.addColorStop(1, C(soot(PAVEMENT.asphaltShade, 0.18)));
  g.fillStyle = vg; g.fillRect(0, 0, w, h);
  // Belgian block coming through the worn tar, drawn as patches not as a tile
  for (let i = 0; i < 26; i++) {
    const cx = r.next() * w, cy = r.next() * h;
    const pw = r.range(w * 0.05, w * 0.16), ph = r.range(h * 0.05, h * 0.14);
    g.globalAlpha = r.range(0.10, 0.26);
    g.fillStyle = r.chance(0.55) ? C(PAVEMENT.belgianBlock) : C(PAVEMENT.asphaltDark);
    g.beginPath(); g.ellipse(cx, cy, pw, ph, r.next() * 3, 0, TAU); g.fill();
    if (r.chance(0.5)) {
      g.globalAlpha = 0.13;
      g.strokeStyle = C(soot(PAVEMENT.belgianBlock, 0.4)); g.lineWidth = 1.2;
      for (let k = -3; k <= 3; k++) {
        g.beginPath();
        g.moveTo(cx - pw, cy + (ph / 3.5) * k); g.lineTo(cx + pw, cy + (ph / 3.5) * k + r.range(-3, 3));
        g.stroke();
      }
    }
  }
  g.globalAlpha = 0.18;
  for (let i = 0; i < 140; i++) {
    const x = r.next() * w, y = r.next() * h, l = r.range(w * 0.008, w * 0.045);
    g.strokeStyle = r.chance(0.5) ? C(PAVEMENT.blockCrown) : C(soot(base, 0.30));
    g.lineWidth = r.range(0.6, 2.2);
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + l * r.range(-0.3, 0.3)); g.stroke();
  }
  g.restore();
  // the sun band: the 16-foot ribbon of direct sun a 1:1 canyon lets down at three
  // o'clock (PERIOD §6.1), baked in rather than lit, and the reason the middle is bright
  g.save();
  g.globalAlpha = 0.30;
  const bg = g.createLinearGradient(0, h * 0.10, w * 0.30, h * 0.92);
  bg.addColorStop(0, 'rgba(0,0,0,0)');
  bg.addColorStop(0.42, C(PAVEMENT.blockCrown));
  bg.addColorStop(0.58, C(PAVEMENT.blockCrown));
  bg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.restore();
  // the potsy grid somebody chalked here this morning and nobody has rubbed out
  if (o.potsy !== false) {
    g.save();
    g.globalAlpha = 0.16;
    const gx = w * 0.055, gy = h * 0.16, cell = w * 0.052;
    for (let i = 0; i <= 3; i++) chalkStroke(g, [[gx, gy + i * cell], [gx + cell * 2, gy + i * cell]], 3, 200 + i, 0.9, C(CHALK));
    for (let i = 0; i <= 2; i++) chalkStroke(g, [[gx + i * cell, gy], [gx + i * cell, gy + cell * 3]], 3, 210 + i, 0.9, C(CHALK));
    g.restore();
  }
}

/**
 * A bluestone sidewalk with its joints drawn (never tiled), ending in a granite
 * curb on the `side` given. Mid value, near-neutral, and it exists so the roadway
 * in the middle can be the brightest ground in the frame (Law 1).
 */
export function sidewalkBand(g, x, y, w, h, side = 1, seed = 5) {
  const r = new RNG(seed);
  const base = PAVEMENT.sidewalk;
  g.save();
  g.fillStyle = C(base); g.fillRect(x, y, w, h);
  const vg = g.createLinearGradient(x + (side > 0 ? w : 0), 0, x + (side > 0 ? 0 : w), 0);
  vg.addColorStop(0, C(mix(base, PAVEMENT.blockCrown, 0.30)));
  vg.addColorStop(1, C(soot(base, 0.22)));
  g.fillStyle = vg; g.globalAlpha = 0.75; g.fillRect(x, y, w, h);
  g.globalAlpha = 1;
  g.strokeStyle = C(soot(base, 0.42)); g.lineWidth = Math.max(1.5, w * 0.006);
  const fh = h / 5.5;
  for (let j = 1; j < 6; j++) {
    const yy = y + j * fh + r.range(-4, 4);
    g.beginPath(); g.moveTo(x, yy); g.lineTo(x + w, yy + r.range(-4, 4)); g.stroke();
  }
  const mx = x + w * 0.52 + r.range(-6, 6);
  g.beginPath(); g.moveTo(mx, y); g.lineTo(mx + r.range(-6, 6), y + h); g.stroke();
  g.globalAlpha = 0.14;
  for (let i = 0; i < 70; i++) {
    const px = x + r.next() * w, py = y + r.next() * h, l = r.range(6, 26);
    g.strokeStyle = r.chance(0.5) ? C(PAVEMENT.blockCrown) : C(soot(base, 0.34));
    g.lineWidth = r.range(0.6, 2.0);
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + l, py + l * r.range(-0.3, 0.3)); g.stroke();
  }
  g.globalAlpha = 1;
  // granite curb, then the gutter shadow where the sidewalk drops to the road
  const cw = Math.max(6, w * 0.05);
  const cx0 = side > 0 ? x + w - cw : x;
  g.fillStyle = C(PAVEMENT.curb); g.fillRect(cx0, y, cw, h);
  g.fillStyle = C(soot(PAVEMENT.curb, 0.30));
  g.fillRect(side > 0 ? cx0 + cw - cw * 0.34 : cx0, y, cw * 0.34, h);
  g.restore();
}

/* ============================================================================
   11. The sheet
   ========================================================================= */

const SHEET = { cols: 8, rows: 2 };

function paintSheet(g, W, H) {
  const S = Math.min(W / 1600, H / 900);
  const DW = 1600, DH = 900;
  pavement(g, W, H, 12);
  g.save();
  g.translate((W - DW * S) / 2, (H - DH * S) / 2);
  g.scale(S, S);

  const margin = 22, gapX = 7, gapY = 12;
  const cw = (DW - margin * 2 - gapX * (SHEET.cols - 1)) / SHEET.cols;
  const ch = cw / CARD_ASPECT;
  const top = 92;

  /* header: a torn strip of butcher paper, taped down, hand-lettered */
  const bw = DW * 0.52, bx = (DW - bw) / 2, by = 8, bh = 70;
  g.save();
  g.beginPath();
  const teeth = 30;
  g.moveTo(bx, by);
  for (let i = 0; i <= teeth; i++) g.lineTo(bx + (bw * i) / teeth, by + (i % 2 ? -1 : 1) * 1.4);
  g.lineTo(bx + bw, by + bh);
  for (let i = teeth; i >= 0; i--) g.lineTo(bx + (bw * i) / teeth, by + bh + (i % 2 ? 1 : -1) * 2.2);
  g.closePath();
  g.fillStyle = C(mix(CLOTH[0], CHALK, 0.28)); g.fill();
  g.strokeStyle = C(mix(INK, CLOTH[0], 0.55)); g.lineWidth = 1.2; g.stroke();
  g.restore();
  for (const s of [0, 1]) {
    g.save();
    g.translate(bx + s * bw, by + bh * 0.5);
    g.rotate(s ? -0.22 : 0.22);
    g.globalAlpha = 0.62;
    g.fillStyle = C(mix(ACCENTS.mustard, CLOTH[0], 0.45));
    g.fillRect(-26, -20, 52, 40);
    g.restore();
  }
  fitSlab(g, 'THE BLOCK  1925', DW / 2, by + bh * 0.74, 46, bw * 0.78, {
    color: C(mix(FACADE.brickShade, INK, 0.28)), tracking: 0.12, condense: 0.92,
    weight: 0.20, serif: 8, jitter: 1.2, seed: 21,
    shadow: { dx: 2.6, dy: 3, color: C(mix(ACCENTS.red, INK, 0.45)) },
  });

  /* the cards */
  const r = new RNG(97);
  for (let i = 0; i < ROSTER.length; i++) {
    const col = i % SHEET.cols, row = Math.floor(i / SHEET.cols);
    const x = margin + col * (cw + gapX);
    const y = top + row * (ch + gapY);
    const tilt = (r.next() - 0.5) * 0.026;
    g.save();
    g.translate(x + cw / 2, y + ch / 2);
    g.rotate(tilt);
    g.translate(-cw / 2, -ch / 2);
    cardShadow(g, 0, 0, cw, ch, 0.9);
    g.drawImage(cardCanvas(ROSTER[i], Math.round(cw), Math.round(ch), { detail: 'full' }), 0, 0);
    g.restore();
  }

  /* the curb, and what is chalked on it */
  const cy2 = top + SHEET.rows * ch + gapY + 14;
  g.save();
  g.fillStyle = C(PAVEMENT.curb); g.fillRect(0, cy2, DW, DH - cy2);
  g.fillStyle = C(soot(PAVEMENT.curb, 0.26)); g.fillRect(0, cy2, DW, 5);
  g.fillStyle = C(mix(PAVEMENT.sidewalk, PAVEMENT.blockCrown, 0.42)); g.fillRect(0, cy2 + 5, DW, DH - cy2 - 5);
  g.restore();
  // a chalked Spaldeen and a chalked stick, because somebody always draws them
  g.save();
  g.globalAlpha = 0.5;
  const bx0 = DW * 0.525, by0 = cy2 + (DH - cy2) * 0.52, br = 15;
  const ring = [];
  for (let i = 0; i <= 20; i++) ring.push([bx0 + Math.cos((i / 20) * TAU) * br, by0 + Math.sin((i / 20) * TAU) * br]);
  chalkStroke(g, ring, 3, 88, 0.9, C(CHALK));
  chalkStroke(g, [[bx0 - br * 0.5, by0 - br * 0.4], [bx0 + br * 0.1, by0 + br * 0.5]], 2.4, 89, 0.8, C(CHALK));
  g.restore();
  const noteY = cy2 + (DH - cy2) * 0.62;
  fitChalk(g, 'SIXTEEN KIDS · ONE STICK · ONE BALL · TILL THE LIGHTS COME ON', DW * 0.27, noteY, 24, DW * 0.46, {
    color: C(CHALK), tracking: 0.13, condense: 0.84, weight: 0.14, seed: 71, alpha: 0.94,
  });
  fitChalk(g, 'TWO LEFTYS. BOTH ANSWER. NOBODY HAS FIXED IT.', DW * 0.755, noteY, 24, DW * 0.42, {
    color: C(CHALK), tracking: 0.13, condense: 0.84, weight: 0.14, seed: 72, alpha: 0.94,
  });
  chalkStroke(g, [[DW * 0.525, cy2 + 20], [DW * 0.525, DH - 18]], 3, 73, 0.55, C(CHALK));
  g.restore();
}

/* ============================================================================
   12. Registration
   ========================================================================= */

export default registerSystem({
  name: 'portraits',
  order: 205,
  init() {
    screen.mount();
    if (typeof globalThis.addEventListener === 'function') {
      globalThis.addEventListener('resize', () => { if (screen.name) screen.resize(); });
    }
  },
  onScenario(name) {
    if (name !== 'portrait_sheet' && name !== 'team_select') screen.close();
  },
  preRender() { if (screen.name) screen.paint(); },
});

registerScenario('portrait_sheet', {
  seed: 1925,
  setup: () => { screen.open('portrait_sheet', paintSheet); },
  settle: 0.05,
});

export { paintSheet };

import * as THREE from 'three';
import { FACADE, PAVEMENT, AIR, ACCENTS, CHALK, INK } from '../render/palette.js';
import { RNG } from '../core/rng.js';
import { M, tc, tcCss, hexToLin, linToCss, scaleLin, shadeLin, texTint, litOf, rectUV, panel, FACE_N } from './facade.js';

/**
 * Storefronts and every painted word on the block.
 *
 * PERIOD-REFERENCE §4.1: everything here was lettered by a human being with a brush. There is
 * no vinyl and no logo lockup. So each line is drawn glyph by glyph with its own baseline
 * wobble and its own optical tracking, condensed to justify to the panel width, and shaded in
 * two extra colours — which is what a sign painter did and what a font does not do.
 *
 * Under-lettering the block is the most common way a period city scene reads generic, so the
 * density here is deliberately higher than a modeller's instinct.
 */

// Five faces, no more (§4.2). Stacks, because the bundle carries no font files.
const F = {
  gothic: '"Liberation Sans","DejaVu Sans","FreeSans","Arial",sans-serif',   // condensed grotesque
  slab: '"DejaVu Serif","Liberation Serif","FreeSerif",serif',               // fat egyptian
  roman: '"Liberation Serif","DejaVu Serif","FreeSerif",serif',              // cheltenham-ish
  script: '"DejaVu Serif","Liberation Serif",serif',                         // spencerian casual
  cjk: '"WenQuanYi Zen Hei","Noto Sans CJK SC",sans-serif',
};

function widthOf(g, text, track) {
  let w = 0;
  for (const ch of text) w += g.measureText(ch).width + track;
  return w - track;
}

/**
 * One hand-lettered line. Fitted to `w` by condensing (the painter stretched each line to
 * fill the panel), then drawn per glyph with a hard drop shadow and an outline.
 */
function letters(g, o) {
  const size = o.size, track = o.track ?? size * 0.06;
  const style = o.face === 'script' ? 'italic ' : '';
  g.font = `${style}${o.weight || 700} ${size}px ${F[o.face || 'gothic']}`;
  const natural = widthOf(g, o.text, track);
  const sx = o.fit === false ? Math.min(1, o.w / natural) : (o.w / natural);
  const r = new RNG(o.seed || 7);
  g.save();
  g.translate(o.x ?? 0, o.y);
  g.scale(Math.min(sx, o.maxStretch ?? 3), 1);
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  let x = 0;
  for (const ch of o.text) {
    const dy = r.range(-size * 0.018, size * 0.018);
    const rot = r.range(-0.007, 0.007);
    g.save();
    g.translate(x, dy);
    g.rotate(rot);
    if (o.shadow) {
      g.fillStyle = tcCss(o.shadow);
      g.fillText(ch, size * 0.055, size * 0.06);
    }
    if (o.outline) {
      g.lineWidth = size * (o.outlineW ?? 0.075);
      g.lineJoin = 'round';
      g.strokeStyle = tcCss(o.outline);
      g.strokeText(ch, 0, 0);
    }
    g.fillStyle = tcCss(o.fill);
    g.fillText(ch, 0, 0);
    if (o.high) {                       // a bevel catch-light on the upper left, gold-leaf work
      g.globalAlpha = 0.55;
      g.fillStyle = tcCss(o.high);
      g.fillText(ch, -size * 0.02, -size * 0.022);
      g.globalAlpha = 1;
    }
    g.restore();
    x += g.measureText(ch).width + track;
  }
  g.restore();
  return sx;
}

/** Centre a fitted line inside a box of width W. */
function centred(g, o, W) {
  W = W ?? o.w;
  const track = o.track ?? o.size * 0.06;
  const style = o.face === 'script' ? 'italic ' : '';
  g.font = `${style}${o.weight || 700} ${o.size}px ${F[o.face || 'gothic']}`;
  const natural = widthOf(g, o.text, track);
  const sx = Math.min(o.w / natural, o.maxStretch ?? 3);
  letters(g, { ...o, x: (W - natural * sx) / 2, fit: true });
}

// ─── the shops, from PERIOD-REFERENCE §4.5 ────────────────────────────────────
// name, the lines on the sign band, the awning colours, and the gold leaf on the glass.
export const SHOPS = {
  grocer: {
    band: { bg: 0x2e4034, lines: [['GRISTEDE BROS.', 1.0, 0xe6c96a], ['FANCY GROCERIES', 0.42, 0xe6dbc0]] },
    glass: [['GROCERIES', 0.5], ['FRUIT · VEGETABLES', 0.3]],
    awning: [0x2f7f63, 0xddd2b8], goods: 'produce', tile: 'G',
  },
  barber: {
    band: { bg: 0x5a2a24, lines: [['BARBER SHOP', 1.0, 0xe6dbc0], ['HAIR CUT 25¢ · SHAVE 15¢', 0.36, 0xe6c96a]] },
    glass: [['SHAVE 15¢', 0.46], ['CHILDREN 15¢', 0.3]],
    awning: [0xb03a5e, 0xddd2b8], goods: 'none', pole: true, tile: 'B',
  },
  tailor: {
    band: { bg: 0x332f2c, lines: [['S. LEVINE · TAILOR', 0.86, 0xe6c96a], ['CLEANING · PRESSING · DYEING', 0.34, 0xe6dbc0]] },
    glass: [['SUITS PRESSED 50¢', 0.4], ['REPAIRING', 0.3]],
    awning: null, goods: 'none', tile: 'L',
  },
  cigar: {
    band: { bg: 0x7b1f1f, lines: [['UNITED CIGAR STORES', 0.8, 0xe6c96a], ['CIGARS · CIGARETTES · CANDY · SODA', 0.34, 0xe6dbc0]] },
    glass: [['ICE CREAM SODA 5¢', 0.42], ['EGG CREAM 3¢', 0.3]],
    awning: [0xc8a23a, 0xddd2b8], goods: 'papers', tile: 'C',
  },
  deli: {
    band: { bg: 0x2f5f3f, lines: [['SALUMERIA', 1.0, 0xe6dbc0], ['LATTICINI FRESCHI · OLIO D’OLIVA', 0.32, 0xe6c96a]] },
    glass: [['PANE FRESCO', 0.42], ['OGNI GIORNO', 0.3]],
    awning: [0x8a2f2f, 0xddd2b8], goods: 'produce', tile: 'S',
  },
  shoe: {
    band: { bg: 0x3a3020, lines: [['SHOE REPAIRING WHILE U WAIT', 0.66, 0xe6dbc0], ['HEELS 40¢ · SOLES 75¢', 0.4, 0xe0a62b]] },
    glass: [['SHINE 10¢', 0.5]],
    awning: null, goods: 'none', tile: 'R',
  },
  fivedime: {
    band: { bg: 0x9c2a22, lines: [['F. W. WOOLWORTH CO.', 0.78, 0xe6c96a], ['5¢ AND 10¢ STORE', 0.46, 0xe6dbc0]] },
    glass: [['NOTHING OVER 10¢', 0.36]],
    awning: [0x8a6a2a, 0xddd2b8], goods: 'crates', tile: 'W',
  },
  lunch: {
    band: { bg: 0x24384c, lines: [['LUNCH ROOM', 1.0, 0xe6dbc0], ['REGULAR DINNER 35¢ · COFFEE 5¢', 0.32, 0xe6c96a]] },
    glass: [['SODA · CIGARS', 0.4], ['OPEN ALL NIGHT', 0.28]],
    awning: [0x3b5ea0, 0xddd2b8], goods: 'none', tile: 'N',
  },
  laundry: {
    band: { bg: 0x1f4038, lines: [['HAND LAUNDRY', 0.92, 0xe6dbc0], ['SHIRTS 8¢ · COLLARS 3¢', 0.36, 0xe6c96a]] },
    glass: [['洗衣', 0.6, 'cjk'], ['SHIRTS 8¢', 0.3]],
    awning: null, goods: 'none', tile: 'H',
  },
  ice: {
    band: { bg: 0x3d4a52, lines: [['COAL · WOOD · ICE', 0.9, 0xe6dbc0], ['DELIVERED TO ALL FLOORS', 0.34, 0xe6c96a]] },
    glass: [['ICE 10¢', 0.5]],
    awning: null, goods: 'crates', tile: 'I',
  },
  fish: {
    band: { bg: 0x2b4a5e, lines: [['FISH MARKET', 1.0, 0xe6dbc0], ['CARP · WHITEFISH · PIKE', 0.34, 0xe6c96a]] },
    glass: [['FRESH DAILY', 0.44]],
    awning: [0x2e6e6e, 0xddd2b8], goods: 'crates', tile: 'F',
  },
};

// ─── atlas art ────────────────────────────────────────────────────────────────
/** A shop's sign band: the most important word 3:1 bigger, shaded, filling the panel. */
function drawBand(g, w, h, spec, seed) {
  const r = new RNG(seed);
  g.fillStyle = tcCss(spec.bg); g.fillRect(0, 0, w, h);
  // panel is a painted board: give it a grain and a lit top edge
  const base = tc(spec.bg);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = linToCss(scaleLin(base, 1 + r.range(-0.10, 0.10)));
    g.fillRect(r.range(0, w), r.range(0, h), r.range(20, 120), r.range(2, 7));
  }
  g.fillStyle = linToCss(scaleLin(base, 1.35)); g.fillRect(0, 0, w, h * 0.045);
  g.fillStyle = linToCss(scaleLin(base, 0.62)); g.fillRect(0, h * 0.955, w, h * 0.045);
  // a fine painted rule inside the panel edge
  g.strokeStyle = tcCss(0xe6c96a); g.globalAlpha = 0.5;
  g.lineWidth = Math.max(1, h * 0.018);
  g.strokeRect(w * 0.012, h * 0.09, w * 0.976, h * 0.82);
  g.globalAlpha = 1;

  const lines = spec.lines;
  const total = lines.reduce((s, l) => s + l[1], 0);
  let y = h * 0.10;
  for (let i = 0; i < lines.length; i++) {
    const [text, rel, colour] = lines[i];
    const band = (h * 0.80) * (rel / total);
    const size = band * 0.94;
    y += band;
    centred(g, {
      text, y: y - band * 0.16, w: w * 0.94, size,
      face: i === 0 ? 'slab' : 'gothic',
      fill: colour, shadow: 0x1c1512, outline: 0x241a16, outlineW: 0.05,
      high: i === 0 ? 0xfff0c0 : null,
      seed: seed + i * 13, maxStretch: 1.9,
    }, w);
  }
}

/** Gold leaf on the inside of the plate glass: a bright warm ribbon on a dark window. */
function drawGlass(g, w, h, spec, seed) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, tcCss(0x4d5a63));
  grad.addColorStop(0.34, tcCss(0x333f47));
  grad.addColorStop(1, tcCss(0x3a3a38));
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  // the sky reflected in the top of the glass, and the street's shapes below it
  g.globalAlpha = 0.5; g.fillStyle = tcCss(AIR.skyLower);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w, h * 0.20); g.lineTo(0, h * 0.30); g.fill();
  g.globalAlpha = 1;
  // goods stacked behind the glass, in silhouette
  const r = new RNG(seed);
  for (let i = 0; i < 14; i++) {
    g.fillStyle = linToCss(scaleLin(tc(0x6b5a44), r.range(0.7, 1.25)));
    const bw = r.range(w * 0.05, w * 0.13), bh = r.range(h * 0.08, h * 0.26);
    g.fillRect(r.range(0, w - bw), h - bh - r.range(0, h * 0.10), bw, bh);
  }
  let y = h * 0.30;
  for (const [text, rel, face] of spec) {
    const size = h * rel * 0.62;
    y += size;
    centred(g, {
      text, y, w: w * 0.86, size, face: face || 'roman', weight: 700,
      fill: 0xe8c25e, outline: 0x2a1d1a, outlineW: 0.09, high: 0xfff2c4,
      seed: seed + 3, maxStretch: 1.5,
    }, w);
    y += size * 0.35;
  }
  // a hairline gold rule above and below the lettering, as the gilder ruled it
  g.strokeStyle = tcCss(0xe8c25e); g.lineWidth = Math.max(1, h * 0.008);
  g.beginPath(); g.moveTo(w * 0.08, h * 0.28); g.lineTo(w * 0.92, h * 0.28);
  g.moveTo(w * 0.08, y + h * 0.03); g.lineTo(w * 0.92, y + h * 0.03); g.stroke();
}

/** Striped canvas awning, sun-bleached on top, with a scalloped valance. */
function drawAwning(g, w, h, cols, seed) {
  const r = new RNG(seed);
  const [a, b] = cols;
  const stripe = w / 13;
  for (let i = 0; i * stripe < w; i++) {
    g.fillStyle = tcCss(i % 2 ? a : b);
    g.fillRect(i * stripe, 0, stripe + 0.5, h);
  }
  // bleached along the crown, dirtier at the fold
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, 'rgba(255,246,220,0.34)');
  gr.addColorStop(0.55, 'rgba(255,246,220,0.05)');
  gr.addColorStop(1, 'rgba(60,48,40,0.20)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9; i++) {                    // the pipe frame reads through the canvas
    g.fillStyle = 'rgba(40,32,26,0.13)';
    g.fillRect(r.range(0, w), 0, 2.5, h);
  }
  g.fillStyle = 'rgba(70,58,44,0.35)';             // a split somebody never repaired
  g.fillRect(w * 0.62, h * 0.1, 2, h * 0.55);
}

function drawValance(g, w, h, cols, seed) {
  const [a, b] = cols;
  const stripe = w / 13;
  const scallop = w / 9;
  g.save();
  g.beginPath();
  for (let i = 0; i * scallop < w + scallop; i++) {
    g.moveTo(i * scallop, 0);
    g.lineTo(i * scallop, h * 0.45);
    g.arc(i * scallop + scallop / 2, h * 0.45, scallop / 2, Math.PI, 0, true);
    g.lineTo((i + 1) * scallop, 0);
  }
  g.closePath(); g.clip();
  for (let i = 0; i * stripe < w; i++) {
    g.fillStyle = tcCss(i % 2 ? a : b);
    g.fillRect(i * stripe, 0, stripe + 0.5, h);
  }
  g.fillStyle = 'rgba(46,38,30,0.26)'; g.fillRect(0, 0, w, h);
  g.restore();
}

/**
 * A wall ad on an exposed party wall, in three layers of history (§4.4): a ghost from the
 * nineties, a half-faded ad over it, and a fresher one on top. Paint sinks into the brick, so
 * the lettering is knocked back by the courses and eaten from the top down.
 */
function drawGhostWall(g, w, h, spec, seed) {
  const r = new RNG(seed);
  const base = tc(spec.ground ?? FACADE.partyWall);
  g.fillStyle = tcCss(spec.ground ?? FACADE.partyWall); g.fillRect(0, 0, w, h);
  const courseH = h / spec.ftH * (2.625 / 12) * 2;   // two courses per drawn band, for legibility
  for (let y = 0; y < h; y += courseH) {
    g.fillStyle = linToCss(scaleLin(base, 1 + r.range(-0.06, 0.05)));
    g.fillRect(0, y, w, courseH * 0.86);
  }
  for (let i = 0; i < 40; i++) {                    // patchy repaint and weather
    g.fillStyle = linToCss(scaleLin(base, 1 + r.range(-0.12, 0.09)));
    g.fillRect(r.range(0, w), r.range(0, h), r.range(20, 140), r.range(8, 46));
  }
  // layer 1 — the ghost, barely there
  if (spec.ghost) {
    g.globalAlpha = 0.20;
    centred(g, { text: spec.ghost, y: h * 0.85, w: w * 0.9, size: h * 0.22, face: 'slab', fill: 0xd8cfb8, seed: seed + 1, maxStretch: 2.4 }, w);
    g.globalAlpha = 1;
  }
  // layer 2 — half faded
  if (spec.faded) {
    g.globalAlpha = 0.42;
    let y = h * 0.42;
    for (const [t, rel] of spec.faded) {
      const s = h * rel;
      centred(g, { text: t, y: y + s, w: w * 0.88, size: s, face: 'gothic', fill: spec.fadedColour ?? 0xb8503c, seed: seed + 2, maxStretch: 2.4 }, w);
      y += s * 1.15;
    }
    g.globalAlpha = 1;
  }
  // layer 3 — the live ad
  let y = h * 0.10;
  const total = spec.lines.reduce((s, l) => s + l[1], 0);
  for (const [t, rel, colour, face] of spec.lines) {
    const s = (h * 0.52) * (rel / total);
    y += s;
    centred(g, {
      text: t, y, w: w * 0.86, size: s * 0.95, face: face || 'slab',
      fill: colour, outline: spec.outline ?? 0x2a1d1a, outlineW: 0.06,
      shadow: spec.shadow ?? null, seed: seed + 3, maxStretch: 2.2,
    }, w);
    y += s * 0.22;
  }
  // weather eats it from the top down and from the windward corner in
  const gr = g.createLinearGradient(0, 0, w * 0.4, h * 0.5);
  gr.addColorStop(0, `rgba(${spec.eat ?? '184,168,142'},0.55)`);
  gr.addColorStop(1, `rgba(${spec.eat ?? '184,168,142'},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.16; g.fillStyle = tcCss(0x8a7a62);
  for (let i = 0; i < 26; i++) g.fillRect(r.range(0, w), r.range(0, h), r.range(10, 60), r.range(4, 20));
  g.globalAlpha = 1;
}

/** Paper pasted on brick, torn, one bill fresh and one sun-bleached (§4.5 items 48–54). */
function drawBills(g, w, h, seed) {
  const r = new RNG(seed);
  g.clearRect(0, 0, w, h);
  const bills = [
    { x: 0.02, y: 0.30, w: 0.44, h: 0.66, bg: 0xd8cdb0, fade: 0.42, lines: [['HYLAN', 0.30, 0x2a2a2a], ['FOR MAYOR', 0.14, 0x2a2a2a]] },
    { x: 0.30, y: 0.10, w: 0.40, h: 0.60, bg: 0xe8dcbe, fade: 0.10, lines: [['WALKER', 0.30, 0x9c2a22], ['FOR MAYOR', 0.13, 0x24384c]] },
    { x: 0.58, y: 0.24, w: 0.40, h: 0.72, bg: 0xefe6cf, fade: 0.0, lines: [['HAROLD LLOYD', 0.15, 0x1c1512], ['THE FRESHMAN', 0.22, 0x9c2a22], ['NOW PLAYING', 0.10, 0x1c1512]] },
  ];
  for (const b of bills) {
    const bx = b.x * w, by = b.y * h, bw = b.w * w, bh = b.h * h;
    g.save();
    g.beginPath();                                   // a torn edge, not a rectangle
    g.moveTo(bx, by);
    for (let i = 0; i <= 8; i++) g.lineTo(bx + bw * (i / 8), by + r.range(-2, 3));
    for (let i = 0; i <= 6; i++) g.lineTo(bx + bw + r.range(-2, 2), by + bh * (i / 6));
    for (let i = 8; i >= 0; i--) g.lineTo(bx + bw * (i / 8), by + bh + r.range(-3, 2));
    g.closePath(); g.clip();
    g.fillStyle = tcCss(b.bg); g.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
    let y = by + bh * 0.16;
    for (const [t, rel, col] of b.lines) {
      const s = bh * rel;
      y += s;
      g.save(); g.translate(bx, 0);
      centred(g, { text: t, y, w: bw * 0.88, size: s, face: 'slab', fill: col, seed: seed + 5, maxStretch: 2.0 }, bw);
      g.restore();
      y += s * 0.18;
    }
    if (b.fade) { g.fillStyle = `rgba(214,204,178,${b.fade})`; g.fillRect(bx - 4, by - 4, bw + 8, bh + 8); }
    g.restore();
  }
  g.globalAlpha = 0.5; g.fillStyle = tcCss(0x6b5a44);
  g.fillRect(0, 0, w, 2);
  g.globalAlpha = 1;
}

/** Hexagonal white tile with the shop's initial laid in black — §8 item 34. */
function drawTile(g, w, h, letter, seed) {
  const r = new RNG(seed);
  g.fillStyle = tcCss(0xcfc9ba); g.fillRect(0, 0, w, h);
  const R = w / 16;
  for (let row = 0; row * R * 1.5 < h + R; row++) {
    for (let col = 0; col * R * 1.74 < w + R; col++) {
      const cx = col * R * 1.74 + (row % 2) * R * 0.87, cy = row * R * 1.5;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92);
      }
      g.closePath();
      g.fillStyle = linToCss(scaleLin(tc(0xe4dfd0), 1 + r.range(-0.07, 0.03)));
      g.fill();
    }
  }
  centred(g, { text: letter, y: h * 0.74, w: w * 0.5, size: h * 0.66, face: 'roman', fill: 0x2f2b26, seed: seed, maxStretch: 1.2 }, w);
  g.globalAlpha = 0.25; g.fillStyle = tcCss(0x6b5a44);
  for (let i = 0; i < 10; i++) g.fillRect(r.range(0, w), r.range(0, h), r.range(4, 20), r.range(4, 14));
  g.globalAlpha = 1;
}

/** Transom prism glass — ribbed, throwing daylight to the back of the shop. */
function drawTransom(g, w, h, seed) {
  const r = new RNG(seed);
  g.fillStyle = tcCss(0x6e7a72); g.fillRect(0, 0, w, h);
  const n = 26;
  for (let i = 0; i < n; i++) {
    const x = (i / n) * w;
    g.fillStyle = linToCss(scaleLin(tc(0x8fa08e), 1 + r.range(-0.12, 0.16)));
    g.fillRect(x, 0, w / n - 1, h);
  }
  g.fillStyle = tcCss(0x2e4034);
  for (let i = 0; i <= 5; i++) g.fillRect((i / 5) * w - 1.5, 0, 3, h);
  g.fillRect(0, 0, w, 2.5); g.fillRect(0, h - 2.5, w, 2.5);
}

const ROOF_SIGNS = [
  { lines: [['ROOMS TO LET', 1.0, 0xe6dbc0], ['INQUIRE WITHIN', 0.4, 0xe6c96a]], bg: 0x3a3228 },
  { lines: [['MOXIE', 1.0, 0xe87a2a], ['DRINK IT', 0.4, 0xe6dbc0]], bg: 0x1f3a6e },
];

/** Draw every lettered thing into the shared atlas. Called once, at init. */
export function registerSignSprites(atlas, plan) {
  for (const [key, shop] of Object.entries(SHOPS)) {
    atlas.add(`band:${key}`, 544, 68, (g, w, h) => drawBand(g, w, h, shop.band, key.length * 97 + 11));
    atlas.add(`glass:${key}`, 232, 124, (g, w, h) => drawGlass(g, w, h, shop.glass, key.length * 31 + 5));
    atlas.add(`tile:${key}`, 84, 84, (g, w, h) => drawTile(g, w, h, shop.tile, key.length * 17));
    if (shop.awning) {
      atlas.add(`awn:${key}`, 256, 96, (g, w, h) => drawAwning(g, w, h, shop.awning, key.length * 13));
      atlas.add(`val:${key}`, 256, 44, (g, w, h) => drawValance(g, w, h, shop.awning, key.length * 19));
    }
  }
  atlas.add('transom', 320, 40, (g, w, h) => drawTransom(g, w, h, 3));
  atlas.add('bills', 236, 168, (g, w, h) => drawBills(g, w, h, 41));
  atlas.add('bills2', 236, 168, (g, w, h) => drawBills(g, w, h, 77));

  // Wall ads. Every one of these is a real 1925 New York advertisement.
  const walls = {
    uneeda: {
      ftH: 24, ground: 0xb8a88e,
      lines: [['UNEEDA', 1.0, 0xe6dbc0], ['BISCUIT', 0.8, 0xe6dbc0], ['5¢', 0.62, 0xe0a62b]],
      outline: 0x1f2f52, shadow: 0x1f2f52,
      faded: [['OMEGA OIL', 0.10], ['IT’S GREEN', 0.07]], fadedColour: 0x3f7a4a,
      ghost: 'SAPOLIO',
    },
    goldDust: {
      ftH: 22, ground: 0xb2a48c,
      lines: [['GOLD DUST', 1.0, 0xe0a62b], ['WASHING POWDER', 0.42, 0xe6dbc0]],
      outline: 0x2a1d1a, faded: [['BULL DURHAM', 0.09]], fadedColour: 0x8a6a54,
      ghost: 'RUPPERT',
    },
    castoria: {
      ftH: 20, ground: 0xbaa88c,
      lines: [['FLETCHER’S', 0.62, 0xe6dbc0], ['CASTORIA', 1.0, 0xe6dbc0], ['CHILDREN CRY FOR IT', 0.30, 0xe0a62b]],
      outline: 0x6b2020, shadow: 0x6b2020, ghost: 'SAPOLIO',
    },
  };
  for (const [k, spec] of Object.entries(walls)) {
    atlas.add(`ghost:${k}`, 352, 288, (g, w, h) => drawGhostWall(g, w, h, spec, k.length * 53 + 7));
  }
  ROOF_SIGNS.forEach((s, i) => {
    atlas.add(`roofsign:${i}`, 384, 96, (g, w, h) => drawBand(g, w, h, s, 200 + i * 31));
  });
  atlas.add('postnobills', 208, 34, (g, w, h) => {
    g.fillStyle = tcCss(0x6b4235); g.fillRect(0, 0, w, h);
    centred(g, { text: 'POST NO BILLS', y: h * 0.76, w: w * 0.9, size: h * 0.72, face: 'gothic', fill: 0xd8cfb8, seed: 9, maxStretch: 2 }, w);
  });
  atlas.add('numbers', 76, 38, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    centred(g, { text: '2214', y: h * 0.8, w: w * 0.8, size: h * 0.85, face: 'roman', fill: 0xe8c25e, outline: 0x2a1d1a, outlineW: 0.1, seed: 4, maxStretch: 1.2 }, w);
  });
}


// ─── storefront geometry ──────────────────────────────────────────────────────
const GLASS_BOT = 2.55, GLASS_TOP = 8.9, TRANSOM_TOP = 10.0, BAND_TOP = 12.15;

/**
 * One 25ft shopfront: bulkhead, plate glass with gold leaf on the inside face, prism transom,
 * a hand-lettered sign band, a recessed entry with a hex-tile floor and the shop's initial in
 * it, an awning cranked down over the afternoon sun, and goods spilling onto the walk.
 */
export function buildStorefront(ctx, lot) {
  const shop = SHOPS[lot.shop];
  const T = ctx.b('trim'), S = ctx.b('sign');
  const A = ctx.atlas;
  const o = lot.out, xf = lot.xf, front = lot.front;
  const X = (d0, d1) => (o < 0 ? [xf - d1, xf - d0] : [xf + d0, xf + d1]);
  const z0 = lot.z0, z1 = lot.z0 + M.lot;
  const y0 = M.walkY;
  const r = new RNG(Math.round(lot.z0 * 7) + 3001);
  const woodwork = (dark) => (f, n, c) => shadeLin(lot.bulkhead, litOf(n, c[0], c[1], c[2]) * 0.7, f === front ? 0 : dark);

  // cast-iron pier at each end, carrying the wall above
  const pierW = 1.15;
  for (const pz of [z0, z1 - pierW]) {
    const [a, b] = X(0, 0.6);
    T.box(a, y0, pz, b, BAND_TOP, pz + pierW, woodwork(0.28), `${front} py pz nz`);
  }
  const iz0 = z0 + pierW, iz1 = z1 - pierW;
  const entryW = 5.2;
  const ez0 = iz0 + (iz1 - iz0) * 0.54, ez1 = ez0 + entryW;
  const recess = 3.3;

  for (const [a, b] of [[iz0, ez0], [ez1, iz1]]) {
    // bulkhead, scuffed to bare wood at kick height
    const [bx0, bx1] = X(0, 0.45);
    T.box(bx0, y0, a, bx1, GLASS_BOT, b, woodwork(0.3), `${front} py`);
    T.box(bx0 - 0.03, y0 + 0.15, a, bx1 + 0.03, y0 + 0.4, b,
      (f, n, c) => shadeLin(0x8a6a54, litOf(n, c[0], c[1], c[2]) * 0.6, 0.2), `${front} py`);
    // plate glass with gold-leaf lettering behind it
    panel(S, lot, 0.22, a + 0.12, b - 0.12, GLASS_BOT, GLASS_TOP,
      texTint(0, 0.05), rectUV(A.get(`glass:${lot.shop}`)));
    // wooden mullion and frame
    const mz = (a + b) / 2;
    const [mx0, mx1] = X(0.1, 0.42);
    T.box(mx0, GLASS_BOT, mz - 0.17, mx1, GLASS_TOP, mz + 0.17, woodwork(0.2), `${front} pz nz`);
    T.box(mx0, GLASS_TOP - 0.26, a, mx1, GLASS_TOP, b, woodwork(0.2), `${front} py ny`);
    T.box(mx0, GLASS_BOT, a, mx1, GLASS_BOT + 0.22, b, woodwork(0.2), `${front} py ny`);
  }

  // the recessed entry
  {
    const [rx0, rx1] = X(0, recess);
    for (const wz of [[ez0 - 0.14, ez0 + 0.14], [ez1 - 0.14, ez1 + 0.14]]) {
      T.box(rx0, y0, wz[0], rx1, TRANSOM_TOP, wz[1], () => shadeLin(0x6b4235, 0, 0.30), 'px nx py');
    }
    S.quad([rx0, y0 + 0.03, ez0 + 0.14], [rx1, y0 + 0.03, ez0 + 0.14], [rx1, y0 + 0.03, ez1 - 0.14], [rx0, y0 + 0.03, ez1 - 0.14],
      texTint(0, 0.26), rectUV(A.get(`tile:${lot.shop}`)), [0, 1, 0]);
    // the door, at the back of the recess, standing open a hand's width
    const dz0 = ez0 + 0.45, dz1 = ez1 - 0.45;
    const [dx0, dx1] = X(recess - 0.2, recess);
    T.box(dx0, y0, dz0, dx1, 9.3, dz1, () => shadeLin(lot.doorHex, 0, 0.34), `${o < 0 ? 'nx' : 'px'} py`);
    panel(S, lot, recess - 0.22, dz0 + 0.3, dz1 - 0.3, 4.4, 8.5, texTint(0, 0.36), rectUV(A.get('transom')));
    T.box(rx0, TRANSOM_TOP, ez0, rx1, TRANSOM_TOP + 0.25, ez1, () => shadeLin(0x6b4235, 0, 0.42), 'ny');
  }

  // transom band of prism glass, throwing daylight to the back of the shop
  panel(S, lot, 0.2, iz0, iz1, GLASS_TOP, TRANSOM_TOP, texTint(0, 0.06), rectUV(A.get('transom')));

  // sign band — the loudest thing at eye level on the whole block
  {
    const [bx0, bx1] = X(0, 0.62);
    T.box(bx0, TRANSOM_TOP, z0, bx1, BAND_TOP, z1, () => shadeLin(0x2f2823, 0, 0.15), 'py ny');
    panel(S, lot, 0.63, z0 + 0.06, z1 - 0.06, TRANSOM_TOP + 0.1, BAND_TOP - 0.08,
      texTint(litOf(FACE_N[front], xf, 11, z0 + 12) * 0.9), rectUV(A.get(`band:${lot.shop}`)));
  }

  // awning: canvas, striped, cranked down, valance scalloped, 7ft above the walk
  if (shop.awning && lot.awning !== false) {
    const proj = 5.4, backY = TRANSOM_TOP - 0.15, frontY = 7.6;
    const bx = xf + o * 0.05, fx = xf + o * proj;
    const a = [bx, backY, iz0], b = [bx, backY, iz1], c = [fx, frontY, iz1], d = [fx, frontY, iz0];
    const slot = A.get(`awn:${lot.shop}`);
    const nTop = normal3(o < 0 ? d : a, o < 0 ? c : b, o < 0 ? b : c);
    const top = texTint(Math.max(litOf(nTop, bx, backY, (iz0 + iz1) / 2), 0.12));
    const under = texTint(0, 0.40);
    if (o < 0) { S.quad(d, c, b, a, top, rectUV(slot)); S.quad(a, b, c, d, under, rectUV(slot)); }
    else { S.quad(a, b, c, d, top, rectUV(slot)); S.quad(d, c, b, a, under, rectUV(slot)); }
    // scalloped valance hanging off the leading edge
    const vs = A.get(`val:${lot.shop}`);
    const v = 1.15;
    const V0 = [fx, frontY, iz0], V1 = [fx, frontY, iz1], V2 = [fx, frontY - v, iz1], V3 = [fx, frontY - v, iz0];
    if (o < 0) S.quad(V3, V2, V1, V0, texTint(0, 0.10), rectUV(vs));
    else S.quad(V2, V3, V0, V1, texTint(0, 0.10), rectUV(vs));
    // pipe frame
    for (const pz of [iz0 + 0.12, iz1 - 0.12]) {
      const lo = Math.min(bx, fx), hi = Math.max(bx, fx);
      T.box(lo, frontY - 0.07, pz - 0.06, hi, frontY + 0.07, pz + 0.06, () => shadeLin(0x4a4a44, 0.2), 'px nx py ny pz nz');
      T.box(xf + o * 0.05 - 0.06, frontY, pz - 0.05, xf + o * 0.05 + 0.06, backY, pz + 0.05, () => shadeLin(0x4a4a44, 0.1), 'px nx pz nz');
    }
  }

  // goods spilling 3-4ft onto the walk — stores in 1925 do not stay inside their walls
  const gz = lot.z0 + M.lot * 0.12;
  if (shop.goods === 'produce') {
    for (let i = 0; i < 3; i++) {
      const [cx0, cx1] = X(1.0 + r.range(0, 0.4), 3.5);
      const zz = gz + i * 2.5;
      T.box(cx0, y0, zz, cx1, y0 + 1.45, zz + 2.0, (f, n, c) => shadeLin(0x8a6a44, litOf(n, c[0], c[1], c[2]) + (f === 'py' ? 0.15 : 0), f === 'py' ? 0 : 0.12), 'px nx py pz nz');
      for (let k = 0; k < 7; k++) {
        const px = r.range(cx0 + 0.25, cx1 - 0.25), pz = r.range(zz + 0.25, zz + 1.75);
        const c = r.chance(0.45) ? 0xd4694a : r.chance(0.6) ? 0xe3a32b : 0x8fa23c;
        T.box(px - 0.17, y0 + 1.45, pz - 0.17, px + 0.17, y0 + 1.79, pz + 0.17,
          (f, n, cc) => shadeLin(c, litOf(n, cc[0], cc[1], cc[2]) + 0.1), 'px nx py pz nz');
      }
    }
  } else if (shop.goods === 'crates') {
    for (let i = 0; i < 3; i++) {
      const [cx0, cx1] = X(0.9, 2.7 + r.range(0, 0.4));
      const zz = gz + i * 2.3, hh = r.range(1.2, 2.3);
      T.box(cx0, y0, zz, cx1, y0 + hh, zz + 1.9, (f, n, c) => shadeLin(0x7a6244, litOf(n, c[0], c[1], c[2]), f === 'py' ? 0 : 0.14), 'px nx py pz nz');
    }
  } else if (shop.goods === 'papers') {
    const [cx0, cx1] = X(1.0, 3.0);
    T.box(cx0, y0, gz, cx1, y0 + 2.5, gz + 3.0, (f, n, c) => shadeLin(0x6b5a44, litOf(n, c[0], c[1], c[2]), 0.16), 'px nx py pz nz');
    const px = o < 0 ? cx0 - 0.02 : cx1 + 0.02;
    const P = o < 0
      ? [[px, y0 + 1.3, gz + 0.2], [px, y0 + 1.3, gz + 2.8], [px, y0 + 2.45, gz + 2.8], [px, y0 + 2.45, gz + 0.2]]
      : [[px, y0 + 1.3, gz + 2.8], [px, y0 + 1.3, gz + 0.2], [px, y0 + 2.45, gz + 0.2], [px, y0 + 2.45, gz + 2.8]];
    S.quad(P[0], P[1], P[2], P[3], texTint(0.1), rectUV(A.get('bills')), [o, 0, 0]);
  }

  // the barber's pole: the one turned object on the block
  if (shop.pole && lot.pole) {
    const [px0, px1] = X(0.8, 1.3);
    const cx = (px0 + px1) / 2, pz = z0 + 2.1;
    T.cyl(cx, pz, 0.24, y0 + 3.0, y0 + 6.5, 8, (n, c) => shadeLin(0xefe6d2, litOf(n, c[0], c[1], c[2])));
    for (let i = 0; i < 5; i++) {
      const yy = y0 + 3.1 + i * 0.64;
      T.cyl(cx, pz, 0.255, yy, yy + 0.3, 8, (n, c) => shadeLin(i % 2 ? 0xc8402f : 0x3b5ea0, litOf(n, c[0], c[1], c[2])));
    }
    T.cyl(cx, pz, 0.3, y0 + 6.5, y0 + 6.9, 8, (n, c) => shadeLin(0x8a6a54, litOf(n, c[0], c[1], c[2])));
    T.box(Math.min(cx, xf), y0 + 6.2, pz - 0.08, Math.max(cx, xf), y0 + 6.35, pz + 0.08, () => shadeLin(0x4a4a44, 0.2), 'px nx py ny pz nz');
  }
}

export function normal3(a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const L = Math.hypot(cr[0], cr[1], cr[2]) || 1;
  return [cr[0] / L, cr[1] / L, cr[2] / L];
}

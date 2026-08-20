/**
 * A chalk alphabet, drawn rather than typeset.
 *
 * DESIGN-BIBLE §11 forbids default fonts in the HUD, and it is right to: a system font is the
 * one thing on screen that could not possibly have been chalked onto a kerb by a twelve-year-old.
 * So the letterforms are stroke paths in a 0..1 box and the brush does the rest — every stroke is
 * drawn three times with a little jitter and a little alpha, which is what makes chalk read as
 * chalk instead of as a thin white line.
 *
 * Condensed and blocky on purpose: that is what you get writing on stone with a broken piece of
 * chalk, and it stays legible at the 24px the bible sets as the floor for tally marks.
 */

// Each glyph is a list of polylines. x runs 0..1 left to right, y runs 0..1 top to bottom.
const G = {
  A: [[[0, 1], [0.5, 0], [1, 1]], [[0.18, 0.62], [0.82, 0.62]]],
  B: [[[0, 0], [0, 1]], [[0, 0], [0.75, 0], [0.9, 0.22], [0.72, 0.48], [0, 0.48]], [[0, 0.48], [0.8, 0.48], [0.98, 0.74], [0.78, 1], [0, 1]]],
  C: [[[1, 0.14], [0.62, 0], [0.16, 0.1], [0, 0.5], [0.16, 0.9], [0.62, 1], [1, 0.86]]],
  D: [[[0, 0], [0, 1]], [[0, 0], [0.66, 0.04], [0.96, 0.44], [0.7, 0.96], [0, 1]]],
  E: [[[1, 0], [0, 0], [0, 1], [1, 1]], [[0, 0.5], [0.72, 0.5]]],
  F: [[[1, 0], [0, 0], [0, 1]], [[0, 0.5], [0.68, 0.5]]],
  G: [[[1, 0.14], [0.6, 0], [0.14, 0.12], [0, 0.5], [0.16, 0.9], [0.64, 1], [1, 0.84], [1, 0.55], [0.55, 0.55]]],
  H: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.52], [1, 0.52]]],
  I: [[[0.5, 0], [0.5, 1]], [[0.16, 0], [0.84, 0]], [[0.16, 1], [0.84, 1]]],
  J: [[[0.86, 0], [0.86, 0.78], [0.6, 1], [0.2, 0.94], [0.06, 0.66]]],
  K: [[[0, 0], [0, 1]], [[0.96, 0], [0.06, 0.55]], [[0.3, 0.4], [1, 1]]],
  L: [[[0, 0], [0, 1], [0.94, 1]]],
  M: [[[0, 1], [0.06, 0], [0.5, 0.62], [0.94, 0], [1, 1]]],
  N: [[[0, 1], [0, 0], [1, 1], [1, 0]]],
  O: [[[0.5, 0], [0.14, 0.16], [0, 0.5], [0.16, 0.88], [0.5, 1], [0.86, 0.88], [1, 0.5], [0.86, 0.14], [0.5, 0]]],
  P: [[[0, 1], [0, 0], [0.76, 0.02], [0.96, 0.28], [0.74, 0.54], [0, 0.54]]],
  Q: [[[0.5, 0], [0.14, 0.16], [0, 0.5], [0.16, 0.88], [0.5, 1], [0.86, 0.88], [1, 0.5], [0.86, 0.14], [0.5, 0]], [[0.62, 0.72], [1, 1.06]]],
  R: [[[0, 1], [0, 0], [0.76, 0.02], [0.96, 0.28], [0.72, 0.54], [0, 0.54]], [[0.42, 0.54], [1, 1]]],
  S: [[[0.98, 0.12], [0.58, 0], [0.14, 0.08], [0.04, 0.32], [0.4, 0.48], [0.82, 0.56], [0.96, 0.78], [0.72, 0.98], [0.24, 1], [0, 0.86]]],
  T: [[[0.5, 0], [0.5, 1]], [[0, 0], [1, 0]]],
  U: [[[0, 0], [0, 0.72], [0.24, 0.98], [0.7, 0.98], [1, 0.72], [1, 0]]],
  V: [[[0, 0], [0.5, 1], [1, 0]]],
  W: [[[0, 0], [0.2, 1], [0.5, 0.38], [0.8, 1], [1, 0]]],
  X: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]],
  Y: [[[0, 0], [0.5, 0.5], [1, 0]], [[0.5, 0.5], [0.5, 1]]],
  Z: [[[0, 0], [1, 0], [0, 1], [1, 1]]],
  0: [[[0.5, 0], [0.12, 0.2], [0.04, 0.5], [0.14, 0.84], [0.5, 1], [0.86, 0.84], [0.96, 0.5], [0.88, 0.18], [0.5, 0]], [[0.86, 0.16], [0.16, 0.86]]],
  1: [[[0.18, 0.2], [0.52, 0], [0.52, 1]], [[0.16, 1], [0.9, 1]]],
  2: [[[0.04, 0.2], [0.3, 0], [0.74, 0.02], [0.94, 0.28], [0.6, 0.6], [0.04, 1], [1, 1]]],
  3: [[[0.06, 0.06], [0.6, 0], [0.92, 0.2], [0.66, 0.46], [0.24, 0.48]], [[0.66, 0.46], [0.98, 0.7], [0.7, 0.98], [0.16, 1], [0, 0.86]]],
  4: [[[0.74, 1], [0.74, 0], [0, 0.7], [1, 0.7]]],
  5: [[[0.96, 0], [0.16, 0.02], [0.08, 0.44], [0.56, 0.4], [0.94, 0.6], [0.84, 0.92], [0.34, 1], [0.02, 0.88]]],
  6: [[[0.9, 0.06], [0.42, 0], [0.1, 0.3], [0.04, 0.72], [0.32, 1], [0.74, 0.98], [0.94, 0.72], [0.72, 0.48], [0.24, 0.5], [0.05, 0.68]]],
  7: [[[0, 0], [1, 0], [0.38, 1]]],
  8: [[[0.5, 0.46], [0.14, 0.3], [0.2, 0.06], [0.62, 0], [0.9, 0.18], [0.5, 0.46], [0.94, 0.66], [0.82, 0.94], [0.34, 1], [0.06, 0.8], [0.5, 0.46]]],
  9: [[[0.1, 0.94], [0.58, 1], [0.9, 0.7], [0.96, 0.28], [0.68, 0], [0.26, 0.02], [0.06, 0.28], [0.28, 0.52], [0.76, 0.5], [0.95, 0.32]]],
  '-': [[[0.1, 0.55], [0.9, 0.55]]],
  '.': [[[0.44, 0.94], [0.56, 1]]],
  "'": [[[0.5, 0], [0.42, 0.28]]],
  ' ': [],
};

const ASPECT = 0.62;      // glyph width as a fraction of its height
const TRACK = 0.26;       // space between glyphs, in glyph heights

/** Width of `text` in pixels if drawn at the given cap height. */
export function chalkWidth(text, size) {
  const n = text.length;
  if (!n) return 0;
  return n * size * ASPECT + (n - 1) * size * TRACK;
}

/**
 * Draw chalk text. `jitter` seeds the wobble so the same label wobbles the same way every
 * frame — chalk that reshuffles itself at 60fps reads as static, not as chalk.
 */
export function chalkText(ctx, text, x, y, size, opts = {}) {
  const {
    color = '#f6f0e2', align = 'left', weight = Math.max(1.6, size * 0.13),
    alpha = 1, jitter = 1, tilt = 0,
  } = opts;
  const str = String(text).toUpperCase();
  const total = chalkWidth(str, size);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;

  ctx.save();
  if (tilt) { ctx.translate(x, y); ctx.rotate((tilt * Math.PI) / 180); ctx.translate(-x, -y); }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;

  let seed = jitter * 9781;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) - 0.5; };

  for (const ch of str) {
    const glyph = G[ch] ?? G[' '];
    const w = size * ASPECT;
    for (const poly of glyph) {
      // three passes: a soft wide ghost, the body, a bright dry-brush highlight
      for (let pass = 0; pass < 3; pass++) {
        ctx.globalAlpha = alpha * (pass === 0 ? 0.22 : pass === 1 ? 0.92 : 0.5);
        ctx.lineWidth = weight * (pass === 0 ? 2.1 : pass === 1 ? 1 : 0.45);
        ctx.beginPath();
        poly.forEach((p, i) => {
          const jx = rnd() * weight * (pass === 0 ? 1.1 : 0.55);
          const jy = rnd() * weight * (pass === 0 ? 1.1 : 0.55);
          const px = cx + p[0] * w + jx;
          const py = y + (p[1] - 1) * size + jy;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.stroke();
      }
    }
    cx += w + size * TRACK;
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * Tally marks, the way a count actually gets kept on a kerb: four uprights and a diagonal
 * through them for the fifth. `filled` of `total` are chalked in; the rest are ghosts, so the
 * shape of the count is readable even at a glance and even when it is empty.
 */
export function chalkTally(ctx, x, y, size, filled, total, opts = {}) {
  const { color = '#f6f0e2', ghost = 'rgba(246,240,226,0.20)', jitter = 3, tilt = 0 } = opts;
  const gap = size * 0.42;
  ctx.save();
  if (tilt) { ctx.translate(x, y); ctx.rotate((tilt * Math.PI) / 180); ctx.translate(-x, -y); }
  ctx.lineCap = 'round';
  let seed = jitter * 6151;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff) - 0.5; };

  for (let i = 0; i < total; i++) {
    const on = i < filled;
    const bx = x + i * gap;
    ctx.strokeStyle = on ? color : ghost;
    ctx.lineWidth = Math.max(1.8, size * 0.14) * (on ? 1 : 0.8);
    for (let pass = 0; pass < (on ? 2 : 1); pass++) {
      ctx.globalAlpha = on ? (pass ? 0.95 : 0.3) : 1;
      ctx.lineWidth = Math.max(1.8, size * 0.14) * (pass ? 1 : 1.9);
      ctx.beginPath();
      ctx.moveTo(bx + rnd() * 2, y + rnd() * 2);
      ctx.lineTo(bx + rnd() * 2 + size * 0.06, y - size + rnd() * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

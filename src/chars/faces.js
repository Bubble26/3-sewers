/**
 * faces.js — eyes that look somewhere, brows that carry the mood, six mouth shapes.
 *
 * DESIGN-BIBLE §5.3 / BYB §1.3, built as a painted decal on the front of the skull:
 *   - eyes 12-16% of head width, gap ~one eye width, at or just below the head's midline
 *   - eyebrows are SEPARATE FLOATING SHAPES, length 1.0-1.4x eye width, four named positions
 *   - six mouth shapes and no more: flat line, open lower-arc grin, open circle, wide toothy
 *     grin, downturned arc, gritted zigzag
 *   - asymmetry is character: mismatched lids, one raised brow, a tongue out of one corner,
 *     all on a named side, per kid
 *
 * The face is painted rather than modelled because it has to read at gameplay distance:
 * bold shapes, hard edges, high contrast, no fine detail. The same canvas also carries the
 * face's share of the three-band ramp (§4.1) — key from the upper left, a hard terminator
 * down the right cheek, a warm bounce under the jaw, and the brim shadow across the brow —
 * so the face is banded identically whichever way the kid is facing.
 *
 * Public API (the animation and announcer pieces call this):
 *     setExpression(kid, 'grin')          -> boolean
 *     lookAt(kid, x, y)                   -> gaze in [-1..1]
 *     blink(kid, amount)
 *     EXPRESSIONS                          -> the vocabulary
 */
import * as THREE from 'three';
import { SKIN, BLUSH, CHALK, INK, ACCENTS, AIR, PAVEMENT, FACADE, soot } from '../render/palette.js';
import { hexCSS, coolShade, bounceOf, mix, inkOf, HAIR } from './wardrobe.js';

const TAU = Math.PI * 2;
const S = 256;                        // canvas edge; the face reads at 96 px so this is plenty

/* ---------------------------------------------------------------------------
   The vocabulary. Every expression resolves to (brow position, lid openness,
   gaze, one of the six mouths). Nothing else.
   ------------------------------------------------------------------------ */
export const EXPRESSIONS = {
  neutral:      { brow: 'level',  open: [1.00, 1.00], mouth: 'line',   gaze: [0.00, 0.06] },
  grin:         { brow: 'raised', open: [0.92, 0.92], mouth: 'grin',   gaze: [0.05, 0.02] },
  determined:   { brow: 'angry',  open: [0.62, 0.62], mouth: 'grit',   gaze: [0.00, 0.10] },
  shock:        { brow: 'high',   open: [1.32, 1.32], mouth: 'oh',     gaze: [0.00, -0.06] },
  disappointed: { brow: 'sad',    open: [0.50, 0.50], mouth: 'frown',  gaze: [0.00, 0.45] },
  taunt:        { brow: 'cocky',  open: [0.95, 0.45], mouth: 'toothy', gaze: [0.42, 0.02] },
  yell:         { brow: 'high',   open: [0.50, 0.50], mouth: 'yell',   gaze: [0.00, -0.08] },
  smug:         { brow: 'cocky',  open: [0.62, 0.62], mouth: 'smirk',  gaze: [0.30, 0.10] },
  squint:       { brow: 'angry',  open: [0.28, 0.28], mouth: 'line',   gaze: [0.00, 0.05] },
  blink:        { brow: 'level',  open: [0.06, 0.06], mouth: 'line',   gaze: [0.00, 0.06] },
};
export const EXPRESSION_NAMES = Object.keys(EXPRESSIONS);

/* brow position -> per-brow [dy in eye-heights, tilt in degrees, arch] */
const BROWS = {
  level:  [[0.00, 0, 0.16], [0.00, 0, 0.16]],
  raised: [[-0.42, -4, 0.30], [-0.42, 4, 0.30]],
  high:   [[-0.80, -7, 0.42], [-0.80, 7, 0.42]],
  angry:  [[0.20, 24, 0.02], [0.20, -24, 0.02]],
  sad:    [[-0.16, -22, 0.06], [-0.16, 22, 0.06]],
  cocky:  [[-0.66, -10, 0.34], [0.16, -16, 0.04]],
};

/* =========================================================================
   Canvas painting
   ====================================================================== */

function ell(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x * S, y * S, rx * S, ry * S, rot, 0, TAU);
}

function drawEye(ctx, p) {
  const { x, y, ew, eh, open, lid, gaze, ink, white, skinShade } = p;
  const o = Math.max(0.05, open);
  ctx.save();
  ell(ctx, x, y, ew / 2, (eh / 2) * Math.min(o, 1.35));
  ctx.clip();
  ctx.fillStyle = white;
  ctx.fillRect((x - ew) * S, (y - eh) * S, ew * 2 * S, eh * 2 * S);
  // pupil: a solid dark oval that actually looks somewhere
  const px = x + gaze[0] * ew * 0.24, py = y + gaze[1] * eh * 0.22;
  ctx.fillStyle = ink;
  ell(ctx, px, py, ew * 0.33, eh * 0.40);
  ctx.fill();
  ctx.fillStyle = 'rgba(246,240,226,0.92)';
  ell(ctx, px - ew * 0.11, py - eh * 0.14, ew * 0.10, eh * 0.11);
  ctx.fill();
  // upper lid, angled — this is where "narrowed" comes from
  if (lid !== 0 || o < 1) {
    ctx.save();
    ctx.translate(x * S, y * S);
    ctx.rotate(lid);
    ctx.fillStyle = skinShade;
    const drop = (1 - Math.min(o, 1)) * eh;
    ctx.fillRect(-ew * S, (-eh * 1.2) * S, ew * 2 * S, (eh * 1.2 - eh / 2 + drop) * S);
    ctx.restore();
  }
  ctx.restore();
  // the aperture outline: bold, closed, always drawn last so it survives the lid
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = S * 0.016;
  ell(ctx, x, y, ew / 2, (eh / 2) * Math.min(o, 1.35));
  ctx.stroke();
  ctx.restore();
}

function drawBrow(ctx, p) {
  const { x, y, len, thick, tilt, arch, color } = p;
  ctx.save();
  ctx.translate(x * S, y * S);
  ctx.rotate((tilt * Math.PI) / 180);
  ctx.strokeStyle = color;
  ctx.lineWidth = thick * S;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo((-len / 2) * S, 0);
  ctx.quadraticCurveTo(0, -arch * S, (len / 2) * S, 0);
  ctx.stroke();
  ctx.restore();
}

/** The six mouths, plus 'yell'/'smirk' which are scaled members of shapes 3 and 2. */
function drawMouth(ctx, kind, p) {
  const { x, y, w, ink, teeth, tongue, corner } = p;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  const lw = S * 0.019;
  ctx.lineWidth = lw;

  if (kind === 'line') {
    ctx.beginPath();
    ctx.moveTo((x - w / 2) * S, y * S);
    ctx.quadraticCurveTo(x * S, (y + w * 0.10) * S, (x + w / 2) * S, y * S);
    ctx.stroke();
  } else if (kind === 'smirk') {
    ctx.beginPath();
    ctx.moveTo((x - w * 0.48) * S, (y + w * 0.10) * S);
    ctx.quadraticCurveTo(x * S, (y + w * 0.16) * S, (x + w * 0.52) * S, (y - w * 0.16) * S);
    ctx.stroke();
  } else if (kind === 'frown') {
    ctx.beginPath();
    ctx.moveTo((x - w * 0.46) * S, (y + w * 0.10) * S);
    ctx.quadraticCurveTo(x * S, (y - w * 0.22) * S, (x + w * 0.46) * S, (y + w * 0.10) * S);
    ctx.stroke();
  } else if (kind === 'grin' || kind === 'toothy') {
    const big = kind === 'toothy';
    const hw = w * (big ? 0.62 : 0.50), dep = w * (big ? 0.52 : 0.38);
    ctx.beginPath();
    ctx.moveTo((x - hw) * S, y * S);
    ctx.quadraticCurveTo(x * S, (y + dep) * S, (x + hw) * S, y * S);
    ctx.closePath();
    ctx.fill();
    // upper teeth strip
    ctx.save();
    ctx.clip();
    ctx.fillStyle = teeth;
    ctx.fillRect((x - hw) * S, (y - w * 0.05) * S, hw * 2 * S, w * (big ? 0.20 : 0.13) * S);
    if (big) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = S * 0.008;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo((x + i * hw * 0.34) * S, (y - w * 0.05) * S);
        ctx.lineTo((x + i * hw * 0.34) * S, (y + w * 0.16) * S);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo((x - hw) * S, y * S);
    ctx.quadraticCurveTo(x * S, (y + dep) * S, (x + hw) * S, y * S);
    ctx.closePath();
    ctx.stroke();
  } else if (kind === 'oh' || kind === 'yell') {
    const big = kind === 'yell';
    const rx = w * (big ? 0.34 : 0.22), ry = w * (big ? 0.52 : 0.28);
    ctx.fillStyle = ink;
    ell(ctx, x, y + ry * 0.55, rx, ry);
    ctx.fill();
    ctx.save();
    ell(ctx, x, y + ry * 0.55, rx, ry);
    ctx.clip();
    ctx.fillStyle = teeth;
    ctx.fillRect((x - rx) * S, (y + ry * 0.55 - ry) * S, rx * 2 * S, ry * 0.45 * S);
    ctx.fillStyle = tongue;
    ell(ctx, x, y + ry * 1.28, rx * 0.72, ry * 0.45);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ell(ctx, x, y + ry * 0.55, rx, ry);
    ctx.stroke();
  } else if (kind === 'grit') {
    const hw = w * 0.52, hh = w * 0.19;
    ctx.fillStyle = teeth;
    ctx.beginPath();
    ctx.moveTo((x - hw) * S, (y - hh * 0.4) * S);
    ctx.lineTo((x + hw) * S, (y - hh * 0.4) * S);
    ctx.lineTo((x + hw * 0.86) * S, (y + hh) * S);
    ctx.lineTo((x - hw * 0.86) * S, (y + hh) * S);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = lw;
    ctx.stroke();
    // the zigzag that makes it "gritted" rather than "smiling"
    ctx.lineWidth = S * 0.012;
    ctx.beginPath();
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const gx = x - hw * 0.88 + (i / n) * hw * 1.76;
      const gy = y + (i % 2 ? hh * 0.34 : hh * 0.02);
      if (i === 0) ctx.moveTo(gx * S, gy * S); else ctx.lineTo(gx * S, gy * S);
    }
    ctx.stroke();
  }

  // a tongue out of one corner, on a named side, deliberately (§5.3)
  if (corner && (kind === 'line' || kind === 'grin' || kind === 'grit')) {
    ctx.fillStyle = tongue;
    ctx.strokeStyle = ink;
    ctx.lineWidth = S * 0.010;
    ell(ctx, x + corner * w * 0.46, y + w * 0.16, w * 0.14, w * 0.11, corner * 0.4);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/**
 * Paint one kid's face at one expression. Everything is a fraction of the canvas so the
 * layout numbers can be checked against the bible directly.
 */
function paint(ctx, F, exName) {
  const ex = EXPRESSIONS[exName] || EXPRESSIONS.neutral;
  ctx.clearRect(0, 0, S, S);

  /* The decal carries NO skin base. The head mesh underneath is already banded, so
     painting an opaque face on top of it puts a visible mask edge round the jaw. What
     goes on here is only what a painter would add on top of the skin: the brim's cast
     shadow, a little form down the shade side, blush, freckles, the afternoon's dirt,
     and the features. Everything soft-edged, so nothing can seam. */

  ctx.save();
  ctx.filter = 'blur(9px)';
  ctx.globalAlpha = 0.30;                          // form down the shade side (key upper-left)
  ctx.fillStyle = F.formShade;
  ctx.beginPath();
  ctx.moveTo(S * 1.10, -S * 0.10);
  ctx.quadraticCurveTo(S * 0.74, S * 0.40, S * 0.84, S * 0.80);
  ctx.quadraticCurveTo(S * 0.92, S * 1.06, S * 1.10, S * 1.14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (F.brim) {                                    // the brim's own shadow across the brow
    ctx.save();
    ctx.filter = 'blur(5px)';
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = F.formShade;
    ctx.beginPath();
    ctx.moveTo(-S * 0.10, -S * 0.10);
    ctx.lineTo(S * 1.10, -S * 0.10);
    ctx.lineTo(S * 1.10, S * (F.brim - 0.03));
    ctx.quadraticCurveTo(S * 0.5, S * (F.brim + 0.09), -S * 0.10, S * (F.brim - 0.03));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* --- blush, freckles, and the afternoon's dirt ------------------------ */
  ctx.save();
  ctx.filter = 'blur(6px)';
  ctx.globalAlpha = 0.40;
  ctx.fillStyle = F.blush;
  ell(ctx, 0.250, 0.660, 0.112, 0.074); ctx.fill();
  ell(ctx, 0.750, 0.660, 0.112, 0.074); ctx.fill();
  ctx.restore();
  if (F.freckles) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = F.freckle;
    for (let i = 0; i < F.freckles * 5; i++) {
      const a = (i * 2.39996) % TAU, rr = 0.055 + (i % 5) * 0.021;
      const sx = i % 2 ? 0.29 : 0.71;
      ell(ctx, sx + Math.cos(a) * rr, 0.630 + Math.sin(a) * rr * 0.62, 0.0135, 0.0135);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();                                       // cheek streak: dirt shape #1 of three
  ctx.filter = 'blur(3px)';
  ctx.globalAlpha = 0.40;
  ctx.strokeStyle = F.dirt;
  ctx.lineWidth = S * 0.030;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(S * (F.smudgeSide > 0 ? 0.80 : 0.20), S * 0.565);
  ctx.quadraticCurveTo(S * (F.smudgeSide > 0 ? 0.87 : 0.13), S * 0.665, S * (F.smudgeSide > 0 ? 0.77 : 0.23), S * 0.770);
  ctx.stroke();
  ctx.restore();

  /* --- eyes -------------------------------------------------------------- */
  const ew = F.eyeW, eh = ew * 1.22;
  const ey = 0.545;                                 // sits on the head's horizontal midline
  const cx = [0.5 - ew, 0.5 + ew];                  // gap between them = one eye width
  const gz = [ex.gaze[0] + F.gaze[0], ex.gaze[1] + F.gaze[1]];
  for (let i = 0; i < 2; i++) {
    const open = ex.open[i] * F.lidBias[i];
    drawEye(ctx, {
      x: cx[i], y: ey, ew, eh, open,
      lid: (i ? -1 : 1) * (ex.brow === 'angry' ? 0.30 : ex.brow === 'cocky' ? 0.16 : 0.0) + F.lidTilt[i],
      gaze: gz, ink: F.ink, white: F.white, skinShade: F.lidSkin,
    });
  }

  /* --- brows: separate floating shapes, doing most of the work ---------- */
  const bp = BROWS[ex.brow] || BROWS.level;
  for (let i = 0; i < 2; i++) {
    const [dy, tilt, arch] = bp[i];
    drawBrow(ctx, {
      x: cx[i] + (i ? 0.010 : -0.010),
      y: ey - eh * 0.62 - eh * 0.32 + dy * eh + F.browBias[i] * eh,
      len: ew * F.browLen, thick: 0.040 * F.browThick, arch,
      tilt: tilt + F.browTilt[i], color: F.brow,
    });
  }

  /* --- nose: a bump, a dot or a comma. Nothing else. -------------------- */
  ctx.save();
  ctx.strokeStyle = F.noseInk;
  ctx.lineWidth = S * 0.023;
  ctx.lineCap = 'round';
  if (F.nose === 'dot') {
    ctx.fillStyle = F.noseInk;
    ell(ctx, 0.5, 0.672, 0.025, 0.021); ctx.fill();
  } else if (F.nose === 'comma') {
    ctx.beginPath();
    ctx.moveTo(S * 0.492, S * 0.620);
    ctx.quadraticCurveTo(S * 0.468, S * 0.682, S * 0.522, S * 0.684);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(S * 0.5, S * 0.652, S * 0.038, 0.32 * Math.PI, 0.78 * Math.PI);
    ctx.stroke();
  }
  ctx.restore();

  /* --- specs, for the one kid who has them ------------------------------ */
  if (F.specs) {
    ctx.save();
    ctx.strokeStyle = F.ink;
    ctx.lineWidth = S * 0.015;
    for (let i = 0; i < 2; i++) { ell(ctx, cx[i], ey, ew * 0.80, eh * 0.68); ctx.stroke(); }
    ctx.beginPath();
    ctx.moveTo((cx[0] + ew * 0.80) * S, ey * S);
    ctx.lineTo((cx[1] - ew * 0.80) * S, ey * S);
    ctx.stroke();
    ctx.restore();
  }

  /* --- mouth ------------------------------------------------------------- */
  drawMouth(ctx, ex.mouth, {
    x: 0.5, y: 0.762, w: 0.31 * F.mouthW, ink: F.mouthInk, teeth: F.teeth, tongue: F.tongue,
    corner: F.tongueCorner,
  });

  /* --- feather the decal edge so nothing can ever seam ------------------- */
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  const g = ctx.createRadialGradient(S * 0.5, S * 0.5, S * 0.30, S * 0.5, S * 0.5, S * 0.74);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.70, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();
}

/* =========================================================================
   The face object bolted onto a kid
   ====================================================================== */

/** Build the painted-face state for one kid spec. Returns { texture, apply, F }. */
export function makeFace(spec, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const q = spec.quirk || {};
  const skinHex = SKIN[spec.skin ?? 1];
  const hairHex = HAIR[spec.hair ?? 1];
  const side = (spec.id ? spec.id.charCodeAt(0) : 0) % 2 ? 1 : -1;

  const F = {
    skin: hexCSS(skinHex),
    formShade: hexCSS(mix(coolShade(skinHex, 0.52), AIR.shadowTint, 0.18)),
    lidSkin: hexCSS(coolShade(skinHex, 0.86)),
    blush: hexCSS(BLUSH),
    freckle: hexCSS(mix(soot(skinHex, 0.34), ACCENTS.rust, 0.4)),
    dirt: hexCSS(soot(FACADE.brickShade, 0.20)),
    ink: hexCSS(inkOf(mix(skinHex, hairHex, 0.85))),
    noseInk: hexCSS(mix(coolShade(skinHex, 0.55), hairHex, 0.25)),
    brow: hexCSS(mix(soot(hairHex, 0.34), INK, 0.30)),
    mouthInk: hexCSS(inkOf(mix(BLUSH, hairHex, 0.55))),
    teeth: hexCSS(mix(CHALK, SKIN[0], 0.18)),
    tongue: hexCSS(soot(BLUSH, 0.10)),
    white: hexCSS(mix(CHALK, AIR.skyFill, 0.10)),
    eyeW: 0.152 * (q.eyeSize || 1),            // 15% of head width, inside BYB's 12-16%
    browLen: 1.22,                              // 1.0-1.4x eye width
    browThick: q.browThick || 1,
    mouthW: q.mouthW || 1,
    nose: ['bump', 'dot', 'comma'][(spec.id ? spec.id.length : 0) % 3],
    specs: !!spec.specs,
    freckles: q.freckles || 0,
    smudgeSide: side,
    brim: opts.brim || 0,
    gaze: [0, 0],
    // deliberate, per-kid, on a named side
    lidBias: [q.droopy === 'R' ? 0.58 : 1, q.droopy === 'L' ? 0.58 : 1],
    lidTilt: [0, 0],
    browBias: [q.browUp === 'R' ? -0.34 : 0, q.browUp === 'L' ? -0.34 : 0],
    browTilt: [q.browSkew || 0, -(q.browSkew || 0) * 0.4],
    tongueCorner: q.tongue === 'L' ? 1 : q.tongue === 'R' ? -1 : 0,
  };

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  let current = null;
  const apply = (name) => {
    const n = EXPRESSIONS[name] ? name : 'neutral';
    paint(ctx, F, n);
    texture.needsUpdate = true;
    current = n;
  };
  apply(spec.ex || 'neutral');
  return { texture, canvas, apply, F, get expression() { return current; } };
}

/* =========================================================================
   Public API — this is what the animation and announcer pieces call
   ====================================================================== */

/** setExpression(kid, 'grin'). Returns false if the kid has no face or the name is unknown. */
export function setExpression(kid, name) {
  const f = kid && kid.userData && kid.userData.face;
  if (!f) return false;
  if (!EXPRESSIONS[name]) return false;
  if (f.expression === name) return true;
  f.apply(name);
  kid.userData.expression = name;
  return true;
}

/** Point the pupils somewhere. x,y in roughly [-1..1]; the lids stay where they were. */
export function lookAt(kid, x = 0, y = 0) {
  const f = kid && kid.userData && kid.userData.face;
  if (!f) return false;
  f.F.gaze[0] = Math.max(-1, Math.min(1, x));
  f.F.gaze[1] = Math.max(-1, Math.min(1, y));
  f.apply(f.expression || 'neutral');
  return true;
}

/** A one-frame blink is just an expression; callers drive the timing. */
export function blink(kid, closed = true) {
  return setExpression(kid, closed ? 'blink' : (kid.userData.baseExpression || 'neutral'));
}

export function getExpression(kid) {
  const f = kid && kid.userData && kid.userData.face;
  return f ? f.expression : null;
}

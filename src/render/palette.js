/**
 * The master palette, transcribed from docs/DESIGN-BIBLE.md §2, plus the colour arithmetic
 * that turns an authored hex into a shaded one.
 *
 * Owned by the art-direction piece. Every other system imports from here and never writes a
 * hex literal of its own — that is what keeps twenty parallel builders producing one game.
 *
 * THE FOUR LAWS, in the form a builder needs them at the moment they reach for a colour:
 *
 *   Law 1  THE BRIGHT MIDDLE. Value runs dark at the frame edges and light at the play
 *          plane. Use sootAtHeight() on anything vertical: 0% soot at the curb, 100% at the
 *          cornice. The crown of the roadway is the brightest ground surface in the frame.
 *   Law 2  THE CHALK CEILING AND THE INK FLOOR. CHALK (#F6F0E2, L* 94.9) is our white and
 *          INK (#2A1D1A, L* 12.3) is our black, and both are RESERVED. No world material
 *          may exceed L* 89, no backdrop material L* 84, and nothing may sit below L* 28 in
 *          a region bigger than 32 px — except linear ironwork, exempt down to L* 19.
 *          LAWS.check(hex, role) answers this for you; audit() answers it for the whole file.
 *   Law 3  SOOT IS A VALUE SHIFT, NEVER A SATURATION SHIFT. soot() multiplies value and
 *          leaves hue and chroma alone. There is no global grade, no sepia, no desaturation
 *          pass and no LUT anywhere in this pipeline.
 *   Law 4  EVERY SOOTY SURFACE IS ADJACENT TO A SATURATED ONE. No 128 px region may be all
 *          S < 0.20. ACCENTS is where you pay that bill.
 *
 * And the shading model, §4.1 — three bands, hand-authored, not computed per pixel:
 *          ramp(hex) -> { lit, shade, bounce, ink }
 *   lit    the authored colour
 *   shade  0.72x luminance, hue rotated 6° toward skylight — a WARM-TO-COOL shift, never grey
 *   bounce a narrow warm strip off the sunlit facade and the roadway (#C08863 at 25%, +6 L*)
 *   ink    the outline: same hue, saturation up, L* down 40 points. Never a uniform grey.
 */

/* ============================================================================
   0. Colour arithmetic. Everything else in the file is built out of this.
   ========================================================================= */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const rgbOf = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
export const hexOf = (r, g, b) => ((Math.round(clamp(r, 0, 1) * 255) << 16)
  | (Math.round(clamp(g, 0, 1) * 255) << 8) | Math.round(clamp(b, 0, 1) * 255));
export const hexCSS = (h) => `#${(h >>> 0).toString(16).padStart(6, '0')}`;

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/**
 * three.js converts material.color and textures into the linear working space for you and
 * does NOT convert vertex colours. Baking an sRGB hex straight into a colour attribute is
 * what makes an authored palette come out pale and gold-rimmed. Bake through linOf().
 */
export const linOf = (h) => rgbOf(h).map(srgbToLinear);

/** WCAG relative luminance, 0..1. */
export function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** CIE L*, 0..100 — the number every check in DESIGN-BIBLE §2 and §14 is written in. */
export function lstar(hex) {
  const y = luminance(hex);
  const f = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  return 116 * f - 16;
}
/** WCAG contrast ratio between two authored colours. */
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function toHSL(hex) {
  const [r, g, b] = rgbOf(hex);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  const l = (mx + mn) / 2;
  const s = d < 1e-6 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}
export function fromHSL(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return hexOf(r + m, g + m, b + m);
}
export const hueOf = (hex) => toHSL(hex)[0];
export const satOf = (hex) => toHSL(hex)[1];

/** Linear blend in sRGB space — the way a poster painter mixes, which is what we want. */
export function mix(a, b, t) {
  const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b);
  return hexOf(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}

/** Rotate a hue toward skylight blue by `deg` along the short arc — the §4.1 cool shift. */
export function coolHue(h, deg) {
  let d = 220 - h;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return h + Math.sign(d) * Math.min(deg, Math.abs(d));
}

/** Push a colour to a target L* while holding its hue and chroma. Law 3 in one function. */
export function atLstar(hex, target) {
  let lo = 0, hi = 4, mid = 1;
  for (let i = 0; i < 24; i++) {
    mid = (lo + hi) / 2;
    const [r, g, b] = rgbOf(hex);
    const test = hexOf(r * mid, g * mid, b * mid);
    if (lstar(test) < target) lo = mid; else hi = mid;
  }
  const [r, g, b] = rgbOf(hex);
  return hexOf(r * mid, g * mid, b * mid);
}

/* ============================================================================
   1. The reserved pair. Law 2.
   ========================================================================= */

export const CHALK = 0xf6f0e2;   // L* 94.9 — chalk marks, pitch ring, landing marker, ball rim
export const INK = 0x2a1d1a;     // L* 12.3 — outlines on characters, props, ball, HUD rules

/* ============================================================================
   2. The world
   ========================================================================= */

export const PAVEMENT = {
  asphaltShade: 0x6e5c4c,        // base roadway                       L* 40.4
  asphaltSun: 0x8a7157,          // the sun band across the street     L* 49.4
  asphaltDark: 0x5a4e46,         // newer tar patch                    L* 34.1
  asphaltWarm: 0x7e6a52,         // older oxidised patch               L* 46.1
  belgianBlock: 0x957b60,        // block surfacing through worn tar   L* 53.4
  blockCrown: 0xa8917a,          // wear-polished crown — brightest ground in frame  L* 61.6
  sidewalk: 0x9a9184,            // bluestone flag                     L* 60.6
  curb: 0x8e877a,                // granite                            L* 56.6
  manholeHigh: 0x9a9188,         // worn high points of the cast iron  L* 60.7
  manholeLow: 0x3b322b,          // recesses — LINEAR GROOVES ONLY, the L* 19 iron exemption
};

export const FACADE = {
  brickSun: 0xc86e4c,            // L* 56.0
  brick: 0xa85c42,               // the workhorse                      L* 47.5
  brickSoot: 0x8a4a3a,           // floors four and five               L* 38.9
  brickShade: 0x6b4235,          // under cornices, in areaways        L* 32.4
  mortar: 0xb49c86,
  ochre: 0xc8924e,               // one building in eight
  ochreShade: 0x9e7a46,
  partyWall: 0xb8a88e,           // painted-out wall, the ghost-sign ground
  cornice: [0x7a4a34, 0x4c4a3c, 0x5b3b33],
  sash: [0x2e4034, 0x5a2a24, 0x332f2c],
  iron: [0x332e2a, 0x6e4231, 0x8a6a54],   // fire escapes, railings, lamp posts
};

/** The three materials §4.3 allows a specular highlight on. Nothing else in the game shines. */
export const SPECULAR = {
  glass: 0x54626a,               // plate and sash glass, the dark side of a pane
  glassSky: 0x9db6cc,            // what a pane reflects: a slab of upper sky, flattened
  glassSpec: 0xe6eef2,           // the hard hot streak — the only near-chalk value in the world
  gold: 0xd9a441,                // gold-leaf lettering on a doctor's window
  goldShade: 0x8f6a24,
  wetAsphalt: 0x7f6d5c,
};

export const AIR = {
  skyUpper: 0x6fa3d6,            // L* 65.3
  skyLower: 0xa8c6e2,            // L* 78.6
  haze: 0xd8cfb8,                // coal-haze band at the street mouth — L* 83.3, our ceiling
  sunTint: 0xf5a863,             // direct sun multiplier target
  skyFill: 0x8fa6c4,             // fill/key on characters
  brickBounce: 0xc08863,         // warm bounce into the bottom band
  shadowTint: 0x3e4658,          // contact shadows are blue-violet, never grey
};

export const BALL = {
  new: 0xf2828a,                 // a fresh Spaldeen: the readability accent of the whole game
  worn: 0xd4787a,
  sewer: 0xb08472,
  seam: 0xa85a5e,
  felt: 0xc8c2a8,
  rim: CHALK,                    // §2.5 the two-sided ball: chalk crescent upper left …
  outline: INK,                  // … ink outline all the way round. Both, always, at every size.
};

/** Six-step skin ramp. Kids are assigned a step, not a colour. */
export const SKIN = [0xf8d6b6, 0xefc199, 0xdfa377, 0xc07e52, 0x96603a, 0x6a4128];
/** §2.8 — hue 15°, deliberately outside the ball's reserved hue band. */
export const BLUSH = 0xde8062;
/** §4.4.5 — cheek streak, knee dust, black palm. Placed like blush, at 35%. */
export const SMUDGE = 0x7a5a46;

/**
 * Undyed cloth. Four values, no hues, all held below the L* 86 line so a chalk mark laid
 * over a shirt still reads. Light to dark. (§2.9)
 */
export const CLOTH = [0xe2d4b4, 0xd8c8a6, 0xcbba96, 0xbead8a];

/** Every kid carries exactly one saturated accent, drawn from this set and no other. */
export const ACCENTS = {
  red: 0xc8402f,
  mustard: 0xe3a32b,
  bottleGreen: 0x2f7f63,
  indigo: 0x3b5ea0,
  plum: 0x7b4a8c,
  rust: 0xd4694a,
  slateBlue: 0x4e8ca8,
  olive: 0x8fa23c,
  claret: 0xb03a5e,
  teal: 0x2e6e6e,
  tan: 0xa85e2a,
  periwinkle: 0x5c6bb0,
};

/** The two sides. Street kids do not have uniforms — this is a cap band or an armband. */
export const TEAMS = {
  home: { primary: ACCENTS.red, secondary: ACCENTS.mustard, name: 'Mulberry Street' },
  away: { primary: ACCENTS.bottleGreen, secondary: ACCENTS.indigo, name: 'Delancey' },
};

/* ============================================================================
   3. The shading model — DESIGN-BIBLE §4.1. Three bands, hand-authored.
   ========================================================================= */

/** Darken toward soot: a value shift, hue and chroma untouched. amount 0..1 (Law 3). */
export function soot(hex, amount = 0.25) {
  const [r, g, b] = rgbOf(hex);
  const k = 1 - amount;
  return hexOf(r * k, g * k, b * k);
}

/** Push a colour toward the direct-sun tint. §3.2: sun is a colour event, not an exposure one. */
export function sunlit(hex, amount = 0.3) {
  return mix(hex, AIR.sunTint, amount);
}

/**
 * Band 2 — the shade. 0.72x LUMINANCE (not 0.72x of the sRGB byte, which is 2.3:1 and breaks
 * the §3.2 lit-to-shade cap), then 6° toward skylight and a little chroma back. The whole
 * reason our shadows read as afternoon rather than as dirt is that they move BLUE while the
 * light moves GOLD, and that the step is only 1.39:1 — a band, not a hole.
 */
export function shade(hex, k = 0.72) {
  const [r, g, b] = rgbOf(hex).map(srgbToLinear);
  const dark = hexOf(...[r, g, b].map((c) => linearToSrgb(c * k)));
  const [h, s, l] = toHSL(mix(dark, AIR.shadowTint, 0.12));
  const cooled = fromHSL(coolHue(h, 6), Math.min(1, s + 0.04), l);
  return atLstar(cooled, lstar(dark));      // hold the band exactly where the law puts it
}

/** Band 3 — the bounce. Warm kick off the roadway and the sunlit facade: 25% brickBounce, +6 L*. */
export function bounce(hex) {
  const [h, s, l] = toHSL(mix(hex, AIR.brickBounce, 0.25));
  return fromHSL(h, s, Math.min(1, l * 0.86 + 0.09));
}

/**
 * §4.2 — outline colour: same hue, chroma up, L* down 40 points. Never grey, never flat ink.
 * Floored at INK's own L* 12.3, because ink is the darkest thing in the game by definition
 * and an outline that undercuts it is a hole in the frame.
 */
export function inkOf(hex) {
  const [h, s, l] = toHSL(hex);
  const L = lstar(hex);
  // L* minus 40 is the letter of §4.2; the 0.42 term keeps a light ecru shirt from getting a
  // pale tan outline that cannot hold a silhouette. Floored at INK so nothing undercuts ink.
  const target = Math.max(12.3, Math.min(L - 40, L * 0.42));
  const saturated = fromHSL(h, Math.min(1, s * 1.3 + 0.14), Math.max(0.08, l * 0.5));
  return atLstar(saturated, target);
}

/** The whole ramp for one authored colour, ready to hand to a material or bake to vertices. */
export function ramp(hex) {
  return { lit: hex, shade: shade(hex), bounce: bounce(hex), ink: inkOf(hex) };
}

/**
 * Law 1 / §4.4.1 — soot is a function of HEIGHT. 0% at the curb, 100% at the cornice, and the
 * play plane is the cleanest part of the world. Pass a height in feet.
 */
export function sootAtHeight(hex, y, { curb = 2, cornice = 56, max = 0.34 } = {}) {
  const t = clamp((y - curb) / (cornice - curb), 0, 1);
  return soot(hex, max * t * t);       // squared: the first two floors stay nearly clean
}

/**
 * §2.3 — the haze is a LIGHT, not a veil. Distance gets brighter, never darker. Pass a
 * distance in feet; 300 ft should read +8 to +14 L* over the near cornice.
 */
export function hazeAt(hex, feet, { start = 60, full = 420, max = 0.62 } = {}) {
  const t = clamp((feet - start) / (full - start), 0, 1);
  return mix(hex, AIR.haze, max * t * t);
}

/* ============================================================================
   4. The palette gate — the laws, as code a builder can call before shipping a colour.
   ========================================================================= */

export const LAWS = {
  chalk: CHALK,
  ink: INK,
  worldCeiling: 89,        // nothing in the world may exceed this L* …
  backdropCeiling: 84,     // … and nothing the ball flies against may exceed this
  fieldFloor: 28,          // no material below this in a region larger than 32x32 px …
  linearFloor: 19,         // … except linear ironwork: sash bars, fire-escape rails, grooves
  renderedFloor: 26,       // §3.4: and no 64x64 px REGION of a rendered frame below this
  ballHue: [335, 10],      // the reserved rectangle of colour space: this hue range …
  ballL: [58, 78],         // … at this lightness belongs to the ball and nothing else
  ballContrast: 4.0,       // best-of-two (chalk rim / ink outline) against the backdrop
  litToShade: 1.6,         // §3.2 cap on the lit:shade luminance ratio
  shadowOpacity: [0.28, 0.42],
  shadowTint: AIR.shadowTint,

  /** Is this colour inside the rectangle of colour space reserved for the ball? (§2.5.1) */
  reserved(hex) {
    const [h, , ] = toHSL(hex);
    const L = lstar(hex);
    const inHue = h >= LAWS.ballHue[0] || h <= LAWS.ballHue[1];
    return inHue && L >= LAWS.ballL[0] && L <= LAWS.ballL[1];
  },

  /**
   * Check one colour in one role. Roles: 'world' | 'backdrop' | 'linear' | 'mark' | 'ball'.
   * Returns [] when the colour is legal, or a list of plain-English violations.
   */
  check(hex, role = 'world') {
    const L = lstar(hex);
    const out = [];
    if (role === 'mark' || role === 'ball') return out;
    const ceiling = role === 'backdrop' ? LAWS.backdropCeiling : LAWS.worldCeiling;
    const floor = role === 'linear' ? LAWS.linearFloor : LAWS.fieldFloor;
    if (L > ceiling) out.push(`L* ${L.toFixed(1)} breaks the chalk ceiling (${ceiling})`);
    if (L < floor) out.push(`L* ${L.toFixed(1)} breaks the ink floor (${floor})`);
    if (role !== 'ball' && LAWS.reserved(hex)) out.push('sits inside the ball\'s reserved band');
    return out;
  },
};

/**
 * The two-sided ball, as a function (§2.5). Given whatever is behind the ball, which
 * treatment is carrying it, and by how much? Under 4.0 anywhere along the arc is a bug.
 */
export function ballRead(backdropHex) {
  const rim = contrast(CHALK, backdropHex);
  const ink = contrast(INK, backdropHex);
  return { rim, ink, best: Math.max(rim, ink), carrier: rim >= ink ? 'rim' : 'ink' };
}

/**
 * Audit every published colour against its own laws. Returns [] when the palette is clean.
 * Used by the style_sheet scenario and cheap enough to call from a test.
 */
export function audit() {
  const bad = [];
  const push = (name, hex, role) => {
    for (const why of LAWS.check(hex, role)) bad.push(`${name} ${hexCSS(hex)}: ${why}`);
  };
  for (const [k, v] of Object.entries(PAVEMENT)) push(`PAVEMENT.${k}`, v, k === 'manholeLow' ? 'linear' : 'backdrop');
  for (const [k, v] of Object.entries(FACADE)) {
    const role = k === 'iron' || k === 'sash' ? 'linear' : 'backdrop';
    if (Array.isArray(v)) v.forEach((c, i) => push(`FACADE.${k}[${i}]`, c, role));
    else push(`FACADE.${k}`, v, role);
  }
  for (const [k, v] of Object.entries(AIR)) {
    if (k === 'sunTint' || k === 'shadowTint' || k === 'brickBounce' || k === 'skyFill') continue;
    push(`AIR.${k}`, v, 'backdrop');
  }
  SKIN.forEach((c, i) => push(`SKIN[${i}]`, c, 'world'));
  CLOTH.forEach((c, i) => push(`CLOTH[${i}]`, c, 'world'));
  for (const [k, v] of Object.entries(ACCENTS)) push(`ACCENTS.${k}`, v, 'world');
  push('BLUSH', BLUSH, 'world');
  const worst = Math.min(...Object.values(PAVEMENT).map((c) => ballRead(c).best),
    ...Object.values(FACADE).filter((c) => typeof c === 'number').map((c) => ballRead(c).best));
  if (worst < LAWS.ballContrast) bad.push(`ball best-of-two falls to ${worst.toFixed(2)}:1`);
  return bad;
}

export const css = hexCSS;

export default {
  CHALK, INK, PAVEMENT, FACADE, SPECULAR, AIR, BALL, SKIN, BLUSH, SMUDGE, CLOTH, ACCENTS, TEAMS,
  LAWS, soot, sunlit, shade, bounce, inkOf, ramp, sootAtHeight, hazeAt, mix, lstar, contrast,
  ballRead, audit, css,
};

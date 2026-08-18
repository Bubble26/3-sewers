/**
 * The master palette, transcribed from docs/DESIGN-BIBLE.md §2.
 * Owned by the art-direction piece. Every other system imports from here and never writes a
 * hex literal of its own — that is what keeps twenty parallel builders producing one game.
 *
 * The three laws that matter most when you reach for a colour:
 *   1. Soot is a VALUE shift, never a saturation shift. Dirty surfaces get darker, not greyer.
 *   2. CHALK (#F6F0E2) is the readability ceiling and INK (#2A1D1A) the floor — both are
 *      reserved. Nothing else in the world may be that light or that dark.
 *   3. The crown of the roadway, where the game happens, is the brightest ground in frame.
 */

export const CHALK = 0xf6f0e2;   // reserved: chalk marks, pitch ring, landing marker, ball rim
export const INK = 0x2a1d1a;     // reserved: outlines on characters, props, ball, HUD rules

export const PAVEMENT = {
  asphaltShade: 0x6e5c4c,        // base roadway
  asphaltSun: 0x8a7157,          // the sun band across the street
  asphaltDark: 0x5a4e46,         // newer tar patch
  asphaltWarm: 0x7e6a52,         // older oxidised patch
  belgianBlock: 0x957b60,        // block surfacing through worn asphalt
  blockCrown: 0xa8917a,          // wear-polished crown — brightest ground in frame
  sidewalk: 0x9a9184,            // bluestone flag
  curb: 0x8e877a,                // granite
  manholeHigh: 0x9a9188,         // worn high points of the cast iron
  manholeLow: 0x4a4038,          // recesses, lifted off pure black on purpose
};

export const FACADE = {
  brickSun: 0xc86e4c,
  brick: 0xa85c42,               // the workhorse
  brickSoot: 0x8a4a3a,           // floors four and five
  brickShade: 0x6b4235,          // under cornices, in areaways
  mortar: 0xb49c86,
  ochre: 0xc8924e,               // one building in eight
  ochreShade: 0x9e7a46,
  partyWall: 0xb8a88e,           // painted-out wall, the ghost-sign ground
  cornice: [0x7a4a34, 0x4c4a3c, 0x5b3b33],
  sash: [0x2e4034, 0x5a2a24, 0x332f2c],
  iron: [0x332e2a, 0x6e4231, 0x8a6a54],   // fire escapes, railings, lamp posts
};

export const AIR = {
  skyUpper: 0x6fa3d6,
  skyLower: 0xa8c6e2,
  haze: 0xd8cfb8,                // coal-haze band at the street mouth
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
  rim: CHALK,
  outline: INK,
};

/** Six-step skin ramp. Kids are assigned a step, not a colour. */
export const SKIN = [0xf8d6b6, 0xefc199, 0xdfa377, 0xc07e52, 0x96603a, 0x6a4128];
export const BLUSH = 0xe08878;

/** Undyed cloth. Four values, no hue — most of every kid is made of these. */
export const CLOTH = [0xe8dcc4, 0xddcfb4, 0xd2c3a6, 0xefe6d2];

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

const HEX = (n) => `#${n.toString(16).padStart(6, '0')}`;

/** Darken toward soot: a value shift, saturation untouched. amount 0..1 */
export function soot(hex, amount = 0.25) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const k = 1 - amount;
  return ((Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k));
}

/** Push a colour toward the direct-sun tint, capped so nothing outruns chalk. */
export function sunlit(hex, amount = 0.3) {
  const mix = (a, b, t) => Math.round(a + (b - a) * t);
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const sr = (AIR.sunTint >> 16) & 255, sg = (AIR.sunTint >> 8) & 255, sb = AIR.sunTint & 255;
  return ((mix(r, sr, amount) << 16) | (mix(g, sg, amount) << 8) | mix(b, sb, amount));
}

export const css = HEX;
export default { CHALK, INK, PAVEMENT, FACADE, AIR, BALL, SKIN, BLUSH, CLOTH, ACCENTS, TEAMS, soot, sunlit, css };

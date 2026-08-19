/**
 * materials.js — the shading model, published as an API.
 *
 * DESIGN-BIBLE §4: a two-band toon ramp with a third bounce band, hand-authored textures,
 * and a controlled ink outline. No PBR. No normal maps. No ambient occlusion. Specular on
 * exactly three named materials (glass, gold leaf, wet asphalt) and nowhere else.
 *
 * WHAT A BUILDER NEEDS TO KNOW, in four lines:
 *
 *     import { MAT, addOutline, contactShadow } from '../render/materials.js';
 *     mesh.material = MAT.toon(FACADE.brick);        // banded, warm-to-cool, cached
 *     addOutline(kid, { px: 2 });                    // ink outline, screen-constant width
 *     group.add(contactShadow(1.6));                 // §2.7, and it is never optional
 *
 * Everything is CACHED by value, so a hundred bricks share one material and one draw call
 * per geometry. Ask for the same colour twice and you get the same material twice.
 *
 * THE RAMP (§4.1). Three bands, chosen by the world normal against ONE fixed sun, never a
 * per-pixel light integral:
 *     lit     the authored colour
 *     shade   0.72x luminance, 6° toward skylight — the shadows go BLUE as the light goes GOLD
 *     bounce  a narrow warm strip on undersides and on low upward faces, off the roadway
 * The terminator is hard, with a 2-3 px soft edge held constant in SCREEN space via
 * derivatives, so it does not turn to mush at distance or to a staircase up close.
 *
 * THE OUTLINE (§4.2). An inverted hull whose width is constant in pixels, not in world units,
 * clamped to 1-4 px. Colour is inkOf(fill): the fill's own hue, darker and MORE saturated.
 * Never a uniform grey. Characters and gameplay-critical props get 2 px; background
 * architecture gets <= 60% of that, or nothing.
 *
 * THE TEXTURES (§4.3). Painted in a canvas at build time, feature scale >= 6 px at 1600x900,
 * soot baked in vertically as a VALUE shift (Law 3). Never noise, never a tiling photo, never
 * a roughness map, never a dirt overlay.
 */
import * as THREE from 'three';
import { registerScenario } from '../core/scenarios.js';
import { RNG } from '../core/rng.js';
import {
  CHALK, INK, PAVEMENT, FACADE, AIR, BALL, SKIN, BLUSH, SMUDGE, CLOTH, ACCENTS, SPECULAR,
  soot, sunlit, shade, bounce, inkOf, ramp, sootAtHeight, mix, hexCSS, lstar, hexOf, rgbOf,
} from './palette.js';

/* ============================================================================
   1. The art block — one set of uniforms shared by every material in the game.
      Change the sun here and the whole street turns with it.
   ========================================================================= */

export const ART = {
  /** Direction TOWARD the sun. §3.2: 3:50 pm, altitude 33°, behind the camera's right shoulder. */
  sun: new THREE.Vector3(0.60, 0.62, 0.50).normalize(),
  /** Terminator softness in pixels at 1600x900 (§4.1: 2-3 px, and no more). */
  terminatorPx: 2.4,
  /** Global outline weight multiplier — the one dial for "more/less ink". */
  outlineScale: 1.0,
  /**
   * Where the terminator sits. At 0 the band boundary is exactly at the sun's horizon, which
   * on a street lit from behind the camera puts every camera-facing surface in the lit band
   * and makes a toon ramp look like flat colour. A small positive bias walks the boundary
   * into the light so a round form shows the shade band as a crescent, which is what makes
   * this read as BANDED rather than as unlit. Ambient stays at 72% of key either way, so
   * BYB §2.5's "ambient never below 55% of key" is untouched — this moves the edge, not the
   * ratio.
   */
  bandBias: 0.11,
  /** The bounce strip runs from this height to bounceHeight, in feet (§4.1: "a narrow strip"). */
  bounceLo: 0.7,
  /** Height in feet over which the roadway's warm bounce dies out. */
  bounceHeight: 5.0,
  /** Drawing-buffer height, refreshed every frame by syncArt(). */
  viewportH: 900,
  /** 'high' | 'medium' | 'low' — set from app.flags.quality. */
  quality: 'high',
  /** When set to { scene, camera }, postfx renders that instead of the game scene. */
  overrideView: null,
};

const shared = {
  uSun: { value: ART.sun },
  uTermPx: { value: ART.terminatorPx },
  uViewH: { value: ART.viewportH },
  uBounceH: { value: ART.bounceHeight },
  uBounceLo: { value: ART.bounceLo },
  uBias: { value: ART.bandBias },
  uOutlineScale: { value: ART.outlineScale },
};

/**
 * DRAW ORDER ON THE GROUND PLANE. Every flat thing we lay on the road is transparent, so
 * three sorts it by renderOrder and the last one painted wins. Before this table existed the
 * sun band was painted OVER the contact shadows and the chalk, which deleted both — the kids
 * floated and the pitch ring went pale, and no amount of tuning the opacities would have
 * found it. Read it as a paint-layer stack, bottom to top:
 *
 *   LAYER.crown    the scoured bright crown of the roadway              (Law 1, material)
 *   LAYER.light    the sun band and the painted shade shapes            (§3.2, a colour event)
 *   LAYER.chalk    chalk marks — they sit ON the road, in the sun or not
 *   LAYER.shadow   contact shadows — nothing is allowed to paint over a contact shadow
 */
export const LAYER = { crown: -8, light: -6, chalk: -4, shadow: -2 };

/** Called once per frame by the postfx system. Keeps every cached material honest. */
export function syncArt(app) {
  const r = app?.stage?.renderer;
  if (r) {
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    ART.viewportH = size.y || ART.viewportH;
  }
  if (app?.flags?.quality) ART.quality = app.flags.quality;
  // Follow the lighting piece's key light if there is one, so the toon ramp and the world's
  // cast shadows never disagree about where the sun is. A view with its own authored sun
  // (the style sheet) wins, because an art board must not move when the game's clock does.
  if (ART.overrideView?.sun) {
    ART.sun.copy(ART.overrideView.sun);
  } else if (!ART._sunLocked && app?.scene) {
    const key = app.scene.children.find((o) => o.isDirectionalLight && o.intensity > 1);
    if (key) ART.sun.copy(key.position).normalize();
  }
  shared.uSun.value = ART.sun;
  shared.uTermPx.value = ART.terminatorPx;
  shared.uViewH.value = ART.viewportH;
  shared.uBounceH.value = ART.bounceHeight;
  shared.uBounceLo.value = ART.bounceLo;
  shared.uBias.value = ART.bandBias;
  shared.uOutlineScale.value = ART.outlineScale;
}

/* ============================================================================
   2. Hand-painted textures. Canvas at build time, cached, feature scale >= 6 px.
   ========================================================================= */

const texCache = new Map();
const matCache = new Map();
const CSS = (h) => hexCSS(h);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function finish(c, { repeat = [1, 1], wrap = [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping], data = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  // A colour map is authored in sRGB and must be decoded; a value-modulation or alpha map is
  // DATA and must not be, or every grey in it lands 20 points darker than it was painted.
  t.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.wrapS = wrap[0]; t.wrapT = wrap[1];
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}
function cachedTex(key, build) {
  if (!texCache.has(key)) texCache.set(key, build());
  return texCache.get(key);
}

/**
 * Brick, painted as courses with the soot gradient baked in vertically (§4.3).
 * `feet` is the wall height the texture covers, so soot is a function of real height and the
 * bottom band picks up the roadway's warm bounce. One brick is ~30 px here, ~10 px on screen.
 */
export function brickTexture({
  base = FACADE.brick, mortar = FACADE.mortar, seed = 7, feet = 24, wide = 12,
  sootMax = 0.30, sun = 0.0, power = 1.25,
} = {}) {
  const key = `brick:${base}:${mortar}:${seed}:${feet}:${wide}:${sootMax}:${sun}:${power}`;
  return cachedTex(key, () => {
    const W = 512, H = 1024;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    const pxPerFtY = H / feet, pxPerFtX = W / wide;
    const course = 0.219 * pxPerFtY;             // 2 1/4" brick + 3/8" joint
    const brickW = 0.698 * pxPerFtX;             // 8" brick + joint
    g.fillStyle = CSS(soot(mortar, 0.30));      // a joint in a sooty city is DARKER than
    g.fillRect(0, 0, W, H);                     // the brick, not a white grid over it
    const rows = Math.ceil(H / course) + 1;
    for (let row = 0; row < rows; row++) {
      const yTop = H - (row + 1) * course;
      const heightFt = (row * course) / pxPerFtY;
      const off = row % 2 ? brickW * 0.5 : 0;
      for (let i = -1; i * brickW + off < W + brickW; i++) {
        const x = i * brickW + off;
        // Law 1 + Law 3: soot is a function of height and it takes value only.
        let col = sootAtHeight(base, heightFt, { curb: 0, cornice: feet, max: sootMax, power });
        if (sun > 0) col = sunlit(col, sun * Math.min(1, heightFt / feet) * 0.8);
        if (heightFt < 3.2) col = mix(col, AIR.brickBounce, 0.16 * (1 - heightFt / 3.2));
        const v = R.range(-0.10, 0.085);
        col = v < 0 ? soot(col, -v) : mix(col, AIR.sunTint, v * 0.9);
        if (R.chance(0.06)) col = soot(col, 0.34);               // a clinker in the course
        else if (R.chance(0.05)) col = mix(col, FACADE.ochre, 0.30);  // and an odd salmon one
        g.fillStyle = CSS(col);
        g.fillRect(Math.round(x) + 1, Math.round(yTop) + 1, Math.ceil(brickW) - 1, Math.ceil(course) - 1);
      }
    }
    // Drawn grime, never filtered: two streaks and a shadow line, both >= 6 px wide.
    // Drawn grime, never filtered: a streak below a sill, dying out well before the top of
    // the wall so a clamped texture never turns the soot into wallpaper.
    g.globalAlpha = 0.26;
    for (let i = 0; i < 4; i++) {
      const x = R.range(0, W), w = R.range(8, 18), top = R.range(H * 0.30, H * 0.55);
      const grd = g.createLinearGradient(0, top, 0, top + H * 0.34);
      grd.addColorStop(0, 'rgba(30,20,14,0.75)');
      grd.addColorStop(1, 'rgba(30,20,14,0)');
      g.fillStyle = grd;
      g.fillRect(x, top, w, H * 0.34);
    }
    g.globalAlpha = 1;
    return finish(c, { repeat: [1, 1], wrap: [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping] });
  });
}

/** Bluestone / granite: big flags, drawn joints, a polished crown. Matte, always. */
export function stoneTexture({ base = PAVEMENT.sidewalk, seed = 3, cols = 3, rows = 4 } = {}) {
  const key = `stone:${base}:${seed}:${cols}:${rows}`;
  return cachedTex(key, () => {
    const W = 512, H = 512;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    g.fillStyle = CSS(soot(base, 0.22));
    g.fillRect(0, 0, W, H);
    const fw = W / cols, fh = H / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const flag = R.chance(0.5) ? mix(base, CHALK, R.range(0, 0.10)) : soot(base, R.range(0, 0.10));
        g.fillStyle = CSS(flag);
        g.fillRect(x * fw + 3, y * fh + 3, fw - 6, fh - 6);
        // a worn lighter track down the middle of the flag, drawn as a soft band
        g.fillStyle = CSS(mix(flag, CHALK, 0.07));
        g.fillRect(x * fw + fw * 0.18, y * fh + 3, fw * 0.64, fh - 6);
        if (R.chance(0.4)) {
          g.fillStyle = CSS(soot(flag, 0.22));
          g.fillRect(x * fw + R.range(6, fw - 20), y * fh + fh - 12, R.range(10, 22), 8);
        }
      }
    }
    return finish(c, { repeat: [1, 1], wrap: [THREE.RepeatWrapping, THREE.RepeatWrapping] });
  });
}

/**
 * Roadway. One tile is 12 ft, so every drawn feature is at the >= 6 px scale the bible asks
 * for and nothing smears into a mud stain. The bright crown is NOT in here — it is a separate
 * strip of geometry down the middle of the street, because Law 1 is a composition, not a tile.
 */
export function asphaltTexture({ seed = 11 } = {}) {
  return cachedTex(`asphalt:${seed}`, () => {
    const W = 512, H = 512;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    g.fillStyle = CSS(PAVEMENT.asphaltShade);
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 18; i++) {                    // patches: older tar, newer tar, drawn
      g.fillStyle = CSS(R.pick([PAVEMENT.asphaltDark, PAVEMENT.asphaltWarm, PAVEMENT.asphaltWarm, PAVEMENT.asphaltSun]));
      g.beginPath();
      g.ellipse(R.range(0, W), R.range(0, H), R.range(30, 78), R.range(22, 52), R.range(0, 3.14), 0, 6.3);
      g.fill();
    }
    for (let i = 0; i < 7; i++) {                     // Belgian block surfacing through a hole
      const x0 = R.range(0, W), y0 = R.range(0, H), w = R.range(60, 130), h = R.range(40, 80);
      g.fillStyle = CSS(soot(PAVEMENT.belgianBlock, 0.10));
      g.beginPath();
      g.ellipse(x0, y0, w / 2, h / 2, 0, 0, 6.3);
      g.fill();
      for (let by = -h / 2; by < h / 2; by += 11) {
        for (let bx = -w / 2; bx < w / 2; bx += 17) {
          const px = x0 + bx + (Math.round(by / 11) % 2 ? 8 : 0), py = y0 + by;
          if ((px - x0) ** 2 / (w * w / 4) + (py - y0) ** 2 / (h * h / 4) > 0.9) continue;
          g.fillStyle = CSS(mix(PAVEMENT.belgianBlock, PAVEMENT.blockCrown, R.range(0, 0.9)));
          g.fillRect(px - 7, py - 4, 14, 8);
        }
      }
    }
    for (let i = 0; i < 5; i++) {                     // tar seams: drawn, thin, and they wander
      g.strokeStyle = CSS(soot(PAVEMENT.asphaltDark, 0.20));
      g.lineWidth = R.range(5, 8);
      g.beginPath();
      let x = R.range(0, W), y = -10;
      g.moveTo(x, y);
      while (y < H + 10) { y += 46; x += R.range(-18, 18); g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 40; i++) {                    // grit, at 6 px, so it survives a downsample
      g.fillStyle = CSS(R.chance(0.5) ? soot(PAVEMENT.asphaltShade, 0.14) : PAVEMENT.belgianBlock);
      g.fillRect(R.range(0, W), R.range(0, H), R.range(6, 10), R.range(5, 8));
    }
    return finish(c, { wrap: [THREE.RepeatWrapping, THREE.RepeatWrapping] });
  });
}

/**
 * The wear-polished crown of the roadway (Law 1): the brightest ground surface in the frame,
 * laid over the asphalt as a soft-edged strip exactly where the traffic and the game are.
 */
export function crownStrip(length = 200, width = 26, seed = 15) {
  const map = cachedTex(`crown:${seed}`, () => {
    const W = 256, H = 256;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    g.clearRect(0, 0, W, H);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, 'rgba(168,145,122,0)');
    grd.addColorStop(0.32, 'rgba(168,145,122,0.55)');
    grd.addColorStop(0.5, 'rgba(168,145,122,0.85)');
    grd.addColorStop(0.7, 'rgba(168,145,122,0.5)');
    grd.addColorStop(1, 'rgba(168,145,122,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {                    // polished block heads down the crown
      const y = H * 0.5 + R.range(-H * 0.16, H * 0.16);
      g.fillStyle = `rgba(196,176,152,${R.range(0.3, 0.8).toFixed(2)})`;
      g.fillRect(R.range(0, W), y, R.range(12, 20), R.range(7, 11));
    }
    return finish(c, { wrap: [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping] });
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(length, width), new THREE.MeshBasicMaterial({
    map, transparent: true, depthWrite: false, fog: true,
  }));
  m.material.map.repeat.set(length / 24, 1);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -3;
  return m;
}

/**
 * A painted shade shape: the soft dark ground an awning, a stoop or a cornice throws. Drawn,
 * never computed — §4.3 wants grime and shade as SHAPES, and this is the same tool.
 */
export function shadePatch(w, h, { opacity = 0.30, soft = 0.34, color = AIR.shadowTint } = {}) {
  const map = cachedTex(`shade:${soft.toFixed(2)}`, () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    const band = (horiz) => {
      const grd = horiz ? g.createLinearGradient(0, 0, 128, 0) : g.createLinearGradient(0, 0, 0, 128);
      grd.addColorStop(0, '#000000');
      grd.addColorStop(soft, '#ffffff');
      grd.addColorStop(1 - soft, '#ffffff');
      grd.addColorStop(1, '#000000');
      return grd;
    };
    g.fillStyle = band(false);
    g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = band(true);
    g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'source-over';
    return finish(c, { data: true, wrap: [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping] });
  });
  const mat = cachedMat(`shadepatch:${opacity}:${color}`, () => new THREE.MeshBasicMaterial({
    color, alphaMap: map, transparent: true, opacity, depthWrite: false, fog: true,
  }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.renderOrder = -2;
  return m;
}

/**
 * The three VALUE textures. These are greyscale DATA maps centred on 0.5 — the material tints
 * them, so one iron texture serves every iron colour in the game and one knit serves twelve
 * wools. That is what keeps the material cache small. Range is held inside 0.36-0.66 so a
 * texture can never push a colour past the chalk ceiling or under the ink floor.
 */
const V = (t) => `rgb(${Math.round(255 * t)},${Math.round(255 * t)},${Math.round(255 * t)})`;

/** Cast and wrought iron: pitting, a couple of rust blooms, matte. Never a shine. */
export function ironTexture({ seed = 5, rust = 0.5 } = {}) {
  return cachedTex(`ironV:${seed}:${rust}`, () => {
    const W = 256, H = 256;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    g.fillStyle = V(0.5);
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 34; i++) {
      g.fillStyle = V(R.range(0.40, 0.62));
      g.beginPath();
      g.ellipse(R.range(0, W), R.range(0, H), R.range(6, 16), R.range(5, 12), 0, 0, 6.3);
      g.fill();
    }
    for (let i = 0; i < 5 * rust; i++) {          // rust blooms read as a value bloom, drawn
      g.fillStyle = V(R.range(0.56, 0.64));
      g.beginPath();
      g.ellipse(R.range(0, W), R.range(0, H), R.range(9, 22), R.range(7, 17), 0, 0, 6.3);
      g.fill();
    }
    return finish(c, { data: true, wrap: [THREE.RepeatWrapping, THREE.RepeatWrapping] });
  });
}

/** Knitted wool: horizontal ribs, dropped stitches. This is where a kid's chroma lives. */
export function knitTexture({ seed = 9 } = {}) {
  return cachedTex(`knitV:${seed}`, () => {
    const W = 128, H = 128;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    g.fillStyle = V(0.5);
    g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 16) {
      g.fillStyle = V(0.57);
      g.fillRect(0, y, W, 9);
      g.fillStyle = V(0.43);
      g.fillRect(0, y + 9, W, 4);
      for (let x = R.int(0, 16); x < W; x += 16) {
        g.fillStyle = V(0.45);
        g.fillRect(x, y + 2, 6, 6);
      }
    }
    return finish(c, { data: true, wrap: [THREE.RepeatWrapping, THREE.RepeatWrapping] });
  });
}

/** Ecru shirting: a soft weave and a couple of drawn creases. */
export function clothTexture({ seed = 13 } = {}) {
  return cachedTex(`clothV:${seed}`, () => {
    const W = 128, H = 128;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    g.fillStyle = V(0.5);
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = V(R.chance(0.5) ? 0.44 : 0.57);
      g.lineWidth = R.range(6, 11);
      g.beginPath();
      const y = R.range(0, H);
      g.moveTo(0, y); g.lineTo(W, y + R.range(-20, 20));
      g.stroke();
    }
    return finish(c, { data: true, wrap: [THREE.RepeatWrapping, THREE.RepeatWrapping] });
  });
}

/* ----------------------------------------------------------------------------
   Painted lettering for the WORLD ONLY. §6.1 picks French Clarendon — the fat
   condensed slab of the period's wall ads — so that is what these glyphs are: a heavy
   condensed skeleton on a 6x10 body with square slab serifs and a hand wobble.
   §6.3 is explicit that world lettering and HUD lettering are different jobs: this draws
   ads, shop boards and crate stencils on physical surfaces. It never renders a pixel of HUD,
   and the typography piece owns the two real faces.
   ------------------------------------------------------------------------- */

const GLYPHS = {
  A: [[0, 0, 1.7, 8], [4.3, 0, 1.7, 8], [0, 8, 6, 2], [1.7, 4.0, 2.6, 1.8]],
  B: [[0, 0, 1.8, 10], [1.8, 8, 3.0, 2], [1.8, 4.1, 2.7, 1.8], [1.8, 0, 3.0, 2], [4.4, 5.6, 1.6, 2.6], [4.4, 1.6, 1.6, 2.7]],
  C: [[0, 0, 1.8, 10], [1.8, 8, 4.2, 2], [1.8, 0, 4.2, 2]],
  D: [[0, 0, 1.8, 10], [1.8, 8, 2.4, 2], [1.8, 0, 2.4, 2], [4.2, 1.5, 1.8, 7.0]],
  E: [[0, 0, 1.8, 10], [1.8, 8, 4.2, 2], [1.8, 4.1, 3.2, 1.8], [1.8, 0, 4.2, 2]],
  F: [[0, 0, 1.8, 10], [1.8, 8, 4.2, 2], [1.8, 4.1, 3.2, 1.8]],
  G: [[0, 0, 1.8, 10], [1.8, 8, 4.2, 2], [1.8, 0, 4.2, 2], [4.2, 0, 1.8, 4.4], [3.2, 3.4, 2.8, 1.6]],
  H: [[0, 0, 1.8, 10], [4.2, 0, 1.8, 10], [1.8, 4.1, 2.4, 1.8]],
  I: [[2.1, 0, 1.8, 10], [0.2, 8, 5.6, 2], [0.2, 0, 5.6, 2]],
  J: [[4.2, 1.8, 1.8, 8.2], [0, 0, 4.2, 2], [0, 0.6, 1.8, 2.6]],
  K: [[0, 0, 1.8, 10], [1.8, 4.1, 1.6, 1.8], [3.2, 5.6, 1.5, 2.6], [4.5, 7.8, 1.5, 2.2], [3.2, 1.6, 1.5, 2.6], [4.5, 0, 1.5, 2.2]],
  L: [[0, 0, 1.8, 10], [1.8, 0, 4.2, 2]],
  M: [[0, 0, 1.7, 10], [4.3, 0, 1.7, 10], [1.7, 6.6, 1.3, 3.4], [3.0, 6.6, 1.3, 3.4], [2.6, 5.0, 0.9, 2.0]],
  N: [[0, 0, 1.8, 10], [4.2, 0, 1.8, 10], [1.8, 6.2, 1.3, 2.6], [3.0, 3.2, 1.3, 3.0]],
  O: [[0, 1.6, 1.8, 6.8], [4.2, 1.6, 1.8, 6.8], [1.8, 8, 2.4, 2], [1.8, 0, 2.4, 2]],
  P: [[0, 0, 1.8, 10], [1.8, 8, 3.0, 2], [1.8, 4.1, 3.0, 1.8], [4.4, 5.6, 1.6, 2.6]],
  Q: [[0, 1.6, 1.8, 6.8], [4.2, 1.6, 1.8, 6.8], [1.8, 8, 2.4, 2], [1.8, 0, 2.4, 2], [3.8, 0, 2.2, 1.6]],
  R: [[0, 0, 1.8, 10], [1.8, 8, 3.0, 2], [1.8, 4.1, 3.0, 1.8], [4.4, 5.6, 1.6, 2.6], [3.4, 1.6, 1.5, 2.6], [4.5, 0, 1.5, 2.0]],
  S: [[0.2, 8, 5.8, 2], [0, 5.6, 1.8, 2.6], [0.2, 4.1, 5.6, 1.8], [4.2, 1.6, 1.8, 2.7], [0.2, 0, 5.8, 2]],
  T: [[0, 8, 6, 2], [2.1, 0, 1.8, 8]],
  U: [[0, 1.6, 1.8, 8.4], [4.2, 1.6, 1.8, 8.4], [1.8, 0, 2.4, 2]],
  V: [[0, 4.0, 1.8, 6], [4.2, 4.0, 1.8, 6], [1.4, 1.6, 1.6, 3.0], [3.0, 1.6, 1.6, 3.0], [1.8, 0, 2.4, 2]],
  W: [[0, 0, 1.6, 10], [4.4, 0, 1.6, 10], [1.6, 0, 1.3, 3.4], [3.1, 0, 1.3, 3.4], [2.5, 2.6, 1.0, 5.0]],
  X: [[0, 7.6, 1.7, 2.4], [4.3, 7.6, 1.7, 2.4], [1.4, 5.2, 1.6, 2.6], [3.0, 5.2, 1.6, 2.6], [2.1, 3.4, 1.8, 2.0], [1.4, 1.4, 1.6, 2.2], [3.0, 1.4, 1.6, 2.2], [0, 0, 1.7, 2.0], [4.3, 0, 1.7, 2.0]],
  Y: [[0, 6.2, 1.8, 3.8], [4.2, 6.2, 1.8, 3.8], [1.8, 4.4, 2.4, 2.2], [2.1, 0, 1.8, 4.6]],
  Z: [[0.2, 8, 5.8, 2], [3.4, 5.4, 1.6, 2.8], [1.8, 2.4, 1.6, 3.0], [0.2, 0, 5.8, 2]],
  0: [[0, 1.6, 1.8, 6.8], [4.2, 1.6, 1.8, 6.8], [1.8, 8, 2.4, 2], [1.8, 0, 2.4, 2]],
  1: [[2.1, 0, 1.8, 10], [0.6, 7.4, 1.6, 1.6], [0.4, 0, 5.2, 2]],
  2: [[0.2, 8, 5.8, 2], [4.2, 5.4, 1.8, 2.8], [2.6, 3.0, 1.8, 2.6], [0.2, 0, 5.8, 3.0]],
  3: [[0.2, 8, 5.8, 2], [4.2, 5.6, 1.8, 2.6], [1.8, 4.1, 3.0, 1.8], [4.2, 1.6, 1.8, 2.6], [0.2, 0, 5.8, 2]],
  4: [[0, 3.4, 1.8, 6.6], [4.2, 0, 1.8, 10], [1.8, 3.4, 2.4, 1.8]],
  5: [[0.2, 8, 5.8, 2], [0, 4.1, 1.8, 4.0], [0.2, 4.1, 5.6, 1.8], [4.2, 1.6, 1.8, 2.6], [0.2, 0, 5.8, 2]],
  6: [[0, 0, 1.8, 10], [0.2, 8, 5.8, 2], [1.8, 4.1, 4.2, 1.8], [4.2, 1.6, 1.8, 2.6], [1.8, 0, 2.6, 2]],
  7: [[0, 8, 6, 2], [3.4, 4.6, 1.8, 3.6], [2.2, 0, 1.8, 4.8]],
  8: [[0, 1.6, 1.8, 6.8], [4.2, 1.6, 1.8, 6.8], [1.8, 8, 2.4, 2], [1.8, 4.1, 2.4, 1.8], [1.8, 0, 2.4, 2]],
  9: [[4.2, 0, 1.8, 10], [0, 5.6, 1.8, 2.6], [0.2, 8, 5.8, 2], [0.2, 4.1, 4.2, 1.8], [1.8, 0, 2.6, 2]],
  '.': [[2.1, 0, 1.9, 2]],
  ',': [[2.1, 0, 1.9, 2], [1.5, -1.6, 1.6, 1.8]],
  '&': [[0.4, 1.6, 1.8, 5.0], [1.4, 8, 3.0, 2], [4.0, 5.8, 1.8, 2.4], [1.2, 0, 3.4, 2], [4.6, 0, 1.6, 2.6], [2.4, 3.2, 2.6, 2.0]],
  "'": [[2.4, 7.4, 1.4, 2.6]],
  '-': [[0.8, 4.1, 4.4, 1.8]],
  '¢': [[0.6, 1.4, 1.8, 6.4], [2.4, 7.0, 3.2, 1.8], [2.4, 1.0, 3.2, 1.8], [2.6, 0, 1.4, 9.6]],
  ' ': [],
};

/**
 * Paint a line of French Clarendon on a canvas. Jitter is seeded and stable per string
 * (§6.4: jitter that re-rolls per frame reads as a rendering bug, not as a hand).
 */
export function slabText(g, text, x, y, size, {
  color = CHALK, tracking = 0.22, seed = 3, jitter = 1, shadow = null, weight = 1,
} = {}) {
  const R = new RNG(seed + text.length * 17);
  const unit = size / 10;
  const adv = 6 * unit * (1 + tracking);
  let cx = x;
  for (const ch of text.toUpperCase()) {
    const rects = GLYPHS[ch];
    if (rects) {
      g.save();
      g.translate(cx + 3 * unit, y - 5 * unit);
      g.rotate(R.range(-0.026, 0.026) * jitter);
      const sc = 1 + R.range(-0.03, 0.03) * jitter;
      g.scale(sc, sc * (1 + R.range(-0.02, 0.02) * jitter));
      g.translate(-3 * unit, 5 * unit);
      for (const pass of shadow ? [shadow, color] : [color]) {
        const off = pass === shadow ? unit * 0.55 : 0;
        g.fillStyle = CSS(pass);
        for (const [rx, ry, rw, rh] of rects) {
          g.fillRect(rx * unit + off, -(ry + rh) * unit + off,
            rw * unit * (weight === 1 ? 1 : weight), rh * unit);
        }
      }
      g.restore();
    }
    cx += adv;
  }
  return cx - x - adv * tracking / (1 + tracking);
}

/** How wide a slabText call will come out, so a sign can centre itself. */
export function slabWidth(text, size, tracking = 0.22) {
  return text.length * 6 * (size / 10) * (1 + tracking);
}

/**
 * A painted advertisement on brick. Period-true (1925 New York was over-lettered, §Law 4 and
 * check A3) and it is where a wall pays its saturation bill. `wear` knocks the paint back so
 * the brick comes through and it reads as a ghost sign rather than a sticker.
 */
export function paintedSign(lines, {
  w = 512, h = 256, color = CLOTH[0], shadow = null, wear = 0.35, seed = 5, ground = null,
} = {}) {
  const key = `sign:${lines.map((l) => l.text).join('|')}:${color}:${wear}:${w}:${h}:${ground}`;
  return cachedTex(key, () => {
    const [c, g] = canvas(w, h);
    const R = new RNG(seed);
    if (ground !== null) { g.fillStyle = CSS(ground); g.fillRect(0, 0, w, h); }
    for (const ln of lines) {
      const size = ln.size * h;
      const wide = slabWidth(ln.text, size, ln.tracking ?? 0.22);
      const x = ln.x !== undefined ? ln.x * w : (w - wide) / 2;
      slabText(g, ln.text, x, ln.y * h, size, {
        color: ln.color ?? color, shadow: ln.shadow ?? shadow, tracking: ln.tracking ?? 0.22, seed: seed + lines.indexOf(ln) * 7,
      });
    }
    if (wear > 0) {                       // a hundred winters of it, drawn as shapes
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 260; i++) {
        g.globalAlpha = R.range(0.15, 0.95) * wear * 1.4;
        g.beginPath();
        g.ellipse(R.range(0, w), R.range(0, h), R.range(3, 16), R.range(3, 12), R.range(0, 3), 0, 6.3);
        g.fill();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    return finish(c, { wrap: [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping] });
  });
}

/**
 * Window glass — one of the three materials §4.3 lets us shine. The highlight is PAINTED
 * (a hard diagonal streak with a soft companion), because that is how a sprite artist did it
 * and because a real specular term would be the only physically-lit thing in the game.
 */
export function glassTexture({ seed = 17 } = {}) {
  return cachedTex(`glass:${seed}`, () => {
    const W = 128, H = 256;
    const [c, g] = canvas(W, H);
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, CSS(SPECULAR.glassSky));
    grd.addColorStop(0.42, CSS(mix(SPECULAR.glassSky, SPECULAR.glass, 0.75)));
    grd.addColorStop(1, CSS(SPECULAR.glass));
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W * 0.62, H * 0.30);
    g.rotate(-0.62);
    g.fillStyle = CSS(SPECULAR.glassSpec);
    g.fillRect(-9, -H * 0.5, 18, H);
    g.globalAlpha = 0.5;
    g.fillRect(20, -H * 0.5, 9, H);
    g.restore();
    return finish(c, { repeat: [1, 1], wrap: [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping] });
  });
}

/**
 * A soft round contact shadow (§2.7). This is an alphaMap, and three reads the GREEN channel
 * of an alphaMap — not the alpha channel — so it is painted black-to-white and flagged data.
 */
function shadowTexture() {
  return cachedTex('shadow', () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#000';
    g.fillRect(0, 0, 128, 128);
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.50, '#e0e0e0');
    grd.addColorStop(0.80, '#4a4a4a');
    grd.addColorStop(1, '#000000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return finish(c, { data: true, wrap: [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping] });
  });
}

/**
 * Chalk, drawn by a kid with a lump of it: broken strokes, scuffed middles, a 1.5 px ink
 * outline is NOT drawn here (that is the outline pass's job on gameplay marks) but the
 * stroke is deliberately ragged so it never reads as a decal.
 */
export function chalkTexture(draw, { size = 512, seed = 23 } = {}) {
  const key = `chalk:${draw.name || draw.toString().length}:${size}:${seed}`;
  return cachedTex(key, () => {
    const [c, g] = canvas(size, size);
    const R = new RNG(seed);
    g.clearRect(0, 0, size, size);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = CSS(CHALK);
    g.fillStyle = CSS(CHALK);
    draw(g, R, size);
    // scuff: knock holes in the chalk so it reads as dust on stone, not as paint
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 220; i++) {
      g.globalAlpha = R.range(0.10, 0.5);
      g.beginPath();
      g.ellipse(R.range(0, size), R.range(0, size), R.range(3, 11), R.range(3, 9), R.range(0, 3), 0, 6.3);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    return finish(c, { wrap: [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping] });
  });
}

/* ============================================================================
   3. The toon shader. Three bands, one fixed sun, a screen-constant terminator.
   ========================================================================= */

const TOON_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
varying vec3 vWN;
varying vec3 vWP;
varying vec2 vUvA;
void main() {
  vUvA = uv;
  #include <beginnormal_vertex>
  vec3 objN = objectNormal;
  #ifdef USE_INSTANCING
    objN = mat3( instanceMatrix ) * objN;
  #endif
  vWN = normalize( mat3( modelMatrix ) * objN );
  #include <begin_vertex>
  vec4 wp = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vWP = wp.xyz;
  #include <project_vertex>
  #include <fog_vertex>
}`;

const TOON_FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uBounce;
uniform vec3 uSun;
uniform float uTermPx;
uniform float uViewH;
uniform float uBounceH;
uniform float uBounceLo;
uniform float uBias;
uniform float uBounceStr;
uniform float uBandBias;
uniform float uOpacity;
uniform float uTexMode;
uniform float uTexAmt;
uniform float uTexAlpha;
uniform vec2 uTexRepeat;
uniform sampler2D uTex;
varying vec3 vWN;
varying vec3 vWP;
varying vec2 vUvA;

void main() {
  vec3 n = normalize( vWN );
  float ndl = dot( n, uSun );

  // Band 1/2. Hard terminator, softened by exactly uTermPx pixels — held in SCREEN space so
  // it never turns to mush at distance and never staircases up close.
  float w = max( fwidth( ndl ), 1e-4 ) * uTermPx * 0.5;
  float lit = smoothstep( -w, w, ndl - uBandBias - uBias );

  vec3 c = uLit;
  float alpha = uOpacity;
  if ( uTexMode > 0.5 ) {
    vec4 t = texture2D( uTex, vUvA * uTexRepeat );
    c = ( uTexMode < 1.5 ) ? mix( uLit, t.rgb, uTexAmt )          // painted colour map
                           : uLit * mix( 1.0, t.r * 2.0, uTexAmt );       // value modulation
    if ( uTexAlpha > 0.5 ) alpha *= t.a;
  }
  vec3 sr = uShade / max( uLit, vec3( 0.004 ) );
  vec3 br = uBounce / max( uLit, vec3( 0.004 ) );
  vec3 col = mix( c * sr, c, lit );

  // Band 3, §4.1: "a NARROW STRIP on upward-facing surfaces near the ground and on the
  // underside of forms". The emphasis is the whole point. The previous form ramped smoothly
  // from the ground to bounceHeight, which turned every ground plane into cream and airbrushed
  // a soft vertical gradient up every kid — a gradient is the one thing a banded ramp is not.
  // Now it is a band with an edge:
  //   · undersides take the kick from the roadway, fading out with height above it
  //   · upward faces take it only between bounceLo and bounceHeight — and NOT at y = 0,
  //     because the roadway is the surface doing the bouncing and cannot bounce off itself
  float up = max( n.y, 0.0 );
  float down = max( -n.y, 0.0 );
  float h = vWP.y;
  float strip = smoothstep( uBounceLo * 0.35, uBounceLo, h ) * ( 1.0 - smoothstep( uBounceH * 0.70, uBounceH, h ) );
  float fromRoad = 1.0 - smoothstep( uBounceH * 0.6, uBounceH * 2.6, h );
  float bmRaw = clamp( down * fromRoad * 0.95 + up * strip * 0.80, 0.0, 1.0 );
  float bw = max( fwidth( bmRaw ), 0.02 );
  float bm = smoothstep( 0.34 - bw, 0.34 + bw, bmRaw ) * uBounceStr;
  col = mix( col, c * br, bm );

  gl_FragColor = vec4( col, alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const OUTLINE_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
uniform float uPx;
uniform float uViewH;
uniform float uOutlineScale;
void main() {
  #include <beginnormal_vertex>
  vec3 objN = objectNormal;
  #ifdef USE_INSTANCING
    objN = mat3( instanceMatrix ) * objN;
  #endif
  vec3 n = normalize( normalMatrix * objN );
  #include <begin_vertex>
  vec4 mv = modelViewMatrix * vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mv = modelViewMatrix * instanceMatrix * vec4( transformed, 1.0 );
  #endif
  // one pixel, expressed in world units at this depth
  float pxWorld = 2.0 * max( -mv.z, 0.05 ) / ( uViewH * projectionMatrix[1][1] );
  float px = clamp( uPx * uOutlineScale, 1.0, 4.0 );
  mv.xyz += n * px * pxWorld;
  gl_Position = projectionMatrix * mv;
  #ifdef USE_FOG
    vFogDepth = - mv.z;
  #endif
}`;

const OUTLINE_FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>
uniform vec3 uInk;
void main() {
  gl_FragColor = vec4( uInk, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function toonUniforms(o) {
  return THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uLit: { value: null }, uShade: { value: null }, uBounce: { value: null },
      uBounceStr: { value: 1 }, uBandBias: { value: 0 }, uOpacity: { value: 1 },
      uTexMode: { value: 0 }, uTexAmt: { value: 1 }, uTexAlpha: { value: 0 },
      uTexRepeat: { value: new THREE.Vector2(1, 1) },
      uTex: { value: null },
    },
  ]);
}

/* ============================================================================
   4. The published materials. Everything cached by value.
   ========================================================================= */

function cachedMat(key, build) {
  if (!matCache.has(key)) matCache.set(key, build());
  return matCache.get(key);
}

/**
 * The workhorse. A banded toon material for anything with volume.
 *   toon(hex)                                   flat colour, three bands
 *   toon(hex, { map, repeat })                  painted colour map, bands multiply it
 *   toon(hex, { tex, texAmt })                  greyscale value modulation
 *   toon(hex, { bounce: 0 })                    no warm kick (things that are not near ground)
 */
export function toon(color, opts = {}) {
  const {
    map = null, tex = null, repeat = [1, 1], texAmt = 1, bounceStr = 1, bias = 0,
    opacity = 1, transparent = false, side = THREE.FrontSide, depthWrite = true,
    fog = true, shadeK = 0.72, shadeFloor = 28, bounceLift = 6, mapAlpha = false, key = '',
  } = opts;
  const id = `toon:${color}:${map?.uuid || tex?.uuid || 'x'}:${repeat}:${texAmt}:${bounceStr}:${bias}:${opacity}:${side}:${fog}:${shadeK}:${shadeFloor}:${bounceLift}:${mapAlpha}:${key}`;
  return cachedMat(id, () => {
    const u = toonUniforms();
    u.uLit.value = new THREE.Color(color);
    u.uShade.value = new THREE.Color(shade(color, shadeK, shadeFloor));
    u.uBounce.value = new THREE.Color(bounce(color, bounceLift));
    u.uBounceStr.value = bounceStr;
    u.uBandBias.value = bias;
    u.uOpacity.value = opacity;
    u.uTexMode.value = map ? 1 : tex ? 2 : 0;
    u.uTexAmt.value = texAmt;
    u.uTexAlpha.value = mapAlpha ? 1 : 0;
    u.uTexRepeat.value = new THREE.Vector2(repeat[0], repeat[1]);
    u.uTex.value = map || tex;
    u.uSun = shared.uSun; u.uTermPx = shared.uTermPx; u.uViewH = shared.uViewH;
    u.uBounceH = shared.uBounceH; u.uBounceLo = shared.uBounceLo; u.uBias = shared.uBias;
    const m = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: TOON_VERT, fragmentShader: TOON_FRAG,
      transparent: transparent || opacity < 1 || mapAlpha, side, depthWrite, fog,
    });
    m.userData.artColor = color;
    return m;
  });
}

/** Flat, unlit, fully authored. For anything whose shading is already painted in. */
export function unlit(color, opts = {}) {
  const { map = null, opacity = 1, side = THREE.FrontSide, fog = true, depthWrite = true, transparent = false } = opts;
  const id = `unlit:${color}:${map?.uuid || 'x'}:${opacity}:${side}:${fog}:${depthWrite}`;
  return cachedMat(id, () => new THREE.MeshBasicMaterial({
    color, map, opacity, transparent: transparent || opacity < 1, side, fog, depthWrite,
  }));
}

/** The ink outline material for an inverted hull. Colour derived from the fill it borders. */
export function outlineMaterial(fill = INK, px = 2) {
  const ink = fill === INK ? INK : inkOf(fill);
  const id = `outline:${ink}:${px}`;
  return cachedMat(id, () => {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uInk: { value: null }, uPx: { value: px } }]);
    u.uInk.value = new THREE.Color(ink);
    u.uPx.value = px;
    u.uViewH = shared.uViewH;
    u.uOutlineScale = shared.uOutlineScale;
    return new THREE.ShaderMaterial({
      uniforms: u, vertexShader: OUTLINE_VERT, fragmentShader: OUTLINE_FRAG,
      side: THREE.BackSide, fog: true, depthWrite: true,
    });
  });
}

/**
 * Add an inverted-hull outline to a mesh, or to every mesh under a group.
 *   px      2 for characters and gameplay-critical props, <= 1.2 for background architecture
 *   color   omit to derive from each mesh's own fill (§4.2), or pass INK for the ball
 */
export function addOutline(root, { px = 2, color = null, filter = null } = {}) {
  const targets = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline && (!filter || filter(o))) targets.push(o); });
  for (const m of targets) {
    const fill = color ?? m.material?.userData?.artColor ?? m.material?.color?.getHex?.() ?? INK;
    const o = new THREE.Mesh(m.geometry, outlineMaterial(fill, px));
    o.userData.isOutline = true;
    o.renderOrder = (m.renderOrder || 0) - 1;
    m.add(o);
  }
  return root;
}

/** §2.7 — the contact shadow. Blue-violet, soft, and never optional. */
export function contactShadow(width = 1.5, { opacity = 0.36, ratio = 0.62 } = {}) {
  const mat = cachedMat(`shadow:${opacity}`, () => new THREE.MeshBasicMaterial({
    color: AIR.shadowTint, alphaMap: shadowTexture(), transparent: true, opacity,
    depthWrite: false, fog: true, blending: THREE.NormalBlending,
  }));
  const m = new THREE.Mesh(SHADOW_GEO(), mat);
  m.scale.set(width, width * ratio, 1);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.renderOrder = -2;
  return m;
}
let _shadowGeo = null;
const SHADOW_GEO = () => (_shadowGeo ||= new THREE.PlaneGeometry(1, 1));

/**
 * The named material set. This is the API the rest of the game is meant to reach for; if
 * something you need is not here, it probably wants to be, so add it here rather than
 * inventing a MeshStandardMaterial in your own file.
 */
export const MAT = {
  toon,
  unlit,
  outline: outlineMaterial,
  /** Brick, with courses and the soot gradient baked in over `feet` of wall. */
  brick(kind = 'brick', o = {}) {
    const base = FACADE[kind] ?? FACADE.brick;
    const map = brickTexture({ base, feet: o.feet ?? 24, wide: o.wide ?? 12, seed: o.seed ?? 7, sootMax: o.sootMax ?? 0.30, sun: o.sun ?? 0, power: o.power ?? 1.25 });
    return toon(base, { map, repeat: o.repeat ?? [1, 1], bounceStr: 0.5, key: `brick${kind}${o.feet}${o.seed}` });
  },
  /** Bluestone, granite, brownstone: matte, mid-value, the stuff the stoop is made of. */
  stone(base = PAVEMENT.sidewalk, o = {}) {
    const map = stoneTexture({ base, seed: o.seed ?? 3, cols: o.cols ?? 3, rows: o.rows ?? 4 });
    return toon(base, { map, repeat: o.repeat ?? [1, 1], bounceStr: 0.8, key: `stone${base}${o.seed}` });
  },
  /** Roadway. The crown of it is the brightest ground surface in the frame (Law 1). */
  asphalt(o = {}) {
    const map = asphaltTexture({ seed: o.seed ?? 11 });
    return toon(PAVEMENT.asphaltShade, { map, repeat: o.repeat ?? [1, 1], bounceStr: 0.4, key: `asph${o.seed}` });
  },
  /** Iron: fire escapes, railings, ash cans, hydrants. MATTE — §4.3 gives it no shine. */
  iron(base = FACADE.iron[0], o = {}) {
    const tex = ironTexture({ seed: o.seed ?? 5, rust: o.rust ?? 0.5 });
    return toon(base, { tex, texAmt: 0.55, repeat: o.repeat ?? [1, 1], bounceStr: 1.1, key: `iron${base}${o.seed}${o.rust}${o.repeat}` });
  },
  /** Glass. One of three materials allowed a highlight, and the highlight is painted. */
  glass(o = {}) {
    return unlit(0xffffff, { map: glassTexture({ seed: o.seed ?? 17 }), fog: true });
  },
  /** Gold leaf. The second of the three. Unlit so it always reads as leaf, never as paint. */
  gold(o = {}) {
    return unlit(SPECULAR.gold, o);
  },
  /** Undyed cloth: ecru, four values, all under the L* 86 line. */
  cloth(base = CLOTH[0], o = {}) {
    return toon(base, { tex: clothTexture({ seed: o.seed ?? 13 }), texAmt: 0.30, repeat: o.repeat ?? [1, 1], key: `cloth${base}${o.seed}` });
  },
  /** Dyed wool: the one saturated garment every kid carries. */
  wool(base = ACCENTS.bottleGreen, o = {}) {
    return toon(base, { tex: knitTexture({ seed: o.seed ?? 9 }), texAmt: 0.42, repeat: o.repeat ?? [2, 2], key: `wool${base}${o.seed}` });
  },
  /** Skin: warm, high-value, cartoon. Step 0-5 from the six-tone ramp. */
  skin(step = 1) {
    return toon(SKIN[((step % SKIN.length) + SKIN.length) % SKIN.length], { bounceStr: 1.2, key: `skin${step}` });
  },
  /** Chalk — the readability ceiling. Unlit, because a mark must not take the shade band. */
  chalk(o = {}) {
    return unlit(CHALK, { ...o, fog: o.fog ?? true });
  },
  /** A chalk mark laid on the ground: alpha-mapped, unlit, never in shade. */
  chalkMark(map, { opacity = 0.92 } = {}) {
    const id = `chalkmark:${map.uuid}:${opacity}`;
    return cachedMat(id, () => new THREE.MeshBasicMaterial({
      color: 0xffffff, map, transparent: true, opacity, depthWrite: false, fog: true,
    }));
  },
  /** Ink: outlines, and the ball's own outline. Nothing in the world is darker than this. */
  ink() { return unlit(INK, { fog: false }); },
  /** The ball body. The chalk rim and the ink outline are added by ballMesh(). */
  ball(state = 'new') {
    return toon(BALL[state] ?? BALL.new, { bounceStr: 1.4, bias: -0.12, key: `ball${state}` });
  },
  shadow: contactShadow,
};

/**
 * A sewer casting. In this game it is home plate and second base, so it is a gameplay object
 * as much as a prop: worn high points at L* 60.7, recesses at L* 21.5 — the ONLY place the
 * palette goes under L* 28, and legal because those grooves are 2-6 px wide and never read as
 * a field (Law 2, the linear-ironwork exemption).
 */
export function manholeMesh(radius = 1.2) {
  const g = new THREE.Group();
  const hi = toon(PAVEMENT.manholeHigh, { tex: ironTexture({ seed: 31, rust: 0.2 }), texAmt: 0.5, repeat: [2, 2], bounceStr: 1.1, key: 'mhHi' });
  const mid = toon(mix(PAVEMENT.manholeHigh, PAVEMENT.manholeLow, 0.52), { bounceStr: 0.9, key: 'mhMid' });
  g.add(meshOf(new THREE.CylinderGeometry(radius, radius * 0.98, 0.12, 26), mid, 0, 0.055, 0));
  g.add(meshOf(new THREE.CylinderGeometry(radius * 0.93, radius * 0.93, 0.10, 26), mid, 0, 0.10, 0));
  const bar = new THREE.BoxGeometry(radius * 1.72, 0.055, 0.19);
  const bars = new THREE.InstancedMesh(bar, hi, 22);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  let n = 0;
  for (let ring = 0; ring < 2; ring++) {
    for (let i = 0; i < 11; i++) {
      const off = (i - 5) * radius * 0.155;
      const sc = Math.sqrt(Math.max(0.04, 1 - (off / (radius * 0.86)) ** 2));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ring * Math.PI / 2);
      v.set(ring ? off : 0, 0.155, ring ? 0 : off);
      m.compose(v, q, new THREE.Vector3(sc, 1, 1));
      bars.setMatrixAt(n++, m);
    }
  }
  bars.count = n;
  g.add(bars);
  const rim = meshOf(new THREE.TorusGeometry(radius * 0.99, 0.05, 5, 26), hi, 0, 0.13, 0);
  rim.rotation.x = -Math.PI / 2;
  g.add(rim);
  return g;
}

/**
 * The two-sided ball (§2.5) as a ready-made object: body, chalk rim crescent on the upper
 * left, ink outline all the way round. Below L* 50 the rim carries it; above, the outline
 * does; there is no backdrop in the game where both fail.
 */
export function ballMesh(radius = 0.18, state = 'new') {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), MAT.ball(state));
  g.add(body);
  addOutline(body, { px: 2.2, color: INK });
  // the chalk crescent: a thin spherical shell sector, upper left, facing the sky-fill
  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.012, 20, 14, Math.PI * 0.62, Math.PI * 0.72, 0, Math.PI * 0.46),
    MAT.chalk({ side: THREE.DoubleSide }),
  );
  rim.rotation.set(0.35, 0.2, 0.55);
  g.add(rim);
  const seam = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.99, radius * 0.075, 6, 22),
    toon(BALL.seam, { bounceStr: 0.6, key: 'seam' }),
  );
  seam.rotation.set(0.9, 0.3, 0.2);
  g.add(seam);
  g.userData.body = body;
  return g;
}

export function disposeArt() {
  for (const m of matCache.values()) m.dispose?.();
  for (const t of texCache.values()) t.dispose?.();
  matCache.clear(); texCache.clear();
}

/* ============================================================================
   5. The style sheet — one frame a critic can judge the whole art direction from.
      Brick, stoop, kid, ball, chalk, iron, sky, all in the same light, at 3:50 pm.

      The composition IS Law 1: a tall sooted tenement holds the dark left edge, a 16 ft
      corner taxpayer drops the roofline on the right so the sky can get in, and the
      brightest surface in the frame is the crown of the roadway in the middle, where the
      kid, the ball and the chalk are.
   ========================================================================= */

function meshOf(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/**
 * A kid, built to §5.1 arithmetic out of the published materials: 3.27 head-heights, head at
 * 31% of standing height, shoulders no wider than the head, limbs are tubes, hands are mitts,
 * shoes are enormous. He is here to prove the shading model on a character, so he wears one
 * saturated garment (§2.9), carries the drawn smudges (§4.4.5), and stands on a contact
 * shadow (§2.7). The character piece owns the real roster; this is the material test.
 */
function buildMannequin({
  seed = 5, skinStep = 2, wool = ACCENTS.bottleGreen, capCol = ACCENTS.rust, shirt = 0, bat = false,
} = {}) {
  const R = new RNG(seed);
  const g = new THREE.Group();

  /* §5.1 as arithmetic, so nobody has to trust my eye:
       head       1.00 HH   (crown to chin, cap excluded)      30% of standing height
       torso      1.00 HH   shoulder to hip
       legs       1.20 HH   hip to ground
       standing   3.31 HH   = 4 ft 4 in for a nine-year-old
       shoulders  1.14 HH   — narrower than the head, which is the whole child cue
       hands      0.62 x head width, mitts, no anatomy. Limbs are tubes.            */
  const HH = 1.30;
  const hipY = HH * 1.10;
  const chestY = hipY + HH * 1.00;
  const headY = chestY + HH * 0.12 + HH * 0.54;
  const kneeY = HH * 0.70;
  const bootH = HH * 0.20;
  const bootTop = 0.02 + bootH;

  const skinM = MAT.skin(skinStep);
  const shirtM = MAT.cloth(CLOTH[shirt], { seed: 31 });
  const woolM = MAT.wool(wool, { seed: 9 });
  const capM = MAT.wool(capCol, { seed: 21, repeat: [1.6, 1.6] });
  const hairHex = soot(SKIN[Math.min(5, skinStep + 3)], 0.32);
  const hairM = toon(hairHex, { key: `hair${skinStep}` });
  const trouser = soot(mix(PAVEMENT.asphaltWarm, AIR.shadowTint, 0.34), 0.22);
  const trouserM = toon(trouser, { key: 'knick' });
  const buckleM = toon(soot(trouser, 0.30), { key: 'buckle' });
  const sockM = toon(mix(CLOTH[2], PAVEMENT.curb, 0.28), { tex: knitTexture({ seed: 14 }), texAmt: 0.55, repeat: [1, 3], key: 'sock' });
  const bootM = toon(soot(ACCENTS.tan, 0.48), { key: 'boot' });

  /* --- legs: knicker balloon, hard buckle at the knee, sagging stockings, big boots --- */
  for (const s of [-1, 1]) {
    const x = s * HH * 0.20;
    const splay = s * 0.04;
    const knick = meshOf(new THREE.SphereGeometry(HH * 0.285, 14, 10), trouserM, x, (hipY + kneeY) * 0.5 + 0.02, 0);
    knick.scale.set(1.02, (hipY - kneeY) * 0.66 / (HH * 0.285), 1.06);
    g.add(knick);
    g.add(meshOf(new THREE.CylinderGeometry(HH * 0.205, HH * 0.175, HH * 0.09, 12), buckleM, x, kneeY, 0));
    const sockH = kneeY - bootTop;
    g.add(meshOf(new THREE.CylinderGeometry(HH * 0.165, HH * 0.140, sockH, 12), sockM, x, bootTop + sockH / 2, 0));
    for (let i = 0; i < 3; i++) {                    // accordion sag, asymmetric leg to leg
      const t = 0.18 + i * 0.27 + (s > 0 ? 0.07 : 0);
      const ring = meshOf(new THREE.TorusGeometry(HH * (0.158 - i * 0.007), 0.026, 5, 14), sockM, x, bootTop + sockH * t, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    const boot = meshOf(new THREE.BoxGeometry(HH * 0.34, bootH, HH * 0.58), bootM, x, 0.02 + bootH / 2, HH * 0.08 + splay);
    boot.rotation.y = splay * 2.2;
    g.add(boot);
    const toe = meshOf(new THREE.SphereGeometry(HH * 0.115, 10, 8), bootM, x, 0.02 + bootH * 0.46, HH * 0.35 + splay);
    toe.scale.set(0.92, 0.80, 1.10);
    g.add(toe);
    const tongue = meshOf(new THREE.BoxGeometry(HH * 0.22, HH * 0.10, 0.05), bootM, x, bootTop + HH * 0.015, HH * 0.07);
    tongue.rotation.x = -0.55;
    g.add(tongue);
  }

  /* --- torso: ecru shirt, one saturated sweater over it, hem below the hip --- */
  const shirtMesh = meshOf(new THREE.CapsuleGeometry(HH * 0.30, HH * 0.62, 4, 12), shirtM, 0, chestY - HH * 0.18, 0);
  shirtMesh.scale.set(1.0, 1, 0.80);
  g.add(shirtMesh);
  const sweater = meshOf(new THREE.CapsuleGeometry(HH * 0.325, HH * 0.40, 4, 12), woolM, 0, chestY - HH * 0.34, 0);
  sweater.scale.set(1.0, 1, 0.84);
  g.add(sweater);
  const hem = meshOf(new THREE.CylinderGeometry(HH * 0.335, HH * 0.325, HH * 0.11, 14), woolM, 0, hipY + HH * 0.05, 0);
  hem.scale.set(1.0, 1, 0.86);
  g.add(hem);
  const collar = meshOf(new THREE.CylinderGeometry(HH * 0.185, HH * 0.215, HH * 0.07, 12), shirtM, 0, chestY + HH * 0.055, 0);
  g.add(collar);

  /* --- arms: tubes to mid-thigh, mitts for hands --- */
  const armY = chestY + HH * 0.02;
  const arm = (s, shoulder, elbow) => {
    const a = new THREE.Group();
    a.position.set(s * HH * 0.30, armY, 0);
    a.rotation.set(shoulder[0], 0, shoulder[1]);
    a.add(meshOf(new THREE.CapsuleGeometry(HH * 0.105, HH * 0.34, 3, 10), woolM, 0, -HH * 0.22, 0));
    const f = new THREE.Group();
    f.position.set(0, -HH * 0.44, 0);
    f.rotation.set(elbow[0], 0, elbow[1]);
    f.add(meshOf(new THREE.CapsuleGeometry(HH * 0.088, HH * 0.30, 3, 10), skinM, 0, -HH * 0.19, 0));
    const hand = meshOf(new THREE.SphereGeometry(HH * 0.155, 10, 8), skinM, 0, -HH * 0.40, 0);
    hand.scale.set(1, 1.06, 0.74);
    f.add(hand);
    a.add(f);
    a.userData.fore = f;
    g.add(a);
    return a;
  };
  // near arm up on the shoulder holding the stick; far arm hanging, one shoulder dropped
  const armL = arm(1, [-0.12, 0.20], [0.42, -0.08]);
  const armR = arm(-1, [-0.30, -0.72], [1.95, 0.30]);

  /* --- head: 30% of standing height, cap perched ON it, face painted flat --- */
  g.add(meshOf(new THREE.CylinderGeometry(HH * 0.145, HH * 0.165, HH * 0.20, 10), skinM, 0, chestY + HH * 0.13, 0));
  const head = new THREE.Group();
  head.position.set(0, headY, 0);
  head.rotation.set(0.04, -0.34, 0.05);
  const skull = meshOf(new THREE.SphereGeometry(HH * 0.56, 22, 16), skinM, 0, 0, 0);
  skull.scale.set(1, 1.0, 0.95);
  head.add(skull);
  for (const s of [-1, 1]) {
    const e = meshOf(new THREE.SphereGeometry(HH * 0.125, 10, 8), skinM, s * HH * 0.525, -HH * 0.03, -0.03);
    e.scale.set(0.42, 1, 0.85);
    head.add(e);
  }
  // hair shows below the cap line, front and sides, so the cap reads as a separate object
  const hair = meshOf(new THREE.SphereGeometry(HH * 0.568, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.40), hairM, 0, 0, 0);
  hair.scale.set(1.01, 1.02, 0.98);
  head.add(hair);
  const fringe = meshOf(new THREE.SphereGeometry(HH * 0.155, 10, 8), hairM, HH * 0.15, HH * 0.34, HH * 0.45);
  fringe.scale.set(1.5, 0.55, 0.5);
  head.add(fringe);
  // the cap: 1.3x the head's plan area, a lid on top, with a hard brim edge (§5.2)
  const cap = meshOf(new THREE.SphereGeometry(HH * 0.605, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.36), capM, 0, HH * 0.065, -HH * 0.045);
  cap.scale.set(1.14, 0.80, 1.22);
  head.add(cap);
  const brim = meshOf(new THREE.CylinderGeometry(HH * 0.48, HH * 0.44, 0.075, 20, 1, false, -1.05, 2.1), capM, 0, HH * 0.265, HH * 0.22);
  brim.scale.set(1.15, 1, 1.35);
  brim.rotation.x = -0.30;
  head.add(brim);
  head.add(meshOf(new THREE.SphereGeometry(0.058, 8, 6), capM, 0, HH * 0.44, -HH * 0.045));
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(HH * 0.572, 24, 18, Math.PI * 0.22, Math.PI * 0.56, Math.PI * 0.20, Math.PI * 0.60),
    new THREE.MeshBasicMaterial({ map: faceTexture(skinStep, seed), transparent: true, alphaTest: 0.4, depthWrite: false, fog: true }),
  );
  face.scale.set(1, 1.0, 0.95);
  face.renderOrder = 3;
  head.add(face);
  g.add(head);

  /* --- the broomstick, taped at the grip, up on the shoulder under the near hand --- */
  if (bat) {
    const stick = new THREE.Group();
    stick.position.set(0, -HH * 0.40, 0);
    stick.rotation.set(-1.34, -0.30, 0.52);
    const wood = mix(ACCENTS.tan, CLOTH[2], 0.42);
    stick.add(meshOf(new THREE.CylinderGeometry(0.062, 0.076, 3.1, 9), toon(wood, { key: 'stick' }), 0, 1.30, 0));
    stick.add(meshOf(new THREE.CylinderGeometry(0.088, 0.088, 0.62, 9), toon(soot(CLOTH[3], 0.26), { key: 'tape' }), 0, 0.02, 0));
    armR.userData.fore.add(stick);
    g.userData.stick = stick;
  }

  g.userData.rig = { head, armL, armR };
  g.userData.headHeight = HH;
  g.userData.standing = headY + HH * 0.5;
  return g;
}

/** A face, painted flat: two eyes, two floating brows, one of the six mouths, freckles. */
function faceTexture(skinStep = 2, seed = 5) {
  return cachedTex(`face:${skinStep}:${seed}`, () => {
    const S = 256;
    const [c, g] = canvas(S, S);
    const R = new RNG(seed);
    const skinHex = SKIN[skinStep];
    g.clearRect(0, 0, S, S);
    const ink = CSS(inkOf(skinHex));
    const eyeR = S * 0.098, eyeY = S * 0.545, cx = S * 0.5;
    for (const s of [-1, 1]) {
      const x = cx + s * S * 0.135;
      g.fillStyle = CSS(CHALK);
      g.beginPath(); g.ellipse(x, eyeY, eyeR * 1.02, eyeR * 1.18, 0, 0, 6.3); g.fill();
      g.fillStyle = ink;
      g.beginPath(); g.ellipse(x + s * eyeR * 0.18, eyeY + eyeR * 0.10, eyeR * 0.58, eyeR * 0.74, 0, 0, 6.3); g.fill();
      g.fillStyle = CSS(CHALK);
      g.beginPath(); g.ellipse(x + s * eyeR * 0.38, eyeY - eyeR * 0.26, eyeR * 0.20, eyeR * 0.22, 0, 0, 6.3); g.fill();
      g.strokeStyle = ink;                        // one lid heavier than the other, on purpose
      g.lineWidth = s > 0 ? 6 : 3.6;
      g.lineCap = 'round';
      g.beginPath();
      g.ellipse(x, eyeY, eyeR * 1.02, eyeR * 1.18, 0, Math.PI * 1.04, Math.PI * 1.96);
      g.stroke();
    }
    g.fillStyle = CSS(soot(SKIN[Math.min(5, skinStep + 3)], 0.30));
    for (const s of [-1, 1]) {                    // brows: separate floating shapes, one raised
      const x = cx + s * S * 0.135;
      const raise = s > 0 ? S * 0.068 : S * 0.034;
      g.save();
      g.translate(x, eyeY - eyeR - raise);
      g.rotate(s * -0.18);
      g.beginPath();
      g.ellipse(0, 0, eyeR * 1.10, 8.5, 0, 0, 6.3);
      g.fill();
      g.restore();
    }
    g.strokeStyle = ink;                          // nose: a comma
    g.lineWidth = 5.5;
    g.lineCap = 'round';
    g.beginPath();
    g.lineWidth = 7;
    g.moveTo(cx + 7, S * 0.645);
    g.quadraticCurveTo(cx + 21, S * 0.700, cx - 2, S * 0.716);
    g.stroke();
    g.fillStyle = ink;                            // mouth: open lower-arc grin (§5.3, shape 2)
    g.beginPath();
    g.arc(cx, S * 0.725, S * 0.150, 0.20, Math.PI - 0.14);
    g.closePath();
    g.fill();
    g.fillStyle = CSS(mix(BLUSH, CHALK, 0.35));   // tongue in one corner
    g.beginPath();
    g.ellipse(cx + S * 0.088, S * 0.812, S * 0.042, S * 0.029, 0.35, 0, 6.3);
    g.fill();
    g.fillStyle = CSS(CHALK);                     // two teeth, because six mouths need teeth
    g.fillRect(cx - S * 0.058, S * 0.725, S * 0.048, S * 0.036);
    g.fillRect(cx - S * 0.004, S * 0.725, S * 0.046, S * 0.034);
    g.globalAlpha = 0.20;                         // blush at 20% (§2.8)
    g.fillStyle = CSS(BLUSH);
    for (const s of [-1, 1]) {
      g.beginPath(); g.ellipse(cx + s * S * 0.205, S * 0.678, S * 0.068, S * 0.044, 0, 0, 6.3); g.fill();
    }
    g.globalAlpha = 0.35;                         // one cheek smudge (§4.4.5)
    g.fillStyle = CSS(SMUDGE);
    g.beginPath();
    g.ellipse(cx - S * 0.170, S * 0.596, S * 0.058, S * 0.020, -0.42, 0, 6.3);
    g.fill();
    g.beginPath();
    g.ellipse(cx - S * 0.150, S * 0.634, S * 0.036, S * 0.014, -0.30, 0, 6.3);
    g.fill();
    g.globalAlpha = 0.8;
    if (skinStep <= 2) {
      g.fillStyle = CSS(soot(SKIN[Math.min(5, skinStep + 2)], 0.06));
      for (let i = 0; i < 14; i++) {
        const s = R.chance(0.5) ? 1 : -1;
        g.beginPath();
        g.ellipse(cx + s * R.range(S * 0.09, S * 0.21), S * 0.596 + R.range(-S * 0.03, S * 0.055), 3.8, 3.4, 0, 0, 6.3);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    return finish(c, { wrap: [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping] });
  });
}

/** A striped awning: Law 4's saturated neighbour, and the period's own shopfront. */
function awningTexture(a = ACCENTS.red, b = mix(CLOTH[1], CHALK, 0.14), seed = 3) {
  return cachedTex(`awn:${a}:${b}`, () => {
    const [c, g] = canvas(256, 128);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = CSS(i % 2 ? a : b);
      g.fillRect(i * 32, 0, 32, 128);
    }
    g.fillStyle = 'rgba(42,29,26,0.20)';           // the drawn shadow line where it folds
    g.fillRect(0, 104, 256, 24);
    return finish(c, { wrap: [THREE.RepeatWrapping, THREE.ClampToEdgeWrapping] });
  });
}

let STYLE = null;

function buildStyleSet() {
  if (STYLE) return STYLE;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(AIR.skyLower);
  // The haze is a LIGHT: distance goes toward #D8CFB8 and gets BRIGHTER, never darker (§2.3).
  scene.fog = new THREE.Fog(AIR.haze, 45, 260);
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.5, 700);
  // 3:50 pm, 22 September 1925: altitude 33°, and behind the camera's right shoulder (§3.2).
  const sun = new THREE.Vector3(0.72, 0.55, 0.42).normalize();

  const G = new THREE.Group();
  scene.add(G);
  const add = (m) => { G.add(m); return m; };

  /* --- sky: painted gradient, cool at the top, warm coal haze down at the street mouth --- */
  const skyTex = cachedTex('sky', () => {
    const [c, g] = canvas(8, 256);
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, CSS(AIR.skyUpper));
    grd.addColorStop(0.62, CSS(AIR.skyLower));
    grd.addColorStop(1, CSS(AIR.haze));
    g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
    return finish(c, { wrap: [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping] });
  });
  const sky = add(meshOf(new THREE.PlaneGeometry(600, 300), new THREE.MeshBasicMaterial({ map: skyTex, fog: false, depthWrite: false }), 40, 60, -220));
  sky.renderOrder = -20;

  /* --- ground: roadway with its polished crown, bluestone sidewalk, granite curb --- */
  const road = add(meshOf(new THREE.PlaneGeometry(300, 120), MAT.asphalt({ repeat: [25, 10] }), 0, 0, 26));
  road.rotation.x = -Math.PI / 2;
  const walk = add(meshOf(new THREE.BoxGeometry(300, 0.62, 14), MAT.stone(PAVEMENT.sidewalk, { repeat: [22, 1], seed: 3 }), 0, 0.31, -4.8));
  const curb = add(meshOf(new THREE.BoxGeometry(300, 0.70, 0.9), MAT.stone(PAVEMENT.curb, { repeat: [60, 1], seed: 4, cols: 1, rows: 1 }), 0, 0.35, 2.65));
  // Law 1, as geometry: the scoured crown of the roadway is the brightest ground in the frame
  const crown = crownStrip(260, 30, 15);
  crown.position.set(0, 0.008, 20);
  add(crown);
  // and the far edge of the play plane goes back down again, so the eye is delivered inward
  const gutterShade = shadePatch(260, 9, { opacity: 0.26, soft: 0.42 });
  gutterShade.rotation.x = -Math.PI / 2;
  gutterShade.position.set(0, 0.012, 5.6);
  add(gutterShade);
  // §3.2/§3.3 THE SUN BAND. The corner taxpayer is only 16 ft, so the 3:50 pm sun clears it
  // and lands on the roadway from 21.8 ft out — a colour event, not an exposure event, so it
  // is painted warm rather than blown bright, and it is what makes the crown the brightest
  // ground in the frame (Law 1).
  const sunBand = shadePatch(74, 30, { opacity: 0.46, soft: 0.36, color: sunlit(PAVEMENT.blockCrown, 0.42) });
  sunBand.rotation.x = -Math.PI / 2;
  sunBand.rotation.z = -0.20;
  sunBand.position.set(20, 0.02, 17);
  add(sunBand);
  // and the sidewalk under the six-storey tenement never gets it (§3.2 arithmetic)
  const walkShade = shadePatch(78, 20, { opacity: 0.30, soft: 0.30 });
  walkShade.rotation.x = -Math.PI / 2;
  walkShade.position.set(-30, 0.645, -3.0);
  add(walkShade);

  /* --- the tenement, left: brick, sooted upward, 60 ft of it, holding the dark edge --- */
  const tenH = 58;
  add(meshOf(
    new THREE.BoxGeometry(46, tenH, 2.0),
    MAT.brick('brick', { feet: 34, wide: 12, repeat: [3.8, tenH / 34], seed: 7, sootMax: 0.52, power: 1.0 }),
    -24, tenH / 2, -12.9,
  ));
  // A3: a painted advertisement on brick, and it is where this wall pays its Law 4 bill.
  const ad = meshOf(new THREE.PlaneGeometry(23, 11), toon(0xffffff, {
    map: paintedSign([
      { text: 'SALVATORE', size: 0.30, y: 0.40, color: mix(CLOTH[0], CHALK, 0.15) },
      { text: '& SONS', size: 0.19, y: 0.66, color: mix(CLOTH[0], CHALK, 0.15) },
      { text: 'COAL-ICE-WOOD', size: 0.135, y: 0.90, color: ACCENTS.mustard, tracking: 0.16 },
    ], { w: 768, h: 384, wear: 0.34, seed: 9 }),
    mapAlpha: true, depthWrite: false, bounceStr: 0.5, key: 'ad1',
  }), -14, 21.5, -11.83);
  ad.renderOrder = 1;
  add(ad);
  // a ghost sign, older, nearly gone, on the wall next door
  const ghost = meshOf(new THREE.PlaneGeometry(15, 9), toon(0xffffff, {
    map: paintedSign([
      { text: 'CIGARS', size: 0.30, y: 0.42, color: mix(CLOTH[1], PAVEMENT.curb, 0.35) },
      { text: '5¢', size: 0.34, y: 0.92, color: mix(CLOTH[1], PAVEMENT.curb, 0.35) },
    ], { w: 512, h: 320, wear: 0.72, seed: 17 }),
    mapAlpha: true, opacity: 0.62, depthWrite: false, bounceStr: 0.5, key: 'ghost',
  }), -56, 30, -12.12);
  ghost.renderOrder = 1;
  add(ghost);
  // the party wall of the next house along, one building in eight is ochre (§2.2)
  add(meshOf(
    new THREE.BoxGeometry(24, 52, 2.0),
    MAT.brick('ochre', { feet: 34, wide: 12, repeat: [2, 52 / 34], seed: 12, sootMax: 0.54, power: 1.0 }),
    -59, 26, -13.2,
  ));

  /* --- the corner taxpayer, right: 16 ft, one storey, and the reason we can see sky --- */
  const taxH = 16.0;
  add(meshOf(
    new THREE.BoxGeometry(30, taxH, 2.0),
    MAT.brick('brick', { feet: taxH, wide: 12, repeat: [2.5, 1], seed: 21, sootMax: 0.22, sun: 0.10 }),
    15, taxH / 2, -12.9,
  ));
  const corniceCol = FACADE.cornice[0];
  add(meshOf(new THREE.BoxGeometry(30.6, 1.5, 3.4), toon(corniceCol, { bounceStr: 1.0, key: 'cor' }), 15, taxH + 0.75, -11.5));
  // the upper face of a cornice is the blackest thing in the frame, and it is DRAWN so (§4.4)
  add(meshOf(new THREE.BoxGeometry(30.6, 0.45, 3.7), toon(soot(corniceCol, 0.40), { bounceStr: 0, key: 'cortop' }), 15, taxH + 1.7, -11.4));
  const dentil = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.55, 0.5), toon(soot(corniceCol, 0.14), { bounceStr: 1.3, key: 'dent' }), 26);
  const dm = new THREE.Matrix4();
  for (let i = 0; i < 26; i++) { dm.makeTranslation(0.5 + i * 1.16, taxH - 0.32, -10.1); dentil.setMatrixAt(i, dm); }
  add(dentil);
  // the tenement's own cornice, far above, catching the sun band the period is famous for
  add(meshOf(new THREE.BoxGeometry(46, 2.0, 3.6), toon(sunlit(FACADE.cornice[2], 0.30), { bounceStr: 0.8, key: 'cor2' }), -24, tenH + 1.0, -11.4));

  /* --- what is across the avenue: hazed, brighter with distance, never darker (§2.3) --- */
  const far = add(meshOf(new THREE.BoxGeometry(60, 56, 2), toon(FACADE.brickSoot, { bounceStr: 0, key: 'far' }), -94, 28, -13.2));
  const far2 = add(meshOf(new THREE.BoxGeometry(120, 46, 2), toon(FACADE.ochreShade, { bounceStr: 0, key: 'far2' }), -160, 23, -34));
  for (const m of [far, far2]) m.renderOrder = -8;

  /* --- the window: sash, glass with a painted highlight, gold leaf, a sill and its grime --- */
  const winG = new THREE.Group();
  winG.position.set(6.0, 7.6, -11.8);
  const sashM = toon(FACADE.sash[0], { bounceStr: 1.2, key: 'sash' });
  winG.add(meshOf(new THREE.BoxGeometry(5.6, 8.6, 0.5), toon(soot(FACADE.brickShade, 0.12), { key: 'reveal' }), 0, 0, -0.30));
  winG.add(meshOf(new THREE.PlaneGeometry(4.7, 7.6), MAT.glass(), 0, 0, 0.02));
  winG.add(meshOf(new THREE.BoxGeometry(5.2, 0.36, 0.44), sashM, 0, 3.95, 0.14));
  winG.add(meshOf(new THREE.BoxGeometry(5.2, 0.30, 0.44), sashM, 0, 0.25, 0.16));
  winG.add(meshOf(new THREE.BoxGeometry(5.2, 0.36, 0.44), sashM, 0, -3.95, 0.14));
  winG.add(meshOf(new THREE.BoxGeometry(0.34, 8.2, 0.44), sashM, -2.5, 0, 0.14));
  winG.add(meshOf(new THREE.BoxGeometry(0.34, 8.2, 0.44), sashM, 2.5, 0, 0.14));
  winG.add(meshOf(new THREE.BoxGeometry(0.16, 7.8, 0.30), sashM, 0, 0, 0.14));
  // gold leaf on the lower sash: §4.3's second specular material, and the doctor is in
  const arc = meshOf(new THREE.TorusGeometry(1.45, 0.11, 6, 24, Math.PI * 0.9), MAT.gold(), 0, -1.5, 0.12);
  arc.rotation.z = Math.PI * 0.05;
  winG.add(arc);
  winG.add(meshOf(new THREE.TorusGeometry(0.40, 0.08, 6, 16), MAT.gold(), 0, -2.75, 0.12));
  winG.add(meshOf(new THREE.BoxGeometry(6.2, 0.44, 1.1), MAT.stone(PAVEMENT.sidewalk, { seed: 8, cols: 1, rows: 1 }), 0, -4.55, 0.36));
  winG.add(meshOf(new THREE.BoxGeometry(6.2, 0.24, 0.1), toon(soot(FACADE.brickShade, 0.42), { bounceStr: 0, key: 'sillline' }), 0, -4.84, 0.86));
  add(winG);
  addOutline(winG, { px: 1.1 });

  /* --- fire escape: linear ironwork, the L* 19 exemption, up the tenement --- */
  const feG = new THREE.Group();
  feG.position.set(-20, 15.0, -11.6);
  const feM = MAT.iron(FACADE.iron[0], { seed: 5, rust: 0.6, repeat: [2, 2] });
  for (let lev = 0; lev < 3; lev++) {
    const y = lev * 11;
    feG.add(meshOf(new THREE.BoxGeometry(11, 0.28, 3.6), feM, 0, y, 1.8));
    for (let i = 0; i < 15; i++) feG.add(meshOf(new THREE.BoxGeometry(0.13, 0.13, 3.4), feM, -5.2 + i * 0.75, y + 0.02, 1.8));
    for (let i = 0; i < 13; i++) feG.add(meshOf(new THREE.BoxGeometry(0.15, 3.0, 0.15), feM, -5.2 + i * 0.87, y + 1.6, 3.5));
    feG.add(meshOf(new THREE.BoxGeometry(11, 0.18, 0.18), feM, 0, y + 3.1, 3.5));
    feG.add(meshOf(new THREE.BoxGeometry(11, 0.16, 0.16), feM, 0, y + 1.6, 3.5));
    for (let i = 0; i < 9; i++) feG.add(meshOf(new THREE.BoxGeometry(2.0, 0.12, 0.12), feM, 3.4, y - 0.6 - i * 1.1, 2.6 - i * 0.20));
    for (const s of [-1, 1]) feG.add(meshOf(new THREE.BoxGeometry(0.16, 11, 0.16), feM, s * 5.0, y + 5.5, 3.5));
  }
  add(feG);
  addOutline(feG, { px: 1.0 });

  /* --- the awning and the shopfront under it: Law 4's saturated neighbour --- */
  const awnG = new THREE.Group();
  awnG.position.set(21.0, 10.6, -11.7);
  const awnT = awningTexture();
  const canopy = meshOf(new THREE.BoxGeometry(15, 0.22, 7.2), toon(0xffffff, { map: awnT, repeat: [3, 1], bounceStr: 1.3, key: 'awn' }), 0, 0, 3.5);
  canopy.rotation.x = -0.34;
  awnG.add(canopy);
  awnG.add(meshOf(new THREE.BoxGeometry(15, 1.5, 0.16), toon(0xffffff, { map: awnT, repeat: [3, 0.22], bounceStr: 1.5, key: 'awnv' }), 0, -1.95, 6.7));
  for (const s of [-1, 1]) awnG.add(meshOf(new THREE.CylinderGeometry(0.085, 0.085, 9.0, 8), MAT.iron(FACADE.iron[1], { seed: 6 }), s * 7.1, -4.9, 6.6));
  add(awnG);
  addOutline(awnG, { px: 1.4 });
  const awnShade = shadePatch(16, 8.5, { opacity: 0.42, soft: 0.26 });
  awnShade.rotation.x = -Math.PI / 2;
  awnShade.position.set(19.4, 0.64, -7.4);
  add(awnShade);
  add(meshOf(new THREE.BoxGeometry(16, 8.6, 0.5), toon(soot(ACCENTS.bottleGreen, 0.30), { key: 'shopfront' }), 21.0, 4.9, -11.75));
  add(meshOf(new THREE.PlaneGeometry(13.4, 5.0), MAT.glass({ seed: 19 }), 21.0, 5.4, -11.46));
  add(meshOf(new THREE.BoxGeometry(16.4, 0.5, 0.7), toon(soot(ACCENTS.bottleGreen, 0.46), { key: 'stall' }), 21.0, 9.7, -11.6));
  // the shop board: gold on bottle green, hand-painted, the period's own storefront
  add(meshOf(new THREE.PlaneGeometry(15.4, 2.1), toon(0xffffff, {
    map: paintedSign([{ text: 'LATTICINI', size: 0.62, y: 0.80, color: SPECULAR.gold, shadow: soot(ACCENTS.bottleGreen, 0.6), tracking: 0.26 }],
      { w: 1024, h: 140, wear: 0.10, seed: 23, ground: soot(ACCENTS.bottleGreen, 0.34) }),
    bounceStr: 0.8, key: 'board',
  }), 21.0, 8.15, -11.44));
  // crates of produce on the stall board: six saturated accents in one 128 px region (Law 4)
  const crateM = toon(mix(ACCENTS.tan, CLOTH[2], 0.30), { key: 'crate' });
  for (let i = 0; i < 3; i++) {
    const cx = 16.0 + i * 4.2;
    add(meshOf(new THREE.BoxGeometry(3.4, 1.5, 2.0), crateM, cx, 1.0, -9.6));
    const fruit = [ACCENTS.red, ACCENTS.mustard, ACCENTS.olive][i];
    for (let j = 0; j < 5; j++) {
      const f = meshOf(new THREE.SphereGeometry(0.34, 8, 6), toon(fruit, { key: `fruit${i}` }),
        cx - 1.1 + (j % 3) * 1.1, 1.95, -10.1 + Math.floor(j / 3) * 0.9);
      add(f);
    }
  }

  /* --- the stoop: bluestone treads, brownstone cheeks, an iron rail --- */
  const stoop = new THREE.Group();
  stoop.position.set(-5.0, 0, -11.6);
  const treadM = MAT.stone(mix(PAVEMENT.sidewalk, PAVEMENT.blockCrown, 0.30), { seed: 6, cols: 1, rows: 1 });
  const cheekM = toon(soot(mix(FACADE.ochreShade, FACADE.brickShade, 0.45), 0.10), { tex: ironTexture({ seed: 22, rust: 0 }), texAmt: 0.30, repeat: [2, 2], key: 'cheek' });
  for (let i = 0; i < 6; i++) {
    stoop.add(meshOf(new THREE.BoxGeometry(7.6, 0.66, 1.30), treadM, 0, 0.33 + i * 0.66, 7.0 - i * 1.30));
    stoop.add(meshOf(new THREE.BoxGeometry(7.4, 0.66, 0.10), toon(soot(PAVEMENT.sidewalk, 0.42), { bounceStr: 1.6, key: 'riser' }), 0, 0.33 + i * 0.66, 7.65 - i * 1.30));
  }
  for (const s of [-1, 1]) {
    stoop.add(meshOf(new THREE.BoxGeometry(0.9, 4.0, 8.0), cheekM, s * 4.1, 2.0, 3.6));
    stoop.add(meshOf(new THREE.BoxGeometry(1.15, 0.34, 8.3), treadM, s * 4.1, 4.15, 3.6));
    const railM = MAT.iron(FACADE.iron[0], { seed: 7, repeat: [1, 2] });
    for (let i = 0; i < 6; i++) {
      stoop.add(meshOf(new THREE.CylinderGeometry(0.055, 0.055, 2.7, 7), railM, s * 4.1, 4.3 + i * 0.33, 6.6 - i * 1.30));
    }
    const hand = meshOf(new THREE.CylinderGeometry(0.10, 0.10, 7.4, 8), railM, s * 4.1, 5.85, 3.6);
    hand.rotation.x = Math.PI / 2 - 0.245;
    stoop.add(hand);
  }
  stoop.add(meshOf(new THREE.BoxGeometry(5.0, 8.2, 0.4), toon(soot(FACADE.sash[1], 0.06), { key: 'door' }), 0, 7.6, -0.6));
  stoop.add(meshOf(new THREE.BoxGeometry(3.2, 1.6, 0.2), MAT.glass({ seed: 23 }), 0, 10.3, -0.35));
  stoop.add(meshOf(new THREE.BoxGeometry(6.4, 0.6, 1.2), toon(soot(FACADE.cornice[0], 0.10), { key: 'lintel' }), 0, 11.6, -0.3));
  add(stoop);
  addOutline(stoop, { px: 1.3 });

  /* --- iron in the street: an ash can with the lid off, and a hydrant --- */
  const canG = new THREE.Group();
  canG.position.set(1.0, 0.62, -7.0);
  const canM = MAT.iron(mix(FACADE.iron[2], PAVEMENT.curb, 0.42), { seed: 9, rust: 1, repeat: [3, 1] });
  canG.add(meshOf(new THREE.CylinderGeometry(1.05, 0.86, 3.0, 16), canM, 0, 1.5, 0));
  for (let i = 0; i < 3; i++) canG.add(meshOf(new THREE.TorusGeometry(1.02 - i * 0.04, 0.055, 5, 18), canM, 0, 0.7 + i * 0.85, 0));
  const lid = meshOf(new THREE.CylinderGeometry(1.16, 1.16, 0.16, 16), canM, 1.95, 0.66, 0.9);
  lid.rotation.z = 1.2;
  canG.add(lid);
  canG.add(meshOf(new THREE.TorusGeometry(0.26, 0.05, 5, 12), canM, 1.72, 0.80, 0.9));
  canG.add(contactShadow(3.0, { opacity: 0.34 }));
  add(canG);
  addOutline(canG, { px: 1.6 });

  const hyd = new THREE.Group();
  hyd.position.set(26.5, 0.62, 1.4);
  const hydM = toon(ACCENTS.red, { bounceStr: 1.2, key: 'hyd' });
  hyd.add(meshOf(new THREE.CylinderGeometry(0.42, 0.52, 2.4, 12), hydM, 0, 1.2, 0));
  hyd.add(meshOf(new THREE.SphereGeometry(0.44, 12, 8), hydM, 0, 2.45, 0));
  const nozzle = meshOf(new THREE.CylinderGeometry(0.19, 0.19, 0.5, 10), hydM, 0.52, 1.5, 0);
  nozzle.rotation.z = Math.PI / 2;
  hyd.add(nozzle);
  hyd.add(meshOf(new THREE.CylinderGeometry(0.66, 0.72, 0.32, 12), hydM, 0, 0.16, 0));
  hyd.add(contactShadow(1.9, { opacity: 0.36 }));
  add(hyd);
  addOutline(hyd, { px: 1.8 });

  /* --- chalk: the pitch ring on the crown, a hopscotch on the flags, tally marks --- */
  const ring = add(meshOf(new THREE.PlaneGeometry(9, 9), MAT.chalkMark(chalkTexture((g, r, s) => {
    g.lineWidth = 14;
    g.beginPath();
    for (let a = 0; a <= 72; a++) {
      const th = (a / 72) * Math.PI * 2;
      const rad = s * 0.40 + Math.sin(th * 3.1) * 4 + r.range(-3, 3);
      const x = s / 2 + Math.cos(th) * rad, y = s / 2 + Math.sin(th) * rad;
      a ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.stroke();
    g.lineWidth = 12;
    g.beginPath(); g.moveTo(s * 0.28, s * 0.5); g.lineTo(s * 0.72, s * 0.5 + r.range(-6, 6)); g.stroke();
    g.beginPath(); g.moveTo(s * 0.5, s * 0.28); g.lineTo(s * 0.5 + r.range(-6, 6), s * 0.72); g.stroke();
  }, { seed: 31 })), 13.0, 0.015, 19.0));
  ring.rotation.x = -Math.PI / 2;

  const hop = add(meshOf(new THREE.PlaneGeometry(7, 10), MAT.chalkMark(chalkTexture((g, r, s) => {
    g.lineWidth = 9;
    const boxes = [[0.30, 0.04, 0.40, 0.19], [0.30, 0.25, 0.40, 0.19], [0.06, 0.46, 0.40, 0.19], [0.54, 0.46, 0.40, 0.19], [0.30, 0.67, 0.40, 0.21]];
    for (const [x, y, w, h] of boxes) {
      g.beginPath();
      g.moveTo(s * x + r.range(-4, 4), s * y + r.range(-4, 4));
      g.lineTo(s * (x + w) + r.range(-4, 4), s * y + r.range(-4, 4));
      g.lineTo(s * (x + w) + r.range(-4, 4), s * (y + h) + r.range(-4, 4));
      g.lineTo(s * x + r.range(-4, 4), s * (y + h) + r.range(-4, 4));
      g.closePath();
      g.stroke();
    }
    g.lineWidth = 11;                            // a kid keeps score in strokes, not letters
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(s * 0.16 + i * 20, s * 0.90); g.lineTo(s * 0.16 + i * 20 + r.range(-6, 6), s * 0.97);
      g.stroke();
    }
    g.beginPath(); g.moveTo(s * 0.14, s * 0.975); g.lineTo(s * 0.16 + 3 * 20 + 10, s * 0.885); g.stroke();
  }, { seed: 37 })), 8.0, 0.635, -3.0));
  hop.rotation.x = -Math.PI / 2;

  /* --- the ball: body, chalk rim, ink outline, landing marker, and its own shadow (§2.5) --- */
  const ball = ballMesh(0.30, 'new');
  ball.position.set(15.5, 7.4, 10.0);
  add(ball);
  const bshadow = contactShadow(1.3, { opacity: 0.30 });
  bshadow.position.set(15.5, 0.02, 10.0);
  add(bshadow);
  const marker = add(meshOf(new THREE.PlaneGeometry(2.8, 2.8), MAT.chalkMark(chalkTexture((g, r, s) => {
    g.lineWidth = 17;
    g.beginPath();
    for (let a = 0; a <= 48; a++) {
      const th = (a / 48) * Math.PI * 2;
      const rad = s * 0.34 + r.range(-5, 5);
      const x = s / 2 + Math.cos(th) * rad, y = s / 2 + Math.sin(th) * rad;
      a ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.stroke();
  }, { seed: 41 })), 15.5, 0.03, 10.0));
  marker.rotation.x = -Math.PI / 2;

  /* --- home plate is a sewer casting, which is why a home run is a "two-sewer" hit --- */
  const plate = manholeMesh(1.25);
  plate.position.set(15.5, 0.01, 15.0);
  add(plate);
  addOutline(plate, { px: 1.2 });
  const plate2 = manholeMesh(1.25);
  plate2.position.set(-13.0, 0.01, 12.0);
  plate2.rotation.y = 0.4;
  add(plate2);
  addOutline(plate2, { px: 1.0 });

  /* --- the kid, on the brightest ground in the frame (Law 1), and his broomstick --- */
  const kid = buildMannequin({ seed: 5, skinStep: 2, wool: ACCENTS.indigo, capCol: ACCENTS.mustard, bat: true });
  kid.position.set(22.0, 0, 12.0);
  kid.rotation.y = 1.15;
  addOutline(kid, { px: 2.6, filter: (m) => m.material?.type === 'ShaderMaterial' });
  kid.add(contactShadow(2.2, { opacity: 0.38 }));
  add(kid);
  /* --- a second kid down the block: the same language, at a quarter of the size --- */
  const kid2 = buildMannequin({ seed: 11, skinStep: 4, wool: ACCENTS.mustard, capCol: ACCENTS.slateBlue, shirt: 2 });
  kid2.position.set(-8.0, 0, 9.0);
  kid2.rotation.y = -1.15;
  kid2.scale.setScalar(0.94);
  addOutline(kid2, { px: 1.7, filter: (m) => m.material?.type === 'ShaderMaterial' });
  kid2.add(contactShadow(2.2, { opacity: 0.34 }));
  add(kid2);

  camera.position.set(29.0, 5.2, 29.0);
  camera.lookAt(0.0, 7.0, -11.9);

  STYLE = { scene, camera, group: G, kid, ball, sun };
  return STYLE;
}

registerScenario('style_sheet', {
  seed: 1925,
  setup() {
    const s = buildStyleSet();
    ART.overrideView = { scene: s.scene, camera: s.camera, sun: s.sun };
  },
  settle: 0,
});

export { buildStyleSet, buildMannequin, faceTexture, awningTexture };

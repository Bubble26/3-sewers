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
  /** Height in feet over which the roadway's warm bounce dies out. */
  bounceHeight: 4.0,
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
  uOutlineScale: { value: ART.outlineScale },
};

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
  sootMax = 0.30, sun = 0.0,
} = {}) {
  const key = `brick:${base}:${mortar}:${seed}:${feet}:${wide}:${sootMax}:${sun}`;
  return cachedTex(key, () => {
    const W = 512, H = 1024;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    const pxPerFtY = H / feet, pxPerFtX = W / wide;
    const course = 0.219 * pxPerFtY;             // 2 1/4" brick + 3/8" joint
    const brickW = 0.698 * pxPerFtX;             // 8" brick + joint
    g.fillStyle = CSS(soot(mortar, 0.08));
    g.fillRect(0, 0, W, H);
    const rows = Math.ceil(H / course) + 1;
    for (let row = 0; row < rows; row++) {
      const yTop = H - (row + 1) * course;
      const heightFt = (row * course) / pxPerFtY;
      const off = row % 2 ? brickW * 0.5 : 0;
      for (let i = -1; i * brickW + off < W + brickW; i++) {
        const x = i * brickW + off;
        // Law 1 + Law 3: soot is a function of height and it takes value only.
        let col = sootAtHeight(base, heightFt, { curb: 0, cornice: feet, max: sootMax });
        if (sun > 0) col = sunlit(col, sun * Math.min(1, heightFt / feet) * 0.8);
        if (heightFt < 3.2) col = mix(col, AIR.brickBounce, 0.16 * (1 - heightFt / 3.2));
        const v = R.range(-0.055, 0.055);
        col = v < 0 ? soot(col, -v) : mix(col, AIR.sunTint, v * 0.9);
        if (R.chance(0.045)) col = soot(col, 0.30);              // a clinker in the course
        g.fillStyle = CSS(col);
        g.fillRect(Math.round(x) + 1, Math.round(yTop) + 1, Math.ceil(brickW) - 2, Math.ceil(course) - 2);
      }
    }
    // Drawn grime, never filtered: two streaks and a shadow line, both >= 6 px wide.
    g.globalAlpha = 0.30;
    for (let i = 0; i < 3; i++) {
      const x = R.range(0, W), w = R.range(10, 26);
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, 'rgba(30,20,14,0.85)');
      grd.addColorStop(0.55, 'rgba(30,20,14,0.25)');
      grd.addColorStop(1, 'rgba(30,20,14,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, w, H * 0.8);
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
        // one drawn chip out of a corner, and a worn lighter centre
        g.fillStyle = CSS(mix(flag, CHALK, 0.14));
        g.beginPath();
        g.ellipse(x * fw + fw * 0.5, y * fh + fh * 0.5, fw * 0.32, fh * 0.28, 0, 0, 6.3);
        g.fill();
        if (R.chance(0.4)) {
          g.fillStyle = CSS(soot(flag, 0.22));
          g.fillRect(x * fw + R.range(6, fw - 20), y * fh + fh - 12, R.range(10, 22), 8);
        }
      }
    }
    return finish(c, { repeat: [1, 1], wrap: [THREE.RepeatWrapping, THREE.RepeatWrapping] });
  });
}

/** Roadway: tar patches, block surfacing through, and a wear-polished crown (Law 1). */
export function asphaltTexture({ seed = 11, crown = 0.5 } = {}) {
  const key = `asphalt:${seed}:${crown}`;
  return cachedTex(key, () => {
    const W = 512, H = 512;
    const [c, g] = canvas(W, H);
    const R = new RNG(seed);
    g.fillStyle = CSS(PAVEMENT.asphaltShade);
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {                     // patches, drawn as shapes
      const col = R.pick([PAVEMENT.asphaltDark, PAVEMENT.asphaltWarm, PAVEMENT.asphaltSun]);
      g.fillStyle = CSS(col);
      g.beginPath();
      const x = R.range(0, W), y = R.range(0, H), rx = R.range(28, 90), ry = R.range(18, 55);
      g.ellipse(x, y, rx, ry, R.range(0, 3.14), 0, 6.3);
      g.fill();
    }
    // the crown: the brightest ground in the frame, with Belgian block coming through it
    const cy = H * crown;
    const grd = g.createLinearGradient(0, cy - H * 0.36, 0, cy + H * 0.36);
    grd.addColorStop(0, 'rgba(168,145,122,0)');
    grd.addColorStop(0.5, 'rgba(168,145,122,0.55)');
    grd.addColorStop(1, 'rgba(168,145,122,0)');
    g.fillStyle = grd;
    g.fillRect(0, cy - H * 0.36, W, H * 0.72);
    for (let i = 0; i < 40; i++) {                     // block heads polished silver
      const x = R.range(0, W), y = cy + R.range(-H * 0.22, H * 0.22);
      g.fillStyle = CSS(mix(PAVEMENT.belgianBlock, PAVEMENT.blockCrown, R.range(0.2, 1)));
      g.fillRect(x, y, R.range(14, 22), R.range(8, 12));
    }
    for (let i = 0; i < 9; i++) {                      // tar seams, drawn, >= 6 px
      g.strokeStyle = CSS(soot(PAVEMENT.asphaltDark, 0.12));
      g.lineWidth = R.range(6, 10);
      g.beginPath();
      let x = R.range(0, W), y = 0;
      g.moveTo(x, y);
      while (y < H) { y += 40; x += R.range(-26, 26); g.lineTo(x, y); }
      g.stroke();
    }
    return finish(c, { repeat: [1, 1], wrap: [THREE.RepeatWrapping, THREE.RepeatWrapping] });
  });
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
uniform float uBounceStr;
uniform float uBandBias;
uniform float uOpacity;
uniform float uTexMode;
uniform float uTexAmt;
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
  float lit = smoothstep( -w, w, ndl - uBandBias );

  vec3 c = uLit;
  if ( uTexMode > 0.5 ) {
    vec3 t = texture2D( uTex, vUvA * uTexRepeat ).rgb;
    c = ( uTexMode < 1.5 ) ? mix( uLit, t, uTexAmt )              // painted colour map
                           : uLit * mix( 1.0, t.r * 2.0, uTexAmt );       // value modulation
  }
  vec3 sr = uShade / max( uLit, vec3( 0.004 ) );
  vec3 br = uBounce / max( uLit, vec3( 0.004 ) );
  vec3 col = mix( c * sr, c, lit );

  // Band 3. The warm kick: undersides of forms always, low upward faces near the roadway.
  float up = max( n.y, 0.0 );
  float down = max( -n.y, 0.0 );
  float near = 1.0 - smoothstep( 0.0, uBounceH, vWP.y );
  float bm = clamp( down * 0.9 + up * near * 0.85, 0.0, 1.0 );
  bm = smoothstep( 0.30, 0.78, bm ) * uBounceStr;
  col = mix( col, c * br, bm );

  gl_FragColor = vec4( col, uOpacity );
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
      uTexMode: { value: 0 }, uTexAmt: { value: 1 }, uTexRepeat: { value: new THREE.Vector2(1, 1) },
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
    fog = true, shadeK = 0.72, key = '',
  } = opts;
  const id = `toon:${color}:${map?.uuid || tex?.uuid || 'x'}:${repeat}:${texAmt}:${bounceStr}:${bias}:${opacity}:${side}:${fog}:${shadeK}:${key}`;
  return cachedMat(id, () => {
    const u = toonUniforms();
    u.uLit.value = new THREE.Color(color);
    u.uShade.value = new THREE.Color(shade(color, shadeK));
    u.uBounce.value = new THREE.Color(bounce(color));
    u.uBounceStr.value = bounceStr;
    u.uBandBias.value = bias;
    u.uOpacity.value = opacity;
    u.uTexMode.value = map ? 1 : tex ? 2 : 0;
    u.uTexAmt.value = texAmt;
    u.uTexRepeat.value = new THREE.Vector2(repeat[0], repeat[1]);
    u.uTex.value = map || tex;
    u.uSun = shared.uSun; u.uTermPx = shared.uTermPx; u.uViewH = shared.uViewH;
    u.uBounceH = shared.uBounceH;
    const m = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: TOON_VERT, fragmentShader: TOON_FRAG,
      transparent: transparent || opacity < 1, side, depthWrite, fog,
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
    const map = brickTexture({ base, feet: o.feet ?? 24, wide: o.wide ?? 12, seed: o.seed ?? 7, sootMax: o.sootMax ?? 0.30, sun: o.sun ?? 0 });
    return toon(base, { map, repeat: o.repeat ?? [1, 1], bounceStr: 0.5, key: `brick${kind}${o.feet}${o.seed}` });
  },
  /** Bluestone, granite, brownstone: matte, mid-value, the stuff the stoop is made of. */
  stone(base = PAVEMENT.sidewalk, o = {}) {
    const map = stoneTexture({ base, seed: o.seed ?? 3, cols: o.cols ?? 3, rows: o.rows ?? 4 });
    return toon(base, { map, repeat: o.repeat ?? [1, 1], bounceStr: 0.8, key: `stone${base}${o.seed}` });
  },
  /** Roadway. The crown of it is the brightest ground surface in the frame (Law 1). */
  asphalt(o = {}) {
    const map = asphaltTexture({ seed: o.seed ?? 11, crown: o.crown ?? 0.5 });
    return toon(PAVEMENT.asphaltShade, { map, repeat: o.repeat ?? [1, 1], bounceStr: 0.4, key: `asph${o.seed}${o.crown}` });
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
function buildMannequin({ seed = 5, skinStep = 2, wool = ACCENTS.bottleGreen, capCol = ACCENTS.rust, shirt = 0 } = {}) {
  const R = new RNG(seed);
  const g = new THREE.Group();
  const HH = 1.30;                                   // head height in feet
  const headW = HH * 0.94;
  const skinM = MAT.skin(skinStep);
  const shirtM = MAT.cloth(CLOTH[shirt], { seed: 31 });
  const woolM = MAT.wool(wool, { seed: 9 });
  const capM = MAT.wool(capCol, { seed: 21, repeat: [1.4, 1.4] });
  const trouser = soot(mix(PAVEMENT.asphaltWarm, AIR.shadowTint, 0.34), 0.22);
  const trouserM = toon(trouser, { key: 'knick' });
  const buckleM = toon(soot(trouser, 0.26), { key: 'buckle' });
  const sockM = toon(mix(CLOTH[2], PAVEMENT.curb, 0.30), { tex: knitTexture({ seed: 14 }), texAmt: 0.5, repeat: [1, 3], key: 'sock' });
  const bootM = toon(soot(ACCENTS.tan, 0.48), { key: 'boot' });

  const hipY = HH * 1.42;                            // legs = 1.42 head-heights, inside 1.2-1.5
  const kneeY = HH * 0.78;
  const bootH = HH * 0.20;
  const bootTop = 0.02 + bootH;

  for (const s of [-1, 1]) {
    const x = s * headW * 0.25;
    const lean = s * 0.03;
    // knickers: a balloon ending in a hard horizontal buckle line at the knee (§5.2)
    const knick = meshOf(new THREE.SphereGeometry(headW * 0.40, 14, 10), trouserM, x, (hipY + kneeY) * 0.5, 0);
    knick.scale.set(1.0, (hipY - kneeY) / (headW * 0.80) * 0.62 + 0.42, 1.06);
    g.add(knick);
    g.add(meshOf(new THREE.CylinderGeometry(headW * 0.29, headW * 0.275, 0.10, 12), buckleM, x, kneeY, 0));
    // stocking: three accordion folds, asymmetric left to right (free character, §5.2)
    const sockH = kneeY - bootTop;
    const sock = meshOf(new THREE.CylinderGeometry(headW * 0.235, headW * 0.20, sockH, 12), sockM, x, bootTop + sockH / 2, 0);
    g.add(sock);
    for (let i = 0; i < 3; i++) {
      const t = 0.20 + i * 0.26 + (s > 0 ? 0.06 : 0);
      const ring = meshOf(new THREE.TorusGeometry(headW * (0.225 - i * 0.010), 0.038, 5, 14), sockM, x, bootTop + sockH * t, 0);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }
    // boots: 0.8 head-heights long, tongue out, and they are the funny part of a run cycle
    const boot = meshOf(new THREE.BoxGeometry(headW * 0.44, bootH, HH * 0.62), bootM, x, 0.02 + bootH / 2, HH * 0.10 + lean);
    g.add(boot);
    const toe = meshOf(new THREE.SphereGeometry(HH * 0.125, 10, 8), bootM, x, 0.02 + bootH * 0.48, HH * 0.38 + lean);
    toe.scale.set(0.94, 0.78, 1.15);
    g.add(toe);
    const tongue = meshOf(new THREE.BoxGeometry(headW * 0.30, HH * 0.11, 0.06), bootM, x, bootTop + HH * 0.02, HH * 0.10 + lean);
    tongue.rotation.x = -0.5;
    g.add(tongue);
  }

  // torso: ecru shirt, one saturated sweater over it, hem below the hip
  const chestY = hipY + HH * 0.50;
  const shirtMesh = meshOf(new THREE.CapsuleGeometry(headW * 0.37, HH * 0.50, 4, 12), shirtM, 0, chestY - HH * 0.06, 0);
  shirtMesh.scale.set(1.04, 1, 0.84);
  g.add(shirtMesh);
  const sweater = meshOf(new THREE.CapsuleGeometry(headW * 0.41, HH * 0.34, 4, 12), woolM, 0, chestY - HH * 0.22, 0);
  sweater.scale.set(1.04, 1, 0.88);
  g.add(sweater);
  const hem = meshOf(new THREE.CylinderGeometry(headW * 0.44, headW * 0.43, HH * 0.11, 14), woolM, 0, hipY - HH * 0.06, 0);
  hem.scale.set(1.02, 1, 0.9);
  g.add(hem);

  // arms: tubes to mid-thigh, mitts for hands, sleeves of the sweater then bare forearm
  const armY = chestY + HH * 0.08;
  const arm = (s, shoulder, elbow) => {
    const a = new THREE.Group();
    a.position.set(s * headW * 0.38, armY, 0);
    a.rotation.set(shoulder[0], 0, shoulder[1]);
    a.add(meshOf(new THREE.CapsuleGeometry(headW * 0.125, HH * 0.32, 3, 10), woolM, 0, -HH * 0.21, 0));
    const f = new THREE.Group();
    f.position.set(0, -HH * 0.42, 0);
    f.rotation.set(elbow[0], 0, elbow[1]);
    f.add(meshOf(new THREE.CapsuleGeometry(headW * 0.105, HH * 0.28, 3, 10), skinM, 0, -HH * 0.18, 0));
    const hand = meshOf(new THREE.SphereGeometry(headW * 0.185, 10, 8), skinM, 0, -HH * 0.38, 0);
    hand.scale.set(1, 1.05, 0.72);
    f.add(hand);
    a.add(f);
    g.add(a);
    return a;
  };
  const armL = arm(1, [-0.30, 0.26], [0.60, -0.10]);
  const armR = arm(-1, [-0.16, -0.20], [0.26, 0.10]);

  // head: 31% of standing height, cap at 1.3x its plan area, face painted flat
  const neckY = chestY + HH * 0.32;
  g.add(meshOf(new THREE.CylinderGeometry(headW * 0.16, headW * 0.18, HH * 0.10, 10), skinM, 0, neckY - HH * 0.02, 0));
  const head = new THREE.Group();
  head.position.set(0, neckY + HH * 0.44, 0);
  head.rotation.y = -0.20;
  const skull = meshOf(new THREE.SphereGeometry(headW * 0.52, 20, 16), skinM, 0, 0, 0);
  skull.scale.set(1, 1.06, 0.95);
  head.add(skull);
  for (const s of [-1, 1]) {
    const e = meshOf(new THREE.SphereGeometry(headW * 0.125, 10, 8), skinM, s * headW * 0.49, -HH * 0.02, -0.03);
    e.scale.set(0.45, 1, 0.85);
    head.add(e);
  }
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(headW * 0.532, 24, 18, Math.PI * 0.22, Math.PI * 0.56, Math.PI * 0.20, Math.PI * 0.58),
    new THREE.MeshBasicMaterial({ map: faceTexture(skinStep, seed), transparent: true, alphaTest: 0.4, depthWrite: false, fog: true }),
  );
  face.renderOrder = 3;
  head.add(face);
  const hair = meshOf(new THREE.SphereGeometry(headW * 0.53, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.44), toon(soot(SKIN[Math.min(5, skinStep + 3)], 0.35), { key: 'hair' }), 0, HH * 0.015, 0);
  hair.scale.set(1.02, 0.9, 1.02);
  head.add(hair);
  const cap = meshOf(new THREE.SphereGeometry(headW * 0.585, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.54), capM, 0, HH * 0.085, -headW * 0.03);
  cap.scale.set(1.08, 0.66, 1.16);
  head.add(cap);
  const brim = meshOf(new THREE.CylinderGeometry(headW * 0.60, headW * 0.55, 0.06, 18, 1, false, -0.95, 1.9), capM, 0, HH * 0.045, headW * 0.14);
  brim.scale.set(1, 1, 1.28);
  brim.rotation.x = -0.10;
  head.add(brim);
  head.add(meshOf(new THREE.SphereGeometry(0.055, 8, 6), capM, 0, HH * 0.175, -headW * 0.03));
  g.add(head);

  g.userData.rig = { head, armL, armR };
  g.userData.headHeight = HH;
  g.userData.standing = neckY + HH * 0.44 + headW * 0.55;
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
    const eyeR = S * 0.070, eyeY = S * 0.455, cx = S * 0.5;
    for (const s of [-1, 1]) {
      const x = cx + s * S * 0.115;
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
      const x = cx + s * S * 0.115;
      const raise = s > 0 ? S * 0.062 : S * 0.030;
      g.save();
      g.translate(x, eyeY - eyeR - raise);
      g.rotate(s * -0.18);
      g.beginPath();
      g.ellipse(0, 0, eyeR * 1.15, 6.5, 0, 0, 6.3);
      g.fill();
      g.restore();
    }
    g.strokeStyle = ink;                          // nose: a comma
    g.lineWidth = 5.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx + 5, S * 0.535);
    g.quadraticCurveTo(cx + 15, S * 0.583, cx - 1, S * 0.598);
    g.stroke();
    g.fillStyle = ink;                            // mouth: open lower-arc grin (§5.3, shape 2)
    g.beginPath();
    g.arc(cx, S * 0.598, S * 0.112, 0.26, Math.PI - 0.20);
    g.closePath();
    g.fill();
    g.fillStyle = CSS(mix(BLUSH, CHALK, 0.35));   // tongue in one corner
    g.beginPath();
    g.ellipse(cx + S * 0.070, S * 0.677, S * 0.032, S * 0.022, 0.35, 0, 6.3);
    g.fill();
    g.fillStyle = CSS(CHALK);                     // two teeth, because six mouths need teeth
    g.fillRect(cx - S * 0.045, S * 0.598, S * 0.036, S * 0.028);
    g.fillRect(cx - S * 0.004, S * 0.598, S * 0.034, S * 0.026);
    g.globalAlpha = 0.20;                         // blush at 20% (§2.8)
    g.fillStyle = CSS(BLUSH);
    for (const s of [-1, 1]) {
      g.beginPath(); g.ellipse(cx + s * S * 0.186, S * 0.572, S * 0.060, S * 0.040, 0, 0, 6.3); g.fill();
    }
    g.globalAlpha = 0.35;                         // one cheek smudge (§4.4.5)
    g.fillStyle = CSS(SMUDGE);
    g.beginPath();
    g.ellipse(cx - S * 0.170, S * 0.520, S * 0.058, S * 0.020, -0.42, 0, 6.3);
    g.fill();
    g.beginPath();
    g.ellipse(cx - S * 0.150, S * 0.560, S * 0.036, S * 0.014, -0.30, 0, 6.3);
    g.fill();
    g.globalAlpha = 0.8;
    if (skinStep <= 2) {
      g.fillStyle = CSS(soot(SKIN[Math.min(5, skinStep + 2)], 0.06));
      for (let i = 0; i < 14; i++) {
        const s = R.chance(0.5) ? 1 : -1;
        g.beginPath();
        g.ellipse(cx + s * R.range(S * 0.09, S * 0.21), S * 0.520 + R.range(-S * 0.03, S * 0.055), 3.8, 3.4, 0, 0, 6.3);
        g.fill();
      }
    }
    g.globalAlpha = 1;
    return finish(c, { wrap: [THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping] });
  });
}

/** A striped awning: Law 4's saturated neighbour, and the period's own shopfront. */
function awningTexture(a = ACCENTS.red, b = mix(CLOTH[0], CHALK, 0.30), seed = 3) {
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
  scene.fog = new THREE.Fog(AIR.haze, 55, 300);
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 700);
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
  const road = add(meshOf(new THREE.PlaneGeometry(300, 120), MAT.asphalt({ repeat: [7, 3], crown: 0.46 }), 0, 0, 26));
  road.rotation.x = -Math.PI / 2;
  const walk = add(meshOf(new THREE.BoxGeometry(300, 0.62, 14), MAT.stone(PAVEMENT.sidewalk, { repeat: [22, 1], seed: 3 }), 0, 0.31, -4.8));
  const curb = add(meshOf(new THREE.BoxGeometry(300, 0.70, 0.9), MAT.stone(PAVEMENT.curb, { repeat: [60, 1], seed: 4, cols: 1, rows: 1 }), 0, 0.35, 2.65));

  /* --- the tenement, left: brick, sooted upward, 60 ft of it, holding the dark edge --- */
  const tenH = 58;
  add(meshOf(
    new THREE.BoxGeometry(46, tenH, 2.0),
    MAT.brick('brick', { feet: tenH, wide: 12, repeat: [3.8, 1], seed: 7, sootMax: 0.36 }),
    -31, tenH / 2, -12.9,
  ));
  // the party wall of the next house along, one building in eight is ochre (§2.2)
  add(meshOf(
    new THREE.BoxGeometry(24, 52, 2.0),
    MAT.brick('ochre', { feet: 52, wide: 12, repeat: [2, 1], seed: 12, sootMax: 0.40 }),
    -66, 26, -13.2,
  ));

  /* --- the corner taxpayer, right: 16 ft, one storey, and the reason we can see sky --- */
  const taxH = 15.6;
  add(meshOf(
    new THREE.BoxGeometry(30, taxH, 2.0),
    MAT.brick('brick', { feet: taxH, wide: 12, repeat: [2.5, 1], seed: 21, sootMax: 0.22, sun: 0.10 }),
    5, taxH / 2, -12.9,
  ));
  const corniceCol = FACADE.cornice[0];
  add(meshOf(new THREE.BoxGeometry(30.6, 1.5, 3.4), toon(corniceCol, { bounceStr: 1.0, key: 'cor' }), 5, taxH + 0.75, -11.5));
  // the upper face of a cornice is the blackest thing in the frame, and it is DRAWN so (§4.4)
  add(meshOf(new THREE.BoxGeometry(30.6, 0.45, 3.7), toon(soot(corniceCol, 0.40), { bounceStr: 0, key: 'cortop' }), 5, taxH + 1.7, -11.4));
  const dentil = new THREE.InstancedMesh(new THREE.BoxGeometry(0.62, 0.55, 0.5), toon(soot(corniceCol, 0.14), { bounceStr: 1.3, key: 'dent' }), 26);
  const dm = new THREE.Matrix4();
  for (let i = 0; i < 26; i++) { dm.makeTranslation(-9.5 + i * 1.16, taxH - 0.32, -10.1); dentil.setMatrixAt(i, dm); }
  add(dentil);
  // the tenement's own cornice, far above, catching the sun band the period is famous for
  add(meshOf(new THREE.BoxGeometry(46, 2.0, 3.6), toon(sunlit(FACADE.cornice[2], 0.30), { bounceStr: 0.8, key: 'cor2' }), -31, tenH + 1.0, -11.4));

  /* --- what is across the avenue: hazed, brighter with distance, never darker (§2.3) --- */
  const far = add(meshOf(new THREE.BoxGeometry(70, 62, 2), toon(FACADE.brickSoot, { bounceStr: 0, key: 'far' }), 66, 31, -150));
  const far2 = add(meshOf(new THREE.BoxGeometry(46, 44, 2), toon(FACADE.ochreShade, { bounceStr: 0, key: 'far2' }), 122, 22, -196));
  for (const m of [far, far2]) m.renderOrder = -8;

  /* --- the window: sash, glass with a painted highlight, gold leaf, a sill and its grime --- */
  const winG = new THREE.Group();
  winG.position.set(-2.0, 8.2, -11.8);
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
  feG.position.set(-26, 14.0, -11.6);
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
  awnG.position.set(9, 10.4, -11.7);
  const awnT = awningTexture();
  const canopy = meshOf(new THREE.BoxGeometry(15, 0.22, 7.2), toon(0xffffff, { map: awnT, repeat: [3, 1], bounceStr: 1.3, key: 'awn' }), 0, 0, 3.5);
  canopy.rotation.x = -0.34;
  awnG.add(canopy);
  awnG.add(meshOf(new THREE.BoxGeometry(15, 1.5, 0.16), toon(0xffffff, { map: awnT, repeat: [3, 0.22], bounceStr: 1.5, key: 'awnv' }), 0, -1.95, 6.7));
  for (const s of [-1, 1]) awnG.add(meshOf(new THREE.CylinderGeometry(0.085, 0.085, 9.0, 8), MAT.iron(FACADE.iron[1], { seed: 6 }), s * 7.1, -4.9, 6.6));
  add(awnG);
  addOutline(awnG, { px: 1.4 });
  add(meshOf(new THREE.BoxGeometry(16, 9.8, 0.5), toon(soot(ACCENTS.bottleGreen, 0.30), { key: 'shopfront' }), 9, 4.9, -11.75));
  add(meshOf(new THREE.PlaneGeometry(13.4, 5.8), MAT.glass({ seed: 19 }), 9, 5.6, -11.46));
  add(meshOf(new THREE.BoxGeometry(16.4, 0.5, 0.7), toon(soot(ACCENTS.bottleGreen, 0.46), { key: 'stall' }), 9, 9.9, -11.6));
  // crates of produce on the stall board: six saturated accents in one 128 px region (Law 4)
  const crateM = toon(mix(ACCENTS.tan, CLOTH[2], 0.30), { key: 'crate' });
  for (let i = 0; i < 3; i++) {
    const cx = 3.4 + i * 4.2;
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
  stoop.position.set(-14.5, 0, -11.6);
  const treadM = MAT.stone(mix(PAVEMENT.sidewalk, FACADE.brickShade, 0.16), { seed: 6, cols: 1, rows: 1 });
  const cheekM = toon(mix(FACADE.brickShade, PAVEMENT.curb, 0.30), { key: 'cheek' });
  for (let i = 0; i < 6; i++) {
    stoop.add(meshOf(new THREE.BoxGeometry(7.6, 0.66, 1.30), treadM, 0, 0.33 + i * 0.66, 7.0 - i * 1.30));
    stoop.add(meshOf(new THREE.BoxGeometry(7.4, 0.66, 0.10), toon(soot(PAVEMENT.sidewalk, 0.34), { bounceStr: 1.4, key: 'riser' }), 0, 0.33 + i * 0.66, 7.65 - i * 1.30));
  }
  for (const s of [-1, 1]) {
    stoop.add(meshOf(new THREE.BoxGeometry(0.9, 4.0, 8.0), cheekM, s * 4.1, 2.0, 3.6));
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
  canG.position.set(-7.6, 0, -6.6);
  const canM = MAT.iron(mix(FACADE.iron[0], PAVEMENT.curb, 0.34), { seed: 9, rust: 1, repeat: [3, 1] });
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
  hyd.position.set(6.6, 0.62, -1.4);
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
  }, { seed: 31 })), 3.0, 0.015, 9.5));
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
  }, { seed: 37 })), -20.0, 0.635, -3.0));
  hop.rotation.x = -Math.PI / 2;

  /* --- the ball: body, chalk rim, ink outline, landing marker, and its own shadow (§2.5) --- */
  const ball = ballMesh(0.30, 'new');
  ball.position.set(6.2, 6.6, 2.6);
  add(ball);
  const bshadow = contactShadow(1.3, { opacity: 0.30 });
  bshadow.position.set(6.2, 0.02, 2.6);
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
  }, { seed: 41 })), 6.2, 0.03, 2.6));
  marker.rotation.x = -Math.PI / 2;

  /* --- the kid, on the brightest ground in the frame (Law 1), and his broomstick --- */
  const kid = buildMannequin({ seed: 5, skinStep: 2, wool: ACCENTS.indigo, capCol: ACCENTS.mustard });
  kid.position.set(1.6, 0, 5.0);
  kid.rotation.y = 0.62;
  addOutline(kid, { px: 2.0, filter: (m) => m.material?.type === 'ShaderMaterial' });
  kid.add(contactShadow(2.2, { opacity: 0.38 }));
  add(kid);
  const bat = new THREE.Group();
  bat.position.set(1.15, 3.55, 5.35);
  bat.rotation.set(-0.34, 0.62, -0.78);
  const wood = mix(ACCENTS.tan, CLOTH[2], 0.40);
  bat.add(meshOf(new THREE.CylinderGeometry(0.070, 0.082, 3.2, 9), toon(wood, { key: 'stick' }), 0, 1.45, 0));
  bat.add(meshOf(new THREE.CylinderGeometry(0.098, 0.098, 0.66, 9), toon(soot(CLOTH[3], 0.26), { key: 'tape' }), 0, 0.15, 0));
  addOutline(bat, { px: 1.8 });
  add(bat);

  /* --- a second kid down the block: the same language, at a quarter of the size --- */
  const kid2 = buildMannequin({ seed: 11, skinStep: 4, wool: ACCENTS.mustard, capCol: ACCENTS.slateBlue, shirt: 2 });
  kid2.position.set(-15.0, 0, 20.0);
  kid2.rotation.y = -1.15;
  kid2.scale.setScalar(0.94);
  addOutline(kid2, { px: 1.7, filter: (m) => m.material?.type === 'ShaderMaterial' });
  kid2.add(contactShadow(2.2, { opacity: 0.34 }));
  add(kid2);

  camera.position.set(13.5, 5.3, 22.0);
  camera.lookAt(-5.5, 8.2, -8.0);

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

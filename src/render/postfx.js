/**
 * postfx.js — the output transform, and the only place a pixel is touched after shading.
 *
 * This module also carries the art-direction system for the whole game: it imports
 * materials.js (which imports palette.js), so `import '../render/postfx.js'` in
 * src/boot/modules.js pulls in the entire look — palette, materials, outlines, style sheet.
 *
 * WHAT IT DOES, and why each part is allowed to exist:
 *
 * 1. IT TURNS THE FILM CURVE OFF. This is the important one. The palette in §2 is authored as
 *    FINAL DISPLAY VALUES — every check in the bible is written in the L* of a hex, and §14
 *    A1 measures those L* on the rendered frame. A filmic tone curve breaks that contract:
 *    measured through ACES at exposure 1.05, our brick renders at L* 67.6 instead of the
 *    authored 47.5, and the coal haze renders at L* 94 — level with CHALK, which Law 2 says
 *    nothing may reach. So the renderer's tone mapping is switched off while this pass owns
 *    the output, and the pass applies a curve a 1997 sprite artist could have painted instead
 *    (§3.4 bans "a tone-mapping curve that a 1997 sprite artist could not have painted by
 *    hand", which is exactly what ACES is). Turn postfx off and the renderer's own setting is
 *    put back untouched.
 *
 * 2. THE POSTER CURVE. Three segments, and the middle one is a straight line:
 *      · FLOOR — §3.4 requires no 64x64 px region of a gameplay frame below L* 26. The lift is
 *        REGION-AWARE: it reads a 1/16-scale luminance buffer, so a dark neighbourhood is
 *        raised as a whole (§3.4: "lifted by raising ambient — never by adding a light") while
 *        a 2 px ink outline sitting in a bright neighbourhood stays ink. It lifts toward
 *        #3E4658, the period's own blue-violet skylight, so shadows go cool, never grey.
 *      · MIDDLE — dead straight. The play plane, every kid, and above all THE BALL pass
 *        through this pass unchanged, which is the only way the §2.5 contrast table stays
 *        true on screen. Nothing here may ever hurt the readability of the ball.
 *      · CEILING — a shoulder that only engages above L* 88 and asymptotes below white, so
 *        the top of the range stays reserved for chalk and no pixel is ever #FFFFFF (Law 2).
 *
 * 3. WHAT IT DELIBERATELY DOES NOT DO. §3.4: "No bloom, no vignette, no chromatic aberration,
 *    no depth of field, no film grain, no colour LUT." Law 1 says our vignette is built out of
 *    MATERIAL — soot up the facade, a scoured bright crown on the roadway — not out of a post
 *    effect. The vignette and grain terms below exist, are wired, and ship at strength 0 with
 *    their shader code compiled out; PROFILES.debug turns them on for an A/B and nothing else.
 *    If you are tempted to raise them, re-read Law 1: the answer is in the geometry.
 *
 * 4. IT DEGRADES. No WebGL2, a lost context, a failed float target, or app.flags.quality
 *    'low' and the whole thing steps aside and calls stage.render() directly, with the
 *    renderer's original tone mapping restored. The game never depends on this file working.
 */
import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { ART, syncArt } from './materials.js';
import { AIR, CHALK, lstar } from './palette.js';

/* Y of a target L*, the number the shader actually needs. */
const yOf = (L) => ((L + 16) / 116) ** 3;

export const PROFILES = {
  /** What ships. A floor, a straight middle, a shoulder. Nothing else. */
  bible: { floorL: 26.0, floorGain: 1.30, ceilKnee: 0.90, ceilMax: 0.965, chroma: 0.0, vignette: 0.0, grain: 0.0 },
  /** For an A/B only — everything §3.4 forbids, so a critic can see why it forbids it. */
  debug: { floorL: 26.0, floorGain: 1.30, ceilKnee: 0.86, ceilMax: 0.95, chroma: 0.10, vignette: 0.35, grain: 0.05 },
  /** Straight through: the pass still owns the output transform, but grades nothing. */
  flat: { floorL: 0, floorGain: 0, ceilKnee: 1.0, ceilMax: 1.0, chroma: 0, vignette: 0, grain: 0 },
};

const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}`;

/** Downsample to 1/16 and keep luminance only — the "region" the floor law is written about. */
const DOWN_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform vec2 tTexel;
varying vec2 vUv;
void main() {
  vec3 s = vec3( 0.0 );
  s += texture2D( tDiffuse, vUv + tTexel * vec2( -5.0, -5.0 ) ).rgb;
  s += texture2D( tDiffuse, vUv + tTexel * vec2(  5.0, -5.0 ) ).rgb;
  s += texture2D( tDiffuse, vUv + tTexel * vec2( -5.0,  5.0 ) ).rgb;
  s += texture2D( tDiffuse, vUv + tTexel * vec2(  5.0,  5.0 ) ).rgb;
  s += texture2D( tDiffuse, vUv + tTexel * vec2( -12.0, 0.0 ) ).rgb;
  s += texture2D( tDiffuse, vUv + tTexel * vec2(  12.0, 0.0 ) ).rgb;
  s += texture2D( tDiffuse, vUv + tTexel * vec2( 0.0, -12.0 ) ).rgb;
  s += texture2D( tDiffuse, vUv + tTexel * vec2( 0.0,  12.0 ) ).rgb;
  s *= 0.125;
  float y = dot( s, vec3( 0.2126, 0.7152, 0.0722 ) );
  gl_FragColor = vec4( vec3( y ), 1.0 );
}`;

const GRADE_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tRegion;
uniform vec2 rTexel;
uniform vec3 uFill;
uniform float uFloor;
uniform float uFloorGain;
uniform float uKnee;
uniform float uCeil;
uniform float uChroma;
#ifdef USE_VIGNETTE
uniform float uVignette;
#endif
#ifdef USE_GRAIN
uniform float uGrain;
uniform float uSeed;
#endif
varying vec2 vUv;

float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

void main() {
  vec3 c = texture2D( tDiffuse, vUv ).rgb;

  // --- FLOOR. Read the neighbourhood, not the pixel: a dark REGION gets ambient added; a
  //     2 px ink outline inside a bright region is left exactly as dark as it was authored.
  float region = texture2D( tRegion, vUv ).r;
  region += texture2D( tRegion, vUv + vec2( rTexel.x, 0.0 ) ).r;
  region += texture2D( tRegion, vUv - vec2( rTexel.x, 0.0 ) ).r;
  region += texture2D( tRegion, vUv + vec2( 0.0, rTexel.y ) ).r;
  region += texture2D( tRegion, vUv - vec2( 0.0, rTexel.y ) ).r;
  region *= 0.2;
  float need = max( 0.0, uFloor - region ) * uFloorGain;
  float keep = 1.0 - smoothstep( uFloor * 2.0, uFloor * 5.0, luma( c ) );
  c += uFill * need * keep;

  // --- MIDDLE. Nothing. The play plane and the ball pass through untouched.

  // --- CEILING. A shoulder above L* 88 only, asymptotic below white: the top of the range
  //     belongs to chalk, and no pixel in this game is ever pure white.
  float m = max( c.r, max( c.g, c.b ) );
  if ( m > uKnee ) {
    float t = m - uKnee;
    float span = max( uCeil - uKnee, 1e-4 );
    float mm = uKnee + span * ( t / ( t + span ) );
    c *= mm / max( m, 1e-4 );
  }

  if ( uChroma > 0.0 ) c = mix( vec3( luma( c ) ), c, 1.0 + uChroma );

  #ifdef USE_VIGNETTE
    float d = distance( vUv, vec2( 0.5 ) );
    c *= 1.0 - uVignette * smoothstep( 0.34, 0.82, d );
  #endif
  #ifdef USE_GRAIN
    float n = fract( sin( dot( vUv * 1024.0 + uSeed, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    c += ( n - 0.5 ) * uGrain;
  #endif

  gl_FragColor = vec4( max( c, vec3( 0.0 ) ), 1.0 );
  #include <colorspace_fragment>
}`;

class PostFX {
  constructor(renderer, profile = PROFILES.bible) {
    this.renderer = renderer;
    this.profile = profile;
    this.ok = false;
    this.samples = 4;
    this.size = new THREE.Vector2(2, 2);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.BufferGeometry();
    this.quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));

    const fill = new THREE.Color(AIR.shadowTint);
    // The fill is a direction in colour space, not a colour: normalise it so uFloorGain is
    // the only dial and the tint cannot quietly change the amount of lift.
    const fmax = Math.max(fill.r, fill.g, fill.b) || 1;
    fill.multiplyScalar(1 / fmax);

    this.grade = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tRegion: { value: null },
        rTexel: { value: new THREE.Vector2(1 / 100, 1 / 56) },
        uFill: { value: fill },
        uFloor: { value: yOf(profile.floorL) },
        uFloorGain: { value: profile.floorGain },
        uKnee: { value: profile.ceilKnee },
        uCeil: { value: profile.ceilMax },
        uChroma: { value: profile.chroma },
        uVignette: { value: profile.vignette },
        uGrain: { value: profile.grain },
        uSeed: { value: 0 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: GRADE_FRAG,
      defines: {
        ...(profile.vignette > 0 ? { USE_VIGNETTE: '' } : {}),
        ...(profile.grain > 0 ? { USE_GRAIN: '' } : {}),
      },
      depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    });
    this.down = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT, fragmentShader: DOWN_FRAG,
      depthTest: false, depthWrite: false, fog: false, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.quad, this.grade);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    try {
      this.build(1600, 900);
      this.ok = true;
    } catch (e) {
      this.ok = false;
    }
  }

  build(w, h) {
    this.rt?.dispose();
    this.small?.dispose();
    const opts = {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, stencilBuffer: false, samples: this.samples,
    };
    this.rt = new THREE.WebGLRenderTarget(w, h, opts);
    this.small = new THREE.WebGLRenderTarget(Math.max(4, Math.round(w / 16)), Math.max(4, Math.round(h / 16)), {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this.size.set(w, h);
    this.down.uniforms.tTexel.value.set(1 / w, 1 / h);
    this.grade.uniforms.rTexel.value.set(1 / this.small.width, 1 / this.small.height);
  }

  resizeTo(renderer) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    if (s.x < 2 || s.y < 2) return;
    if (Math.abs(s.x - this.size.x) > 0.5 || Math.abs(s.y - this.size.y) > 0.5) this.build(s.x, s.y);
  }

  render(scene, camera) {
    const r = this.renderer;
    this.resizeTo(r);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);

    this.mesh.material = this.down;
    this.down.uniforms.tDiffuse.value = this.rt.texture;
    r.setRenderTarget(this.small);
    r.render(this.scene, this.camera);

    this.mesh.material = this.grade;
    this.grade.uniforms.tDiffuse.value = this.rt.texture;
    this.grade.uniforms.tRegion.value = this.small.texture;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  dispose() {
    this.rt?.dispose(); this.small?.dispose();
    this.grade.dispose(); this.down.dispose(); this.quad.dispose();
  }
}

export default registerSystem({
  name: 'art',
  order: 250,

  init(app) {
    this.app = app;
    const r = app.stage?.renderer;
    this.enabled = false;
    if (!r) return;
    this.savedToneMapping = r.toneMapping;
    this.savedExposure = r.toneMappingExposure;
    const quality = app.flags?.quality ?? 'high';
    if (globalThis.__SB_NOFX) return;
    if (quality === 'low' || !r.capabilities?.isWebGL2) return;   // step aside, keep the frame
    try {
      this.fx = new PostFX(r, PROFILES.bible);
      if (!this.fx.ok) return;
      if (quality !== 'high') { this.fx.samples = 0; this.fx.build(this.fx.size.x, this.fx.size.y); }
      // §3.4 — this pass owns the output transform from here, so the film curve comes off and
      // the authored palette lands on screen at the L* the bible says it does.
      r.toneMapping = THREE.NoToneMapping;
      r.toneMappingExposure = 1.0;
      this.enabled = true;
    } catch (e) {
      this.enabled = false;
      r.toneMapping = this.savedToneMapping;
      r.toneMappingExposure = this.savedExposure;
    }
  },

  onScenario(name, app) {
    // The style sheet is an art board, not a game frame: it renders its own set and the DOM
    // scorebug steps out of the way for it. Every other scenario restores both.
    if (name !== 'style_sheet') ART.overrideView = null;
    const ui = document.getElementById('ui');
    if (ui) ui.style.visibility = name === 'style_sheet' ? 'hidden' : '';
  },

  preRender(app) {
    syncArt(app);
  },

  renderOverride(app) {
    const view = ART.overrideView;
    const scene = view?.scene ?? app.scene;
    const camera = view?.camera ?? app.camera;
    if (view?.camera) {
      const r = app.stage.renderer;
      const s = r.getDrawingBufferSize(new THREE.Vector2());
      const aspect = s.x / Math.max(1, s.y);
      if (Math.abs(camera.aspect - aspect) > 1e-3) { camera.aspect = aspect; camera.updateProjectionMatrix(); }
    }
    if (this.enabled && this.fx) {
      try {
        this.fx.render(scene, camera);
        return;
      } catch (e) {
        this.enabled = false;
        const r = app.stage.renderer;
        r.setRenderTarget(null);
        r.toneMapping = this.savedToneMapping;
        r.toneMappingExposure = this.savedExposure;
      }
    }
    app.stage.renderer.render(scene, camera);
  },

  dispose(app) {
    this.fx?.dispose();
    const r = app?.stage?.renderer;
    if (r && this.savedToneMapping !== undefined) {
      r.toneMapping = this.savedToneMapping;
      r.toneMappingExposure = this.savedExposure;
    }
  },
});

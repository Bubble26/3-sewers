import * as THREE from 'three';
import { T } from '../core/tuning.js';

/**
 * The stage: renderer, scene, camera, resize — and, since DESIGN-BIBLE §17, the physical
 * facts a camera director needs in order to do its job.
 *
 * §17 turned this game from a 3D world into a 2D STAGE with 3D actors on it. That changes two
 * things in here and nothing else:
 *
 *   1. The camera boots on the contract BATTING framing at the contract long lens, so anything
 *      that snapshots "the default camera" at init (chars/rig.js does) snapshots a legal
 *      §17 framing rather than the old 46° street camera.
 *   2. The coal haze is re-anchored in WORLD Z every frame (`syncHaze`). Fog in three.js is a
 *      view-depth ramp, so a long lens pulled 100+ units back would otherwise drag the haze
 *      forward over the cast and wash out every kid on the block. The haze belongs to the far
 *      street, not to the actors, so we keep its onset nailed to a place rather than to a
 *      distance. The authored numbers still come from world/sky.js — we only move them.
 *   3. In harness mode the BOOT frame is deferred off the document's load path (see
 *      `_deferFirstFrame`). It is a shader warm-up, not a picture anybody looks at, and every
 *      headless tool in tools/ waits on `load` with a fixed budget it was blowing.
 */

const S = T.stage;

// The pre-§17 game camera sat ~35 units of view depth from home plate, and the haze band in
// world/sky.js was authored against it. That constant is the whole conversion between the
// authored view-depth band and the world-Z band it was meant to describe.
const HAZE_REF_DEPTH = 35;
const HAZE_ANCHOR_X = 0, HAZE_ANCHOR_Y = 2.4;

const _fwd = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fc3d8);
    this.scene.fog = new THREE.Fog(0xcbd8dd, 120, 420);

    // A long lens, pulled back to suit (§17.2). The sky dome in world/sky.js has radius 760 and
    // rides with the camera, so the far plane has to clear that plus the whole pull-back.
    // §17.2 gained a FLOOR of 16° in round 2, so the boot lens is clamped into the legal band
    // as well as under the ceiling — anything that snapshots "the default camera" (chars/rig.js
    // does) then snapshots a framing the arbiter would pass.
    const F = S.framings.batting;
    this.camera = new THREE.PerspectiveCamera(
      Math.min(Math.max(F.fov, 16), S.lens.max), 16 / 9, 0.5, 1400);
    this.camera.position.set(...F.pos);
    this.camera.lookAt(...F.look);
    this.camera.updateMatrixWorld();

    this._haze = null;
    this._hazeZ = { near: 96, far: 626 };

    this.resize();
    addEventListener('resize', () => this.resize());
    if (new URLSearchParams(location.search).has('harness')) this._deferFirstFrame();
  }

  /**
   * Take the first frame off the document's load path — harness only.
   *
   * src/main.js draws one frame synchronously at the end of the boot module. Because module
   * scripts are part of the document load, that one frame lands INSIDE the `load` event, and
   * under SwiftShader the first frame of this scene links ~50 shader programs and takes about
   * twenty seconds. tools/shoot.mjs, tools/measure.mjs and tools/film.mjs all wait on
   * `page.goto(..., waitUntil:'load')` with a fixed 30 s budget, so every critic run in this
   * tree was dying on a timeout that had nothing to do with the piece being judged.
   *
   * Nothing is skipped: the first `renderer.render` is swallowed and re-issued as a full frame
   * on a task after `load`, so the same warm-up happens, one turn of the event loop later,
   * where it blocks a `waitForFunction` poll instead of the load event. The frame the tools
   * actually screenshot is always the one they ask for with `__SB.scenario()` afterwards.
   */
  _deferFirstFrame() {
    const r = this.renderer;
    const real = r.render.bind(r);
    let armed = true;
    r.render = (scene, camera) => {
      if (!armed) return real(scene, camera);
      armed = false;
      // A full re-issue, not a replay of the swallowed call: postfx may have been mid-composer
      // when we intercepted, and the whole pipeline is cheap once the programs are linked.
      const draw = () => { if (globalThis.__SB?.renderOnce) globalThis.__SB.renderOnce(); else real(scene, camera); };
      // A quarter of a second of daylight after `load`, so the tools' first `waitForFunction`
      // poll — which is also on a fixed budget — gets to see `__SB.ready` before the compile
      // seizes the main thread. Whatever arrives after that is a page.evaluate, which is not
      // on a clock.
      const arm = () => setTimeout(draw, 250);
      if (document.readyState === 'complete') arm();
      else addEventListener('load', arm, { once: true });
      return undefined;
    };
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || 1280, h = c.clientHeight || 720;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** View depth of a point on the street centreline, in the camera's current forward axis. */
  depthAtZ(z) {
    const c = this.camera;
    _fwd.set(0, 0, -1).applyQuaternion(c.quaternion);
    _p.set(HAZE_ANCHOR_X, HAZE_ANCHOR_Y, z).sub(c.position);
    return _p.dot(_fwd);
  }

  /**
   * Keep the coal-haze band standing still in the street while the camera moves.
   * Called by the camera director every frame, after it has placed the camera.
   */
  syncHaze() {
    const fog = this.scene.fog;
    if (!fog || !fog.isFog) return;
    const a = this._haze;
    if (!a || Math.abs(fog.near - a.near) > 1e-3 || Math.abs(fog.far - a.far) > 1e-3) {
      // world/sky.js has authored a band. Read it once, as world Z, and hold on to that.
      this._hazeZ = { near: fog.near - HAZE_REF_DEPTH, far: fog.far - HAZE_REF_DEPTH };
    }
    const near = Math.max(2, this.depthAtZ(this._hazeZ.near));
    const far = Math.max(near + 40, this.depthAtZ(this._hazeZ.far));
    fog.near = near;
    fog.far = far;
    this._haze = { near, far };
  }

  render() { this.renderer.render(this.scene, this.camera); }
}

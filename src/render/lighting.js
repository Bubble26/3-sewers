import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { bus } from '../core/bus.js';
import { registerScenario } from '../core/scenarios.js';
import { AIR, PAVEMENT, CHALK } from '../render/palette.js';
import { SKY, CANYON, setTimeOfDay, v3, mix } from '../world/sky.js';
import { roadHeight, GROUND } from '../world/props.js';

// The sky-light-atmosphere piece is three modules and one line in modules.js.
// lighting.js is the entry point, so it pulls its two siblings in with it.
import '../world/sky.js';
import '../world/atmosphere.js';

/* =============================================================================
 * LIGHTING — key, fill, bounce, and the canyon's own shadow
 * -----------------------------------------------------------------------------
 * The block's architecture is baked (world/facade.js authors its own light into
 * vertex colours) but everything that MOVES — nine kids, the ball, the props,
 * the pushcarts, the ice wagon — is lit for real, and so is the roadway they
 * stand on.  So this rig has to do four jobs:
 *
 *   KEY      one sun, 33° up, behind the camera's right shoulder. It casts, and
 *            the only other things in the shadow map are two invisible proxy
 *            boxes standing where the south building line stands: the 16ft
 *            corner taxpayer and the 62ft tenement row behind it. That single
 *            trick is what throws the hard diagonal across the pavement, puts
 *            home plate in sun, and drops the far half of the block into cool
 *            shade — all of it from the same geometry facade.js baked.
 *
 *   FILL     a hemisphere: cool skylight down the canyon slot above, warm
 *            roadway bounce from below. Never under 60% of key, which is what
 *            keeps a shadowed kid readable and stops the street reading grim.
 *
 *   BOUNCE   a warm directional off the sunlit north facade, aimed back across
 *            the street into the shade side. This is the single cheapest thing
 *            that makes the block read as a canyon rather than a diorama.
 *
 *   BALL KEY a light on a private layer that nothing but the ball can see, held
 *            on the camera-to-ball axis. The design bible's hardest single
 *            requirement is that the ball is never lost against pavement or
 *            brick; this guarantees the body value from any angle, in any
 *            shadow, at any time of day, without touching the ball's own module.
 *
 * On top of the lights sits the CANYON WASH: an unlit, un-tone-mapped colour
 * wash on the roadway and both facades that carries the *hue* of the light —
 * warm where the sun lands, blue-violet skylight where it does not. The bible
 * is explicit that the sun band is a colour event and not an exposure event, so
 * value comes from the shadow map and colour comes from here.
 * ========================================================================== */

const FADE_START = 150, FADE_END = 470;

/* ─── the wash shader ──────────────────────────────────────────────────────── */

const WASH_VERT = /* glsl */`
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WASH_FRAG = /* glsl */`
precision mediump float;
uniform vec2 uH;            // horizontal unit vector toward the sun
uniform float uRise;        // tan(sun altitude)
uniform vec3 uSunCol, uShdCol;
uniform vec2 uAmt;          // (alpha in sun, alpha in shade)
uniform vec2 uFar;          // (extra shade alpha far off, where the shadow map ends)
uniform vec3 uCam;
uniform float uForceShade;  // 1 on a wall the sun can never reach
uniform vec4 uWall;         // facadeX, taxZ0, taxZ1, taxH
uniform float uWallH;
varying vec3 vW;

void main() {
  float dist = length(vW - uCam);
  float d = (vW.x + uWall.x) / max(-uH.x, 1e-4);
  float zh = vW.z + uH.y * d;
  float yh = vW.y + uRise * d;
  // the south building line: nothing, then a one-storey taxpayer, then the row
  float h = mix(0.0, uWall.w, smoothstep(uWall.y - 0.30, uWall.y + 0.30, zh));
  h = mix(h, uWallH, smoothstep(uWall.z - 0.12, uWall.z + 0.12, zh));
  // a terminator that stays two or three pixels wide wherever it is on screen
  float soft = clamp(dist * 0.0026, 0.05, 1.1);
  float occ = clamp((yh - h) / soft + 0.5, 0.0, 1.0);
  occ *= 1.0 - uForceShade;

  // near the camera the shadow map owns the VALUE and this wash only carries
  // hue; past the shadow camera's reach the wash takes the value back over.
  float beyond = smoothstep(uFar.x, uFar.y, dist);
  vec3 col = mix(uShdCol, uSunCol, occ);
  float a = mix(mix(uAmt.y, 0.62, beyond), uAmt.x, occ);
  a *= 1.0 - smoothstep(${FADE_START.toFixed(1)}, ${FADE_END.toFixed(1)}, dist);
  gl_FragColor = vec4(col, a);
}`;

function washMaterial(forceShade = 0) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    vertexShader: WASH_VERT, fragmentShader: WASH_FRAG,
    uniforms: {
      uH: { value: new THREE.Vector2(SKY.h[0], SKY.h[1]) },
      uRise: { value: SKY.rise },
      uSunCol: { value: v3(0xffffff) },
      uShdCol: { value: v3(0x808080) },
      uAmt: { value: new THREE.Vector2(0.16, 0.30) },
      uCam: { value: new THREE.Vector3() },
      uForceShade: { value: forceShade },
      uFar: { value: new THREE.Vector2(165, 275) },
      uWall: { value: new THREE.Vector4(CANYON.facadeX, CANYON.taxZ0, CANYON.taxZ1, CANYON.taxH) },
      uWallH: { value: CANYON.wallH },
    },
  });
}

/* ─── the roadway wash: a crowned sheet lying on the paving ────────────────── */

function groundWashMesh(mat) {
  const X0 = -33.2, X1 = 33.2, Z0 = -62, Z1 = 190;
  const NX = 62, NZ = 74;
  const pos = [], idx = [];
  for (let j = 0; j <= NZ; j++) {
    const z = Z0 + (Z1 - Z0) * (j / NZ);
    for (let i = 0; i <= NX; i++) {
      const x = X0 + (X1 - X0) * (i / NX);
      pos.push(x, roadHeight(x) + 0.022, z);
    }
  }
  const W = NX + 1;
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.name = 'light:groundWash';
  m.renderOrder = -6;
  m.matrixAutoUpdate = false;
  return m;
}

/* ─── the facade washes: one quad per lot, so they hug the real skyline ────── */

function facadeWashMesh(mat, lots, side, name) {
  const pos = [], idx = [];
  const x = side * (CANYON.facadeX - 0.16);
  const put = (z0, z1, top) => {
    const n = pos.length / 3;
    pos.push(x, 0.2, z0, x, 0.2, z1, x, top, z1, x, top, z0);
    idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
  };
  if (lots && lots.length) {
    for (const lot of lots) {
      if (Math.sign(lot.xf) !== side) continue;
      const top = 12 + (lot.storeys - 1) * 10.5 + 3.2 + 2.4;    // facade.js buildingTop()
      put(lot.z0 - 0.1, lot.z0 + 25.1, top);
    }
  }
  if (!pos.length) put(side > 0 ? -15 : 5, side > 0 ? 190 : 210, 70);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.renderOrder = -5;
  m.matrixAutoUpdate = false;
  return m;
}

/* ─── invisible proxies for the two things that shadow this street ─────────── */

function shadowProxies() {
  const grp = new THREE.Group();
  grp.name = 'light:canyonProxy';
  const invisible = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  const box = (x0, y0, z0, x1, y1, z1) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), invisible);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    m.castShadow = true;
    m.receiveShadow = false;
    m.renderOrder = -2000;
    grp.add(m);
    return m;
  };
  // the 62ft tenement row on the south side, and the 16ft corner taxpayer that
  // is the entire reason home plate has sun on it at ten of four.
  box(-CANYON.facadeX - 9, 0, CANYON.taxZ1, -CANYON.facadeX, CANYON.wallH, 78);
  box(-CANYON.facadeX - 9, 0, CANYON.taxZ0, -CANYON.facadeX, CANYON.taxH, CANYON.taxZ1);
  return grp;
}

/* ─── legacy entry point, kept so nothing that imported it breaks ──────────── */
export function buildLighting(scene) {
  const rig = new Rig(scene);
  return { hemi: rig.hemi, sun: rig.key, bounce: rig.bounce, rig };
}

class Rig {
  constructor(scene) {
    this.scene = scene;

    this.key = new THREE.DirectionalLight(0xffffff, 1.7);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    const d = 95;
    const cam = this.key.shadow.camera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 20; cam.far = 420;
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.09;
    this.keyTarget = new THREE.Object3D();
    this.keyTarget.position.set(-2, 6, 22);       // centred on the play plane
    scene.add(this.keyTarget);
    this.key.target = this.keyTarget;
    this.key.name = 'light:key';
    scene.add(this.key);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.2);
    this.hemi.name = 'light:fill';
    scene.add(this.hemi);

    this.bounce = new THREE.DirectionalLight(0xffffff, 0.4);
    this.bounce.name = 'light:bounce';
    this.bounceTarget = new THREE.Object3D();
    this.bounceTarget.position.set(-30, 3, 24);
    scene.add(this.bounceTarget);
    this.bounce.target = this.bounceTarget;
    scene.add(this.bounce);

    this.amb = new THREE.AmbientLight(0xffffff, 0.25);
    this.amb.name = 'light:ambient';
    scene.add(this.amb);

    // the ball's private rig — layer 10, seen by nothing else in the world
    this.ballKey = new THREE.DirectionalLight(0xffffff, 1.5);
    this.ballKey.layers.set(10);
    this.ballKey.name = 'light:ballKey';
    this.ballTarget = new THREE.Object3D();
    scene.add(this.ballTarget);
    this.ballKey.target = this.ballTarget;
    scene.add(this.ballKey);
    this.ballRim = new THREE.DirectionalLight(0xffffff, 0.9);
    this.ballRim.layers.set(10);
    this.ballRim.target = this.ballTarget;
    this.ballRim.name = 'light:ballRim';
    scene.add(this.ballRim);

    scene.add(shadowProxies());
  }

  place() {
    const D = SKY.dir;
    const t = this.keyTarget.position;
    this.key.position.set(t.x + D.x * 190, t.y + D.y * 190, t.z + D.z * 190);
    this.key.updateMatrixWorld();
    // the bounce comes off the sunlit north facade, so it lives over there and
    // points back across the roadway into the shade side.
    this.bounce.position.set(30, 26, 8);
  }

  apply(P) {
    const R = P.rig;
    this.key.color.setHex(R.keyHex, THREE.SRGBColorSpace);
    this.key.intensity = R.keyI;
    this.hemi.color.setHex(R.skyHex, THREE.SRGBColorSpace);
    this.hemi.groundColor.setHex(R.groundHex, THREE.SRGBColorSpace);
    this.hemi.intensity = R.hemiI;
    this.bounce.color.setHex(R.bounceHex, THREE.SRGBColorSpace);
    this.bounce.intensity = R.bounceI;
    this.amb.color.setHex(R.ambHex, THREE.SRGBColorSpace);
    this.amb.intensity = R.ambI;
    this.ballKey.color.setHex(R.keyHex, THREE.SRGBColorSpace);
    this.ballRim.color.setHex(mix(R.skyHex, CHALK, 0.5), THREE.SRGBColorSpace);
    this.place();
  }
}

/* ─── shadow-caster policy ─────────────────────────────────────────────────── */
/**
 * Nothing in the repo asks to cast a shadow, because casting is a lighting
 * decision and not a modelling one. So the rig makes it, once, by rule:
 * anything lit, opaque, small enough to be an object rather than a surface, and
 * not part of the baked architecture, casts. Outline shells (back-face) and
 * painted contact ellipses never do.
 */
function markCasters(app) {
  const skip = new Set();
  const street = app.get('street');
  if (street && street.group) street.group.traverse((o) => skip.add(o));
  let n = 0;
  app.scene.traverse((o) => {
    if (!o.isMesh || o.userData.__lit) return;
    o.userData.__lit = 1;
    if (skip.has(o) || o.name === 'contactShadow') return;
    const m = o.material;
    if (!m || Array.isArray(m)) return;
    if (m.transparent || m.side === THREE.BackSide || m.colorWrite === false) return;
    if (m.isMeshBasicMaterial) return;                    // baked, unlit, not ours to shade
    const g = o.geometry;
    if (!g) return;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const s = o.getWorldScale(new THREE.Vector3());
    const r = (g.boundingSphere ? g.boundingSphere.radius : 1) * Math.max(s.x, s.y, s.z);
    if (r > 24) { o.receiveShadow = true; return; }        // a surface, not an object
    o.castShadow = true;
    // deliberately NOT receiving: a toon character self-shadowing at a grazing
    // 33 degrees is all acne and no information. Grounding comes from the cast
    // shadow on the roadway and from the painted contact ellipse.
    if (r > 5) o.receiveShadow = true;
    n++;
  });
  return n;
}

/* ─── the system ───────────────────────────────────────────────────────────── */

export default registerSystem({
  name: 'lighting',
  order: 15,

  init(app) {
    this.rig = new Rig(app.scene);
    Object.assign(this, { hemi: this.rig.hemi, sun: this.rig.key, bounce: this.rig.bounce });

    this.groundMat = washMaterial(0);
    this.northMat = washMaterial(0);
    this.southMat = washMaterial(1);
    const lots = app.get('street')?.lots;
    app.scene.add(groundWashMesh(this.groundMat));
    app.scene.add(facadeWashMesh(this.northMat, lots, 1, 'light:northWash'));
    app.scene.add(facadeWashMesh(this.southMat, lots, -1, 'light:southWash'));

    this.apply(SKY.P);
    bus.on('tod', ({ preset }) => this.apply(preset));
    app.lighting = this;
    this.swept = 0;
  },

  apply(P) {
    this.rig.apply(P);
    const W = P.wash;
    const set = (m, sun, shd, a) => {
      const u = m.uniforms;
      u.uH.value.set(SKY.h[0], SKY.h[1]);
      u.uRise.value = SKY.rise;
      u.uSunCol.value.copy(v3(sun));
      u.uShdCol.value.copy(v3(shd));
      u.uAmt.value.set(a[0], a[1]);
    };
    set(this.groundMat, W.sunCol, W.shdCol, [W.sunA, W.shdA]);
    set(this.northMat, W.wallSunCol, W.wallShdCol, [W.wallSunA, W.wallShdA]);
    set(this.southMat, W.wallSunCol, W.wallShdCol, [W.wallShdA, W.wallShdA]);
  },

  onScenario(name, app) {
    setTimeOfDay(name === 'golden_hour' ? 'golden' : 'afternoon');
    this.swept = 0;
    if (name === 'golden_hour') {
      app.camera.fov = 44;
      app.camera.updateProjectionMatrix();
      app.camera.position.set(4.5, 9.0, -30);
      app.camera.lookAt(-1, 9.5, 40);
    }
  },

  preRender(app) {
    if (this.swept < 2) { this.swept++; markCasters(app); }
    const c = app.camera.position;
    this.groundMat.uniforms.uCam.value.copy(c);
    this.northMat.uniforms.uCam.value.copy(c);
    this.southMat.uniforms.uCam.value.copy(c);

    // hold the ball's private key on the camera-to-ball axis so the lit face is
    // always the face we can see. The ball is the brightest object in frame, at
    // every point of every flight — that is the one rule with no exceptions.
    const bv = app.get('ballview');
    const mesh = bv && bv.mesh;
    if (mesh) {
      if (!mesh.userData.__ballLayer) { mesh.layers.enable(10); mesh.userData.__ballLayer = 1; }
      const p = mesh.position;
      this.rig.ballTarget.position.copy(p);
      this.rig.ballTarget.updateMatrixWorld();
      const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      this.rig.ballKey.position.set(p.x + (dx / L) * 26 + 4, p.y + (dy / L) * 26 + 14, p.z + (dz / L) * 26);
      this.rig.ballRim.position.set(p.x + SKY.dir.x * 30, p.y + SKY.dir.y * 30 + 6, p.z + SKY.dir.z * 30);
      this.rig.ballKey.updateMatrixWorld();
      this.rig.ballRim.updateMatrixWorld();
    }
  },
});

/* ─── scenario ─────────────────────────────────────────────────────────────── */

registerScenario('golden_hour', {
  seed: 1925,
  setup: ({ app }) => {
    app.sim.reset(1925);
    app.clock.advance(0.55);
    app.camera.fov = 44;
    app.camera.updateProjectionMatrix();
    app.camera.position.set(4.5, 9.0, -30);
    app.camera.lookAt(-1, 9.5, 40);
  },
  settle: 0.5,
});

void PAVEMENT; void AIR; void GROUND;

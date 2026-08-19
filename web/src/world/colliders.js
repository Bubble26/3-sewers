import * as THREE from 'three';

/**
 * The collidable world, as seen by the ball.
 *
 * World pieces (architecture, props, vehicles) register what the ball can hit and what it
 * sounds and behaves like when it does. The ball-physics piece queries this and never needs
 * to know how the street was built — which is what lets those pieces be built in parallel.
 *
 *   registerCollider({ name: 'fire-escape-3', box, surface: 'iron', scoring: 'foul' });
 *
 * Surfaces come from SURFACES below; each carries the restitution, friction and the event
 * name the audio and fx systems listen for. `scoring` is optional and is how street rules
 * find out that a ball hit something that matters: 'foul' | 'sewer' | 'window' | 'car' | 'roof'.
 */

export const SURFACES = {
  asphalt: { restitution: 0.52, friction: 0.42, sfx: 'bounce_asphalt' },
  belgian: { restitution: 0.46, friction: 0.55, sfx: 'bounce_stone' },
  brick: { restitution: 0.58, friction: 0.30, sfx: 'bounce_brick' },
  iron: { restitution: 0.44, friction: 0.22, sfx: 'clang_iron' },      // fire escapes, railings, hydrant
  wood: { restitution: 0.40, friction: 0.45, sfx: 'thud_wood' },       // crates, stoop rail, cart
  glass: { restitution: 0.20, friction: 0.35, sfx: 'window_break' },   // windows: usually a story, not a bounce
  cloth: { restitution: 0.12, friction: 0.80, sfx: 'flap_cloth' },     // laundry: kills the ball dead
  tin: { restitution: 0.50, friction: 0.30, sfx: 'clatter_tin' },      // ash cans, awning frames, signs
  car: { restitution: 0.48, friction: 0.35, sfx: 'thunk_fender' },
  sewer: { restitution: 0.0, friction: 1.0, sfx: 'sewer_swallow' },    // the ball is gone
};

const colliders = [];
const _box = new THREE.Box3();

export function registerCollider(def) {
  if (!def.box) throw new Error('collider needs a Box3');
  if (!SURFACES[def.surface]) throw new Error(`unknown surface "${def.surface}"`);
  colliders.push({ scoring: null, ...def });
  return def;
}

/** Convenience: register a mesh's world-space bounds. Call after the mesh is positioned. */
export function registerMesh(mesh, surface, extra = {}) {
  mesh.updateWorldMatrix(true, false);
  const box = new THREE.Box3().setFromObject(mesh);
  return registerCollider({ name: mesh.name || 'mesh', box, surface, object: mesh, ...extra });
}

/** Tag-and-forget: anything in the scene with userData.surface gets picked up. */
export function harvestTaggedMeshes(scene) {
  let found = 0;
  scene.traverse((o) => {
    if (o.isMesh && o.userData?.surface && SURFACES[o.userData.surface] && !o.userData._collider) {
      o.userData._collider = registerMesh(o, o.userData.surface, { scoring: o.userData.scoring ?? null });
      found++;
    }
  });
  return found;
}

export function allColliders() { return colliders; }
export function clearColliders() { colliders.length = 0; }

/**
 * Sphere sweep against every collider. Returns the first hit as
 * { collider, surface, normal, point, t } or null.
 */
export function sweepSphere(from, to, radius) {
  let best = null;
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 1e-6) return null;
  dir.divideScalar(len);

  for (const c of colliders) {
    _box.copy(c.box).expandByScalar(radius);
    const hit = rayBox(from, dir, _box);
    if (hit === null || hit > len) continue;
    if (best && hit >= best.t) continue;
    const point = from.clone().addScaledVector(dir, hit);
    best = { collider: c, surface: SURFACES[c.surface], surfaceName: c.surface, scoring: c.scoring, point, t: hit, normal: boxNormal(point, c.box) };
  }
  return best;
}

function rayBox(origin, dir, box) {
  let tmin = 0, tmax = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    const inv = 1 / (dir[axis] || 1e-12);
    let t1 = (box.min[axis] - origin[axis]) * inv;
    let t2 = (box.max[axis] - origin[axis]) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }
  return tmin;
}

function boxNormal(point, box) {
  const c = box.getCenter(new THREE.Vector3());
  const d = point.clone().sub(c);
  const e = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const bias = 1.0001;
  const nx = d.x / (e.x || 1e-6), ny = d.y / (e.y || 1e-6), nz = d.z / (e.z || 1e-6);
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ax > ay && ax > az) return new THREE.Vector3(Math.sign(nx) * bias, 0, 0).normalize();
  if (ay > az) return new THREE.Vector3(0, Math.sign(ny) * bias, 0).normalize();
  return new THREE.Vector3(0, 0, Math.sign(nz) * bias).normalize();
}

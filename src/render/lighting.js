import * as THREE from 'three';

// Late-afternoon September light down a Manhattan side street.
export function buildLighting(scene) {
  const hemi = new THREE.HemisphereLight(0xdfeaf2, 0x6b5a49, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe9c4, 2.1);
  sun.position.set(-70, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 90;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  const bounce = new THREE.DirectionalLight(0xa8c4d8, 0.35);
  bounce.position.set(50, 20, -40);
  scene.add(bounce);
  return { hemi, sun, bounce };
}

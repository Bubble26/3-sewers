import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { T } from '../core/tuning.js';

// The block: asphalt, curbs, sidewalks, tenement facades either side.
// Owned by the street-architecture piece.
export function buildStreet(scene) {
  const group = new THREE.Group();
  group.name = 'street';

  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(44, 340),
    new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.95 })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, 60);
  road.receiveShadow = true;
  group.add(road);

  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(
      new THREE.BoxGeometry(10, 0.55, 340),
      new THREE.MeshStandardMaterial({ color: 0x8d8577, roughness: 0.9 })
    );
    walk.position.set(side * 27, 0.27, 60);
    walk.receiveShadow = true;
    group.add(walk);

    for (let i = 0; i < 7; i++) {
      const h = 46 + (i % 3) * 9;
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(30, h, 44),
        new THREE.MeshStandardMaterial({ color: i % 2 ? 0x8c4a34 : 0x9c5a3c, roughness: 0.95 })
      );
      b.position.set(side * 47, h / 2, -20 + i * 46);
      b.castShadow = true; b.receiveShadow = true;
      group.add(b);
    }
  }

  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 24),
    new THREE.MeshStandardMaterial({ color: 0x3a3833, roughness: 0.8, metalness: 0.35 })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(0, 0.02, T.street.plateZ);
  plate.receiveShadow = true;
  group.add(plate);

  scene.add(group);
  return group;
}

export default registerSystem({
  name: 'street',
  order: 10,
  init(app) { this.group = buildStreet(app.scene); },
});

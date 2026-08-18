import * as THREE from 'three';

// Big-head, small-body proportions in the Backyard Baseball spirit.
export function buildKid({ skin = 0xe8b48c, shirt = 0xc94f3d, pants = 0x3d4a63, cap = 0x2b3a55 } = {}) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 0.9, 6, 12), mat(shirt));
  torso.position.y = 2.35; torso.castShadow = true; g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 18), mat(skin));
  head.position.y = 3.9; head.castShadow = true; g.add(head);
  g.userData.head = head;

  const capMesh = new THREE.Mesh(new THREE.SphereGeometry(1.08, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(cap));
  capMesh.position.y = 3.95; head.add(capMesh); capMesh.position.set(0, 0.05, 0);

  const limb = (x, y, len, c) => {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, len, 4, 8), mat(c));
    m.position.set(x, y, 0); m.castShadow = true; g.add(m); return m;
  };
  g.userData.armL = limb(-0.8, 2.4, 0.9, skin);
  g.userData.armR = limb(0.8, 2.4, 0.9, skin);
  g.userData.legL = limb(-0.32, 1.05, 1.1, pants);
  g.userData.legR = limb(0.32, 1.05, 1.1, pants);
  return g;
}

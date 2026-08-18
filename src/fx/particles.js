import * as THREE from 'three';

// Cheap pooled dust puffs for slides, contact and bounces.
export class Puffs {
  constructor(scene, count = 120) {
    this.geo = new THREE.SphereGeometry(0.35, 6, 5);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xd8cfbd, transparent: true, opacity: 0.85 });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.items = Array.from({ length: count }, () => ({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), scale: 1 }));
    this.dummy = new THREE.Object3D();
  }
  burst(pos, n = 8, power = 3) {
    let spawned = 0;
    for (const it of this.items) {
      if (it.life > 0) continue;
      it.life = 0.6 + Math.random() * 0.3;
      it.pos.copy(pos);
      it.vel.set((Math.random() - 0.5) * power, Math.random() * power * 0.7, (Math.random() - 0.5) * power);
      it.scale = 0.5 + Math.random() * 0.8;
      if (++spawned >= n) break;
    }
  }
  update(dt) {
    let i = 0;
    for (const it of this.items) {
      if (it.life > 0) {
        it.life -= dt;
        it.vel.y -= 4 * dt;
        it.pos.addScaledVector(it.vel, dt);
        this.dummy.position.copy(it.pos);
        this.dummy.scale.setScalar(Math.max(0.001, it.scale * it.life));
      } else {
        this.dummy.position.set(0, -999, 0);
        this.dummy.scale.setScalar(0.001);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i++, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

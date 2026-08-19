import * as THREE from 'three';
import { registerSystem } from '../app.js';
import { T } from '../core/tuning.js';

// Visual proxy for the simulated ball. Owned by the ball-physics piece.
export default registerSystem({
  name: 'ballview',
  order: 30,
  init(app) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(T.ball.radius, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xf2ead6, roughness: 0.7 })
    );
    this.mesh.castShadow = true;
    app.scene.add(this.mesh);
  },
  lateUpdate(dt, app) {
    this.mesh.position.copy(app.sim.ball.pos);
    this.mesh.visible = app.sim.ball.live || app.sim.ball.inFlight;
  },
});

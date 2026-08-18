import { registerSystem } from '../app.js';
import { buildKid } from './rig.js';
import { ROSTER } from './roster.js';
import { T } from '../core/tuning.js';

// Places the nine-ish bodies on the street. Owned by the character-art piece;
// animation is layered on top by src/chars/anim.js.
export default registerSystem({
  name: 'players',
  order: 20,
  init(app) {
    this.batter = buildKid(ROSTER[0].colors);
    this.batter.position.set(-2.2, 0, T.street.plateZ - 0.6);
    app.scene.add(this.batter);

    this.pitcher = buildKid(ROSTER[1].colors);
    this.pitcher.position.set(0, 0, T.street.moundZ);
    this.pitcher.rotation.y = Math.PI;
    app.scene.add(this.pitcher);

    this.fielders = [];
    for (let i = 0; i < 4; i++) {
      const f = buildKid(ROSTER[(i + 2) % ROSTER.length].colors);
      f.position.set(-16 + i * 11, 0, 78 + (i % 2) * 24);
      f.rotation.y = Math.PI;
      app.scene.add(f);
      this.fielders.push(f);
    }
  },
});

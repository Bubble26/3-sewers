import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { buildKid } from './rig.js';
import { ROSTER } from './roster.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { registerScenario } from '../core/scenarios.js';
import { CHALK } from '../render/palette.js';
import { bindRig, attachStick, Animator, Trail } from './anim.js';
import { CLIPS, FIDGETS, IDLES } from './clips.js';

/**
 * Everybody on the block: where they stand, what they are doing, and why.
 *
 * The rule this file exists to enforce is that the animation always agrees with the game.
 * Nothing here decides anything — it listens to src/core/bus.js and moves bodies to match.
 * Where a gameplay slot is still empty (fielding and baserunning, at time of writing) the
 * kids fall back to a purely visual reaction so the street is never dead, and the moment a
 * real slot shows up it is preferred: see `fielderTargets()` and `runnerTargets()`.
 */

// A private RNG so fidget timers never touch the sim's deterministic draw order.
const arng = new RNG(4711);

const BASES = [
  { x: 18, z: T.street.plateZ + 28 },
  { x: 0, z: T.street.plateZ + 56 },
  { x: -18, z: T.street.plateZ + 28 },
];
const HOME = { x: 0, z: T.street.plateZ };
const PLATE_BOX = { x: 2.5, z: T.street.plateZ - 0.4 };

// Nine on defence, spread up a street rather than around a diamond.
const POSTS = [
  { id: 'catcher', x: 0, z: T.street.plateZ - 5.2, clip: 'crouch', face: 0 },
  { id: 'pitcher', x: 0, z: T.street.moundZ, clip: 'pitch_set', face: Math.PI },
  { id: 'first', x: 17, z: 33 },
  { id: 'short', x: 8, z: 64 },
  { id: 'third', x: -17, z: 33 },
  { id: 'left', x: -15, z: 97 },
  { id: 'center', x: 1, z: 118 },
  { id: 'right', x: 16, z: 94 },
];

// ── one kid ─────────────────────────────────────────────────────────────────
class Kid {
  constructor(scene, index, opts = {}) {
    this.index = index;
    this.group = buildKid({ spec: index });
    this.spec = this.group.userData.spec || {};
    this.name = this.spec.name || `kid${index}`;
    this.rig = bindRig(this.group);
    this.scale = this.rig.posScale;
    this.anim = new Animator(this.rig, CLIPS);
    scene.add(this.group);

    this.pos = new THREE.Vector2(0, 0);
    this.face = 0; this.faceGoal = 0;
    this.speed = 0; this.maxSpeed = T.run.speed;
    this.target = null; this.arrive = null; this.hardStop = false;
    this.runDist = arng.range(0, 5);
    this.state = 'idle';
    this.lock = 0;                       // seconds a one-shot owns the body
    this.idleClip = IDLES[index % IDLES.length];
    // three character-specific fidgets per kid, never the same trio twice
    this.fidgets = [FIDGETS[index % FIDGETS.length], FIDGETS[(index * 3 + 2) % FIDGETS.length], FIDGETS[(index * 5 + 5) % FIDGETS.length]];
    this.fidgetIn = arng.range(0.6, 4.2);
    this.cycle = null; this.cycleT = 0; this.cycleStep = -1;
    this.anim.play(this.idleClip, { at: arng.range(0, 3) });
    if (opts.stick) this.giveStick();
    this.group.userData.kid = this;
  }

  giveStick() {
    if (this.stick) return;
    this.stick = attachStick(this.rig, {});
    this.trail = new Trail(this.group, { samples: 14, color: CHALK });
    this._tipA = new THREE.Vector3(); this._tipB = new THREE.Vector3(); this._prevTip = new THREE.Vector3();
  }
  showStick(v) { if (this.rig.get('stick')) this.rig.get('stick').visible = v; if (this.trail && !v) this.trail.clear(); }

  at(x, z, face) {
    this.pos.set(x, z);
    this.group.position.set(x, 0, z);
    if (face !== undefined) { this.face = face; this.faceGoal = face; this.group.rotation.y = face; }
    this.target = null; this.speed = 0;
    this.rig.resetSprings();
    return this;
  }
  lookAt(x, z) { this.faceGoal = Math.atan2(x - this.pos.x, z - this.pos.y); return this; }
  snapFacing() { this.face = this.faceGoal; this.group.rotation.y = this.face; return this; }

  goTo(x, z, o = {}) {
    this.target = new THREE.Vector2(x, z);
    this.maxSpeed = o.speed || T.run.speed;
    this.hardStop = !!o.hard;
    this.arrive = o.onArrive || null;
    this.gait = o.gait || 'run';
    this.state = 'run';
    return this;
  }

  /** Play a one-shot that owns the body for `lock` seconds. */
  act(name, o = {}) {
    const cl = CLIPS[name];
    if (!cl) return;
    this.anim.play(name, { fade: o.fade === undefined ? 0.1 : o.fade, restart: true, speed: o.speed || 1 });
    this.state = o.state || 'act';
    this.lock = (o.lock === undefined ? cl.dur / (o.speed || 1) : o.lock);
    this.after = o.after || null;
  }
  /** Additive layer on top of whatever is playing. */
  flavour(name, o) { this.anim.once(name, o); }

  setCycle(period, steps, offset = 0) {
    this.cycle = { period, steps };
    this.cycleT = ((offset % period) + period) % period;
    this.cycleStep = -1;
    return this;
  }

  setLook() { /* the rig bakes each kid's colours into merged geometry; identity is per-kid, not per-tint */ }

  update(dt) {
    if (this.cycle) {
      this.cycleT += dt;
      if (this.cycleT >= this.cycle.period) this.cycleT -= this.cycle.period;
      const steps = this.cycle.steps;
      let idx = 0;
      for (let i = 0; i < steps.length; i++) if (this.cycleT >= steps[i].t) idx = i;
      if (idx !== this.cycleStep) { this.cycleStep = idx; steps[idx].do(this); }
    }

    if (this.lock > 0) {
      this.lock -= dt;
      if (this.lock <= 0) { const a = this.after; this.after = null; this.state = 'idle'; if (a) a(this); }
    }

    // ── steering ────────────────────────────────────────────────────────────
    if (this.target) {
      const dx = this.target.x - this.pos.x, dz = this.target.y - this.pos.y;
      const dist = Math.hypot(dx, dz);
      const brake = this.hardStop ? 0.6 : (this.speed * this.speed) / (2 * T.run.accel * 1.15) + 0.5;
      const want = dist <= brake ? (this.hardStop ? this.maxSpeed : 0) : this.maxSpeed;
      const a = T.run.accel * (want > this.speed ? 1 : 1.9);
      this.speed += THREE.MathUtils.clamp(want - this.speed, -a * dt, a * dt);
      if (dist > 0.05) {
        const step = Math.min(this.speed * dt, dist);
        this.pos.x += (dx / dist) * step;
        this.pos.y += (dz / dist) * step;
        this.faceGoal = Math.atan2(dx, dz);
      }
      if (dist <= Math.max(0.35, this.speed * dt * 1.2)) {
        this.target = null;
        const cb = this.arrive; this.arrive = null;
        if (this.hardStop && this.speed > 7) {
          this.act('run_stop', { state: 'stop' });
          if (APP.puffs) APP.puffs.burst(new THREE.Vector3(this.pos.x, 0.15, this.pos.y), 6, 2.4);
        }
        this.speed = 0;
        if (cb) cb(this);
      }
    } else if (this.speed > 0) {
      this.speed = Math.max(0, this.speed - T.run.accel * 2 * dt);
    }

    this.group.position.set(this.pos.x, 0, this.pos.y);
    let d = this.faceGoal - this.face;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.face += THREE.MathUtils.clamp(d, -9 * dt, 9 * dt);
    this.group.rotation.y = this.face;

    // ── clip selection ──────────────────────────────────────────────────────
    const moving = this.speed > 0.6;
    if (moving && this.lock <= 0) {
      const gait = this.gait === 'trot' ? 'trot' : 'run';
      const cl = CLIPS[gait];
      this.runDist += this.speed * dt;
      this.anim.play(gait, { fade: 0.12 });
      this.anim.t = (this.runDist / ((cl.meta.stride || 5.4) * this.scale)) % 1 * cl.dur;
      const eff = THREE.MathUtils.clamp(1 - this.speed / this.maxSpeed, 0, 1);
      if (gait === 'run' && eff > 0.05) {
        if (!this._drive) this._drive = this.anim.once('run_drive', { life: 1e6, in: 0.08, out: 0.1, amp: eff });
        this._drive.amp = eff * 0.9;
        this._drive.t = 0.5;
      } else if (this._drive) { this._drive.life = 0; this._drive = null; }
      this.fidgetIn = arng.range(1.6, 5.0);
    } else {
      if (this._drive) { this._drive.life = 0; this._drive = null; }
      if (this.lock <= 0 && !this.cycle && (this.state === 'idle' || this.state === 'run')) {
        this.state = 'idle';
        this.anim.play(this.restClip || this.idleClip, { fade: 0.2 });
      }
      // idle fidgets on a randomised timer — never two kids in the same pose
      if (this.lock <= 0 && this.state === 'idle' && !this.cycle) {
        this.fidgetIn -= dt;
        if (this.fidgetIn <= 0) {
          this.fidgetIn = arng.range(2.6, 6.4);
          this.flavour(arng.pick(this.fidgets), { amp: arng.range(0.8, 1) });
        }
      }
    }

    this.anim.update(dt);
    this.group.updateMatrixWorld(true);
    this.rig.solveHands();
    this.group.updateMatrixWorld(true);
    this.rig.updateSecondary(dt);
    this.updateTrail(dt);
  }

  updateTrail(dt) {
    if (!this.trail) return;
    const tip = this.rig.get('stickTip');
    const stick = this.rig.get('stick');
    if (!tip || !stick || !stick.visible) { this.trail.clear(); return; }
    const len = (this.rig.stickLength || 3.3) * 0.5;
    this._tipA.set(0, len * 0.15, 0).applyMatrix4(tip.matrixWorld);
    this._tipB.set(0, len, 0).applyMatrix4(tip.matrixWorld);
    const v = this._tipB.distanceTo(this._prevTip) / Math.max(dt, 1e-4);
    this._prevTip.copy(this._tipB);
    this.trail.push(this._tipA, this._tipB, THREE.MathUtils.clamp((v - 26) / 60, 0, 1));
    this.trail.update();
  }
}

// ── chalk on the road ───────────────────────────────────────────────────────
function chalkMarks(scene) {
  if (scene.getObjectByName('chalk_bases')) return null;
  const g = new THREE.Group();
  g.name = 'chalk_bases';
  const mat = new THREE.MeshBasicMaterial({ color: CHALK, transparent: true, opacity: 0.72, depthWrite: false });
  const ring = (x, z, r, w) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r - w, r, 4, 1), mat);
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.PI / 4;
    m.position.set(x, 0.03, z);
    m.renderOrder = 1;
    g.add(m);
  };
  for (const b of BASES) ring(b.x, b.z, 2.3, 0.34);
  ring(HOME.x, HOME.z, 2.6, 0.36);
  scene.add(g);
  return g;
}

// ── the system ──────────────────────────────────────────────────────────────
const _v = new THREE.Vector3();

export default registerSystem({
  name: 'players',
  order: 20,

  init(app) {
    this.kids = [];
    this.mode = 'game';
    this.hitstop = 0;
    this.scriptT = 0;
    this.script = null;

    const mk = (i, opts) => { const k = new Kid(app.scene, i, opts); this.kids.push(k); return k; };

    // defence
    this.fielders = POSTS.map((p, i) => {
      const k = mk(i + 2);
      k.post = p;
      k.restClip = p.clip || 'ready';
      k.at(p.x, p.z, p.face === undefined ? Math.PI : p.face);
      if (p.clip) k.anim.play(p.clip, { at: arng.range(0, 2) });
      return k;
    });
    this.catcher = this.fielders[0];
    this.pitcher = this.fielders[1];

    // offence
    this.batter = mk(0, { stick: true });
    this.batter.at(PLATE_BOX.x, PLATE_BOX.z, -Math.PI / 2);
    this.batter.restClip = 'bat_wait';
    this.batter.anim.play('stance');

    this.onDeck = mk(1, { stick: true });
    this.onDeck.at(9.5, T.street.plateZ - 9.5, -2.1);
    this.onDeck.restClip = 'bat_wait';

    this.runners = [mk(10), mk(11), mk(12)];
    for (const r of this.runners) { r.group.visible = false; r.at(HOME.x, HOME.z, 0); }

    this.stoopKid = mk(13);
    this.stoopKid.at(-23.5, 26, 1.35);
    this.stoopKid.restClip = 'sit_flip';
    this.stoopKid.anim.play('sit_flip', { at: 1.1 });

    chalkMarks(app.scene);
    this.wire(app);
    this.homePose();
  },

  // ── gameplay → animation ─────────────────────────────────────────────────
  wire(app) {
    const sim = () => app.sim;
    bus.on('atbat:begin', () => {
      if (this.mode !== 'game') return;
      this.pitcher.act('windup', { state: 'windup', lock: 0.9 });
      this.batter.setLook(sim().state.batterIdx % 9);
      if (this.batter.lock <= 0) { this.batter.act('stance', { state: 'stance', lock: 0.9 }); }
      for (const f of this.fielders) if (f !== this.pitcher && f !== this.catcher && f.lock <= 0) f.anim.play('ready', { fade: 0.25 });
    });

    bus.on('pitch:thrown', () => {
      if (this.mode !== 'game') return;
      this.pitcher.act('pitch_recover', { state: 'recover' });
      this.batter.act('stance', { state: 'stance', lock: 1.4 });
      this.batter.flavour('waggle', { life: 1.2, amp: 0.9 });
      this.catcher.flavour('fidget_chatter', { amp: 0.35, life: 0.7 });
    });

    bus.on('bat:swing', () => {
      if (this.mode !== 'game') return;
      const s = sim();
      const remain = Math.max(0.1, s.timeToPlate - s.pitchT);
      const speed = THREE.MathUtils.clamp(CLIPS.swing.meta.contact / remain, 0.75, 2.4);
      this.batter.act('swing', { state: 'swing', speed, fade: 0.05 });
    });

    bus.on('bat:contact', () => {
      if (this.mode !== 'game') return;
      this.hitstop = 0.075;
      this.reactToBall(app, 0.16);
    });

    bus.on('strike', (p) => {
      if (this.mode !== 'game') return;
      if (p.kind === 'swinging') {
        this.batter.act('whiff', { state: 'whiff', fade: 0.04 });
      } else if (p.kind === 'looking') {
        this.batter.flavour('fidget_look', { amp: 0.7 });
      }
      if (p.kind !== 'foul') this.catcher.flavour('fidget_chatter', { amp: 0.5 });
    });

    bus.on('out', () => {
      if (this.mode !== 'game') return;
      this.batter.act('sulk', { state: 'sulk', lock: 1.5 });
      const f = this.fielders[2 + (arng.int(0, 5))];
      if (f && f.lock <= 0) f.flavour('fidget_pants', { amp: 0.7 });
      this.clearRunners();
    });

    bus.on('hit', (p) => {
      if (this.mode !== 'game') return;
      const bases = Math.min(4, p.bases || 1);
      this.sendRunner(bases);
      if (bases >= 4) this.homeRun();
      else this.batter.act('bat_wait', { state: 'idle', lock: 0.4 });
    });

    bus.on('run', () => { if (this.mode === 'game') this.mobAtPlate(); });
    bus.on('game:over', () => { if (this.mode === 'game') this.mobAtPlate(); });
  },

  /** Prefer a real fielding slot if one ever fills; otherwise chase the ball ourselves. */
  reactToBall(app, delay = 0.2) {
    const b = app.sim.ball;
    const g = T.ball.gravity;
    const vy = b.vel.y, y = Math.max(b.pos.y, 0.2);
    const tFall = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * y))) / g;
    const lx = b.pos.x + b.vel.x * tFall;
    const lz = b.pos.z + b.vel.z * tFall;
    let best = null, bd = 1e9;
    for (const f of this.fielders) {
      if (f === this.catcher) continue;
      const d = Math.hypot(f.pos.x - lx, f.pos.y - lz);
      if (d < bd) { bd = d; best = f; }
    }
    this.chaseDelay = delay;
    this.chase = best;
    this.chaseTo = { x: THREE.MathUtils.clamp(lx, -20, 20), z: THREE.MathUtils.clamp(lz, 6, 150) };
    // a second kid backs him up — nobody in this game stands still while a ball is live
    let second = null, sd = 1e9;
    for (const f of this.fielders) {
      if (f === best || f === this.catcher || f === this.pitcher) continue;
      const d = Math.hypot(f.pos.x - lx, f.pos.y - lz);
      if (d < sd) { sd = d; second = f; }
    }
    this.backup = second;
  },

  sendRunner(bases) {
    const r = this.runners.find((k) => !k.group.visible) || this.runners[0];
    r.group.visible = true;
    r.setLook((APP.sim.state.batterIdx + 4) % 9);
    r.at(HOME.x + 1.4, HOME.z, 0);
    r.speed = 0;
    const path = [];
    for (let i = 0; i < Math.min(bases, 3); i++) path.push(BASES[i]);
    if (bases >= 4) path.push(HOME);
    const walk = (n) => {
      if (n >= path.length) { r.state = 'idle'; return; }
      const p = path[n];
      r.goTo(p.x, p.z, { hard: n === path.length - 1, gait: bases >= 4 ? 'trot' : 'run', speed: bases >= 4 ? 9 : T.run.speed, onArrive: () => walk(n + 1) });
    };
    walk(0);
    if (bases < 4 && bases >= 1) {
      // slide into the last bag if it is going to be close
      const last = path[path.length - 1];
      r.arriveSlide = last;
    }
    return r;
  },

  clearRunners() { for (const r of this.runners) { r.group.visible = false; r.target = null; r.speed = 0; } },

  homeRun() {
    this.batter.act('point', { state: 'point', lock: 0.4 });
    this.batter.after = (k) => { k.showStick(false); k.goTo(BASES[0].x, BASES[0].z, { gait: 'trot', speed: 9 }); };
  },

  mobAtPlate() {
    const star = this.runners.find((r) => r.group.visible) || this.batter;
    star.target = null;
    star.at(HOME.x, HOME.z + 1.2, Math.PI);
    star.act('mobbed', { state: 'mob', lock: 3.2 });
    const crew = this.fielders.slice(2, 6);
    let i = 0;
    for (const f of crew) {
      const a = (i / crew.length) * Math.PI * 2;
      f.goTo(HOME.x + Math.cos(a) * 4.4, HOME.z + 1.2 + Math.sin(a) * 4.4, {
        speed: 14,
        onArrive: (k) => { k.lookAt(HOME.x, HOME.z + 1.2); k.act('cheer_jump', { state: 'cheer', lock: 2.6 }); k.anim.t = arng.range(0, 0.9); },
      });
      i++;
    }
  },

  homePose() {
    for (const f of this.fielders) { f.at(f.post.x, f.post.z, f.post.face === undefined ? Math.PI : f.post.face); f.lock = 0; f.cycle = null; f.state = 'idle'; f.anim.stopLayers(); f.anim.play(f.restClip, { at: arng.range(0, 2), fade: 0 }); }
    for (const f of this.fielders.slice(2)) f.lookAt(HOME.x, HOME.z);
    this.batter.at(PLATE_BOX.x, PLATE_BOX.z, -Math.PI / 2);
    this.batter.cycle = null; this.batter.lock = 0; this.batter.anim.stopLayers();
    this.batter.showStick(true);
    this.batter.anim.play('stance', { fade: 0 });
    this.onDeck.at(9.5, T.street.plateZ - 9.5, -2.1);
    this.onDeck.cycle = null; this.onDeck.lock = 0; this.onDeck.showStick(true);
    this.onDeck.anim.play('bat_wait', { at: 1.2, fade: 0 });
    this.stoopKid.at(-23.5, 26, 1.35);
    this.stoopKid.cycle = null; this.stoopKid.lock = 0;
    this.stoopKid.anim.play('sit_flip', { at: 1.1, fade: 0 });
    this.clearRunners();
    this.chase = null; this.backup = null;
  },

  /** Scenarios other than ours must find the street exactly as they left it. */
  onScenario(name, app) {
    arng.reset(4711);
    this.mode = name && name.startsWith('anim_') ? 'demo' : 'game';
    this.hitstop = 0;
    for (const k of this.kids) {
      k.cycle = null; k.cycleStep = -1; k.lock = 0; k.target = null; k.speed = 0;
      k.anim.stopLayers(); k._drive = null; k.gait = 'run'; k.maxSpeed = T.run.speed;
      k.group.visible = true; k.rig.resetSprings();
      if (k.trail) k.trail.clear();
    }
    this.homePose();
    if (this.mode === 'game') {
      app.camera.position.set(0, 12, -34);
      app.camera.lookAt(0, 4, 30);
      app.camera.fov = 46;
      app.camera.updateProjectionMatrix();
    }
  },

  update(dt, app) {
    // hitstop: the kids freeze for four frames on solid contact, the world does not
    if (this.hitstop > 0) { this.hitstop -= dt; return; }

    if (this.chase) {
      this.chaseDelay -= dt;
      if (this.chaseDelay <= 0) {
        const c = this.chase, to = this.chaseTo;
        this.chase = null;
        const far = Math.hypot(c.pos.x - to.x, c.pos.y - to.z);
        c.goTo(to.x, to.z, {
          speed: T.field.speed, hard: far > 14,
          onArrive: (k) => {
            const roll = arng.next();
            if (roll < 0.18) k.act('fumble', { state: 'fumble' });
            else if (roll < 0.34) k.act('dive', { state: 'dive' });
            else if (roll < 0.5) k.act('jump_catch', { state: 'catch' });
            else k.act('throw', { state: 'throw' });
          },
        });
        if (this.backup) {
          const b = this.backup; this.backup = null;
          b.goTo(to.x - 7, to.z - 8, { speed: T.field.speed * 0.85 });
        }
      }
    }

    for (const k of this.kids) k.update(dt);
  },
});

// ── scenarios ───────────────────────────────────────────────────────────────
const sys = () => APP.get('players');

/**
 * Frame a demo composition: put the camera `dist` out from `at`, `elev` degrees above the
 * horizontal and `yaw` degrees round to one side, which keeps every animation reel at the
 * three-quarter angle §12 asks for instead of at whatever looked fine that afternoon.
 */
function cam(at, { dist = 20, elev = 25, yaw = -26, fov = 46, aim = 0 } = {}) {
  const e = elev * Math.PI / 180, y = yaw * Math.PI / 180;
  const h = dist * Math.cos(e);
  APP.camera.position.set(at[0] + Math.sin(y) * h, at[1] + dist * Math.sin(e), at[2] - Math.cos(y) * h);
  APP.camera.lookAt(at[0], at[1] + aim, at[2]);
  APP.camera.fov = fov;
  APP.camera.updateProjectionMatrix();
  return Math.atan2(APP.camera.position.x - at[0], APP.camera.position.z - at[2]);
}

/** Take a set of kids off duty and make them available as demo actors. */
function cast(n) {
  const p = sys();
  const pool = [p.batter, p.onDeck, ...p.fielders, ...p.runners, p.stoopKid];
  const out = [];
  for (const k of pool) {
    if (out.length >= n) break;
    k.cycle = null; k.lock = 0; k.target = null; k.speed = 0; k.state = 'idle';
    k.anim.stopLayers(); k.group.visible = true;
    out.push(k);
  }
  for (const k of pool.slice(n)) k.group.visible = false;
  return out;
}

/** The direction a kid at (x,z) must face to be three-quarter on to the camera. */
function faceCam(x, z, skew = 0) {
  const c = APP.camera.position;
  return Math.atan2(c.x - x, c.z - z) + skew;
}

registerScenario('anim_idle', {
  seed: 21,
  setup: () => {
    const a = cast(6);
    cam([1, 3.0, 46.2], { dist: 17.2, elev: 16, yaw: -28, fov: 50, aim: 0.4 });
    const xs = [-9.8, -5.4, -0.6, 3.8, 8.4, 12.6];
    const zs = [44.4, 48.6, 44.2, 48.4, 44.0, 48.2];
    a.forEach((k, i) => {
      k.showStick(i === 2);
      k.at(xs[i], zs[i], faceCam(xs[i], zs[i], (i - 2.5) * 0.2));
      k.idleClip = IDLES[i % IDLES.length];
      k.restClip = k.idleClip;
      k.anim.play(k.idleClip, { at: i * 0.73, fade: 0 });
      // staggered so every frame of the strip has three kids visibly moving
      k.setCycle(3.9, [
        { t: 0.0, do: (x) => { x.anim.play(x.idleClip, { fade: 0.22 }); x.flavour(x.fidgets[0]); } },
        { t: 1.55, do: (x) => x.flavour(x.fidgets[1]) },
        { t: 2.75, do: (x) => x.flavour(x.fidgets[2]) },
      ], i * 0.62);
    });
  },
  settle: 1.35,
});

registerScenario('anim_swing', {
  seed: 22,
  setup: () => {
    const a = cast(5);
    cam([0, 3.0, 45.2], { dist: 15.8, elev: 15, yaw: -15, fov: 50, aim: 0.5 });
    const P = 1.5;
    a.forEach((k, i) => {
      k.giveStick(); k.showStick(true);
      const x = -9.6 + i * 4.8, z = 44.4 + (i % 2) * 2.0;
      // every batter square to the same imaginary pitcher (off to camera right), so the five
      // phases read left to right as one continuous arc
      k.at(x, z, faceCam(x, z, -0.16));
      k.setCycle(P, [
        { t: 0.0, do: (y) => { y.anim.play('stance', { fade: 0.1 }); y.flavour('waggle', { life: 0.28 }); } },
        { t: 0.22, do: (y) => y.anim.play('swing', { restart: true, fade: 0.05 }) },
      ], (P / 5) * i);
    });
  },
  settle: 0.72,
});

registerScenario('anim_run', {
  seed: 23,
  setup: () => {
    const a = cast(6);
    cam([1.5, 3.0, 45.5], { dist: 18.5, elev: 16, yaw: -14, fov: 52, aim: 0.3 });
    // four kids at four phases of one cycle, running the same lane left to right
    for (let i = 0; i < 4; i++) {
      const k = a[i];
      const lane = 41.0 + i * 2.4;
      k.showStick(false);
      k.at(-15 + i * 2.0, lane, Math.PI / 2);
      k.runDist = i * (CLIPS.run.meta.stride * k.scale) / 4;
      k.setCycle(3.6, [
        { t: 0.0, do: (x) => { x.at(-16, lane, Math.PI / 2); x.goTo(20, lane, { speed: T.run.speed }); } },
      ], i * 0.62);
    }
    // the hard stop
    const s = a[4];
    s.showStick(false);
    s.at(-14, 51.2, Math.PI / 2);
    s.setCycle(3.6, [
      { t: 0.0, do: (x) => { x.at(-14, 51.2, Math.PI / 2); x.goTo(2.5, 51.2, { speed: T.run.speed, hard: true }); } },
    ], 1.05);
    // and the slide into the chalk
    const d = a[5];
    d.showStick(false);
    d.setCycle(3.6, [
      { t: 0.0, do: (x) => { x.at(6.5, 55.5, 1.2); x.goTo(14.6, 51.4, { speed: T.run.speed }); } },
      { t: 0.86, do: (x) => { x.target = null; x.act('slide', { state: 'slide' }); if (APP.puffs) APP.puffs.burst(new THREE.Vector3(x.pos.x, 0.2, x.pos.y), 12, 3.2); } },
    ], 0.2);
  },
  settle: 1.62,
});

registerScenario('anim_celebrate', {
  seed: 24,
  setup: () => {
    const a = cast(7);
    cam([0.5, 3.0, 8.0], { dist: 15.5, elev: 17, yaw: -22, fov: 50, aim: 0.5 });
    const star = a[0];
    star.showStick(false);
    star.at(0.5, 7.5, faceCam(0.5, 7.5));
    star.anim.play('mobbed', { fade: 0 });
    star.setCycle(9, [{ t: 0, do: (x) => x.anim.play('mobbed', { fade: 0.2 }) }], 0.4);
    // four kids piling on, offset so no two are airborne on the same frame
    const ring = [[-4.2, 5.2], [4.6, 5.6], [-2.9, 11.0], [3.6, 11.4]];
    ring.forEach((p, i) => {
      const k = a[1 + i];
      k.showStick(false);
      k.at(p[0], p[1], Math.atan2(0.5 - p[0], 7.5 - p[1]));
      k.anim.play('cheer_jump', { at: i * 0.22, fade: 0 });
      k.setCycle(9, [{ t: 0, do: (x) => x.anim.play('cheer_jump', { fade: 0.2 }) }], i * 0.22);
    });
    // one thumbing his nose at the other bench, one who lost taking it hard
    const t = a[5];
    t.showStick(false);
    t.at(-10.5, 12.5, 2.1);
    t.anim.play('taunt', { at: 0.4, fade: 0 });
    t.setCycle(9, [{ t: 0, do: (x) => x.anim.play('taunt', { fade: 0.2 }) }], 0.4);
    const s = a[6];
    s.showStick(false);
    s.at(11.5, 13.5, 3.5);
    s.anim.play('sulk', { at: 1.1, fade: 0 });
    s.setCycle(9, [{ t: 0, do: (x) => x.anim.play('sulk', { fade: 0.2 }) }], 1.1);
  },
  settle: 0.95,
});

registerScenario('anim_pitch', {
  seed: 25,
  setup: () => {
    const a = cast(4);
    cam([0, 3.0, 45.2], { dist: 15.5, elev: 16, yaw: -30, fov: 50, aim: 0.5 });
    a.forEach((k, i) => {
      k.showStick(false);
      const x = -7.6 + i * 5.1, z = 43.6 + (i % 2) * 2.2;
      k.at(x, z, Math.PI * 0.88);
      k.setCycle(2.1, [
        { t: 0.0, do: (y) => y.anim.play('windup', { restart: true, fade: 0.06 }) },
        { t: 0.92, do: (y) => y.anim.play('pitch_recover', { restart: true, fade: 0.05 }) },
        { t: 1.9, do: (y) => y.anim.play('pitch_set', { fade: 0.12 }) },
      ], (2.1 / 4) * i);
    });
  },
  settle: 0.52,
});

registerScenario('anim_field', {
  seed: 26,
  setup: () => {
    const a = cast(4);
    cam([0, 2.9, 45.2], { dist: 16, elev: 16, yaw: -20, fov: 52, aim: 0.4 });
    const acts = ['dive', 'jump_catch', 'fumble', 'throw'];
    a.forEach((k, i) => {
      k.showStick(false);
      const x = -8.2 + i * 5.5, z = 43.6 + (i % 2) * 2.2;
      k.at(x, z, faceCam(x, z, 0.35));
      k.restClip = 'ready';
      k.setCycle(2.5, [
        { t: 0.0, do: (y) => y.act(acts[i], { state: 'demo' }) },
        { t: 2.0, do: (y) => y.anim.play('ready', { fade: 0.2 }) },
      ], (2.5 / 4) * i * 0.6);
    });
  },
  settle: 0.66,
});

registerScenario('anim_car', {
  seed: 27,
  setup: () => {
    const a = cast(6);
    cam([0, 3.0, 45.4], { dist: 19, elev: 18, yaw: -26, fov: 52, aim: 0.4 });
    const spots = [[-8.6, 42.6], [-4.4, 47.6], [0.4, 42.8], [4.8, 47.8], [9.2, 43.2], [-11.6, 48.4]];
    a.forEach((k, i) => {
      k.showStick(i === 2);
      const sp = spots[i];
      k.at(sp[0], sp[1], faceCam(sp[0], sp[1], (i - 2.5) * 0.2));
      k.setCycle(7.0, [
        { t: 0.0, do: (x) => { x.restClip = x.idleClip; x.anim.play(x.idleClip, { fade: 0.2 }); x.flavour(x.fidgets[0]); } },
        { t: 1.4, do: (x) => x.act('freeze', { state: 'freeze', lock: 1.7 }) },
        { t: 3.15, do: (x) => x.goTo(sp[0] < 0 ? -15.5 : 15.5, sp[1] + (sp[0] < 0 ? -2 : 2), { speed: T.run.speed, hard: true }) },
        { t: 4.5, do: (x) => { x.lookAt(0, 20); x.restClip = x.stick ? 'curb_wait' : 'idle_slouch'; x.anim.play(x.restClip, { fade: 0.25 }); } },
        { t: 6.3, do: (x) => { x.at(sp[0], sp[1], faceCam(sp[0], sp[1], 0)); x.restClip = x.idleClip; } },
      ], 0);
    });
  },
  settle: 1.55,
});

registerScenario('anim_argue', {
  seed: 28,
  setup: () => {
    const a = cast(4);
    cam([-0.4, 2.9, 46.2], { dist: 14.5, elev: 15, yaw: -32, fov: 50, aim: 0.5 });
    const [p, q, r, s] = a;
    p.showStick(false); q.showStick(false);
    p.at(-2.2, 45.4, 1.44); q.at(2.2, 46.3, -1.58);
    p.anim.play('argue_jab', { fade: 0 });
    q.anim.play('argue_appeal', { at: 0.5, fade: 0 });
    p.setCycle(6, [{ t: 0, do: (x) => x.anim.play('argue_jab', { fade: 0.2 }) }], 0);
    q.setCycle(6, [{ t: 0, do: (x) => x.anim.play('argue_appeal', { fade: 0.2 }) }], 0.5);
    // the called shot, happening behind them, ignored by everybody
    r.giveStick(); r.showStick(true);
    r.at(-9.5, 53, faceCam(-9.5, 53, -0.2));
    r.setCycle(3.4, [
      { t: 0.0, do: (x) => x.act('point', { state: 'point' }) },
      { t: 2.2, do: (x) => x.anim.play('stance', { fade: 0.2 }) },
    ], 0.6);
    s.showStick(false);
    s.at(8.5, 52, 3.4);
    s.restClip = 'idle_slouch';
    s.setCycle(6, [{ t: 0, do: (x) => x.anim.play('idle_slouch', { fade: 0.2 }) }], 1.4);
  },
  settle: 1.15,
});

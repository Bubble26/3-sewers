import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { buildKid } from './rig.js';
import { ROSTER } from './roster.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { registerScenario } from '../core/scenarios.js';
import { CHALK } from '../render/palette.js';
import { bindRig, attachStick, Animator, Trail, headingTo } from './anim.js';
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
const PLATE_BOX = { x: 2.7, z: T.street.plateZ - 0.5 };

/**
 * Every heading in this file goes through the rig's own detected facing (anim.js `headingTo`)
 * rather than re-deriving which way a kid points and getting it wrong.
 */
const YAW = (dx, dz) => headingTo(dx, dz);
/** Batting box: face the kid across the plate with the pitcher off to his open side. */
const BAT_YAW = () => YAW(-1, 0);

// Nine on defence, spread up a street rather than around a diamond.
const POSTS = [
  { id: 'catcher', x: 0, z: T.street.plateZ - 5.6, clip: 'crouch' },
  { id: 'pitcher', x: 0, z: T.street.moundZ, clip: 'pitch_set' },
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
    this.glide = 0;
    this.state = 'idle';
    this.lock = 0;                       // seconds a one-shot owns the body
    this.idleClip = IDLES[index % IDLES.length];
    // three character-specific fidgets per kid, never the same trio twice
    this.fidgets = [FIDGETS[index % FIDGETS.length], FIDGETS[(index * 3 + 2) % FIDGETS.length], FIDGETS[(index * 5 + 5) % FIDGETS.length]];
    this.fidgetIn = arng.range(0.6, 4.2);
    this.cycle = null; this.cycleT = 0; this.cycleStep = -1;

    // face: the cheapest character there is, and the thing the first pass never touched
    this.baseFace = this.homeFace = this.group.userData.baseExpression || 'neutral';
    this.faceNow = this.group.userData.expression || 'neutral';
    this.faceHold = 0;
    this.anim.onEvent = (n) => this.onAnimEvent(n);
    this._runPhase = 0;

    this.anim.play(this.idleClip, { at: arng.range(0, 3) });
    if (opts.stick) this.giveStick();
    this.group.userData.kid = this;
  }

  /**
   * Clips fire named events; this is where they land. `face:*` drives the painted expression,
   * everything else is a puff of dust at the feet. Repainting a face canvas is not free, so a
   * change is only pushed when the expression actually differs.
   */
  onAnimEvent(name) {
    if (name.startsWith('face:')) return this.setFace(name.slice(5), 1.1);
    const P = APP.puffs;
    if (!P) return;
    _v.set(this.pos.x, 0.12, this.pos.y);
    if (name === 'skid') { P.burst(_v, 22, 4.2); this.glide = Math.max(this.glide || 0, this.speed * 0.5); }
    else if (name === 'dust') P.burst(_v, 30, 5.0);
    else if (name === 'land') P.burst(_v, 12, 2.6);
  }

  setFace(name, hold = 0) {
    this.faceHold = Math.max(this.faceHold, hold);
    if (name === this.faceNow) return;
    const set = this.group.userData.setExpression;
    if (!set) return;
    set(name);
    this.faceNow = name;
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
  lookAt(x, z) { this.faceGoal = YAW(x - this.pos.x, z - this.pos.y); return this; }
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
    // a kid who leaves his feet keeps travelling: without this the slide is a mime of a slide
    if (o.glide !== false && (name === 'slide' || name === 'dive')) this.glide = Math.max(this.speed, o.glide || 0);
    this.state = o.state || 'act';
    this.lock = (o.lock === undefined ? cl.dur / (o.speed || 1) : o.lock);
    this.after = o.after || null;
  }
  /** Additive layer on top of whatever is playing. */
  flavour(name, o) { this.anim.once(name, o); }

  /**
   * A looping director track. The offset is a TRUE phase offset: the starting step is fired
   * immediately and the clip is wound forward to match, so five kids on the same cycle at five
   * offsets read as five consecutive frames of one action rather than five copies of frame 1.
   */
  setCycle(period, steps, offset = 0) {
    this.cycle = { period, steps };
    this.cycleT = ((offset % period) + period) % period;
    let idx = 0;
    for (let i = 0; i < steps.length; i++) if (this.cycleT >= steps[i].t) idx = i;
    this.cycleStep = idx;
    steps[idx].do(this);
    this.anim.t += this.cycleT - steps[idx].t;
    this.anim.fade = 1; this.anim.prev = null;
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
        this.faceGoal = YAW(dx, dz);
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

    // skid: friction, not braking. Feet are off the ground, so it decays slowly and the kid
    // travels several feet on his hip — which is the entire read of a slide.
    if (this.glide > 0) {
      this.glide = Math.max(0, this.glide - 13 * dt);
      const step = this.glide * dt;
      this.pos.x += Math.sin(this.face) * step;
      this.pos.y += Math.cos(this.face) * step;
      if (this.lock <= 0) this.glide = 0;
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
      // Phase comes from distance travelled, never from the clock — that is the whole reason
      // a planted foot does not skate when the sim changes the kid's speed mid-stride.
      const stride = (cl.meta.stride || 5.4) * this.scale;
      const ph = (this.runDist / stride) % 1;
      this.anim.t = ph * cl.dur;
      // footfalls are counted off the same distance, so dust lands under the foot that
      // planted it — two per cycle, and it stays in step when the speed changes
      const steps = Math.floor(this.runDist / (stride * 0.5));
      if (steps !== this._steps) {
        if (this._steps !== undefined && this.speed > 9 && APP.puffs) {
          _v.set(this.pos.x, 0.1, this.pos.y);
          APP.puffs.burst(_v, 2, 1.3);
        }
        this._steps = steps;
      }
      this._runPhase = ph;
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
    this.rig.updateShadow();
    this.updateTrail(dt);

    // faces fall back to the kid's own resting expression once the beat that set them passes
    if (this.faceHold > 0) {
      this.faceHold -= dt;
      if (this.faceHold <= 0) this.setFace(this.baseFace);
    }
  }

  updateTrail(dt) {
    if (!this.trail) return;
    const tip = this.rig.get('stickTip');
    const stick = this.rig.get('stick');
    if (!tip || !stick || !stick.visible) { this.trail.clear(); return; }
    const len = (this.rig.stickLength || 3.3) * 0.5;
    this._tipA.set(0, len * 0.58, 0).applyMatrix4(tip.matrixWorld);
    this._tipB.set(0, len * 1.06, 0).applyMatrix4(tip.matrixWorld);
    const v = this._tipB.distanceTo(this._prevTip) / Math.max(dt, 1e-4);
    this._prevTip.copy(this._tipB);
    this.trail.push(this._tipA, this._tipB, THREE.MathUtils.clamp((v - 26) / 58, 0, 1));
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

/** A single extra chalk bag for the locomotion reel, so the slide slides INTO something. */
function reelBase(scene, x, z) {
  let g = scene.getObjectByName('reel_base');
  if (g) return g;
  g = new THREE.Group();
  g.name = 'reel_base';
  const mat = new THREE.MeshBasicMaterial({ color: CHALK, transparent: true, opacity: 0.78, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.35, 4, 1), mat);
  ring.rotation.x = -Math.PI / 2; ring.rotation.z = Math.PI / 4;
  ring.position.set(x, 0.035, z);
  ring.renderOrder = 1;
  g.add(ring);
  scene.add(g);
  g.visible = false;
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
      k.restClip = k.homeClip = p.clip || 'ready';
      k.at(p.x, p.z, p.face === undefined ? YAW(0, -1) : p.face);
      if (p.clip) k.anim.play(p.clip, { at: arng.range(0, 2) });
      return k;
    });
    this.catcher = this.fielders[0];
    this.pitcher = this.fielders[1];

    // offence
    this.batter = mk(0, { stick: true });
    this.batter.at(PLATE_BOX.x, PLATE_BOX.z, BAT_YAW());
    this.batter.restClip = this.batter.homeClip = 'bat_wait';
    this.batter.anim.play('stance');

    this.onDeck = mk(1, { stick: true });
    this.onDeck.at(10.5, T.street.plateZ - 8.5, 0).lookAt(0, T.street.moundZ).snapFacing();
    this.onDeck.restClip = this.onDeck.homeClip = 'bat_wait';

    this.runners = [mk(10), mk(11), mk(12)];
    for (const r of this.runners) { r.homeClip = 'ready'; r.group.visible = false; r.at(HOME.x, HOME.z, 0); }

    this.stoopKid = mk(13);
    this.stoopKid.at(-23.5, 26, YAW(1, 0));
    this.stoopKid.restClip = this.stoopKid.homeClip = 'sit_flip';
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

  /** A scoring play pulls at least three kids into a SHARED celebration (BYB 5.6). */
  mobAtPlate() {
    const star = this.runners.find((r) => r.group.visible) || this.batter;
    star.target = null;
    star.showStick(false);
    star.at(HOME.x, HOME.z + 2.0, YAW(0, -1));
    star.act('mobbed', { state: 'mob', lock: 3.4 });
    const crew = this.fielders.slice(2, 6);
    const cheers = ['mob_pile', 'mob_pile', 'cheer_jump', 'cheer_wave'];
    let i = 0;
    for (const f of crew) {
      const a = (-0.55 + (i / (crew.length - 1)) * 1.1) * Math.PI;
      const r = 3.9 + (i % 2) * 1.1;
      const clip = cheers[i % cheers.length];
      f.goTo(HOME.x + Math.cos(a) * r, HOME.z + 2.0 + Math.sin(a) * r, {
        speed: 15,
        onArrive: (k) => {
          k.lookAt(HOME.x, HOME.z + 2.0);
          k.act(clip, { state: 'cheer', lock: 2.8 });
          k.anim.t = arng.range(0, 0.9);
        },
      });
      i++;
    }
    // the kid who did not score takes it hard, out of the scrum where it reads as a reaction
    const odd = this.fielders[6];
    if (odd) { odd.target = null; odd.lookAt(HOME.x, HOME.z); odd.act('sulk', { state: 'sulk', lock: 3.0 }); }
  },

  homePose() {
    for (const k of this.kids) { k.restClip = k.homeClip || k.idleClip; k.baseFace = k.homeFace; k.faceHold = 0; k.setFace(k.baseFace); k._steps = undefined; }
    for (const f of this.fielders) { f.at(f.post.x, f.post.z, f.post.face === undefined ? YAW(0, -1) : f.post.face); f.lock = 0; f.cycle = null; f.state = 'idle'; f.anim.stopLayers(); f.anim.play(f.restClip, { at: arng.range(0, 2), fade: 0 }); }
    for (const f of this.fielders.slice(2)) { f.lookAt(HOME.x, HOME.z); f.snapFacing(); }
    this.catcher.lookAt(0, T.street.moundZ).snapFacing();
    this.pitcher.lookAt(HOME.x, HOME.z).snapFacing();
    this.batter.at(PLATE_BOX.x, PLATE_BOX.z, BAT_YAW());
    this.batter.cycle = null; this.batter.lock = 0; this.batter.anim.stopLayers();
    this.batter.showStick(true);
    this.batter.anim.play('stance', { fade: 0 });
    this.onDeck.at(10.5, T.street.plateZ - 8.5, 0).lookAt(0, T.street.moundZ).snapFacing();
    this.onDeck.cycle = null; this.onDeck.lock = 0; this.onDeck.showStick(true);
    this.onDeck.anim.play('bat_wait', { at: 1.2, fade: 0 });
    this.stoopKid.at(-23.5, 26, YAW(1, 0));
    this.stoopKid.cycle = null; this.stoopKid.lock = 0;
    this.stoopKid.anim.play('sit_flip', { at: 1.1, fade: 0 });
    this.clearRunners();
    this.chase = null; this.backup = null;
  },

  /** Scenarios other than ours must find the street exactly as they left it. */
  onScenario(name, app) {
    arng.reset(4711);
    const rb = app.scene.getObjectByName('reel_base');
    if (rb) rb.visible = name === 'anim_run';
    this.mode = name && name.startsWith('anim_') ? 'demo' : 'game';
    this.hitstop = 0;
    for (const k of this.kids) {
      k.cycle = null; k.cycleStep = -1; k.lock = 0; k.target = null; k.speed = 0; k.glide = 0;
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
 * horizontal and `yaw` degrees round to one side. DESIGN-BIBLE §12 fixes the three-quarter
 * angle at 20-35 degrees above horizontal and the batter at 18-26% of frame height; the
 * numbers below sit inside both bands, which is what stops an animation reel from turning
 * into a set of cropped torsos the way the first pass did.
 */
function cam(at, { dist = 21, elev = 21, yaw = -22, fov = 44, aim = 0 } = {}) {
  const e = elev * Math.PI / 180, y = yaw * Math.PI / 180;
  const h = dist * Math.cos(e);
  APP.camera.position.set(at[0] + Math.sin(y) * h, at[1] + dist * Math.sin(e), at[2] - Math.cos(y) * h);
  APP.camera.lookAt(at[0], at[1] + aim, at[2]);
  APP.camera.fov = fov;
  APP.camera.updateProjectionMatrix();
  return Math.atan2(APP.camera.position.x - at[0], APP.camera.position.z - at[2]);
}

/** Take a set of kids off duty and make them available as demo actors, in a known state. */
function cast(n) {
  const p = sys();
  const pool = [p.batter, p.onDeck, ...p.fielders, ...p.runners, p.stoopKid];
  const out = [];
  for (const k of pool) {
    if (out.length >= n) break;
    k.cycle = null; k.cycleStep = -1; k.lock = 0; k.target = null; k.speed = 0; k.glide = 0; k.state = 'idle';
    k.anim.stopLayers(); k.group.visible = true;
    k.idleClip = IDLES[out.length % IDLES.length];
    k.restClip = k.idleClip;
    k.gait = 'run'; k.maxSpeed = T.run.speed;
    k.showStick(false);
    k.faceHold = 0; k.setFace(k.baseFace);
    out.push(k);
  }
  for (const k of pool.slice(n)) k.group.visible = false;
  return out;
}

/** The direction a kid at (x,z) must face to be three-quarter on to the camera. */
function faceCam(x, z, skew = 0) {
  const c = APP.camera.position;
  return YAW(c.x - x, c.z - z) + skew;
}

/**
 * anim_idle — "no kid at rest" (BYB §9's veto, and §5.3's most under-built animation).
 * Five kids, three idle families, three character-specific fidgets each, on offset cycles so
 * that in ANY single frame of a capture no two are in the same pose and at least three are
 * visibly moving. Faces differ too: the neighbourhood is not one kid five times.
 */
registerScenario('anim_idle', {
  seed: 21,
  setup: () => {
    const a = cast(5);
    cam([0.2, 2.6, 44.6], { dist: 19.5, elev: 19, yaw: -24, fov: 43, aim: 0.5 });
    const spot = [[-6.9, 42.4], [-3.3, 45.6], [0.4, 42.2], [4.2, 45.4], [7.6, 42.0]];
    const rest = ['idle', 'idle_slouch', 'idle_bounce', 'idle', 'idle_slouch'];
    const mood = ['neutral', 'squint', 'grin', 'smug', 'neutral'];
    // three-quarter, and no two the same way round: a kid square-on to the lens loses both
    // arms and both legs to foreshortening, which is exactly what killed the first pass
    const turn = [0.86, -0.72, 0.55, -0.92, 0.78];
    a.forEach((k, i) => {
      const [x, z] = spot[i];
      k.showStick(i === 2);
      k.at(x, z, faceCam(x, z, turn[i]));
      k.idleClip = rest[i];
      k.restClip = rest[i];
      k.baseFace = mood[i];
      k.setFace(mood[i]);
      // three fidgets each, on a long cycle offset by a fifth of a period per kid
      k.setCycle(6.6, [
        { t: 0.0, do: (y) => { y.anim.play(y.idleClip, { fade: 0.22, at: 0.7 }); y.flavour(y.fidgets[0]); } },
        { t: 2.4, do: (y) => y.flavour(y.fidgets[1]) },
        { t: 4.5, do: (y) => y.flavour(y.fidgets[2]) },
      ], i * 1.31);
    });
  },
  settle: 0.9,
});

/**
 * anim_swing — the swing as a chart you read left to right.
 * Four batters on one 1.25 s cycle at four phase offsets, so a single frame shows load,
 * stride, contact and wrap side by side, and a contact sheet shows each of them walking
 * through the whole action. A catcher squats in front so the reel still reads as baseball.
 */
registerScenario('anim_swing', {
  seed: 22,
  setup: () => {
    const a = cast(5);
    cam([0.2, 2.7, 44.8], { dist: 21, elev: 19, yaw: -16, fov: 44, aim: 0.55 });
    const P = 1.25;
    const spot = [[-7.6, 42.4], [-2.6, 45.4], [2.4, 42.4], [7.4, 45.4]];
    // Batters stand PROFILE to the lens. A swing is hips-before-hands and a bat arc; both of
    // those are invisible head-on and unmissable from the side, which is why every baseball
    // photograph ever taken of a swing is shot from third base.
    for (let i = 0; i < 4; i++) {
      const k = a[i];
      const [x, z] = spot[i];
      k.giveStick(); k.showStick(true);
      k.at(x, z, faceCam(x, z, 1.02));
      k.restClip = 'stance';
      k.setCycle(P, [
        { t: 0.0, do: (y) => { y.anim.play('stance', { fade: 0.08 }); y.flavour('waggle', { life: 0.16 }); } },
        { t: 0.14, do: (y) => y.anim.play('swing', { restart: true, fade: 0.04 }) },
      ], (P / 4) * i + 0.30);
    }
    // the catcher, squatting, so the frame carries a second silhouette family
    const c = a[4];
    c.at(-8.4, 50.0, faceCam(-8.4, 50.0, 0.5));
    c.restClip = 'crouch';
    c.anim.play('crouch', { at: 0.9, fade: 0 });
  },
  settle: 0.05,
});

/**
 * anim_run — locomotion: acceleration, a full-speed cycle, a hard stop, and a slide.
 * The four runners are on a treadmill so the strip shows four points of one cycle at once;
 * their clip phase comes from distance travelled, so the planted foot never skates.
 */
registerScenario('anim_run', {
  seed: 23,
  setup: () => {
    const a = cast(6);
    cam([1.2, 2.6, 45.0], { dist: 21, elev: 17, yaw: -12, fov: 43, aim: 0.65 });
    const treadmill = (k, lane, x0) => {
      k.at(x0, lane, YAW(1, 0));
      k.speed = T.run.speed;
      k.goTo(30, lane, { speed: T.run.speed, onArrive: (y) => treadmill(y, lane, -22) });
    };
    // Three at full tilt on one lane, a quarter-cycle apart, so a single frame is three
    // points of one stride and a contact sheet is the whole cycle four times over.
    for (let i = 0; i < 3; i++) {
      const k = a[i];
      k.runDist = i * (CLIPS.run.meta.stride * k.scale) / 3;
      k._steps = undefined;
      treadmill(k, 46.6, -11.6 + i * 5.6);
    }
    // one launching from a standstill: the reel has to show acceleration, not just the loop
    const e = a[3];
    e.setCycle(2.6, [
      { t: 0.0, do: (x) => { x.at(-13.0, 49.8, YAW(1, 0)); x.speed = 0; x.runDist = 0; x._steps = undefined; x.goTo(22, 49.8, { speed: T.run.speed }); } },
    ], 0.0);
    // the hard stop on the back lane: both feet plant, everything above the knees keeps going
    const s = a[4];
    s.setCycle(2.6, [
      { t: 0.0, do: (x) => { x.at(-8.8, 52.6, YAW(1, 0)); x.speed = T.run.speed; x.goTo(-0.2, 52.6, { speed: T.run.speed, hard: true }); } },
    ], 0.0);
    // and the slide, on the front lane, aimed at an actual chalk bag
    const BX = 2.6, BZ = 41.2;
    reelBase(APP.scene, BX, BZ).visible = true;
    const d = a[5];
    d.setCycle(2.6, [
      { t: 0.0, do: (x) => { x.at(-8.0, BZ, YAW(1, 0)); x.speed = T.run.speed; x.goTo(BX + 4.5, BZ, { speed: T.run.speed }); } },
      { t: 0.30, do: (x) => { x.target = null; x.act('slide', { state: 'slide' }); } },
    ], 0.0);
  },
  settle: 0.55,
});

/**
 * anim_celebrate — a scoring play pulls at least three kids into a SHARED celebration
 * (BYB §5.6), not one kid emoting alone. Star mobbed at the plate with his arms up, three
 * piling on out of phase, one jumping, one waving the block over — and, because the joke is
 * always in the reaction shot, the losing side: one thumbing his nose, one taking it hard.
 */
registerScenario('anim_celebrate', {
  seed: 24,
  setup: () => {
    const a = cast(7);
    cam([0.4, 2.7, 12.2], { dist: 17.5, elev: 20, yaw: -19, fov: 45, aim: 1.15 });
    const star = a[0];
    star.at(0, 12.2, faceCam(0, 12.2, 0.16));
    star.setCycle(9, [{ t: 0, do: (x) => x.anim.play('mobbed', { fade: 0.2 }) }], 0.4);

    // three piling on, at three phases, so no two are airborne on the same frame
    const pile = [[-3.0, 10.4, 0.00], [3.2, 10.8, 0.42], [-0.6, 14.9, 0.78]];
    pile.forEach((p, i) => {
      const k = a[1 + i];
      k.at(p[0], p[1], YAW(0 - p[0], 12.2 - p[1]));
      k.setCycle(9, [{ t: 0, do: (x) => x.anim.play('mob_pile', { fade: 0.2 }) }], p[2]);
    });
    // one bouncing clear of the scrum, one waving the whole block over
    const j = a[4];
    j.at(6.6, 15.6, faceCam(6.6, 15.6, -0.34));
    j.setCycle(9, [{ t: 0, do: (x) => x.anim.play('cheer_jump', { fade: 0.2 }) }], 0.61);
    const w = a[5];
    w.at(-6.4, 15.2, faceCam(-6.4, 15.2, 0.30));
    w.setCycle(9, [{ t: 0, do: (x) => x.anim.play('cheer_wave', { fade: 0.2 }) }], 0.9);
    // the other bench: the kid who lost, out at the edge where he reads as a reaction shot
    const s = a[6];
    s.at(9.4, 8.2, faceCam(9.4, 8.2, -0.46));
    s.setCycle(9, [{ t: 0, do: (x) => x.anim.play('sulk', { fade: 0.2 }) }], 1.4);
  },
  settle: 0.9,
});

/** anim_pitch — set, windup, the held leg-kick apex, release and recovery, four at a time. */
registerScenario('anim_pitch', {
  seed: 25,
  setup: () => {
    const a = cast(4);
    cam([0, 2.8, 45.2], { dist: 21, elev: 21, yaw: -27, fov: 43, aim: 0.4 });
    const spot = [[-7.4, 43.0], [-2.6, 46.2], [2.4, 43.0], [7.4, 46.2]];
    a.forEach((k, i) => {
      const [x, z] = spot[i];
      k.at(x, z, YAW(0, -1) - 0.30);
      k.restClip = 'pitch_set';
      k.setCycle(2.3, [
        { t: 0.0, do: (y) => y.anim.play('windup', { restart: true, fade: 0.06 }) },
        { t: 0.94, do: (y) => y.anim.play('pitch_recover', { restart: true, fade: 0.05 }) },
        { t: 2.0, do: (y) => y.anim.play('pitch_set', { fade: 0.12 }) },
      ], (2.3 / 4) * (3 - i));
    });
  },
  settle: 0.1,
});

/** anim_field — the dive, the jump catch, the bobble and the throw, side by side. */
registerScenario('anim_field', {
  seed: 26,
  setup: () => {
    const a = cast(4);
    cam([0, 2.8, 45.6], { dist: 22.5, elev: 21, yaw: -20, fov: 45, aim: 0.5 });
    const acts = ['dive', 'jump_catch', 'fumble', 'throw'];
    const spot = [[-8.6, 42.2], [-2.8, 46.0], [2.8, 42.2], [8.6, 46.0]];
    a.forEach((k, i) => {
      const [x, z] = spot[i];
      k.at(x, z, faceCam(x, z, 0.34));
      k.restClip = 'ready';
      k.setCycle(2.6, [
        { t: 0.0, do: (y) => y.act(acts[i], { state: 'demo' }) },
        { t: 2.1, do: (y) => y.anim.play('ready', { fade: 0.2 }) },
      ], 0.4 + i * 0.3);
    });
  },
  settle: 0.1,
});

/** anim_car — signature moment #1: the shout, the freeze, the scatter, the wait, the resume. */
registerScenario('anim_car', {
  seed: 27,
  setup: () => {
    const a = cast(6);
    cam([0, 2.9, 45.8], { dist: 24, elev: 22, yaw: -24, fov: 46, aim: 0.4 });
    const spots = [[-8.6, 42.4], [-4.2, 47.4], [0.6, 42.6], [5.0, 47.6], [9.4, 43.0], [-12.0, 48.2]];
    a.forEach((k, i) => {
      const sp = spots[i];
      k.showStick(i === 2);
      k.at(sp[0], sp[1], faceCam(sp[0], sp[1], (i - 2.5) * 0.14));
      k.setCycle(7.4, [
        { t: 0.0, do: (x) => { x.restClip = x.idleClip; x.anim.play(x.idleClip, { fade: 0.2 }); x.flavour(x.fidgets[0]); } },
        { t: 1.5, do: (x) => x.act('freeze', { state: 'freeze', lock: 1.8 }) },
        { t: 3.35, do: (x) => x.goTo(sp[0] < 0 ? -16.5 : 16.5, sp[1] + (sp[0] < 0 ? -2 : 2), { speed: T.run.speed, hard: true }) },
        { t: 4.7, do: (x) => { x.lookAt(0, 20); x.restClip = x.stick ? 'curb_wait' : 'idle_slouch'; x.anim.play(x.restClip, { fade: 0.25 }); } },
        { t: 6.7, do: (x) => { x.at(sp[0], sp[1], faceCam(sp[0], sp[1], 0)); x.restClip = x.idleClip; } },
      ], 1.62);
    });
  },
  settle: 0.05,
});

/** anim_argue — two kids nose to nose, and behind them the called shot nobody is watching. */
registerScenario('anim_argue', {
  seed: 28,
  setup: () => {
    const a = cast(4);
    cam([-0.4, 2.8, 46.4], { dist: 19.5, elev: 20, yaw: -30, fov: 43, aim: 0.4 });
    const [p, q, r, s] = a;
    p.at(-2.0, 45.2, YAW(4.0, 1.1)); q.at(2.0, 46.3, YAW(-4.0, -1.1));
    p.setCycle(6, [{ t: 0, do: (x) => x.anim.play('argue_jab', { fade: 0.2 }) }], 0.9);
    q.setCycle(6, [{ t: 0, do: (x) => x.anim.play('argue_appeal', { fade: 0.2 }) }], 1.6);
    r.giveStick(); r.showStick(true);
    r.at(-10.0, 53.5, faceCam(-10.0, 53.5, -0.25));
    r.restClip = 'stance';
    r.setCycle(3.6, [
      { t: 0.0, do: (x) => x.act('point', { state: 'point' }) },
      { t: 2.3, do: (x) => x.anim.play('stance', { fade: 0.2 }) },
    ], 0.9);
    s.at(9.0, 52.4, faceCam(9.0, 52.4, -0.4));
    s.restClip = 'idle_slouch';
    s.setCycle(6, [{ t: 0, do: (x) => x.anim.play('idle_slouch', { fade: 0.2 }) }], 1.4);
  },
  settle: 0.6,
});

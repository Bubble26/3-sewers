/**
 * baserunning.js — THE KIDS BETWEEN THE BASES.
 * ============================================================================
 * src/game/core.js decides who is safe. This file is why you believe it.
 *
 * The rules core resolves a batted ball into a list of MOVES — `{ id, from, to }`,
 * lead runner first — and a `margin` in abstract units for the race to the stoop.
 * It knows nothing about feet, seconds, chalk or dust. This piece turns each of
 * those moves into a body on the street, and it holds itself to one promise:
 *
 *      THE CORE OWNS THE VERDICT. THIS FILE OWNS THE ARRIVAL.
 *      If the core says he was out by a stride, he must be out by a stride
 *      ON SCREEN, in the frame, at the moment the ball reaches the bag.
 *
 * That is not a dice roll dressed up. The throw is a real object flying to a real
 * bag (src/game/fielding.js owns it); this file measures the ball's own time to
 * arrival every frame and governs the runner's legs — inside a ±20% band, which is
 * the difference between a kid pressing and a kid coasting — so that the two land
 * on the correct side of each other. Outside that band the legs win and the frame
 * tells the truth about the geometry instead. `__SB.app.baserunning.debug` prints
 * both arrival times and the gap in frames, so "was that close play honest" is a
 * number a critic can read rather than an opinion.
 *
 * ── the six things this file owns ───────────────────────────────────────────
 *
 * 1. THE BREAK. Contact, the stick goes down, and the box empties. Every kid's
 *    first step is his own: the lag is off his card, and a fly ball freezes the
 *    runners where a grounder launches them.
 *
 * 2. HOLDING AND TAGGING UP. On anything in the air the runners take three steps,
 *    stop dead, and look up. Caught, they scramble back and touch the bag, bluff
 *    two steps and get waved back — which is what actually happens on a shallow
 *    fly, and the core is honest that it does not score them.
 *
 * 3. THE TURN AT FIRST. A runner does not corner; he bananas. Every path through
 *    a bag he is not stopping at bows OUT away from the diamond a full body width
 *    before the bag and cuts back through it, and on a clean single he rounds it,
 *    pulls up hard in a cloud of his own dust, and looks back over his shoulder.
 *    A race to the stoop is different and looks different: he runs THROUGH it in a
 *    straight line, because nobody has ever slid into first and been right.
 *
 * 4. THE SLIDE. Feet-first into a chalk cross, or head-first if that is his quirk,
 *    with a rooster tail of road dust that hangs, and a smear left on the asphalt
 *    that is still there two plays later.
 *
 * 5. THE DIVE BACK. Off the bag, a throw behind him, and he is on his belly with
 *    one hand on the chalk.
 *
 * 6. THE ARGUMENT. Anything inside two frames is a `run:close`, and `run:argue`
 *    goes out with the gap, the bag and both kids' names so the booth and the
 *    rules piece can make a scene of it. The runner is already up on one knee
 *    pointing at the bag when it fires.
 *
 * ── house rules for anyone editing this file ────────────────────────────────
 * • This file NEVER decides a play. It reads `play.moves` and `play.result` and
 *   stages them. If you catch yourself writing `if (margin <` here, stop.
 * • Every random draw is from a PRIVATE RNG (`brng`). Staging randomness must not
 *   touch the sim's deterministic draw order or `tools/soak.mjs` stops replaying.
 * • Bodies are borrowed, never built: src/chars/players.js owns the rigs and is
 *   NOT edited by this piece. It also keeps a placeholder runner of its own for
 *   the days this slot was empty — it is not empty any more, so this file writes
 *   the runners' positions every frame at system order 18, BEFORE players.js
 *   steers, and the placeholder never reaches a rendered frame.
 * • Every beat is announced on src/core/bus.js. Audio, fx, the booth and the
 *   rules piece hang off those events; nothing in here calls them directly.
 * ========================================================================= */

import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { provide, gameplay } from './plugins.js';
import { LAYOUT } from './layout.js';
import { liveMatch } from './core.js';
import { headingTo } from '../chars/anim.js';
import { CLIPS } from '../chars/clips.js';
import { CHALK, INK, PAVEMENT, mix } from '../render/palette.js';
import { makeCanvas, canvasTexture, texMat, roadHeight } from '../world/props.js';

/* ============================================================================
   0. TUNING
   ---------------------------------------------------------------------------
   These belong in T.run in src/core/tuning.js and they are not there, because
   this piece owns exactly one file and tuning.js is not it. Everything that
   ALREADY exists in T.run / T.field is read from there; only the constants this
   piece invented live here, in one block, so lifting them across later is a cut
   and a paste. Flagged in the report as the known weakness it is — the same
   compromise src/game/fielding.js records at the top of its own FT block.
   ========================================================================= */
export const RT = {
  /**
   * LEGS. The core's SPD runs 0..9 on PLAY_SCALE (roster.js), and our sixteen
   * average 5.8. This maps that onto feet per second: the slowest kid on the
   * block covers the 35 feet to the stoop in 2.3 s and the fastest in 1.7 s,
   * which is six tenths of daylight between Tiny and Speed over one base — big
   * enough that a player learns who is quick without being told.
   */
  speedBase: 12.7,
  speedPerSpd: 0.85,          // SPD 0 -> 12.7 ft/s, SPD 9 -> 20.3 ft/s
  accel: 33.0,                // out of the box, and it is the slowest part of a run
  decel: 26.0,
  trotScale: 0.52,            // a home-run trot, and the walk back to a bag
  /** How long before he believes it. Quick kids are also quick to go. */
  lagBase: 0.235,
  lagPerSpd: 0.0135,          // SPD 9 -> 0.11 s, SPD 0 -> 0.235 s
  lagLine: 0.16,              // a liner freezes everybody for an extra beat
  lagFly: 0.30,               // ... and a fly ball for longer still

  /** The banana. A runner rounding a bag bows out this far, a body width. */
  bellyOut: 3.9,
  bellyAt: 0.58,              // where along the approach leg the bow sits
  exitBow: 0.42,              // and how much of it survives onto the next leg
  overrun: 9.6,               // feet past the stoop on a race he ran through
  roundOut: 13.0,             // feet up the line on a single he rounded

  /** The slide. */
  slideDecel: 24.0,           // ft/s^2 on his hip — friction, not braking. At 20 ft/s
                              // that is 8.3 feet of skid over 0.83 s, which is a slide;
                              // half of it is a stumble and twice is a toboggan.
  slideMin: 4.2,              // never start one shorter than this
  slideMax: 11.0,
  slideWindow: 1.15,          // he commits this many seconds before the throw lands
  diveBack: 0.42,             // seconds of a dive back to the bag

  /** The governor — see the header. */
  govLo: 0.80,
  govHi: 1.22,
  govEase: 4.5,               // how fast the multiplier is allowed to move, per second
  outBy: 0.105,               // seconds the runner arrives AFTER the ball, on an out
  safeBy: 0.085,              // ... and before it, when he is safe
  closeGap: 0.12,             // inside this and the whole street has an opinion
  arguePause: 1.5,            // how long the argument holds the bag

  /**
   * How far a runner's shoulders are allowed to open toward the lens.
   *
   * Home to first runs 31 degrees off the lens axis and away from it, so a runner
   * legging one out is seen from BEHIND — and a kid seen dead astern is, in
   * src/game/layout.js's own words about the catcher, "a coloured trapezoid with
   * a cap on it". That file yaws the catcher 82 degrees off his facing for
   * exactly this reason and says so. This is the same cheat, a quarter as big:
   * the shoulders open toward the camera in proportion to how directly he is
   * running away, so a sprint up the line shows a profile, an arm and a face.
   * The stage cheats; §17.6 says it in as many words.
   */
  runYaw: 0.60,               // radians, the most the shoulders may be argued with
  threeQuarter: 1.02,         // radians (58 deg) of separation we want from the lens axis

  /** Life on a bag between pitches. */
  lead: 4.2,                  // feet off the chalk once the pitcher commits
  leadCreep: 1.6,             // ... and how much further he steals while nobody looks
  fidgetEvery: [2.4, 5.6],

  /** The lane he is running in — see §2. */
  laneStep: 2.6,              // feet per segment of the chalked base path
  laneWidth: 0.95,            // ... and how wide the chalk is
  bagInside: 2.6,             // feet to the crown side of the bag a race passes on

  /** Dust. */
  dustSlide: 30,              // puffs in a slide's rooster tail
  dustStop: 16,
  dustStep: 2,
  dustEvery: 0.105,           // seconds between puffs off a sprinting kid's heels
  smearLife: 4.6,             // seconds a slide's smear stays on the road
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Staging randomness. Private on purpose — see the house rules above. */
const brng = new RNG(70918);

/* ============================================================================
   1. THE DIAMOND, AS A PLACE TO RUN
   ---------------------------------------------------------------------------
   src/game/layout.js owns where the bases are and this file never invents a
   coordinate. What it adds is the shape of the running itself.

   THE STAGE IS SHALLOW AND THAT DECIDES THE PATHS. A kid's screen height comes
   from depth and his screen POSITION mostly from x, so a leg that spends its
   length in z is a leg that happens on one spot of the frame. Measured on the
   solved FIELD framing at 1600x900: the road runs about 22 px per foot of x at
   the bases and about 7 px per foot of z. Every leg of this kite therefore has
   to be read left-to-right, and happily every leg of it is:

       home  -> first    +18.4 x, +30 z    400 px across, 207 px up
       first -> second   -18.0 x, +30 z    390 px across, 207 px up
       second-> third    -14.0 x, -29 z    304 px across, 200 px down
       third -> home     +13.6 x, -31 z    295 px across, 214 px down

   Nobody runs into the frame. That is the layout's kite doing this piece a
   favour, and it is why the bases are not re-solved here.
   ========================================================================= */

const BAGS = [LAYOUT.FIRST, LAYOUT.SECOND, LAYOUT.THIRD, LAYOUT.HOME];
const BAG_TAG = ['1B', '2B', '3B', 'home'];
const BAG_WORD = ['FIRST', 'SECOND', 'THIRD', 'HOME'];
const TAG_INDEX = { '1B': 0, '2B': 1, '3B': 2, home: 3 };

/** The middle of the kite: which way "out of the diamond" points, per leg. */
const HUB = {
  x: (LAYOUT.HOME.x + LAYOUT.FIRST.x + LAYOUT.SECOND.x + LAYOUT.THIRD.x) / 4,
  z: (LAYOUT.HOME.z + LAYOUT.FIRST.z + LAYOUT.SECOND.z + LAYOUT.THIRD.z) / 4,
};

/** Where a runner starts. -1 is the batter, who starts in his own chalk box. */
function startAt(from) {
  if (from < 0) return { x: LAYOUT.PLATE_BOX.x, z: LAYOUT.PLATE_BOX.z };
  return BAGS[from];
}

/** Unit normal to a leg, pointing away from the middle of the diamond. */
function outward(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz) || 1;
  let nx = dz / L, nz = -dx / L;
  const mx = (ax + bx) / 2 - HUB.x, mz = (az + bz) / 2 - HUB.z;
  if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
  return { nx, nz };
}

/** Where along a path a body already standing somewhere belongs. */
function nearestS(built, p) {
  const N = 48;
  let best = 0, bd = 1e9;
  for (let i = 0; i <= N; i++) {
    const u = (i / N) * 0.34;                 // only ever the first third of a leg
    const q = built.curve.getPointAt(u);
    const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bd) { bd = d; best = u; }
  }
  return bd > 90 ? 0 : best * built.len;      // ten feet out and he is not on this path
}

/**
 * The path a runner actually takes, as a curve rather than a set of corners.
 *
 * `tail` is what happens after the last bag: 'stop' (he is staying), 'through'
 * (the race to the stoop — straight on, no turn, because a kid who slides into
 * first has been beaten by his own idea), or 'round' (the banana: out past the
 * bag toward second, then hard on the brakes and a look back over the shoulder).
 *
 * Every intermediate bag gets a bow OUT of the diamond before it and a smaller
 * one after it, which is the whole difference between a runner and a waypoint
 * follower. The bows are why the curve stays outside the chalk line the way a
 * real base path is worn outside it.
 */
function buildPath(from, to, tail, opt = {}) {
  const a = startAt(from);
  const pts = [new THREE.Vector3(a.x, 0, a.z)];
  let px = a.x, pz = a.z;
  const marks = [];

  for (let i = from + 1; i <= to; i++) {
    const bag = BAGS[i];
    const last = i === to;
    const bows = !last || tail === 'round';
    if (bows) {
      const { nx, nz } = outward(px, pz, bag.x, bag.z);
      pts.push(new THREE.Vector3(
        px + (bag.x - px) * RT.bellyAt + nx * RT.bellyOut,
        0,
        pz + (bag.z - pz) * RT.bellyAt + nz * RT.bellyOut,
      ));
    }
    pts.push(new THREE.Vector3(bag.x, 0, bag.z));
    marks.push({ base: i, at: pts.length - 1 });
    if (bows) {
      // where he is heading next: the following bag, or straight up the line
      const nxt = i + 1 <= 3 ? BAGS[Math.min(i + 1, 3)] : BAGS[3];
      const { nx, nz } = outward(bag.x, bag.z, nxt.x, nxt.z);
      const run = last ? (opt.round || RT.roundOut) : Math.hypot(nxt.x - bag.x, nxt.z - bag.z) * 0.22;
      const ux = (nxt.x - bag.x), uz = (nxt.z - bag.z);
      const L = Math.hypot(ux, uz) || 1;
      pts.push(new THREE.Vector3(
        bag.x + (ux / L) * run + nx * RT.bellyOut * RT.exitBow,
        0,
        bag.z + (uz / L) * run + nz * RT.bellyOut * RT.exitBow,
      ));
    }
    px = bag.x; pz = bag.z;
  }

  if (tail === 'through') {
    // Straight on, in the direction he arrived, which is the only honest way to
    // leave first base on a play he is trying to beat.
    //
    // And down the CROWN side of it. The kid covering the bag came in off the
    // gutter and holds it from there; the runner takes the middle of the road.
    // That is period-true — on this block first base is a fender and you take the
    // side that has not got a Ford parked on it — and it is the only thing that
    // keeps the two of them out of one screen column. Measured on the line, the
    // runner and the first baseman landed 8 px apart at 1600x900 and fused into a
    // single body, which is the exact fault src/game/layout.js `separate()`
    // exists to prevent for everybody standing still.
    const bag = BAGS[to];
    const start = pts[0];
    const { nx, nz } = outward(start.x, start.z, bag.x, bag.z);
    const last = pts[pts.length - 1];
    last.set(bag.x - nx * RT.bagInside, 0, bag.z - nz * RT.bagInside);
    const ux = last.x - start.x, uz = last.z - start.z;
    const L = Math.hypot(ux, uz) || 1;
    pts.push(new THREE.Vector3(last.x + (ux / L) * RT.overrun, 0, last.z + (uz / L) * RT.overrun));
  }

  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const len = curve.getLength();
  // arc length of each bag, found by sampling: the curve passes exactly through
  // every bag point, so the nearest sample is the bag to within a few inches
  const N = 220;
  for (const m of marks) {
    const p = pts[m.at];
    let best = 0, bd = 1e9;
    for (let i = 0; i <= N; i++) {
      const q = curve.getPointAt(i / N);
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) { bd = d; best = i / N; }
    }
    m.s = best * len;
  }
  return { curve, len, marks };
}

/* ============================================================================
   2. DUST AND THE MARKS IT LEAVES
   ---------------------------------------------------------------------------
   DESIGN-BIBLE §12 and BYB §5: cartoon dust is a SHAPE, not a haze. A soft alpha
   fog under a sliding kid reads as a rendering artefact; four chunky ink-outlined
   puff lobes that bloom, drift and pop read as a slide. So the dust here is drawn
   the way the kids are drawn — flat fill, ink outline — and it is the same
   material family as the road it comes off (§2.1 blockCrown lifted toward chalk,
   which lands at L* 80 and stays under the L* 84 ceiling for anything the ball
   crosses).

   The smear is the other half and it is the half a still frame needs: a slide
   leaves four feet of scuffed asphalt behind it that is still on the road when
   the argument starts.
   ========================================================================= */

const DUST_HI = mix(PAVEMENT.blockCrown, CHALK, 0.46);
const DUST_MID = mix(PAVEMENT.belgianBlock, CHALK, 0.34);
const DUST_LO = mix(PAVEMENT.asphaltSun, CHALK, 0.12);

function puffTexture() {
  const { c, g } = makeCanvas(128, 128);
  const lobes = [[62, 70, 30], [38, 58, 22], [88, 56, 24], [60, 40, 21], [44, 86, 17], [86, 84, 16]];
  // ink first, thin, so every lobe carries the outline §2.6 asks of everything else
  // without a 40 px puff turning into a black bead
  g.fillStyle = '#2a1d1a';
  for (const [x, y, r] of lobes) { g.beginPath(); g.arc(x, y, r + 3.0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ffffff';
  for (const [x, y, r] of lobes) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  // one bite of shade along the bottom so the puff has a top and a bottom
  g.globalAlpha = 0.34;
  g.fillStyle = '#7e6a52';
  g.beginPath(); g.ellipse(62, 88, 36, 14, 0, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 1;
  return canvasTexture(c);
}

function smearTexture() {
  const { c, g } = makeCanvas(256, 64);
  const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.30, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.86, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  const R = new RNG(3391);
  // seven dragged fibres, not one bar: a hip on asphalt scrapes in streaks
  for (let i = 0; i < 7; i++) {
    const y = 8 + i * 7.2 + R.range(-2, 2);
    g.globalAlpha = R.range(0.45, 1);
    g.fillRect(R.range(0, 40), y, 256 - R.range(0, 40), R.range(2.2, 5.4));
  }
  g.globalAlpha = 1;
  return canvasTexture(c);
}

class Dust {
  constructor(scene, count = 190) {
    this.n = count;
    const geo = new THREE.PlaneGeometry(1, 1);
    // A CUTOUT, not a transparency. Alpha-tested with depth written means the
    // cloud sorts against the kids in it: dust in front of a runner hides him and
    // dust behind him does not — which is the difference between a cloud and a
    // sheet of cotton wool pinned over the play. (Drawn transparent with
    // depthWrite off, round 2 of this piece painted every puff over the runner
    // it belonged to and the runner could not be found in the frame at all.)
    const mat = new THREE.MeshBasicMaterial({
      map: puffTexture(), transparent: false, alphaTest: 0.45, depthWrite: true,
      side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.name = 'run_dust';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    scene.add(this.mesh);
    this.items = Array.from({ length: count }, () => ({
      life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1, roll: 0, spin: 0,
    }));
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
    this.dirty = true;

    // the smear pool: flat decals that outlive the cloud
    const sgeo = new THREE.PlaneGeometry(1, 1);
    sgeo.rotateX(-Math.PI / 2);
    this.smearMat = new THREE.MeshBasicMaterial({
      map: smearTexture(), transparent: true, depthWrite: false, opacity: 0.5,
      color: mix(PAVEMENT.asphaltSun, CHALK, 0.42), toneMapped: false,
    });
    this.smears = [];
    this.byId = new Map();
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(sgeo, this.smearMat.clone());
      m.visible = false; m.renderOrder = 4;
      scene.add(m);
      this.smears.push({ mesh: m, life: 0 });
    }
  }

  /** n puffs at a point, thrown along `dir` (a Vector3 or null for a plain bloom). */
  burst(x, y, z, n, power = 4.4, dir = null, size = 1.15, hang = 1) {
    let made = 0;
    for (const it of this.items) {
      if (it.life > 0) continue;
      it.max = brng.range(0.46, 0.86) * hang;
      it.life = it.max;
      it.pos.set(x + brng.range(-0.9, 0.9), y + brng.range(0, 0.9), z + brng.range(-0.9, 0.9));
      const a = brng.range(0, Math.PI * 2), r = brng.range(0.25, 1) * power;
      it.vel.set(Math.cos(a) * r * 0.7, brng.range(0.35, 1.05) * power * 0.55, Math.sin(a) * r * 0.7);
      if (dir) it.vel.addScaledVector(dir, brng.range(0.35, 1.0) * power * 0.62);
      it.size = size * brng.range(0.48, 1.85);
      it.roll = brng.range(0, Math.PI * 2);
      it.spin = brng.range(-2.2, 2.2);
      it.tone = brng.next();
      if (++made >= n) break;
    }
    this.dirty = true;
  }

  /**
   * The mark a hip leaves. `ax,az -> bx,bz` in world feet.
   *
   * `id` re-uses a slot, so a slide that is still happening GROWS its own smear
   * instead of laying down forty overlapping ones.
   */
  smear(ax, az, bx, bz, width = 2.5, id = null) {
    let slot = (id !== null && this.byId.get(id)) || this.smears.find((s) => s.life <= 0) || this.smears[0];
    if (id !== null) this.byId.set(id, slot);
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.6) return;
    slot.life = RT.smearLife; slot.max = RT.smearLife;
    const m = slot.mesh;
    m.visible = true;
    // The geometry is already lying down (`sgeo.rotateX(-PI/2)` in the ctor), so the
    // mesh needs a HEADING and nothing else. Setting rotation.x here as well —
    // which the first draft did — stands the decal on its edge, where it is one
    // pixel wide and invisible, which is exactly how it looked.
    m.position.set((ax + bx) / 2, roadHeight((ax + bx) / 2) + 0.055, (az + bz) / 2);
    m.rotation.set(0, Math.atan2(bx - ax, bz - az) - Math.PI / 2, 0);
    m.scale.set(len, 1, width);
    m.material.opacity = 0.52;
  }

  update(dt, camQuat) {
    let i = 0;
    let any = false;
    for (const it of this.items) {
      if (it.life > 0) {
        any = true;
        it.life -= dt;
        it.vel.y -= 5.6 * dt;
        it.vel.multiplyScalar(1 - 2.35 * dt);
        it.pos.addScaledVector(it.vel, dt);
        const g = roadHeight(it.pos.x) + 0.25;
        if (it.pos.y < g) { it.pos.y = g; it.vel.y = Math.abs(it.vel.y) * 0.18; }
        it.roll += it.spin * dt;
        const u = 1 - it.life / it.max;                 // 0 fresh -> 1 gone
        // bloom fast, hang, then pop out: chunky dust does not dissolve
        const s = it.size * (u < 0.22 ? 0.35 + (u / 0.22) * 0.85 : 1.2 - Math.pow((u - 0.22) / 0.78, 2.4) * 1.2);
        this.dummy.position.copy(it.pos);
        this.dummy.quaternion.copy(camQuat);
        this.dummy.rotateZ(it.roll);
        this.dummy.scale.setScalar(Math.max(0.001, s * 1.32));
        this.col.setHex(it.tone < 0.30 ? DUST_LO : it.tone < 0.66 ? DUST_MID : DUST_HI);
        this.mesh.setColorAt(i, this.col);
      } else {
        this.dummy.position.set(0, -999, 0);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(0.001);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i++, this.dummy.matrix);
    }
    if (any || this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
      this.dirty = any;
    }
    for (const s of this.smears) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const u = clamp(s.life / s.max, 0, 1);
      s.mesh.material.opacity = 0.52 * Math.pow(u, 0.75);
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  clear() {
    for (const it of this.items) it.life = 0;
    for (const s of this.smears) { s.life = 0; s.mesh.visible = false; }
    this.byId.clear();
    this.dirty = true;
  }
}

/**
 * The chevrons a runner is running along.
 *
 * This is the piece's answer to the one readability problem a shallow stage
 * hands it: thirteen kids are on screen, the base paths are not painted, and a
 * kid at 15% of frame height sprinting across a busy street is — measured, in
 * round 1 of this piece — genuinely hard to find. BYB never had the problem
 * because BYB had a green field with four white bags on it and nine kids.
 *
 * §11 allows exactly one material for a mark on this roadway, so the answer is
 * chalk: three to seven fresh chevrons scuffed into the asphalt IN FRONT of the
 * runner, pointing at the bag he is going to, brightening in a wave that runs
 * toward it. They are drawn ahead of him and never behind, so they read as
 * "he is going there" rather than as a trail, and they die the moment he
 * arrives.
 *
 * The fade is done in COLOUR rather than in alpha — the chevron is lerped from
 * chalk toward the roadway it is drawn on — because an InstancedMesh gets a
 * per-instance colour for free and a per-instance alpha only through a shader
 * patch. Chalk scuffing back into the road is also what actually happens.
 */
function laneTexture() {
  const { c, g } = makeCanvas(128, 40);
  const R = new RNG(2207);
  const bar = (w, col, alpha) => {
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'butt';
    g.beginPath();
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      g.lineTo(u * 128, 20 + R.range(-2.6, 2.6));
    }
    g.stroke();
    g.restore();
  };
  // ink under, chalk over — one quad carrying the two-sided read of §2.5
  bar(26, '#2a1d1a', 0.92);
  bar(13, '#f6f0e2', 1);
  // the chalk is not new: a couple of scuffs through it
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 1;
  for (let i = 0; i < 3; i++) {
    const x = R.range(6, 118);
    g.fillRect(x, 0, R.range(2, 6), 40);
  }
  g.globalCompositeOperation = 'source-over';
  return canvasTexture(c);
}

class Lane {
  constructor(scene, count = 132) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: laneTexture(), transparent: true, depthWrite: false,
      alphaTest: 0.40, toneMapped: false, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.name = 'run_lane';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    scene.add(this.mesh);
    this.n = count;
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
    this.road = new THREE.Color(PAVEMENT.asphaltWarm);
    this.chalkC = new THREE.Color(CHALK);
    this.t = 0;
  }

  /**
   * Lay this frame's chalk out for every runner who is going somewhere.
   *
   * The mark is a LINE, not a row of arrows. Round 3 of this piece drew chevrons
   * and they died on the ground plane: this camera squashes the road 3.4 to 1, so
   * a chevron 3 ft deep is 20 px of bracket and reads as debris. A line does not
   * care — it is the same line however hard you foreshorten it — and a chalked
   * base path is what a block actually puts on a road.
   *
   * It is drawn along the runner's OWN curve, which means it draws the banana:
   * the bow out of the diamond before the bag and the cut back through it. That
   * is the single most legible thing this piece owns, because it turns a kid
   * running away from the lens into a shape across the frame.
   *
   * The fade is done in TINT and SIZE and never in alpha, because a per-instance
   * colour multiplies the texture and the texture carries its own ink outline:
   * tint it dark and the chalk goes to road while the ink stays ink, which turns
   * a chalk mark into a painted road stripe.
   */
  update(dt, runners) {
    this.t += dt;
    let i = 0;
    for (const r of runners) {
      if (!r.path) continue;
      const power = r.lanePower ?? 0;
      if (power <= 0.02) continue;
      const end = r.bagS();
      const step = RT.laneStep;
      const first = Math.max(1.4, Math.min(r.s - 12.0, end - step * 20));
      for (let k = 0; k < 26 && i < this.n; k++) {
        const sv = first + k * step;
        if (sv > end - 0.4) break;
        const u = clamp(sv / r.path.len, 0, 1);
        const q = r.path.curve.getPointAt(u);
        const tg = r.path.curve.getTangentAt(u);
        const ahead = sv > r.s;
        const gone = clamp((r.s - sv) / 13, 0, 1);
        this.dummy.position.set(q.x, roadHeight(q.x) + 0.085, q.z);
        this.dummy.rotation.set(0, Math.atan2(tg.x, tg.z) + Math.PI / 2, 0);
        this.dummy.scale.set(step * 1.16, 1, RT.laneWidth * (ahead ? 1 : 0.94 - 0.3 * gone) * (0.35 + 0.65 * power));
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        const wave = 0.5 + 0.5 * Math.sin(this.t * 5.6 - (sv - first) * 0.30);
        const bright = (ahead ? 0.84 + 0.16 * wave : 0.80 - 0.18 * gone) * (0.30 + 0.70 * power);
        this.col.copy(this.road).lerp(this.chalkC, clamp(bright, 0, 1));
        this.mesh.setColorAt(i, this.col);
        i++;
      }
    }
    for (; i < this.n; i++) {
      this.dummy.position.set(0, -999, 0);
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.update(0, []); }
}

/* ============================================================================
   3. THE LIVE BAG
   ---------------------------------------------------------------------------
   §11 says every readable thing is a depicted physical object with a nameable
   material, and there is exactly one material available on a roadway: chalk.
   So the bag a runner is racing to gets CHALKED FRESH — somebody has just gone
   over last week's cross with a new piece — and it fades back to the layout's
   scuffed mark when the play is dead. One object, no panel, no ring of light.
   ========================================================================= */

function crossTexture() {
  const { c, g } = makeCanvas(256, 256);
  const R = new RNG(881);
  const stroke = (x0, y0, x1, y1, w, col, alpha) => {
    g.save();
    g.globalAlpha = alpha;
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath();
    const n = 9;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const X = x0 + (x1 - x0) * u + R.range(-3, 3);
      const Y = y0 + (y1 - y0) * u + R.range(-3, 3);
      if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    }
    g.stroke();
    g.restore();
  };
  // ink under, chalk over — the two-sided read every mark in this game carries
  stroke(52, 52, 204, 204, 26, '#2a1d1a', 0.9);
  stroke(204, 52, 52, 204, 26, '#2a1d1a', 0.9);
  stroke(52, 52, 204, 204, 14, '#f6f0e2', 1);
  stroke(204, 52, 52, 204, 14, '#f6f0e2', 1);
  // ... and the ring somebody scuffed round it with the side of his shoe when
  // the play started. Dashed, because a whole circle is a UI element and a
  // broken one is a kid with a piece of chalk.
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2, a1 = a0 + Math.PI * 2 / 14 * 0.56;
    const R = 112;
    const x0 = 128 + Math.cos(a0) * R, y0 = 128 + Math.sin(a0) * R;
    const x1 = 128 + Math.cos(a1) * R, y1 = 128 + Math.sin(a1) * R;
    stroke(x0, y0, x1, y1, 15, '#2a1d1a', 0.85);
    stroke(x0, y0, x1, y1, 8, '#f6f0e2', 1);
  }
  return canvasTexture(c);
}

class LiveBag {
  constructor(scene) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const tex = crossTexture();
    this.marks = BAGS.map((b) => {
      const m = new THREE.Mesh(geo, texMat(tex, {
        transparent: true, depthWrite: false, opacity: 0, lift: 0.72,
      }));
      m.position.set(b.x, roadHeight(b.x) + 0.075, b.z);
      m.scale.set(8.6, 1, 8.6);
      m.rotation.y = brng.range(-0.16, 0.16);
      m.renderOrder = 5;
      m.visible = false;
      m.name = 'live_bag';
      scene.add(m);
      return { mesh: m, on: 0, want: 0, pulse: brng.range(0, 6) };
    });
  }

  set(i, want) { if (this.marks[i]) this.marks[i].want = want; }
  clear() { for (const m of this.marks) { m.want = 0; m.on = 0; m.mesh.visible = false; m.mesh.material.opacity = 0; } }

  update(dt) {
    for (const m of this.marks) {
      m.pulse += dt;
      m.on += clamp(m.want - m.on, -dt * 2.4, dt * 5.0);
      const a = m.on * (0.80 + 0.20 * Math.sin(m.pulse * 5.2));
      m.mesh.visible = a > 0.012;
      m.mesh.material.opacity = a;
      m.mesh.scale.setScalar(1);
      const s = 8.6 * (1 + 0.05 * m.on * Math.sin(m.pulse * 5.2));
      m.mesh.scale.set(s, 1, s);
    }
  }
}

/* ============================================================================
   4. ONE RUNNER
   ---------------------------------------------------------------------------
   A borrowed body, a curve, a speed off his card, and a small explicit state
   machine — because "the runner is doing something" is not a state anybody can
   debug on a contact sheet.

       set     standing on the chalk between pitches
       lead    off the bag, weight on the balls of his feet
       hold    broke, stopped, looking up at a ball in the air
       run     travelling the path
       slide   feet-first (or head-first) into the last bag
       back    trotting back to a bag he over-ran, or diving into one
       stand   arrived, on it, and letting everybody know
       out     beaten, and not happy about it
       score   he touched the manhole
   ========================================================================= */

class Runner {
  constructor(id, kid, from, to, ctx) {
    this.id = id;
    this.kid = kid;
    this.from = from;
    this.to = to;
    this.at = from;                 // the last bag he has actually touched
    this.st = 'set';
    this.t = 0;
    this.v = 0;
    this.s = 0;
    this.gov = 1;
    this.stepD = 0;
    this.p = { x: 0, z: 0 };
    this.faceGoal = 0;
    this.snapFace = true;
    this.lead = 0;
    this.fidgetIn = brng.range(RT.fidgetEvery[0], RT.fidgetEvery[1]);
    this.slideFrom = null;
    this.deadline = null;           // play-time this file wants him on the bag
    this.touchedAt = null;          // play-time he actually got there
    this.tail = 'stop';
    this.spd = ctx.spd(id);
    this.quirk = ctx.quirk(id);
    this.base = clamp(RT.speedBase + this.spd * RT.speedPerSpd, 11.5, 21.5);
    this.headfirst = this.quirk === 'headfirst';
    this.eager = this.quirk === 'extra';
    const p0 = startAt(from);
    this.p.x = p0.x; this.p.z = p0.z;
    this.aimAt(BAGS[Math.min(3, Math.max(0, from + 1))]);
  }

  get name() { return liveMatch.kidName ? liveMatch.kidName(this.id) : this.id; }
  get here() { return this.at < 0 ? 'plate' : BAG_TAG[this.at]; }
  get bagTag() { return BAG_TAG[clamp(this.to, 0, 3)]; }

  aimAt(b) { if (b) this.faceGoal = headingTo(b.x - this.p.x, b.z - this.p.z); }

  /** Put him where the chalk is, in the pose of a kid who has just got there. */
  settleOnBase(i) {
    const b = BAGS[i];
    this.at = i; this.to = i; this.st = 'set';
    this.p.x = b.x; this.p.z = b.z;
    this.v = 0; this.s = 0; this.lead = 0; this.path = null;
    this.aimAt(BAGS[Math.min(3, i + 1)]);
    this.snapFace = true;
    if (this.kid) { this.kid.lock = 0; this.kid.glide = 0; this.kid.anim.play('ready', { fade: 0.2 }); }
  }

  /* --- the break ---------------------------------------------------------- */

  /**
   * He is going. `tail` decides what the last bag means to him.
   *
   * `lag` is his own reaction, off his own card, plus whatever the ball in the
   * air is worth: a grounder launches a block and a fly ball freezes it, and the
   * difference between those two is most of what baserunning looks like.
   */
  send(to, tail, lag) {
    if (to <= this.at && this.st !== 'hold') return;
    this.to = to;
    this.tail = tail;
    // Speed's quirk is `extra` and the core pays her a base for it 40% of the time
    // (T.play.run.extraOdds). This is what that looks like from the kerb: she takes
    // half as long to decide and she rounds the bag half again as wide, which is
    // why she is already three strides up the line when everybody else is looking
    // for the ball.
    const built = buildPath(this.at, to, tail, { round: RT.roundOut * (this.eager ? 1.5 : 1) });
    this.path = built;
    // He is not standing ON the bag: he has a lead, or he broke three steps and
    // stopped on a fly. Start him where his feet actually are, or the frame he
    // breaks on is a frame where he teleports backwards onto the chalk.
    this.s = nearestS(built, this.p);
    this.st = 'run';
    this.wait = lag;
    this.slid = false;
    this.turned = false;
    this.touchedAt = null;
    this.deadline = null;
    this.gov = 1;
    if (this.kid) {
      this.kid.lock = 0;
      this.kid.glide = 0;
      this.kid.setFace('determined', 1.6);
      this.kid.runDist = brng.range(0, 3);
      this.kid._steps = undefined;
    }
    bus.emit('run:break', {
      who: this.id, name: this.name, from: this.at, to,
      base: BAG_WORD[clamp(to, 0, 3)], lag: +lag.toFixed(2), speed: +this.base.toFixed(1),
    });
  }

  /**
   * Three steps and stop: there is a ball in the air and nobody is that brave.
   *
   * A LINE DRIVE and a FLY BALL are different holds and they have to look
   * different. On a liner he freezes for a beat and then goes, because a liner
   * to the outfield is down before anybody can get under it; on a fly he stops
   * dead, turns his face up, and waits to be told. `freeze` is how long the beat
   * lasts, and `null` means "until somebody catches it or it hits the road".
   */
  hold(spot, kind) {
    if (this.at < 0) return;
    this.st = 'hold';
    this.holdT = 0;
    this.lookSpot = spot;
    this.lead = Math.max(this.lead, 0);
    this.path = buildPath(this.at, Math.min(3, this.at + 1), 'stop');
    this.s = Math.max(0, this.lead);
    this.v = 0;
    this.looked = 0;
    this.wait = RT.lagLine * 0.5;
    this.freeze = kind === 'line' ? 0.42 : null;
    this.holdTo = kind === 'line' ? brng.range(3.4, 5.0) : brng.range(6.0, 9.5);
    bus.emit('run:hold', { who: this.id, name: this.name, kind, base: BAG_WORD[this.at], bag: BAG_TAG[this.at] });
  }

  /** Caught. Back to the chalk, touch it, bluff two steps, get waved back. */
  tagUp(caught) {
    if (this.st !== 'hold') return;
    this.st = 'back';
    this.backT = 0;
    this.backTo = { x: BAGS[this.at].x, z: BAGS[this.at].z };
    this.backDive = false;
    this.bluff = caught;
    bus.emit('run:tag_up', {
      who: this.id, name: this.name, base: BAG_WORD[this.at], bag: BAG_TAG[this.at], caught: !!caught,
    });
  }

  /** A throw behind him, and he is on his belly with one hand on the chalk. */
  diveBack(bag) {
    if (this.st === 'slide' || this.st === 'back') return;
    this.st = 'back';
    this.backT = 0;
    this.backDive = true;
    this.bluff = false;
    this.backTo = { x: BAGS[bag].x, z: BAGS[bag].z };
    this.at = bag; this.to = bag;
    if (this.kid) {
      this.kid.lock = 0;
      this.kid.act('dive', { state: 'dive', glide: false });
      this.kid.setFace('shock', 1.2);
      this.kid.faceGoal = headingTo(this.backTo.x - this.p.x, this.backTo.z - this.p.z);
    }
    bus.emit('run:dive_back', { who: this.id, name: this.name, bag: BAG_TAG[bag], base: BAG_WORD[bag] });
    bus.emit('run:slide', { pos: new THREE.Vector3(this.p.x, 0.2, this.p.z) });
  }

  /* --- the tick ----------------------------------------------------------- */

  step(dt, ctx) {
    this.t += dt;
    // how much of his chalk lane is still on the road (see Lane): full while he is
    // running, scuffed out over a beat after he gets there, because a mark that
    // vanishes on the frame he arrives takes the composition with it
    const live = this.st === 'run' || this.st === 'slide';
    this.lanePower = live ? 1 : Math.max(0, (this.lanePower ?? 0) - dt / 0.9);
    if (this.pend && ctx.now >= this.pend.at) { const f = this.pend.fn; this.pend = null; f(); }
    switch (this.st) {
      case 'set': this.stepSet(dt, ctx); break;
      case 'hold': this.stepHold(dt, ctx); break;
      case 'run': this.stepRun(dt, ctx); break;
      case 'slide': this.stepSlide(dt, ctx); break;
      case 'back': this.stepBack(dt, ctx); break;
      default: this.v = Math.max(0, this.v - RT.decel * dt); break;
    }
    this.place(dt, ctx);
  }

  /**
   * On the bag between pitches. He is never actually still: he takes a lead when
   * the pitcher commits, creeps another foot and a half while nobody is looking,
   * and one kid in the game calls the count out loud from second (`on_house`).
   */
  stepSet(dt, ctx) {
    const b = BAGS[this.at];
    if (this.at < 0 || !b) return;
    const want = ctx.leadOut ? RT.lead + (ctx.leadCreep ? RT.leadCreep : 0) : 0;
    this.lead += clamp(want - this.lead, -dt * 7.5, dt * 4.2);
    const nxt = BAGS[Math.min(3, this.at + 1)];
    const dx = nxt.x - b.x, dz = nxt.z - b.z;
    const L = Math.hypot(dx, dz) || 1;
    this.p.x = b.x + (dx / L) * this.lead;
    this.p.z = b.z + (dz / L) * this.lead;
    this.faceGoal = headingTo(dx, dz);
    this.v = 0;
    const k = this.kid;
    if (!k) return;
    this.fidgetIn -= dt;
    if (this.fidgetIn <= 0 && k.lock <= 0) {
      this.fidgetIn = brng.range(RT.fidgetEvery[0], RT.fidgetEvery[1]);
      k.flavour(this.quirk === 'on_house' ? 'fidget_chatter'
        : this.quirk === 'lookout' ? 'fidget_look'
          : brng.pick(['fidget_pants', 'fidget_stocking', 'fidget_spit', 'fidget_tap']), { amp: 0.9 });
    }
    if (k.lock <= 0 && k.state !== 'crouch') k.anim.play(this.lead > 1.6 ? 'crouch' : 'ready', { fade: 0.25 });
  }

  /** Broke, stopped, and watching it. The most freezable pose in the game. */
  stepHold(dt, ctx) {
    this.holdT += dt;
    if (this.wait > 0) { this.wait -= dt; this.v = 0; return; }
    const want = this.s < this.holdTo ? this.base * 0.72 : 0;
    this.v += clamp(want - this.v, -RT.decel * 1.5 * dt, RT.accel * dt);
    this.s = Math.min(this.holdTo, this.s + this.v * dt);
    const q = this.path.curve.getPointAt(clamp(this.s / this.path.len, 0, 1));
    this.p.x = q.x; this.p.z = q.z;
    if (this.v < 0.6 && this.lookSpot) {
      this.faceGoal = headingTo(this.lookSpot.x - this.p.x, this.lookSpot.z - this.p.z);
      const k = this.kid;
      if (k && k.lock <= 0 && !this.looked) {
        this.looked = 1;
        k.anim.play('crouch', { fade: 0.2 });
        k.flavour('fidget_look', { amp: 1, life: 1.6 });
        k.setFace('squint', 1.8);
      }
    } else {
      const tg = this.path.curve.getTangentAt(clamp(this.s / this.path.len, 0, 1));
      this.faceGoal = headingTo(tg.x, tg.z);
    }
  }

  /**
   * Running. The governor lives here.
   *
   * `deadline` is a play-time this file wants him on the bag by, and it is only
   * ever set from a LIVE THROW's own measured time to arrival — never from a
   * number in this file. What it buys is the ±20% band inside which the legs are
   * allowed to be adjusted so that the picture agrees with the scoreboard. Push
   * it wider and it reads as a rubber band; drop it and one close play in three
   * calls the core a liar.
   */
  stepRun(dt, ctx) {
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait > 0) { this.v = Math.max(0, this.v - RT.decel * dt); return; }
      if (this.kid) this.kid.act('run_stop', { state: 'run', lock: 0.001 });
    }
    const P = this.path;
    const remain = P.len - this.s;

    // the governor
    let want = this.base;
    if (this.deadline !== null) {
      const left = this.deadline - ctx.now;
      // the deadline is about his FOOT ON THE CHALK. A path with a follow-through
      // on the end of it (the over-run at first, the round toward second) is
      // longer than the race, and governing against the whole length is how a
      // runner ends up sprinting flat out and still arriving late.
      const need = Math.max(0.5, this.bagS() - this.s);
      // A slide covers its last few feet at HALF the speed he went into it at, so
      // a governor that plans a constant run to the bag delivers him late by
      // exactly the length of his own slide. Plan for it: the skid is `ds` feet
      // and costs the same time again.
      const ds = this.slideExpected(ctx) ? this.slideReach() : 0;
      const wantV = left > 0.04 ? (need + ds) / left : this.base * RT.govHi;
      const mul = clamp(wantV / this.base, RT.govLo, RT.govHi);
      this.gov += clamp(mul - this.gov, -RT.govEase * dt, RT.govEase * dt);
      want = this.base * this.gov;
    }

    // Pulling up at a bag he is stopping on — unless he is going to leave his
    // feet, in which case braking and sliding fight each other for the same eight
    // feet of road and the brake wins by a hair, which is how a runner ends up
    // trotting into a play at the plate.
    const bs = this.bagS();
    const sliding = this.slideExpected(ctx);
    if (this.tail === 'stop' && !sliding) {
      const d = bs - this.s;
      const brake = (this.v * this.v) / (2 * RT.decel) + 0.9;
      if (d <= brake) want = 0;
    }
    this.v += clamp(want - this.v, -RT.decel * dt, RT.accel * dt);
    this.v = Math.max(0, this.v);
    this.s += this.v * dt;

    const u = clamp(this.s / P.len, 0, 1);
    const q = P.curve.getPointAt(u);
    const tg = P.curve.getTangentAt(u);
    this.p.x = q.x; this.p.z = q.z;
    this.faceGoal = headingTo(tg.x, tg.z);

    // Footfalls, off distance travelled rather than off the clock, so the sound
    // lands under the foot that made it whatever speed he is going.
    this.stepD += this.v * dt;
    const stride = (CLIPS.run.meta.stride || 6.8) * (this.kid ? this.kid.scale : 1) * 0.5;
    if (this.stepD > stride) {
      this.stepD = 0;
      bus.emit('run:step', { pos: new THREE.Vector3(this.p.x, 0.2, this.p.z), surface: 'street', pitch: brng.range(0, 0.28) });
    }
    // ... and the dust is on a CLOCK, not on the stride, because it is the thing
    // that says "this one is moving" from across a crowded frame and a rope of it
    // reads where two puffs a stride do not. Thrown backwards off his heels.
    this.dustT = (this.dustT || 0) + dt;
    if (this.v > 9.5 && ctx.dust && this.dustT >= RT.dustEvery) {
      this.dustT = 0;
      const back = new THREE.Vector3(-tg.x, 0.16, -tg.z);
      const hot = clamp((this.v - 9.5) / 11, 0, 1);
      ctx.dust.burst(
        this.p.x - tg.x * 0.7, roadHeight(this.p.x) + 0.22, this.p.z - tg.z * 0.7,
        RT.dustStep, 2.0 + hot * 2.4, back, 0.42 + hot * 0.34, 0.62,
      );
    }

    // touching the bag
    for (const m of P.marks) {
      if (m.base > this.at && this.s >= m.s) {
        this.at = m.base;
        this.touch(m.base, ctx);
      }
    }

    // the turn: he is past the bag and leaning
    if (this.tail === 'round' && !this.turned && this.s > bs + 1.5) {
      this.turned = true;
      if (this.kid) this.kid.setFace('smug', 1.2);
      bus.emit('run:turn', { who: this.id, name: this.name, bag: this.bagTag, base: BAG_WORD[clamp(this.to, 0, 3)] });
    }

    if (this.willSlide(ctx)) return this.beginSlide(ctx);

    // The last foot. Deceleration is asymptotic and a bag is not: a runner who
    // coasts to a halt eleven inches short of the chalk has not touched it, never
    // gets judged, and stands there for the rest of the inning. So the last foot
    // is taken, not approached.
    if (this.tail === 'stop' && this.v < 1.2 && bs - this.s < 1.4 && bs - this.s > 0) {
      this.s = bs;
      for (const m of P.marks) if (m.base > this.at && this.s >= m.s) { this.at = m.base; this.touch(m.base, ctx); }
    }
    if (this.s >= P.len - 0.05 || (this.tail === 'stop' && this.s >= bs - 0.02)) {
      this.s = Math.max(this.s, Math.min(P.len, bs));
      this.arrive(ctx);
    }
  }

  bagS() {
    const m = this.path && this.path.marks[this.path.marks.length - 1];
    return m ? m.s : (this.path ? this.path.len : 0);
  }

  /**
   * Does he leave his feet?
   *
   * Only when there is something to beat. A kid sliding into a bag on a ball
   * nobody is throwing has not looked up, and that reads as a bug rather than as
   * a joke — the same rule src/game/fielding.js wrote down for its own runner.
   * And never into first: you run through first, and every kid on the block will
   * tell you so at length.
   */
  slideReach() { return clamp((this.v * this.v) / (2 * RT.slideDecel), RT.slideMin, RT.slideMax); }

  slideExpected(ctx) {
    if (this.slid || this.tail !== 'stop') return false;
    const tta = ctx.throwTta(this.bagTag);
    return tta !== null && tta <= RT.slideWindow;
  }

  willSlide(ctx) {
    if (this.st !== 'run' || !this.slideExpected(ctx)) return false;
    const d = this.bagS() - this.s;
    return d <= this.slideReach() && d > 0.8;
  }

  /**
   * Leaving his feet. The friction is SOLVED rather than fixed: whatever speed he
   * went in at and however far the chalk still is, `v^2 / 2d` is the deceleration
   * that stops him exactly on it. A slide that ends a foot short of the bag is
   * the single most common way a baseball game admits it is faking.
   */
  beginSlide(ctx) {
    this.slid = true;
    this.st = 'slide';
    const d = Math.max(0.8, this.bagS() - this.s);
    this.slideA = clamp((this.v * this.v) / (2 * d), 9, 70);
    this.smearId = `${this.id}:${Math.round(ctx.now * 100)}`;
    this.slideFrom = { x: this.p.x, z: this.p.z };
    const k = this.kid;
    const at = new THREE.Vector3(this.p.x, roadHeight(this.p.x) + 0.2, this.p.z);
    if (k) {
      k.lock = 0;
      k.act(this.headfirst ? 'dive' : 'slide', { state: 'slide', glide: false });
      k.setFace(this.headfirst ? 'determined' : 'shock', 1.6);
      k.face = this.faceGoal;
    }
    if (ctx.dust) {
      const tg = this.path.curve.getTangentAt(clamp(this.s / this.path.len, 0, 1));
      ctx.dust.burst(at.x, at.y, at.z, RT.dustSlide, 6.6, new THREE.Vector3(tg.x, 0.3, tg.z), 1.5, 1.5);
    }
    bus.emit('run:slide', { pos: at, headfirst: this.headfirst, who: this.id, name: this.name, bag: this.bagTag, at: +ctx.now.toFixed(3), from: +this.s.toFixed(1), to: +this.bagS().toFixed(1) });
  }

  stepSlide(dt, ctx) {
    this.v = Math.max(0, this.v - (this.slideA || RT.slideDecel) * dt);
    this.s = Math.min(this.path.len, this.s + this.v * dt);
    const tgS = this.path.curve.getTangentAt(clamp(this.s / this.path.len, 0, 1));
    this.faceGoal = headingTo(tgS.x, tgS.z);
    const u = clamp(this.s / this.path.len, 0, 1);
    const q = this.path.curve.getPointAt(u);
    this.p.x = q.x; this.p.z = q.z;
    // Dust keeps boiling off the hip the whole way down, and the SMEAR is laid
    // as he goes rather than when he stops: a still taken mid-skid needs the
    // four feet of scuffed asphalt behind him or there is nothing in the frame
    // that says he arrived at speed.
    if (this.v > 4 && ctx.dust) {
      ctx.dust.burst(this.p.x, roadHeight(this.p.x) + 0.2, this.p.z, 2, 3.0, null, 1.05, 1.25);
      if (this.slideFrom) ctx.dust.smear(this.slideFrom.x, this.slideFrom.z, this.p.x, this.p.z, 2.9, this.smearId);
    }
    for (const m of this.path.marks) {
      if (m.base > this.at && this.s >= m.s) { this.at = m.base; this.touch(m.base, ctx); }
    }
    if (this.v <= 0.35 || this.s >= this.bagS()) {
      this.s = Math.min(this.path.len, Math.max(this.s, this.bagS()));
      const q2 = this.path.curve.getPointAt(clamp(this.s / this.path.len, 0, 1));
      this.p.x = q2.x; this.p.z = q2.z;
      if (ctx.dust && this.slideFrom) ctx.dust.smear(this.slideFrom.x, this.slideFrom.z, this.p.x, this.p.z, 2.7);
      this.arrive(ctx);
    }
  }

  /** Coming back: a trot to a bag he over-ran, or the last foot of a dive. */
  stepBack(dt, ctx) {
    this.backT += dt;
    const to = this.backTo;
    const dx = to.x - this.p.x, dz = to.z - this.p.z;
    const d = Math.hypot(dx, dz);
    if (this.backDive) {
      const u = clamp(this.backT / RT.diveBack, 0, 1);
      const e = 1 - Math.pow(1 - u, 2);
      this.p.x += dx * e * 0.6; this.p.z += dz * e * 0.6;
      this.v = d / Math.max(0.05, RT.diveBack);
      if (u >= 1) { this.p.x = to.x; this.p.z = to.z; this.stand(ctx, false); }
      return;
    }
    // the bluff: two steps toward the next bag, then the whole block yells
    if (this.bluff && this.backT < 0.62) {
      const nxt = BAGS[Math.min(3, this.at + 1)];
      this.faceGoal = headingTo(nxt.x - this.p.x, nxt.z - this.p.z);
      this.v = this.base * 0.55;
      const L = Math.hypot(nxt.x - this.p.x, nxt.z - this.p.z) || 1;
      this.p.x += ((nxt.x - this.p.x) / L) * this.v * dt;
      this.p.z += ((nxt.z - this.p.z) / L) * this.v * dt;
      return;
    }
    if (this.bluff && !this.wavedBack) {
      this.wavedBack = 1;
      if (this.kid) { this.kid.setFace('sulk', 1.4); this.kid.flavour('fidget_look', { amp: 0.8 }); }
      bus.emit('run:waved_back', { who: this.id, name: this.name, bag: BAG_TAG[this.at] });
    }
    this.faceGoal = headingTo(dx, dz);
    this.v += clamp(this.base * (this.bluff ? 0.62 : RT.trotScale) - this.v, -RT.decel * dt, RT.accel * dt);
    if (d < 0.45) { this.p.x = to.x; this.p.z = to.z; this.stand(ctx, false); return; }
    const stepLen = Math.min(this.v * dt, d);
    this.p.x += (dx / d) * stepLen;
    this.p.z += (dz / d) * stepLen;
  }

  /* --- arriving ----------------------------------------------------------- */

  touch(i, ctx) {
    bus.emit('run:touch', {
      who: this.id, name: this.name, bag: BAG_TAG[i], base: BAG_WORD[i], at: +ctx.now.toFixed(3),
    });
    if (i === clamp(this.to, 0, 3)) this.judge(ctx);
  }

  /**
   * FOOT ON THE CHALK. This is the one measurement this file exists to make: the
   * gap in seconds between his foot and the ball, published in frames, so the
   * honesty of a close play is a number a critic can read rather than an opinion.
   *
   * It fires on the BAG, not at the end of the path, because the follow-through
   * — the over-run at first, the round toward second — happens after the play is
   * already decided and has nothing to do with who won.
   */
  judge(ctx) {
    if (this.touchedAt !== null) return;
    this.touchedAt = ctx.now;
    this.deadline = null;          // the race is run; stop pushing his legs
    const bag = this.bagTag;
    const ballAt = ctx.ballArrival(bag);
    const gap = ballAt === null ? null : this.touchedAt - ballAt;
    const called = ctx.calledOut(this);
    if (gap !== null) {
      bus.emit('run:race', {
        who: this.id, name: this.name, bag, base: BAG_WORD[clamp(this.to, 0, 3)],
        runner: +this.touchedAt.toFixed(3), ball: +ballAt.toFixed(3),
        gap: +gap.toFixed(3), frames: +(gap * 60).toFixed(1), out: called,
      });
      // Nobody argues about a clean single. The appeal is for a play that is
      // OVER for this runner — he is standing on it, or he has been beaten —
      // because a kid who stops to argue while he is still rounding the bag has
      // thrown away the only thing he was arguing about.
      if (Math.abs(gap) <= RT.closeGap && (this.tail === 'stop' || called)) {
        this.argue(ctx, gap, bag, called);
      }
    }
    if (this.to === 3) return this.score(ctx);
    if (called) return this.out(ctx, bag);
    bus.emit('run:safe', {
      who: this.id, name: this.name, bag, base: BAG_WORD[clamp(this.to, 0, 3)],
      by: gap === null ? null : +(-gap).toFixed(3),
    });
  }

  /**
   * End of the path: the pull-up, the over-run, the round, or standing on it.
   *
   * The verdict is forced here if the mark loop has not already fired it. A slide
   * decelerates asymptotically onto its own bag and can come to rest a thousandth
   * of a foot short of the sample the mark was found at — and a runner who slides
   * home, is announced as planted, and is never judged is the ugliest bug this
   * file can produce, because everything downstream of it is silently wrong.
   */
  arrive(ctx) {
    if (this.st === 'out' || this.st === 'score') return;
    if (this.touchedAt === null) {
      this.at = clamp(this.to, 0, 3);
      this.judge(ctx);
      if (this.st === 'out' || this.st === 'score') return;
    }
    this.stand(ctx, !this.beaten);
  }

  stand(ctx, celebrate) {
    this.st = 'stand';
    this.v = 0;
    const k = this.kid;
    if (this.tail === 'through' && !this.overrunDone) {
      // he ran through it. Pull up, kick the road, and drift back to the bag.
      this.overrunDone = 1;
      this.st = 'back';
      this.backT = 0; this.bluff = false; this.backDive = false;
      this.backTo = { x: BAGS[clamp(this.to, 0, 3)].x, z: BAGS[clamp(this.to, 0, 3)].z };
      if (k) {
        k.act('run_stop', { state: 'stop', lock: 0.55 });
        if (this.beaten) k.after = (kk) => kk.act('sulk', { state: 'sulk', lock: 1.7 });
        if (ctx.dust) ctx.dust.burst(this.p.x, roadHeight(this.p.x) + 0.16, this.p.z, RT.dustStop, 3.4, null, 0.85);
      }
      return;
    }
    if (this.tail === 'round' && !this.roundDone) {
      this.roundDone = 1;
      this.st = 'back';
      this.backT = 0; this.bluff = false; this.backDive = false;
      this.backTo = { x: BAGS[clamp(this.to, 0, 3)].x, z: BAGS[clamp(this.to, 0, 3)].z };
      if (k) {
        k.act('run_stop', { state: 'stop', lock: 0.6 });
        k.setFace('smug', 1.6);
        if (ctx.dust) ctx.dust.burst(this.p.x, roadHeight(this.p.x) + 0.16, this.p.z, RT.dustStop + 4, 4.0, null, 0.95);
      }
      bus.emit('run:pull_up', { who: this.id, name: this.name, bag: this.bagTag });
      return;
    }
    this.at = clamp(this.to, 0, 3);
    this.p.x = BAGS[this.at].x; this.p.z = BAGS[this.at].z;
    this.lead = 0;
    if (this.beaten) { this.st = 'out'; if (k && k.lock <= 0) k.act('sulk', { state: 'sulk', lock: 1.7 }); return; }
    if (k) {
      if (celebrate && k.lock <= 0) { k.act('cheer_arms', { state: 'cheer', lock: 1.1 }); k.setFace('grin', 1.8); }
      else if (k.lock <= 0) k.anim.play('ready', { fade: 0.25 });
    }
    bus.emit('run:planted', { who: this.id, name: this.name, bag: BAG_TAG[this.at], base: BAG_WORD[this.at] });
  }

  /**
   * Beaten. He does not snap out of a slide to sulk — the skid is the picture and
   * cutting it short throws the picture away — so when he is on his hip the sulk
   * is queued behind the clip that is already telling the story.
   */
  out(ctx, bag) {
    const wasSliding = this.st === 'slide';
    const runThrough = this.tail === 'through' && this.st === 'run';
    this.beaten = true;
    const k = this.kid;
    if (k) k.setFace('sulk', 2.4);
    // Beaten at the stoop, he still runs THROUGH it — nobody stops dead on a bag
    // they have just lost a race to — and the sulk lands on the far side of it,
    // which is also where the block is standing to tell him about it.
    if (!runThrough) {
      this.st = 'out';
      this.v = 0;
      if (k) {
        if (wasSliding && k.lock > 0) k.after = (kk) => kk.act('sulk', { state: 'sulk', lock: 1.9 });
        else { k.lock = 0; k.act('sulk', { state: 'sulk', lock: 1.9 }); }
      }
    }
    bus.emit('run:out', { who: this.id, name: this.name, bag, base: BAG_WORD[clamp(this.to, 0, 3)] });
  }

  score(ctx) {
    if (this.scored) return;
    this.scored = 1;
    this.st = 'score';
    this.v = 0;
    const k = this.kid;
    if (k && k.lock <= 0) { k.act('cheer_jump', { state: 'cheer', lock: 1.4 }); k.setFace('grin', 2.2); }
    bus.emit('run:score', { who: this.id, name: this.name, from: this.from });
  }

  /**
   * Inside two frames. The runner is up on one knee with a finger on the chalk
   * before anybody has said anything, and the event carries the numbers so the
   * booth and the rules piece can settle it by volume, then seniority, then who
   * owns the ball (DESIGN-BIBLE §8.1).
   */
  argue(ctx, gap, bag, called) {
    // The pose comes AFTER the picture. A kid who springs into an argument on the
    // frame his hip hits the road has thrown away the frame the whole play was
    // for, so the appeal is queued a beat behind it.
    this.pend = {
      at: ctx.now + (this.slid ? 0.62 : 0.16),
      fn: () => {
        const k = this.kid;
        if (k) {
          k.lock = 0;
          k.act(called ? 'argue_jab' : 'argue_appeal', { state: 'argue', lock: RT.arguePause });
          k.setFace(called ? 'taunt' : 'shock', RT.arguePause);
          const b = BAGS[clamp(this.to, 0, 3)];
          k.faceGoal = headingTo(b.x - this.p.x || 1, b.z - this.p.z || 0.01);
        }
        ctx.blockArgues(this, bag, called);
      },
    };
    bus.emit('run:close', {
      who: this.id, name: this.name, bag, base: BAG_WORD[clamp(this.to, 0, 3)],
      gap: +gap.toFixed(3), frames: +(gap * 60).toFixed(1), out: called,
    });
    bus.emit('run:argue', {
      who: this.id, name: this.name, bag, out: called,
      frames: +(gap * 60).toFixed(1),
      word: called ? 'HE WAS UNDER IT!' : 'HE NEVER TOUCHED HIM!',
    });
  }

  /* --- writing the body --------------------------------------------------- */

  /**
   * THE THREE-QUARTER CHEAT.
   *
   * Two of the four legs of this diamond run almost straight down the lens axis:
   * home to first goes 31 degrees away from the camera and third to home comes
   * 23 degrees straight back at it. A kid running dead away is a coat with a cap
   * on it; a kid sliding dead at the lens is a cap and nothing else, which is
   * exactly what a round-3 frame of this piece showed. src/game/layout.js has the
   * same problem with the catcher, says so at length, and solves it by yawing him
   * 82 degrees off his facing. This is the same fix, smaller and continuous: the
   * body is turned until it makes at least `threeQuarter` radians with the lens
   * axis, capped at `runYaw` so it never becomes a crab-walk, and the turn is
   * toward whichever side is already shorter.
   *
   * The feet are then a little off the direction of travel. That is the cost, it
   * is one this stage has already agreed to pay (§17.6: "we cheat, the way a
   * stage does"), and it buys a silhouette instead of a hat.
   */
  shoulderCheat(ctx) {
    if (this.st !== 'run' && this.st !== 'slide') return 0;
    const cam = ctx.cam;
    if (!cam) return 0;
    const cx = cam.x - this.p.x, cz = cam.z - this.p.z;
    const L = Math.hypot(cx, cz);
    if (L < 1) return 0;
    const camA = Math.atan2(cx / L, cz / L);
    let d = this.faceGoal - camA;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const sgn = d >= 0 ? 1 : -1;
    const a = Math.abs(d);
    const want = RT.threeQuarter;
    const a2 = clamp(a, want, Math.PI - want);
    return clamp(sgn * (a2 - a), -RT.runYaw, RT.runYaw);
  }

  /**
   * Push this frame's answer onto the borrowed rig.
   *
   * `speed` is handed over PRE-DECAY: src/chars/players.js takes a fixed bite out
   * of `speed` on any kid with no steering target, and then phases the run cycle
   * off whatever is left. Adding the bite back means the planted foot matches the
   * ground speed this file is actually moving him at, which is the whole reason
   * the stride does not skate.
   */
  place(dt, ctx) {
    const k = this.kid;
    if (!k) return;
    k.target = null;
    k.glide = 0;
    k.pos.set(this.p.x, this.p.z);
    k.faceGoal = this.faceGoal + this.shoulderCheat(ctx);
    if (this.snapFace) { k.face = this.faceGoal; k.group.rotation.y = this.faceGoal; this.snapFace = false; }
    k.speed = Math.max(0, this.v) + T.run.accel * 2 * dt;
    k.maxSpeed = Math.max(this.base, 1);
    k.group.visible = true;
  }
}

/* ============================================================================
   5. THE CREW — every runner on the street at once
   ---------------------------------------------------------------------------
   The core's `bases` array is the truth about who is standing where; `play.moves`
   is the truth about where they are going. This class is the only thing in the
   build that turns either into a body, and it re-reads `play.moves` every frame
   because a human throw prompt can add moves to the SAME play object a second
   after contact (src/game/core.js `resolveThrow`).
   ========================================================================= */

const players = () => APP.get('players');

class Crew {
  constructor() {
    this.runners = [];
    this.byBody = new Map();
    this.play = null;
    this.now = 0;
    this.seen = 0;            // how many of play.moves have been staged
    this.leadOut = false;
    this.leadCreep = false;
    this.throwTag = null;
    this.throwT0 = 0;
    this.throwDur = 0;
    this.ballAt = {};         // bag tag -> play-time the ball reached it
    this.dust = null;
    this.bags = null;
    this.holdSpot = null;
  }

  /* --- cards -------------------------------------------------------------- */
  spd(id) { try { return liveMatch.stat(id, 'SPD'); } catch { return 5; } }
  quirk(id) { try { return liveMatch.quirkOf(id); } catch { return 'none'; } }

  /* --- bodies ------------------------------------------------------------- */

  /**
   * Borrow a rig. src/chars/players.js builds three spare bodies for exactly this
   * (LAYOUT.BENCH) and the batter's own rig is the fourth, which is the most that
   * can ever be running at once. The choice is stable per kid so the same runner
   * is the same body all game.
   */
  bodyFor(id, batter) {
    const pl = players();
    if (!pl) return null;
    if (batter && pl.batter && !this.byBody.has(pl.batter)) return pl.batter;
    const pool = pl.runners || [];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    for (let i = 0; i < pool.length; i++) {
      const k = pool[(h + i) % pool.length];
      if (!this.byBody.has(k)) return k;
    }
    return pool.find((k) => !this.byBody.has(k)) || (batter ? pl.batter : null) || pool[0] || null;
  }

  claim(id, from, batter) {
    const k = this.bodyFor(id, batter);
    const r = new Runner(id, k, from, from, this);
    if (k) {
      this.byBody.set(k, r);
      k.onBase = true;                 // players.js reads this when it mobs the plate
      k.group.visible = true;
      k.target = null; k.speed = 0; k.glide = 0; k.lock = 0;
      k.showStick(false);
      k.rig.resetSprings();
    }
    this.runners.push(r);
    return r;
  }

  release(r) {
    if (r.kid) { this.byBody.delete(r.kid); r.kid.onBase = false; }
    const i = this.runners.indexOf(r);
    if (i >= 0) this.runners.splice(i, 1);
  }

  clear(hide = true) {
    const pl = players();
    for (const r of this.runners) if (r.kid) { r.kid.onBase = false; }
    this.runners.length = 0;
    this.byBody.clear();
    this.play = null; this.seen = 0;
    this.throwTag = null; this.ballAt = {};
    this.leadOut = false; this.leadCreep = false;
    if (hide && pl) for (const k of pl.runners || []) k.group.visible = false;
    if (this.bags) this.bags.clear();
  }

  /**
   * Rebuild the crew from the rules core's own base state. Called at the top of
   * every at-bat, which is the one moment nobody is moving and the one moment the
   * batter's rig has to be handed back to the batter.
   */
  resync() {
    const pl = players();
    if (!pl) return;
    const want = liveMatch.bases.slice();
    // let go of anybody who is no longer on a bag
    for (const r of this.runners.slice()) {
      const idx = want.indexOf(r.id);
      if (idx < 0 || r.st === 'out' || r.st === 'score') {
        if (r.kid) { r.kid.onBase = false; if (r.kid !== pl.batter) r.kid.group.visible = false; }
        this.release(r);
      }
    }
    // and place everybody who is
    for (let i = 0; i < 3; i++) {
      const id = want[i];
      if (!id) continue;
      let r = this.runners.find((x) => x.id === id);
      if (!r) r = this.claim(id, i, false);
      // hand the plate rig back: a kid who reached first is a kid on first, in
      // somebody else's body, and the batter's box needs its own kid back
      if (r.kid === pl.batter) {
        this.byBody.delete(pl.batter);
        pl.batter.onBase = false;
        const k = this.bodyFor(id, false);
        r.kid = k;
        if (k) {
          this.byBody.set(k, r);
          k.onBase = true; k.group.visible = true; k.lock = 0; k.glide = 0;
          k.showStick(false); k.rig.resetSprings();
        }
      }
      r.settleOnBase(i);
    }
    this.play = null; this.seen = 0;
    this.throwTag = null; this.ballAt = {};
    this.leadOut = false; this.leadCreep = false;
    if (this.bags) this.bags.clear();
    if (pl.runners) for (const k of pl.runners) if (!this.byBody.has(k)) k.group.visible = false;
  }

  /** Everybody on a bag steps off it, the way they have already done all game. */
  takeLeads(f = 1) {
    this.leadOut = true;
    for (const r of this.runners) {
      if (r.st !== 'set' || r.at < 0) continue;
      r.lead = RT.lead * f;
      const b = BAGS[r.at];
      const n = BAGS[Math.min(3, r.at + 1)];
      const L = Math.hypot(n.x - b.x, n.z - b.z) || 1;
      r.p.x = b.x + ((n.x - b.x) / L) * r.lead;
      r.p.z = b.z + ((n.z - b.z) / L) * r.lead;
      r.snapFace = true;
      if (r.kid) r.kid.anim.play('crouch', { fade: 0 });
    }
  }

  /* --- the play ----------------------------------------------------------- */

  /**
   * Contact. The batter is a runner from this instant; everybody else moves or
   * holds depending on what is in the air.
   */
  onContact(sim) {
    const pl = players();
    if (!pl) return;
    const play = sim.lastPlay || null;
    this.play = play;
    this.seen = 0;
    this.ballAt = {};
    this.throwTag = null;
    this.leadOut = false;
    this.now = 0;
    const loft = play ? play.loft : 'ground';
    const airborne = loft === 'fly' || loft === 'line';
    this.holdSpot = { x: sim.ball.pos.x + sim.ball.vel.x * 0.55, z: sim.ball.pos.z + sim.ball.vel.z * 0.55 };

    // the batter, out of the box
    const bid = (play && play.batter) || liveMatch.batterId();
    let bat = this.runners.find((r) => r.id === bid);
    if (!bat) bat = this.claim(bid, -1, true);
    if (bat.kid) {
      bat.kid.runOut = true;           // so fielding.js puts the rig back at atbat:begin
      bat.kid.showStick(false);
      bus.emit('bat:drop', { pos: new THREE.Vector3(bat.kid.pos.x, 0.3, bat.kid.pos.y) });
    }
    const race = !!(play && (play.needsThrow || play.result === 'out_ground'));
    const tail = race ? 'through' : 'round';
    bat.send(0, tail, this.lagFor(bat, loft) * (airborne ? 0.7 : 1));

    // everybody already on a bag
    for (const r of this.runners) {
      if (r === bat || r.at < 0) continue;
      if (airborne && !(play && play.bases >= 3)) r.hold(this.holdSpot, loft);
      else r.st = 'set';
    }
    this.applyMoves(play);
    bus.emit('run:contact', {
      loft, race, runners: this.runners.length,
      batter: bid, holding: this.runners.filter((r) => r.st === 'hold').length,
    });
  }

  lagFor(r, loft) {
    const base = clamp(RT.lagBase - r.spd * RT.lagPerSpd, 0.08, 0.30);
    const lag = base + (loft === 'fly' ? RT.lagFly : loft === 'line' ? RT.lagLine : 0);
    return r.eager ? lag * 0.55 : lag;
  }

  /**
   * Read the core's moves and send anybody it has not sent yet.
   *
   * Re-read every frame ON PURPOSE: `resolveThrow` appends to the same play a
   * second after contact when a human answers the throw prompt, and a runner who
   * only ever read `moves` once would stand on second watching himself score.
   */
  applyMoves(play) {
    if (!play || !play.moves) return;
    for (let i = this.seen; i < play.moves.length; i++) {
      const mv = play.moves[i];
      const r = this.runners.find((x) => x.id === mv.id);
      if (!r) continue;
      if (mv.out) continue;                       // the core cut him down; the throw stages that
      const to = clamp(mv.to, 0, 3);
      if (to <= r.at && r.st !== 'hold') continue;
      // The batter left the box on the crack with a tail already chosen for him
      // (`round` on a hit, `through` on a race). The core's move for him says the
      // same destination a beat later, and re-sending would throw that away and
      // restart his path from a standing start — which is how a runner ends up
      // teleporting back to the plate one frame after he left it.
      if (r.st === 'run' || r.st === 'slide') {
        if (to > r.to) r.send(to, to === 0 ? r.tail : 'stop', 0);
        continue;
      }
      if (r.st === 'back' || r.st === 'stand') { if (to <= r.to) continue; }
      const tail = to === 0 ? (r.tail === 'through' ? 'through' : 'round') : 'stop';
      r.send(to, tail, this.lagFor(r, play.loft) * (r.st === 'hold' ? 0.4 : 1));
    }
    this.seen = play.moves.length;
  }

  /* --- what the ball is doing --------------------------------------------- */

  /**
   * Seconds until the live throw reaches `tag`, measured off the ball itself.
   *
   * Deliberately NOT computed from src/game/fielding.js's numbers: that file owns
   * the throw and may re-solve it, and a copy of somebody else's arithmetic is a
   * bug with a delay fuse. The ball is a real object in the scene with a real
   * velocity, so this asks the ball.
   */
  throwTta(tag) {
    if (!this.throwTag || this.throwTag !== tag) return null;
    if (this.ballAt[tag] !== undefined) return 0;
    const sim = APP.sim;
    const i = TAG_INDEX[tag];
    if (i === undefined || !sim) return null;
    const bag = BAGS[i];
    const b = sim.ball;
    const d = Math.hypot(bag.x - b.pos.x, bag.z - b.pos.z);
    const v = Math.hypot(b.vel.x, b.vel.z);
    if (v > 3) return d / v;
    // still in his hand: fall back on the flight the throw was released with
    const left = this.throwDur - (this.now - this.throwT0);
    return left > 0 ? left : 0.02;
  }

  /** Play-time at which the ball reached a bag, if it has. */
  ballArrival(tag) {
    if (this.ballAt[tag] !== undefined) return this.ballAt[tag];
    const tta = this.throwTta(tag);
    return tta === null ? null : this.now + tta;
  }

  /**
   * A runner who froze on a ball in the air goes the moment the ball stops being
   * a threat to him: the beat is up on a liner, or it is on the road on a fly.
   * He goes SPECULATIVELY, one bag, because that is what a kid does — and the
   * core's own moves, which arrive a beat later, are what decide where he stops.
   */
  releaseHolds(dt) {
    const p = this.play;
    const caught = !!p && (p.result === 'out_fly' || p.result === 'out_line');
    for (const r of this.runners) {
      if (r.st !== 'hold') continue;
      if (r.freeze !== null && r.freeze !== undefined) {
        r.freeze -= dt;
        if (r.freeze > 0) continue;
      } else if (!this.ballLoose()) continue;
      if (caught) continue;                       // a catch is fielding's to announce
      const to = clamp(r.at + 1, 0, 3);
      r.send(to, 'stop', this.lagFor(r, 'ground') * 0.5);
    }
  }

  /** Did the core call this one out? The core, and nothing in this file. */
  calledOut(r) {
    const p = this.play;
    if (!p) return false;
    if (r.at < 0 || r.from < 0) {
      return p.result === 'out_ground' && r.to === 0;
    }
    if (p.result === 'out_home' && r.to === 3) return true;
    if (p.moves) for (const mv of p.moves) if (mv.id === r.id && mv.out) return true;
    return false;
  }

  /**
   * HOW CLOSE IS CLOSE. The core does not just say who won, it says by how much:
   * `play.margin`, and its own definition of "genuinely close" is the band it
   * only bothers a human about (`T.play.race.promptLo..promptHi`). So a play the
   * core thought was a coin toss is staged as a coin toss, and a play it thought
   * was comfortable is staged comfortable. Anything else makes the scoreboard and
   * the picture disagree about the only thing they both know.
   */
  gapFor(out) {
    const m = this.play && Number.isFinite(this.play.margin) ? this.play.margin : 0;
    const R = T.play.race;
    const close = m > R.promptLo * 1.6 && m < R.promptHi * 1.6;
    if (out) return close ? RT.outBy : RT.outBy * 3.2;
    return close ? RT.safeBy : RT.safeBy * 4.4;
  }

  /**
   * Hand every runner a deadline when a throw is live, so the legs and the ball
   * arrive on the correct side of each other.
   */
  govern() {
    if (!this.throwTag) return;
    const arrive = this.ballArrival(this.throwTag);
    if (arrive === null) return;
    for (const r of this.runners) {
      if (r.st !== 'run') continue;
      if (r.bagTag !== this.throwTag) continue;
      const out = this.calledOut(r);
      r.deadline = arrive + (out ? this.gapFor(true) : -this.gapFor(false));
    }
  }

  /* --- the tick ----------------------------------------------------------- */

  /**
   * Is the ball down, or through, or otherwise no longer a reason to stand still?
   *
   * This is the question a runner on a bag is actually asking, and it is asked of
   * the BALL rather than of an event, because the answer has to be the same
   * whether the ball was caught, dropped, bounced off a fender or rolled under a
   * pushcart — and src/game/fielding.js only announces two of those four.
   */
  ballLoose() {
    const sim = APP.sim;
    if (!sim) return false;
    const b = sim.ball;
    return b.pos.y < 2.6 || (b.vel.y < 0 && b.pos.y < 5.0 && b.pos.z > 34);
  }

  step(dt) {
    this.now += dt;
    this.cam = APP.camera ? APP.camera.position : null;
    const sim = APP.sim;
    if (sim && sim.state.phase === 'in_play') this.applyMoves(this.play || sim.lastPlay);
    this.releaseHolds(dt);
    // the ball has reached a bag the moment it stops closing on it
    if (this.throwTag && this.ballAt[this.throwTag] === undefined) {
      const i = TAG_INDEX[this.throwTag];
      const bag = BAGS[i];
      const d = Math.hypot(bag.x - sim.ball.pos.x, bag.z - sim.ball.pos.z);
      if (d < 2.6) this.ballAt[this.throwTag] = this.now;
    }
    this.govern();
    for (const r of this.runners.slice()) r.step(dt, this);
    // whoever is being run at gets his chalk redrawn
    if (this.bags) {
      const want = [0, 0, 0, 0];
      for (const r of this.runners) {
        if (r.st === 'run' || r.st === 'slide') want[clamp(r.to, 0, 3)] = 1;
      }
      for (let i = 0; i < 4; i++) this.bags.set(i, want[i]);
    }
  }

  /**
   * EVERY DISPUTE IS SETTLED BY VOLUME (DESIGN-BIBLE §8.1), so a close play is not
   * one kid pointing at a bag — it is the whole block having an opinion about it
   * within half a second.
   *
   * Only bodies this piece may touch join in: the three on the curb, the kid on
   * deck, and any runner not otherwise busy. The nine fielders belong to
   * src/game/fielding.js and it stages their half of the argument off the same
   * `run:argue` event, which is why the event carries the bag, the gap in frames
   * and the word rather than just a flag.
   */
  blockArgues(from, bag, called) {
    const pl = players();
    if (!pl) return;
    const at = BAGS[TAG_INDEX[bag] ?? 0];
    let n = 0;
    for (const sp of pl.spectators || []) {
      if (!sp || sp.lock > 0.4) continue;
      sp.lookAt(at.x, at.z);
      sp.flavour(n % 2 ? 'cheer_wave' : 'argue_jab', { life: RT.arguePause, amp: 0.95 });
      sp.setFace(n % 2 ? 'taunt' : 'shock', RT.arguePause);
      n++;
    }
    if (pl.onDeck && pl.onDeck.lock <= 0) {
      pl.onDeck.lookAt(at.x, at.z);
      pl.onDeck.flavour('argue_appeal', { life: RT.arguePause, amp: 0.9 });
      pl.onDeck.setFace('shock', RT.arguePause);
    }
    for (const r of this.runners) {
      if (r === from || !r.kid || r.kid.lock > 0.4) continue;
      r.kid.lookAt(at.x, at.z);
      r.kid.flavour('cheer_wave', { life: RT.arguePause, amp: 0.8 });
    }
  }

  /** One line of state, for a probe and for anybody debugging a stuck runner. */
  get debug() {
    return {
      t: +this.now.toFixed(2),
      throwTo: this.throwTag,
      runners: this.runners.map((r) => ({
        who: r.id, body: r.kid && r.kid.name, st: r.st, at: r.at, to: r.to, tail: r.tail,
        v: +r.v.toFixed(1), base: +r.base.toFixed(1), gov: +r.gov.toFixed(2),
        s: +r.s.toFixed(1), len: r.path ? +r.path.len.toFixed(1) : 0,
        touched: r.touchedAt === null ? null : +r.touchedAt.toFixed(3),
      })),
      ballAt: this.ballAt,
    };
  }
}

const crew = new Crew();

/* ============================================================================
   6. THE SLOT
   ========================================================================= */

provide('baserunning', {
  onContact(sim) { crew.onContact(sim); },

  /**
   * src/game/sim.js does not tick this slot — it ticks fielding and lets every
   * other system tick itself — so the per-frame work is in the system below and
   * this exists for anybody who calls the documented contract.
   */
  update(dt, sim) { return null; },

  /**
   * The bookkeeping advance: a walk, a home run, anything the core resolved with
   * no ball in play. `bases` is how far everybody moves; the core has already
   * written the moves, so this only starts the legs.
   */
  advance(sim, bases) {
    const ev = sim.lastEv || sim.lastPlay;
    if (!ev) return;
    crew.play = ev;
    crew.seen = 0;
    crew.applyMoves(ev);
  },
});

/* ============================================================================
   7. LISTENING TO THE REST OF THE BLOCK
   ========================================================================= */

bus.on('atbat:begin', () => {
  crew.resync();
});

bus.on('pitch:thrown', () => {
  crew.leadOut = true;
  crew.leadCreep = brng.chance(0.45);
});

const backOff = () => { crew.leadOut = false; crew.leadCreep = false; };
bus.on('strike', backOff);
bus.on('ball', backOff);

/** A walk pushes only what it has to, and the core has already said which. */
bus.on('walk', () => {
  const sim = APP.sim;
  const ev = sim && sim.lastEv;
  if (!ev || !ev.moves) return;
  const pl = players();
  if (!pl) return;
  const bid = ev.snap ? ev.snap.batter : liveMatch.batterId();
  if (bid && !crew.runners.find((r) => r.id === bid)) crew.claim(bid, -1, true);
  crew.play = ev; crew.seen = 0;
  for (const r of crew.runners) r.tail = 'stop';
  crew.applyMoves(ev);
  for (const r of crew.runners) if (r.st === 'run') { r.base *= RT.trotScale * 1.5; r.tail = 'stop'; }
});

/** The throw is in the air. Everything the governor needs comes off this. */
bus.on('field:throw', (p) => {
  crew.throwTag = p && p.to === 'relay' ? null : (p && p.to) || null;
  crew.throwT0 = crew.now;
  crew.throwDur = (p && p.dur) || 0.6;
  if (!crew.throwTag) return;
  const i = TAG_INDEX[crew.throwTag];
  // anybody standing off THAT bag gets back on it, in a hurry
  for (const r of crew.runners) {
    if (r.st !== 'set' && r.st !== 'hold') continue;
    if (r.at !== i) continue;
    if (r.lead < 1.2 && r.s < 1.2) continue;
    r.diveBack(i);
  }
});

bus.on('field:tag', (p) => {
  if (!p || !p.bag) return;
  if (crew.ballAt[p.bag] === undefined) crew.ballAt[p.bag] = crew.now;
});

/**
 * Caught. Everybody who was holding scrambles back and touches the bag, then
 * bluffs two steps and gets waved back — which is what a shallow fly ball
 * actually produces, and the core is honest that it does not score anybody.
 */
bus.on('field:catch', (p) => {
  if (!p || p.clean === false) {
    for (const r of crew.runners) if (r.st === 'hold') r.st = 'set';
    return;
  }
  const play = crew.play;
  const caughtOut = !!play && (play.result === 'out_fly' || play.result === 'out_line');
  for (const r of crew.runners) if (r.st === 'hold') r.tagUp(caughtOut);
});

/** Gone. Everybody trots, and the batter goes round the whole thing. */
bus.on('field:gone', () => {
  for (const r of crew.runners) {
    if (r.st === 'stand' || r.st === 'score') continue;
    r.base = Math.max(7.5, r.base * RT.trotScale);
    r.tail = 'stop';
    if (r.st !== 'run') r.send(3, 'stop', 0.1);
  }
});

/* ============================================================================
   8. INPUT — send him, hold him, get him back
   ---------------------------------------------------------------------------
   The core decides whether a base is his; this decides how he goes after it. So
   the controls are honest about what they can do: SEND makes the lead runner
   round hard and go for the next bag if the core gave it to him (and get waved
   back by the whole block if it did not, which is a joke the player caused);
   HOLD pulls him up on the bag; BACK puts him on his belly.
   ========================================================================= */

function leadRunner() {
  let best = null;
  for (const r of crew.runners) {
    if (r.st === 'out' || r.st === 'score') continue;
    if (!best || r.at > best.at) best = r;
  }
  return best;
}

function sendLead() {
  const r = leadRunner();
  if (!r) return false;
  if (r.st === 'hold') { r.st = 'run'; r.wait = 0; }
  const to = clamp(r.at + 1, 0, 3);
  const allowed = (() => {
    const p = crew.play;
    if (!p || !p.moves) return false;
    for (const mv of p.moves) if (mv.id === r.id && mv.to >= to) return true;
    return false;
  })();
  if (allowed) r.send(to, to === 3 ? 'stop' : 'stop', 0.02);
  else {
    // he goes anyway, gets a third of the way, and the block screams him back
    r.send(to, 'stop', 0.02);
    r.base *= 0.8;
    setTimeoutish(r);
  }
  bus.emit('run:sent', { who: r.id, name: r.name, to: BAG_WORD[to], honoured: allowed });
  return true;
}

/** Not a timer — the crew's own clock. He is hauled back after half a second. */
function setTimeoutish(r) { r.recallAt = crew.now + 0.55; }

function holdLead() {
  const r = leadRunner();
  if (!r) return false;
  if (r.st === 'run' && r.tail !== 'through') { r.tail = 'stop'; r.deadline = null; }
  if (r.st === 'hold') { r.holdTo = Math.min(r.holdTo, r.s + 0.5); }
  bus.emit('run:held', { who: r.id, name: r.name, bag: BAG_TAG[clamp(r.at, 0, 3)] });
  return true;
}

function diveLead() {
  const r = leadRunner();
  if (!r || r.at < 0) return false;
  r.diveBack(clamp(r.at, 0, 3));
  return true;
}

/* ============================================================================
   9. THE SYSTEM
   ---------------------------------------------------------------------------
   Order 18: BEFORE src/chars/players.js (20).

   That number is the whole integration. players.js keeps a placeholder runner
   from the days this slot was empty — it teleports a body to the plate on `hit`
   and hides it on `out` — and both of those fire inside sim.update(), which runs
   before any system does. Writing the runners here, at 18, means players.js then
   steers and draws from THIS file's positions on the same tick, so the
   placeholder's teleport never reaches a rendered frame and neither file has to
   know about the other.
   ========================================================================= */

export default registerSystem({
  name: 'baserunning',
  order: 18,

  get crew() { return crew; },
  get debug() { return crew.debug; },

  init(app) {
    app.baserunning = this;
    this.dust = new Dust(app.scene);
    this.bags = new LiveBag(app.scene);
    this.lane = new Lane(app.scene);
    crew.dust = this.dust;
    crew.bags = this.bags;
    if (typeof addEventListener === 'function') {
      addEventListener('keydown', (e) => {
        if (e.code === 'KeyR') { if (sendLead()) e.preventDefault(); }
        else if (e.code === 'KeyF') { if (holdLead()) e.preventDefault(); }
        else if (e.code === 'KeyB') { if (diveLead()) e.preventDefault(); }
      });
    }
  },

  onInput(action) {
    if (action === 'run' || action === 'send') return sendLead();
    if (action === 'hold') return holdLead();
    if (action === 'dive_back' || action === 'back') return diveLead();
    return false;
  },

  update(dt, app) {
    crew.step(dt);
    // the recall: he was sent, the core never gave him the base, and the block
    // has been screaming at him for half a second
    for (const r of crew.runners) {
      if (r.recallAt && crew.now >= r.recallAt && r.st === 'run') {
        r.recallAt = 0;
        r.st = 'back';
        r.backT = 0; r.bluff = false; r.backDive = false;
        r.backTo = { x: BAGS[clamp(r.at, 0, 3)].x, z: BAGS[clamp(r.at, 0, 3)].z };
        if (r.kid) r.kid.setFace('shock', 1.2);
        bus.emit('run:waved_back', { who: r.id, name: r.name, bag: BAG_TAG[clamp(r.at, 0, 3)] });
      }
    }
    this.dust.update(dt, app.camera.quaternion);
    this.bags.update(dt);
    this.lane.update(dt, crew.runners);
  },

  onScenario(name, app) {
    brng.reset(70918);
    crew.clear(true);
    crew.now = 0;
    this.dust.clear();
    this.bags.clear();
    this.lane.clear();
    const pl = players();
    if (pl && pl.batter) { pl.batter.runOut = false; pl.batter.onBase = false; }
  },
});

/* ============================================================================
   10. SCENARIOS
   ---------------------------------------------------------------------------
   All three are the REAL path with a pinned verdict, not a diagram of it: the
   core's `applyHit` writes the moves, src/game/fielding.js chases and throws for
   real, and this file stages whatever comes out. A critic looking at these is
   looking at the running game on a seed that produces it every time.
   ========================================================================= */

/** Ask the camera director for one of its two locked framings, if it is there. */
function framing(which) {
  const cam = APP.get('cameras');
  if (!cam || !cam.solutions) return;
  cam.pin = which;
  cam.cutIn = -1; cam.cutTo = null;
  cam.tilt = 0; cam.tiltGoal = 0;
  cam.pushT = -1;
  cam.cut(which, true);
}

/**
 * Put the block into a known situation and hit the ball.
 *
 * `on` names who is standing on which bag, by lineup slot, so the ids are real
 * kids with real cards and a real SPD. The core then does its own bookkeeping —
 * `applyHit` for a hit, `pendingThrow` for a play the human has to answer — and
 * this file and src/game/fielding.js both read the result rather than a copy.
 */
function stage(app, {
  seed = 1920, half = null, on = [null, null, null], bat = null, ball, vel, play, prompt = null, settle = 0, view = 'field',
}) {
  const sim = app.sim;
  sim.reset(seed);
  app.clock.advance(0.55);

  if (half !== null) liveMatch.half = half;
  const order = liveMatch.lineups[liveMatch.battingSide()];
  liveMatch.bases = on.map((slot) => (slot === null ? '' : order[slot % order.length]));
  if (bat !== null) liveMatch.batIdx[liveMatch.battingSide()] = bat;
  const batter = liveMatch.batterId();
  sim.syncState();
  crew.clear(true);
  crew.resync();

  const shot = { ...play, batter, moves: [], runs: 0 };
  if (prompt) {
    shot.needsThrow = { targets: liveMatch.throwTargets(), best: prompt.best, deadline: prompt.deadline || T.play.race.throwDeadline };
    liveMatch.pendingThrow = { play: shot, margin: shot.margin };
  } else if (shot.bases > 0) {
    liveMatch.applyHit(shot, shot.bases);
  }

  sim.state.phase = 'in_play';
  sim.playT = 0;
  sim.ball.pos.set(ball[0], ball[1], ball[2]);
  sim.ball.vel.set(vel[0], vel[1], vel[2]);
  sim.ball.spin.set(0, 0, 0);
  sim.ball.inFlight = true; sim.ball.live = true;
  sim.lastContact = { quality: shot.quality ?? 0.55, power: 68, angleDeg: 18, sprayRad: shot.lane || 0, kind: 'square' };
  sim.lastPlay = shot;
  sim.syncState(false);

  sim.__forcePlay = shot;
  if (gameplay.fielding && gameplay.fielding.onBallInPlay) gameplay.fielding.onBallInPlay(sim, sim.lastContact);
  sim.__forcePlay = null;
  if (prompt && app.fielding && app.fielding.play) {
    app.fielding.play.wantPrompt = shot.needsThrow;
  }
  crew.onContact(sim);
  crew.takeLeads(1);
  framing(view);
  if (settle) app.clock.advance(settle);
  // The prompt opens when the kid's hands close on the ball, and how long that
  // takes is src/game/fielding.js's business — so wait for it rather than
  // guessing at it, one fixed step at a time so the wait is as deterministic as
  // everything else in the harness.
  if (prompt && prompt.answer) {
    for (let i = 0; i < 240; i++) {
      const cur = app.fielding && app.fielding.play;
      if (cur && cur.phase === 'prompt') break;
      if (cur && (cur.phase === 'beat' || cur.phase === 'done')) break;
      app.clock.advance(1 / 60);
    }
    const cur = app.fielding && app.fielding.play;
    if (cur && cur.phase === 'prompt') cur.choose(prompt.answer);
    crew.applyMoves(shot);
  }
  // Advance to an ABSOLUTE play time rather than a blind offset from an event
  // whose moment this file does not control: the gather, and therefore the
  // prompt, is src/game/fielding.js's clock. Fixed steps, so it stays as
  // deterministic as everything else in the harness.
  if (prompt && prompt.until) {
    for (let i = 0; i < 480 && crew.now < prompt.until; i++) app.clock.advance(1 / 60);
  } else if (prompt && prompt.after) {
    app.clock.advance(prompt.after);
  }
}

export const STAGED = {
  /**
   * run_single — a clean single into left, and TWO runners on two diagonals.
   *
   * The ball goes to screen RIGHT and the running goes to screen LEFT, which is
   * the whole reason this is the ball chosen: on a stage 46 wide and 70 deep the
   * one thing a frame cannot afford is the fielders and the runners occupying the
   * same 300 px of it. Rose is on first and has to hold a beat on a liner, so she
   * is still at full stride into second while the batter is already leaning
   * through the turn — one frame, two runners, neither of them standing still.
   */
  single: {
    seed: 4111,
    on: [3, null, null],
    ball: [1.2, 3.0, 3.2], vel: [-19, 9.5, 30],
    play: { result: 'single', bases: 1, loft: 'line', fielder: 'SS', lane: -0.55, quality: 0.62, carry: 0.34, margin: 0.5 },
  },
  /**
   * run_close_play — the race to the stoop with Dom on the end of it, who is the
   * fastest kid on the block and, per the roster, nobody knows it. The core says
   * out by six hundredths; the throw is in the first baseman's hands with his
   * front foot still in the air. He runs THROUGH the bag, because nobody has ever
   * slid into first and been right about it.
   */
  close: {
    seed: 3311,
    on: [null, null, null], bat: 7,
    ball: [0, 2.6, 3.0], vel: [-12, 6, 22],
    play: { result: 'out_ground', bases: 0, loft: 'ground', fielder: 'SS', lane: -0.3, quality: 0.44, margin: -0.06 },
  },
  /**
   * run_slide — the play at the plate, which is the best slide in baseball and
   * the only one the ported core actually models (`resolveThrow('home')`).
   *
   * The gang are batting so the runner on third is Jesús, whose quirk is
   * `headfirst` — the core pays him +0.05 on the race and this file spends it on
   * the picture: he goes in on his stomach, into a manhole cover, at the front of
   * the stage where he is the biggest body in the frame.
   */
  slide: {
    seed: 5150, half: 1,
    on: [null, null, 4], bat: 2,
    ball: [0.8, 3.2, 3.0], vel: [15, 11.5, 31],
    play: { result: 'single', bases: 1, loft: 'line', fielder: 'RF', lane: 0.5, quality: 0.6, carry: 0.4, margin: 0.16 },
    prompt: { best: 'home', answer: 'home', deadline: 1.4 },
  },
};

/**
 * A clean single: the batter bananas round first with the block's dust still
 * hanging where he pushed off, and the kid who was on first is pulling into
 * second on the other diagonal.
 */
registerScenario('run_single', {
  seed: 4111,
  setup: ({ app }) => { stage(app, { ...STAGED.single, settle: 3.02 }); },
  settle: 0,
});

/**
 * Bang-bang at the stoop. The core called him out by six hundredths; the ball is
 * in the kid's hands and the runner's front foot is still in the air.
 */
registerScenario('run_close_play', {
  seed: 3311,
  setup: ({ app }) => { stage(app, { ...STAGED.close, settle: 1.675 }); },
  settle: 0,
});

/**
 * The play at the plate: the slide, the dust, and the argument that follows it.
 */
registerScenario('run_slide', {
  seed: 5150,
  setup: ({ app }) => {
    stage(app, { ...STAGED.slide, settle: 1.15, prompt: { ...STAGED.slide.prompt, until: 2.50 } });
  },
  settle: 0,
});

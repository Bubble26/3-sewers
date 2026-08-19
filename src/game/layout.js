import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { T } from '../core/tuning.js';
import { registerScenario } from '../core/scenarios.js';
import {
  GROUND, roadHeight, makeCanvas, canvasTexture, chalkStroke, chalkText, texMat, mat, outline,
} from '../world/props.js';

/* =============================================================================
 * THE FIELD LAYOUT — where every body stands on the stage.
 *
 * DESIGN-BIBLE §17 says the game is 3D characters on a 2D STAGE. A stage is not
 * a street: it is shallow, it is wide, and everything on it has to be legible
 * from two locked seats in the house. This file is the single place that decides
 * where a body goes, and it is written against three facts that fight each other.
 *
 * FACT 1 — a real stickball field is long and thin and mostly empty.
 *   Home is a manhole; second base is the NEXT manhole, 95 ft up the crown; the
 *   pitcher stands halfway between; the outfield is "the street" (PERIOD §1.3).
 *   Laid out honestly that is 200 ft of playing surface with nine kids strung
 *   down it like beads, and on a long lens the far ones are four pixels tall.
 *
 * FACT 2 — the stage is 70 deep and 46 wide (T.stage), and the 46 is free.
 *   Depth costs size: a kid's on-screen height is 50·h/(t·(z+C)), so every foot
 *   of z spent flattens the whole cast. Width costs nothing at all — moving a
 *   kid sideways changes where he is in the frame and not how big he is. So the
 *   layout spends z like money and x like water.
 *
 * FACT 3 — the leads have a band, not a floor (§17.3: batter, pitcher, catcher
 *   at 18–26%). pct ∝ 1/(z+C), so the pitcher can never be more than 26/18 =
 *   1.44× the catcher's depth from the lens. With the camera ~82 units off the
 *   plate that puts a hard ceiling on the pitcher of about z = 30. The 42-foot
 *   mound the first pass used cannot be lit by any legal lens; it is not a
 *   camera problem and it was never going to be solved by one.
 *
 * WHAT COMES OUT OF THAT
 * ---------------------------------------------------------------------------
 * The block plays a 0.63-scale game: second base 60 up the crown instead of 95,
 * the pitcher at 27 instead of 45, a true 35-foot diamond with its corners on
 * the x of the two chalk crosses src/world/surface.js already paints into the
 * road. Everything past second is outfield, and it stops at 64 — six units
 * inside the contract — so the last kid still measures over the floor.
 *
 * Then the width does the work the depth used to. The cast is placed by SCREEN
 * SLOT, not by baseball convention: each body's slot is x/(z+82), the angle it
 * subtends off the lens axis, and the layout keeps consecutive slots ~0.1 of a
 * frame apart so thirteen kids read as thirteen kids and not as a queue. That
 * is why the centre fielder is not on the crown (the crown projects onto the
 * batter's head) and why nobody but the batter is inside ±3 of the middle.
 *
 * And the street's own furniture is used as standing room, because a stickball
 * field is made of whatever is bolted down (PERIOD §1.3):
 *
 *   · the north curb at the foot of the stoop  — a kid flipping cigarette cards
 *   · the south curb at the areaway rail       — a kid watching, arms folded
 *   · the roof of the parked ice-and-coal truck — the self-appointed umpire,
 *     eight feet up, which is half a frame of vertical separation for free
 *   · the Ford's rear fender, the hydrant, the lamppost — the bases themselves
 *
 * NOTHING IN HERE IS A SUGGESTION. bounds are checked on every read: clamp()
 * and chase() are the only ways a position enters the world, so a fielder
 * chasing a ball up the block cannot walk off the stage even if the ball does.
 * ========================================================================== */

const S = T.stage;

/**
 * The stage floor. playWidth is curb to curb; playDepth is the plate to the
 * deepest fielder. The APRON is the only thing behind the plate — the catcher
 * and the on-deck kid have to stand somewhere — and it is deliberately tiny,
 * because depth behind the plate is depth in front of the lens and costs the
 * whole cast size.
 */
export const APRON = 6.5;
export const BOUNDS = {
  xMin: -S.playWidth / 2,
  xMax: S.playWidth / 2,
  zMin: -APRON,
  zMax: S.playDepth,
};

/** Ground height under a pair of feet: the crowned roadway, or the bluestone. */
export function groundAt(x) {
  return roadHeight(x) + 0.005;
}

/** Nothing enters the world without passing through here. */
export function clamp(x, z) {
  return {
    x: Math.min(BOUNDS.xMax, Math.max(BOUNDS.xMin, x)),
    z: Math.min(BOUNDS.zMax, Math.max(BOUNDS.zMin, z)),
  };
}

/**
 * Where a fielder is allowed to chase to. Tighter than the stage itself: a kid
 * standing on the very curb is standing in the gutter, and a kid at z=70 is at
 * the contract's edge with no room to overrun, so both are pulled in a little.
 */
export function chase(x, z) {
  return {
    x: Math.min(21.0, Math.max(-21.0, x)),
    z: Math.min(64.0, Math.max(-3.0, z)),
  };
}

/* ---------------------------------------------------------------------------
   THE DIAMOND
   Home is the manhole casting src/world/surface.js sets at the plate. The two
   corners keep the x of the chalk crosses that file paints (18.4 / −19.4) so
   the fresh marks sit in the same lane as last week's; only the z comes in.
   35 feet a side, and every leg within a foot of every other.
--------------------------------------------------------------------------- */
export const HOME = { x: 0.0, z: 0.0 };
export const FIRST = { x: 18.4, z: 30.0 };
export const SECOND = { x: 0.4, z: 60.0 };
export const THIRD = { x: -19.4, z: 30.0 };
export const BASES = [FIRST, SECOND, THIRD];

/**
 * CASTING IS PART OF THE LAYOUT, because on a long lens height is the only thing that
 * survives distance. A kid's on-screen height is 50·h/(t·depth), so a 3.96-unit Fireplug at
 * z=31 and a 5.36-unit Beanpole at z=64 measure the SAME. That is a free 60 units of stage:
 * cast the tall silhouettes deep and the short ones near, and the whole street clears the
 * 12% floor without the camera moving an inch.
 *
 * It happens to be how a sandlot picks sides anyway — the big kids go out, the barrel-chested
 * one squats behind the plate, the one who is all leg pitches — so the arithmetic and the
 * character design want the same nine kids in the same nine places. Families per §5.4:
 *
 *   Fireplug 3.96 · Sack 4.06 · Barefoot 4.30 · Melon 4.40 · Bandbox 4.62 · Brace 4.68
 *   Ears 4.72 · Ribbon 4.86 · Beanpole 5.36
 */

/** The batter's box: he stands off the casting, on the open side, half a step back. */
export const PLATE_BOX = { x: 2.9, z: -0.6, kid: 'otto', look: [0.9, 27], slot: 0.035 };

/** The pitcher's scratch, kept next to the pitcher so the two can never drift. */
export const PITCH_SCRATCH = { x: 0.9, z: 27.0 };

/**
 * The nine. `slot` is the screen slot each body was placed for — x/(z+83), which is very
 * nearly its NDC x over the solved lens — and it is written down so the next person to move
 * somebody can see, without rendering, whose piece of frame they are standing in. Consecutive
 * slots want ~0.025 between them; anything past ±0.16 is at the edge of the picture.
 */
export const POSTS = [
  {
    id: 'catcher', x: -3.0, z: -4.4, kid: 'sal', clip: 'crouch', look: [9.5, 22], slot: -0.036,
    note: 'The Fireplug: barrel torso, no neck, jammed cap. Squats on the casting, shaded to '
        + 'the batter\'s open side and turned a third of the way toward first, because the '
        + 'batting camera sits almost square behind him and a crouching kid seen dead astern '
        + 'is a rectangle with a cap on it. Nearest lead, so the SHORTEST kid on the block — his 26% '
        + 'ceiling is what decides how close the camera may come, and every other kid on the '
        + 'street is standing in the room he leaves.',
  },
  {
    id: 'pitcher', x: 0.9, z: 27.0, kid: 'irving', clip: 'pitch_set', look: [2.9, 0], slot: 0.008,
    note: 'The Beanpole, all leg. Halfway to second on the scratch — 27, not the old 42. At 42 '
        + 'he is 1.5x the catcher\'s depth and cannot reach 18% of frame at any legal lens; '
        + 'casting the tallest kid here buys back the rest.',
  },
  {
    id: 'first', x: 16.8, z: 31.5, kid: 'rocco', clip: 'ready', look: [0, 0], slot: 0.147,
    note: 'A step off the bag toward the plate, the black Ford at his back.',
  },
  {
    id: 'third', x: -17.8, z: 31.0, kid: 'luz', clip: 'ready', look: [0, 0], slot: -0.156,
    note: 'The lamppost corner, mirror of first, and the far edge of the picture on that side.',
  },
  {
    id: 'short', x: -7.2, z: 40.0, kid: 'reese', clip: 'idle_bounce', look: [0, 0], slot: -0.059,
    note: 'The hole between second and third. Never stops moving, which is the only thing in '
        + 'the middle of the frame that is not the pitcher.',
  },
  {
    id: 'right', x: 15.0, z: 50.0, kid: 'ethel', clip: 'ready', look: [0, 0], slot: 0.113,
    note: 'Deep on the Ford side and playing the fender: he knows it kicks left.',
  },
  {
    id: 'center', x: 9.0, z: 64.0, kid: 'herman', clip: 'idle', look: [0, 0], slot: 0.061,
    note: 'The deepest body on the stage and therefore the tallest kid on the block. Off the '
        + 'crown on purpose: the crown projects straight onto the batter\'s head.',
  },
  {
    id: 'left', x: -14.6, z: 60.0, kid: 'kathleen', clip: 'idle_slouch', look: [0, 0], slot: -0.102,
    note: 'Deepest on the lamppost side, bored, and about to be very busy.',
  },
];

/** The kid with the next turn, out of the swing path, watching the pitcher and not the ball. */
/**
 * The kid with the next turn, out of the swing path. He watches the BATTER, not the pitcher:
 * from a camera behind the plate that turns him broadside, and a kid in profile with a broom
 * handle is a silhouette while a kid seen from behind is a coat.
 */
export const ON_DECK = { x: -9.6, z: -5.5, kid: 'bessie', clip: 'bat_wait', look: [2.9, -0.6], slot: -0.124 };

/**
 * The rest of the batting side, waiting in the north gutter from the plate up, in the order
 * they bat. These are the three rigs baserunning wears, so a kid leaves the curb exactly when
 * it is his turn to be on the bases.
 *
 * They stand out at the curb rather than beside the plate for a reason worth writing down.
 * T.stage.framings.batting looks up the street on a 3.5 degree yaw, and a yaw costs lateral
 * frame in proportion to depth: at z=130 it drags everything 7.8 units toward screen right.
 * So in that framing world −x reaches the edge of the picture at depth and world +x never can
 * — the left quarter of the batting frame is unreachable by anything more than 40 up the
 * street. The only thing that can fill it is a body that is NEAR and far over on +x. That is
 * where the kids waiting to bat go, and it is also where they would really be standing.
 */
export const BENCH = [
  { x: 17.6, z: 4.5, kid: 'connie', clip: 'curb_wait', look: [2.9, -0.6], slot: 0.201 },
  { x: 18.6, z: 9.5, kid: 'peggy', clip: 'idle_slouch', look: [0.9, 27], slot: 0.201 },
  { x: 19.4, z: 14.5, kid: 'gertie', clip: 'idle', look: [0.9, 27], slot: 0.199 },
];

/**
 * The block, watching. Three of them on three different planes, because §13 asks for clusters
 * and distinct silhouettes rather than a row of heads.
 *
 * The curb pair sit DEEP on purpose. A body at the curb subtends x/(z+83), so the nearer he
 * stands the further out of frame he is: at z=30 a kid on the north curb is past the edge of
 * the picture, and at z=47 he is inside it. They are cast tall to pay for the depth.
 *
 * `y` is explicit: the gutter kids sit on the dish of the roadway with their backs to the
 * granite, and the umpire is on the load bed of the ice-and-coal truck src/world/vehicles.js
 * parks at (−18.2, 26, ry 0.04). Its cargo roof caps at local y 7.78 over a deck at 0.047, the
 * bed runs local z −8.1…1.3 and the stake posts are forward of local z 0.9 — so local
 * (+0.9, −1.0) is on the boards, on the street side, and clear of the ironwork.
 */
export const SPECTATORS = [
  {
    id: 'cards', x: 20.8, z: 52.0, kid: 'carmen', clip: 'sit_flip', face: 'grin',
    look: [2.9, 0], slot: 0.154,
    note: 'north gutter at the foot of the stoop, flipping cigarette cards against the granite',
  },
  {
    id: 'watcher', x: -20.9, z: 53.0, kid: 'rose', clip: 'idle_slouch', face: 'squint',
    look: [2.9, 0], slot: -0.154,
    note: 'south gutter by the areaway rail, arms folded, has opinions',
  },
  {
    id: 'umpire', x: -17.3, z: 25.0, y: 7.83, kid: 'cheech', clip: 'idle_bounce', face: 'taunt',
    look: [2.9, 0], slot: -0.160,
    note: 'up on the ice truck\'s load bed calling balls and strikes. Nobody asked him. Eight '
        + 'feet of elevation is half a frame of vertical separation for free, which is the '
        + 'only reason a fourth body fits down that side of the street.',
  },
];

/** Where a scoring kid gets mobbed, and the ring the block piles into. */
export const MOB = { x: 0.0, z: 3.2, radius: 4.4 };

const BY_ID = new Map();
for (const p of POSTS) BY_ID.set(p.id, p);
for (const s of SPECTATORS) BY_ID.set(s.id, s);
BY_ID.set('home', HOME);
BY_ID.set('plate', PLATE_BOX);
BY_ID.set('ondeck', ON_DECK);
BY_ID.set('base1', FIRST);
BY_ID.set('base2', SECOND);
BY_ID.set('base3', THIRD);

export const LAYOUT = {
  BOUNDS, APRON, HOME, PLATE_BOX, BASES, FIRST, SECOND, THIRD,
  POSTS, ON_DECK, BENCH, SPECTATORS, MOB,
  groundAt, clamp, chase,
  spot: (id) => BY_ID.get(id) || null,
  /** Every body this file places, for diagnostics and for anyone drawing marks. */
  all() {
    return [
      { id: 'plate', label: 'AT BAT', ...PLATE_BOX },
      { id: 'ondeck', label: 'UP NEXT', ...ON_DECK },
      ...POSTS.map((p) => ({ ...p, label: LABEL[p.id] || p.id.toUpperCase() })),
      ...SPECTATORS.map((s) => ({ ...s, label: LABEL[s.id] || s.id.toUpperCase() })),
    ];
  },
};

/** What the chalk diagram calls each of them. Street words, not baseball words. */
const LABEL = {
  catcher: 'BEHIND', pitcher: 'PITCHIN', first: 'FIRST', third: 'THIRD',
  short: 'SHORT', right: 'RIGHT', center: 'MIDDLE', left: 'LEFT',
  cards: 'CARDS', watcher: 'WATCHIN', umpire: 'THE UMP',
};

/* =============================================================================
 * CHALK — the layout, drawn on the road in the block's own hand.
 *
 * Every mark is soft schoolroom chalk painted into a canvas in WORLD FEET and
 * laid on a plane that follows the crown, using the same chalkStroke/chalkText
 * the roadway itself is painted with, so a fresh base cross and last week's
 * scuffed one are the same material at two ages.
 * ========================================================================== */

const CX0 = -24, CX1 = 24, CZ0 = -10, CZ1 = 72;      // the canvas' world window
const PPF = 13;                                       // pixels per foot

function chalkCanvas() {
  const w = Math.round((CX1 - CX0) * PPF), h = Math.round((CZ1 - CZ0) * PPF);
  const { c, g } = makeCanvas(w, h);
  // canvas +x -> world +x, canvas +y -> world +z, matching src/world/surface.js
  const X = (wx) => (wx - CX0) * PPF;
  const Z = (wz) => (wz - CZ0) * PPF;
  return { c, g, X, Z, w, h };
}

/** Chalk that lies on the ground reads backwards: the lens is up-street of it. */
function groundText(g, text, px, pz, size, opts = {}) {
  g.save();
  g.translate(px, pz);
  g.rotate(Math.PI);
  chalkText(g, text, 0, 0, size, { align: 'center', ...opts });
  g.restore();
}

/** A base: two crossed strokes and a numeral, in the hand surface.js uses. */
function chalkCross(ctx, x, z, r, label, seed) {
  const { g, X, Z } = ctx;
  const W = PPF * 0.30;
  const line = (a, b, s, alpha, wid) => chalkStroke(g, [[X(a[0]), Z(a[1])], [X(b[0]), Z(b[1])]], wid, s, alpha);
  line([x - r, z - r], [x + r, z + r], seed, 0.95, W * 1.7);
  line([x + r, z - r], [x - r, z + r], seed + 2, 0.95, W * 1.7);
  if (label) groundText(g, label, X(x), Z(z - r - 1.4), 1.05 * PPF, { seed: seed + 4, weight: 0.16, alpha: 0.8 });
}

function buildChalk(scene) {
  const ctx = chalkCanvas();
  const { g, X, Z } = ctx;
  const W = PPF * 0.30;
  const line = (pts, seed, alpha = 0.85, wid = W) =>
    chalkStroke(g, pts.map(([a, b]) => [X(a), Z(b)]), wid, seed, alpha);

  // the batter's box: two brackets round the casting, redrawn every game and
  // therefore the freshest chalk on the block
  for (const s of [1, -1]) {
    line([[s * 1.5, -2.6], [s * 4.6, -2.6], [s * 4.6, 2.4], [s * 1.5, 2.4]], 201 + s, 0.9, W * 1.15);
  }
  // the pitcher's scratch, halfway to second, with the ball of his foot worn into it
  line([[PITCH_SCRATCH.x - 2.4, PITCH_SCRATCH.z], [PITCH_SCRATCH.x + 2.4, PITCH_SCRATCH.z]], 211, 0.92, W * 1.35);

  // the three bases
  chalkCross(ctx, FIRST.x, FIRST.z, 2.5, '1', 221);
  chalkCross(ctx, SECOND.x, SECOND.z, 2.7, '2', 231);
  chalkCross(ctx, THIRD.x, THIRD.z, 2.5, '3', 241);

  const tex = canvasTexture(ctx.c);
  const mesh = new THREE.Mesh(crownedPlane(CX1 - CX0, CZ1 - CZ0, (CZ0 + CZ1) / 2, 0.028),
    texMat(tex, { transparent: true, depthWrite: false, lift: 0.55 }));
  mesh.name = 'layout_chalk';
  mesh.renderOrder = 2;
  scene.add(mesh);
  return mesh;
}

/**
 * The diagnostic overlay for `layout_positions`: the base paths and a chalk
 * word under every body. Same chalk, one plane higher, and off in every other
 * scenario — a diagram the block could plausibly have drawn itself.
 */
function buildDiagram(scene) {
  const ctx = chalkCanvas();
  const { g, X, Z } = ctx;
  const W = PPF * 0.24;
  const dash = (a, b, seed) => {
    const n = 9;
    for (let i = 0; i < n; i += 2) {
      const t0 = i / n, t1 = Math.min(1, (i + 1) / n);
      chalkStroke(g, [
        [X(a[0] + (b[0] - a[0]) * t0), Z(a[1] + (b[1] - a[1]) * t0)],
        [X(a[0] + (b[0] - a[0]) * t1), Z(a[1] + (b[1] - a[1]) * t1)],
      ], W, seed + i, 0.62);
    }
  };
  const ring = [HOME, FIRST, SECOND, THIRD, HOME];
  for (let i = 0; i < 4; i++) dash([ring[i].x, ring[i].z], [ring[i + 1].x, ring[i + 1].z], 301 + i * 11);

  for (const b of LAYOUT.all()) {
    // The word goes UNDER the feet — smaller z is nearer the lens, so it lands below the kid
    // instead of across his knees — and it is drawn small and faint, because a diagram that
    // shouts louder than the thing it is describing is not a diagram.
    if ((b.y || 0) > 2) {
      // a body standing on something gets a tick on the road beneath him
      chalkStroke(g, [[X(b.x), Z(b.z - 2.4)], [X(b.x), Z(b.z + 0.6)]], W * 0.8, 401, 0.45);
    }
    groundText(g, b.label, X(b.x), Z(b.z - 3.4), 0.82 * PPF, { seed: 411, weight: 0.15, alpha: 0.62 });
  }
  const tex = canvasTexture(ctx.c);
  const mesh = new THREE.Mesh(crownedPlane(CX1 - CX0, CZ1 - CZ0, (CZ0 + CZ1) / 2, 0.05),
    texMat(tex, { transparent: true, depthWrite: false, lift: 0.6 }));
  mesh.name = 'layout_diagram';
  mesh.renderOrder = 3;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

/** A plane that follows the crown of the road, so chalk never floats or sinks. */
function crownedPlane(spanX, spanZ, cz, lift) {
  const geo = new THREE.PlaneGeometry(spanX, spanZ, 24, 8);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, roadHeight(p.getX(i)) + lift);
  geo.translate(0, 0, cz);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Somebody's cap, laid on the asphalt and weighed down with a stone, because
 * on this block second base is not a bag and there is no casting to use.
 */
function capAtSecond(scene) {
  const g = new THREE.Group();
  g.name = 'second_base_cap';
  const wool = mat(0x6f5b46);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.05, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), wool);
  crown.scale.set(1, 0.40, 1);
  g.add(crown); outline(crown, 0.045);
  const brimGeo = new THREE.CircleGeometry(1.0, 16, Math.PI, Math.PI);
  brimGeo.rotateX(-Math.PI / 2);
  brimGeo.scale(1.35, 1, 0.95);
  const brim = new THREE.Mesh(brimGeo, mat(0x5b4938, { side: THREE.DoubleSide }));
  brim.position.set(0, 0.09, 0.55);
  g.add(brim); outline(brim, 0.035);
  const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), mat(0x8d8578));
  stone.position.set(0.42, 0.46, -0.28);
  g.add(stone); outline(stone, 0.035);
  g.position.set(SECOND.x, groundAt(SECOND.x), SECOND.z);
  g.rotation.y = 0.6;
  scene.add(g);
  return g;
}

/* =============================================================================
 * THE SYSTEM
 * ========================================================================== */

export default registerSystem({
  name: 'layout',
  order: 15,                      // before players (20): they read it in init

  init(app) {
    app.layout = LAYOUT;
    this.chalk = buildChalk(app.scene);
    this.diagram = buildDiagram(app.scene);
    this.cap = capAtSecond(app.scene);
  },

  onScenario(name) {
    if (this.diagram) this.diagram.visible = name === 'layout_positions';
  },
});

/* =============================================================================
 * SCENARIOS
 * ========================================================================== */

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
 * layout_positions — the diagnostic. Every body at its post, the base paths and
 * the block's own words chalked on the road under them, shot on the wide locked
 * framing. If a kid is standing somewhere this file did not put him, this is the
 * frame that shows it.
 */
registerScenario('layout_positions', {
  seed: 1925,
  setup: () => {
    APP.sim.reset(1925);
    const P = APP.get('players');
    if (P) P.homePose();
    framing('field');
  },
  settle: 0.5,
});

/**
 * layout_field — the same arrangement doing its job: a ball driven into the
 * right-centre gap, the two nearest kids converging on it, the corners holding
 * their bags and the block reacting. The live version of the diagram.
 */
registerScenario('layout_field', {
  seed: 606,
  setup: () => {
    APP.sim.reset(606);
    APP.clock.advance(0.62);
    const b = APP.sim.ball;
    b.pos.set(6.0, 6.4, 20.0);
    b.vel.set(12.5, 4.0, 40.0);
    b.live = true; b.inFlight = true;
    APP.sim.state.phase = 'in_play';
    APP.sim.playT = 0;
    const P = APP.get('players');
    if (P) P.reactToBall(APP, 0.0);
    framing('field');
  },
  settle: 0.62,
});

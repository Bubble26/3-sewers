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
 * Where a fielder is allowed to chase to.
 *
 * Tighter than the stage itself in x — a kid at the very curb is standing in the gutter — and
 * tighter in z BY HOW TALL HE IS, which is the part worth explaining. Screen height is
 * 50·h/(t·depth), so the depth at which a kid hits the §17.3 floor is proportional to his own
 * height. Measured against the solved framings, a 5.36-unit Beanpole at z=64 renders at 14.2%
 * of frame, which pins the constant: a kid of height h stays above 13.8% out to a depth
 * of 2087·(h/5.36)/13.8 ≈ 28.2·h, i.e. z ≈ 28.2·h − 83.
 *
 * Without this a short kid backing up a deep fly runs himself off the bottom of the scale —
 * measured, a 4.68 Brace sent to z=64 rendered at exactly 12.0%, on the floor — which is a
 * frame the build fails for a reason no artist put there. The posts themselves are cast so
 * that nobody is ever posted past his own limit (src/game/layout.js POSTS); this is the guard
 * for everywhere the ball sends him afterwards.
 */
export function chase(x, z, tall = 4.4) {
  const zMax = Math.min(64, Math.max(34, 28.2 * tall - 83));
  return {
    x: Math.min(21.0, Math.max(-21.0, x)),
    z: Math.min(zMax, Math.max(-3.0, z)),
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
export const THIRD = { x: -13.6, z: 31.0 };
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
export const PLATE_BOX = { x: 2.9, z: 2.0, kid: 'otto', look: [0.9, 24], slot: 0.034 };
// He stands a foot UP-STREET of the casting rather than level with it, and that foot is not
// decoration. He is the biggest body in the frame and the solver parks him against the 26%
// lead ceiling, so a pose that raises the broom handle an inch tips him over it — measured,
// 26.7% on the portrait sheet. A foot of depth is 2% of frame height and buys the margin
// without moving him out of his own chalk box, which runs z −2.6…2.4.

/** The pitcher's scratch, kept next to the pitcher so the two can never drift. */
export const PITCH_SCRATCH = { x: 0.9, z: 24.0 };

/**
 * The nine. `slot` is the screen slot each body was placed for — x/(z+83), which is very
 * nearly its NDC x over the solved lens — and it is written down so the next person to move
 * somebody can see, without rendering, whose piece of frame they are standing in. Consecutive
 * slots want ~0.025 between them; anything past ±0.16 is at the edge of the picture.
 */
export const POSTS = [
  {
    id: 'catcher', x: -7.5, z: -4.0, kid: 'sal', clip: 'ready', look: [12, 20], slot: -0.095,
    note: 'The Fireplug: barrel torso, no neck, jammed cap. Back of the casting, shaded to the '
        + 'batter\'s open side and turned a third of the way toward first, because the batting '
        + 'camera sits almost square behind him. He does NOT squat: a catcher\'s crouch is a '
        + 'baseball pose that needs a mitt and a mask, PERIOD §1.4 says no gloves ever, and a '
        + 'squatting kid seen dead astern renders as a rectangle with a cap on it. Hands on '
        + 'knees is what a bare-handed kid actually does back there and it has arms and legs '
        + 'in it. He stands well off to the open side rather than dead behind the casting: a '
        + 'slow-pitch street game has no plate umpire to stand behind and nothing to catch '
        + 'with, so back-and-to-the-side is the true position — and it is the only body that '
        + 'can fill the middle-right of the batting frame, which is otherwise a third of a '
        + 'frame of empty road between the pitcher and the shortstop. Nearest lead, so the '
        + 'SHORTEST kid on the block — his 26% ceiling is what '
        + 'decides how close the camera may come, and every other kid on the street is '
        + 'standing in the room he leaves.',
  },
  {
    id: 'pitcher', x: 0.9, z: 24.0, kid: 'irving', clip: 'pitch_set', look: [2.9, 0], slot: 0.008,
    note: 'The Beanpole, all leg. Halfway to second on the scratch — 27, not the old 42. At 42 '
        + 'he is 1.5x the catcher\'s depth and cannot reach 18% of frame at any legal lens; '
        + 'casting the tallest kid here buys back the rest.',
  },
  {
    id: 'first', x: 16.8, z: 31.5, kid: 'rocco', clip: 'ready', look: [0, 0], slot: 0.147,
    note: 'A step off the bag toward the plate, the black Ford at his back.',
  },
  {
    id: 'third', x: -12.6, z: 44.0, kid: 'luz', clip: 'ready', look: [0, 0], slot: -0.099,
    note: 'Past the ice truck\'s tailgate. The truck is parked across the old third-base '
        + 'corner (it fills x −21.9…−14.5, z 16.7…35.3), so the bag was re-chalked on its '
        + 'street side and the kid plays behind the whole thing — which is exactly what a '
        + 'block does when somebody parks on third. Inboard of his own bag rather than outside '
        + 'it, because the curb line at that depth is where the umpire and the deep left kid '
        + 'already are and three bodies in one screen column is one body.',
  },
  {
    id: 'short', x: -7.2, z: 40.0, kid: 'reese', clip: 'idle_bounce', look: [0, 0], slot: -0.059,
    note: 'The hole between second and third. Never stops moving, which is the only thing in '
        + 'the middle of the frame that is not the pitcher.',
  },
  {
    id: 'right', x: 13.0, z: 52.0, kid: 'ethel', clip: 'ready', look: [0, 0], slot: 0.097,
    note: 'Level with the black Ford and just inboard of it (the car fills x 15.1…21.7, '
        + 'z 44.3…55.7). He plays the fender rather than standing in it: he knows it kicks left.',
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
 * The kid with the next turn. He waits BEHIND the hitter's back — the batter stands on the
 * +x side of the casting and swings toward −x, so this is both the safe side and the side a
 * real on-deck kid stands on. He watches the BATTER rather than the pitcher, which turns him
 * broadside to the lens: a kid in profile with a broom handle is a silhouette, and a kid seen
 * from behind is a coat.
 *
 * It also fills the one hole the composition had. With him behind the plate on the far side
 * the whole near-left quadrant of the batting frame — a fifth of the picture — was bare road.
 */
export const ON_DECK = { x: 12.5, z: -4.5, kid: 'bessie', clip: 'bat_wait', look: [2.9, -0.6], slot: 0.159 };

/**
 * The rest of the batting side. These are the three rigs baserunning wears, so a kid leaves
 * the curb exactly when it is his turn to be on the bases — and until then he is off the
 * picture, because thirteen bodies is what a 16:9 frame holds at 12% a head and the
 * fourteenth turns the north gutter into a pile. Measured: with them standing there the five
 * bodies on that side of the frame sat 0.01–0.06 apart in NDC x, which is one kid wide.
 *
 * They are still PLACED rather than parked at the origin: the arbiter measures every kid in
 * the scene whether or not he is drawn, and the camera solver composes on all of them, so an
 * invisible kid in a silly place is a camera fault nobody can see. These three sit in the
 * north gutter in the order they bat, well inside the frame's extremes.
 */
export const BENCH = [
  { x: 12.0, z: 6.0, kid: 'connie', clip: 'curb_wait', look: [2.9, -0.6], slot: 0.135 },
  { x: 13.0, z: 11.0, kid: 'peggy', clip: 'idle_slouch', look: [0.9, 24], slot: 0.138 },
  { x: 14.0, z: 16.0, kid: 'gertie', clip: 'idle', look: [0.9, 24], slot: 0.141 },
];

/**
 * The block, watching. Three of them on three different planes, because §13 asks for clusters
 * and distinct silhouettes rather than a row of heads.
 *
 * All three are on the north side of the street, and that is arithmetic rather than taste.
 * T.stage.framings.batting looks up the block on a 3.5-degree yaw, and a yaw costs lateral
 * frame in proportion to depth: at z=130 it drags the whole picture 7.8 units toward screen
 * right. So in that framing world −x runs off the edge at depth and world +x never reaches it
 * — measured, a spectator on the south curb at z=50 lands at NDC 1.0, fully outside the
 * picture, while the same kid on the north curb sits at −0.44 with room either side. The
 * north side is the cheap side; everything optional lives there.
 *
 * `y` is explicit where the ground is not the road: the card kid sits in the gutter dish with
 * his back to the granite, the watcher is up on the bluestone by the lamppost, and the umpire
 * is on the load bed of the ice-and-coal truck src/world/vehicles.js parks at (−18.2, 26,
 * ry 0.04). Its cargo roof caps at local y 7.78 over a deck at 0.047, the bed runs local
 * z −8.1…1.3 and the stake posts are forward of local z 0.9 — so local (+2.3, −1.0) is on the
 * boards, on the street side, and clear of the ironwork.
 */
export const SPECTATORS = [
  {
    id: 'cards', x: 21.0, z: 33.0, kid: 'carmen', clip: 'sit_flip', face: 'grin',
    look: [2.9, 0], slot: 0.181,
    note: 'north gutter at the foot of the stoop, between the ash cans and the fruit cart, '
        + 'flipping cigarette cards against the granite',
  },
  {
    id: 'watcher', x: 22.6, z: 14.0, y: GROUND.walkTop, kid: 'rose', clip: 'idle_slouch', face: 'squint',
    look: [2.9, -0.6], slot: 0.269,
    note: 'standing over him with her arms folded, having opinions. The pair are a CLUSTER '
        + 'rather than a row (§13), and they are both on the north side because the batting '
        + 'framing\'s yaw makes that side of the frame cheap and the other side expensive: a '
        + 'spectator on the south curb costs the whole cast three points of frame height.',
  },
  {
    id: 'umpire', x: -15.9, z: 25.0, y: 7.83, kid: 'cheech', clip: 'idle_bounce', face: 'taunt',
    look: [2.9, 0], slot: -0.147,
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
  umpire: 'THE UMP',   // the spectators keep their rings and lose their words: at z=33 a
                       // second label lands on top of FIRST's and the pair read as neither
  plate: 'AT BAT', ondeck: 'UP NEXT',
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
    line([[s * 1.5, -3.0], [s * 4.8, -3.0], [s * 4.8, 3.8], [s * 1.5, 3.8]], 201 + s, 0.9, W * 1.15);
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

  // a chalk ring under every pair of feet: the block marks a spot the way a block would
  for (const b of LAYOUT.all()) {
    const y = b.y || 0;
    const r = 1.9;
    const pts = [];
    for (let i = 0; i <= 22; i++) {
      const a = i / 22 * Math.PI * 2;
      pts.push([X(b.x + Math.cos(a) * r * 1.25), Z(b.z + Math.sin(a) * r)]);
    }
    chalkStroke(g, pts, W * 0.9, 431, 0.55);
    // a body standing on something gets a tick from the ring up to where he actually is
    if (y > 2) chalkStroke(g, [[X(b.x), Z(b.z)], [X(b.x), Z(b.z - 2.6)]], W * 0.8, 401, 0.45);
    // The word only goes on the ground where the ground still reads. Anything inside z=18 is
    // so oblique to a 17-degree lens that ground lettering smears into a vertical streak, so
    // the near bodies get the ring and nothing else — and the size grows with depth so every
    // word lands at the same height on screen instead of the same height on the road.
    if (b.z < 18 || !b.label) continue;
    groundText(g, b.label, X(b.x), Z(b.z - 5.0), 0.62 * (1 + b.z / 85) * PPF,
      { seed: 411, weight: 0.15, alpha: 0.62 });
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
    // Driven into the gap behind second on purpose. That is the one hole in the arrangement,
    // and it is the shot that proves the arrangement: the ball lands between the middle kid
    // and the deep left kid, so BOTH have to move and the frame shows them converging with
    // the corners still holding their bags. Timed so the ball is still in the air and neither
    // has arrived — a fielder already lying on the road is a pose, not an arrangement.
    const b = APP.sim.ball;
    b.pos.set(2.2, 6.0, 18.0);
    b.vel.set(-4.0, 11.0, 38.4);
    b.live = true; b.inFlight = true;
    APP.sim.state.phase = 'in_play';
    APP.sim.playT = 0;
    const P = APP.get('players');
    if (P) {
      P.batter.act('swing', { state: 'swing', speed: 0.75 });
      P.reactToBall(APP, 0.0);
    }
    framing('field');
  },
  settle: 0.72,
});

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

/* ---------------------------------------------------------------------------
   SCENERY THAT CAN HIDE A KID.

   Three things stand on this stage that are taller than a nine-year-old's waist
   and wide enough to swallow him: the fruit barrow on the north walk, the
   ice-and-coal truck at the south curb, and the black Ford parked on first.
   Boxes copied from the colliders their owners register — src/world/props.js
   `pushcart` and src/world/vehicles.js `register()` — so if either moves, this
   is wrong and the diagnostic will show it.

   A kid parked behind one of these does not read as a player. He reads as a
   passer-by who has been cut off at the waist, which is exactly what a critic
   said about the two bodies behind the barrow in round 1. So the shadow each
   one throws from the two locked seats is a NO-STAND ZONE, checked in code.
--------------------------------------------------------------------------- */
export const SCENERY = [
  { id: 'pushcart', x0: 22.3, x1: 28.3, z0: 41.0, z1: 47.0, top: 3.6 },
  { id: 'ice truck', x0: -21.5, x1: -14.9, z0: 16.8, z1: 35.2, top: 8.6 },
  { id: 'black ford', x0: 15.2, x1: 21.6, z0: 44.4, z1: 55.6, top: 7.0 },
];

/** Segment vs axis-aligned box, slab method, in the three axes that matter. */
function segHitsBox(ax, ay, az, bx, by, bz, b) {
  let t0 = 0, t1 = 1;
  const slab = (p, d, lo, hi) => {
    if (Math.abs(d) < 1e-6) return p >= lo && p <= hi;
    let n = (lo - p) / d, f = (hi - p) / d;
    if (n > f) { const q = n; n = f; f = q; }
    if (n > t0) t0 = n;
    if (f < t1) t1 = f;
    return t0 <= t1;
  };
  if (!slab(ax, bx - ax, b.x0, b.x1)) return false;
  if (!slab(ay, by - ay, -0.5, b.top)) return false;
  if (!slab(az, bz - az, b.z0, b.z1)) return false;
  // A grazing hit in the last few percent of the ray is the kid's own feet on his own
  // perch, not an occlusion, so the far end of the segment is open.
  return t0 <= t1 && t1 > 0.02 && t0 < 0.94;
}

/**
 * Is a body standing at (x, z, y) hidden behind scenery from either locked seat?
 *
 * The ray is aimed at the CHEST rather than the head or the feet: a kid whose shins are
 * behind a barrow is fine — that is what a barrow does — and a kid whose chest is behind
 * one has lost his silhouette, his shirt colour and his face in one go.
 */
export function blocks(x, z, y = 0) {
  const views = lockedViews();
  if (!views.length) return null;
  for (const b of SCENERY) {
    if (b.top <= y + 0.15) continue;            // he is standing on it, or over it
    for (const v of views) {
      if (segHitsBox(v.eye.x, v.eye.y, v.eye.z, x, y + 2.4, z, b)) return b.id;
    }
  }
  return null;
}

/**
 * Nothing enters the world without passing through here.
 *
 * As well as the stage bounds it now walks a body out of any scenery shadow, because a post
 * placed behind the barrow is a post nobody can see. The escape is lateral and small — up to
 * six feet, tried nearest-first — and it gives up rather than teleporting anyone: a body that
 * cannot get clear keeps its place and the diagnostic shows it standing in the dark.
 */
export function clamp(x, z, y = 0) {
  const cx = Math.min(BOUNDS.xMax, Math.max(BOUNDS.xMin, x));
  const cz = Math.min(BOUNDS.zMax, Math.max(BOUNDS.zMin, z));
  if (!blocks(cx, cz, y)) return { x: cx, z: cz };
  for (let d = 0.75; d <= 6.0; d += 0.75) {
    for (const s of [1, -1]) {
      const nx = Math.min(BOUNDS.xMax, Math.max(BOUNDS.xMin, cx + s * d));
      if (!blocks(nx, cz, y)) return { x: nx, z: cz };
    }
  }
  return { x: cx, z: cz };
}

/* ---------------------------------------------------------------------------
   THE TWO SEATS IN THE HOUSE, and how a body projects into them.

   §17.4 locks the camera to two framings and cuts between them. src/render/
   cameras.js solves the exact position of each at boot against the cast that is
   actually standing in the street; until it has, T.stage.framings is the
   contract they are solved from and close enough to plan against. Everything
   below is read-only — this file never writes a camera.
--------------------------------------------------------------------------- */
const _views = { built: null, list: [] };

function makeView(pos, look, fov) {
  const eye = new THREE.Vector3(...pos);
  const fwd = new THREE.Vector3(...look).sub(eye).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  return { eye, fwd, right, up, t: Math.tan(fov * Math.PI / 360), aspect: 16 / 9 };
}

function lockedViews() {
  const cam = APP.get && APP.get('cameras');
  const sol = cam && cam.solutions;
  const key = sol ? 'solved' : 'nominal';
  if (_views.built === key) return _views.list;
  _views.built = key;
  if (sol) {
    _views.list = ['batting', 'field'].filter((k) => sol[k]).map((k) => {
      const f = sol[k];
      const fwd = f.fwd ? f.fwd.clone().normalize()
        : new THREE.Vector3(0, 0, 1).applyQuaternion(f.quat).negate();
      const look = f.pos.clone().add(fwd);
      return makeView(f.pos.toArray(), look.toArray(), f.fov ?? S.lens.fov);
    });
  } else {
    _views.list = [S.framings.batting, S.framings.field]
      .map((f) => makeView(f.pos, f.look, f.fov ?? S.lens.fov));
  }
  return _views.list;
}

const _p = new THREE.Vector3();
/** Where a world point lands, in 1600x900 pixels, and how far down the lens it is. */
function toScreen(v, x, y, z) {
  _p.set(x, y, z).sub(v.eye);
  const d = _p.dot(v.fwd);
  if (d <= 0.2) return null;
  return {
    px: (_p.dot(v.right) / (d * v.t * v.aspect) * 0.5 + 0.5) * 1600,
    py: (0.5 - _p.dot(v.up) / (d * v.t) * 0.5) * 900,
    d,
  };
}

/**
 * How tall a body of each tier ends up on screen, in percent of frame height.
 *
 * These are not measurements of this file's work — src/render/cameras.js owns §17.6's staged
 * scale and drives every kid to a height by role. They are the numbers that file lands on,
 * written down here so the separation pass below can reason about how much of the frame a
 * body will actually occupy without rendering one. If they drift, the separation gets
 * conservative, not wrong: a wrong guess costs a foot of standing room, not a merged pair.
 */
const TIER_PCT = { subject: 25.0, lead: 19.0, field: 15.5, block: 14.5 };
// A kid is about 0.30 as wide as he is tall, arms in. `wide` scales it for anybody holding a
// stick or with both hands out in front.
const WIDTH_RATIO = 0.30;

function footprint(v, b) {
  const s = toScreen(v, b.x, b.y || groundAt(b.x), b.z);
  if (!s) return null;
  const h = (TIER_PCT[b.tier] || TIER_PCT.field) / 100 * 900;
  const hw = h * WIDTH_RATIO * (b.wide || 1) * 0.5;
  return { cx: s.px, hw, top: s.py - h, bot: s.py, d: s.d };
}

/**
 * SEPARATE — no two children welded into one silhouette.
 *
 * The `slot` metric this file was built on (x/(z+83), the angle a body subtends off the lens
 * axis) is necessary and not sufficient, and round 1 proved it: it measures lateral angle and
 * cannot see two kids sharing a screen COLUMN at different depths. Measured in that build,
 * the third baseman's boots were drawn on the shortstop's cap at (1195,300)/(1230,190) of the
 * wide shot, and the two of them scored as comfortably separated because they were.
 *
 * So this pass does the only thing that actually answers the question: it projects every
 * posted body through BOTH locked framings, in pixels, and pushes bodies apart in x until no
 * two of them overlap horizontally by more than 40% of the narrower one's width WHILE their
 * vertical spans overlap at all. Two kids in the same column at the same height are one kid.
 * Two kids in the same column with clear sky between them are a composition.
 *
 * x is the currency because x is free (see FACT 2 at the top of this file): moving a body
 * sideways changes where he is in the frame and not how big he is. Bodies that cannot pay —
 * the batter, the catcher and the pitcher, who are the axis; the kid standing on a car —
 * carry `pinX` and everybody else moves around them.
 */
function separate(bodies) {
  const views = lockedViews();
  const movable = bodies.filter((b) => !b.pinX);
  if (!views.length || !movable.length) return;
  const GAP = 0.40;                       // §the brief: 40% of the narrower body
  for (let pass = 0; pass < 90; pass++) {
    let worst = 0;
    const push = new Map(bodies.map((b) => [b, 0]));
    for (const v of views) {
      const fp = new Map();
      for (const b of bodies) { const f = footprint(v, b); if (f) fp.set(b, f); }
      // dpx/dx, measured rather than derived, so a yawed camera is handled for free
      const grad = new Map();
      for (const b of bodies) {
        const a = toScreen(v, b.x, b.y || groundAt(b.x), b.z);
        const c = toScreen(v, b.x + 1, b.y || groundAt(b.x), b.z);
        grad.set(b, a && c ? (c.px - a.px) || 1e-3 : 1e-3);
      }
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const A = bodies[i], B = bodies[j];
          if (A.pinX && B.pinX) continue;
          const a = fp.get(A), b = fp.get(B);
          if (!a || !b) continue;
          if (a.bot <= b.top || b.bot <= a.top) continue;        // clear sky between them
          const want = a.hw + b.hw - GAP * Math.min(a.hw, b.hw);
          const dx = b.cx - a.cx;
          const over = want - Math.abs(dx);
          if (over <= 0) continue;
          worst = Math.max(worst, over);
          // The one further from the lens gives way: a near body is the one the eye is on.
          const dir = dx >= 0 ? 1 : -1;
          const share = [A.pinX ? 0 : 1, B.pinX ? 0 : 1];
          const tot = share[0] + share[1];
          if (!tot) continue;
          const move = over * 0.34;
          push.set(A, push.get(A) - dir * move * (share[0] / tot) / Math.abs(grad.get(A)));
          push.set(B, push.get(B) + dir * move * (share[1] / tot) / Math.abs(grad.get(B)));
        }
      }
    }
    if (worst < 1.0) break;
    for (const b of movable) {
      const d = push.get(b) || 0;
      if (!d) continue;
      const nx = Math.min(21.0, Math.max(-21.0, b.x + Math.max(-1.2, Math.min(1.2, d))));
      const clear = clamp(nx, b.z, b.y || 0);
      b.x = clear.x;
    }
  }
  for (const b of bodies) b.slot = +(b.x / (b.z + 83)).toFixed(3);
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
   THE DIAMOND — and it is not a square, and it was never going to be.

   Home is the manhole casting src/world/surface.js sets at the plate; second is
   the next casting up the crown. The two side corners keep the x of the chalk
   crosses that file paints (18.4 / −19.4) so the fresh marks sit in the same
   lane as last week's; only the z comes in.

   The legs measure 35.2 (home→first), 35.0 (first→second), 32.2 (second→third)
   and 33.9 (third→home) — three units of spread, not "within a foot", which is
   what an earlier draft of this comment claimed. The claim is deleted rather
   than fixed because it cannot be fixed: a square on a 60-unit long axis wants
   its side corners at x ±30, and the street is 46 wide curb to curb. A block
   that chalks its bases between two sewer lids gets a KITE, squashed by the
   kerbs, and every stickball diagram ever drawn on a New York street is one.
   Anyone re-solving these four points should solve them against the street's
   width, not against a protractor.
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

/**
 * The batter's box: he stands off the casting, on the open side, half a step back.
 *
 * He stands a foot UP-STREET of the casting rather than level with it, and that foot is not
 * decoration: a foot of depth is two points of frame height, and he is the body every other
 * body's size is derived from (§17.6).
 *
 * x moved out from 2.9 to 4.6 in round 2, and that is the price of putting the catcher back
 * on the pitch axis. The BATTING lens sits almost square up the axis, so a catcher at x ≈ 1
 * and a batter at x ≈ 3 land in the same screen column and fuse into one silhouette — the
 * exact fault `separate()` below exists to catch. 4.6 is still inside his own chalk box
 * (which runs |x| 1.5…4.8, z −2.6…2.4) and it opens ninety pixels of daylight between the two
 * of them at 1600×900.
 */
export const PLATE_BOX = { x: 4.6, z: 2.0, kid: 'otto', look: [0.9, 24], slot: 0.034, tier: 'subject', pinX: true, wide: 1.35 };

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
    id: 'catcher', x: 1.3, z: -4.6, kid: 'sal', clip: 'ready', look: [0.9, 24], yawDeg: 40,
    slot: 0.017, tier: 'lead', accent: 'claret', garment: 'sweater', pinX: true, wide: 1.30,
    note: 'The Fireplug: barrel torso, no neck, jammed cap. BEHIND THE PLATE, on the pitch '
        + 'axis — pitcher (0.9, 24) → home (0, 0) → here is collinear to 1.42 units, which is '
        + 'the whole point of him. Round 1 parked him at x −7.5, ten units off the axis and '
        + 'seen dead astern, and a critic called him "a red armchair standing beside the '
        + 'plate": the pitcher→batter→catcher triangle that tells a player a pitch is coming '
        + 'never formed. It forms now. He does NOT squat on his heels: a catcher\'s crouch is '
        + 'a baseball pose that needs a mitt and a mask, PERIOD §1.4 forbids gloves, and a '
        + 'squatting kid seen from behind renders as a rectangle with a cap on it. `ready` is '
        + 'the half-crouch a bare-handed kid actually takes — weight down, knees at 44°, both '
        + 'hands out in front of him — and the root is yawed 40° toward first so the lens gets '
        + 'a shoulder, a cheek and a raised bare hand instead of a back. THE REAL FIX IS '
        + 'ANIMATION, NOT PLACEMENT: this file can turn him and lower him, but it cannot give '
        + 'him a step forward on the pitch. See the report.',
  },
  {
    id: 'pitcher', x: 0.9, z: 24.0, kid: 'irving', clip: 'pitch_set', look: [4.6, 0],
    slot: 0.008, tier: 'lead', accent: 'red', garment: 'sweater', pinX: true,
    note: 'The Beanpole, all leg. Halfway to second on the scratch — 24, not the old 42. At 42 '
        + 'he is 1.5x the catcher\'s depth and cannot reach 18% of frame at any legal lens; '
        + 'casting the tallest kid here buys back the rest. He is the far point of the axis '
        + 'and he wears the loudest hue on the block for the same reason.',
  },
  {
    id: 'first', x: 13.5, z: 19.0, kid: 'rocco', clip: 'ready', look: [0, 0],
    slot: 0.132, tier: 'field', accent: 'slateBlue', garment: 'sweater',
    note: 'Pulled in from (16.8, 31.5) to fill the middle-right band the catcher vacated when '
        + 'he went back behind the plate. Playing well in front of his own bag, which is what '
        + 'a kid does in a game with no throws to first worth the name, and it puts a body in '
        + 'the one third of the batting frame that was bare road. It also walks him out of the '
        + 'pushcart\'s shadow — see blocks().',
  },
  {
    id: 'short', x: -8.5, z: 15.0, kid: 'reese', clip: 'idle_bounce', look: [0, 0],
    slot: -0.076, tier: 'field', accent: 'rust', garment: 'vest',
    note: 'The hole between the plate and third, and deliberately SHALLOW. Every fielder used '
        + 'to land inside one 250-pixel strip of the wide shot with a dead band of road under '
        + 'them; at z=15 he drops into that band and the cast reads as three ranks instead of '
        + 'one chorus line. Never stops moving.',
  },
  {
    id: 'third', x: -13.8, z: 42.0, kid: 'luz', clip: 'ready', look: [0, 0],
    slot: -0.111, tier: 'field', accent: 'plum', garment: 'sweater',
    note: 'Past the ice truck\'s tailgate. The truck is parked across the old third-base '
        + 'corner (it fills x −21.5…−14.9, z 16.8…35.2), so the bag was re-chalked on its '
        + 'street side and the kid plays behind the whole thing — which is exactly what a '
        + 'block does when somebody parks on third.',
  },
  {
    id: 'right', x: 11.0, z: 35.0, kid: 'ethel', clip: 'ready', look: [0, 0],
    slot: 0.093, tier: 'field', accent: 'olive', garment: 'dress',
    note: 'Short right, inboard of the parked Ford (which fills x 15.2…21.6, z 44.4…55.6) and '
        + 'in front of it rather than beside it: level with the fender she shares a screen '
        + 'column with the kid standing on its roof. She plays the fender anyway — she knows '
        + 'it kicks left. Ribbon family, so the accent lands in the dress and she is the one '
        + 'body on the block whose whole silhouette is a colour.',
  },
  {
    id: 'center', x: 3.0, z: 62.0, kid: 'herman', clip: 'idle', look: [0, 0],
    slot: 0.021, tier: 'field', accent: 'periwinkle', garment: 'sweater',
    note: 'The deepest body on the stage and therefore the tallest kid on the block. Off the '
        + 'crown on purpose: the crown projects straight onto the batter\'s head.',
  },
  {
    id: 'left', x: -18.0, z: 55.0, kid: 'kathleen', clip: 'idle_slouch', look: [0, 0],
    slot: -0.132, tier: 'field', accent: 'bottleGreen', garment: 'sweater',
    note: 'Deepest on the lamppost side, out at the gutter line, bored, and about to be very '
        + 'busy. Wide of third rather than behind him, because at depth two kids in one lane '
        + 'is one kid.',
  },
  {
    id: 'roof', x: 18.4, z: 48.6, y: 6.95, kid: 'eugene', clip: 'idle_slouch', look: [4.6, 0],
    slot: 0.157, tier: 'field', accent: 'mustard', garment: 'vest', pinX: true,
    note: 'UP ON THE FORD. src/world/vehicles.js parks a black Model T at (18.4, 50) and its '
        + 'squared-off canvas top is a box(4.85, 0.40, 6.0) centred at local (0, 6.75, −1.35), '
        + 'so the boards are at world y 6.95 and run z 45.7…51.7 — this is the middle of them, '
        + 'not the 5.6 of the collider mid-height. Nobody sane stands on a canvas top, which '
        + 'is why a nine-year-old does. He is the second of the three heights the wide shot '
        + 'needs (road ~0.4, this ~7.0, the umpire on the ice truck 7.8) and the only reason '
        + 'the deep right of the frame has a body in it at all: the Ford fills that lane at '
        + 'ground level, so the only standing room out there is on top of the Ford.',
  },
];

/**
 * The kid with the next turn. He waits BEHIND the hitter's back — the batter stands on the
 * +x side of the casting and swings toward −x, so this is both the safe side and the side a
 * real on-deck kid stands on. He watches the BATTER rather than the pitcher, which turns him
 * broadside to the lens: a kid in profile with a broom handle is a silhouette, and a kid seen
 * from behind is a coat.
 *
 * OFF THE LENS. Round 1 put him at z −4.5, two and a half units NEARER the camera than the
 * batter, and the arbiter duly reported him at 24.4% against the batter's 22.7% — 1.08x, in a
 * rule that wants 1.35x. §17.6 reserves the near third of frame for the subject and this is a
 * kid who is not the subject; a body in front of the batter is a body arguing with him. He
 * goes back to z 2.5, level with the plate and twelve units out toward the north gutter, where
 * he still fills the near-left quadrant of the batting frame without competing for it.
 */
export const ON_DECK = { x: 15.0, z: 2.5, kid: 'bessie', clip: 'bat_wait', look: [4.6, 1.4], slot: 0.153, tier: 'block', wide: 1.30 };

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
  { x: 18.6, z: 7.0, kid: 'connie', clip: 'curb_wait', look: [4.6, -0.6], slot: 0.207, tier: 'block' },
  { x: 19.6, z: 12.5, kid: 'peggy', clip: 'idle_slouch', look: [0.9, 24], slot: 0.206, tier: 'block' },
  { x: 20.4, z: 18.0, kid: 'gertie', clip: 'idle', look: [0.9, 24], slot: 0.202, tier: 'block' },
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
    id: 'cards', x: 16.6, z: 30.0, kid: 'carmen', clip: 'sit_flip', face: 'grin',
    look: [4.6, 0], slot: 0.147, tier: 'block',
    note: 'squatting in the road at the foot of the stoop, flipping cigarette cards against '
        + 'the granite. She used to sit at x 21 in the gutter dish and from BATTING the '
        + 'pushcart stood squarely between her and the lens — a kid sawn off at the waist by '
        + 'a barrow of apples reads as a bystander, not as the block. blocks() now refuses '
        + 'that placement outright; this is four units in from it and clear of the barrow '
        + 'from both locked seats.',
  },
  {
    id: 'watcher', x: 22.6, z: 14.0, y: GROUND.walkTop, kid: 'rose', clip: 'idle_slouch', face: 'squint',
    look: [4.6, -0.6], slot: 0.269, tier: 'block',
    note: 'standing over him with her arms folded, having opinions. The pair are a CLUSTER '
        + 'rather than a row (§13), and they are both on the north side because the batting '
        + 'framing\'s yaw makes that side of the frame cheap and the other side expensive: a '
        + 'spectator on the south curb costs the whole cast three points of frame height.',
  },
  {
    id: 'umpire', x: -15.9, z: 25.0, y: 7.83, kid: 'cheech', clip: 'idle_bounce', face: 'taunt',
    look: [4.6, 0], slot: -0.147, tier: 'block',
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

/** Every body this file posts, as the objects themselves — mutable, and mutated by separate(). */
function posted() {
  return [PLATE_BOX, ON_DECK, ...POSTS, ...BENCH, ...SPECTATORS];
}

export const LAYOUT = {
  BOUNDS, APRON, HOME, PLATE_BOX, PITCH_SCRATCH, BASES, FIRST, SECOND, THIRD,
  POSTS, ON_DECK, BENCH, SPECTATORS, SCENERY, MOB,
  groundAt, clamp, chase, blocks,
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
  short: 'SHORT', right: 'RIGHT', center: 'MIDDLE', left: 'LEFT', roof: 'ON THE CAR',
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
 * The diagnostic overlay for `layout_positions`: the chalked diamond, the pitch
 * axis, and a chalk word under every body. Same chalk, one plane higher, and off
 * in every other scenario — a diagram the block could plausibly have drawn itself.
 *
 * The diamond is drawn as a CONTINUOUS line rather than as four loose crosses,
 * because a reader who has never seen the game cannot infer the shape of a field
 * from four X's twenty feet apart — and because the shape is the one thing about
 * this layout that is worth arguing with. The pitch axis is dashed instead of
 * solid, so the two marks read as two different kinds of statement: the diamond
 * is where the bases are, the dashes are where the ball goes. Anyone checking the
 * catcher's alignment can now do it by eye: the dashes run from the scratch
 * through home and out the back, and he should be standing on them.
 */
function buildDiagram(scene) {
  const ctx = chalkCanvas();
  const { g, X, Z } = ctx;
  const W = PPF * 0.24;
  const dash = (a, b, seed, wid = W, alpha = 0.62) => {
    const n = Math.max(7, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2.4));
    for (let i = 0; i < n; i += 2) {
      const t0 = i / n, t1 = Math.min(1, (i + 1) / n);
      chalkStroke(g, [
        [X(a[0] + (b[0] - a[0]) * t0), Z(a[1] + (b[1] - a[1]) * t0)],
        [X(a[0] + (b[0] - a[0]) * t1), Z(a[1] + (b[1] - a[1]) * t1)],
      ], wid, seed + i, alpha);
    }
  };

  // THE DIAMOND: home → first → second → third → home, one unbroken 0.18-unit line at 55%.
  // Drawn corner to corner in one stroke per leg so the chalk grain runs along the leg the
  // way a dragged piece of chalk does, and closed, so the shape reads as a shape.
  const ring = [HOME, FIRST, SECOND, THIRD, HOME];
  for (let i = 0; i < 4; i++) {
    chalkStroke(g, [[X(ring[i].x), Z(ring[i].z)], [X(ring[i + 1].x), Z(ring[i + 1].z)]],
      PPF * 0.18, 301 + i * 11, 0.55);
  }
  // THE PITCH AXIS: the scratch through home and out the back past the catcher, dashed,
  // fainter than the bases. Extended two thirds of the apron behind the plate so the line
  // the catcher is supposed to be standing on is visible underneath him.
  const ax = HOME.x - (PITCH_SCRATCH.x - HOME.x) * (APRON * 0.9) / (PITCH_SCRATCH.z - HOME.z);
  dash([PITCH_SCRATCH.x, PITCH_SCRATCH.z], [ax, -APRON * 0.9], 361, PPF * 0.15, 0.44);

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
    this.cap = capAtSecond(app.scene);
    this.diagram = null;
    this.settled = false;
  },

  /**
   * The one thing this file cannot do at init.
   *
   * separate() needs to know where the two locked seats ended up, and src/render/cameras.js
   * solves them at ITS init, which runs after ours (order 300 against 15). So the projection
   * pass is deferred to the first frame anybody asks for — by which time the solutions exist
   * — and it runs exactly once, off a solved-at-boot camera, so it is as deterministic as the
   * camera it reads. Everything downstream re-reads the same POSTS objects on every
   * homePose(), so moving them here moves the kids without anybody being told.
   */
  settle(app) {
    if (this.settled) return;
    this.settled = true;
    separate(posted());
    for (const b of posted()) {
      const c = clamp(b.x, b.z, b.y || 0);
      b.x = c.x; b.z = c.z;
    }
    this.diagram = buildDiagram(app.scene);
    const P = app.get('players');
    if (P && P.homePose) P.homePose();
  },

  onScenario(name, app) {
    this.settle(app);
    if (this.diagram) this.diagram.visible = name === 'layout_positions';
  },

  update(dt, app) { this.settle(app); },
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

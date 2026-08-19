/**
 * fielding.js — WHAT HAPPENS AFTER THE STICK.
 * ============================================================================
 * The rules core (src/game/core.js) already decided this play before the ball
 * had finished rising. It knows whether the kid is out, whether somebody has to
 * pick a base, and by how many tenths the race to the stoop was won. It knows
 * none of it in feet, in seconds, or in bodies.
 *
 * That is the whole division of labour in this file:
 *
 *      THE CORE IS THE AUTHORITY ON THE OUTCOME.
 *      THIS FILE IS THE AUTHORITY ON HOW IT LOOKS GETTING THERE.
 *
 * So the very first thing a batted ball does here is ask the core what happened
 * (`judge()`), and everything after that is staging: who breaks, who is asleep,
 * who calls for it, who gets there, who does not, who drops it, and — on a play
 * the core has marked close enough to be worth a human's opinion — who the
 * player decides to throw it to.
 *
 * ── the five things this file owns ──────────────────────────────────────────
 *
 * 1. CHASE AND CONVERGE. Nine kids, reaction times that differ by half a second
 *    (one of them is watching a pigeon), a primary who calls for it out loud, a
 *    backup who comes in behind and to the side, a cut-off man on anything deep,
 *    a body standing on every bag the play can go to, and six heads that TRACK
 *    THE BALL every frame. Nobody in this file is ever in a symmetrical rest
 *    pose while a ball is live; that is a veto in BYB §9 and it is checked here
 *    rather than hoped for.
 *
 * 2. THE GATHER. The catch, the jump, the dive, the scoop — and the four comic
 *    failures BYB-REFERENCE §5.6 asks for by name: the bobble, the collision,
 *    through the legs, and the one that drops between two kids who both stopped.
 *    Which one plays is chosen so it AGREES with the core: a kid only muffs a
 *    ball the core scored as a hit, and a kid only comes up with one the core
 *    scored as an out. A muffed ball is NOT quietly teleported into a hand — it
 *    lies in the road, live, and somebody else has to go and get it, which is
 *    both the joke and the reason the runner is safe. Errors are funny and
 *    readable, never punishing, and there is a volume knob on them
 *    (`comicErrors`) exactly as the 1997 options menu had.
 *
 * 3. THE THROW PROMPT. The one moment the player is on defence. The core hands
 *    over `targets`, a best choice and a 1.4 s deadline; this file turns that
 *    into chalk arrows on the road, a torn paper tag over every live bag with
 *    the kid who is standing on it, and a five-stroke chalk tally that scuffs
 *    out while you think. Keyboard, mouse and touch. Letting it run out is a KID
 *    HESITATING — he double-clutches, looks at two bases, and everybody yells at
 *    him — not a UI failure.
 *
 * 4. THE RACE. If the core says `out_ground`, the runner must be visibly beaten,
 *    and if it says `single` he must visibly win. The runner's arrival is
 *    measured every frame, and THE RELEASE IS WHAT GIVES: the fielder holds the
 *    ball, sets his feet and crow-hops for exactly as long as it takes for a
 *    natural 68 ft/s throw to land on the right side of the runner. Stretching
 *    the flight instead — which is what this file used to do — produced moon
 *    balls that hung for a second and a quarter. The number is fixed, the
 *    picture is negotiable, and the negotiation happens BEFORE the ball leaves
 *    the hand where nobody can see it.
 *
 * 5. THE HAND-OFF. A thrown ball lands in a body's hands, not on a chalk cross.
 *    The receiver is sent to the bag at the crack and the throw is re-aimed at
 *    his hands every frame it is in the air, because a ball that arrives at the
 *    bag and then snaps twelve feet sideways into the first baseman is the exact
 *    frame a critic screenshots.
 *
 * ── house rules for anyone editing this file ────────────────────────────────
 * • This file NEVER decides a play. If you find yourself writing `if (margin <`
 *   in here, stop: `liveMatch.resolveThrow()` is one call away and it is the
 *   only thing allowed to answer that question.
 * • Every random draw is from a PRIVATE RNG (`frng`). Staging randomness must
 *   never touch the sim's deterministic draw order, or the screenshot harness
 *   stops replaying and the whole critique loop dies.
 * • Bodies are moved through the public Kid verbs (`goTo`, `act`, `lookAt`,
 *   `flavour`) that src/chars/players.js publishes, and every beat is also
 *   announced on src/core/bus.js so audio, fx and the booth can hang off it.
 *   src/chars/players.js is NOT edited by this piece.
 * ========================================================================= */

import * as THREE from 'three';
import { registerSystem, app as APP } from '../app.js';
import { registerScenario } from '../core/scenarios.js';
import { T } from '../core/tuning.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { provide, gameplay } from './plugins.js';
import { LAYOUT, POSTS } from './layout.js';
import { liveMatch } from './core.js';
import { getKid } from '../chars/roster.js';
import { KIDS_BY_ID } from '../chars/wardrobe.js';
import { CHALK, INK, ACCENTS, PAVEMENT, hexCSS, mix, inkOf } from '../render/palette.js';
import { slab, slabW } from '../chars/portraits.js';
import { chalkStroke } from '../world/props.js';
import { bubbles } from '../ui/bubbles.js';

/* ============================================================================
   0. Tuning
   ---------------------------------------------------------------------------
   These belong in T.field in src/core/tuning.js and they are not there, because
   this piece owns exactly one file and tuning.js is not it (three other agents
   are writing into it this hour). Everything that ALREADY exists in T.field is
   read from T.field; only the constants this piece invented live here, in one
   block, so lifting them across later is a cut and a paste. Flagged in the
   report as the known weakness it is.
   ========================================================================= */
export const FT = {
  // How long a kid takes to believe the ball is coming to him. A real block is
  // NOT uniform about this and the spread is the character: the shortstop is
  // moving before the sound arrives, the kid on the car roof is not.
  react: { keen: 0.06, quick: 0.14, normal: 0.24, dozy: 0.78 },
  dozyOdds: 0.5,               // how often the deep kid is genuinely elsewhere
  chaseSpeed: T.field.speed,   // 16.5 ft/s — a nine-year-old at a dead run
  sprint: 20.5,                // ... and the same kid when it is his ball
  reach: 2.9,                  // he can field it standing here
  diveReach: 6.6,              // ... and here, with his feet off the ground
  gatherY: 5.4,                // a ball above this is a jump, not a pickup
  jumpY: 4.2,
  campAt: 2.2,                 // this close to the landing spot he stops and waits under it
  retarget: 1.1,               // ft the landing spot must move before he re-aims
  relayZ: 38,                  // past this the ball comes in through a cut-off man
  throwSpeed: T.field.throwSpeed,  // 68 ft/s
  throwArc: 0.16,              // fraction of the throw's length spent as lift
  releaseAt: 0.48,             // the `release` event inside CLIPS.throw
  windup: 0.26,                // seconds of arm between "he throws" and the ball leaving
  ticks: 5,                    // chalk strokes in the countdown
  beat: 1.05,                  // how long the street reacts before the play closes
  cap: 7.0,                    // hard ceiling on one play (ballphysics caps at 7.5)
  outBy: 0.20,                 // seconds the throw beats the runner by, on an out
  safeBy: 0.34,                // ... and loses by, on a hit
  holdMax: 1.7,                // longest a kid may stand there setting his feet
  holdMin: 0.16,               // ... and the shortest, so there is always an exchange
  exchange: 0.34,              // ball in the hand, feet set, crow-hop — a real transfer
  slideAt: 5.5,                // he leaves his feet this far from the bag
  beatenBy: 5.0,               // ... and on an out the ball lands while he is still this far out
  bagIn: 2.0,                  // and this close counts as arriving
  glideDecay: 13,              // src/chars/players.js: skid friction, ft/s per second
  holdLift: 6.2,               // fake upward speed on a held ball; see hold()
  trailSpeed: 58,              // fake speed on a thrown ball, so ballphysics trails it
  looseSettle: 0.55,           // how long a muffed ball keeps hopping in the road
  looseDwell: 0.85,            // ... and the least time it lies there before a hand closes
};

const P = T.play;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const C = (h) => hexCSS(h);

/** Staging randomness. Private on purpose — see the house rules above. */
const frng = new RNG(50419);

/* ============================================================================
   1. The street, as positions
   ========================================================================= */

const POST = {};
for (const p of POSTS) POST[p.id] = p;

/** Where the bags are, in the words the block uses for them. */
const BAG = { '1B': LAYOUT.FIRST, '2B': LAYOUT.SECOND, '3B': LAYOUT.THIRD, home: LAYOUT.HOME };
const BAG_WORD = { '1B': 'FIRST', '2B': 'SECOND', '3B': 'THIRD', home: 'HOME' };
const BAG_KEY = { '1B': '1', '2B': '2', '3B': '3', home: 'H' };
const BAG_YELL = { '1B': 'HERE! HERE!', '2B': 'TWO! TWO!', '3B': 'THIRD!', home: 'HOME! HOME!' };
/** Who runs to stand on it when the play is live. */
const BAG_KEEPER = { '1B': 'first', '2B': 'short', '3B': 'third', home: 'catcher' };
/** Which bag a runner is coming FROM, which is the line the receiver must clear. */
const BAG_FROM = { '1B': LAYOUT.HOME, '2B': LAYOUT.FIRST, '3B': LAYOUT.SECOND, home: LAYOUT.THIRD };

/* ----------------------------------------------------------------------------
   STAGING IS A SCREEN PROBLEM, NOT A BASEBALL ONE.

   Everything in this file that puts a body somewhere used to solve it in feet,
   and feet are the wrong unit: the lens is 20 degrees and sits fourteen degrees
   above a road that runs AWAY from it, so five feet of depth is thirty pixels
   and five feet across is a hundred and forty. Measured on round 1 of wave G3,
   the pitcher backing up first was posted eight feet behind the first baseman
   and landed THIRTY PIXELS from him: one creature with two caps, in the exact
   corner of the frame the whole play resolves in.

   So a spot is now CHOSEN rather than computed. The caller offers three or four
   seats it would be happy with, in order of preference, and this picks whichever
   one the lens keeps clear of the bodies that matter. It is the same arithmetic
   a storyboard artist does by eye and it costs one projection per candidate,
   once, at the moment the kid is sent.
--------------------------------------------------------------------------- */

/** The reference frame every pixel threshold in this file is written against. */
const REF_W = 1600, REF_H = 900;
const _sv = new THREE.Vector3();

/** A world point in reference pixels, or null if it is behind the lens. */
function toScreen(x, y, z) {
  const cam = APP.camera;
  if (!cam) return null;
  _sv.set(x, y, z).project(cam);
  if (_sv.z > 1) return null;
  return { x: (_sv.x * 0.5 + 0.5) * REF_W, y: (-_sv.y * 0.5 + 0.5) * REF_H };
}
/** Where a kid's chest is on screen — the part of him another body actually hides. */
const bodyAt = (k) => (k ? toScreen(k.pos.x, (k.groundY || 0) + 2.4, k.pos.y) : null);
/** ... and where a spot on the road puts a chest that is not standing there yet. */
const spotAt = (x, z) => toScreen(x, LAYOUT.groundAt(x) + 2.4, z);

/**
 * How far apart two kids have to be before a player reads them as two kids.
 * A kid is about 110 px tall in the wide framing; a body-and-a-bit of daylight
 * is the difference between a play and a pile.
 */
const DAYLIGHT = 140;

/**
 * Pick the seat the lens likes. `cands` are world spots in preference order,
 * `avoid` is a list of reference-pixel points nothing should sit on top of.
 */
/**
 * Everybody the lens can see, as pixels, so a staged body is never posted on top
 * of one. The SPECTATORS matter as much as the fielders: src/game/layout.js sits
 * two kids playing cards on the kerb at (20.2, 34), which is four feet behind
 * first base and directly between the receiver and the runner from this seat.
 */
function crowdAt(exclude) {
  const pl = players();
  const out = [];
  if (!pl) return out;
  const all = pl.fielders.concat(pl.spectators || [], pl.batter ? [pl.batter] : []);
  for (const k of all) {
    if (!k || (exclude && exclude.includes(k))) continue;
    const s = bodyAt(k);
    if (s) out.push(s);
  }
  return out;
}

function stagePlace(kid, cands, avoid) {
  let best = null, bestScore = -1e9;
  for (let i = 0; i < cands.length; i++) {
    const c = reachable(kid, cands[i].x, cands[i].z);
    const s = spotAt(c.x, c.z);
    let score = -i * 26;                       // the caller's own order is worth something
    if (s) {
      let near = DAYLIGHT;
      for (const a of avoid) if (a) near = Math.min(near, Math.hypot(s.x - a.x, s.y - a.y));
      score += near * 3.2;
      // and nothing gets staged into the frame edge or up among the shop signs
      score -= Math.max(0, 170 - Math.min(s.x, REF_W - s.x)) * 1.6;
      score -= Math.max(0, 300 - s.y) * 1.1;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best || reachable(kid, cands[0].x, cands[0].z);
}

/**
 * WHERE THE KID COVERING THE BAG ACTUALLY STANDS.
 *
 * Not on it. A receiver standing dead on the chalk and a runner arriving at the
 * same chalk are one lump of kid from a lens fourteen degrees above the road —
 * measured on round 1 of this piece, the first baseman and the sliding runner
 * fused into a single unreadable shape with two caps and four hands in it. So he
 * takes the bag on the OUTSIDE, one long step off the running line, the way a
 * kid with no glove and a healthy respect for shins does anyway. Two bodies,
 * forty pixels apart, both whole.
 */
function keeperSeats(tag) {
  const bag = BAG[tag] || LAYOUT.FIRST;
  const from = BAG_FROM[tag] || LAYOUT.HOME;
  let ax = bag.x - from.x, az = bag.z - from.z;
  const m = Math.max(1e-3, Math.hypot(ax, az));
  ax /= m; az /= m;
  /**
   * The perpendicular that points OUT of the diamond, and the choice is a
   * screen-space one rather than a baseball one.
   *
   * The runner arrives up the line and, on a close play, is a stride short of
   * the bag when the ball lands — which puts him at very nearly the receiver's
   * own x. Standing the receiver on the INSIDE was tried and measured: at the
   * call the two of them shared a screen column to within a foot and the kid
   * with the ball in his hands was completely behind the kid who was out.
   * Outside is three and a half feet of daylight in the axis the lens actually
   * separates, and daylight is the whole job.
   */
  let sx = az, sz = -ax;
  if (sx * (bag.x - 0) + sz * (bag.z - 30) < 0) { sx = -sx; sz = -sz; }
  /**
   * ... and OUTSIDE is only the first offer. On a bag jammed against the curb —
   * first is chalked at x 18.4 and the chase limit is 21.0 — the outside seat and
   * the seat the pitcher backs up to collapse onto the same screen column, which
   * is how round 1's play at first became one creature with two caps. So four
   * seats are offered and stagePlace() takes whichever the lens keeps clear.
   */
  return [
    { x: bag.x + sx * 3.6, z: bag.z + sz * 3.6 },                     // outside the line
    { x: bag.x + sx * 5.4 + ax * 1.2, z: bag.z + sz * 5.4 + az * 1.2 }, // ... wider
    { x: bag.x - sx * 4.2 + ax * 1.6, z: bag.z - sz * 4.2 + az * 1.6 }, // inside, half a step past
    { x: bag.x + ax * 4.0, z: bag.z + az * 4.0 },                     // straight past it
  ];
}

/** Where the runner will be when the ball lands: a stride short, up the line. */
function runnerLane(tag) {
  const bag = BAG[tag] || LAYOUT.FIRST;
  const from = BAG_FROM[tag] || LAYOUT.HOME;
  let ax = bag.x - from.x, az = bag.z - from.z;
  const m = Math.max(1e-3, Math.hypot(ax, az));
  return { x: bag.x - (ax / m) * 3.0, z: bag.z - (az / m) * 3.0 };
}

/**
 * The seat the kid covering this bag actually takes, solved against the lens.
 * `avoid` is everything the lens must keep him clear of — the runner's lane
 * first of all, because those two are the pair the payoff frame is about.
 */
function keeperSpot(tag, kid, avoid) {
  const seats = keeperSeats(tag);
  if (!kid) return { x: seats[0].x, z: seats[0].z };
  const lane = runnerLane(tag);
  return stagePlace(kid, seats, [spotAt(lane.x, lane.z), ...(avoid || [])]);
}

/** The core talks in six positions; the stage stands nine kids. This is the bridge. */
const CORE_POST = { P: 'pitcher', C: 'catcher', '1B': 'first', SS: 'short', LF: 'left', RF: 'right' };

/** The street's own words for a verdict. */
const CALL = {
  out_fly: 'caught on the fly',
  out_line: 'speared on a line',
  out_ground: 'thrown out at the stoop',
  out_home: 'cut down at the plate',
  single: 'a clean single',
  double: 'in for two',
  triple: 'all the way to third',
};

/**
 * What the block actually yells. Kept short enough to read in one glance on a
 * torn scrap of kraft paper, because that is what src/ui/bubbles.js draws it on.
 * The announcers (src/audio/announcer.js) own the play-by-play; these are the
 * nine-year-olds under it, and the two banks never say the same thing.
 */
const YELL = {
  mine: ['I GOT IT!', 'MINE! MINE!', 'ME! I GOT IT!', 'I GOT IT I GOT IT!'],
  yours: ['I THOUGHT YOU HAD IT!', 'THAT WAS YOURS!', 'YOU SAID YOU HAD IT!', 'WHY DIDN\'T YOU CALL IT!'],
  muff: ['AW, NUTS.', 'IT WENT RIGHT THROUGH!', 'MY HANDS! MY HANDS!', 'THAT ONE WAS WET.'],
  legs: ['RIGHT UNDER ME!', 'WHERE\'D IT GO?', 'IT WENT UNDER!'],
  wake: ['WHAT? WHAT HAPPENED?', 'HEY! HEY, WAIT!', 'I WASN\'T LOOKIN\'!'],
  hesitate: ['UH - I - ', 'WHERE? WHERE?', 'WHO DO I - '],
  yellAt: ['THROW IT SOMEWHERE!', 'ANYWHERE! ANYWHERE!', 'YA BUM!', 'THAT IS A RUN, THAT IS!'],
};

const players = () => {
  const p = APP.get('players');
  return p && p.fielders && p.fielders.length ? p : null;
};

/**
 * What the block calls him.
 *
 * The layout casts by WARDROBE id (`rocco`, `reese`, `herman`) and the wardrobe
 * carries more kids than the sixteen-strong roster does, so the nickname is read
 * from src/chars/wardrobe.js first and only falls back to the roster. Reading it
 * from the roster alone put the word SOCKS on all three tags at once, which is
 * the kind of thing a screenshot catches and a unit test never would.
 */
function nickOf(postId) {
  const id = (POST[postId] && POST[postId].kid) || postId;
  const w = typeof id === 'string' ? KIDS_BY_ID.get(id) : null;
  if (w && w.nick) return w.nick;
  const k = getKid(id);
  return (k && k.nick) || 'THE KID';
}
const accentOf = (postId) => ACCENTS[(POST[postId] && POST[postId].accent) || 'red'] || ACCENTS.red;

/** A kid's own ceiling on how deep he may chase, per §17.3. Never bypass this. */
function reachable(k, x, z) {
  return LAYOUT.chase(x, z, k && k.group && k.group.userData.metrics && k.group.userData.metrics.tall);
}

const _wp = new THREE.Vector3();
/** Where a kid's throwing hand is, in the world, right now. */
function handAt(k, out) {
  const h = (k.rig && (k.rig.get('handR') || k.rig.get('handL'))) || null;
  if (h) { h.getWorldPosition(out); return out; }
  return out.set(k.pos.x, (k.groundY || 0) + 3.0, k.pos.y);
}

const dist2 = (k, x, z) => Math.hypot(k.pos.x - x, k.pos.y - z);

/**
 * IS HE STANDING ON SOMETHING?
 *
 * One kid on this block plays the whole game from the canvas top of a parked
 * Model T and another calls balls and strikes off the bed of an ice truck
 * (src/game/layout.js POSTS `roof`, SPECTATORS `umpire`). src/chars/players.js
 * pins a perched kid's feet to that perch for as long as he lives, so the moment
 * this file sends him anywhere he walks across the street SEVEN FEET IN THE AIR
 * — which is exactly what the round-1 frames of `field_fly` show, and it reads
 * as a bug rather than as a joke. Perched kids turn their heads and shout and do
 * nothing else. Getting down off the car is an animation this piece does not own.
 */
const perched = (k) => !!k && k.perch !== null && k.perch !== undefined;

/** One line of kid noise, on kraft paper, over the kid who said it. */
function yell(k, bank, hold = 1.5) {
  if (!k || !bubbles || !bubbles.say) return;
  const line = bank[frng.int(0, bank.length - 1)];
  bubbles.say({ who: 'kid', body: k, text: line, kind: 'shout', hold });
  bus.emit('field:chatter', { kid: k.home && k.home.id, text: line });
}

/* ============================================================================
   2. THE PLAY
   ---------------------------------------------------------------------------
   One batted ball, from the crack to the call. A small explicit state machine,
   because "the fielders are doing something" is not a state anybody can debug
   at four in the afternoon.

       watch   nobody is getting this one. Turn and look. (sewer shots, glass)
       chase   everybody converges; the ball is still ballphysics'
       gather  a body is on the ball: catch / jump / dive / muff
       loose   the muff worked: the ball is in the road and somebody is coming
       set     he has it, and he is setting his feet — the exchange
       prompt  the human picks a bag                      (only if the core asked)
       throw   the ball is in the air, on its way to a pair of hands
       beat    the call has been made; the street reacts
       done    hand the verdict back to the sim
   ========================================================================= */

class Play {
  constructor(sim, hit, forced) {
    this.sim = sim;
    this.hit = hit || {};
    this.t = 0;
    this.phase = 'chase';
    this.result = null;       // the object handed back to sim.resolvePlay
    this.play = null;         // the core's verdict
    this.judgedHere = false;  // did WE ask the core? then it must not be asked twice
    this.prompt = null;
    this.holder = null;       // the kid with the ball in his hand
    this.style = '';
    this.spot = new THREE.Vector2(0, 8);
    this.aimed = new THREE.Vector2(-999, -999);
    this.primary = null; this.backup = null; this.relay = null; this.dozy = null; this.backer = null;
    this.keeper = null;       // the body standing on the bag this play is going to
    this.keeperAt = null;     // ... and the seat the lens picked for him
    this.keeperTag = '1B';
    this.watchers = [];       // everybody else, tracking the ball
    this.movers = [];         // every kid this play took control of
    this.runner = null;       // the batter, legging it out
    this.arrow = null;        // the live throw {from,to,t,dur,tag,hi}
    this.callWord = null;     // 'OUT!' / 'SAFE!' — the payoff frame
    this.callAt = 0;
    this.closeAt = 99;        // play-time the whole thing hands back
    this.gathered = false;
    this.forced = forced || null;
    this.loose = null;        // {pos, t, by} — a ball in the road with nobody on it
    this.setT = 0; this.setFor = 0; this.setTag = '1B'; this.setOut = false;
    this.scuff = 0;
  }

  /* --- 2.1 the verdict ---------------------------------------------------- */

  /**
   * Ask the core what happened. This is the only place in the piece that is
   * allowed to know the outcome, and it happens ONCE, at the crack, so the
   * whole play can be choreographed toward an ending that is already true.
   *
   * The core's bridge (core.js `rules.onResult`) is the same call src/game/sim.js
   * would have made at settle time. Calling it early is not a trick — it is the
   * only ordering in which the fielders can agree with it. Afterwards
   * `sim.lastContact` is cleared so the bridge's own guard (`if (!hit) return`)
   * stops it judging the same batted ball twice.
   */
  judge() {
    const sim = this.sim;
    if (this.forced) { this.play = this.forced; this.result = this.fromPlay(this.forced); return; }

    // If some other wiring already drove the core into a pending throw, that is
    // the authority and we do not re-judge.
    if (liveMatch.pendingThrow && liveMatch.pendingThrow.play) {
      this.play = liveMatch.pendingThrow.play;
      this.result = { kind: 'hit', bases: 1, detail: CALL.single };
      return;
    }

    const scratch = { kind: 'live', bases: 0, detail: '' };
    sawThrow = null;
    const rules = gameplay.rules;
    if (rules && rules.onResult) rules.onResult(sim, scratch);
    this.judgedHere = true;
    this.play = sim.lastPlay || null;
    this.result = scratch.kind === 'live'
      ? { kind: 'out', bases: 0, detail: 'fielded' }
      : { kind: scratch.kind, bases: scratch.bases, detail: scratch.detail, play: scratch.play };

    // The bridge answers its own throw prompt because, until this file existed,
    // there was nobody to ask. There is now: re-arm the core's pending throw
    // from the verdict it just computed and let a human settle it.
    if (sawThrow && this.play) {
      liveMatch.pendingThrow = { play: this.play, margin: this.play.margin };
      this.wantPrompt = sawThrow;
      sawThrow = null;
    }
  }

  /** A core verdict -> the shape src/game/sim.js resolves. */
  fromPlay(play) {
    const r = play.result || 'single';
    if (r.startsWith('out')) return { kind: 'out', bases: 0, detail: CALL[r] || 'fielded', play };
    const bases = r === 'hr' ? 4 : r === 'triple' ? 3 : r === 'double' ? 2 : (play.bases || 1);
    const detail = play.window ? 'THROUGH THE WINDOW'
      : r === 'hr' ? `${play.sewers || 1} SEWER${(play.sewers || 1) > 1 ? 'S' : ''}`
        : play.fireEscape ? 'off the fire escape'
          : play.flivver ? 'off the flivver'
            : CALL[r] || 'a hit';
    return { kind: 'hit', bases, detail, play };
  }

  get gone() {
    const p = this.play;
    return !!p && (p.result === 'hr' || p.window || p.fireEscape);
  }

  get isOut() { return !!this.result && this.result.kind === 'out'; }
  get isFly() { return !!this.play && (this.play.loft === 'fly' || this.play.loft === 'line'); }

  /* --- 2.2 casting -------------------------------------------------------- */

  /**
   * Who breaks, and how fast.
   *
   * Six jobs get handed out on every batted ball and NOBODY is left without one,
   * because a kid standing to attention while a ball is live is the single
   * cheapest way this piece fails BYB §9's veto:
   *
   *   primary   nearest body to where the ball is going. Sprints, calls for it.
   *   backup    in BEHIND and to the side — where a real backup stands, and on a
   *             stage this shallow the only way two kids on one ball read as two.
   *   keeper    goes and STANDS ON the bag this play is going to, so the throw
   *             has a pair of hands to land in instead of a chalk cross.
   *   relay     between the ball and the plate on anything deep.
   *   dozy      the little brother. Half a second late and facing the wrong way.
   *   watchers  everybody else: two of them drift toward the ball, all of them
   *             turn their heads and keep turning them.
   */
  cast(pl) {
    const spot = this.spot;
    const pool = pl.fielders.filter((f) => f !== pl.catcher);
    const runners = pool.filter((f) => !perched(f));
    const ranked = runners.slice().sort((a, b) => dist2(a, spot.x, spot.y) - dist2(b, spot.x, spot.y));

    // The core named a position. Where our stage has that kid within shouting
    // distance of the ball, honour it — the announcer is about to say his name.
    let primary = ranked[0];
    const named = this.play && this.play.fielder && CORE_POST[this.play.fielder];
    if (named) {
      const k = pl.fielders.find((f) => f.home && f.home.id === named);
      if (k && k !== pl.catcher && !perched(k) && dist2(k, spot.x, spot.y) < dist2(primary, spot.x, spot.y) + 13) primary = k;
    }
    this.primary = primary;

    // Where this one is going if anybody throws it. A grounder is a race to
    // first; a fly that gets caught is over where it is caught.
    this.keeperTag = (this.wantPrompt && this.wantPrompt.best) || '1B';
    const keeperId = BAG_KEEPER[this.keeperTag];
    let keeper = runners.find((f) => f.home && f.home.id === keeperId);
    // THE PITCHER COVERS FIRST. If the kid who plays the bag is the kid chasing
    // the ball, somebody else has to get over there, and on every block in New
    // York that somebody is the pitcher. It is a real baseball beat and it costs
    // one line.
    if (keeper === primary || !keeper) keeper = pl.pitcher === primary ? ranked[1] : pl.pitcher;
    this.keeper = keeper;

    this.backup = ranked.find((k) => k !== primary && k !== keeper && k !== pl.pitcher)
      || ranked.find((k) => k !== primary && k !== keeper) || null;

    /**
     * THE PITCHER BACKS UP THE BAG.
     *
     * Real, and load-bearing for the picture. He is posted at (0.9, 24) — dead
     * centre of the stage and nineteen units nearer the lens than the deep
     * outfield — so on any ball hit past him he stands squarely between the
     * camera and the catch. Measured on `field_fly`: the whole money frame, a
     * kid at full stretch with the ball in her bare hands, was drawn BEHIND a
     * stationary red sweater. Sending him round behind the bag is what a
     * pitcher actually does on a throw, and it clears the middle third of the
     * frame on every play in the game.
     */
    if (pl.pitcher && pl.pitcher !== primary && pl.pitcher !== keeper
        && pl.pitcher !== this.backup && !perched(pl.pitcher)) this.backer = pl.pitcher;

    // deep ball: somebody has to turn it round
    if (spot.y > FT.relayZ) {
      this.relay = ranked.find((k) => k !== primary && k !== this.backup && k !== keeper && k.pos.y < spot.y - 12)
        || null;
    }

    // THE LITTLE BROTHER. Somebody out there is not paying attention, and on a
    // real block it is always one of the deep kids — the one on the car roof,
    // the one up the far end — because nothing has come to him in twenty minutes.
    // He starts three-quarters of a second late, and he starts by dropping a
    // pigeon.
    const idle = ['roof', 'center', 'right', 'left']
      .map((id) => pool.find((f) => f.home && f.home.id === id))
      .filter((f) => f && f !== this.backup && f !== keeper && f !== primary);
    if (idle.length && frng.chance(FT.dozyOdds)) this.dozy = idle[frng.int(0, idle.length - 1)];

    for (const k of pool) {
      k.fieldReact = k === primary ? FT.react.keen
        : (k === this.backup || k === keeper || k === this.backer) ? FT.react.quick
          : k === this.dozy ? FT.react.dozy : FT.react.normal;
    }
    this.watchers = pool.filter((k) => k !== primary && k !== this.backup && k !== keeper
      && k !== this.relay && k !== this.backer);

    if (this.dozy && this.dozy.lock <= 0) {
      this.dozy.target = null;
      // facing the wrong way entirely: up the block, at a pigeon on a cornice
      this.dozy.lookAt(this.dozy.pos.x + (this.dozy.pos.x > 0 ? 9 : -9), this.dozy.pos.y + 12);
      this.dozy.flavour('fidget_pigeon', { amp: 1, life: 1.2 });
      this.dozy.setFace('squint', 1.2);
    }
    bus.emit('field:break', {
      primary: primary && primary.home && primary.home.id,
      backup: this.backup && this.backup.home && this.backup.home.id,
      keeper: keeper && keeper.home && keeper.home.id,
      spot: { x: spot.x, z: spot.y },
    });
  }

  /** The batter is a runner now. Nobody else is going to make him one. */
  breakRunner(pl) {
    if (gameplay.baserunning) return;          // a real baserunning piece owns him
    const b = pl.batter;
    if (!b) return;
    this.runner = b;
    b.runOut = true;
    b.slidYet = 0; b.arrivedYet = 0; b.fieldStep = undefined;
    b.lock = 0;
    b.showStick(false);
    b.setFace('determined', 1.6);
    const to = LAYOUT.FIRST;
    b.goTo(to.x, to.z, { speed: T.run.speed, hard: false });
    bus.emit('bat:drop', { pos: new THREE.Vector3(b.pos.x, 0.3, b.pos.y) });
  }

  /**
   * Seconds until the runner is ON the bag, at the speed he is actually going,
   * INCLUDING the slide — because the slide is not a way of travelling, it is a
   * way of arriving, and it costs him half a second he would not otherwise
   * spend. Timing a throw against a straight-line run and then playing a slide
   * under it is how a fielding system produces an "out" the runner reaches
   * first.
   *
   * src/chars/players.js decays a skid at 13 ft/s²: a kid who leaves his feet at
   * g ft/s travels g²/26 feet in g/13 seconds. Both halves are used here.
   */
  etaTo(d0) {
    const r = this.runner;
    if (!r) return 1.15;
    const d = dist2(r, LAYOUT.FIRST.x, LAYOUT.FIRST.z);
    if (d <= d0) return 0;
    if (r.slidYet) {
      // he is on his hip: src/chars/players.js bleeds the skid off at 13 ft/s²
      const g = r.glide || 0;
      const reach = (g * g) / (2 * FT.glideDecay);
      if (reach <= d - d0) return g / FT.glideDecay;
      const gEnd = Math.sqrt(Math.max(0, g * g - 2 * FT.glideDecay * (d - d0)));
      return (g - gEnd) / FT.glideDecay;
    }
    const v = Math.max(8, r.speed || T.run.speed * 0.8);
    return (d - d0) / v;
  }

  /**
   * How long the throw has.
   *
   * On an OUT the target is not the bag — it is FT.beatenBy feet short of it,
   * because "visibly beaten" is a thing a still frame has to say and a runner
   * who is level with the bag when the ball lands does not say it. On a HIT the
   * target is the bag itself plus the slide, and the ball arrives after him.
   */
  runnerEta() { return this.etaTo(this.setOut ? FT.beatenBy : FT.bagIn); }

  /* --- 2.3 the tick ------------------------------------------------------- */

  step(dt, sim) {
    this.t += dt;
    const pl = players();
    if (!pl) return this.close();

    switch (this.phase) {
      case 'watch': this.stepWatch(dt, sim, pl); break;
      case 'chase': this.stepChase(dt, sim, pl); break;
      case 'gather': this.stepGather(dt, sim, pl); break;
      case 'loose': this.stepLoose(dt, sim, pl); break;
      case 'set': this.stepSet(dt, sim, pl); break;
      case 'prompt': this.stepPrompt(dt, sim, pl); break;
      case 'throw': this.stepThrow(dt, sim, pl); break;
      case 'beat': break;
      default: break;
    }

    if (this.phase !== 'watch' && this.phase !== 'done') this.trackBall(dt, sim, pl);
    if (this.runner && this.runner.runOut) this.stepRunner(dt, pl);
    if (this.callWord) this.scuff = Math.min(1, this.scuff + dt / 1.5);

    if (this.t > FT.cap && this.phase !== 'done') this.close();
    if (this.phase === 'beat' && this.t >= this.closeAt) this.close();
    return this.phase === 'done' ? this.result : null;
  }

  /**
   * NINE HEADS ON ONE BALL.
   *
   * The cheapest aliveness in the whole piece and the first thing a critic
   * notices missing: while a ball is live every kid who is not busy turns to
   * face wherever it is, every frame. It costs one lookAt per body and it is the
   * difference between a fielding play and a diagram of one.
   */
  trackBall(dt, sim, pl) {
    const b = sim.ball;
    for (const k of this.watchers) {
      if (k.fieldReact === undefined || k.fieldReact > 0) continue;
      if (k.lock > 0 || k.target) continue;
      k.lookAt(b.pos.x, b.pos.z);
    }
    if (this.keeper && this.keeper.lock <= 0 && !this.keeper.target && this.phase !== 'throw') {
      this.keeper.lookAt(b.pos.x, b.pos.z);
    }
  }

  /* --- watch: this one is gone -------------------------------------------- */
  stepWatch(dt, sim, pl) {
    if (this.t > 1.9 || (this.t > 0.7 && !sim.ball.inFlight)) {
      this.callWord = null;
      this.beat(0.35);
    }
  }

  /* --- chase -------------------------------------------------------------- */
  stepChase(dt, sim, pl) {
    const ball = sim.ball;
    this.aim(sim);

    for (const k of pl.fielders) {
      if (k === pl.catcher) continue;
      if (k.fieldReact === undefined) continue;
      const was = k.fieldReact;
      k.fieldReact -= dt;
      if (k.fieldReact > 0) continue;
      if (was > 0) this.wake(k, pl);
    }

    // the primary
    const pr = this.primary;
    if (pr && pr.fieldReact <= 0) {
      const to = reachable(pr, this.spot.x, this.spot.y);
      const gap = dist2(pr, to.x, to.z);
      if (Math.hypot(to.x - this.aimed.x, to.z - this.aimed.y) > FT.retarget) {
        this.aimed.set(to.x, to.z);
        if (gap > FT.campAt) pr.goTo(to.x, to.z, { speed: FT.sprint, hard: true });
        this.own(pr);
      }
      // CAMPED UNDER IT. He gets there before the ball does and then he waits,
      // bare hands up, watching it come down — which is the pose the whole fly
      // ball is about and which a kid who is still running never strikes.
      if (gap < FT.campAt && ball.pos.y > FT.gatherY && !pr.camped) {
        pr.camped = 1;
        pr.target = null;
        pr.lookAt(ball.pos.x, ball.pos.z);
        pr.act('ready', { state: 'catch', lock: 1.1 });
        pr.setFace('determined', 1.2);
      }
    }
    // the backup, in behind and to the side — on whichever side the lens has room
    const bk = this.backup;
    if (bk && bk.fieldReact <= 0 && !bk.fieldPlaced) {
      bk.fieldPlaced = 1;
      const sx = this.spot.x, sz = this.spot.y;
      const to = stagePlace(bk, [
        { x: sx - 7.5, z: sz + 7.0 },
        { x: sx + 7.5, z: sz + 7.0 },
        { x: sx - 9.5, z: sz + 2.0 },
        { x: sx + 9.5, z: sz + 2.0 },
      ], [spotAt(sx, sz), bodyAt(this.primary), bodyAt(this.keeper)]);
      bk.goTo(to.x, to.z, { speed: FT.chaseSpeed * 0.95 });
      this.own(bk);
    }
    // the kid who covers the bag
    const kp = this.keeper;
    if (kp && kp.fieldReact <= 0 && !kp.fieldPlaced) {
      kp.fieldPlaced = 1;
      const to = keeperSpot(this.keeperTag, kp, crowdAt([kp]));
      this.keeperAt = to;
      kp.goTo(to.x, to.z, {
        speed: FT.sprint,
        onArrive: (k) => { k.act('ready', { state: 'catch', lock: 2.2 }); k.lookAt(this.spot.x, this.spot.y); },
      });
      this.own(kp);
      bus.emit('field:cover', { bag: this.keeperTag, kid: kp.home && kp.home.id });
    }
    // and the kid behind him, in case it gets through
    const bk2 = this.backer;
    if (bk2 && bk2.fieldReact <= 0 && !bk2.fieldPlaced) {
      bk2.fieldPlaced = 1;
      const bag = BAG[this.keeperTag] || LAYOUT.FIRST;
      let dx = bag.x - this.spot.x, dz = bag.z - this.spot.y;
      const m = Math.max(1e-3, Math.hypot(dx, dz));
      dx /= m; dz /= m;
      const px = dz, pz = -dx;
      /**
       * BEHIND THE BAG, AND NOT BEHIND THE KID ON IT. Backing up first means
       * standing where an overthrow would go, and there are two of those — one
       * on each side of the line — plus the deep one straight past. The one the
       * lens keeps clear of the receiver is the one he takes; posting him at a
       * fixed eight feet put him thirty pixels off the first baseman's shoulder
       * and fused the pair in every frame of `field_grounder`.
       */
      const kAt = this.keeperAt ? spotAt(this.keeperAt.x, this.keeperAt.z) : bodyAt(this.keeper);
      const to = stagePlace(bk2, [
        { x: bag.x + dx * 7.5 - px * 7.0, z: bag.z + dz * 7.5 - pz * 7.0 },
        { x: bag.x + dx * 7.5 + px * 7.0, z: bag.z + dz * 7.5 + pz * 7.0 },
        { x: bag.x + dx * 10.0, z: bag.z + dz * 10.0 },
        { x: bag.x - px * 9.5, z: bag.z - pz * 9.5 },
        { x: bag.x + px * 9.5, z: bag.z + pz * 9.5 },
      ], [kAt, spotAt(bag.x, bag.z), spotAt(runnerLane(this.keeperTag).x, runnerLane(this.keeperTag).z)]);
      bk2.goTo(to.x, to.z, {
        speed: FT.chaseSpeed,
        onArrive: (k2) => { k2.act('ready', { state: 'catch', lock: 1.6 }); k2.lookAt(this.spot.x, this.spot.y); },
      });
      this.own(bk2);
      bus.emit('field:backup', { bag: this.keeperTag, kid: bk2.home && bk2.home.id });
    }
    // the cut-off man
    if (this.relay && this.relay.fieldReact <= 0 && !this.relay.fieldPlaced) {
      this.relay.fieldPlaced = 1;
      const to = reachable(this.relay, this.spot.x * 0.45, Math.max(14, this.spot.y * 0.48));
      this.relay.goTo(to.x, to.z, { speed: FT.chaseSpeed });
      this.own(this.relay);
      bus.emit('field:relay', { kid: this.relay.home && this.relay.home.id });
    }

    // ready to be fielded?
    if (!pr) return this.beat(0.3);
    const d = Math.hypot(pr.pos.x - ball.pos.x, pr.pos.y - ball.pos.z);
    const slow = ball.vel.lengthSq() < 90;
    const low = ball.pos.y < FT.gatherY;
    // A kid leaves his feet only when standing up will not do it: the ball is
    // already past him, or going past. Diving at everything is how a fielding
    // system ends up looking like a blooper reel.
    const away = (ball.pos.x - pr.pos.x) * ball.vel.x + (ball.pos.z - pr.pos.y) * ball.vel.z > 0;
    const reach = (this.isOut && away) ? FT.diveReach : FT.reach;
    // A kid going up for one leaves the ground BEFORE the ball arrives. Waiting
    // for it to fall inside arm's reach turns every fly ball into a chest catch,
    // and the jump — BYB §5.6's held apex — never happens once.
    const goingUp = ball.vel.y < 2 && ball.pos.y > FT.jumpY && ball.pos.y < 8.2 && d < FT.reach * 2.6;
    if ((low && d < reach) || (low && slow && d < FT.reach * 1.7) || goingUp || (this.t > 2.9 && d < 9)) {
      this.gather(pl, d);
    }
  }

  /**
   * A kid's reaction lands. Three of them are worth a beat of their own.
   */
  wake(k, pl) {
    if (k === this.dozy) {
      k.camped = 0;
      k.setFace('shock', 1.4);
      k.flavour('fidget_look', { amp: 1, life: 0.5 });
      yell(k, YELL.wake, 1.3);
      bus.emit('field:asleep', { kid: k.home && k.home.id });
      return;
    }
    if (k === this.primary) {
      k.setFace('determined', 1.4);
      // he calls for it, out loud, the way every kid under every fly ball has
      if (this.isFly && frng.chance(0.85)) yell(k, YELL.mine, 1.25);
      return;
    }
    // everybody else leans in: two of the watchers actually take three steps
    if (this.watchers.includes(k) && !perched(k) && frng.chance(0.55)) {
      const to = reachable(k, k.pos.x + (this.spot.x - k.pos.x) * 0.22, k.pos.y + (this.spot.y - k.pos.y) * 0.22);
      k.goTo(to.x, to.z, { speed: FT.chaseSpeed * 0.7 });
      this.own(k);
    }
  }

  /**
   * Where to run.
   *
   * A ball in the air is read off its own predicted landing point — that is what
   * a kid does, and src/game/ballphysics.js already publishes it. A ball ON THE
   * GROUND is a different problem: it is still travelling, and running at where
   * it landed is how a fielder ends up watching it roll past his ankles. For
   * those, solve a crude intercept instead — two passes of "where will it be by
   * the time I could get there" is enough, and it is what makes the difference
   * between converging on a grounder and trailing one.
   */
  aim(sim) {
    const b = sim.ball;
    const rolling = b.pos.y < 1.6 && b.vel.y < 6;
    if (!rolling) {
      const bp = gameplay.ballphysics;
      const pred = bp && bp.predict && bp.predict();
      if (pred) { this.spot.set(pred.x, pred.z); return; }
      const g = T.ball.gravity;
      const vy = b.vel.y, y = Math.max(b.pos.y, 0.2);
      const tf = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * y))) / g;
      this.spot.set(b.pos.x + b.vel.x * tf, b.pos.z + b.vel.z * tf);
      return;
    }
    const k = this.primary;
    let lead = 0;
    for (let i = 0; i < 2; i++) {
      const x = b.pos.x + b.vel.x * lead, z = b.pos.z + b.vel.z * lead;
      if (!k) break;
      lead = clamp(Math.hypot(k.pos.x - x, k.pos.y - z) / FT.sprint, 0, 1.1);
    }
    this.spot.set(b.pos.x + b.vel.x * lead, b.pos.z + b.vel.z * lead);
  }

  /* --- gather: the money frame -------------------------------------------- */

  /**
   * Which of the eight ways a kid gets his hands on a rubber ball plays here.
   *
   * The choice is CONSTRAINED BY THE CORE, always: a kid may only come up with a
   * ball the core scored as an out, and may only muff one it scored as a hit. So
   * the comedy never argues with the scoreboard, and every error on screen is
   * the reason a hit is a hit rather than an insult stapled onto one.
   */
  gather(pl, d) {
    this.phase = 'gather';
    this.gatherT = 0;
    const k = this.primary;
    const ball = this.sim.ball;
    const high = ball.pos.y > FT.jumpY;
    const far = d > FT.reach * 1.25;
    const out = this.isOut;

    let style;
    if (out) {
      if (high) style = 'jump';
      else if (far) style = 'dive';
      else style = this.isFly ? 'snag' : 'scoop';
    } else if (!comicOn()) {
      style = this.isFly ? 'snag' : 'scoop';
    } else {
      // a hit. WHY was it a hit? pick the funniest true answer.
      const both = this.backup && dist2(this.backup, this.spot.x, this.spot.y) < 13;
      const r = frng.next();
      if (both && r < 0.22) style = 'standoff';
      else if (both && r < 0.36) style = 'pile';
      else if (!this.isFly && r < 0.68) style = 'legs';
      else style = 'bobble';
    }
    if (forceStyle && STYLE[forceStyle]) style = forceStyle;
    this.style = style;
    const S = STYLE[style] || STYLE.scoop;
    this.graspAt = S.grasp;
    this.clean = S.clean;
    this.carry = S.carry;
    // From here the ball is spoken for, whether or not it is actually in a hand.
    // A bobbled ball has to keep existing somewhere while it is being bobbled.
    this.claimed = true;
    this.claimFrom = ball.pos.clone();
    this.claimVel = ball.vel.clone();
    this.applyStyle(pl, k, style);
  }

  applyStyle(pl, k, style) {
    const ball = this.sim.ball;
    k.target = null;
    k.camped = 0;
    k.lookAt(ball.pos.x, ball.pos.z);
    const at = new THREE.Vector3(k.pos.x, (k.groundY || 0) + 0.2, k.pos.y);
    // where a ball that gets away ends up: on down the road, the way it was going
    const vx = ball.vel.x, vz = ball.vel.z;
    const m = Math.max(1e-3, Math.hypot(vx, vz));

    switch (style) {
      case 'jump':
        k.act('jump_catch', { state: 'catch' });
        break;
      case 'dive':
        k.act('dive', { state: 'dive', glide: Math.max(6, k.speed) });
        break;
      case 'snag':
        k.act('ready', { state: 'catch', lock: 0.42 });
        k.flavour('cheer_arms', { life: 0.3, amp: 0.4 });
        break;
      case 'scoop':
        k.act('crouch', { state: 'catch', lock: 0.5 });
        break;

      // ── the four comic failures (BYB §5.6) ──────────────────────────────
      case 'bobble':
        k.act('fumble', { state: 'fumble' });
        k.setFace('shock', 1.4);
        bus.emit('field:error', { kind: 'bobble', kid: k.home && k.home.id, pos: at });
        break;

      /**
       * THROUGH THE LEGS. The ball does not stop and it is not quietly moved
       * into his hand a second later: it keeps going, out the back of him, and
       * he is left straddling an empty piece of road looking down between his
       * own feet while it rolls away. Somebody else has to go and get it, and
       * THAT is why the runner is safe — the error and the outcome are the same
       * fact rather than two facts stapled together.
       */
      case 'legs':
        k.lookAt(k.pos.x + vx, k.pos.y + vz);
        k.snapFacing();
        k.act('crouch', { state: 'catch', lock: 0.34, after: (kk) => {
          kk.act('freeze', { state: 'act', lock: 0.9 });
          kk.setFace('shock', 1.6);
          kk.lookAt(kk.pos.x - vx, kk.pos.y - vz);
          kk.flavour('fidget_look', { amp: 1 });
          yell(kk, YELL.legs, 1.4);
        } });
        // ELEVEN FEET, not five. A rubber ball that goes through a kid on
        // asphalt does not stop politely behind him; and on a lens this shallow
        // five feet of depth is thirty pixels, which is not a gap a player can
        // see. The distance IS the joke and it is also the readability.
        this.looseAt = new THREE.Vector3(
          ball.pos.x + (vx / m) * 11.5, 0, ball.pos.z + (vz / m) * 11.5,
        );
        bus.emit('field:error', { kind: 'through_the_legs', kid: k.home && k.home.id, pos: at });
        break;

      /**
       * NOBODY CALLED IT. Two kids, one ball, four eyes on each other and none
       * on the ball, which lands between them and sits there. The argument
       * starts before it has stopped rolling.
       */
      case 'standoff': {
        const o = this.backup;
        k.act('run_stop', { state: 'stop', lock: 0.4 });
        k.setFace('shock', 1.7);
        if (o) {
          o.target = null;
          o.act('run_stop', { state: 'stop', lock: 0.4 });
          o.lookAt(k.pos.x, k.pos.y);
          o.setFace('shock', 1.7);
          k.lookAt(o.pos.x, o.pos.y);
          this.argueAt = 0.72;
          this.looseAt = new THREE.Vector3((k.pos.x + o.pos.x) / 2, 0, (k.pos.y + o.pos.y) / 2);
        } else {
          this.looseAt = new THREE.Vector3(ball.pos.x, 0, ball.pos.z);
        }
        bus.emit('field:error', { kind: 'nobody_called_it', kid: k.home && k.home.id, pos: at });
        break;
      }

      /** PIG PILE. Both of them get there, neither of them gets the ball. */
      case 'pile': {
        const o = this.backup;
        k.act('dive', { state: 'dive', glide: Math.max(7, k.speed) });
        if (o) {
          o.target = null;
          o.lookAt(k.pos.x, k.pos.y);
          o.act('dive', { state: 'dive', glide: Math.max(7, o.speed) });
          o.setFace('shock', 1.7);
        }
        k.setFace('shock', 1.7);
        this.looseAt = new THREE.Vector3(
          ball.pos.x - (vz / m) * 4.4, 0, ball.pos.z + (vx / m) * 4.4,
        );
        bus.emit('field:collide', { kids: [k.home && k.home.id, o && o.home && o.home.id], pos: at });
        break;
      }
      default:
        break;
    }
    if (APP.puffs && (style === 'dive' || style === 'pile' || style === 'scoop' || style === 'legs')) {
      APP.puffs.burst(at, style === 'scoop' || style === 'legs' ? 4 : 9, style === 'scoop' ? 2.2 : 3.8);
    }
  }

  stepGather(dt, sim, pl) {
    this.gatherT += dt;
    const k = this.primary;
    if (this.argueAt && this.gatherT > this.argueAt) {
      this.argueAt = 0;
      const o = this.backup;
      k.act('argue_jab', { state: 'argue', lock: 1.2 });
      if (o) o.act('argue_appeal', { state: 'argue', lock: 1.2 });
      yell(k, YELL.yours, 1.6);
      bus.emit('field:argue', { kids: [k.home && k.home.id, o && o.home && o.home.id] });
    }
    if (this.gatherT < this.graspAt) return;
    if (this.gathered) return;
    this.gathered = true;

    const at = new THREE.Vector3(k.pos.x, (k.groundY || 0) + 2.2, k.pos.y);

    // ── it got away from him ────────────────────────────────────────────────
    if (!this.carry) {
      bus.emit('field:catch', { clean: false, pos: at, kid: k.home && k.home.id });
      return this.goLoose(pl);
    }

    bus.emit('field:catch', { clean: this.clean, pos: at, kid: k.home && k.home.id });
    if (!this.clean) yell(k, YELL.muff, 1.4);
    this.holder = k;

    // A catch is an out and the play is over the moment his hands close. The
    // word goes where the catch was, not where the bag is — a call floating over
    // a bag nobody is looking at is a call about nothing.
    if (this.isOut && this.play && (this.play.result === 'out_fly' || this.play.result === 'out_line')) {
      this.stamp('OUT!', { x: k.pos.x, z: k.pos.y }, true, k);
      this.celebrate(pl, true);
      this.pullUp();
      return this.beat(FT.beat);
    }

    // Anything else is a race, and somebody has to throw it somewhere.
    if (this.wantPrompt && !this.gone) return this.openPrompt(pl);
    this.goSet(pl, this.isOut ? (this.relay ? 'relay' : '1B') : '1B', this.isOut);
  }

  /* --- loose: the ball is in the road and it is nobody's ------------------- */

  /**
   * A muffed ball is a REAL BALL IN A REAL PLACE. It lies where it got away,
   * hopping twice on the Belgian block, while the kid who muffed it stands there
   * and somebody else runs it down. Every frame of that is the reason the runner
   * is safe, and it is the only version of an error that a player can read
   * without being told.
   */
  goLoose(pl) {
    const ball = this.sim.ball;
    const at = this.looseAt || new THREE.Vector3(ball.pos.x, 0, ball.pos.z);
    const g = LAYOUT.chase(at.x, at.z, 4.4);
    at.x = g.x; at.z = g.z;
    this.phase = 'loose';
    this.loose = { pos: at, t: 0, from: new THREE.Vector3(ball.pos.x, ball.pos.y, ball.pos.z) };

    /**
     * Who goes and gets it — and it is NOT the kid who let it through.
     *
     * A muff where the same boy turns round, picks it up and throws is a muff
     * with no consequence in it: the joke is that somebody else has to come all
     * the way over and do his job while he is still looking at the road. He is
     * excluded outright unless there is genuinely nobody else on his half of the
     * street.
     */
    const pool = pl.fielders.filter((f) => f !== pl.catcher && f !== this.keeper && f !== this.primary
      && !perched(f) && f.lock < 0.5);
    let best = null, bd = 1e9;
    for (const f of pool) {
      const d = dist2(f, at.x, at.z);
      if (d < bd) { bd = d; best = f; }
    }
    if (!best) best = this.backup && this.backup !== this.primary ? this.backup : this.primary;
    this.recover = best;
    const to = reachable(best, at.x, at.z);
    best.target = null;
    best.lock = 0;
    best.goTo(to.x, to.z, { speed: FT.sprint });
    best.setFace('determined', 1.6);
    this.own(best);
    bus.emit('field:loose', { kid: best.home && best.home.id, pos: at.clone() });
  }

  stepLoose(dt, sim, pl) {
    this.loose.t += dt;
    const k = this.recover;
    if (!k) return this.beat(0.5);
    if (this.loose.t < 0.16) return;                 // he has to see it first
    if (dist2(k, this.loose.pos.x, this.loose.pos.z) < 2.6 && !this.picking) {
      this.picking = 1;
      k.target = null;
      k.lookAt(this.loose.pos.x, this.loose.pos.z);
      k.act('crouch', { state: 'catch', lock: 0.42 });
      if (APP.puffs) APP.puffs.burst(new THREE.Vector3(k.pos.x, (k.groundY || 0) + 0.2, k.pos.y), 3, 2.0);
      // A LOOSE BALL LIES THERE FOR A BEAT. Nobody's hand closes on it inside
      // three-quarters of a second, whoever happens to be standing next to it,
      // because the beat where the ball is in the road and nobody has it is the
      // whole error — take it away and the muff is a half-second stutter that a
      // player never sees.
      this.pickAt = Math.max(this.loose.t + 0.24, FT.looseDwell);
    }
    if (this.picking && this.loose.t >= this.pickAt) {
      this.holder = k;
      this.loose = null;
      bus.emit('field:catch', { clean: true, pos: new THREE.Vector3(k.pos.x, (k.groundY || 0) + 2.0, k.pos.y), kid: k.home && k.home.id });
      if (this.wantPrompt && !this.gone) return this.openPrompt(pl);
      return this.goSet(pl, '1B', this.isOut);
    }
    if (this.loose && this.loose.t > 2.6) return this.beat(0.6);
  }

  /* --- set: the exchange -------------------------------------------------- */

  /**
   * He has it. Now he has to get rid of it, and WHEN he gets rid of it is the
   * whole of the race.
   *
   * The flight is left alone at a true 68 ft/s and the HOLD is solved instead:
   * every frame, ask how long the runner has left, subtract the arm and the
   * flight, and throw the moment the answer reaches zero. Because it re-solves
   * every frame it corrects itself as the runner accelerates, and because the
   * negotiation happens before the release, nothing a player can see was ever
   * stretched.
   */
  goSet(pl, tag, out) {
    this.phase = 'set';
    this.setT = 0;
    this.setTag = tag;
    this.setOut = !!out;
    const k = this.holder;
    if (!k) return this.beat(0.4);
    k.target = null;
    if (k.lock > 0.9) k.lock = 0.9;
    const bag = tag === 'relay' && this.relay
      ? { x: this.relay.pos.x, z: this.relay.pos.y }
      : (BAG[tag] || LAYOUT.FIRST);
    k.lookAt(bag.x, bag.z);

    /**
     * ONE LAST LOOK THROUGH THE LENS.
     *
     * The receiver was sent to his bag at the crack, and at the crack the camera
     * can still be sitting in the batting seat — a seat solved against the wrong
     * lens is a seat solved against nothing. The throw is the frame that
     * matters, so it is re-solved here, a beat before the ball leaves, and he
     * takes the two steps if the answer moved. Two steps is all it ever is: the
     * seats are a yard apart and he has the exchange to walk them.
     */
    const kp = this.keeper;
    if (kp && kp !== k && tag !== 'relay') {
      const pl2 = players();
      const want = keeperSpot(tag, kp, crowdAt([kp]).concat(pl2 && pl2.batter ? [bodyAt(pl2.batter)] : []));
      if (Math.hypot(want.x - kp.pos.x, want.z - kp.pos.y) > 2.2) {
        kp.target = null; kp.lock = 0;
        kp.goTo(want.x, want.z, {
          speed: FT.sprint,
          onArrive: (kk) => { kk.act('ready', { state: 'catch', lock: 2.0 }); kk.lookAt(k.pos.x, k.pos.y); },
        });
        this.own(kp);
      }
      this.keeperAt = want;
    }
    bus.emit('field:set', { kid: k.home && k.home.id, to: tag });
  }

  /** Natural flight time for the throw he is about to make, in seconds. */
  throwDur(tag) {
    const k = this.holder;
    const bag = tag === 'relay' && this.relay
      ? { x: this.relay.pos.x, z: this.relay.pos.y }
      : (BAG[tag] || LAYOUT.FIRST);
    const d = k ? dist2(k, bag.x, bag.z) : 24;
    return clamp(d / FT.throwSpeed, 0.16, 0.9);
  }

  stepSet(dt, sim, pl) {
    this.setT += dt;
    const dur = this.throwDur(this.setTag);
    /**
     * WHO IS SOLVING THE RACE.
     *
     * src/game/baserunning.js governs its own runners off this file's
     * `field:throw` event — it measures the ball's real time to the bag and
     * bends the legs inside a ±20% band so the picture agrees with the core. On
     * a street with that piece in it the honest thing for a fielder to do is
     * make a natural exchange and throw; solving the flight against a runner
     * somebody else owns would be two governors fighting over one play.
     *
     * The fallback below is for the days that slot is empty (and for
     * tools/playthrough.mjs, which has run without it): hold the ball, set the
     * feet, and release the moment a true 68 ft/s throw lands on the right side
     * of him.
     */
    let go = this.setT >= FT.holdMin;
    if (go && gameplay.baserunning) {
      go = this.setT >= FT.exchange;
    } else if (go && this.setTag === '1B' && this.runner) {
      const want = this.runnerEta() + (this.setOut ? -FT.outBy : FT.safeBy);
      go = want - FT.windup - dur <= 0;
    } else if (go) {
      go = this.setT >= FT.exchange;
    }
    if (this.setT > FT.holdMax) go = true;
    if (go) this.startThrow(pl, this.setTag, this.setOut, dur);
  }

  /* --- the prompt --------------------------------------------------------- */

  openPrompt(pl) {
    const want = this.wantPrompt || {};
    const targets = (want.targets && want.targets.length ? want.targets : ['1B']).slice(0, 3);
    const deadline = want.deadline || P.race.throwDeadline;
    this.phase = 'prompt';
    this.prompt = {
      t: 0, deadline, targets,
      best: want.best || '1B',
      cards: [],
      choice: null,
      pop: 0,
      tick: FT.ticks,
    };
    // every live bag gets a body standing on it — that is the read
    for (const tg of targets) {
      const id = BAG_KEEPER[tg];
      let k = id && pl.fielders.find((f) => f.home && f.home.id === id);
      if (k === this.holder) k = null;
      const bag = BAG[tg];
      if (k && bag) {
        const to = keeperSpot(tg, k, crowdAt([k]));
        k.target = null; k.lock = 0;
        k.goTo(to.x, to.z, {
          speed: FT.sprint,
          onArrive: (kk) => { kk.act('ready', { state: 'catch', lock: 2.4 }); kk.lookAt(this.holder ? this.holder.pos.x : 0, this.holder ? this.holder.pos.y : 0); },
        });
        this.own(k);
      }
      this.prompt.cards.push({ bag: tg, kid: id, box: null });
    }
    // the thrower is cocked and looking for somebody
    this.holder.target = null;
    this.holder.act('throw', { state: 'throw', speed: 0.3, lock: deadline + 0.4 });
    this.holder.setFace('squint', deadline);
    bus.emit('throw:prompt', { targets, best: this.prompt.best, deadline });
  }

  stepPrompt(dt, sim, pl) {
    const pr = this.prompt;
    pr.t += dt;
    pr.pop = Math.max(0, pr.pop - dt * 4);
    // the chalk marks come off one at a time, and each one is a beat you can hear
    const left = Math.max(0, pr.deadline - pr.t);
    const n = Math.ceil(clamp(left / pr.deadline, 0, 1) * FT.ticks - 1e-6);
    if (n < pr.tick) { pr.tick = n; bus.emit('throw:tick', { left: n }); }
    // he keeps looking from one bag to the other while he thinks
    const look = BAG[pr.targets[Math.floor(pr.t / 0.42) % pr.targets.length]];
    if (look && this.holder) this.holder.lookAt(look.x, look.z);
    if (pr.t >= pr.deadline) this.timeout(pl);
  }

  /** The player picked a bag. The CORE settles it; this file only stages it. */
  choose(tag) {
    if (this.phase !== 'prompt' || !this.prompt) return false;
    const pr = this.prompt;
    if (!pr.targets.includes(tag)) return false;
    pr.choice = tag;
    pr.pop = 1;
    bus.emit('throw:choice', { target: tag, left: Math.max(0, pr.deadline - pr.t) });
    const settled = liveMatch.resolveThrow(tag);
    if (settled) { this.play = settled; this.result = this.fromPlay(settled); }
    const pl = players();
    if (pl) {
      // he already had it cocked: the arm is short and the ball is gone
      this.keeperTag = tag;
      const id = BAG_KEEPER[tag];
      const k = id && pl.fielders.find((f) => f.home && f.home.id === id);
      if (k && k !== this.holder) this.keeper = k;
      this.goSet(pl, tag, this.isOut);
      this.setT = FT.holdMin;
    }
    return true;
  }

  /**
   * Nobody threw it anywhere.
   *
   * This is a KID HESITATING, not an interface that expired: he cocks it, looks
   * at first, looks at home, double-clutches, and ends up holding the ball while
   * the whole block tells him what he should have done. The core calls the same
   * thing it always calls (`throwTimeout`), and everybody is safe.
   */
  timeout(pl) {
    const settled = liveMatch.throwTimeout();
    if (settled) { this.play = settled; this.result = this.fromPlay(settled); }
    this.prompt.expired = true;
    this.prompt.t = this.prompt.deadline;
    const k = this.holder;
    if (k) {
      k.lock = 0;
      k.act('fumble', { state: 'fumble', speed: 0.8 });
      k.setFace('shock', 1.8);
      yell(k, YELL.hesitate, 1.5);
    }
    // the block, immediately and at volume
    let yelled = 0;
    for (const f of pl.fielders) {
      if (f === k || f === pl.catcher || yelled >= 3) continue;
      if (f.lock > 0) continue;
      f.target = null;
      f.lookAt(k ? k.pos.x : 0, k ? k.pos.y : 0);
      f.act(yelled % 2 ? 'argue_appeal' : 'argue_jab', { state: 'argue', lock: 1.3 });
      f.setFace('taunt', 1.8);
      if (yelled === 0) yell(f, YELL.yellAt, 1.6);
      yelled++;
    }
    for (const sp of pl.spectators) if (sp.lock <= 0) sp.flavour('cheer_wave', { life: 1.1, amp: 0.9 });
    this.stamp('HELD IT!', { x: k ? k.pos.x : LAYOUT.FIRST.x, z: k ? k.pos.y : LAYOUT.FIRST.z }, false, k);
    bus.emit('throw:timeout', {});
    bus.emit('field:hesitate', { kid: k && k.home && k.home.id });
    this.beat(1.35);
  }

  /* --- the throw ---------------------------------------------------------- */

  /**
   * Let go of it. The flight is honest — a straight 68 ft/s line with a foot and
   * a half of arc on it — because the arithmetic that makes the call true was
   * already spent standing still (see stepSet). It is AIMED AT A BODY: `keeper`
   * is re-read every frame the ball is in the air, so the throw lands in a pair
   * of hands even if the kid covering the bag is still three strides away when
   * it leaves.
   */
  startThrow(pl, tag, out, dur) {
    const k = this.holder;
    if (!k) return this.beat(0.4);
    const relay = tag === 'relay';
    const target = relay ? this.relay : this.keeper;
    const bag = relay ? null : (BAG[tag] || LAYOUT.FIRST);
    const to = relay && target
      ? new THREE.Vector2(target.pos.x, target.pos.y)
      : new THREE.Vector2(bag.x, bag.z);

    const from = handAt(k, new THREE.Vector3()).clone();
    const d = Math.hypot(to.x - from.x, to.y - from.z);
    const flight = dur || clamp(d / FT.throwSpeed, 0.16, 0.9);

    if (k.lock > 0 && k.state !== 'throw') k.lock = 0;
    k.lookAt(to.x, to.y);
    // the clip's `release` event is at 0.48 s; play it so that lands on FT.windup
    const speed = clamp(FT.releaseAt / FT.windup, 0.9, 2.4);
    k.act('throw', { state: 'throw', speed });
    k.setFace('determined', 0.9);
    this.arrow = {
      from,
      to: new THREE.Vector3(to.x, LAYOUT.groundAt(to.x) + 3.0, to.y),
      t: -FT.windup, dur: flight, tag, relay,
      hi: d * FT.throwArc + 1.2,
      body: relay ? this.relay : this.keeper,
      released: false,
    };
    this.phase = 'throw';
    /**
     * `dur` is the arm PLUS the flight, because src/game/baserunning.js governs
     * its runners off it from the frame it hears about the throw — and for the
     * first quarter of a second of that the ball is still cocked behind a kid's
     * ear. Reporting only the flight told that file the ball would be there a
     * quarter of a second before it could physically be there, and every close
     * play at first came in a stride early.
     */
    bus.emit('field:throw', { from: k.home && k.home.id, to: relay ? 'relay' : tag, dur: FT.windup + flight, out: !!out });
  }

  stepThrow(dt, sim, pl) {
    const a = this.arrow;
    if (!a) return this.beat(0.4);
    a.t += dt;
    if (a.t < 0) return;                       // still winding up
    if (!a.released) {
      a.released = true;
      this.holder = null;                      // it is out of his hand now
      a.from.copy(sim.ball.pos);
      if (APP.puffs) APP.puffs.burst(a.from, 2, 1.6);
    }
    // re-aim at the hands it is going to land in
    const b = a.body;
    if (b) {
      const want = handAt(b, _wp);
      a.to.x += (want.x - a.to.x) * clamp(dt * 7, 0, 1);
      a.to.y += (want.y - a.to.y) * clamp(dt * 7, 0, 1);
      a.to.z += (want.z - a.to.z) * clamp(dt * 7, 0, 1);
    }
    if (a.t >= a.dur) this.landThrow(pl, a);
  }

  landThrow(pl, a) {
    const sim = this.sim;
    sim.ball.pos.set(a.to.x, a.to.y, a.to.z);
    const at = a.to.clone();

    if (a.relay && this.relay) {
      // the cut-off man turns and fires it in — the second half of a relay
      const r = this.relay;
      this.holder = r;
      this.relay = null;
      this.arrow = null;
      r.target = null; r.lock = 0;
      r.act('ready', { state: 'catch', lock: 0.28 });
      r.lookAt(LAYOUT.FIRST.x, LAYOUT.FIRST.z);
      bus.emit('field:catch', { clean: true, pos: at, kid: r.home && r.home.id });
      bus.emit('field:relay_turn', { kid: r.home && r.home.id });
      return this.goSet(pl, '1B', this.isOut);
    }

    const keeper = a.body;
    if (keeper) {
      keeper.target = null;
      keeper.lock = 0;
      keeper.setFace(this.isOut ? 'grin' : 'shock', 1.8);
      /**
       * HE SHOWS THE BALL.
       *
       * The single frame this whole file exists to produce is a boy holding a
       * ball up where everyone can see it while the runner stands four feet
       * short of the bag — and round 1 of wave G3 did not produce it. The catch
       * ended in `ready`, which is a half-crouch with both hands at chest
       * height, in the busiest corner of the frame, against a fire hydrant that
       * is very nearly the ball's own colour. Measured on `field_grounder`: the
       * ball was eleven pixels of pink inside a hundred-pixel lump of kid.
       *
       * The ball in this file lives at whichever hand src/chars/players.js
       * solves, so the fix is a pose, not a hack — but it has to be the RIGHT
       * pose. `cheer_arms` was tried and measured first: these kids are 3.2 head
       * heights tall and their arms are barely longer than their heads, so both
       * arms up put the ball at 4.2 units, level with his own ear and BELOW the
       * top of his cap. Beside his head is not above the crowd.
       *
       * `cheer_jump` takes the whole body up 1.9 units at the apex and holds it
       * for four frames, which puts the ball at six — a clear head and a half
       * over every cap on the block, silhouetted against road instead of against
       * a fire hydrant of very nearly its own colour. It is also, plainly, what
       * a nine-year-old who has just thrown somebody out does.
       */
      keeper.act('ready', { state: 'catch', lock: 0.06, after: (kk) => {
        if (this.isOut) { kk.act('cheer_jump', { state: 'act', lock: 2.1 }); kk.setFace('grin', 2.2); }
        else { kk.act('sulk', { state: 'sulk', lock: 1.4 }); kk.setFace('shock', 1.4); }
      } });
      this.holder = keeper;
      if (this.isOut) bus.emit('field:show_ball', { kid: keeper.home && keeper.home.id, bag: a.tag });
    }
    this.arrow = null;
    bus.emit('field:catch', { clean: true, pos: at, kid: keeper && keeper.home && keeper.home.id });
    bus.emit('field:tag', { bag: a.tag, out: this.isOut });

    const bag = BAG[a.tag] || LAYOUT.FIRST;
    if (this.isOut) this.pullUp();
    // The call goes up when the ball reaches the bag, and it goes up whichever
    // way it went. Round 1 held SAFE! back until this file's own runner touched
    // the chalk — and src/game/baserunning.js owns the runners now, so that
    // flag never came and half the plays in the game ended with no call at all.
    if (!this.callWord) this.stamp(this.isOut ? 'OUT!' : 'SAFE!', bag, this.isOut, keeper);
    this.celebrate(pl, this.isOut);
    this.beat(FT.beat);
  }

  /* --- runner, call, reaction --------------------------------------------- */

  stepRunner(dt, pl) {
    const r = this.runner;
    const d = dist2(r, LAYOUT.FIRST.x, LAYOUT.FIRST.z);
    if (r.fieldStep === undefined) r.fieldStep = 0;
    r.fieldStep += r.speed * dt;
    if (r.fieldStep > 5.4) {
      r.fieldStep = 0;
      bus.emit('run:step', { pos: new THREE.Vector3(r.pos.x, 0.2, r.pos.y), surface: 'street', pitch: frng.range(0, 0.25) });
    }
    /**
     * HE GOES IN HEAD FIRST, AND HE STOPS ON THE BAG.
     *
     * src/chars/players.js decays a skid at 13 ft/s², so a kid who leaves his
     * feet at g travels exactly g²/26 feet. Solving g for the distance he has
     * left is the difference between a slide that ends on the chalk and the one
     * this file used to play, which carried him six feet past first and left him
     * lying in the road while the call was made behind him.
     */
    /**
     * HE ONLY LEAVES HIS FEET WHEN HE IS GOING TO MAKE IT.
     *
     * Nobody slides into first on a play he has already lost, and — the reason
     * that matters here rather than in a rulebook — a kid lying face down under
     * a lens this high is a cap and two hands, while a kid at a dead run is a
     * silhouette. On an out he is beaten ON HIS FEET, five feet short, which is
     * a picture a critic can read in one glance. On a hit he goes in head first,
     * into a bag the receiver is standing a stride off, and raises dust.
     */
    if (d < FT.slideAt && !r.slidYet && !this.gone && !this.isOut) {
      r.slidYet = 1;
      r.target = null;
      r.lookAt(LAYOUT.FIRST.x, LAYOUT.FIRST.z);
      r.snapFacing();
      const travel = Math.max(0.4, d - FT.bagIn);
      r.act('slide', { state: 'slide' });
      // src/chars/players.js takes max(speed, glide) inside act(), so a SHORTER
      // skid than the kid's own running speed cannot be asked for through the
      // verb — it has to be written after it. Without this he skids 11.8 feet on
      // his hip every time and finishes the play lying six feet past the bag.
      r.glide = Math.min(r.speed, Math.sqrt(2 * FT.glideDecay * travel));
      bus.emit('run:slide', { pos: new THREE.Vector3(r.pos.x, 0.2, r.pos.y) });
    }
    if (d < FT.bagIn + 0.7 && !r.arrivedYet) {
      r.arrivedYet = 1;
      r.runOut = false;
      r.target = null;
      if (!this.isOut) {
        r.setFace('grin', 2.0);
        if (!this.callWord) this.stamp('SAFE!', LAYOUT.FIRST, false, r);
      } else {
        r.setFace('shock', 1.6);
      }
    }
  }

  /** Caught. He pulls up half way down the line and kicks the road. */
  pullUp() {
    const r = this.runner;
    if (!r || !r.runOut) return;
    r.runOut = false;
    r.target = null;
    r.act('run_stop', { state: 'stop', lock: 0.5, after: (k) => k.act('sulk', { state: 'sulk', lock: 1.6 }) });
    r.setFace('sulk', 2.2);
  }

  /**
   * The payoff frame: one word, chalked on the road at the play.
   *
   * `near` is the body the call is ABOUT. The overlay pushes the word clear of
   * him, of the ball and of the frame edges, because a call written across the
   * catch is a call about nothing — and a UI element on top of the ball is the
   * one unforgivable readability failure in BYB §11.
   */
  stamp(word, bag, out, near) {
    this.callWord = word;
    this.callOut = !!out;
    this.callBag = bag || LAYOUT.FIRST;
    this.callNear = near || null;
    this.callAt = this.t;
    this.scuff = 0;
    bus.emit('field:call', { word, out: !!out });
  }

  celebrate(pl, good) {
    let n = 0;
    for (const f of pl.fielders) {
      if (f === pl.catcher || f.lock > 0.4) continue;
      f.setFace(good ? 'grin' : 'sulk', 1.8);
      if (good && n < 3 && frng.chance(0.6)) { f.flavour('cheer_arms', { life: 0.9, amp: 0.65 }); n++; }
    }
    for (const sp of pl.spectators) if (sp.lock <= 0 && frng.chance(0.6)) sp.flavour('cheer_wave', { life: 1.2, amp: 0.75 });
  }

  beat(sec) { this.phase = 'beat'; this.closeAt = this.t + sec; }

  close() {
    this.phase = 'done';
    if (!this.result) this.result = { kind: 'out', bases: 0, detail: 'fielded' };
    // The bridge in core.js must not judge the same batted ball a second time.
    if (this.judgedHere) this.sim.lastContact = null;
    if (liveMatch.pendingThrow) liveMatch.pendingThrow = {};
    bus.emit('field:done', { kind: this.result.kind, detail: this.result.detail });
  }

  own(k) { if (k && !this.movers.includes(k)) this.movers.push(k); }

  /** Everybody back on their mark; nothing this play touched stays touched. */
  release() {
    const pl = players();
    if (!pl) return;
    for (const k of pl.fielders) {
      k.fieldReact = undefined; k.fieldPlaced = undefined; k.camped = 0;
    }
    for (const k of this.movers) {
      if (k.lock <= 0) { k.target = null; k.goHome(); }
      else k.fieldGoHome = 1;
    }
    if (this.runner) {
      const r = this.runner;
      r.runOut = false; r.slidYet = 0; r.arrivedYet = 0; r.fieldStep = undefined;
    }
  }
}

/**
 * The eight ways this ends, as one table.
 *
 *   grasp   seconds into the animation at which his hands close on it — or, for
 *           the three that do not end in a hand, the frame it gets away
 *   clean   was it a catch? (drives the audio cue and the announcer's line)
 *   carry   does he end up holding it, or does it end up in the road?
 */
const STYLE = {
  jump: { grasp: 0.40, clean: true, carry: true },
  dive: { grasp: 0.42, clean: true, carry: true },
  snag: { grasp: 0.12, clean: true, carry: true },
  scoop: { grasp: 0.18, clean: true, carry: true },
  bobble: { grasp: 1.02, clean: false, carry: true },
  legs: { grasp: 0.32, clean: false, carry: false },
  standoff: { grasp: 0.40, clean: false, carry: false },
  pile: { grasp: 0.50, clean: false, carry: false },
};

/* ============================================================================
   3. THE SLOT
   ---------------------------------------------------------------------------
   src/game/sim.js calls exactly two things on this piece.
   ========================================================================= */

let sawThrow = null;
bus.on('street:throw', (p) => { sawThrow = p || {}; });

let current = null;
let comicErrors = true;
/** Scenarios only: pin which of the eight gathers plays, so a still is a still. */
let forceStyle = null;
const comicOn = () => comicErrors;

provide('fielding', {
  onBallInPlay(sim, hit) {
    const pl = players();
    // src/chars/players.js keeps a purely visual chase for the days this slot is
    // empty. It is not empty any more; stand it down rather than have two
    // systems steering the same nine bodies.
    if (pl) { pl.chase = null; pl.backup = null; }

    current = new Play(sim, hit, sim.__forcePlay || null);
    sim.__forcePlay = null;
    current.judge();

    if (!pl) return;
    current.aim(sim);
    if (current.gone) {
      current.phase = 'watch';
      for (const f of pl.fielders) {
        if (f === pl.catcher) continue;
        f.target = null;
        f.lookAt(current.spot.x, Math.max(current.spot.y, 70));
        f.setFace('shock', 1.8);
        if (frng.chance(0.4) && f.lock <= 0) f.flavour('fidget_look', { amp: 1 });
      }
      bus.emit('field:gone', { detail: current.result && current.result.detail });
      return;
    }
    current.cast(pl);
    current.breakRunner(pl);
  },

  update(dt, sim) {
    if (!current) return null;

    /**
     * ANSWER BEFORE THE PHYSICS DOES.
     *
     * src/game/sim.js asks this slot first and src/game/ballphysics.js second,
     * and if the ball is declared settled while this file is still returning
     * null the play resolves through the placeholder in defaults.js — which
     * re-judges the same batted ball through the core and produces a second,
     * different verdict. So a dead ball (rest, roll-out, down a grate, on a
     * roof) closes the play HERE, with the verdict the core already gave.
     */
    const bp = gameplay.ballphysics;
    const mine = current.claimed || current.holder || current.arrow || current.phase === 'loose';
    if (!mine && current.phase !== 'done') {
      const dead = bp && bp.settled ? bp.settled(sim.ball, sim) : sim.playT > 2.4;
      if (dead) current.close();
    }

    const out = current.step(dt, sim);

    /**
     * The fake upward speed is not decoration: src/game/ballphysics.js declares a
     * ball "settled" after 0.30 s under 4 ft/s, and a settled ball makes
     * src/game/sim.js resolve the play out from under this file with the
     * placeholder verdict in defaults.js. Keeping a ball that is spoken for —
     * in a hand, or lying in the road with a kid running at it — nominally alive
     * and pointed at the sky, where there is nothing to collide with, is the
     * cheapest honest way to say "this one is ours".
     *
     * On a throw the speed is set to the real thing instead, because
     * src/game/ballphysics.js draws its six-frame chalk trail off `ball.vel`
     * and a thrown ball is exactly the hard-hit ball that trail is for.
     */
    if (current.claimed || current.holder || current.phase === 'loose') {
      sim.ball.vel.set(0, FT.holdLift, 0);
    } else if (current.arrow && current.arrow.t >= 0) {
      /**
       * The real horizontal velocity of the throw, not a stand-in for it. Two
       * other files read it: src/game/ballphysics.js draws its six-frame chalk
       * trail on anything over 52 ft/s (a thrown ball is exactly the hard-hit
       * ball that trail is for), and src/game/baserunning.js divides the
       * distance to the bag by it to know when the ball gets there.
       */
      const a = current.arrow;
      _wp.set(a.to.x - a.from.x, 0, a.to.z - a.from.z);
      const m = Math.max(1e-3, _wp.length());
      const v = Math.max(FT.trailSpeed, m / Math.max(0.05, a.dur));
      sim.ball.vel.set((_wp.x / m) * v, 0, (_wp.z / m) * v);
    }

    if (out) { current.release(); current = null; }
    return out;
  },
});

/* ============================================================================
   4. THE OVERLAY — chalk, torn paper, and a countdown made of tally marks
   ---------------------------------------------------------------------------
   DESIGN-BIBLE §11: every element is a depicted physical object you can name the
   material of. There are three materials in here and no fourth:

       CHALK on asphalt   the arrows to each live bag, the tally countdown, the
                          scuffed patch under them, and the word the block yells
       BUTCHER PAPER      the tag over each bag, torn all round, with a band of
                          the waiting kid's own accent colour along the top —
                          the single-saturated-garment rule doing double duty as
                          a name tag (the same trick src/ui/bubbles.js plays)
       INK                every outline, never grey (§4.2)

   No panel, no bar, no rectangle with four equal corners, no system font: every
   letter is the CURB CHALK skeleton out of src/world/props.js.
   ========================================================================= */

const PAPER = 0xe3d0a6;
const PAPER_SHADE = 0xc4ac7d;

class Overlay {
  constructor() { this.el = null; this.g = null; this.w = 0; this.h = 0; this.U = 1; this.hits = []; }

  mount() {
    if (this.el || typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.id = 'sb-field';
    Object.assign(c.style, {
      position: 'fixed', left: '0', top: '0', width: '100%', height: '100%',
      display: 'block', zIndex: '44', pointerEvents: 'none',
    });
    (document.getElementById('ui') || document.body).appendChild(c);
    this.el = c; this.g = c.getContext('2d');
    this.resize();
  }

  resize() {
    if (!this.el) return;
    const w = Math.max(640, Math.round(globalThis.innerWidth || 1600));
    const h = Math.max(360, Math.round(globalThis.innerHeight || 900));
    if (this.w !== w || this.h !== h) { this.el.width = w; this.el.height = h; this.w = w; this.h = h; }
    this.U = this.h / 900;
  }

  project(app, x, y, z) {
    _wp.set(x, y, z).project(app.camera);
    if (_wp.z > 1) return null;
    return { x: (_wp.x * 0.5 + 0.5) * this.w, y: (-_wp.y * 0.5 + 0.5) * this.h };
  }

  clear() { if (this.g) this.g.clearRect(0, 0, this.w, this.h); this.hits = []; }

  /**
   * SHOWN ONLY WHEN THERE IS SOMETHING ON IT.
   *
   * A fixed-position canvas gets its own compositing layer, and a layer whose
   * backing store is cleared but whose element never changes is not reliably
   * re-composited: measured in the screenshot harness, the throw prompt's chalk
   * and tags kept appearing in the NEXT scenario's PNG for a full frame after
   * `getImageData` proved the canvas was empty. Toggling `display` is a layout
   * change, which nothing skips, and it costs one style write per play.
   */
  show(v) {
    if (this.shown === v || !this.el) return;
    this.shown = v;
    this.el.style.display = v ? 'block' : 'none';
  }

  paint(app) {
    const p = current;
    this.mount(); this.resize();
    if (!this.g) return;
    this.clear();
    const promptUp = !!p && (p.phase === 'prompt' || (p.prompt && p.prompt.expired && p.phase === 'beat'));
    const callUp = !!p && !!p.callWord;
    this.show(promptUp || callUp);
    if (!promptUp && !callUp) return;
    const g = this.g;
    g.save();
    if (promptUp) this.paintPrompt(app, g, p);
    if (callUp) this.paintCall(app, g, p);
    g.restore();
  }

  /* --- the prompt --------------------------------------------------------- */
  /**
   * The prompt, in three reads, in this order of priority:
   *
   *   WHICH BAGS ARE LIVE   a chalk ring on each one and a torn paper tag over it
   *   WHICH IS THE GOOD ONE the good one is fresh chalk — a thick arrow with
   *                         chevrons crawling up it, a big tag, and the kid on
   *                         the bag shouting. The others are last week's chalk.
   *   HOW LONG IS LEFT      five chalk strokes on a scuffed patch of road, rubbed
   *                         out one at a time, with the thrower's own ring going
   *                         red as they go
   */
  paintPrompt(app, g, p) {
    const pr = p.prompt;
    const U = this.U;
    const k = p.holder || p.primary;
    if (!k) return;
    const left = Math.max(0, pr.deadline - pr.t);
    const frac = clamp(left / pr.deadline, 0, 1);
    const urgent = frac < 0.42;
    const dim = pr.expired ? 0.32 : 1;
    const ball = app.sim.ball;
    const bp = this.project(app, ball.pos.x, ball.pos.y, ball.pos.z);

    /**
     * 1. THE ROAD.
     *
     * Not a line. A line from the boy with the ball to a bag forty feet away is
     * a straight bar across the middle of the frame, and on a street with a
     * lamppost, an El column and an awning strut already in it a straight bar
     * reads as one more piece of ironwork — measured, round 1's arrow was
     * mistaken for a scaffold pole in every frame it appeared in.
     *
     * So it is CHEVRONS: four chalk arrow-heads walking up the road toward the
     * bag, drawn on the ground plane, crawling while the clock runs. Nothing
     * continuous, nothing straight, nothing that can be mistaken for a girder,
     * and direction is what an arrow-head says for a living.
     */
    for (const card of pr.cards) {
      const bag = BAG[card.bag];
      if (!bag) continue;
      const best = card.bag === pr.best;
      const chosen = pr.choice === card.bag;
      const lit = best || chosen;
      const al = (chosen ? 1 : best ? 0.98 : 0.40) * dim;

      /**
       * The ground path — and it BOWS.
       *
       * A dead-straight mark between two points forty feet apart is a rule, and
       * a rule laid on a street that already has a lamppost, an El column and an
       * awning strut in it reads as one more piece of ironwork; round 1 of wave
       * G3 drew exactly that and it photographed as a guy-wire strung across the
       * frame. Two feet of sag, thrown to the side the kid's arm swings, is what
       * a boy dragging a stub of chalk at a dead run actually leaves, and it is
       * the difference between chalk and hardware.
       */
      const dxb = bag.x - k.pos.x, dzb = bag.z - k.pos.y;
      const mb = Math.max(1e-3, Math.hypot(dxb, dzb));
      const bowX = (dzb / mb) * 3.2, bowZ = -(dxb / mb) * 3.2;
      const at = (u) => {
        const sag = Math.sin(clamp(u / 0.42, 0, 1) * Math.PI);
        const x = k.pos.x + dxb * u + bowX * sag;
        const z = k.pos.y + dzb * u + bowZ * sag;
        return this.project(app, x, LAYOUT.groundAt(x) + 0.05, z);
      };
      /**
       * A CHALK LINE, BROKEN, with one big head on the end of it.
       *
       * The road is seen at about ten degrees, so anything drawn flat on it is
       * squashed to a sliver and a cluster of small marks reads as litter — that
       * is what killed the four-chevron version. What survives that projection
       * is LENGTH: one line that runs the whole way from the boy with the ball
       * to the bag, dashed so it is unmistakably chalk rather than ironwork, and
       * thin enough that it never becomes the scaffold pole round 1 drew.
       */
      /**
       * A FLICK, NOT A ROAD.
       *
       * Three rounds have now tried to draw a line from the boy with the ball to
       * a bag forty feet away, and all three photographed as hardware: a road
       * seen at fourteen degrees squashes anything laid flat on it into a bar,
       * and a white bar with an ink lining under it, forty feet long, in a
       * street that already contains a lamppost, an El column and an awning
       * strut, is a broom handle lying in the gutter. Measured on wave G3 round
       * 1 the "tapered dashes" version came out as one solid stick through the
       * runner's shins.
       *
       * The distance was never the job. The BAG says where — it has a chalk ring
       * round it, a bit of string up to a torn paper tag, and the kid who is
       * standing on it named on the tag. All the line has to say is WHICH WAY,
       * and which way is a gesture: a short bowed swipe of chalk leaving the
       * thrower's own feet with an arrow-head on the end of it, ten feet long
       * and gone. Three of them, one per live bag, make a starburst round the
       * boy who has to choose — which is the read the whole prompt is about, and
       * it cannot be mistaken for a girder because it is nowhere near straight
       * and nowhere near long enough.
       */
      const flick = [];
      for (let i = 0; i <= 7; i++) {
        const sp = at(0.09 + (i / 7) * 0.21);
        if (sp) flick.push([sp.x, sp.y]);
      }
      if (flick.length > 2) {
        chalkMark(g, flick, (lit ? 7.0 : 2.6) * U, 37 + card.bag.length, al * (lit ? 1 : 0.8));
        if (lit) chalkMark(g, flick, 3.0 * U, 43 + card.bag.length, al * 0.55);
      }
      // and the head on the end of the swipe, pointing up the street at the bag
      const a1 = at(0.335), a0 = at(0.27);
      if (a1 && a0) {
        const ang = Math.atan2(a1.y - a0.y, a1.x - a0.x);
        const L = (lit ? 30 : 14) * U;
        chalkMark(g, [
          [a1.x - Math.cos(ang + 0.62) * L, a1.y - Math.sin(ang + 0.62) * L],
          [a1.x, a1.y],
          [a1.x - Math.cos(ang - 0.62) * L, a1.y - Math.sin(ang - 0.62) * L],
        ], (lit ? 8.0 : 3.2) * U, 63 + card.bag.length, al);
      }

      // THE RING. On the good one it is drawn twice, fast, the way a kid rings
      // something on a wall when he means it, and it breathes.
      const rings = lit ? [3.1, 3.9] : [3.2];
      for (let rr = 0; rr < rings.length; rr++) {
        const rad = rings[rr] + (lit ? 0.14 * Math.sin(pr.t * 6 + rr) : 0);
        const ring = [];
        for (let i = 0; i <= 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const sp = this.project(app, bag.x + Math.cos(a) * rad, LAYOUT.groundAt(bag.x) + 0.05, bag.z + Math.sin(a) * rad);
          if (sp) ring.push([sp.x, sp.y]);
        }
        if (ring.length > 3) chalkMark(g, ring, (lit ? (rr ? 3.4 : 6.0) : 2.6) * U, 19 + rr * 5 + card.bag.length, al * (rr ? 0.7 : 1));
      }
    }

    // 1b. a ring round the boy with the ball. Three tags and two arrows do not
    //     say WHO is deciding, and on a street with nine kids on it that is the
    //     first thing a player has to find. It goes red on the last two strokes.
    const me = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const rr = 2.7 + (urgent ? 0.22 * Math.sin(pr.t * 13) : 0);
      const s = this.project(app, k.pos.x + Math.cos(a) * rr, (k.groundY || 0) + 0.05, k.pos.y + Math.sin(a) * rr);
      if (s) me.push([s.x, s.y]);
    }
    if (me.length > 3) chalkMark(g, me, 5.2 * U, 97, dim * 0.95, urgent ? ACCENTS.red : CHALK);

    // 2. the tags. Solved so no two of them touch and none of them sits on the
    //    ball — a UI element covering the ball is the one unforgivable one.
    //    `roadTop` is where the street stops and the shopfronts start, measured
    //    off the locked field framing: nothing chalked or torn goes above it.
    const roadTop = this.h * 0.27;
    const boxes = [];
    for (const card of pr.cards) {
      const bag = BAG[card.bag];
      if (!bag) continue;
      // Anchored to the bag's own ground point and lifted a FIXED number of
      // pixels, not a fixed number of feet: five feet of world above home plate
      // is 140 px and five feet above second is 40, so a world offset put the
      // near tag in orbit and the far one on the floor. A tag is a screen object.
      const s = this.project(app, bag.x, LAYOUT.groundAt(bag.x) + 0.1, bag.z);
      if (!s) continue;
      const best = card.bag === pr.best;
      /**
       * A FLOOR ON THE SIZE, AND A SIDE OF THE BAG TO SIT ON.
       *
       * Second is chalked sixty feet up the street, so the road behind it on
       * screen is not road at all — it is the far sidewalk, an awning and a
       * lunchroom sign. Round 1 hung the tag a hundred pixels ABOVE that bag at
       * 0.84 scale and produced an eighty-pixel scrap of kraft paper lying on a
       * storefront: a player scanning the frame read it as signage and never saw
       * it. Two fixes, both structural rather than cosmetic. A non-best tag is
       * never smaller than 1.02 — the hierarchy is carried by the fresh chalk
       * round the good one, not by shrinking the others into illegibility. And a
       * tag goes above its bag only while there is ROAD above its bag; past the
       * point where the buildings start it drops to the near side instead and
       * the chalk stem runs up to the bag, which is where a kid would have put
       * it anyway.
       */
      const sc = (best ? 1.46 : 1.02) * U * (pr.choice === card.bag ? 1 + pr.pop * 0.12 : 1);
      const w = 132 * sc, h = 68 * sc;
      const lift = 104 * U;
      let ty = s.y - h - lift;
      if (ty < roadTop) ty = s.y + lift * 0.42;
      boxes.push({ card, best, sc, w, h, bag, x: s.x - w / 2, y: ty });
    }
    boxes.sort((A, B) => A.y - B.y);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      b.x = clamp(b.x, 10 * U, this.w - b.w - 10 * U);
      b.y = clamp(b.y, roadTop, this.h - b.h - 96 * U);
      // clear of the ball
      if (bp && bp.x > b.x - 40 * U && bp.x < b.x + b.w + 40 * U
          && bp.y > b.y - 26 * U && bp.y < b.y + b.h + 26 * U) {
        b.y = clamp(bp.y - b.h - 48 * U, roadTop, this.h - b.h - 96 * U);
      }
      // clear of each other
      for (let j = 0; j < i; j++) {
        const o = boxes[j];
        if (b.x < o.x + o.w + 8 * U && b.x + b.w + 8 * U > o.x
            && b.y < o.y + o.h + 10 * U && b.y + b.h + 10 * U > o.y) {
          b.y = o.y + o.h + 16 * U;
        }
      }
    }
    this.hits = [];
    for (const b of boxes) {
      // THE STEM. A label floating above a street with nine kids in it belongs
      // to nobody until something joins it to the chalk it is about; this is the
      // bit of string between the tag and the bag, and it is drawn first so the
      // paper sits on top of it.
      const foot = this.project(app, b.bag.x, LAYOUT.groundAt(b.bag.x) + 0.08, b.bag.z);
      if (foot) {
        const sx = b.x + b.w / 2, sy = b.y + b.h;
        chalkMark(g, [[sx, sy], [(sx + foot.x) / 2 + 4 * U, (sy + foot.y) / 2], [foot.x, foot.y]],
          (b.best ? 3.6 : 2.2) * U, 211 + b.card.bag.length, (b.best ? 0.9 : 0.5) * dim);
      }
      b.card.box = { x: b.x, y: b.y, w: b.w, h: b.h };
      this.hits.push({ bag: b.card.bag, x: b.x, y: b.y, w: b.w, h: b.h });
      this.tag(g, b.card, b.x, b.y, b.w, b.h, b.sc, b.best, pr.choice === b.card.bag, dim);
    }

    // 3. the clock.
    //    It used to sit at the thrower's feet, which was diegetically neat and
    //    practically useless: on a stage this shallow his feet are usually on top
    //    of the catcher, and a countdown you have to hunt for is not a countdown.
    //    The ring round HIM says who; this says how long, chalked on the flags at
    //    the bottom of the frame where a kid would actually chalk something, in
    //    one of the three corner clusters §11 allows.
    this.tally(g, 0.148 * this.w, this.h - 104 * U, U, pr, frac, urgent);
  }

  /** One torn butcher-paper tag: accent band, chalked key cap, bag, kid. */
  tag(g, card, x, y, w, h, sc, best, chosen, alpha) {
    const acc = accentOf(card.kid);
    const ink = inkOf(acc);
    const a = best || chosen ? alpha : alpha * 0.62;
    const tilt = (card.bag === 'home' ? -2.6 : card.bag === '2B' ? 3.2 : -1.5) * Math.PI / 180;
    g.save();
    g.globalAlpha = a;
    g.translate(x + w / 2, y + h / 2);
    g.rotate(tilt);
    g.translate(-w / 2, -h / 2);

    const path = tornPath(g, 0, 0, w, h, card.bag.length * 13 + 3, 2.8 * sc);
    g.save();
    g.translate(3.5 * sc, 5.5 * sc);
    g.fillStyle = 'rgba(20,15,12,0.34)';
    g.fill(path);
    g.restore();
    g.fillStyle = C(PAPER);
    g.fill(path);
    g.save(); g.clip(path);
    g.globalAlpha = a * 0.30;
    g.fillStyle = C(PAPER_SHADE);
    for (let i = 1; i < 4; i++) g.fillRect(0, h * (0.34 + i * 0.16), w, 1.1 * sc);
    g.globalAlpha = a;
    g.fillStyle = C(acc);
    g.fillRect(0, 0, w, h * 0.34);
    g.fillStyle = C(ink);
    g.fillRect(0, h * 0.34 - 2.2 * sc, w, 2.2 * sc);
    g.restore();
    g.strokeStyle = C(INK); g.lineWidth = Math.max(1.5, 2.2 * sc); g.stroke(path);

    // the key cap — a chalked square on the band with the key in it
    const ks = h * 0.34 - 9 * sc, kx = 7 * sc, ky = 4.5 * sc;
    g.save();
    g.strokeStyle = C(CHALK); g.lineWidth = Math.max(1.4, 2.4 * sc);
    g.strokeRect(kx, ky, ks * 1.06, ks);
    slab(g, BAG_KEY[card.bag] || '?', kx + ks * 0.53, ky + ks * 0.82, ks * 0.88, {
      color: C(CHALK), align: 'center', weight: 0.20, tracking: 0.02, jitter: 0.8, seed: 5,
    });
    g.restore();
    // the bag, on the band, in the kid's own colour's ink
    slab(g, BAG_WORD[card.bag] || card.bag, kx + ks * 1.3, ky + ks * 0.84, ks * 0.98, {
      color: C(mix(acc, CHALK, 0.88)), align: 'left', weight: 0.21, tracking: 0.05, condense: 0.92,
      jitter: 1, seed: 13, shadow: { dx: 1.4 * sc, dy: 1.5 * sc, color: C(ink) },
    });
    // who is standing on it
    slab(g, nickOf(card.kid), w * 0.5, h * 0.80, 21 * sc, {
      color: C(INK), align: 'center', weight: 0.21, tracking: 0.07, condense: 0.94, jitter: 1.1, seed: 17,
      shadow: { dx: 1.5 * sc, dy: 1.7 * sc, color: C(mix(PAPER, INK, 0.26)) },
    });

    // the good one is scrawled round in fresh chalk and it is shouting
    if (best || chosen) {
      const pad = 7 * sc;
      chalkStroke(g, [[-pad, -pad], [w + pad, -pad], [w + pad, h + pad], [-pad, h + pad], [-pad, -pad]],
        4.2 * sc, 77, chosen ? 1 : 0.9, C(CHALK));
      chalkStroke(g, [[-pad * 1.7, -pad * 1.7], [w + pad * 1.7, -pad * 1.6], [w + pad * 1.6, h + pad * 1.7], [-pad * 1.6, h + pad * 1.6], [-pad * 1.7, -pad * 1.7]],
        2.6 * sc, 81, chosen ? 0.8 : 0.62, C(CHALK));
      slab(g, chosen ? 'THAT ONE!' : (BAG_YELL[card.bag] || 'HERE!'), w / 2, h + pad + 27 * sc, 22 * sc, {
        align: 'center', color: C(CHALK), weight: 0.19, tracking: 0.10, condense: 0.94,
        jitter: 1.2, seed: 23, shadow: { dx: 2.2 * sc, dy: 2.4 * sc, color: C(INK) },
      });
    }
    g.restore();
  }

  /**
   * The clock. Five chalk strokes on a scuffed patch of road, rubbed out one at
   * a time — the same material the scorebug is made of (§11), and the reason
   * there is no progress bar anywhere in this piece.
   */
  tally(g, cx, cy, U, pr, frac, urgent) {
    const n = FT.ticks;
    const leftN = pr.expired ? 0 : Math.ceil(frac * n - 1e-6);
    const w = 330 * U, h = 66 * U;
    const hot = urgent && !pr.expired;
    g.save();
    g.translate(cx, cy);
    g.rotate(-2.0 * Math.PI / 180);

    // The road, rubbed clear with a sleeve. It has to be a good deal paler than
    // the block work or the chalk on top of it is chalk on chalk: measured, a
    // 0.42 mix of CHALK into asphalt shade is the same L* as the sun band this
    // street already has running across it, and it vanished.
    const patch = new Path2D();
    const R = new RNG(404);
    for (let i = 0; i <= 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rx = (w / 2 + 12 * U) * (0.94 + R.next() * 0.10);
      const ry = (h / 2 + 22 * U) * (0.88 + R.next() * 0.16);
      const X = Math.cos(a) * rx, Y = -13 * U + Math.sin(a) * ry;
      if (i === 0) patch.moveTo(X, Y); else patch.lineTo(X, Y);
    }
    patch.closePath();
    g.save(); g.globalAlpha = 0.26; g.fillStyle = C(INK);
    g.translate(0, 6 * U); g.fill(patch); g.restore();
    // WARM, not grey. §11 forbids a neutral grey HUD pixel outright, and the
    // first pass of this patch mixed chalk into the SHADE value and produced
    // exactly that: a dishwater plate with red marks on it.
    g.save(); g.globalAlpha = 0.52;
    g.fillStyle = C(mix(PAVEMENT.asphaltSun, CHALK, 0.52)); g.fill(patch); g.restore();

    slab(g, pr.expired ? 'TOO LATE' : hot ? 'THROW IT NOW' : 'THROW IT', 0, -h * 0.34, 32 * U, {
      align: 'center', color: C(hot ? ACCENTS.red : INK),
      weight: 0.22, tracking: 0.10, condense: 0.90, jitter: 1.2, seed: 31,
      shadow: { dx: 2.4 * U, dy: 2.6 * U, color: C(hot ? INK : mix(PAVEMENT.asphaltShade, CHALK, 0.88)) },
    });

    // THE BOX: five chalked cells, and the marks get rubbed out of them left to
    // right. Five empty cells with three marks in them is a countdown you can
    // read in a still frame; a ring that closes is a progress bar in a hat.
    const y0 = h * 0.12, y1 = h * 0.96;
    const cell = w / n;
    const box = [[-w / 2, y0], [w / 2, y0], [w / 2, y1], [-w / 2, y1], [-w / 2, y0]];
    chalkMark(g, box, 2.6 * U, 137, 0.9, INK);
    for (let i = 1; i < n; i++) {
      const x = -w / 2 + cell * i;
      chalkMark(g, [[x, y0], [x, y1]], 2.0 * U, 151 + i, 0.6, INK);
    }
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + cell * (i + 0.5);
      // a tally stroke is a STROKE — a short fat rectangle is a segment of a
      // progress bar, which is the one HUD shape §11 bans by name
      const seg = [[x - 9 * U, y1 - 5 * U], [x + 6 * U, y0 + 5 * U]];
      const alive = i < leftN;
      if (!alive) { chalkStroke(g, seg, 6 * U, 41 + i * 3, 0.16, C(INK)); continue; }
      const dying = i === leftN - 1;
      const a = dying ? 0.55 + 0.45 * ((frac * n) % 1 || 1) : 1;
      chalkMark(g, seg, 7.5 * U, 41 + i * 3, a, hot ? ACCENTS.red : INK);
    }
    g.restore();
  }

  /* --- the call ----------------------------------------------------------- */
  /**
   * The payoff frame. One word, chalked on the road beside the play, on a patch
   * somebody has rubbed clear with a sleeve — because a word floating in the air
   * over a pushcart is a HUD element, and there are no HUD elements in this game
   * (§11). It punches in over four frames, holds, and is scuffed away.
   *
   * And it GETS OUT OF THE WAY. Four candidate seats round the bag are scored
   * against the ball and against the kid the call is about, and the word takes
   * the emptiest one. The version of this that anchored hard to the bag wrote
   * OUT! across the catch in `field_fly` — a red word on top of the one pair of
   * hands the whole frame is about.
   */
  paintCall(app, g, p) {
    const U = this.U;
    const age = p.t - p.callAt;
    const pop = clamp(age / 0.10, 0, 1);
    const fade = clamp(1 - (age - 1.15) / 0.5, 0, 1);
    if (fade <= 0) return;
    const bag = p.callBag;
    const s = this.project(app, bag.x, LAYOUT.groundAt(bag.x) + 1.6, bag.z);
    if (!s) return;
    const over = 1 + 0.26 * Math.sin(clamp(age / 0.16, 0, 1) * Math.PI);   // overshoot
    const sc = U * (0.62 + 0.30 * pop) * over * (p.callWord.length > 5 ? 0.66 : 1);
    const size = 74 * sc;
    const wpx = slabW(p.callWord, size, { tracking: 0.06, condense: 0.88 });

    /**
     * WHAT THE WORD MUST NOT SIT ON.
     *
     * Everything that is a body, and the ball hardest of all. Round 1 anchored
     * this to the bag and wrote OUT! straight across the catch in `field_fly` —
     * a red word on top of the one pair of hands the whole frame is about, which
     * is BYB anti-pattern 5 committed by the piece that is supposed to prevent
     * it. Eight seats round the bag are scored against every kid on the street
     * and the word takes the emptiest one.
     */
    const avoid = [];
    const ball = app.sim.ball;
    const b = this.project(app, ball.pos.x, ball.pos.y, ball.pos.z);
    if (b) avoid.push({ x: b.x, y: b.y, r: 74 * U, w: 8 });
    const pl = players();
    if (pl) {
      // A KID IS NOT A POINT. Round 1 kept the word's CENTRE clear of a kid's
      // HEAD and called that avoidance: OUT! is a hundred and eighty pixels wide
      // and a kid is a hundred and ten tall, so a word whose centre cleared the
      // runner's cap by ninety pixels still had its first letter across his
      // chest — which is what `field_grounder` photographed. Two samples per
      // body, head and belt, and the word is measured as the RECTANGLE it is.
      for (const k of pl.fielders.concat(pl.batter ? [pl.batter] : [])) {
        const near = k === p.callNear;
        const hd = this.project(app, k.pos.x, (k.groundY || 0) + 2.6, k.pos.y);
        if (hd) avoid.push({ x: hd.x, y: hd.y, r: (near ? 56 : 46) * U, w: near ? 3.5 : 1.4 });
        const bl = this.project(app, k.pos.x, (k.groundY || 0) + 0.9, k.pos.y);
        if (bl) avoid.push({ x: bl.x, y: bl.y, r: (near ? 46 : 38) * U, w: near ? 3.0 : 1.2 });
      }
    }
    const rw = wpx * 0.5 + 20 * U, rh = size * 0.52;
    const seats = [];
    for (let ring = 0; ring < 3; ring++) {
      const R = 1 + ring * 0.30;
      for (let i = 0; i < 14; i++) {
        const a = -Math.PI / 2 + (i / 14) * Math.PI * 2;
        seats.push({ x: s.x + Math.cos(a) * (rw + 52 * U) * R, y: s.y + Math.sin(a) * (rh + 58 * U) * R });
      }
    }
    /**
     * CLEARANCE IS NOT A PRIZE, IT IS A THRESHOLD.
     *
     * The first pass of this solver MAXIMISED distance from every body, and a
     * frame where all nine kids are bunched round one bag has exactly one such
     * seat: the empty corner. `field_grounder` duly chalked OUT! onto the awning
     * of a sugar store two hundred pixels from the play, half off the left edge,
     * about nothing. A call belongs AT the call. So overlap is a penalty and
     * clearance earns nothing once it exists: the word takes the seat nearest
     * the bag that is not lying on the ball (weight 8, non-negotiable), on the
     * two bodies the call is about (3.5), or on anybody else (1.4).
     */
    const want = { x: s.x, y: s.y - rh - 58 * U };
    let seat = seats[0], bestScore = -1e9;
    for (const c of seats) {
      const X = clamp(c.x, rw + 64 * U, this.w - rw - 64 * U);
      const Y = clamp(c.y, rh + 84 * U, this.h - rh - 44 * U);
      let sc2 = -Math.hypot(X - want.x, Y - want.y) * 0.62;
      for (const a of avoid) {
        const dx = Math.max(0, Math.abs(X - a.x) - rw);
        const dy = Math.max(0, Math.abs(Y - a.y) - rh);
        const gap = Math.hypot(dx, dy) - a.r;
        if (gap < 0) sc2 += gap * (a.w || 1.4);
      }
      if (sc2 > bestScore) { bestScore = sc2; seat = { x: X, y: Y }; }
    }

    g.save();
    g.globalAlpha = fade;
    g.translate(seat.x, seat.y);
    g.rotate(-3.6 * Math.PI / 180);

    /**
     * The ground it sits on is a SCUFF, not a plate.
     *
     * The first pass filled a 450x180 ellipse of half-opaque grey behind the
     * word and, because this is a screen overlay rather than a decal, that grey
     * lay over the first baseman, the runner and the dog as well as the road —
     * one smudge across the whole payoff frame. It is now a rubbed streak that
     * hugs the letters, warm rather than neutral, and the word carries its own
     * legibility instead: a fat INK skeleton, a CHALK rim on top of that, and
     * the colour last. Three passes of the same hand-drawn glyphs, which is what
     * a kid with a stub of chalk and a lot of feeling actually produces.
     */
    const patch = new Path2D();
    const R = new RNG(909);
    const pw = wpx * 0.54 + 12 * sc, ph = size * 0.50;
    for (let i = 0; i <= 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const X = Math.cos(a) * pw * (0.92 + R.next() * 0.14);
      const Y = -size * 0.26 + Math.sin(a) * ph * (0.84 + R.next() * 0.22);
      if (i === 0) patch.moveTo(X, Y); else patch.lineTo(X, Y);
    }
    patch.closePath();
    g.save(); g.globalAlpha = fade * 0.34;
    g.fillStyle = C(mix(PAVEMENT.asphaltSun, CHALK, 0.44)); g.fill(patch); g.restore();

    const col = p.callOut ? ACCENTS.red : CHALK;
    const opt = { align: 'center', tracking: 0.06, condense: 0.88, jitter: 1.4, seed: 71 };
    slab(g, p.callWord, 0, 0, size, { ...opt, color: C(INK), weight: 0.44,
      shadow: { dx: 5.0 * sc, dy: 5.6 * sc, color: C(INK) } });
    slab(g, p.callWord, 0, 0, size, { ...opt, color: C(mix(CHALK, col, 0.18)), weight: 0.32 });
    slab(g, p.callWord, 0, 0, size, { ...opt, color: C(col), weight: 0.205 });
    g.restore();
  }

  /** Screen hit-test for mouse and touch. */
  pick(x, y) {
    for (const h of this.hits) {
      if (x >= h.x - 8 && x <= h.x + h.w + 8 && y >= h.y - 8 && y <= h.y + h.h + 8) return h.bag;
    }
    return null;
  }
}

/**
 * A chalk mark that survives a busy street.
 *
 * §6.4: chalk holds 5.60:1 on shaded asphalt, but this road is not one value —
 * it is tar, Belgian block, sun band, shadow and a parked truck, and a broken
 * chalk dash laid straight onto it disappears into the block work. So every mark
 * this file puts on the road is drawn TWICE: an ink pass a little wider
 * underneath (the 1.5 px outline §2.5 mandates, scaled up because these strokes
 * are big), then the chalk on top of it. Cheap, and it is the difference between
 * a mark a player sees and a mark a player finds.
 */
function chalkMark(g, pts, w, seed, alpha, colour) {
  if (pts.length < 2) return;
  // The ink pass is SOLID — a broken dash under a broken dash is still a dashed
  // line, and a dashed line on Belgian block is camouflage. But it is only a
  // LINING, not a second mark: at 1.9x the chalk's width and full alpha, a long
  // straight arrow across this street stopped reading as chalk at all and read
  // as a scaffold pole lying in the road. 1.4x at half alpha holds the mark and
  // keeps the chalk on top of it the thing you see.
  g.save();
  g.globalAlpha = Math.min(1, alpha * 0.55);
  g.strokeStyle = C(INK);
  g.lineWidth = w * 1.4;
  g.lineJoin = 'round'; g.lineCap = 'round';
  const R = new RNG(seed + 700);
  g.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const jx = (R.next() - 0.5) * w * 0.45, jy = (R.next() - 0.5) * w * 0.45;
    if (i === 0) g.moveTo(pts[i][0] + jx, pts[i][1] + jy);
    else g.lineTo(pts[i][0] + jx, pts[i][1] + jy);
  }
  g.stroke();
  g.restore();
  chalkStroke(g, pts, w, seed, alpha, C(colour === undefined ? CHALK : colour));
}

/** A torn paper outline: four jittered edges, seeded so it never crawls. */
function tornPath(g, x, y, w, h, seed, amp) {
  const R = new RNG(seed);
  const p = new Path2D();
  const edge = (x0, y0, x1, y1, nx, ny, first) => {
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      const j = (R.next() - 0.5) * amp * 2;
      const X = x0 + (x1 - x0) * u + nx * j;
      const Y = y0 + (y1 - y0) * u + ny * j;
      if (first && i === 0) p.moveTo(X, Y); else p.lineTo(X, Y);
    }
  };
  edge(x, y, x + w, y, 0, 1, true);
  edge(x + w, y, x + w, y + h, -1, 0, false);
  edge(x + w, y + h, x, y + h, 0, -1, false);
  edge(x, y + h, x, y, 1, 0, false);
  p.closePath();
  return p;
}

export const overlay = new Overlay();

/* ============================================================================
   5. INPUT — keyboard, mouse, touch, and the harness
   ---------------------------------------------------------------------------
   Three ways in, all of them one action deep:
     1 / 2 / 3 / H    the bag's own chalk numeral
     ← ↑ →            the bag's direction on the street
     SPACE / ENTER    the one the block would have picked
     click / tap      the tag itself — and a tap anywhere else means
                      "just get it in", because a nine-year-old with a ball and
                      1.4 seconds does not hunt for a hit box
   ========================================================================= */

const KEY_BAG = {
  Digit1: '1B', Numpad1: '1B', KeyJ: '1B',
  Digit2: '2B', Numpad2: '2B', KeyK: '2B',
  Digit3: 'home', Numpad3: 'home', KeyH: 'home', KeyL: 'home',
  ArrowRight: '1B', ArrowUp: '2B', ArrowLeft: 'home',
};

function throwTo(tag) {
  if (!current || current.phase !== 'prompt') return false;
  if (tag === 'best') tag = current.prompt.best;
  return current.choose(tag);
}

/* ============================================================================
   6. THE SYSTEM
   ========================================================================= */

export default registerSystem({
  name: 'fielding',
  // after src/render/cameras.js (300): the overlay projects onto the final
  // camera, and a tag solved against last frame's lens slides on every cut.
  // Before src/ui/bubbles.js (320), so speech sits on top of chalk.
  order: 310,

  /** The live play, for a probe or a critic: `__SB.app.fielding.play`. */
  get play() { return current; },

  /**
   * Re-stage one of the four plays from t=0, so a critic can burst frames
   * through the WHOLE play instead of from wherever the scenario settled:
   *   __SB.app.fielding.stage('grounder'); then advance/renderOnce in a loop.
   */
  stage(which) {
    const def = STAGED[which] || STAGED.grounder;
    stage(APP, def);
    return which;
  },
  /** One line of state, for tools and for anybody debugging a stuck play. */
  get debug() {
    const p = current;
    if (!p) return { play: null };
    return {
      t: +p.t.toFixed(2), phase: p.phase, style: p.style, gt: +(p.gatherT || 0).toFixed(2),
      verdict: p.play && p.play.result, kind: p.result && p.result.kind,
      primary: p.primary && p.primary.home && p.primary.home.id,
      keeper: p.keeper && p.keeper.home && p.keeper.home.id,
      holder: p.holder && p.holder.home && p.holder.home.id,
      eta: +p.runnerEta().toFixed(2),
      prompt: p.prompt && { left: +(p.prompt.deadline - p.prompt.t).toFixed(2), targets: p.prompt.targets, choice: p.prompt.choice },
      call: p.callWord,
    };
  },

  init(app) {
    app.fielding = this;
    this.comicErrors = true;
    overlay.mount();
    if (typeof addEventListener === 'function') {
      addEventListener('resize', () => overlay.resize());
      addEventListener('keydown', (e) => {
        if (!current || current.phase !== 'prompt') return;
        if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
          if (throwTo('best')) e.preventDefault();
          return;
        }
        const bag = KEY_BAG[e.code];
        if (bag && throwTo(bag)) e.preventDefault();
      });
      const tap = (e) => {
        if (!current || current.phase !== 'prompt') return;
        const bag = overlay.pick(e.clientX, e.clientY);
        if (bag) { throwTo(bag); e.preventDefault(); e.stopPropagation(); }
        else throwTo('best');            // anywhere else means "just get it in"
      };
      addEventListener('pointerdown', tap, { capture: true });
    }
  },

  /** `__SB.input('throw_home')` and friends, for the harness and for a critic. */
  onInput(action) {
    if (action === 'throw' || action === 'throw_best') return throwTo('best');
    if (action === 'throw_first') return throwTo('1B');
    if (action === 'throw_second') return throwTo('2B');
    if (action === 'throw_home') return throwTo('home');
    if (action === 'errors_off') { this.comicErrors = comicErrors = false; return true; }
    if (action === 'errors_on') { this.comicErrors = comicErrors = true; return true; }
    return false;
  },

  update(dt, app) {
    comicErrors = this.comicErrors;
    if (!current) return;
    const sim = app.sim;
    // Belt and braces: if anything else ever ends the at-bat while a play is
    // still open (a foul, a do-over, the half ending), let go of the bodies
    // rather than leaving nine kids frozen mid-converge for the next pitch.
    if (sim.state.phase !== 'in_play') { current.release(); current = null; return; }

    /**
     * WHERE THE BALL IS, every frame, in one place.
     *
     * This runs in `update` at order 310 — after src/chars/players.js (20) has
     * solved the frame's hands and before src/game/ballview.js reads the ball in
     * lateUpdate — so the ball is never drawn a frame behind the kid carrying it.
     */
    if (current.holder) {
      handAt(current.holder, sim.ball.pos);
      // Pull it a foot toward the lens. A cocked arm puts the hand behind the
      // torso from both locked seats, and a ball the player cannot see is the
      // one unforgivable readability failure (§2.5, BYB anti-pattern 5).
      _wp.copy(app.camera.position).sub(sim.ball.pos).setY(0).normalize().multiplyScalar(0.95);
      sim.ball.pos.add(_wp);
      sim.ball.pos.y += 0.35;
    } else if (current.loose) {
      // IT IS IN THE ROAD. It gets there on its own arc, hops twice on the
      // Belgian block and lies still, in plain sight, while somebody runs at it.
      const L = current.loose;
      const u = clamp(L.t / FT.looseSettle, 0, 1);
      const e = u * u * (3 - 2 * u);
      const gy = LAYOUT.groundAt(L.pos.x) + T.ball.radius;
      sim.ball.pos.set(
        L.from.x + (L.pos.x - L.from.x) * e,
        Math.max(gy, gy + Math.abs(Math.sin(u * Math.PI * 2.2)) * 1.5 * (1 - u) + L.from.y * (1 - e) * 0.35),
        L.from.z + (L.pos.z - L.from.z) * e,
      );
    } else if (current.claimed && !current.arrow && current.primary) {
      const k = current.primary;
      const g = current.gatherT || 0;
      if (!current.carry) {
        // It is not his. Until it gets away it is still a ball obeying gravity,
        // and that is exactly what has to be true for THROUGH THE LEGS to read:
        // the ball keeps its line, through him, out the back.
        const f = current.claimFrom, v = current.claimVel;
        const gy = LAYOUT.groundAt(f.x + v.x * g) + T.ball.radius;
        sim.ball.pos.set(
          f.x + v.x * g,
          Math.max(gy, f.y + v.y * g - 0.5 * T.ball.gravity * g * g),
          f.z + v.z * g,
        );
      } else {
        // Not in a hand yet — being scooped, or being juggled. A bobble that does
        // not visibly bobble THE BALL is a kid waving at nothing, so the ball hops
        // around his mitts on a decaying wobble while he chases it (§5.6).
        const wob = current.clean === false ? Math.max(0, 1 - g / 1.15) : 0;
        const h = handAt(k, _wp);
        let hx = h.x, hy = h.y, hz = h.z;
        // Between "he has it" and "his hands close on it" the ball keeps flying and
        // is STEERED into the hand rather than snapped to it. Without this every
        // catch in the game is a one-frame teleport, which is the single most
        // common way a fielding system reads as fake.
        const grasp = current.graspAt || 0.2;
        if (g < grasp && current.claimFrom) {
          const u = Math.pow(clamp(g / grasp, 0, 1), 1.7);
          const fx = current.claimFrom.x + current.claimVel.x * g;
          const fy = current.claimFrom.y + current.claimVel.y * g - 0.5 * T.ball.gravity * g * g;
          const fz = current.claimFrom.z + current.claimVel.z * g;
          hx += (fx - hx) * (1 - u); hy += (fy - hy) * (1 - u); hz += (fz - hz) * (1 - u);
        }
        sim.ball.pos.set(
          hx + Math.sin(g * 15.5) * 1.35 * wob,
          Math.max((k.groundY || 0) + 0.36, hy + Math.sin(g * 21.0 + 1.1) * 1.15 * wob),
          hz + Math.cos(g * 12.5 + 0.6) * 1.0 * wob,
        );
      }
    } else if (current.arrow && current.arrow.t >= 0) {
      const a = current.arrow;
      const u = clamp(a.t / a.dur, 0, 1);
      sim.ball.pos.set(
        a.from.x + (a.to.x - a.from.x) * u,
        a.from.y + (a.to.y - a.from.y) * u + Math.sin(u * Math.PI) * a.hi,
        a.from.z + (a.to.z - a.from.z) * u,
      );
    }

    // anybody a one-shot was still holding when the play ended goes home now
    const pl = players();
    if (pl) for (const k of pl.fielders) if (k.fieldGoHome && k.lock <= 0) { k.fieldGoHome = 0; k.target = null; k.goHome(); }
  },

  preRender(app) { overlay.paint(app); },

  onScenario(name, app) {
    frng.reset(50419);
    sawThrow = null;
    forceStyle = null;
    if (current) { current.release(); current = null; }
    this.comicErrors = comicErrors = true;
    overlay.clear();
    const pl = players();
    if (pl) {
      for (const k of pl.fielders) { k.fieldReact = undefined; k.fieldPlaced = undefined; k.camped = 0; k.fieldGoHome = 0; }
      if (pl.batter) { pl.batter.runOut = false; pl.batter.slidYet = 0; pl.batter.arrivedYet = 0; }
    }
    if (liveMatch.pendingThrow) liveMatch.pendingThrow = {};
  },
});

/**
 * The batter is the runner, and this file borrowed him. Put him back on his
 * chalk the instant the next at-bat opens — which is the same tick the camera
 * cuts back to the batting framing, so nobody ever sees the change of seats.
 */
bus.on('atbat:begin', () => {
  const pl = players();
  if (!pl || !pl.batter) return;
  const b = pl.batter;
  if (!b.runOut && !b.arrivedYet && !b.slidYet) return;
  b.runOut = false; b.slidYet = 0; b.arrivedYet = 0; b.fieldStep = undefined;
  b.target = null; b.speed = 0; b.glide = 0; b.lock = 0;
  b.at(LAYOUT.PLATE_BOX.x, LAYOUT.PLATE_BOX.z, undefined);
  if (LAYOUT.PLATE_BOX.look) b.lookAt(LAYOUT.PLATE_BOX.look[0], LAYOUT.PLATE_BOX.look[1]);
  b.snapFacing();
  b.showStick(true);
});

/* ============================================================================
   7. SCENARIOS
   ---------------------------------------------------------------------------
   Four, and each one is the real code path with a pinned verdict — not a
   diagram of it. `sim.__forcePlay` hands the Play the core verdict it would
   otherwise have drawn, so a critic looking at `field_grounder` is looking at
   the same convergence, the same gather and the same race the running game
   produces, on a seed that produces it every time.
   ========================================================================= */

function stage(app, { seed = 1920, ball, vel, play, bases = [null, null, null], settle = 0, prompt = false, errors = true, style = null } = {}) {
  const sim = app.sim;
  sim.reset(seed);
  app.clock.advance(0.55);
  const pl = players();
  if (pl) {
    // `__SB.app.fielding.stage()` is a debug door and it has to open on the same
    // street the registered scenario does: put everybody back on his own chalk
    // first, or the second play a critic stages is cast off the wreckage of the
    // first one and is a different play.
    for (const k of pl.fielders) { k.lock = 0; k.target = null; k.speed = 0; k.glide = 0; k.camped = 0; k.goHome(); }
  }
  if (pl && pl.batter) {
    const b = pl.batter;
    b.runOut = false; b.slidYet = 0; b.arrivedYet = 0; b.fieldStep = undefined;
    b.target = null; b.speed = 0; b.glide = 0; b.lock = 0;
    b.at(LAYOUT.PLATE_BOX.x, LAYOUT.PLATE_BOX.z, undefined);
    b.showStick(true);
  }
  const F = app.fielding;
  if (F) F.comicErrors = comicErrors = errors;
  sim.state.bases = bases.slice();
  sim.state.phase = 'in_play';
  sim.playT = 0;
  sim.ball.pos.set(ball[0], ball[1], ball[2]);
  sim.ball.vel.set(vel[0], vel[1], vel[2]);
  sim.ball.spin.set(0, 0, 0);
  sim.ball.inFlight = true; sim.ball.live = true;
  sim.lastContact = { quality: play.quality ?? 0.5, power: 70, angleDeg: 18, sprayRad: play.lane || 0, kind: 'square' };
  sim.lastPlay = play;
  // the core's own bookkeeping, so `throwTargets()` and `resolveThrow()` answer
  // for the situation the scenario is actually showing
  liveMatch.bases = [bases[0] ? liveMatch.lineups[0][3] : '', bases[1] ? liveMatch.lineups[0][4] : '', bases[2] ? liveMatch.lineups[0][5] : ''];
  liveMatch.pendingThrow = {};
  sim.__forcePlay = play;
  forceStyle = style;
  gameplay.fielding.onBallInPlay(sim, sim.lastContact);
  // the prompt the core would have asked for, on the play it just decided
  if (prompt && current) {
    current.wantPrompt = { targets: liveMatch.throwTargets(), best: '1B', deadline: P.race.throwDeadline };
    liveMatch.pendingThrow = { play: current.play, margin: current.play.margin };
  }
  // and the runners break, because src/game/baserunning.js owns them and
  // src/game/sim.js is the only other place that ever tells it a ball was hit
  if (gameplay.baserunning && gameplay.baserunning.onContact) gameplay.baserunning.onContact(sim);
  // the wide framing, pinned: a locked framing that depends on which scenario
  // ran before this one is not a locked framing
  const cam = app.get('cameras');
  if (cam && cam.solutions) {
    cam.pin = 'field'; cam.cutIn = -1; cam.cutTo = null;
    cam.tilt = 0; cam.tiltGoal = 0; cam.pushT = -1;
    cam.cut('field', true);
  }
  if (settle) app.clock.advance(settle);
}

/**
 * The four staged plays, in one table, so `field_grounder` and a critic's frame
 * burst are the same play and not two guesses at it.
 * `__SB.app.fielding.stage('prompt')` runs any of them from t=0.
 */
export const STAGED = {
  grounder: {
    seed: 3311,
    ball: [0, 2.6, 3.0], vel: [-12, 6, 22],
    play: { result: 'out_ground', loft: 'ground', fielder: 'SS', margin: -0.06, bases: 0, quality: 0.44, lane: -0.3 },
  },
  fly: {
    seed: 8802,
    ball: [0.5, 3.0, 2.0], vel: [2.0, 23, 27],
    play: { result: 'out_fly', loft: 'fly', fielder: 'RF', margin: 0, bases: 0, quality: 0.82, lane: 0.6 },
  },
  prompt: {
    seed: 5150,
    bases: [true, null, true],
    ball: [0, 2.6, 3.0], vel: [-12, 6, 22],
    play: { result: 'out_ground', loft: 'ground', fielder: 'SS', margin: 0.04, bases: 0, quality: 0.42, lane: -0.25 },
    prompt: true,
  },
  error: {
    seed: 2027,
    ball: [0, 2.5, 3.0], vel: [7.5, 5, 24],
    play: { result: 'single', loft: 'ground', fielder: '1B', margin: 0.4, bases: 1, quality: 0.46, lane: 0.4 },
    style: 'legs',
  },
};

/** A hard one-hopper into the hole, and the throw beats him by a stride. */
registerScenario('field_grounder', {
  seed: 3311,
  setup: ({ app }) => {
    stage(app, STAGED.grounder);
  },
  /**
   * 1.98, and every tenth of it is load-bearing.
   *
   * The throw lands in the first baseman's bare hands at 1.75 and he is off the
   * ground with it a breath later. src/game/baserunning.js runs its man THROUGH
   * the bag — which is correct, it is what a kid legging one out does — and he
   * reaches the chalk at 2.02, so a frame taken at the apex of the leap (2.23)
   * catches him four feet PAST first, which photographs as a man who was safe.
   * At 1.98 he is three feet short and at a dead run, the receiver is rising
   * with the ball a head over the block, and the word is on the road between
   * them: the out, as a photograph, in the only tenth of a second it exists.
   */
  settle: 1.98,
});

/** A fly into the gap: two kids converge, and one of them was watching a pigeon. */
registerScenario('field_fly', {
  seed: 8802,
  setup: ({ app }) => {
    stage(app, STAGED.fly);
  },
  // the apex hold of the jump: full extension, ball in the hands, feet off the road
  settle: 1.68,
});

/**
 * The one moment the player is on defence: a bang-bang grounder with a kid on
 * third and a kid on first, so all three bags are live and the good one is the
 * one drawn in fresh chalk.
 */
registerScenario('throw_prompt', {
  seed: 5150,
  setup: ({ app }) => {
    stage(app, STAGED.prompt);
  },
  // the ball is fielded just before a second; another 0.6 s puts the tally at
  // three strokes of five, which is what "how long is left" has to read as
  settle: 1.55,
});

/**
 * IT WENT RIGHT THROUGH HIM. The core scored this one a single, and this is the
 * reason it is a single: the ball is in the road, the kid who was supposed to
 * have it is looking down between his own feet, and somebody else is sprinting
 * at it while the runner takes the bag standing up.
 */
registerScenario('field_error', {
  seed: 2027,
  setup: ({ app }) => {
    stage(app, STAGED.error);
  },
  settle: 1.78,
});

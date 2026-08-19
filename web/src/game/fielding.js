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
 * ── the four things this file owns ──────────────────────────────────────────
 *
 * 1. CHASE AND CONVERGE. Nine kids, reaction times that differ by half a second
 *    (one of them is watching a pigeon), a primary, a backup who comes in behind
 *    and to the side, a cut-off man on anything deep, and a kid covering every
 *    bag that is live. Nobody stands still while a ball is live.
 *
 * 2. THE GATHER. The catch, the jump, the dive, the scoop — and the four comic
 *    failures BYB-REFERENCE §5.6 asks for by name: the bobble, the collision,
 *    through the legs, and the one that drops between two kids who both stopped.
 *    Which one plays is chosen so it AGREES with the core: a kid only muffs a
 *    ball the core scored as a hit, and a kid only comes up with one the core
 *    scored as an out. Errors are funny and readable, never punishing, and there
 *    is a volume knob on them (`comicErrors`) exactly as the 1997 options menu had.
 *
 * 3. THE THROW PROMPT. The one moment the player is on defence. The core hands
 *    over `targets`, a best choice and a 1.4 s deadline; this file turns that
 *    into chalk arrows on the road, a torn paper tag over every live bag with
 *    the kid who is standing on it, and a five-stroke chalk tally at the
 *    thrower's feet that scuffs out while you think. Keyboard, mouse and touch.
 *    Letting it run out is a KID HESITATING — he double-clutches, looks at two
 *    bases, and everybody yells at him — not a UI failure.
 *
 * 4. THE RACE. If the core says `out_ground`, the runner must be visibly beaten,
 *    and if it says `single` he must visibly win. The runner's arrival time is
 *    measured, and the throw is released to land on the right side of it. That
 *    is not cheating; that is the difference between a rules engine and a game.
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
import { slab, slabW, chalk } from '../chars/portraits.js';
import { chalkStroke } from '../world/props.js';

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
  react: { keen: 0.07, quick: 0.15, normal: 0.26, dozy: 0.72 },
  dozyOdds: 0.34,              // how often the deep kid is genuinely elsewhere
  chaseSpeed: T.field.speed,   // 16.5 ft/s — a nine-year-old at a dead run
  sprint: 20.5,                // ... and the same kid when it is his ball
  reach: 2.9,                  // he can field it standing here
  diveReach: 6.6,              // ... and here, with his feet off the ground
  gatherY: 5.4,                // a ball above this is a jump, not a pickup
  jumpY: 4.2,
  retarget: 1.1,               // ft the landing spot must move before he re-aims
  relayZ: 38,                  // past this the ball comes in through a cut-off man
  throwSpeed: T.field.throwSpeed,  // 68 ft/s
  throwArc: 0.20,              // fraction of the throw's length spent as lift
  releaseAt: 0.48,             // the `release` event inside CLIPS.throw
  ticks: 5,                    // chalk strokes in the countdown
  beat: 0.9,                   // how long the street reacts before the play closes
  cap: 6.2,                    // hard ceiling on one play (ballphysics caps at 7.5)
  outBy: 0.17,                 // seconds the throw beats the runner by, on an out
  safeBy: 0.30,                // ... and loses by, on a hit
  holdLift: 6.2,               // fake upward speed on a held ball; see hold()
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

/* ============================================================================
   2. THE PLAY
   ---------------------------------------------------------------------------
   One batted ball, from the crack to the call. A small explicit state machine,
   because "the fielders are doing something" is not a state anybody can debug
   at four in the afternoon.

       watch   nobody is getting this one. Turn and look. (sewer shots, glass)
       chase   everybody converges; the ball is still ballphysics'
       gather  a body is on the ball: catch / jump / dive / muff
       prompt  the human picks a bag                      (only if the core asked)
       throw   the ball is in the air, on its way to a bag
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
    this.holdT = 0;
    this.style = '';
    this.spot = new THREE.Vector2(0, 8);
    this.aimed = new THREE.Vector2(-999, -999);
    this.primary = null; this.backup = null; this.relay = null; this.dozy = null;
    this.movers = [];         // every kid this play took control of
    this.runner = null;       // the batter, legging it out
    this.runnerHome = 99;     // play-time at which he touches the bag
    this.arrow = null;        // the live throw {from,to,t,dur,bag,hi}
    this.callWord = null;     // 'OUT!' / 'SAFE!' — the payoff frame
    this.callAt = 0;
    this.closeAt = 99;        // play-time the whole thing hands back
    this.gathered = false;
    this.forced = forced || null;
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

  /* --- 2.2 casting -------------------------------------------------------- */

  /**
   * Who breaks, and how fast. The primary is the nearest body to where the ball
   * is going; the backup comes in BEHIND and to the side (which is where a real
   * backup stands and, on a stage this shallow, the only way two kids on one
   * ball read as two kids); the cut-off man stands between the ball and the
   * plate on anything deep; and one kid per live bag goes and stands on it.
   */
  cast(pl) {
    const spot = this.spot;
    const pool = pl.fielders.filter((f) => f !== pl.catcher);
    const dist = (k) => Math.hypot(k.pos.x - spot.x, k.pos.y - spot.y);
    const ranked = pool.slice().sort((a, b) => dist(a) - dist(b));

    // The core named a position. Where our stage has that kid within shouting
    // distance of the ball, honour it — the announcer is about to say his name.
    let primary = ranked[0];
    const named = this.play && this.play.fielder && CORE_POST[this.play.fielder];
    if (named) {
      const k = pl.fielders.find((f) => f.home && f.home.id === named);
      if (k && k !== pl.catcher && dist(k) < dist(primary) + 13) primary = k;
    }
    this.primary = primary;
    this.backup = ranked.find((k) => k !== primary && k !== pl.pitcher) || null;

    // deep ball: somebody has to turn it round
    if (spot.y > FT.relayZ) {
      this.relay = ranked.find((k) => k !== primary && k !== this.backup && k.pos.y < spot.y - 12)
        || pl.pitcher;
    }

    // THE LITTLE BROTHER. Somebody out there is not paying attention, and on a
    // real block it is always one of the deep kids — the one on the car roof,
    // the one up the far end — because nothing has come to him in twenty minutes.
    // He starts half a second late, and he starts by dropping a pigeon.
    const idle = ['roof', 'center', 'right', 'left']
      .map((id) => pool.find((f) => f.home && f.home.id === id))
      .filter((f) => f && f !== primary && f !== this.backup);
    if (idle.length && frng.chance(FT.dozyOdds)) this.dozy = idle[frng.int(0, idle.length - 1)];

    for (const k of pool) {
      k.fieldReact = k === primary ? FT.react.keen
        : k === this.backup ? FT.react.quick
          : k === this.dozy ? FT.react.dozy : FT.react.normal;
    }
    if (this.dozy && this.dozy.lock <= 0) {
      this.dozy.flavour('fidget_pigeon', { amp: 1, life: 0.9 });
      this.dozy.setFace('squint', 0.9);
    }
    bus.emit('field:break', {
      primary: primary && primary.home && primary.home.id,
      backup: this.backup && this.backup.home && this.backup.home.id,
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
    b.lock = 0;
    b.showStick(false);
    b.setFace('determined', 1.4);
    const to = LAYOUT.FIRST;
    b.goTo(to.x, to.z, { speed: T.run.speed, hard: false });
    bus.emit('bat:drop', { pos: new THREE.Vector3(b.pos.x, 0.3, b.pos.y) });
  }

  /** Seconds until the runner touches first, at the speed he is actually going. */
  runnerEta() {
    const r = this.runner;
    if (!r) return 1.15;
    const d = Math.hypot(LAYOUT.FIRST.x - r.pos.x, LAYOUT.FIRST.z - r.pos.y);
    const v = Math.max(6, r.speed || T.run.speed * 0.8);
    return d / v;
  }

  /* --- 2.3 the tick ------------------------------------------------------- */

  step(dt, sim) {
    this.t += dt;
    const pl = players();
    if (!pl) return this.close();

    switch (this.phase) {
      case 'watch': this.stepWatch(dt, sim, pl); break;
      case 'chase': this.stepChase(dt, sim, pl); break;
      case 'gather': this.stepGather(dt, sim, pl); break;
      case 'prompt': this.stepPrompt(dt, sim, pl); break;
      case 'throw': this.stepThrow(dt, sim, pl); break;
      case 'beat': break;
      default: break;
    }

    if (this.runner && this.runner.runOut) this.stepRunner(dt, pl);
    if (this.callWord) this.scuff = Math.min(1, this.scuff + dt / 1.5);

    if (this.t > FT.cap && this.phase !== 'done') this.close();
    if (this.phase === 'beat' && this.t >= this.closeAt) this.close();
    return this.phase === 'done' ? this.result : null;
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
      k.fieldReact -= dt;
      if (k.fieldReact > 0) continue;
      if (k.fieldWoke === undefined && k === this.dozy) {
        k.fieldWoke = 1;
        k.setFace('shock', 1.1);
        k.flavour('fidget_look', { amp: 1 });
        bus.emit('field:asleep', { kid: k.home && k.home.id });
      }
    }

    // the primary
    const pr = this.primary;
    if (pr && pr.fieldReact <= 0) {
      const to = reachable(pr, this.spot.x, this.spot.y);
      if (Math.hypot(to.x - this.aimed.x, to.z - this.aimed.y) > FT.retarget) {
        this.aimed.set(to.x, to.z);
        pr.goTo(to.x, to.z, { speed: FT.sprint, hard: true });
        this.own(pr);
      }
    }
    // the backup, in behind and to the side
    const bk = this.backup;
    if (bk && bk.fieldReact <= 0 && !bk.fieldPlaced) {
      bk.fieldPlaced = 1;
      const s = Math.sign(this.spot.x || 1);
      const to = reachable(bk, this.spot.x - s * 6.5, this.spot.y + 7.0);
      bk.goTo(to.x, to.z, { speed: FT.chaseSpeed * 0.9 });
      this.own(bk);
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
    const fly = this.play && (this.play.loft === 'fly' || this.play.loft === 'line');
    const out = this.isOut;

    let style;
    if (out) {
      if (high) style = 'jump';
      else if (far) style = 'dive';
      else style = fly ? 'snag' : 'scoop';
    } else if (!comicOn()) {
      style = fly ? 'snag' : 'scoop';
    } else {
      // a hit. WHY was it a hit? pick the funniest true answer.
      const both = this.backup && Math.hypot(this.backup.pos.x - this.spot.x, this.backup.pos.y - this.spot.y) < 11;
      const r = frng.next();
      if (both && r < 0.20) style = 'standoff';
      else if (both && r < 0.32) style = 'pile';
      else if (!fly && r < 0.62) style = 'legs';
      else style = 'bobble';
    }
    this.style = style;
    // From here the ball is spoken for, whether or not it is actually in a hand.
    // A bobbled ball has to keep existing somewhere while it is being bobbled.
    this.claimed = true;
    this.claimAt = new THREE.Vector3(ball.pos.x, Math.max(ball.pos.y, 1.0), ball.pos.z);
    this.claimFrom = ball.pos.clone();
    this.claimVel = ball.vel.clone();
    this.applyStyle(pl, k, style);
  }

  applyStyle(pl, k, style) {
    const ball = this.sim.ball;
    k.target = null;
    k.lookAt(ball.pos.x, ball.pos.z);
    const at = new THREE.Vector3(k.pos.x, (k.groundY || 0) + 0.2, k.pos.y);

    switch (style) {
      case 'jump':
        k.act('jump_catch', { state: 'catch' });
        this.graspAt = 0.40; this.clean = true;
        break;
      case 'dive':
        k.act('dive', { state: 'dive', glide: Math.max(6, k.speed) });
        this.graspAt = 0.40; this.clean = true;
        break;
      case 'snag':
        k.act('ready', { state: 'catch', lock: 0.42 });
        k.flavour('cheer_arms', { life: 0.3, amp: 0.4 });
        this.graspAt = 0.12; this.clean = true;
        break;
      case 'scoop':
        k.act('crouch', { state: 'catch', lock: 0.46 });
        this.graspAt = 0.16; this.clean = true;
        break;

      // ── the four comic failures (BYB §5.6) ──────────────────────────────
      case 'bobble':
        k.act('fumble', { state: 'fumble' });
        this.graspAt = 1.04; this.clean = false;
        bus.emit('field:error', { kind: 'bobble', kid: k.home && k.home.id, pos: at });
        break;
      case 'legs':
        k.act('crouch', { state: 'catch', lock: 0.30, after: (kk) => {
          kk.act('freeze', { state: 'act', lock: 0.34, after: (k3) => {
            k3.lookAt(k3.pos.x, k3.pos.y + 20);
            k3.flavour('fidget_look', { amp: 1 });
          } });
          kk.setFace('shock', 1.3);
        } });
        this.graspAt = 1.22; this.clean = false;
        bus.emit('field:error', { kind: 'through_the_legs', kid: k.home && k.home.id, pos: at });
        break;
      case 'standoff': {
        const o = this.backup;
        k.act('run_stop', { state: 'stop', lock: 0.34 });
        k.setFace('shock', 1.6);
        if (o) {
          o.target = null;
          o.act('run_stop', { state: 'stop', lock: 0.34 });
          o.lookAt(k.pos.x, k.pos.y);
          o.setFace('shock', 1.6);
          k.lookAt(o.pos.x, o.pos.y);
          this.argueAt = 0.9;
        }
        this.graspAt = 1.30; this.clean = false;
        bus.emit('field:error', { kind: 'nobody_called_it', kid: k.home && k.home.id, pos: at });
        break;
      }
      case 'pile': {
        const o = this.backup;
        k.act('dive', { state: 'dive', glide: Math.max(7, k.speed) });
        if (o) {
          o.target = null;
          o.lookAt(k.pos.x, k.pos.y);
          o.act('dive', { state: 'dive', glide: Math.max(7, o.speed) });
          o.setFace('shock', 1.6);
        }
        k.setFace('shock', 1.6);
        this.graspAt = 1.18; this.clean = false;
        bus.emit('field:collide', { kids: [k.home && k.home.id, o && o.home && o.home.id], pos: at });
        break;
      }
      default:
        this.graspAt = 0.2; this.clean = true;
    }
    if (APP.puffs && (style === 'dive' || style === 'pile' || style === 'scoop')) {
      APP.puffs.burst(at, style === 'scoop' ? 5 : 14, style === 'scoop' ? 2.0 : 3.6);
    }
  }

  stepGather(dt, sim, pl) {
    this.gatherT += dt;
    const k = this.primary;
    if (this.argueAt && this.gatherT > this.argueAt) {
      this.argueAt = 0;
      const o = this.backup;
      k.act('argue_jab', { state: 'argue', lock: 1.1 });
      if (o) o.act('argue_appeal', { state: 'argue', lock: 1.1 });
      bus.emit('field:argue', { kids: [k.home && k.home.id, o && o.home && o.home.id] });
    }
    if (this.gatherT < this.graspAt) return;
    if (this.gathered) return;
    this.gathered = true;

    const at = new THREE.Vector3(k.pos.x, (k.groundY || 0) + 2.2, k.pos.y);
    bus.emit('field:catch', { clean: this.clean, pos: at, kid: k.home && k.home.id });
    this.holder = k;

    // A catch is an out and the play is over the moment his hands close. The
    // word goes where the catch was, not where the bag is — a call floating over
    // a bag nobody is looking at is a call about nothing.
    if (this.isOut && this.play && (this.play.result === 'out_fly' || this.play.result === 'out_line')) {
      this.stamp('OUT!', { x: k.pos.x, z: k.pos.y }, true);
      this.celebrate(pl, true);
      this.pullUp();
      return this.beat(FT.beat);
    }

    // Anything else is a race, and somebody has to throw it somewhere.
    if (this.wantPrompt && !this.gone) return this.openPrompt(pl);

    if (this.isOut) return this.startThrow(pl, '1B', true);

    // a hit: get it back in, but too late, and let the runner be safe on camera
    this.stamp('SAFE!', LAYOUT.FIRST, false);
    this.startThrow(pl, this.relay ? 'relay' : '1B', false);
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
    };
    // every live bag gets a body standing on it — that is the read
    for (const tg of targets) {
      const id = BAG_KEEPER[tg];
      const k = id && pl.fielders.find((f) => f.home && f.home.id === id);
      const bag = BAG[tg];
      if (k && k !== this.holder && bag) {
        const to = reachable(k, bag.x, bag.z);
        k.goTo(to.x, to.z, { speed: FT.sprint, hard: true });
        this.own(k);
      }
      this.prompt.cards.push({ bag: tg, kid: id, box: null });
    }
    // the thrower is cocked and looking for somebody
    this.holder.act('throw', { state: 'throw', speed: 0.34, lock: deadline + 0.4 });
    this.holder.setFace('squint', deadline);
    bus.emit('throw:prompt', { targets, best: this.prompt.best, deadline });
  }

  stepPrompt(dt, sim, pl) {
    const pr = this.prompt;
    pr.t += dt;
    pr.pop = Math.max(0, pr.pop - dt * 4);
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
    if (pl) this.startThrow(pl, tag, this.isOut);
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
      k.setFace('shock', 1.6);
    }
    // the block, immediately and at volume
    let yelled = 0;
    for (const f of pl.fielders) {
      if (f === k || f === pl.catcher || yelled >= 3) continue;
      if (f.lock > 0) continue;
      f.lookAt(k ? k.pos.x : 0, k ? k.pos.y : 0);
      f.act(yelled % 2 ? 'argue_appeal' : 'argue_jab', { state: 'argue', lock: 1.2 });
      f.setFace('taunt', 1.6);
      yelled++;
    }
    for (const sp of pl.spectators) if (sp.lock <= 0) sp.flavour('cheer_wave', { life: 1.1, amp: 0.9 });
    this.stamp('HELD IT!', LAYOUT.FIRST, false);
    bus.emit('throw:timeout', {});
    bus.emit('field:hesitate', { kid: k && k.home && k.home.id });
    this.beat(1.25);
  }

  /* --- the throw ---------------------------------------------------------- */

  /**
   * Release the ball so that it lands on the correct side of the runner.
   *
   * The core has already said whether he is out. A throw that arrives whenever
   * the arithmetic of 68 ft/s happens to put it makes a liar of the scoreboard
   * one play in three, so the flight time is solved against the runner's own
   * measured arrival instead, and the release is what gives. That is the whole
   * craft of a sports game: the number is fixed, the picture is negotiable.
   */
  startThrow(pl, tag, out) {
    const k = this.holder;
    const relay = tag === 'relay';
    const target = relay ? this.relay : null;
    const bag = relay ? null : (BAG[tag] || LAYOUT.FIRST);
    const to = relay && target
      ? new THREE.Vector2(target.pos.x, target.pos.y)
      : new THREE.Vector2(bag.x, bag.z);

    const from = handAt(k, new THREE.Vector3()).clone();
    const dist = Math.hypot(to.x - from.x, to.y - from.z);
    const eta = this.runnerEta();
    let dur = dist / FT.throwSpeed;
    if (!relay && (tag === '1B')) {
      const want = out ? eta - FT.outBy : eta + FT.safeBy;
      dur = clamp(want, 0.20, 1.30);
    }
    this.runnerHome = this.t + eta;

    if (k.lock > 0 && k.state !== 'throw') k.lock = 0;
    k.lookAt(to.x, to.y);
    k.act('throw', { state: 'throw', speed: clamp(0.42 / Math.max(0.16, dur), 0.8, 2.2) });
    this.arrow = {
      from, to: new THREE.Vector3(to.x, LAYOUT.groundAt(to.x) + 2.4, to.y),
      t: -FT.releaseAt * (1.1 / clamp(0.42 / Math.max(0.16, dur), 0.8, 2.2)) * 0.55,
      dur, tag, relay, hi: dist * FT.throwArc + 1.4,
    };
    this.phase = 'throw';
    bus.emit('field:throw', { from: tag, to: relay ? 'relay' : tag, kid: k.home && k.home.id, dur });
  }

  stepThrow(dt, sim, pl) {
    const a = this.arrow;
    if (!a) return this.beat(0.4);
    a.t += dt;
    if (a.t < 0) return;                       // still winding up
    if (this.holder) { this.holder.throwing = false; }
    this.holder = null;                        // it is out of his hand now
    if (a.t >= a.dur) {
      this.landThrow(pl, a);
      return;
    }
  }

  landThrow(pl, a) {
    const sim = this.sim;
    sim.ball.pos.set(a.to.x, a.to.y, a.to.z);
    const at = a.to.clone();

    if (a.relay && this.relay) {
      // the cut-off man turns and fires it in — the second half of a relay
      this.holder = this.relay;
      this.relay.lookAt(LAYOUT.HOME.x, LAYOUT.HOME.z);
      bus.emit('field:catch', { clean: true, pos: at, kid: this.relay.home && this.relay.home.id });
      this.arrow = null;
      this.relay = null;
      return this.startThrow(pl, '1B', false);
    }

    const keeper = pl.fielders.find((f) => f.home && f.home.id === BAG_KEEPER[a.tag]);
    if (keeper) {
      keeper.target = null;
      keeper.act('ready', { state: 'catch', lock: 0.5 });
      keeper.setFace(this.isOut ? 'grin' : 'shock', 1.5);
      this.holder = keeper;
    }
    bus.emit('field:catch', { clean: true, pos: at, kid: keeper && keeper.home && keeper.home.id });
    bus.emit('field:tag', { bag: a.tag, out: this.isOut });

    if (!this.callWord) this.stamp(this.isOut ? 'OUT!' : 'SAFE!', BAG[a.tag] || LAYOUT.FIRST, this.isOut);
    this.celebrate(pl, this.isOut);
    this.beat(FT.beat);
  }

  /* --- runner, call, reaction --------------------------------------------- */

  stepRunner(dt, pl) {
    const r = this.runner;
    const d = Math.hypot(LAYOUT.FIRST.x - r.pos.x, LAYOUT.FIRST.z - r.pos.y);
    if (r.fieldStep === undefined) r.fieldStep = 0;
    r.fieldStep += r.speed * dt;
    if (r.fieldStep > 5.4) {
      r.fieldStep = 0;
      bus.emit('run:step', { pos: new THREE.Vector3(r.pos.x, 0.2, r.pos.y), surface: 'street', pitch: frng.range(0, 0.25) });
    }
    // He goes in head first only when there is a throw to beat. Sliding into a
    // bag on a caught fly ball is a kid who has not looked up, and it reads as a
    // bug rather than as a joke.
    if (d < 7.5 && !r.slidYet && this.isOut && this.arrow) {
      r.slidYet = 1;
      r.act('slide', { state: 'slide', glide: Math.max(9, r.speed) });
      bus.emit('run:slide', { pos: new THREE.Vector3(r.pos.x, 0.2, r.pos.y) });
    }
    if (d < 2.0 && !r.arrivedYet) {
      r.arrivedYet = 1;
      r.runOut = false;
      r.target = null;
      if (!this.isOut) { r.act('cheer_arms', { state: 'cheer', lock: 1.2 }); r.setFace('grin', 1.6); }
      else r.setFace('shock', 1.4);
    }
  }

  /** Caught. He pulls up half way down the line and kicks the road. */
  pullUp() {
    const r = this.runner;
    if (!r || !r.runOut) return;
    r.runOut = false;
    r.target = null;
    r.act('run_stop', { state: 'stop', lock: 0.5, after: (k) => k.act('sulk', { state: 'sulk', lock: 1.4 }) });
    r.setFace('sulk', 2.0);
  }

  /** The payoff frame: one word, chalked on the road at the bag. */
  stamp(word, bag, out) {
    this.callWord = word;
    this.callOut = !!out;
    this.callBag = bag || LAYOUT.FIRST;
    this.callAt = this.t;
    this.scuff = 0;
    bus.emit('field:call', { word, out: !!out });
  }

  celebrate(pl, good) {
    let n = 0;
    for (const f of pl.fielders) {
      if (f === pl.catcher || f.lock > 0.4) continue;
      f.setFace(good ? 'grin' : 'sulk', 1.6);
      if (good && n < 3 && frng.chance(0.55)) { f.flavour('cheer_arms', { life: 0.9, amp: 0.6 }); n++; }
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
      k.fieldReact = undefined; k.fieldPlaced = undefined; k.fieldWoke = undefined;
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

/* ============================================================================
   3. THE SLOT
   ---------------------------------------------------------------------------
   src/game/sim.js calls exactly two things on this piece.
   ========================================================================= */

let sawThrow = null;
bus.on('street:throw', (p) => { sawThrow = p || {}; });

let current = null;
let comicErrors = true;
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
        f.setFace('shock', 1.6);
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
    const mine = current.claimed || current.holder || current.arrow;
    if (!mine && current.phase !== 'done') {
      const dead = bp && bp.settled ? bp.settled(sim.ball, sim) : sim.playT > 2.4;
      if (dead) current.close();
    }

    const out = current.step(dt, sim);

    // The fake upward speed is not decoration: src/game/ballphysics.js declares a
    // ball "settled" after 0.30 s under 4 ft/s, and a settled ball makes
    // src/game/sim.js resolve the play out from under this file with the
    // placeholder verdict in defaults.js. Keeping a ball that is in somebody's
    // hands nominally alive — and pointed at the sky, where there is nothing to
    // collide with — is the cheapest honest way to say "this one is spoken for".
    if (current.claimed || current.holder) sim.ball.vel.set(0, FT.holdLift, 0);
    else if (current.arrow && current.arrow.t >= 0) {
      const a = current.arrow;
      sim.ball.vel.set((a.to.x - a.from.x) / a.dur, 0, (a.to.z - a.from.z) / a.dur);
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

  paint(app) {
    const p = current;
    this.mount(); this.resize();
    if (!this.g) return;
    this.clear();
    if (!p) return;
    const g = this.g;
    g.save();
    if (p.phase === 'prompt' || (p.prompt && p.prompt.expired && p.phase === 'beat')) this.paintPrompt(app, g, p);
    if (p.callWord) this.paintCall(app, g, p);
    g.restore();
  }

  /* --- the prompt --------------------------------------------------------- */
  /**
   * The prompt, in three reads, in this order of priority:
   *
   *   WHICH BAGS ARE LIVE   a chalk ring on each one and a torn paper tag over it
   *   WHICH IS THE GOOD ONE the good one is fresh chalk, big, ringed and shouting;
   *                         the others are last week's chalk
   *   HOW LONG IS LEFT      five chalk strokes at the thrower's feet, rubbed out
   *                         one at a time
   */
  paintPrompt(app, g, p) {
    const pr = p.prompt;
    const U = this.U;
    const k = p.holder || p.primary;
    if (!k) return;
    const foot = this.project(app, k.pos.x, (k.groundY || 0) + 0.06, k.pos.y);
    const left = Math.max(0, pr.deadline - pr.t);
    const frac = clamp(left / pr.deadline, 0, 1);
    const urgent = frac < 0.42;
    const ball = app.sim.ball;
    const bp = this.project(app, ball.pos.x, ball.pos.y, ball.pos.z);

    // 1. the road: a chalk ring on every live bag, and an arrow to the good one
    for (const card of pr.cards) {
      const bag = BAG[card.bag];
      if (!bag) continue;
      const best = card.bag === pr.best;
      const chosen = pr.choice === card.bag;
      const lit = best || chosen;
      const al = (chosen ? 1 : best ? 0.90 : 0.34) * (pr.expired ? 0.35 : 1);

      // the ring, drawn as a circle of world radius 3 on the road
      const ring = [];
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const s = this.project(app, bag.x + Math.cos(a) * 3.0, LAYOUT.groundAt(bag.x) + 0.05, bag.z + Math.sin(a) * 3.0);
        if (s) ring.push([s.x, s.y]);
      }
      if (ring.length > 3) chalkMark(g, ring, (lit ? 5.8 : 3.4) * U, 19 + card.bag.length, al);

      // an arrow to every live bag — that is the picture of "which ones count",
      // and a label alone is a list rather than a play
      const pts = [];
      for (let i = 1; i <= 7; i++) {
        const u = 0.10 + (i / 7) * 0.78;
        const x = k.pos.x + (bag.x - k.pos.x) * u;
        const z = k.pos.y + (bag.z - k.pos.y) * u;
        const s = this.project(app, x, LAYOUT.groundAt(x) + 0.05, z);
        if (s) pts.push([s.x, s.y]);
      }
      if (pts.length < 2) continue;
      const aw = (lit ? 7.4 : 4.0) * U;
      chalkMark(g, pts, aw, 37 + card.bag.length, al * 0.95);
      const a = pts[pts.length - 1], b = pts[pts.length - 2];
      const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
      const L = (lit ? 27 : 17) * U;
      for (const sgn of [0.62, -0.62]) {
        chalkMark(g, [[a[0] - Math.cos(ang + sgn) * L, a[1] - Math.sin(ang + sgn) * L], [a[0], a[1]]],
          aw, 63 + Math.round(sgn * 10) + card.bag.length, al);
      }
    }

    // 1b. a ring round the boy with the ball. Three tags and two arrows do not
    //     say WHO is deciding, and on a street with nine kids on it that is the
    //     first thing a player has to find.
    const me = [];
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const s = this.project(app, k.pos.x + Math.cos(a) * 2.6, (k.groundY || 0) + 0.05, k.pos.y + Math.sin(a) * 2.6);
      if (s) me.push([s.x, s.y]);
    }
    if (me.length > 3) chalkMark(g, me, 6.0 * U, 97, pr.expired ? 0.35 : 0.95, urgent ? ACCENTS.red : CHALK);

    // 2. the tags. Solved so no two of them touch and none of them sits on the
    //    ball — a UI element covering the ball is the one unforgivable one.
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
      const sc = (best ? 1.34 : 0.90) * U * (pr.choice === card.bag ? 1 + pr.pop * 0.10 : 1);
      const w = 130 * sc, h = 66 * sc;
      boxes.push({ card, best, sc, w, h, x: s.x - w / 2, y: s.y - h - 104 * U });
    }
    boxes.sort((A, B) => A.y - B.y);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      b.x = clamp(b.x, 10 * U, this.w - b.w - 10 * U);
      b.y = clamp(b.y, 74 * U, this.h - b.h - 96 * U);
      // clear of the ball
      if (bp && bp.x > b.x - 40 * U && bp.x < b.x + b.w + 40 * U
          && bp.y > b.y - 26 * U && bp.y < b.y + b.h + 26 * U) {
        b.y = clamp(bp.y - b.h - 44 * U, 74 * U, this.h - b.h - 96 * U);
      }
      // clear of each other
      for (let j = 0; j < i; j++) {
        const o = boxes[j];
        if (b.x < o.x + o.w + 8 * U && b.x + b.w + 8 * U > o.x
            && b.y < o.y + o.h + 10 * U && b.y + b.h + 10 * U > o.y) {
          b.y = o.y + o.h + 14 * U;
        }
      }
    }
    this.hits = [];
    for (const b of boxes) {
      b.card.box = { x: b.x, y: b.y, w: b.w, h: b.h };
      this.hits.push({ bag: b.card.bag, x: b.x, y: b.y, w: b.w, h: b.h });
      this.tag(g, b.card, b.x, b.y, b.w, b.h, b.sc, b.best, pr.choice === b.card.bag, pr.expired ? 0.34 : 1);
    }

    // 3. the clock.
    //    It used to sit at the thrower's feet, which was diegetically neat and
    //    practically useless: on a stage this shallow his feet are usually on top
    //    of the catcher, and a countdown you have to hunt for is not a countdown.
    //    The ring round HIM says who; this says how long, chalked on the flags at
    //    the bottom of the frame where a kid would actually chalk something, in
    //    one of the three corner clusters §11 allows.
    void foot;
    this.tally(g, 0.215 * this.w, this.h - 122 * U, U, pr, frac, urgent);
  }

  /** One torn butcher-paper tag: accent band, chalked key cap, bag, kid. */
  tag(g, card, x, y, w, h, sc, best, chosen, alpha) {
    const acc = accentOf(card.kid);
    const ink = inkOf(acc);
    const tilt = (card.bag === 'home' ? -2.6 : card.bag === '2B' ? 3.2 : -1.5) * Math.PI / 180;
    g.save();
    g.globalAlpha = alpha;
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
    g.globalAlpha = alpha * 0.30;
    g.fillStyle = C(PAPER_SHADE);
    for (let i = 1; i < 4; i++) g.fillRect(0, h * (0.34 + i * 0.16), w, 1.1 * sc);
    g.globalAlpha = alpha;
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
        4.0 * sc, 77, chosen ? 1 : 0.86, C(CHALK));
      slab(g, chosen ? 'THAT ONE!' : (BAG_YELL[card.bag] || 'HERE!'), w / 2, h + pad + 24 * sc, 21 * sc, {
        align: 'center', color: C(CHALK), weight: 0.19, tracking: 0.10, condense: 0.94,
        jitter: 1.2, seed: 23, shadow: { dx: 2.2 * sc, dy: 2.4 * sc, color: C(INK) },
      });
    }
    g.restore();
  }

  /**
   * The clock. Five chalk strokes on a scuffed patch of road at the thrower's
   * feet, rubbed out one at a time — the same material the scorebug is made of
   * (§11), and the reason there is no progress bar anywhere in this piece.
   */
  tally(g, cx, cy, U, pr, frac, urgent) {
    const n = FT.ticks;
    const leftN = pr.expired ? 0 : Math.ceil(frac * n - 1e-6);
    const w = 296 * U, h = 60 * U;
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
      const rx = (w / 2 + 13 * U) * (0.92 + R.next() * 0.12);
      const ry = (h / 2 + 25 * U) * (0.86 + R.next() * 0.20);
      const X = Math.cos(a) * rx, Y = -13 * U + Math.sin(a) * ry;
      if (i === 0) patch.moveTo(X, Y); else patch.lineTo(X, Y);
    }
    patch.closePath();
    g.save(); g.globalAlpha = 0.36; g.fillStyle = C(INK);
    g.translate(0, 6 * U); g.fill(patch); g.restore();
    g.save(); g.globalAlpha = 0.58;
    g.fillStyle = C(mix(PAVEMENT.asphaltShade, CHALK, 0.58)); g.fill(patch); g.restore();

    slab(g, pr.expired ? 'TOO LATE' : 'THROW IT', 0, -h * 0.36, 30 * U, {
      align: 'center', color: C(hot ? ACCENTS.red : INK),
      weight: 0.21, tracking: 0.10, condense: 0.92, jitter: 1.2, seed: 31,
      shadow: { dx: 2.4 * U, dy: 2.6 * U, color: C(hot ? INK : mix(PAVEMENT.asphaltShade, CHALK, 0.86)) },
    });

    // THE BOX: five chalked cells, and the marks get rubbed out of them left to
    // right. Five empty cells with three marks in them is a countdown you can
    // read in a still frame; a ring that closes is a progress bar in a hat.
    const y0 = h * 0.10, y1 = h * 0.92;
    const cell = w / n;
    const box = [[-w / 2, y0], [w / 2, y0], [w / 2, y1], [-w / 2, y1], [-w / 2, y0]];
    chalkMark(g, box, 3.6 * U, 137, 0.95, INK);
    for (let i = 1; i < n; i++) {
      const x = -w / 2 + cell * i;
      chalkMark(g, [[x, y0], [x, y1]], 2.6 * U, 151 + i, 0.72, INK);
    }
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + cell * (i + 0.5);
      const seg = [[x - 5 * U, y0 + 7 * U], [x + 5 * U, y1 - 7 * U]];
      const alive = i < leftN;
      if (!alive) { chalkStroke(g, seg, 8 * U, 41 + i * 3, 0.20, C(INK)); continue; }
      const dying = i === leftN - 1;
      const a = dying ? 0.55 + 0.45 * ((frac * n) % 1 || 1) : 1;
      chalkMark(g, seg, 11 * U, 41 + i * 3, a, hot ? ACCENTS.red : INK);
    }
    g.restore();
  }

  /* --- the call ----------------------------------------------------------- */
  /**
   * The payoff frame. One word, chalked on the road beside the bag, on a patch
   * somebody has rubbed clear with a sleeve — because a word floating in the air
   * over a pushcart is a HUD element, and there are no HUD elements in this game
   * (§11). It punches in over four frames, holds, and is scuffed away.
   */
  paintCall(app, g, p) {
    const U = this.U;
    const age = p.t - p.callAt;
    const pop = clamp(age / 0.10, 0, 1);
    const fade = clamp(1 - (age - 0.95) / 0.5, 0, 1);
    if (fade <= 0) return;
    const bag = p.callBag;
    const s = this.project(app, bag.x, LAYOUT.groundAt(bag.x) + 1.6, bag.z);
    if (!s) return;
    const over = 1 + 0.24 * Math.sin(clamp(age / 0.16, 0, 1) * Math.PI);   // overshoot
    const sc = U * (0.62 + 0.30 * pop) * over * (p.callWord.length > 5 ? 0.70 : 1);
    const size = 82 * sc;
    const wpx = slabW(p.callWord, size, { tracking: 0.06, condense: 0.88 });
    g.save();
    g.globalAlpha = fade;
    g.translate(clamp(s.x, wpx * 0.5 + 26 * U, this.w - wpx * 0.5 - 26 * U),
      clamp(s.y, 96 * U, this.h - 56 * U));
    g.rotate(-3.6 * Math.PI / 180);

    // the rubbed patch, with an ink shadow so it lifts off the block work
    const patch = new Path2D();
    const R = new RNG(909);
    const rw = wpx * 0.62 + 26 * sc, rh = size * 0.78;
    for (let i = 0; i <= 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const X = Math.cos(a) * rw * (0.88 + R.next() * 0.20);
      const Y = -size * 0.28 + Math.sin(a) * rh * (0.80 + R.next() * 0.30);
      if (i === 0) patch.moveTo(X, Y); else patch.lineTo(X, Y);
    }
    patch.closePath();
    g.save(); g.globalAlpha = fade * 0.32; g.fillStyle = C(INK);
    g.translate(0, 5 * U); g.fill(patch); g.restore();
    g.save(); g.globalAlpha = fade * 0.52;
    g.fillStyle = C(mix(PAVEMENT.asphaltShade, CHALK, 0.46)); g.fill(patch); g.restore();

    const col = p.callOut ? ACCENTS.red : CHALK;
    slab(g, p.callWord, 0, 0, size, {
      color: C(col), align: 'center', weight: 0.215, tracking: 0.06, condense: 0.88,
      jitter: 1.4, seed: 71, shadow: { dx: 5.0 * sc, dy: 5.6 * sc, color: C(INK) },
    });
    g.restore();
  }

  /** Screen hit-test for mouse and touch. */
  pick(x, y) {
    for (const h of this.hits) {
      if (x >= h.x - 6 && x <= h.x + h.w + 6 && y >= h.y - 6 && y <= h.y + h.h + 6) return h.bag;
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
  // the ink pass is SOLID — a broken dash under a broken dash is still a dashed
  // line, and a dashed line on Belgian block is camouflage
  g.save();
  g.globalAlpha = Math.min(1, alpha * 0.86);
  g.strokeStyle = C(INK);
  g.lineWidth = w * 1.9;
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
     click / tap      the tag itself
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
   * Re-stage one of the three plays from t=0, so a critic can burst frames
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
      holder: p.holder && p.holder.home && p.holder.home.id,
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

    // Glue the ball to the hand that is holding it. This runs in `update` at
    // order 310 — after src/chars/players.js (20) has solved the frame's hands
    // and before src/game/ballview.js reads the ball in lateUpdate — so the ball
    // is never drawn a frame behind the kid carrying it.
    if (current.holder) {
      handAt(current.holder, sim.ball.pos);
      // Pull it a foot toward the lens. A cocked arm puts the hand behind the
      // torso from both locked seats, and a ball the player cannot see is the
      // one unforgivable readability failure (§2.5, BYB anti-pattern 5).
      _wp.copy(app.camera.position).sub(sim.ball.pos).setY(0).normalize().multiplyScalar(0.95);
      sim.ball.pos.add(_wp);
      sim.ball.pos.y += 0.35;
      sim.ball.vel.set(0, FT.holdLift, 0);
    } else if (current.claimed && !current.arrow && current.primary) {
      // Not in a hand yet — being scooped, or being juggled. A bobble that does
      // not visibly bobble THE BALL is a kid waving at nothing, so the ball hops
      // around his mitts on a decaying wobble while he chases it (§5.6).
      const k = current.primary;
      const g = current.gatherT || 0;
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
      sim.ball.vel.set(0, FT.holdLift, 0);
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
    if (current) { current.release(); current = null; }
    this.comicErrors = comicErrors = true;
    overlay.clear();
    const pl = players();
    if (pl) {
      for (const k of pl.fielders) { k.fieldReact = undefined; k.fieldPlaced = undefined; k.fieldWoke = undefined; k.fieldGoHome = 0; }
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
  b.target = null; b.speed = 0;
  b.at(LAYOUT.PLATE_BOX.x, LAYOUT.PLATE_BOX.z, undefined);
  if (LAYOUT.PLATE_BOX.look) b.lookAt(LAYOUT.PLATE_BOX.look[0], LAYOUT.PLATE_BOX.look[1]);
  b.snapFacing();
  b.showStick(true);
});

/* ============================================================================
   7. SCENARIOS
   ---------------------------------------------------------------------------
   Three, and each one is the real code path with a pinned verdict — not a
   diagram of it. `sim.__forcePlay` hands the Play the core verdict it would
   otherwise have drawn, so a critic looking at `field_grounder` is looking at
   the same convergence, the same gather and the same race the running game
   produces, on a seed that produces it every time.
   ========================================================================= */

function stage(app, { seed = 1920, ball, vel, play, bases = [null, null, null], settle = 0, prompt = false } = {}) {
  const sim = app.sim;
  sim.reset(seed);
  app.clock.advance(0.55);
  sim.state.bases = bases.slice();
  sim.state.phase = 'in_play';
  sim.playT = 0;
  sim.ball.pos.set(ball[0], ball[1], ball[2]);
  sim.ball.vel.set(vel[0], vel[1], vel[2]);
  sim.ball.spin.set(0, 0, 0);
  sim.ball.inFlight = true; sim.ball.live = true;
  sim.lastContact = { quality: play.quality ?? 0.5, power: 70, angleDeg: 18, sprayRad: play.lane || 0, kind: 'square' };
  // the core's own bookkeeping, so `throwTargets()` and `resolveThrow()` answer
  // for the situation the scenario is actually showing
  liveMatch.bases = [bases[0] ? liveMatch.lineups[0][3] : '', bases[1] ? liveMatch.lineups[0][4] : '', bases[2] ? liveMatch.lineups[0][5] : ''];
  liveMatch.pendingThrow = {};
  sim.__forcePlay = play;
  gameplay.fielding.onBallInPlay(sim, sim.lastContact);
  // the prompt the core would have asked for, on the play it just decided
  if (prompt && current) {
    current.wantPrompt = { targets: liveMatch.throwTargets(), best: '1B', deadline: P.race.throwDeadline };
    liveMatch.pendingThrow = { play: current.play, margin: current.play.margin };
  }
  if (settle) app.clock.advance(settle);
}

/**
 * The three staged plays, in one table, so `field_grounder` and a critic's frame
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
};

/** A hard one-hopper into the hole, and the throw beats him by a stride. */
registerScenario('field_grounder', {
  seed: 3311,
  setup: ({ app }) => {
    stage(app, STAGED.grounder);
  },
  // the throw has landed, the word is on the road and the runner is on his hip
  settle: 2.18,
});

/** A fly into the gap: two kids converge, and one of them was watching a pigeon. */
registerScenario('field_fly', {
  seed: 8802,
  setup: ({ app }) => {
    stage(app, STAGED.fly);
  },
  // the apex hold of the jump: full extension, ball in the hands, feet off the road
  settle: 1.80,
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

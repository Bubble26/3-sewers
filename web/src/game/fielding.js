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

const nickOf = (kidId) => { const k = getKid(kidId); return (k && k.nick) || 'THE KID'; };
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

    // the little brother in right field, who is not paying attention
    const deep = ranked[ranked.length - 1];
    if (deep && deep !== primary && frng.chance(FT.dozyOdds)) this.dozy = deep;

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
    if ((low && d < FT.reach) || (low && slow && d < FT.reach * 1.9) || this.t > 3.1) {
      this.gather(pl, d);
    }
  }

  /** Follow the ball's own predicted landing point; that is what a kid reads. */
  aim(sim) {
    const bp = gameplay.ballphysics;
    let x = sim.ball.pos.x, z = sim.ball.pos.z;
    const pred = bp && bp.predict && bp.predict();
    if (pred) { x = pred.x; z = pred.z; }
    else {
      const g = T.ball.gravity;
      const vy = sim.ball.vel.y, y = Math.max(sim.ball.pos.y, 0.2);
      const tf = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * y))) / g;
      x += sim.ball.vel.x * tf; z += sim.ball.vel.z * tf;
    }
    this.spot.set(x, z);
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

    // A catch is an out and the play is over the moment his hands close.
    if (this.isOut && this.play && (this.play.result === 'out_fly' || this.play.result === 'out_line')) {
      this.stamp('OUT!', BAG.home, true);
      this.celebrate(pl, true);
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
    if (d < 7.5 && !r.slidYet && this.isOut) {
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
    const out = current.step(dt, sim);

    // Hold the ball, if somebody has it. The fake upward speed is not decoration:
    // src/game/ballphysics.js declares a ball "settled" after 0.30 s under
    // 4 ft/s, and a settled ball makes src/game/sim.js resolve the play out from
    // under this file with the placeholder verdict in defaults.js. Keeping it
    // nominally alive (and pointed at the sky, so it never finds a collider) is
    // the cheapest way to say "this ball is in a hand, not on the road".
    if (current.holder && current.phase !== 'throw') {
      sim.ball.vel.set(0, FT.holdLift, 0);
    } else if (current.arrow && current.arrow.t >= 0) {
      const a = current.arrow;
      const u = clamp(a.t / a.dur, 0, 1);
      sim.ball.vel.set((a.to.x - a.from.x) / a.dur, 0, (a.to.z - a.from.z) / a.dur);
      void u;
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
  paintPrompt(app, g, p) {
    const pr = p.prompt;
    const U = this.U;
    const k = p.holder;
    const foot = k ? this.project(app, k.pos.x, (k.groundY || 0) + 0.06, k.pos.y) : null;
    const hand = k ? this.project(app, k.pos.x, (k.groundY || 0) + 2.6, k.pos.y) : null;
    const left = Math.max(0, pr.deadline - pr.t);
    const frac = clamp(left / pr.deadline, 0, 1);

    // 1. the chalk arrows, drawn on the road in world space
    for (const card of pr.cards) {
      const bag = BAG[card.bag];
      if (!bag || !hand) continue;
      const best = card.bag === pr.best;
      const chosen = pr.choice === card.bag;
      const pts = [];
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = (k.pos.x) + (bag.x - k.pos.x) * u;
        const z = (k.pos.y) + (bag.z - k.pos.y) * u;
        const s = this.project(app, x, LAYOUT.groundAt(x) + 0.05, z);
        if (s) pts.push([s.x, s.y]);
      }
      if (pts.length < 2) continue;
      const w = (best || chosen ? 5.6 : 3.0) * U;
      const al = chosen ? 0.98 : best ? 0.86 : 0.30;
      chalkStroke(g, pts, w, 31 + card.bag.length * 7, al * (0.55 + 0.45 * frac), C(CHALK));
      // an arrowhead, two strokes, at the bag end
      const a = pts[pts.length - 1], b = pts[Math.max(0, pts.length - 2)];
      const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
      const L = 16 * U * (best ? 1.25 : 1);
      for (const s of [0.62, -0.62]) {
        chalkStroke(g, [[a[0], a[1]], [a[0] - Math.cos(ang + s) * L, a[1] - Math.sin(ang + s) * L]],
          w, 61 + Math.round(s * 10), al, C(CHALK));
      }
    }

    // 2. the tags, one per live bag
    this.hits = [];
    for (const card of pr.cards) {
      const bag = BAG[card.bag];
      if (!bag) continue;
      const s = this.project(app, bag.x, LAYOUT.groundAt(bag.x) + 5.4, bag.z);
      if (!s) continue;
      const best = card.bag === pr.best;
      const chosen = pr.choice === card.bag;
      const sc = (best ? 1.16 : 1.0) * (chosen ? 1.0 + pr.pop * 0.12 : 1) * U;
      const w = 176 * sc, h = 92 * sc;
      const x = clamp(s.x - w / 2, 8 * U, this.w - w - 8 * U);
      const y = clamp(s.y - h - 10 * U, 8 * U, this.h - h - 8 * U);
      card.box = { x, y, w, h };
      this.hits.push({ bag: card.bag, x, y, w, h });
      this.tag(g, card, x, y, w, h, sc, best, chosen, pr.expired ? 0.3 : 1);
    }

    // 3. the countdown, chalked on the road at his feet
    if (foot) this.tally(g, foot.x, foot.y + 26 * U, U, pr, frac);
  }

  /** One torn butcher-paper tag: accent band, key cap, bag name, kid's name. */
  tag(g, card, x, y, w, h, sc, best, chosen, alpha) {
    const U = this.U;
    const acc = accentOf(card.kid);
    const ink = inkOf(acc);
    const tilt = (card.bag === 'home' ? -2.4 : card.bag === '2B' ? 3.1 : -1.6) * Math.PI / 180;
    g.save();
    g.globalAlpha = alpha;
    g.translate(x + w / 2, y + h / 2);
    g.rotate(tilt);
    g.translate(-w / 2, -h / 2);

    // torn edge
    const path = tornPath(g, 0, 0, w, h, card.bag.length * 13 + 3, 3.4 * sc);
    g.save();
    g.translate(3 * sc, 5 * sc);
    g.fillStyle = 'rgba(24,18,14,0.30)';
    g.fill(path);
    g.restore();
    g.fillStyle = C(PAPER);
    g.fill(path);
    // a printed rule down the paper, so it reads as paper and not as a card
    g.save(); g.clip(path);
    g.fillStyle = C(PAPER_SHADE);
    g.globalAlpha = alpha * 0.35;
    for (let i = 1; i < 5; i++) g.fillRect(0, h * (i / 5), w, 1.1 * sc);
    g.globalAlpha = alpha;
    // the accent band along the top — the kid's own colour, so you know who
    g.fillStyle = C(acc);
    g.fillRect(0, 0, w, h * 0.28);
    g.fillStyle = C(mix(acc, INK, 0.35));
    g.fillRect(0, h * 0.28 - 2.4 * sc, w, 2.4 * sc);
    g.restore();
    g.strokeStyle = C(INK); g.lineWidth = Math.max(1.4, 2.0 * sc); g.stroke(path);

    // the key cap — a chalked square with the key in it, on the band
    const kx = 8 * sc, ky = 4 * sc, ks = h * 0.28 - 8 * sc;
    g.save();
    g.strokeStyle = C(CHALK); g.lineWidth = Math.max(1.2, 2.2 * sc);
    g.strokeRect(kx, ky, ks, ks);
    slab(g, BAG_KEY[card.bag] || '?', kx + ks / 2, ky + ks * 0.80, ks * 0.86, {
      color: C(CHALK), align: 'center', weight: 0.19, tracking: 0.02, jitter: 0.8, seed: 5,
    });
    g.restore();
    // the shout, on the band next to the key
    slab(g, BAG_YELL[card.bag] || '', kx + ks + 7 * sc, ky + ks * 0.78, ks * 0.62, {
      color: C(mix(acc, CHALK, 0.86)), align: 'left', weight: 0.20, tracking: 0.06, jitter: 1, seed: 9,
      shadow: { dx: 1.2 * sc, dy: 1.4 * sc, color: C(ink) },
    });

    // the bag itself, big
    slab(g, BAG_WORD[card.bag] || card.bag, w / 2, h * 0.72, 30 * sc, {
      color: C(INK), align: 'center', weight: 0.21, tracking: 0.05, condense: 0.94, jitter: 1.1, seed: 13,
      shadow: { dx: 1.6 * sc, dy: 1.8 * sc, color: C(mix(PAPER, INK, 0.30)) },
    });
    // the kid standing on it
    slab(g, nickOf((POST[card.kid] || {}).kid || ''), w / 2, h * 0.93, 13 * sc, {
      color: C(mix(INK, PAPER, 0.34)), align: 'center', weight: 0.22, tracking: 0.10, jitter: 1, seed: 17,
    });

    // the good one is scrawled round in fresh chalk; the others are not
    if (best || chosen) {
      const pad = 7 * sc;
      chalkStroke(g, [[-pad, -pad], [w + pad, -pad], [w + pad, h + pad], [-pad, h + pad], [-pad, -pad]],
        3.6 * sc, 77, chosen ? 1 : 0.8, C(CHALK));
      chalk(g, chosen ? 'THAT ONE' : 'THE SURE ONE', w / 2, -pad - 8 * sc, 15 * sc, {
        align: 'center', color: C(CHALK), weight: 0.17, tracking: 0.12, alpha: 0.95, seed: 23,
      });
    }
    g.restore();
  }

  /**
   * The clock. Five chalk strokes on a scuffed patch of road at the thrower's
   * feet, rubbed out one at a time — the same material the scorebug is made of
   * (§11), and the reason there is no progress bar anywhere in this piece.
   */
  tally(g, cx, cy, U, pr, frac) {
    const n = FT.ticks;
    const leftN = pr.expired ? 0 : Math.ceil(frac * n - 1e-6);
    const w = 210 * U, h = 74 * U;
    g.save();
    g.translate(cx, cy);
    g.rotate(-1.8 * Math.PI / 180);
    // the scuffed patch
    g.save();
    g.globalAlpha = 0.30;
    g.fillStyle = C(mix(PAVEMENT.asphaltShade, CHALK, 0.30));
    const patch = new Path2D();
    const R = new RNG(404);
    for (let i = 0; i <= 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const rx = (w / 2) * (0.86 + R.next() * 0.2), ry = (h / 2) * (0.80 + R.next() * 0.28);
      const X = Math.cos(a) * rx, Y = Math.sin(a) * ry;
      if (i === 0) patch.moveTo(X, Y); else patch.lineTo(X, Y);
    }
    patch.closePath();
    g.fill(patch);
    g.restore();

    chalk(g, pr.expired ? 'TOO LATE' : 'THROW IT', 0, -h * 0.20, 20 * U, {
      align: 'center', color: C(CHALK), weight: 0.16, tracking: 0.14, alpha: 0.95, seed: 31,
    });

    const step = (w * 0.70) / n;
    for (let i = 0; i < n; i++) {
      const x = -w * 0.35 + step * (i + 0.5);
      const alive = i < leftN;
      const dying = alive && i === leftN - 1;
      const a = alive ? (dying ? 0.55 + 0.45 * ((frac * n) % 1) : 0.95) : 0.11;
      chalkStroke(g, [[x - 2 * U, h * 0.05], [x + 2 * U, h * 0.34]], 6.4 * U, 41 + i * 3, a, C(CHALK));
    }
    g.restore();
  }

  /* --- the call ----------------------------------------------------------- */
  paintCall(app, g, p) {
    const U = this.U;
    const age = p.t - p.callAt;
    const pop = clamp(age / 0.11, 0, 1);
    const fade = clamp(1 - (age - 1.0) / 0.55, 0, 1);
    if (fade <= 0) return;
    const bag = p.callBag;
    const s = this.project(app, bag.x, LAYOUT.groundAt(bag.x) + 7.4, bag.z);
    if (!s) return;
    const sc = U * (0.72 + 0.34 * pop) * (p.callWord.length > 5 ? 0.78 : 1);
    g.save();
    g.globalAlpha = fade;
    g.translate(clamp(s.x, 130 * U, this.w - 130 * U), clamp(s.y, 70 * U, this.h - 70 * U));
    g.rotate(-3.4 * Math.PI / 180);
    const col = p.callOut ? ACCENTS.red : CHALK;
    // chalked ground under the word, so the word is ON something
    g.save();
    g.globalAlpha = fade * 0.34;
    g.fillStyle = C(mix(PAVEMENT.asphaltShade, CHALK, 0.42));
    const wpx = slabW(p.callWord, 74 * sc, { tracking: 0.07 }) + 44 * sc;
    g.beginPath();
    g.ellipse(0, -18 * sc, wpx / 2, 46 * sc, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    slab(g, p.callWord, 0, 0, 74 * sc, {
      color: C(col), align: 'center', weight: 0.215, tracking: 0.07, condense: 0.9,
      jitter: 1.3, seed: 71, shadow: { dx: 4.6 * sc, dy: 5.2 * sc, color: C(INK) },
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

    // Glue the ball to the hand that is holding it. This runs in `update` at
    // order 310 — after src/chars/players.js (20) has solved the frame's hands
    // and before src/game/ballview.js reads the ball in lateUpdate — so the ball
    // is never drawn a frame behind the kid carrying it.
    if (current.holder && current.phase !== 'throw') {
      handAt(current.holder, sim.ball.pos);
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

function stage(app, { seed = 1920, ball, vel, play, bases = [null, null, null], settle = 0 } = {}) {
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
  if (settle) app.clock.advance(settle);
}

/** A hard one-hopper to short, and the throw beats him by a stride. */
registerScenario('field_grounder', {
  seed: 3311,
  setup: ({ app }) => {
    stage(app, {
      seed: 3311,
      ball: [-1.2, 2.4, 2.0], vel: [-13, 9, 46],
      play: { result: 'out_ground', loft: 'ground', fielder: 'SS', margin: -0.06, bases: 0, quality: 0.44, lane: -0.3 },
    });
  },
  // late enough that the ball is fielded, the throw is in the air and the runner
  // is inside the last third of the line
  settle: 1.35,
});

/** A lazy fly into short right; two kids converge and one of them is asleep. */
registerScenario('field_fly', {
  seed: 8802,
  setup: ({ app }) => {
    stage(app, {
      seed: 8802,
      ball: [1.0, 3.0, 1.5], vel: [15, 40, 44],
      play: { result: 'out_fly', loft: 'fly', fielder: 'RF', margin: 0, bases: 0, quality: 0.82, lane: 0.6 },
    });
  },
  settle: 1.55,
});

/**
 * The one moment the player is on defence: a bang-bang grounder with a kid on
 * third and a kid on first, so all three bags are live and the good one is the
 * one drawn in fresh chalk.
 */
registerScenario('throw_prompt', {
  seed: 5150,
  setup: ({ app }) => {
    stage(app, {
      seed: 5150,
      bases: [true, null, true],
      ball: [-1.0, 2.2, 2.0], vel: [-11, 8, 40],
      play: { result: 'out_ground', loft: 'ground', fielder: 'SS', margin: 0.04, bases: 0, quality: 0.42, lane: -0.25 },
    });
    // the prompt the core would have asked for, on the play it just decided
    const p = current;
    if (p) {
      p.wantPrompt = { targets: liveMatch.throwTargets(), best: '1B', deadline: P.race.throwDeadline };
      liveMatch.pendingThrow = { play: p.play, margin: p.play.margin };
    }
  },
  // the ball is fielded at ~0.9 s; another 0.55 s puts the tally at three of five
  settle: 1.45,
});

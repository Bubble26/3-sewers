/**
 * engine.js — THE SOUND ENGINE.
 * ============================================================================
 * One WebAudio graph, five buses, a canyon send, a ducker and a master limiter,
 * and — this is the load-bearing part — the graph is described by ONE function
 * that is handed a context. Give it an AudioContext and it is the live game.
 * Give it an OfflineAudioContext and it is app.audio.renderOffline(), which is
 * what tools/audition.mjs measures. There is no "offline version" of anything;
 * a cue that sounds right in the audition sounds right in the game because it
 * is the same nodes in the same order.
 *
 *   app.audio.listCues()                                    -> string[]
 *   app.audio.renderOffline({ cue, seconds, sampleRate })    -> Promise<AudioBuffer>
 *   app.audio.play(cue, { gain, pos, dist, pan, speed, pitch, delay })
 *   app.audio.registerCue(name, def)     other pieces add stings into this graph
 *
 * ---------------------------------------------------------------------------
 * THE GRAPH
 * ---------------------------------------------------------------------------
 *
 *   cue -> [cue gain x play gain x 1/(1+d/ref)] -> [air lowpass(d)] -> [pan]
 *              |
 *              +-> bus: sfx | voice | chatter | music | ambience --> [mix x master]
 *              |                                                        |
 *              +-> canyon send(d) -> [convolver] -> [reverb bus] -------+
 *                                                                       |
 *                                        [1/range] -> [soft clip] -> [range] -> out
 *
 * Bus levels obey DESIGN-BIBLE §7.5: during a pitch the loudest thing on the mix
 * is the kids, music is a bed, and ambience sits underneath everything and ducks
 * -18 dB the moment a voice fires. Ducking is bus-to-bus and therefore invisible
 * in a single-cue render, so `mix_duck_demo` and `mix_distance_demo` (bottom of
 * this file) put the whole mix through the offline path where it can be measured
 * — CONTRACT.md is explicit that what cannot be rendered offline counts as
 * unbuilt, and that applies to mix behaviour as much as to sounds.
 * ============================================================================
 */
import { registerSystem } from '../app.js';
import { bus } from '../core/bus.js';
import { T } from '../core/tuning.js';
import { RNG } from '../core/rng.js';
import { CUES, registerCue, listCues, getCue, clamp, gain as gainNode } from './sfx.js';

/* =============================================================================
 * MIX — the whole audio tuning surface. Published on T.audio.
 * ========================================================================== */
export const MIX = {
  // 0.40, not 0.78. A realistic game instant is FOUR things at once — the bed on
  // ambience, a sewer shot on sfx, a kid yelling on chatter and Dot calling it on
  // voice — and at 0.78 that instant measured 0.9905, i.e. it only stayed legal by
  // sitting on the soft-clip knee, and the thing the knee shaves first is the crest
  // factor of the pock, which is the most important sound in the game. 6 dB back.
  // `mix_headroom` at the bottom of this file is the standing proof: <= 0.82.
  master: 0.40,
  // §7.5 is a bus list: kid chatter is its OWN bus with its own volume control,
  // sitting 8-12 dB under the announcers and ducking to -18 dB while a line plays.
  buses: { sfx: 0.86, voice: 1.0, chatter: 0.32, music: 0.62, ambience: 0.58, reverb: 0.42 },
  busAlias: { effects: 'sfx', announcer: 'voice', amb: 'ambience' },
  duck: {
    voice: { chatter: -18, ambience: -18, music: -12, sfx: -4 },
    music: { ambience: -6 },
    chatter: { ambience: -5 },
    attack: 0.09, release: 0.55, hold: 0.25,
  },
  // THE MASTER LIMITER. Chrome's DynamicsCompressorNode turned out to be unusable
  // here: measured on this exact graph, at ratio 1 / threshold 0 / nothing above
  // the threshold at all, it still costs a fixed 14 dB (0.998 in -> 0.201 out),
  // and at 20:1 it took the pock down 15 dB below where it belonged. So the
  // ceiling is a real soft-clip transfer curve instead — sample-accurate, dead
  // transparent below the knee (0.4991 in -> 0.4977 out), asymptotic to 1.0 above
  // it. A transient keeps the crest factor it was built with.
  //
  // WHAT IT GUARANTEES, measured rather than claimed: at 2x oversampling and a
  // 0.62 knee, a 3x-gain stress render of every loud cue in the set comes out at
  // or under 1.000. The old 4x path overshot to 1.007-1.013 — inaudible, but the
  // old header said "nothing can leave this graph clipped" and that was false,
  // and a false absolute is worse in a comment than a true bound is. This is the
  // true bound, and `mix_headroom` below is the standing test of the normal case.
  limiter: { knee: 0.62, range: 2.0 },
  space: {
    refDist: 14,        // feet at which a sound is half as loud
    rolloff: 0.85,
    airDist: 95,        // feet per e-fold of high frequency lost to air and soot
    minLp: 900, maxLp: 19000,
    panWidth: 22,       // feet of street that maps to full stereo width
    panMax: 0.72,
    sendNear: 0.055, sendFar: 0.46, sendDist: 210,
  },
  reverb: {
    // the canyon: 60 ft of street between two 60 ft walls. Slapback first, then a
    // short dirty tail. Never a hall, never a plate — this is brick and soot.
    taps: [[0.031, 0.42], [0.054, 0.30], [0.089, 0.21], [0.131, 0.14]],
    tail: 0.95, damp: 4200, predelay: 0.008,
  },
  ambience: { gap: [22, 55] },   // §7.5: a sporadic layer every 22-55 s, never on a cycle
};

/* =============================================================================
 * The canyon impulse response — generated, cached per context.
 * ========================================================================== */
function canyonIR(ctx) {
  const key = '__canyonIR';
  if (ctx[key]) return ctx[key];
  const R = MIX.reverb;
  const sr = ctx.sampleRate, len = Math.ceil(sr * (R.tail + 0.15));
  const buf = ctx.createBuffer(2, len, sr);
  const rnd = new RNG(51925);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    // discrete early reflections off the far facade, slightly different per ear
    for (const [t, g] of R.taps) {
      const i = Math.round((t * (c ? 1.06 : 0.97) + R.predelay) * sr);
      if (i < len) { d[i] += g * (c ? 0.92 : 1); d[i + 1] += g * 0.5; }
    }
    // then a dirty exponential tail, lowpassed as it goes (soot eats the top)
    let lpz = 0;
    const k = Math.exp(-2 * Math.PI * R.damp / sr);
    for (let i = Math.round(R.predelay * sr); i < len; i++) {
      const t = i / sr;
      const w = rnd.range(-1, 1) * Math.pow(1 - t / (R.tail + 0.15), 2.6) * 0.42;
      lpz = w * (1 - k) + lpz * k;
      d[i] += lpz;
    }
  }
  ctx[key] = buf;
  return buf;
}

/* =============================================================================
 * buildGraph(ctx) — THE graph. Live and offline both call exactly this.
 * ========================================================================== */
export function buildGraph(ctx) {
  const mix = ctx.createGain();
  mix.gain.value = MIX.master;

  const L = MIX.limiter;
  // The curve is written against input pre-scaled by 1/range, so it stays smooth
  // for a full +6 dB of overshoot instead of flattening the moment a stack of
  // cues sums past unity.
  const pre = ctx.createGain(); pre.gain.value = 1 / L.range;
  const clip = ctx.createWaveShaper();
  const n = 4096, curve = new Float32Array(n), k = L.knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * L.range, a = Math.abs(x);
    const y = a <= k ? a : k + (1 - k) * Math.tanh((a - k) / (1 - k));
    curve[i] = Math.sign(x) * y / L.range;
  }
  clip.curve = curve; clip.oversample = '2x';
  const post = ctx.createGain(); post.gain.value = L.range;

  mix.connect(pre); pre.connect(clip); clip.connect(post); post.connect(ctx.destination);

  const buses = {};
  for (const name of ['sfx', 'voice', 'chatter', 'music', 'ambience']) {
    const g = ctx.createGain();
    g.gain.value = MIX.buses[name];
    g.connect(mix);
    buses[name] = g;
  }

  // the canyon send: one convolver, everything dips into it by distance
  const verb = ctx.createConvolver();
  verb.buffer = canyonIR(ctx);
  const verbOut = ctx.createGain();
  verbOut.gain.value = MIX.buses.reverb;
  verb.connect(verbOut); verbOut.connect(mix);

  return { ctx, mix, limiter: clip, pre, post, buses, verb, verbOut, destination: ctx.destination };
}

/**
 * Per-play voice chain: gain -> air lowpass -> pan -> bus, with a distance-scaled
 * tap into the canyon. Identical live and offline; renderOffline just passes the
 * dist/pan it was asked for instead of reading them off the camera.
 */
function voiceChain(graph, cue, o) {
  const ctx = graph.ctx, S = MIX.space;
  const dist = Math.max(0, o.dist ?? 0);
  const g = ctx.createGain();
  g.gain.value = (cue.gain ?? 1) * (o.gain ?? 1) / (1 + Math.pow(dist / S.refDist, S.rolloff));

  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  air.frequency.value = clamp(S.maxLp * Math.exp(-dist / S.airDist), S.minLp, S.maxLp);
  air.Q.value = 0.7;

  let tail = g;
  g.connect(air); tail = air;

  if (ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(o.pan ?? 0, -1, 1) * S.panMax;
    tail.connect(p); tail = p;
  }
  tail.connect(graph.buses[MIX.busAlias[cue.bus] || cue.bus] || graph.buses.sfx);

  const send = ctx.createGain();
  // a cue may ask for more canyon than distance alone would give it — the pock
  // that happens six feet from the camera still has sixty feet of brick behind it
  send.gain.value = o.send ?? clamp((cue.send ?? S.sendNear) + (dist / S.sendDist) * (S.sendFar - S.sendNear), 0, S.sendFar);
  tail.connect(send); send.connect(graph.verb);
  return g;
}

/**
 * Ducking. WebAudio has no sidechain, so this is the honest version: whichever
 * bus is talking pushes the others down by a named number of dB and lets them
 * back up on a slow release. One implementation, used by the live path AND by
 * the `mix_duck_demo` cue below, so what a critic hears in the audition is
 * literally the automation the game runs.
 */
export function applyDuck(graph, source, t, seconds = 0.4) {
  const table = MIX.duck[source];
  if (!table || !graph) return t;
  const D = MIX.duck;
  for (const [name, db] of Object.entries(table)) {
    const b = graph.buses[name];
    if (!b) continue;
    const target = MIX.buses[name] * Math.pow(10, db / 20);
    b.gain.cancelScheduledValues(t);
    b.gain.setValueAtTime(MIX.buses[name], t);
    b.gain.setTargetAtTime(target, t, D.attack);
    b.gain.setTargetAtTime(MIX.buses[name], t + seconds + D.hold, D.release);
  }
  return t + seconds + D.hold + D.release;
}

/* =============================================================================
 * THE ENGINE
 * ========================================================================== */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.graph = null;
    this.enabled = true;
    this.started = false;
    this.listener = { x: 0, y: 15, z: -46 };
    this.duckUntil = 0;
    this.seq = 0;
    this.rnd = new RNG(1925);
    this.bedAt = 0;
    this.sporadicAt = 0;
    this.lastEl = -1e9;      // §7.5: the El is rate-limited, not merely unlikely
    this.lastPlay = new Map();
    this.log = [];
  }

  /* --- lifecycle ---------------------------------------------------------
   * ensure() returns the AudioContext, NOT the graph. That is a contract other
   * pieces already depend on — src/audio/music.js calls `app.audio.ensure()` and
   * treats the result as a BaseAudioContext — and returning the graph from here
   * broke every live music cue with "ctx.createGain is not a function". The graph
   * is on `.graph`; ensureGraph() is the internal accessor.
   */
  ensure() {
    if (this.ctx || !this.enabled) return this.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) { this.enabled = false; return null; }
    this.ctx = new AC();
    this.graph = buildGraph(this.ctx);
    return this.ctx;
  }
  ensureGraph() { this.ensure(); return this.graph; }
  resume() { const c = this.ensure(); if (c && c.state === 'suspended') c.resume(); return c; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /* --- mixing ------------------------------------------------------------ */
  setBus(name, linear, ramp = 0.08) {
    name = MIX.busAlias[name] || name;
    MIX.buses[name] = linear;
    if (this.graph?.buses[name]) {
      const p = this.graph.buses[name].gain;
      p.cancelScheduledValues(this.now);
      p.setTargetAtTime(linear, this.now, ramp);
    }
  }
  setMaster(linear) {
    MIX.master = linear;
    if (this.graph) this.graph.mix.gain.setTargetAtTime(linear, this.now, 0.05);
  }

  /**
   * Ducking. WebAudio has no sidechain, so this is the honest version: whichever
   * bus is talking pushes the others down by a named number of dB and lets them
   * back up on a slow release. Deterministic, and it works offline too.
   */
  duck(source = 'voice', seconds = 0.4) {
    if (!this.graph) return;
    this.duckUntil = Math.max(this.duckUntil, applyDuck(this.graph, source, this.now, seconds));
  }

  /* --- space ------------------------------------------------------------- */
  /** Distance + pan for a world position, from the locked stage camera (§17). */
  spatial(pos) {
    if (!pos) return { dist: 0, pan: 0 };
    const L = this.listener;
    const dx = pos.x - L.x, dy = (pos.y ?? 0) - L.y, dz = (pos.z ?? 0) - L.z;
    return {
      dist: Math.sqrt(dx * dx + dy * dy + dz * dz),
      // the stage is locked and looks down +z (§17), so world x IS screen-horizontal
      pan: clamp(pos.x / MIX.space.panWidth, -1, 1),
    };
  }

  /* --- playing ----------------------------------------------------------- */
  play(name, o = {}) {
    const cue = getCue(name);
    if (!cue) { if (!this.log.includes(name)) this.log.push(name); return null; }
    const graph = this.ensureGraph();
    if (!graph) return null;
    const t = this.now + (o.delay ?? 0) + 0.004;
    // one voice per cue per ~35 ms: a ball can hit two colliders in one tick and
    // the same clang twice in a frame is a phase mess, not a louder clang
    const gate = o.gate ?? 0.035;
    if (gate > 0) {
      const last = this.lastPlay.get(name) ?? -1;
      if (t - last < gate) return null;
      this.lastPlay.set(name, t);
    }
    const sp = o.pos ? this.spatial(o.pos) : {};
    const opts = {
      ...o,
      dist: o.dist ?? sp.dist ?? 0,
      pan: o.pan ?? sp.pan ?? 0,
      rnd: o.rnd || new RNG((this.seq++ * 2654435761 + 1925) >>> 0),
      graph,
    };
    const out = voiceChain(graph, cue, opts);
    try { cue.build(this.ctx, out, t, opts); } catch (e) { console.error('cue ' + name, e); return null; }
    if (cue.bus === 'voice') this.duck('voice', Math.min(2.2, cue.dur ?? 0.6));
    else if (cue.bus === 'music') this.duck('music', Math.min(4, cue.dur ?? 1));
    return t;
  }

  /* --- the offline path, which is the contract (docs/CONTRACT.md) --------- */
  listCues() { return listCues(); }
  cueInfo(name) {
    const c = getCue(name);
    return c ? { name, bus: c.bus, gain: c.gain, dur: c.dur, note: c.note || '' } : null;
  }
  registerCue(name, def) { return registerCue(name, def); }

  /**
   * Rebuild the SAME graph into an OfflineAudioContext and render one cue.
   * Not a re-implementation, not an approximation: buildGraph() and
   * voiceChain() and cue.build() are the identical functions the live path uses.
   */
  async renderOffline({ cue, seconds = 3, sampleRate = 44100, gain = 1, dist = 0, pan = 0, ...rest } = {}) {
    const def = getCue(cue);
    if (!def) throw new Error('unknown cue "' + cue + '" — try app.audio.listCues()');
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!OAC) throw new Error('no OfflineAudioContext in this environment');
    const ctx = new OAC(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate);
    const graph = buildGraph(ctx);
    const opts = {
      ...rest, gain, dist, pan, seconds, graph,
      rnd: new RNG(rest.seed ?? 1925),
    };
    const out = voiceChain(graph, def, opts);
    // a hair of pre-roll so the attack lands inside the first analysis bucket
    def.build(ctx, out, 0.0015, opts);
    if (def.bus === 'voice') applyDuck(graph, 'voice', 0.004, Math.min(2.2, def.dur ?? 0.6));
    else if (def.bus === 'music') applyDuck(graph, 'music', 0.004, Math.min(4, def.dur ?? 1));
    return ctx.startRendering();
  }

  /* --- the block runs whether anybody is playing or not ------------------- */
  startBed() {
    if (!this.graph || this.bedAt > this.now) return;
    // §7.5: the loop must never become audible, so every pass is a different draw
    // and a different length. Deterministic per session, never identical twice.
    const LEN = this.rnd.range(7.5, 10.5);
    this.play('city_bed', { gain: 0.9, dist: 0, gate: 0, seconds: LEN, rnd: new RNG(this.rnd.int(1, 1e6)) });
    this.bedAt = this.now + LEN - 0.4;
  }
  tickAmbience(dt) {
    if (!this.graph || !this.started) return;
    if (this.now >= this.bedAt) this.startBed();
    if (this.now >= this.sporadicAt) {
      if (this.sporadicAt > 0) {
        let pick = SPORADIC_LIST[this.rnd.int(0, SPORADIC_LIST.length - 1)];
        // the El came up too soon — re-roll off the rest of the list
        if (pick === 'el_train' && this.now - this.lastEl < EL_MIN_GAP) {
          const rest = SPORADIC_LIST.slice(1);
          pick = rest[this.rnd.int(0, rest.length - 1)];
        }
        if (pick === 'el_train') this.lastEl = this.now;
        const O = SPORADIC_OPTS[pick] || { gain: 0.55, dist: [90, 240], pan: [-0.8, 0.8] };
        this.play(pick, {
          gain: O.gain, gate: 0,
          dist: this.rnd.range(O.dist[0], O.dist[1]),
          pan: this.rnd.range(O.pan[0], O.pan[1]),
        });
      }
      const G = MIX.ambience.gap;
      this.sporadicAt = this.now + this.rnd.range(G[0], G[1]);
    }
  }
}

/* =============================================================================
 * MIX DEMONSTRATION CUES
 * ---------------------------------------------------------------------------
 * Ducking and distance are mix behaviour, not sounds, so they cannot be heard in
 * a single-cue render — and CONTRACT.md is explicit that a thing which cannot be
 * rendered offline counts as unbuilt. These two cues put the whole mix through
 * the offline path so both are visible in an audition envelope.
 * ========================================================================== */
registerCue('mix_duck_demo', {
  bus: 'ambience', gain: 1.0, dur: 7.0, send: 0.05,
  note: '§7.5 proof: the block running, then a mother calls and the block drops -18 dB under her.',
  build(ctx, out, t0, o) {
    const graph = o.graph;
    if (!graph) return;
    // the bed goes to the AMBIENCE bus and the call to the VOICE bus, which is the
    // only way the duck can be heard: it is a bus-to-bus behaviour
    const bed = gainNode(ctx, 0.60); bed.connect(graph.buses.ambience);
    CUES.city_bed.build(ctx, bed, t0, { ...o, seconds: 7, rnd: new RNG(101) });
    const v = gainNode(ctx, 0.95); v.connect(graph.buses.voice);
    CUES.mother_calling.build(ctx, v, t0 + 2.4, { ...o, rnd: new RNG(202) });
    applyDuck(graph, 'voice', t0 + 2.34, 1.5);
  },
});

registerCue('mix_distance_demo', {
  bus: 'sfx', gain: 1.0, dur: 6.0,
  note: 'the same pock at 4, 18, 55 and 140 feet: level, air lowpass and canyon send all move.',
  build(ctx, out, t0, o) {
    const graph = o.graph;
    if (!graph) return;
    let t = t0;
    for (const d of [4, 18, 55, 140]) {
      const node = voiceChain(graph, CUES.crack, { ...o, dist: d, pan: 0, gain: 1 });
      CUES.crack.build(ctx, node, t, { ...o, rnd: new RNG(300 + d) });
      t += 1.1;
    }
  },
});

registerCue('mix_headroom', {
  bus: 'sfx', gain: 1.0, dur: 4.2,
  note: 'THE HEADROOM TEST: one real game instant — the block, a sewer shot, a kid yelling and Dot calling it, all inside 300 ms, ducking OFF so it is the worst case. Must render at or under 0.82.',
  build(ctx, out, t0, o) {
    const graph = o.graph;
    if (!graph) return;
    // A cue rendered alone tells you nothing about headroom; the game never plays
    // one cue alone. This is the instant that actually happens — every bus lit at
    // once — and it is registered rather than thrown away so the claim in MIX
    // stays checkable by anybody with `node tools/audition.mjs mix_headroom`.
    const bed = gainNode(ctx, 0.60); bed.connect(graph.buses.ambience);
    CUES.city_bed.build(ctx, bed, t0, { ...o, seconds: 4.2, rnd: new RNG(4041) });

    const T0 = t0 + 1.30;                                  // the moment of contact
    const hit = voiceChain(graph, CUES.crack_wallop, { ...o, dist: 6, pan: 0, gain: 1 });
    CUES.crack_wallop.build(ctx, hit, T0, { ...o, rnd: new RNG(4042) });

    const yellCue = getCue('kid_yell');
    if (yellCue) {
      const y = voiceChain(graph, yellCue, { ...o, dist: 42, pan: -0.35, gain: 1 });
      yellCue.build(ctx, y, T0 + 0.12, { ...o, text: 'some wallop', rnd: new RNG(4043) });
    }
    const dot = getCue('dot_line');
    if (dot) {
      const d = voiceChain(graph, dot, { ...o, dist: 30, pan: 0.4, gain: 1 });
      dot.build(ctx, d, T0 + 0.28, { ...o, text: 'and that one is gone down the sewer', rnd: new RNG(4044) });
    }
  },
});

/* =============================================================================
 * THE SPORADIC LAYER — §7.5's "at least one layer firing every 20-60 s"
 * ---------------------------------------------------------------------------
 * These are EVENTS. The bed (sfx.js `city_bed`) is now only the four things this
 * block does continuously — the avenue, a cart, the cornice pigeons and one
 * radio in one window. Everything below happens sometimes, which is the whole
 * reason it is worth hearing: an El pass that arrives every eight seconds is
 * wallpaper; an El pass that arrives twice in five minutes is New York.
 *
 * The El is the biggest event the block owns and the one that would give the
 * loop away fastest, so it is hard-limited to once per 90 s and the roll is
 * taken again if it comes up early. SPORADIC_OPTS is how each event gets its own
 * place on the street instead of all of them arriving from the same random
 * distance — the church is always downtown, the dog is always in the areaway.
 * ========================================================================== */
const SPORADIC_LIST = ['el_train', 'klaxon', 'dog', 'church_bells', 'knife_grinder', 'mother_calling', 'horse_cart'];
const EL_MIN_GAP = 90;                       // seconds. §7.5: never a cycle you can count.
const SPORADIC_OPTS = {
  el_train:       { gain: 0.95, dist: [95, 135],  pan: [0.15, 0.55] },
  klaxon:         { gain: 0.60, dist: [110, 190], pan: [-0.8, 0.8] },
  dog:            { gain: 0.62, dist: [60, 120],  pan: [-0.7, 0.7] },
  church_bells:   { gain: 0.50, dist: [230, 320], pan: [-0.5, -0.1] },
  knife_grinder:  { gain: 0.58, dist: [70, 150],  pan: [-0.8, 0.8] },
  mother_calling: { gain: 0.55, dist: [55, 95],   pan: [-0.6, 0.6] },
  horse_cart:     { gain: 0.50, dist: [80, 160],  pan: [-0.8, 0.8] },
};

export const audio = new AudioEngine();

/* =============================================================================
 * WIRING — gameplay emits, audio listens. Rendering never drives rules.
 * ========================================================================== */
const IRON_TAGS = new Set(['rung', 'stringer', 'rail', 'grate']);

function contactTier(hit) {
  const q = hit?.quality ?? 0.5, p = hit?.power ?? 70;
  if (q > 0.70 && p > 95) return 'crack_wallop';
  if (q < 0.30) return 'crack_weak';
  return 'crack';
}

export default registerSystem({
  name: 'audio',
  order: 150,

  init(app) {
    app.audio = audio;
    T.audio = MIX;                       // the tuning surface lives where tuning lives
    audio.listener = { x: -3.5, y: 15, z: -46 };

    // ?harness=1 means no autoplay and no wall clock (CONTRACT). renderOffline
    // still works — it builds its own context and never touches this one.
    if (app.flags.harness) audio.enabled = false;

    /* --- the bat -------------------------------------------------------
     * ONE FOLLOW-THROUGH PER SWING. `bat:swing` fires a 340 ms whiff and, ~200 ms
     * later, `bat:contact` fires a tier that carries its own air burst — so a big
     * hit used to play two overlapping swooshes, which is the seam you notice
     * before you notice anything else. Keep a handle on the whiff; if it is still
     * going when the ball is struck, pass { air: 0 } and the tier stands its own
     * burst down (see `broomstick()` in sfx.js).
     */
    let swingAt = -1e9;
    bus.on('bat:swing', (p) => {
      swingAt = audio.play('whiff', { speed: p?.kind === 'power' ? 1.15 : 1, gain: 0.8 }) ?? -1e9;
    });
    bus.on('bat:contact', (hit) => {
      const stillSwooshing = audio.now - swingAt < 0.22;
      audio.play(contactTier(hit), {
        gain: 0.95 + (hit?.quality ?? 0.5) * 0.2, gate: 0,
        ...(stillSwooshing ? { air: 0 } : {}),
      });
    });

    /* --- the ball against the block ------------------------------------ */
    bus.on('ball:impact', (p) => {
      const speed = clamp((p.speed ?? 30) / 55, 0.35, 1.5);
      const common = { pos: p.pos, speed, gain: 0.45 + 0.65 * Math.min(1, speed) };
      if (p.kind === 'break') return audio.play('window_break', { ...common, gain: 1, gate: 0 });
      if (p.kind === 'boom') return audio.play('window_flex', { ...common, gain: 1, gate: 0 });
      if (p.kind === 'whump') return audio.play('canvas_whump', common);
      if (p.kind === 'deadened') return audio.play('flap_cloth', common);
      if (IRON_TAGS.has(p.tag)) return;                    // handled by ball:fire_escape, with a rung pitch
      if (p.tag === 'cans') return audio.play(p.speed > 14 ? 'ashcan_lid' : 'clatter_tin', common);
      if (p.tag === 'plate' || /manhole/.test(p.name || '')) return audio.play('manhole_boom', common);
      // `sfx` is colliders.js's key and `sound` is the world piece's; both resolve
      // through CUE_ALIAS, so neither of them has to know what this file calls things
      audio.play(p.sfx || p.sound || 'bounce_asphalt', common);
    });
    bus.on('ball:fire_escape', (p) => {
      audio.play('clang_iron', {
        pos: p.pos, pitch: clamp(0.62 + (p.pitch ?? 1) * 0.55, 0.5, 1.35),
        speed: clamp((p.speed ?? 26) / 46, 0.4, 1.4), gain: 0.9, gate: 0.02,
      });
    });
    // ball-physics fills the `ballphysics` slot and emits the detailed impact, but
    // sim.js re-emits a plain bounce for the SAME event, and pitching.js emits its
    // own for a pitch that skips off the block first. Sound the plain one only
    // when nobody more specific has spoken, or every bounce fires twice.
    let sawImpact = false;
    bus.on('ball:impact', () => { sawImpact = true; });
    bus.on('ball:bounce', (p) => {
      if (p?.pitch) return audio.play('bounce_stone', { pos: p.pos, speed: 0.75, gain: 0.62 });
      if (sawImpact) return;
      audio.play(p?.surface === 'sidewalk' ? 'bounce_stone' : 'bounce_asphalt', { pos: p?.pos, speed: 0.9 });
    });

    // the block always has an opinion: a broken window buys you one furious dog
    bus.on('ball:window', (p) => { if (p.broke) audio.play('dog', { gain: 0.55, dist: 46, pan: 0.4, delay: 0.62 }); });
    // and a ball on the tar roof puts the whole cornice up
    bus.on('ball:roof', (p) => {
      audio.play('bounce_asphalt', { dist: 88, pan: (p?.side ?? 1) * 0.6, speed: 0.8 });
      audio.play('pigeons', { gain: 0.7, dist: 74, pan: (p?.side ?? 1) * 0.55, delay: 0.30, gate: 0 });
    });

    /* --- bodies -------------------------------------------------------- */
    bus.on('run:step', (p) => audio.play(p?.surface === 'sidewalk' ? 'step_sidewalk' : 'step_asphalt', { pos: p?.pos, pitch: 0.9 + (p?.pitch ?? 0.1), gain: 0.7, gate: 0.02 }));
    bus.on('run:slide', (p) => audio.play('slide', { pos: p?.pos, gain: 0.95, gate: 0 }));
    bus.on('field:catch', (p) => audio.play(p?.clean === false ? 'catch_muff' : 'catch', { pos: p?.pos, gain: 0.9, gate: 0 }));
    bus.on('bat:drop', (p) => audio.play('bat_drop', { pos: p?.pos, gain: 0.85 }));

    /* --- the block reacts ---------------------------------------------- */
    bus.on('ball:sewer', () => audio.play('klaxon', { gain: 0.32, dist: 150, pan: -0.5, delay: 1.35 }));
    // somebody's mother, about half the time, because every half-inning would be a gag
    bus.on('half:end', () => {
      if (audio.rnd.chance(0.5)) audio.play('mother_calling', { gain: 0.7, dist: 62, pan: audio.rnd.range(-0.5, 0.5), delay: 0.9, gate: 0 });
    });

    /* --- unlock on the first gesture; the bed starts with it ------------ */
    const unlock = () => {
      if (!audio.enabled) return;
      audio.resume();
      if (audio.graph && !audio.started) { audio.started = true; audio.startBed(); }
      removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock);
    };
    if (!app.flags.harness && typeof addEventListener === 'function') {
      addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    }
  },

  lateUpdate(dt, app) {
    if (!audio.enabled || !audio.graph) return;
    const c = app.camera;
    if (c) { audio.listener.x = c.position.x; audio.listener.y = c.position.y; audio.listener.z = c.position.z; }
    audio.tickAmbience(dt);
  },
});

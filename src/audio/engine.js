/**
 * engine.js — THE SOUND ENGINE.
 * ============================================================================
 * One WebAudio graph, four buses, a canyon send, a ducker and a master limiter,
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
 *   cue -> [cueGain] -> [distance lp] -> [panner] -+-> bus(sfx|voice|music|amb)
 *                                                  |        |
 *                                                  +-> canyon reverb -> reverbBus
 *                                                                       |
 *                          all buses ---------------------------------> [mix]
 *                                                  -> [limiter comp] -> [soft clip] -> out
 *
 * Bus levels obey DESIGN-BIBLE §7.5: during a pitch the loudest thing on the
 * mix is the kids, music is silent or a -20 dB bed, ambience sits underneath
 * everything and ducks -18 dB the moment a voice fires.
 * ============================================================================
 */
import { registerSystem } from '../app.js';
import { bus } from '../core/bus.js';
import { T } from '../core/tuning.js';
import { RNG } from '../core/rng.js';
import { registerCue, listCues, getCue, clamp } from './sfx.js';

/* =============================================================================
 * MIX — the whole audio tuning surface. Published on T.audio.
 * ========================================================================== */
export const MIX = {
  master: 0.78,
  buses: { sfx: 1.0, voice: 1.0, music: 0.62, ambience: 0.58, reverb: 0.42 },
  duck: {
    // a voice line flattens the block: §7.5 chatter ducks -18 dB under a line
    voice: { ambience: -18, music: -12, sfx: -4 },
    music: { ambience: -6 },
    attack: 0.09, release: 0.55, hold: 0.25,
  },
  // THE MASTER LIMITER. Chrome's DynamicsCompressorNode turned out to be unusable
  // here: measured on this exact graph, at ratio 1 / threshold 0 / nothing above
  // the threshold at all, it still costs a fixed 14 dB (0.998 in -> 0.201 out),
  // and at 20:1 it took the pock down 15 dB below where it belonged. So the
  // ceiling is a real soft-clip transfer curve instead — sample-accurate, dead
  // transparent below the knee (0.4991 in -> 0.4977 out), asymptotic to 1.0 above
  // it. Nothing can leave this graph clipped, and a transient keeps the crest
  // factor it was built with.
  limiter: { knee: 0.68, range: 2.0 },
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
  ambience: { gap: [17, 44] },   // §7.5: a sporadic layer every 20-60 s, never on a cycle
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
  clip.curve = curve; clip.oversample = '4x';
  const post = ctx.createGain(); post.gain.value = L.range;

  mix.connect(pre); pre.connect(clip); clip.connect(post); post.connect(ctx.destination);

  const buses = {};
  for (const name of ['sfx', 'voice', 'music', 'ambience']) {
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
  tail.connect(graph.buses[cue.bus] || graph.buses.sfx);

  const send = ctx.createGain();
  send.gain.value = o.send ?? clamp(S.sendNear + (dist / S.sendDist) * (S.sendFar - S.sendNear), 0, S.sendFar);
  tail.connect(send); send.connect(graph.verb);
  return g;
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
    this.lastPlay = new Map();
    this.log = [];
  }

  /* --- lifecycle --------------------------------------------------------- */
  ensure() {
    if (this.graph || !this.enabled) return this.graph;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) { this.enabled = false; return null; }
    this.ctx = new AC();
    this.graph = buildGraph(this.ctx);
    return this.graph;
  }
  resume() { const g = this.ensure(); if (g && this.ctx.state === 'suspended') this.ctx.resume(); return g; }
  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  /* --- mixing ------------------------------------------------------------ */
  setBus(name, linear, ramp = 0.08) {
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
    const table = MIX.duck[source];
    if (!table) return;
    const D = MIX.duck, t = this.now;
    for (const [name, db] of Object.entries(table)) {
      const b = this.graph.buses[name];
      if (!b) continue;
      const target = MIX.buses[name] * Math.pow(10, db / 20);
      b.gain.cancelScheduledValues(t);
      b.gain.setTargetAtTime(target, t, D.attack);
      b.gain.setTargetAtTime(MIX.buses[name], t + seconds + D.hold, D.release);
    }
    this.duckUntil = Math.max(this.duckUntil, t + seconds + D.hold + D.release);
  }

  /* --- space ------------------------------------------------------------- */
  /** Distance + pan for a world position, from the locked stage camera (§17). */
  spatial(pos) {
    if (!pos) return { dist: 0, pan: 0 };
    const L = this.listener;
    const dx = pos.x - L.x, dy = (pos.y ?? 0) - L.y, dz = (pos.z ?? 0) - L.z;
    return {
      dist: Math.sqrt(dx * dx + dy * dy + dz * dz),
      pan: clamp((pos.x - 0) / MIX.space.panWidth, -1, 1),
    };
  }

  /* --- playing ----------------------------------------------------------- */
  play(name, o = {}) {
    const cue = getCue(name);
    if (!cue) { if (!this.log.includes(name)) this.log.push(name); return null; }
    const graph = this.ensure();
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
    };
    const out = voiceChain(graph, cue, opts);
    try { cue.build(this.ctx, out, t, opts); } catch (e) { console.error('cue ' + name, e); return null; }
    if (cue.bus === 'voice') this.duck('voice', Math.min(2.2, cue.dur ?? 0.6));
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
      ...rest, gain, dist, pan, seconds,
      rnd: new RNG(rest.seed ?? 1925),
    };
    const out = voiceChain(graph, def, opts);
    // a hair of pre-roll so the attack lands inside the first analysis bucket
    def.build(ctx, out, 0.0015, opts);
    if (def.bus === 'voice' && MIX.duck.voice) {
      // ducking is part of the mix, so the offline render hears it too
      const D = MIX.duck;
      for (const [name, db] of Object.entries(MIX.duck.voice)) {
        const b = graph.buses[name];
        if (!b) continue;
        const target = MIX.buses[name] * Math.pow(10, db / 20);
        b.gain.setValueAtTime(MIX.buses[name], 0);
        b.gain.setTargetAtTime(target, 0.004, D.attack);
      }
    }
    return ctx.startRendering();
  }

  /* --- the block runs whether anybody is playing or not ------------------- */
  startBed(t = 0) {
    if (!this.graph || this.bedAt > this.now) return;
    const LEN = 8;
    this.play('city_bed', { gain: 0.9, dist: 0, gate: 0, seconds: LEN });
    this.bedAt = this.now + LEN - 0.35;
  }
  tickAmbience(dt) {
    if (!this.graph || !this.started) return;
    if (this.now >= this.bedAt) this.startBed();
    if (this.now >= this.sporadicAt) {
      if (this.sporadicAt > 0) {
        const pick = SPORADIC_LIST[this.rnd.int(0, SPORADIC_LIST.length - 1)];
        this.play(pick, { gain: 0.55, dist: this.rnd.range(90, 240), pan: this.rnd.range(-0.8, 0.8), gate: 0 });
      }
      const G = MIX.ambience.gap;
      this.sporadicAt = this.now + this.rnd.range(G[0], G[1]);
    }
  }
}

const SPORADIC_LIST = ['klaxon', 'dog', 'church_bells', 'knife_grinder', 'pigeons', 'el_train', 'horse_cart', 'mother_calling'];

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

    /* --- the bat ------------------------------------------------------- */
    bus.on('bat:swing', (p) => audio.play('whiff', { speed: p?.kind === 'power' ? 1.15 : 1, gain: 0.8 }));
    bus.on('bat:contact', (hit) => {
      audio.play(contactTier(hit), { gain: 0.95 + (hit?.quality ?? 0.5) * 0.2, gate: 0 });
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
      if (p.tag === 'plate' || p.name === 'manhole') return audio.play('manhole_boom', common);
      audio.play(p.sfx || 'bounce_asphalt', common);
    });
    bus.on('ball:fire_escape', (p) => {
      audio.play('clang_iron', {
        pos: p.pos, pitch: clamp(0.62 + (p.pitch ?? 1) * 0.55, 0.5, 1.35),
        speed: clamp((p.speed ?? 26) / 46, 0.4, 1.4), gain: 0.9, gate: 0.02,
      });
    });
    // the block always has an opinion: a broken window buys you one furious dog
    bus.on('ball:window', (p) => { if (p.broke) audio.play('dog', { gain: 0.5, dist: 46, pan: 0.4, delay: 0.62 }); });

    /* --- bodies -------------------------------------------------------- */
    bus.on('run:step', (p) => audio.play(p?.surface === 'sidewalk' ? 'step_sidewalk' : 'step_asphalt', { pos: p?.pos, pitch: 0.9 + (p?.pitch ?? 0.1), gain: 0.7, gate: 0.02 }));
    bus.on('run:slide', (p) => audio.play('slide', { pos: p?.pos, gain: 0.95, gate: 0 }));
    bus.on('field:catch', (p) => audio.play(p?.clean === false ? 'catch_muff' : 'catch', { pos: p?.pos, gain: 0.9, gate: 0 }));
    bus.on('bat:drop', (p) => audio.play('bat_drop', { pos: p?.pos, gain: 0.85 }));

    /* --- the block reacts ---------------------------------------------- */
    bus.on('ball:sewer', () => audio.play('klaxon', { gain: 0.32, dist: 150, pan: -0.5, delay: 1.35 }));
    bus.on('half:end', () => audio.play('mother_calling', { gain: 0.7, dist: 62, pan: 0.35, delay: 0.9 }));

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

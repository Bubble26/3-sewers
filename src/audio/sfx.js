/**
 * sfx.js — EVERY SOUND IN THE GAME, SYNTHESISED.
 * ============================================================================
 * No sample files. Not one. The whole game has to survive as a single
 * self-contained HTML page with the network unplugged (CONTRACT §1), so every
 * pock, clang, bark and bell in here is built out of oscillators, noise
 * buffers and filters at the moment it is heard.
 *
 * DESIGN-BIBLE §7.4 is the law: "the cartoon is the exaggeration of the real
 * object". Every cue is welded to a NAMED PERIOD OBJECT — a broomstick, a
 * fire-escape rung, an ash-can lid, a Model T fender, a sewer grate — and each
 * one is the real acoustic object plus exactly one cartoon lie:
 *
 *   fire escape  -> it rings, AND it rings down the ladder rung by rung
 *   ash-can lid  -> it clangs, AND it wobbles to flat like a dropped coin
 *   fender       -> it tonks, AND a spring boings
 *   awning       -> it whumps, AND a slide whistle rides the rebound
 *   plate glass  -> it booms and does NOT break, AND a whole beat of silence
 *   sewer        -> it plinks, AND a descending slide whistle, and it is gone
 *   klaxon       -> already a cartoon; not touched
 *
 * BANNED here, permanently: synthesised whooshes, cinematic braams, sub-bass
 * impacts, notification blips, modern sirens, tyre screech. Every UI sound is
 * mechanical or comic — a wooden clack, a boing, a rattle of bottle caps.
 *
 * ---------------------------------------------------------------------------
 * MEASURED, NOT CLAIMED  (node tools/audition.mjs <cue> --seconds 3, 44.1 kHz)
 * ---------------------------------------------------------------------------
 * The shape of a sound is checkable, so here is the check. Every number below
 * came out of the tool on THIS build, not out of an intention. Absolute peaks
 * moved down ~5.8 dB this round because engine.js MIX.master went 0.78 -> 0.40
 * to buy back headroom; the RATIOS are what to read.
 *
 *   cue              peak    crest   attack  decay   centroid   what it proves
 *   crack            0.382   31.7dB    0ms    35ms    680 Hz    hollow pock, not a baseball crack
 *   crack_weak       0.296   33.3dB    0ms    23ms    366 Hz    dull thock: darker AND shorter
 *   crack_wallop     0.661   27.0dB    0ms   164ms    497 Hz    +4.8 dB and 4.7x the tail of the pock
 *   whiff            0.146   25.0dB   12ms   211ms   2684 Hz    air only, and it peaks AT contact
 *   clang_iron       0.270   24.0dB    0ms   750ms    378 Hz    7 onsets = a staircase you can count
 *   ashcan_lid       0.194   30.3dB    0ms   105ms    734 Hz    9 onsets = the wobble-to-flat
 *   window_flex      0.402   28.6dB    0ms    94ms    116 Hz    a flat boom, then a beat of nothing
 *   window_break     0.359   29.2dB    0ms   258ms   2151 Hz    glass, an octave above everything else
 *   sewer_swallow    0.264   25.8dB    0ms    35ms    882 Hz    plink, slide whistle, gone
 *   city_bed (10 s)  0.138   12.7dB   78ms      -     305 Hz    no transient sharp enough to fight a bounce
 *   mix_headroom     0.678   26.5dB     -        -    583 Hz    the worst real instant, 3.4 dB under full scale
 *
 * THE THREE BROOMSTICK TIERS separate on every axis: 366 / 680 / 497 Hz centroid
 * and 23 / 35 / 164 ms decay. The thock is the dullest and shortest, the pock is
 * the brightest, and the wallop is the pock with a building hung under it — 78 Hz
 * sagging to 46 plus a 39 Hz sub, which is why its centroid drops BELOW the pock's
 * while its peak sits 4.8 dB above it. That inversion is the sound of weight.
 *
 * THE TWO STAIRCASES are mirror images, on purpose (§7.4). `ashcan_lid` contacts
 * at 0.29 / 0.45 / 0.57 / 0.68 / 0.77 / 0.86 / 0.93 / 0.98 / 1.04 s — gaps of
 * 152/129/106/93/82/71/58/59 ms, SHRINKING, a lid falling flat like a dropped
 * coin. `clang_iron` contacts at 0.12 / 0.23 / 0.35 / 0.48 / 0.62 / 0.76 / 0.91 s
 * — gaps of 117/118/128/141/141/152 ms, WIDENING, a ball walking DOWN a ladder
 * and taking longer to reach every next bar. Nine accelerating steps against
 * seven decelerating ones: two cartoon lies about two different objects, and the
 * two analysis PNGs are the proof they are not the same sound twice. (Read
 * `clang_iron` at --seconds 1.5 if you want the staircase to fill the frame;
 * at the default 3 s it is squeezed into the left third.)
 *
 * THE BED IS FOUR LAYERS, NOT EIGHT. §7.5 asks for looping layers plus a sporadic
 * layer every 20-60 s. The bed is now only what is continuously true of this block
 * — the avenue, a horse cart, the cornice pigeons, one radio in one window (§7.1
 * says one radio, one window, and means it). The El, the dog, the knife grinder,
 * the church bells, the klaxon and a mother at a window are EVENTS and live in
 * engine.js SPORADIC_LIST, where the scheduler fires one every 22-55 s and the El
 * at most once every 90 s. Measured over an hour of virtual time: 93 events, gaps
 * 22.3-54.8 s, ten El passes with a minimum spacing of 136 s. Before this round
 * the bed rebuilt a full El pass every 8 seconds.
 *
 * ---------------------------------------------------------------------------
 * HOW A CUE WORKS
 * ---------------------------------------------------------------------------
 * A cue is pure description. It never touches a live AudioContext of its own,
 * it is handed one:
 *
 *   build(ctx, out, t0, o)
 *     ctx  an AudioContext OR an OfflineAudioContext — identical code path,
 *          which is the entire reason app.audio.renderOffline() can be trusted
 *     out  the node to write into (engine already put bus / distance / send on it)
 *     t0   absolute start time in ctx time
 *     o    { rnd: RNG, speed, pitch, ... } — rnd is a PRIVATE RNG instance so a
 *          sound never disturbs the gameplay draw order (CONTRACT: determinism)
 *
 * Tuning lives in the cue tables at the bottom and in engine.js MIX, both of
 * which are published on T.audio.
 * ============================================================================
 */
import { RNG } from '../core/rng.js';
import { ROSTER } from '../chars/roster.js';

/* =============================================================================
 * 0. SMALL TOOLS
 * ========================================================================== */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TAU = Math.PI * 2;

/** Wire a list of nodes head-to-tail and return the tail. */
export function chain(...n) {
  for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]);
  return n[n.length - 1];
}

const _perCtx = new WeakMap();
function memo(ctx, key, make) {
  let m = _perCtx.get(ctx);
  if (!m) _perCtx.set(ctx, (m = new Map()));
  if (!m.has(key)) m.set(key, make());
  return m.get(key);
}

/* --- noise ---------------------------------------------------------------
 * Buffers are generated from a private RNG, cached per context, and looped.
 * White for grit and glass, pink for air and cloth, brown for traffic and the
 * El. Same seed every run, so the audition numbers are stable.
 */
export function noiseBuf(ctx, kind = 'white') {
  return memo(ctx, 'noise:' + kind, () => {
    const sr = ctx.sampleRate, len = Math.ceil(sr * 4);
    const b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
    const r = new RNG(kind === 'white' ? 70701 : kind === 'pink' ? 31415 : 90210);
    if (kind === 'brown') {
      let last = 0;
      for (let i = 0; i < len; i++) { const w = r.range(-1, 1); last = (last + 0.021 * w) / 1.021; d[i] = clamp(last * 4.4, -1, 1); }
    } else if (kind === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = r.range(-1, 1);
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = clamp((b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.17, -1, 1);
        b6 = w * 0.115926;
      }
    } else {
      for (let i = 0; i < len; i++) d[i] = r.range(-1, 1);
    }
    return b;
  });
}

export function noiseSrc(ctx, t0, dur, kind = 'white', offset = 0) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf(ctx, kind);
  s.loop = true;
  const L = s.buffer.duration;
  s.start(Math.max(0, t0), ((offset % L) + L) % L, Math.max(0.001, dur));
  return s;
}

/* --- filters -------------------------------------------------------------- */
function biq(ctx, type, f, q, gainDb) {
  const b = ctx.createBiquadFilter();
  b.type = type; b.frequency.value = f;
  if (q != null) b.Q.value = q;
  if (gainDb != null) b.gain.value = gainDb;
  return b;
}
export const bp = (ctx, f, q = 1) => biq(ctx, 'bandpass', f, q);
export const lp = (ctx, f, q = 0.7) => biq(ctx, 'lowpass', f, q);
export const hp = (ctx, f, q = 0.7) => biq(ctx, 'highpass', f, q);
export const pk = (ctx, f, q, db) => biq(ctx, 'peaking', f, q, db);
export const notch = (ctx, f, q = 2) => biq(ctx, 'notch', f, q);

export function gain(ctx, v = 1) { const g = ctx.createGain(); g.gain.value = v; return g; }

/**
 * Percussive envelope. Exponential by default because that is what a struck
 * object actually does, and because it is what puts a real crest factor on the
 * audition read-out instead of a lazy linear triangle.
 */
export function envGain(ctx, t0, o = {}) {
  const peak = Math.max(1e-5, o.peak ?? 1);
  const a = o.a ?? 0.002, hold = o.hold ?? 0, d = o.d ?? 0.2;
  const floor = Math.max(1e-6, peak * (o.floorRatio ?? 0.0018));
  const g = ctx.createGain(), p = g.gain;
  p.setValueAtTime(floor, t0);
  if (a > 0) {
    if (o.shapeA === 'lin') p.linearRampToValueAtTime(peak, t0 + a);
    else p.exponentialRampToValueAtTime(peak, t0 + a);
  } else p.setValueAtTime(peak, t0);
  const s = t0 + a + hold;
  if (hold > 0) p.setValueAtTime(peak, s);
  if (o.shapeD === 'lin') p.linearRampToValueAtTime(floor, s + d);
  else p.exponentialRampToValueAtTime(floor, s + d);
  p.setValueAtTime(0, s + d + 0.002);
  return g;
}

/** Soft saturation. Used for horn-speaker honk and klaxon rasp, never as "warmth". */
export function shaper(ctx, amount = 3) {
  return memo(ctx, 'shape:' + amount, () => {
    const ws = ctx.createWaveShaper(), n = 1024, c = new Float32Array(n);
    const k = Math.tanh(amount);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(amount * x) / k; }
    ws.curve = c; ws.oversample = '2x';
    return ws;
  });
}

/**
 * Feed-forward comb — a real reflection, not a feedback loop, so it is legal at
 * sub-millisecond delays (a feedback delay in WebAudio is quantised to a render
 * quantum and could never be a 1 ms tube). This is how brick gets its flutter
 * and how the broomstick handle gets hollow.
 */
export function comb(ctx, freqHz, mix = 0.6, invert = true) {
  const inG = gain(ctx, 1), out = gain(ctx, 1);
  const dly = ctx.createDelay(0.2), wet = gain(ctx, invert ? -mix : mix);
  dly.delayTime.value = clamp(1 / freqHz, 0.0002, 0.19);
  inG.connect(out); inG.connect(dly); dly.connect(wet); wet.connect(out);
  return { in: inG, out };
}

/* =============================================================================
 * 1. VOICES — the physical primitives every cue is assembled from
 * ========================================================================== */

/**
 * Cosine-phase wave. A sine oscillator starts at zero, so a stack of them fades
 * in over a few milliseconds and an "impact" arrives with no impact. Every
 * struck partial in this file starts at full amplitude instead, in phase with
 * every other partial, which is what a real strike does and what puts the
 * transient back on the front of the sound.
 */
function cosWave(ctx) {
  return memo(ctx, 'coswave', () => ctx.createPeriodicWave(
    Float32Array.from([0, 1]), Float32Array.from([0, 0]), { disableNormalization: true }));
}

/** One damped partial. The atom of every struck object in the game. */
export function partial(ctx, dest, t0, o) {
  const osc = ctx.createOscillator();
  const cos = o.phase === 'cos' && (!o.type || o.type === 'sine');
  if (cos) osc.setPeriodicWave(cosWave(ctx));
  else osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(Math.max(8, o.f), t0);
  if (o.glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(8, o.glideTo), t0 + (o.glideTime ?? o.d ?? 0.1));
  if (o.detune) osc.detune.value = o.detune;
  // a struck mode is excited by an impulse, so its envelope is ALREADY OPEN at t0.
  // Ramping it up over even half a millisecond throws away the phase alignment
  // between partials, and with it the entire front edge of the sound.
  const a = o.a ?? (cos ? 0 : 0.0012);
  const e = envGain(ctx, t0, { peak: o.g ?? 0.3, a, hold: o.hold ?? 0, d: o.d ?? 0.2, shapeA: o.shapeA, shapeD: o.shapeD });
  osc.connect(e).connect(dest);
  osc.start(t0);
  osc.stop(t0 + a + (o.hold ?? 0) + (o.d ?? 0.2) + 0.03);
  return osc;
}

/** Band-limited noise burst: grit, hiss, scuff, clapper, glass. */
export function burst(ctx, dest, t0, o) {
  const dur = (o.a ?? 0.001) + (o.hold ?? 0) + (o.d ?? 0.05) + 0.01;
  const s = noiseSrc(ctx, t0, dur, o.color || 'white', o.offset ?? 0);
  let node = s;
  if (o.f) {
    const f = o.type === 'lp' ? lp(ctx, o.f, o.q ?? 0.8) : o.type === 'hp' ? hp(ctx, o.f, o.q ?? 0.8) : bp(ctx, o.f, o.q ?? 1);
    if (o.fTo) {
      f.frequency.setValueAtTime(o.f, t0);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, o.fTo), t0 + (o.fTime ?? o.d ?? 0.05));
    }
    node = chain(node, f);
  }
  const e = envGain(ctx, t0, { peak: o.g ?? 0.3, a: o.a ?? 0.001, hold: o.hold ?? 0, d: o.d ?? 0.05, shapeA: o.shapeA, shapeD: o.shapeD });
  chain(node, e, dest);
  return s;
}

/**
 * A struck metal object. Inharmonic partials, a clapper transient, and optional
 * beating (two partials a fraction of a hertz apart) which is the thing that
 * makes a bell sound cast rather than sampled.
 */
export function metal(ctx, dest, t0, o) {
  const f0 = o.f0, g0 = o.g ?? 0.3;
  const ratios = o.ratios, gains = o.gains, decays = o.decays;
  for (let i = 0; i < ratios.length; i++) {
    const f = f0 * ratios[i];
    if (f > 17000) continue;
    const d = (decays[i] ?? 0.3) * (o.dScale ?? 1);
    partial(ctx, dest, t0, { f, g: g0 * (gains[i] ?? 0.3), d, a: o.a ?? 0, phase: 'cos' });
    if (o.beat) partial(ctx, dest, t0, { f: f * (1 + o.beat / f), g: g0 * (gains[i] ?? 0.3) * 0.72, d, a: o.a ?? 0, phase: 'cos' });
  }
  if (o.strike !== 0) burst(ctx, dest, t0, { f: o.strikeF ?? f0 * 3.2, q: 0.9, g: g0 * (o.strike ?? 0.5), a: 0.0004, d: o.strikeD ?? 0.012 });
}

/**
 * The cartoon boing: a sine sliding down with a decaying vibrato riding it.
 * The vibrato depth is what separates a boing from a bad synth pad.
 */
export function boing(ctx, dest, t0, o = {}) {
  const f0 = o.f0 ?? 420, f1 = o.f1 ?? 150, d = o.d ?? 0.5;
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(f0, t0);
  osc.frequency.exponentialRampToValueAtTime(f1, t0 + d);
  const lfo = ctx.createOscillator(); lfo.frequency.value = o.rate ?? 11;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(o.depth ?? 90, t0);
  depth.gain.exponentialRampToValueAtTime(0.5, t0 + d * 0.9);
  lfo.connect(depth).connect(osc.frequency);
  const e = envGain(ctx, t0, { peak: o.g ?? 0.16, a: 0.004, d });
  osc.connect(e).connect(dest);
  osc.start(t0); lfo.start(t0);
  osc.stop(t0 + d + 0.05); lfo.stop(t0 + d + 0.05);
}

/**
 * Slide whistle. Sine plus a whisper of its second harmonic plus breath — the
 * breath is the whole trick, a bare sine reads as a test tone.
 */
export function slideWhistle(ctx, dest, t0, o = {}) {
  const f0 = o.f0 ?? 900, f1 = o.f1 ?? 300, d = o.d ?? 0.4, g = o.g ?? 0.14;
  const mk = (mult, lvl) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * mult, t0);
    if (o.f2) {
      osc.frequency.exponentialRampToValueAtTime(o.f2 * mult, t0 + d * (o.split ?? 0.45));
      osc.frequency.exponentialRampToValueAtTime(f1 * mult, t0 + d);
    } else osc.frequency.exponentialRampToValueAtTime(f1 * mult, t0 + d);
    const e = envGain(ctx, t0, { peak: g * lvl, a: o.a ?? 0.02, hold: d * 0.5, d: d * 0.5, shapeA: 'lin' });
    osc.connect(e).connect(dest);
    osc.start(t0); osc.stop(t0 + d + 0.08);
  };
  mk(1, 1); mk(2, 0.11);
  burst(ctx, dest, t0, { f: f0 * 1.4, q: 1.2, g: g * 0.10, a: 0.02, hold: d * 0.5, d: d * 0.5, color: 'pink' });
}

/* --- formant voice --------------------------------------------------------
 * Used for the dog and for the mother at the window. Three parallel band-passes
 * over a glottal-ish saw. Not speech synthesis — a caricature of a vowel, which
 * is exactly what carries across sixty feet of street.
 */
export const VOWELS = {
  a: [730, 1090, 2440], ae: [660, 1720, 2410], e: [530, 1840, 2480],
  i: [270, 2290, 3010], ih: [390, 1990, 2550], o: [570, 840, 2410],
  u: [300, 870, 2240], uh: [640, 1190, 2390], aw: [570, 840, 2410],
};

export function formantVoice(ctx, dest, t0, o) {
  const dur = o.dur ?? 0.3;
  const src = ctx.createOscillator();
  src.type = o.type || 'sawtooth';
  const f = src.frequency;
  const pts = o.pitch || [[0, 300]];
  f.setValueAtTime(pts[0][1], t0);
  for (let i = 1; i < pts.length; i++) f.exponentialRampToValueAtTime(Math.max(20, pts[i][1]), t0 + pts[i][0]);
  const pre = gain(ctx, 1);
  src.connect(pre);
  if (o.rasp) burst(ctx, pre, t0, { f: 1400, q: 0.5, g: o.rasp, a: 0.006, hold: dur * 0.6, d: dur * 0.4, color: 'pink' });

  const amp = envGain(ctx, t0, {
    peak: o.g ?? 0.2, a: o.a ?? 0.02, hold: o.hold ?? dur * 0.55, d: o.d ?? dur * 0.5,
    shapeA: o.shapeA ?? 'lin', shapeD: o.shapeD,
  });
  const F = o.formants || VOWELS.a;
  const scale = o.fScale ?? 1;
  const lvl = o.fGains || [1, 0.5, 0.2];
  for (let i = 0; i < 3; i++) {
    const fr = F[i] * scale;
    const filt = bp(ctx, fr, fr / (o.bw ? o.bw[i] : [80, 110, 190][i]));
    if (o.formantsTo) {
      filt.frequency.setValueAtTime(fr, t0);
      filt.frequency.linearRampToValueAtTime(o.formantsTo[i] * scale, t0 + dur * (o.morph ?? 0.6));
    }
    chain(pre, filt, gain(ctx, lvl[i]), amp);
  }
  amp.connect(dest);
  src.start(t0); src.stop(t0 + dur + 0.08);
  return amp;
}

/* --- the syllable engine for the mother -----------------------------------
 * Reads kid.call straight off the roster ("SAL-VA-TO-RE! SUPPER!") and calls it
 * out of a third-floor window. DESIGN-BIBLE §7.5: dialect is a performance,
 * never a spelling — so nothing here is written phonetically, the accent is
 * entirely in the contour.
 */
const VOWEL_OF = [
  ['oo', 'u'], ['ou', 'u'], ['ee', 'i'], ['ea', 'i'], ['ie', 'i'], ['ei', 'i'],
  ['oi', 'o'], ['oy', 'o'], ['oa', 'o'], ['ai', 'e'], ['ay', 'e'], ['au', 'aw'],
  ['a', 'a'], ['e', 'e'], ['i', 'ih'], ['o', 'o'], ['u', 'uh'], ['y', 'i'],
];
export function syllables(text) {
  const out = [];
  for (const word of String(text).split(/\s+/)) {
    const parts = word.replace(/[!.,?]/g, '').split('-').filter(Boolean);
    const w = [];
    for (const p of parts) {
      const low = p.toLowerCase();
      let v = 'a';
      for (const [pat, vow] of VOWEL_OF) if (low.includes(pat)) { v = vow; break; }
      const onset = low[0];
      w.push({ v, onset, text: p });
    }
    if (w.length) out.push(w);
  }
  return out;
}

/* =============================================================================
 * 2. THE CUE TABLE
 * ========================================================================== */
export const CUES = Object.create(null);

/** Public: any piece may add a cue to the one graph (per-kid stings, announcer). */
export function registerCue(name, def) {
  if (!def || typeof def.build !== 'function') throw new Error('cue "' + name + '" needs build()');
  CUES[name] = { bus: 'sfx', gain: 1, dur: 1, dist: 0, ...def, name };
  return CUES[name];
}
export function listCues() { return Object.keys(CUES).sort(); }

/**
 * Other pieces name their sounds for the OBJECT, not for this file — the world
 * piece registers `sound: 'iron_ring'` on a lamppost and `sound: 'wood_knock'`
 * on a pushcart. Those are better names than mine and it is not their job to
 * know my registry, so the aliases live here.
 */
export const CUE_ALIAS = {
  iron_ring: 'clang_iron', iron_clang: 'clang_iron', clang: 'clang_iron',
  wood_knock: 'thud_wood', wood: 'thud_wood',
  sewer_plink: 'sewer_swallow', sewer: 'sewer_swallow',
  glass_break: 'window_break', glass: 'window_flex',
  bounce: 'bounce_asphalt', asphalt: 'bounce_asphalt', stone: 'bounce_stone',
  belgian: 'bounce_stone', brick: 'bounce_brick', tin: 'clatter_tin',
  cloth: 'flap_cloth', laundry: 'flap_cloth', awning: 'canvas_whump',
  car: 'thunk_fender', fender: 'thunk_fender', manhole: 'manhole_boom',
  cans: 'clatter_tin', step: 'step_asphalt', footstep: 'step_asphalt',
};
export function getCue(name) { return CUES[name] || CUES[CUE_ALIAS[name]] || null; }

/* -----------------------------------------------------------------------------
 * 2.1 THE BROOMSTICK — the most important sound in the game
 * ---------------------------------------------------------------------------
 * A spaldeen is solid pink rubber and a broomstick is a thin ash rod. Together
 * they do NOT make a baseball crack (a baseball crack is ash-on-cork-and-yarn,
 * 2-5 kHz, and it rings). They make a dry HOLLOW POCK: a 2 ms contact click, a
 * handful of rod bending modes around 350/690/1200 Hz that die in under a tenth
 * of a second, and the ball's own dull 190 Hz belly-flop underneath.
 * Three tiers, exactly as DESIGN-BIBLE §7.4 asks: dull thock / sharp crack /
 * crack + low thump.
 * ------------------------------------------------------------------------- */
function broomstick(ctx, out, t0, o, tier) {
  const P = tier;
  const body = gain(ctx, 1);
  // the handle is a hollow tube: one strong resonance, a scooped box below it,
  // and nothing at all above 5 kHz, which is the whole difference between a
  // broomstick pock and a baseball crack
  chain(body, pk(ctx, P.tubeF, 1.25, P.tubeDb), pk(ctx, P.tubeF * 0.42, 1.1, -5), lp(ctx, P.lpf, 0.9), out);

  // 1. contact click — wood meeting rubber, six milliseconds of it
  burst(ctx, body, t0, { f: P.clickF, q: 0.85, g: P.click, a: 0, d: P.clickD });
  // 2. the rod's bending modes (a rod is inharmonic: 1 : 2.76 : 5.4), all struck
  //    in phase, which is what makes the front edge of the sound
  for (const [mult, g, d] of P.modes) {
    partial(ctx, body, t0, { f: P.f0 * mult, g: P.g * g, d, a: 0, phase: 'cos' });
  }
  // 3. the ball itself: pink rubber squashing flat and coming back
  partial(ctx, body, t0, { f: P.ballF, glideTo: P.ballF * 0.72, glideTime: 0.05, g: P.g * P.ball, d: P.ballD, a: 0, phase: 'cos' });
  // 4. grain — the dry scrape of a painted handle
  burst(ctx, body, t0, { f: 1700, q: 0.7, g: P.g * 0.34, a: 0.0006, d: 0.022, color: 'pink' });
  if (P.thump) {
    // THE WALLOP'S WEIGHT. A sewer shot is not a louder pock, it is a pock with a
    // building's worth of low end hung under it: 78 Hz sagging to 46 over a quarter
    // of a second, which is long enough that you hear it arrive AFTER the click.
    partial(ctx, out, t0 + 0.022, { f: 78, glideTo: 46, glideTime: 0.26, g: P.thump, d: 0.52, a: 0.010, hold: 0.062 });
    // and one octave under that, so the stoop feels it. Starts 30 ms late on purpose
    // — the block is bigger than the stick and it answers a beat behind.
    partial(ctx, out, t0 + 0.030, { f: 39, g: 0.09, d: 0.60, a: 0.014, hold: 0.070 });
    burst(ctx, out, t0 + 0.024, { f: 220, type: 'lp', q: 0.8, g: 0.07, a: 0.006, d: 0.14 });
  }
  // The follow-through the stick is still doing after the ball has gone. `bat:swing`
  // already fired `whiff` ~200 ms ago, and two swooshes for one swing is the seam a
  // critic hears first — so engine.js passes { air: 0 } when the whiff is still live
  // and this burst stands down. One follow-through per swing, never two.
  if (P.air && o.air !== 0) {
    burst(ctx, out, t0 + 0.012, { f: 900, fTo: 2600, fTime: 0.10, q: 0.7, g: P.air, a: 0.02, d: 0.10, color: 'pink' });
  }
}

const TIER_POCK = {
  f0: 352, g: 0.30, tubeF: 690, tubeDb: 7, lpf: 5000,
  clickF: 2100, click: 0.30, clickD: 0.007,
  modes: [[1, 0.34, 0.098], [1.96, 1.0, 0.092], [2.76, 0.68, 0.058], [4.24, 0.38, 0.034], [6.2, 0.19, 0.020]],
  ballF: 196, ball: 0.30, ballD: 0.078,
};
const TIER_THOCK = {
  f0: 300, g: 0.30, tubeF: 545, tubeDb: 6, lpf: 2300,
  clickF: 1250, click: 0.15, clickD: 0.006,
  modes: [[1, 0.72, 0.070], [1.86, 0.85, 0.048], [2.76, 0.30, 0.026], [4.24, 0.10, 0.014]],
  ballF: 168, ball: 0.62, ballD: 0.105,
};
const TIER_WALLOP = {
  f0: 360, g: 0.31, tubeF: 700, tubeDb: 7, lpf: 6400,
  clickF: 2500, click: 0.36, clickD: 0.008,
  // 1.5x the pock's mode decays: the rod is loaded harder and it rings longer, which
  // is the whole difference between "he got it" and "he GOT it".
  modes: [[1, 0.36, 0.180], [1.96, 1.0, 0.165], [2.76, 0.72, 0.096], [4.24, 0.44, 0.057], [6.2, 0.24, 0.033]],
  ballF: 205, ball: 0.30, ballD: 0.10,
  thump: 0.26, air: 0.055,
};

registerCue('crack', {
  bus: 'sfx', gain: 1.5, dur: 0.5, send: 0.19,
  note: 'broomstick meets spaldeen, square on. Hollow pock, not a baseball crack.',
  build(ctx, out, t0, o) { broomstick(ctx, out, t0, o, TIER_POCK); },
});
registerCue('crack_weak', {
  bus: 'sfx', gain: 1.35, dur: 0.4,
  note: 'off the end of the stick. Dull thock, all ball and no rod.',
  build(ctx, out, t0, o) { broomstick(ctx, out, t0, o, TIER_THOCK); },
});
registerCue('crack_wallop', {
  bus: 'sfx', gain: 2.4, dur: 1.1, send: 0.17,
  note: 'two sewers worth. Pock + a low thump the whole block feels.',
  build(ctx, out, t0, o) { broomstick(ctx, out, t0, o, TIER_WALLOP); },
});

registerCue('foul_tip', {
  bus: 'sfx', gain: 3.4, dur: 0.2,
  note: 'a tick off the very end. One millisecond of wood, then nothing.',
  build(ctx, out, t0) {
    burst(ctx, out, t0, { f: 3100, q: 1.1, g: 0.22, a: 0.0003, d: 0.006 });
    partial(ctx, out, t0, { f: 980, g: 0.14, d: 0.028 });
    partial(ctx, out, t0, { f: 1640, g: 0.07, d: 0.018 });
  },
});

registerCue('whiff', {
  bus: 'sfx', gain: 1.35, dur: 0.45,
  note: 'a broomstick through empty air. Air first, then the stick still ringing faintly.',
  build(ctx, out, t0, o) {
    const s = o.speed ?? 1;
    // The swoosh CRESCENDOES INTO THE BALL. `bat:swing` fires when the kid commits
    // and `bat:contact` fires 150-220 ms later when the ball reaches the plate, so
    // a swoosh that peaked at 80 ms was already over before the stick got there —
    // it read as two separate events instead of one swing. The plateau now sits
    // 105-155 ms in, which is where contact actually lands, and engine.js cuts the
    // whole thing over 12 ms the instant the ball is struck.
    const src = noiseSrc(ctx, t0, 0.40, 'pink', 0.7);
    const f = bp(ctx, 420, 1.5);
    f.frequency.setValueAtTime(380, t0);
    f.frequency.exponentialRampToValueAtTime(2100 * s, t0 + 0.145);
    f.frequency.exponentialRampToValueAtTime(560, t0 + 0.34);
    f.Q.setValueAtTime(1.1, t0);
    f.Q.linearRampToValueAtTime(3.2, t0 + 0.16);
    const e = envGain(ctx, t0, { peak: 1.9, a: 0.105, hold: 0.05, d: 0.17, shapeA: 'lin' });
    chain(src, f, e, out);
    // a second, higher, later band = the tip of the stick, which is going faster
    const s2 = noiseSrc(ctx, t0 + 0.03, 0.30, 'pink', 1.9);
    const f2 = bp(ctx, 1400, 2.4);
    f2.frequency.setValueAtTime(1200, t0 + 0.03);
    f2.frequency.exponentialRampToValueAtTime(3600 * s, t0 + 0.155);
    f2.frequency.exponentialRampToValueAtTime(1500, t0 + 0.30);
    chain(s2, f2, envGain(ctx, t0 + 0.03, { peak: 0.85, a: 0.095, d: 0.16, shapeA: 'lin' }), out);
    // and the handle grumbling in the kid's hands afterwards
    partial(ctx, out, t0 + 0.17, { f: 168, g: 0.12, d: 0.10, a: 0.01 });
  },
});

registerCue('bat_drop', {
  bus: 'sfx', gain: 1.15, dur: 1.4,
  note: 'the stick let go of on the way to first: clack, clack-clack-clack, then it rolls.',
  build(ctx, out, t0, o) {
    const r = o.rnd;
    const wood = (t, g, det) => {
      for (const [f, a, d] of [[338, 0.9, 0.055], [612, 0.7, 0.036], [968, 0.34, 0.022], [1520, 0.14, 0.014]]) {
        partial(ctx, out, t, { f: f * det, g: g * a, d, a: 0.0009 });
      }
      burst(ctx, out, t, { f: 2300 * det, q: 0.9, g: g * 0.5, a: 0.0004, d: 0.008 });
    };
    // it lands, it bounces, and each bounce is faster and smaller than the last
    let t = t0, dt = 0.135, g = 0.36;
    for (let i = 0; i < 5; i++) {
      wood(t, g, 1 + r.range(-0.05, 0.05));
      t += dt; dt *= 0.63; g *= 0.55;
    }
    // then a length of ash rolling on asphalt — grit modulated by the roll rate
    const roll = noiseSrc(ctx, t, 0.55, 'pink', 3.1);
    const rf = bp(ctx, 900, 1.4);
    rf.frequency.setValueAtTime(1000, t);
    rf.frequency.exponentialRampToValueAtTime(520, t + 0.5);
    const am = gain(ctx, 0.5);
    const lfo = ctx.createOscillator(); lfo.type = 'triangle';
    lfo.frequency.setValueAtTime(17, t); lfo.frequency.linearRampToValueAtTime(7, t + 0.5);
    lfo.connect(gain(ctx, 0.5)).connect(am.gain);
    lfo.start(t); lfo.stop(t + 0.6);
    chain(roll, rf, am, envGain(ctx, t, { peak: 0.075, a: 0.02, hold: 0.12, d: 0.36, shapeA: 'lin' }), out);
  },
});

registerCue('catch', {
  bus: 'sfx', gain: 1.55, dur: 0.4,
  note: 'a rubber ball into two bare hands. Nobody on this block owns a glove.',
  build(ctx, out, t0, o) {
    burst(ctx, out, t0, { f: 1450, type: 'lp', q: 0.9, g: 0.50, a: 0.0008, d: 0.045 });
    partial(ctx, out, t0, { f: 236, glideTo: 152, glideTime: 0.06, g: 0.22, d: 0.070, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 480, g: 0.15, d: 0.030, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 940, g: 0.06, d: 0.016, a: 0, phase: 'cos' });
    // the little squeak of rubber dragging on a palm
    const sq = ctx.createOscillator(); sq.type = 'sine';
    sq.frequency.setValueAtTime(1180, t0 + 0.012);
    sq.frequency.exponentialRampToValueAtTime(1560, t0 + 0.05);
    const v = ctx.createOscillator(); v.frequency.value = 42;
    v.connect(gain(ctx, 60)).connect(sq.frequency);
    sq.connect(envGain(ctx, t0 + 0.012, { peak: 0.035, a: 0.006, d: 0.04 })).connect(out);
    sq.start(t0 + 0.012); sq.stop(t0 + 0.08); v.start(t0 + 0.012); v.stop(t0 + 0.08);
  },
});

registerCue('catch_muff', {
  bus: 'sfx', gain: 3.6, dur: 0.8,
  note: 'had it. Then did not have it. Then had it again, off a knee.',
  build(ctx, out, t0, o) {
    burst(ctx, out, t0, { f: 1250, type: 'lp', q: 0.9, g: 0.26, a: 0.0012, d: 0.038 });
    partial(ctx, out, t0, { f: 232, g: 0.14, d: 0.06 });
    burst(ctx, out, t0 + 0.115, { f: 900, type: 'lp', q: 0.9, g: 0.15, a: 0.001, d: 0.03 });
    partial(ctx, out, t0 + 0.115, { f: 196, g: 0.09, d: 0.05 });
    burst(ctx, out, t0 + 0.205, { f: 700, type: 'lp', q: 0.9, g: 0.10, a: 0.001, d: 0.026 });
    partial(ctx, out, t0 + 0.205, { f: 172, g: 0.07, d: 0.045 });
    // and the boing of a knee, because it is funnier than a catch
    boing(ctx, out, t0 + 0.30, { f0: 300, f1: 128, d: 0.34, rate: 13, depth: 62, g: 0.075 });
  },
});

/* -----------------------------------------------------------------------------
 * 2.2 THE BALL AND THE BLOCK
 * A rubber ball in a stone canyon is the whole comedy engine (DESIGN-BIBLE §8.1)
 * so every surface in world/colliders.js gets its own named sound, and the sound
 * is what tells the player what the ball just did without looking.
 * ------------------------------------------------------------------------- */

registerCue('bounce_asphalt', {
  bus: 'sfx', gain: 1.2, dur: 0.3,
  note: 'spaldeen on the crown of the roadway. Dark, dead, gone in 60 ms.',
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.35, 1.6);
    partial(ctx, out, t0, { f: 158 * s, glideTo: 108, glideTime: 0.05, g: 0.30, d: 0.052, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 452 * s, g: 0.26, d: 0.028, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 880 * s, g: 0.11, d: 0.017, a: 0, phase: 'cos' });
    burst(ctx, out, t0, { f: 1700 * s, q: 0.7, g: 0.20 * s, a: 0.0005, d: 0.014, color: 'pink' });
    burst(ctx, out, t0, { f: 4200, type: 'hp', q: 0.6, g: 0.050, a: 0.0005, d: 0.018 });
  },
});

registerCue('bounce_stone', {
  bus: 'sfx', gain: 1.18, dur: 0.35,
  note: 'Belgian block in the gutter: harder, brighter, and it ticks.',
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.35, 1.6);
    burst(ctx, out, t0, { f: 2900 * s, q: 0.9, g: 0.32 * s, a: 0.0003, d: 0.009 });
    partial(ctx, out, t0, { f: 272 * s, glideTo: 208, glideTime: 0.04, g: 0.20, d: 0.040, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 760 * s, g: 0.26, d: 0.030, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 1310 * s, g: 0.15, d: 0.017, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 2180 * s, g: 0.07, d: 0.010, a: 0, phase: 'cos' });
  },
});

registerCue('bounce_brick', {
  bus: 'sfx', gain: 1.14, dur: 0.4,
  note: 'off the tenement wall. Courses of brick comb the reflection — that flutter is real.',
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.35, 1.6);
    const c = comb(ctx, 1180, 0.62, true);
    chain(c.out, lp(ctx, 3800, 0.8), out);
    partial(ctx, c.in, t0, { f: 182 * s, glideTo: 130, glideTime: 0.05, g: 0.22, d: 0.050, a: 0, phase: 'cos' });
    partial(ctx, c.in, t0, { f: 545 * s, g: 0.24, d: 0.030, a: 0, phase: 'cos' });
    partial(ctx, c.in, t0, { f: 1040 * s, g: 0.14, d: 0.018, a: 0, phase: 'cos' });
    burst(ctx, c.in, t0, { f: 2100, q: 0.6, g: 0.30 * s, a: 0.0005, d: 0.016, color: 'pink' });
    // brick dust, which you hear more than you would think
    burst(ctx, out, t0 + 0.004, { f: 5200, type: 'hp', q: 0.5, g: 0.055, a: 0.002, d: 0.075 });
  },
});

registerCue('thud_wood', {
  bus: 'sfx', gain: 0.88, dur: 0.35,
  note: 'a crate, a stoop rail, the pushcart. Knuckle-on-a-door dull.',
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.4, 1.5);
    burst(ctx, out, t0, { f: 1800, q: 0.8, g: 0.22 * s, a: 0.0004, d: 0.010 });
    for (const [f, g, d] of [[192, 0.30, 0.080], [322, 0.26, 0.052], [534, 0.17, 0.030], [896, 0.09, 0.018], [1420, 0.04, 0.011]]) {
      partial(ctx, out, t0, { f: f * s, g, d, a: 0, phase: 'cos' });
    }
  },
});

/* --- fire-escape iron: it rings, and it rings DOWN THE LADDER --------------
 * §7.4 asks for one thing here and it is not a clang: "pitched, and it rings
 * down the ladder rung by rung." That is a STAIRCASE, and a staircase is only a
 * staircase if you can count the steps. Seven rungs, each a fifth of a tone
 * lower than the last, and the gaps get WIDER as the ball runs out of bounce.
 *
 * That widening is deliberate and it is the opposite of `ashcan_lid`, whose
 * contacts accelerate to a buzz like a dropped coin. Two cartoon lies about two
 * different objects: the lid is falling FLAT and speeds up; the ball is walking
 * DOWN and slows down. Put the two analysis PNGs side by side and they are
 * mirror images, which is how you know they are not the same sound twice.
 * ------------------------------------------------------------------------- */
registerCue('clang_iron', {
  bus: 'sfx', gain: 1.05, dur: 1.95, send: 0.18,
  note: '§7.4: fire-escape iron, pitched, walking DOWN the ladder — 7 countable rungs over ~0.92 s, gaps widening as the bounce dies. The mirror of ashcan_lid.',
  build(ctx, out, t0, o) {
    const p = clamp(o.pitch ?? 1, 0.45, 1.5);
    const s = clamp(o.speed ?? 1, 0.4, 1.5);
    const f0 = 645 * p;

    // 0. THE LADDER ITSELF. A fire escape is forty feet of bolted steel hung off a
    //    brick wall: touch it anywhere and the whole frame answers for two seconds.
    //    This is the only envelope in the file that fades LINEARLY — a big welded
    //    structure does not decay like a struck bar — and, practically, it is the
    //    smooth floor the seven rungs have to stand on to be countable at all.
    //    The broadband part matters as much as the tuned part: three sine partials
    //    alone beat against each other and the floor ripples, and a rippling floor
    //    eats the small late rungs.
    const FR = 0.092 * s;
    const frame = gain(ctx, 1);
    chain(frame, lp(ctx, 950, 0.9), pk(ctx, 205 * p, 1.1, 4), out);
    for (const [mult, g] of [[0.181, 1.0], [0.290, 0.62], [0.410, 0.34]]) {
      partial(ctx, frame, t0 + 0.003, { f: f0 * mult, g: FR * g, d: 1.95, a: 0.010, hold: 0.03, shapeD: 'lin', phase: 'cos' });
    }
    const rum = noiseSrc(ctx, t0, 1.98, 'brown', 1.3);
    chain(rum, bp(ctx, 190 * p, 0.7), envGain(ctx, t0, { peak: FR * 1.7, a: 0.015, hold: 0.04, d: 1.92, shapeA: 'lin', shapeD: 'lin' }), frame);

    // 1. THE PLATFORM GRATING, clipped on the way in. Many modes, long decays,
    //    and it is the brightest thing here — the ball hits it edge-on.
    metal(ctx, out, t0, {
      f0, g: 0.150 * s, strike: 0.42, strikeF: f0 * 4.1, strikeD: 0.010, beat: 1.6,
      ratios: [1, 1.52, 2.34, 3.06, 4.21, 5.44, 7.1],
      gains: [0.85, 1.0, 0.66, 0.44, 0.30, 0.19, 0.10],
      decays: [0.26, 0.30, 0.20, 0.15, 0.10, 0.070, 0.044],
    });

    // 2. THE DESCENT. A rung is one 3/4-inch bar, so it is a NOTE and not a crash:
    //    four modes, short decays, gone before the next one lands. Tight on purpose
    //    — the rungs are the spikes, the frame is the floor, and keeping those two
    //    jobs in separate objects is what makes the staircase readable.
    const rung = (t, ff, g) => metal(ctx, out, t, {
      f0: ff, g, strike: 0.55, strikeF: ff * 3.4, strikeD: 0.006, beat: 1.15,
      ratios: [1, 2.44, 3.92, 6.05],
      gains: [1.0, 0.50, 0.26, 0.11],
      decays: [0.098, 0.066, 0.045, 0.028],
    });
    // dt GROWS 6% a rung. The ball has less bounce left every time, so it takes
    // longer to reach the next bar — the exact opposite of ashcan_lid, whose
    // contacts accelerate. Same cartoon lie, two different objects, and the two
    // analysis PNGs are mirror images of each other.
    // LEVEL TAPER 0.84, not the 0.72 the pock uses. Two reasons, one measured and
    // one physical. Measured: at 0.72 the seventh rung is 14% of the first, which
    // in the audition envelope is a 7-pixel ripple on the floor — the numbers said
    // "staircase" and the picture said "wash", and the picture is the thing §7.4
    // actually asks for. Physical: the ball is FALLING between rungs, so gravity
    // hands back most of what the bounce takes, and impact speed barely drops.
    // 0.84 gives seven rungs you can count in the PNG and in the ear.
    let t = t0 + 0.115, f = f0 * 0.90, g = 0.255 * s, dt = 0.115;
    for (let i = 0; i < 7; i++) {
      rung(t, f, g);
      t += dt; dt *= 1.06; f *= 0.90; g *= 0.84;
    }

    // 3. the grating buzzing about it, all the way down
    const bz = noiseSrc(ctx, t0 + 0.02, 0.55, 'white', 2.3);
    const bf = bp(ctx, 2400 * p, 6);
    const am = gain(ctx, 0.5);
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 47;
    lfo.connect(gain(ctx, 0.5)).connect(am.gain);
    lfo.start(t0 + 0.02); lfo.stop(t0 + 0.58);
    chain(bz, bf, am, envGain(ctx, t0 + 0.02, { peak: 0.030 * s, a: 0.004, hold: 0.10, d: 0.40 }), out);
  },
});

/* --- ash cans: the body, and then the lid ---------------------------------- */
registerCue('clatter_tin', {
  bus: 'sfx', gain: 0.42, dur: 0.9,
  note: 'the side of a galvanised ash can. Boxy, buzzy, and it rocks on the sidewalk.',
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.4, 1.5);
    metal(ctx, out, t0, {
      f0: 384, g: 0.26 * s, strike: 0.6, strikeF: 1900, strikeD: 0.012, beat: 2.4,
      ratios: [1, 1.41, 1.93, 2.58, 3.4, 4.6, 6.1],
      gains: [0.9, 1.0, 0.62, 0.40, 0.26, 0.15, 0.08],
      decays: [0.19, 0.15, 0.11, 0.085, 0.06, 0.042, 0.03],
    });
    partial(ctx, out, t0, { f: 96, g: 0.10, d: 0.09, a: 0.002 });
    // it rocks twice on the flags and settles
    metal(ctx, out, t0 + 0.19, { f0: 384, g: 0.09 * s, strike: 0.3, strikeF: 1700, strikeD: 0.008, ratios: [1, 1.41, 2.58], gains: [0.9, 1, 0.4], decays: [0.13, 0.10, 0.06] });
    metal(ctx, out, t0 + 0.315, { f0: 384, g: 0.045 * s, strike: 0.2, ratios: [1, 1.41], gains: [0.8, 1], decays: [0.09, 0.07] });
  },
});

registerCue('ashcan_lid', {
  bus: 'sfx', gain: 0.36, dur: 2.4,
  note: 'the lid comes off. §7.4: clang, then the classic wobble-to-flat, all of it.',
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.5, 1.4);
    // the clang
    metal(ctx, out, t0, {
      f0: 438, g: 0.30 * s, strike: 0.7, strikeF: 2600, strikeD: 0.016, beat: 3.1,
      ratios: [1, 1.36, 1.88, 2.44, 3.22, 4.35, 5.7, 7.4],
      gains: [0.8, 1.0, 0.70, 0.48, 0.33, 0.21, 0.13, 0.07],
      decays: [0.55, 0.48, 0.36, 0.27, 0.19, 0.13, 0.09, 0.06],
    });
    // the wobble: contacts that accelerate geometrically to a buzz, like a dropped coin
    const ring = gain(ctx, 1);
    chain(ring, bp(ctx, 1500, 1.1), out);
    let t = t0 + 0.30, dt = 0.145, g = 0.52 * s;
    for (let i = 0; i < 30 && dt > 0.0065; i++) {
      metal(ctx, ring, t, {
        f0: 438 * (1 + i * 0.005), g, strike: 0.5, strikeF: 3100, strikeD: 0.005,
        ratios: [1, 1.36, 2.44, 4.35], gains: [0.7, 1.0, 0.45, 0.2], decays: [0.055, 0.045, 0.028, 0.016],
      });
      t += dt; dt *= 0.868; g *= 0.955;
    }
    // ...and flat. One last dead scrape of tin on bluestone.
    burst(ctx, out, t + 0.01, { f: 2100, q: 0.8, g: 0.22, a: 0.003, d: 0.11, color: 'pink' });
    partial(ctx, out, t + 0.01, { f: 438, g: 0.10, d: 0.13, a: 0, phase: 'cos' });
  },
});

registerCue('thunk_fender', {
  bus: 'sfx', gain: 0.54, dur: 1.0,
  note: "Model T fender. §7.4: a tin tonk, and then a spring boing, because of course.",
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.4, 1.5);
    // curved sheet tin, heavily damped by the car behind it
    metal(ctx, out, t0, {
      f0: 322, g: 0.30 * s, strike: 0.55, strikeF: 1800, strikeD: 0.011, beat: 1.9,
      ratios: [1, 1.49, 1.91, 2.82, 3.9, 5.2],
      gains: [1.0, 0.72, 0.50, 0.28, 0.16, 0.09],
      decays: [0.16, 0.12, 0.09, 0.06, 0.04, 0.028],
    });
    partial(ctx, out, t0, { f: 92, g: 0.075, d: 0.11, a: 0, phase: 'cos' });
    // the leaf spring underneath takes it personally
    boing(ctx, out, t0 + 0.018, { f0: 405, f1: 132, d: 0.52, rate: 12.5, depth: 92, g: 0.115 * s });
    // and a hubcap rattles somewhere behind it
    burst(ctx, out, t0 + 0.09, { f: 3400, q: 3, g: 0.030, a: 0.005, d: 0.22 });
  },
});

registerCue('flap_cloth', {
  bus: 'sfx', gain: 2.3, dur: 0.7,
  note: 'into the laundry on the line. Cloth kills a rubber ball dead — no bounce, ever.',
  build(ctx, out, t0, o) {
    burst(ctx, out, t0, { f: 800, type: 'lp', q: 0.8, g: 0.60, a: 0.003, d: 0.080, color: 'pink' });
    partial(ctx, out, t0, { f: 120, g: 0.12, d: 0.085, a: 0.003, phase: 'cos' });
    // sheets snapping back on the line
    for (const [dt, g, f] of [[0.075, 0.34, 1500], [0.155, 0.24, 1250], [0.245, 0.15, 1050], [0.36, 0.085, 900]]) {
      burst(ctx, out, t0 + dt, { f, q: 0.9, g, a: 0.005, d: 0.05, color: 'pink' });
    }
    // the clothesline itself thrumming, and a wooden peg letting go
    partial(ctx, out, t0 + 0.03, { f: 76, g: 0.07, d: 0.34, a: 0.02 });
    burst(ctx, out, t0 + 0.29, { f: 2600, q: 1.6, g: 0.14, a: 0.0004, d: 0.012 });
  },
});

registerCue('canvas_whump', {
  bus: 'sfx', gain: 1.8, dur: 1.0,
  note: "storefront awning. §7.4: canvas whump, and a slide whistle rides the rebound.",
  build(ctx, out, t0, o) {
    burst(ctx, out, t0, { f: 460, type: 'lp', q: 0.9, g: 0.34, a: 0.002, d: 0.070, color: 'pink' });
    partial(ctx, out, t0, { f: 98, g: 0.10, d: 0.11, a: 0.003, phase: 'cos' });
    // the frame, which is tin, and the canvas rebounding off it
    partial(ctx, out, t0 + 0.008, { f: 660, g: 0.10, d: 0.05, a: 0, phase: 'cos' });
    burst(ctx, out, t0 + 0.10, { f: 1400, q: 0.8, g: 0.22, a: 0.006, d: 0.06, color: 'pink' });
    slideWhistle(ctx, out, t0 + 0.085, { f0: 540, f2: 1550, f1: 780, d: 0.34, g: 0.36, split: 0.5 });
    burst(ctx, out, t0 + 0.30, { f: 1000, q: 0.9, g: 0.10, a: 0.008, d: 0.09, color: 'pink' });
  },
});

/* --- plate glass: the boom that does NOT break, and the beat of silence ----- */
registerCue('window_flex', {
  bus: 'sfx', gain: 1.7, dur: 2.4, send: 0.22,
  note: "§7.4/§9.5: a flat terrifying boom, then ONE FULL BEAT of nothing, then one small thing.",
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.5, 1.4);
    // the pane, which is four feet across and does not want to be
    partial(ctx, out, t0, { f: 56, g: 0.40 * s, d: 0.40, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 84, g: 0.26, d: 0.30, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 141, g: 0.18, d: 0.22, a: 0, phase: 'cos' });
    burst(ctx, out, t0, { f: 300, type: 'lp', q: 1.2, g: 0.30, a: 0.0012, d: 0.10 });
    // the flex: the glass wobbling in the putty, which is the terrifying part
    const w = ctx.createOscillator(); w.type = 'sine';
    w.frequency.setValueAtTime(196, t0);
    const wl = ctx.createOscillator(); wl.frequency.value = 19;
    wl.connect(gain(ctx, 26)).connect(w.frequency);
    w.connect(envGain(ctx, t0, { peak: 0.075, a: 0.006, d: 0.30 })).connect(out);
    w.start(t0); w.stop(t0 + 0.36); wl.start(t0); wl.stop(t0 + 0.36);
    burst(ctx, out, t0 + 0.002, { f: 2400, q: 0.8, g: 0.055, a: 0.0006, d: 0.020 });
    // ---- and now nothing at all, for a whole beat, because that is the joke ----
    // ---- 1.35 seconds later, exactly one small guilty noise: a lid falling over.
    metal(ctx, out, t0 + 1.42, {
      f0: 402, g: 0.038, strike: 0.4, strikeF: 2400, strikeD: 0.006,
      ratios: [1, 1.36, 2.44], gains: [0.7, 1, 0.4], decays: [0.12, 0.09, 0.05],
    });
    metal(ctx, out, t0 + 1.53, { f0: 402, g: 0.020, strike: 0.2, ratios: [1, 1.36], gains: [0.8, 1], decays: [0.08, 0.06] });
  },
});

registerCue('window_break', {
  bus: 'sfx', gain: 1.3, dur: 2.6, send: 0.20,
  note: 'the deli pane, and then everybody runs. Snap, shower, and shards on the sidewalk.',
  build(ctx, out, t0, o) {
    const r = o.rnd;
    // 1. the snap — the fracture itself, four milliseconds wide
    burst(ctx, out, t0, { f: 4400, q: 0.5, g: 0.60, a: 0.0002, d: 0.012 });
    burst(ctx, out, t0, { f: 2200, q: 0.6, g: 0.34, a: 0.0003, d: 0.030 });
    partial(ctx, out, t0, { f: 3150, g: 0.34, d: 0.055, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 5400, g: 0.20, d: 0.030, a: 0, phase: 'cos' });
    partial(ctx, out, t0 + 0.006, { f: 128, g: 0.055, d: 0.16, a: 0.004 });  // the pane letting go
    // 2. the shower — the pane arriving on the flags as a hundred small bright things
    const air = gain(ctx, 1);
    chain(air, hp(ctx, 900, 0.7), out);
    for (let i = 0; i < 86; i++) {
      const u = i / 86;
      const t = t0 + 0.012 + Math.pow(u, 1.55) * 0.95 + r.range(0, 0.02);
      const f = r.range(2400, 8200) * (1 - u * 0.34);
      const g = 0.26 * (1 - u * 0.70) * r.range(0.35, 1);
      burst(ctx, air, t, { f, q: r.range(4, 13), g, a: 0.0004, d: r.range(0.010, 0.045) });
      // a shard is a tuned plate: the ring is what makes it read as glass and not as static
      if (r.chance(0.8)) partial(ctx, air, t, { f: f * r.range(0.98, 1.02), g: g * 1.5, d: r.range(0.02, 0.07), a: 0, phase: 'cos' });
    }
    // 3. the big shards, later, lower, one at a time, on bluestone
    for (const [dt, f, g] of [[0.52, 1250, 0.075], [0.78, 980, 0.055], [1.06, 1420, 0.040], [1.44, 860, 0.028]]) {
      burst(ctx, out, t0 + dt, { f, q: 5, g, a: 0.0005, d: 0.045 });
      partial(ctx, out, t0 + dt, { f: f * 1.61, g: g * 0.5, d: 0.09 });
    }
  },
});

registerCue('sewer_swallow', {
  bus: 'sfx', gain: 1.65, dur: 2.2, send: 0.26,
  note: "§7.4: a plink on the grate, a descending slide whistle, and it is gone. Game over for that ball.",
  build(ctx, out, t0, o) {
    // the plink: the ball clipping an iron bar on the way in
    metal(ctx, out, t0, {
      f0: 1420, g: 0.16, strike: 0.5, strikeF: 4200, strikeD: 0.006, beat: 2.2,
      ratios: [1, 1.47, 2.1, 3.05], gains: [1, 0.6, 0.32, 0.15], decays: [0.09, 0.06, 0.04, 0.025],
    });
    partial(ctx, out, t0, { f: 205, g: 0.10, d: 0.05 });
    // down it goes
    slideWhistle(ctx, out, t0 + 0.045, { f0: 1500, f1: 205, d: 0.58, g: 0.135, a: 0.012 });
    // and lands in the water at the bottom of the catch basin, ten feet under the street
    const deep = gain(ctx, 1);
    chain(deep, lp(ctx, 620, 1.6), out);
    burst(ctx, deep, t0 + 0.66, { f: 380, type: 'lp', q: 1.4, g: 0.16, a: 0.002, d: 0.10 });
    partial(ctx, deep, t0 + 0.66, { f: 128, glideTo: 84, glideTime: 0.14, g: 0.11, d: 0.20, a: 0.004 });
    partial(ctx, deep, t0 + 0.70, { f: 262, g: 0.05, d: 0.16 });
    // a last, smaller, hopeless plop
    burst(ctx, deep, t0 + 0.94, { f: 300, type: 'lp', q: 1.2, g: 0.045, a: 0.002, d: 0.07 });
  },
});

registerCue('manhole_boom', {
  bus: 'sfx', gain: 0.62, dur: 1.4,
  note: "§7.4: the cover is home plate. A hollow boom, and a low timpani doink under it.",
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.4, 1.5);
    // 90 lb of cast iron over a hole
    metal(ctx, out, t0, {
      f0: 238, g: 0.24 * s, strike: 0.5, strikeF: 1500, strikeD: 0.010, beat: 1.2,
      ratios: [1, 1.58, 2.33, 3.4, 4.7], gains: [1, 0.55, 0.32, 0.16, 0.08],
      decays: [0.24, 0.17, 0.11, 0.07, 0.045],
    });
    // and the shaft under it, which is a drum ten feet deep
    partial(ctx, out, t0, { f: 63, glideTo: 47, glideTime: 0.30, g: 0.30, d: 0.52, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 96, g: 0.16, d: 0.34, a: 0, phase: 'cos' });
    burst(ctx, out, t0, { f: 170, type: 'lp', q: 1.5, g: 0.16, a: 0.002, d: 0.14 });
  },
});

registerCue('wood_boom', {
  bus: 'sfx', gain: 0.85, dur: 1.3,
  note: 'a bill-postered hoarding, or a cellar door. Thin boards over a void: it booms and it rattles.',
  build(ctx, out, t0, o) {
    const s = clamp(o.speed ?? 1, 0.4, 1.5);
    const r = o.rnd;
    // the board that was hit
    burst(ctx, out, t0, { f: 1500, q: 0.8, g: 0.30 * s, a: 0, d: 0.011 });
    for (const [f, g, d] of [[74, 0.34, 0.30], [118, 0.26, 0.22], [196, 0.20, 0.15], [312, 0.12, 0.09], [520, 0.06, 0.05]]) {
      partial(ctx, out, t0, { f: f * s, g, d, a: 0, phase: 'cos' });
    }
    // the void behind it
    burst(ctx, out, t0 + 0.004, { f: 190, type: 'lp', q: 1.4, g: 0.20, a: 0.003, d: 0.20 });
    // and every other board on the hoarding letting you know it is loose
    for (let i = 0; i < 7; i++) {
      const t = t0 + 0.03 + r.range(0, 0.34);
      partial(ctx, out, t, { f: r.range(150, 460), g: r.range(0.02, 0.065), d: r.range(0.03, 0.09), a: 0, phase: 'cos' });
      burst(ctx, out, t, { f: r.range(900, 2400), q: 1.4, g: r.range(0.015, 0.045), a: 0, d: 0.012 });
    }
  },
});

/* -----------------------------------------------------------------------------
 * 2.3 NINE PAIRS OF SHOES
 * Asphalt is soft, gritty and dead. Bluestone sidewalk is hard, bright and it
 * ticks, because these are leather soles with nails in them, not sneakers.
 * ------------------------------------------------------------------------- */
function step(ctx, out, t0, o, hard) {
  const s = clamp(o.speed ?? 1, 0.5, 1.5);
  const p = o.pitch ?? 1;
  if (hard) {
    burst(ctx, out, t0, { f: 2500 * p, q: 0.85, g: 0.30 * s, a: 0.0004, d: 0.026 });
    burst(ctx, out, t0 + 0.008, { f: 5600, type: 'hp', q: 0.6, g: 0.085 * s, a: 0.001, d: 0.030 });
    partial(ctx, out, t0, { f: 1500 * p, g: 0.15 * s, d: 0.026, a: 0, phase: 'cos' });
    partial(ctx, out, t0, { f: 218 * p, g: 0.13 * s, d: 0.036, a: 0, phase: 'cos' });
  } else {
    burst(ctx, out, t0, { f: 1180 * p, q: 0.7, g: 0.28 * s, a: 0.0010, d: 0.048, color: 'pink' });
    partial(ctx, out, t0, { f: 172 * p, glideTo: 124, glideTime: 0.04, g: 0.14 * s, d: 0.048, a: 0, phase: 'cos' });
    burst(ctx, out, t0 + 0.014, { f: 3400, type: 'hp', q: 0.5, g: 0.060 * s, a: 0.003, d: 0.040 });
  }
}
registerCue('step_asphalt', { bus: 'sfx', gain: 1.7, dur: 0.2, note: 'one shoe on the crown of the road.', build: (c, o, t, x) => step(c, o, t, x, false) });
registerCue('step_sidewalk', { bus: 'sfx', gain: 0.9, dur: 0.2, note: 'one shoe on bluestone. Nailed heels tick.', build: (c, o, t, x) => step(c, o, t, x, true) });

registerCue('footsteps_run', {
  bus: 'sfx', gain: 1.0, dur: 2.0,
  note: 'a kid going flat out for second, off the road and up over the curb halfway.',
  build(ctx, out, t0, o) {
    const r = o.rnd;
    let t = t0, dt = 0.235;
    for (let i = 0; i < 10; i++) {
      const onStone = i >= 6;
      step(ctx, out, t, { speed: (onStone ? 1.0 : 0.9) * r.range(0.85, 1.15), pitch: r.range(0.93, 1.08), rnd: r }, onStone);
      t += dt * r.range(0.94, 1.06);
      dt = Math.max(0.165, dt * 0.965);           // accelerating, because he is being chased
    }
  },
});

registerCue('slide', {
  bus: 'sfx', gain: 1.25, dur: 1.3,
  note: 'into the manhole cover, on a knee, in short pants. It costs him skin and he does not care.',
  build(ctx, out, t0, o) {
    // the launch: heel catching
    burst(ctx, out, t0, { f: 950, q: 0.8, g: 0.55, a: 0.0015, d: 0.045, color: 'pink' });
    partial(ctx, out, t0, { f: 130, g: 0.14, d: 0.085, a: 0.002, phase: 'cos' });
    // the scrape: a wide band that falls as he loses speed
    const src = noiseSrc(ctx, t0 + 0.02, 0.62, 'pink', 0.35);
    const f = bp(ctx, 1500, 1.1);
    f.frequency.setValueAtTime(1650, t0 + 0.02);
    f.frequency.exponentialRampToValueAtTime(420, t0 + 0.60);
    f.Q.setValueAtTime(0.9, t0 + 0.02);
    f.Q.linearRampToValueAtTime(3.4, t0 + 0.58);
    const e = envGain(ctx, t0 + 0.02, { peak: 1.15, a: 0.05, hold: 0.16, d: 0.40, shapeA: 'lin' });
    chain(src, f, e, out);
    // the low rumble of a body actually moving along the ground
    const low = noiseSrc(ctx, t0 + 0.02, 0.56, 'brown', 1.4);
    chain(low, lp(ctx, 260, 1.2), envGain(ctx, t0 + 0.02, { peak: 0.30, a: 0.05, hold: 0.14, d: 0.34, shapeA: 'lin' }), out);
    // grit skipping out from under him
    const r = o.rnd;
    for (let i = 0; i < 9; i++) {
      burst(ctx, out, t0 + 0.05 + r.range(0, 0.5), { f: r.range(2600, 6200), q: 3, g: r.range(0.040, 0.115), a: 0.0004, d: 0.018 });
    }
    // and he arrives
    partial(ctx, out, t0 + 0.60, { f: 96, g: 0.11, d: 0.16, a: 0.004 });
    burst(ctx, out, t0 + 0.60, { f: 620, type: 'lp', q: 1, g: 0.10, a: 0.003, d: 0.09 });
    metal(ctx, out, t0 + 0.615, { f0: 238, g: 0.055, strike: 0.3, ratios: [1, 1.58, 2.33], gains: [1, 0.5, 0.25], decays: [0.16, 0.11, 0.07] });
  },
});

/* -----------------------------------------------------------------------------
 * 2.4 UI — §7.4: zero synthesised blips, ever. Everything is a wooden object.
 * ------------------------------------------------------------------------- */
registerCue('ui_clack', {
  bus: 'sfx', gain: 2.0, dur: 0.25,
  note: 'a wooden checker laid on a stoop. This is what a button is.',
  build(ctx, out, t0) {
    burst(ctx, out, t0, { f: 2900, q: 0.9, g: 0.16, a: 0.0003, d: 0.007 });
    for (const [f, g, d] of [[432, 0.20, 0.045], [780, 0.13, 0.028], [1290, 0.06, 0.016]]) partial(ctx, out, t0, { f, g, d });
  },
});
registerCue('ui_boing', {
  bus: 'sfx', gain: 4.2, dur: 0.6,
  note: 'the wrong button. A rubber band across an ash-can lid.',
  build(ctx, out, t0) {
    burst(ctx, out, t0, { f: 1800, q: 1.2, g: 0.08, a: 0.0005, d: 0.010 });
    boing(ctx, out, t0, { f0: 520, f1: 138, d: 0.40, rate: 14, depth: 105, g: 0.16 });
  },
});
registerCue('ui_bottlecaps', {
  bus: 'sfx', gain: 5.2, dur: 0.7,
  note: 'a pocketful of bottle caps, shaken. This is what a menu opening is.',
  build(ctx, out, t0, o) {
    const r = o.rnd;
    for (let i = 0; i < 22; i++) {
      const t = t0 + Math.pow(r.next(), 0.8) * 0.36;
      metal(ctx, out, t, {
        f0: r.range(1500, 3400), g: r.range(0.020, 0.055), strike: 0.6, strikeD: 0.004,
        ratios: [1, 1.44, 2.2], gains: [1, 0.55, 0.25], decays: [0.035, 0.025, 0.015],
      });
    }
  },
});

/* =============================================================================
 * 3. THE BLOCK — the city bed
 * ---------------------------------------------------------------------------
 * DESIGN-BIBLE §7.5: 4-6 looping layers at different periods, plus at least one
 * sporadic layer every 20-60 s, so the loop never becomes audible. All of it
 * lives UNDER the play: nothing in here has a transient sharp enough to pull
 * the ear off a bounce, and everything is lowpassed like it is a hundred feet
 * away, because it is.
 * ========================================================================== */

/** A Model T at idle: four cylinders, ~600 rpm, which is a 20 Hz chuff. */
function motorT(ctx, dest, t0, o) {
  const dur = o.dur ?? 3, rate = o.rate ?? 20;
  const pulse = ctx.createOscillator();
  pulse.type = 'sawtooth';
  pulse.frequency.setValueAtTime(rate, t0);
  pulse.frequency.linearRampToValueAtTime(rate * (o.drift ?? 1.06), t0 + dur);
  const am = gain(ctx, 0.42);
  chain(pulse, shaper(ctx, 6), gain(ctx, 0.58)).connect(am.gain);
  const src = noiseSrc(ctx, t0, dur, 'brown', o.offset ?? 0);
  const body = bp(ctx, o.f ?? 155, 3.2);
  const e = envGain(ctx, t0, { peak: o.g ?? 0.09, a: o.a ?? 0.4, hold: dur * 0.55, d: o.d ?? dur * 0.4, shapeA: 'lin', shapeD: 'lin' });
  chain(src, body, am, lp(ctx, o.lp ?? 700, 0.8), e, dest);
  pulse.start(t0); pulse.stop(t0 + dur + 0.05);
}

registerCue('city_traffic', {
  bus: 'ambience', gain: 1.45, dur: 6,
  note: 'the avenue, two blocks over. Never a modern engine, never a tyre screech.',
  build(ctx, out, t0, o) {
    const dur = o.seconds ?? 6, r = o.rnd;
    // 1. the floor: everything in the city at once, rolled off at 260 Hz
    const bed = noiseSrc(ctx, t0, dur, 'brown', 0.1);
    const bf = lp(ctx, 250, 1.1);
    const swell = ctx.createOscillator(); swell.type = 'sine'; swell.frequency.value = 0.071;
    swell.connect(gain(ctx, 95)).connect(bf.frequency);
    swell.start(t0); swell.stop(t0 + dur);
    chain(bed, bf, envGain(ctx, t0, { peak: 0.50, a: 0.5, hold: dur - 1.3, d: 0.8, shapeA: 'lin', shapeD: 'lin' }), out);
    // 2. iron tyres on Belgian block, far enough away to be a hiss
    const hash = noiseSrc(ctx, t0, dur, 'pink', 1.7);
    const hf = bp(ctx, 760, 0.55);
    const drift = ctx.createOscillator(); drift.type = 'sine'; drift.frequency.value = 0.043;
    drift.connect(gain(ctx, 210)).connect(hf.frequency);
    drift.start(t0); drift.stop(t0 + dur);
    chain(hash, hf, lp(ctx, 2400, 0.7), envGain(ctx, t0, { peak: 0.30, a: 0.7, hold: dur - 1.6, d: 0.9, shapeA: 'lin', shapeD: 'lin' }), out);
    // 3. three flivvers, all at slightly different idles, which is what makes it a street
    motorT(ctx, out, t0 + 0.1, { dur: dur * 0.62, rate: 19.5, g: 0.34, f: 150, lp: 620, offset: 0.4 });
    motorT(ctx, out, t0 + dur * 0.30, { dur: dur * 0.55, rate: 23.5, g: 0.24, f: 178, lp: 760, offset: 1.2, drift: 0.94 });
    motorT(ctx, out, t0 + dur * 0.05, { dur: dur * 0.9, rate: 16.5, g: 0.17, f: 132, lp: 520, offset: 2.6, drift: 1.1 });
    // 4. somebody two streets over leaning on a horn, twice
    const farHorn = gain(ctx, 1);
    chain(farHorn, lp(ctx, 1500, 0.9), gain(ctx, 0.30), out);
    klaxonCall(ctx, farHorn, t0 + dur * 0.46, { g: 0.30, f0: 168, f1: 268 });
  },
});

/* --- the klaxon: §7.4 says it is already a cartoon, do not touch it --------- */
function klaxonCall(ctx, dest, t0, o = {}) {
  const g0 = (o.g ?? 0.20) * 0.55, f0 = o.f0 ?? 152, f1 = o.f1 ?? 328;
  const wave = memo(ctx, 'klaxonwave', () => {
    const h = [0, 1, 0.86, 0.64, 0.52, 0.40, 0.31, 0.24, 0.18, 0.13, 0.10, 0.07, 0.05];
    return ctx.createPeriodicWave(new Float32Array(h.length), Float32Array.from(h), { disableNormalization: false });
  });
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  const f = osc.frequency;
  // the motor spins the diaphragm up, holds, and runs down: ah - OO - gah
  f.setValueAtTime(f0, t0);
  f.exponentialRampToValueAtTime(f1, t0 + 0.19);
  f.setValueAtTime(f1, t0 + 0.44);
  f.exponentialRampToValueAtTime(f1 * 0.86, t0 + 0.52);
  f.exponentialRampToValueAtTime(f0 * 0.88, t0 + 0.76);
  // the diaphragm buzz on top of the tone
  const am = gain(ctx, 0.86);
  const buzz = ctx.createOscillator(); buzz.type = 'sine'; buzz.frequency.value = 31;
  buzz.connect(gain(ctx, 0.14)).connect(am.gain);
  buzz.start(t0); buzz.stop(t0 + 0.9);
  const e = envGain(ctx, t0, { peak: g0, a: 0.035, hold: 0.44, d: 0.30, shapeA: 'lin', shapeD: 'lin' });
  chain(osc, am, shaper(ctx, 2.2), pk(ctx, 880, 1.2, 8), bp(ctx, 900, 0.55), e, dest);
  osc.start(t0); osc.stop(t0 + 0.9);
}

registerCue('klaxon', {
  bus: 'ambience', gain: 0.75, dur: 2.2,
  note: 'ah-OO-gah. A brass bulb horn on a delivery truck. Cartoon as bought.',
  build(ctx, out, t0, o) {
    klaxonCall(ctx, out, t0, { g: 0.30 });
    klaxonCall(ctx, out, t0 + 1.02, { g: 0.21, f0: 148, f1: 318 });
  },
});

/* --- the Third Avenue El, passing overhead --------------------------------- */
registerCue('el_train', {
  bus: 'ambience', gain: 0.95, dur: 6.5,
  note: 'the El. PERIOD: steel structure over the avenue, wooden cars, and it flattens conversation.',
  build(ctx, out, t0, o) {
    const r = o.rnd;
    const PASS = 2.55, LEN = 5.4;
    const dop = (t) => 1.075 - 0.15 / (1 + Math.exp(-(t - PASS) * 5.2));   // one smooth Doppler slide
    // 1. the rumble of the structure, which arrives before the train does
    const rum = noiseSrc(ctx, t0, LEN, 'brown', 0.2);
    const rf = lp(ctx, 90, 1.6);
    rf.frequency.setValueAtTime(85, t0);
    rf.frequency.linearRampToValueAtTime(330, t0 + PASS);
    rf.frequency.linearRampToValueAtTime(105, t0 + LEN);
    const re = ctx.createGain();
    re.gain.setValueAtTime(0.0001, t0);
    re.gain.linearRampToValueAtTime(0.62, t0 + PASS);
    re.gain.linearRampToValueAtTime(0.02, t0 + LEN);
    re.gain.setValueAtTime(0, t0 + LEN + 0.01);
    chain(rum, rf, re, out);
    // 2. the ironwork itself, resonating in three places
    for (const [f, g] of [[43, 0.30], [67, 0.21], [89, 0.13]]) {
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t0);
      e.gain.linearRampToValueAtTime(g, t0 + PASS + 0.15);
      e.gain.linearRampToValueAtTime(0.0001, t0 + LEN - 0.4);
      e.gain.setValueAtTime(0, t0 + LEN);
      const trem = ctx.createOscillator(); trem.frequency.value = 3.1 + f * 0.02;
      trem.connect(gain(ctx, g * 0.35)).connect(e.gain);
      trem.start(t0); trem.stop(t0 + LEN);
      chain(osc, e, out); osc.start(t0); osc.stop(t0 + LEN);
    }
    // 3. rail joints — two bogies per car, seven cars. This is the clackety-clack.
    const rail = gain(ctx, 1);
    chain(rail, lp(ctx, 4200, 0.8), out);
    for (let car = 0; car < 8; car++) {
      const base = 0.28 + car * 0.615;
      for (const off of [0, 0.052, 0.295, 0.347]) {
        const t = t0 + base + off + r.range(-0.006, 0.006);
        const tt = base + off;
        const d = dop(tt);
        const near = Math.exp(-Math.pow((tt - PASS) / 1.65, 2));
        const g = (0.14 + 0.62 * near) * r.range(0.82, 1.15);
        burst(ctx, rail, t, { f: 880 * d, q: 1.4, g: g * 2.1, a: 0.0004, d: 0.026 });
        burst(ctx, rail, t, { f: 2600 * d, q: 1.0, g: g * 0.85, a: 0.0003, d: 0.012 });
        partial(ctx, rail, t, { f: 168 * d, g: g * 0.62, d: 0.055, a: 0, phase: 'cos' });
        partial(ctx, rail, t, { f: 452 * d, g: g * 0.40, d: 0.036, a: 0, phase: 'cos' });
        partial(ctx, rail, t, { f: 1350 * d, g: g * 0.24, d: 0.020, a: 0, phase: 'cos' });
      }
    }
    // 4. flanges squealing on the curve at Twenty-Third
    for (const [f, g, dt, dur] of [[1720, 0.19, 1.35, 1.5], [2380, 0.105, 1.55, 1.15]]) {
      const osc = ctx.createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(f * dop(dt), t0 + dt);
      osc.frequency.linearRampToValueAtTime(f * dop(dt + dur) * 0.97, t0 + dt + dur);
      const vib = ctx.createOscillator(); vib.frequency.value = 6.4;
      vib.connect(gain(ctx, f * 0.018)).connect(osc.frequency);
      vib.start(t0 + dt); vib.stop(t0 + dt + dur);
      chain(osc, bp(ctx, f, 1.4), envGain(ctx, t0 + dt, { peak: g, a: dur * 0.4, d: dur * 0.6, shapeA: 'lin' }), out);
      osc.start(t0 + dt); osc.stop(t0 + dt + dur + 0.05);
    }
    // 5. and the air it drags with it, going away
    const cars = noiseSrc(ctx, t0 + 0.4, LEN - 0.9, 'pink', 3.6);
    const cf = bp(ctx, 520, 0.9);
    cf.frequency.setValueAtTime(430, t0 + 0.4);
    cf.frequency.linearRampToValueAtTime(760, t0 + PASS);
    cf.frequency.linearRampToValueAtTime(400, t0 + LEN - 0.5);
    const ce = ctx.createGain();
    ce.gain.setValueAtTime(0.0001, t0 + 0.4);
    ce.gain.linearRampToValueAtTime(0.30, t0 + PASS);
    ce.gain.linearRampToValueAtTime(0.0001, t0 + LEN - 0.5);
    ce.gain.setValueAtTime(0, t0 + LEN - 0.4);
    chain(cars, cf, ce, out);

    const wake = noiseSrc(ctx, t0 + PASS - 0.3, 2.4, 'pink', 2.9);
    const wf = bp(ctx, 700, 0.7);
    wf.frequency.setValueAtTime(900, t0 + PASS - 0.3);
    wf.frequency.exponentialRampToValueAtTime(300, t0 + PASS + 2.0);
    chain(wake, wf, envGain(ctx, t0 + PASS - 0.3, { peak: 0.24, a: 0.35, hold: 0.4, d: 1.6, shapeA: 'lin', shapeD: 'lin' }), out);
  },
});

/* --- the radio in the third-floor window ----------------------------------
 * §7.1: the world's music is 1925. Band-limited 200 Hz - 3.5 kHz, mid-heavy,
 * horn-speaker honk, surface noise. ONE radio, ONE window, thin and far.
 * A novelty two-step in F, which is what was on in September 1925.
 */
registerCue('radio_window', {
  bus: 'music', gain: 2.6, dur: 4.0,
  note: '§7.1: 1925 on a battery set through a horn speaker, across the street, through glass.',
  build(ctx, out, t0, o) {
    const r = o.rnd;
    const BPM = 168, B = 60 / BPM;
    // the set: everything below 200 and above 3.4k simply did not exist
    const set = gain(ctx, 1);
    chain(set, hp(ctx, 210, 0.8), pk(ctx, 1750, 1.1, 11), pk(ctx, 620, 1.4, -6), lp(ctx, 3400, 0.9), shaper(ctx, 1.9), gain(ctx, 0.9), out);

    // The tune is an ORIGINAL written in the September-1925 novelty two-step idiom
    // rather than a transcription: §7.1 fixes the repertoire's period, and what
    // carries that period to a listener is the timbre, the oom-pah and the 168 bpm
    // two-step, not the specific melody. Jaunty, diatonic, and it does not resolve
    // until the last bar.
    const MEL = [
      [81, 0, 0.5], [81, 0.5, 0.5], [79, 1, 0.5], [77, 1.5, 0.5],
      [79, 2, 0.5], [79, 2.5, 0.5], [81, 3, 0.9],
      [84, 4, 0.5], [84, 4.5, 0.5], [82, 5, 0.5], [81, 5.5, 0.5],
      [79, 6, 1.4], [77, 7.5, 0.4], [79, 8, 0.5], [81, 8.5, 0.5],
      [82, 9, 1.0], [79, 10, 0.5], [77, 10.5, 1.4],
    ];
    for (const [m, b, d] of MEL) {
      const t = t0 + b * B, dur = d * B;
      const f = midi(m);
      const osc = ctx.createOscillator(); osc.type = 'square';
      osc.frequency.setValueAtTime(f * r.range(0.997, 1.003), t);
      const vib = ctx.createOscillator(); vib.frequency.value = 5.3;
      vib.connect(gain(ctx, f * 0.006)).connect(osc.frequency);
      vib.start(t); vib.stop(t + dur);
      chain(osc, bp(ctx, 1500, 0.6), envGain(ctx, t, { peak: 0.10, a: 0.018, hold: dur * 0.55, d: dur * 0.45, shapeA: 'lin' }), set);
      osc.start(t); osc.stop(t + dur + 0.03);
    }
    // oom-pah: a bass note on the beat, a chord chirp off it
    for (let b = 0; b < 12; b++) {
      const t = t0 + b * B;
      const root = [53, 53, 55, 55, 53, 53, 60, 60, 53, 53, 55, 53][b];
      const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = midi(root);
      chain(osc, envGain(ctx, t, { peak: 0.085, a: 0.008, d: 0.16 }), set);
      osc.start(t); osc.stop(t + 0.22);
      for (const semi of [0, 4, 7]) {
        const c = ctx.createOscillator(); c.type = 'square'; c.frequency.value = midi(root + 12 + semi);
        chain(c, gain(ctx, 0.28), envGain(ctx, t + B * 0.5, { peak: 0.030, a: 0.004, d: 0.075 }), set);
        c.start(t + B * 0.5); c.stop(t + B * 0.5 + 0.12);
      }
    }
    // surface noise: hiss, and the once-a-revolution thump of a 78
    const hiss = noiseSrc(ctx, t0, 4.0, 'pink', 3.4);
    chain(hiss, bp(ctx, 2600, 0.6), envGain(ctx, t0, { peak: 0.028, a: 0.05, hold: 3.5, d: 0.4, shapeA: 'lin', shapeD: 'lin' }), set);
    for (let i = 0; i * 0.769 < 3.9; i++) {
      burst(ctx, set, t0 + i * 0.769, { f: 340, type: 'lp', q: 1.1, g: 0.022, a: 0.002, d: 0.030 });
      if (r.chance(0.5)) burst(ctx, set, t0 + i * 0.769 + r.range(0.05, 0.7), { f: 3000, q: 4, g: 0.014, a: 0.0004, d: 0.006 });
    }
  },
});

/* --- the knife grinder, working his way up the block ----------------------- */
registerCue('knife_grinder', {
  bus: 'ambience', gain: 1.2, dur: 3.0,
  note: 'PERIOD: he rings a hand bell and the whole street knows what he is. Two per swing.',
  build(ctx, out, t0, o) {
    const bell = (t, g, p) => metal(ctx, out, t, {
      f0: 1180 * p, g, strike: 0.55, strikeF: 5200, strikeD: 0.006, beat: 3.4,
      ratios: [1, 1.41, 2.06, 2.72, 3.61, 4.88, 6.2],
      gains: [1, 0.78, 0.52, 0.36, 0.24, 0.14, 0.08],
      decays: [0.72, 0.55, 0.40, 0.29, 0.20, 0.13, 0.085],
    });
    // three swings of the wrist, two strikes each, and the wrist is not a metronome
    for (const [t, g, p] of [[0, 0.13, 1], [0.185, 0.10, 0.995], [0.62, 0.115, 1.006], [0.79, 0.085, 1.0],
      [1.30, 0.10, 0.99], [1.475, 0.075, 1.004], [2.02, 0.065, 1.0]]) bell(t0 + t, g, p);
    // the wheel and the treadle under it all
    const wheel = noiseSrc(ctx, t0, 3.0, 'pink', 1.1);
    const wf = bp(ctx, 1600, 2.2);
    const tread = ctx.createOscillator(); tread.type = 'sine'; tread.frequency.value = 2.6;
    tread.connect(gain(ctx, 380)).connect(wf.frequency);
    tread.start(t0); tread.stop(t0 + 3.0);
    const am = gain(ctx, 0.5);
    const tl = ctx.createOscillator(); tl.type = 'sine'; tl.frequency.value = 2.6;
    tl.connect(gain(ctx, 0.42)).connect(am.gain);
    tl.start(t0); tl.stop(t0 + 3.0);
    chain(wheel, wf, am, envGain(ctx, t0, { peak: 0.035, a: 0.6, hold: 1.6, d: 0.7, shapeA: 'lin', shapeD: 'lin' }), out);
  },
});

/* --- the dog in the areaway ------------------------------------------------ */
function bark(ctx, dest, t0, o = {}) {
  const p = o.p ?? 1, g = (o.g ?? 0.22) * 6.5;
  formantVoice(ctx, dest, t0, {
    dur: 0.13, g, a: 0.004, hold: 0.022, d: 0.085,
    pitch: [[0, 430 * p], [0.02, 470 * p], [0.13, 300 * p]],
    formants: [600, 1180, 2450], formantsTo: [740, 1520, 2500], morph: 0.5,
    bw: [110, 150, 260], fGains: [1, 0.62, 0.26], rasp: 0.30, type: 'sawtooth',
  });
  burst(ctx, dest, t0, { f: 1150, q: 0.7, g: g * 0.16, a: 0.001, d: 0.030 });
  partial(ctx, dest, t0, { f: 150 * p, g: g * 0.06, d: 0.055, a: 0.002, phase: 'cos' });
}
registerCue('dog', {
  bus: 'ambience', gain: 2.5, dur: 2.2,
  note: 'somebody has a dog in the areaway and it has opinions about a rubber ball.',
  build(ctx, out, t0, o) {
    bark(ctx, out, t0, { g: 0.26, p: 1.0 });
    bark(ctx, out, t0 + 0.315, { g: 0.22, p: 1.05 });
    bark(ctx, out, t0 + 0.60, { g: 0.17, p: 0.97 });
    // and then it mutters about it for a while
    formantVoice(ctx, out, t0 + 0.90, {
      dur: 0.55, g: 0.34, a: 0.06, hold: 0.28, d: 0.24, shapeA: 'lin',
      pitch: [[0, 122], [0.28, 138], [0.55, 104]],
      formants: [470, 1000, 2200], bw: [90, 140, 240], fGains: [1, 0.4, 0.12], rasp: 0.16,
    });
  },
});

/* --- church bells, a long way off ----------------------------------------- */
function churchBell(ctx, dest, t0, prime, g) {
  metal(ctx, dest, t0, {
    f0: prime, g, strike: 0.30, strikeF: prime * 12, strikeD: 0.022, beat: 0.7, dScale: 1,
    ratios: [0.5, 1, 1.183, 1.506, 2.0, 2.514, 3.011, 4.166, 5.433],
    gains: [0.34, 0.90, 0.80, 0.62, 1.0, 0.52, 0.38, 0.22, 0.13],
    decays: [4.6, 3.6, 2.7, 2.3, 2.0, 1.5, 1.15, 0.75, 0.5],
  });
}
registerCue('church_bells', {
  bus: 'ambience', gain: 1.0, dur: 7.0, send: 0.34,
  note: 'the quarter hour, from a church you cannot see. Cast bronze: hum, prime, tierce, quint, nominal.',
  build(ctx, out, t0, o) {
    const far = gain(ctx, 1);
    chain(far, lp(ctx, 3000, 0.7), hp(ctx, 130, 0.7), out);
    churchBell(ctx, far, t0 + 0.00, 262, 0.115);
    churchBell(ctx, far, t0 + 1.09, 196, 0.100);
    churchBell(ctx, far, t0 + 2.16, 262, 0.090);
    churchBell(ctx, far, t0 + 3.27, 196, 0.078);
    churchBell(ctx, far, t0 + 4.34, 233, 0.062);
  },
});

/* --- a horse cart, and the pigeons it puts up ------------------------------ */
function hoof(ctx, dest, t0, g) {
  burst(ctx, dest, t0, { f: 1450, q: 1.5, g: g * 0.9, a: 0.0005, d: 0.014 });
  partial(ctx, dest, t0, { f: 320, g: g * 0.6, d: 0.030, a: 0.0012 });
  partial(ctx, dest, t0, { f: 178, g: g * 0.45, d: 0.045, a: 0.0016 });
  burst(ctx, dest, t0 + 0.004, { f: 4200, type: 'hp', q: 0.6, g: g * 0.20, a: 0.0006, d: 0.018 });
}
registerCue('horse_cart', {
  bus: 'ambience', gain: 1.6, dur: 4.0,
  note: 'PERIOD: in 1925 half the deliveries on this block are still a horse. Four-beat walk.',
  build(ctx, out, t0, o) {
    const r = o.rnd;
    const near = gain(ctx, 1);
    chain(near, lp(ctx, 5000, 0.7), out);
    let t = t0 + 0.05;
    for (let s = 0; s < 8; s++) {
      // a walk is four beats, unevenly spaced, and no two are the same loudness
      for (const [off, g] of [[0, 0.42], [0.135, 0.30], [0.30, 0.38], [0.425, 0.27]]) {
        hoof(ctx, near, t + off + r.range(-0.012, 0.012), g * r.range(0.8, 1.2));
      }
      t += 0.62;
    }
    // iron tyres on the cart, and the tailgate chain
    const roll = noiseSrc(ctx, t0, 4.0, 'pink', 2.2);
    chain(roll, bp(ctx, 620, 0.8), envGain(ctx, t0, { peak: 0.30, a: 0.5, hold: 2.6, d: 0.8, shapeA: 'lin', shapeD: 'lin' }), near);
    for (let i = 0; i < 7; i++) {
      metal(ctx, near, t0 + 0.4 + i * 0.62 + r.range(0, 0.2), {
        f0: r.range(2200, 3400), g: 0.055, strike: 0.5, strikeD: 0.003,
        ratios: [1, 1.5], gains: [1, 0.5], decays: [0.03, 0.02],
      });
    }
  },
});
registerCue('pigeons', {
  bus: 'ambience', gain: 4.4, dur: 2.4,
  note: 'the whole cornice goes up at once, and then one of them complains.',
  build(ctx, out, t0, o) {
    const r = o.rnd;
    // wingbeats: many small pink puffs, dense then thinning
    for (let i = 0; i < 40; i++) {
      const u = i / 40;
      const t = t0 + Math.pow(u, 0.85) * 1.0 + r.range(0, 0.05);
      burst(ctx, out, t, { f: r.range(400, 1300), q: 1.1, g: 0.95 * (1 - u * 0.7) * r.range(0.5, 1), a: 0.004, d: r.range(0.02, 0.05), color: 'pink' });
    }
    // and one coo, because a pigeon has never once let a thing go
    for (const [dt, f, d] of [[1.15, 300, 0.20], [1.38, 262, 0.16], [1.58, 240, 0.30]]) {
      formantVoice(ctx, out, t0 + dt, {
        dur: d, g: 0.42, a: 0.04, hold: d * 0.4, d: d * 0.5, shapeA: 'lin',
        pitch: [[0, f], [d * 0.4, f * 1.08], [d, f * 0.86]],
        formants: [430, 780, 2200], bw: [70, 110, 220], fGains: [1, 0.3, 0.06], type: 'sawtooth',
      });
    }
  },
});

/* -----------------------------------------------------------------------------
 * 3.9 A MOTHER, THIRD FLOOR, CALLING SOMEBODY IN
 * ---------------------------------------------------------------------------
 * This one is read straight off the roster: kid.call is "what his mother yells
 * out of the window, in her own caps" — SAL-VA-TO-RE! SUPPER! — already
 * hyphenated into syllables, so the call is literally sung from the roster
 * data and every kid's mother sounds like a different woman.
 *
 * DESIGN-BIBLE §7.5: dialect is a performance, never a spelling. Nothing here
 * is written phonetically; the accent is entirely in the contour and the vowel.
 * A calling contour is not speech — it is two or three sung steps with the last
 * syllable held and bent down a minor third, which is how a call carries sixty
 * feet of street and four floors of air.
 * ------------------------------------------------------------------------- */
export function callOut(ctx, dest, t0, o = {}) {
  const words = syllables(o.text || 'AN-TO-NEE! SUP-PER!');
  const base = (o.f0 ?? 292) * (o.pitch ?? 1);
  const g0 = o.g ?? 0.16;
  // a called scale: up a fourth, sit there, and fall a minor third at the end
  const STEPS = [0, 3, 5, 5, 7, 5];
  let t = t0;
  for (let w = 0; w < words.length; w++) {
    const syl = words[w];
    const last = w === words.length - 1;
    for (let i = 0; i < syl.length; i++) {
      const s = syl[i];
      const tail = last && i === syl.length - 1;
      const dur = tail ? 0.62 : (i === 0 ? 0.26 : 0.21);
      const f = base * Math.pow(2, STEPS[Math.min(i, STEPS.length - 1)] / 12);
      const F = VOWELS[s.v] || VOWELS.a;
      // the onset consonant, as one small piece of noise, never as a spelling
      const on = s.onset;
      if ('tkpdgb'.includes(on)) burst(ctx, dest, t, { f: on === 's' ? 5000 : 2300, q: 1.1, g: g0 * 0.30, a: 0.0004, d: 0.010 });
      else if ('sfzh'.includes(on)) burst(ctx, dest, t, { f: 4600, q: 0.8, g: g0 * 0.22, a: 0.004, d: 0.045 });
      else if ('mn'.includes(on)) partial(ctx, dest, t, { f: f * 0.5, g: g0 * 0.12, d: 0.05, a: 0.008 });
      const pitch = tail
        ? [[0, f], [0.10, f * 1.061], [0.30, f * 1.061], [dur, f * 0.841]]   // hold, then down a third
        : [[0, f * 0.97], [0.05, f], [dur, f * 0.985]];
      formantVoice(ctx, dest, t + (('tkpdgb'.includes(on)) ? 0.012 : 0), {
        dur, g: g0 * (tail ? 1 : 0.86), a: tail ? 0.045 : 0.028, hold: dur * (tail ? 0.55 : 0.42),
        d: dur * (tail ? 0.42 : 0.5), shapeA: 'lin',
        pitch, formants: F, fScale: 1.14, bw: [95, 130, 210], fGains: [1, 0.62, 0.24],
        rasp: 0.10, type: 'sawtooth',
      });
      t += dur * (tail ? 1.0 : 0.86);
    }
    t += 0.20;   // she takes a breath between the name and the instruction
  }
  return t - t0;
}

registerCue('mother_calling', {
  bus: 'voice', gain: 1.3, dur: 3.4, send: 0.30,
  note: 'third floor, front window, and the game is over for one of them. Sung off kid.call.',
  build(ctx, out, t0, o) {
    // she is four floors up and across the street: no bass, no top, all canyon
    const window = gain(ctx, 1);
    chain(window, hp(ctx, 230, 0.7), pk(ctx, 1250, 1.0, 5), lp(ctx, 2900, 0.8), out);
    const kid = o.kid ? ROSTER.find((k) => k.id === o.kid) : ROSTER[o.rnd.int(0, ROSTER.length - 1)];
    callOut(ctx, window, t0, { text: o.text || kid?.call || 'AN-TO-NEE! SUP-PER!', f0: 268 + (o.rnd.next() * 46), g: 1.35 });
  },
});

/* -----------------------------------------------------------------------------
 * 3.10 THE BED ITSELF — only what is continuously true of this block
 * §7.5 asks for 4-6 looping layers at different periods PLUS a sporadic layer, so
 * the loop never becomes audible. The trap in that sentence is the word "layer":
 * the previous build read it as "put everything in", and the bed came out as
 * eight objects — including a full Third Avenue El pass — re-drawn every 7.5-10.5
 * seconds, which meant a train went overhead every eight seconds forever. Eight
 * objects averaging into a wash is not a place; it is a hiss with a rumble in it.
 *
 * So the bed is four layers and the four are chosen by ONE test: is this true of
 * this block all the time? The avenue is. A horse cart on a delivery round is.
 * The cornice pigeons are. One radio in one window is (§7.1 says so in as many
 * words). A train, a dog, a knife grinder, a church, a klaxon and a mother at a
 * window are not — they are events, they belong to engine.js's sporadic
 * scheduler, and they are worth hearing precisely because they are rare.
 *
 * Cutting the layer list also cuts the allocation burst the last builder flagged
 * and could not measure. Counted by instrumenting OfflineAudioContext's create*
 * methods around one build: the bed is 840 nodes per pass, against ~1,600 before
 * — the El alone was 422 of them, the knife grinder 229. That is a 47% cut, and
 * it is still a wholesale rebuild rather than persistent looping sources, which
 * remains the honest weak point of this file.
 * ------------------------------------------------------------------------- */
registerCue('city_bed', {
  bus: 'ambience', gain: 1.5, dur: 8.0,
  note: '§7.5: the FOUR things this block does all the time — the avenue, a cart, the cornice pigeons, one radio in one window. Everything rarer than that belongs to the sporadic scheduler, not to the bed.',
  build(ctx, out, t0, o) {
    const r = o.rnd, dur = o.seconds ?? 8;
    // Every layer gets its own stream so the bed can be re-drawn every pass and
    // never repeats. But the LIST is fixed and short, which is the actual §7.5
    // rule: a bed is what is true of this block continuously. An El pass, a dog,
    // a knife grinder and a mother at a window are EVENTS, and an event that
    // happens on every pass of an 8 s bed is a carousel, not a place. Those four
    // moved out to engine.js SPORADIC_LIST, where they fire once every 22-55 s
    // and the El at most once every 90 s.
    const sub = () => new RNG(r.int(1, 1000000));

    // 1. THE AVENUE, two blocks over. The floor of the whole mix, and the only
    //    thing in here allowed to run at full level.
    CUES.city_traffic.build(ctx, out, t0, { ...o, seconds: dur, rnd: sub() });

    // everything else is FAR — the bed must never fight the play (§7.5)
    const far = gain(ctx, 0.78);
    chain(far, lp(ctx, 2600, 0.8), out);

    // 2. A HORSE CART. PERIOD: in 1925 half the deliveries on this block are
    //    still a horse, and the four-beat walk is slow enough to be furniture.
    CUES.horse_cart.build(ctx, far, t0 + r.range(0.2, 1.4), { ...o, rnd: sub() });

    // 3. THE CORNICE PIGEONS. They never all leave and they never all settle.
    CUES.pigeons.build(ctx, far, t0 + dur * r.range(0.20, 0.40), { ...o, rnd: sub() });

    // 4. ONE RADIO, ONE WINDOW, thin and far — §7.1 states that as an absolute,
    //    and "one radio in one window" is a continuous fact about the block, so
    //    this is the one non-traffic layer that is right to hear every pass.
    const rad = gain(ctx, 0.40); chain(rad, lp(ctx, 2400, 0.8), out);
    CUES.radio_window.build(ctx, rad, t0 + r.range(0.05, 0.6), { ...o, rnd: sub() });
  },
});

/* --- the sporadic layer: one of these every 22-55 s, never on a cycle -------
 * The scheduler lives in engine.js (tickAmbience); this is the same list, exported
 * so anything else that wants to know what the block is capable of can read it.
 * ------------------------------------------------------------------------- */
export const SPORADIC = ['el_train', 'klaxon', 'dog', 'church_bells', 'knife_grinder', 'mother_calling', 'horse_cart'];

export default CUES;

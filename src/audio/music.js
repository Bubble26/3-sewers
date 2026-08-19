/**
 * music.js — THE 1920s SCORE
 * ============================================================================
 * A procedural ragtime / hot-jazz score, synthesised entirely in WebAudio.
 * No samples, no network, no files. Everything below — every string, every reed,
 * every brush stroke — is computed from first principles at render time.
 *
 * DESIGN-BIBLE §7.1 is the governing rule and it is a MIX rule, not a style rule:
 *
 *     "The world's music is 1925. The game's music is now."
 *
 * so this file ships two mixes of the same band:
 *   - GAME cues (title, walk-ups, stingers, win/loss) are clean, close, bright,
 *     full-band. They score the player's action, so they get Backyard's polish.
 *   - the WORLD cue (`world_radio`) is the same band pushed through a 1925 battery
 *     receiver: 200 Hz – 4 kHz, a horn-speaker honk at 1.2 kHz, wow, and shellac
 *     surface noise. One radio, one window, thin and far (PERIOD §1.9, checklist 26).
 *
 * And the rule that outranks everything: THE SCORE NEVER COMPETES WITH THE
 * ANNOUNCER OR WITH THE CRACK OF THE BAT. Every cue lives behind one duck gain
 * (`R.duckGain`) that both the announcer bus and `bat:contact` pull down, and the
 * big-hit stinger is deliberately delayed 120 ms so the wooden TOCK owns the
 * transient it was written to answer. `renderOffline('duck_proof')` renders that
 * behaviour through the same code path the live game uses, so it is measurable.
 * Arrangement dynamics — the breaks — live on a SECOND gain (`R.arrangeGain`,
 * written by `arrangeAt`) so a composer's hairpin and the mix's ducker multiply
 * instead of fighting over one AudioParam.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE SCORE COMES FROM, IN A RUNNING GAME
 * ---------------------------------------------------------------------------
 * A score nobody starts is not a score. Every cue below has a caller:
 *   boot / `title` scenario ....... `title`
 *   `team_select` scenario ........ `team_select`
 *   `atbat:begin`, `pitch:called` . `bed_play`, and `world_radio` layered under it
 *   full count / a hit / a run .... `bed_tension` / `bed_rally`, via `state()`
 *   `roster:picked`, `atbat:begin`,
 *   `ball:sewer` .................. the kid's own walk-up — BIBLE §7.3's three
 *                                   firing places: the card, the plate, the trot
 *   `bat:contact` (hard) .......... `stinger_hit`   `ball:sewer` -> `stinger_sewer`
 *   `half:end` .................... `between_innings`
 *   `game:over` ................... `win` / `loss`
 *
 * ---------------------------------------------------------------------------
 * WHY IT SWINGS
 * ---------------------------------------------------------------------------
 * Swing is not a note choice, it is a time and accent choice, so both are first
 * class here:
 *   - `eighthToTime()` places the off-eighth at `swing` of the beat (0.5 = dead
 *     straight, 0.667 = triplet). The band runs 0.60–0.65 — the 1925 dotted lilt,
 *     not the 1940s triplet.
 *   - `accentAt()` puts the lift on the OFF eighth and the weight on 1 and 3,
 *     which is what makes a line lope instead of march.
 *   - `humanise()` adds deterministic (RNG-seeded, never Math.random) micro-timing:
 *     the lead plays 6–11 ms behind the bass, which is the whole feel of a hot
 *     band and is the difference between a score and a sequencer.
 *
 * ---------------------------------------------------------------------------
 * WHY THE HARMONY IS REAL
 * ---------------------------------------------------------------------------
 * Charts are written out as chord symbols and parsed (`chart()`), the strains are
 * period forms (16-bar A strain with the IV → iv borrowed-minor turn, a trio in
 * the subdominant, the I–VI7–II7–V7 ragtime turnaround), and every comping voice
 * is placed by `voiceLead()` — nearest-chord-tone motion from the previous
 * voicing, no doubling — so the inner voices actually move by step. Nothing here
 * picks a note at random.
 *
 * ---------------------------------------------------------------------------
 * PUBLIC SURFACE
 * ---------------------------------------------------------------------------
 *   app.music.play(cue) / .stop() / .duck(db, hold, rel) / .state({...})
 *   app.audio.listCues()                        -> includes every cue below
 *   app.audio.renderOffline({cue, seconds, sampleRate}) -> AudioBuffer
 *   __SB.music.analysisPlan(cue)                -> grid the swing analyser folds to
 *   __SB.music.validate()                       -> notation self-check, [] when clean
 *
 * The audio ENGINE (src/audio/engine.js) is owned by another builder. This file
 * never edits it: it attaches additively, registering every cue through the
 * engine's own `registerCue` and then letting the engine's `renderOffline` render
 * them. That matters for measurement: every number quoted in this file was taken
 * THROUGH `MIX.buses.music` (0.62) and the engine's master soft clip, which is the
 * graph the player hears — not around it.
 */
import { registerSystem } from '../app.js';
import { bus } from '../core/bus.js';
import { RNG } from '../core/rng.js';
import { T } from '../core/tuning.js';
import { ROSTER } from '../chars/roster.js';

/* ==========================================================================
 * 1. TUNING
 * Constants live in one block and are overridable from src/core/tuning.js as
 * `T.music` the moment that file's owner adds the key. Nothing is hard-coded
 * at a call site.
 * ======================================================================== */
const MUSIC_DEFAULTS = {
  /**
   * Gain staging, and it matters more than any note in this file. The band was
   * summing to ~1.6 before the soft clip, so the clip ran flat out and every
   * cue rendered as a brick with a 7 dB crest factor. `mixTrim` sets the level
   * INTO the clip so only real transients touch it; `masterGain` sets the level
   * out. Read the envelope in tools/audition.mjs after changing either.
   */
  mixTrim: 0.36,
  masterGain: 1.05,
  bedGainDb: -20,          // BYB §6.6 / BIBLE §7.5: the in-play bed sits 20 dB down
  /**
   * ONE TRIM PER BED, and this is a correctness fix, not a taste one. The three
   * beds are three different arrangements — brushes-and-bass, a diminished
   * tremolo wash, and a full four-to-the-bar band — so one shared trim made the
   * score get 7.2 dB louder on a full count and 12.8 dB louder on a rally, which
   * are precisely the two moments BIBLE §7.5 says belong to the kids and the
   * announcer. A rally has to read as a TEXTURE change (tuba on all four, sticks
   * instead of brushes, cornet + trombone) at the same level, never as volume.
   * Every number below is measured through the engine's own graph, not guessed.
   */
  bedTrimDb: 24.3,         // bed_play   -> -44.0 dBFS measured through MIX.buses.music
  bedTrimTensionDb: 12.8,  // bed_tension -> -44.0
  bedTrimRallyDb: 8.6,     // bed_rally   -> -44.0
  duckAnnouncerDb: -12,    // the announcer always wins — and -12 is the SHIPPED number:
                           // it is MIX.duck.voice.music in src/audio/engine.js, which is the
                           // duck that actually runs. `duck_proof` therefore demonstrates the
                           // depth the game applies, not a second one this file would like.
  duckCrackDb: -10,        // the bat always wins
  duckAttack: 0.055,
  duckRelease: 0.34,
  crackAttack: 0.022,
  crackHold: 0.18,
  crackRelease: 0.26,
  stingerPreDelay: 0.12,   // the crack owns its own transient; the band answers it
  swing: 0.625,            // off-eighth phase, fraction of a beat. 0.5 straight, .667 triplet
  swingHot: 0.655,
  swingRag: 0.585,
  humanMs: 9,              // micro-timing spread
  leadLagMs: 7,            // the lead sits behind the rhythm section
  reverbSend: 0.16,
  reverbSeconds: 0.85,
  seed: 1925,
};
const MT = { ...MUSIC_DEFAULTS, ...(T && T.music ? T.music : {}) };

const dB = (d) => Math.pow(10, d / 20);

/* ==========================================================================
 * 2. THEORY — notes, chords, voice leading
 * ======================================================================== */
const PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};
const NOTE_RE = /^([A-G][b#]?)(-?\d)$/;
function noteToMidi(s) {
  const m = NOTE_RE.exec(s);
  if (!m) return 60;
  return PC[m[1]] + (parseInt(m[2], 10) + 1) * 12;
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Chord qualities as interval sets. The 6ths and the dominant 9ths are the
// period's own vocabulary; nothing here is post-1930.
const QUALITY = {
  '': [0, 4, 7], M: [0, 4, 7], '6': [0, 4, 7, 9], maj7: [0, 4, 7, 11],
  '7': [0, 4, 7, 10], '9': [0, 4, 7, 10, 14], '7b9': [0, 4, 7, 10, 13],
  m: [0, 3, 7], m6: [0, 3, 7, 9], m7: [0, 3, 7, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8],
};
const CHORD_RE = /^([A-G][b#]?)([^/]*)(?:\/([A-G][b#]?))?$/;
function parseChord(sym) {
  const m = CHORD_RE.exec(sym.trim());
  if (!m) return { root: 0, pcs: [0, 4, 7], bass: 0, sym };
  const root = PC[m[1]];
  const ivs = QUALITY[m[2]] ?? QUALITY[''];
  const pcs = ivs.map((i) => (root + i) % 12);
  const bass = m[3] != null ? PC[m[3]] : root;
  return { root, pcs, bass, third: (root + ivs[1]) % 12, sym, quality: m[2] };
}

/**
 * chart('F6 | F6 | C7 C7 | ...') -> [{bar, beats:[{beat, chord}]}]
 * A bar with two symbols splits at beat 3, three symbols at 1/2.5/3.5, four on each beat.
 */
function chart(str) {
  return str.split('|').map((barStr, bar) => {
    const syms = barStr.trim().split(/\s+/).filter(Boolean);
    const starts = { 1: [0], 2: [0, 2], 3: [0, 1.5, 2.5], 4: [0, 1, 2, 3] }[syms.length] || [0];
    return { bar, beats: syms.map((s, i) => ({ beat: starts[i], chord: parseChord(s) })) };
  });
}
function chordAt(bars, bar, beat = 0) {
  const b = bars[((bar % bars.length) + bars.length) % bars.length];
  let cur = b.beats[0];
  for (const e of b.beats) if (beat >= e.beat - 1e-6) cur = e;
  return cur.chord;
}

/**
 * Real voice leading: every voice moves to the NEAREST unused chord tone.
 * No doubling, no parallel octaves by construction, common tones held.
 */
function voiceLead(prev, chordObj, lo, hi, n) {
  const pool = [];
  for (let m = lo; m <= hi; m++) if (chordObj.pcs.includes(((m % 12) + 12) % 12)) pool.push(m);
  if (!pool.length) return prev || [];
  const targets = (prev && prev.length === n)
    ? prev.slice()
    : Array.from({ length: n }, (_, i) => lo + Math.round(((hi - lo) * (i + 0.5)) / n));
  const used = new Set(); const out = [];
  // Least-ambiguous voice first keeps the bottom voice from stealing the top's tone.
  const order = targets.map((t, i) => i).sort((a, b) => targets[a] - targets[b]);
  for (const i of order) {
    let best = null; let bd = 1e9;
    for (const p of pool) {
      if (used.has(p)) continue;
      const d = Math.abs(p - targets[i]);
      if (d < bd) { bd = d; best = p; }
    }
    if (best != null) { used.add(best); out.push(best); }
  }
  return out.sort((a, b) => a - b);
}

/* ==========================================================================
 * 3. NOTATION — a tiny readable language so melodies are WRITTEN, not generated
 *   'C5:3 F5:1 A5:2!'   pitch:durationInEighths, ! = accent, ~ = ghost,
 *   'r:2' rest, '^' prefix = grace note, '|' = barline (checked by validate())
 * ======================================================================== */
function mel(str) {
  const out = []; let e = 0; let bars = 0;
  for (const raw of String(str).split(/\s+/)) {
    if (!raw) continue;
    if (raw === '|') { bars++; continue; }
    let tok = raw; let vel = 1; let grace = false; let gliss = false;
    if (tok.startsWith('^')) { grace = true; tok = tok.slice(1); }
    if (tok.endsWith('!')) { vel = 1.24; tok = tok.slice(0, -1); }
    else if (tok.endsWith('~')) { vel = 0.66; tok = tok.slice(0, -1); }
    if (tok.endsWith('/')) { gliss = true; tok = tok.slice(0, -1); }
    const i = tok.lastIndexOf(':');
    const p = tok.slice(0, i); const dur = parseFloat(tok.slice(i + 1));
    if (!(dur > 0)) continue;
    if (p !== 'r') out.push({ e, dur, midi: noteToMidi(p), vel, grace, gliss });
    e += dur;
  }
  out.eighths = e; out.bars = bars + 1;
  return out;
}
function transposeMel(m, semis) {
  const out = m.map((n) => ({ ...n, midi: n.midi + semis }));
  out.eighths = m.eighths; out.bars = m.bars;
  return out;
}

/* ==========================================================================
 * 4. GROOVE — swing placement and accent
 * ======================================================================== */
/**
 * Position (in eighths) -> seconds. The off-eighth lands at `swing` of the beat,
 * and any 16th inside a division is placed proportionally INSIDE that unequal
 * division, which is how a player actually subdivides a swung eighth.
 */
function eighthToTime(e, beat, swing) {
  const i = Math.floor(e + 1e-9);
  const frac = e - i;
  const off = (i % 2) === 1;
  const base = Math.floor(i / 2) * beat;
  const start = off ? swing * beat : 0;
  const divLen = off ? (1 - swing) * beat : swing * beat;
  return base + start + frac * divLen;
}
/** The accent pattern IS the swing. Lift on the off eighth, weight on 1 and 3. */
function accentAt(e) {
  const i = Math.round(e);
  const off = (i % 2) === 1;
  const beat = (Math.floor(i / 2)) % 4;
  let a = off ? 1.14 : 0.93;
  if (!off && beat === 0) a *= 1.10;
  if (!off && beat === 2) a *= 1.04;
  if (Math.abs(e - i) > 0.01) a *= 0.86;        // interior 16ths are ghosted
  return a;
}

/* ==========================================================================
 * 5. RAW DSP — everything that becomes an AudioBuffer
 * Buffers are context-independent, generated once per (instrument, pitch,
 * sampleRate) and shared between the live context and every offline render.
 * ======================================================================== */
const bufCache = new Map();
function makeBuffer(sr, chans, len) {
  const L = Math.max(1, len | 0);
  try { return new AudioBuffer({ length: L, sampleRate: sr, numberOfChannels: chans }); }
  catch (e) {
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    return new OAC(1, 1, sr).createBuffer(chans, L, sr);
  }
}
function fromFloat(sr, data) {
  const b = makeBuffer(sr, 1, data.length);
  b.copyToChannel ? b.copyToChannel(data, 0) : b.getChannelData(0).set(data);
  return b;
}
function fadeEnds(a, sr, inMs = 1.2, outMs = 14) {
  const ni = Math.min(a.length, (inMs * sr / 1000) | 0);
  const no = Math.min(a.length, (outMs * sr / 1000) | 0);
  for (let i = 0; i < ni; i++) a[i] *= i / ni;
  for (let i = 0; i < no; i++) a[a.length - 1 - i] *= i / no;
  return a;
}
function normalise(a, to = 0.92) {
  let mx = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > mx) mx = v; }
  if (mx > 1e-7) { const g = to / mx; for (let i = 0; i < a.length; i++) a[i] *= g; }
  return a;
}

/** Karplus–Strong string: banjo, mandolin, cuatro, string bass. Real physical model. */
function ksString(sr, f0, seconds, o = {}) {
  const N = Math.max(64, Math.round(seconds * sr));
  const out = new Float32Array(N);
  const D = sr / f0;
  let Di = D - 0.5;                                  // the loop's 2-point average costs 0.5 samples
  let Li = Math.floor(Di); let d = Di - Li;
  if (d < 0.1) { Li -= 1; d += 1; }
  if (Li < 2) return out;
  const c = (1 - d) / (1 + d);                       // one-pole allpass -> fractional delay, exact pitch
  const line = new Float32Array(Li);
  const rnd = o.rng || new RNG(7);
  for (let i = 0; i < Li; i++) line[i] = rnd.range(-1, 1);
  // pick brightness (one-pole) then plectrum position (comb notch)
  let z = 0; const bright = o.bright ?? 0.55;
  for (let i = 0; i < Li; i++) { z += bright * (line[i] - z); line[i] = z; }
  const pp = Math.max(1, Math.round((o.pos ?? 0.16) * Li));
  const tmp = line.slice();
  for (let i = 0; i < Li; i++) line[i] = tmp[i] - 0.86 * tmp[(i - pp + Li) % Li];
  normalise(line, 1);
  const damp = o.damp ?? 0.9955;
  const tone = o.tone ?? 0.82;
  let idx = 0; let prevX = 0; let lp = 0; let apIn = 0; let apOut = 0;
  for (let n = 0; n < N; n++) {
    const x = line[idx];
    const avg = 0.5 * (x + prevX); prevX = x;
    lp += tone * (avg - lp);
    const v = lp * damp;
    const y = c * v + apIn - c * apOut; apIn = v; apOut = y;
    out[n] = y;
    line[idx] = y;
    idx = (idx + 1) % Li;
  }
  return fadeEnds(normalise(out, 0.9), sr, 0.4, 18);
}

/** Struck/additive with inharmonicity: piano, celesta, wood block, chimes. */
function additive(sr, f0, seconds, o = {}) {
  const N = Math.max(64, Math.round(seconds * sr));
  const out = new Float32Array(N);
  const parts = o.partials || [{ h: 1, a: 1, d: 1 }];
  const inh = o.inharm || 0;
  const strings = o.strings || [1];
  for (const sd of strings) {
    for (const p of parts) {
      const h = p.h;
      const f = f0 * sd * h * Math.sqrt(1 + inh * h * h);
      if (f > sr * 0.46 || f < 12) continue;
      const w = 2 * Math.PI * f / sr;
      const dec = Math.exp(-1 / Math.max(1, (p.d * (o.decay || 1) * sr)));
      let amp = p.a / strings.length;
      const ph = (o.phase || 0) * h;
      for (let n = 0; n < N; n++) {
        out[n] += amp * Math.sin(w * n + ph);
        amp *= dec;
        if (amp < 2e-6) break;
      }
    }
  }
  // hammer / mallet contact noise, band-limited around the strike point
  if (o.hammer) {
    const rnd = o.rng || new RNG(11);
    const hn = Math.min(N, Math.round((o.hammerMs || 5) * sr / 1000));
    let z = 0;
    for (let n = 0; n < hn; n++) {
      const w = rnd.range(-1, 1);
      z += 0.35 * (w - z);
      out[n] += (w - z) * o.hammer * (1 - n / hn) * (1 - n / hn);
    }
  }
  return fadeEnds(normalise(out, 0.9), sr, 0.3, 12);
}

/** Deterministic white noise, one shared 4 s block. */
function noiseBuffer(sr) {
  const key = `noise|${sr}`;
  if (bufCache.has(key)) return bufCache.get(key);
  const n = Math.round(sr * 4);
  const a = new Float32Array(n);
  const rnd = new RNG(MT.seed + 3);
  for (let i = 0; i < n; i++) a[i] = rnd.range(-1, 1);
  const b = fromFloat(sr, a);
  bufCache.set(key, b);
  return b;
}

/** Bass drum: pitch-dropping sine plus a beater click. */
function bassDrumBuf(sr, o = {}) {
  const N = Math.round(sr * (o.seconds || 0.7));
  const a = new Float32Array(N);
  const f0 = o.f0 || 96; const f1 = o.f1 || 44;
  const drop = o.drop || 0.055; const dec = o.decay || 0.16;
  let ph = 0;
  const rnd = new RNG(MT.seed + 5);
  for (let n = 0; n < N; n++) {
    const t = n / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / drop);
    ph += 2 * Math.PI * f / sr;
    a[n] = Math.sin(ph) * Math.exp(-t / dec);
    if (t < 0.006) a[n] += rnd.range(-1, 1) * 0.5 * (1 - t / 0.006);
  }
  return fadeEnds(normalise(a, 0.95), sr, 0.2, 8);
}

/** Guiro: a scrape — a burst of ticks whose spacing tightens across the stroke. */
function guiroBuf(sr, o = {}) {
  const secs = o.seconds || 0.22;
  const N = Math.round(sr * secs);
  const a = new Float32Array(N);
  const rnd = new RNG(MT.seed + 9);
  const ticks = o.ticks || 11;
  for (let k = 0; k < ticks; k++) {
    const frac = k / ticks;
    const pos = Math.round((o.tighten ? Math.pow(frac, 0.72) : frac) * N * 0.86);
    const len = Math.round(sr * 0.004);
    for (let i = 0; i < len && pos + i < N; i++) {
      a[pos + i] += rnd.range(-1, 1) * Math.exp(-i / (len * 0.4)) * (0.55 + 0.45 * frac);
    }
  }
  return fadeEnds(normalise(a, 0.9), sr, 0.3, 10);
}

/** A small procedural room. Generated, never loaded. */
function reverbIR(sr, seconds) {
  const key = `ir|${sr}|${seconds}`;
  if (bufCache.has(key)) return bufCache.get(key);
  const n = Math.round(sr * seconds);
  const b = makeBuffer(sr, 2, n);
  const rnd = new RNG(MT.seed + 17);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // early street slap then a short decay — a stone canyon, not a cathedral
      const early = (i > sr * 0.011 && i < sr * 0.013) ? 0.55 : 0;
      d[i] = (rnd.range(-1, 1) * Math.pow(1 - t, 3.1) * 0.45 + early * rnd.range(-1, 1));
    }
  }
  bufCache.set(key, b);
  return b;
}

/**
 * A true soft-clip: transparent below the knee, tanh above it. The old
 * tanh-everywhere curve was a loudness processor and it flattened the band's
 * crest factor to 8 dB, which is what a squashed 2005 master sounds like, not
 * a 1925 one. Below `knee` nothing is touched at all.
 */
function softClipCurve(knee = 0.74) {
  const n = 2048; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = (x < 0 ? -1 : 1) * y;
  }
  return c;
}

function tanhCurve(drive) {
  const n = 1024; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(x * (1 + drive * 4)) / Math.tanh(1 + drive * 4);
  }
  return c;
}

/* ==========================================================================
 * 6. THE BAND — instrument definitions
 * kind 'blow'   : live oscillator graph (reeds, brass, bowed, bellows)
 * kind 'pluck'  : Karplus-Strong buffer
 * kind 'struck' : additive buffer
 * kind 'perc'   : noise/shape buffer
 * ======================================================================== */
const INSTRUMENTS = {
  /* ---- reeds & brass -------------------------------------------------- */
  clarinet: {
    kind: 'blow', gain: 0.30, pan: 0.16,
    waves: [{ type: 'square', gain: 1 }, { type: 'triangle', gain: 0.22, detune: 0 }],
    filter: { type: 'lowpass', base: 900, track: 1.9, envAmt: 1500, q: 1.1 },
    peak: { f: 1500, q: 1.4, gain: 4 },
    // s 0.60, not 0.86. A reed that holds 86% of its peak for the whole note
    // leaves no floor between beats: measured, the arranged cues sat at 6 dB of
    // 20 ms peak-to-trough inside a 0.6 s window while the sparse bed sat at 41.
    // Real players breathe and taper; the tune has to open up between notes or
    // the swing lives only on paper.
    env: { a: 0.032, d: 0.06, s: 0.60, r: 0.085 },
    vib: { rate: 5.1, cents: 11, delay: 0.24 },
    noise: { gain: 0.030, hp: 1800, lp: 6500 },
    drive: 0.12,
  },
  clarinet_low: {                                   // chalumeau: woody, hollow
    kind: 'blow', gain: 0.32, pan: 0.12,
    waves: [{ type: 'square', gain: 1 }],
    filter: { type: 'lowpass', base: 520, track: 1.2, envAmt: 700, q: 2.2 },
    env: { a: 0.045, d: 0.12, s: 0.9, r: 0.10 },
    vib: { rate: 4.6, cents: 7, delay: 0.3 },
    noise: { gain: 0.035, hp: 900, lp: 4000 },
    drive: 0.08,
  },
  cornet: {
    kind: 'blow', gain: 0.28, pan: -0.13,
    waves: [{ type: 'sawtooth', gain: 1 }, { type: 'sawtooth', gain: 0.42, detune: 7 }],
    filter: { type: 'lowpass', base: 1250, track: 1.5, envAmt: 2400, q: 1.0 },
    peak: { f: 1150, q: 1.6, gain: 6 },
    env: { a: 0.040, d: 0.06, s: 0.58, r: 0.10 },
    vib: { rate: 5.6, cents: 8, delay: 0.30 },
    noise: { gain: 0.022, hp: 2200, lp: 8000 },
    drive: 0.22, rip: 190,                          // brass attack scoops up from below
  },
  cornet_plunger: {                                 // the plunger opens across the note
    kind: 'blow', gain: 0.30, pan: -0.16,
    waves: [{ type: 'sawtooth', gain: 1 }, { type: 'sawtooth', gain: 0.5, detune: -9 }],
    filter: { type: 'bandpass', base: 620, track: 0.30, envAmt: 1500, q: 3.4, wah: true },
    peak: { f: 1750, q: 2.2, gain: 7 },
    env: { a: 0.045, d: 0.07, s: 0.62, r: 0.11 },
    vib: { rate: 5.4, cents: 10, delay: 0.26 },
    noise: { gain: 0.030, hp: 1400, lp: 5200 },
    drive: 0.36, rip: 150, growl: 27,
  },
  trombone: {
    kind: 'blow', gain: 0.30, pan: -0.24,
    waves: [{ type: 'sawtooth', gain: 1 }, { type: 'sawtooth', gain: 0.35, detune: -6 }],
    filter: { type: 'lowpass', base: 720, track: 1.25, envAmt: 1500, q: 1.3 },
    peak: { f: 620, q: 1.5, gain: 5 },
    env: { a: 0.055, d: 0.06, s: 0.60, r: 0.13 },
    vib: { rate: 4.9, cents: 9, delay: 0.34 },
    noise: { gain: 0.026, hp: 900, lp: 4200 },
    drive: 0.30, rip: 120,
  },
  tuba: {
    kind: 'blow', gain: 0.34, pan: 0.02,
    // A sine at the FUNDAMENTAL, not an octave below it. The sub-octave was
    // putting 25-45 Hz into the mix, which BYB §6.5 bans outright and which
    // read on the spectrum as a wall of mud under everything else.
    waves: [{ type: 'sawtooth', gain: 1 }, { type: 'sine', gain: 0.55, detune: 0 }],
    filter: { type: 'lowpass', base: 240, track: 0.85, envAmt: 380, q: 1.1 },
    env: { a: 0.030, d: 0.07, s: 0.62, r: 0.09 },
    vib: { rate: 4.2, cents: 4, delay: 0.4 },
    noise: { gain: 0.030, hp: 220, lp: 1400 },
    drive: 0.20,
  },
  accordion: {                                      // musette: the beating IS the vibrato
    kind: 'blow', gain: 0.24, pan: 0.20,
    waves: [
      { type: 'sawtooth', gain: 0.8, detune: -14 },
      { type: 'sawtooth', gain: 0.8, detune: 14 },
      { type: 'square', gain: 0.35, detune: 0 },
    ],
    filter: { type: 'lowpass', base: 1700, track: 1.1, envAmt: 900, q: 0.9 },
    env: { a: 0.070, d: 0.10, s: 0.94, r: 0.16 },
    noise: { gain: 0.018, hp: 500, lp: 3000 },
    drive: 0.10,
  },
  erhu: {                                           // bowed two-string, nasal, portamento
    kind: 'blow', gain: 0.26, pan: -0.08,
    waves: [{ type: 'sawtooth', gain: 1 }],
    filter: { type: 'lowpass', base: 2200, track: 1.3, envAmt: 1100, q: 1.4 },
    peak: { f: 1050, q: 5.0, gain: 8 },
    peak2: { f: 340, q: 4.0, gain: 5 },
    env: { a: 0.085, d: 0.12, s: 0.92, r: 0.14 },
    vib: { rate: 6.2, cents: 26, delay: 0.16 },
    noise: { gain: 0.030, hp: 2500, lp: 7000 },     // bow hair
    drive: 0.10, glide: 0.075,
  },
  penny_whistle: {
    kind: 'blow', gain: 0.24, pan: 0.22,
    waves: [{ type: 'triangle', gain: 1 }, { type: 'sine', gain: 0.5, detune: 1200 }],
    filter: { type: 'lowpass', base: 3200, track: 1.6, envAmt: 2600, q: 0.7 },
    env: { a: 0.020, d: 0.06, s: 0.72, r: 0.07 },
    vib: { rate: 5.9, cents: 14, delay: 0.20 },
    noise: { gain: 0.085, hp: 2800, lp: 9500 },     // a whistle is mostly breath
    chiff: 0.5,
    drive: 0.05,
  },
  /**
   * THE HARMONICA. Otto's roster charm says harmonica, his art prop is a
   * harmonica, and the Gooch says out loud between innings that Otto plays four
   * bars of it — so the score has to own one. A ten-hole diatonic is two rows of
   * reeds: you BLOW one set and DRAW the other, and the two rows do not sound
   * alike, so `draw` shifts the formant on every other note down the line. That
   * alternation is the whole reason a harmonica sounds like a harmonica and not
   * like a small accordion.
   */
  harmonica: {
    kind: 'blow', gain: 0.26, pan: 0.14,
    waves: [
      { type: 'sawtooth', gain: 1, detune: -9 },
      { type: 'sawtooth', gain: 1, detune: 9 },
      { type: 'square', gain: 0.4, detune: 0 },
    ],
    filter: { type: 'bandpass', base: 1900, track: 0.6, envAmt: 900, q: 1.8 },
    peak: { f: 2400, q: 2.0, gain: 5 },
    // s 0.66, not 0.78: a harmonica is a breath instrument and it tapers. At 0.78
    // under a legato lead the rendered envelope was a flat ribbon with no visible
    // notes in it — see shots/music-r2/audio/walkup_otto-analysis.png before/after.
    env: { a: 0.012, d: 0.05, s: 0.66, r: 0.06 },
    vib: { rate: 5.4, cents: 12, delay: 0.28 },
    noise: { gain: 0.05, hp: 1200, lp: 7000 },      // the breath through the comb
    draw: 300,                                      // draw reeds sit a formant higher
    drive: 0.18,
  },
  kazoo: {                                          // membrane buzz + fixed nasal formant
    kind: 'blow', gain: 0.19, pan: 0.26,
    waves: [{ type: 'sawtooth', gain: 1 }, { type: 'square', gain: 0.5, detune: 4 }],
    filter: { type: 'bandpass', base: 1000, track: 0.25, envAmt: 300, q: 2.6 },
    peak: { f: 2450, q: 3.0, gain: 9 },
    env: { a: 0.020, d: 0.06, s: 0.74, r: 0.05 },
    vib: { rate: 5.0, cents: 18, delay: 0.10 },
    noise: { gain: 0.05, hp: 1500, lp: 6000 },
    drive: 0.85, growl: 42,                         // the membrane rattle
  },

  /* ---- strings (Karplus-Strong) --------------------------------------- */
  banjo: {
    kind: 'pluck', gain: 0.30, pan: 0.28,
    ks: { damp: 0.9930, tone: 0.90, bright: 0.80, pos: 0.11 }, tail: 1.5,
    body: { type: 'peaking', f: 420, q: 1.1, gain: 5 },
    hp: 190, drive: 0.14,
  },
  mandolin: {
    kind: 'pluck', gain: 0.26, pan: 0.24,
    ks: { damp: 0.9948, tone: 0.86, bright: 0.72, pos: 0.19 }, tail: 1.3,
    courses: [-6, 6],
    body: { type: 'peaking', f: 680, q: 1.4, gain: 4 },
    hp: 220, drive: 0.10,
  },
  cuatro: {
    kind: 'pluck', gain: 0.27, pan: -0.22,
    ks: { damp: 0.9958, tone: 0.66, bright: 0.48, pos: 0.24 }, tail: 1.9,
    courses: [-4, 4],
    body: { type: 'peaking', f: 300, q: 1.2, gain: 5 },
    hp: 110, drive: 0.06,
  },
  string_bass: {
    kind: 'pluck', gain: 0.38, pan: 0.0,
    ks: { damp: 0.9972, tone: 0.42, bright: 0.32, pos: 0.28 }, tail: 1.5,
    body: { type: 'peaking', f: 92, q: 1.0, gain: 6 },
    lp: 1400, drive: 0.10,
  },

  /* ---- struck (additive) ---------------------------------------------- */
  piano: {
    kind: 'struck', gain: 0.30, pan: -0.20,
    add: {
      partials: [
        { h: 1, a: 1.00, d: 1.60 }, { h: 2, a: 0.52, d: 1.05 }, { h: 3, a: 0.30, d: 0.72 },
        { h: 4, a: 0.19, d: 0.52 }, { h: 5, a: 0.12, d: 0.38 }, { h: 6, a: 0.085, d: 0.30 },
        { h: 7, a: 0.055, d: 0.24 }, { h: 8, a: 0.04, d: 0.20 }, { h: 10, a: 0.026, d: 0.15 },
      ],
      inharm: 0.00035, strings: [0.9992, 1.0008], hammer: 0.30, hammerMs: 4,
    },
    tail: 2.0, body: { type: 'peaking', f: 2300, q: 0.9, gain: 2 }, drive: 0.06,
  },
  piano_tinny: {                                    // the upright in the third-floor window
    kind: 'struck', gain: 0.26, pan: -0.10,
    add: {
      partials: [
        { h: 1, a: 0.55, d: 0.70 }, { h: 2, a: 0.80, d: 0.60 }, { h: 3, a: 0.62, d: 0.45 },
        { h: 4, a: 0.40, d: 0.34 }, { h: 5, a: 0.30, d: 0.26 }, { h: 6, a: 0.22, d: 0.20 },
        { h: 8, a: 0.14, d: 0.14 },
      ],
      inharm: 0.0016, strings: [0.9975, 1.0026], hammer: 0.42, hammerMs: 5,
    },
    tail: 1.1, hp: 320, drive: 0.16,
  },
  celesta: {
    kind: 'struck', gain: 0.24, pan: 0.18,
    add: {
      partials: [
        { h: 1, a: 1.0, d: 2.4 }, { h: 3.01, a: 0.34, d: 1.5 }, { h: 5.42, a: 0.16, d: 0.9 },
        { h: 8.9, a: 0.07, d: 0.5 }, { h: 2.0, a: 0.10, d: 1.1 },
      ],
      inharm: 0.0, hammer: 0.10, hammerMs: 3,
    },
    tail: 2.4, body: { type: 'peaking', f: 3200, q: 1.0, gain: 3 }, drive: 0.0,
  },
  wood_block: {
    kind: 'struck', gain: 0.30, pan: 0.30,
    add: {
      partials: [{ h: 1, a: 1.0, d: 0.055 }, { h: 2.76, a: 0.55, d: 0.032 }, { h: 5.4, a: 0.22, d: 0.018 }],
      inharm: 0, hammer: 0.55, hammerMs: 2,
    },
    tail: 0.24, body: { type: 'peaking', f: 1800, q: 2.0, gain: 4 }, drive: 0.10,
  },

  /* ---- percussion ------------------------------------------------------ */
  brush_swirl: { kind: 'perc', gain: 0.16, pan: -0.24, perc: 'swirl' },
  brush_tap: { kind: 'perc', gain: 0.20, pan: 0.22, perc: 'tap' },
  snare_roll: { kind: 'perc', gain: 0.17, pan: 0.10, perc: 'roll' },
  cymbal: { kind: 'perc', gain: 0.19, pan: 0.26, perc: 'cymbal' },
  hi_hat: { kind: 'perc', gain: 0.14, pan: 0.30, perc: 'hat' },
  bass_drum: { kind: 'perc', gain: 0.42, pan: 0.0, perc: 'kick' },
  guiro: { kind: 'perc', gain: 0.24, pan: 0.26, perc: 'guiro' },
  washboard: { kind: 'perc', gain: 0.16, pan: -0.28, perc: 'washboard' },
};

// Alias so a roster entry can name any of the bible's bank and still sound.
const INSTRUMENT_ALIAS = {
  jaw_harp: 'kazoo', hurdy_gurdy: 'accordion',
  tin_whistle: 'penny_whistle', spoons: 'wood_block', jug: 'tuba', cornet_muted: 'cornet_plunger',
};
const inst = (n) => INSTRUMENTS[n] || INSTRUMENTS[INSTRUMENT_ALIAS[n]] || INSTRUMENTS.piano;
const instName = (n) => (INSTRUMENTS[n] ? n : (INSTRUMENT_ALIAS[n] || 'piano'));

/* ==========================================================================
 * 7. RENDER GRAPH — one class, used identically live and offline
 * buses + reverb -> musicIn -> HP/air EQ -> musicBus -> [radio chain]
 *   -> DUCK -> soft clip -> master -> out
 * ======================================================================== */
class Render {
  constructor(ctx, { seed = MT.seed, world = false, gain = 1, dest = null } = {}) {
    this.ctx = ctx;
    this.rng = new RNG(seed);
    this.sr = ctx.sampleRate;

    this.master = ctx.createGain();
    this.master.gain.value = MT.masterGain * gain;
    // `dest` is how the audio engine's music bus gets to own the final balance.
    // Offline renders go straight to the destination so a measurement is of the
    // music and not of somebody else's mixer.
    this.master.connect(dest || ctx.destination);

    this.limiter = ctx.createWaveShaper();
    this.limiter.curve = softClipCurve(0.74);
    this.limiter.oversample = '2x';
    this.limiter.connect(this.master);

    // THE DUCK. Everything musical passes through here and nothing else does.
    this.duckGain = ctx.createGain();
    this.duckGain.gain.value = 1;
    this.duckGain.connect(this.limiter);
    this._duckUntil = 0;

    /**
     * ARRANGEMENT DYNAMICS, on their OWN gain stage.
     * A break — the band stops dead and one horn keeps going — is the oldest
     * device in this music, and it is a level move, not a note move. It used to
     * have nowhere to live: the only automatable gain in the chain was the duck,
     * and an arrangement that writes to the duck fights the announcer for the
     * same AudioParam and loses (or wins, which is worse). So there are two
     * stages now. `arrangeAt` is the composer. `duckAt` is the mix. They
     * multiply, they never overwrite each other, and the announcer still wins.
     */
    this.arrangeGain = ctx.createGain();
    this.arrangeGain.gain.value = 1;
    this.arrangeGain.connect(this.duckGain);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MT.mixTrim;

    /**
     * Bus EQ. Two decisions, both from looking at the rendered spectrum:
     * a 12 dB/oct high-pass at 55 Hz, because nothing in a 1925 band lives below
     * the tuba's low F and everything down there was mud; and a small air shelf,
     * because Backyard is BRIGHT and an unshelved acoustic band reads dull.
     */
    const hp1 = ctx.createBiquadFilter(); hp1.type = 'highpass'; hp1.frequency.value = 55; hp1.Q.value = 0.7;
    const hp2 = ctx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 55; hp2.Q.value = 0.7;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 3600; air.gain.value = 4;
    // and a low shelf, which is both Backyard-true (bright, melody forward) and
    // period-true (a 1925 acoustic horn could not capture much under 150 Hz,
    // which is exactly why the tuba replaced the string bass in the studio)
    const lowsh = ctx.createBiquadFilter(); lowsh.type = 'lowshelf'; lowsh.frequency.value = 165; lowsh.gain.value = -3;
    this.musicIn = ctx.createGain();
    this.musicIn.connect(hp1); hp1.connect(hp2); hp2.connect(lowsh); lowsh.connect(air); air.connect(this.musicBus);

    if (world) {
      // 1925 battery receiver + horn speaker + shellac. BIBLE §7.1's filter boundary.
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 200; hp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 4000; lp.Q.value = 0.9;
      const honk = ctx.createBiquadFilter(); honk.type = 'peaking'; honk.frequency.value = 1200; honk.Q.value = 2.2; honk.gain.value = 7;
      const dip = ctx.createBiquadFilter(); dip.type = 'peaking'; dip.frequency.value = 480; dip.Q.value = 1.4; dip.gain.value = -6;
      const crunch = ctx.createWaveShaper(); crunch.curve = tanhCurve(0.30);
      // wow & flutter: a slowly modulated delay
      const wow = ctx.createDelay(0.06); wow.delayTime.value = 0.012;
      const wowLfo = ctx.createOscillator(); wowLfo.type = 'sine'; wowLfo.frequency.value = 0.7;
      const wowAmt = ctx.createGain(); wowAmt.gain.value = 0.0016;
      wowLfo.connect(wowAmt).connect(wow.delayTime); wowLfo.start(0);
      this.tailSources = [wowLfo];
      /**
       * ORDER MATTERS AND IT WAS WRONG. The waveshaper used to sit AFTER the
       * 4 kHz lowpass with oversampling off, so its odd harmonics and its
       * aliases landed at 8–13 kHz with nothing in front of them — a 1925 horn
       * speaker that was brighter in the top octave than the modern full-band
       * mix it is supposed to contrast with. The distortion now happens where a
       * receiver's distortion happens, in front of the horn, and the horn is
       * two cascaded poles pairs (24 dB/oct) because a real horn does not roll
       * off gently. §7.1's boundary is the point of this cue; it has to be a
       * boundary you can hear.
       */
      const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 4000; lp2.Q.value = 0.6;
      crunch.oversample = '4x';
      this.musicBus.connect(hp); hp.connect(dip); dip.connect(honk); honk.connect(crunch);
      crunch.connect(lp); lp.connect(lp2); lp2.connect(wow); wow.connect(this.arrangeGain);
      // shellac surface noise, always present, never loud — and coming off the
      // same disc through the same horn, so it goes through the same lowpass
      const sn = ctx.createBufferSource(); sn.buffer = noiseBuffer(this.sr); sn.loop = true;
      const snf = ctx.createBiquadFilter(); snf.type = 'bandpass'; snf.frequency.value = 2600; snf.Q.value = 2.0;
      const sng = ctx.createGain(); sng.gain.value = 0.016;
      sn.connect(snf).connect(sng).connect(lp); sn.start(0);
      this.tailSources.push(sn);
      this.world = true;
    } else {
      this.musicBus.connect(this.arrangeGain);
    }

    // a small stone-canyon room, generated
    this.revSend = ctx.createGain();
    this.revSend.gain.value = MT.reverbSend;
    const conv = ctx.createConvolver();
    conv.buffer = reverbIR(this.sr, MT.reverbSeconds);
    conv.normalize = true;
    this.revSend.connect(conv).connect(this.musicIn);

    // Section balance, set by reading the spectrum: the bass section was carrying
    // the whole low end and burying the lead.
    this.buses = {};
    const busGain = { lead: 1.22, comp: 1.0, bass: 0.70, perc: 0.98 };
    for (const b of ['lead', 'comp', 'bass', 'perc']) {
      const g = ctx.createGain();
      g.gain.value = busGain[b];
      g.connect(this.musicIn);
      this.buses[b] = g;
    }
    this.channels = new Map();
    this.lastNoteEnd = 0;
  }

  /**
   * The two nodes in this graph that would otherwise run forever — the shellac
   * surface noise and the wow LFO — get an end time. That used to be harmless
   * because `world_radio` was never actually played; now it is layered under the
   * bed and retiled every pass, and without this each pass would stack another
   * permanent hiss on top of the last one.
   */
  endSources(t) {
    for (const src of (this.tailSources || [])) { try { src.stop(t); } catch (e) { /* already stopped */ } }
  }

  /** One mixer strip per instrument per render — not per note. Keeps node count sane. */
  channel(name, busName = 'comp', opts = {}) {
    const key = `${name}|${busName}|${opts.tag || ''}`;
    if (this.channels.has(key)) return this.channels.get(key);
    const ctx = this.ctx; const S = inst(name);
    const g = ctx.createGain();
    g.gain.value = (opts.gain ?? 1);
    let node = g;
    if (S.drive) {
      const ws = ctx.createWaveShaper();
      ws.curve = tanhCurve(S.drive); ws.oversample = '2x';
      node.connect(ws); node = ws;
    }
    if (S.body) {
      const f = ctx.createBiquadFilter();
      f.type = S.body.type; f.frequency.value = S.body.f;
      f.Q.value = S.body.q; f.gain.value = S.body.gain;
      node.connect(f); node = f;
    }
    if (S.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = S.hp; node.connect(f); node = f; }
    if (S.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = S.lp; node.connect(f); node = f; }
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = (opts.pan ?? S.pan ?? 0); node.connect(pan); node = pan; }
    node.connect(this.buses[busName] || this.buses.comp);
    const send = ctx.createGain();
    send.gain.value = opts.wet ?? 1;
    node.connect(send); send.connect(this.revSend);
    const strip = { in: g, out: node };
    this.channels.set(key, strip);
    return strip;
  }

  /**
   * THE DUCK — the one thing in this file that outranks the music.
   * Same call live (announcer bus, bat:contact) and offline (`duck_proof`).
   */
  duckAt(t, depthDb, hold, release, attack) {
    const g = this.duckGain.gain;
    const a = attack ?? MT.duckAttack;
    const lvl = dB(depthDb);
    const t0 = Math.max(t, this.ctx.currentTime || 0);
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value !== undefined ? Math.min(1, g.value) : 1, t0);
    g.linearRampToValueAtTime(lvl, t0 + a);
    g.setValueAtTime(lvl, t0 + a + hold);
    g.linearRampToValueAtTime(1, t0 + a + hold + release);
    this._duckUntil = t0 + a + hold + release;
  }

  /**
   * THE BREAK. Fall to `db` over `fall`, sit there for `hold`, come back over
   * `rise`. Deliberately does NOT cancelScheduledValues: a looping cue writes one
   * of these per pass and they have to stack up the timeline in order, not erase
   * each other. Deliberately not on the duck gain either — see the constructor.
   */
  arrangeAt(t, db, hold, rise = 0.12, fall = 0.04) {
    const g = this.arrangeGain.gain;
    const lvl = dB(db);
    const t0 = Math.max(t, (this.ctx.currentTime || 0) + fall);
    g.setValueAtTime(1, t0 - fall);
    g.linearRampToValueAtTime(lvl, t0);
    g.setValueAtTime(lvl, t0 + hold);
    g.linearRampToValueAtTime(1, t0 + hold + rise);
    return t0 + hold + rise;
  }

  /* --- note dispatch ---------------------------------------------------- */
  note(name, midi, t, dur, vel = 1, opts = {}) {
    const S = inst(name);
    // micro-timing and grace notes can push an event a few ms before the cue's
    // origin; AudioParam times may never be negative, so the graph starts at 0.
    if (!(t >= 0)) t = 0;
    const end = t + dur;
    if (end > this.lastNoteEnd) this.lastNoteEnd = end;
    if (S.kind === 'blow') return this._blow(name, S, midi, t, dur, vel, opts);
    if (S.kind === 'pluck') return this._pluck(name, S, midi, t, dur, vel, opts);
    if (S.kind === 'struck') return this._struck(name, S, midi, t, dur, vel, opts);
    return this._perc(name, S, midi, t, dur, vel, opts);
  }

  _blow(name, S, midi, t, dur, vel, o) {
    const ctx = this.ctx;
    const strip = this.channel(name, o.bus || 'lead', { pan: o.pan, gain: o.chanGain, wet: o.wet, tag: o.tag });
    const f = mtof(midi + (o.detuneSemis || 0));
    const env = S.env;
    const peak = Math.max(0.0005, vel * (S.gain || 0.3) * (o.gain ?? 1));
    const sus = peak * env.s;
    const hold = Math.max(dur, env.a + env.d + 0.02);
    const off = t + hold;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + env.a);
    amp.gain.linearRampToValueAtTime(sus, t + env.a + env.d);
    amp.gain.setValueAtTime(sus, off);
    amp.gain.linearRampToValueAtTime(0.0001, off + env.r);
    amp.connect(strip.in);

    // filter: brightness tracks the note and opens with the breath
    const filt = ctx.createBiquadFilter();
    filt.type = S.filter.type;
    // draw vs blow: two physically different rows of reeds, alternating down the
    // line. Counted per instrument per render, so it is deterministic.
    let drawShift = 0;
    if (S.draw) {
      this._draw = this._draw || new Map();
      const k = this._draw.get(name) || 0;
      this._draw.set(name, k + 1);
      drawShift = (k % 2) ? S.draw : 0;
    }
    const base = S.filter.base + drawShift + S.filter.track * f;
    filt.Q.value = S.filter.q;
    if (S.filter.wah) {
      // plunger: closed -> open -> closing again across the note
      filt.frequency.setValueAtTime(base * 0.85, t);
      filt.frequency.linearRampToValueAtTime(base + S.filter.envAmt * (0.6 + 0.6 * vel), t + Math.min(0.26, hold * 0.55));
      filt.frequency.linearRampToValueAtTime(base * 1.05, off + env.r);
    } else {
      filt.frequency.setValueAtTime(base * 0.55, t);
      filt.frequency.linearRampToValueAtTime(base + S.filter.envAmt * vel, t + env.a + 0.01);
      filt.frequency.linearRampToValueAtTime(base + S.filter.envAmt * 0.45 * vel, off + env.r);
    }
    let chain = filt;
    if (S.peak) {
      const p = ctx.createBiquadFilter();
      p.type = 'peaking'; p.frequency.value = S.peak.f; p.Q.value = S.peak.q; p.gain.value = S.peak.gain;
      chain.connect(p); chain = p;
    }
    if (S.peak2) {
      const p = ctx.createBiquadFilter();
      p.type = 'peaking'; p.frequency.value = S.peak2.f; p.Q.value = S.peak2.q; p.gain.value = S.peak2.gain;
      chain.connect(p); chain = p;
    }
    chain.connect(amp);

    const stopAt = off + env.r + 0.03;
    const oscs = [];
    for (const w of (S.waves || [])) {
      const osc = ctx.createOscillator();
      osc.type = w.type;
      const g = ctx.createGain();
      g.gain.value = w.gain;
      // pitch: glide from the previous note, or a brass rip up from below
      const startF = o.glideFrom ? mtof(o.glideFrom) : (S.rip ? f * Math.pow(2, -S.rip / 1200) : f);
      const glideT = o.glideFrom ? (S.glide || 0.06) : (S.rip ? 0.045 : 0);
      osc.frequency.setValueAtTime(Math.max(8, startF), t);
      if (glideT > 0) osc.frequency.exponentialRampToValueAtTime(f, t + glideT);
      if (o.gliss) {
        const gf = mtof(midi + o.gliss);
        osc.frequency.setValueAtTime(f, off - Math.min(0.22, hold * 0.5));
        osc.frequency.exponentialRampToValueAtTime(Math.max(8, gf), off + env.r * 0.8);
      }
      osc.detune.value = w.detune || 0;
      osc.connect(g).connect(filt);
      osc.start(t); osc.stop(stopAt);
      oscs.push(osc);
    }
    // vibrato, delayed the way a player delays it
    if (S.vib && hold > 0.16) {
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = S.vib.rate;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0.0001, t);
      lg.gain.setValueAtTime(0.0001, t + Math.min(S.vib.delay, hold * 0.6));
      lg.gain.linearRampToValueAtTime(S.vib.cents, t + Math.min(S.vib.delay, hold * 0.6) + 0.12);
      for (const osc of oscs) lg.connect(osc.detune);
      lfo.connect(lg); lfo.start(t); lfo.stop(stopAt);
    }
    // growl / membrane buzz (kazoo, plunger cornet)
    if (S.growl) {
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = S.growl;
      const lg = ctx.createGain(); lg.gain.value = peak * 0.22;
      lfo.connect(lg).connect(amp.gain); lfo.start(t); lfo.stop(stopAt);
    }
    // breath / bow / chiff
    if (S.noise && S.noise.gain > 0) {
      const n = ctx.createBufferSource();
      n.buffer = noiseBuffer(this.sr); n.loop = true;
      n.playbackRate.value = 0.8 + this.rng.next() * 0.4;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass';
      nf.frequency.value = Math.min(this.sr * 0.4, (S.noise.hp + S.noise.lp) / 2);
      nf.Q.value = 0.8;
      const ng = ctx.createGain();
      const nb = peak * S.noise.gain / Math.max(0.08, S.gain);
      ng.gain.setValueAtTime(nb * (S.chiff ? (1 + S.chiff * 3) : 1), t);
      ng.gain.linearRampToValueAtTime(nb, t + (S.chiff ? 0.045 : env.a));
      ng.gain.setValueAtTime(nb, off);
      ng.gain.linearRampToValueAtTime(0.0001, off + env.r);
      n.connect(nf).connect(ng).connect(strip.in);
      n.start(t); n.stop(stopAt);
    }
    return { end: stopAt };
  }

  _bufferFor(name, S, midi, o) {
    const key = `${name}|${midi}|${this.sr}|${o.variant || ''}`;
    if (bufCache.has(key)) return bufCache.get(key);
    const f = mtof(midi);
    let data;
    if (S.kind === 'pluck') {
      const tail = Math.min(S.tail * Math.pow(240 / Math.max(35, f), 0.35), 3.2);
      const courses = S.courses || [0];
      const N = Math.round(tail * this.sr);
      data = new Float32Array(N);
      for (let ci = 0; ci < courses.length; ci++) {
        const rnd = new RNG(MT.seed + midi * 13 + ci * 101);
        const one = ksString(this.sr, mtof(midi + courses[ci] / 100), tail, { ...S.ks, rng: rnd });
        const skew = ci === 0 ? 0 : Math.round(this.sr * 0.006);   // the second course is a hair late
        for (let i = 0; i < N - skew; i++) data[i + skew] += one[i] / courses.length;
      }
    } else {
      const tail = Math.min(S.tail * Math.pow(220 / Math.max(30, f), 0.30), 3.4);
      data = additive(this.sr, f, tail, { ...S.add, rng: new RNG(MT.seed + midi * 7) });
    }
    const buf = fromFloat(this.sr, data);
    bufCache.set(key, buf);
    return buf;
  }

  _pluckLike(name, S, midi, t, dur, vel, o) {
    const ctx = this.ctx;
    const strip = this.channel(name, o.bus || 'comp', { pan: o.pan, gain: o.chanGain, wet: o.wet, tag: o.tag });
    const buf = this._bufferFor(name, S, midi, o);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const amp = ctx.createGain();
    const peak = Math.max(0.0005, vel * (S.gain || 0.3) * (o.gain ?? 1));
    amp.gain.setValueAtTime(peak, t);
    // damping: a stopped string (staccato comp chunk) is the banjo's whole rhythmic identity
    const damp = o.damp ?? dur;
    const rel = o.release ?? 0.05;
    amp.gain.setValueAtTime(peak, t + Math.max(0.01, damp));
    amp.gain.linearRampToValueAtTime(0.0001, t + Math.max(0.01, damp) + rel);
    src.connect(amp).connect(strip.in);
    src.start(t);
    src.stop(t + Math.min(buf.duration, damp + rel + 0.05));
    return { end: t + damp + rel };
  }
  _pluck(...a) { return this._pluckLike(...a); }
  _struck(...a) { return this._pluckLike(...a); }

  _perc(name, S, midi, t, dur, vel, o) {
    const ctx = this.ctx;
    const strip = this.channel(name, o.bus || 'perc', { pan: o.pan, gain: o.chanGain, wet: o.wet, tag: o.tag });
    const peak = Math.max(0.0005, vel * (S.gain || 0.2) * (o.gain ?? 1));
    const kind = S.perc;

    if (kind === 'kick') {
      const key = `kick|${this.sr}`;
      let b = bufCache.get(key);
      if (!b) { b = fromFloat(this.sr, bassDrumBuf(this.sr, {})); bufCache.set(key, b); }
      const src = ctx.createBufferSource(); src.buffer = b;
      src.playbackRate.value = o.rate || 1;
      const g = ctx.createGain(); g.gain.value = peak;
      src.connect(g).connect(strip.in); src.start(t); src.stop(t + b.duration);
      return { end: t + b.duration };
    }
    if (kind === 'guiro') {
      const key = `guiro|${this.sr}|${o.variant || 0}`;
      let b = bufCache.get(key);
      if (!b) { b = fromFloat(this.sr, guiroBuf(this.sr, { seconds: 0.2, ticks: o.variant ? 6 : 12, tighten: true })); bufCache.set(key, b); }
      const src = ctx.createBufferSource(); src.buffer = b;
      src.playbackRate.value = o.rate || 1;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2100; f.Q.value = 1.1;
      const g = ctx.createGain(); g.gain.value = peak;
      src.connect(f).connect(g).connect(strip.in); src.start(t); src.stop(t + b.duration + 0.02);
      return { end: t + b.duration };
    }

    // noise-derived voices, shaped entirely by nodes
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(this.sr);
    src.loop = true;
    src.playbackRate.value = 0.7 + this.rng.next() * 0.6;
    const f1 = ctx.createBiquadFilter();
    const g = ctx.createGain();
    let len = 0.12; let atk = 0.002;
    if (kind === 'swirl') {
      f1.type = 'bandpass'; f1.frequency.value = 1500 + this.rng.next() * 400; f1.Q.value = 0.55;
      len = Math.max(0.14, dur); atk = len * 0.62;                       // the swish rises then leaves
    } else if (kind === 'tap') {
      f1.type = 'bandpass'; f1.frequency.value = 3400; f1.Q.value = 1.1; len = 0.055;
    } else if (kind === 'hat') {
      f1.type = 'highpass'; f1.frequency.value = 6200; len = o.open ? 0.24 : 0.055;
    } else if (kind === 'roll') {
      f1.type = 'bandpass'; f1.frequency.value = 2100; f1.Q.value = 0.8; len = Math.max(0.2, dur); atk = len * 0.75;
    } else if (kind === 'cymbal') {
      f1.type = 'highpass'; f1.frequency.value = 3200; len = o.choke ? 0.16 : 2.0; atk = 0.004;
    } else if (kind === 'washboard') {
      f1.type = 'bandpass'; f1.frequency.value = 4200; f1.Q.value = 0.9; len = 0.07;
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.exponentialRampToValueAtTime(Math.max(0.00005, peak * 0.02), t + len);
    g.gain.linearRampToValueAtTime(0.0001, t + len + 0.02);
    src.connect(f1).connect(g);
    if (kind === 'roll') {
      // press roll: a 31 Hz flutter plus the snares' own tone
      const am = ctx.createGain(); am.gain.value = 1;
      const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 31;
      const la = ctx.createGain(); la.gain.value = 0.5;
      lfo.connect(la).connect(am.gain); lfo.start(t); lfo.stop(t + len + 0.05);
      g.connect(am).connect(strip.in);
      const tone = ctx.createOscillator(); tone.type = 'triangle'; tone.frequency.value = 188;
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.linearRampToValueAtTime(peak * 0.22, t + atk);
      tg.gain.linearRampToValueAtTime(0.0001, t + len + 0.02);
      tone.connect(tg).connect(strip.in); tone.start(t); tone.stop(t + len + 0.05);
    } else if (kind === 'cymbal') {
      // a couple of inharmonic rings so it is a cymbal and not a hiss
      for (const [fr, gn] of [[3170, 0.5], [5210, 0.34], [7430, 0.22]]) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = 8;
        const bg = ctx.createGain(); bg.gain.value = gn;
        g.connect(bp).connect(bg).connect(strip.in);
      }
      g.connect(strip.in);
    } else {
      g.connect(strip.in);
    }
    src.start(t); src.stop(t + len + 0.06);
    return { end: t + len };
  }
}

/* ==========================================================================
 * 8. THE ARRANGER — parts, written the way a 1925 band actually plays them
 * ======================================================================== */
function planOf({ bpm, swing, chartStr, bars, seed }) {
  const bars_ = chart(chartStr);
  return {
    bpm, beat: 60 / bpm, swing: swing ?? MT.swing,
    bars: bars_, nBars: bars ?? bars_.length,
    rng: new RNG(seed ?? MT.seed),
  };
}
const barT = (P, bar) => bar * 4 * P.beat;
function tAt(P, bar, eighth) { return barT(P, bar) + eighthToTime(eighth, P.beat, P.swing); }
function human(P, ms) { return (P.rng.next() - 0.5) * 2 * (ms / 1000); }

/** Stride piano: bass note on 1 and 3, chord on 2 and 4, with real voice leading. */
function partStride(R, P, t0, o = {}) {
  const from = o.from ?? 0; const to = o.to ?? P.nBars;
  const g = o.gain ?? 1;
  let voicing = null;
  let lastBass = 40;
  for (let bar = from; bar < to; bar++) {
    const ch = chordAt(P.bars, bar, 0);
    const ch3 = chordAt(P.bars, bar, 2);
    // bass: root on 1, fifth on 3 — the alternation IS stride
    const rootM = nearest(ch.bass, 33, 45, lastBass);
    const fifthM = nearest((ch3.root + 7) % 12, 33, 47, rootM + 5);
    lastBass = rootM;
    R.note('piano', rootM, t0 + tAt(P, bar, 0) + human(P, 5), 0.42 * P.beat, 0.95 * g, { bus: 'bass', damp: 0.5 * P.beat });
    if (o.tenth !== false && P.rng.chance(0.25)) {
      R.note('piano', rootM + 16, t0 + tAt(P, bar, 0) + human(P, 5) + 0.012, 0.36 * P.beat, 0.55 * g, { bus: 'bass', damp: 0.4 * P.beat });
    }
    R.note('piano', fifthM, t0 + tAt(P, bar, 4) + human(P, 5), 0.42 * P.beat, 0.86 * g, { bus: 'bass', damp: 0.5 * P.beat });
    // chords on 2 and 4, voice-led
    for (const e of [2, 6]) {
      const c = chordAt(P.bars, bar, e / 2);
      voicing = voiceLead(voicing, c, 52, 71, 3);
      const t = t0 + tAt(P, bar, e) + human(P, 6);
      for (let i = 0; i < voicing.length; i++) {
        R.note('piano', voicing[i], t + i * 0.004, 0.3 * P.beat, (e === 2 ? 0.62 : 0.7) * accentAt(e) * g, { bus: 'comp', damp: 0.34 * P.beat });
      }
    }
  }
}
function nearest(pc, lo, hi, target) {
  let best = target; let bd = 1e9;
  for (let m = lo; m <= hi; m++) {
    if (((m % 12) + 12) % 12 !== pc) continue;
    const d = Math.abs(m - target);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

/** Banjo: chunk on 2 and 4, four strings rolled over 11 ms, damped short. */
function partBanjo(R, P, t0, o = {}) {
  const from = o.from ?? 0; const to = o.to ?? P.nBars;
  const g = o.gain ?? 1;
  const beats = o.beats || [2, 6];
  let voicing = null;
  for (let bar = from; bar < to; bar++) {
    for (const e of beats) {
      const c = chordAt(P.bars, bar, e / 2);
      voicing = voiceLead(voicing, c, 55, 74, 4);
      const t = t0 + tAt(P, bar, e) + human(P, 7);
      const acc = accentAt(e);
      for (let i = 0; i < voicing.length; i++) {
        R.note('banjo', voicing[i], t + i * 0.0105, 0.2, 0.62 * acc * g, { damp: (o.ring ?? 0.30) * P.beat, release: 0.045 });
      }
    }
    // THE PUSH. An up-stroke on the "and of 4" carrying the NEXT bar's chord,
    // so the harmony arrives an eighth early. This is the single most
    // characteristic rhythmic gesture in the idiom, and without it a band with
    // its bass on 1-and-3 and its chunk on 2-and-4 is a march: every event in
    // the rhythm section lands on a beat and nothing pulls against it.
    if (o.push && bar < to - 1) {
      const nc = chordAt(P.bars, bar + 1, 0);
      const v = voiceLead(voicing, nc, 57, 76, 3);
      const t = t0 + tAt(P, bar, 7) + human(P, 6);
      for (let i = 0; i < v.length; i++) {
        R.note('banjo', v[i], t + i * 0.009, 0.18, 0.58 * accentAt(7) * g, { damp: 0.24 * P.beat, release: 0.04 });
      }
    } else if (o.fills !== false && P.rng.chance(0.22)) {
      // a single up-stroke on the "and of 4" — the banjo's own comment
      const c = chordAt(P.bars, bar, 3.5);
      const v = voiceLead(voicing, c, 62, 78, 2);
      const t = t0 + tAt(P, bar, 7) + human(P, 8);
      for (let i = 0; i < v.length; i++) R.note('banjo', v[i], t + i * 0.008, 0.16, 0.4 * g, { damp: 0.2 * P.beat });
    }
  }
}
/** Banjo tremolo — for held chords (win theme, tension bed). */
function partBanjoTremolo(R, P, t0, bar, beats, o = {}) {
  const c = chordAt(P.bars, bar, 0);
  const v = voiceLead(null, c, 57, 76, 4);
  const step = (o.rate ?? 16) / 60;
  const n = Math.round((beats * P.beat) / step);
  for (let i = 0; i < n; i++) {
    const t = t0 + barT(P, bar) + i * step;
    const m = v[i % v.length];
    R.note('banjo', m, t, 0.12, (0.32 + 0.14 * Math.sin(i * 0.7)) * (o.gain ?? 1), { damp: step * 0.9, release: 0.03 });
  }
}

/** Tuba / string bass, two-beat: 1 and 3, with a chromatic approach into the next bar. */
function partBass(R, P, t0, o = {}) {
  const from = o.from ?? 0; const to = o.to ?? P.nBars;
  const name = o.inst || 'tuba';
  const g = o.gain ?? 1;
  const four = o.four || false;
  let last = 33;
  for (let bar = from; bar < to; bar++) {
    const c1 = chordAt(P.bars, bar, 0);
    const c3 = chordAt(P.bars, bar, 2);
    const lo = name === 'tuba' ? 28 : 28; const hi = name === 'tuba' ? 45 : 48;
    const r = nearest(c1.bass, lo, hi, last); last = r;
    const fifth = nearest((c3.root + 7) % 12, lo, hi + 2, r + 4);
    const dur = four ? 0.36 * P.beat : 0.52 * P.beat;
    R.note(name, r, t0 + tAt(P, bar, 0) + human(P, 4), dur, 1.0 * g, { bus: 'bass', damp: dur });
    if (four) {
      const third = nearest(c1.third ?? c1.root, lo, hi + 2, r + 3);
      R.note(name, third, t0 + tAt(P, bar, 2) + human(P, 4), dur, 0.8 * g, { bus: 'bass', damp: dur });
    }
    R.note(name, fifth, t0 + tAt(P, bar, 4) + human(P, 4), dur, 0.92 * g, { bus: 'bass', damp: dur });
    if (four) {
      const nc = chordAt(P.bars, bar + 1, 0);
      const app = nearest((nc.bass + 11) % 12, lo, hi + 2, fifth);
      R.note(name, app, t0 + tAt(P, bar, 6) + human(P, 4), dur, 0.78 * g, { bus: 'bass', damp: dur });
    } else if (bar < to - 1 && P.rng.chance(0.3)) {
      const nc = chordAt(P.bars, bar + 1, 0);
      const app = nearest((nc.bass + 11) % 12, lo, hi + 2, fifth);
      R.note(name, app, t0 + tAt(P, bar, 7) + human(P, 4), 0.3 * P.beat, 0.6 * g, { bus: 'bass', damp: 0.3 * P.beat });
    }
  }
}

/** Brushes: swirl across 1 and 3, tap on 2 and 4, ghosted offbeat ticks. */
function partBrushes(R, P, t0, o = {}) {
  const from = o.from ?? 0; const to = o.to ?? P.nBars;
  const g = o.gain ?? 1;
  for (let bar = from; bar < to; bar++) {
    for (const e of [0, 4]) {
      // 0.55 of a beat, not 0.9. A swirl that runs almost the whole beat welds
      // the noise floor shut and the band reads as one continuous texture; a
      // brush actually leaves the head before the next beat arrives.
      R.note('brush_swirl', 0, t0 + tAt(P, bar, e) + human(P, 8), P.beat * (o.swirl ?? 0.55), 0.85 * g, {});
    }
    for (const e of [2, 6]) {
      R.note('brush_tap', 0, t0 + tAt(P, bar, e) + human(P, 6), 0.06, 0.95 * accentAt(e) * g, {});
    }
    if (o.ticks !== false) {
      // The swung "and" has to be AUDIBLE or the swing lives only in the melody.
      const all = o.ticks === 'all';
      for (const e of [1, 3, 5, 7]) {
        if (all || P.rng.chance(0.6)) {
          R.note('hi_hat', 0, t0 + tAt(P, bar, e) + human(P, 6), 0.05, (all ? 0.48 : 0.38) * accentAt(e) * g, {});
        }
      }
    }
  }
}

/**
 * A written melody, played with swing, accents and the lead's own lag.
 * `legato` defaults to 0.78, not 0.92: at 0.92 consecutive notes touch, the
 * amplitude never returns to the floor, and the accent pattern that IS the swing
 * gets buried under its own sustain. 0.78 is a 1925 wind player's articulation —
 * tongued, not slurred — and it is what puts the daylight back between beats.
 */
function partLead(R, P, t0, m, name, o = {}) {
  const g = o.gain ?? 1;
  const lag = (o.lagMs ?? MT.leadLagMs) / 1000;
  const barOff = o.bar ?? 0;
  let prev = null;
  const last = m.length ? m[m.length - 1] : null;
  for (const n of m) {
    const t = t0 + barT(P, barOff) + eighthToTime(n.e, P.beat, P.swing) + lag + human(P, MT.humanMs);
    let dur = eighthToTime(n.e + n.dur, P.beat, P.swing) - eighthToTime(n.e, P.beat, P.swing);
    // a player holds the last note of a phrase; `ringLast` is the button on the
    // end of a walk-up, and it is also what keeps every sting over BIBLE §7.3's
    // three-second floor now that the band articulates instead of slurring
    // a player holds the last note; a plucked string is simply left alone to
    // decay the way the physical model already decays, instead of being damped
    const ring = !!(o.ringLast && n === last);
    if (ring) dur = Math.max(dur, o.ringLast);
    const vel = n.vel * accentAt(n.e) * g * (o.vel ?? 1);
    if (n.grace) {
      R.note(name, n.midi - 1, t - 0.055, 0.05, vel * 0.55, { bus: o.bus || 'lead', gain: o.chanGain });
    }
    R.note(name, n.midi + (o.transpose || 0), t, Math.max(0.06, dur * (o.legato ?? 0.78)), vel, {
      bus: o.bus || 'lead',
      glideFrom: (o.portamento && prev != null) ? prev + (o.transpose || 0) : undefined,
      gliss: n.gliss ? (o.glissTo ?? -5) : undefined,
      pan: o.pan, chanGain: o.chanGain, tag: o.tag,
      damp: ring ? Math.max(2.4, dur) : Math.max(0.06, dur * (o.legato ?? 0.78)),
      release: ring ? 0.30 : undefined,
    });
    prev = n.midi;
  }
  return m.eighths ? t0 + barT(P, barOff) + eighthToTime(m.eighths, P.beat, P.swing) : t0;
}

/** A harmony line under a melody: the nearest chord tone a 3rd/6th below. */
function partHarmony(R, P, t0, m, name, o = {}) {
  const barOff = o.bar ?? 0;
  for (const n of m) {
    const bar = barOff + Math.floor(n.e / 8);
    const c = chordAt(P.bars, bar, (n.e % 8) / 2);
    const target = n.midi - (o.below ?? 4);
    let h = target; let hd = 1e9;
    for (const pc of c.pcs) {
      const cand = nearest(pc, target - 7, target + 7, target);
      const d = Math.abs(cand - target);
      if (d < hd) { hd = d; h = cand; }
    }
    const t = t0 + barT(P, barOff) + eighthToTime(n.e, P.beat, P.swing) + (MT.leadLagMs + 3) / 1000 + human(P, MT.humanMs);
    const dur = eighthToTime(n.e + n.dur, P.beat, P.swing) - eighthToTime(n.e, P.beat, P.swing);
    R.note(name, h, t, Math.max(0.06, dur * 0.9), n.vel * accentAt(n.e) * (o.gain ?? 0.7), { bus: 'lead', damp: dur * 0.9 });
  }
}

/** The whole band hits one chord. Used for shouts, stingers and the last bar. */
function partShout(R, P, t0, bar, e, o = {}) {
  const c = chordAt(P.bars, bar, e / 2);
  const t = t0 + tAt(P, bar, e);
  const g = o.gain ?? 1;
  const v = voiceLead(null, c, 55, 76, 4);
  for (let i = 0; i < v.length; i++) R.note('banjo', v[i], t + i * 0.008, 0.2, 0.7 * g, { damp: o.hold ?? 0.4 });
  R.note('piano', nearest(c.bass, 33, 45, 40), t, 0.3, 0.9 * g, { bus: 'bass', damp: o.hold ?? 0.5 });
  R.note('tuba', nearest(c.bass, 28, 43, 36), t, o.hold ?? 0.4, 0.95 * g, { bus: 'bass' });
  R.note('cornet', v[3], t, o.hold ?? 0.4, 0.9 * g, { bus: 'lead' });
  R.note('trombone', v[1], t, o.hold ?? 0.4, 0.85 * g, { bus: 'lead' });
  R.note('clarinet', v[3] + 5, t, o.hold ?? 0.4, 0.7 * g, { bus: 'lead' });
  if (o.cymbal !== false) R.note('cymbal', 0, t, 1.2, 0.8 * g, {});
}

/* ==========================================================================
 * 9. THE TUNES
 * One suite, so the game sounds like one band: the A strain in F is the title
 * hook, the trio in Bb is the between-innings rag, and the bed / vamp / stingers
 * are all built from the same turnaround.
 * ======================================================================== */

// --- "THE SEWER SHOT RAG" — the hook ---------------------------------------
// Bars 1-4 and 5-8 share one rhythm (3-1-2-1-1 / 3-1-3-1) so it is hummable
// after one hearing. Bar 8's Bbm6 is the borrowed minor subdominant, which is
// the single most period-correct move available in this idiom.
const TITLE_CHART =
  'F6 | F6 | C7 | C7 | F6 | F7 | Bb6 | Bbm6 | ' +
  'F/C | D7 | G7 | C7 | F6 | D7 | G7 C7 | F6';
const TITLE_HOOK = mel(`
  C5:3 F5:1 A5:2 A5:1 G5:1 | F5:3 D5:1 C5:3 D5:1 |
  E5:3 G5:1 E5:2 D5:1 C5:1 | D5:3 C5:1 Bb4:3 C5:1 |
  C5:3 F5:1! A5:2 C6:2 | Bb5:3 A5:1 F5:3 D5:1 |
  D5:2 F5:2 Bb5:3 A5:1 | Db5:2 C5:2 Bb4:2 G4:2 |
  A4:3 C5:1 F5:2 A5:2 | A5:3 F#5:1 D5:2 C5:2 |
  B4:2 D5:2 G5:3 F5:1 | E5:3 D5:1 C5:2 Bb4:2 |
  A4:3 C5:1 F5:4 | F#5:3 A5:1 D5:4 |
  G5:2 F5:2 E5:2 D5:2 | C5:4 r:2 C5:1 D5:1
`);
// TWO bars, not four. The first draft opened with a 4-bar vamp and the hook did
// not arrive until 5.2 seconds, which is an eternity on a title screen for a
// nine-year-old. Now the clarinet climbs for two bars and the tune starts at 2.6.
const TITLE_INTRO_CHART = 'G7 | C7';
const TITLE_INTRO = mel('r:4 F5:1 G5:1 A5:1 B5:1 | C6:4 r:2 C5:1 D5:1');

// --- the trio, in the subdominant, as rags do ------------------------------
const TRIO_CHART =
  'Bb6 | Bb6 | F7 | F7 | Bb6 | Bb7 | Eb6 | Ebm6 | ' +
  'Bb/F | G7 | C7 F7 | Bb6';
const TRIO_MEL = mel(`
  F5:2 Bb5:2 D6:3 C6:1 | Bb5:3 A5:1 G5:2 F5:2 |
  Eb5:2 F5:2 A5:3 G5:1 | F5:4 Eb5:2 C5:2 |
  D5:2 F5:2 Bb5:3 C6:1 | D6:3 C6:1 Ab5:2 F5:2 |
  G5:3 Eb5:1 Bb5:2 G5:2 | Gb5:2 F5:2 Db5:2 Bb4:2 |
  D5:3 F5:1 Bb5:4 | B4:2 D5:2 G5:3 F5:1 |
  E5:2 G5:2 A5:2 C6:2 | Bb5:4 r:2 F5:1 G5:1
`);

// --- the vamp under the team select ----------------------------------------
const VAMP_CHART = 'Bb6 | G7 | C7 | F7 | Bb6 | Bb7 | Eb6 Edim7 | Bb/F F7';
// Two rhythmic cells, alternating: an off-beat pickup cell and a Charleston
// cell. Every bar has at least two off-beat attacks in the melody, which is what
// the first draft of this riff did not have.
const VAMP_RIFF = mel(`
  r:1 D5:1 F5:2 Bb5:1 A5:1 F5:2 | D5:3 F5:1 G5:2 F5:2 |
  E5:1 G5:2 Bb5:1 A5:2 G5:2 | A5:3 C6:1 A5:2 F5:2 |
  r:1 D5:1 F5:2 Bb5:1 A5:1 F5:2 | D5:3 F5:1 Ab5:2 F5:2 |
  G5:1 Bb5:2 G5:1 Db5:2 Bb5:2 | F5:3 D5:1 A4:2 C5:2
`);

// --- the bed: the ragtime turnaround, played almost to itself ---------------
const BED_CHART = 'F6 | D7 | G7 | C7';
const BED_PUNCH = mel('r:8 | r:8 | r:8 | r:4 C5:1 D5:1 E5:2');

// --- tension: the silent-picture peril chord, rising -----------------------
const TENSION_CHART = 'Ddim7 | Ddim7 | D#dim7 | Edim7';

// --- the rally lift --------------------------------------------------------
const RALLY_CHART = 'F6 | A7 | D7 | G7 C7';
const RALLY_CALL = mel(`
  r:4 C5:1 D5:1 E5:1 F5:1 | A5:2 A5:1 G5:1 F5:4 |
  r:4 D5:1 E5:1 F#5:1 G5:1 | B5:2 A5:2 G5:2 F5:2
`);

// --- win / loss ------------------------------------------------------------
const WIN_CHART = 'F6 | D7 | G7 | C7 | F6 | F6';
// The win theme is the title hook's RHYTHM (3-1-2-2 / 3-1-3-1) on new pitches, so
// the payoff sounds like the thing you have been humming since the front end.
const WIN_MEL = mel(`
  C5:3 F5:1 A5:2 C6:2 | A5:3 F#5:1 D5:3 A5:1 |
  B4:3 D5:1 G5:2 B5:2 | C6:3 Bb5:1 G5:2 E5:2 |
  F5:3 A5:1 C6:4 | F5:8
`);
const LOSS_CHART = 'F6 | Fm6 | Db7 | C7';
const LOSS_MEL = mel('A4:4 Ab4:4 | G4:4 Gb4:4 | F4:3 Eb4:3 Db4:2 | C4:6/ r:2');

// --- the radio in the third-floor window (world, not game) ------------------
const RADIO_CHART = 'C6 | A7 | D7 | G7 | C6 | E7 | F6 Fm6 | C/G G7';
const RADIO_MEL = mel(`
  E5:2 G5:2 C6:3 B5:1 | A5:2 C#5:2 E5:3 G5:1 |
  F#5:2 A5:2 D6:2 C6:2 | B5:2 D5:2 G5:3 F5:1 |
  E5:2 G5:2 C6:3 A5:1 | G#5:2 B5:2 E5:3 D5:1 |
  C6:2 A5:2 Ab5:2 F5:2 | E5:3 D5:1 C5:4
`);

/* ==========================================================================
 * 10. WALK-UP STINGS — one per kid, nameable by instrument alone (BIBLE §7.3)
 * Each is a joke about the kid, told in 3-5 seconds by one instrument.
 * ======================================================================== */
const WALKUPS = {
  // Owns the stick, bats first, and will explain why. Taps the manhole FOUR times.
  sal: {
    inst: 'trombone', bpm: 146, chartStr: 'F6 | C7 F6', swing: MT.swingHot,
    mel: 'A4:2 A4:1 G4:1 F4:2 A4:2 | C5:3 A4:1 F4:4/',
    mel2: 'F4:2 A4:1 C5:1 A4:2 F4:2 | G4:2 A4:2 C5:3 A4:1/',
    trim: 0.8354, trimB: 0.82, preroll: 0.78, rhythm: 'strut', taps: 4, glissTo: -7,
  },
  // Will not step on a crack: the tune skips the beat where the crack would be.
  kathleen: {
    inst: 'penny_whistle', bpm: 172, chartStr: 'G6 | D7 G6', swing: MT.swingHot,
    mel: 'D5:1 G5:1 B5:1 r:1 B5:1 A5:1 G5:2 | A5:1 B5:1 D6:2 r:2 B5:2',
    mel2: 'G5:1 B5:1 D6:1 r:1 D6:1 B5:1 G5:2 | F#5:1 A5:1 B5:2 r:2 G5:2',
    trim: 1.2012, trimB: 1.1952, rhythm: 'light',
  },
  // Nine years old, four foot nothing, nobody has ever picked second. Fierce.
  filomena: {
    inst: 'mandolin', bpm: 158, chartStr: 'Dm | A7 D6', swing: MT.swingRag,
    mel: 'D5:2 F5:2 A5:3 G5:1 | F5:2 E5:2 F#5:4',
    mel2: 'A4:2 D5:2 F5:3 E5:1 | E5:2 C#5:2 D5:4',
    trim: 3.732, trimB: 3.635, rhythm: 'napoli', tremolo: true,
  },
  // Sal's brother. Plays Sal's lick, an octave up, a beat late, on a kazoo.
  dom: {
    inst: 'kazoo', bpm: 146, chartStr: 'F6 | C7 F6', swing: MT.swingHot,
    mel: 'r:2 A5:2 A5:1 G5:1 F5:2 | A5:2 C6:3 A5:1 F5:2',
    mel2: 'r:2 F5:2 A5:1 C6:1 A5:2 | G5:2 A5:2 C6:3 A5:1',
    trim: 1.1275, trimB: 1.059, rhythm: 'strut', wobble: 22,
  },
  // Six feet of elbows. Klezmer freygish, and it laughs on the way out.
  irving: {
    inst: 'clarinet', bpm: 152, chartStr: 'Dm | A7 Dm', swing: MT.swingHot,
    mel: 'D5:2 ^Eb5:1 F#5:1 G5:2 A5:2 | Bb5:2 A5:1 G5:1 F#5:2 D5:2/',
    mel2: 'A5:2 ^Bb5:1 A5:1 G5:2 F#5:2 | E5:2 F#5:1 G5:1 A5:2 D5:2/',
    trim: 0.6446, trimB: 0.6435, rhythm: 'klez', glissTo: 7,
  },
  // Runs the argument. The wood block interrupts the band and wins.
  bessie: {
    inst: 'wood_block', bpm: 150, chartStr: 'C6 | G7 C6', swing: MT.swingHot,
    mel: 'C6:1 r:1 C6:1 r:1 A5:2 r:2 | C6:1 C6:1 r:2 A5:1 r:1 C6:2!',
    mel2: 'C6:1 C6:1 r:2 C6:1 r:1 A5:2 | r:2 C6:1 r:1 C6:1 C6:1 C6:2!',
    trim: 3.408, trimB: 3.228, rhythm: 'argue', lastWord: true,
  },
  // Two years of lessons and every hour went into her wrists. Real stride.
  rose: {
    inst: 'piano', bpm: 168, chartStr: 'Eb6 | Bb7 Eb6', swing: MT.swingRag,
    mel: 'Bb4:1 C5:1 Eb5:2 G5:1 F5:1 Eb5:2 | D5:1 Eb5:1 F5:2 Bb5:3 G5:1',
    mel2: 'Eb5:1 F5:1 G5:2 Bb5:1 Ab5:1 G5:2 | F5:1 G5:1 Ab5:2 F5:2 Eb5:2',
    trim: 1.4458, trimB: 1.483, rhythm: 'stride',
  },
  // Four bars of harmonica between innings. Only four. Nobody has heard the fifth.
  // So he gets a harmonica, alone, and it quits before the phrase is done.
  otto: {
    inst: 'harmonica', bpm: 132, chartStr: 'F6 | Bb6 | F6', swing: MT.swing,
    mel: 'C5:2 F5:2 A5:2 F5:2 | G5:2 Bb5:2 D6:4 | C5:2 F5:2 A5:2 r:2',
    mel2: 'A5:2 G5:2 F5:2 C5:2 | D5:2 F5:2 Bb5:4 | A5:2 C6:2 F5:2 r:2',
    trim: 1.656, trimB: 1.6958, rhythm: 'none', stopGag: true,
  },
  // The best kid on the block for two innings. It wanders off at the end.
  stash: {
    inst: 'accordion', bpm: 140, chartStr: 'Gm | D7 Gm', swing: MT.swing,
    mel: 'G4:2 Bb4:2 D5:3 C5:1 | Bb4:2 A4:2 G4:4',
    mel2: 'D5:2 G4:2 Bb4:3 A4:1 | F#4:2 A4:2 G4:4',
    trim: 0.9805, trimB: 0.9813, rhythm: 'oompah', drift: 55,
  },
  // Has a pigeon. The pigeon has opinions.
  eugene: {
    inst: 'cornet_plunger', bpm: 132, chartStr: 'Bb6 | F7 Bb6', swing: MT.swingHot,
    mel: 'F4:3 Bb4:1 D5:2 C5:2 | Bb4:6 r:2',
    mel2: 'D5:3 C5:1 Bb4:2 F4:2 | A4:2 C5:4 r:2',
    trim: 1.9742, trimB: 1.8488, rhythm: 'sparse', pigeon: true,
  },
  // Named at six for being the slowest. The name stayed. She is not slow.
  ethel: {
    inst: 'banjo', bpm: 188, chartStr: 'C6 | G7 | C6', swing: MT.swingHot,
    mel: 'C5:1 E5:1 G5:1 C6:1 G5:1 E5:1 G5:1 C6:1 | ' +
      'B5:1 G5:1 D5:1 B4:1 D5:1 F5:1 G5:1 B5:1 | C6:1 G5:1 E5:1 C5:1 E5:2 G5:2',
    mel2: 'E5:1 G5:1 C6:1 E6:1 C6:1 G5:1 E5:1 C5:1 | ' +
      'D5:1 F5:1 G5:1 B5:1 D6:1 B5:1 G5:1 F5:1 | E5:1 G5:1 C6:2 G5:2 E5:2',
    trim: 2.6251, trimB: 2.8197, rhythm: 'drive',
  },
  // No shoes since June. Claims it is faster. It is faster.
  jesus: {
    inst: 'guiro', bpm: 164, chartStr: 'A7 | D7 A7', swing: MT.swingHot,
    mel: 'A4:1 r:1 A4:1 A4:1 r:2 A4:2 | A4:1 r:1 A4:2 A4:1 r:1 A4:2',
    mel2: 'A4:1 A4:1 r:2 A4:1 r:1 A4:2 | r:1 A4:1 A4:1 r:1 A4:2 A4:2',
    trim: 4.4929, trimB: 4.4463, rhythm: 'street', whistle: true,
  },
  // Plants the crutch, and then the ball is already past you.
  luz: {
    inst: 'cuatro', bpm: 150, chartStr: 'D6 | A7 D6', swing: MT.swingRag,
    mel: 'A4:4 r:4 | A4:0.5 B4:0.5 C#5:0.5 D5:0.5 E5:0.5 F#5:0.5 G5:0.5 A5:0.5 A5:2 D3:2',
    mel2: 'D5:4 r:4 | D5:0.5 E5:0.5 F#5:0.5 G5:0.5 A5:0.5 B4:0.5 C#5:0.5 D5:0.5 F#5:2 D3:2',
    trim: 5.883, trimB: 5.5802, rhythm: 'plant',
  },
  // Best pair of hands on the block. Calm, exact, and it glides.
  ling: {
    inst: 'erhu', bpm: 108, chartStr: 'Am | Am', swing: MT.swing,
    mel: 'A4:3 C5:1 D5:4 | E5:3 D5:1 C5:2 A4:2',
    mel2: 'E5:3 D5:1 C5:4 | D5:3 C5:1 A4:2 G4:2',
    trim: 0.909, trimB: 0.872, rhythm: 'none', portamento: true,
  },
  // Real Keds. Her father is on the beat, and the music stops when he turns the corner.
  maureen: {
    inst: 'celesta', bpm: 128, chartStr: 'C6 | G7 C6', swing: MT.swingRag,
    mel: 'C6:1 E6:1 G6:2 E6:1 C6:1 G5:2 | A5:1 C6:1 E6:2 D6:1 r:3',
    mel2: 'G5:1 C6:1 E6:2 G6:1 E6:1 C6:2 | B5:1 D6:1 G6:2 F6:1 r:3',
    trim: 1.8776, trimB: 1.8449, rhythm: 'boxy', copGag: true,
  },
  // Named Tiny at four and has been growing out of it ever since.
  tommy: {
    inst: 'bass_drum', bpm: 104, chartStr: 'F6 | C7 F6', swing: MT.swing,
    mel: 'F2:2 F2:2 F2:2 F2:2 | F2:2 F2:2 F2:4',
    mel2: 'F2:2 F2:2 F2:1 F2:1 F2:2 | F2:2 F2:1 F2:1 F2:4',
    trim: 2.6301, trimB: 2.2331, rhythm: 'onemanband', tinyGag: true,
  },
};

/**
 * TWO TUNES PER KID, and this is not decoration.
 * BYB-REFERENCE §5.4 names "the same walk-up plays every single time" as the
 * criticism that sinks the original: by the twentieth at-bat a memorised sting
 * stops being characterisation and becomes a tax on the player. So every kid
 * carries a second written melody over the same chart, for the same instrument,
 * in the same character — Sal still struts, Bessie still interrupts, Otto still
 * quits early — and the game alternates them by at-bat index, deterministically.
 * The variation is composed, not randomised; nothing here picks a note.
 */
function buildWalkup(R, id, t0, o = {}) {
  const spec = WALKUPS[id];
  if (!spec) return buildGenericWalkup(R, id, t0);
  const alt = !!o.variant && !!spec.mel2;
  const P = planOf({
    bpm: spec.bpm, swing: spec.swing, chartStr: spec.chartStr,
    seed: MT.seed + hash(id) + (alt ? 4801 : 0),
  });
  const m = mel(alt ? spec.mel2 : spec.mel);
  const name = instName(spec.inst);

  // The rhythm section is a whisper — the point is that you can name the instrument.
  const rh = spec.rhythm;
  if (rh === 'strut') { partBass(R, P, t0, { inst: 'tuba', gain: 0.55 }); partBanjo(R, P, t0, { gain: 0.4, fills: false }); partBrushes(R, P, t0, { gain: 0.45 }); }
  else if (rh === 'light') { partBanjo(R, P, t0, { gain: 0.32, fills: false }); partBrushes(R, P, t0, { gain: 0.4, ticks: false }); }
  else if (rh === 'napoli') { partBass(R, P, t0, { inst: 'string_bass', gain: 0.5 }); partBrushes(R, P, t0, { gain: 0.3, ticks: false }); }
  else if (rh === 'klez') { partBass(R, P, t0, { inst: 'tuba', gain: 0.5 }); partBanjo(R, P, t0, { gain: 0.45, fills: false }); }
  else if (rh === 'stride') { partStride(R, P, t0, { gain: 0.85 }); partBrushes(R, P, t0, { gain: 0.35, ticks: false }); }
  else if (rh === 'oompah') { partBass(R, P, t0, { inst: 'tuba', gain: 0.6 }); partBanjo(R, P, t0, { gain: 0.4, fills: false }); }
  else if (rh === 'drive') { partBass(R, P, t0, { inst: 'string_bass', gain: 0.55, four: true }); partBrushes(R, P, t0, { gain: 0.5 }); }
  else if (rh === 'street') { partBass(R, P, t0, { inst: 'string_bass', gain: 0.6 }); partBanjo(R, P, t0, { gain: 0.5, beats: [1, 3, 5, 7], ring: 0.16, fills: false }); }
  else if (rh === 'plant') { partBass(R, P, t0, { inst: 'string_bass', gain: 0.55 }); partBrushes(R, P, t0, { gain: 0.35, ticks: false }); }
  else if (rh === 'argue') { partBass(R, P, t0, { inst: 'tuba', gain: 0.45 }); }
  else if (rh === 'boxy') { partBrushes(R, P, t0, { gain: 0.22, ticks: false }); }
  else if (rh === 'sparse') { partBass(R, P, t0, { inst: 'string_bass', gain: 0.45 }); partBrushes(R, P, t0, { gain: 0.3, ticks: false }); }
  else if (rh === 'onemanband') {
    for (let bar = 0; bar < 2; bar++) {
      for (const e of [2, 6]) R.note('cymbal', 0, t0 + tAt(P, bar, e), 0.6, 0.5, { choke: true });
      R.note('washboard', 0, t0 + tAt(P, bar, 3), 0.06, 0.5, {});
    }
  }

  // The featured instrument, out front and unmistakable.
  const leadOpts = {
    gain: 1.25, chanGain: 1.35, portamento: !!spec.portamento,
    // 0.80, not 0.92. The whole point of a walk-up is that you can name the
    // instrument, and you name an instrument by its attacks. A slurred line hides
    // them. `portamento` kids (Ling's erhu) are the exception: sliding IS the
    // sound, so those stay joined.
    glissTo: spec.glissTo, legato: spec.portamento ? 1.0 : (spec.legato ?? 0.80), tag: 'feature',
    ringLast: spec.ringLast ?? 1.25,
  };
  if (spec.tremolo) {
    // mandolin tremolo: re-pick at 11 Hz for the length of every long note
    for (const n of m) {
      const t = t0 + eighthToTime(n.e, P.beat, P.swing);
      const dur = eighthToTime(n.e + n.dur, P.beat, P.swing) - eighthToTime(n.e, P.beat, P.swing);
      const step = 1 / 11;
      const reps = Math.max(1, Math.round((n === m[m.length - 1] ? Math.max(dur, 1.25) : dur) / step));
      for (let i = 0; i < reps; i++) {
        R.note(name, n.midi, t + i * step + human(P, 4), step, (i === 0 ? 1.0 : 0.72) * n.vel * 1.2, { bus: 'lead', damp: step, chanGain: 1.35 });
      }
    }
  } else {
    partLead(R, P, t0, m, name, leadOpts);
  }

  /* --- the gags: setup frame, payoff frame, seconds between them --------- */
  if (spec.taps) {
    // Sal taps the manhole four times, on the theory that twice is twice as good.
    for (let i = 0; i < spec.taps; i++) {
      R.note('wood_block', 72, t0 - 0.62 + i * 0.15, 0.08, 0.55 - i * 0.03, {});
    }
  }
  if (spec.stopGag) {
    // Otto quits with a bar and a half still to go. The tick is the punchline of
    // the silence — somebody in the band waiting for a fifth bar that never comes.
    R.note('hi_hat', 0, t0 + tAt(P, m.bars - 1, 7), 0.05, 0.26, {});
  }
  if (spec.pigeon) {
    // The pigeon has opinions. It offers them in the rest.
    const t = t0 + tAt(P, 1, 6);
    for (let i = 0; i < 7; i++) R.note('brush_tap', 0, t + i * 0.033, 0.03, 0.30 - i * 0.03, { pan: 0.45 });
    R.note('penny_whistle', 86, t + 0.24, 0.10, 0.22, { bus: 'lead', pan: 0.45 });
    R.note('penny_whistle', 83, t + 0.35, 0.14, 0.18, { bus: 'lead', pan: 0.45 });
  }
  if (spec.whistle) {
    R.note('penny_whistle', 76, t0 + tAt(P, 0, 6), 0.18, 0.5, { bus: 'lead' });
    // and he is already gone: the last whistle bends up and keeps going
    R.note('penny_whistle', 81, t0 + tAt(P, 1, 6), 0.95, 0.58, { bus: 'lead', gliss: 6 });
  }
  if (spec.lastWord) {
    // Bessie runs the argument. The band finishes; she does not. One more block,
    // alone, a beat and a bit after everybody else has stopped.
    R.note('wood_block', 74, t0 + tAt(P, m.bars - 1, 8) + 0.36, 0.09, 0.8, {});
  }
  if (spec.copGag) {
    // The cop turns the corner: two flat-footed clops, and the music stops dead.
    R.note('wood_block', 60, t0 + tAt(P, 1, 5), 0.08, 0.62, { pan: -0.4 });
    R.note('wood_block', 57, t0 + tAt(P, 1, 6), 0.08, 0.58, { pan: -0.4 });
  }
  if (spec.tinyGag) {
    // Named Tiny at four. The one-man band's last word is a very small whistle.
    R.note('penny_whistle', 93, t0 + tAt(P, 1, 6) + 0.10, 0.22, 0.34, { bus: 'lead', pan: 0.3 });
  }
  if (spec.wobble) {
    // Junior cannot hold a pitch. Nobody minds.
    R.note('kazoo', 69, t0 + tAt(P, 1, 6.5), 0.28, 0.4, { bus: 'lead', gliss: -3 });
  }
  if (spec.drift) {
    R.note('accordion', 67, t0 + tAt(P, 1, 6), 0.5, 0.45, { bus: 'lead', gliss: 1 });
  }
  return t0 + barT(P, m.bars) + 1.1;
}

function buildGenericWalkup(R, id, t0) {
  // Every kid has a sting even if nobody wrote them one: the instrument comes
  // from the roster, the tune comes from the roster's own stat line.
  const kid = (ROSTER || []).find((k) => k.id === id);
  const name = instName(kid?.voice?.sting || 'banjo');
  const P = planOf({ bpm: 150, swing: MT.swingHot, chartStr: 'F6 | C7 F6', seed: MT.seed + hash(id) });
  const deg = [0, 4, 7, 9, 12];
  const s = kid?.stats || { power: 2, speed: 2, contact: 2 };
  const seq = [0, (s.power % 4) + 1, (s.speed % 4) + 1, (s.contact % 4) + 1, 2, 0];
  partBass(R, P, t0, { inst: 'tuba', gain: 0.5 });
  partBanjo(R, P, t0, { gain: 0.4, fills: false });
  let e = 0;
  for (const k of seq) {
    const midi = 65 + deg[k % deg.length];
    R.note(name, midi, t0 + eighthToTime(e, P.beat, P.swing), P.beat * 0.5, 1.1 * accentAt(e), { bus: 'lead', chanGain: 1.3, damp: P.beat * 0.5 });
    e += (k % 2) ? 1 : 2;
  }
  return t0 + barT(P, 2) + 0.8;
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 100000; }

/* ==========================================================================
 * 11. CUES
 * `build(R, t0, o)` writes the whole arrangement into the render graph.
 * Identical code runs live and inside OfflineAudioContext.
 * ======================================================================== */
const CUES = {
  /**
   * THE TITLE — "The Sewer Shot Rag".
   * Arranged with an arc, not a loop: piano alone, the band walks in one desk at
   * a time, the hook is stated bare, the second half harmonises it, and bars
   * 13–14 are a BREAK — rhythm section out, cornet alone over one tuba note.
   * The break is the oldest device in this music and it is the reason the
   * arrangement has dynamics instead of a level.
   */
  title: {
    seconds: 26, span: 23.478, loop: false, bus: 'game',
    build(R, t0) {
      const I = planOf({ bpm: 184, swing: MT.swing, chartStr: TITLE_INTRO_CHART, seed: MT.seed + 1 });
      // two bars: piano and banjo, tuba and brushes joining on the second
      partStride(R, I, t0, { gain: 0.95 });
      partBanjo(R, I, t0, { gain: 0.85, fills: false });
      partBass(R, I, t0, { from: 1, inst: 'tuba', gain: 0.95 });
      partBrushes(R, I, t0, { from: 1, gain: 0.85 });
      partLead(R, I, t0, TITLE_INTRO, 'clarinet', { gain: 0.95 });
      R.note('cymbal', 0, t0 + tAt(I, 1, 6), 1.4, 0.66, {});

      const t1 = t0 + barT(I, 2);
      const P = planOf({ bpm: 184, swing: MT.swing, chartStr: TITLE_CHART, seed: MT.seed + 2 });
      const BRK = [12, 14];                       // the break: bars 13-14, everybody out

      // rhythm section: 0.82 for the first strain, full for the second, silent in the break
      for (const [from, to, g, push] of [[0, 8, 0.82, false], [8, BRK[0], 1.0, true], [BRK[1], 16, 1.05, true]]) {
        partStride(R, P, t1, { from, to, gain: g });
        partBanjo(R, P, t1, { from, to, gain: g, push });
        partBass(R, P, t1, { from, to, inst: 'tuba', gain: g });
        partBrushes(R, P, t1, { from, to, gain: g * 0.95, ticks: push ? 'all' : true });
      }
      // in the break only the tuba marks the bar — one note, then air
      for (let bar = BRK[0]; bar < BRK[1]; bar++) {
        const c = chordAt(P.bars, bar, 0);
        R.note('tuba', nearest(c.bass, 28, 43, 36), t1 + tAt(P, bar, 0), 0.55, 0.9, { bus: 'bass' });
      }

      /**
       * THE BREAK, FINALLY AUDIBLE. Bars 13-14 used to be "everybody out except
       * the cornet" on paper and 1.6 dB down in the render, because one cornet
       * playing the hook is nearly as loud as the whole band playing under it.
       * A break is a hole in the music. The rhythm section stopping is only half
       * of it; the other half is the level, and the level now happens on its own
       * gain stage 40 ms before the barline and comes back on the downbeat of 15.
       */
      const barSec = 4 * P.beat;                 // 1.3043 s at 184
      R.arrangeAt(t1 + BRK[0] * barSec, -9, (BRK[1] - BRK[0]) * barSec, 0.12, 0.04);

      partLead(R, P, t1, TITLE_HOOK, 'cornet', { gain: 1.15 });
      // The clarinet only harmonises the second half. The hook has to be heard
      // once, bare, or nobody hums it.
      const second = TITLE_HOOK.filter((n) => n.e >= 32 && n.e < 96);
      second.eighths = TITLE_HOOK.eighths;
      partHarmony(R, P, t1, second, 'clarinet', { below: -5, gain: 0.55 });
      // trombone answers the borrowed-minor bar with a smear
      R.note('trombone', 53, t1 + tAt(P, 7, 4), 0.7, 0.8, { bus: 'lead', gliss: -4 });
      // and the whole band lands on the last bar together
      // and the whole band comes back IN on 15, louder than it left
      partShout(R, P, t1, 15, 0, { hold: 1.6, gain: 1.5 });
      partBanjoTremolo(R, P, t1, 15, 3.4, { rate: 17, gain: 0.5 });
    },
  },

  /** Team select: a vamp that can run forever without wearing out. */
  team_select: {
    seconds: 22.9, span: 11.429, loop: true, bus: 'game',
    build(R, t0) {
      const P = planOf({ bpm: 168, swing: MT.swingHot, chartStr: VAMP_CHART, seed: MT.seed + 3 });
      partStride(R, P, t0, { gain: 0.75 });
      partBanjo(R, P, t0, { push: true });
      partBass(R, P, t0, { inst: 'string_bass' });
      partBrushes(R, P, t0, { gain: 0.9, ticks: 'all' });
      partLead(R, P, t0, VAMP_RIFF, 'clarinet', { gain: 0.95, legato: 0.70 });
      R.note('cornet_plunger', 65, t0 + tAt(P, 3, 6), 0.5, 0.6, { bus: 'lead' });
      R.note('cornet_plunger', 63, t0 + tAt(P, 7, 6), 0.6, 0.6, { bus: 'lead', gliss: -3 });
    },
  },

  /**
   * The in-play bed. −20 dB, brushes and bass and a banjo chunk and nothing else,
   * with one muted-cornet comment every fourth bar. It exists to be ducked.
   */
  bed_play: {
    // BIBLE §7.5: during a pitch the loudest thing on the mix is the kids, and
    // music is "silent or a -20 dB bed". The trim is MEASURED against the thing
    // that has to win — the announcer — through the engine's own graph, not
    // guessed from the arrangement. See MUSIC_DEFAULTS for the three numbers.
    seconds: 25.6, span: 25.6, loop: true, bus: 'game', gain: dB(MT.bedGainDb + MT.bedTrimDb),
    build(R, t0, o = {}) {
      const pass = (o.pass | 0);
      // a different draw every pass, so the micro-timing and the banjo's own
      // fills are never bar-for-bar the same twice
      const P = planOf({ bpm: 150, swing: MT.swingHot, chartStr: BED_CHART, seed: MT.seed + 4 + pass * 37 });
      /**
       * Four reps, four textures — and WHICH rep gets which texture rotates once
       * per pass. Two things come out of that. The bed stops being a four-bar
       * loop you can hum along to inside one inning (BYB §6.4), and, more
       * importantly, the pass boundary stops being a cliff: the old build put the
       * thin rep last and the full rep first, so every 25.6 s the bed stepped
       * 13.7 dB in 400 ms. A level slam is a louder announcement of a loop than
       * a click is.
       *
       * The colour is deliberately NOT the title's. This bed is brushes and
       * string bass — no banjo except on one rep in four — so the in-play music
       * is a different band from the front end rather than a quieter copy of it.
       */
      const thinRep = (2 + pass) % 4;      // the one that empties out
      const chunkRep = (3 + pass) % 4;     // the one where the banjo shows up at all
      const talkRep = (1 + pass) % 4;      // the one where the plunger cornet says something
      for (let rep = 0; rep < 4; rep++) {
        const t = t0 + rep * barT(P, 4);
        const thin = rep === thinRep;
        partBass(R, P, t, { inst: 'string_bass', gain: thin ? 0.78 : 0.9 });
        partBrushes(R, P, t, { gain: thin ? 0.66 : 0.8, ticks: thin ? false : (rep === chunkRep ? 'all' : true) });
        if (rep === chunkRep) partBanjo(R, P, t, { gain: 0.55, fills: false, push: true });
        if (rep === talkRep && !thin) partLead(R, P, t, BED_PUNCH, 'cornet_plunger', { gain: 0.55 });
        if (thin) partStride(R, P, t, { gain: 0.42, tenth: false });
        if (rep === 3) {
          /**
           * THE PICKUP. Two beats of banjo climbing chord tones out of the last
           * bar and landing on the downbeat of the next pass. It is what a real
           * rhythm player does at the end of a chorus, and it is also the thing
           * that closes the seam: the 280 ms before the boundary used to be
           * empty air.
           */
          const nc = chordAt(P.bars, 0, 0);
          const v = voiceLead(null, chordAt(P.bars, 3, 2), 55, 74, 4);
          const up = [v[0], v[1], v[2], nearest(nc.bass, 62, 76, v[3])];
          for (let i = 0; i < 4; i++) {
            R.note('banjo', up[i], t + tAt(P, 3, 4 + i) + human(P, 6), 0.18,
              (0.61 + i * 0.20) * accentAt(4 + i),
              // the last one is an UP-stroke on the and-of-4 and it is allowed to
              // ring straight across the barline, which is what actually joins
              // one pass to the next
              { damp: (i === 3 ? 0.46 : 0.24) * P.beat, release: i === 3 ? 0.14 : 0.05 });
          }
          R.note('brush_swirl', 0, t + tAt(P, 3, 6) + human(P, 6), P.beat * 0.85, 0.95, {});
          R.note('brush_tap', 0, t + tAt(P, 3, 6) + human(P, 5), 0.06, 0.7, {});
          R.note('hi_hat', 0, t + tAt(P, 3, 7) + human(P, 5), 0.05, 0.6, {});
        }
      }
    },
  },

  /** Full count. Diminished, rising, a press roll, and the bass stops walking. */
  bed_tension: {
    seconds: 12.8, span: 6.4, loop: true, bus: 'game', gain: dB(MT.bedGainDb + MT.bedTrimTensionDb),
    build(R, t0, o = {}) {
      // A full count can last a while. Each pass draws different micro-timing and
      // the clarinet trill starts a semitone higher than it did last time, so the
      // cue ratchets instead of circling — which is what tension is.
      const pass = (o.pass | 0);
      const P = planOf({ bpm: 150, swing: MT.swingHot, chartStr: TENSION_CHART, seed: MT.seed + 5 + pass * 13 });
      const lift = Math.min(4, pass);
      for (let bar = 0; bar < 4; bar++) {
        const c = chordAt(P.bars, bar, 0);
        R.note('string_bass', nearest(c.bass, 30, 42, 34), t0 + tAt(P, bar, 0), P.beat * 1.6, 0.95, { bus: 'bass', damp: P.beat * 1.6 });
        // A CLOCK. Without a pulse this cue was a wash, and a wash is atmosphere,
        // not tension — the player has to feel the count running out, and a bare
        // wood block on 2 and 4 is the cheapest, oldest way to make them.
        R.note('wood_block', 64 + lift, t0 + tAt(P, bar, 2), 0.09, 0.55 + bar * 0.06, { pan: -0.3 });
        R.note('wood_block', 64 + lift, t0 + tAt(P, bar, 6), 0.09, 0.50 + bar * 0.06, { pan: -0.3 });
        partBanjoTremolo(R, P, t0, bar, 4, { rate: 15, gain: 0.42 });
        R.note('snare_roll', 0, t0 + tAt(P, bar, 0), P.beat * 3.6, 0.34 + bar * 0.10, {});
        // the clarinet trill climbs a semitone a bar and never resolves
        const trill = 81 + bar + lift;
        const step = 0.075;
        for (let i = 0; i < Math.round(P.beat * 3 / step); i++) {
          R.note('clarinet', trill + (i % 2), t0 + tAt(P, bar, 4) + i * step, step * 1.1, 0.30 + bar * 0.05, { bus: 'lead' });
        }
      }
      R.note('cymbal', 0, t0 + barT(P, 4) - 0.02, 1.4, 0.5, { choke: true });
    },
  },

  /** A rally. Everybody stands up: four to the bar, sticks instead of brushes. */
  bed_rally: {
    seconds: 12.2, span: 6.076, loop: true, bus: 'game', gain: dB(MT.bedGainDb + MT.bedTrimRallyDb),
    build(R, t0, o = {}) {
      // A rally that circles the same four bars stops sounding like a rally, so
      // the banjo tightens onto every eighth on the second pass and the cymbal
      // moves to the front of the phrase instead of the back.
      const pass = (o.pass | 0);
      const hard = (pass % 2) === 1;
      const P = planOf({ bpm: 158, swing: MT.swingHot, chartStr: RALLY_CHART, seed: MT.seed + 6 + pass * 17 });
      partBass(R, P, t0, { inst: 'tuba', four: true });
      partBanjo(R, P, t0, { beats: hard ? [1, 3, 5, 7] : [1, 2, 3, 5, 6, 7], ring: hard ? 0.14 : 0.18, gain: 0.7 });
      partBrushes(R, P, t0, { gain: 1.0, ticks: hard ? 'all' : true });
      partStride(R, P, t0, { gain: 0.6 });
      partLead(R, P, t0, RALLY_CALL, 'cornet', { gain: 1.0 });
      partHarmony(R, P, t0, RALLY_CALL, 'trombone', { below: 7, gain: 0.55 });
      R.note('cymbal', 0, t0 + (hard ? tAt(P, 0, 0) : tAt(P, 3, 6)), 1.2, 0.7, {});
    },
  },

  /**
   * The big-hit stinger. It starts MT.stingerPreDelay LATE on purpose: the
   * broomstick's TOCK owns the transient, and the band answers it.
   */
  stinger_hit: {
    seconds: 2.4, loop: false, bus: 'game',
    build(R, t0) {
      const t = t0 + MT.stingerPreDelay;
      const P = planOf({ bpm: 176, swing: MT.swingHot, chartStr: 'F6 | F6', seed: MT.seed + 7 });
      R.note('cymbal', 0, t, 1.1, 0.85, {});
      partShout(R, P, t - barT(P, 0), 0, 0, { hold: 0.34, gain: 0.95, cymbal: false });
      // brass rip up into a held, wide-open plunger note
      R.note('cornet_plunger', 77, t + 0.14, 0.85, 1.0, { bus: 'lead', gain: 1.15 });
      R.note('trombone', 65, t + 0.16, 0.75, 0.85, { bus: 'lead' });
      R.note('clarinet', 84, t + 0.18, 0.7, 0.7, { bus: 'lead' });
      R.note('bass_drum', 0, t, 0.4, 0.8, {});
    },
  },

  /** The sewer shot. Three seconds of the band losing its mind, then out. */
  stinger_sewer: {
    seconds: 5.6, loop: false, bus: 'game',
    build(R, t0) {
      const P = planOf({ bpm: 196, swing: MT.swingHot, chartStr: 'F6 | D7 G7 | C7 | F6', seed: MT.seed + 8 });
      const t = t0 + MT.stingerPreDelay;
      partBass(R, P, t, { inst: 'tuba', four: true });
      partBanjo(R, P, t, { beats: [0, 2, 4, 6], ring: 0.2 });
      partBrushes(R, P, t, {});
      partLead(R, P, t, mel('F5:2 A5:2 C6:2 F6:2 | D6:2 C6:2 B5:2 G5:2 | E5:2 G5:2 Bb5:2 C6:2 | A5:8'), 'cornet', { gain: 1.15 });
      partHarmony(R, P, t, mel('F5:2 A5:2 C6:2 F6:2 | D6:2 C6:2 B5:2 G5:2 | E5:2 G5:2 Bb5:2 C6:2 | A5:8'), 'trombone', { below: 8, gain: 0.6 });
      R.note('cymbal', 0, t, 1.6, 0.8, {});
      R.note('cymbal', 0, t + tAt(P, 3, 0), 2.0, 0.9, {});
      partBanjoTremolo(R, P, t, 3, 3.5, { rate: 18, gain: 0.6 });
      R.note('clarinet', 89, t + tAt(P, 3, 0), 1.1, 0.7, { bus: 'lead' });
    },
  },

  /**
   * Between innings: the trio strain, in the subdominant, taken fast.
   * Bar 8 (the Ebm6) is a two-beat break — the clarinet finishes the phrase over
   * nothing, which is how a rag gets air into it at 196.
   */
  between_innings: {
    seconds: 14.7, span: 14.694, loop: true, bus: 'game',
    build(R, t0) {
      const P = planOf({ bpm: 196, swing: MT.swingRag, chartStr: TRIO_CHART, seed: MT.seed + 9 });
      for (const [from, to, g] of [[0, 7, 0.9], [8, 12, 1.05]]) {
        partStride(R, P, t0, { from, to, gain: g });
        partBanjo(R, P, t0, { from, to, gain: g, push: true });
        partBass(R, P, t0, { from, to, inst: 'tuba', gain: g });
        partBrushes(R, P, t0, { from, to, gain: g, ticks: 'all' });
      }
      // the break on bar 8: one bass note and then the clarinet on its own —
      // and the hole is a level, not just an absence (see `title`)
      R.note('tuba', 34, t0 + tAt(P, 7, 0), 0.5, 0.95, { bus: 'bass' });
      R.arrangeAt(t0 + barT(P, 7), -8, barT(P, 8) - barT(P, 7), 0.12, 0.04);
      partLead(R, P, t0, TRIO_MEL, 'clarinet', { gain: 1.05 });
      // cornet takes the last four bars, because a rag needs a shout chorus
      const tail = TRIO_MEL.filter((n) => n.e >= 64);
      tail.eighths = TRIO_MEL.eighths;
      partHarmony(R, P, t0, tail, 'cornet_plunger', { below: 5, gain: 0.7 });
      /**
       * FOUR BARS OF HARMONICA BETWEEN INNINGS. ONLY FOUR.
       * The Gooch says this out loud, Otto's roster charm says it, and his art
       * prop is a harmonica — so it happens, in the music, in bars 9-12, and then
       * the cue loops back to bar 1 where there is none. Nobody ever hears the
       * fifth.
       */
      partLead(R, P, t0, mel(`
        F4:2 D4:2 F4:2 Bb4:2 | D4:2 F4:2 G4:2 D4:2 |
        E4:2 G4:2 A4:2 C5:2 | Bb4:2 F4:2 D4:4
      `), 'harmonica', { bar: 8, gain: 0.58, legato: 0.62, lagMs: 14, ringLast: 0.9 });
      R.note('cymbal', 0, t0 + tAt(P, 11, 6), 1.4, 0.7, {});
    },
  },

  /**
   * WIN. Four bars of band, then a BREAK, then the payoff.
   * The first version of this cue was a solid block of sound for eight seconds
   * with a crest factor of 7 dB and no detectable onsets at all — it read as a
   * held chord, not as winning. A win theme needs the same shape as a joke: a
   * setup, a beat of nothing, and then the thing you were waiting for.
   */
  win: {
    seconds: 9, loop: false, bus: 'game',
    build(R, t0) {
      const P = planOf({ bpm: 176, swing: MT.swingHot, chartStr: WIN_CHART, seed: MT.seed + 10 });
      // --- setup: four bars of band, articulated, four to the bar -----------
      partStride(R, P, t0, { to: 4 });
      partBanjo(R, P, t0, { to: 4, ring: 0.24, push: true });
      partBass(R, P, t0, { inst: 'tuba', four: true, to: 4 });
      partBrushes(R, P, t0, { to: 4, ticks: 'all' });
      const body = WIN_MEL.filter((n) => n.e < 32);
      body.eighths = WIN_MEL.eighths;
      partLead(R, P, t0, body, 'cornet', { gain: 1.2 });
      partHarmony(R, P, t0, body, 'trombone', { below: 7, gain: 0.60 });
      R.note('cymbal', 0, t0, 1.4, 0.65, {});

      // --- the beat of nothing: bar 5 is a break. One tuba note, one cornet
      //     note climbing, and a press roll underneath getting louder ---------
      const c = chordAt(P.bars, 4, 0);
      R.note('tuba', nearest(c.bass, 28, 43, 36), t0 + tAt(P, 4, 0), 0.5, 0.95, { bus: 'bass' });
      // the soloist in a break sustains — he is the only one left playing
      partLead(R, P, t0, mel('F5:3 A5:1 C6:4'), 'cornet', { bar: 4, gain: 1.15, legato: 0.96, ringLast: 1.1 });
      R.note('snare_roll', 0, t0 + tAt(P, 4, 1), P.beat * 3.0, 0.42, {});
      // and it is a HOLE: -10 dB across bar 5 (5.4545-6.8182 s at 176), back on
      // the downbeat of 6. A win theme has the shape of a joke — setup, a beat of
      // nothing, then the thing you were waiting for — and the beat of nothing
      // only works if it is actually quieter than what surrounds it.
      R.arrangeAt(t0 + barT(P, 4), -10, barT(P, 5) - barT(P, 4), 0.12, 0.04);

      // --- the payoff: everybody, on the one, and then it rings out ----------
      partShout(R, P, t0, 5, 0, { hold: 1.15, gain: 1.85 });
      partBanjoTremolo(R, P, t0, 5, 2.6, { rate: 17, gain: 0.6 });
      R.note('cymbal', 0, t0 + barT(P, 5), 2.4, 1.4, {});
      R.note('bass_drum', 0, t0 + barT(P, 5), 0.5, 0.95, {});
    },
  },

  loss: {
    seconds: 8, loop: false, bus: 'game',
    build(R, t0) {
      const P = planOf({ bpm: 116, swing: MT.swing, chartStr: LOSS_CHART, seed: MT.seed + 11 });
      partBass(R, P, t0, { inst: 'tuba', gain: 0.9 });
      partBanjo(R, P, t0, { gain: 0.55, fills: false });
      partLead(R, P, t0, LOSS_MEL, 'trombone', { gain: 1.1, glissTo: -7 });
      partStride(R, P, t0, { gain: 0.55, to: 3 });
      // the classic three-note deflate, on a plunger cornet, one beat late
      const t = t0 + tAt(P, 3, 2);
      R.note('cornet_plunger', 62, t, 0.42, 0.75, { bus: 'lead' });
      R.note('cornet_plunger', 60, t + 0.44, 0.42, 0.7, { bus: 'lead' });
      R.note('cornet_plunger', 57, t + 0.9, 1.0, 0.8, { bus: 'lead', gliss: -3 });
      // and a tuba burp, because nobody is sad for very long on this block
      R.note('tuba', 29, t + 2.0, 0.28, 0.9, { bus: 'bass' });
      R.note('bass_drum', 0, t + 2.0, 0.4, 0.6, {});
      R.note('cymbal', 0, t + 2.02, 0.5, 0.35, { choke: true });
    },
  },

  /**
   * The radio in the third-floor window. Same band, 1925 signal path.
   * This is BIBLE §7.1's boundary made audible: compare it to `title`.
   */
  world_radio: {
    seconds: 14.6, span: 14.545, loop: true, world: true, bus: 'world', gain: 0.10,
    build(R, t0) {
      const P = planOf({ bpm: 132, swing: MT.swingRag, chartStr: RADIO_CHART, seed: MT.seed + 12 });
      partStride(R, P, t0, { gain: 0.9 });
      partBanjo(R, P, t0, { gain: 0.7, fills: false });
      partBass(R, P, t0, { inst: 'tuba', gain: 0.8 });
      partLead(R, P, t0, RADIO_MEL, 'clarinet', { gain: 0.9 });
      partBrushes(R, P, t0, { gain: 0.5, ticks: false });
    },
  },

  /**
   * SWING PROBE — a diagnostic, not a tune. One banjo playing continuous eighths
   * over the bed's turnaround, with the accent pattern on and micro-timing OFF,
   * so an analyser sees the timing engine and nothing else. Render this and
   * `swing_probe_straight` (identical, swing = 0.5) and difference the measured
   * off-beat phase: that difference IS the swing, with no arrangement to hide in.
   */
  swing_probe: {
    seconds: 6.4, span: 6.4, loop: true, bus: 'game',
    build(R, t0, o = {}) {
      const P = planOf({
        bpm: 150, swing: o.straight ? 0.5 : MT.swingHot,
        chartStr: BED_CHART, seed: MT.seed + 21,
      });
      let v = null;
      for (let bar = 0; bar < 4; bar++) {
        R.note('wood_block', 72, t0 + tAt(P, bar, 0), 0.1, 0.55, {});
        R.note('wood_block', 67, t0 + tAt(P, bar, 4), 0.1, 0.45, {});
        for (let e = 0; e < 8; e++) {
          v = voiceLead(v, chordAt(P.bars, bar, e / 2), 57, 74, 2);
          R.note('banjo', v[e % 2], t0 + tAt(P, bar, e), 0.2, 0.9 * accentAt(e), { damp: 0.16, release: 0.03 });
        }
      }
    },
  },
  swing_probe_straight: {
    seconds: 6.4, span: 6.4, loop: true, bus: 'game', seedAs: 'swing_probe',
    build(R, t0) { CUES.swing_probe.build(R, t0, { straight: true }); },
  },

  /**
   * THE PROOF. The bed, plus the two things that outrank it, fired through the
   * same duck the live game uses:
   *   t=1.60  an announcer line starts (−12 dB, held 1.10 s)
   *   t=4.30  the bat connects        (−10 dB, 22 ms attack, held 0.18 s)
   * Measure the RMS inside those windows against `duck_proof_flat`, which is the
   * bit-identical arrangement with the ducking off. −12 is the SHIPPED announcer
   * depth: it is `MIX.duck.voice.music` in src/audio/engine.js, the duck the game
   * actually applies. This cue demonstrates that number and no other.
   */
  duck_proof: {
    seconds: 7, loop: false, bus: 'game', gain: dB(MT.bedGainDb + MT.bedTrimDb + 7),
    build(R, t0, o = {}) {
      const P = planOf({ bpm: 150, swing: MT.swingHot, chartStr: BED_CHART, seed: MT.seed + 13 });
      for (let rep = 0; rep < 2; rep++) {
        const t = t0 + rep * barT(P, 4);
        partBass(R, P, t, { inst: 'string_bass', gain: 1.0 });
        partBanjo(R, P, t, { gain: 0.8, fills: false });
        partBrushes(R, P, t, { gain: 1.0 });
        partStride(R, P, t, { gain: 0.7 });
      }
      if (o.noDuck) return;
      R.duckAt(t0 + 1.60, MT.duckAnnouncerDb, 1.10, MT.duckRelease, MT.duckAttack);
      R.duckAt(t0 + 4.30, MT.duckCrackDb, MT.crackHold, MT.crackRelease, MT.crackAttack);
    },
    windows: {
      open_a: [0.60, 1.55], ducked_announcer: [1.72, 2.68],
      open_b: [3.30, 4.25], ducked_crack: [4.335, 4.50],
    },
  },

  /**
   * The control. Bit-for-bit the same arrangement, same seed, ducking disabled —
   * so `duck_proof` minus `duck_proof_flat` in the same window is the duck depth
   * and nothing else. Content differences cannot flatter the measurement.
   */
  duck_proof_flat: {
    seconds: 7, loop: false, bus: 'game', gain: dB(MT.bedGainDb + MT.bedTrimDb + 7), seedAs: 'duck_proof',
    build(R, t0) { CUES.duck_proof.build(R, t0, { noDuck: true }); },
    windows: {
      open_a: [0.60, 1.55], ducked_announcer: [1.72, 2.68],
      open_b: [3.30, 4.25], ducked_crack: [4.335, 4.50],
    },
  },
};

// every kid gets a cue, whether or not somebody wrote them a tune
/**
 * One cue per kid per variant. `trim` / `trimB` are per-sting mix gains, MEASURED
 * and not guessed: rendered flat, the stings spanned 21 dB, because a plucked
 * mandolin is nothing like a blown clarinet and a bank that jumps 21 dB between
 * kids reads as sixteen accidents rather than one composer's work. Every number
 * below was set by rendering the sting THROUGH the engine's own graph, taking RMS
 * across its sounding span, and solving for -32.0 dBFS; the last pass measured a
 * 0.7 dB spread across all thirty-two. The two variants of one kid get separate
 * trims because two different tunes on one instrument are two different levels.
 */
function addWalkupCue(id) {
  const spec = WALKUPS[id] || null;
  const mk = (suffix, variant, trim) => {
    CUES[`walkup_${id}${suffix}`] = {
      seconds: 6.6, loop: false, bus: 'game', variantOf: id,
      gain: trim || 1.4,
      // 0.15 s of air before the sting, not 0.7: a walk-up fires the moment a kid
      // is picked and half a second of nothing reads as a bug. Only Sal needs the
      // long pre-roll, because his four manhole taps happen before his tune.
      build(R, t0) { buildWalkup(R, id, t0 + ((spec && spec.preroll) || 0.15), { variant }); },
    };
  };
  mk('', 0, spec && spec.trim);
  if (spec && spec.mel2) mk('_b', 1, spec.trimB ?? spec.trim);
}
for (const kid of (ROSTER || [])) addWalkupCue(kid.id);
// and if the roster ever fails to load, the hand-written ones still exist
for (const id of Object.keys(WALKUPS)) if (!CUES[`walkup_${id}`]) addWalkupCue(id);
/** Which sting a kid gets on their Nth trip to the plate. Deterministic, never random. */
function walkupCue(id, n = 0) {
  const b = `walkup_${id}_b`;
  return (CUES[b] && (n % 2) === 1) ? b : `walkup_${id}`;
}

/* ==========================================================================
 * 12. THE MUSIC DIRECTOR — the score answers the game
 * ======================================================================== */
class Music {
  constructor() {
    this.app = null;
    this.live = null;             // { ctx, R, cue, startedAt, endsAt }
    this.enabled = true;
    this.current = null;
    this.mood = { tension: 0, rally: 0, intensity: 0.3 };
    this.layers = [];
    this.count = { balls: 0, strikes: 0 };
    this.pendingBed = null;
    /**
     * THE HOOK GETS TO FINISH ITS SENTENCE. A tune nobody hears twice is not a
     * hook, and the title states its melody bare and then harmonises it. Until
     * `holdUntil`, no bed may displace the title — a stinger, a walk-up or the
     * announcer still can, because those are the game talking, but the in-play
     * bed is only wallpaper and wallpaper does not get to interrupt the theme.
     */
    this.holdUntil = 0;
  }

  cueNames() { return Object.keys(CUES); }
  has(name) { return !!CUES[name]; }

  /**
   * The musical length of one pass, in seconds. A loop cue is tiled at exactly
   * this interval, so a loop is seamless and never leaves a bar of silence at
   * the end of a render.
   */
  span(name) {
    const c = CUES[name];
    return c ? (c.span || c.seconds || 6) : 6;
  }

  /** Build one cue into any BaseAudioContext. The single render path. */
  renderInto(ctx, name, t0 = 0, opts = {}) {
    const cue = CUES[name];
    if (!cue) return null;
    const R = new Render(ctx, {
      seed: MT.seed + hash(cue.seedAs || name),
      world: !!cue.world,
      gain: (cue.gain ?? 1) * (opts.gain ?? 1),
      dest: opts.dest || null,
    });
    const total = opts.seconds ?? cue.seconds ?? 6;
    const span = this.span(name);
    // Which pass this is. A loop cue gets to know, so it can rotate its own
    // arrangement instead of stamping the identical four bars forever — offline
    // it counts up inside one render, live it counts up across retiles.
    let pass = opts.pass | 0;
    let t = t0; let guard = 0;
    do { cue.build(R, t, { ...opts, pass }); t += span; pass++; }
    while (cue.loop && t < t0 + total - 0.05 && ++guard < 24);
    // note tails ring past `total` on their own; only the endless ones are cut
    R.endSources(t0 + total + 0.05);
    return R;
  }

  async renderOffline({ cue = 'title', seconds, sampleRate = 44100 } = {}) {
    const name = CUES[cue] ? cue : 'title';
    const secs = seconds || CUES[name].seconds || 6;
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.max(1, Math.round(secs * sampleRate)), sampleRate);
    this.renderInto(ctx, name, 0, { seconds: secs });
    return ctx.startRendering();
  }

  /* --- live playback ---------------------------------------------------- */
  ctx() {
    const a = this.app && this.app.audio;
    if (a && typeof a.ensure === 'function') { const c = a.ensure(); if (c) return c; }
    if (a && a.ctx) return a.ctx;
    return null;
  }
  /** The engine owns the mix. If it has a music bus, the score plays into it. */
  dest() {
    const a = this.app && this.app.audio;
    const b = a && a.graph && a.graph.buses && a.graph.buses.music;
    return b || null;
  }
  play(name, opts = {}) {
    if (!this.enabled || !CUES[name]) return false;
    const ctx = this.ctx();
    if (!ctx) return false;
    if (name.startsWith('bed_') && ctx.currentTime < this.holdUntil) return false;
    if (this.live && !opts.layer) this.stop(0.12);
    const t0 = ctx.currentTime + 0.06 + (opts.delay || 0);
    const loop = !!CUES[name].loop;
    const len = loop ? this.span(name) : (CUES[name].seconds || 6);
    const R = this.renderInto(ctx, name, t0, { ...opts, seconds: len, pass: 0, dest: this.dest() });
    if (!R) return false;
    // 2 bars of intro + the whole first strain at 184 bpm (bar = 1.3043 s): the
    // hook is stated bare, then harmonised, before any bed is allowed in.
    if (name === 'title') this.holdUntil = t0 + 13.05;
    const entry = { R, cue: name, t0, endsAt: t0 + len, loop, pass: 0 };
    if (opts.layer) { (this.layers = this.layers || []).push(entry); }
    else { this.live = entry; this.current = name; }
    return true;
  }

  /**
   * BIBLE §7.1 made audible instead of explained: whenever the in-play bed comes
   * up, the radio in the third-floor window comes up under it. Same band, 1925
   * signal path, band-limited 200 Hz-4 kHz — so the player hears the boundary
   * between the world's music and the game's music without ever being told there
   * is one. It layers, so a stinger can fire straight over the top of it.
   */
  ensureWorldRadio() {
    if (!this.enabled || !CUES.world_radio) return false;
    if ((this.layers || []).some((l) => l.cue === 'world_radio')) return false;
    // 0.40 under the bed's own level: one radio, one window, thin and far
    // (PERIOD §1.9). The cue's own gain is set for auditioning it on its own.
    return this.play('world_radio', { layer: true, gain: 0.40 });
  }
  /** Start (or switch to) the bed the game is currently asking for. */
  startBed() {
    const want = this.bedFor();
    if (this.current !== want) this.play(want);
    this.ensureWorldRadio();
    return this.current;
  }
  stop(fade = 0.25) {
    const ctx = this.ctx();
    for (const e of [this.live, ...(this.layers || [])]) {
      if (!e) continue;
      try {
        const g = e.R.master.gain;
        const now = ctx ? ctx.currentTime : 0;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(0.0001, now + fade);
      } catch (err) { /* context already gone */ }
    }
    this.live = null; this.layers = []; this.current = null;
  }
  /** Called by the announcer bus and by bat:contact. The one rule of this file. */
  duck(depthDb = MT.duckAnnouncerDb, hold = 1.0, release = MT.duckRelease, attack = MT.duckAttack) {
    const ctx = this.ctx();
    if (!ctx) return;
    for (const e of [this.live, ...(this.layers || [])]) {
      if (e) { try { e.R.duckAt(ctx.currentTime + 0.001, depthDb, hold, release, attack); } catch (err) { /* noop */ } }
    }
  }

  /** The bed the game should currently be under. */
  bedFor() {
    if (this.mood.rally > 0.5) return 'bed_rally';
    if (this.mood.tension > 0.5) return 'bed_tension';
    return 'bed_play';
  }
  /**
   * The old guard was `if (this.current && this.current.startsWith('bed_') && ...)`
   * — which can only ever be true if a bed is ALREADY playing, and nothing in the
   * game started the first one. The score was written, measured, and silent.
   * Now: if a bed should be running and nothing is, start it.
   */
  refreshBed() {
    const want = this.bedFor();
    if (this.current === want) return;
    if (!this.current || this.current.startsWith('bed_')) this.startBed();
  }
  state(patch = {}) { Object.assign(this.mood, patch); this.refreshBed(); return this.mood; }

  update(dt) {
    // moods relax; the score does not stay excited on its own
    this.mood.rally = Math.max(0, this.mood.rally - dt * 0.09);
    const ctxNow = this.ctx();
    // layered stingers were accumulating forever: one per big hit, for a whole
    // game, each holding a graph. Retire them once they have rung out.
    if (this.layers && this.layers.length && ctxNow) {
      // a looping layer (the third-floor radio) retiles like the bed does;
      // a one-shot layer (a sting) is retired once it has rung out
      for (const e of this.layers) {
        if (e.loop && ctxNow.currentTime > e.endsAt - 0.45) {
          const len = this.span(e.cue);
          e.pass = (e.pass | 0) + 1;
          e.R = this.renderInto(ctxNow, e.cue, e.endsAt, { seconds: len, pass: e.pass, dest: this.dest() });
          e.t0 = e.endsAt; e.endsAt += len;
        }
      }
      this.layers = this.layers.filter((e) => e.loop || ctxNow.currentTime < e.endsAt + 3);
    }
    if (!this.live) return;
    const ctx = ctxNow;
    if (!ctx) return;
    if (this.live.loop && ctx.currentTime > this.live.endsAt - 0.45) {
      const name = this.live.cue;
      const t0 = this.live.endsAt;
      const len = this.span(name);
      const pass = (this.live.pass | 0) + 1;
      const R = this.renderInto(ctx, name, t0, { seconds: len, pass, dest: this.dest() });
      this.live = { R, cue: name, t0, endsAt: t0 + len, loop: true, pass };
    } else if (!this.live.loop && ctx.currentTime > this.live.endsAt + 1.5) {
      this.live = null; this.current = null;
    }
  }

  /** Notation self-check. Returns [] when every written bar is 8 eighths long. */
  validate() {
    const problems = [];
    const check = (label, m, chartStr) => {
      const bars = chart(chartStr).length;
      if (Math.abs(m.eighths - bars * 8) > 0.001) {
        problems.push(`${label}: ${m.eighths} eighths over ${bars} bars (want ${bars * 8})`);
      }
      if (m.bars !== bars) problems.push(`${label}: ${m.bars} written bars vs ${bars} chart bars`);
    };
    check('title.hook', TITLE_HOOK, TITLE_CHART);
    check('title.intro', TITLE_INTRO, TITLE_INTRO_CHART);
    check('trio', TRIO_MEL, TRIO_CHART);
    check('vamp', VAMP_RIFF, VAMP_CHART);
    check('bed.punch', BED_PUNCH, BED_CHART);
    check('rally', RALLY_CALL, RALLY_CHART);
    check('win', WIN_MEL, WIN_CHART);
    check('loss', LOSS_MEL, LOSS_CHART);
    check('radio', RADIO_MEL, RADIO_CHART);
    for (const [id, s] of Object.entries(WALKUPS)) {
      check(`walkup.${id}`, mel(s.mel), s.chartStr);
      if (s.mel2) check(`walkup.${id}.b`, mel(s.mel2), s.chartStr);
    }
    return problems;
  }

  /** What tempo/grid an analyser should fold a cue's onsets onto. */
  analysisPlan(name) {
    const t = {
      title: [184, MT.swing], team_select: [168, MT.swingHot], bed_play: [150, MT.swingHot],
      bed_tension: [150, MT.swingHot], bed_rally: [158, MT.swingHot], between_innings: [196, MT.swingRag],
      win: [176, MT.swingHot], loss: [116, MT.swing], world_radio: [132, MT.swingRag],
      duck_proof: [150, MT.swingHot], duck_proof_flat: [150, MT.swingHot],
      swing_probe: [150, MT.swingHot], swing_probe_straight: [150, 0.5],
      stinger_sewer: [196, MT.swingHot], stinger_hit: [176, MT.swingHot],
    };
    if (t[name]) return { bpm: t[name][0], swing: t[name][1] };
    const id = name.replace(/^walkup_/, '').replace(/_b$/, '');
    if (WALKUPS[id]) return { bpm: WALKUPS[id].bpm, swing: WALKUPS[id].swing ?? MT.swing };
    return { bpm: 150, swing: MT.swing };
  }
  duckWindows(name) { return (CUES[name] && CUES[name].windows) || null; }
}
export const music = new Music();

/* ==========================================================================
 * 13. THE SYSTEM — bus wiring and the additive engine adapter
 * ======================================================================== */
let attachedTo = null;

/**
 * Attach to src/audio/engine.js WITHOUT editing it. If the engine already has
 * renderOffline/listCues (its own cues), keep them and delegate anything that
 * is not ours. If the engine grows a registerCue() API later, we use it too.
 */
function attachToEngine(app) {
  const A = app.audio;
  if (!A || attachedTo === A) return;
  attachedTo = A;

  // The engine's cue contract is build(ctx, out, t, opts) on bus 'music', so the
  // score registers in exactly that shape: anything else in the game can then
  // call app.audio.play('walkup_sal') and get it through the real mix, and the
  // engine's own offline path can render it too.
  if (typeof A.registerCue === 'function') {
    for (const name of music.cueNames()) {
      const cue = CUES[name];
      try {
        A.registerCue(name, {
          bus: 'music', gain: 1, dist: 0, send: 0.06,
          dur: cue.seconds || 6,
          note: `1920s score — ${name}`,
          build: (ctx, out, t, opts = {}) =>
            music.renderInto(ctx, name, t, { ...opts, dest: out, seconds: opts.seconds || cue.seconds }),
        });
      } catch (e) { /* the engine's API is not ours to fight with */ }
    }
  }

  const prevRender = typeof A.renderOffline === 'function' ? A.renderOffline.bind(A) : null;
  const prevList = typeof A.listCues === 'function' ? A.listCues.bind(A) : null;

  /**
   * MEASURE THROUGH THE MIX, NOT AROUND IT.
   * The old override intercepted every music cue and rendered it straight to
   * ctx.destination — so every number tools/audition.mjs printed was taken
   * OUTSIDE MIX.buses.music (0.62) and outside the engine's master soft clip.
   * The cues were registered with A.registerCue in exactly the right shape and
   * then that registration was made unreachable. Now the engine's own path runs
   * first, which means an audition measures the graph the player hears; our bare
   * renderer is only the fallback for a cue the engine cannot resolve at all.
   */
  A.renderOffline = async (opts = {}) => {
    const o = { ...opts };
    if (music.has(o.cue) && !o.seconds) o.seconds = CUES[o.cue].seconds || 6;
    if (prevRender) {
      try { return await prevRender(o); } catch (e) { if (!music.has(o.cue)) throw e; }
    }
    return music.renderOffline(o);
  };
  A.listCues = () => {
    const theirs = prevList ? (prevList() || []) : [];
    const out = [...theirs];
    for (const n of music.cueNames()) if (!out.includes(n)) out.push(n);
    return out;
  };
  A.music = music;
}

export default registerSystem({
  name: 'music',
  order: 155,                     // after audio (150), so app.audio exists
  init(app) {
    music.app = app;
    app.music = music;
    if (app.flags.harness) music.enabled = false;    // no live audio in the harness; offline still renders
    attachToEngine(app);

    // __SB is assigned by main.js *after* bootApp() returns, so hand the harness
    // its music handle on the next microtask rather than clobbering nothing now.
    const installHarness = () => {
      if (!globalThis.__SB || globalThis.__SB.music) return;
      globalThis.__SB.music = {
        listCues: () => music.cueNames(),
        validate: () => music.validate(),
        analysisPlan: (n) => music.analysisPlan(n),
        duckWindows: (n) => music.duckWindows(n),
        render: (o) => music.renderOffline(o),
      };
    };
    installHarness();
    Promise.resolve().then(installHarness);
    this._installHarness = installHarness;

    /* --- STARTING THE SCORE -------------------------------------------- */
    /**
     * The score used to be unreachable: nothing in the game ever called play().
     * Three entry points now, and they are all events the game already emits.
     *   - the title screen, at boot
     *   - the team-select vamp and the title, on their scenarios
     *   - the in-play bed, the first time a batter steps up (with `pitch:called`
     *     as a backstop, because a scenario can drop straight into a pitch)
     * Each of them is idempotent: it only starts something if nothing better is
     * already playing, so an at-bat during a between-innings rag does not cut it off.
     */
    // The front end must not still be playing once a pitch has been called; a
    // moment (the between-innings rag, a win, a stinger) is allowed to finish.
    const FRONT = new Set(['title', 'team_select']);
    const wantBed = () => {
      if (!music.enabled) return;
      const c = music.current;
      if (!c || c.startsWith('bed_') || FRONT.has(c)) music.startBed();
    };
    /**
     * WHO IS ALLOWED TO KILL THE FRONT END. `atbat:begin` is emitted by
     * `bootApp()`'s own last statement (`app.sim.reset(1920)`), so listening for
     * it here meant the title theme was stopped by the boot sequence that had
     * just started it — the score's best 26 seconds existed only inside
     * renderOffline. An at-bat merely BEGINNING is not the player playing; a
     * pitch actually leaving a hand is. So the bed comes up on `pitch:called`
     * and on `pitch:thrown`, and the front end owns the screen until then.
     */
    bus.on('pitch:called', wantBed);
    bus.on('pitch:thrown', wantBed);

    /**
     * STARTING THE TITLE FOR REAL. `play()` returns false against a context that
     * has not resumed, and a browser will not resume one until the player has
     * touched the page — so a single call at init() could only ever fail. This
     * retries on the first gesture and unsubscribes itself the moment the theme
     * is actually running, which is the shipping path: click into the game, the
     * hook plays.
     */
    const startFront = () => {
      if (music.current || !music.enabled) return;
      if (!music.play('title')) return;
      window.removeEventListener('pointerdown', startFront, true);
      window.removeEventListener('keydown', startFront, true);
    };
    if (!app.flags.harness) {
      startFront();
      window.addEventListener('pointerdown', startFront, true);
      window.addEventListener('keydown', startFront, true);
    }

    /* --- the score answers the game ------------------------------------ */
    // The announcer and the bat both outrank the band. Every plausible name the
    // announcer piece might emit is covered; whichever it uses, the band gets out.
    //
    // WHO ACTUALLY DUCKS. The engine's mixer pulls the whole `music` bus down by
    // MIX.duck.voice.music = -12 dB every time the `voice` bus talks, and that is
    // the shipped announcer duck. Ours is the SAME depth (MT.duckAnnouncerDb) and
    // fires only if the engine has no ducker of its own, so the two can never
    // stack to -24 and make the band disappear. Either way the announcer wins,
    // which is the one rule this file has.
    const engineDucks = () => typeof (app.audio && app.audio.duck) === 'function';
    for (const ev of ['announcer:line', 'announcer:start', 'vo:line', 'vo:start', 'commentary', 'booth:line']) {
      bus.on(ev, (p) => {
        if (engineDucks()) return;
        music.duck(MT.duckAnnouncerDb, (p && p.seconds) || 1.1, MT.duckRelease, MT.duckAttack);
      });
    }
    // The crack of the bat is on the sfx bus and the engine's duck table has no
    // sfx source, so nothing else in the game gets the band out of the way of the
    // one sound the whole piece is built around. This does.
    bus.on('bat:contact', (p) => {
      music.duck(MT.duckCrackDb, MT.crackHold, MT.crackRelease, MT.crackAttack);
      if (p && (p.quality > 0.75 || p.power > 0.75)) music.play('stinger_hit', { layer: true });
    });
    bus.on('strike', (p) => {
      music.count.strikes = (p && p.count) || music.count.strikes + 1;
      music.state({ tension: (music.count.strikes >= 2 && music.count.balls >= 3) ? 1 : music.mood.tension * 0.6 });
    });
    bus.on('ball', (p) => {
      music.count.balls = (p && p.count) || music.count.balls + 1;
      music.state({ tension: (music.count.strikes >= 2 && music.count.balls >= 3) ? 1 : music.mood.tension });
    });
    bus.on('atbat:begin', () => { music.count = { balls: 0, strikes: 0 }; music.state({ tension: 0 }); });
    bus.on('hit', (p) => music.state({ rally: Math.min(1, music.mood.rally + ((p && p.bases) || 1) * 0.34), tension: 0 }));
    bus.on('run', () => music.state({ rally: 1, tension: 0 }));
    bus.on('out', () => music.state({ rally: music.mood.rally * 0.4 }));
    /**
     * BIBLE §7.3: a kid's sting fires in exactly three places — the card, the
     * walk-up, and the trot after a sewer shot. Card and walk-up are wired here;
     * the trot layers the batter's own sting 1.2 s behind the fanfare, which is
     * the beat at which the original plays the kid's theme as they round.
     * Payload shapes differ between pieces, so read an id out of whatever comes.
     */
    const kidId = (p) => {
      if (!p) return null;
      // src/game/sim.js:50 emits `{ batter: <index into the lineup> }` — a NUMBER.
      // The old reader only understood string ids, so it returned null on the one
      // event the game actually fires, the walk-up never sounded at the plate, and
      // `atBat` was never set, which killed the sewer-shot trot sting as well.
      // Two of BIBLE §7.3's three firing places were dead because of this line.
      if (typeof p.batter === 'number' && ROSTER && ROSTER.length) {
        return ROSTER[((p.batter % ROSTER.length) + ROSTER.length) % ROSTER.length].id;
      }
      const c = p.id || p.kid || p.who || p.batterId ||
        (p.batter && (p.batter.id || (typeof p.batter === 'string' ? p.batter : null)));
      return (typeof c === 'string' && CUES[`walkup_${c}`]) ? c : null;
    };
    let atBat = null;
    const trips = new Map();          // kid -> how many times they have come up
    let lastSting = -99;
    for (const ev of ['atbat:begin', 'batter:up', 'walkup', 'batter:ready']) {
      bus.on(ev, (p) => {
        const id = kidId(p);
        if (!id) return;
        atBat = id;
        // Several pieces announce the same at-bat (sim.js re-emits, the card UI
        // emits its own), and two copies of one sting on top of each other is a
        // phase mess, not a louder sting. One per second, and no more.
        const ctx = music.ctx();
        const now = ctx ? ctx.currentTime : 0;
        if (ctx && now - lastSting < 1.0) return;
        const n = trips.get(id) || 0;
        // a sting that could not sound (no context yet, audio disabled) must not
        // burn the kid's turn in the A/B rotation
        if (!music.play(walkupCue(id, n), { layer: true })) return;
        lastSting = now;
        trips.set(id, n + 1);
      });
    }
    bus.on('ball:sewer', () => {
      music.play('stinger_sewer');
      // scheduled on the AUDIO clock, not a setTimeout: wall-clock timing is
      // non-deterministic and the harness forbids it (docs/CONTRACT.md)
      if (atBat) music.play(walkupCue(atBat, (trips.get(atBat) || 1) - 1), { layer: true, delay: 1.2 });
    });
    bus.on('half:end', () => music.play('between_innings'));
    bus.on('game:over', (p) => {
      const s = (p && p.score) || { home: 0, away: 0 };
      music.play(s.home >= s.away ? 'win' : 'loss');
    });
    // the card. BIBLE §7.3's first firing place — and the card always plays the
    // kid's A-side, because that is the tune the game is teaching you here.
    bus.on('roster:picked', (p) => { if (p && p.id) music.play(`walkup_${p.id}`, { layer: true }); });
  },
  /**
   * A screen is a cue. `__SB.scenario()` calls this on every system before it
   * sets the scene up, so jumping to the team-select card wall starts the vamp
   * and jumping to the title starts the title — the same way clicking there in a
   * running game does, because it is the same call.
   */
  onScenario(name, app) {
    if (!music.enabled) return;
    if (name === 'team_select') music.play('team_select');
    else if (name === 'title') music.play('title');
    else music.startBed();
  },
  update(dt, app) {
    if (app.audio && app.audio !== attachedTo) attachToEngine(app);
    if (this._installHarness) this._installHarness();
    if (!music.enabled) return;
    music.update(dt);
  },
});

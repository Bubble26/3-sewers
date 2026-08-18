#!/usr/bin/env python3
"""THREE SEWERS — the whole soundtrack, synthesized from nothing.

    python3 tools/gen_audio.py              # write into threesewers/assets/audio
    python3 tools/gen_audio.py /tmp/out     # dry run somewhere else
    python3 tools/gen_audio.py --qc         # inspect what was rendered
    python3 tools/gen_audio.py --plots DIR  # waveform + spectrogram PNGs

There are no samples in this project and no network to fetch any, so every
noise the game makes is built here out of numpy: noise, sines, resonators and
convolution. Same deal as tools/artkit.py — one kernel, one set of house
rules, so the whole soundtrack sounds like it came off one machine.

House rules (do not break these per-sound):
  1. PERIOD TIMBRE, NOT CINEMA. 1926 means tin megaphone, hand-cranked
     acoustic recording, ragtime piano, surface crackle. Nothing gets a
     modern sub-bass thump or a wide reverb wash. Band-limit and saturate.
  2. TRANSIENT FIRST. Every hit sound starts with a sub-5 ms crack, then a
     body, then the street. Filters are causal (convolution with a real
     impulse response) so nothing ever rings BEFORE it is struck — the one
     thing zero-phase FFT filtering would get wrong.
  3. BODY, NOT BEEP. Impacts are modal: a stick is a handful of decaying
     partials with a wood ratio, not one sine. If it can be mistaken for a
     synth beep it is not finished.
  4. THE STREET IS A CANYON. Tenements both sides, so everything outdoors
     gets the same two slapbacks (~24 ms, ~41 ms) and a short dark tail. One
     room for the whole game is what makes the mix sit together.
  5. VARIANTS, ALWAYS. Anything the game fires more than twice a minute ships
     as 2-4 renders with different seeds. audio.gd rolls between them and
     detunes on top, so the ear never locks on.
  6. -1 dBFS CEILING, MONO SFX. Peaks land at -3 dBFS or below with the
     ceiling at -1; SFX are mono (the engine pans them), beds and music are
     stereo.

Layout written:
    assets/audio/sfx/    one-shots, mono
    assets/audio/vox/    announcer patter, mono
    assets/audio/music/  loops + stings, stereo

Names and variant counts are mirrored by BANK in scripts/audio.gd — if you
add a sound here, add it there.
"""
import math
import os
import re
import struct
import sys
import zlib

import numpy as np

SR = 44100
BITS = 16
CEIL_DB = -1.0            # absolute ceiling; QC fails anything louder
PEAK_DB = -3.0            # what most one-shots are normalised to

# ---------------------------------------------------------------- kernel
# Everything below is plain numpy. The one idea worth stating: linear filters
# are applied by convolving with their impulse response rather than by running
# a recursion in Python. It is exact for the filters used here (one-poles and
# two-pole resonators have closed-form IRs), it is causal — unlike multiplying
# an FFT by a magnitude curve, which smears a transient backwards in time —
# and an FFT convolution of a half-second sound costs about a millisecond.

_rng = np.random.default_rng(1926)


def seed(*key):
    """Re-seed the global stream so a given sound renders the same every time.

    crc32, not hash() — Python randomises string hashing per process and a
    rebuild that quietly reshuffles every variant is worse than no seed.
    """
    global _rng
    h = 1926
    for k in key:
        h = (h * 1000003) ^ zlib.crc32(str(k).encode())
    _rng = np.random.default_rng(h & 0x7FFFFFFF)


def n_of(sec):
    return max(1, int(round(sec * SR)))


def t_of(sec):
    return np.arange(n_of(sec)) / SR


def noise(sec):
    return _rng.standard_normal(n_of(sec))


def pink(sec):
    """1/f noise — the colour of hiss, rumble and distant crowd."""
    n = n_of(sec)
    spec = np.fft.rfft(_rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1.0 / SR)
    f[0] = f[1] if len(f) > 1 else 1.0
    out = np.fft.irfft(spec / np.sqrt(f), n)
    return out / (np.std(out) + 1e-12)


def conv(x, ir, keep=None):
    """FFT convolution. Returns len(x) samples unless keep says otherwise."""
    n = len(x) + len(ir) - 1
    nfft = 1 << max(1, (n - 1)).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, nfft) * np.fft.rfft(ir, nfft), nfft)[:n]
    if keep is None:
        keep = len(x)
    if keep <= len(y):
        return y[:keep]
    return np.pad(y, (0, keep - len(y)))


# -- envelopes -------------------------------------------------------------
def ad(sec, atk, tau, shape=1.0, hold=0.0):
    """Percussive envelope: shaped attack, optional hold, exponential decay."""
    t = t_of(sec)
    a = np.clip(t / max(atk, 1e-6), 0.0, 1.0) ** shape
    d = np.exp(-np.maximum(t - atk - hold, 0.0) / max(tau, 1e-6))
    return a * d


def asr(sec, atk, rel, shape=2.0):
    """Swell envelope for sustained things: crowds, whooshes, brushes."""
    n = n_of(sec)
    t = np.arange(n) / SR
    a = np.clip(t / max(atk, 1e-6), 0.0, 1.0) ** shape
    r = np.clip((sec - t) / max(rel, 1e-6), 0.0, 1.0) ** shape
    return a * r


def fade(x, in_s=0.002, out_s=0.006):
    """Guarantee no click at either end of a buffer."""
    y = np.asarray(x, dtype=float).copy()
    ni, no = min(n_of(in_s), len(y) // 2), min(n_of(out_s), len(y) // 2)
    shape = (-1,) if y.ndim == 1 else (-1, 1)
    if ni > 1:
        y[:ni] *= (np.linspace(0.0, 1.0, ni) ** 1.5).reshape(shape)
    if no > 1:
        y[-no:] *= (np.linspace(1.0, 0.0, no) ** 1.5).reshape(shape)
    return y


# -- filters (causal, via impulse response) --------------------------------
def _pole_ir(fc, floor=1e-4):
    a = math.exp(-2.0 * math.pi * max(fc, 1.0) / SR)
    n = int(math.log(floor) / math.log(max(a, 1e-9))) + 1
    return (1.0 - a) * a ** np.arange(min(n, SR))


def lp(x, fc, poles=1):
    """Gentle 6 dB/oct-per-pole lowpass. Period gear did not have brickwalls."""
    ir = _pole_ir(fc)
    y = x
    for _ in range(poles):
        y = conv(y, ir)
    return y


def hp(x, fc, poles=1):
    y = x
    for _ in range(poles):
        y = y - lp(y, fc, 1)
    return y


def band(x, lo, hi, poles=1):
    return lp(hp(x, lo, poles), hi, poles)


def res_ir(f, tau, n=None):
    """A two-pole resonator's impulse response, energy-normalised so that the
    same input level gives the same output level whatever the ring time."""
    if n is None:
        n = n_of(min(7.0 * tau, 2.5))
    t = np.arange(max(n, 8)) / SR
    ir = np.exp(-t / max(tau, 1e-5)) * np.sin(2.0 * math.pi * f * t)
    return ir / (np.sqrt(np.sum(ir * ir)) + 1e-12)


def resonate(x, f, tau, gain=1.0, keep=None):
    return conv(x, res_ir(f, tau), keep) * gain


def sweep_band(x, path, q=3.0, steps=12):
    """Band-pass whose centre glides through `path` across the buffer.

    Crossfaded fixed resonators rather than a genuinely time-varying filter:
    for a 200 ms whoosh the seams are inaudible and it stays five lines.
    A two-pole resonator with ring time tau has bandwidth 1/(pi*tau), so
    tau = q/(pi*f) gives the requested Q at every step.
    """
    path = np.asarray(path, dtype=float)
    if path.ndim == 0:
        path = path.reshape(1)
    n = len(x)
    tt = np.linspace(0.0, 1.0, n)
    cs = np.linspace(0.0, 1.0, steps)
    fs = np.exp(np.interp(cs, np.linspace(0.0, 1.0, len(path)), np.log(path)))
    out = np.zeros(n)
    for c, f in zip(cs, fs):
        w = np.clip(1.0 - np.abs(tt - c) * (steps - 1.0), 0.0, 1.0)
        out += resonate(x, f, q / (math.pi * f)) * w
    return out


def modes(freqs, taus, amps, sec, jitter=0.0, rand_phase=False):
    """Additive modal ring: what a struck solid actually does.

    Modes start at phase 0 by default — a real strike excites them all at
    once, and it also means the buffer opens at zero instead of on a click.
    """
    t = t_of(sec)
    out = np.zeros(len(t))
    for f, tau, a in zip(freqs, taus, amps):
        ff = f * (1.0 + jitter * _rng.uniform(-1.0, 1.0))
        ph = _rng.uniform(0.0, 2.0 * math.pi) if rand_phase else 0.0
        out += a * np.exp(-t / tau) * np.sin(2.0 * math.pi * ff * t + ph)
    return out


def glide(f_from, f_to, tau, sec, decay, amp=1.0, partials=((1.0, 1.0, 1.0),)):
    """A pitched body whose frequency sags as it decompresses — the single
    detail that separates rubber from a sine beep."""
    t = t_of(sec)
    out = np.zeros(len(t))
    for mul, gain, dmul in partials:
        f = f_to * mul + (f_from - f_to) * mul * np.exp(-t / tau)
        # cumulative phase, shifted so the buffer opens at zero (no click)
        ph = 2.0 * math.pi * (np.cumsum(f) - f[0]) / SR
        out += gain * np.sin(ph) * np.exp(-t / (decay * dmul))
    return out * amp


# -- character# -- character -------------------------------------------------------------
def saturate(x, drive=2.0):
    """Soft clip. Everything on a 1926 record went through something like it."""
    return np.tanh(x * drive) / math.tanh(drive)


def comb(x, delay_s, g=0.35):
    """A single reflection mixed back in — the metal in a megaphone cone."""
    d = n_of(delay_s)
    y = x.copy()
    y[d:] += g * x[:-d]
    return y


def megaphone(x, drive=2.6, tin=0.32, lo=380.0, hi=3100.0):
    """The kid with the tin megaphone: narrow band, horn formants, hot drive."""
    y = band(x, lo, hi, poles=2)
    y = y + 0.55 * resonate(y, 1250.0, 0.0045) + 0.35 * resonate(y, 2300.0, 0.003)
    y = saturate(y, drive)
    y = comb(y, 0.0011, tin)
    return lp(y, 3600.0, 1)


def gramophone(x, lo=110.0, hi=5200.0, drive=1.15):
    """Acoustic-era record: no lows, no air, a little horn honk, mild clip."""
    y = band(x, lo, hi, poles=2)
    y += 0.20 * resonate(y, 900.0, 0.010) + 0.14 * resonate(y, 2100.0, 0.006)
    return saturate(y, drive)


def read_frac(x, idx, wrap=False):
    """Linear-interpolated read — the primitive under wow, flutter, doppler."""
    n = len(x)
    if wrap:
        i0 = np.floor(idx).astype(np.int64)
        fr = idx - i0
        return x[i0 % n] * (1.0 - fr) + x[(i0 + 1) % n] * fr
    idx = np.clip(idx, 0.0, n - 1.001)
    i0 = idx.astype(np.int64)
    fr = idx - i0
    return x[i0] * (1.0 - fr) + x[i0 + 1] * fr


def wow(x, rate=0.72, depth=0.0026, flut=6.4, fdepth=0.00045, loop=False):
    """Tape/turntable pitch drift. On a loop the LFOs are snapped to whole
    cycles per buffer so the wobble meets itself at the seam."""
    n = len(x)
    sec = n / SR
    if loop:
        rate = max(1.0, round(rate * sec)) / sec
        flut = max(1.0, round(flut * sec)) / sec
    t = np.arange(n) / SR
    mod = depth * np.sin(2.0 * math.pi * rate * t) \
        + fdepth * np.sin(2.0 * math.pi * flut * t + 1.3)
    return read_frac(x, np.arange(n) + mod * SR, wrap=loop)


def crackle(sec, density=26.0, level=1.0, rumble=True, loop=False):
    """Shellac surface noise: sparse pops with a heavy tail, hiss, and the
    once-per-revolution thump of a 78 (78 rpm = 1.3 Hz)."""
    n = n_of(sec)
    out = np.zeros(n)
    for _ in range(int(density * sec)):
        pos = int(_rng.integers(0, n))
        ln = n_of(_rng.uniform(0.0007, 0.0035))
        g = float(_rng.standard_exponential()) ** 1.6 * 0.25
        pop = band(_rng.standard_normal(ln), 1400.0, 8000.0, 1) \
            * np.exp(-np.arange(ln) / (ln * 0.35))
        _wrap_add(out, pop * g, pos, loop)
    white = _rng.standard_normal(n)
    hiss = (circular(white, lambda z: band(z, 900.0, 7000.0, 1)) if loop
            else band(white, 900.0, 7000.0, 1)) * 0.055
    out += hiss
    if rumble:
        w2 = _rng.standard_normal(n)
        low = circular(w2, lambda z: lp(z, 55.0, 2)) if loop else lp(w2, 55.0, 2)
        out += low / (np.std(low) + 1e-9) * 0.03
        rev = 1.3 if not loop else max(1.0, round(1.3 * sec)) / sec
        thump = np.sin(2.0 * math.pi * rev * np.arange(n) / SR)
        out += 0.02 * np.clip(thump, 0.0, 1.0) ** 6
    return out * level


def _wrap_add(buf, seg, at, wrap):
    n = len(buf)
    if at >= n:
        return
    end = at + len(seg)
    if end <= n:
        buf[at:end] += seg
    elif wrap:
        cut = n - at
        buf[at:] += seg[:cut]
        rest = min(len(seg) - cut, n)
        buf[:rest] += seg[cut:cut + rest]
    else:
        buf[at:] += seg[:n - at]


# -- the street ------------------------------------------------------------
# One room for the whole game. The block is a canyon — tenements both sides,
# cobbles underfoot — so what you hear after a hit is two hard slapbacks off
# the facades and a short, dark, dead tail. This IR is WET ONLY (no direct
# path) and normalised to unit energy, so the `mix` argument means what it
# says: 0.2 is a fifth as much reflected sound as direct.
def street_ir(size=1.0, tail=0.26, bright=2400.0):
    n = n_of(tail + 0.08)
    ir = np.zeros(n)
    for dt, g in ((0.0240 * size, 0.62), (0.0410 * size, 0.44),
                  (0.0685 * size, 0.26), (0.0990 * size, 0.14)):
        i = n_of(dt)
        if i < n:
            ir[i] += g
    t = np.arange(n) / SR
    diffuse = _rng.standard_normal(n) * np.exp(-t / (tail * 0.30))
    diffuse = lp(hp(diffuse, 300.0, 1), bright, 2)
    diffuse *= 0.55 / (np.sqrt(np.sum(diffuse * diffuse)) + 1e-12)
    ir = ir + diffuse
    return ir / (np.sqrt(np.sum(ir * ir)) + 1e-12)


_ROOM = None


def street(x, mix=0.16, size=1.0):
    """Put a sound outdoors on the block."""
    global _ROOM
    if size != 1.0:
        state = _rng.bit_generator.state
        seed("street-ir", size)
        ir = street_ir(size)
        _rng.bit_generator.state = state
        return x + conv(x, ir) * mix
    if _ROOM is None:
        state = _rng.bit_generator.state
        seed("street-ir")
        _ROOM = street_ir()
        _rng.bit_generator.state = state
    return x + conv(x, _ROOM) * mix


# -- output ----------------------------------------------------------------
def dc_block(x):
    return hp(x - float(np.mean(x)), 16.0, 1)


def norm(x, peak_db=PEAK_DB):
    p = float(np.max(np.abs(x)))
    if p < 1e-9:
        return x
    return x * (10.0 ** (peak_db / 20.0) / p)


def limit(x, peak_db=PEAK_DB, knee=0.7):
    """Tanh limiter — keeps a crack's transient instead of turning the whole
    sound down to fit it."""
    ceil = 10.0 ** (peak_db / 20.0)
    k = ceil * knee
    over = np.abs(x) > k
    y = x.copy()
    y[over] = np.sign(x[over]) * (k + (ceil - k) * np.tanh((np.abs(x[over]) - k) / (ceil - k)))
    return y


def per_channel(fn, x, *a, **k):
    """Run a mono kernel function over a mono or stereo buffer."""
    if x.ndim == 1:
        return fn(x, *a, **k)
    return np.stack([fn(x[:, c], *a, **k) for c in range(x.shape[1])], axis=1)


def finish(x, peak_db=PEAK_DB, fin=0.0002, fout=0.008, ceiling=-1.8, loop=False):
    """The only way a sound leaves this file: DC-blocked, click-free at both
    ends, normalised, then limited. Fades happen BEFORE normalising so a
    transient in the first millisecond is never quietly shaved off, and gain
    is applied to both channels together so the image never shifts."""
    y = np.asarray(x, dtype=float)
    if loop:
        # a loop gets no fades at all, and even the DC blocker runs circularly
        # — a one-pole at 16 Hz has a 4000-sample tail, easily enough to leave
        # an audible step at the join.
        y = per_channel(lambda c: circular(c, dc_block), y)
    else:
        y = per_channel(dc_block, y)
        y = per_channel(lambda c: fade(c, fin, fout), y)
    return limit(norm(y, peak_db), ceiling)


def stereo(l, r):
    n = max(len(l), len(r))
    return np.stack([np.pad(l, (0, n - len(l))), np.pad(r, (0, n - len(r)))], axis=1)


def widen(x, spread=0.010, tilt=0.6):
    """Mono -> stereo by two short decorrelating delays. Collapses cleanly to
    mono on a phone speaker, which is where most of this will be heard."""
    d = n_of(spread)
    l = x.copy()
    r = x.copy()
    l[d:] += tilt * 0.5 * x[:-d]
    r[n_of(spread * 0.61):] += tilt * 0.5 * x[:-n_of(spread * 0.61)]
    return stereo(l, r)


def write_wav(path, x, loop=False):
    """16-bit PCM RIFF. Loops carry a `smpl` chunk so Godot's importer marks
    them looping on import with no .import hand-editing."""
    x = np.asarray(x, dtype=np.float64)
    ch = 1 if x.ndim == 1 else x.shape[1]
    frames = x.shape[0]
    data = np.clip(x.reshape(-1), -1.0, 1.0)
    pcm = np.round(data * 32767.0).astype("<i2").tobytes()
    fmt = struct.pack("<HHIIHH", 1, ch, SR, SR * ch * 2, ch * 2, 16)
    chunks = b"fmt " + struct.pack("<I", len(fmt)) + fmt
    if loop:
        smpl = struct.pack("<IIIIIIIII", 0, 0, int(1e9 / SR), 60, 0, 0, 0, 1, 0)
        smpl += struct.pack("<IIIIII", 0, 0, 0, frames - 1, 0, 0)
        chunks += b"smpl" + struct.pack("<I", len(smpl)) + smpl
    chunks += b"data" + struct.pack("<I", len(pcm)) + pcm
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 4 + len(chunks)) + b"WAVE" + chunks)
    return len(pcm) + 44


# Godot writes a .import file next to every asset the first time it scans it.
# Only one setting in there matters to us, and it is not one you want left to
# chance: a looping bed must import as raw PCM so the join stays the exact
# sample pair this file rendered, while one-shots take Godot's QOA default and
# come out five times smaller on the phone.
_IMPORT_TEMPLATE = """[remap]

importer="wav"
type="AudioStreamWAV"

[deps]

source_file="res://assets/audio/%s"

[params]

force/8_bit=false
force/mono=false
force/max_rate=false
force/max_rate_hz=44100
edit/trim=false
edit/normalize=false
edit/loop_mode=0
edit/loop_begin=0
edit/loop_end=-1
compress/mode=%d
"""


def ensure_import(wav_path, loop, rel):
    mode = 0 if loop else 2                  # 0 = PCM, 2 = QOA
    ip = wav_path + ".import"
    if os.path.exists(ip):
        with open(ip) as f:
            txt = f.read()
        new = re.sub(r"compress/mode=\d+", "compress/mode=%d" % mode, txt)
        if new != txt:
            with open(ip, "w") as f:
                f.write(new)
        return
    with open(ip, "w") as f:
        f.write(_IMPORT_TEMPLATE % (rel, mode))


def read_wav(path):
    with open(path, "rb") as f:
        raw = f.read()
    pos, ch, sr, loop = 12, 1, SR, False
    data = b""
    while pos + 8 <= len(raw):
        cid = raw[pos:pos + 4]
        sz = struct.unpack("<I", raw[pos + 4:pos + 8])[0]
        body = raw[pos + 8:pos + 8 + sz]
        if cid == b"fmt ":
            ch, sr = struct.unpack("<HI", body[2:8])
        elif cid == b"data":
            data = body
        elif cid == b"smpl":
            loop = True
        pos += 8 + sz + (sz & 1)
    x = np.frombuffer(data, dtype="<i2").astype(np.float64) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch)
    return x, sr, loop


# ================================================================ the bat
# A stickball bat is a broom handle: a thin ash cylinder, so its bending modes
# run 1 : 2.76 : 5.40 : 8.93 (a free-free bar), not a harmonic series. The ball
# is a hollow pink rubber spaldeen, which adds a short pitched squash on top.
BAR_RATIOS = (1.0, 2.76, 5.40, 8.93, 13.34)


def tick(sec=0.006, tau=0.0009, lo=2200.0, poles=2):
    """The sub-millisecond spike that makes an impact read as an impact.

    The 0.12 ms attack ramp is there so the buffer starts at zero: it is a
    ~3 kHz rise time, far too fast to soften anything audibly, but it means
    the output fade never has to chew on the loudest sample in the file.
    """
    n = n_of(sec)
    x = _rng.standard_normal(n) * ad(sec, 0.00012, tau)
    return hp(x, lo, poles)


def burst(sec, tau, lo, hi, atk=0.0002):
    """A shaped noise burst — grit, leather, dust, breath."""
    return band(noise(sec), lo, hi, 1) * ad(sec, atk, tau)


def bat_crack(v):
    """Perfect contact. Crack, wood body, squash, and the canyon answering."""
    seed("bat_crack", v)
    dur = 0.48
    f0 = 238.0 * _rng.uniform(0.94, 1.07)
    out = np.zeros(n_of(dur))
    out[:n_of(0.006)] += tick(0.006, 0.00085, 2400.0) * 1.35
    out += 0.85 * band(burst(dur, 0.010, 900.0, 7000.0), 700.0, 8000.0, 1) * 2.2
    wood = modes([f0 * r for r in BAR_RATIOS],
                 [0.062, 0.040, 0.026, 0.017, 0.011],
                 [1.0, 0.90, 0.70, 0.46, 0.26], dur, jitter=0.01)
    out += 0.55 * wood
    # the spaldeen giving way: pitched, and it sags as it comes back off
    out += 0.40 * glide(760.0, 610.0, 0.012, dur, 0.030,
                        partials=((1.0, 1.0, 1.0), (1.63, 0.35, 0.6)))
    out += 0.22 * modes([96.0], [0.032], [1.0], dur)          # the weight of it
    out = saturate(out * 1.1, 1.4)
    out = street(out, mix=0.20)
    return finish(out, -2.2)


def bat_thud(v):
    """Weak contact — off the end, off the handle. Dead, dark, no crack."""
    seed("bat_thud", v)
    dur = 0.42
    f0 = 205.0 * _rng.uniform(0.92, 1.06)
    out = np.zeros(n_of(dur))
    out[:n_of(0.006)] += tick(0.006, 0.0011, 900.0, 1) * 0.45
    out += 0.7 * band(burst(dur, 0.014, 260.0, 1900.0), 200.0, 2200.0, 1) * 1.6
    out += 0.45 * modes([f0 * r for r in BAR_RATIOS[:3]],
                        [0.038, 0.022, 0.013], [1.0, 0.5, 0.22], dur, jitter=0.02)
    out += 0.55 * glide(520.0, 430.0, 0.018, dur, 0.045)      # a dead spaldeen
    out += 0.35 * modes([88.0], [0.055], [1.0], dur)
    out = street(lp(out, 2600.0, 1), mix=0.16)
    return finish(out, -6.0)


def bat_whiff(v):
    """Broom handle through afternoon air. Nothing but a moving band of wind."""
    seed("bat_whiff", v)
    dur = 0.34
    src = noise(dur)
    body = sweep_band(src, [520.0, 2500.0, 900.0], q=1.5, steps=14)
    body *= asr(dur, 0.13, 0.18, shape=2.4)
    body += 0.25 * sweep_band(src, [180.0, 700.0, 260.0], q=1.2, steps=8) \
        * asr(dur, 0.15, 0.16, shape=2.0)
    out = street(body, mix=0.10)
    return finish(out, -9.0, 0.004, 0.05)


# ================================================================ the spaldeen
def ball_bounce(v):
    """THE sound. Every pitch bounces once on the cobbles before the plate, so
    this cue is the game's metronome: stone tick, grit slap, and a pink rubber
    body that sags in pitch as it decompresses."""
    seed("ball_bounce", v)
    dur = 0.30
    f = 655.0 * _rng.uniform(0.90, 1.12)
    out = np.zeros(n_of(dur))
    out[:n_of(0.005)] += tick(0.005, 0.00065, 3000.0) * 1.15
    out += 1.9 * band(burst(dur, 0.0075, 800.0, 5200.0), 600.0, 6000.0, 1)
    out += 0.95 * glide(f * 1.16, f, 0.011, dur, 0.052,
                        partials=((1.0, 1.0, 1.0), (1.62, 0.34, 0.55),
                                  (2.29, 0.14, 0.35)))
    out += 0.34 * modes([158.0 * _rng.uniform(0.95, 1.05)], [0.030], [1.0], dur)
    out = saturate(out, 1.2)
    out = street(out, mix=0.15)
    return finish(out, -3.4)


def ball_mitt(v):
    """Into the catcher's mitt: leather, a fist of air, no ring."""
    seed("ball_mitt", v)
    dur = 0.30
    out = np.zeros(n_of(dur))
    out[:n_of(0.006)] += tick(0.006, 0.0011, 1400.0, 1) * 0.55
    out += 1.5 * band(burst(dur, 0.020, 220.0, 2400.0), 180.0, 2800.0, 1)
    out += 0.30 * modes([132.0, 268.0], [0.042, 0.024], [1.0, 0.4], dur)
    out += 0.18 * glide(470.0, 400.0, 0.02, dur, 0.028)
    out = street(lp(out, 3200.0, 1), mix=0.12)
    return finish(out, -6.5)


def ball_brick(v):
    """Off a tenement wall: harder, brighter, drier than the cobbles."""
    seed("ball_brick", v)
    dur = 0.30
    out = np.zeros(n_of(dur))
    out[:n_of(0.004)] += tick(0.004, 0.0006, 3400.0) * 1.0
    out += 2.0 * band(burst(dur, 0.0060, 1100.0, 7000.0), 900.0, 8000.0, 1)
    out += 0.75 * glide(880.0, 800.0, 0.009, dur, 0.038,
                        partials=((1.0, 1.0, 1.0), (1.71, 0.35, 0.7)))
    # brick is dead, but not THAT dead — a little dusty ring off the courses
    out += 0.30 * modes([345.0, 690.0], [0.030, 0.018], [1.0, 0.45], dur, jitter=0.02)
    out += 0.22 * modes([210.0], [0.022], [1.0], dur)
    out = street(out, mix=0.24, size=0.7)
    return finish(out, -5.0)


def ball_flivver(v):
    """Off Mr. Esposito's Model T. Thin steel panel: inharmonic, long, comic."""
    seed("ball_flivver", v)
    dur = 1.05
    k = _rng.uniform(0.94, 1.08)
    fr = [318.0, 497.0, 742.0, 1103.0, 1655.0, 2411.0, 3120.0]
    out = np.zeros(n_of(dur))
    out[:n_of(0.005)] += tick(0.005, 0.0007, 2600.0) * 0.7
    out += 1.2 * band(burst(dur, 0.006, 700.0, 6000.0), 600.0, 7000.0, 1)
    out += 0.75 * modes([f * k for f in fr],
                        [0.34, 0.27, 0.21, 0.15, 0.10, 0.065, 0.04],
                        [1.0, 0.82, 0.66, 0.5, 0.34, 0.2, 0.12], dur, jitter=0.006)
    # the panel flapping after the hit, and a loose fender rattling twice
    t = t_of(dur)
    out *= 1.0 + 0.16 * np.sin(2.0 * math.pi * 7.3 * t) * np.exp(-t / 0.35)
    for at, g in ((0.16, 0.35), (0.27, 0.22), (0.41, 0.13)):
        rat = modes([1180.0 * k, 1980.0 * k], [0.02, 0.013], [1.0, 0.5], 0.12)
        _wrap_add(out, rat * g, n_of(at), False)
    out = street(out, mix=0.20)
    return finish(out, -4.0)


def glass_smash(v):
    """Mrs. Costello's window. Crack, then a shower of shards down the areaway."""
    seed("glass_smash", v)
    dur = 1.25
    n = n_of(dur)
    out = np.zeros(n)
    out[:n_of(0.008)] += tick(0.008, 0.0012, 2600.0) * 1.1
    out += 1.6 * band(burst(dur, 0.045, 900.0, 9000.0), 800.0, 10000.0, 1)
    out += 0.5 * modes([1560.0, 2320.0, 3910.0], [0.06, 0.04, 0.025],
                       [1.0, 0.7, 0.4], dur, jitter=0.02)
    out += 0.30 * modes([148.0, 292.0], [0.075, 0.045], [1.0, 0.4], dur)  # frame
    # the shards: grains whose density dies away, each a tiny bright ping
    for _ in range(260):
        at = float(_rng.exponential(0.30)) + 0.03
        if at >= dur - 0.05:
            continue
        f = float(_rng.uniform(1900.0, 8200.0))
        ln = 0.030
        g = float(_rng.uniform(0.05, 0.55)) * math.exp(-at / 0.55)
        grain = modes([f, f * 2.41], [0.006, 0.003], [1.0, 0.45], ln) \
            + 0.5 * burst(ln, 0.0022, 2500.0, 11000.0)
        _wrap_add(out, grain * g * 0.5, n_of(at), False)
    out = street(out, mix=0.26)
    return finish(out, -2.6)


def ball_roll(v):
    """Rolling away down the cobbles — bump rate falls with the ball."""
    seed("ball_roll", v)
    dur = 1.35
    n = n_of(dur)
    out = lp(hp(noise(dur), 240.0, 1), 2200.0, 1) * 0.35
    at, rate = 0.0, 26.0
    while at < dur - 0.05:
        g = float(_rng.uniform(0.4, 1.0)) * (1.0 - at / dur) ** 1.3
        bump = burst(0.05, 0.0035, 500.0, 4500.0) \
            + 0.5 * modes([620.0 * _rng.uniform(0.8, 1.25)], [0.008], [1.0], 0.05)
        _wrap_add(out, bump * g * 0.7, n_of(at), False)
        at += 1.0 / rate * float(_rng.uniform(0.7, 1.3))
        rate = max(5.0, rate * 0.955)
    out *= np.exp(-np.arange(n) / (SR * 0.75))
    out = street(out, mix=0.14)
    return finish(out, -10.0, 0.01, 0.12)


# ================================================================ kids
def step(v):
    """A sneaker scuffing wet cobble. Short, gritty, no thump."""
    seed("step", v)
    dur = 0.20
    out = np.zeros(n_of(dur))
    out += 1.4 * band(burst(dur, 0.022, 420.0, 4200.0, atk=0.0016),
                      350.0, 5000.0, 1)
    out += 0.35 * modes([190.0 * _rng.uniform(0.9, 1.1)], [0.020], [1.0], dur)
    for _ in range(int(_rng.integers(1, 4))):        # loose grit under the sole
        _wrap_add(out, tick(0.004, 0.0007, 3000.0) * float(_rng.uniform(0.05, 0.2)),
                  n_of(float(_rng.uniform(0.0, 0.05))), False)
    out = street(out, mix=0.13)
    return finish(out, -13.0, 0.001, 0.03)


def slide(v):
    """Into the stoop on one hip. A long scrape with grit in it."""
    seed("slide", v)
    dur = 0.75
    src = noise(dur)
    out = sweep_band(src, [2600.0, 1200.0, 520.0], q=1.1, steps=10)
    out *= asr(dur, 0.05, 0.42, shape=1.6)
    out += 0.5 * lp(hp(src, 120.0, 1), 700.0, 1) * asr(dur, 0.07, 0.4, 1.4)
    for _ in range(26):
        at = float(_rng.uniform(0.0, dur - 0.06))
        _wrap_add(out, tick(0.005, 0.0009, 2500.0)
                  * float(_rng.uniform(0.02, 0.16)) * (1.0 - at / dur), n_of(at), False)
    out = street(out, mix=0.13)
    return finish(out, -11.0, 0.006, 0.10)


def mitt_catch(v):
    """A fielder squeezing it. Leather slap plus the creak of the pocket."""
    seed("mitt_catch", v)
    dur = 0.36
    out = np.zeros(n_of(dur))
    out[:n_of(0.006)] += tick(0.006, 0.0010, 1200.0, 1) * 0.5
    out += 1.6 * band(burst(dur, 0.018, 260.0, 2800.0), 200.0, 3200.0, 1)
    out += 0.28 * modes([118.0, 240.0], [0.040, 0.022], [1.0, 0.4], dur)
    creak = band(noise(dur), 700.0, 1800.0, 1) * ad(dur, 0.03, 0.05, hold=0.02)
    t = t_of(dur)
    out += 0.30 * creak * (1.0 + 0.8 * np.sin(2.0 * math.pi * 19.0 * t))
    out = street(lp(out, 3400.0, 1), mix=0.12)
    return finish(out, -7.0)


# ================================================================ events
def cop_whistle(v):
    """The beat cop rounding the corner. A pea whistle: two close tones, a
    rattling pea chopping them, and a lot of breath."""
    seed("cop_whistle", v)
    blasts = [(0.0, 0.62)] if v == 1 else [(0.0, 0.20), (0.30, 0.20), (0.62, 0.42)]
    dur = blasts[-1][0] + blasts[-1][1] + 0.45
    n = n_of(dur)
    out = np.zeros(n)
    f = 2620.0 * _rng.uniform(0.97, 1.04)
    for at, ln in blasts:
        t = t_of(ln)
        # the pea: a smoothed random gate around 30 Hz doing both AM and FM
        pea = lp(_rng.standard_normal(len(t)), 90.0, 2)
        pea /= (np.std(pea) + 1e-9)
        rat = np.sin(2.0 * math.pi * 31.0 * t + 2.0 * pea)
        vib = 1.0 + 0.012 * rat + 0.004 * pea
        ph = 2.0 * math.pi * np.cumsum(f * vib) / SR
        tone = np.sin(ph) + 0.75 * np.sin(2.0 * math.pi * np.cumsum(f * 1.006 * vib) / SR) \
            + 0.22 * np.sin(2.0 * ph)
        tone *= 0.72 + 0.28 * rat
        air = band(_rng.standard_normal(len(t)), 2200.0, 7000.0, 1) * 0.16
        env = asr(ln, 0.030, 0.075, shape=1.4)
        rise = 1.0 - 0.06 * np.exp(-t / 0.02)             # the little chirp up
        seg = (tone * 0.55 + air) * env * rise
        _wrap_add(out, seg, n_of(at), False)
    out = saturate(out, 1.6)
    out = street(out, mix=0.22)
    return finish(out, -4.5)


def scatter():
    """Twelve kids leaving at once."""
    seed("scatter")
    dur = 1.1
    out = np.zeros(n_of(dur))
    for _ in range(22):
        at = float(_rng.uniform(0.0, 0.75)) ** 1.4
        s = step(int(_rng.integers(1, 5)))
        _wrap_add(out, s * float(_rng.uniform(0.25, 0.8)), n_of(at), False)
    out += 0.5 * sweep_band(noise(dur), [400.0, 2400.0], q=1.2, steps=8) \
        * asr(dur, 0.35, 0.5, shape=2.0)
    out = street(out, mix=0.16)
    return finish(out, -6.0, 0.004, 0.09)


def card_slam():
    """An intertitle hitting the screen: paper flap, wood knock, projector."""
    seed("card_slam")
    dur = 0.70
    out = np.zeros(n_of(dur))
    flap = sweep_band(noise(0.07), [300.0, 1600.0], q=1.3, steps=6) * asr(0.07, 0.012, 0.04)
    _wrap_add(out, flap * 0.8, 0, False)
    knock = modes([176.0, 421.0, 903.0, 1580.0], [0.055, 0.030, 0.016, 0.009],
                  [1.0, 0.62, 0.34, 0.18], dur)
    knock += 3.0 * band(burst(dur, 0.0055, 500.0, 5000.0), 400.0, 6000.0, 1)
    knock[:n_of(0.005)] += tick(0.005, 0.0008, 2400.0) * 0.8
    _wrap_add(out, knock * 0.9, n_of(0.030), False)
    chunk = modes([240.0, 690.0], [0.020, 0.010], [1.0, 0.5], 0.15) \
        + 1.5 * band(burst(0.15, 0.004, 800.0, 4000.0), 600.0, 5000.0, 1)
    _wrap_add(out, chunk * 0.3, n_of(0.095), False)
    out = street(out, mix=0.24)
    return finish(out, -2.8)


def iris(v):
    """The iris wipe. Air, plus the 24 Hz flutter of the projector gate.
    v=1 closes in (the sweep falls), v=2 opens out (it rises)."""
    seed("iris", v)
    dur = 0.60
    path = [2400.0, 900.0, 320.0] if v == 1 else [340.0, 1000.0, 2600.0]
    body = sweep_band(noise(dur), path, q=1.4, steps=12)
    body *= asr(dur, 0.10, 0.30, shape=1.6)
    t = t_of(dur)
    body *= 1.0 + 0.20 * np.sin(2.0 * math.pi * 24.0 * t)
    body += 0.35 * lp(noise(dur), 300.0, 2) * asr(dur, 0.12, 0.3, 1.5)
    out = street(body, mix=0.14)
    return finish(out, -10.0, 0.008, 0.08)


def score_bell():
    """A run crosses the manhole: the candy-store bell over the door."""
    seed("score_bell")
    dur = 1.1
    fr = [1046.5, 2093.0, 3138.0, 4186.0]
    out = modes(fr, [0.42, 0.26, 0.16, 0.10], [1.0, 0.55, 0.3, 0.16], dur, jitter=0.004)
    out[:n_of(0.004)] += tick(0.004, 0.0006, 3000.0) * 0.5
    second = modes([f * 1.005 for f in fr], [0.30, 0.19, 0.12, 0.07],
                   [0.7, 0.4, 0.2, 0.1], dur - 0.09)
    _wrap_add(out, second, n_of(0.09), False)
    out = street(out, mix=0.16)
    return finish(out, -6.0, 0.001, 0.12)


def sewer_ping(v):
    """ONE SEWER… TWO SEWERS… — a rising chime per manhole cleared."""
    seed("sewer_ping", v)
    dur = 0.75
    base = 784.0 * (1.26 ** (v - 1))
    out = glide(base * 0.86, base, 0.035, dur, 0.16,
                partials=((1.0, 1.0, 1.0), (2.01, 0.45, 0.6), (3.02, 0.2, 0.4)))
    out[:n_of(0.004)] += tick(0.004, 0.0006, 3400.0) * 0.35
    out = street(out, mix=0.18)
    return finish(out, -8.0, 0.002, 0.10)


def pitch_release(v):
    """The arm coming over — a soft whip so the pitch never starts silently."""
    seed("pitch_release", v)
    dur = 0.20
    out = sweep_band(noise(dur), [900.0, 2200.0, 1100.0], q=1.3, steps=8)
    out *= asr(dur, 0.06, 0.10, shape=2.0)
    return finish(out, -17.0, 0.004, 0.05)


# ================================================================ UI
def ui_flip(v):
    """A trading card coming off the rack."""
    seed("ui_flip", v)
    dur = 0.22
    out = sweep_band(noise(dur), [1100.0, 4200.0, 1800.0], q=1.1, steps=8)
    out *= asr(dur, 0.03, 0.10, shape=1.8)
    out += 0.5 * burst(dur, 0.004, 1800.0, 7000.0)
    return finish(out, -12.0, 0.003, 0.05)


def ui_select():
    """Card picked: paper plus a small nickel ting."""
    seed("ui_select")
    dur = 0.45
    out = np.zeros(n_of(dur))
    paper = sweep_band(noise(0.14), [1400.0, 4000.0], q=1.1, steps=6) * asr(0.14, 0.02, 0.08)
    _wrap_add(out, paper * 0.55, 0, False)
    ting = modes([2093.0, 3136.0, 4700.0], [0.09, 0.055, 0.03],
                 [1.0, 0.5, 0.25], dur - 0.02)
    _wrap_add(out, ting * 0.5, n_of(0.02), False)
    return finish(out, -9.0, 0.002, 0.06)


def ui_click(v):
    """A ticket punch. Mechanical, short, satisfying."""
    seed("ui_click", v)
    dur = 0.16
    out = np.zeros(n_of(dur))
    out[:n_of(0.004)] += tick(0.004, 0.0006, 2000.0, 1) * 0.6
    out += 1.4 * band(burst(dur, 0.006, 600.0, 4500.0), 500.0, 5200.0, 1)
    out += 0.5 * modes([880.0, 1490.0], [0.012, 0.007], [1.0, 0.5], dur)
    out += 0.3 * modes([210.0], [0.018], [1.0], dur)
    return finish(out, -10.0, 0.001, 0.03)


def ui_two_note(up=True, name="ui_confirm"):
    """Confirm rises, back falls — same little bell either way."""
    seed(name)
    dur = 0.55
    notes = [523.25, 783.99] if up else [659.25, 392.0]
    out = np.zeros(n_of(dur))
    for i, f in enumerate(notes):
        at = 0.0 if i == 0 else 0.10
        seg = modes([f, f * 2.0, f * 3.01], [0.16, 0.10, 0.06],
                    [1.0, 0.45, 0.2], dur - at)
        seg[:n_of(0.003)] += tick(0.003, 0.0005, 2600.0) * 0.25
        _wrap_add(out, seg * (0.8 if i == 0 else 1.0), n_of(at), False)
    out = street(out, mix=0.12)
    return finish(out, -10.0, 0.002, 0.08)


# ================================================================ voices
# Real speech is off the table with no samples and no network, so the announcer
# talks the way Banjo and the Animal Crossing villagers talk: a proper voice
# synth saying nothing at all. A glottal pulse train through three formant
# resonators is a real vowel; strings of them with a plausible pitch contour
# and consonant bursts between read as a sentence. Then it all goes down the
# tin megaphone, which is what sells 1926 more than any of the phonetics.
#
# Formant tables are the standard male-adult centres; the kids get the same
# tables with everything scaled up by a shorter vocal tract.
VOWELS = {
    "a":  ((730.0, 1090.0, 2440.0), (1.00, 0.50, 0.26)),
    "e":  ((530.0, 1840.0, 2480.0), (1.00, 0.62, 0.30)),
    "i":  ((300.0, 2300.0, 3000.0), (1.00, 0.36, 0.26)),
    "o":  ((570.0,  840.0, 2410.0), (1.00, 0.56, 0.18)),
    "u":  ((320.0,  870.0, 2240.0), (1.00, 0.42, 0.14)),
    "ae": ((660.0, 1720.0, 2410.0), (1.00, 0.58, 0.30)),
    "er": ((490.0, 1350.0, 1690.0), (1.00, 0.62, 0.34)),
}
FORMANT_BW = (72.0, 105.0, 150.0)
# (burst length, band, silent gap before it) — plosives close the mouth first,
# fricatives just hiss, and "" is a vowel starting on its own.
CONSONANTS = {
    "t":  (0.007, 3000.0, 7500.0, 0.028),
    "k":  (0.011, 1200.0, 3600.0, 0.026),
    "p":  (0.008,  400.0, 1700.0, 0.024),
    "d":  (0.006, 1800.0, 5000.0, 0.018),
    "b":  (0.007,  300.0, 1400.0, 0.016),
    "s":  (0.055, 3800.0, 9000.0, 0.004),
    "sh": (0.055, 1500.0, 4200.0, 0.004),
    "f":  (0.045, 2200.0, 6500.0, 0.004),
    "h":  (0.030,  700.0, 3000.0, 0.0),
    "":   (0.0, 0.0, 0.0, 0.0),
}


def glottal(f0, sec, jitter=0.013, shimmer=0.09):
    """Rosenberg glottal flow, differentiated (that derivative is the sharp
    closure spike that actually rings the formants). f0 may be an array."""
    n = n_of(sec)
    f0 = np.full(n, float(f0)) if np.isscalar(f0) else np.resize(f0, n)
    jit = lp(_rng.standard_normal(n), 11.0, 2)
    jit /= (np.std(jit) + 1e-9)
    ph = np.cumsum(f0 * (1.0 + jitter * jit)) / SR
    frac = ph - np.floor(ph)
    open_f, close_f = 0.62, 0.16
    flow = np.zeros(n)
    m = frac < open_f
    u = frac[m] / open_f
    flow[m] = 3.0 * u * u - 2.0 * u ** 3
    m = (frac >= open_f) & (frac < open_f + close_f)
    u = (frac[m] - open_f) / close_f
    flow[m] = 1.0 - u * u
    per = np.floor(ph).astype(np.int64)
    per -= per.min()
    flow *= 1.0 + shimmer * _rng.standard_normal(per.max() + 2)[per]
    return np.diff(flow, prepend=flow[0])


def tract(src, vowel, scale=1.0, breath=0.0):
    """Three parallel formants. scale > 1 shortens the vocal tract (a kid)."""
    fs, amps = VOWELS[vowel]
    out = np.zeros(len(src))
    for f, a, bw in zip(fs, amps, FORMANT_BW):
        out += a * resonate(src, f * scale, 1.0 / (math.pi * bw))
    if breath > 0.0:
        air = band(_rng.standard_normal(len(src)), 1200.0 * scale, 6000.0, 1)
        out += breath * air * (np.abs(out) / (np.max(np.abs(out)) + 1e-9))
    return out


def consonant(kind, scale=1.0, level=1.0):
    ln, lo, hi, gap = CONSONANTS[kind]
    pre = np.zeros(n_of(gap)) if gap > 0.0 else np.zeros(0)
    if ln <= 0.0:
        return pre
    body = band(noise(ln), lo * scale, hi * scale, 1)
    if kind in ("t", "k", "p", "d", "b"):
        body *= ad(ln, 0.0004, ln * 0.30)          # a plosive is a pop
    else:
        body *= asr(ln, ln * 0.35, ln * 0.45)      # a fricative is a hiss
    return np.concatenate([pre, body * level])


def syllable(vowel, cons, f_start, f_peak, f_end, dur, level, scale=1.0):
    """One consonant + one vowel with its own little pitch arc."""
    n = n_of(dur)
    t = np.linspace(0.0, 1.0, n)
    curve = np.where(t < 0.35,
                     f_start + (f_peak - f_start) * (t / 0.35),
                     f_peak + (f_end - f_peak) * ((t - 0.35) / 0.65))
    curve = lp(curve, 30.0, 1) + (curve[0] - lp(curve, 30.0, 1)[0])
    v = tract(glottal(curve, dur), vowel, scale, breath=0.05)
    v *= asr(dur, 0.020, 0.045, shape=1.3)
    v /= (np.max(np.abs(v)) + 1e-9)
    head = consonant(cons, scale, level * 0.55)
    return np.concatenate([head, v * level])


# per-style: base pitch, phrase declination, syllable arc, final drop, drive
STYLES = {
    "call":  (172.0, (1.14, 0.86), 0.075, 0.72, 3.0),
    "flat":  (152.0, (1.02, 0.93), 0.028, 0.88, 2.2),
    "shout": (208.0, (1.20, 1.02), 0.110, 0.62, 4.2),
    "short": (178.0, (1.10, 0.95), 0.090, 0.70, 3.0),
}
SYLL_VOWELS = ("a", "e", "o", "ae", "er", "i", "u")
SYLL_CONS = ("t", "k", "p", "d", "b", "s", "sh", "f", "h", "", "", "")


def patter(style, n_syll, v, scale=1.0, mega=True):
    """A phrase of announcer gibberish. Charm comes from restraint: mid range,
    a couple of stresses, and a real fall at the end so it reads as a sentence
    that finished rather than a stream that got cut off."""
    seed("patter", style, n_syll, v)
    base, (dec0, dec1), arc, drop, drive = STYLES[style]
    base *= float(_rng.uniform(0.94, 1.07))
    parts = []
    stress = int(_rng.integers(0, max(1, n_syll - 1)))
    for i in range(n_syll):
        c = i / max(1, n_syll - 1.0)
        line = base * (dec0 + (dec1 - dec0) * c)
        hot = 1.0 + (0.13 if i == stress else 0.0)
        last = i == n_syll - 1
        f_start = line * hot * float(_rng.uniform(0.96, 1.04))
        f_peak = f_start * (1.0 + arc * float(_rng.uniform(0.6, 1.4)))
        f_end = f_start * (drop if last else float(_rng.uniform(0.93, 1.02)))
        dur = float(_rng.uniform(0.095, 0.155)) * (1.30 if i == stress else 1.0)
        if last:
            dur *= 1.35
        lvl = (0.72 + 0.28 * float(_rng.random())) * (1.0 if i != stress else 1.15)
        parts.append(syllable(str(_rng.choice(SYLL_VOWELS)),
                              str(_rng.choice(SYLL_CONS)),
                              f_start, f_peak, f_end, dur, lvl, scale))
        if not last:
            parts.append(np.zeros(n_of(float(_rng.uniform(0.008, 0.032)))))
    out = np.concatenate(parts)
    if mega:
        out = megaphone(out, drive=drive)
        out += band(noise(len(out) / SR), 700.0, 3000.0, 1) * 0.012  # carrier hiss
        out = street(out, mix=0.13)
    else:
        out = street(lp(out, 6000.0, 1), mix=0.10)
    return finish(out, -5.0, 0.001, 0.02)


def hup(v):
    """A kid's effort blip — half a syllable, no megaphone."""
    seed("hup", v)
    f = float(_rng.uniform(255.0, 330.0))
    dur = float(_rng.uniform(0.10, 0.16))
    out = syllable(str(_rng.choice(("a", "e", "ae", "o"))),
                   str(_rng.choice(("h", "h", "t", ""))),
                   f * 1.08, f * 1.16, f * 0.80, dur, 1.0, scale=1.28)
    out = street(lp(out, 7000.0, 1), mix=0.12)
    return finish(out, -12.0, 0.001, 0.03)


# ================================================================ the gang on the kerb
# A crowd is just a lot of voices that do not agree. Every one of these is the
# same synth as the announcer with the megaphone taken off, detuned across an
# adult/kid range and scattered in time; the disagreement is the sound.
def _crowd_voice(kind, sec, f0, scale):
    n = n_of(sec)
    t = np.arange(n) / SR
    if kind == "ooh":
        curve = f0 * (0.88 + 0.22 * np.sin(math.pi * np.clip(t / sec, 0, 1) ** 0.8))
        vow_a, vow_b, mixw = "u", "o", np.clip(t / (sec * 0.55), 0.0, 1.0)
        env = asr(sec, sec * 0.34, sec * 0.42, shape=1.5)
    elif kind == "cheer":
        curve = f0 * (1.06 + 0.10 * np.sin(2.0 * math.pi * 5.4 * t + _rng.random() * 6.0)
                      - 0.18 * np.clip((t - sec * 0.5) / sec, 0.0, 1.0))
        vow_a, vow_b, mixw = "a", "e", np.clip(t / sec, 0.0, 1.0) * 0.5
        env = asr(sec, sec * 0.07, sec * 0.55, shape=1.2)
    elif kind == "groan":
        curve = f0 * (1.0 - 0.30 * np.clip(t / sec, 0.0, 1.0) ** 0.7)
        vow_a, vow_b, mixw = "o", "a", np.clip(t / (sec * 0.8), 0.0, 1.0) * 0.6
        env = asr(sec, sec * 0.18, sec * 0.5, shape=1.3)
    elif kind == "laugh":
        rate = float(_rng.uniform(4.6, 6.8))
        pulse = np.clip(np.sin(2.0 * math.pi * rate * t + _rng.random() * 6.0), 0.0, 1.0) ** 0.7
        curve = f0 * (1.02 + 0.16 * pulse - 0.12 * np.clip(t / sec, 0, 1))
        vow_a, vow_b, mixw = "a", "er", np.clip(t / sec, 0.0, 1.0) * 0.4
        env = asr(sec, sec * 0.06, sec * 0.45, shape=1.1) * (0.15 + 0.85 * pulse)
    else:                                     # murmur
        rate = float(_rng.uniform(2.6, 4.4))
        pulse = 0.35 + 0.65 * np.clip(np.sin(2.0 * math.pi * rate * t
                                             + _rng.random() * 6.0), 0.0, 1.0)
        curve = f0 * (1.0 + 0.06 * np.sin(2.0 * math.pi * rate * 0.5 * t))
        vow_a, vow_b, mixw = str(_rng.choice(("a", "e", "o", "er"))), "u", 0.35
        env = pulse * asr(sec, 0.25, 0.25, shape=1.0)
    src = glottal(curve, sec, jitter=0.02, shimmer=0.14)
    body = tract(src, vow_a, scale) * (1.0 - mixw) + tract(src, vow_b, scale) * mixw
    body /= (np.max(np.abs(body)) + 1e-9)
    return body * env


def _clap(sec=0.09):
    """Kid hands, not an arena. Kept dull on purpose — bright claps are what
    turns a crowd bed into white noise."""
    out = band(burst(sec, 0.0055, 500.0, 4200.0), 400.0, 4800.0, 1) * 1.6
    out += 0.4 * modes([980.0 * _rng.uniform(0.85, 1.2)], [0.009], [1.0], sec)
    return out


def crowd(kind):
    """ooh / cheer / bigcheer / groan / laugh — the kerb reacting."""
    seed("crowd", kind)
    # This is eleven kids on a kerb, not a ballpark: few enough voices that
    # you can still pick individuals out of it.
    spec = {
        "ooh":      (2.00, 11, -8.0, 0),
        "cheer":    (2.30, 12, -4.5, 14),
        "bigcheer": (3.20, 17, -3.0, 34),
        "groan":    (1.90, 10, -8.0, 0),
        "laugh":    (2.30, 10, -8.0, 0),
    }[kind]
    sec, n_v, peak, claps = spec
    voice_kind = "cheer" if kind == "bigcheer" else kind
    out = np.zeros(n_of(sec + 0.4))
    for i in range(n_v):
        kid = _rng.random() < 0.55
        f0 = float(_rng.uniform(210.0, 300.0)) if kid else float(_rng.uniform(105.0, 165.0))
        scale = float(_rng.uniform(1.16, 1.34)) if kid else float(_rng.uniform(0.95, 1.06))
        ln = sec * float(_rng.uniform(0.72, 1.0))
        at = float(_rng.uniform(0.0, 0.12)) * (2.5 if kind in ("ooh", "groan") else 1.0)
        v = _crowd_voice(voice_kind, ln, f0, scale)
        _wrap_add(out, v * float(_rng.uniform(0.5, 1.0)) / math.sqrt(n_v), n_of(at), False)
    if claps:
        for _ in range(claps):
            at = float(_rng.uniform(0.05, sec * 0.92))
            dens = math.exp(-abs(at - sec * 0.35) / (sec * 0.5))
            _wrap_add(out, _clap() * float(_rng.uniform(0.1, 0.5)) * dens
                      / math.sqrt(claps), n_of(at), False)
    if kind in ("cheer", "bigcheer"):          # the wordless roar underneath
        roar = band(noise(len(out) / SR), 300.0, 2200.0, 1)
        out += 0.20 * roar * asr(len(out) / SR, sec * 0.10, sec * 0.55, 1.2)
    out = lp(out, 5000.0, 2)
    out = street(out, mix=0.22, size=1.4)
    return finish(out, peak, 0.004, 0.09)


def crowd_idle(sec=6.0):
    """The bed: eleven kids on the kerb not paying attention. Seamless loop."""
    seed("crowd_idle")
    n = n_of(sec)
    out = np.zeros(n)
    for _ in range(11):
        kid = _rng.random() < 0.7
        f0 = float(_rng.uniform(200.0, 290.0)) if kid else float(_rng.uniform(100.0, 160.0))
        scale = float(_rng.uniform(1.15, 1.32)) if kid else 1.0
        ln = float(_rng.uniform(0.9, 2.2))
        at = 0.0
        while at < sec:
            v = _crowd_voice("murmur", ln, f0 * float(_rng.uniform(0.9, 1.1)), scale)
            _wrap_add(out, v * float(_rng.uniform(0.25, 0.7)) / 3.4, n_of(at), True)
            at += ln + float(_rng.uniform(0.4, 2.6))
            ln = float(_rng.uniform(0.7, 2.0))
    for _ in range(9):                          # a distant clink, a far-off horn
        at = float(_rng.uniform(0.0, sec))
        if _rng.random() < 0.5:
            g = modes([1480.0 * _rng.uniform(0.8, 1.3)], [0.05], [1.0], 0.3) * 0.05
        else:
            g = lp(modes([220.0, 330.0], [0.28, 0.2], [1.0, 0.6], 0.5), 900.0, 1) * 0.05
        _wrap_add(out, g, n_of(at), True)
    out += circular(pink(sec), lambda z: lp(z, 700.0, 1)) * 0.05   # the block humming
    out = circular(out, lambda z: street(lp(hp(z, 130.0, 1), 4200.0, 1), mix=0.30, size=1.5))
    out = out[:n]
    return finish(out, -16.0, loop=True)


# ================================================================ the band
# Period-correct means an acoustic-era dance side: stride piano, upright bass,
# brushes, and a cornet when something needs announcing. The piano is the part
# that has to be right — a sine per note would sink the whole thing — so it is
# built the way a piano works: an inharmonic partial series (stiff strings run
# sharp: f_k = k*f0*sqrt(1 + B*k^2)), higher partials dying faster than lower,
# two slightly detuned strings per note beating against each other, a hammer
# noise transient, and a null in the series where the hammer strikes.
_NOTE = {"C": 0, "C#": 1, "Db": 1, "D": 2, "D#": 3, "Eb": 3, "E": 4, "F": 5,
         "F#": 6, "Gb": 6, "G": 7, "G#": 8, "Ab": 8, "A": 9, "A#": 10,
         "Bb": 10, "B": 11}


def hz(name):
    i = 2 if name[1] in "#b" else 1
    return 440.0 * 2.0 ** ((_NOTE[name[:i]] + 12 * (int(name[i:]) - 4) - 9) / 12.0)


_piano_cache = {}


def piano(f0, sec, vel=0.8, bright=1.0):
    key = ("p", round(f0, 2), round(sec, 3), round(vel, 2), round(bright, 2))
    if key in _piano_cache:
        return _piano_cache[key]
    n = n_of(sec)
    t = np.arange(n) / SR
    B = 0.00016 + 0.00042 * (f0 / 261.6) ** 0.9      # string stiffness
    tau0 = float(np.clip(1.7 * (261.6 / f0) ** 0.45, 0.28, 1.8))
    strike = 1.0 / 8.0                                # hammer at 1/8 the string
    out = np.zeros(n)
    for k in range(1, 21):
        fk = k * f0 * math.sqrt(1.0 + B * k * k)
        if fk > 14000.0:
            break
        a = abs(math.sin(math.pi * k * strike)) / k ** 1.12
        a *= vel ** (1.0 + 0.055 * k) * bright ** (0.3 * (k - 1) / 6.0)
        tau = tau0 / (1.0 + 0.95 * (k - 1) ** 0.8)
        for det, dm in ((1.0 - 0.00035, 1.06), (1.0 + 0.00035, 0.94)):
            out += 0.5 * a * np.exp(-t / (tau * dm)) \
                * np.sin(2.0 * math.pi * fk * det * t)
    out *= np.clip(t / 0.0025, 0.0, 1.0)              # hammers are not instant
    ham = band(noise(min(sec, 0.02)), 1100.0, 7000.0, 1) \
        * ad(min(sec, 0.02), 0.0004, 0.0035)
    out[:len(ham)] += ham * 0.10 * vel
    out = lp(out, 2200.0 + 7000.0 * vel * bright, 1)
    out *= 0.55
    _piano_cache[key] = out
    return out


def upright(f0, sec, vel=0.8):
    """Pizzicato double bass: fat fundamental, quick pluck, short ring."""
    t = t_of(sec)
    out = np.zeros(len(t))
    for k in range(1, 11):
        a = vel ** (1.0 + 0.09 * k) / k ** 1.45
        tau = 0.62 / (1.0 + 0.85 * (k - 1))
        out += a * np.exp(-t / tau) * np.sin(2.0 * math.pi * k * f0 * t)
    out *= np.clip(t / 0.004, 0.0, 1.0)
    pluck = band(noise(min(sec, 0.03)), 180.0, 2600.0, 1) * ad(min(sec, 0.03), 0.0006, 0.006)
    out[:len(pluck)] += pluck * 0.35 * vel
    return lp(out, 1800.0, 1) * 0.8


def brush_swish(sec, vel=0.5):
    x = band(noise(sec), 900.0, 7000.0, 1)
    return x * asr(sec, sec * 0.42, sec * 0.5, shape=1.5) * vel * 0.5


def brush_tap(sec=0.22, vel=0.6):
    x = band(noise(sec), 260.0, 6000.0, 1) * ad(sec, 0.0008, 0.045)
    x += 0.35 * modes([182.0, 331.0], [0.05, 0.03], [1.0, 0.6], sec)
    x += 0.25 * band(noise(sec), 3000.0, 9000.0, 1) * ad(sec, 0.002, 0.09)  # wires
    return x * vel * 0.5


def cymbal(sec=0.9, vel=0.7):
    x = band(noise(sec), 2600.0, 14000.0, 1) * ad(sec, 0.0015, sec * 0.34)
    for f in (740.0, 1130.0, 1790.0, 2610.0):
        x += 0.10 * modes([f * _rng.uniform(0.97, 1.03)], [sec * 0.3], [1.0], sec)
    return x * vel * 0.35


def cornet(f0, sec, vel=0.9):
    """One brass horn, for fanfares. Bright harmonic stack, formant bump at
    1.1 kHz, and a scoop up into the note the way a cornet player leans in."""
    n = n_of(sec)
    t = np.arange(n) / SR
    vib = 1.0 + 0.004 * np.sin(2.0 * math.pi * 5.4 * t) * np.clip((t - 0.12) / 0.2, 0, 1)
    scoop = 1.0 - 0.035 * np.exp(-t / 0.028)
    ph = 2.0 * math.pi * np.cumsum(f0 * vib * scoop) / SR
    out = np.zeros(n)
    for k in range(1, 15):
        if k * f0 > 12000.0:
            break
        out += (vel ** (1.0 + 0.05 * k)) / k ** 0.95 * np.sin(k * ph)
    out *= asr(sec, 0.035, min(0.12, sec * 0.4), shape=1.2)
    out += 0.20 * resonate(out, 1100.0, 0.0022) + 0.12 * resonate(out, 2000.0, 0.0016)
    out += band(noise(sec), 1500.0, 6000.0, 1) * asr(sec, 0.03, 0.1) * 0.03 * vel
    return lp(saturate(out * 0.5, 1.6), 7000.0, 1) * 0.5


VOICE_FN = {"p": piano, "b": upright, "c": cornet}


def render_score(events, sec, bpm, wrap=True):
    """events: (beat, voice, note-or-list, beats, vel). Notes ring past their
    written length; on a loop the ring wraps round to the top, which is what
    makes a four-bar piano loop join without a seam."""
    buf = np.zeros(n_of(sec))
    spb = 60.0 / bpm
    for beat, voice, note, beats, vel in events:
        names = note if isinstance(note, (list, tuple)) else [note]
        ring = {"p": 1.0, "b": 0.6, "c": 0.25}[voice]
        ln = beats * spb + ring
        for nm in names:
            seg = VOICE_FN[voice](hz(nm), ln, vel)
            _wrap_add(buf, seg, n_of(beat * spb), wrap)
    return buf


def circular(x, fn):
    """Run an LTI chain as if the buffer were already looping, by filtering
    three copies and keeping the middle one. Without this every filter and
    reverb in the chain leaves a seam at the loop point."""
    n = len(x)
    return fn(np.tile(x, 3))[n:2 * n]


def record(x, loop=False, crack=1.0, wow_depth=0.0026):
    """Dry mix -> 1926 acoustic side: horn-band-limited, saturated, wowing,
    with shellac underneath."""
    # Level the dry mix first: the horn's saturation is meant to round the
    # peaks, not to pancake the whole take. Feeding it a mix that already
    # peaks at 3.0 flattens ten dB of dynamics into nothing.
    x = norm(x, -1.0)
    y = circular(x, gramophone) if loop else gramophone(x)
    y = wow(y, rate=0.62, depth=wow_depth, flut=6.4, fdepth=0.0005, loop=loop)
    if crack > 0.0:
        y = y + crackle(len(y) / SR, density=20.0, level=0.05 * crack, loop=loop)
    return y


def widen(x, spread=0.011, tilt=0.55, loop=False):
    """Mono -> stereo with two short decorrelating delays. Collapses cleanly
    to mono, which is where most phones will land anyway."""
    d1, d2 = n_of(spread), n_of(spread * 0.61)
    if loop:
        l = x + tilt * 0.5 * np.roll(x, d1)
        r = x + tilt * 0.5 * np.roll(x, -d2)
    else:
        l, r = x.copy(), x.copy()
        l[d1:] += tilt * 0.5 * x[:-d1]
        r[d2:] += tilt * 0.5 * x[:-d2]
    return stereo(l, r)


# -- the tunes -------------------------------------------------------------
# Ragtime in F: I - IV - V7 - I with a stride left hand (bass note on the odd
# beats, chord on the even ones) and a right hand in the 3-3-2 sixteenth
# figure that gives rag its limp.
def _stride(bar, bass_a, chord, bass_b, vel=0.70):
    """Bass note on the odd beats, chord on the even ones. The chords sit a
    long way under the melody on purpose: a stride left hand that matches the
    right hand for level turns the whole loop into one continuous block."""
    b = bar * 4.0
    return [(b + 0.0, "p", bass_a, 0.9, vel),
            (b + 1.0, "p", chord, 0.6, vel * 0.55),
            (b + 2.0, "p", bass_b, 0.9, vel * 0.92),
            (b + 3.0, "p", chord, 0.6, vel * 0.52)]


def _rag_group(start, notes, vel=0.95):
    """3-3-2 in sixteenths across two beats — the ragtime snap. The first of
    each group is the one that gets leaned on; that accent is most of what
    makes the figure swing rather than tick."""
    outs = []
    for off, ln, nm, acc in zip((0.0, 0.75, 1.5), (0.75, 0.75, 0.5), notes,
                                (1.0, 0.80, 0.88)):
        outs.append((start + off, "p", nm, ln, vel * acc))
    return outs


def music_title():
    """Title screen: four bars of stride rag, 120 bpm, joins itself."""
    seed("music_title")
    bpm, bars = 120.0, 4
    sec = bars * 4 * 60.0 / bpm                       # 8.000 s exactly
    ev = []
    ev += _stride(0, "F2", ["A3", "C4", "F4"], "C3")
    ev += _stride(1, "Bb2", ["D4", "F4", "Bb4"], "F3")
    ev += _stride(2, "C3", ["E4", "G4", "Bb4"], "G3")
    ev += _stride(3, "F2", ["A3", "C4", "F4"], "C3")
    ev += _rag_group(0.0, ("A4", "C5", "F5")) + _rag_group(2.0, ("A5", "F5", "C5"))
    ev += _rag_group(4.0, ("D5", "F5", "Bb5")) + _rag_group(6.0, ("A5", "F5", "D5"))
    ev += _rag_group(8.0, ("E5", "G5", "Bb5")) + _rag_group(10.0, ("A5", "G5", "E5"))
    ev += _rag_group(12.0, ("F5", "A5", "C6"))
    ev += [(14.0, "p", "A5", 0.5, 0.85), (14.5, "p", "G5", 0.5, 0.8),
           (15.0, "p", "F5", 0.5, 0.8), (15.5, "p", "E5", 0.5, 0.75)]
    # the upright doubles the stride bass an octave up from where a modern
    # mix would put it — an acoustic side has nothing below ~110 Hz anyway
    for bar, roots in enumerate((("F2", "C3"), ("Bb2", "F3"), ("C3", "G3"), ("F2", "C3"))):
        ev += [(bar * 4 + 0.0, "b", roots[0], 1.6, 0.60),
               (bar * 4 + 2.0, "b", roots[1], 1.6, 0.54)]
    dry = render_score(ev, sec, bpm)
    kit = np.zeros(n_of(sec))
    spb = 60.0 / bpm
    for beat in range(bars * 4):
        _wrap_add(kit, brush_swish(spb * 0.8, 0.26 if beat % 2 else 0.16),
                  n_of(beat * spb), True)
        if beat % 4 in (1, 3):
            _wrap_add(kit, brush_tap(0.22, 0.45), n_of(beat * spb), True)
    dry = dry + kit * 0.20
    dry = circular(dry, lambda y: street(y, mix=0.10))
    return finish(widen(record(dry, loop=True), loop=True), -3.0, loop=True)


def music_game():
    """Under the play: same band, half the coffee. 100 bpm, four bars."""
    seed("music_game")
    bpm, bars = 100.0, 4
    sec = bars * 4 * 60.0 / bpm                       # 9.600 s exactly
    ev = []
    prog = (("F2", ["A3", "C4", "F4"], "C3"),
            ("D2", ["F3", "A3", "D4"], "A2"),
            ("Bb1", ["D4", "F4", "Bb4"], "F2"),
            ("C2", ["E4", "G4", "Bb4"], "G2"))
    for bar, (ba, ch, bb) in enumerate(prog):
        b = bar * 4.0
        ev += [(b + 0.0, "b", ba, 1.8, 0.72), (b + 2.0, "b", bb, 1.8, 0.66)]
        ev += [(b + 1.5, "p", ch, 0.5, 0.42), (b + 3.5, "p", ch, 0.5, 0.38)]
    ev += [(14.0, "p", "C5", 0.5, 0.5), (14.75, "p", "A4", 0.5, 0.46),
           (15.5, "p", "F4", 0.5, 0.44)]
    dry = render_score(ev, sec, bpm)
    kit = np.zeros(n_of(sec))
    spb = 60.0 / bpm
    for beat in range(bars * 4):
        _wrap_add(kit, brush_swish(spb * 0.85, 0.18), n_of(beat * spb), True)
        if beat % 4 == 2:
            _wrap_add(kit, brush_tap(0.20, 0.28), n_of(beat * spb), True)
    dry = dry + kit * 0.20
    dry = circular(dry, lambda y: street(y, mix=0.12))
    return finish(widen(record(dry, loop=True, crack=0.7), loop=True), -8.0, loop=True)


def music_playball():
    """PLAY BALL — one cornet, one piano stab, one cymbal. Two and a half
    seconds, and then get out of the way."""
    seed("music_playball")
    bpm = 108.0
    spb = 60.0 / bpm
    sec = 2.5
    ev = [(0.0, "c", "F4", 0.5, 0.85), (0.5, "c", "A4", 0.5, 0.88),
          (1.0, "c", "C5", 0.5, 0.92), (1.5, "c", "F5", 2.2, 1.0),
          (1.5, "c", "A5", 2.2, 0.45),
          (0.0, "p", ["F3", "A3", "C4"], 0.5, 0.7),
          (1.5, "p", ["F3", "A4", "C5", "F5"], 2.0, 0.95),
          (0.0, "b", "F2", 1.4, 0.8), (1.5, "b", "F2", 1.6, 0.9)]
    dry = render_score(ev, sec, bpm, wrap=False)
    # the roll runs up to the downbeat of the held note and hands over to the
    # cymbal there — both in seconds, both derived from the same beat
    hit = 1.5 * spb
    roll = np.zeros(n_of(sec))
    at, step_t = 0.0, 0.055
    while at < hit:
        _wrap_add(roll, brush_tap(0.14, 0.20 + 0.5 * at / hit), n_of(at), False)
        at += step_t
        step_t = max(0.028, step_t * 0.93)
    _wrap_add(roll, cymbal(1.2, 0.8), n_of(hit), False)
    dry = dry + roll * 0.55
    dry = street(dry, mix=0.14)
    return finish(widen(record(dry, crack=0.6)), -3.0, 0.002, 0.05)


def music_gameover():
    """That's the ball game: a slow cadence, a ritard, and the lights off."""
    seed("music_gameover")
    bpm = 84.0
    sec = 3.6
    ev = [(0.0, "p", ["Bb3", "D4", "F4"], 1.0, 0.72),
          (0.0, "b", "Bb2", 1.0, 0.7),
          (1.0, "p", ["C4", "E4", "Bb4"], 1.0, 0.68),
          (1.0, "b", "C3", 1.0, 0.68),
          (2.0, "p", ["F3", "A3", "C4", "F4"], 2.0, 0.85),
          (2.0, "b", "F2", 2.0, 0.8),
          (2.0, "c", "F4", 1.6, 0.55), (2.0, "c", "C5", 1.6, 0.35)]
    dry = render_score(ev, sec, bpm, wrap=False)
    _wrap_add(dry, cymbal(1.6, 0.5), n_of(2.0 * 60.0 / bpm), False)
    dry = street(dry, mix=0.16)
    return finish(widen(record(dry, crack=0.8)), -4.0, 0.002, 0.10)


def music_cheese():
    """CHEESE IT — a chromatic scramble up the keyboard and out of the block."""
    seed("music_cheese")
    bpm = 168.0
    sec = 3.3                                         # the run is 6 beats; the
    #                                                   landing chord needs the rest
    run = ["F4", "F#4", "G4", "G#4", "A4", "A#4", "B4", "C5",
           "C#5", "D5", "D#5", "E5"]
    ev = [(i * 0.5, "p", nm, 0.5, 0.62 + 0.03 * i) for i, nm in enumerate(run)]
    ev += [(6.0, "p", ["F5", "A5", "C6"], 1.0, 0.95),
           (6.0, "b", "F2", 1.2, 0.85)]
    for i in range(0, 12, 2):
        ev.append((i * 0.5, "b", "F2" if i % 4 == 0 else "C3", 0.5, 0.55))
    dry = render_score(ev, sec, bpm, wrap=False)
    _wrap_add(dry, cymbal(1.0, 0.6), n_of(6.0 * 60.0 / bpm), False)
    dry = street(dry, mix=0.14)
    return finish(widen(record(dry, crack=0.6)), -4.0, 0.002, 0.06)


def sting_side():
    """SIDE AWAY — three notes down and a shrug. Mono: it plays over the
    action, so it belongs on the SFX bus where nothing ducks it."""
    seed("sting_side")
    bpm = 120.0
    sec = 1.4
    ev = [(0.0, "p", ["C5", "E4"], 0.5, 0.72), (0.5, "p", ["A4", "C4"], 0.5, 0.68),
          (1.0, "p", ["F4", "A3"], 1.0, 0.75), (1.0, "b", "F2", 1.0, 0.7)]
    dry = render_score(ev, sec, bpm, wrap=False)
    dry = street(dry, mix=0.14)
    return finish(record(dry, crack=0.5), -9.0, 0.002, 0.08)


# ================================================================ manifest
# (folder, name, variants, builder, loop). audio.gd's BANK mirrors this list;
# the file on disk is always <folder>/<name>_<n>.wav, even at one variant, so
# the engine side needs no special cases.
def MANIFEST():
    return [
        # -- the bat
        ("sfx", "bat_crack", 3, bat_crack, False),
        ("sfx", "bat_thud", 2, bat_thud, False),
        ("sfx", "bat_whiff", 3, bat_whiff, False),
        # -- the spaldeen
        ("sfx", "ball_bounce", 4, ball_bounce, False),
        ("sfx", "ball_mitt", 3, ball_mitt, False),
        ("sfx", "ball_brick", 2, ball_brick, False),
        ("sfx", "ball_flivver", 2, ball_flivver, False),
        ("sfx", "ball_roll", 2, ball_roll, False),
        ("sfx", "glass_smash", 2, glass_smash, False),
        # -- kids
        ("sfx", "step", 4, step, False),
        ("sfx", "slide", 2, slide, False),
        ("sfx", "catch", 2, mitt_catch, False),
        ("sfx", "hup", 3, hup, False),
        # -- the gang on the kerb
        ("sfx", "crowd_ooh", 1, lambda v: crowd("ooh"), False),
        ("sfx", "crowd_cheer", 1, lambda v: crowd("cheer"), False),
        ("sfx", "crowd_bigcheer", 1, lambda v: crowd("bigcheer"), False),
        ("sfx", "crowd_groan", 1, lambda v: crowd("groan"), False),
        ("sfx", "crowd_laugh", 1, lambda v: crowd("laugh"), False),
        ("sfx", "crowd_idle", 1, lambda v: crowd_idle(), True),
        # -- events
        ("sfx", "cop_whistle", 2, cop_whistle, False),
        ("sfx", "scatter", 1, lambda v: scatter(), False),
        ("sfx", "card_slam", 1, lambda v: card_slam(), False),
        ("sfx", "iris_in", 1, lambda v: iris(1), False),
        ("sfx", "iris_out", 1, lambda v: iris(2), False),
        ("sfx", "score_bell", 1, lambda v: score_bell(), False),
        ("sfx", "sewer_ping", 3, sewer_ping, False),
        ("sfx", "pitch_release", 2, pitch_release, False),
        ("sfx", "sting_side", 1, lambda v: sting_side(), False),
        # -- UI
        ("sfx", "ui_flip", 2, ui_flip, False),
        ("sfx", "ui_select", 1, lambda v: ui_select(), False),
        ("sfx", "ui_click", 2, ui_click, False),
        ("sfx", "ui_confirm", 1, lambda v: ui_two_note(True, "ui_confirm"), False),
        ("sfx", "ui_back", 1, lambda v: ui_two_note(False, "ui_back"), False),
        # -- the kid with the megaphone
        ("vox", "patter_short", 4, lambda v: patter("short", 1 + v % 2, v), False),
        ("vox", "patter_call", 4, lambda v: patter("call", 3 + v % 3, v), False),
        ("vox", "patter_long", 3, lambda v: patter("call", 6 + v % 3, v), False),
        ("vox", "patter_flat", 4, lambda v: patter("flat", 3 + v % 2, v), False),
        ("vox", "patter_shout", 3, lambda v: patter("shout", 2 + v % 3, v), False),
        ("vox", "patter_big", 2, lambda v: patter("shout", 6 + v, v), False),
        # -- the band
        ("music", "title", 1, lambda v: music_title(), True),
        ("music", "game", 1, lambda v: music_game(), True),
        ("music", "playball", 1, lambda v: music_playball(), False),
        ("music", "gameover", 1, lambda v: music_gameover(), False),
        ("music", "cheese", 1, lambda v: music_cheese(), False),
    ]


# ================================================================ QC
# Nothing ships without going through here. The rules are dumb on purpose:
# a sound that clips, a sound that is silent, or a loop that ticks is a bug,
# and none of them are things you should have to notice by ear.
def db(v):
    return 20.0 * math.log10(max(float(v), 1e-12))


def measure(path):
    x, sr, loop = read_wav(path)
    m = x if x.ndim == 1 else x.mean(axis=1)
    peak = float(np.max(np.abs(x))) if len(x) else 0.0
    rms = float(np.sqrt(np.mean(m * m))) if len(m) else 0.0
    d = np.abs(np.diff(m))
    tail = np.concatenate([m[-64:], m[:64]])
    wrap = float(np.max(np.abs(np.diff(tail)))) / max(float(np.percentile(d, 99.9)), 1e-9)
    return {
        "path": path, "ch": 1 if x.ndim == 1 else x.shape[1], "sr": sr,
        "sec": len(m) / float(sr), "kb": os.path.getsize(path) / 1024.0,
        "peak": db(peak), "rms": db(rms), "dc": float(np.mean(m)),
        "loop": loop, "wrap": wrap,
    }


def qc(root, verbose=True):
    rows, bad = [], []
    for folder in ("sfx", "vox", "music"):
        d = os.path.join(root, folder)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.endswith(".wav"):
                rows.append(measure(os.path.join(d, fn)))
    if verbose:
        # "wrap" is the step across the loop point measured against the file's
        # own 99.9th-percentile sample-to-sample step: under 1.0 means the join
        # is indistinguishable from ordinary signal motion.
        print("%-34s %2s %7s %7s %8s %8s %9s %6s" %
              ("file", "ch", "sec", "kB", "peak dB", "rms dB", "dc", "wrap"))
    total = 0.0
    for r in rows:
        total += r["kb"]
        flags = []
        if r["peak"] > CEIL_DB:
            flags.append("CLIP")
        if r["peak"] < -40.0:
            flags.append("SILENT")
        if abs(r["dc"]) > 2e-3:
            flags.append("DC")
        if r["loop"] and r["wrap"] > 1.5:
            flags.append("SEAM")
        if r["sr"] != SR:
            flags.append("RATE")
        if flags:
            bad.append((r["path"], flags))
        if verbose:
            rel = os.path.relpath(r["path"], root)
            print("%-34s %2d %7.3f %7.1f %8.2f %8.2f %9.6f %6s %s%s" %
                  (rel, r["ch"], r["sec"], r["kb"], r["peak"], r["rms"], r["dc"],
                   ("%.2f" % r["wrap"]) if r["loop"] else "-",
                   "LOOP " if r["loop"] else "", " ".join(flags)))
    if verbose:
        print("\n%d files, %.2f MB total" % (len(rows), total / 1024.0))
        if bad:
            print("FAILURES:")
            for p, f in bad:
                print("  %s: %s" % (os.path.relpath(p, root), ", ".join(f)))
        else:
            print("QC OK — nothing clips, nothing is silent, no loop ticks.")
    return rows, bad


# -- pictures --------------------------------------------------------------
# PIL rather than matplotlib (which is not installed, and the art pipeline
# already speaks PIL). Sepia on ink, to match everything else in the project.
_RAMP = [(24, 18, 16), (58, 40, 32), (110, 66, 44), (168, 104, 52),
         (217, 164, 65), (245, 214, 150), (255, 247, 228)]


def _ramp(v):
    v = float(np.clip(v, 0.0, 1.0)) * (len(_RAMP) - 1)
    i = int(v)
    f = v - i
    a = _RAMP[i]
    b = _RAMP[min(i + 1, len(_RAMP) - 1)]
    return tuple(int(a[c] + (b[c] - a[c]) * f) for c in range(3))


def plot(path, out_png, w=980, h=210):
    """Waveform over spectrogram, so a bad sound is visible instead of
    theoretical: a crack has a vertical wall then nothing, a bounce has one
    spike and a short pitched tail, a loop is flat across the seam."""
    from PIL import Image, ImageDraw
    x, sr, loop = read_wav(path)
    m = x if x.ndim == 1 else x.mean(axis=1)
    img = Image.new("RGB", (w, h * 2 + 26), (24, 18, 16))
    d = ImageDraw.Draw(img)
    # -- waveform: min/max per pixel column
    step = max(1, len(m) // w)
    for px in range(w):
        seg = m[px * step:(px + 1) * step]
        if len(seg) == 0:
            continue
        lo, hi = float(seg.min()), float(seg.max())
        y0 = h * 0.5 - hi * h * 0.47
        y1 = h * 0.5 - lo * h * 0.47
        d.line([(px, y0), (px, y1)], fill=(228, 98, 111))
    d.line([(0, h * 0.5), (w, h * 0.5)], fill=(78, 62, 52))
    # -- spectrogram, log frequency 40 Hz .. 16 kHz
    win, hop = 1024, max(64, len(m) // w)
    han = np.hanning(win)
    cols = max(1, (len(m) - win) // hop)
    spec = np.zeros((win // 2 + 1, cols))
    for i in range(cols):
        seg = m[i * hop:i * hop + win]
        if len(seg) < win:
            break
        spec[:, i] = np.abs(np.fft.rfft(seg * han))
    S = 20.0 * np.log10(spec + 1e-7)
    S = np.clip((S - (S.max() - 72.0)) / 72.0, 0.0, 1.0)
    fbin = np.fft.rfftfreq(win, 1.0 / sr)
    want = np.exp(np.linspace(math.log(40.0), math.log(16000.0), h))[::-1]
    px_map = np.clip(np.searchsorted(fbin, want), 1, len(fbin) - 1)
    top = h + 26
    grid = Image.new("RGB", (cols, h))
    gp = grid.load()
    for yy in range(h):
        row = S[px_map[yy]]
        for xx in range(cols):
            gp[xx, yy] = _ramp(row[xx])
    img.paste(grid.resize((w, h), Image.BILINEAR), (0, top))
    for f, lbl in ((100, "100"), (1000, "1k"), (10000, "10k")):
        yy = top + int(h * (math.log(16000.0 / f) / math.log(16000.0 / 40.0)))
        d.line([(0, yy), (w, yy)], fill=(70, 56, 48))
        d.text((4, yy - 10), lbl, fill=(168, 140, 110))
    sec = len(m) / float(sr)
    d.text((6, 4), "%s  %.3fs  %dch  peak %.1f dB%s" %
           (os.path.basename(path), sec, 1 if m.ndim == 1 else 2,
            db(np.max(np.abs(x))), "  LOOP" if loop else ""),
           fill=(239, 227, 200))
    for i in range(1, int(sec * 10) + 1):        # 100 ms ticks
        px = int(w * (i / 10.0) / sec)
        if px < w:
            d.line([(px, h - 6), (px, h)], fill=(120, 96, 78))
    img.save(out_png)
    return out_png


# ================================================================ build
def main(argv):
    args = list(argv)
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "assets", "audio")
    if "--qc" in args:
        args.remove("--qc")
        if args:
            out = args[0]
        _, bad = qc(out)
        return 1 if bad else 0
    if "--plots" in args:
        i = args.index("--plots")
        dest = args[i + 1]
        os.makedirs(dest, exist_ok=True)
        for folder in ("sfx", "vox", "music"):
            for fn in sorted(os.listdir(os.path.join(out, folder))):
                if fn.endswith(".wav"):
                    plot(os.path.join(out, folder, fn),
                         os.path.join(dest, "%s_%s.png" % (folder, fn[:-4])))
        print("plots -> %s" % dest)
        return 0
    if args:
        out = args[0]
    import time
    t0 = time.time()
    n = 0
    for folder, name, variants, fn, loop in MANIFEST():
        for v in range(1, variants + 1):
            y = fn(v)
            rel = "%s/%s_%d.wav" % (folder, name, v)
            path = os.path.join(out, folder, "%s_%d.wav" % (name, v))
            write_wav(path, y, loop)
            ensure_import(path, loop, rel)
            n += 1
        print("  %-8s %-16s x%d" % (folder, name, variants), flush=True)
    print("\n%d wavs in %.0fs -> %s\n" % (n, time.time() - t0, out))
    _, bad = qc(out)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

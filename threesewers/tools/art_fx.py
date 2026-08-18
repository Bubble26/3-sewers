#!/usr/bin/env python3
"""THREE SEWERS — impact effects.

The only VFX the game had was the street lamp's light pool, blown up and
blended additive: one soft airbrushed circle in a game where everything else
is flat colour inside a thick ink line. It read as a foreign object, it had no
direction, and it painted straight over the spaldeen for the whole hit.

So the effects here are DRAWN, not glowed. Same rules as every other module:
one ink contour lifted off the silhouette, flat cel fills, the upper-left sun.
Two habits are specific to VFX and worth keeping:

  * Impacts are HOLLOW. Every burst has a ragged hole punched through its
    middle so the ball keeps its own outline and its own pink underneath it.
    A solid flash erases the one saturated object in the game.
  * The bounce puff is COOL. Cobbles are warm brown (about 186,145,95 where
    the lamps hit them); dust drawn in cream disappears into them. These
    puffs are pulled toward slate so they separate by hue as well as value —
    the batter has to read the hop.

    python3 art_fx.py [outdir]

Authored at 2x world size like everything else (Tuning.ART = 0.5).

What comes out, and where its origin sits:

  fx_sock_0..2   3 frames, 192x192  bat on ball. Contact point = canvas
                 centre. Drawn pointing RIGHT along the swing vector, so
                 rotate the sprite to the real hit direction.
  fx_dust_0..3   4 frames, 160x112  the pitch hopping off the cobbles.
                 Impact point = (w/2, h*0.72); the puff rises out of it.
  fx_scuff       1 frame,  144x96   the mark left at the bounce. PLAN view,
                 centred, NOT pre-squashed — squash it in engine.
  fx_glass_0..2  3 frames, 192x192  the window going in. Smash point =
                 canvas centre.
  fx_ring        1 frame,  256x256  hollow shockwave, centred; scale it up
                 over the life of a big hit.

Draw them NORMAL, not additive. These are painted marks with an ink line;
BLEND_MODE_ADD washes the outline out and puts the airbrush back.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import artkit as ak  # noqa: E402
from artkit import (ASPHALT, CHALK, CLOTH, PAPER, SLATE, Canvas, mix)  # noqa: E402

S = 2  # assets are authored at 2x world size

CLEAR = (0, 0, 0, 0)  # punching a hole is the one honest use of PIL's replace


def W(*vals):
    """world units -> asset pixels."""
    if len(vals) == 1:
        return vals[0] * S
    return tuple(v * S for v in vals)


# ------------------------------------------------------------------ colours
# Struck chalk: warm, because it is lit by the same low sun as the street.
SOCK_EDGE = mix(PAPER, CLOTH["ochre"], 0.13)
SOCK_BODY = mix(PAPER, CHALK, 0.78)
SOCK_CORE = (255, 253, 247)

# Kicked dust: pulled toward slate so it does not vanish into warm cobble.
DUST_DEEP = mix(CHALK, SLATE, 0.54)
DUST_BODY = mix(CHALK, SLATE, 0.27)
DUST_CROWN = mix(CHALK, SLATE, 0.06)
GRIT = mix(CLOTH["dust"], ASPHALT, 0.34)

# Settled dust on stone: warmer than the airborne puff, it has landed.
SCUFF_BODY = mix(PAPER, CLOTH["dust"], 0.36)
SCUFF_PALE = mix(PAPER, CHALK, 0.55)
SCUFF_DARK = mix(ASPHALT, CLOTH["chocolate"], 0.45)

# Window glass: pale blue-white, low chroma — it is light, not paint.
GLASS_PALE = (230, 242, 248)
GLASS_MID = (178, 206, 222)
GLASS_DEEP = (140, 174, 196)


# ------------------------------------------------------------------ helpers
def _dir_scale(a, lo, hi, sharp=1.25):
    """Directional falloff. 1.0 along +X (the swing vector), lo behind it.

    This is what stops a burst being a symmetric circle: every radius the
    star hands out gets multiplied by it, so the shape leans into the hit.
    """
    t = (0.5 + 0.5 * math.cos(a)) ** sharp
    return lo + (hi - lo) * t


def _jitter(n, rnd, amt):
    """Per-vertex radius wobble, generated ONCE and reused by every frame so
    the burst reads as one shape growing rather than three unrelated ones."""
    return [1.0 + rnd.uniform(-amt, amt) for _ in range(n)]


def _star(cx, cy, r_in, r_out, jit, phase=0.0, lo=1.0, hi=1.0, sharp=1.25,
          rmax=None):
    """Ragged star: alternating peak/valley radii, directionally stretched.

    rmax is a hard budget — jitter times directional stretch can nearly
    double a radius, which is how a burst ends up sawn off at the canvas
    edge. Size the keys so the clamp almost never fires.
    """
    n = len(jit)
    pts = []
    for k in range(n):
        a = math.tau * k / n + phase
        r = (r_out if k % 2 == 0 else r_in) * jit[k]
        r *= _dir_scale(a, lo, hi, sharp)
        if rmax is not None:
            r = min(r, rmax)
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def _blob(cx, cy, r, phase, lobes=5, amp=0.17, squash=1.0, steps=44):
    """Cauliflower lump — a puff of smoke, not a circle."""
    pts = []
    for i in range(steps):
        a = math.tau * i / steps
        rr = r * (1.0 + amp * math.sin(lobes * a + phase)
                  + amp * 0.52 * math.sin((lobes + 3) * a - phase * 1.7))
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * squash))
    return pts


def _puff_group(c, lumps, crown=True):
    """A run of lumps drawn PASS BY PASS — every seat, then every face, then
    every crown. Drawn lump-at-a-time instead, the next lump's dark seat lands
    on the last one's lit crown and the row reads as a line of cobblestones
    rather than one rolling bank of dust."""
    for (cx, cy, r, ph, sq) in lumps:
        c.poly(_blob(cx, cy + r * 0.10, r, ph, squash=sq), fill=DUST_DEEP)
    for (cx, cy, r, ph, sq) in lumps:
        c.poly(_blob(cx - r * 0.05, cy - r * 0.06, r * 0.93, ph + 0.9,
                     squash=sq), fill=DUST_BODY)
    if crown:
        for (cx, cy, r, ph, sq) in lumps:
            c.poly(_blob(cx - r * 0.20, cy - r * 0.22, r * 0.56, ph + 2.1,
                         amp=0.13, squash=sq), fill=DUST_CROWN)


def _skirt(cx, gy, half, n, r0, squash, skip=()):
    """The bank of dust still running along the stone.

    Lumps taper AND rise toward the ends, because a row of equal lumps all
    seated on the same line gives the puff a dead-flat bottom edge and it
    reads as a plank lying in the street instead of dust.
    """
    lumps = []
    for i in range(n):
        if i in skip:
            continue
        t = -1.0 + 2.0 * i / (n - 1.0)
        r = r0 * (1.0 - 0.44 * t * t)
        lumps.append((cx + t * half, gy + 4.0 - t * t * r0 * 0.58,
                      r, (i * 2.31) % 6.28, squash))
    return lumps


def _sliver(c, x, y, ang, ln, wd, fill):
    """A flying chunk: an asymmetric kite so it reads as broken, not a leaf."""
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    nx, ny = -sa, ca
    c.poly([(x + ca * ln * 0.64, y + sa * ln * 0.64),
            (x + nx * wd * 0.52 + ca * ln * 0.04,
             y + ny * wd * 0.52 + sa * ln * 0.04),
            (x - ca * ln * 0.36, y - sa * ln * 0.36),
            (x - nx * wd * 0.44 - ca * ln * 0.08,
             y - ny * wd * 0.44 - sa * ln * 0.08)], fill=fill)


def _shard(c, x, y, ang, ln, wd, base, facet):
    """A splinter of glass: five hard corners, no two the same, plus the one
    bright facet that catches the sky. Rounded chunks read as gravel."""
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    nx, ny = -sa, ca

    def P(t, n):
        return (x + ca * ln * t + nx * wd * n, y + sa * ln * t + ny * wd * n)

    c.poly([P(0.66, 0.02), P(0.10, 0.54), P(-0.50, 0.08),
            P(-0.10, -0.34), P(0.30, -0.28)], fill=base)
    # a lit edge, not a blaze: a splinter that is all highlight is just white
    c.poly([P(0.50, 0.04), P(-0.30, -0.12), P(-0.16, -0.28),
            P(0.42, -0.20)], fill=facet)


def _fade(img, k):
    """Scale the whole alpha channel. Touches alpha ONLY — never blend an
    RGBA sprite toward a colour, that mixes alpha and paints a rectangle."""
    img = img.copy()
    img.putalpha(img.getchannel("A").point(lambda v: int(v * k)))
    return img


# ================================================================== the sock
# 11 spikes; the tables are shared by all three frames so the burst reads as
# one shape opening up, not three unrelated drawings.
_SOCK_JIT = _jitter(22, random.Random(4021), 0.20)
_SOCK_HOLE = _jitter(14, random.Random(4022), 0.24)

# per-frame: outer radius, valley fraction, hole radius, chunk step
SOCK_KEYS = ((40.0, 0.46, 13.0, 0.0),
             (55.0, 0.34, 22.0, 1.0),
             (63.0, 0.24, 34.0, 2.0))
SOCK_LO, SOCK_HI = 0.40, 1.15      # behind the hit / along the swing


def build_sock(frame):
    """96x96 world. Bat on ball: struck chalk, leaning downrange.

    Hollow from frame 0 on, so the spaldeen keeps its own ink line and its
    own pink in the middle of its own contact flash.
    """
    w = h = W(96)
    c = Canvas(w, h)
    rnd = random.Random(400 + frame)
    cx, cy = w * 0.5, h * 0.5
    rmax = w * 0.5 - 8.0
    r_out, valley, hole, chunk = SOCK_KEYS[frame]
    r_in = r_out * valley

    def star(dx, dy, fi, fo, ph=0.0):
        return _star(cx + dx, cy + dy, r_in * fi, r_out * fo, _SOCK_JIT,
                     ph, SOCK_LO, SOCK_HI, rmax=rmax)

    # the burst proper — three nested stars, each a step brighter
    c.poly(star(0, 0, 1.0, 1.0), fill=SOCK_EDGE)
    c.poly(star(-1.5, -1.5, 0.94, 0.88), fill=SOCK_BODY)
    if frame < 2:
        c.poly(star(-2.5, -2.5, 0.84, 0.60), fill=SOCK_CORE)

    # two long spikes ahead of the hit — the shape's downrange lean
    for k, (aa, ln) in enumerate(((-13.0, 1.26), (11.0, 1.15))):
        a = math.radians(aa)
        tip = min(r_out * ln * SOCK_HI, rmax)
        c.poly([(cx + math.cos(a) * tip, cy + math.sin(a) * tip),
                (cx + math.cos(a + 0.20) * r_out * 0.34,
                 cy + math.sin(a + 0.20) * r_out * 0.34),
                (cx + math.cos(a - 0.22) * r_out * 0.30,
                 cy + math.sin(a - 0.22) * r_out * 0.30)],
               fill=SOCK_BODY if k else SOCK_EDGE)

    # HOLE. Ragged, not a donut — the ball shows through its own impact.
    c.poly(_star(cx, cy, hole * 0.64, hole, _SOCK_HOLE, 0.4, 0.86, 1.10),
           fill=CLEAR)

    # chunks thrown clear, further out and smaller each frame
    for k in range((5, 7, 8)[frame]):
        a = rnd.uniform(-78, 78) + rnd.choice((0, 0, 0, 180))
        d = r_out * (1.10 + 0.24 * chunk) + rnd.uniform(-4, 12)
        d *= _dir_scale(math.radians(a), 0.55, 1.0, 1.1)
        ln = (13.0, 11.0, 8.5)[frame] * rnd.uniform(0.7, 1.35)
        d = min(d, rmax - ln * 0.7)
        _sliver(c, cx + math.cos(math.radians(a)) * d,
                cy + math.sin(math.radians(a)) * d, a, ln,
                ln * rnd.uniform(0.36, 0.58),
                SOCK_BODY if k % 2 else SOCK_EDGE)

    img = ak.finish(c, ink=3, light=True, light_strength=0.34, rim=True,
                    grain_amt=4, seed=40 + frame)
    return _fade(img, (1.0, 0.94, 0.82)[frame])


# ================================================================== the hop
# The one the whole game hangs on: nine untextured brown particles fired onto
# brown cobbles was no event at all.
#
# Lumps are (dx, dy, r, phase, squash), relative to the impact point. Airborne
# lumps rise and spread; the skirt is a separate low row that stays on the
# stone, drawn as overlapping ragged lumps rather than one long ellipse — a
# single flat blob just looks like a plank lying in the street.
DUST_KEYS = (
    [(-17, -5, 12.5, 0.4, 1.00), (13, -7, 13.5, 2.2, 1.00),
     (-2, -20, 11.0, 4.1, 0.94)],
    [(-31, -7, 13.0, 0.4, 0.96), (27, -10, 14.0, 2.2, 0.96),
     (-6, -31, 12.5, 4.1, 0.92), (16, -26, 10.0, 1.3, 0.92)],
    [(-46, -9, 12.0, 0.4, 0.94), (41, -13, 12.5, 2.2, 0.94),
     (-15, -43, 11.5, 4.1, 0.90), (24, -38, 10.5, 1.3, 0.90),
     (3, -54, 8.0, 6.0, 0.90)],
    [(-57, -11, 9.5, 0.4, 0.92), (52, -15, 10.0, 2.2, 0.92),
     (-25, -51, 9.0, 4.1, 0.88), (34, -46, 8.5, 1.3, 0.88),
     (6, -62, 6.5, 6.0, 0.88), (-9, -31, 5.5, 2.8, 0.88)],
)
# per frame: half-width, lump count, base radius, squash, lumps left out
DUST_SKIRT = ((20.0, 4, 13.0, 0.62, ()),
              (34.0, 5, 13.5, 0.58, ()),
              (48.0, 7, 13.5, 0.54, (3,)),
              (60.0, 7, 11.0, 0.50, (2, 4)))


def build_dust(frame):
    """80x56 world. The ball hopping off the cobbles — the read the batter
    has to make, so it is drawn cool and light against warm brown stone.

    Impact point is (w/2, h*0.72): the plume climbs out of it and the skirt
    spreads along the ground in front of it.
    """
    w, h = W(80, 56)
    c = Canvas(w, h)
    rnd = random.Random(700 + frame)
    cx, gy = w * 0.5, h * 0.72

    half, n, r0, sq, skip = DUST_SKIRT[frame]
    _puff_group(c, _skirt(cx, gy, half, n, r0, sq, skip), crown=False)
    _puff_group(c, [(cx + dx, gy + dy, r, ph, sq2)
                    for (dx, dy, r, ph, sq2) in DUST_KEYS[frame]])

    # grit flicked out of the seams — kept LOW and OUTSIDE the puffs, or it
    # reads as holes punched in the dust
    reach = (30.0, 45.0, 60.0, 68.0)[frame]
    for _ in range((7, 8, 9, 7)[frame]):
        x = cx + rnd.choice((-1, 1)) * reach * rnd.uniform(1.14, 1.40)
        y = gy + rnd.uniform(-6.0, 9.0)
        if not (6 < x < w - 6 and 6 < y < h - 6):
            continue
        c.circle(x, y, rnd.uniform(1.4, 2.6),
                 fill=GRIT if rnd.random() < 0.4 else DUST_BODY)

    img = ak.finish(c, ink=3, light=True, light_strength=0.46, rim=True,
                    grain_amt=5, seed=70 + frame)
    return _fade(img, (1.0, 0.96, 0.88, 0.74)[frame])


def build_scuff():
    """72x48 world. The mark the hop leaves behind on the stone.

    Drawn in PLAN view — no perspective baked in — because the engine
    squashes ground decals itself. Long axis is the direction of travel.
    Broken into overlapping streaks with gaps so the cobbles read through it:
    a solid lozenge of cream just looks like spilt paint.
    """
    w, h = W(72, 48)
    c = Canvas(w, h)
    rnd = random.Random(913)
    cx, cy = w * 0.5, h * 0.5

    # the smear — dust shoved off the stone, thickest where the ball landed
    for (dx, dy, r, ph, sq) in ((-44, -1.0, 15.0, 1.1, 0.50),
                                (-24, 2.5, 21.0, 3.0, 0.50),
                                (-2, -1.5, 25.0, 5.2, 0.54),
                                (22, 2.0, 22.0, 2.4, 0.50),
                                (44, -1.5, 16.0, 4.6, 0.46)):
        c.poly(_blob(cx + dx, cy + dy, r, ph, lobes=6, amp=0.28, squash=sq),
               fill=SCUFF_BODY)
    for (dx, dy, r, ph, sq) in ((-33, -3.0, 11.0, 4.4, 0.44),
                                (-9, -4.0, 17.0, 0.3, 0.44),
                                (16, -3.5, 14.0, 5.9, 0.42),
                                (37, 1.0, 9.0, 1.6, 0.42)):
        c.poly(_blob(cx + dx, cy + dy, r, ph, lobes=6, amp=0.26, squash=sq),
               fill=SCUFF_PALE)

    # two short scrapes of bare stone dragged clear of its dust film
    for (dx, dy, r, ph, sq) in ((-10, 3.0, 14.0, 2.7, 0.20),
                                (20, -0.5, 9.0, 5.0, 0.20)):
        c.poly(_blob(cx + dx, cy + dy, r, ph, lobes=7, amp=0.32, squash=sq),
               fill=SCUFF_DARK)

    # flecks kicked clear. Kept fat on purpose — a 1px chip is all ink line
    # once the outline pass has been round it.
    for _ in range(11):
        x = cx + rnd.uniform(-1.0, 1.0) * 60
        y = cy + rnd.uniform(-1.0, 1.0) * 22
        if abs(x - cx) < 26 and abs(y - cy) < 11:
            continue
        c.poly(_blob(x, y, rnd.uniform(2.6, 4.4), rnd.uniform(0, 6),
                     lobes=5, amp=0.13, squash=rnd.uniform(0.60, 0.88)),
               fill=SCUFF_PALE if rnd.random() < 0.62 else GRIT)

    img = ak.finish(c, ink=2, light=True, light_strength=0.30, rim=False,
                    grain_amt=6, seed=91)
    return _fade(img, 0.90)


# ================================================================== the pane
def _shard_table(seed, count):
    """One flight plan per splinter, evaluated at each frame, so the same
    glass keeps travelling instead of being re-diced every frame."""
    rnd = random.Random(seed)
    out = []
    for k in range(count):
        # stratified angles: pure rnd.uniform leaves bald patches in the ring
        out.append({
            "a": 360.0 * k / count + rnd.uniform(-9.0, 9.0),
            "v": rnd.uniform(0.70, 1.20),
            "ln": rnd.uniform(19.0, 38.0),
            "wd": rnd.uniform(0.20, 0.40),
            "spin": rnd.uniform(-60, 60),
            "tilt": rnd.uniform(-34, 34),
            "tone": rnd.random(),
            "skew": rnd.uniform(0.62, 1.0),
        })
    return out


_GLASS = _shard_table(5150, 17)

# per-frame: ring radius, shard scale, travel time
GLASS_KEYS = ((20.0, 1.00, 0.0), (46.0, 0.90, 1.0), (68.0, 0.74, 2.0))


def build_glass(frame):
    """96x96 world. The window going in: long angular slivers, no soft edges."""
    w = h = W(96)
    c = Canvas(w, h)
    rnd = random.Random(300 + frame)
    cx, cy = w * 0.5, h * 0.5
    ring, sz, t = GLASS_KEYS[frame]
    lim = w * 0.5 - 8.0

    if frame == 0:
        # the pane letting go: a ragged pale hole where the ball went through
        c.poly(_star(cx, cy, 10.0, 22.0, _jitter(16, random.Random(11), 0.30),
                     0.3), fill=GLASS_PALE)
        c.poly(_star(cx, cy, 5.0, 12.0, _jitter(16, random.Random(12), 0.30),
                     0.9), fill=CLEAR)

    for s_ in _GLASS:
        a = s_["a"] + s_["spin"] * t * 0.10   # keep the ring even as it opens
        ln = s_["ln"] * sz
        d = min(ring * s_["v"], lim - ln * 0.7)
        x = cx + math.cos(math.radians(a)) * d
        y = cy + math.sin(math.radians(a)) * d * s_["skew"]
        ang = a + s_["tilt"] + s_["spin"] * t
        _shard(c, x, y, ang, ln, ln * s_["wd"],
               GLASS_MID if s_["tone"] < 0.55 else GLASS_DEEP, GLASS_PALE)

    # dust of glass — the bits too small to be splinters
    for _ in range((7, 10, 12)[frame]):
        a = rnd.uniform(0, math.tau)
        d = min(ring * rnd.uniform(0.80, 1.45), lim - 4)
        x, y = cx + math.cos(a) * d, cy + math.sin(a) * d * 0.85
        c.circle(x, y, rnd.uniform(1.3, 2.6),
                 fill=GLASS_PALE if rnd.random() < 0.6 else GLASS_MID)

    img = ak.finish(c, ink=3, light=True, light_strength=0.48, rim=True,
                    grain_amt=3, seed=51 + frame)
    return _fade(img, (1.0, 0.95, 0.82)[frame])


# ================================================================== the wave
def build_ring():
    """128x128 world. One hollow shockwave the engine scales up on big hits.

    Hand-drawn, so it is neither quite round nor an even weight: the line
    thickens on the lower right, away from the sun, like an inked stroke.
    """
    w = h = W(128)
    c = Canvas(w, h)
    rnd = random.Random(6600)
    cx, cy = w * 0.5, h * 0.5
    R = w * 0.40
    band = 8.0

    def ring_pts(k):
        pts = []
        for i in range(180):
            a = math.tau * i / 180
            wob = (1.0 + 0.030 * math.sin(3 * a + 0.7)
                   + 0.017 * math.sin(7 * a - 1.9))
            b = band * (0.72 + 0.56 * (0.5 + 0.5 * math.cos(a - 2.4)))
            pts.append((cx + math.cos(a) * (R * wob + b * k),
                        cy + math.sin(a) * (R * wob + b * k)))
        return pts

    c.poly(ring_pts(0.5), fill=SOCK_EDGE)
    c.poly(ring_pts(0.14), fill=SOCK_BODY)
    c.poly(ring_pts(-0.5), fill=CLEAR)

    # dashes riding just outside the wave so it reads as travelling, not drawn
    for k in range(7):
        a = 360.0 * k / 7.0 + rnd.uniform(-16.0, 16.0)
        ln = rnd.uniform(6.0, 10.0)
        d = min(R + band * rnd.uniform(1.5, 2.4), w * 0.5 - 6.0 - ln * 0.7)
        _sliver(c, cx + math.cos(math.radians(a)) * d,
                cy + math.sin(math.radians(a)) * d, a, ln,
                rnd.uniform(2.6, 4.2), SOCK_BODY)

    return ak.finish(c, ink=2, light=True, light_strength=0.46, rim=True,
                     grain_amt=3, seed=66)


# ================================================================== registry
FRAMES = {"fx_sock": 3, "fx_dust": 4, "fx_glass": 3}
BUILDERS = {
    "fx_sock": build_sock,
    "fx_dust": build_dust,
    "fx_glass": build_glass,
    "fx_scuff": build_scuff,
    "fx_ring": build_ring,
}

# world sizes, for sanity-checking the output
WORLD = {
    "fx_sock": (96, 96), "fx_dust": (80, 56), "fx_scuff": (72, 48),
    "fx_glass": (96, 96), "fx_ring": (128, 128),
}


def build(outdir, only=None):
    """Render every effect into outdir. Returns {filename: (w, h)}."""
    os.makedirs(outdir, exist_ok=True)
    made = {}
    for name, fn in BUILDERS.items():
        if only and name not in only:
            continue
        want = W(*WORLD[name])
        n = FRAMES.get(name, 0)
        for i in range(max(1, n)):
            img = fn(i) if n else fn()
            if img.size != want:
                raise AssertionError("%s is %s, expected %s"
                                     % (name, img.size, want))
            fname = "%s_%d" % (name, i) if n else name
            ak.save(img, os.path.join(outdir, fname + ".png"))
            made[fname] = img.size
    return made


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/art_fx"
    sel = sys.argv[2:] or None
    for k, v in sorted(build(out, sel).items()):
        print("%-18s %dx%d" % (k, v[0], v[1]))

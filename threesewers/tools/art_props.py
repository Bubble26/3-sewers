#!/usr/bin/env python3
"""THREE SEWERS — street props, bases and seamless tiles.

Everything here is authored at 2x world size (retina) and pushed through
artkit.finish() so the props carry the same ink line and the same upper-left
sun as the kids. The only saturated thing in this file — in the whole game —
is the spaldeen's pink.

    python3 art_props.py [outdir]

Tiles (brick / asphalt / sidewalk / curb / cornice) are drawn on a torus:
every primitive is replayed at the wrapping offsets so the tile has no seam.
They skip the ink pass and the cel-light pass on purpose — a silhouette
outline or a corner-to-corner light ramp is exactly what makes a tile show
its grid. Their light is painted in by hand instead, same sun.
"""
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import artkit as ak  # noqa: E402
from artkit import (ASPHALT, ASPHALT_D, ASPHALT_L, BRICK, BRICK_D, BRICK_L,  # noqa: E402
                    BROWNSTONE, CHALK, CLOTH, GOLD, INK, IRON,
                    PAPER, PATINA, PINK, PINK_L, RUST, SLATE, Canvas, mix,
                    shade)

S = 2  # assets are authored at 2x world size

# ------------------------------------------------------------------ helpers


def W(*vals):
    """world units -> asset pixels."""
    if len(vals) == 1:
        return vals[0] * S
    return tuple(v * S for v in vals)


def epoint(cx, cy, rx, ry, ang):
    a = math.radians(ang)
    return (cx + rx * math.cos(a), cy + ry * math.sin(a))


def earc(cx, cy, rx, ry, a0, a1, steps=24):
    return [epoint(cx, cy, rx, ry, a0 + (a1 - a0) * i / steps)
            for i in range(steps + 1)]


def wobble(pts, rnd, amt=1.2):
    return [(x + rnd.uniform(-amt, amt), y + rnd.uniform(-amt, amt))
            for x, y in pts]


def jitter_path(p0, p1, rnd, segs=8, amt=3.0):
    """A hand-drawn wandering line between two points."""
    out = []
    for i in range(segs + 1):
        t = i / segs
        x = p0[0] + (p1[0] - p0[0]) * t
        y = p0[1] + (p1[1] - p0[1]) * t
        if 0 < i < segs:
            x += rnd.uniform(-amt, amt)
            y += rnd.uniform(-amt, amt)
        out.append((x, y))
    return out


def sit(img, cx, cy, rx, ry, alpha=0.34, blur=5):
    """Bake a tight contact shadow under a standing prop so it doesn't float."""
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry],
              fill=(24, 18, 14, int(255 * alpha)))
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(sh)
    out.alpha_composite(img)
    return out


def soft_glow(img, cx, cy, rx, ry, color, alpha=0.30, blur=9, under=False):
    """Muted halo (lamp light). Composited after finish so the ink pass never
    outlines it and the cel pass never darkens it."""
    g = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    for i, k in enumerate((1.0, 0.66, 0.38)):
        a = int(255 * alpha * (0.42 + 0.29 * i))
        d.ellipse([cx - rx * k, cy - ry * k, cx + rx * k, cy + ry * k],
                  fill=color + (a,))
    g = g.filter(ImageFilter.GaussianBlur(blur))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    if under:
        out.alpha_composite(g)
        out.alpha_composite(img)
    else:
        out.alpha_composite(img)
        out.alpha_composite(g)
    return out


def wrap_blur(img, radius):
    """Gaussian blur that wraps around the tile edges (blur a 3x3 lay-up and
    crop the middle) so soft passes never introduce a seam."""
    w, h = img.size
    big = Image.new("RGBA", (w * 3, h * 3), (0, 0, 0, 0))
    for i in range(3):
        for j in range(3):
            big.alpha_composite(img, (i * w, j * h))
    big = big.filter(ImageFilter.GaussianBlur(radius))
    return big.crop((w, h, w * 2, h * 2))


class Tile:
    """A Canvas that draws on a torus: each primitive is replayed at the
    wrapping offsets it actually touches, so the tile is seamless."""

    def __init__(self, w, h, wrap_x=True, wrap_y=True, ss=ak.SS):
        self.c = Canvas(w, h, ss)
        self.w = w
        self.h = h
        self.wx = wrap_x
        self.wy = wrap_y

    def _offs(self, bbox):
        xs = [0] + ([-self.w, self.w] if self.wx else [])
        ys = [0] + ([-self.h, self.h] if self.wy else [])
        x0, y0, x1, y1 = bbox
        out = []
        for dx in xs:
            for dy in ys:
                if x1 + dx < -3 or x0 + dx > self.w + 3:
                    continue
                if y1 + dy < -3 or y0 + dy > self.h + 3:
                    continue
                out.append((dx, dy))
        return out

    @staticmethod
    def _bb(pts, pad=0):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)

    def rect(self, box, **kw):
        for dx, dy in self._offs(box):
            self.c.rect([box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy], **kw)

    def rrect(self, box, r, **kw):
        for dx, dy in self._offs(box):
            self.c.rrect([box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy],
                         r, **kw)

    def ellipse(self, box, **kw):
        for dx, dy in self._offs(box):
            self.c.ellipse([box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy],
                           **kw)

    def circle(self, cx, cy, r, **kw):
        self.ellipse([cx - r, cy - r, cx + r, cy + r], **kw)

    def poly(self, pts, **kw):
        for dx, dy in self._offs(self._bb(pts)):
            self.c.poly([(x + dx, y + dy) for x, y in pts], **kw)

    def line(self, pts, fill, width, joint="curve"):
        for dx, dy in self._offs(self._bb(pts, width)):
            self.c.line([(x + dx, y + dy) for x, y in pts], fill, width, joint)

    def speck(self, n, rnd, colors, rmin=0.7, rmax=2.2, box=None):
        x0, y0, x1, y1 = box or (0, 0, self.w, self.h)
        for _ in range(n):
            self.circle(rnd.uniform(x0, x1), rnd.uniform(y0, y1),
                        rnd.uniform(rmin, rmax), fill=rnd.choice(colors))


# ------------------------------------------------------------------ colors
LACQUER = (46, 44, 46)          # model T black, kept off pure black
LACQUER_L = (82, 80, 82)
BRASS = mix(GOLD, ASPHALT, 0.34)
GALV = shade(mix(SLATE, CLOTH["grey"], 0.5), 0.88)
STONE = mix(BROWNSTONE, PAPER, 0.30)
CONCRETE = mix(ASPHALT_L, PAPER, 0.34)
IRON_L = mix(IRON, SLATE, 0.45)
GLASS = (34, 32, 36)
WOOD = mix(CLOTH["oat"], BROWNSTONE, 0.42)
SPOKE = mix(WOOD, LACQUER, 0.40)   # artillery wheel, dulled so the car stays dark


# ================================================================== the ball
def build_spaldeen():
    """24x24 world. The only saturated object in the game."""
    w, h = W(24, 24)
    c = Canvas(w, h)
    cx, cy, r = w * 0.5, h * 0.5, w * 0.38
    # A spaldeen is PINK, not crimson: keep the lit two-thirds high and rosy and
    # let the terminator stay chromatic instead of sliding to maroon.
    deep = mix(PINK, (128, 54, 72), 0.30)
    c.circle(cx, cy, r, fill=deep)
    c.circle(cx - r * 0.08, cy - r * 0.09, r * 0.95, fill=PINK)
    c.circle(cx - r * 0.17, cy - r * 0.18, r * 0.84,
             fill=mix(PINK, PINK_L, 0.34))
    c.circle(cx - r * 0.27, cy - r * 0.29, r * 0.62,
             fill=mix(PINK, PINK_L, 0.72))
    # kick highlight
    c.ellipse([cx - r * 0.70, cy - r * 0.74, cx - r * 0.14, cy - r * 0.26],
              fill=mix(PINK_L, (255, 250, 248), 0.55))
    c.ellipse([cx - r * 0.60, cy - r * 0.64, cx - r * 0.30, cy - r * 0.42],
              fill=(255, 252, 250))
    # bounce light on the shadow rim keeps the ball round, not flat
    for a in range(20, 110, 6):
        p = epoint(cx, cy, r * 0.90, r * 0.90, a)
        c.circle(p[0], p[1], r * 0.075, fill=mix(deep, PINK_L, 0.40))
    img = ak.finish(c, ink=3, light=True, light_strength=0.42, grain_amt=3, seed=7)
    return img


# ================================================================== bases
def build_manhole():
    """140x64 world. Home plate: a cast-iron cover set into the asphalt."""
    w, h = W(140, 64)
    c = Canvas(w, h)
    rnd = random.Random(11)
    cx, cy = w * 0.5, h * 0.50
    rx, ry = w * 0.452, h * 0.40

    # Cast iron has to sit ABOVE the asphalt in value or the whole base reads
    # as a hole in the street. Groove = near-black, raised cell = mid grey.
    groove = shade(IRON, 0.55)
    iron_m = mix(IRON, ASPHALT_L, 0.70)
    iron_l = mix(IRON, ASPHALT_L, 1.02)
    iron_ll = mix(iron_l, CHALK, 0.22)

    # the recess it sits in
    c.ellipse([cx - rx - 4, cy - ry - 3, cx + rx + 4, cy + ry + 4],
              fill=shade(ASPHALT_D, 0.80))
    # worn outer rim
    c.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=shade(iron_m, 0.72))
    c.ellipse([cx - rx, cy - ry - 2, cx + rx, cy + ry - 2], fill=iron_l)
    # cover face
    frx, fry = rx * 0.90, ry * 0.86
    c.ellipse([cx - frx, cy - fry, cx + frx, cy + fry], fill=groove)

    # foundry waffle: raised cells in concentric rings, cut by dark grooves
    rings = [(0.40, 0.64, 14), (0.67, 0.86, 20), (0.89, 1.0, 26)]
    for r0, r1, n in rings:
        for k in range(n):
            a0 = 360.0 * k / n + 3.0
            a1 = 360.0 * (k + 1) / n - 3.0
            i0, i1 = r0 + 0.03, r1 - 0.03
            outer = earc(cx, cy, frx * i1, fry * i1, a0, a1, 5)
            inner = earc(cx, cy, frx * i0, fry * i0, a1, a0, 5)
            cell = outer + inner
            base = mix(iron_m, iron_l, rnd.uniform(0.4, 1.0))
            c.poly(cell, fill=shade(base, 0.70))
            up = [(x - 1.4, y - 1.6) for x, y in cell]
            c.poly(up, fill=base)
            top = [(x - 2.2, y - 2.6) for x, y in cell]
            c.poly(top[:6], fill=shade(base, 1.16))
    # centre band carries the foundry name
    c.ellipse([cx - frx * 0.40, cy - fry * 0.40, cx + frx * 0.40, cy + fry * 0.40],
              fill=shade(iron_m, 0.60))
    c.ellipse([cx - frx * 0.37, cy - fry * 0.40, cx + frx * 0.37, cy + fry * 0.30],
              fill=iron_l)
    f = ak.font("serif_bold", int(7.5 * S * c.ss))
    c.text((cx, cy - 2), "SEWER", f, shade(iron_m, 0.55))
    c.text((cx, cy - 3), "SEWER", f, iron_ll)
    # pick holes, out on the mid ring where they can't collide with the text
    for sx in (-1, 1):
        px = cx + sx * frx * 0.76
        c.ellipse([px - 7, cy - 4.5, px + 7, cy + 4.5], fill=shade(IRON, 0.40))
        c.ellipse([px - 7, cy - 5.5, px + 7, cy + 2.0], fill=shade(IRON, 0.70))
    # polished wear where the kids stand
    for _ in range(11):
        a = rnd.uniform(150, 300)
        rr = rnd.uniform(0.15, 0.8)
        p = epoint(cx, cy, frx * rr, fry * rr, a)
        c.ellipse([p[0] - rnd.uniform(5, 13), p[1] - 2,
                   p[0] + rnd.uniform(5, 13), p[1] + 2], fill=iron_ll)
    img = ak.finish(c, ink=3, light=True, light_strength=0.8, grain_amt=6, seed=3)
    return img


def build_sewer():
    """120x52 world. Slotted cover, sunk a little into the street."""
    w, h = W(120, 52)
    c = Canvas(w, h)
    rnd = random.Random(23)
    cx, cy = w * 0.5, h * 0.50
    rx, ry = w * 0.445, h * 0.39
    iron_m = mix(IRON, ASPHALT_L, 0.68)
    iron_l = mix(IRON, ASPHALT_L, 1.00)

    c.ellipse([cx - rx - 5, cy - ry - 4, cx + rx + 5, cy + ry + 5],
              fill=shade(ASPHALT_D, 0.74))
    c.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=shade(iron_m, 0.70))
    c.ellipse([cx - rx, cy - ry - 2, cx + rx, cy + ry - 3], fill=iron_l)
    frx, fry = rx * 0.88, ry * 0.82
    c.ellipse([cx - frx, cy - fry, cx + frx, cy + fry], fill=shade(iron_m, 0.62))
    c.ellipse([cx - frx, cy - fry + 2, cx + frx, cy + fry], fill=iron_m)
    # the grate frame reads as bar-and-slot only if the BARS are the light part
    for i in range(8):
        t = (i + 0.5) / 8
        by = cy - fry * 0.88 + fry * 1.76 * t
        k = 1.0 - ((by - cy) / (fry * 1.04)) ** 2
        if k <= 0.02:
            continue
        hw = frx * 0.90 * math.sqrt(k)
        c.rrect([cx - hw, by - 3.4, cx + hw, by + 2.6], 2.6,
                fill=mix(iron_l, CHALK, 0.10))

    # slots — near-black voids between the lit bars
    n = 7
    for i in range(n):
        t = (i + 0.5) / n
        sy = cy - fry * 0.82 + fry * 1.64 * t
        k = 1.0 - ((sy - cy) / (fry * 1.02)) ** 2
        if k <= 0.02:
            continue
        hw = frx * 0.86 * math.sqrt(k)
        c.rrect([cx - hw, sy - 3.6, cx + hw, sy + 3.6], 3.4,
                fill=shade(IRON, 0.26))
        c.rrect([cx - hw + 2, sy + 1.6, cx + hw - 2, sy + 3.4], 1.6,
                fill=shade(iron_m, 0.80))
    # rim bolts
    for k in range(10):
        a = 360.0 * k / 10 + 18
        p = epoint(cx, cy, rx * 0.94, ry * 0.94, a)
        c.circle(p[0], p[1], 2.6, fill=shade(iron_m, 0.66))
        c.circle(p[0] - 0.6, p[1] - 0.7, 1.9, fill=mix(iron_l, CHALK, 0.20))
    # the near lip casts into the pit
    c.poly(earc(cx, cy, frx, fry, 190, 350, 22)
           + earc(cx, cy, frx * 0.96, fry * 0.80, 350, 190, 22),
           fill=shade(iron_m, 0.56))
    # grime in the recess, not water droplets scattered over the cover
    for _ in range(30):
        a = rnd.uniform(0, 360)
        rr = 0.90 + math.sqrt(rnd.random()) * 0.12
        p = epoint(cx, cy, rx * rr, ry * rr, a)
        c.circle(p[0], p[1], rnd.uniform(0.7, 1.6),
                 fill=rnd.choice([shade(iron_m, 0.72), iron_l]))
    img = ak.finish(c, ink=3, light=True, light_strength=0.8, grain_amt=6, seed=4)
    return img


def build_hydrant():
    """64x96 world. Third base. Squat, chunky, chipped."""
    w, h = W(64, 96)
    c = Canvas(w, h)
    rnd = random.Random(31)
    cx = w * 0.5
    ground = h - 7

    # Weathered municipal verdigris, pulled well down in chroma: at 64x96 world
    # this is a big object, and full PATINA made it the loudest thing on the
    # street after the ball.
    base = mix(PATINA, ASPHALT, 0.34)
    body = base
    body_d = shade(base, 0.68)
    body_dd = shade(base, 0.50)
    body_l = mix(base, CHALK, 0.26)
    chip = mix(shade(RUST, 0.80), ASPHALT, 0.30)

    # foot flange
    c.ellipse([cx - 40, ground - 20, cx + 40, ground + 2], fill=body_dd)
    c.rrect([cx - 38, ground - 26, cx + 38, ground - 6], 7, fill=body_d)
    c.rrect([cx - 38, ground - 28, cx + 26, ground - 12], 7, fill=body)
    c.rrect([cx - 33, ground - 25, cx - 12, ground - 15], 4, fill=body_l)
    # barrel
    c.rrect([cx - 31, 74, cx + 31, ground - 18], 13, fill=body_d)
    c.rrect([cx - 31, 74, cx + 12, ground - 20], 13, fill=body)
    c.rrect([cx - 26, 80, cx - 8, ground - 26], 9, fill=body_l)
    # mid collar
    c.rrect([cx - 38, 62, cx + 38, 84], 8, fill=body_d)
    c.rrect([cx - 38, 60, cx + 20, 78], 8, fill=body)
    c.rrect([cx - 33, 64, cx - 12, 73], 4, fill=body_l)
    # bonnet
    c.ellipse([cx - 34, 22, cx + 34, 74], fill=body_d)
    c.ellipse([cx - 34, 18, cx + 16, 66], fill=body)
    c.ellipse([cx - 27, 24, cx - 4, 48], fill=body_l)
    c.rrect([cx - 36, 52, cx + 36, 68], 6, fill=body_d)
    c.rrect([cx - 36, 50, cx + 18, 62], 6, fill=body)
    # top nut
    c.poly([(cx - 14, 30), (cx + 14, 30), (cx + 10, 13), (cx - 10, 13)], fill=body_d)
    c.poly([(cx - 14, 30), (cx + 2, 30), (cx + 1, 13), (cx - 10, 13)], fill=body)
    c.ellipse([cx - 14, 8, cx + 14, 20], fill=body_d)
    c.ellipse([cx - 14, 6, cx + 6, 17], fill=body_l)

    # side nozzle + cap
    c.rrect([cx + 22, 96, cx + 46, 126], 6, fill=body_d)
    c.rrect([cx + 22, 94, cx + 42, 116], 6, fill=body)
    c.ellipse([cx + 38, 92, cx + 56, 128], fill=body_dd)
    c.ellipse([cx + 38, 90, cx + 52, 120], fill=body)
    c.ellipse([cx + 40, 94, cx + 46, 106], fill=body_l)
    for k in range(5):
        p = epoint(cx + 46, 108, 6, 13, 72 * k - 20)
        c.circle(p[0], p[1], 1.8, fill=body_dd)
    # front nozzle — small, low, and capped. A big pale disc in the middle of
    # the barrel turns the hydrant into a face.
    c.ellipse([cx - 17, 108, cx + 5, 130], fill=body_dd)
    c.ellipse([cx - 15, 106, cx + 3, 124], fill=body_d)
    c.ellipse([cx - 13, 108, cx + 1, 122], fill=body)
    c.ellipse([cx - 11, 110, cx - 3, 117], fill=body_l)
    for k in range(5):
        pnt = epoint(cx - 6, 115, 9, 9, 72 * k + 20)
        c.circle(pnt[0], pnt[1], 1.3, fill=shade(body_dd, 0.85))

    # chain: dark links drooping from the bonnet collar to the nozzle cap.
    # It has to be DARKER than the hydrant — a pale strap across the body read
    # like a thermometer taped to it.
    link_d = shade(IRON, 0.72)
    link_l = mix(IRON, SLATE, 0.55)
    ca, cb = (cx + 30, 58), (cx + 49, 92)
    pts = []
    for i in range(5):
        t = i / 4.0
        x = ca[0] + (cb[0] - ca[0]) * t + 8 * math.sin(math.pi * t)
        y = ca[1] + (cb[1] - ca[1]) * t + 8 * math.sin(math.pi * t)
        pts.append((x, y))
    for i, (px, py) in enumerate(pts):
        box = ([px - 5.0, py - 3.4, px + 5.0, py + 3.4] if i % 2 else
               [px - 3.4, py - 5.0, px + 3.4, py + 5.0])
        c.ellipse(box, fill=link_d)
        inner = [box[0] + 2.0, box[1] + 2.0, box[2] - 2.0, box[3] - 2.0]
        c.ellipse(inner, fill=body_dd)
        c.circle(box[0] + 2.6, box[1] + 2.4, 1.0, fill=link_l)
    # the lug it hangs from
    c.circle(ca[0], ca[1] - 3, 4.4, fill=link_d)
    c.circle(ca[0], ca[1] - 3, 2.0, fill=body_dd)

    # chipped paint: bare metal shows where the casting turns an edge and down
    # low where boots and fenders hit it — never as spots in the middle
    edges = [(cx - 28, 88), (cx - 30, ground - 30), (cx + 27, 96),
             (cx - 24, ground - 22), (cx + 20, ground - 20), (cx - 31, 70),
             (cx + 30, 78), (cx - 12, ground - 12), (cx + 8, ground - 16),
             (cx - 30, 46), (cx + 26, 40)]
    for (ex, ey) in edges:
        r = rnd.uniform(1.6, 3.2)
        pts = [epoint(ex + rnd.uniform(-3, 3), ey + rnd.uniform(-5, 5),
                      r * rnd.uniform(0.5, 1.2), r * rnd.uniform(0.8, 1.8), a)
               for a in range(0, 360, 72)]
        c.poly(pts, fill=body_dd)
        c.poly([(x + 0.8, y + 0.8) for x, y in pts],
               fill=chip if rnd.random() < 0.7 else shade(GALV, 0.86))

    img = ak.finish(c, ink=3, light=True, light_strength=0.9, grain_amt=6, seed=5)
    return sit(img, cx, ground + 2, 36, 9, 0.34, 5)


def build_stoop():
    """150x110 world. First base: a brownstone stoop.

    Three-quarter view from the street: the flight climbs to the right and
    away, the near riser faces are dark, and one bright nosing band per step is
    what makes the thing read as stone stairs at 150px wide. The building it
    belongs to is only a sliver of doorway at the top right — this is a base a
    kid runs to, so the STAIRS have to own the frame.
    """
    w, h = W(150, 110)
    c = Canvas(w, h)
    rnd = random.Random(41)
    ground = h - 12

    # Warm brownstone, lifted well clear of the sooty brick tile it stands
    # against — at the same value the whole stoop dissolves into the wall.
    st = mix(mix(BROWNSTONE, RUST, 0.12), PAPER, 0.17)
    st_l = mix(st, PAPER, 0.30)      # tread top
    st_ll = mix(st, PAPER, 0.54)     # nosing in full sun
    st_d = shade(st, 0.76)           # riser face
    st_dd = shade(st, 0.54)          # under the nosing
    void = shade(st, 0.26)

    n = 4
    rise = 34
    run = 44
    skew = 13
    x0 = 22
    top_y = ground - n * rise
    land_x = x0 + n * run

    # ---- doorway sliver, the only bit of building in frame
    c.rect([land_x + 6, 10, w - 8, top_y - 2], fill=shade(st, 0.44))
    c.rect([land_x + 18, 20, w - 20, top_y - 2], fill=void)
    c.rect([land_x + 14, 14, w - 16, 24], fill=st_l)
    c.rect([land_x + 14, 14, w - 16, 19], fill=st_ll)

    # ---- the solid stone mass of the flight
    sil = [(x0, ground + 6)]
    for i in range(n):
        ty = ground - (i + 1) * rise
        xl = x0 + i * run
        sil.append((xl, ty))
        sil.append((xl + run + skew, ty))
    sil += [(w - 6, top_y), (w - 6, ground + 6)]
    c.poly(sil, fill=st_d)

    def mass_left(y):
        i = int((ground - y) // rise)
        if i <= 0:
            return x0
        return x0 + min(i, n) * run

    # coursed ashlar. Without this the side of the stoop is one flat brown
    # field the size of a kid, and the cel wedge slices it in half like a bad
    # gradient. Real brownstone is stacked blocks and reads that way at 75px.
    ch = 21.0
    kk = 0
    yy = ground + 2
    while yy > top_y - 2:
        lx = mass_left(yy)
        c.line([(lx, yy), (w - 6, yy)], shade(st, 0.56), 2.2)
        c.line([(lx, yy + 2), (w - 6, yy + 2)], shade(st, 0.94), 1.4)
        jx = x0 + (34 if kk % 2 else 0)
        while jx < w - 8:
            if jx > mass_left(yy - ch) + 4:
                c.line([(jx, yy - ch + 1), (jx + rnd.uniform(-1.5, 1.5), yy)],
                       shade(st, 0.62), 2.0)
            jx += 68
        yy -= ch
        kk += 1

    # ---- steps, far to near so each riser overlaps the tread behind it
    for i in range(n - 1, -1, -1):
        ty = ground - (i + 1) * rise
        xl = x0 + i * run
        xr = xl + run
        # tread top surface, receding up-right
        c.poly([(xl, ty), (xr + skew, ty), (xr + skew, ty - 11),
                (xl + skew, ty - 11)], fill=st_l)
        c.poly([(xl, ty), (xl + skew, ty - 11), (xl + skew + 18, ty - 11),
                (xl + 18, ty)], fill=shade(st_l, 0.88))
        # riser face — clearly darker than the coursed side wall, otherwise
        # the steps dissolve into the mass
        c.rect([xl, ty, xr + skew, ty + rise], fill=st_dd)
        c.rect([xl, ty, xr + skew, ty + 7], fill=void)
        c.rect([xl + 5, ty + 10, xr + skew - 4, ty + rise - 3],
               fill=shade(st_dd, 1.10))
        # the nosing: one bright line per step
        c.rect([xl, ty - 11, xr + skew, ty - 5], fill=st_ll)
        c.rect([xl, ty - 5, xr + skew, ty - 1], fill=shade(st_l, 0.86))
        # worn dish where a thousand feet landed
        c.ellipse([xl + 10, ty - 11, xr + skew - 8, ty - 4],
                  fill=shade(st_l, 0.94))
        for _ in range(14):
            c.circle(rnd.uniform(xl + 3, xr + skew - 3),
                     rnd.uniform(ty + 9, ty + rise - 2),
                     rnd.uniform(0.7, 1.6),
                     fill=rnd.choice([shade(st_dd, 0.90), shade(st_dd, 1.12)]))
        # a bitten corner off the nosing — a centred triangle reads as a UI
        # arrow, so keep it at the ends and irregular
        if rnd.random() < 0.8:
            cxp = rnd.choice([xl + rnd.uniform(2, 12),
                              xr + skew - rnd.uniform(8, 20)])
            cw = rnd.uniform(11, 19)
            c.poly([(cxp, ty - 4), (cxp + cw, ty - 3),
                    (cxp + cw * 0.62, ty + 3), (cxp + cw * 0.2, ty + 2)],
                   fill=shade(void, 1.22))

    # ---- landing at the top
    c.rect([land_x, top_y - 8, w - 6, top_y], fill=st_l)
    c.rect([land_x, top_y - 8, w - 6, top_y - 4], fill=st_ll)

    # ---- weathering on the stone, kept inside the mass
    for _ in range(240):
        wx = rnd.uniform(x0, w - 8)
        i = max(0, min(n, int((wx - x0) // run)))
        floor = ground - i * rise
        c.circle(wx, rnd.uniform(floor - 6, ground + 2), rnd.uniform(0.5, 1.4),
                 fill=rnd.choice([shade(st_d, 0.90), shade(st_d, 1.08), st]))
    # damp stain creeping up from the sidewalk
    ov = c.overlay()
    ov.poly([(x0, ground + 6), (w - 6, ground + 6), (w - 6, ground - 30),
             (x0, ground - 14)], fill=(26, 18, 12, 44))
    c.merge(ov)

    # ---- iron railing: newel, raked handrail, real balusters onto the treads
    rail = mix(IRON, SLATE, 0.50)
    rail_d = shade(IRON, 0.78)
    lo = (x0 + 6, ground - rise - 52)
    hi = (land_x + 8, top_y - 52)

    def rake_y(x):
        t = (x - lo[0]) / float(hi[0] - lo[0])
        return lo[1] + (hi[1] - lo[1]) * t

    for k in range(7):
        bx = lo[0] + (hi[0] - lo[0]) * k / 6.0
        i = max(0, min(n - 1, int((bx - x0) / run)))
        foot = ground - (i + 1) * rise - 5
        c.rect([bx - 2.6, rake_y(bx), bx + 2.6, foot], fill=rail_d)
        c.rect([bx - 2.6, rake_y(bx), bx - 0.4, foot], fill=rail)
    c.capsule(lo, hi, 8, 8, rail_d)
    c.capsule((lo[0], lo[1] - 2.4), (hi[0], hi[1] - 2.4), 3.6, 3.6, rail)
    # newel post
    c.rect([lo[0] - 5, lo[1] - 6, lo[0] + 5, ground - rise - 4], fill=rail_d)
    c.rect([lo[0] - 5, lo[1] - 6, lo[0] - 1, ground - rise - 4], fill=rail)
    c.circle(lo[0], lo[1] - 10, 6.0, fill=rail_d)
    c.circle(lo[0] - 1.6, lo[1] - 11.4, 3.2, fill=rail)
    c.rect([hi[0] - 4, hi[1] - 4, hi[0] + 4, top_y - 6], fill=rail_d)

    img = ak.finish(c, ink=3, light=True, light_strength=0.85, grain_amt=6, seed=6)
    return sit(img, w * 0.46, ground + 8, w * 0.46, 8, 0.32, 6)


# ================================================================== furniture
def build_model_t():
    """256x128 world. 1926 Ford in profile."""
    w, h = W(256, 128)
    c = Canvas(w, h, ss=3)
    rnd = random.Random(53)
    ground = h - 10
    fw = (120, ground - 48)
    rw = (420, ground - 48)
    wr = 48

    def wheel(cx, cy):
        c.circle(cx, cy, wr, fill=shade(LACQUER, 0.62))
        c.circle(cx, cy, wr - 3, fill=(38, 36, 36))
        c.circle(cx - 3, cy - 4, wr - 6, fill=(56, 54, 54))
        c.circle(cx, cy, wr - 12, fill=shade(SPOKE, 0.66))
        c.circle(cx, cy, wr - 15, fill=(40, 38, 38))
        for k in range(12):
            a = 30 * k + 8
            p0 = epoint(cx, cy, 9, 9, a)
            p1 = epoint(cx, cy, wr - 15, wr - 15, a)
            c.line([p0, p1], SPOKE if k % 2 else shade(SPOKE, 0.84), 4)
        c.circle(cx, cy, 11, fill=shade(SPOKE, 0.60))
        c.circle(cx, cy, 8, fill=shade(BRASS, 0.86))
        c.circle(cx - 2, cy - 2, 4, fill=BRASS)

    # chassis + running board first so wheels/fenders sit over it
    c.rect([84, ground - 74, 466, ground - 58], fill=shade(LACQUER, 0.7))
    wheel(*fw)
    wheel(*rw)

    # body tub
    body = [(214, 108), (300, 104), (420, 106), (452, 112), (466, 132),
            (468, 168), (446, 178), (240, 178), (214, 172)]
    c.poly(body, fill=shade(LACQUER, 0.72))
    c.poly([(p[0], p[1]) for p in body[:6]] + [(468, 150), (214, 150)],
           fill=LACQUER)
    c.line([(216, 112), (452, 116)], LACQUER_L, 3)
    c.line([(218, 120), (450, 124)], shade(LACQUER, 0.5), 2)

    # hood + cowl
    c.poly([(96, 100), (206, 92), (214, 108), (214, 172), (96, 172)],
           fill=shade(LACQUER, 0.78))
    c.poly([(96, 100), (206, 92), (210, 104), (98, 112)], fill=LACQUER_L)
    c.poly([(98, 112), (210, 104), (212, 140), (98, 146)], fill=LACQUER)
    for k in range(7):
        x = 112 + k * 12
        c.line([(x, 124), (x + 2, 152)], shade(LACQUER, 0.52), 2)

    # radiator shell (brass) + core
    c.poly([(74, 104), (98, 98), (100, 176), (76, 176)], fill=shade(BRASS, 0.7))
    c.poly([(74, 104), (94, 99), (95, 172), (76, 172)], fill=BRASS)
    c.poly([(79, 110), (92, 106), (92, 168), (80, 168)], fill=(44, 42, 40))
    for k in range(9):
        y = 112 + k * 6.5
        c.line([(80, y), (92, y - 1)], shade(BRASS, 0.55), 1.4)
    c.circle(85, 100, 6, fill=BRASS)

    # headlamp: a brass drum on a bracket off the radiator
    c.line([(92, 116), (84, 100)], shade(BRASS, 0.50), 5)
    c.poly([(74, 88), (92, 90), (92, 112), (74, 110)], fill=shade(BRASS, 0.58))
    c.poly([(74, 88), (86, 89), (86, 110), (74, 110)], fill=shade(BRASS, 0.80))
    c.ellipse([68, 84, 80, 114], fill=shade(BRASS, 0.66))
    c.ellipse([70, 87, 79, 111], fill=mix(PAPER, GOLD, 0.42))
    c.ellipse([71, 90, 75, 99], fill=CHALK)

    # windshield
    c.poly([(202, 94), (222, 94), (232, 30), (212, 30)], fill=shade(LACQUER, 0.52))
    c.poly([(206, 90), (219, 90), (228, 36), (215, 36)],
           fill=mix(SLATE, PAPER, 0.24))
    c.poly([(206, 90), (211, 90), (220, 36), (215, 36)],
           fill=mix(SLATE, PAPER, 0.44))
    c.line([(208, 64), (224, 64)], shade(LACQUER, 0.7), 3)

    # dark interior under the top
    c.poly([(222, 106), (440, 110), (440, 60), (226, 46)], fill=(30, 28, 30))
    # seat back
    seat = mix(CLOTH["chocolate"], LACQUER, 0.62)
    c.poly([(322, 108), (372, 108), (368, 62), (326, 64)],
           fill=shade(seat, 0.70))
    c.poly([(322, 108), (348, 108), (346, 64), (326, 64)], fill=seat)
    c.line([(334, 66), (332, 106)], shade(seat, 0.72), 2)
    # steering wheel + column
    c.line([(240, 118), (258, 78)], shade(LACQUER, 0.62), 5)
    c.ellipse([248, 60, 264, 100], fill=None, outline=(52, 48, 46), width=4)
    c.ellipse([248, 60, 256, 100], fill=None, outline=(70, 66, 62), width=3)

    # cloth top
    top = CLOTH["charcoal"]
    c.poly([(214, 40), (300, 32), (400, 34), (452, 44), (456, 60),
            (398, 48), (300, 46), (216, 54)], fill=shade(top, 0.82))
    c.poly([(214, 40), (300, 32), (400, 34), (452, 44), (450, 52),
            (398, 42), (300, 40), (216, 48)], fill=mix(top, PAPER, 0.12))
    # rear quarter of the top
    c.poly([(440, 40), (462, 52), (468, 96), (452, 126), (432, 122),
            (446, 92), (440, 56)], fill=shade(top, 0.82))
    c.poly([(440, 40), (458, 50), (462, 92), (450, 120), (442, 118),
            (450, 90), (438, 54)], fill=top)
    for x in (300, 372):
        c.line([(x, 34), (x + 2, 46)], shade(top, 0.6), 2)

    # fenders
    def fender(cx, cy, x0, x1):
        outer = earc(cx, cy, wr + 22, wr + 20, 186, 354, 20)
        inner = earc(cx, cy, wr + 6, wr + 5, 354, 186, 20)
        c.poly(outer + inner, fill=shade(LACQUER, 0.62))
        outer2 = earc(cx, cy, wr + 20, wr + 17, 190, 300, 16)
        inner2 = earc(cx, cy, wr + 8, wr + 7, 300, 190, 16)
        c.poly(outer2 + inner2, fill=LACQUER_L)
        c.poly([(x0, cy), (x0 + 10, cy), (x0 + 10, cy + 26), (x0, cy + 24)],
               fill=shade(LACQUER, 0.6))
        c.poly([(x1 - 10, cy), (x1, cy), (x1, cy + 24), (x1 - 10, cy + 26)],
               fill=shade(LACQUER, 0.6))
    fender(fw[0], fw[1], 58, 184)
    fender(rw[0], rw[1], 358, 484)

    # running board
    c.poly([(168, 154), (376, 158), (378, 172), (166, 168)],
           fill=shade(LACQUER, 0.55))
    c.poly([(168, 154), (376, 158), (376, 163), (168, 159)], fill=(74, 72, 70))
    for k in range(11):
        x = 176 + k * 18
        c.line([(x, 155), (x, 162)], shade(LACQUER, 0.5), 2)

    # door line + handle
    c.line([(316, 112), (318, 172)], shade(LACQUER, 0.45), 2.5)
    c.line([(322, 130), (334, 131)], BRASS, 3)
    # crank
    c.line([(64, 170), (56, 176), (56, 186)], shade(IRON, 1.3), 4)
    # rear lamp
    c.circle(470, 118, 5, fill=BRASS)

    # scuffs, on the paint only
    for _ in range(34):
        x = rnd.uniform(100, 460)
        y = rnd.uniform(110, 176)
        c.circle(x, y, rnd.uniform(0.7, 1.7),
                 fill=rnd.choice([shade(LACQUER, 1.35), shade(LACQUER, 0.7)]))
    img = ak.finish(c, ink=3, light=True, light_strength=0.85, grain_amt=6, seed=8)
    return sit(img, (fw[0] + rw[0]) * 0.5, ground + 2, 190, 12, 0.34, 7)


def build_fire_escape():
    """120x300 world. Spindly wrought iron against the brick."""
    w, h = W(120, 300)
    c = Canvas(w, h)
    rnd = random.Random(61)
    lit = mix(IRON, SLATE, 0.55)
    dk = shade(IRON, 0.70)
    rust_pts = []

    def hbar(x0, x1, y, th=7):
        c.rrect([x0, y, x1, y + th], th * 0.4, fill=dk)
        c.rrect([x0, y, x1, y + th * 0.42], th * 0.3, fill=lit)
        rust_pts.append((rnd.uniform(x0, x1), y + th * 0.5))

    def landing(y_rail):
        """Railing top at y_rail. Returns the underside y of the floor."""
        y_floor = y_rail + 56
        # balusters, real gaps between them
        x = 26
        while x <= w - 26:
            c.rect([x - 3, y_rail, x + 3, y_floor + 4], fill=dk)
            c.rect([x - 3, y_rail, x - 0.8, y_floor + 4], fill=lit)
            x += 21.4
        hbar(16, w - 16, y_rail, 9)             # top rail
        hbar(18, w - 18, y_rail + 26, 5)        # middle rail
        c.rect([16, y_rail - 4, 24, y_floor + 10], fill=dk)   # end stiles
        c.rect([w - 24, y_rail - 4, w - 16, y_floor + 10], fill=dk)
        c.rect([16, y_rail - 4, 19, y_floor + 10], fill=lit)
        # floor plate, seen almost edge-on
        c.rect([8, y_floor + 4, w - 8, y_floor + 22], fill=dk)
        c.rect([8, y_floor + 4, w - 8, y_floor + 10], fill=lit)
        for k in range(14):
            gx = 14 + k * 16
            c.rect([gx, y_floor + 12, gx + 7, y_floor + 21],
                   fill=shade(IRON, 0.46))
        # gusset brackets under the plate
        for bx, s in ((22, 1), (w - 22, -1)):
            c.poly([(bx, y_floor + 22), (bx + s * 30, y_floor + 22),
                    (bx, y_floor + 46)], fill=dk)
            c.poly([(bx, y_floor + 22), (bx + s * 30, y_floor + 22),
                    (bx + s * 6, y_floor + 27)], fill=lit)
        return y_floor + 22

    top_bot = landing(24)
    bot_bot = landing(300)

    # verticals tying the frames together
    for x in (20, w - 20):
        c.rect([x - 4, top_bot, x + 4, 300], fill=dk)
        c.rect([x - 4, top_bot, x - 1.4, 300], fill=lit)
        rust_pts.append((x, rnd.uniform(top_bot, 300)))

    # diagonal ladder between the landings
    lad_hi = (w - 46, top_bot + 8)
    lad_lo = (46, 292)
    dx = lad_lo[0] - lad_hi[0]
    dy = lad_lo[1] - lad_hi[1]
    ln = math.hypot(dx, dy)
    nx, ny = -dy / ln, dx / ln
    for s in (-13, 13):
        c.line([(lad_hi[0] + nx * s, lad_hi[1] + ny * s),
                (lad_lo[0] + nx * s, lad_lo[1] + ny * s)], dk, 6)
    c.line([(lad_hi[0] + nx * 13 - 1, lad_hi[1] + ny * 13),
            (lad_lo[0] + nx * 13 - 1, lad_lo[1] + ny * 13)], lit, 2)
    nrung = 9
    for k in range(1, nrung):
        t = k / nrung
        px = lad_hi[0] + dx * t
        py = lad_hi[1] + dy * t
        c.line([(px + nx * 13, py + ny * 13), (px - nx * 13, py - ny * 13)],
               dk, 5)
        rust_pts.append((px, py))

    # drop ladder below the lower landing
    yl0 = bot_bot + 4
    for x in (48, 80):
        c.rect([x - 3.5, yl0, x + 3.5, h - 10], fill=dk)
        c.rect([x - 3.5, yl0, x - 1.2, h - 10], fill=lit)
    k = 0
    while yl0 + 18 + k * 24 < h - 14:
        yy = yl0 + 18 + k * 24
        c.rect([46, yy, 82, yy + 5], fill=dk)
        c.rect([46, yy, 82, yy + 2], fill=lit)
        rust_pts.append((rnd.uniform(48, 80), yy))
        k += 1

    # rust bloom, only where there is iron
    for (rx, ry) in rust_pts:
        for _ in range(2):
            c.circle(rx + rnd.uniform(-4, 4), ry + rnd.uniform(-4, 4),
                     rnd.uniform(0.9, 2.0), fill=mix(RUST, IRON, 0.52))
    img = ak.finish(c, ink=2, light=True, light_strength=0.8, grain_amt=5, seed=9)
    return img


def build_lamp():
    """40x190 world. Cast iron post, warm muted lantern."""
    w, h = W(40, 190)
    c = Canvas(w, h)
    ground = h - 6
    cx = w * 0.5
    dk = shade(IRON, 0.78)
    md = IRON
    lt = IRON_L

    # plinth
    c.rrect([cx - 22, ground - 14, cx + 22, ground], 4, fill=dk)
    c.rrect([cx - 22, ground - 16, cx + 12, ground - 4], 4, fill=md)
    c.rrect([cx - 17, ground - 30, cx + 17, ground - 12], 5, fill=dk)
    c.rrect([cx - 17, ground - 32, cx + 8, ground - 16], 5, fill=md)
    c.ellipse([cx - 19, ground - 40, cx + 19, ground - 24], fill=md)
    c.ellipse([cx - 19, ground - 42, cx + 8, ground - 30], fill=lt)

    # fluted shaft
    top_y = 128
    bw, tw = 13.5, 8.5
    c.poly([(cx - bw, ground - 34), (cx + bw, ground - 34),
            (cx + tw, top_y), (cx - tw, top_y)], fill=md)
    c.poly([(cx - bw, ground - 34), (cx - bw * 0.15, ground - 34),
            (cx - tw * 0.15, top_y), (cx - tw, top_y)], fill=lt)
    c.poly([(cx + bw * 0.55, ground - 34), (cx + bw, ground - 34),
            (cx + tw, top_y), (cx + tw * 0.55, top_y)], fill=dk)
    for k in (-0.55, 0.0, 0.55):
        c.line([(cx + bw * k, ground - 36), (cx + tw * k, top_y)],
               shade(md, 0.72), 1.4)

    # collar + lamplighter's bar
    c.rrect([cx - 14, top_y - 8, cx + 14, top_y + 6], 3, fill=dk)
    c.rrect([cx - 14, top_y - 10, cx + 6, top_y + 1], 3, fill=lt)
    c.rrect([cx - 26, top_y - 22, cx + 26, top_y - 16], 3, fill=md)
    for sx in (-26, 26):
        c.circle(cx + sx, top_y - 19, 4, fill=md)
        c.circle(cx + sx - 1, top_y - 20, 2.4, fill=lt)

    # lantern
    ly0, ly1 = 44, top_y - 12
    lx0, lx1 = cx - 17, cx + 17
    tx0, tx1 = cx - 13, cx + 13
    c.poly([(lx0, ly1), (lx1, ly1), (tx1, ly0), (tx0, ly0)], fill=dk)
    glass = mix(GOLD, PAPER, 0.45)
    c.poly([(lx0 + 4, ly1 - 4), (lx1 - 4, ly1 - 4), (tx1 - 3, ly0 + 4),
            (tx0 + 3, ly0 + 4)], fill=shade(glass, 0.82))
    c.poly([(lx0 + 4, ly1 - 4), (cx - 1, ly1 - 4), (cx - 1, ly0 + 4),
            (tx0 + 3, ly0 + 4)], fill=glass)
    # mantle
    c.ellipse([cx - 5, ly1 - 26, cx + 5, ly1 - 12], fill=mix(GOLD, CHALK, 0.55))
    # corner posts + glazing bar
    for x in (lx0, lx1):
        t = 0 if x < cx else 1
        c.line([(x, ly1), (tx0 if t == 0 else tx1, ly0)], dk, 3.2)
    c.line([(cx, ly0), (cx, ly1)], dk, 2.4)
    c.rrect([lx0 - 3, ly1 - 6, lx1 + 3, ly1 + 4], 2, fill=md)
    c.rrect([lx0 - 3, ly1 - 8, lx1 - 6, ly1 - 1], 2, fill=lt)
    # crown
    c.poly([(tx0 - 6, ly0 + 3), (tx1 + 6, ly0 + 3), (cx + 5, ly0 - 16),
            (cx - 5, ly0 - 16)], fill=dk)
    c.poly([(tx0 - 6, ly0 + 3), (cx, ly0 + 3), (cx, ly0 - 16),
            (cx - 5, ly0 - 16)], fill=md)
    c.circle(cx, ly0 - 20, 5, fill=md)
    c.circle(cx - 1.4, ly0 - 21, 2.8, fill=lt)
    c.line([(cx, ly0 - 24), (cx, ly0 - 32)], md, 3)

    img = ak.finish(c, ink=3, light=True, grain_amt=5, seed=10)
    img = soft_glow(img, cx, (ly0 + ly1) * 0.5, 28, 38, GOLD, 0.20, 12)
    return sit(img, cx, ground + 1, 22, 6, 0.30, 5)


# ================================================================== windows
def _window_frame(c, w, h):
    """Shared casing for prp_window and prp_window_broken. Painted sash: light
    frame, black glass — the pair that reads at 40px against brick."""
    wood = mix(CLOTH["grey"], PAPER, 0.34)
    wood_l = mix(wood, CHALK, 0.34)
    wood_d = shade(wood, 0.66)

    # stone lintel
    c.rect([5, 4, w - 5, 22], fill=shade(STONE, 0.78))
    c.rect([5, 4, w - 9, 16], fill=mix(STONE, PAPER, 0.26))
    # casing
    c.rect([10, 20, w - 10, h - 22], fill=wood_d)
    c.rect([10, 20, w - 14, h - 26], fill=wood)
    c.rect([10, 20, 17, h - 26], fill=wood_l)
    c.rect([10, 20, w - 14, 27], fill=wood_l)
    # opening
    gx0, gy0, gx1, gy1 = 21, 30, w - 21, h - 33
    c.rect([gx0 - 2, gy0 - 2, gx1 + 2, gy1 + 2], fill=wood_d)
    c.rect([gx0, gy0, gx1, gy1], fill=(20, 18, 20))
    # sill
    c.rect([5, h - 26, w - 5, h - 12], fill=shade(STONE, 0.72))
    c.rect([5, h - 26, w - 9, h - 19], fill=mix(STONE, PAPER, 0.34))
    c.rect([9, h - 12, w - 9, h - 6], fill=shade(STONE, 0.50))
    return (gx0, gy0, gx1, gy1, wood, wood_l, wood_d)


def _window_bars(c, geo, w, h):
    """Sash rails + mullions, drawn on top of whatever the glass is doing."""
    gx0, gy0, gx1, gy1, wood, wood_l, wood_d = geo
    mid = (gy0 + gy1) * 0.5
    cxm = (gx0 + gx1) * 0.5
    # meeting rail
    c.rect([gx0 - 2, mid - 6, gx1 + 2, mid + 6], fill=wood_d)
    c.rect([gx0 - 2, mid - 6, gx1 + 2, mid + 1], fill=wood)
    c.rect([gx0 - 2, mid - 6, gx1 + 2, mid - 3], fill=wood_l)
    # vertical mullions
    c.rect([cxm - 3.5, gy0, cxm + 3.5, gy1], fill=wood_d)
    c.rect([cxm - 3.5, gy0, cxm + 0.5, gy1], fill=wood)
    # sash frames
    for y0, y1 in ((gy0, mid), (mid, gy1)):
        c.rect([gx0 - 2, y0, gx1 + 2, y0 + 5], fill=wood)
        c.rect([gx0 - 2, y1 - 5, gx1 + 2, y1], fill=wood_d)
        c.rect([gx0 - 2, y0, gx0 + 5, y1], fill=wood)
        c.rect([gx0 - 2, y0, gx0 + 2, y1], fill=wood_l)
        c.rect([gx1 - 5, y0, gx1 + 2, y1], fill=wood_d)


def build_window():
    """56x76 world."""
    w, h = W(56, 76)
    c = Canvas(w, h)
    geo = _window_frame(c, w, h)
    gx0, gy0, gx1, gy1 = geo[:4]
    mid = (gy0 + gy1) * 0.5
    # glass: dark room with a cold sky reflection sliding across
    c.rect([gx0, gy0, gx1, gy1], fill=GLASS)
    c.poly([(gx0, gy0 + 30), (gx0 + 34, gy0), (gx0 + 58, gy0),
            (gx0, gy0 + 56)], fill=mix(GLASS, SLATE, 0.40))
    c.poly([(gx0, gy0 + 12), (gx0 + 16, gy0), (gx0 + 30, gy0),
            (gx0, gy0 + 36)], fill=mix(GLASS, SLATE, 0.62))
    c.poly([(gx0, gy1 - 18), (gx0 + 20, gy1), (gx0 + 4, gy1)],
           fill=mix(GLASS, SLATE, 0.28))
    # curtain, pushed to one side of the upper sash
    cur = mix(CLOTH["cream"], SLATE, 0.14)
    c.poly([(gx0 + 1, gy0), (gx0 + 22, gy0), (gx0 + 20, mid - 20),
            (gx0 + 13, mid - 10), (gx0 + 6, mid - 22), (gx0 + 1, mid - 12)],
           fill=shade(cur, 0.80))
    c.poly([(gx0 + 1, gy0), (gx0 + 14, gy0), (gx0 + 13, mid - 16),
            (gx0 + 6, mid - 22), (gx0 + 1, mid - 12)], fill=cur)
    c.line([(gx0 + 9, gy0 + 4), (gx0 + 10, mid - 20)], shade(cur, 0.86), 1.6)
    # a shade half drawn in the top of the other pane
    c.rect([(gx0 + gx1) * 0.5 + 4, gy0 + 1, gx1 - 1, gy0 + 14],
           fill=mix(CLOTH["oat"], ASPHALT, 0.35))
    _window_bars(c, geo, w, h)
    return ak.finish(c, ink=3, light=True, light_strength=0.85, grain_amt=5, seed=11)


def build_window_broken():
    """56x76 world. Same frame, smashed glass."""
    w, h = W(56, 76)
    c = Canvas(w, h)
    rnd = random.Random(71)
    geo = _window_frame(c, w, h)
    gx0, gy0, gx1, gy1 = geo[:4]
    mid = (gy0 + gy1) * 0.5
    # the hole
    c.rect([gx0, gy0, gx1, gy1], fill=(14, 12, 14))
    shard = mix(GLASS, SLATE, 0.62)
    shard_l = mix(GLASS, CHALK, 0.55)

    def shards(x0, y0, x1, y1, n=6):
        """Teeth of glass still clinging to the pane edges."""
        for k in range(n):
            side = k % 4
            if side == 0:
                a = (x0 + (x1 - x0) * rnd.uniform(0, 0.62), y0)
                b = (a[0] + rnd.uniform(10, 20), y0)
                tip = ((a[0] + b[0]) / 2 + rnd.uniform(-5, 5),
                       y0 + rnd.uniform(12, 24))
            elif side == 1:
                a = (x1, y0 + (y1 - y0) * rnd.uniform(0, 0.62))
                b = (x1, a[1] + rnd.uniform(10, 20))
                tip = (x1 - rnd.uniform(10, 22), (a[1] + b[1]) / 2)
            elif side == 2:
                a = (x0 + (x1 - x0) * rnd.uniform(0, 0.62), y1)
                b = (a[0] + rnd.uniform(10, 20), y1)
                tip = ((a[0] + b[0]) / 2, y1 - rnd.uniform(12, 24))
            else:
                a = (x0, y0 + (y1 - y0) * rnd.uniform(0, 0.62))
                b = (x0, a[1] + rnd.uniform(10, 20))
                tip = (x0 + rnd.uniform(10, 22), (a[1] + b[1]) / 2)
            c.poly([a, b, tip], fill=shard if rnd.random() < 0.5 else shard_l)
            c.line([a, tip], shard_l, 1.4)

    cxm = (gx0 + gx1) * 0.5
    for (x0, y0, x1, y1) in ((gx0, gy0, cxm, mid), (cxm, gy0, gx1, mid),
                             (gx0, mid, cxm, gy1), (cxm, mid, gx1, gy1)):
        shards(x0 + 1, y0 + 1, x1 - 1, y1 - 1, 6)
    # radiating cracks from the impact
    ix, iy = cxm + 6, mid - 10
    for k in range(11):
        a = 360.0 * k / 11 + rnd.uniform(-8, 8)
        ln = rnd.uniform(14, 30)
        p1 = (ix + math.cos(math.radians(a)) * ln,
              iy + math.sin(math.radians(a)) * ln)
        c.line(jitter_path((ix, iy), p1, rnd, 3, 1.6), shard_l, 1.3)
    _window_bars(c, geo, w, h)
    # a torn shard hanging over the mullion
    c.poly([(cxm - 2, mid - 30), (cxm + 9, mid - 26), (cxm + 1, mid - 12)],
           fill=shard_l)
    return ak.finish(c, ink=3, light=True, light_strength=0.85, grain_amt=5, seed=11)


# ================================================================== street junk
def build_trash():
    """70x86 world. Galvanized ash can."""
    w, h = W(70, 86)
    c = Canvas(w, h)
    rnd = random.Random(83)
    ground = h - 6
    cx = w * 0.5
    md = GALV
    lt = mix(GALV, CHALK, 0.34)
    dk = shade(GALV, 0.62)

    top_y, bot_y = 40, ground - 8
    tw, bw = 50, 40

    # handles behind the body
    for sx in (-1, 1):
        hx = cx + sx * (tw - 4)
        c.line([(hx - sx * 2, 56), (hx + sx * 9, 62), (hx - sx * 1, 74)], dk, 6)
        c.line([(hx - sx * 2, 55), (hx + sx * 8, 61), (hx - sx * 1, 72)], md, 3)

    # body
    c.poly([(cx - tw, top_y), (cx + tw, top_y), (cx + bw, bot_y),
            (cx - bw, bot_y)], fill=dk)
    c.poly([(cx - tw, top_y), (cx + tw * 0.34, top_y), (cx + bw * 0.34, bot_y),
            (cx - bw, bot_y)], fill=md)
    c.poly([(cx - tw + 5, top_y), (cx - tw + 20, top_y), (cx - bw + 16, bot_y),
            (cx - bw + 4, bot_y)], fill=lt)
    c.ellipse([cx - bw, bot_y - 8, cx + bw, bot_y + 8], fill=dk)
    c.ellipse([cx - bw + 3, bot_y - 8, cx + bw - 8, bot_y + 4], fill=md)

    # ribs
    for t in (0.28, 0.52, 0.76):
        y = top_y + (bot_y - top_y) * t
        hw = tw + (bw - tw) * t
        c.poly([(cx - hw, y), (cx + hw, y), (cx + hw, y + 4), (cx - hw, y + 4)],
               fill=dk)
        c.poly([(cx - hw, y - 2), (cx + hw, y - 2), (cx + hw, y + 0.5),
                (cx - hw, y + 0.5)], fill=lt)
    # dents
    for _ in range(4):
        x = rnd.uniform(cx - tw + 10, cx + tw - 14)
        y = rnd.uniform(top_y + 12, bot_y - 12)
        rx = rnd.uniform(5, 10)
        c.ellipse([x - rx, y - rx * 0.6, x + rx, y + rx * 0.6], fill=dk)
        c.ellipse([x - rx * 0.7, y - rx * 0.55, x + rx * 0.5, y + rx * 0.2],
                  fill=shade(GALV, 0.80))
    for _ in range(46):
        x = rnd.uniform(cx - tw, cx + tw)
        y = rnd.uniform(top_y, bot_y)
        c.circle(x, y, rnd.uniform(0.5, 1.2),
                 fill=rnd.choice([dk, lt, lt, mix(shade(RUST, 0.74), GALV, 0.45)]))

    # lid, sitting askew
    c.poly([(cx - tw - 4, top_y + 2), (cx + tw + 2, top_y - 4),
            (cx + tw - 2, top_y - 12), (cx - tw, top_y - 8)], fill=dk)
    c.ellipse([cx - tw - 2, top_y - 26, cx + tw, top_y - 2], fill=dk)
    c.ellipse([cx - tw - 2, top_y - 28, cx + tw - 8, top_y - 8], fill=md)
    c.ellipse([cx - tw + 10, top_y - 26, cx + 6, top_y - 14], fill=lt)
    c.ellipse([cx - 16, top_y - 24, cx + 14, top_y - 12], fill=dk)
    c.ellipse([cx - 16, top_y - 25, cx + 8, top_y - 16], fill=md)
    c.line([(cx - 9, top_y - 20), (cx - 3, top_y - 27), (cx + 6, top_y - 22)],
           dk, 5)
    c.line([(cx - 9, top_y - 21), (cx - 3, top_y - 28), (cx + 5, top_y - 23)],
           lt, 2.4)

    img = ak.finish(c, ink=3, light=True, grain_amt=7, seed=13)
    return sit(img, cx, ground - 2, bw + 6, 8, 0.32, 5)


def build_crate():
    """84x62 world. Produce crate."""
    w, h = W(84, 62)
    c = Canvas(w, h)
    rnd = random.Random(89)
    ground = h - 6
    wood = WOOD
    wood_l = mix(WOOD, PAPER, 0.28)
    wood_d = shade(WOOD, 0.66)

    x0, x1 = 10, w - 26
    y0, y1 = 26, ground
    dxs, dys = 16, -9  # side/top skew

    # top face
    c.poly([(x0, y0), (x1, y0), (x1 + dxs, y0 + dys), (x0 + dxs, y0 + dys)],
           fill=wood_l)
    c.line([((x0 + x1) * 0.5, y0), ((x0 + x1) * 0.5 + dxs, y0 + dys)],
           shade(wood_l, 0.8), 2)
    # side face
    c.poly([(x1, y0), (x1 + dxs, y0 + dys), (x1 + dxs, y1 + dys), (x1, y1)],
           fill=wood_d)
    for k in range(3):
        yy = y0 + (y1 - y0) * (k + 1) / 4.0
        c.line([(x1, yy), (x1 + dxs, yy + dys)], shade(wood_d, 0.72), 2)
    # front slats
    c.rect([x0, y0, x1, y1], fill=shade(wood, 0.7))
    for k in range(3):
        sy0 = y0 + 3 + k * 22
        c.rect([x0, sy0, x1, sy0 + 18], fill=wood)
        c.rect([x0, sy0, x1, sy0 + 5], fill=wood_l)
        c.rect([x0, sy0 + 15, x1, sy0 + 18], fill=wood_d)
        for _ in range(5):
            gx = rnd.uniform(x0 + 4, x1 - 4)
            c.line([(gx, sy0 + 4), (gx + rnd.uniform(6, 20), sy0 + rnd.uniform(6, 14))],
                   shade(wood, 0.82), 1.3)
    # end battens
    for bx in (x0, x1 - 13):
        c.rect([bx, y0 - 1, bx + 13, y1], fill=wood)
        c.rect([bx, y0 - 1, bx + 4, y1], fill=wood_l)
        c.rect([bx + 11, y0 - 1, bx + 13, y1], fill=wood_d)
        for ny in (y0 + 6, y1 - 8):
            c.circle(bx + 6, ny, 1.8, fill=shade(IRON, 1.4))
    # stencil
    f = ak.font("serif_bold", int(9 * S * c.ss))
    ink_stamp = mix(BRICK_D, wood, 0.45)
    c.text(((x0 + x1) * 0.5 + 1, y0 + 34), "ORANGES", f, ink_stamp)
    f2 = ak.font("serif_bold", int(6 * S * c.ss))
    c.text(((x0 + x1) * 0.5 + 1, y0 + 47), "FLA.", f2, ink_stamp)
    for _ in range(60):
        c.circle(rnd.uniform(x0, x1 + dxs), rnd.uniform(y0 + dys, y1),
                 rnd.uniform(0.5, 1.1),
                 fill=rnd.choice([shade(wood, 0.84), wood_l, shade(wood, 0.92)]))

    img = ak.finish(c, ink=3, light=True, grain_amt=7, seed=14)
    return sit(img, (x0 + x1) * 0.5 + 6, ground, (x1 - x0) * 0.56, 6, 0.30, 5)


def build_awning():
    """180x70 world. Shop awning, muted stripes."""
    w, h = W(180, 70)
    c = Canvas(w, h)
    rnd = random.Random(97)
    bx0, bx1, by = 34, w - 34, 14      # back edge (at the wall)
    fx0, fx1, fy = 8, w - 8, h - 46    # front edge
    # Faded 1926 duck canvas, not a circus tent. The light stripe has to sit
    # near the sidewalk in value or the awning becomes the loudest thing on the
    # street and steals the eye from the kids and the ball.
    a = mix(CLOTH["oat"], ASPHALT, 0.42)
    b = mix(shade(RUST, 0.82), ASPHALT, 0.40)

    # iron arms + wall brackets, behind the cloth
    for sx0, sx1 in ((bx0 + 4, fx0 + 8), (bx1 - 4, fx1 - 8)):
        c.line([(sx0, by - 2), (sx1, fy + 26)], shade(IRON, 1.15), 5)
        c.line([(sx0, by - 3), (sx1, fy + 25)], shade(IRON, 1.7), 2)
    for bx in (bx0, bx1):
        c.rect([bx - 6, by - 10, bx + 6, by + 6], fill=shade(IRON, 1.0))
        c.rect([bx - 6, by - 10, bx - 2, by + 6], fill=shade(IRON, 1.5))

    # ---- canopy. The front edge bows DOWN in the middle (the cloth sags
    # between the two arms); that curve is what stops it reading as a flat lid.
    sag = 9.0

    def front_y(t):
        return fy + sag * math.sin(math.pi * t)

    n = 13
    for k in range(n):
        t0 = k / float(n)
        t1 = (k + 1) / float(n)
        col = a if k % 2 == 0 else b
        c.poly([(bx0 + (bx1 - bx0) * t0, by), (bx0 + (bx1 - bx0) * t1, by),
                (fx0 + (fx1 - fx0) * t1, front_y(t1)),
                (fx0 + (fx1 - fx0) * t0, front_y(t0))], fill=col)
        # each panel is a shallow vault: dark where it turns away at the seam
        c.poly([(bx0 + (bx1 - bx0) * t0, by), (bx0 + (bx1 - bx0) * (t0 + 0.28 / n), by),
                (fx0 + (fx1 - fx0) * (t0 + 0.28 / n), front_y(t0)),
                (fx0 + (fx1 - fx0) * t0, front_y(t0))], fill=shade(col, 0.84))
        c.poly([(bx0 + (bx1 - bx0) * (t0 + 0.30 / n), by),
                (bx0 + (bx1 - bx0) * (t0 + 0.62 / n), by),
                (fx0 + (fx1 - fx0) * (t0 + 0.62 / n), front_y(t0)),
                (fx0 + (fx1 - fx0) * (t0 + 0.30 / n), front_y(t0))],
               fill=shade(col, 1.06))
    # the top third is nearest the wall and in the building's own shade
    sh = c.overlay()
    sh.poly([(bx0, by), (bx1, by),
             (fx0 + (fx1 - fx0) * 1.0, fy - 22), (fx0, fy - 22)],
            fill=(30, 24, 20, 46))
    c.merge(sh)

    # front roll bar, following the sag
    bar = [(fx0 + (fx1 - fx0) * (i / 16.0), front_y(i / 16.0)) for i in range(17)]
    c.line(bar, shade(IRON, 0.95), 9)
    c.line([(x, y - 2.6) for x, y in bar], shade(IRON, 1.35), 3)

    # ---- valance: a straight band with shallow half-round scallops cut into
    # its lower edge (full circles read as a row of beach balls)
    vh = 30
    ns = 11
    sw = (fx1 - fx0) / float(ns)
    ry = 9.0                       # scallop depth: shallow, not a half-circle
    for k in range(ns):
        t0 = (k + 0.5) / ns
        vx0 = fx0 + k * sw
        vy = front_y(t0) + 3
        col = a if k % 2 == 0 else b
        # a straight hanging band with a shallow half-round bitten out of the
        # bottom; a full circle per stripe reads as a row of coins on a string
        c.rect([vx0, vy, vx0 + sw + 0.8, vy + vh - ry], fill=col)
        c.ellipse([vx0, vy + vh - 2 * ry, vx0 + sw, vy + vh], fill=col)
        # the valance hangs in the canopy's own shadow at the top
        c.rect([vx0, vy, vx0 + sw + 0.8, vy + 9], fill=shade(col, 0.78))
        c.ellipse([vx0 + 3, vy + vh - 2 * ry + 2, vx0 + sw - 3, vy + vh - 1.5],
                  fill=shade(col, 0.90))
    for _ in range(40):
        c.circle(rnd.uniform(fx0, fx1), rnd.uniform(by, fy + vh),
                 rnd.uniform(0.6, 1.6),
                 fill=rnd.choice([shade(a, 0.92), shade(b, 0.92)]))
    return ak.finish(c, ink=3, light=True, light_strength=0.8, grain_amt=6, seed=15)


def build_pigeon():
    """34x28 world."""
    w, h = W(34, 28)
    c = Canvas(w, h)
    # A slate bird on slate asphalt vanishes. Real city pigeons are a pale
    # dove grey with a DARK wing and tail — that internal contrast is the whole
    # silhouette at 34x28.
    body = mix(SLATE, CHALK, 0.34)
    body_d = SLATE
    body_l = mix(SLATE, CHALK, 0.62)
    wing = shade(SLATE, 0.62)
    wing_l = shade(SLATE, 0.82)
    ground = h - 4

    # feet
    for fx in (30, 40):
        c.line([(fx, ground - 11), (fx, ground - 4)], shade(RUST, 0.86), 3.4)
        c.line([(fx - 5, ground - 3), (fx + 5, ground - 3)], shade(RUST, 0.86), 2.8)
    # tail — a clean dark wedge sticking out past the body
    c.poly([(43, 24), (63, 32), (61, 43), (42, 37)], fill=shade(SLATE, 0.50))
    c.poly([(43, 25), (59, 32), (58, 38), (42, 33)], fill=wing)
    for k in range(3):
        c.line([(47, 28 + k * 3), (60, 34 + k * 2.6)], shade(SLATE, 0.44), 1.4)
    # body
    c.ellipse([15, 19, 54, 48], fill=body_d)
    c.ellipse([15, 17, 50, 43], fill=body)
    # breast, catching the light
    c.ellipse([13, 22, 34, 46], fill=body_l)
    c.ellipse([15, 24, 29, 41], fill=mix(body_l, CHALK, 0.35))
    # wing — the dark mass that makes the bird read
    c.poly([(25, 24), (51, 27), (55, 39), (36, 42), (25, 33)], fill=shade(SLATE, 0.48))
    c.poly([(26, 25), (48, 28), (51, 37), (35, 39), (27, 32)], fill=wing)
    c.poly([(26, 25), (44, 27), (45, 32), (28, 31)], fill=wing_l)
    for k in range(3):
        c.line([(30 + k * 3, 33 + k * 2.4), (50 + k, 34 + k * 2.2)],
               shade(SLATE, 0.42), 1.6)
    # head + neck
    c.circle(22, 17, 12, fill=body_d)
    c.circle(21, 15, 11, fill=body)
    c.circle(19, 13, 7.5, fill=body_l)
    # iridescent throat
    c.ellipse([16, 22, 31, 33], fill=mix(PATINA, SLATE, 0.45))
    c.ellipse([17, 23, 27, 30], fill=mix(PATINA, CHALK, 0.30))
    # beak
    c.poly([(13, 15), (4, 19), (13, 23)], fill=shade(GALV, 0.72))
    c.poly([(13, 15), (7, 18.2), (13, 19.5)], fill=mix(CLOTH["oat"], PAPER, 0.3))
    c.circle(13, 15, 2.4, fill=body_l)
    # eye — big and cartoon, it is what tells you which end is the head
    c.circle(17, 13, 4.0, fill=CHALK)
    c.circle(17, 13, 2.6, fill=INK)
    c.circle(16.0, 12.0, 1.1, fill=CHALK)
    return ak.finish(c, ink=3, light=True, light_strength=0.8, grain_amt=5, seed=16)


# ================================================================== laundry
def _pins(c, x0, x1, top):
    pin = mix(CLOTH["oat"], BROWNSTONE, 0.25)
    for x in (x0, x1):
        c.rrect([x - 3, top - 6, x + 3, top + 7], 2, fill=shade(pin, 0.78))
        c.rrect([x - 3, top - 6, x + 1, top + 5], 2, fill=pin)
        c.line([(x, top - 4), (x, top + 5)], shade(pin, 0.6), 1.2)


def _folds(c, pts_pairs, col, rnd):
    for (p0, p1) in pts_pairs:
        c.line(jitter_path(p0, p1, rnd, 4, 1.4), shade(col, 0.84), 2.0)


def build_shirt():
    """44x58 world. Work shirt on the line."""
    w, h = W(44, 58)
    c = Canvas(w, h)
    rnd = random.Random(101)
    col = CLOTH["dustblue"]
    dk = shade(col, 0.78)
    dd = shade(col, 0.62)
    lt = mix(col, CHALK, 0.24)
    top = 14

    _pins(c, 24, 62, top - 4)
    # sleeves first so the body overlaps them at the shoulder seam
    c.form_capsule((24, top + 12), (14, 74), 21, 17, col, dk)
    c.form_capsule((62, top + 12), (72, 74), 21, 17, dk, shade(col, 0.66))
    c.capsule((14, 76), (15, 81), 17, 16, dd)
    c.capsule((72, 76), (71, 81), 17, 16, shade(col, 0.58))
    # body: shoulders sag between the pins, hem waves
    body = [(18, top + 1), (30, top + 8), (44, top + 13), (58, top + 8),
            (70, top + 1), (75, 46), (72, 92), (74, 102), (60, 95),
            (44, 104), (28, 95), (13, 101), (16, 92), (14, 46)]
    c.poly(body, fill=dk)
    c.poly([(18, top + 1), (44, top + 13), (62, top + 6), (66, 46),
            (64, 94), (44, 104), (28, 95), (16, 99), (16, 46)], fill=col)
    c.poly([(19, top + 3), (32, top + 7), (32, 92), (19, 96), (17, 50)],
           fill=lt)
    # shoulder seams
    c.line([(22, top + 10), (30, top + 6)], dd, 2.2)
    c.line([(64, top + 9), (58, top + 6)], dd, 2.2)
    # collar
    c.poly([(32, top - 1), (56, top - 1), (52, top + 15), (44, top + 9),
            (36, top + 15)], fill=lt)
    c.poly([(32, top - 1), (44, top + 4), (36, top + 15)], fill=shade(lt, 0.84))
    c.line([(36, top + 14), (44, top + 8), (52, top + 14)], dd, 1.8)
    # placket + buttons
    c.rect([41, top + 8, 48, 98], fill=lt)
    c.line([(41, top + 8), (41, 98)], dd, 1.6)
    for k in range(4):
        c.circle(44.5, top + 24 + k * 20, 2.2,
                 fill=mix(CLOTH["cream"], BROWNSTONE, 0.2))
    # pocket
    c.rect([24, 44, 38, 58], fill=shade(col, 0.90))
    c.line([(24, 44), (38, 44)], dd, 1.6)
    _folds(c, [((26, 44), (30, 90)), ((58, 46), (56, 92)),
               ((36, 62), (38, 96))], col, rnd)
    return ak.finish(c, ink=3, light=True, grain_amt=6, seed=17)


def build_union():
    """36x58 world. Union suit — long johns, legs apart."""
    w, h = W(36, 58)
    c = Canvas(w, h)
    rnd = random.Random(103)
    col = mix(CLOTH["cream"], CLOTH["rose"], 0.34)
    dk = shade(col, 0.78)
    dd = shade(col, 0.62)
    lt = mix(col, CHALK, 0.26)
    top = 14

    _pins(c, 20, 52, top - 4)
    # stubby arms
    c.form_capsule((18, top + 12), (11, 52), 17, 14, col, dk)
    c.form_capsule((54, top + 12), (58, 52), 17, 14, dk, dd)
    # legs, with a real gap between them
    c.form_capsule((23, 60), (19, 96), 22, 18, col, dk)
    c.form_capsule((49, 60), (51, 96), 22, 18, dk, dd)
    c.capsule((19, 97), (19, 101), 18, 17, dd)
    c.capsule((51, 97), (51, 101), 18, 17, shade(col, 0.56))
    # torso
    c.poly([(14, top + 1), (36, top + 11), (58, top + 2), (60, 40),
            (57, 70), (36, 76), (15, 70), (12, 40)], fill=dk)
    c.poly([(14, top + 1), (36, top + 11), (52, top + 3), (54, 40),
            (52, 70), (36, 75), (16, 68), (14, 40)], fill=col)
    c.poly([(15, top + 3), (26, top + 5), (26, 68), (16, 66)], fill=lt)
    # neck opening — a small dark scoop under a light collar band, not a
    # pale egg sitting on the chest
    c.ellipse([28, top + 2, 44, top + 13], fill=shade(col, 0.60))
    c.ellipse([28, top + 1, 44, top + 8], fill=lt)
    c.ellipse([30, top + 3, 42, top + 8], fill=shade(col, 0.66))
    # buttoned rear flap
    c.rrect([20, 40, 52, 68], 5, fill=shade(col, 0.92))
    c.line([(20, 41), (52, 40)], dd, 2.2)
    for k in range(3):
        c.circle(24 + k * 12, 40, 2.2, fill=mix(CLOTH["cream"], BROWNSTONE, 0.25))
    # placket buttons up the chest
    for k in range(3):
        c.circle(35, top + 14 + k * 8, 1.9, fill=mix(CLOTH["cream"], BROWNSTONE, 0.2))
    _folds(c, [((24, 26), (26, 62)), ((46, 28), (45, 64)),
               ((24, 78), (23, 98)), ((48, 78), (49, 96))], col, rnd)
    return ak.finish(c, ink=3, light=True, grain_amt=6, seed=18)


def build_dress():
    """44x58 world."""
    w, h = W(44, 58)
    c = Canvas(w, h)
    rnd = random.Random(107)
    col = CLOTH["plum"]
    dk = shade(col, 0.78)
    lt = mix(col, CHALK, 0.24)
    top = 12
    _pins(c, 30, 58, top - 2)
    # bodice
    c.poly([(24, top), (44, top + 8), (64, top + 1), (66, 30), (62, 52),
            (26, 52), (22, 30)], fill=dk)
    c.poly([(24, top), (44, top + 8), (58, top + 2), (58, 30),
            (56, 52), (26, 52), (24, 30)], fill=col)
    c.poly([(26, top + 3), (36, top + 2), (35, 52), (27, 50)], fill=lt)
    # skirt
    skirt = [(24, 50), (64, 50), (80, 96), (76, 104), (66, 98), (56, 106),
             (44, 98), (32, 106), (20, 98), (10, 104), (8, 96)]
    c.poly(skirt, fill=dk)
    c.poly([(26, 50), (58, 50), (70, 98), (56, 104), (44, 98), (30, 104),
            (16, 98)], fill=col)
    c.poly([(27, 51), (37, 51), (28, 100), (17, 97)], fill=lt)
    # belt
    c.rect([22, 46, 66, 54], fill=shade(col, 0.66))
    c.rect([22, 46, 66, 49], fill=shade(lt, 0.92))
    # collar
    c.poly([(34, top), (54, top), (50, top + 13), (44, top + 8),
            (38, top + 13)], fill=mix(CLOTH["cream"], PAPER, 0.3))
    # short sleeves
    c.poly([(22, top + 6), (30, top + 4), (28, 34), (16, 32)], fill=col)
    c.poly([(58, top + 6), (68, top + 8), (70, 34), (58, 34)], fill=dk)
    _folds(c, [((34, 58), (30, 100)), ((52, 58), (56, 100)),
               ((44, 60), (44, 96)), ((40, 20), (40, 44))], col, rnd)
    return ak.finish(c, ink=3, light=True, grain_amt=6, seed=19)


# ================================================================== tiles
def build_brick_tile():
    """128x128 world, seamless. Sooty tenement brick, running bond."""
    w, h = W(128, 128)
    t = Tile(w, h)
    rnd = random.Random(211)
    mortar = mix(BRICK_D, ASPHALT_L, 0.55)
    t.rect([0, 0, w, h], fill=mortar)
    for _ in range(420):
        t.circle(rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(0.6, 1.5),
                 fill=rnd.choice([shade(mortar, 0.88), shade(mortar, 1.10)]))

    bw = w / 4.0
    rows = 12
    bh = h / rows
    # ONE brick colour, varied in value only. A wide hue spread (pink / mauve /
    # ochre bricks side by side) reads as confetti from across the street and
    # fights the kids; 1926 soot-caked tenement brick is nearly monochrome.
    base_brick = mix(BRICK, ASPHALT, 0.34)
    fam = [shade(base_brick, f) for f in (0.80, 0.88, 0.94, 1.0, 1.07, 1.14)]
    for r in range(rows):
        y0 = r * bh
        off = 0 if r % 2 == 0 else bw * 0.5
        for k in range(-1, 5):
            x0 = k * bw + off
            col = rnd.choice(fam)
            col = tuple(max(0, min(255, v + rnd.randint(-3, 3))) for v in col)
            bx0, by0 = x0 + 2.4, y0 + 2.4
            bx1, by1 = x0 + bw - 2.4, y0 + bh - 2.4
            t.rect([bx0, by0, bx1, by1], fill=shade(col, 0.84))
            t.rect([bx0, by0, bx1 - 1.6, by1 - 1.6], fill=col)
            t.rect([bx0, by0, bx1 - 1.6, by0 + 2.0], fill=shade(col, 1.14))
            t.rect([bx0, by0, bx0 + 1.8, by1 - 1.6], fill=shade(col, 1.09))
            # joint shadow under the brick
            t.rect([bx0 - 2.4, by1, bx1 + 2.4, by1 + 2.4],
                   fill=shade(mortar, 0.72))
            for _ in range(6):
                t.circle(rnd.uniform(bx0, bx1), rnd.uniform(by0, by1),
                         rnd.uniform(0.6, 1.4),
                         fill=rnd.choice([shade(col, 0.90), shade(col, 1.08)]))
            if rnd.random() < 0.14:
                px = rnd.uniform(bx0 + 3, bx1 - 8)
                py = rnd.uniform(by0 + 2, by1 - 3)
                t.poly([(px, py), (px + rnd.uniform(4, 9), py - 1),
                        (px + 5, py + rnd.uniform(2, 4))], fill=shade(col, 0.76))
    img = ak.finish(t.c, ink=0, light=False, grain_amt=6, seed=20)

    # soot drift + grime running down the wall, blurred on the torus
    soot = Tile(w, h)
    for _ in range(40):
        x = rnd.uniform(0, w)
        y = rnd.uniform(0, h)
        rx = rnd.uniform(14, 36)
        soot.ellipse([x - rx, y - rx * 0.62, x + rx, y + rx * 0.62],
                     fill=(24, 20, 18, rnd.randint(10, 24)))
    for _ in range(16):
        x = rnd.uniform(0, w)
        y = rnd.uniform(0, h)
        soot.poly([(x, y), (x + rnd.uniform(5, 13), y),
                   (x + rnd.uniform(3, 11), y + rnd.uniform(30, 90)),
                   (x - 2, y + rnd.uniform(30, 90))],
                  fill=(22, 18, 16, rnd.randint(10, 20)))
    img.alpha_composite(wrap_blur(soot.c.resolve(), 13))
    return img


def build_asphalt_tile():
    """128x128 world, seamless. The quietest thing on screen."""
    w, h = W(128, 128)
    t = Tile(w, h)
    rnd = random.Random(223)
    t.rect([0, 0, w, h], fill=ASPHALT_D)

    # Worn patches. The eye finds a tile repeat through the LARGEST features,
    # so the low-frequency layer has to be many small overlapping stains at
    # near-nothing alpha rather than a few big blobs — three fat tar wedges is
    # what turned a street of this into a visible chevron pattern.
    patch = Tile(w, h)
    for _ in range(34):
        x = rnd.uniform(0, w)
        y = rnd.uniform(0, h)
        rx = rnd.uniform(14, 34)
        ry = rx * rnd.uniform(0.6, 1.1)
        col = ASPHALT if rnd.random() < 0.62 else shade(ASPHALT_D, 0.88)
        patch.ellipse([x - rx, y - ry, x + rx, y + ry],
                      fill=col + (rnd.randint(12, 26),))
    pim = wrap_blur(patch.c.resolve(), 18)

    base = ak.finish(t.c, ink=0, light=False, grain_amt=0, seed=21)
    base.alpha_composite(pim)

    # detail pass on top of the soft patches
    t2 = Tile(w, h)
    # tar patches — irregular blobs, never straight lines (a repeated straight
    # seam turns the whole street into visible graph paper). Small and barely
    # separated in value so no single one becomes the "logo" of the repeat.
    for _ in range(9):
        x = rnd.uniform(0, w)
        y = rnd.uniform(0, h)
        n = 9
        rot = rnd.uniform(0, 360)
        sx = rnd.uniform(0.9, 1.6)
        pts = []
        for k in range(n):
            a = 360.0 * k / n + rot
            rr = rnd.uniform(9, 17)
            pts.append(epoint(x, y, rr * sx, rr / sx, a))
        t2.poly(pts, fill=shade(ASPHALT_D, 0.945))
        t2.poly([(px, py - 1.5) for px, py in pts], fill=shade(ASPHALT_D, 0.985))
    # cracks
    for _ in range(7):
        x0 = rnd.uniform(0, w)
        y0 = rnd.uniform(0, h)
        ang = rnd.uniform(0, 360)
        ln = rnd.uniform(20, 48)
        p1 = (x0 + math.cos(math.radians(ang)) * ln,
              y0 + math.sin(math.radians(ang)) * ln)
        path = jitter_path((x0, y0), p1, rnd, 6, 3.4)
        t2.line(path, shade(ASPHALT_D, 0.82), 1.8)
        t2.line([(px, py - 1.4) for px, py in path], shade(ASPHALT_D, 1.08), 1.0)
        if rnd.random() < 0.7:
            mid = path[len(path) // 2]
            p2 = (mid[0] + rnd.uniform(-24, 24), mid[1] + rnd.uniform(-24, 24))
            t2.line(jitter_path(mid, p2, rnd, 4, 2.6), shade(ASPHALT_D, 0.84), 1.4)
    # aggregate grit: even coverage on a jittered grid, barely-there contrast
    grit = [shade(ASPHALT_D, 0.86), shade(ASPHALT_D, 1.14),
            mix(ASPHALT_D, ASPHALT, 0.70), shade(ASPHALT_D, 0.78)]
    step = 5.0
    for iy in range(int(h / step)):
        for ix in range(int(w / step)):
            if rnd.random() < 0.42:
                continue
            t2.circle(ix * step + rnd.uniform(0, step),
                      iy * step + rnd.uniform(0, step),
                      rnd.uniform(0.6, 1.5), fill=rnd.choice(grit))
    for _ in range(40):
        t2.circle(rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(0.7, 1.3),
                  fill=mix(ASPHALT, ASPHALT_L, 0.6))
    base.alpha_composite(t2.c.resolve())
    return ak.grain(base, 7, 22)


def build_sidewalk_tile():
    """128x128 world, seamless. Concrete flags, joints offset row to row so
    the repeat never reads as a checkerboard."""
    w, h = W(128, 128)
    t = Tile(w, h)
    rnd = random.Random(227)
    joint = shade(CONCRETE, 0.62)
    t.rect([0, 0, w, h], fill=joint)

    half = h / 2.0
    for gy in range(2):
        off = 0.0 if gy == 0 else half * 0.5
        for gx in range(-1, 3):
            x0 = gx * half + off + 3
            y0 = gy * half + 3
            x1 = x0 + half - 6
            y1 = y0 + half - 6
            dv = rnd.randint(-5, 5)   # value only: hue drift reads as a checker
            col = tuple(max(0, min(255, v + dv)) for v in CONCRETE)
            t.rect([x0, y0, x1, y1], fill=shade(col, 0.94))
            t.rect([x0, y0, x1 - 2, y1 - 2], fill=col)
            t.rect([x0, y0, x1 - 2, y0 + 2], fill=shade(col, 1.06))
            t.rect([x0, y0, x0 + 2, y1 - 2], fill=shade(col, 1.04))
            for _ in range(4):
                cx = rnd.choice([x0, x1]) + rnd.uniform(-5, 5)
                cy = rnd.choice([y0, y1]) + rnd.uniform(-5, 5)
                t.poly([(cx, cy), (cx + rnd.uniform(3, 8), cy + rnd.uniform(-4, 4)),
                        (cx + rnd.uniform(-3, 4), cy + rnd.uniform(3, 7))],
                       fill=shade(col, 0.80))
            if rnd.random() < 0.4:
                px = rnd.uniform(x0 + 10, x1 - 10)
                py = rnd.uniform(y0 + 10, y1 - 10)
                t.line(jitter_path((px, py),
                                   (px + rnd.uniform(-34, 34), py + rnd.uniform(-34, 34)),
                                   rnd, 5, 3.0), shade(col, 0.78), 1.6)
            for _ in range(150):
                t.circle(rnd.uniform(x0, x1), rnd.uniform(y0, y1),
                         rnd.uniform(0.5, 1.4),
                         fill=rnd.choice([shade(col, 0.88), shade(col, 1.07),
                                          shade(col, 0.94)]))
    img = ak.finish(t.c, ink=0, light=False, grain_amt=6, seed=23)
    stain = Tile(w, h)
    for _ in range(12):
        x = rnd.uniform(0, w)
        y = rnd.uniform(0, h)
        rx = rnd.uniform(16, 46)
        stain.ellipse([x - rx, y - rx * 0.7, x + rx, y + rx * 0.7],
                      fill=(48, 42, 36, rnd.randint(14, 30)))
    img.alpha_composite(wrap_blur(stain.c.resolve(), 13))
    return img


def build_curb():
    """128x40 world, tiles horizontally. Light top, mid face, dark gutter."""
    w, h = W(128, 40)
    t = Tile(w, h, wrap_x=True, wrap_y=False)
    rnd = random.Random(229)
    top = mix(CONCRETE, PAPER, 0.20)
    face = shade(CONCRETE, 0.80)
    face_d = shade(CONCRETE, 0.62)
    gutter = shade(ASPHALT_D, 0.88)

    t.rect([0, 0, w, h], fill=gutter)
    t.rect([0, 0, w, 18], fill=top)                      # sunlit top surface
    t.rect([0, 13, w, 20], fill=shade(top, 0.90))        # nose
    t.rect([0, 20, w, 56], fill=face)                    # face
    t.rect([0, 40, w, 56], fill=shade(face, 0.92))
    t.rect([0, 49, w, 57], fill=face_d)                  # face, in shadow
    t.rect([0, 56, w, 61], fill=shade(ASPHALT_D, 0.60))  # base shadow line
    # section joints, quiet
    for jx in (0.0, w * 0.5):
        t.rect([jx - 1.6, 0, jx + 1.6, 57], fill=shade(CONCRETE, 0.66))
        t.rect([jx + 1.6, 0, jx + 3.0, 57], fill=shade(top, 1.04))

    def band(y):
        if y < 13:
            return top
        if y < 20:
            return shade(top, 0.90)
        if y < 40:
            return face
        if y < 49:
            return shade(face, 0.92)
        if y < 57:
            return face_d
        if y < 61:
            return shade(ASPHALT_D, 0.60)
        return gutter

    # the nose is chipped, so the top/face break is never a ruled line
    for _ in range(16):
        x = rnd.uniform(0, w)
        t.poly([(x, 18), (x + rnd.uniform(4, 11), 18),
                (x + rnd.uniform(1, 7), 18 + rnd.uniform(3, 7))],
               fill=shade(top, 0.84))
    for _ in range(9):
        x = rnd.uniform(0, w)
        t.poly([(x, 18), (x + rnd.uniform(3, 9), 18),
                (x + rnd.uniform(1, 6), 18 - rnd.uniform(2, 5))],
               fill=shade(face, 1.06))
    # aggregate — tinted off whatever band it lands on, so light flecks never
    # get scattered across a dark band like confetti
    for _ in range(560):
        y = rnd.uniform(0, 57)
        c0 = band(y)
        t.circle(rnd.uniform(0, w), y, rnd.uniform(0.4, 1.1),
                 fill=rnd.choice([shade(c0, 0.93), shade(c0, 1.05)]))
    for _ in range(200):
        y = rnd.uniform(58, h)
        c0 = band(y)
        t.circle(rnd.uniform(0, w), y, rnd.uniform(0.5, 1.3),
                 fill=rnd.choice([shade(c0, 1.12), shade(c0, 0.88)]))
    return ak.finish(t.c, ink=0, light=False, grain_amt=6, seed=24)


def build_cornice():
    """128x48 world, tiles horizontally. Few bands, big value steps."""
    w, h = W(128, 48)
    t = Tile(w, h, wrap_x=True, wrap_y=False)
    rnd = random.Random(233)
    stone = mix(BROWNSTONE, PAPER, 0.20)   # warmer than the generic STONE
    lt = mix(stone, PAPER, 0.40)
    md = stone
    dk = shade(stone, 0.66)
    vd = shade(stone, 0.32)

    t.rect([0, 0, w, h], fill=md)
    # crown slab, catching the sun
    t.rect([0, 0, w, 20], fill=lt)
    t.rect([0, 16, w, 23], fill=shade(lt, 0.80))
    # the deep shadow under the projection — the line that sells the overhang
    t.rect([0, 23, w, 33], fill=vd)
    # dentil course
    per = 32.0
    nd = int(w / per)
    for k in range(nd):
        x0 = k * per + 5
        t.rect([x0 + 20, 33, x0 + per + 5, 59], fill=vd)   # the gap behind
    for k in range(nd):
        x0 = k * per + 5
        t.rect([x0, 33, x0 + 20, 59], fill=md)
        t.rect([x0, 33, x0 + 20, 39], fill=lt)             # lit top of the block
        t.rect([x0 + 15, 33, x0 + 20, 59], fill=dk)        # its own side shade
        t.rect([x0, 55, x0 + 20, 59], fill=shade(md, 0.80))
    # bed mould
    t.rect([0, 59, w, 67], fill=lt)
    t.rect([0, 65, w, 72], fill=dk)
    # frieze fading into the wall
    t.rect([0, 72, w, h], fill=shade(stone, 0.56))
    t.rect([0, 88, w, h], fill=shade(stone, 0.44))

    def band(x, y):
        if y < 16:
            return lt
        if y < 23:
            return shade(lt, 0.80)
        if y < 33:
            return vd
        if y < 59:
            xm = x % per
            if 5 <= xm < 20:
                return lt if y < 39 else md
            if 20 <= xm < 25:
                return dk
            return vd
        if y < 65:
            return lt
        if y < 72:
            return dk
        if y < 88:
            return shade(stone, 0.56)
        return shade(stone, 0.44)

    # weathering, restrained, tinted off the band it lands on
    for _ in range(620):
        x = rnd.uniform(0, w)
        y = rnd.uniform(0, h)
        c0 = band(x, y)
        t.circle(x, y, rnd.uniform(0.4, 1.1),
                 fill=rnd.choice([shade(c0, 0.92), shade(c0, 1.06)]))
    for _ in range(9):
        x = rnd.uniform(0, w)
        t.line(jitter_path((x, 72), (x + rnd.uniform(-4, 4), h), rnd, 3, 1.4),
               (46, 40, 34, 26), 2.6)
    return ak.finish(t.c, ink=0, light=False, grain_amt=6, seed=25)


# ================================================================== misc
def build_shadow():
    """128x40 world. Pure alpha blob, no ink."""
    w, h = W(128, 40)
    c = Canvas(w, h)
    cx, cy = w * 0.5, h * 0.5
    for k, a in ((1.00, 46), (0.80, 52), (0.58, 58), (0.34, 62)):
        c.ellipse([cx - w * 0.46 * k, cy - h * 0.42 * k,
                   cx + w * 0.46 * k, cy + h * 0.42 * k],
                  fill=(22, 18, 16, a))
    img = ak.finish(c, ink=0, light=False, grain_amt=0)
    return img.filter(ImageFilter.GaussianBlur(4.5))


def build_bat():
    """120x28 world. Broom handle, friction tape at the grip."""
    w, h = W(120, 28)
    c = Canvas(w, h)
    rnd = random.Random(239)
    wood = mix(CLOTH["dust"], BROWNSTONE, 0.44)
    p0 = (16, 38)
    p1 = (w - 16, 20)

    def at(t):
        return (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)

    c.form_capsule(p0, p1, 21, 23, wood, shade(wood, 0.70))
    # grain
    for k in (-4.5, 0.5, 5.0):
        c.line([(at(0.06)[0], at(0.06)[1] + k), (at(0.97)[0], at(0.97)[1] + k)],
               shade(wood, 0.86), 1.3)
    # dings on the barrel
    for _ in range(9):
        t = rnd.uniform(0.5, 0.97)
        p = at(t)
        c.circle(p[0], p[1] + rnd.uniform(-6, 6), rnd.uniform(1.1, 2.3),
                 fill=shade(wood, 0.74))
    # sawn end
    e = at(1.0)
    c.ellipse([e[0] - 4.5, e[1] - 11.5, e[0] + 4.5, e[1] + 11.5],
              fill=mix(wood, PAPER, 0.10))
    c.ellipse([e[0] - 2.6, e[1] - 7, e[0] + 2.6, e[1] + 7],
              fill=shade(wood, 0.80))

    # friction tape — one dark mass, seams read as the wrap
    tape = (58, 54, 52)
    g0, g1 = 0.02, 0.44
    a, b = at(g0), at(g1)
    c.capsule(a, b, 24, 26, tape)
    c.capsule((a[0], a[1] - 3), (b[0], b[1] - 3), 15, 16, shade(tape, 1.28))
    k = 0
    while g0 + k * 0.052 < g1 - 0.01:
        p = at(g0 + k * 0.052)
        c.poly([(p[0] - 3, p[1] - 14), (p[0] - 1.4, p[1] - 14),
                (p[0] + 4, p[1] + 14), (p[0] + 2.4, p[1] + 14)],
               fill=shade(tape, 0.68))
        k += 1
    # frayed tape end
    pe = at(g1)
    for k in range(4):
        yy = pe[1] - 10 + k * 6
        c.poly([(pe[0] - 2, yy), (pe[0] + rnd.uniform(3, 9), yy + 1.5),
                (pe[0] - 2, yy + 4)], fill=shade(tape, 1.1))
    # knob at the very end of the grip
    kb = at(-0.01)
    c.ellipse([kb[0] - 5, kb[1] - 14, kb[0] + 5, kb[1] + 14], fill=shade(tape, 0.8))
    return ak.finish(c, ink=3, light=True, grain_amt=6, seed=26)


# ================================================================== registry
BUILDERS = {
    "prp_spaldeen": build_spaldeen,
    "prp_manhole": build_manhole,
    "prp_sewer": build_sewer,
    "prp_hydrant": build_hydrant,
    "prp_stoop": build_stoop,
    "prp_model_t": build_model_t,
    "prp_fire_escape": build_fire_escape,
    "prp_lamp": build_lamp,
    "prp_window": build_window,
    "prp_window_broken": build_window_broken,
    "prp_trash": build_trash,
    "prp_crate": build_crate,
    "prp_awning": build_awning,
    "prp_pigeon": build_pigeon,
    "prp_shirt": build_shirt,
    "prp_union": build_union,
    "prp_dress": build_dress,
    "prp_brick_tile": build_brick_tile,
    "prp_asphalt_tile": build_asphalt_tile,
    "prp_sidewalk_tile": build_sidewalk_tile,
    "prp_curb": build_curb,
    "prp_cornice": build_cornice,
    "prp_shadow": build_shadow,
    "prp_bat": build_bat,
}

# world sizes, for sanity-checking the output
WORLD = {
    "prp_spaldeen": (24, 24), "prp_manhole": (140, 64), "prp_sewer": (120, 52),
    "prp_hydrant": (64, 96), "prp_stoop": (150, 110), "prp_model_t": (256, 128),
    "prp_fire_escape": (120, 300), "prp_lamp": (40, 190),
    "prp_window": (56, 76), "prp_window_broken": (56, 76),
    "prp_trash": (70, 86), "prp_crate": (84, 62), "prp_awning": (180, 70),
    "prp_pigeon": (34, 28), "prp_shirt": (44, 58), "prp_union": (36, 58),
    "prp_dress": (44, 58), "prp_brick_tile": (128, 128),
    "prp_asphalt_tile": (128, 128), "prp_sidewalk_tile": (128, 128),
    "prp_curb": (128, 40), "prp_cornice": (128, 48), "prp_shadow": (128, 40),
    "prp_bat": (120, 28),
}


def build(outdir, only=None):
    """Render every prop into outdir. Returns {name: (w, h)}."""
    os.makedirs(outdir, exist_ok=True)
    made = {}
    for name, fn in BUILDERS.items():
        if only and name not in only:
            continue
        img = fn()
        want = W(*WORLD[name])
        if img.size != want:
            raise AssertionError("%s is %s, expected %s" % (name, img.size, want))
        ak.save(img, os.path.join(outdir, name + ".png"))
        made[name] = img.size
    return made


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/art_props"
    sel = sys.argv[2:] or None
    for k, v in sorted(build(out, sel).items()):
        print("%-22s %dx%d" % (k, v[0], v[1]))

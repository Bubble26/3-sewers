#!/usr/bin/env python3
"""THREE SEWERS — the street canyon: facades, skyline, chalk.

These are the big quiet pieces. Everything in here sits BEHIND the game, so
the rule that governs the file is restraint: the walls are dark, the skyline
is haze, and the only thing allowed to be bright is a kid's chalk.

    python3 art_world.py [outdir] [names...]

Facades tile on a torus in both axes (match_view draws them with
texture_repeat and a region larger than the art), so every primitive is
replayed at its wrapping offsets. One vertical repeat is one tenement:
cornice at the top, storeys of windows, shopfront at the pavement — so a
column of repeats reads as a block of buildings receding up the street.
"""
import math
import os
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import artkit as ak  # noqa: E402
from artkit import (ASPHALT, ASPHALT_D, ASPHALT_L, BRICK, BRICK_D, BRICK_L,  # noqa: E402
                    BROWNSTONE, CHALK, CLOTH, GOLD, INK, IRON, PAPER, PATINA,
                    RUST, SLATE, Canvas, mix, shade)

S = 2  # assets are authored at 2x world size


def W(*vals):
    """world units -> asset pixels."""
    if len(vals) == 1:
        return vals[0] * S
    return tuple(v * S for v in vals)


# ------------------------------------------------------------------ helpers
def wrap_blur(img, radius):
    """Blur that wraps the tile edges, so soft passes never make a seam."""
    w, h = img.size
    big = Image.new("RGBA", (w * 3, h * 3), (0, 0, 0, 0))
    for i in range(3):
        for j in range(3):
            big.alpha_composite(img, (i * w, j * h))
    big = big.filter(ImageFilter.GaussianBlur(radius))
    return big.crop((w, h, w * 2, h * 2))


class Tile:
    """Canvas on a torus — primitives are replayed at wrapping offsets."""

    def __init__(self, w, h, wrap_x=True, wrap_y=True, ss=ak.SS):
        self.c = Canvas(w, h, ss)
        self.w, self.h = w, h
        self.wx, self.wy = wrap_x, wrap_y

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

    def text(self, xy, s, f, fill, anchor="mm"):
        self.c.text(xy, s, f, fill, anchor)


def vgrad_alpha(img, stops):
    """Multiply an image's alpha by a piecewise-linear vertical ramp.

    stops: [(y_fraction, factor), ...] ascending.
    """
    w, h = img.size
    ramp = Image.new("L", (1, h))
    px = ramp.load()
    for y in range(h):
        t = y / max(1, h - 1)
        f = stops[-1][1]
        for i in range(len(stops) - 1):
            y0, f0 = stops[i]
            y1, f1 = stops[i + 1]
            if t <= y1:
                k = 0.0 if y1 <= y0 else (t - y0) / (y1 - y0)
                f = f0 + (f1 - f0) * max(0.0, min(1.0, k))
                break
        px[0, y] = max(0, min(255, int(f * 255)))
    ramp = ramp.resize((w, h))
    a = ImageChops.multiply(img.getchannel("A"), ramp)
    out = img.copy()
    out.putalpha(a)
    return out


def noise_img(w, h, rnd, lo=0, hi=255, cell=1, blur=0.0):
    """Cheap value noise: random at 1/cell resolution, smoothly upsampled."""
    nw, nh = max(1, w // cell), max(1, h // cell)
    n = Image.new("L", (nw, nh))
    n.putdata([rnd.randint(lo, hi) for _ in range(nw * nh)])
    n = n.resize((w, h), Image.BICUBIC)
    if blur:
        n = n.filter(ImageFilter.GaussianBlur(blur))
    return n


# ================================================================== facades
# Palette for the walls. Everything here is pushed toward asphalt on purpose:
# these are the quietest surfaces in the game.
BRICK_WALL = shade(mix(BRICK, ASPHALT, 0.50), 0.84)
STONE_WALL = shade(mix(BROWNSTONE, SLATE, 0.48), 0.78)
GLASS_DK = shade(mix(IRON, SLATE, 0.30), 0.92)
LAMPLIT = shade(mix(mix(GOLD, BRICK_D, 0.44), ASPHALT, 0.30), 0.94)
SHADE_CLOTH = shade(mix(CLOTH["oat"], ASPHALT, 0.46), 0.90)


def _wall(t, w, h, rnd, base, course, joints=False, seed_mul=1):
    """Sooted masonry: flat base, course lines, mottling, grime drift."""
    t.rect([-4, -4, w + 4, h + 4], fill=base)

    dark = shade(base, 0.80)
    lite = shade(base, 1.10)
    # broad tonal patches so the wall isn't a flat rectangle
    for _ in range(240):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        rx, ry = rnd.uniform(16, 110), rnd.uniform(9, 52)
        f = rnd.uniform(0.86, 1.12)
        t.ellipse([x - rx, y - ry, x + rx, y + ry], fill=shade(base, f))

    # course lines (mortar). thin, low contrast, no moire at game size
    rows = int(round(h / course))
    ch = h / rows
    for r in range(rows):
        y = r * ch
        t.rect([-4, y, w + 4, y + 1.6], fill=shade(base, 0.80))
        t.rect([-4, y + 1.6, w + 4, y + 2.6], fill=shade(base, 1.05))
        if joints:
            # ashlar: staggered vertical joints
            per = w / 5.0
            off = 0 if r % 2 == 0 else per * 0.5
            k = -1
            while off + k * per < w + per:
                x = off + k * per
                t.rect([x, y, x + 1.6, y + ch], fill=shade(base, 0.82))
                k += 1

    # individual units catching or losing the light
    for _ in range(1500):
        x = rnd.uniform(0, w)
        r = rnd.randrange(rows)
        y = r * ch + 3
        bw = rnd.uniform(9, 22)
        t.rect([x, y, x + bw, y + ch - 3.6],
               fill=shade(base, rnd.uniform(0.90, 1.08) if joints
                          else rnd.uniform(0.84, 1.14)))
    # grit
    for _ in range(2200):
        t.circle(rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(0.5, 1.4),
                 fill=rnd.choice([dark, lite, shade(base, 0.88)]))


def _soot(t, w, h, rnd, bands=(), n_blot=34, n_run=22):
    """Coal soot and rain-grime, blurred on the torus."""
    s = Tile(w, h, ss=2)
    for _ in range(n_blot):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        rx = rnd.uniform(40, 170)
        s.ellipse([x - rx, y - rx * 0.48, x + rx, y + rx * 0.48],
                  fill=(20, 17, 15, rnd.randint(20, 46)))
    for _ in range(n_run):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        ln = rnd.uniform(120, 380)
        wd = rnd.uniform(5, 26)
        s.poly([(x, y), (x + wd, y), (x + wd * 0.55, y + ln), (x - 3, y + ln)],
               fill=(18, 15, 13, rnd.randint(16, 32)))
    # dirt collects in the sheltered courses — under the cornice, over the shop
    for y0, y1, a in bands:
        for k in range(26):
            f = k / 25.0
            s.rect([-6, y0 + (y1 - y0) * f, w + 6, y0 + (y1 - y0) * (f + 0.06)],
                   fill=(18, 15, 13, int(a * (1.0 - f) ** 1.4)))
    return wrap_blur(s.c.resolve(), 15)


def _lintel(t, cx, y, ww, stone):
    """Stone lintel over an opening: lit top face, hard shadow underneath."""
    lw = ww + 20
    t.rect([cx - lw / 2, y - 15, cx + lw / 2, y], fill=stone)
    t.rect([cx - lw / 2, y - 15, cx + lw / 2, y - 11], fill=shade(stone, 1.14))
    t.rect([cx - lw / 2, y - 3.5, cx + lw / 2, y], fill=shade(stone, 0.80))
    t.rect([cx - lw / 2, y - 16.5, cx + lw / 2, y - 15], fill=shade(stone, 0.72))


def _sill(t, cx, y, ww, stone, wall):
    lw = ww + 26
    t.rect([cx - lw / 2, y, cx + lw / 2, y + 9], fill=stone)
    t.rect([cx - lw / 2, y, cx + lw / 2, y + 3], fill=shade(stone, 1.16))
    t.rect([cx - lw / 2, y + 9, cx + lw / 2, y + 15], fill=shade(stone, 0.52))
    # the sill throws a little shadow onto the wall below it
    t.rect([cx - lw / 2, y + 15, cx + lw / 2, y + 20], fill=shade(wall, 0.86))


def _sash(t, x0, y0, x1, y1, frame, cols, rows):
    """Painted muntins over the glass."""
    b = 3.0
    t.rect([x0, y0, x1, y0 + b], fill=shade(frame, 1.06))
    t.rect([x0, y1 - b, x1, y1], fill=shade(frame, 0.82))
    t.rect([x0, y0, x0 + b, y1], fill=shade(frame, 1.02))
    t.rect([x1 - b, y0, x1, y1], fill=shade(frame, 0.84))
    for i in range(1, cols):
        x = x0 + (x1 - x0) * i / cols
        t.rect([x - 1.4, y0, x + 1.4, y1], fill=frame)
    for j in range(1, rows):
        y = y0 + (y1 - y0) * j / rows
        t.rect([x0, y - 1.8, x1, y + 1.8], fill=frame)


def _window(t, cx, y0, ww, wh, wall, stone, frame, state, rnd, glow):
    """One tenement window. 'dark'|'lit'|'shade'|'open'|'curtain'|'brick'."""
    x0, x1 = cx - ww / 2, cx + ww / 2
    y1 = y0 + wh
    _lintel(t, cx, y0, ww, stone)

    if state == "brick":
        # bricked up years ago, in a mortar that never matched
        patch = shade(mix(wall, PAPER, 0.10), 0.94)
        t.rect([x0 - 3, y0, x1 + 3, y1], fill=shade(wall, 0.62))
        t.rect([x0, y0 + 2, x1, y1], fill=patch)
        for r in range(int(wh / 9)):
            yy = y0 + 3 + r * 9
            t.rect([x0, yy, x1, yy + 1.4], fill=shade(patch, 0.84))
            off = 0 if r % 2 else 9
            for k in range(4):
                t.rect([x0 + off + k * 18, yy, x0 + off + k * 18 + 1.4,
                        yy + 8], fill=shade(patch, 0.86))
        t.rect([x0 - 3, y0, x1 + 3, y0 + 5], fill=shade(wall, 0.40))
        _sill(t, cx, y1, ww, stone, wall)
        return

    # reveal: the opening is a hole in the wall, darkest under the lintel
    t.rect([x0 - 3, y0, x1 + 3, y1], fill=shade(wall, 0.50))
    t.rect([x0 - 3, y0, x1 + 3, y0 + 6], fill=shade(wall, 0.32))
    t.rect([x0 - 3, y0, x0 + 2, y1], fill=shade(wall, 0.40))
    t.rect([x1 - 1, y0, x1 + 3, y1], fill=shade(wall, 0.66))

    gx0, gy0, gx1, gy1 = x0 + 2, y0 + 5, x1 - 1, y1 - 2
    gh = gy1 - gy0
    if state == "lit":
        glass = shade(LAMPLIT, rnd.uniform(0.88, 1.06))
    else:
        glass = shade(GLASS_DK, rnd.uniform(0.82, 1.16))
    t.rect([gx0, gy0, gx1, gy1], fill=glass)

    if state == "lit":
        # a warmer core and a silhouette in the room, never a bright accent
        t.rect([gx0 + 3, gy0 + 4, gx1 - 4, gy1 - 5], fill=shade(glass, 1.10))
        if rnd.random() < 0.55:
            bw = ww * rnd.uniform(0.20, 0.32)
            bx = rnd.uniform(gx0 + 4, gx1 - bw - 4)
            t.rect([bx, gy0 + gh * rnd.uniform(0.18, 0.34), bx + bw, gy1],
                   fill=shade(glass, 0.42))
        glow.ellipse([cx - ww * 0.85, y0 + wh * 0.5 - wh * 0.78,
                      cx + ww * 0.85, y0 + wh * 0.5 + wh * 0.78],
                     fill=(255, 210, 148, 22))
    elif state == "shade":
        f = rnd.uniform(0.32, 0.64)
        cl = shade(SHADE_CLOTH, rnd.uniform(0.86, 1.06))
        t.rect([gx0, gy0, gx1, gy0 + gh * f], fill=cl)
        t.rect([gx0, gy0 + gh * f - 2.5, gx1, gy0 + gh * f], fill=shade(cl, 0.64))
        t.rect([cx - 1, gy0 + gh * f, cx + 1, gy0 + gh * f + 5],
               fill=shade(cl, 0.58))
    elif state == "open":
        # bottom sash raised: black gap, the sash stacked over the top
        t.rect([gx0, gy1 - gh * 0.44, gx1, gy1], fill=shade(GLASS_DK, 0.36))
        t.rect([gx0, gy1 - gh * 0.46, gx1, gy1 - gh * 0.42], fill=shade(frame, 0.80))
    elif state == "curtain":
        cw = ww * rnd.uniform(0.16, 0.26)
        cl = shade(SHADE_CLOTH, 0.86)
        t.rect([gx0, gy0, gx0 + cw, gy1], fill=cl)
        t.rect([gx1 - cw, gy0, gx1, gy1], fill=shade(cl, 0.90))
        t.rect([gx0, gy0, gx1, gy0 + gh * 0.10], fill=shade(cl, 0.94))

    # reflection: a thin sliver of sky, on some panes only, never bright
    if state in ("dark", "open") and rnd.random() < 0.42:
        k = rnd.uniform(0.22, 0.42)
        sx = gx0 + (gx1 - gx0) * rnd.uniform(0.04, 0.30)
        t.poly([(sx, gy1 - 3), (sx + ww * k, gy0 + 2),
                (sx + ww * k * 1.5, gy0 + 2), (sx + ww * 0.09, gy1 - 3)],
               fill=shade(mix(glass, SLATE, 0.34), 1.08))

    rows = 2 if wh > 74 else 1
    _sash(t, gx0, gy0, gx1, gy1, frame, 2, rows)
    _sill(t, cx, y1, ww, stone, wall)

    # rain has washed a pale streak down off the sill for twenty years
    if rnd.random() < 0.5:
        dw = ww * rnd.uniform(0.5, 0.95)
        dl = rnd.uniform(18, 62)
        t.poly([(cx - dw * 0.5, y1 + 21), (cx + dw * 0.5, y1 + 21),
                (cx + dw * 0.36, y1 + 21 + dl), (cx - dw * 0.36, y1 + 21 + dl)],
               fill=shade(wall, 0.91))


def _tile_text(t, xy, s, size, fill, tracking=0.0):
    ss = t.c.ss
    f = ak.font("serif_bold", max(6, int(size * ss)))
    ak.text_spaced(t.c.d, (xy[0] * ss, xy[1] * ss), s, f, fill, tracking * ss)


def _cornice(t, w, y, dep, stone, rnd, brackets=True, dentils=True):
    """Sheet-metal cornice: fascia, dentil course, bracket row, dark soffit."""
    dk = shade(stone, 0.58)
    md = shade(stone, 0.84)
    lt = shade(stone, 1.14)

    def Y(f):
        return y + dep * f

    # roof edge / sky gap above
    t.rect([-4, y - dep * 0.20, w + 4, y], fill=shade(stone, 0.30))
    # crown moulding
    t.rect([-4, Y(0.00), w + 4, Y(0.11)], fill=shade(stone, 1.06))
    t.rect([-4, Y(0.11), w + 4, Y(0.17)], fill=md)
    t.rect([-4, Y(0.17), w + 4, Y(0.22)], fill=dk)
    # fascia
    t.rect([-4, Y(0.22), w + 4, Y(0.50)], fill=stone)
    t.rect([-4, Y(0.22), w + 4, Y(0.27)], fill=shade(stone, 1.10))
    yb = Y(0.50)
    if dentils:
        n = max(6, int(w / 16))
        for i in range(n + 1):
            x = i * (w / n)
            t.rect([x + 3, yb - dep * 0.13, x + 11, yb], fill=shade(stone, 1.06))
            t.rect([x + 9, yb - dep * 0.13, x + 11, yb], fill=shade(stone, 0.74))
    if brackets:
        n = 7
        for i in range(n + 1):
            x = i * (w / n)
            t.poly([(x - 9, yb), (x + 9, yb), (x + 5, Y(0.80)),
                    (x - 5, Y(0.80))], fill=md)
            t.poly([(x - 9, yb), (x - 1, yb), (x - 3, Y(0.80)),
                    (x - 5, Y(0.80))], fill=lt)
    # soffit shadow — the cornice hangs over the wall
    t.rect([-4, Y(0.80), w + 4, Y(1.0)], fill=shade(stone, 0.34))
    t.rect([-4, Y(0.92), w + 4, Y(1.0)], fill=shade(stone, 0.26))
    t.rect([-4, Y(1.0), w + 4, Y(1.0) + 7], fill=shade(stone, 0.42))


def _ghost_sign(t, x0, y0, x1, y1, lines, rnd, tone):
    """Faded painted advertising — barely there, no contrast."""
    ov = Tile(t.w, t.h, ss=2)
    n = len(lines)
    hh = (y1 - y0) / n
    for i, (txt, sz) in enumerate(lines):
        _tile_text(ov, ((x0 + x1) * 0.5, y0 + hh * (i + 0.5)), txt, sz,
                   tone + (46,), sz * 0.18)
    img = ov.c.resolve()
    img = img.filter(ImageFilter.GaussianBlur(1.1))
    # eat holes out of it so the paint looks flaked
    m = noise_img(t.w, t.h, rnd, 0, 255, cell=3, blur=1.2)
    m = m.point(lambda v: 255 if v > 96 else int(v * 1.6))
    img.putalpha(ImageChops.multiply(img.getchannel("A"), m))
    return img


def _wall_extras(t, w, top, bottom, wall, stone, rnd, n_patch=5):
    """The little irregularities that stop a wall reading as wallpaper."""
    # repointed patches: newer mortar, slightly off-tone
    for _ in range(n_patch):
        px = rnd.uniform(0, w)
        py = rnd.uniform(top, bottom - 60)
        pw = rnd.uniform(40, 130)
        ph = rnd.uniform(30, 90)
        t.rect([px, py, px + pw, py + ph],
               fill=shade(wall, rnd.choice([0.90, 1.07])))
        for k in range(int(ph / 9)):
            t.rect([px, py + k * 9, px + pw, py + k * 9 + 1.3],
                   fill=shade(wall, 0.84))
    # iron wall vents
    for _ in range(2):
        vx = rnd.uniform(20, w - 20)
        vy = rnd.uniform(top + 40, bottom - 60)
        vw, vh = 20, 14
        t.rect([vx, vy, vx + vw, vy + vh], fill=shade(wall, 0.36))
        for k in range(3):
            t.rect([vx + 2, vy + 2 + k * 4, vx + vw - 2, vy + 3.2 + k * 4],
                   fill=shade(wall, 0.72))
    # a datestone / house number cut into the band above the shopfront
    t.rect([w * 0.06, bottom - 40, w * 0.06 + 40, bottom - 16],
           fill=shade(stone, 0.92))
    t.rect([w * 0.06, bottom - 40, w * 0.06 + 40, bottom - 37],
           fill=shade(stone, 1.10))
    _tile_text(t, (w * 0.06 + 20, bottom - 27), rnd.choice(["1889", "1891"]),
               11, shade(stone, 0.60), 1.4)
    # anchor plates for the floor beams
    for _ in range(6):
        ax = rnd.uniform(14, w - 14)
        ay = rnd.uniform(top + 30, bottom - 40)
        t.circle(ax, ay, 5.5, fill=shade(wall, 0.52))
        t.circle(ax - 1, ay - 1, 4.0, fill=shade(wall, 0.78))


def _posters(t, w, y0, y1, rnd, n=4):
    """Fly-posted broadsides, sun-bleached and half torn off."""
    for _ in range(n):
        pw = rnd.uniform(26, 42)
        ph = pw * rnd.uniform(1.00, 1.32)
        px = rnd.uniform(4, w - pw - 4)
        py = rnd.uniform(y0, max(y0, y1 - ph))
        tone = shade(mix(PAPER, ASPHALT, rnd.uniform(0.74, 0.88)), 0.86)
        t.rect([px, py, px + pw, py + ph], fill=shade(tone, 0.78))
        t.rect([px, py, px + pw - 2, py + ph - 2], fill=tone)
        if rnd.random() < 0.6:              # a torn corner
            t.poly([(px + pw * 0.55, py + ph), (px + pw, py + ph),
                    (px + pw, py + ph * 0.62)], fill=shade(tone, 0.70))
        ink = shade(tone, 0.56)             # illegible letterpress
        t.rect([px + 4, py + ph * 0.10, px + pw - 4, py + ph * 0.20], fill=ink)
        for k in range(4):
            yy = py + ph * (0.30 + k * 0.14)
            t.rect([px + 5, yy, px + pw - rnd.uniform(6, 18), yy + 2.2],
                   fill=ink)


def _downpipe(t, x, y0, y1, col):
    t.rect([x - 5, y0, x + 5, y1], fill=shade(col, 0.72))
    t.rect([x - 5, y0, x - 1, y1], fill=shade(col, 0.94))
    t.rect([x + 3, y0, x + 5, y1], fill=shade(col, 0.52))
    y = y0 + 40
    while y < y1:
        t.rect([x - 8, y, x + 8, y + 5], fill=shade(col, 0.60))
        y += 116


# ------------------------------------------------------------ shopfronts
def _shopfront_l(t, w, y0, h, wall, stone, rnd):
    """Grocer: awning-less, cast-iron piers, produce boxes, dark doorway."""
    frame = shade(mix(CLOTH["moss"], ASPHALT, 0.42), 0.88)
    ground = y0 + h

    # heavy stone bandcourse that carries the wall above
    t.rect([-4, y0, w + 4, y0 + 12], fill=shade(stone, 0.92))
    t.rect([-4, y0, w + 4, y0 + 4], fill=shade(stone, 1.12))
    t.rect([-4, y0 + 12, w + 4, y0 + 17], fill=shade(stone, 0.44))

    # signboard
    sb0, sb1 = y0 + 17, y0 + 55
    board = shade(mix(CLOTH["chocolate"], ASPHALT, 0.30), 0.86)
    t.rect([-4, sb0, w + 4, sb1], fill=board)
    t.rect([-4, sb0, w + 4, sb0 + 3], fill=shade(board, 1.18))
    t.rect([-4, sb1 - 5, w + 4, sb1], fill=shade(board, 0.66))
    _tile_text(t, (w * 0.46, (sb0 + sb1) * 0.5), "GROCER", 23,
               shade(mix(PAPER, board, 0.44), 0.94), 9)

    # storefront glazing between iron piers
    gy0, gy1 = sb1 + 8, ground - 56
    piers = [0, w * 0.30, w * 0.55, w * 0.80, w]
    t.rect([-4, gy0 - 6, w + 4, gy0], fill=shade(frame, 0.62))
    for i in range(len(piers) - 1):
        a, b = piers[i] + 7, piers[i + 1] - 7
        if i == 2:
            continue  # the doorway
        t.rect([a, gy0, b, gy1], fill=shade(GLASS_DK, 0.78))
        # transom over the shop glass
        t.rect([a, gy0, b, gy0 + 16], fill=shade(GLASS_DK, 1.28))
        t.rect([a, gy0 + 16, b, gy0 + 19], fill=frame)
        # dim goods stacked in the window
        for _ in range(9):
            bx = rnd.uniform(a + 6, b - 22)
            bw2 = rnd.uniform(12, 24)
            bh2 = rnd.uniform(10, 22)
            t.rect([bx, gy1 - bh2 - rnd.uniform(0, 16), bx + bw2, gy1],
                   fill=shade(mix(CLOTH["oat"], ASPHALT, 0.55),
                              rnd.uniform(0.62, 0.86)))
        # one pale reflection streak
        if rnd.random() < 0.75:
            k0 = rnd.uniform(0.10, 0.34)
            kw = rnd.uniform(0.07, 0.16)
            t.poly([(a + (b - a) * (k0 - 0.10), gy1 - 8),
                    (a + (b - a) * k0, gy0 + 22),
                    (a + (b - a) * (k0 + kw), gy0 + 22),
                    (a + (b - a) * (k0 - 0.10),
                     gy1 - (gy1 - gy0) * rnd.uniform(0.42, 0.66))],
                   fill=shade(mix(GLASS_DK, SLATE, 0.24),
                              rnd.uniform(0.88, 1.00)))
        _sash(t, a, gy0, b, gy1, frame, 2, 1)

    # doorway: recessed, black, with a transom light
    da, db = piers[2] + 9, piers[3] - 9
    t.rect([da, gy0, db, ground], fill=shade(wall, 0.30))
    t.rect([da + 4, gy0 + 4, db - 4, gy0 + 20], fill=shade(LAMPLIT, 0.66))
    t.rect([da + 4, gy0 + 20, db - 4, ground], fill=(20, 17, 15, 255))
    t.rect([da, gy0, da + 4, ground], fill=shade(wall, 0.44))
    t.rect([db - 4, gy0, db, ground], fill=shade(wall, 0.22))

    # iron piers
    for x in piers:
        t.rect([x - 8, gy0 - 8, x + 8, ground], fill=shade(frame, 0.66))
        t.rect([x - 8, gy0 - 8, x - 3, ground], fill=shade(frame, 0.92))
        t.rect([x + 5, gy0 - 8, x + 8, ground], fill=shade(frame, 0.48))

    # panelled bulkhead + base course
    t.rect([-4, gy1, w + 4, ground - 14], fill=shade(frame, 0.66))
    t.rect([-4, gy1, w + 4, gy1 + 5], fill=shade(frame, 0.98))
    for i in range(len(piers) - 1):
        a, b = piers[i] + 12, piers[i + 1] - 12
        t.rect([a, gy1 + 10, b, ground - 22], fill=shade(frame, 0.56))
        t.rect([a + 3, gy1 + 13, b - 3, ground - 25], fill=shade(frame, 0.74))
    t.rect([-4, ground - 14, w + 4, ground], fill=shade(stone, 0.38))
    t.rect([-4, ground - 14, w + 4, ground - 11], fill=shade(stone, 0.56))
    t.rect([-4, ground - 5, w + 4, ground], fill=(20, 17, 15, 255))


def _shopfront_r(t, w, y0, h, wall, stone, rnd):
    """Candy store: one big window, a stoop door, a barber pole gone grey."""
    frame = shade(mix(CLOTH["navy"], ASPHALT, 0.40), 0.90)
    ground = y0 + h

    t.rect([-4, y0, w + 4, y0 + 10], fill=shade(stone, 0.94))
    t.rect([-4, y0, w + 4, y0 + 3], fill=shade(stone, 1.14))
    t.rect([-4, y0 + 10, w + 4, y0 + 15], fill=shade(stone, 0.46))

    # arched signboard
    sb0, sb1 = y0 + 15, y0 + 60
    board = shade(mix(CLOTH["moss"], ASPHALT, 0.34), 0.80)
    t.rect([-4, sb0, w + 4, sb1], fill=board)
    t.rect([-4, sb0, w + 4, sb0 + 3], fill=shade(board, 1.20))
    t.rect([-4, sb1 - 6, w + 4, sb1], fill=shade(board, 0.62))
    _tile_text(t, (w * 0.44, (sb0 + sb1) * 0.5), "CANDY  SODA", 21,
               shade(mix(PAPER, board, 0.46), 0.92), 6)

    gy0, gy1 = sb1 + 10, ground - 58
    # one wide plate window on the left, door + narrow window on the right
    t.rect([-4, gy0 - 5, w + 4, gy0], fill=shade(frame, 0.60))

    a, b = 10, w * 0.52
    t.rect([a, gy0, b, gy1], fill=shade(GLASS_DK, 0.82))
    t.rect([a, gy0, b, gy0 + 15], fill=shade(GLASS_DK, 1.34))
    t.rect([a, gy0 + 15, b, gy0 + 18], fill=frame)
    # jars on a shelf, low contrast
    for i in range(7):
        jx = a + 14 + i * ((b - a - 26) / 6.0)
        jh = rnd.uniform(16, 26)
        t.rect([jx - 6, gy1 - 30 - jh, jx + 6, gy1 - 30],
               fill=shade(mix(CLOTH["oat"], ASPHALT, 0.5), rnd.uniform(0.7, 0.95)))
    t.rect([a + 4, gy1 - 32, b - 4, gy1 - 26], fill=shade(frame, 0.80))
    t.poly([(a + 6, gy1 - 7), (a + (b - a) * 0.22, gy0 + 21),
            (a + (b - a) * 0.30, gy0 + 21), (a + 6, gy1 - (gy1 - gy0) * 0.58)],
           fill=shade(mix(GLASS_DK, SLATE, 0.24), 0.94))
    _sash(t, a, gy0, b, gy1, frame, 1, 1)

    # doorway
    da, db = w * 0.58, w * 0.80
    t.rect([da, gy0, db, ground], fill=shade(wall, 0.28))
    t.rect([da + 5, gy0 + 5, db - 5, gy0 + 22], fill=shade(LAMPLIT, 0.58))
    t.rect([da + 5, gy0 + 22, db - 5, ground], fill=(19, 16, 14, 255))
    t.rect([da, gy0, da + 5, ground], fill=shade(wall, 0.42))
    t.rect([db - 5, gy0, db, ground], fill=shade(wall, 0.20))

    # narrow side window
    a2, b2 = w * 0.85, w - 8
    t.rect([a2, gy0, b2, gy1], fill=shade(GLASS_DK, 0.76))
    t.rect([a2, gy0, b2, gy0 + 15], fill=shade(GLASS_DK, 1.24))
    _sash(t, a2, gy0, b2, gy1, frame, 1, 2)

    for x in (0, w * 0.55, w * 0.83, w):
        t.rect([x - 7, gy0 - 7, x + 7, ground], fill=shade(frame, 0.64))
        t.rect([x - 7, gy0 - 7, x - 3, ground], fill=shade(frame, 0.90))
        t.rect([x + 4, gy0 - 7, x + 7, ground], fill=shade(frame, 0.46))

    t.rect([-4, gy1, w + 4, ground - 14], fill=shade(frame, 0.64))
    t.rect([-4, gy1, w + 4, gy1 + 5], fill=shade(frame, 0.96))
    for a, b in ((12, w * 0.50), (w * 0.86, w - 10)):
        t.rect([a, gy1 + 10, b, ground - 24], fill=shade(frame, 0.54))
        t.rect([a + 3, gy1 + 13, b - 3, ground - 27], fill=shade(frame, 0.72))
    t.rect([-4, ground - 14, w + 4, ground], fill=shade(stone, 0.36))
    t.rect([-4, ground - 14, w + 4, ground - 11], fill=shade(stone, 0.54))
    t.rect([-4, ground - 5, w + 4, ground], fill=(20, 17, 15, 255))


# ------------------------------------------------------------ facade driver
def _build_facade(cfg):
    w, h = W(420, 1000)
    rnd = random.Random(cfg["seed"])
    t = Tile(w, h, ss=2)
    wall = cfg["wall"]
    stone = cfg["stone"]
    frame = cfg["frame"]

    _wall(t, w, h, rnd, wall, W(cfg["course"]), joints=cfg["joints"])

    glow = Tile(w, h, ss=2)

    cor_h = W(cfg["cornice"])
    _cornice(t, w, W(6), cor_h, stone, rnd,
             brackets=cfg["brackets"], dentils=cfg["dentils"])

    # storeys
    top = W(6) + cor_h + W(10)
    shop_h = W(cfg["shop"])
    bottom = h - shop_h
    n = cfg["storeys"]
    sh = (bottom - top) / n
    bays = cfg["bays"]
    bw = w / bays
    ww, wh = W(*cfg["win"])

    if cfg.get("ghost"):
        gs = _ghost_sign(t, w * 0.08, top + sh * 0.20, w * 0.92,
                         top + sh * 1.62, cfg["ghost"], rnd,
                         shade(mix(PAPER, wall, 0.42), 0.92))
    else:
        gs = None

    _wall_extras(t, w, top, bottom, wall, stone, rnd)

    for s in range(n):
        ytop = top + s * sh + (sh - wh) * 0.52
        for b in range(bays):
            cx = bw * (b + 0.5)
            r = rnd.random()
            lit = cfg["lit"]
            if r < lit:
                st = "lit"
            elif r < lit + 0.15:
                st = "shade"
            elif r < lit + 0.22:
                st = "open"
            elif r < lit + 0.32:
                st = "curtain"
            elif r < lit + 0.35 and s > 0:
                st = "brick"
            else:
                st = "dark"
            _window(t, cx, ytop, ww, wh, wall, stone, frame, st, rnd, glow)
        # a string course between storeys on the stone building
        if cfg["joints"] and s < n - 1:
            y = top + (s + 1) * sh - 6
            t.rect([-4, y, w + 4, y + 5], fill=shade(stone, 0.80))
            t.rect([-4, y, w + 4, y + 2], fill=shade(stone, 1.04))
            t.rect([-4, y + 5, w + 4, y + 8], fill=shade(stone, 0.46))

    if cfg.get("pipe") is not None:
        _downpipe(t, w * cfg["pipe"], W(6) + cor_h, bottom - 4,
                  mix(IRON, stone, 0.34))

    _posters(t, w, bottom - W(36), bottom - W(3), rnd, 4)
    cfg["shopfn"](t, w, bottom, shop_h, wall, stone, rnd)

    img = ak.finish(t.c, ink=0, light=False, grain_amt=5, seed=cfg["seed"])
    if gs is not None:
        img.alpha_composite(gs)
    img.alpha_composite(_soot(t, w, h, rnd, bands=(
        (W(6) + cor_h, W(6) + cor_h + W(90), 92),
        (bottom - W(70), bottom + W(8), 60),
        (h - W(30), h + W(6), 120))))
    img.alpha_composite(wrap_blur(glow.c.resolve(), 16))

    # push the whole wall back: a flat haze so it never fights the kids
    haze = Image.new("RGBA", img.size, cfg["haze"] + (cfg["haze_a"],))
    img.alpha_composite(haze)
    # roll the finished tile so opposite sides of the street never line up
    if cfg.get("roll"):
        img = ImageChops.offset(img, 0, int(cfg["roll"]))
    return img


def build_facade_l():
    """420x1000 world, tiles both ways. Sooted brick tenement, grocer below."""
    return _build_facade(dict(
        seed=6101, wall=BRICK_WALL, stone=shade(mix(BROWNSTONE, PAPER, 0.24), 0.66),
        frame=shade(mix(CLOTH["cream"], ASPHALT, 0.52), 0.72),
        course=7, joints=False, cornice=62, brackets=True, dentils=True,
        storeys=4, bays=3, win=(58, 84), shop=204, lit=0.12, pipe=None,
        haze=mix(ASPHALT, RUST, 0.16), haze_a=40,
        ghost=[("FINE", 52), ("TEAS", 52)], shopfn=_shopfront_l))


def build_facade_r():
    """420x1000 world, tiles both ways. Grey brownstone, candy store below."""
    return _build_facade(dict(
        seed=6202, wall=STONE_WALL, stone=shade(mix(SLATE, PAPER, 0.30), 0.62),
        frame=shade(mix(CLOTH["dust"], ASPHALT, 0.50), 0.64),
        course=13, joints=True, cornice=52, brackets=False, dentils=True,
        storeys=5, bays=4, win=(46, 66), shop=190, lit=0.09, pipe=0.245,
        haze=mix(ASPHALT, SLATE, 0.40), haze_a=44, roll=W(212),
        ghost=None, shopfn=_shopfront_r))


# ================================================================== skyline
# The far distance is a dark, sooty silhouette standing against its own warm
# haze — the value order is sky-light / far-dark / near-darker, which is what
# actually reads as depth. Nothing in here is crisp.
SKY_FAR = shade(mix(ASPHALT, SLATE, 0.46), 0.88)
SKY_MID = mix(ASPHALT_D, SLATE, 0.26)
SKY_NEAR = shade(mix(ASPHALT_D, IRON, 0.55), 0.94)
SKY_GLOW = mix(PAPER, CLOTH["ochre"], 0.22)


def _sky_watertower(c, cx, base, ht, col):
    """Tower on stilts, silhouette only, but with real proportions."""
    tw = ht * 0.42
    tank_h = ht * 0.46
    ty = base - ht * 0.40
    for a, b in ((-1.0, -0.62), (1.0, 0.62)):
        c.poly([(cx + tw * a, base), (cx + tw * (a * 0.62), ty),
                (cx + tw * (b * 0.62), ty), (cx + tw * b, base)], fill=col)
    c.rect([cx - tw * 0.86, base - ht * 0.20, cx + tw * 0.86,
            base - ht * 0.20 + ht * 0.035], fill=col)
    c.rect([cx - tw * 0.62, ty - tank_h, cx + tw * 0.62, ty + 2], fill=col)
    c.poly([(cx - tw * 0.76, ty - tank_h), (cx + tw * 0.76, ty - tank_h),
            (cx, ty - tank_h - ht * 0.26)], fill=col)
    c.rect([cx - ht * 0.018, ty - tank_h - ht * 0.36, cx + ht * 0.018,
            ty - tank_h - ht * 0.22], fill=col)


def _sky_spire(c, cx, base, ht, col):
    """A church: a squat tower, a belfry, and a long thin steeple."""
    bw = ht * 0.115
    c.rect([cx - bw, base - ht * 0.44, cx + bw, base + 24], fill=col)
    c.rect([cx - bw * 1.22, base - ht * 0.50, cx + bw * 1.22,
            base - ht * 0.44], fill=col)
    # belfry openings knocked out as a lighter tone
    for k in (-0.45, 0.45):
        c.rect([cx + bw * (k - 0.20), base - ht * 0.40,
                cx + bw * (k + 0.20), base - ht * 0.28],
               fill=shade(col, 0.72))
    c.poly([(cx - bw * 1.22, base - ht * 0.50), (cx + bw * 1.22, base - ht * 0.50),
            (cx + bw * 0.82, base - ht * 0.56), (cx - bw * 0.82, base - ht * 0.56)],
           fill=col)
    c.poly([(cx - bw * 0.82, base - ht * 0.56), (cx + bw * 0.82, base - ht * 0.56),
            (cx, base - ht * 1.00)], fill=col)
    c.rect([cx - ht * 0.012, base - ht * 1.10, cx + ht * 0.012,
            base - ht * 0.98], fill=col)
    c.rect([cx - ht * 0.035, base - ht * 1.065, cx + ht * 0.035,
            base - ht * 1.045], fill=col)


def _sky_stack(c, x, top, wd, ht, col, pots=2):
    """Brick chimney stack with clay pots on it."""
    c.rect([x, top - ht, x + wd, top + 6], fill=col)
    c.rect([x - 1.6, top - ht - wd * 0.20, x + wd + 1.6, top - ht], fill=col)
    for k in range(pots):
        px = x + wd * (k + 0.5) / pots
        c.rect([px - wd * 0.16, top - ht - wd * 0.62, px + wd * 0.16,
                top - ht - wd * 0.18], fill=col)


def _sky_coop(c, x, top, wd, col):
    """Pigeon coop: every roof in this town had one."""
    ht = wd * 0.52
    c.rect([x, top - ht, x + wd, top + 4], fill=col)
    c.poly([(x - 3, top - ht), (x + wd + 3, top - ht),
            (x + wd * 0.5, top - ht - wd * 0.24)], fill=col)
    c.rect([x + wd * 0.5 - 1.2, top - ht - wd * 0.62, x + wd * 0.5 + 1.2,
            top - ht - wd * 0.20], fill=col)
    c.rect([x + wd * 0.5 - 1.2, top - ht - wd * 0.62, x + wd * 0.5 + 9,
            top - ht - wd * 0.58], fill=col)


def _sky_windows(c, x0, y0, x1, y1, col, rnd):
    """Faint window ticks so the masses read as buildings, not cardboard."""
    lit = shade(col, 1.14)
    dk = shade(col, 0.86)
    step = rnd.uniform(14, 21)
    vstep = step * rnd.uniform(1.0, 1.35)
    x = x0 + rnd.uniform(6, 12)
    while x < x1 - 10:
        y = y0 + rnd.uniform(8, 16)
        while y < y1 - 10:
            if rnd.random() < 0.66:
                c.rect([x, y, x + step * 0.32, y + step * 0.44],
                       fill=lit if rnd.random() < 0.30 else dk)
            y += vstep
        x += step


def _sky_block(c, x, bw, top, base, col, rnd, feature=True, ticks=False):
    """One building: body, parapet, and whatever is standing on the roof."""
    style = rnd.random()
    if style < 0.12:
        # stepped parapet
        c.rect([x, top + 12, x + bw, base], fill=col)
        c.rect([x + bw * 0.22, top, x + bw * 0.78, top + 14], fill=col)
    elif style < 0.22:
        # mansard
        c.rect([x, top + bw * 0.16, x + bw, base], fill=col)
        c.poly([(x, top + bw * 0.17), (x + bw, top + bw * 0.17),
                (x + bw * 0.84, top), (x + bw * 0.16, top)], fill=col)
    elif style < 0.30:
        # gable end
        c.rect([x, top + bw * 0.18, x + bw, base], fill=col)
        c.poly([(x - 3, top + bw * 0.19), (x + bw + 3, top + bw * 0.19),
                (x + bw * 0.5, top)], fill=col)
    else:
        c.rect([x, top, x + bw, base], fill=col)
        c.rect([x - 4, top - 6, x + bw + 4, top], fill=col)
        c.rect([x - 4, top - 6, x + bw + 4, top - 3.6], fill=shade(col, 1.20))
    if ticks:
        _sky_windows(c, x, top + 16, x + bw, base, col, rnd)
    if not feature:
        return
    r = rnd.random()
    if r < 0.26:
        _sky_watertower(c, x + bw * rnd.uniform(0.28, 0.72), top,
                        rnd.uniform(38, 62), col)
    elif r < 0.40 and bw > 90:
        _sky_coop(c, x + bw * rnd.uniform(0.2, 0.6), top,
                  rnd.uniform(22, 36), col)
    elif r < 0.50:
        # billboard frame
        bx = x + bw * 0.15
        bh = rnd.uniform(24, 40)
        c.rect([bx, top - bh, bx + bw * 0.7, top - bh * 0.18], fill=col)
        for k in range(3):
            c.rect([bx + bw * 0.7 * (0.12 + k * 0.36), top - bh * 0.18,
                    bx + bw * 0.7 * (0.12 + k * 0.36) + 3, top + 4], fill=col)
    for _ in range(rnd.randint(0, 3)):
        _sky_stack(c, x + rnd.uniform(6, max(8, bw - 20)), top,
                   rnd.uniform(8, 16), rnd.uniform(10, 26), col,
                   pots=rnd.randint(1, 3))
    if rnd.random() < 0.22:
        px = x + bw * rnd.uniform(0.2, 0.8)
        c.rect([px - 1.2, top - rnd.uniform(26, 46), px + 1.2, top + 4],
               fill=col)


def _sky_run(c, w, base, lo, hi, col, rnd, ticks=False, wmin=70, wmax=210):
    """A run of rooftops across the whole width. Returns their tops."""
    out = []
    x = -40.0
    while x < w + 40:
        bw = rnd.uniform(wmin, wmax)
        top = base - rnd.uniform(lo, hi)
        _sky_block(c, x, bw, top, base + 60, col, rnd, ticks=ticks)
        out.append((x, x + bw, top))
        x += bw + rnd.uniform(2, 14)
    return out


def _laundry(c, tops, col, rnd, chance=0.45):
    for i in range(len(tops) - 1):
        if rnd.random() > chance:
            continue
        a, b = tops[i], tops[i + 1]
        x0 = a[0] + (a[1] - a[0]) * rnd.uniform(0.35, 0.85)
        x1 = b[0] + (b[1] - b[0]) * rnd.uniform(0.15, 0.6)
        y0, y1 = a[2] - rnd.uniform(8, 22), b[2] - rnd.uniform(8, 22)
        sag = rnd.uniform(6, 16)
        pts = [(x0 + (x1 - x0) * (k / 12.0),
                y0 + (y1 - y0) * (k / 12.0)
                + math.sin(math.pi * (k / 12.0)) * sag) for k in range(13)]
        # the poles the line is tied to
        c.rect([x0 - 1.4, y0 - 14, x0 + 1.4, y0 + 16], fill=col)
        c.rect([x1 - 1.4, y1 - 14, x1 + 1.4, y1 + 16], fill=col)
        c.line(pts, col, 1.7)
        for k in range(1, 12, 2):
            px, py = pts[k]
            gw = rnd.uniform(5, 10)
            gh = rnd.uniform(9, 18)
            if rnd.random() < 0.3:      # a union suit flapping
                c.rect([px - gw * 0.5, py, px + gw * 0.5, py + gh * 0.6],
                       fill=col)
                c.rect([px - gw * 0.5, py + gh * 0.6, px - gw * 0.06,
                        py + gh], fill=col)
                c.rect([px + gw * 0.06, py + gh * 0.6, px + gw * 0.5,
                        py + gh], fill=col)
            else:
                c.rect([px - gw * 0.5, py, px + gw * 0.5, py + gh], fill=col)


def build_skyline():
    """1400x260 world. Far rooftops closing the top of the street."""
    w, h = W(1400, 260)
    rnd = random.Random(7331)

    def hazed(draw, stops):
        """Draw one depth layer and sink it into its own share of the haze."""
        lc = Canvas(w, h, ss=2)
        draw(lc)
        im = lc.resolve()
        hz = Image.new("RGBA", im.size, SKY_GLOW + (255,))
        hz = vgrad_alpha(hz, stops)
        hz.putalpha(ImageChops.multiply(hz.getchannel("A"),
                                        im.getchannel("A")))
        im.alpha_composite(hz)
        return im

    # --- warm haze standing behind everything, so the band never reads as a
    #     hole punched in the screen
    hz = Canvas(w, h, ss=2)
    hz.rect([0, 0, w, h], fill=SKY_GLOW + (255,))
    sky = vgrad_alpha(hz.resolve(),
                      [(0.0, 0.0), (0.10, 0.54), (0.32, 0.50), (0.58, 0.26),
                       (0.86, 0.05), (1.0, 0.0)])

    # --- far: almost dissolved, its feet lost in the murk
    def far(c):
        _sky_run(c, w, h * 0.54, h * 0.10, h * 0.44, SKY_FAR, rnd,
                 wmin=60, wmax=190)
        for bx, bw2, bh2 in ((w * 0.09, 74, h * 0.62), (w * 0.545, 62, h * 0.56)):
            c.rect([bx, h * 0.54 - bh2, bx + bw2, h * 0.62], fill=SKY_FAR)
            c.rect([bx - 5, h * 0.54 - bh2 - 7, bx + bw2 + 5, h * 0.54 - bh2],
                   fill=SKY_FAR)
            _sky_windows(c, bx, h * 0.54 - bh2 + 12, bx + bw2, h * 0.54,
                         SKY_FAR, rnd)
        _sky_spire(c, w * 0.735, h * 0.60, h * 0.52, SKY_FAR)
        _sky_watertower(c, w * 0.155, h * 0.32, h * 0.22, SKY_FAR)
        _sky_watertower(c, w * 0.905, h * 0.28, h * 0.20, SKY_FAR)
        for sx, sk in ((w * 0.30, h * 0.50), (w * 0.62, h * 0.40)):
            c.rect([sx - 5, h * 0.80 - sk, sx + 5, h * 0.86], fill=SKY_FAR)
            c.rect([sx - 7, h * 0.80 - sk - 5, sx + 7, h * 0.80 - sk],
                   fill=SKY_FAR)

    # --- mid
    def mid(c):
        rows = _sky_run(c, w, h * 0.68, h * 0.12, h * 0.36, SKY_MID, rnd,
                        ticks=True, wmin=80, wmax=220)
        _laundry(c, rows, shade(SKY_MID, 0.80), rnd, 0.34)

    # --- near: the darkest mass, and it carries most of the laundry
    def near(c):
        rows = _sky_run(c, w, h * 0.86, h * 0.10, h * 0.34, SKY_NEAR, rnd,
                        ticks=True, wmin=95, wmax=250)
        _laundry(c, rows, shade(SKY_NEAR, 0.68), rnd, 0.5)

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    img.alpha_composite(sky)
    img.alpha_composite(hazed(far, [(0.0, 0.26), (0.55, 0.46), (1.0, 0.56)]))
    img.alpha_composite(hazed(mid, [(0.0, 0.08), (0.62, 0.26), (1.0, 0.36)]))
    img.alpha_composite(hazed(near, [(0.0, 0.0), (0.70, 0.12), (1.0, 0.20)]))

    # chimney smoke drifting off the far stacks
    smoke = Canvas(w, h, ss=2)
    for sx, sk in ((w * 0.30, h * 0.50), (w * 0.62, h * 0.40)):
        yy = h * 0.80 - sk
        for k in range(18):
            t2 = k / 17.0
            r = 6 + t2 * 30
            smoke.circle(sx + t2 * 74 + math.sin(t2 * 5) * 10, yy - t2 * 78, r,
                         fill=(232, 224, 208, int(30 * (1 - t2))))
    img.alpha_composite(smoke.resolve().filter(ImageFilter.GaussianBlur(9)))

    img = ak.grain(img, 4, 11)
    # and the whole band dissolves into the street at the bottom
    return vgrad_alpha(img, [(0.0, 1.0), (0.68, 1.0), (0.86, 0.50), (1.0, 0.0)])


# ================================================================== props
def build_watertower():
    """160x200 world. Wooden tank on an iron frame, for a roofline."""
    w, h = W(160, 200)
    c = Canvas(w, h, ss=3)
    rnd = random.Random(4404)
    cx = w * 0.5
    ground = h - 7

    wood = shade(mix(CLOTH["oat"], BROWNSTONE, 0.68), 0.82)
    wood_d = shade(wood, 0.70)
    iron = mix(IRON, SLATE, 0.24)
    iron_l = shade(iron, 1.55)
    tar = shade(mix(IRON, BROWNSTONE, 0.20), 1.02)

    tank_top = h * 0.29
    tank_bot = h * 0.615
    tr_top = w * 0.235
    tr_bot = w * 0.258

    # ---- iron frame (drawn first: the tank sits on top of it)
    # each leg is (top factor, bottom factor) of tr_bot
    LEGS = [(-1.00, -1.40), (-0.40, -0.56), (0.40, 0.56), (1.00, 1.40)]

    def legx(i, f):
        a, b = LEGS[i]
        return cx + tr_bot * (a + (b - a) * f)

    def legy(f):
        return tank_bot - 6 + (ground - tank_bot + 6) * f

    for i in range(4):
        wd = 11 if i in (0, 3) else 8
        c.capsule((legx(i, 0), legy(0)), (legx(i, 1), legy(1)),
                  wd * 0.82, wd, iron)
        c.capsule((legx(i, 0) - wd * 0.22, legy(0)),
                  (legx(i, 1) - wd * 0.22, legy(1)),
                  wd * 0.40, wd * 0.46, shade(iron, 1.42))

    # X braces between each neighbouring pair of legs
    for f0, f1 in ((0.14, 0.54), (0.56, 0.96)):
        for i in range(3):
            j = i + 1
            c.capsule((legx(i, f0), legy(f0)), (legx(j, f1), legy(f1)),
                      4.4, 4.4, shade(iron, 1.16))
            c.capsule((legx(j, f0), legy(f0)), (legx(i, f1), legy(f1)),
                      4.4, 4.4, shade(iron, 1.16))
    # horizontal ties
    for f in (0.14, 0.55, 0.96):
        y = legy(f)
        x0, x1 = legx(0, f), legx(3, f)
        c.rect([x0 - 3, y - 3.4, x1 + 3, y + 3.4], fill=iron)
        c.rect([x0 - 3, y - 3.4, x1 + 3, y - 1.0], fill=iron_l)
    # the platform the tank stands on
    c.rect([legx(0, 0) - 8, tank_bot - 5, legx(3, 0) + 8, tank_bot + 5],
           fill=shade(iron, 0.86))
    c.rect([legx(0, 0) - 8, tank_bot - 5, legx(3, 0) + 8, tank_bot - 2],
           fill=iron_l)
    c.rect([legx(0, 0) - 8, tank_bot + 2, legx(3, 0) + 8, tank_bot + 5],
           fill=shade(iron, 0.56))

    # ---- tank: a barrel, so it needs a lit side, a core and a turned edge
    c.poly([(cx - tr_top, tank_top), (cx + tr_top, tank_top),
            (cx + tr_bot, tank_bot), (cx - tr_bot, tank_bot)], fill=wood_d)
    c.poly([(cx - tr_top, tank_top), (cx + tr_top * 0.34, tank_top),
            (cx + tr_bot * 0.34, tank_bot), (cx - tr_bot, tank_bot)], fill=wood)
    c.poly([(cx - tr_top * 0.86, tank_top), (cx - tr_top * 0.20, tank_top),
            (cx - tr_bot * 0.20, tank_bot), (cx - tr_bot * 0.86, tank_bot)],
           fill=shade(wood, 1.14))
    # the far edge of the staves curls away on both sides
    c.poly([(cx - tr_top, tank_top), (cx - tr_top * 0.84, tank_top),
            (cx - tr_bot * 0.84, tank_bot), (cx - tr_bot, tank_bot)],
           fill=shade(wood, 0.86))
    c.poly([(cx + tr_top * 0.80, tank_top), (cx + tr_top, tank_top),
            (cx + tr_bot, tank_bot), (cx + tr_bot * 0.80, tank_bot)],
           fill=shade(wood, 0.60))
    # staves
    for i in range(-7, 8):
        f = i / 7.0
        # staves crowd together toward the silhouette edges
        f = math.copysign(abs(f) ** 0.78, f)
        c.line([(cx + tr_top * f, tank_top), (cx + tr_bot * f, tank_bot)],
               shade(wood, 0.82 if i % 2 else 0.92), 1.7)
    # weathering
    for _ in range(120):
        yy = rnd.uniform(tank_top, tank_bot)
        f = (yy - tank_top) / (tank_bot - tank_top)
        rr = tr_top + (tr_bot - tr_top) * f
        c.circle(rnd.uniform(cx - rr, cx + rr), yy, rnd.uniform(0.8, 2.4),
                 fill=shade(wood, rnd.uniform(0.72, 1.10)))
    for _ in range(9):     # dark water stains running down the staves
        xx = rnd.uniform(cx - tr_top, cx + tr_top)
        yy = rnd.uniform(tank_top + 6, tank_bot - 24)
        c.poly([(xx, yy), (xx + rnd.uniform(3, 8), yy),
                (xx + rnd.uniform(2, 6), tank_bot - 2), (xx - 1, tank_bot - 2)],
               fill=shade(wood, 0.80))
    # the tank's underside bulges: you are standing below it
    und = [(cx + tr_bot * (k / 8.0 - 1.0),
            tank_bot + 8.0 * (1.0 - ((k / 8.0 - 1.0) ** 2)))
           for k in range(17)]
    c.poly([(cx - tr_bot, tank_bot - 8)] + und + [(cx + tr_bot, tank_bot - 8)],
           fill=shade(wood_d, 0.78))
    c.poly([(cx - tr_bot, tank_bot - 3)] + [(x, y - 5) for x, y in und]
           + [(cx + tr_bot, tank_bot - 3)], fill=shade(wood_d, 0.94))

    # iron hoops — the tower is above eye level, so they curl up at the ends
    def hoop(f, curl, wd):
        y = tank_top + (tank_bot - tank_top) * f
        rr = tr_top + (tr_bot - tr_top) * f
        # inset a touch: at the silhouette edge the hoop turns away from us
        rr -= 3.0
        pts = [(cx + rr * (k / 8.0 - 1.0),
                y + curl * (1.0 - ((k / 8.0 - 1.0) ** 2)))
               for k in range(17)]
        c.line(pts, shade(iron, 0.62), wd)
        c.line([(x, yy - wd * 0.24) for x, yy in pts[2:-2]],
               shade(iron, 1.08), wd * 0.30)
        for sgn in (-1, 1):
            c.circle(cx + sgn * (rr - 6), y + curl * 0.16, 2.2,
                     fill=shade(iron, 1.30))

    for f, curl in ((0.18, 4.0), (0.45, 3.4), (0.71, 2.8), (0.93, 2.2)):
        hoop(f, curl, 5.4)

    # ---- conical roof
    roof_y = tank_top
    apex = h * 0.070
    rw = tr_top * 1.32
    c.poly([(cx - rw, roof_y), (cx + rw, roof_y), (cx, apex)],
           fill=shade(tar, 0.78))
    c.poly([(cx - rw, roof_y), (cx + rw * 0.14, roof_y), (cx, apex)], fill=tar)
    c.poly([(cx - rw, roof_y), (cx - rw * 0.40, roof_y), (cx, apex)],
           fill=shade(tar, 1.18))
    for k in range(1, 6):
        f = k / 6.0
        yy = apex + (roof_y - apex) * f
        curl = 3.6 * f
        pts = [(cx + rw * f * (j / 6.0 - 1.0),
                yy + curl * (1.0 - ((j / 6.0 - 1.0) ** 2)))
               for j in range(13)]
        c.line(pts, shade(tar, 0.70), 1.6)
    c.rect([cx - rw - 3, roof_y - 3.5, cx + rw + 3, roof_y + 3.5],
           fill=shade(tar, 0.62))
    c.rect([cx - rw - 3, roof_y - 3.5, cx + rw + 3, roof_y - 1.2],
           fill=shade(tar, 1.10))
    # finial
    c.rect([cx - 2.0, apex - 15, cx + 2.0, apex + 3], fill=iron)
    c.circle(cx, apex - 17, 3.8, fill=shade(iron, 1.35))

    # ---- supply pipe down the far side
    px0 = legx(0, 0.0) + 13
    px1 = legx(0, 1.0) + 13
    c.capsule((px0, tank_bot - 8), (px1, ground - 4), 6.0, 6.4,
              shade(iron, 0.94))
    c.capsule((px0 - 1.6, tank_bot - 8), (px1 - 1.6, ground - 4), 2.4, 2.6,
              shade(iron, 1.40))
    for f in (0.30, 0.70):
        c.rect([px0 + (px1 - px0) * f - 6, legy(f) - 2,
                px0 + (px1 - px0) * f + 6, legy(f) + 2], fill=shade(iron, 1.15))

    # ---- ladder, bolted to the near leg and running up onto the tank
    lx = legx(3, 0.0) - 10
    lx1 = legx(3, 1.0) - 10
    for off in (-8.5, 8.5):
        c.capsule((lx + off, tank_top + (tank_bot - tank_top) * 0.30),
                  (lx1 + off, ground - 3), 3.4, 3.8, shade(iron, 1.22))
    steps = 13
    for k in range(steps):
        f = k / (steps - 1.0)
        ry = (tank_top + (tank_bot - tank_top) * 0.30) \
            + (ground - 3 - (tank_top + (tank_bot - tank_top) * 0.30)) * f
        rx = lx + (lx1 - lx) * f
        c.rect([rx - 8.5, ry - 1.3, rx + 8.5, ry + 1.3], fill=shade(iron, 1.38))

    img = ak.finish(c, ink=3, light=True, light_strength=0.66, grain_amt=5,
                    seed=44)
    img = ak.drop_shadow(img, 3, 3, 2.0, 0.30, ss=1)
    return img


def build_gutter_grate():
    """90x36 world. Storm drain in the curb, seen flat like the sewer lids."""
    w, h = W(90, 36)
    c = Canvas(w, h, ss=4)
    rnd = random.Random(5511)
    conc = mix(ASPHALT_L, PAPER, 0.34)
    iron = mix(IRON, ASPHALT_L, 0.40)
    dark = (16, 14, 12)

    # concrete surround, foreshortened the way the manhole covers are
    pad = 3
    c.poly([(pad + 6, pad), (w - pad - 6, pad), (w - pad, h - pad),
            (pad, h - pad)], fill=shade(conc, 0.66))
    c.poly([(pad + 6, pad), (w - pad - 6, pad), (w - pad - 3, h - pad - 6),
            (pad + 3, h - pad - 6)], fill=conc)
    c.poly([(pad + 6, pad), (w - pad - 6, pad), (w - pad - 4, pad + 4),
            (pad + 7, pad + 4)], fill=shade(conc, 1.16))
    for _ in range(300):
        c.circle(rnd.uniform(pad, w - pad), rnd.uniform(pad, h - pad),
                 rnd.uniform(0.5, 1.7),
                 fill=rnd.choice([shade(conc, 0.80), shade(conc, 1.10),
                                  shade(conc, 0.66)]))
    # chipped edge
    for _ in range(7):
        ex = rnd.uniform(pad + 8, w - pad - 8)
        c.poly([(ex, pad), (ex + rnd.uniform(4, 9), pad),
                (ex + rnd.uniform(2, 6), pad + rnd.uniform(2, 5))],
               fill=shade(conc, 1.20))

    # ---- the iron grate itself
    ix0, ix1 = w * 0.13, w * 0.87
    iy0, iy1 = h * 0.26, h * 0.82
    # rebate the frame sits in
    c.rect([ix0 - 5, iy0 - 5, ix1 + 5, iy1 + 5], fill=shade(conc, 0.48))
    c.rect([ix0 - 5, iy0 - 5, ix1 + 5, iy0 - 1.5], fill=shade(conc, 0.34))
    c.rect([ix0 - 4, iy0 - 4, ix1 + 4, iy1 + 4], fill=shade(iron, 0.86))
    c.rect([ix0 - 4, iy0 - 4, ix1 + 4, iy0 - 1], fill=shade(iron, 1.45))
    c.rect([ix0 - 4, iy1 + 1, ix1 + 4, iy1 + 4], fill=shade(iron, 0.56))
    c.rect([ix0, iy0, ix1, iy1], fill=dark)

    # five fat bars, each with a lit top edge and a black slot under it
    n = 5
    span = iy1 - iy0
    bh = span / (n + (n - 1) * 0.72)
    gap = bh * 0.72
    y = iy0
    for i in range(n):
        c.rect([ix0, y - gap * 0.9, ix1, y], fill=dark)
        c.rect([ix0, y, ix1, y + bh], fill=iron)
        c.rect([ix0, y, ix1, y + bh * 0.36], fill=shade(iron, 1.40))
        c.rect([ix0, y + bh * 0.78, ix1, y + bh], fill=shade(iron, 0.52))
        for _ in range(14):
            c.circle(rnd.uniform(ix0, ix1), rnd.uniform(y, y + bh),
                     rnd.uniform(0.5, 1.4),
                     fill=rnd.choice([shade(iron, 0.70), shade(iron, 1.24),
                                      shade(RUST, 0.70), shade(RUST, 0.55)]))
        y += bh + gap
    c.rect([ix0, y - gap * 0.9, ix1, y - gap * 0.1], fill=dark)

    # cross ribs tie the bars together
    for f in (0.30, 0.70):
        x = ix0 + (ix1 - ix0) * f
        c.rect([x - 3, iy0, x + 3, iy1], fill=iron)
        c.rect([x - 3, iy0, x - 0.4, iy1], fill=shade(iron, 1.30))
        c.rect([x + 1.8, iy0, x + 3, iy1], fill=shade(iron, 0.60))

    # leaves and grit caught in the mouth
    for _ in range(10):
        lx = rnd.uniform(ix0 + 4, ix1 - 4)
        ly = rnd.uniform(iy0 + 2, iy1 - 2)
        rr = rnd.uniform(2.2, 5.0)
        c.ellipse([lx - rr, ly - rr * 0.5, lx + rr, ly + rr * 0.5],
                  fill=shade(mix(CLOTH["ochre"], ASPHALT, 0.58),
                             rnd.uniform(0.58, 0.88)))
    for _ in range(70):
        c.circle(rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(0.5, 1.5),
                 fill=shade(ASPHALT, rnd.uniform(0.78, 1.18)))

    return ak.finish(c, ink=3, light=True, light_strength=0.46, grain_amt=6,
                     seed=55)


def build_manhole_steam():
    """120x150 world. Atmosphere only — no ink, barely there."""
    w, h = W(120, 150)
    ss = 3
    rnd = random.Random(9911)
    acc = Image.new("L", (w * ss, h * ss), 0)

    def blob(cx, cy, rx, ry, v):
        x0 = int(max(0, (cx - rx) * ss))
        y0 = int(max(0, (cy - ry) * ss))
        x1 = int(min(w * ss, (cx + rx) * ss))
        y1 = int(min(h * ss, (cy + ry) * ss))
        if x1 <= x0 or y1 <= y0:
            return
        tmp = Image.new("L", (x1 - x0, y1 - y0), 0)
        ImageDraw.Draw(tmp).ellipse([0, 0, x1 - x0 - 1, y1 - y0 - 1], fill=v)
        reg = acc.crop((x0, y0, x1, y1))
        acc.paste(ImageChops.add(reg, tmp), (x0, y0))

    # four loose columns leaning the same way, billowing as they climb
    for col in range(4):
        base_x = w * (0.36 + col * 0.09) + rnd.uniform(-5, 5)
        lean = rnd.uniform(-0.10, 0.30)
        ph = rnd.uniform(0, 6.3)
        for i in range(170):
            f = i / 169.0
            y = h * (1.00 - 0.98 * f)
            spread = 5 + 44 * (f ** 0.80)
            cxx = (base_x + lean * f * w * 0.30
                   + math.sin(f * 3.2 + ph) * spread * 0.55)
            r = 6 + 26 * (f ** 0.80)
            v = 9 * (1.0 - f * 0.55)
            blob(cxx + rnd.uniform(-spread, spread) * 0.65,
                 y + rnd.uniform(-8, 8),
                 r * rnd.uniform(0.7, 1.4), r * rnd.uniform(0.55, 1.15),
                 max(2, int(v)))
    # wisps peeling off the top
    for _ in range(6):
        sx = w * rnd.uniform(0.32, 0.66)
        sy = h * rnd.uniform(0.50, 0.72)
        d = rnd.choice((-1, 1))
        for k in range(28):
            t2 = k / 27.0
            blob(sx + d * (math.sin(t2 * 3.4) * 26 * t2 + t2 * 30),
                 sy - t2 * h * 0.52, 5 + t2 * 14, 4 + t2 * 10,
                 int(7 * (1 - t2)))

    acc = acc.filter(ImageFilter.GaussianBlur(7 * ss / 3.0))

    # a plume envelope: pinched at the vent, opening out as it rises
    env = Image.new("L", (w * ss, h * ss), 0)
    ed = ImageDraw.Draw(env)
    ed.polygon([(0.40 * w * ss, h * ss), (0.16 * w * ss, 0.52 * h * ss),
                (0.02 * w * ss, 0.02 * h * ss), (0.98 * w * ss, 0.02 * h * ss),
                (0.86 * w * ss, 0.50 * h * ss), (0.62 * w * ss, h * ss)],
               fill=255)
    env = env.filter(ImageFilter.GaussianBlur(11 * ss))
    acc = ImageChops.multiply(acc, env.point(lambda v: 40 + int(v * 0.84)))

    # tear it apart so it is vapour, not a cotton ball: four scales of holes
    for cell, blur, lo in ((7, 3, 20), (19, 7, 50), (46, 16, 80),
                           (98, 30, 108)):
        acc = ImageChops.multiply(
            acc, noise_img(w * ss, h * ss, rnd, lo, 255, cell=cell, blur=blur))
    # a stretched noise gives it the streaky, rising grain of real steam
    streak = noise_img(w * ss, h * ss // 7, rnd, 110, 255, cell=4, blur=2)
    acc = ImageChops.multiply(acc, streak.resize((w * ss, h * ss),
                                                 Image.BICUBIC))
    acc = acc.point(lambda v: min(104, int(v * 3.6)))
    acc = acc.filter(ImageFilter.GaussianBlur(3 * ss / 3.0))

    img = Image.new("RGBA", (w * ss, h * ss), (230, 226, 218, 0))
    img.putalpha(acc)
    img = img.resize((w, h), Image.LANCZOS)
    return vgrad_alpha(img, [(0.0, 0.0), (0.20, 0.55), (0.52, 1.0),
                             (0.88, 0.92), (1.0, 0.40)])


# ================================================================== chalk
class ChalkPad:
    """An accumulating chalk mask. Strokes wander, break and overshoot."""

    def __init__(self, w, h, ss=3, seed=1):
        self.w, self.h, self.ss = w, h, ss
        self.m = Image.new("L", (w * ss, h * ss), 0)
        self.rnd = random.Random(seed)

    def stroke(self, pts, width, wob=None, press=1.0, gaps=0.08):
        rnd = self.rnd
        if len(pts) < 2:
            return
        # densify
        dense = []
        length = 0.0
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            ln = math.hypot(bx - ax, by - ay)
            length += ln
            n = max(2, int(ln / (width * 0.16)))
            for k in range(n):
                t = k / n
                dense.append((ax + (bx - ax) * t, ay + (by - ay) * t))
        dense.append(pts[-1])

        total = len(dense)
        # the hand wobbles at the scale of the whole stroke, not the nib
        if wob is None:
            wob = min(width * 0.42, length * 0.030) + width * 0.10
        ph1, ph2 = rnd.uniform(0, 6.3), rnd.uniform(0, 6.3)
        f1, f2 = rnd.uniform(0.4, 1.1), rnd.uniform(1.6, 3.2)
        a1, a2 = wob, wob * 0.38

        dabs = []
        skip_until = -1
        for i, (px, py) in enumerate(dense):
            t = i / max(1, total - 1)
            j = min(total - 1, i + 1)
            dx = dense[j][0] - dense[max(0, i - 1)][0]
            dy = dense[j][1] - dense[max(0, i - 1)][1]
            ln = math.hypot(dx, dy) or 1.0
            nx, ny = -dy / ln, dx / ln
            off = (math.sin(t * f1 * 6.28 + ph1) * a1
                   + math.sin(t * f2 * 6.28 + ph2) * a2)
            x = px + nx * off + rnd.uniform(-0.25, 0.25)
            y = py + ny * off + rnd.uniform(-0.25, 0.25)
            if i < skip_until:
                continue
            if rnd.random() < gaps / 26.0:
                skip_until = i + rnd.randint(2, 7)
                continue
            # chalk bites hardest mid-stroke and lifts at the ends
            pr = press * (0.62 + 0.38 * math.sin(math.pi * min(1.0, max(0.0, t))))
            pr *= rnd.uniform(0.86, 1.06)
            r = width * 0.5 * rnd.uniform(0.86, 1.06)
            dabs.append((x, y, r, max(50, min(255, int(255 * pr)))))
        if not dabs:
            return
        ss = self.ss
        x0 = max(0, int(min(d[0] - d[2] for d in dabs) * ss) - 2)
        y0 = max(0, int(min(d[1] - d[2] for d in dabs) * ss) - 2)
        x1 = min(self.w * ss, int(max(d[0] + d[2] for d in dabs) * ss) + 2)
        y1 = min(self.h * ss, int(max(d[1] + d[2] for d in dabs) * ss) + 2)
        if x1 <= x0 or y1 <= y0:
            return
        tmp = Image.new("L", (x1 - x0, y1 - y0), 0)
        td = ImageDraw.Draw(tmp)
        for x, y, r, v in dabs:
            td.ellipse([x * ss - r * ss - x0, y * ss - r * ss - y0,
                        x * ss + r * ss - x0, y * ss + r * ss - y0], fill=v)
        reg = self.m.crop((x0, y0, x1, y1))
        self.m.paste(ImageChops.lighter(reg, tmp), (x0, y0))

    def resolve(self, color=CHALK, alpha=0.92, seed=3):
        rnd = random.Random(seed)
        ss = self.ss
        m = self.m
        # asphalt tooth: chalk only takes on the high spots of the tar
        tooth = noise_img(self.w * ss, self.h * ss, rnd, 0, 255, cell=2, blur=0.9)
        tooth = tooth.point(lambda v: 150 + int(v * 0.42))
        coarse = noise_img(self.w * ss, self.h * ss, rnd, 0, 255, cell=9, blur=4)
        coarse = coarse.point(lambda v: 128 + int(v * 0.50))
        m = ImageChops.multiply(m, tooth)
        m = ImageChops.multiply(m, coarse)
        m = m.point(lambda v: min(255, int(v * 2.0)))
        m = m.filter(ImageFilter.GaussianBlur(ss * 0.26))
        img = Image.new("RGBA", (self.w * ss, self.h * ss), color + (0,))
        img.putalpha(m.point(lambda v: int(v * alpha)))
        return img.resize((self.w, self.h), Image.LANCZOS)


def _rot(pts, cx, cy, deg):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * ca - (y - cy) * sa,
             cy + (x - cx) * sa + (y - cy) * ca) for x, y in pts]


# a child's hand, not a font: each glyph is a set of scrawled polylines in a
# unit box (x right, y down).
GLYPH = {
    "1": [[(0.26, 0.24), (0.54, 0.05), (0.48, 0.95)]],
    "2": [[(0.12, 0.22), (0.4, 0.03), (0.82, 0.19), (0.58, 0.52), (0.1, 0.93),
           (0.87, 0.89)]],
    "3": [[(0.1, 0.12), (0.55, 0.02), (0.86, 0.24), (0.46, 0.47)],
          [(0.44, 0.46), (0.9, 0.6), (0.76, 0.93), (0.16, 0.9), (0.06, 0.78)]],
    "4": [[(0.66, 0.04), (0.1, 0.68), (0.9, 0.63)], [(0.6, 0.3), (0.68, 0.96)]],
    "5": [[(0.84, 0.06), (0.24, 0.08), (0.16, 0.45), (0.56, 0.38),
           (0.84, 0.6), (0.66, 0.92), (0.18, 0.88)]],
    "6": [[(0.78, 0.05), (0.32, 0.22), (0.14, 0.62), (0.34, 0.93),
           (0.72, 0.87), (0.8, 0.58), (0.48, 0.48), (0.2, 0.6)]],
    "7": [[(0.1, 0.07), (0.88, 0.05), (0.4, 0.96)], [(0.26, 0.55), (0.66, 0.5)]],
    "8": [[(0.5, 0.04), (0.18, 0.18), (0.5, 0.45), (0.82, 0.22), (0.5, 0.04)],
          [(0.5, 0.45), (0.12, 0.66), (0.46, 0.96), (0.86, 0.74), (0.5, 0.45)]],
    "9": [[(0.82, 0.42), (0.46, 0.52), (0.16, 0.34), (0.4, 0.06),
           (0.76, 0.12), (0.84, 0.42), (0.56, 0.96)]],
    "S": [[(0.86, 0.14), (0.44, 0.02), (0.1, 0.2), (0.3, 0.44), (0.62, 0.52),
           (0.86, 0.68), (0.68, 0.94), (0.18, 0.9), (0.06, 0.76)]],
    "E": [[(0.2, 0.05), (0.14, 0.95)], [(0.16, 0.06), (0.84, 0.02)],
          [(0.17, 0.5), (0.68, 0.47)], [(0.14, 0.94), (0.86, 0.9)]],
    "W": [[(0.03, 0.04), (0.27, 0.96), (0.5, 0.36), (0.73, 0.96), (0.97, 0.04)]],
    "R": [[(0.18, 0.96), (0.2, 0.04)],
          [(0.2, 0.05), (0.7, 0.09), (0.82, 0.3), (0.22, 0.47)],
          [(0.38, 0.45), (0.88, 0.96)]],
    "N": [[(0.12, 0.96), (0.16, 0.04), (0.8, 0.9), (0.86, 0.06)]],
    "O": [[(0.5, 0.04), (0.14, 0.28), (0.16, 0.74), (0.52, 0.96), (0.86, 0.7),
           (0.84, 0.24), (0.5, 0.04)]],
    "K": [[(0.2, 0.04), (0.16, 0.96)], [(0.82, 0.05), (0.18, 0.52)],
          [(0.24, 0.46), (0.86, 0.95)]],
    "Y": [[(0.08, 0.05), (0.48, 0.5), (0.88, 0.04)], [(0.48, 0.5), (0.44, 0.96)]],
    "!": [[(0.5, 0.04), (0.44, 0.68)], [(0.46, 0.84), (0.45, 0.94)]],
}


def _text_width(s, size, k=0.84):
    """Roughly what _chalk_text will consume, for centring."""
    return sum(size * (0.45 if ch == " " else k) for ch in s)


def _chalk_text(pad, s, x, y, size, width, rnd, tilt=0.0, jog=0.06, ctr=None):
    """Hand-lettered caps that drift off the baseline the way kids' do."""
    if ctr is None:
        ctr = (x, y + size * 0.5)
    for ch in s:
        if ch == " ":
            x += size * 0.45
            continue
        g = GLYPH.get(ch)
        if not g:
            x += size * 0.84
            continue
        gw = size * rnd.uniform(0.58, 0.70)
        gh = size * rnd.uniform(0.90, 1.08)
        dy = size * rnd.uniform(-jog, jog)
        sl = rnd.uniform(-6, 6)
        for poly in g:
            pts = [(x + px * gw, y + dy + py * gh) for px, py in poly]
            pts = _rot(pts, x + gw * 0.5, y + dy + gh * 0.5, sl)
            pts = _rot(pts, ctr[0], ctr[1], tilt)
            pad.stroke(pts, width * rnd.uniform(0.88, 1.10), gaps=0.10)
        x += size * 0.84
    return x


def build_chalk_marks():
    """300x300 world. Hopscotch, tallies, an arrow, and the game's name."""
    w, h = W(300, 300)
    rnd = random.Random(2718)
    pad = ChalkPad(w, h, ss=3, seed=2718)
    lw = W(3.0)

    # --- hopscotch, leaning a little, numbers scrawled inside
    cx = W(72)
    half = W(26)
    rows = [(1, W(240), W(208)), (1, W(208), W(176)),
            (2, W(176), W(144)), (1, W(144), W(112)),
            (2, W(112), W(80)), (1, W(80), W(48))]
    tilt = -4.0
    ctr = (W(72), W(145))
    num = 1
    for kind, yb, yt in rows:
        if kind == 1:
            boxes = [(cx - half, cx + half)]
        else:
            boxes = [(cx - half * 2, cx), (cx, cx + half * 2)]
        for bx0, bx1 in boxes:
            p = _rot([(bx0, yt), (bx1, yt), (bx1, yb), (bx0, yb)],
                     ctr[0], ctr[1], tilt)
            over = W(2.5)
            for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
                pa = (p[a][0] + rnd.uniform(-over, over),
                      p[a][1] + rnd.uniform(-over, over))
                pb = (p[b][0] + rnd.uniform(-over, over),
                      p[b][1] + rnd.uniform(-over, over))
                pad.stroke([pa, pb], lw, gaps=0.10)
            nsz = W(17)
            nx = (bx0 + bx1) * 0.5 - nsz * 0.32
            ny = (yt + yb) * 0.5 - nsz * 0.52
            np_ = _rot([(nx, ny)], ctr[0], ctr[1], tilt)[0]
            _chalk_text(pad, str(num), np_[0], np_[1], nsz, lw * 0.82, rnd,
                        tilt=tilt, ctr=ctr)
            num += 1
    # the "sky" arc over the top box
    arc = [(cx - half + (2 * half) * (i / 16.0),
            W(48) - math.sin(math.pi * i / 16.0) * W(21)) for i in range(17)]
    pad.stroke(_rot(arc, ctr[0], ctr[1], tilt), lw, gaps=0.12)

    # --- tally marks: two bundles of five
    for gx, gy in ((W(168), W(34)), (W(226), W(42))):
        for i in range(4):
            x = gx + i * W(10) + rnd.uniform(-1.5, 1.5)
            pad.stroke([(x, gy), (x + rnd.uniform(-3, 3), gy + W(26))],
                       lw * 0.9, gaps=0.08)
        pad.stroke([(gx - W(5), gy + W(24)), (gx + W(36), gy + W(2))],
                   lw * 0.9, gaps=0.08)

    # --- crooked arrow pointing down-street
    ax, ay = W(158), W(96)
    bx, by = W(266), W(142)
    pad.stroke([(ax, ay), (ax + W(44), ay + W(6)), (ax + W(80), ay + W(28)),
                (bx, by)], lw * 1.15, gaps=0.06)
    pad.stroke([(bx + W(3), by + W(2)), (bx - W(30), by - W(12))],
               lw * 1.15, gaps=0.05)
    pad.stroke([(bx + W(3), by + W(2)), (bx - W(22), by + W(19))],
               lw * 1.15, gaps=0.05)

    # --- the name, scrawled big across the bottom
    tsz = W(30)
    tw = _text_width("3 SEWERS", tsz)
    tx = W(150) - tw * 0.5
    _chalk_text(pad, "3 SEWERS", tx, W(238), tsz, lw * 1.3, rnd,
                tilt=-5.0, jog=0.08, ctr=(W(150), W(254)))

    # --- a scribbled underline
    und = [(tx - W(4) + (tw + W(8)) * (i / 12.0),
            W(285) + math.sin(i * 1.7) * W(2.6)) for i in range(13)]
    pad.stroke(_rot(und, W(150), W(280), -5.0), lw * 1.05, gaps=0.14)

    # --- a stray star, drawn in one go the way kids do
    sx, sy, sr = W(146), W(64), W(15)
    star = [(sx + math.cos(math.radians(-90 + k * 144)) * sr,
             sy + math.sin(math.radians(-90 + k * 144)) * sr)
            for k in range(6)]
    pad.stroke(star, lw * 0.85, gaps=0.10)

    return pad.resolve(color=CHALK, alpha=0.9, seed=99)


# ================================================================== registry
WORLD = {
    "prp_facade_l": (420, 1000),
    "prp_facade_r": (420, 1000),
    "prp_skyline": (1400, 260),
    "prp_watertower": (160, 200),
    "prp_gutter_grate": (90, 36),
    "prp_manhole_steam": (120, 150),
    "prp_chalk_marks": (300, 300),
}

BUILDERS = {
    "prp_facade_l": build_facade_l,
    "prp_facade_r": build_facade_r,
    "prp_skyline": build_skyline,
    "prp_watertower": build_watertower,
    "prp_gutter_grate": build_gutter_grate,
    "prp_manhole_steam": build_manhole_steam,
    "prp_chalk_marks": build_chalk_marks,
}


def build(outdir, only=None):
    """Render every backdrop piece into outdir. Returns {name: (w, h)}."""
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
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/art_world"
    sel = sys.argv[2:] or None
    for k, v in sorted(build(out, sel).items()):
        print("%-22s %dx%d" % (k, v[0], v[1]))

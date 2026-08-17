#!/usr/bin/env python3
"""THREE SEWERS — night on the block.

The reference art for this game is a gaslit street after dark: warm pools
under the lamps, deep blue shadow everywhere else, cobbles catching the
light, and a moody sky at the end of the canyon. This module draws the
pieces that make that mood.

Nothing here is an object the game simulates — it is all atmosphere.
"""
import math
import os
import random

from PIL import Image, ImageFilter

import artkit as A
from artkit import INK, shade

SS = 2

NIGHT_STONE = (74, 72, 76)      # cobbles read cool where the lamps miss them
NIGHT_STONE_L = (96, 93, 94)
NIGHT_STONE_D = (60, 58, 62)
LAMP_WARM = (255, 206, 130)
SKY_HI = (58, 66, 92)
SKY_LO = (28, 32, 48)
CLOUD = (86, 92, 116)


def _cobble_tile(size=256, seed=5):
    """Irregular setts, hand-laid. Wraps seamlessly in both directions."""
    rnd = random.Random(seed)
    c = A.Canvas(size, size, SS)
    c.rect([0, 0, size, size], fill=NIGHT_STONE_D)
    step = 46                       # big setts; small ones read as gravel
    rows = int(size / (step * 0.78)) + 2
    for row in range(rows):
        stagger = rnd.uniform(0, step)
        for col in range(-1, rows + 2):
            cx = col * step + stagger + rnd.uniform(-6.0, 6.0)
            cy = row * step * 0.78 + step * 0.4 + rnd.uniform(-4.0, 4.0)
            w = step * rnd.uniform(0.46, 0.56)
            h = step * rnd.uniform(0.44, 0.52)
            rot = rnd.uniform(-0.22, 0.22)
            tone = rnd.uniform(0.90, 1.12)
            base = shade(NIGHT_STONE, tone)
            for ox in (-size, 0, size):
                for oy in (-size, 0, size):
                    x, y = cx + ox, cy + oy
                    if x < -step or x > size + step or y < -step or y > size + step:
                        continue
                    # hand-laid stone: dark seat, face, lit crown. Drawn as a
                    # tilted polygon so no two setts are the same pill.
                    pts = []
                    for k in range(7):
                        a = math.tau * k / 7.0 + rot
                        rr = rnd.uniform(0.82, 1.0)
                        pts.append((x + math.cos(a) * w * rr,
                                    y + math.sin(a) * h * rr))
                    seat = [(px, py + 1.5) for px, py in pts]
                    c.poly(seat, fill=NIGHT_STONE_D)
                    c.poly(pts, fill=base)
                    crown = [(x + (px - x) * 0.60, y + (py - y) * 0.60 - h * 0.22)
                             for px, py in pts]
                    c.poly(crown, fill=shade(base, 1.07))
    img = c.resolve().filter(ImageFilter.GaussianBlur(0.6))
    return A.grain(img, 4, seed)


def _light_pool(size=512, warm=LAMP_WARM):
    """Soft radial glow, drawn for additive blending."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    r = size / 2.0
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - r, y - r) / r
            if d >= 1.0:
                continue
            f = (1.0 - d) ** 2.2
            px[x, y] = (warm[0], warm[1], warm[2], int(255 * f))
    return img.filter(ImageFilter.GaussianBlur(size * 0.02))


def _sky(w=2800, h=760, seed=9):
    """Night sky closing the end of the street: gradient, cloud bank, moon."""
    rnd = random.Random(seed)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y in range(h):
        t = y / float(h)
        col = tuple(int(SKY_LO[i] + (SKY_HI[i] - SKY_LO[i]) * (1.0 - t) ** 1.4)
                    for i in range(3))
        for x in range(w):
            px[x, y] = col + (255,)
    c = A.Canvas(w, h, 1)
    c.img = img
    c.d = A.ImageDraw.Draw(img)
    # a low moon behind the bank
    mx, my = w * 0.5, h * 0.34
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = A.ImageDraw.Draw(glow)
    for i in range(30):
        rr = 300 - i * 9
        gd.ellipse([mx - rr, my - rr, mx + rr, my + rr],
                   fill=(210, 198, 168, int(4 + i * 0.9)))
    gd.ellipse([mx - 44, my - 44, mx + 44, my + 44], fill=(240, 232, 200, 225))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(6)))

    # Cloud bank as metaballs: stamp blobs into a mask, blur and threshold, so
    # the silhouette billows instead of showing its component circles.
    mask = Image.new("L", (w, h), 0)
    md = A.ImageDraw.Draw(mask)
    for cy, scale in ((h * 0.46, 0.62), (h * 0.70, 0.80), (h * 0.92, 0.95)):
        x = -200.0
        while x < w + 200:
            rr = rnd.uniform(50, 110) * scale
            yy = cy + rnd.uniform(-30, 30)
            md.ellipse([x - rr, yy - rr * 0.72, x + rr, yy + rr * 0.72], fill=255)
            x += rr * rnd.uniform(0.85, 1.5)
    mask = mask.filter(ImageFilter.GaussianBlur(18))
    mask = mask.point(lambda v: 230 if v > 150 else int(v * 0.30))
    mask = mask.filter(ImageFilter.GaussianBlur(3))

    body = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    bp = body.load()
    for y in range(h):
        t = y / float(h)
        col = shade(CLOUD, 0.80 + 0.55 * t)      # lit from the city below
        for x in range(w):
            bp[x, y] = col + (225,)
    body.putalpha(A.ImageChops.multiply(body.getchannel("A"), mask))
    img.alpha_composite(body)

    # a soft rim where the moon catches the top of the bank
    rim = A.ImageChops.subtract(mask, A.ImageChops.offset(mask, 0, 10))
    rimimg = Image.new("RGBA", (w, h), (206, 198, 176, 0))
    rimimg.putalpha(rim.point(lambda v: int(v * 0.22)))
    img.alpha_composite(rimimg.filter(ImageFilter.GaussianBlur(7)))

    out = img.filter(ImageFilter.GaussianBlur(1.2))
    return A.grain(out, 4, seed)


def build(outdir):
    os.makedirs(outdir, exist_ok=True)
    n = 0
    _cobble_tile(256, 5).save(f"{outdir}/prp_cobble_tile.png")
    n += 1
    _light_pool(512, LAMP_WARM).save(f"{outdir}/prp_lightpool.png")
    n += 1
    _light_pool(512, (255, 226, 176)).save(f"{outdir}/prp_lightpool_soft.png")
    n += 1
    _sky().save(f"{outdir}/prp_nightsky.png")
    n += 1
    return n


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/art_night"
    print("wrote", build(out), "->", out)

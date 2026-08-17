#!/usr/bin/env python3
"""THREE SEWERS — title treatment and paper stock for the front end.

The title screen is the first frame anyone sees, so it gets a real printed
logotype rather than a text label: letterspaced serif caps, a hand-cut arch,
double rules, and the spaldeen sitting in the middle of the word like a
printer's ornament.
"""
import math
import os
import random

from PIL import Image, ImageFilter

import artkit as A
from artkit import CHALK, INK, PAPER, PINK, shade

SS = 3


def _aged_paper(w, h, seed=7):
    """Pulpy card stock: warm base, blotches, fibre speckle, darkened edges."""
    rnd = random.Random(seed)
    c = A.Canvas(w, h, 2)
    c.rect([0, 0, w, h], fill=PAPER)
    # blotches are stamped nine times, wrapped, so the tile has no seam
    for _ in range(70):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(w * 0.02, w * 0.09)
        tone = rnd.choice([shade(PAPER, 0.975), shade(PAPER, 1.015),
                           shade(PAPER, 0.99)])
        for ox in (-w, 0, w):
            for oy in (-h, 0, h):
                c.circle(x + ox, y + oy, r, fill=tone)
    for _ in range(700):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(0.6, 1.9)
        col = rnd.choice([shade(PAPER, 0.93), shade(PAPER, 0.88),
                          shade(PAPER, 1.04)])
        for ox in (-w, 0, w):
            for oy in (-h, 0, h):
                c.circle(x + ox, y + oy, r, fill=col)
    img = c.resolve()
    img = img.filter(ImageFilter.GaussianBlur(0.4))
    return A.grain(img, 5, seed)


def build(outdir):
    os.makedirs(outdir, exist_ok=True)
    n = 0

    # ---- paper stock tile for menu backgrounds
    _aged_paper(512, 512, 11).save(f"{outdir}/ui_paper.png")
    n += 1

    # ---- the logotype ------------------------------------------------
    W, H = 1800, 620          # 2x of a 900x310 world plate
    c = A.Canvas(W, H, SS)
    cx = W / 2

    big = A.font("serif_bold", 190)
    small = A.font("serif_bold", 54)
    tiny = A.font("serif_bold", 40)

    # arched top word
    def arched(word, f, cy, radius, spread, fill, tracking=18):
        widths = [c.d.textlength(ch, font=f) for ch in word]
        total = sum(widths) + tracking * (len(word) - 1)
        pos = -total / 2
        for ch, wch in zip(word, widths):
            centre = pos + wch / 2
            t = centre / (total / 2)                     # -1 .. 1
            ang = t * spread
            x = cx + math.sin(math.radians(ang)) * radius
            y = cy + (1 - math.cos(math.radians(ang))) * radius
            layer = Image.new("RGBA", c.img.size, (0, 0, 0, 0))
            d2 = A.ImageDraw.Draw(layer)
            d2.text((c._s(x), c._s(y)), ch, font=f, fill=fill, anchor="mm")
            layer = layer.rotate(-ang, resample=Image.BICUBIC,
                                 center=(c._s(x), c._s(y)))
            c.img.alpha_composite(layer)
            pos += wch + tracking

    # drop shadow pass then the ink pass, offset — cheap letterpress
    arched("THREE", big, 214, 900, 15, (120, 96, 72, 120))
    arched("THREE", big, 208, 900, 15, INK + (255,))
    arched("SEWERS", big, 470, -900, -13, (120, 96, 72, 120))
    arched("SEWERS", big, 464, -900, -13, INK + (255,))

    # rules above and below
    for y, wgt in ((96, 7), (110, 3)):
        c.line([(cx - 640, y), (cx + 640, y)], INK, wgt)
    for y, wgt in ((566, 3), (580, 7)):
        c.line([(cx - 560, y), (cx + 560, y)], INK, wgt)

    A.text_spaced(c.d, (c._s(cx), c._s(58)),
                  "A STICKBALL PICTURE", A.font("serif_bold", 46),
                  (96, 74, 56, 255), c._s(14))
    A.text_spaced(c.d, (c._s(cx), c._s(614 - 12)),
                  "NEW YORK CITY · 1926", A.font("serif_bold", 42),
                  (96, 74, 56, 255), c._s(12))

    img = A.finish(c, ink=0, light=False, grain_amt=4, seed=3)

    # the spaldeen, the one saturated thing, wedged between the two words
    ball = A.Canvas(150, 150, SS)
    ball.circle(75, 75, 60, fill=INK)
    ball.sphere(75, 75, 55, PINK)
    ball.circle(56, 54, 16, fill=(252, 206, 210))
    bimg = A.cel_light(ball.img, 0.5, SS).resize((150, 150), Image.LANCZOS)
    img.alpha_composite(bimg, (int(W / 2 - 75), 300))
    img.save(f"{outdir}/ui_title.png")
    n += 1

    # ---- intertitle plate (9-patch: 60px margins all round) ----------
    # Every SOCK! / OUT! / THREE SEWERS! card is stamped on this stock.
    PL = 360
    c3 = A.Canvas(PL, PL, 2)
    plate = _aged_paper(PL, PL, 21)
    c3.img.alpha_composite(plate.resize((PL * 2, PL * 2), Image.LANCZOS))
    m = 16
    c3.rrect([m, m, PL - m, PL - m], 14, outline=INK, width=9)
    c3.rrect([m + 20, m + 20, PL - m - 20, PL - m - 20], 8,
             outline=shade(INK, 1.7), width=3)
    # corner printer's ornaments
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
        px = PL / 2 + sx * (PL / 2 - m - 34)
        py = PL / 2 + sy * (PL / 2 - m - 34)
        c3.circle(px, py, 7, fill=INK)
    img3 = c3.resolve()
    # punch the middle transparent so the 9-patch stretches cleanly
    img3.save(f"{outdir}/ui_card_plate.png")
    n += 1

    # ---- scoreboard slate (9-patch: 60px margins) --------------------
    # A board the kids chalked themselves and nailed to the brick.
    BW = 360
    c4 = A.Canvas(BW, BW, 2)
    rnd = random.Random(33)
    board = shade(A.BRICKC if hasattr(A, "BRICKC") else (110, 74, 50), 0.62)
    c4.rrect([6, 6, BW - 6, BW - 6], 12, fill=board)
    for _ in range(500):                       # slate tooth
        x, y = rnd.uniform(8, BW - 8), rnd.uniform(8, BW - 8)
        c4.circle(x, y, rnd.uniform(0.7, 2.2),
                  fill=rnd.choice([shade(board, 1.10), shade(board, 0.90),
                                   shade(board, 1.04)]))
    c4.rrect([6, 6, BW - 6, BW - 6], 12, outline=shade(board, 0.55), width=8)
    c4.rrect([20, 20, BW - 20, BW - 20], 8, outline=CHALK, width=4)
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):   # nail heads
        c4.circle(BW / 2 + sx * (BW / 2 - 34), BW / 2 + sy * (BW / 2 - 34),
                  6, fill=shade(board, 0.5))
    c4.resolve().save(f"{outdir}/ui_board.png")
    n += 1

    # ---- rack header plate -------------------------------------------
    c2 = A.Canvas(1200, 190, SS)
    c2.rrect([8, 8, 1192, 182], 18, fill=PAPER, outline=INK, width=7)
    c2.line([(40, 150), (1160, 150)], shade(PAPER, 0.82), 4)
    A.text_spaced(c2.d, (c2._s(600), c2._s(84)), "PICK YOUR SIX",
                  A.font("serif_bold", 92), INK + (255,), c2._s(16))
    A.finish(c2, ink=0, light=False, grain_amt=5, seed=5).save(
        f"{outdir}/ui_rack_header.png")
    n += 1
    return n


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/art_ui"
    print("wrote", build(out), "->", out)

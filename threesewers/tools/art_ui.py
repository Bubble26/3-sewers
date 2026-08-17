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

    # ---- in-game HUD: pill plates, pips, corner touch buttons --------
    n += build_hud(outdir)

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


def build_hud(outdir):
    """The in-game HUD, in the reference's language: parchment pill plates
    with icon pips at the top corners, and round parchment touch buttons with
    ink silhouettes at the bottom corners. No text strips."""
    n = 0

    # -- pill plate, 9-patch (36px margins at this size)
    PW, PH = 260, 104
    c = A.Canvas(PW, PH, SS)
    c.rrect([8, 10, PW - 8, PH - 4], 34, fill=(14, 12, 14, 170))     # seat shadow
    c.rrect([6, 6, PW - 6, PH - 8], 34, fill=INK)                    # ink ring
    c.rrect([17, 17, PW - 17, PH - 19], 24, fill=PAPER)
    c.rrect([17, 17, PW - 17, PH - 19], 24, outline=shade(PAPER, 0.82), width=2)
    # slight top sheen on the paper, kept inside the ink ring
    c.chord([28, 21, PW - 28, PH * 0.58], 180, 360, fill=shade(PAPER, 1.05))
    img = A.finish(c, ink=0, light=False, grain_amt=5, seed=41)
    img.save(f"{outdir}/ui_pill.png")
    n += 1

    # -- pips ----------------------------------------------------------
    def pip_ball():
        p = A.Canvas(72, 72, SS)
        p.circle(36, 36, 27, fill=INK)
        p.sphere(36, 36, 23, (246, 242, 230))
        # stitching — two seams hugging the edges, muted rust
        p.arc([-8, 12, 34, 60], 305, 55, (150, 84, 54), 3.2)
        p.arc([38, 12, 80, 60], 125, 235, (150, 84, 54), 3.2)
        return A.finish(p, ink=0, light=False)

    def pip_star():
        p = A.Canvas(72, 72, SS)
        pts = []
        for k in range(10):
            ang = -math.pi / 2 + k * math.pi / 5
            r = 30 if k % 2 == 0 else 13
            pts.append((36 + math.cos(ang) * r, 36 + math.sin(ang) * r))
        grown = [(36 + (x - 36) * 1.18, 36 + (y - 36) * 1.18) for x, y in pts]
        p.poly(grown, fill=INK)
        p.poly(pts, fill=A.GOLD)
        inner = [(36 + (x - 36) * 0.55, 36 + (y - 36) * 0.55 - 2) for x, y in pts]
        p.poly(inner, fill=shade(A.GOLD, 1.14))
        return A.finish(p, ink=0, light=False)

    def pip_out():
        p = A.Canvas(64, 64, SS)
        p.circle(32, 32, 24, fill=INK)
        p.circle(32, 32, 19, fill=(84, 74, 66))
        p.circle(28, 28, 12, fill=(104, 92, 82))
        return A.finish(p, ink=0, light=False)

    pip_ball().save(f"{outdir}/ui_pip_ball.png")
    pip_star().save(f"{outdir}/ui_pip_star.png")
    pip_out().save(f"{outdir}/ui_pip_out.png")
    n += 3

    # -- round touch buttons -------------------------------------------
    def button(glyph_fn):
        B = 220
        b = A.Canvas(B, B, SS)
        b.circle(B / 2, B / 2 + 4, 92, fill=(10, 10, 12, 150))       # soft seat
        b.circle(B / 2, B / 2, 92, fill=(228, 222, 208, 228))
        b.circle(B / 2, B / 2, 92, outline=(60, 52, 44, 255), width=4)
        b.circle(B / 2, B / 2, 82, outline=(60, 52, 44, 90), width=2)
        glyph_fn(b, B / 2, B / 2)
        return A.finish(b, ink=0, light=False, grain_amt=4, seed=17)

    def glyph_run(b, cx, cy):
        """A kid at full sprint, solid ink silhouette."""
        g = INK
        b.capsule((cx + 10, cy - 26), (cx - 8, cy + 8), 26, 20, g)    # torso, leaning
        b.circle(cx + 20, cy - 40, 16, fill=g)                        # head on the lean
        b.capsule((cx + 8, cy - 20), (cx + 38, cy - 2), 11, 8, g)     # front arm
        b.capsule((cx + 2, cy - 18), (cx - 26, cy - 30), 11, 8, g)    # back arm
        b.capsule((cx - 6, cy + 4), (cx + 24, cy + 24), 12, 10, g)    # front leg
        b.capsule((cx + 24, cy + 24), (cx + 42, cy + 20), 10, 9, g)   # shin + boot
        b.capsule((cx - 6, cy + 4), (cx - 24, cy + 32), 12, 10, g)    # back leg
        b.capsule((cx - 24, cy + 32), (cx - 40, cy + 44), 10, 9, g)

    def glyph_hand(b, cx, cy):
        """An open palm, solid ink silhouette."""
        g = INK
        b.rrect([cx - 26, cy - 12, cx + 26, cy + 44], 20, fill=g)     # palm
        fingers = [(-19, -44, 9), (-6, -52, 10), (7, -50, 10), (19, -40, 9)]
        for fx, fy, w in fingers:
            b.capsule((cx + fx, cy - 6), (cx + fx, cy + fy + 14), w * 2, w * 1.7, g)
        b.capsule((cx - 24, cy + 12), (cx - 44, cy - 6), 18, 14, g)   # thumb
    button(glyph_run).save(f"{outdir}/ui_btn_run.png")
    button(glyph_hand).save(f"{outdir}/ui_btn_hand.png")
    n += 2
    return n


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/art_ui"
    print("wrote", build(out), "->", out)

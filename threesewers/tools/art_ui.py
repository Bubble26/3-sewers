#!/usr/bin/env python3
"""THREE SEWERS — the front end: the block at night, and the printed chrome.

The match is a warm gaslit night on the street, so the menus cannot be bright
paper screens — they have to be PLACES in the same night. This module paints
them:

  the title    the corner outside Papadakis' candy store after dark, the
               logotype hanging over the sidewalk on a painted banner
  the rack     the brick wall under the store awning, where the kids' cards
               stand in a wooden rail like penny candy

Both are composed out of the very prop tiles the match street is built from
(brick, cobble, curb, lamp, fire escape) and then relit by one renderer:

  _street()    lays the scene out flat, in daylight tones
  _gaslight()  relights it — deep night everywhere, warm pools under the lamp
               and spilling out of the shop window, bloom, vignette

so the front end is lit by the same lamps as the game. Everything printed —
banner, ticket buttons, ribbons, the intertitle plate — is aged stock with a
confident ink line, and the spaldeen's pink stays the only saturated thing on
screen.
"""
import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

import artkit as A
from artkit import CHALK, INK, PAPER, PINK, shade

try:
    import numpy as np
except ImportError:                      # the relight needs it; art degrades
    np = None

SS = 3
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------- night grade
# One lamp colour for the whole game. Unlit stock goes cold and deep, lit
# stock goes amber, and the light map lerps between the two.
NIGHT_MUL = (0.32, 0.29, 0.33)      # what the night does to a surface
LAMP_MUL = (1.46, 1.14, 0.74)       # what the gaslight does to a surface
LAMP_ADD = (1.00, 0.70, 0.34)       # colour of the bloom itself
GAS = (255, 208, 132)               # the flame
ENAMEL = (56, 76, 64)               # shop fascia green, deep and muted
WOOD = (112, 80, 54)
WOOD_L = (146, 110, 74)
WOOD_D = (72, 50, 33)


def _f(kind, px, ss=SS):
    """A font sized in FINAL pixels (artkit's canvas draws supersampled)."""
    return A.font(kind, max(4, int(round(px * ss))))


# ---------------------------------------------------------------- stock
def _aged_paper(w, h, seed=7):
    """Pulpy card stock: warm base, blotches, fibre speckle."""
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


# ---------------------------------------------------------------- logotype
def _logotype(c, cx, cy, scale=1.0, ink=INK):
    """THREE / SEWERS arched around the spaldeen — the printed wordmark.

    Drawn into an existing canvas so it can sit on a banner, a plate or bare
    stock. Coordinates are final pixels. The whole block scales as one unit:
    at scale 1.0 it measures about 1300 x 600, and the letters are spaced by
    the ARC (radius + spread), not by the type size, so both have to move
    together or the words collide.
    """
    big = _f("serif_bold", 63.5 * scale, c.ss)
    cap = _f("serif_bold", 15.5 * scale, c.ss)

    def arched(word, f, y, radius, spread, fill, tracking):
        widths = [c.d.textlength(ch, font=f) for ch in word]
        total = sum(widths) + tracking * (len(word) - 1)
        pos = -total / 2
        for ch, wch in zip(word, widths):
            t = (pos + wch / 2) / (total / 2)              # -1 .. 1
            ang = t * spread
            x = cx + math.sin(math.radians(ang)) * radius
            yy = y + (1 - math.cos(math.radians(ang))) * radius
            layer = Image.new("RGBA", c.img.size, (0, 0, 0, 0))
            ImageDraw.Draw(layer).text((c._s(x), c._s(yy)), ch, font=f,
                                       fill=fill, anchor="mm")
            layer = layer.rotate(-ang, resample=Image.BICUBIC,
                                 center=(c._s(x), c._s(yy)))
            c.img.alpha_composite(layer)
            pos += wch + tracking

    rad = 900.0 * scale
    trk = 6.0 * scale * c.ss
    soft = shade(ink, 1.7) + (120,)
    # letterpress: a soft off-register impression, then the ink pass
    arched("THREE", big, cy - 90 * scale, rad, 15, soft, trk)
    arched("THREE", big, cy - 96 * scale, rad, 15, ink + (255,), trk)
    arched("SEWERS", big, cy + 166 * scale, -rad, -13, soft, trk)
    arched("SEWERS", big, cy + 160 * scale, -rad, -13, ink + (255,), trk)

    for dy, wgt, half in ((-214, 7, 640), (-200, 3, 640),
                          (256, 3, 560), (270, 7, 560)):
        c.line([(cx - half * scale, cy + dy * scale),
                (cx + half * scale, cy + dy * scale)], ink, wgt * scale)
    A.text_spaced(c.d, (c._s(cx), c._s(cy - 252 * scale)),
                  "A STICKBALL PICTURE", cap, shade(ink, 1.45) + (255,),
                  c._s(4.7 * scale))
    A.text_spaced(c.d, (c._s(cx), c._s(cy + 292 * scale)),
                  "NEW YORK CITY · 1926", _f("serif_bold", 14 * scale, c.ss),
                  shade(ink, 1.45) + (255,), c._s(4.0 * scale))


def _spaldeen(size=150, ss=SS):
    """The one saturated thing on any screen."""
    b = A.Canvas(size, size, ss)
    r = size * 0.40
    b.circle(size / 2, size / 2, r * 1.09, fill=INK)
    b.sphere(size / 2, size / 2, r, PINK)
    b.circle(size / 2 - r * 0.34, size / 2 - r * 0.38, r * 0.28,
             fill=(252, 206, 210))
    return A.cel_light(b.img, 0.5, ss).resize((size, size), Image.LANCZOS)


# ================================================================ the street
def _props_dir(outdir):
    sib = os.path.join(os.path.dirname(os.path.abspath(outdir)), "props")
    if os.path.isdir(sib):
        return sib
    return os.path.join(ROOT, "assets", "props")


_prop_cache = {}


def _prop(pd, name):
    key = (pd, name)
    if key not in _prop_cache:
        p = os.path.join(pd, "prp_%s.png" % name)
        _prop_cache[key] = Image.open(p).convert("RGBA") if os.path.exists(p) else None
    return _prop_cache[key]


def _fit(img, w=None, h=None):
    if img is None:
        return None
    if w is None:
        w = max(1, int(round(img.width * h / img.height)))
    if h is None:
        h = max(1, int(round(img.height * w / img.width)))
    return img.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)


def _tiled(tile, w, h, scale=1.0):
    """A w×h patch of a seamless tile, clipped to the patch."""
    out = Image.new("RGBA", (int(w), int(h)), (0, 0, 0, 0))
    if tile is None:
        return out
    t = _fit(tile, int(tile.width * scale), int(tile.height * scale))
    for y in range(0, int(h) + t.height, t.height):
        for x in range(0, int(w) + t.width, t.width):
            out.alpha_composite(t, (x, y))
    return out.crop((0, 0, int(w), int(h)))


def _flat(w, h, col):
    return Image.new("RGBA", (int(w), int(h)), col + (255,))


def _grade(img, f, tint=(1.0, 1.0, 1.0)):
    """Scale a prop's colour before it is pasted, alpha untouched."""
    if img is None:
        return None
    r, g, b, a = img.split()
    r = r.point(lambda v: min(255, int(v * f * tint[0])))
    g = g.point(lambda v: min(255, int(v * f * tint[1])))
    b = b.point(lambda v: min(255, int(v * f * tint[2])))
    return Image.merge("RGBA", (r, g, b, a))


def _gaslight(scene, lights, ambient=0.052, bloom=0.34, vig=0.72,
              haze=0.050, seed=3, grain=3):
    """Relight a flat scene as one gaslit night.

    lights are (cx, cy, rx, ry, gain, falloff, boxy) in pixels. `boxy` picks a
    superellipse instead of a disc, which is what a shop window throws.
    """
    rgb = scene.convert("RGB")
    if np is None:
        return A.grain(rgb.convert("RGBA"), 4, seed)
    a = np.asarray(rgb, dtype=np.float32) / 255.0
    h, w = a.shape[:2]
    ys = np.arange(h, dtype=np.float32)[:, None]
    xs = np.arange(w, dtype=np.float32)[None, :]
    L = np.full((h, w), ambient, np.float32)
    for cx, cy, rx, ry, gain, fall, boxy in lights:
        u = np.abs(xs - cx) / max(rx, 1.0)
        v = np.abs(ys - cy) / max(ry, 1.0)
        d = np.power(u ** 6 + v ** 6, 1.0 / 6.0) if boxy else np.sqrt(u * u + v * v)
        L += gain * np.clip(1.0 - d, 0.0, 1.0) ** fall
    L = np.clip(L, 0.0, 1.35)
    t = np.clip(L, 0.0, 1.0)[..., None]
    dark = a * np.array(NIGHT_MUL, np.float32)
    lit = a * np.array(LAMP_MUL, np.float32)
    out = dark * (1.0 - t) + lit * t

    # bloom: the light map itself, blurred, added back as amber air
    lm = Image.fromarray(np.uint8(np.clip(L, 0, 1) * 255))
    glow = np.asarray(lm.filter(ImageFilter.GaussianBlur(w * 0.018)),
                      np.float32) / 255.0
    out += glow[..., None] * np.array(LAMP_ADD, np.float32) * bloom
    # a touch of standing haze so the dark half is air, not paint
    out += haze * np.array((0.36, 0.34, 0.42), np.float32)

    # vignette — the film shader adds more on top in engine
    nx = (xs - w * 0.5) / (w * 0.5)
    ny = (ys - h * 0.5) / (h * 0.5)
    r = np.sqrt(nx * nx * 0.92 + ny * ny * 0.88)
    v = np.clip((r - 0.42) / 0.85, 0.0, 1.0) ** 1.5
    out *= (1.0 - vig * v)[..., None]

    img = Image.fromarray(np.uint8(np.clip(out, 0, 1) * 255)).convert("RGBA")
    # light tooth only: the film shader lays live grain over this in engine,
    # and baked noise is most of what a full-screen plate costs on disk
    return A.grain(img, grain, seed)


def _awning(w, h, ss=2, seed=4, n=None):
    """A canvas awning: sloped out from the wall, striped, scalloped valance.

    The top edge is inset (where it bolts to the brick) and the front lip runs
    the full width, so the cloth reads as leaning out over the sidewalk.
    """
    c = A.Canvas(int(w), int(h), ss)
    inset = w * 0.055
    y_top = h * 0.05
    y_lip = h * 0.62
    n = n or max(9, int(w / (h * 0.52)) | 1)
    scal = (w / n) * 0.5
    for i in range(n):
        t0, t1 = i / float(n), (i + 1) / float(n)
        xa0, xa1 = inset + (w - 2 * inset) * t0, inset + (w - 2 * inset) * t1
        xb0, xb1 = w * t0, w * t1
        col = (212, 196, 164) if i % 2 == 0 else (146, 82, 54)
        c.poly([(xa0, y_top), (xa1 + 1, y_top), (xb1 + 1, y_lip), (xb0, y_lip)],
               fill=col)
        cxs = (xb0 + xb1) * 0.5
        c.pieslice([cxs - scal, y_lip - scal * 0.86, cxs + scal,
                    y_lip + scal * 1.14], 0, 180, fill=shade(col, 0.92))
    ov = c.overlay()                       # the cloth's own shading
    ov.poly([(0, y_top), (w, y_top), (w, y_top + (y_lip - y_top) * 0.34),
             (0, y_top + (y_lip - y_top) * 0.34)], fill=(28, 18, 12, 70))
    ov.rect([0, y_lip - h * 0.05, w, y_lip + scal * 1.1], fill=(28, 18, 12, 46))
    c.merge(ov)
    c.rrect([-2, y_lip - h * 0.055, w + 2, y_lip - h * 0.005], h * 0.03,
            fill=(46, 42, 40))             # front rod
    c.rect([0, y_top - h * 0.035, w, y_top + h * 0.02], fill=(40, 36, 34))
    return c


def _brick_wall(pd, w, h, seed=6):
    """Brick with mortar patches and a faded painted advert."""
    out = _tiled(_prop(pd, "brick_tile"), w, h, 1.0)
    if _prop(pd, "brick_tile") is None:
        out = _flat(w, h, (104, 74, 54))
    rnd = random.Random(seed)
    ov = A.Canvas(int(w), int(h), 1)
    ov.img = out
    ov.d = ImageDraw.Draw(out)
    stain = A.Canvas(int(w), int(h), 1)
    for _ in range(int(w * h / 90000)):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        r = rnd.uniform(w * 0.05, w * 0.16)
        stain.circle(x, y, r, fill=(52, 40, 32, rnd.randint(14, 34)))
    out.alpha_composite(stain.img.filter(ImageFilter.GaussianBlur(w * 0.02)))
    return out


def _tenement_windows(pd, dst, x0, x1, y0, y1, cols, rows, lit, lights, seed=3):
    """A grid of sash windows on the wall. Most are dark; a couple burn."""
    rnd = random.Random(seed)
    win = _prop(pd, "window")
    if win is not None:                     # the stone frame is far too bright
        win = _grade(win, 0.42)             # for a street lit by one lamp
    ww = (x1 - x0) / (cols + 1.1)
    wh = ww * 1.42
    for r in range(rows):
        for k in range(cols):
            x = x0 + ww * 0.55 + k * (x1 - x0 - ww * 1.1) / max(1, cols - 1)
            y = y0 + (y1 - y0) * (r + 0.55) / (rows + 0.25)
            on = (r * cols + k) in lit
            if on:                          # a warm room behind the glass
                gl = _flat(ww * 0.70, wh * 0.66, (150, 104, 52))
                dst.alpha_composite(gl, (int(x - ww * 0.35), int(y - wh * 0.30)))
                lights.append((x, y, ww * 0.62, wh * 0.55, 0.34, 2.4, True))
            if win is not None:
                dst.alpha_composite(_fit(win, w=ww), (int(x - ww / 2),
                                                      int(y - wh / 2)))
            sl = _flat(ww * 1.10, wh * 0.055, (78, 70, 60))    # stone sill
            dst.alpha_composite(sl, (int(x - ww * 0.55), int(y + wh * 0.45)))


def _fit_text(text, kind, box_w, px, ss, track):
    """Shrink a letterspaced line until it fits the board — no clipped signage."""
    for _ in range(28):
        f = _f(kind, px, ss)
        w = sum(f.getlength(ch) for ch in text) / ss + track * (len(text) - 1)
        if w <= box_w:
            return f, px
        px *= 0.94
    return _f(kind, px, ss), px


def _storefront(pd, dst, x0, x1, ytop, ybot, lights, name="PAPADAKIS", seed=5):
    """Fascia sign, striped awning, plate glass with the candy jars behind."""
    w = x1 - x0
    h = ybot - ytop
    fascia_h = h * 0.185
    awn_h = h * 0.30
    glass_top = ytop + fascia_h + awn_h * 0.52
    gh = ybot - glass_top

    # -- fascia board: deep enamel green, gold letters, a bead top and bottom
    c = A.Canvas(int(w), int(fascia_h), 2)
    c.rect([0, 0, w, fascia_h], fill=ENAMEL)
    c.rect([0, 0, w, fascia_h * 0.11], fill=shade(ENAMEL, 1.4))
    c.rect([0, fascia_h * 0.88, w, fascia_h], fill=shade(ENAMEL, 0.55))
    label = "%s · CANDY & SODA" % name
    track = fascia_h * 0.13
    # the lamp stands at the left, so the sign is centred off the shop's own
    # window bay instead of the plate, and never runs under the post
    f, _px = _fit_text(label, "serif_bold", w * 0.74, fascia_h * 0.42,
                       c.ss, track)
    A.text_spaced(c.d, (c._s(w * 0.56), c._s(fascia_h * 0.50)), label, f,
                  A.GOLD + (255,), c._s(track))
    dst.alpha_composite(c.resolve(), (int(x0), int(ytop)))

    # -- plate glass: warm room, shelves of jars, iron piers, a lit doorway
    g = A.Canvas(int(w), int(gh), 2)
    g.rect([0, 0, w, gh], fill=(44, 36, 32))
    win_l, win_r = w * 0.055, w * 0.615
    door_l, door_r = w * 0.655, w * 0.845
    bay_l, bay_r = w * 0.875, w * 0.955
    g.rect([win_l, gh * 0.06, win_r, gh * 0.82], fill=(170, 120, 58))
    rnd = random.Random(seed)
    for sy in (0.34, 0.60):                       # two shelves of jars
        y = gh * sy
        jn = 9
        for jx in range(jn):
            span = win_r - win_l
            jw = span / (jn + 2.4)
            x = win_l + jw * 1.2 + jx * (span - jw * 2.4) / (jn - 1)
            jh = jw * rnd.uniform(0.95, 1.45)
            body = (58, 40, 28)
            g.rrect([x - jw * 0.40, y - jh, x + jw * 0.40, y], jw * 0.30,
                    fill=body)
            g.rrect([x - jw * 0.19, y - jh - jw * 0.20, x + jw * 0.19, y - jh],
                    jw * 0.08, fill=shade(body, 0.8))
        g.rect([win_l, y, win_r, y + gh * 0.020], fill=(70, 48, 32))
    g.rect([win_l, gh * 0.82, win_r, gh * 0.86], fill=(64, 46, 32))
    # hand-lettered decal on the glass
    A.text_spaced(g.d, (g._s(w * 0.40), g._s(gh * 0.755)),
                  "ICE  CREAM  ·  NEWS", _f("serif_bold", gh * 0.068, g.ss),
                  (58, 40, 26, 225), g._s(gh * 0.022))
    # doorway, transom burning above it
    g.rect([door_l, gh * 0.04, door_r, gh], fill=(30, 24, 22))
    g.rect([door_l, gh * 0.04, door_r, gh * 0.15], fill=(196, 142, 70))
    g.rect([door_l + w * 0.010, gh * 0.22, door_r - w * 0.010, gh * 0.66],
           fill=(52, 42, 34))
    g.rect([bay_l, gh * 0.06, bay_r, gh * 0.82], fill=(40, 40, 44))
    for px in (win_l, win_r, door_l, door_r, bay_l, bay_r):   # iron piers
        g.rect([px - w * 0.010, 0, px + w * 0.010, gh], fill=(40, 36, 34))
    g.rect([0, gh * 0.87, w, gh], fill=(52, 46, 40))          # bulkhead
    g.rect([0, gh * 0.87, w, gh * 0.90], fill=(76, 68, 58))
    ov = g.overlay()                                          # raking reflection
    ov.poly([(win_l, gh * 0.80), (win_l + w * 0.17, gh * 0.06),
             (win_l + w * 0.25, gh * 0.06), (win_l + w * 0.06, gh * 0.80)],
            fill=(206, 216, 230, 26))
    g.merge(ov)
    dst.alpha_composite(g.resolve(), (int(x0), int(glass_top)))
    lights.append((x0 + (win_l + win_r) / 2, glass_top + gh * 0.44,
                   (win_r - win_l) * 0.60, gh * 0.50, 0.66, 2.0, True))
    lights.append((x0 + (door_l + door_r) / 2, glass_top + gh * 0.10,
                   w * 0.075, gh * 0.10, 0.52, 2.0, True))

    # -- awning last, so the cloth hangs in front of the glass
    aw = _awning(w * 0.66, awn_h)
    dst.alpha_composite(aw.resolve(), (int(x0 + w * 0.005),
                                       int(ytop + fascia_h)))
    return glass_top


# vertical layout of the street plate, as fractions of its height. The bands
# between the wall top and the fascia are deliberately kept dark and plain —
# that is where the banner and the buttons land.
BANDS_P = dict(sky=0.112, wall=0.660, rows=(0.150, 0.430),
               walk=0.900, curb=0.948, lamp_h=0.315, fe=0.66)
BANDS_L = dict(sky=0.095, wall=0.655, rows=(0.135, 0.420),
               walk=0.925, curb=0.960, lamp_h=0.400, fe=0.80)


def _street(pd, w, h, landscape, seed=11):
    """The corner outside the candy store, laid out flat and then relit."""
    W, H = int(w), int(h)
    img = Image.new("RGBA", (W, H), (14, 12, 15, 255))
    lights = []
    rnd = random.Random(seed)
    B = BANDS_L if landscape else BANDS_P

    y_sky = H * B["sky"]
    y_corn = y_sky + H * 0.026
    y_store = H * B["wall"]
    y_walk = H * B["walk"]
    y_curb = H * B["curb"]

    # -- sky: gradient, stars, a low moon behind the roofline
    sky = Image.new("RGBA", (W, int(y_corn) + 2), (0, 0, 0, 0))
    sp = sky.load()
    for y in range(sky.height):
        t = y / float(sky.height)
        col = (int(26 + 30 * t), int(26 + 27 * t), int(34 + 26 * t))
        for x in range(W):
            sp[x, y] = col + (255,)
    glow = Image.new("RGBA", sky.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    mx, my = W * 0.70, sky.height * 0.40
    mr = sky.height * 0.115
    for i in range(24):                    # halo, composited so it blends
        rr = mr * (5.0 - i * 0.19)
        gd.ellipse([mx - rr, my - rr, mx + rr, my + rr],
                   fill=(190, 184, 162, 4 + i // 2))
    gd.ellipse([mx - mr, my - mr, mx + mr, my + mr], fill=(232, 224, 196, 240))
    sky.alpha_composite(glow.filter(ImageFilter.GaussianBlur(sky.height * 0.02)))
    sd = ImageDraw.Draw(sky)
    for _ in range(110):
        x, y = rnd.uniform(0, W), rnd.uniform(0, sky.height * 0.85)
        r = rnd.uniform(0.5, 1.5)
        sd.ellipse([x - r, y - r, x + r, y + r], fill=(206, 202, 192, 210))
    img.alpha_composite(sky)
    tower = _prop(pd, "watertower")
    if tower is not None:
        t = _fit(_grade(tower, 0.34), h=y_corn * 0.80)
        img.alpha_composite(t, (int(W * 0.11), int(y_corn - t.height)))

    # -- the wall
    img.alpha_composite(_brick_wall(pd, W, y_store - y_sky + 4, seed),
                        (0, int(y_sky)))
    corn = _prop(pd, "cornice")
    if corn is not None:
        ch = H * 0.034
        img.alpha_composite(_tiled(_fit(_grade(corn, 0.85), h=ch), W, ch),
                            (0, int(y_sky - ch * 0.60)))
    cols = 7 if landscape else 4
    lit = {2, 8} if landscape else {1, 4}
    _tenement_windows(pd, img, W * 0.045, W * 0.955, H * B["rows"][0],
                      H * B["rows"][1], cols, 2, lit, lights, seed)
    chalk = _prop(pd, "chalk_marks")
    if chalk is not None:                   # the kids' own scrawl, kept small
        ck = _fit(_grade(chalk, 0.55), w=W * (0.155 if landscape else 0.30))
        img.alpha_composite(ck, (int(W * (0.615 if landscape else 0.58)),
                                 int(y_store - ck.height * 1.04)))

    # -- fire escape hanging off the wall
    fe = _prop(pd, "fire_escape")
    if fe is not None:
        f = _fit(_grade(fe, 0.55), h=(y_store - y_corn) * 0.98)
        img.alpha_composite(f, (int(W * B["fe"]), int(y_corn + H * 0.010)))

    # -- the shop
    _storefront(pd, img, 0, W, y_store, y_walk, lights)

    # -- sidewalk, curb, cobbled street
    walk = _tiled(_grade(_prop(pd, "sidewalk_tile"), 0.62), W,
                  y_curb - y_walk + 2, 0.75)
    img.alpha_composite(walk, (0, int(y_walk)))
    curb = _prop(pd, "curb")
    if curb is not None:
        cb = _fit(_grade(curb, 0.75), h=H * 0.020)
        img.alpha_composite(_tiled(cb, W, cb.height), (0, int(y_curb)))
    img.alpha_composite(_tiled(_prop(pd, "cobble_tile"), W, H - y_curb, 0.80),
                        (0, int(y_curb + H * 0.014)))

    # -- street furniture along the walk, and the lamp that lights all this
    def stand(name, fx, fh, grade=1.0, dy=0.0):
        p = _prop(pd, name)
        if p is None:
            return None
        sp_ = _fit(_grade(p, grade), h=H * fh)
        img.alpha_composite(sp_, (int(W * fx - sp_.width / 2),
                                  int(y_walk + H * (0.030 + dy) - sp_.height)))
        return sp_

    stand("stoop", 0.885 if landscape else 0.855, 0.105, 0.85)
    stand("crate", 0.245 if landscape else 0.300, 0.040, 1.0)
    stand("crate", 0.285 if landscape else 0.360, 0.036, 0.9)
    stand("trash", 0.635 if landscape else 0.630, 0.052, 0.9)
    stand("hydrant", 0.175 if landscape else 0.205, 0.050, 1.0)
    lamp = _prop(pd, "lamp")
    lx = W * (0.085 if landscape else 0.072)
    if lamp is not None:
        lm = _fit(lamp, h=H * B["lamp_h"])
        ly = y_walk + H * 0.032 - lm.height
        img.alpha_composite(lm, (int(lx - lm.width / 2), int(ly)))
        fy = ly + lm.height * 0.085
        lights.append((lx, fy, W * 0.30, H * 0.30, 1.15, 2.1, False))
        lights.append((lx, fy, W * 0.055, H * 0.030, 1.30, 1.4, False))
        lights.append((lx, y_walk + H * 0.052, W * 0.20, H * 0.055, 0.62, 1.7, False))
    # the spaldeen, sitting in the lamp pool where a kid left it
    ball = _spaldeen(max(8, int(H * 0.017)))
    img.alpha_composite(ball, (int(lx + W * 0.055), int(y_walk + H * 0.026)))
    return _gaslight(img, lights, seed=seed)


# ================================================================ printed bits
def _banner(w=1560, h=920, ss=2):
    """The logotype on a painted board, hung on two ropes from off-frame.

    The ropes belong to the sprite so the whole thing can bob in engine; they
    run off the top edge, where nothing can betray the cheat.
    """
    c = A.Canvas(w, h, ss)
    bx0, bx1 = w * 0.038, w * 0.962
    by0, by1 = h * 0.270, h * 0.985
    for sx in (0, 1):                                   # ropes first
        gx = bx0 + (bx1 - bx0) * (0.055 if sx == 0 else 0.945)
        tx = gx + (-1 if sx == 0 else 1) * w * 0.085
        pts = [(gx + (tx - gx) * (k / 9.0),
                (by0 + h * 0.030) * (1.0 - k / 9.0)) for k in range(10)]
        c.line(pts, (74, 62, 48), h * 0.0095)
        c.line([(px + h * 0.003, py - h * 0.003) for px, py in pts],
               (118, 102, 80), h * 0.0035)

    board_w, board_h = int(bx1 - bx0), int(by1 - by0)
    board = _aged_paper(board_w, board_h, 17)
    c.img.alpha_composite(
        board.resize((int(c._s(board_w)), int(c._s(board_h))), Image.LANCZOS),
        (int(c._s(bx0)), int(c._s(by0))))
    c.rect([bx0, by0, bx1, by1], outline=INK, width=h * 0.0115)
    c.rect([bx0 + h * 0.026, by0 + h * 0.026, bx1 - h * 0.026, by1 - h * 0.026],
           outline=shade(A.GOLD, 0.9), width=h * 0.0038)
    for fx in (0.055, 0.945):                            # grommets
        gx = bx0 + (bx1 - bx0) * fx
        c.circle(gx, by0 + h * 0.032, h * 0.017, fill=(64, 58, 50))
        c.circle(gx, by0 + h * 0.032, h * 0.008, fill=(24, 20, 18))
    scale = min(board_w / 1420.0, board_h / 640.0)
    _logotype(c, w / 2, (by0 + by1) / 2, scale=scale)
    img = A.finish(c, ink=0, light=False, grain_amt=4, seed=9)
    ball = _spaldeen(int(150 * scale))                   # the one saturated bit
    img.alpha_composite(ball, (int(w / 2 - 75 * scale),
                               int((by0 + by1) / 2 + 32 * scale - 75 * scale)))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))       # cast shadow: it hangs
    ImageDraw.Draw(sh).rectangle([bx0, by0, bx1, by1], fill=(12, 8, 8, 155))
    sh = sh.filter(ImageFilter.GaussianBlur(h * 0.018))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (int(h * 0.010), int(h * 0.022)))
    out.alpha_composite(img)
    return out


def _ticket(w=360, h=170, ss=SS, paper=True):
    """9-patch button plate (60px margins): a printed admission ticket."""
    c = A.Canvas(w, h, ss)
    m = 10
    c.rrect([m + 4, m + 8, w - m + 2, h - m + 2], 16, fill=(10, 8, 8, 130))
    if paper:
        stock = _aged_paper(w, h, 23)
        mask = A.Canvas(w, h, ss)
        mask.rrect([m, m, w - m, h - m], 16, fill=(255, 255, 255, 255))
        st = stock.resize((c._s(w), c._s(h)), Image.LANCZOS)
        st.putalpha(mask.img.getchannel("A"))
        c.img.alpha_composite(st)
    else:
        c.rrect([m, m, w - m, h - m], 16, fill=ENAMEL)
    c.rrect([m, m, w - m, h - m], 16, outline=INK, width=6)
    c.rrect([m + 12, m + 12, w - m - 12, h - m - 12], 9,
            outline=shade(INK, 1.9) if paper else A.GOLD, width=2.5)
    # ticket notches punched out of the left and right edges
    for sx in (m, w - m):
        c.circle(sx, h / 2, 13, fill=(0, 0, 0, 0))
    return A.finish(c, ink=0, light=False, grain_amt=4, seed=13)


def _plate(w=300, h=160, ss=SS, col=(30, 26, 26), edge=A.GOLD, alpha=225):
    """9-patch dark enamel plate (60px margins) for headers and info bars."""
    c = A.Canvas(w, h, ss)
    c.rrect([8, 10, w - 6, h - 4], 18, fill=(8, 6, 8, 120))
    c.rrect([6, 6, w - 8, h - 8], 18, fill=col + (alpha,))
    c.rrect([6, 6, w - 8, h - 8], 18, outline=(14, 12, 12, 255), width=6)
    c.rrect([16, 16, w - 18, h - 18], 12, outline=edge + (150,), width=2.5)
    return A.finish(c, ink=0, light=False, grain_amt=3, seed=27)


def _ribbon(w=360, h=96, ss=SS):
    """9-patch quirk band (24 x 12 margins), printed in NEUTRAL grey.

    The rack tints it in engine: dark leather for a kid still on the shelf,
    spaldeen pink for one you have taken. Drawing it grey is what lets one
    sprite carry both states without the pink leaking everywhere. The folded
    tails are kept narrow so the 9-patch still reads on a thumbnail card.
    """
    c = A.Canvas(w, h, ss)
    base = (206, 206, 206)
    t0, t1 = h * 0.075, h * 0.925
    for x0, x1 in ((0, 24), (w - 24, w)):                 # folded-back tails
        c.poly([(x0, t0 + h * 0.13), (x1, t0), (x1, t1), (x0, t1 - h * 0.13)],
               fill=shade(base, 0.50))
    c.rect([14, t0, w - 14, t1], fill=shade(base, 0.74))
    c.rect([14, t0, w - 14, t0 + (t1 - t0) * 0.66], fill=base)
    c.rect([14, t0, w - 14, t0 + (t1 - t0) * 0.26], fill=shade(base, 1.10))
    c.rect([14, t0 - h * 0.055, w - 14, t0 + h * 0.005], fill=(72, 72, 72))
    c.rect([14, t1 - h * 0.005, w - 14, t1 + h * 0.055], fill=(72, 72, 72))
    return A.finish(c, ink=0, light=False)


def _shelf(w=320, h=110, ss=SS):
    """9-patch wooden rail (60px margins) — the lip the cards stand on."""
    c = A.Canvas(w, h, ss)
    c.rect([0, 0, w, h * 0.16], fill=(12, 10, 10, 120))          # card shadow
    c.rect([0, h * 0.16, w, h * 0.30], fill=WOOD_L)              # front edge
    c.rect([0, h * 0.30, w, h * 0.74], fill=WOOD)
    c.rect([0, h * 0.74, w, h * 0.86], fill=WOOD_D)
    ov = c.overlay()
    rnd = random.Random(19)
    for _ in range(int(w / 6)):                                   # grain
        y = rnd.uniform(h * 0.32, h * 0.72)
        x = rnd.uniform(0, w)
        ln = rnd.uniform(w * 0.02, w * 0.14)
        ov.line([(x, y), (x + ln, y)], (36, 24, 16, 70), h * 0.014)
    c.merge(ov)
    c.rect([0, h * 0.86, w, h], fill=(10, 8, 8, 90))              # underside
    return A.finish(c, ink=0, light=False, grain_amt=4, seed=31)


def _stamp(size=260, ss=SS):
    """The rosette that lands on a card you have taken.

    No type: at rack size a word would be a smudge, so it is a cut-paper star
    on the spaldeen's pink — the one place that colour is allowed to spread.
    """
    c = A.Canvas(size, size, ss)
    r = size * 0.42
    pts = []
    for k in range(26):                       # scalloped rosette edge
        ang = math.tau * k / 26.0
        rr = r if k % 2 == 0 else r * 0.905
        pts.append((size / 2 + math.cos(ang) * rr, size / 2 + math.sin(ang) * rr))
    c.poly(pts, fill=INK)
    c.circle(size / 2, size / 2, r * 0.86, fill=PINK)
    c.circle(size / 2, size / 2, r * 0.86, outline=INK, width=size * 0.020)
    c.circle(size / 2, size / 2, r * 0.70, outline=shade(PINK, 1.35),
             width=size * 0.013)
    star = []
    for k in range(10):
        ang = -math.pi / 2 + k * math.pi / 5
        rr = r * (0.56 if k % 2 == 0 else 0.24)
        star.append((size / 2 + math.cos(ang) * rr, size / 2 + math.sin(ang) * rr))
    grown = [(size / 2 + (x - size / 2) * 1.16, size / 2 + (y - size / 2) * 1.16)
             for x, y in star]
    c.poly(grown, fill=INK)
    c.poly(star, fill=CHALK)
    return A.finish(c, ink=0, light=False)


def _scrim(size=512, ss=1):
    """A soft dark blob that sits under UI so type never fights the scene."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    if np is None:
        return img
    xs = np.arange(size, dtype=np.float32)[None, :]
    ys = np.arange(size, dtype=np.float32)[:, None]
    d = np.sqrt(((xs - size / 2) / (size / 2)) ** 2 +
                ((ys - size / 2) / (size / 2)) ** 2)
    a = np.clip(1.0 - d, 0.0, 1.0) ** 1.9
    arr = np.zeros((size, size, 4), np.uint8)
    arr[..., 0] = 14
    arr[..., 1] = 11
    arr[..., 2] = 12
    arr[..., 3] = np.uint8(a * 232)
    return Image.fromarray(arr, "RGBA")


def _header(w=1400, h=250, text="PICK YOUR SIX", ss=2):
    """The rack's hanging sign: enamel board, gold letters, two screws."""
    c = A.Canvas(w, h, ss)
    c.rrect([10, 14, w - 10, h - 6], 16, fill=(8, 6, 8, 130))
    c.rrect([8, 8, w - 8, h - 12], 16, fill=ENAMEL)
    c.rrect([8, 8, w - 8, h - 12], 16, outline=(16, 14, 12), width=8)
    c.rrect([24, 24, w - 24, h - 28], 10, outline=shade(A.GOLD, 0.85), width=3)
    A.text_spaced(c.d, (c._s(w / 2), c._s(h * 0.46)), text,
                  _f("serif_bold", h * 0.40, c.ss), A.GOLD + (255,),
                  c._s(h * 0.075))
    for fx in (0.035, 0.965):
        c.circle(w * fx, h * 0.46, h * 0.045, fill=shade(ENAMEL, 0.55))
        c.circle(w * fx, h * 0.46, h * 0.022, fill=(18, 16, 14))
    return A.finish(c, ink=0, light=False, grain_amt=4, seed=37)


# ---------------------------------------------------------------- driver
def build(outdir):
    os.makedirs(outdir, exist_ok=True)
    pd = _props_dir(outdir)
    n = 0

    # ---- the logotype on bare stock, for icons and the smoke build
    W, H = 1800, 620
    c = A.Canvas(W, H, SS)
    _logotype(c, W / 2, H / 2, scale=1.0)
    img = A.finish(c, ink=0, light=False, grain_amt=4, seed=3)
    ball = _spaldeen(150)
    img.alpha_composite(ball, (int(W / 2 - 75), int(H / 2 + 32 - 75)))
    img.save(f"{outdir}/ui_title.png")
    n += 1

    # ---- intertitle plate (9-patch: 60px margins all round) ----------
    # Every SOCK! / OUT! / THREE SEWERS! card is stamped on this stock. It has
    # to read on a night street, so the stock carries its own dark bleed.
    PL = 360
    c3 = A.Canvas(PL, PL, 2)
    c3.rrect([10, 14, PL - 10, PL - 6], 16, fill=(8, 6, 6, 150))
    stock = _aged_paper(PL, PL, 21).resize((PL * 2, PL * 2), Image.LANCZOS)
    mask = A.Canvas(PL, PL, 2)
    mask.rrect([8, 8, PL - 8, PL - 10], 14, fill=(255, 255, 255, 255))
    stock.putalpha(mask.img.getchannel("A"))
    c3.img.alpha_composite(stock)
    c3.rrect([8, 8, PL - 8, PL - 10], 14, outline=INK, width=9)
    c3.rrect([30, 30, PL - 30, PL - 32], 8, outline=shade(INK, 1.7), width=3)
    for sx, sy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):     # printer's corners
        px = PL / 2 + sx * (PL / 2 - 50)
        py = PL / 2 + sy * (PL / 2 - 50)
        c3.circle(px, py, 7, fill=INK)
        c3.circle(px, py, 3, fill=PAPER)
    c3.resolve().save(f"{outdir}/ui_card_plate.png")
    n += 1

    # ---- scoreboard slate (9-patch: 60px margins) --------------------
    BW = 360
    c4 = A.Canvas(BW, BW, 2)
    rnd = random.Random(33)
    board = shade((110, 74, 50), 0.62)
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

    # ---- front-end chrome --------------------------------------------
    _header(1400, 250, "PICK YOUR SIX").save(f"{outdir}/ui_rack_header.png")
    _banner().save(f"{outdir}/ui_banner.png")
    _ticket().save(f"{outdir}/ui_ticket.png")
    _ticket(paper=False).save(f"{outdir}/ui_ticket_dark.png")
    _plate().save(f"{outdir}/ui_plate.png")
    _ribbon().save(f"{outdir}/ui_ribbon.png")
    _shelf().save(f"{outdir}/ui_shelf.png")
    _stamp().save(f"{outdir}/ui_stamp.png")
    _scrim().save(f"{outdir}/ui_scrim.png")
    n += 9

    # ---- the two painted screens -------------------------------------
    _street(pd, 1440, 2880, False, 11).convert("RGB").save(
        f"{outdir}/ui_street_p.png", optimize=True)
    _street(pd, 2560, 1400, True, 12).convert("RGB").save(
        f"{outdir}/ui_street_l.png", optimize=True)
    n += 2
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

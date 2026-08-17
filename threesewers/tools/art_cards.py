#!/usr/bin/env python3
"""THREE SEWERS — trading cards + app icon.

Two deliverables, both drawn through the shared art kernel (``artkit``):

  * ``chr_<id>_card.png`` — a 1920s tobacco/candy-store baseball card for each
    of the twelve sandlot kids. World size 300x420, authored at 2x (600x840).
    Aged pasteboard, arched photograph panel, letterspaced serif caps, a
    quirk ribbon and a printed stat block. It should feel like a thing that
    was cut off a candy box in 1926, not like a UI panel.

  * ``icon.png`` / ``icon_180.png`` — the app icon. The pink spaldeen is the
    hero against brownstone and asphalt; it is the one place in the whole
    project where the pink is allowed to shout.

The card art is composed here, but the *face* is not: ``build`` takes a
``portrait_fn(kid_id, size) -> RGBA Image`` supplied by the caller so the
portraits stay owned by whoever draws the kids. A local placeholder portrait
is provided for standalone development only.
"""
import json
import math
import os
import random
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

try:
    import artkit as A
except ImportError:  # running from elsewhere in the tree
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import artkit as A


HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
DATA = os.path.join(PROJ, "data", "characters.json")

CARD_W, CARD_H = 600, 840          # 2x the 300x420 world size
SS = A.SS

# roster order fixes the printed card numbers
ORDER = ["mabel", "ezra", "patsy", "sadie", "nellie", "sal",
         "gus", "vito", "pearl", "tommy", "corny", "whistles"]

# ---------------------------------------------------------------- card stock
STOCK = (233, 216, 181)            # aged pasteboard — warm, not grey
STOCK_L = (245, 233, 205)
STOCK_D = (206, 186, 148)
RULE = (92, 66, 42)                # worn brown printing ink for the rules
INK2 = A.INK_SOFT
# The second printing plate. A real candy-store series ran one brown key
# plate and rotated a spot colour; the order is hand-set so that no two cards
# that end up side by side — or one above the other on a four-wide shelf —
# come out the same colour.
ACCENTS = [
    A.RUST, A.PATINA, A.CLOTH["chocolate"], A.SLATE,
    A.CLOTH["navy"], A.CLOTH["plum"], A.CLOTH["moss"], A.RUST,
    A.CLOTH["steel"], A.CLOTH["chocolate"], A.PATINA, A.CLOTH["plum"],
]
PLATE = (198, 182, 150)            # photographic plate ground (warm sepia grey)
PLATE_D = (122, 98, 70)            # the studio backdrop falling off into shade
SEPIA = (150, 116, 76)             # the tone the whole plate is printed in

# ---- portrait panel geometry (card pixels) --------------------------------
# The panel is an arched window; inside it the bust is vignetted into a
# portrait-shaped cameo, the way a 1920s studio photograph was printed.
PAN = (66, 74, 534, 438)           # x0, y0, x1, y1
PAN_RISE = 132
CAMEO_RX = 0.350                   # oval half-width as a fraction of panel W
CAMEO_RY = 0.560                   # oval half-height as a fraction of panel H
CAMEO_CY = 0.420                   # oval centre, fraction of panel H
CAMEO_FEATHER = 0.062              # dissolve width, fraction of panel H
EYE_Y_MIN = 0.475                  # the eye line may sit anywhere in this band
EYE_Y_MAX = 0.560
EYE_IO = 0.325                     # inter-ocular distance / cameo oval width


# ---------------------------------------------------------------- type
_ital_cache = {}
_ITALIC_FILES = [
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSerifItalic.ttf",
]
_ITALIC_BOLD_FILES = [
    "/usr/share/fonts/truetype/liberation/LiberationSerif-BoldItalic.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf",
]


def _italic(size, bold=False):
    """Serif italic — the kernel's font table has no italic face."""
    key = (size, bold)
    if key in _ital_cache:
        return _ital_cache[key]
    for p in (_ITALIC_BOLD_FILES if bold else _ITALIC_FILES):
        if os.path.exists(p):
            try:
                f = ImageFont.truetype(p, size)
                _ital_cache[key] = f
                return f
            except Exception:
                pass
    f = A.font("serif", size)
    _ital_cache[key] = f
    return f


def cfont(kind, size):
    """artkit font at a FINAL-pixel size, scaled for the supersampled canvas."""
    if kind == "italic":
        return _italic(int(round(size * SS)))
    if kind == "italic_bold":
        return _italic(int(round(size * SS)), bold=True)
    return A.font(kind, int(round(size * SS)))


def ctext(c, xy, s, kind, size, fill, anchor="mm"):
    c.text(xy, s, cfont(kind, size), fill, anchor)


def cspaced(c, xy, s, kind, size, fill, tracking, center=True):
    """Letterspaced type on a Canvas, in final-pixel coordinates."""
    A.text_spaced(c.d, (xy[0] * c.ss, xy[1] * c.ss), s, cfont(kind, size),
                  fill, tracking * c.ss, center)


def spaced_w(c, s, kind, size, tracking):
    f = cfont(kind, size)
    w = sum(c.d.textlength(ch, font=f) for ch in s)
    return (w + tracking * c.ss * max(0, len(s) - 1)) / c.ss


def fit_spaced(c, s, kind, size, tracking, max_w, min_size=18):
    """Shrink type (and tracking with it) until the line fits the measure."""
    while size > min_size:
        if spaced_w(c, s, kind, size, tracking) <= max_w:
            break
        size -= 1
        tracking = max(1.0, tracking * 0.96)
    return size, tracking


def text_w(c, s, kind, size):
    return c.d.textlength(s, font=cfont(kind, size)) / c.ss


# ---------------------------------------------------------------- shapes
def arch_path(draw, box, rise, ss, fill):
    """Filled Roman arch: elliptical top over a rectangle. Final-pixel box."""
    x0, y0, x1, y1 = [v * ss for v in box]
    r = rise * ss
    draw.pieslice([x0, y0, x1, y0 + 2 * r], 180, 360, fill=fill)
    draw.rectangle([x0, y0 + r, x1, y1], fill=fill)


def arch_outline(c, box, rise, color, width):
    x0, y0, x1, y1 = box
    c.arc([x0, y0, x1, y0 + 2 * rise], 180, 360, color, width)
    c.line([(x0, y0 + rise), (x0, y1)], color, width)
    c.line([(x1, y0 + rise), (x1, y1)], color, width)
    c.line([(x0, y1), (x1, y1)], color, width)


def scatter(c, box, n, colors, rnd, rmin=1.0, rmax=3.0):
    """artkit.speckle, but confined to a box instead of the whole canvas."""
    x0, y0, x1, y1 = box
    for _ in range(n):
        c.circle(rnd.uniform(x0, x1), rnd.uniform(y0, y1),
                 rnd.uniform(rmin, rmax), fill=rnd.choice(colors))


def pulp(w, h, base, rnd, ss, spread=0.035, n=420, rmin=4, rmax=22, blur=5):
    """Uneven pasteboard: soft cloudy pulp, built small and blown up.

    Drawing the blotches at half the FINAL size and blurring keeps them
    reading as fibre in the stock instead of as circles on top of it.
    """
    tw, th = max(1, w // 2), max(1, h // 2)
    t = Image.new("RGB", (tw, th), base)
    d = ImageDraw.Draw(t)
    for _ in range(n):
        col = A.shade(base, 1.0 + rnd.uniform(-spread, spread))
        x, y = rnd.uniform(0, tw), rnd.uniform(0, th)
        r = rnd.uniform(rmin, rmax)
        d.ellipse([x - r, y - r * rnd.uniform(0.55, 1.0),
                   x + r, y + r * rnd.uniform(0.55, 1.0)], fill=col)
    t = t.filter(ImageFilter.GaussianBlur(blur))
    return t.convert("RGBA").resize((w * ss, h * ss), Image.BICUBIC)


# ---------------------------------------------------------------- portrait
def _placeholder_portrait(kid_id, size):
    """Stand-in bust so the card can be composed before the real art lands.

    The real ``portrait_fn`` is supplied by the caller; this exists purely so
    ``art_cards.py`` is runnable on its own.
    """
    if isinstance(size, (tuple, list)):
        req = (int(size[0]), int(size[1]))
    else:
        req = (int(size), int(size))
    # Draw at a bounded size and scale up. The card asks for a bust roughly a
    # thousand pixels wide, and a supersampled canvas that big is minutes of
    # silhouette dilation for art that exists only until the real one lands.
    k = min(1.0, 384.0 / max(1, max(req)))
    w, h = max(1, int(req[0] * k)), max(1, int(req[1] * k))
    look = _PLACEHOLDER_LOOK.get(kid_id, _PLACEHOLDER_LOOK["mabel"])
    skin = A.SKIN[look[0]]
    hair = A.HAIR[look[1]]
    cloth = A.CLOTH[look[2]]
    hat, mouth = look[3], look[4]
    rnd = random.Random(sum(ord(ch) * (i + 3) for i, ch in enumerate(kid_id)))

    c = A.Canvas(w, h)
    u = h / 100.0
    cx = w * 0.5
    hr = (25.5 + rnd.uniform(0, 3.4)) * u
    hcy = 43 * u + rnd.uniform(-1.5, 1.5) * u
    lean = rnd.uniform(-2.2, 2.2) * u          # a bit of head sway
    sw = (48 + rnd.uniform(0, 9)) * u          # shoulder width

    # shoulders and collar
    c.form_rrect([cx - sw, 74 * u, cx + sw, 118 * u], 22 * u, cloth)
    c.form_capsule((cx, 62 * u), (cx + lean * 0.5, 78 * u), 17 * u, 19 * u,
                   A.shade(skin, 0.88))
    c.poly([(cx - 20 * u, 76 * u), (cx, 92 * u), (cx + 20 * u, 76 * u),
            (cx + 13 * u, 73 * u), (cx, 84 * u), (cx - 13 * u, 73 * u)],
           fill=A.shade(cloth, 1.16))

    # head
    cx += lean
    c.sphere(cx, hcy, hr, skin)
    c.circle(cx - hr * 0.97, hcy + 3 * u, 4.8 * u, fill=A.shade(skin, 0.95))
    c.circle(cx + hr * 0.97, hcy + 3 * u, 4.8 * u, fill=A.shade(skin, 0.88))

    # hair: skull cap that stops above the brow, plus a fringe
    c.chord([cx - hr * 1.03, hcy - hr * 1.06, cx + hr * 1.03, hcy + hr * 0.34],
            180, 360, fill=hair)
    for i in range(4):
        fx = cx - hr * 0.72 + i * hr * 0.48
        c.circle(fx, hcy - hr * 0.44, hr * 0.30, fill=hair)
    c.chord([cx - hr * 0.98, hcy - hr * 1.02, cx + hr * 0.2, hcy - hr * 0.1],
            180, 340, fill=A.shade(hair, 1.22))

    if hat == "cap":
        cap = A.CLOTH["charcoal"]
        c.chord([cx - hr * 1.10, hcy - hr * 1.30, cx + hr * 1.10, hcy + hr * 0.28],
                180, 360, fill=cap)
        c.chord([cx - hr * 1.06, hcy - hr * 1.26, cx + hr * 0.05, hcy - hr * 0.1],
                180, 340, fill=A.shade(cap, 1.20))
        c.ellipse([cx - hr * 1.68, hcy - hr * 0.44, cx + hr * 0.34, hcy - hr * 0.02],
                  fill=A.shade(cap, 0.76))
        c.circle(cx, hcy - hr * 1.16, hr * 0.11, fill=A.shade(cap, 1.3))
    elif hat == "cloche":
        # 1926's hat: a felt bell pulled down to the brow, grosgrain band,
        # short brim turned DOWN. Pale and domed reads as a chef's toque.
        bon = A.CLOTH["dust"]
        c.chord([cx - hr * 1.12, hcy - hr * 1.28, cx + hr * 1.12, hcy + hr * 0.66],
                180, 360, fill=bon)
        c.chord([cx - hr * 1.08, hcy - hr * 1.24, cx + hr * 0.02, hcy - hr * 0.10],
                180, 340, fill=A.shade(bon, 1.10))
        c.rrect([cx - hr * 1.13, hcy - hr * 0.52, cx + hr * 1.13, hcy - hr * 0.16],
                hr * 0.08, fill=A.shade(cloth, 0.84))
        c.chord([cx - hr * 1.30, hcy - hr * 0.50, cx + hr * 1.30, hcy + hr * 0.06],
                0, 180, fill=A.shade(bon, 0.76))
        c.circle(cx + hr * 0.92, hcy - hr * 0.34, hr * 0.13,
                 fill=A.shade(cloth, 1.10))
    elif hat == "kerchief":
        kc = A.CLOTH["dustblue"]
        c.chord([cx - hr * 1.06, hcy - hr * 1.16, cx + hr * 1.06, hcy + hr * 0.06],
                180, 360, fill=kc)
        c.rrect([cx - hr * 1.05, hcy - hr * 0.30, cx + hr * 1.05, hcy - hr * 0.02],
                hr * 0.08, fill=A.shade(kc, 0.86))
        # knotted off at the side, ends flying
        c.circle(cx + hr * 1.00, hcy - hr * 0.32, hr * 0.21, fill=kc)
        c.poly([(cx + hr * 0.98, hcy - hr * 0.48), (cx + hr * 1.56, hcy - hr * 0.70),
                (cx + hr * 1.44, hcy - hr * 0.14)], fill=A.shade(kc, 0.90))

    # face
    ey = hcy + 4 * u
    gap = (8.2 + rnd.uniform(0, 1.8)) * u
    er = (2.4 + rnd.uniform(0, 0.7)) * u
    brow = rnd.uniform(-2.5, 2.0) * u       # raised or knitted
    for sgn in (-1, 1):
        c.ellipse([cx + sgn * gap - 4.4 * u, ey - 4.6 * u,
                   cx + sgn * gap + 4.4 * u, ey + 4.6 * u], fill=A.CHALK)
        c.circle(cx + sgn * gap + 0.6 * u, ey + 0.4 * u, er, fill=A.INK)
        c.arc([cx + sgn * gap - 6 * u, ey - 13 * u + brow * (1 if sgn > 0 else -1),
               cx + sgn * gap + 6 * u, ey - 3 * u + brow * (1 if sgn > 0 else -1)],
              195, 345, A.INK, 1.9 * u)
    c.arc([cx - 2 * u, ey + 1 * u, cx + 6 * u, ey + 8 * u], 30, 150,
          A.shade(skin, 0.74), 1.7 * u)

    if mouth == "grin":                       # open, teeth showing
        c.chord([cx - 10 * u, ey + 4 * u, cx + 10 * u, ey + 18 * u],
                10, 170, fill=A.INK)
        c.chord([cx - 8 * u, ey + 4.5 * u, cx + 8 * u, ey + 10 * u],
                0, 180, fill=A.CHALK)
    elif mouth == "smirk":                    # one-sided, cocky
        c.arc([cx - 4 * u, ey + 5 * u, cx + 11 * u, ey + 15 * u],
              15, 130, A.INK, 2.0 * u)
    elif mouth == "whistle":                  # pursed
        c.ellipse([cx - 3.4 * u, ey + 7 * u, cx + 3.4 * u, ey + 14 * u],
                  fill=A.INK)
    elif mouth == "flat":                     # unimpressed
        c.line([(cx - 7 * u, ey + 11 * u), (cx + 7 * u, ey + 10 * u)],
               A.INK, 2.0 * u)
    else:                                     # plain smile
        c.arc([cx - 8 * u, ey + 5 * u, cx + 8 * u, ey + 17 * u], 20, 160,
              A.INK, 2.0 * u)

    for sgn in (-1, 1):
        c.ellipse([cx + sgn * 16 * u - 4 * u, ey + 6 * u,
                   cx + sgn * 16 * u + 4 * u, ey + 10 * u],
                  fill=A.mix(skin, A.CLOTH["rose"], 0.24))
    if look[5]:                               # freckles
        for _ in range(9):
            fx = cx + rnd.uniform(-17, 17) * u
            fy = ey + rnd.uniform(2, 9) * u
            if abs(fx - cx) < 6 * u:
                continue
            c.circle(fx, fy, 0.9 * u, fill=A.shade(skin, 0.70))
    # a low cel strength: at bust scale the kernel's wedge is a hard diagonal
    # across the whole image, so the form shading carries the volume instead
    img = A.finish(c, ink=3, light=True, light_strength=0.22, rim=True,
                   grain_amt=0)
    if (img.width, img.height) != req:
        img = img.resize(req, Image.LANCZOS)
    return img


# skin, hair, cloth, hat, mouth, freckles
_PLACEHOLDER_LOOK = {
    "mabel":    ("fair", "chestnut", "rose", "cloche", "smile", False),
    "ezra":     ("light", "brown", "dustblue", "cap", "grin", True),
    "patsy":    ("fair", "ginger", "olive", "cap", "smile", True),
    "sadie":    ("olive", "black", "ochre", None, "grin", False),
    "nellie":   ("fair", "auburn", "moss", None, "smirk", True),
    "sal":      ("olive", "black", "steel", "cap", "flat", False),
    "gus":      ("tan", "black", "clay", "cap", "grin", False),
    "vito":     ("olive", "black", "rust", None, "flat", False),
    "pearl":    ("light", "black", "sage", "kerchief", "smile", False),
    "tommy":    ("light", "black", "navy", "cap", "smirk", False),
    "corny":    ("fair", "blond", "white", None, "flat", False),
    "whistles": ("fair", "sandy", "grey", "cap", "whistle", True),
}


def _call_portrait(portrait_fn, kid_id, side):
    """Ask the caller for a portrait; tolerate int-or-tuple size conventions."""
    if portrait_fn is None:
        portrait_fn = _placeholder_portrait
    img = None
    for arg in (side, (side, side)):
        try:
            img = portrait_fn(kid_id, arg)
            if img is not None:
                break
        except Exception:
            img = None
    if img is None:
        img = _placeholder_portrait(kid_id, side)
    return img.convert("RGBA")


# ---------------------------------------------------------------- framing
# Twelve kids drawn by another hand arrive at twelve different head sizes and
# head heights, because their body types differ. A card series cannot have
# that: the whole point of a series is that the frame is a constant and only
# the face inside it changes. So the bust is registered on the one landmark
# every portrait shares — the pair of white eyes.
def _blobs(mask, w, h):
    """Connected components of a 1-bit mask (small images only, no numpy)."""
    px = mask.load()
    seen = bytearray(w * h)
    out = []
    for y in range(h):
        for x in range(w):
            if not px[x, y] or seen[y * w + x]:
                continue
            stack = [(x, y)]
            seen[y * w + x] = 1
            sx = sy = n = 0
            x0 = x1 = x
            y0 = y1 = y
            while stack:
                cx, cy = stack.pop()
                sx += cx
                sy += cy
                n += 1
                if cx < x0: x0 = cx
                if cx > x1: x1 = cx
                if cy < y0: y0 = cy
                if cy > y1: y1 = cy
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny] \
                            and not seen[ny * w + nx]:
                        seen[ny * w + nx] = 1
                        stack.append((nx, ny))
            out.append((n, sx / n, sy / n, x1 - x0 + 1, y1 - y0 + 1))
    return out


def _eye_anchor(img):
    """(cx, cy, inter-ocular) in source pixels, found from the white sclera.

    Falls back to a sane guess if a portrait has no visible eye whites, so an
    unexpected portrait style degrades to "roughly centred" instead of blowing
    up the build.
    """
    n = 150
    small = img.resize((n, n), Image.LANCZOS).convert("RGBA")
    p = small.load()
    m = Image.new("1", (n, n), 0)
    mp = m.load()
    for y in range(n):
        for x in range(n):
            r, g, b, a = p[x, y]
            # eye whites are CHALK: bright, warm-neutral, never a colour cast
            if a > 200 and r > 228 and g > 222 and b > 194 and abs(r - b) < 52:
                mp[x, y] = 1
    cand = [c for c in _blobs(m, n, n)
            if 6 <= c[0] <= 520 and 0.16 * n < c[2] < 0.66 * n
            and c[3] <= c[4] * 2.3]          # eyes are round; teeth are wide
    best = None
    for i in range(len(cand)):
        for j in range(i + 1, len(cand)):
            a_, b_ = cand[i], cand[j]
            dy = abs(a_[2] - b_[2])
            dx = abs(a_[1] - b_[1])
            if dy > 0.045 * n or not (0.07 * n < dx < 0.36 * n):
                continue
            score = a_[0] + b_[0] - dy * 22   # level, and the biggest pair
            if best is None or score > best[0]:
                best = (score, a_, b_)
    s = img.width / float(n)
    if best is None:
        return img.width * 0.5, img.height * 0.46, img.width * 0.20
    _, a_, b_ = best
    return ((a_[1] + b_[1]) * 0.5 * s, (a_[2] + b_[2]) * 0.5 * s,
            abs(a_[1] - b_[1]) * s)


def _bust(portrait_fn, kid_id, pw, ph, ss):
    """The registered, vignetted bust, as a panel-sized RGBA layer.

    Returns the layer at ``(pw*ss, ph*ss)``. The bust is scaled so the eye
    line and inter-ocular width are the same on every card — but only mostly:
    the measured size is pulled toward the series mean with an exponent, so
    Vito still reads as a bigger kid than Pearl.
    """
    W, H = int(pw * ss), int(ph * ss)
    # Ask for roughly the size the bust will actually occupy. Asking for more
    # buys nothing — a portrait_fn that renders small and upscales gives back
    # the same detail either way — and costs a lot if the callee draws at the
    # size it is handed.
    src = _call_portrait(portrait_fn, kid_id, min(1100, max(512, int(W * 0.62))))
    ex, ey, io = _eye_anchor(src)
    io = max(io, src.width * 0.04)
    ovw = 2.0 * CAMEO_RX * W
    scale = (ovw * EYE_IO * ((io / src.width) / 0.208) ** 0.45) / io
    bust = src.resize((max(1, int(src.width * scale)),
                       max(1, int(src.height * scale))), Image.LANCZOS)
    if scale > 1.6:
        # The bust arrives well under the size the card shows it at, so its
        # ink line lands as a soft grey band next to type that is razor sharp.
        # Put the edge back without touching the flat cel fills.
        bust = bust.filter(ImageFilter.UnsharpMask(radius=int(2 * ss),
                                                   percent=70, threshold=4))

    # Hang the bust from the crown, not the eye line. Caps and cloches are
    # tall and they are what hits the arch first; a kid whose hat is already
    # clipped in the source must not then be pushed further up. The eye line
    # is still held inside a band so nobody's chin lands on the card's name.
    bb = bust.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    top = bb[1] if bb else 0
    oy = H * 0.045 - top
    eyc = (ey * scale + oy) / float(H)
    if eyc < EYE_Y_MIN:
        oy += (EYE_Y_MIN - eyc) * H
    elif eyc > EYE_Y_MAX:
        oy += (EYE_Y_MAX - eyc) * H

    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    lay.alpha_composite(bust, (int(W * 0.5 - ex * scale), int(oy)))
    # a whisper of sepia — enough to read as one printing, not enough to make
    # twelve kids the same colour
    tint = Image.new("RGBA", (W, H), SEPIA + (0,))
    tint.putalpha(lay.getchannel("A").point(lambda v: int(v * 0.07)))
    lay.alpha_composite(tint)

    # the cameo: the bust dissolves into the backdrop below the collar, which
    # is both how a 1920s vignette was printed and how a standing pose's arms
    # stop looking like arms cropped off at the elbow
    cam = Image.new("L", (W, H), 0)
    ImageDraw.Draw(cam).ellipse(
        [W * (0.5 - CAMEO_RX), H * (CAMEO_CY - CAMEO_RY),
         W * (0.5 + CAMEO_RX), H * (CAMEO_CY + CAMEO_RY)], fill=255)
    cam = cam.filter(ImageFilter.GaussianBlur(H * CAMEO_FEATHER))
    lay.putalpha(ImageChops.multiply(lay.getchannel("A"), cam))
    return lay


# ---------------------------------------------------------------- the card
def _stat_cell(c, cx, top, label, value, rnd):
    """One column of the stat block: small-caps label, numeral, chalk pips."""
    cspaced(c, (cx, top + 14), label, "serif_bold", 18, A.CHALK, 2.6)
    ctext(c, (cx, top + 58), str(value), "serif_bold", 44, A.INK)
    # pips: two rows of five, filled to the stat value
    pitch = 13.5
    r = 4.0
    for i in range(10):
        row, col = divmod(i, 5)
        px = cx + (col - 2) * pitch
        py = top + 88 + row * 15
        if i < value:
            c.circle(px, py, r, fill=A.INK)
            c.circle(px - r * 0.28, py - r * 0.30, r * 0.42,
                     fill=A.shade(A.INK, 1.35))
        else:
            c.circle(px, py, r * 0.86, fill=A.shade(STOCK, 0.88))
            c.circle(px - r * 0.12, py - r * 0.12, r * 0.55, fill=STOCK_L)


RIB_TAIL = 46


def _ribbon_band(c, box, band):
    """The quirk ribbon's colour — spot plate only, no type."""
    x0, y0, x1, y1 = box
    mid = (y0 + y1) * 0.5
    band_d = A.shade(band, 0.70)
    for sx, ex in ((x0, x0 + RIB_TAIL + 6), (x1, x1 - RIB_TAIL - 6)):
        d = 1 if ex > sx else -1
        c.poly([(sx, y0 + 7), (ex, y0 - 3), (ex, y1 + 3), (sx, y1 - 7),
                (sx + d * 17, mid)], fill=band_d)
    bx0, bx1 = x0 + RIB_TAIL, x1 - RIB_TAIL
    c.poly([(bx0, y0 - 3), (bx1, y0 - 3), (bx1, y1 + 3), (bx0, y1 + 3)], fill=band)
    # top light band so the ribbon has a form, not a flat fill
    c.poly([(bx0, y0 - 3), (bx1, y0 - 3), (bx1, y0 + 9), (bx0, y0 + 9)],
           fill=A.shade(band, 1.14))


def _ribbon_text(c, box, text):
    """The quirk name — key plate."""
    x0, y0, x1, y1 = box
    bx0, bx1 = x0 + RIB_TAIL, x1 - RIB_TAIL
    size, tr = fit_spaced(c, text.upper(), "serif_bold", 27, 4.0, bx1 - bx0 - 34)
    cspaced(c, ((bx0 + bx1) / 2, (y0 + y1) * 0.5 + 2), text.upper(),
            "serif_bold", size, A.shade(A.CHALK, 0.99), tr)


def draw_card(kid_id, info, number, portrait_fn):
    rnd = random.Random(sum(ord(ch) * (i + 7) for i, ch in enumerate(kid_id)))
    W, H = CARD_W, CARD_H
    c = A.Canvas(W, H)
    # The spot-colour plate is drawn on its own canvas and laid down a hair
    # out of register, the way a two-pass candy-store press actually ran. It
    # is the cheapest honest signal that this is a printed thing: the ribbon's
    # colour sits a half-pixel off its own lettering.
    spot = c.overlay()
    accent = ACCENTS[(number - 1) % len(ACCENTS)]
    # every sheet came off the press a slightly different shade of buff
    stock_c = A.mix(A.shade(STOCK, rnd.uniform(0.975, 1.02)),
                    (214, 190, 152), rnd.uniform(0.0, 0.18))

    # ---- pasteboard stock -------------------------------------------
    # 14px at 2x is ~7px at world size: a guillotined corner that has been
    # thumbed for ninety years, not a UI panel's radius.
    pad, rad = 5, 14
    clip = Image.new("L", c.img.size, 0)
    ImageDraw.Draw(clip).rounded_rectangle(
        [pad * SS, pad * SS, (W - pad) * SS, (H - pad) * SS],
        radius=rad * SS, fill=255)
    stock = pulp(W, H, stock_c, rnd, SS)
    stock.putalpha(clip)
    c.img.alpha_composite(stock)
    A.speckle(c, 130, W, H, rnd,
              [A.shade(stock_c, 0.90), A.shade(stock_c, 1.05)], 0.8, 2.2)
    c.img.putalpha(ImageChops.multiply(c.img.getchannel("A"), clip))

    # ---- printed rules ----------------------------------------------
    c.rrect([20, 20, W - 20, H - 20], 8, outline=RULE, width=3.5)
    c.rrect([29, 29, W - 29, H - 29], 5, outline=A.mix(RULE, stock_c, 0.50),
            width=1.5)

    # ---- series mark -------------------------------------------------
    sy = 52
    cspaced(c, (W / 2, sy), "SANDLOT STARS", "serif_bold", 22, RULE, 6.5)
    smw = spaced_w(c, "SANDLOT STARS", "serif_bold", 22, 6.5)
    flo = A.mix(accent, A.INK, 0.18)
    for sgn in (-1, 1):
        x = W / 2 + sgn * (smw / 2 + 16)
        spot.line([(x, sy), (x + sgn * 34, sy)], flo, 2)
        lx = x + sgn * 43
        spot.poly([(lx - sgn * 8, sy), (lx, sy - 5), (lx + sgn * 8, sy),
                   (lx, sy + 5)], fill=flo)

    # ---- portrait plate ----------------------------------------------
    px0, py0, px1, py1 = PAN
    rise = PAN_RISE
    pw, ph = (px1 - px0), (py1 - py0)
    # ink frame: the arch, grown
    arch_path(c.d, (px0 - 6, py0 - 6, px1 + 6, py1 + 6), rise + 6, SS, A.INK)

    # The backdrop is printed in the card's own spot colour. This is what the
    # second plate was FOR: one pass of brown key ink and one of colour, so
    # the photograph's ground, the ribbon and the stat header all come off the
    # same stone. It is also the only colour event in the top half of the card.
    ground = A.mix(PLATE_D, accent, 0.62)
    plate = A.Canvas(W, H)
    plate.img.alpha_composite(pulp(pw, ph, ground, rnd, SS, spread=0.03,
                                   n=200, blur=7),
                              (px0 * SS, py0 * SS))
    # studio backdrop: a pool of light behind the head, falling off to the
    # shaded corners of the backdrop cloth
    pcx, pcy = (px0 + px1) / 2, py0 + ph * 0.46
    lit = A.mix(PLATE, A.CHALK, 0.58)
    for i in range(34):
        t = i / 33.0
        r = pw * 0.46 * (1.0 - t * 0.90)
        plate.ellipse([pcx - r, pcy - r * 0.92, pcx + r, pcy + r * 0.92],
                      fill=A.mix(ground, lit, t ** 0.62))
    pimg = plate.img.filter(ImageFilter.GaussianBlur(pw * SS * 0.055))
    pimg.alpha_composite(_bust(portrait_fn, kid_id, pw, ph, SS),
                         (px0 * SS, py0 * SS))

    mask = Image.new("L", c.img.size, 0)
    arch_path(ImageDraw.Draw(mask), (px0, py0, px1, py1), rise, SS, 255)
    pimg.putalpha(ImageChops.multiply(pimg.getchannel("A"), mask))
    # vignette the plate like an old photograph — corners only
    vig = Image.new("L", c.img.size, 0)
    ImageDraw.Draw(vig).ellipse(
        [(px0 - 18) * SS, (py0 - 30) * SS, (px1 + 18) * SS, (py1 + 30) * SS],
        fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(pw * SS * 0.10))
    vg = Image.new("RGBA", c.img.size, (52, 38, 24, 0))
    vg.putalpha(ImageChops.multiply(
        vig.point(lambda v: int((255 - v) * 0.20)), pimg.getchannel("A")))
    pimg.alpha_composite(vg)
    c.img.alpha_composite(pimg)

    # inner hairline inside the arch
    arch_outline(c, (px0 + 9, py0 + 9, px1 - 9, py1 - 9), rise - 9,
                 A.mix(A.CHALK, PLATE, 0.40), 1.6)

    # ---- name ---------------------------------------------------------
    parts = info["name"].split()
    given, surname = parts[0], " ".join(parts[1:]) if len(parts) > 1 else ""
    cspaced(c, (W / 2, 470), given.upper(), "serif_bold", 23, RULE, 5.5)
    if surname:
        size, tr = fit_spaced(c, surname.upper(), "serif_bold", 50, 4.0, 466, 26)
        cspaced(c, (W / 2, 508), surname.upper(), "serif_bold", size, A.INK, tr)
    c.line([(W / 2 - 116, 534), (W / 2 + 116, 534)],
           A.mix(RULE, stock_c, 0.42), 1.6)
    for sgn in (-1, 1):
        spot.circle(W / 2 + sgn * 126, 534, 2.6, fill=A.mix(accent, A.INK, 0.18))

    # ---- archetype ----------------------------------------------------
    arch_txt = info["arch"]
    asz = 24
    while text_w(c, arch_txt, "italic", asz) > 462 and asz > 15:
        asz -= 1
    ctext(c, (W / 2, 558), arch_txt, "italic", asz, A.shade(RULE, 1.10))

    # ---- quirk ribbon --------------------------------------------------
    rib = (42, 584, W - 42, 630)
    _ribbon_band(spot, rib, accent)
    qd = info["qdesc"]
    qsz = 20
    while text_w(c, qd, "italic", qsz) > 456 and qsz > 13:
        qsz -= 1
    ctext(c, (W / 2, 655), qd, "italic", qsz, A.shade(INK2, 1.06))

    # ---- stat block ----------------------------------------------------
    sx0, sy0, sx1, sy1 = 50, 672, W - 50, 792
    c.rect([sx0, sy0, sx1, sy1], fill=A.shade(stock_c, 0.965))
    spot.rect([sx0, sy0, sx1, sy0 + 26], fill=accent)

    # ---- the colour pass goes down here, a hair out of register ---------
    ox, oy = rnd.choice(((2, -1), (-2, 1), (1, 2), (-1, -2), (2, 1), (-2, -1)))
    c.img.alpha_composite(ImageChops.offset(spot.img, ox * SS, oy * SS))
    _ribbon_text(c, rib, info["qname"])

    c.rect([sx0, sy0, sx1, sy1], outline=RULE, width=2)
    c.line([(sx0, sy0 + 26), (sx1, sy0 + 26)], RULE, 1.6)
    cw = (sx1 - sx0) / 5.0
    for i in range(1, 5):
        x = sx0 + cw * i
        c.line([(x, sy0), (x, sy1)], A.mix(RULE, stock_c, 0.50), 1.3)
    for i, k in enumerate(("PWR", "CON", "SPD", "ARM", "GLV")):
        _stat_cell(c, sx0 + cw * (i + 0.5), sy0, k, int(info[k]), rnd)

    # ---- footer --------------------------------------------------------
    cspaced(c, (W / 2, 806), "SERIES OF 1926", "serif", 16,
            A.mix(RULE, stock_c, 0.18), 4.5)

    # ---- card number, printed on a spaldeen roundel ---------------------
    nx, ny, nr = W - 72, 54, 26
    c.sphere(nx, ny, nr, A.PINK, A.shade(A.PINK, 0.74), 0.24)
    c.circle(nx - nr * 0.34, ny - nr * 0.38, nr * 0.26,
             fill=A.mix(A.PINK_L, A.CHALK, 0.5))
    c.circle(nx, ny, nr, outline=A.INK, width=3)
    ctext(c, (nx, ny + 1), str(number), "serif_bold", 26, A.INK)

    # A flat sheet of pasteboard has no rounded form for the cel wedge to
    # describe — the hard step just reads as a scan artifact — so the card
    # takes the kernel's ink and grain, and a smooth wash from the same sun.
    img = A.finish(c, ink=3, light=False, grain_amt=6, seed=number * 17 + 3)
    img = _sunwash(img)
    img = _wear(img, rnd, rad)
    return img


def _sunwash(img):
    """Smooth upper-left-to-lower-right wash. Same sun as the kernel's cel
    light, but continuous, because pasteboard has no edge to catch a wedge."""
    w, h = img.size
    a = img.getchannel("A")
    ramp = Image.linear_gradient("L").resize((w, h))
    ramp = Image.blend(ramp, ramp.rotate(-90, expand=False), 0.5)
    dk = Image.new("RGBA", (w, h), (52, 38, 26, 0))
    dk.putalpha(ImageChops.multiply(
        ramp.point(lambda v: int(max(0, v - 104) * 0.24)), a))
    img.alpha_composite(dk)
    lt = Image.new("RGBA", (w, h), A.SUN + (0,))
    lt.putalpha(ImageChops.multiply(
        ramp.point(lambda v: int(max(0, 118 - v) * 0.20)), a))
    img.alpha_composite(lt)
    return img


def _wear(img, rnd, rad):
    """Honest, restrained aging: edge darkening, two faint stains, a scuff."""
    w, h = img.size
    a = img.getchannel("A")

    # darkened, thumbed edges
    edge = Image.new("L", (w, h), 0)
    ImageDraw.Draw(edge).rounded_rectangle([3, 3, w - 4, h - 4], radius=rad,
                                           outline=255, width=26)
    edge = edge.filter(ImageFilter.GaussianBlur(15))
    dark = Image.new("RGBA", (w, h), (74, 54, 36, 0))
    dark.putalpha(ImageChops.multiply(edge.point(lambda v: int(v * 0.28)), a))
    img.alpha_composite(dark)

    # a stain or two, kept faint
    stain = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(stain)
    for _ in range(2):
        cx = rnd.uniform(60, w - 60)
        cy = rnd.uniform(70, h - 70)
        r = rnd.uniform(46, 84)
        sd.ellipse([cx - r, cy - r * rnd.uniform(0.6, 1.0),
                    cx + r, cy + r * rnd.uniform(0.6, 1.0)], fill=255)
    stain = stain.filter(ImageFilter.GaussianBlur(16))
    st = Image.new("RGBA", (w, h), (132, 96, 52, 0))
    st.putalpha(ImageChops.multiply(stain.point(lambda v: int(v * 0.15)), a))
    img.alpha_composite(st)

    # two soft scuffs where the pulp has worn light: one corner, one crease
    scuff = Image.new("L", (w, h), 0)
    sk = ImageDraw.Draw(scuff)
    sk.ellipse([w - 96, h - 74, w + 34, h + 44], fill=255)
    cy = rnd.uniform(h * 0.30, h * 0.72)
    sk.line([(-10, cy), (w + 10, cy + rnd.uniform(-26, 26))], fill=120, width=7)
    scuff = scuff.filter(ImageFilter.GaussianBlur(13))
    sc = Image.new("RGBA", (w, h), (246, 236, 212, 0))
    sc.putalpha(ImageChops.multiply(scuff.point(lambda v: int(v * 0.26)), a))
    img.alpha_composite(sc)
    return img


# ---------------------------------------------------------------- app icon
def draw_icon(size=1024, ss=2):
    """Pink spaldeen against brownstone and asphalt. Must read at 40px.

    Authored at ss=2: the icon's ink lines are very thick and the kernel's
    silhouette dilation is quadratic in line width, so 4x supersampling here
    buys nothing but minutes.

    Composition is deliberately down to four masses — brick, street, chalk
    box, ball — with a broomstick diagonal for energy. Anything finer than
    that is gone by the time the icon is 40 pixels wide.
    """
    S = size
    rnd = random.Random(1926)
    u = S / 1024.0

    # ---- ground: brownstone wall over asphalt street -------------------
    bg = A.Canvas(S, S, ss)
    horizon = 700 * u
    bg.rect([0, 0, S, horizon], fill=A.BRICK)
    # chunky courses — few, big, high-contrast mortar
    ch = 132 * u
    mortar = A.mix(A.BRICK, A.PAPER, 0.34)
    rows = int(horizon / ch) + 2
    for r in range(rows):
        y = r * ch
        off = (r % 2) * 168 * u
        bg.rect([0, y, S, y + 16 * u], fill=mortar)
        bg.rect([0, y + 16 * u, S, y + 24 * u], fill=A.BRICK_D)
        for i in range(-1, 5):
            x = off + i * 336 * u
            bg.rect([x - 9 * u, y, x + 9 * u, y + ch], fill=mortar)
            bg.rect([x + 4 * u, y, x + 9 * u, y + ch], fill=A.BRICK_D)
    scatter(bg, (0, 0, S, horizon), 150,
            [A.BRICK_D, A.shade(A.BRICK, 1.10)], rnd, 2 * u, 5 * u)

    # street
    bg.rect([0, horizon, S, S], fill=A.shade(A.ASPHALT, 0.86))
    bg.rect([0, horizon - 14 * u, S, horizon + 14 * u], fill=A.IRON)
    bg.rect([0, horizon + 14 * u, S, horizon + 30 * u], fill=A.ASPHALT_L)
    scatter(bg, (0, horizon + 30 * u, S, S), 200,
            [A.ASPHALT_D, A.shade(A.ASPHALT, 1.12)], rnd, 2 * u, 5 * u)
    # the sewer lid, the thing the whole game is named after — a full circle
    # sitting in the street, not an arc leaving the frame
    scx, scy, scr = 388 * u, 930 * u, 220 * u
    bg.ellipse([scx - scr, scy - scr * 0.46, scx + scr, scy + scr * 0.46],
               fill=A.INK)
    # the lid face has to sit LIGHTER than the street or it is a puddle
    bg.ellipse([scx - scr * 0.90, scy - scr * 0.40,
                scx + scr * 0.90, scy + scr * 0.40],
               fill=A.mix(A.ASPHALT_L, A.IRON, 0.34))
    bg.ellipse([scx - scr * 0.90, scy - scr * 0.40,
                scx + scr * 0.86, scy + scr * 0.36],
               fill=A.mix(A.ASPHALT_L, A.IRON, 0.16))
    bg.ellipse([scx - scr * 0.60, scy - scr * 0.26,
                scx + scr * 0.60, scy + scr * 0.26], outline=A.PATINA,
               width=13 * u)
    # A flat wall and a flat street have no rounded form for the kernel's cel
    # wedge to describe: it just lays a hard diagonal seam across the brick.
    # Same sun, continuous ramp.
    bg_img = A.finish(bg, ink=0, light=False, grain_amt=8, seed=5)
    bg_img = _sunwash(bg_img)

    # ---- chalk strike box on the wall ----------------------------------
    ck = A.Canvas(S, S, ss)
    bx0, by0, bx1, by1 = 190 * u, 162 * u, 660 * u, 636 * u
    crn = [(bx0, by0), (bx1, by0), (bx1, by1), (bx0, by1)]
    for i in range(4):
        ax, ay = crn[i]
        bxx, byy = crn[(i + 1) % 4]
        pts = []
        for t in range(7):
            f = t / 6.0
            pts.append((ax + (bxx - ax) * f + rnd.uniform(-4.5, 4.5) * u,
                        ay + (byy - ay) * f + rnd.uniform(-4.5, 4.5) * u))
        ck.line(pts, A.CHALK, 20 * u)
    ck_img = A.finish(ck, ink=0, light=False, grain_amt=0)
    ck_img.putalpha(ck_img.getchannel("A").point(lambda v: int(v * 0.78)))
    ck_img = ck_img.filter(ImageFilter.GaussianBlur(1.6 * u))
    bg_img.alpha_composite(ck_img)

    # ---- broomstick bat, behind the ball -------------------------------
    # Fat enough to survive the trip to 40px: at that size the stick is two
    # pixels of light on a dark ground, and two pixels is the whole diagonal.
    bat = A.Canvas(S, S, ss)
    a = math.radians(-36)
    p0 = (-90 * u, 1060 * u)
    p1 = (p0[0] + math.cos(a) * 1720 * u, p0[1] + math.sin(a) * 1720 * u)
    bat.form_capsule(p0, p1, 76 * u, 62 * u, A.CLOTH["oat"],
                     A.shade(A.CLOTH["oat"], 0.70))
    # friction tape on the grip
    for i in range(4):
        t = 0.06 + i * 0.050
        q0 = (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)
        q1 = (p0[0] + (p1[0] - p0[0]) * (t + 0.038),
              p0[1] + (p1[1] - p0[1]) * (t + 0.030))
        bat.capsule(q0, q1, 77 * u, 76 * u, A.IRON)
    bat_img = A.finish(bat, ink=10 * u, light=True, light_strength=0.9, rim=True)
    bat_img = A.drop_shadow(bat_img, 10 * u, 14 * u, 8 * u, 0.40)
    bg_img.alpha_composite(bat_img)

    # ---- the spaldeen — the one loud thing in the whole project ---------
    ball = A.Canvas(S, S, ss)
    bcx, bcy, br = 520 * u, 452 * u, 268 * u
    ink_w = 15 * u
    ball.sphere(bcx, bcy, br, A.PINK, A.shade(A.PINK, 0.80), 0.26)
    # keep the lit side high-chroma rather than letting the cel pass grey it
    ball.circle(bcx - br * 0.30, bcy - br * 0.34, br * 0.52,
                fill=A.mix(A.PINK, A.PINK_L, 0.42))
    # one specular, chalk-white, where the sun is. Two nested highlights read
    # as a cherry on a cocktail once the icon is thumbnail-sized.
    ball.ellipse([bcx - br * 0.60, bcy - br * 0.66,
                  bcx - br * 0.26, bcy - br * 0.32], fill=A.CHALK)
    ball_img = A.finish(ball, ink=ink_w, light=True, light_strength=0.35,
                        rim=True, grain_amt=5, seed=9)
    # The kernel builds its ink by dilating the silhouette with a SQUARE
    # kernel. On a line this thick the square shows: the ring bulges on the
    # diagonals and scallops along the top. The ball is a known circle, so
    # clip the finished sprite back to one — the ink stays the kernel's, it
    # just stops being lumpy.
    rr = br + ink_w
    disc = Image.new("L", (S * ss, S * ss), 0)
    ImageDraw.Draw(disc).ellipse([(bcx - rr) * ss, (bcy - rr) * ss,
                                  (bcx + rr) * ss, (bcy + rr) * ss], fill=255)
    disc = disc.resize((S, S), Image.LANCZOS)
    ball_img.putalpha(ImageChops.multiply(ball_img.getchannel("A"), disc))
    ball_img = A.drop_shadow(ball_img, 18 * u, 24 * u, 13 * u, 0.44)
    bg_img.alpha_composite(ball_img)

    # ---- vignette so the corners sit back ------------------------------
    vig = Image.new("L", (S, S), 0)
    ImageDraw.Draw(vig).ellipse([-S * 0.26, -S * 0.26, S * 1.26, S * 1.26],
                                fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(S * 0.09))
    vg = Image.new("RGBA", (S, S), (28, 20, 14, 0))
    vg.putalpha(vig.point(lambda v: int((255 - v) * 0.34)))
    bg_img.alpha_composite(vg)
    return bg_img


# ---------------------------------------------------------------- build
def build(outdir, portrait_fn=None):
    """Render every trading card into ``outdir`` plus the app icon.

    ``outdir``      assets/characters — receives ``chr_<id>_card.png``.
    ``portrait_fn`` ``fn(kid_id, size) -> RGBA Image``, supplied by the caller.
    """
    with open(DATA) as f:
        kids = json.load(f)
    os.makedirs(outdir, exist_ok=True)
    made = []

    ids = [k for k in ORDER if k in kids] + [k for k in kids if k not in ORDER]
    for n, kid in enumerate(ids, 1):
        img = draw_card(kid, kids[kid], n, portrait_fn)
        p = os.path.join(outdir, "chr_%s_card.png" % kid)
        A.save(img, p)
        made.append(p)

    icon_dir = os.path.join(os.path.dirname(os.path.abspath(outdir)), "icon")
    icon = draw_icon(1024)
    p = os.path.join(icon_dir, "icon.png")
    A.save(icon, p)
    made.append(p)
    p180 = os.path.join(icon_dir, "icon_180.png")
    A.save(icon.resize((180, 180), Image.LANCZOS), p180)
    made.append(p180)
    return made


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        PROJ, "assets", "characters")
    for p in build(out):
        print(p)

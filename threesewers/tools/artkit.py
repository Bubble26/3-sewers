#!/usr/bin/env python3
"""THREE SEWERS — shared art kernel.

Every sprite in the game is drawn through this module so the whole screen
speaks one visual language: chunky Backyard-Baseball silhouettes rendered in
a 1926 New York palette.

House rules (do not break these per-asset):
  1. SUPERSAMPLE. Draw at 4x, downsample LANCZOS. PIL's hard polygon edges
     are what made the placeholder art look like programmer art.
  2. INK EVERYTHING. Every sprite carries a confident outer ink line, made by
     dilating its own silhouette — not by stroking each shape.
  3. CEL SHADE, ONE SUN. Light comes from the upper left, always. Two steps:
     a hard shadow wedge and a warm rim. No gradients, no soft airbrush.
  4. ONE SATURATED COLOR. The spaldeen's pink is the only high-chroma thing
     in the game. Everything else is desaturated period cloth and stone.
  5. BIG HEADS, SMALL HANDS. Head is ~1/3 of body height; limbs are stubby
     tapered capsules. Silhouette reads at 40px tall on a phone.
"""
import math
import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

SS = 4  # supersample factor

# ---------------------------------------------------------------- palette
# Muted 1926 stock. Values chosen to read against ASPHALT without going chalky.
INK = (38, 28, 22)
INK_SOFT = (58, 44, 34)
PAPER = (239, 227, 200)
CHALK = (255, 247, 228)
ASPHALT = (85, 80, 74)
ASPHALT_D = (66, 62, 57)
ASPHALT_L = (104, 98, 90)
BRICK = (110, 74, 50)
BRICK_D = (86, 56, 38)
BRICK_L = (132, 92, 64)
BROWNSTONE = (122, 92, 66)
PATINA = (94, 130, 114)
GOLD = (217, 164, 65)
RUST = (150, 84, 54)
SLATE = (92, 100, 112)
IRON = (54, 50, 48)
PINK = (228, 98, 111)  # spaldeen — the only saturated color on screen
PINK_L = (245, 168, 176)

SUN = (255, 236, 196)  # warm rim light
SHADOW_MUL = 0.66  # cel shadow darkening factor

# period cloth — all low chroma so the ball stays the loudest thing on screen
CLOTH = {
    "cream": (222, 206, 174),
    "oat": (206, 186, 150),
    "dust": (188, 170, 148),
    "olive": (128, 132, 96),
    "moss": (104, 122, 96),
    "sage": (140, 156, 130),
    "dustblue": (122, 144, 162),
    "steel": (98, 116, 136),
    "navy": (70, 84, 106),
    "plum": (128, 100, 116),
    "rose": (188, 140, 138),
    "ochre": (198, 156, 88),
    "mustard": (176, 148, 74),
    "rust": (162, 98, 68),
    "clay": (172, 118, 92),
    "chocolate": (108, 78, 58),
    "grey": (140, 136, 128),
    "charcoal": (86, 84, 80),
    "white": (232, 226, 210),
}

SKIN = {
    "fair": (232, 190, 158),
    "light": (222, 176, 142),
    "olive": (206, 160, 122),
    "tan": (188, 140, 104),
    "brown": (150, 106, 74),
    "deep": (116, 80, 56),
}

HAIR = {
    "black": (46, 38, 36),
    "brown": (86, 60, 42),
    "chestnut": (110, 74, 46),
    "auburn": (140, 82, 50),
    "ginger": (176, 106, 58),
    "blond": (198, 166, 106),
    "sandy": (172, 142, 96),
}


def shade(c, f):
    """Scale a color toward black (f<1) or white (f>1), clamped."""
    if f <= 1.0:
        return tuple(max(0, min(255, int(v * f))) for v in c)
    t = min(1.0, f - 1.0)
    return tuple(max(0, min(255, int(v + (255 - v) * t))) for v in c)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


# ---------------------------------------------------------------- fonts
_FONT_DIRS = [
    "/usr/share/fonts/truetype/dejavu",
    "/usr/share/fonts/truetype/liberation",
    "/usr/share/fonts/truetype/freefont",
]
_FONT_FILES = {
    "serif_bold": ["DejaVuSerif-Bold.ttf", "LiberationSerif-Bold.ttf", "FreeSerifBold.ttf"],
    "serif": ["DejaVuSerif.ttf", "LiberationSerif-Regular.ttf", "FreeSerif.ttf"],
    "sans_bold": ["DejaVuSans-Bold.ttf", "LiberationSans-Bold.ttf", "FreeSansBold.ttf"],
    "cond_bold": ["DejaVuSansCondensed-Bold.ttf", "LiberationSansNarrow-Bold.ttf",
                  "DejaVuSans-Bold.ttf"],
}
_font_cache = {}


def font(kind, size):
    key = (kind, size)
    if key in _font_cache:
        return _font_cache[key]
    for name in _FONT_FILES.get(kind, []):
        for d in _FONT_DIRS:
            p = os.path.join(d, name)
            if os.path.exists(p):
                try:
                    f = ImageFont.truetype(p, size)
                    _font_cache[key] = f
                    return f
                except Exception:
                    pass
    f = ImageFont.load_default()
    _font_cache[key] = f
    return f


def text_c(d, xy, s, f, fill, anchor="mm"):
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


def text_spaced(d, xy, s, f, fill, tracking, anchor_center=True):
    """Letterspaced text — the period look for cards and signage."""
    widths = [d.textlength(ch, font=f) for ch in s]
    total = sum(widths) + tracking * max(0, len(s) - 1)
    x = xy[0] - total / 2 if anchor_center else xy[0]
    for ch, w in zip(s, widths):
        d.text((x, xy[1]), ch, font=f, fill=fill, anchor="lm")
        x += w + tracking


# ---------------------------------------------------------------- canvas
class Canvas:
    """A supersampled RGBA drawing surface.

    All coordinates you pass are in FINAL pixels; the canvas scales them up
    internally, so callers never think about SS.
    """

    def __init__(self, w, h, ss=SS):
        self.w = w
        self.h = h
        self.ss = ss
        self.img = Image.new("RGBA", (w * ss, h * ss), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    # -- primitives (final-pixel coordinates) --------------------------
    def _s(self, v):
        return v * self.ss

    def _box(self, xy):
        return [self._s(v) for v in xy]

    def ellipse(self, box, fill=None, outline=None, width=0):
        self.d.ellipse(self._box(box), fill=fill, outline=outline,
                       width=int(width * self.ss))

    def circle(self, cx, cy, r, fill=None, outline=None, width=0):
        self.ellipse([cx - r, cy - r, cx + r, cy + r], fill, outline, width)

    def rect(self, box, fill=None, outline=None, width=0):
        self.d.rectangle(self._box(box), fill=fill, outline=outline,
                         width=int(width * self.ss))

    def rrect(self, box, r, fill=None, outline=None, width=0):
        self.d.rounded_rectangle(self._box(box), radius=self._s(r), fill=fill,
                                 outline=outline, width=int(width * self.ss))

    def poly(self, pts, fill=None, outline=None, width=0):
        self.d.polygon([(self._s(x), self._s(y)) for x, y in pts], fill=fill,
                       outline=outline, width=int(width * self.ss))

    def line(self, pts, fill, width, joint="curve"):
        self.d.line([(self._s(x), self._s(y)) for x, y in pts], fill=fill,
                    width=max(1, int(width * self.ss)), joint=joint)

    def arc(self, box, a0, a1, fill, width):
        self.d.arc(self._box(box), a0, a1, fill=fill, width=max(1, int(width * self.ss)))

    def pieslice(self, box, a0, a1, fill=None, outline=None, width=0):
        self.d.pieslice(self._box(box), a0, a1, fill=fill, outline=outline,
                        width=int(width * self.ss))

    def chord(self, box, a0, a1, fill=None, outline=None, width=0):
        self.d.chord(self._box(box), a0, a1, fill=fill, outline=outline,
                     width=int(width * self.ss))

    def text(self, xy, s, f, fill, anchor="mm"):
        self.d.text((self._s(xy[0]), self._s(xy[1])), s, font=f, fill=fill, anchor=anchor)

    # -- limbs ---------------------------------------------------------
    def capsule(self, p0, p1, w0, w1=None, fill=None):
        """Tapered capsule — the workhorse for arms and legs."""
        if w1 is None:
            w1 = w0
        x0, y0 = p0
        x1, y1 = p1
        dx, dy = x1 - x0, y1 - y0
        ln = math.hypot(dx, dy)
        if ln < 0.001:
            self.circle(x0, y0, w0 / 2, fill=fill)
            return
        nx, ny = -dy / ln, dx / ln
        a = (x0 + nx * w0 / 2, y0 + ny * w0 / 2)
        b = (x0 - nx * w0 / 2, y0 - ny * w0 / 2)
        c = (x1 - nx * w1 / 2, y1 - ny * w1 / 2)
        e = (x1 + nx * w1 / 2, y1 + ny * w1 / 2)
        self.poly([a, b, c, e], fill=fill)
        self.circle(x0, y0, w0 / 2, fill=fill)
        self.circle(x1, y1, w1 / 2, fill=fill)

    def limb(self, root, ang_deg, length, w0, w1, fill):
        """Draw a limb from root at an angle; returns the far endpoint.

        Angles are screen-space degrees: 0 = right, 90 = DOWN (so gravity is
        positive), matching how the pose tables are authored.
        """
        a = math.radians(ang_deg)
        tip = (root[0] + math.cos(a) * length, root[1] + math.sin(a) * length)
        self.capsule(root, tip, w0, w1, fill)
        return tip

    # -- form shading --------------------------------------------------
    # The sun is upper-left, so every rounded form keeps its shadow on the
    # lower-right. These draw the shadow INSIDE the form, which reads as
    # volume; the global cel_light pass alone just slices shapes in half.
    def sphere(self, cx, cy, r, base, shadow=None, offset=0.22):
        """Two-tone sphere: shadow crescent away from the sun."""
        if shadow is None:
            shadow = shade(base, 0.78)
        self.circle(cx, cy, r, fill=shadow)
        self.circle(cx - r * offset, cy - r * offset, r * (1.0 - offset * 0.62),
                    fill=base)

    def form_rrect(self, box, rad, base, shadow=None, inset=0.3):
        """Two-tone rounded slab: shadow band on the lower-right."""
        if shadow is None:
            shadow = shade(base, 0.78)
        x0, y0, x1, y1 = box
        self.rrect(box, rad, fill=shadow)
        w = x1 - x0
        h = y1 - y0
        self.rrect([x0, y0, x1 - w * inset * 0.34, y1 - h * inset * 0.30],
                   rad, fill=base)

    def form_capsule(self, p0, p1, w0, w1, base, shadow=None):
        """Two-tone limb: a darker underside along the capsule."""
        if shadow is None:
            shadow = shade(base, 0.80)
        self.capsule(p0, p1, w0, w1, shadow)
        d = (p1[0] - p0[0], p1[1] - p0[1])
        ln = math.hypot(*d) or 1.0
        nx, ny = -d[1] / ln, d[0] / ln
        k = 0.20
        self.capsule((p0[0] - nx * w0 * k, p0[1] - ny * w0 * k),
                     (p1[0] - nx * w1 * k, p1[1] - ny * w1 * k),
                     w0 * 0.74, w1 * 0.74, base)

    # -- translucent marks ---------------------------------------------
    def overlay(self):
        """A transparent twin to draw translucent marks on.

        PIL's ImageDraw REPLACES pixels instead of blending, so a fill with
        alpha punches a hole straight through the art. Draw such marks on an
        overlay and merge() it instead.
        """
        return Canvas(self.w, self.h, self.ss)

    def merge(self, other):
        self.img.alpha_composite(other.img)

    # -- output --------------------------------------------------------
    def resolve(self):
        return self.img.resize((self.w, self.h), Image.LANCZOS)


# ---------------------------------------------------------------- ink + light
def ink_outline(img, width=3, color=INK, ss=SS):
    """Confident cartoon outline from the silhouette itself.

    Dilates the alpha channel and paints it under the art, so overlapping
    parts share one clean outer line instead of a tangle of strokes.
    """
    a = img.getchannel("A")
    solid = a.point(lambda v: 255 if v > 110 else 0)
    r = max(1, int(width * ss))
    grown = solid.filter(ImageFilter.MaxFilter(_odd(r * 2 + 1)))
    grown = grown.filter(ImageFilter.GaussianBlur(ss * 0.35))
    grown = grown.point(lambda v: 255 if v > 96 else 0)
    out = Image.new("RGBA", img.size, color + (0,))
    out.putalpha(grown)
    out.alpha_composite(img)
    return out


def _odd(n):
    n = int(n)
    return n if n % 2 == 1 else n + 1


def cel_light(img, strength=1.0, ss=SS, rim=True):
    """Two-step cel shading with a fixed upper-left sun.

    A hard diagonal wedge of shadow on the lower right, and a warm rim on the
    upper left edge. Same sun for every asset in the game.
    """
    w, h = img.size
    a = img.getchannel("A")
    # diagonal ramp: 0 at upper-left, 255 at lower-right
    ramp = Image.linear_gradient("L").resize((w, h))
    ramp = Image.blend(ramp, ramp.rotate(-90, expand=False), 0.5)
    ramp = ramp.filter(ImageFilter.GaussianBlur(ss * 1.2))

    shadow_mask = ramp.point(lambda v: 255 if v > 150 else 0)
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(ss * 0.8))
    shadow_mask = ImageChops.multiply(shadow_mask, a)
    shadow_mask = shadow_mask.point(lambda v: int(v * 0.5 * strength))

    dark = Image.new("RGBA", img.size, (0, 0, 0, 0))
    base = img.convert("RGBA")
    px = base.copy()
    # build the darkened version of the art, then reveal it through the mask
    dk = Image.new("RGB", img.size, (0, 0, 0))
    darkened = Image.blend(px.convert("RGB"), dk, 1.0 - SHADOW_MUL)
    dark = Image.merge("RGBA", (*darkened.split(), shadow_mask))
    out = base.copy()
    out.alpha_composite(dark)

    if rim:
        solid = a.point(lambda v: 255 if v > 110 else 0)
        eroded = solid.filter(ImageFilter.MinFilter(_odd(ss * 2 + 1)))
        edge = ImageChops.subtract(solid, eroded)
        lit = ramp.point(lambda v: 255 if v < 88 else 0)
        rim_mask = ImageChops.multiply(edge, lit)
        rim_mask = rim_mask.filter(ImageFilter.GaussianBlur(ss * 0.4))
        rim_mask = rim_mask.point(lambda v: int(v * 0.55))
        rimimg = Image.new("RGBA", img.size, SUN + (0,))
        rimimg.putalpha(rim_mask)
        out.alpha_composite(rimimg)
    return out


def drop_shadow(img, dx, dy, blur, alpha, ss=SS):
    """Contact shadow behind an asset (props that sit on the street)."""
    a = img.getchannel("A")
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    m = a.filter(ImageFilter.GaussianBlur(blur * ss)).point(lambda v: int(v * alpha))
    sh.putalpha(m)
    sh = ImageChops.offset(sh, int(dx * ss), int(dy * ss))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(sh)
    out.alpha_composite(img)
    return out


# ---------------------------------------------------------------- surface texture
def grain(img, amount=10, seed=1):
    """Fine tooth so flat fills don't look like vector clip art."""
    rnd = random.Random(seed)
    w, h = img.size
    noise = Image.new("L", (w, h))
    noise.putdata([rnd.randint(128 - amount, 128 + amount) for _ in range(w * h)])
    noise = noise.filter(ImageFilter.GaussianBlur(0.4))
    rgb = img.convert("RGBA")
    r, g, b, a = rgb.split()
    ov = noise.point(lambda v: v - 128)
    r = ImageChops.add(r, ov, scale=1, offset=0)
    g = ImageChops.add(g, ov, scale=1, offset=0)
    b = ImageChops.add(b, ov, scale=1, offset=0)
    return Image.merge("RGBA", (r, g, b, a))


def speckle(c, n, w, h, rnd, colors, rmin=1, rmax=3):
    """Scatter flecks — grit on asphalt, mortar chips on brick."""
    for _ in range(n):
        x = rnd.uniform(0, w)
        y = rnd.uniform(0, h)
        r = rnd.uniform(rmin, rmax)
        c.circle(x, y, r, fill=rnd.choice(colors))


def finish(canvas, ink=3, light=True, light_strength=1.0, rim=True,
           grain_amt=0, seed=1):
    """Standard finishing chain: resolve -> ink -> cel light -> grain."""
    img = canvas.img
    if ink:
        img = ink_outline(img, ink, INK, canvas.ss)
    if light:
        img = cel_light(img, light_strength, canvas.ss, rim)
    img = img.resize((canvas.w, canvas.h), Image.LANCZOS)
    if grain_amt:
        img = grain(img, grain_amt, seed)
    return img


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)

#!/usr/bin/env python3
"""THREE SEWERS — the kids.

Backyard-Baseball construction (big head, stubby tapered limbs, silhouette
that reads at 40px) wearing 1926 New York: newsboy caps, suspenders,
knickerbockers, knee socks, pinafores, aprons.

Everything is posed from a small skeleton so the animation actually reads as
motion instead of a sprite jiggling in place. Angles are screen-space degrees:
0 = right, 90 = DOWN.
"""
import math

from PIL import Image, ImageDraw

import artkit as A
from artkit import CLOTH, HAIR, INK, SKIN, shade

SS = 3  # characters carry a lot of frames; 3x is plenty at this size

W, H = 384, 376          # authored size (2x the 192x160 world size);
                         # extra width is headroom for the swung bat, extra
                         # height for a cap that leaves the head on a jump
GROUND = 362.0           # every kid's ankles land here so the gang shares a
                         # floor; the sole sits on the canvas bottom edge,
                         # which is the anchor match_view derives from height

ANIMS = {"idle": 6, "bat_stance": 2, "swing": 6, "run": 8, "pitch": 8,
         "throw": 4, "catch": 3, "slide": 4, "celebrate": 4, "sulk": 2,
         "walk": 4}

# The camera stands behind the batter, so the kid at the plate is drawn from
# the back: no face, the hair mass filling the skull, the cap seen from
# behind. Only the batter ever needs these.
BACK_ANIMS = {"bat_back": 2, "swing_back": 6}

# Frames are only as wide as the pose needs — the kid always stands at canvas
# centre, so Godot's centred sprite keeps the feet in the same world spot no
# matter which width an animation uses.
ANIM_W = {"swing": 384, "bat_stance": 320, "slide": 352, "pitch": 304,
          "swing_back": 384, "bat_back": 320,
          "throw": 304, "catch": 304, "celebrate": 304,
          "idle": 256, "run": 256, "walk": 256, "sulk": 256}

# ---------------------------------------------------------------- roster look
# body: S small / M medium / L large. hat: newsboy|flat|bonnet|cap|scarf|none
# extras drive the little storytelling details that sell each archetype.
KIDS = {
    "mabel": dict(body="M", skin="fair", hair="chestnut", hat="bonnet",
                  shirt="rose", pants="cream", sock="cream", shoe="chocolate",
                  dress=True, pinafore=True, longhair=True, idle="prim", phase=0),
    "ezra": dict(body="S", skin="light", hair="brown", hat="newsboy",
                 shirt="dustblue", pants="charcoal", sock="oat", shoe="chocolate",
                 apron=True, apron_col="oat", satchel=True, idle="fidget", phase=2),
    "patsy": dict(body="S", skin="olive", hair="black", hat="flat",
                  shirt="clay", pants="chocolate", sock="dust", shoe="charcoal",
                  suspenders=True, rolled=True, smudge=True, idle="bounce", phase=1),
    "sadie": dict(body="S", skin="light", hair="auburn", hat="scarf",
                  shirt="sage", pants="clay", sock="cream", shoe="chocolate",
                  apron=True, apron_col="white", dress=True, idle="sway", phase=3),
    "nellie": dict(body="M", skin="fair", hair="ginger", hat="none",
                   shirt="mustard", pants="steel", sock="oat", shoe="rust",
                   overalls=True, freckles=True, bandage=True, messy=True, idle="bounce",
                   phase=4),
    "sal": dict(body="M", skin="olive", hair="black", hat="newsboy",
                shirt="moss", pants="charcoal", sock="oat", shoe="chocolate",
                suspenders=True, backwards=True, idle="scan", phase=2),
    "gus": dict(body="L", skin="tan", hair="brown", hat="flat",
                shirt="rust", pants="olive", sock="dust", shoe="chocolate",
                apron=True, apron_col="oat", stocky=True, idle="planted", phase=0),
    "vito": dict(body="L", skin="olive", hair="black", hat="none",
                 shirt="white", pants="rust", sock="oat", shoe="charcoal",
                 suspenders=True, sleeveless=True, stocky=True, messy=True, idle="planted",
                 phase=3),
    "pearl": dict(body="S", skin="light", hair="black", hat="none",
                  shirt="patina", pants="cream", sock="cream", shoe="chocolate",
                  braids=True, pinafore=True, dress=True, idle="prim", phase=4),
    "tommy": dict(body="M", skin="light", hair="black", hat="cap",
                  shirt="steel", pants="navy", sock="oat", shoe="chocolate",
                  lefty=True, idle="fidget", phase=5),
    "corny": dict(body="M", skin="fair", hair="blond", hat="newsboy",
                  shirt="cream", pants="mustard", sock="white", shoe="chocolate",
                  vest=True, vest_col="ochre", bowtie=True, knickers=True, idle="prim",
                  phase=1),
    "whistles": dict(body="S", skin="brown", hair="black", hat="newsboy",
                     shirt="grey", pants="charcoal", sock="oat", shoe="chocolate",
                     bighat=True, whistle=True, suspenders=True, idle="scan", phase=5),
}

BODY = {
    #        head_r  torso_w torso_h shoulder_y  limb
    "S": dict(hr=50, tw=74, th=80, sy=150, lw=19, scale=0.94),
    "M": dict(hr=54, tw=84, th=86, sy=146, lw=21, scale=1.0),
    "L": dict(hr=57, tw=96, th=90, sy=144, lw=24, scale=1.05),
}


def cloth(key):
    if key in CLOTH:
        return CLOTH[key]
    return getattr(A, key.upper(), CLOTH["dust"])


# ---------------------------------------------------------------- ink helpers
# Parts carry their own thin line; the whole-silhouette pass in finish() then
# lays a heavier contour on top. That weight hierarchy is what makes it read
# as drawn rather than assembled.
def icapsule(c, p0, p1, w0, w1, fill, ink=4.0, shadow=True):
    c.capsule(p0, p1, w0 + ink, w1 + ink, INK)
    if shadow:
        c.form_capsule(p0, p1, w0, w1, fill)
    else:
        c.capsule(p0, p1, w0, w1, fill)


def icircle(c, cx, cy, r, fill, ink=4.0, sphere=True):
    c.circle(cx, cy, r + ink, fill=INK)
    if sphere:
        c.sphere(cx, cy, r, fill)
    else:
        c.circle(cx, cy, r, fill=fill)


def irrect(c, box, rad, fill, ink=4.0, form=True):
    x0, y0, x1, y1 = box
    c.rrect([x0 - ink, y0 - ink, x1 + ink, y1 + ink], rad + ink, fill=INK)
    if form:
        c.form_rrect(box, rad, fill)
    else:
        c.rrect(box, rad, fill=fill)


def ipoly(c, pts, fill, ink=4.0):
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    grown = []
    for x, y in pts:
        dx, dy = x - cx, y - cy
        d = math.hypot(dx, dy) or 1.0
        grown.append((x + dx / d * ink, y + dy / d * ink))
    c.poly(grown, fill=INK)
    c.poly(pts, fill=fill)


def rot(p, ang, ln):
    a = math.radians(ang)
    return (p[0] + math.cos(a) * ln, p[1] + math.sin(a) * ln)


def ik2(root, target, up, lo, sign=1):
    """Two-link IK -> the (parent, bend) pair the skeleton wants.

    Posing an arm by naming where the HAND goes is how you get an
    unselfconscious pose; naming two joint angles is how you get a mannequin.
    ``sign`` picks which way the elbow breaks.
    """
    dx, dy = target[0] - root[0], target[1] - root[1]
    d = math.hypot(dx, dy)
    d = max(min(d, (up + lo) * 0.999), abs(up - lo) + 0.001)
    base = math.degrees(math.atan2(dy, dx))
    a = math.degrees(math.acos(max(-1.0, min(1.0,
        (d * d + up * up - lo * lo) / (2 * d * up)))))
    e = math.degrees(math.acos(max(-1.0, min(1.0,
        (up * up + lo * lo - d * d) / (2 * up * lo)))))
    return base - sign * a, sign * (180.0 - e)


# ---------------------------------------------------------------- the face
def draw_face(c, cx, cy, r, cfg, emo, look=0.0, look_y=0.0, ky=1.0):
    """Eyes, brows, mouth. This is where the kid gets a personality.

    ``look`` swings the gaze left/right, ``look_y`` up/down (the whole mask
    slides on the skull, which is how a cartoon sells a glance without
    redrawing the head). ``ky`` squashes the mask with the skull so a landing
    impact can flatten the face without the mouth sliding off the chin.
    """
    skin = SKIN[cfg["skin"]]
    ink = INK

    def Y(k):
        return cy + (k * r + look_y * r * 0.10) * ky

    ex = r * 0.40
    ey = Y(0.10)
    er = r * 0.235                      # eye radius — big, Backyard-style
    lx = cx - ex + look * r * 0.17
    rx = cx + ex + look * r * 0.17

    squint = 0.0
    wide = 1.0
    if emo in ("effort", "grit"):
        squint = 0.42
    elif emo == "focus":
        squint = 0.22
    elif emo == "wide":
        wide = 1.22
    elif emo == "grin":
        squint = 0.30
    elif emo == "frown":
        squint = 0.16
    elif emo == "sly":
        squint = 0.50
    elif emo == "yell":
        squint = 0.34

    if emo == "blink":
        for x in (lx, rx):
            c.capsule((x - er * 0.86, ey - er * 0.10 * ky),
                      (x + er * 0.86, ey - er * 0.10 * ky), r * 0.075, r * 0.075, ink)
            c.arc([x - er * 0.86, ey - er * 0.46 * ky, x + er * 0.86,
                   ey + er * 0.34 * ky], 20, 160, ink, 3)
    for side, x in ((-1, lx), (1, rx)):
        if emo == "blink":
            break
        h = er * wide * (1.0 - squint) * ky
        # sclera
        c.ellipse([x - er * 0.92, ey - h, x + er * 0.92, ey + h], fill=(250, 246, 236))
        c.d.ellipse([c._s(x - er * 0.92), c._s(ey - h), c._s(x + er * 0.92), c._s(ey + h)],
                    outline=ink, width=int(3.0 * c.ss))
        # iris + pupil, drifting with the look direction
        px = x + look * er * 0.42
        py = ey + (er * 0.10 + look_y * er * 0.34) * ky
        pr = er * 0.52
        c.circle(px, py, pr, fill=shade(HAIR[cfg["hair"]], 0.7))
        c.circle(px, py, pr * 0.60, fill=(28, 22, 20))
        c.circle(px - pr * 0.34, py - pr * 0.34, pr * 0.30, fill=(255, 252, 245))

    # brows — the single strongest emotion signal
    bw = er * 1.5
    by = ey - er * (1.5 * wide) * ky
    tilt = {"calm": 0.0, "focus": 0.30, "effort": 0.52, "grit": 0.58,
            "grin": -0.26, "frown": -0.46, "wide": -0.16, "sly": 0.34, "blink": -0.10,
            "yell": 0.40}.get(emo, 0.0)
    lift = {"wide": -er * 0.30, "frown": er * 0.10, "yell": -er * 0.18}.get(emo, 0.0)
    for side, x in ((-1, lx), (1, rx)):
        y0 = by + lift + tilt * er * 0.62 * side * -1
        y1 = by + lift - tilt * er * 0.62 * side * -1
        c.capsule((x - bw * 0.5, y0), (x + bw * 0.5, y1), r * 0.10, r * 0.10,
                  shade(HAIR[cfg["hair"]], 0.85))

    # nose
    ny = Y(0.40)
    c.circle(cx + look * r * 0.15, ny, r * 0.075, fill=shade(skin, 0.84))

    # mouth
    my = Y(0.60)
    cx = cx + look * r * 0.11      # the mouth rides round with the turn
    mw = r * 0.36
    if emo == "grin":
        c.chord([cx - mw, my - mw * 0.75 * ky, cx + mw, my + mw * 0.95 * ky], 0, 180,
                fill=(96, 52, 48), outline=ink, width=3)
        c.chord([cx - mw * 0.82, my - mw * 0.30 * ky, cx + mw * 0.82, my + mw * 0.30 * ky],
                180, 360, fill=(250, 246, 236))
    elif emo == "effort":
        c.ellipse([cx - mw * 0.62, my - mw * 0.42 * ky, cx + mw * 0.62, my + mw * 0.62 * ky],
                  fill=(96, 52, 48), outline=ink, width=3)
    elif emo == "yell":
        # wide open holler — the follow-through / celebration mouth
        c.ellipse([cx - mw * 0.74, my - mw * 0.62 * ky, cx + mw * 0.74, my + mw * 1.02 * ky],
                  fill=(96, 52, 48), outline=ink, width=3)
        c.chord([cx - mw * 0.62, my - mw * 0.62 * ky, cx + mw * 0.62, my - mw * 0.06 * ky],
                180, 360, fill=(250, 246, 236))
    elif emo == "wide":
        c.ellipse([cx - mw * 0.40, my - mw * 0.30 * ky, cx + mw * 0.40, my + mw * 0.55 * ky],
                  fill=(96, 52, 48), outline=ink, width=3)
    elif emo == "frown":
        c.arc([cx - mw, my + mw * 0.10 * ky, cx + mw, my + mw * 1.30 * ky], 200, 340, ink, 4)
    elif emo == "sly":
        # one-sided smirk: the corner lifts on the side the kid is looking
        sx = 1.0 if look >= 0 else -1.0
        c.capsule((cx - mw * 0.70, my + mw * 0.16 * ky),
                  (cx + mw * 0.70, my - mw * 0.16 * ky * sx), r * 0.075, r * 0.075, ink)
    elif emo == "grit":
        c.rrect([cx - mw * 0.62, my - mw * 0.10 * ky, cx + mw * 0.62, my + mw * 0.34 * ky],
                mw * 0.14, fill=INK)
        c.rrect([cx - mw * 0.54, my - mw * 0.04 * ky, cx + mw * 0.54, my + mw * 0.24 * ky],
                mw * 0.10, fill=(250, 246, 236))
        for gx in (-0.28, 0.0, 0.28):
            c.line([(cx + mw * gx, my - mw * 0.04 * ky),
                    (cx + mw * gx, my + mw * 0.24 * ky)], ink, 2.0)
    else:  # calm / focus — a small friendly curve
        c.arc([cx - mw * 0.85, my - mw * 0.75 * ky, cx + mw * 0.85, my + mw * 0.62 * ky],
              20, 160, ink, 4)

    if cfg.get("freckles"):
        fc = shade(skin, 0.80)
        for sx in (-1, 1):
            for i in range(3):
                c.circle(cx + sx * (r * 0.52 + i * r * 0.085),
                         ny + (r * 0.02 + (i % 2) * r * 0.07) * ky, r * 0.030, fill=fc)
    # blush and grime are translucent, so they go on an overlay — drawing
    # them straight onto the art would punch holes in the face
    ov = c.overlay()
    if cfg.get("smudge"):
        ov.ellipse([cx + r * 0.34, Y(0.30), cx + r * 0.66, Y(0.46)],
                   fill=(96, 84, 74, 150))
    for sx in (-1, 1):
        ov.ellipse([cx + sx * r * 0.60 - r * 0.16, Y(0.33),
                    cx + sx * r * 0.60 + r * 0.16, Y(0.49)],
                   fill=(206, 138, 128, 92))
    c.merge(ov)


def draw_hair_back(c, cx, cy, r, cfg, dx=0.0, dy=0.0, swing=0.0):
    """Hair mass behind the head (drawn before the face).

    ``dx``/``dy`` let the mass lag behind the skull and ``swing`` throws the
    braids out — hair is the cheapest secondary motion a kid has.
    """
    hc = HAIR[cfg["hair"]]
    cx += dx
    cy += dy
    if cfg.get("longhair"):
        c.circle(cx, cy + r * 0.06, r * 1.02, fill=shade(hc, 0.9))
        # a lock swings out past the shoulder when the head whips around
        if abs(swing) > 3:
            sx = 1.0 if swing > 0 else -1.0
            p0 = (cx + sx * r * 0.80, cy + r * 0.44)
            p1 = rot(p0, 90 - swing * 0.9, r * 0.72)
            icapsule(c, p0, p1, r * 0.40, r * 0.24, shade(hc, 0.9), ink=3.5)
    if cfg.get("braids"):
        for sx in (-1, 1):
            p0 = (cx + sx * r * 0.92, cy + r * 0.10)
            p1 = rot(p0, 76 + sx * 8 - swing, r * 0.86)
            icapsule(c, p0, p1, r * 0.26, r * 0.20, hc, ink=3.5)
            c.circle(p1[0], p1[1] + r * 0.06, r * 0.13, fill=CLOTH["rose"])


def draw_hair_front(c, cx, cy, r, cfg, dx=0.0, dy=0.0):
    hc = HAIR[cfg["hair"]]
    hat = cfg.get("hat", "none")
    cx += dx * 0.5
    cy += dy * 0.5
    if hat in ("newsboy", "flat", "cap", "bonnet"):
        # just a fringe under the brim
        c.chord([cx - r * 0.98, cy - r * 0.92, cx + r * 0.98, cy - r * 0.10],
                0, 180, fill=hc)
        return
    c.chord([cx - r * 1.0, cy - r * 1.02, cx + r * 1.0, cy + r * 0.10],
            180, 360, fill=hc)
    if cfg.get("messy"):
        for a, sz in ((-142, 0.40), (-96, 0.34), (-50, 0.38)):
            p = rot((cx, cy), a + dx * 1.2, r * 0.78)
            c.circle(p[0], p[1], r * sz, fill=hc)
        for a, sz in ((-142, 0.40), (-96, 0.34), (-50, 0.38)):
            p = rot((cx, cy), a + dx * 1.2, r * 0.78)
            c.circle(p[0] - r * sz * 0.22, p[1] - r * sz * 0.22, r * sz * 0.66,
                     fill=shade(hc, 1.10))
    else:
        c.chord([cx - r * 0.5, cy - r * 1.05, cx + r * 0.8, cy - r * 0.32],
                180, 360, fill=shade(hc, 1.12))


def draw_hair_back_of_head(c, cx, cy, r, cfg, dx=0.0, dy=0.0, swing=0.0):
    """The whole skull covered in hair, seen from behind.

    This is the hero asset — the batter fills a third of the screen — so the
    back of the head cannot be one flat disc of hair. It gets a crown
    highlight, a whorl the strands run out of, and a shaded nape.
    """
    hc = HAIR[cfg["hair"]]
    cx += dx * 0.5
    cy += dy * 0.5
    # the same rounded two-tone every other form in the game gets, so the
    # skull reads as a ball of hair instead of a hole cut out of the frame
    cy2 = cy - r * 0.06
    c.sphere(cx, cy2, r * 0.99, hc, shade(hc, 0.74))
    # nape: the hair turns under toward the neck
    c.chord([cx - r * 0.98, cy2 - r * 0.22, cx + r * 0.98, cy2 + r * 1.10],
            14, 166, fill=shade(hc, 0.66))
    # one confident sheen along the lit edge — the cartoon shorthand for hair
    c.arc([cx - r * 0.68, cy2 - r * 0.70, cx + r * 0.52, cy2 + r * 0.50],
          186, 262, shade(hc, 1.20), r * 0.085)
    if cfg.get("messy"):
        for a, sz in ((-142, 0.40), (-96, 0.34), (-50, 0.38)):
            p = rot((cx, cy), a, r * 0.78)
            c.circle(p[0], p[1], r * sz, fill=hc)
    if cfg.get("braids"):
        for sx in (-1, 1):
            p0 = (cx + sx * r * 0.72, cy + r * 0.30)
            p1 = rot(p0, 78 + sx * 6 - swing, r * 0.80)
            icapsule(c, p0, p1, r * 0.26, r * 0.20, hc, ink=3.5)
            c.circle(p1[0], p1[1] + r * 0.06, r * 0.13, fill=CLOTH["rose"])
    if cfg.get("longhair"):
        c.circle(cx, cy + r * 0.34, r * 0.94, fill=shade(hc, 0.94))


def draw_hat(c, cx, cy, r, cfg, dx=0.0, dy=0.0, rot_deg=0.0, back=False):
    """Headwear with lag: the cap rides the skull but never quite keeps up.

    ``dx``/``dy`` slide it (a jump pops it off the head, a hard stop slams it
    back down) and ``rot_deg`` cants it — positive is clockwise on screen.
    Drawn on its own layer so the rotation is real instead of a fudge.
    """
    if cfg.get("hat", "none") == "none":
        return
    if abs(rot_deg) < 0.3 and abs(dx) < 0.3 and abs(dy) < 0.3:
        _hat_parts(c, cx, cy, r, cfg, back)
        return
    lay = c.overlay()
    _hat_parts(lay, cx + dx, cy + dy, r, cfg, back)
    if abs(rot_deg) >= 0.3:
        lay.img = lay.img.rotate(-rot_deg, resample=Image.BILINEAR,
                                 center=(c._s(cx), c._s(cy)))
    c.merge(lay)


def _hat_parts(c, cx, cy, r, cfg, back=False):
    """Headwear sits ON the skull.

    Hard rule: nothing may reach below cy - 0.20r. The eyes live at cy + 0.10r
    and a cap over the eyes kills the whole character.
    """
    hat = cfg.get("hat", "none")
    if hat == "none":
        return
    big = 1.12 if cfg.get("bighat") else 1.0
    brim_dir = -1 if cfg.get("backwards") else 1

    def crown(top, bottom, wide, col, puffy=False):
        """Upper-half dome clipped to a flat bottom edge."""
        box = [cx - r * wide, cy - r * top, cx + r * wide, cy + r * bottom]
        ibox = [box[0] - 4, box[1] - 4, box[2] + 4, box[3]]
        c.chord(ibox, 180, 360, fill=INK)
        c.chord(box, 180, 360, fill=col)
        # sun catches the upper left of the crown
        c.chord([box[0] + r * 0.10, box[1] + r * 0.06,
                 box[2] - r * 0.55, box[3] - (box[3] - box[1]) * 0.34],
                180, 360, fill=shade(col, 1.10))
        if puffy:
            c.chord([box[0] + r * 0.16, box[1] - r * 0.10,
                     box[2] - r * 0.06, box[1] + r * 0.62], 180, 360,
                    fill=shade(col, 1.04))

    def visor(y, wide, drop, col):
        """Seen head-on, a cap peak is a wide shallow dome, not a side bar."""
        if back:
            # from behind, only a sliver of the peak shows past the crown
            c.chord([cx - r * wide * 0.55, y - r * 0.24,
                     cx + r * wide * 0.55, y - r * 0.02], 180, 360,
                    fill=shade(col, 0.66))
            return
        if cfg.get("backwards"):
            # peak points away — just the strap and a sliver at the ear
            c.chord([cx - r * 0.30, y - r * 0.10, cx + r * 0.30, y + r * 0.16],
                    0, 180, fill=shade(col, 0.72))
            return
        box = [cx - r * wide, y - r * 0.22, cx + r * wide, y + r * drop]
        c.chord([box[0] - 4, box[1] - 4, box[2] + 4, box[3] + 4], 0, 180, fill=INK)
        c.chord(box, 0, 180, fill=col)
        c.chord([box[0] + r * 0.10, box[1] + 2, box[2] - r * 0.45,
                 box[1] + (box[3] - box[1]) * 0.55], 0, 180, fill=shade(col, 1.06))

    if hat in ("newsboy", "flat"):
        col = cloth(cfg.get("hatcol",
                            "charcoal" if hat == "flat" else "chocolate"))
        if hat == "newsboy":
            crown(1.34 * big, 0.34, 1.08 * big, col, puffy=True)
            visor(cy - r * 0.38, 1.12, 0.17, shade(col, 0.78))
            c.circle(cx - r * 0.10, cy - r * 1.16 * big, r * 0.10,
                     fill=shade(col, 0.72))
        else:
            crown(1.16 * big, 0.16, 1.04 * big, col)
            visor(cy - r * 0.30, 1.08, 0.17, shade(col, 0.78))
    elif hat == "cap":
        col = cloth(cfg.get("hatcol", "navy"))
        crown(1.24, 0.26, 1.02, col)
        visor(cy - r * 0.34, 1.10, 0.19, shade(col, 0.80))
    elif hat == "bonnet":
        col = cloth(cfg.get("hatcol", "cream"))
        crown(1.12, 0.24, 1.14, col)
        # brim arcs over the brow, framing the face without covering it
        c.arc([cx - r * 1.30, cy - r * 1.36, cx + r * 1.30, cy + r * 0.02],
              182, 358, INK, 10)
        c.arc([cx - r * 1.26, cy - r * 1.32, cx + r * 1.26, cy - r * 0.02],
              182, 358, shade(col, 1.08), 7)
        icapsule(c, (cx + r * 1.04, cy - r * 0.30), (cx + r * 1.22, cy + r * 0.16),
                 r * 0.15, r * 0.11, CLOTH["rose"], ink=3)
    elif hat == "scarf":
        col = cloth(cfg.get("hatcol", "clay"))
        crown(1.22, 0.22, 1.06, col)
        # knot tucked at the side, tails fall behind
        icircle(c, cx - r * 0.98, cy - r * 0.42, r * 0.17, col, ink=3, sphere=False)
        icapsule(c, (cx - r * 1.00, cy - r * 0.36), (cx - r * 1.20, cy + r * 0.10),
                 r * 0.15, r * 0.09, shade(col, 0.90), ink=3)


# ---------------------------------------------------------------- the body
def _dep(col):
    """Far-side limbs sit back in the air a little — a flat depth cue that
    stops the far arm disappearing into the torso."""
    return shade(col, 0.87)


def draw_kid(c, cfg, pose):
    b = BODY[cfg["body"]]
    sc = b["scale"]
    hr = b["hr"] * sc
    tw = b["tw"] * sc * (1.07 if cfg.get("stocky") else 1.0)
    th = b["th"] * sc
    lw = b["lw"] * sc * (1.05 if cfg.get("stocky") else 1.0)
    flip = 1

    bob = pose.get("bob", 0.0)
    squat = pose.get("squat", 0.0)
    lean = pose.get("lean", 0.0)
    sh_tilt = pose.get("sh_tilt", 0.0)      # +: the near shoulder drops
    hip_tilt = pose.get("hip_tilt", 0.0)    # +: the near hip drops
    cx = c.w / 2 + pose.get("dx", 0.0)
    feet_y = GROUND + pose.get("dy", 0.0)

    hip_y = feet_y - 98 * sc + squat + bob
    sh_y = hip_y - th + bob * 0.2
    head_cy = sh_y - hr * 0.72 + pose.get("head_dy", 0.0) + sh_tilt * 0.35
    lean_r = math.radians(lean)
    head_cx = cx + math.sin(lean_r) * (sh_y - head_cy) * 0.9 + pose.get("head_dx", 0.0)

    skin = SKIN[cfg["skin"]]
    shirt = cloth(cfg["shirt"])
    pants = cloth(cfg["pants"])
    sock = cloth(cfg["sock"])
    shoe = cloth(cfg["shoe"])

    hip_l = (cx - tw * 0.26, hip_y - hip_tilt)
    hip_r = (cx + tw * 0.26, hip_y + hip_tilt)
    sh_l = (cx - tw * 0.50 + math.sin(lean_r) * th * 0.5, sh_y - sh_tilt)
    sh_r = (cx + tw * 0.50 + math.sin(lean_r) * th * 0.5, sh_y + sh_tilt)

    thigh = 50 * sc
    shin = 48 * sc
    upper = 42 * sc
    fore = 40 * sc
    sock_hi = 0.16 if cfg.get("knickers") else 0.0

    # Joint angles are RELATIVE: the second value is the bend at knee/elbow
    # measured from the parent segment, so limbs articulate like limbs.
    def leg(hip, angs, near, toe=0.0):
        hipa, bend = angs
        kp = rot(hip, hipa, thigh)
        fp = rot(kp, hipa + bend, shin)
        pc, sk, sc_, sc2 = pants, sock, shoe, skin
        if not near:
            pc, sk, sc_, sc2 = _dep(pants), _dep(sock), _dep(shoe), _dep(skin)
        # knickerbocker hem sits above the knee, so the sock covers the joint
        hem = rot(hip, hipa, thigh * (1.0 - sock_hi))
        top = rot(hip, hipa, thigh * (1.0 - sock_hi * 1.6))
        icapsule(c, hip, hem, lw * 1.18, lw * 1.02, pc, ink=4)
        icapsule(c, top, fp, lw * 0.92, lw * 0.78, sk, ink=4)
        if cfg.get("bandage") and near:
            c.capsule((kp[0] - lw * 0.46, kp[1] + lw * 0.1),
                      (kp[0] + lw * 0.46, kp[1] + lw * 0.1),
                      lw * 0.46, lw * 0.46, CLOTH["white"])
            c.line([(kp[0] - lw * 0.34, kp[1] - lw * 0.06),
                    (kp[0] + lw * 0.34, kp[1] + lw * 0.24)],
                   shade(CLOTH["white"], 0.78), 3)
        # shoe — a stubby boot pointing the way the kid faces; ``toe`` rolls
        # it onto the ball of the foot for a push-off or a pointed slide
        heel = rot(fp, 180 + toe, lw * 0.20)
        tip = rot(fp, 8 + toe, lw * 0.95)
        icapsule(c, heel, tip, lw * 0.96, lw * 0.66, sc_, ink=4)
        return fp

    def arm(sh, angs, near, target=None):
        if target is not None:
            # Hand targets are given in BODY-CENTRE units (x right, y down,
            # 1.0 = one arm's reach) because this construction has a head
            # wider than the shoulder span: anything authored off the
            # shoulder ends up planted on the kid's own face.
            sign = target[2] if len(target) > 2 else (-1 if near else 1)
            tp = (cx + math.sin(lean_r) * th * 0.5 + target[0] * (upper + fore),
                  sh_y + target[1] * (upper + fore))
            ua, bend = ik2(sh, tp, upper, fore, sign)
        else:
            ua, bend = angs
        el = rot(sh, ua, upper)
        hd = rot(el, ua + bend, fore)
        sk, sh_c = skin, shirt
        if not near:
            sk, sh_c = _dep(skin), _dep(shirt)
        if cfg.get("sleeveless"):
            icapsule(c, sh, el, lw * 1.02, lw * 0.88, sk, ink=4)
        else:
            cuff = 0.55 if cfg.get("rolled") else 1.0
            mid = (sh[0] + (el[0] - sh[0]) * cuff, sh[1] + (el[1] - sh[1]) * cuff)
            icapsule(c, sh, el, lw * 1.10, lw * 0.94, sk, ink=4)
            icapsule(c, sh, mid, lw * 1.12, lw * 0.98, sh_c, ink=4)
        icapsule(c, el, hd, lw * 0.86, lw * 0.74, sk, ink=4)
        icircle(c, hd[0], hd[1], lw * 0.56, sk, ink=3.5)
        return hd

    far_arm = pose.get("arm_far", (100, 95))
    near_arm = pose.get("arm_near", (80, 85))
    far_leg = pose.get("leg_far", (95, 90))
    near_leg = pose.get("leg_near", (85, 90))

    # ---- motion smear goes down first, behind everything it trails
    smear = pose.get("smear")
    if smear:
        ov = c.overlay()
        for kind, a0, a1, r0, r1, al in smear:
            if kind == "bat":
                hn = pose.get("hand_near")
                if hn is not None:
                    px = cx + math.sin(lean_r) * th * 0.5 + hn[0] * (upper + fore)
                    py = sh_y + hn[1] * (upper + fore)
                else:
                    px, py = rot(sh_r, near_arm[0], upper)
                    px, py = rot((px, py), near_arm[0] + near_arm[1], fore)
            else:
                px, py = sh_r
            fwd = a1 >= a0
            lo, hi = (a0, a1) if fwd else (a1, a0)
            steps = max(3, int((hi - lo) / 11))
            step = (hi - lo) / steps
            for k in range(steps):
                t = (k / max(1, steps - 1)) if fwd else (1 - k / max(1, steps - 1))
                rr = r0 + (r1 - r0) * (0.35 + 0.65 * t)
                aa = int(al * (0.10 + 0.90 * t * t))
                if aa < 4:
                    continue
                b0 = lo + step * k
                ov.arc([px - rr, py - rr, px + rr, py + rr], b0, b0 + step * 1.25,
                       (252, 246, 230, aa), lw * (0.20 + 0.36 * t))
        c.merge(ov)

    # ---- far side first so overlaps read correctly
    arm(sh_l if flip > 0 else sh_r, far_arm, False, pose.get("hand_far"))
    leg(hip_l if flip > 0 else hip_r, far_leg, False, pose.get("foot_far", 0.0))
    leg(hip_r if flip > 0 else hip_l, near_leg, True, pose.get("foot_near", 0.0))

    # ---- torso
    tx0, tx1 = cx - tw / 2, cx + tw / 2
    ty0, ty1 = sh_y - hr * 0.10, hip_y + 6
    lean_off = math.sin(lean_r) * th * 0.42
    hem_dx = pose.get("hem_dx", 0.0)      # skirts and aprons drag a beat behind
    hem_dy = pose.get("hem_dy", 0.0)
    if cfg.get("dress"):
        ipoly(c, [(tx0 + 6 + lean_off, ty0), (tx1 - 6 + lean_off, ty0),
                  (tx1 + tw * 0.30 + hem_dx, ty1 + 26 + hem_dy),
                  (tx0 - tw * 0.30 + hem_dx, ty1 + 26 + hem_dy)],
              shirt, ink=4)
        if cfg.get("pinafore"):
            ipoly(c, [(cx - tw * 0.30 + lean_off, ty0 + 4),
                      (cx + tw * 0.30 + lean_off, ty0 + 4),
                      (cx + tw * 0.40 + hem_dx * 0.9, ty1 + 22 + hem_dy),
                      (cx - tw * 0.40 + hem_dx * 0.9, ty1 + 22 + hem_dy)],
                  CLOTH["white"], ink=3)
    else:
        irrect(c, [tx0 + lean_off * 0.6, ty0, tx1 + lean_off * 0.6, ty1],
               tw * 0.24, shirt, ink=4)
    # shoulder yoke — gives the shoulders mass so they can tilt, and lets the
    # far arm emerge from under something instead of out of the torso edge
    icapsule(c, sh_l, sh_r, lw * 1.30, lw * 1.30,
             shirt if not cfg.get("sleeveless") else shirt, ink=4)
    if cfg.get("overalls"):
        col = pants
        irrect(c, [tx0 + 10 + lean_off * 0.6, ty0 + th * 0.34,
                   tx1 - 10 + lean_off * 0.6, ty1], tw * 0.16, col, ink=3.5)
        for sx in (-1, 1):
            c.capsule((cx + sx * tw * 0.22 + lean_off, ty0 - 2),
                      (cx + sx * tw * 0.26 + lean_off, ty0 + th * 0.36),
                      lw * 0.42, lw * 0.42, col)
    if cfg.get("suspenders"):
        col = shade(cloth(cfg["pants"]), 0.72)
        for sx in (-1, 1):
            c.capsule((cx + sx * tw * 0.24 + lean_off, ty0),
                      (cx + sx * tw * 0.16 + lean_off, ty1),
                      lw * 0.34, lw * 0.34, col)
    if cfg.get("vest"):
        vc = cloth(cfg.get("vest_col", "ochre"))
        ipoly(c, [(tx0 + 8 + lean_off, ty0), (cx + lean_off, ty0 + th * 0.20),
                  (tx1 - 8 + lean_off, ty0), (tx1 - 10 + lean_off, ty1),
                  (tx0 + 10 + lean_off, ty1)], vc, ink=3.5)
    if cfg.get("apron"):
        ac = cloth(cfg.get("apron_col", "dust"))
        ipoly(c, [(cx - tw * 0.30 + lean_off, ty0 + th * 0.18),
                  (cx + tw * 0.30 + lean_off, ty0 + th * 0.18),
                  (cx + tw * 0.34 + hem_dx, ty1 + 14 + hem_dy),
                  (cx - tw * 0.34 + hem_dx, ty1 + 14 + hem_dy)],
              ac, ink=3.5)
        if cfg.get("satchel"):
            irrect(c, [cx + tw * 0.18 + hem_dx * 0.7, ty1 - 16 + hem_dy * 0.5,
                       cx + tw * 0.62 + hem_dx * 0.7, ty1 + 14 + hem_dy * 0.5],
                   8, shade(cloth("chocolate"), 0.94), ink=3)
            c.capsule((cx - tw * 0.18, ty0 + 6),
                      (cx + tw * 0.40 + hem_dx * 0.7, ty1 - 12 + hem_dy * 0.5),
                      lw * 0.28, lw * 0.28, shade(cloth("chocolate"), 0.78))
    if cfg.get("bowtie"):
        ipoly(c, [(cx - 16 + lean_off, ty0 + 2), (cx + lean_off, ty0 + 9),
                  (cx + 16 + lean_off, ty0 + 2), (cx + 16 + lean_off, ty0 + 18),
                  (cx + lean_off, ty0 + 11), (cx - 16 + lean_off, ty0 + 18)],
              CLOTH["rust"], ink=3)
    if cfg.get("whistle"):
        c.line([(cx - 12 + lean_off, ty0 + 4),
                (cx + 8 + lean_off + hem_dx * 0.4, ty0 + 30)], INK, 3)
        icircle(c, cx + 9 + lean_off + hem_dx * 0.4, ty0 + 33, 7, A.GOLD,
                ink=3, sphere=False)

    # collar
    c.capsule((cx - tw * 0.20 + lean_off, ty0 + 2), (cx + tw * 0.20 + lean_off, ty0 + 2),
              lw * 0.5, lw * 0.5, shade(shirt, 1.12))

    # ---- near arm goes on AFTER the torso but BEFORE the head, so a
    # raised arm or a cocked bat passes behind the skull instead of being
    # painted across the kid's own face
    hand = arm(sh_r if flip > 0 else sh_l, near_arm, True, pose.get("hand_near"))

    # ---- head
    hx = pose.get("hair_dx", 0.0)
    hy = pose.get("hair_dy", 0.0)
    hsw = pose.get("hair_swing", 0.0)
    icircle(c, head_cx, head_cy, hr * 0.30, skin, ink=4)     # neck nub
    draw_hair_back(c, head_cx, head_cy, hr, cfg, hx, hy, hsw)
    icircle(c, head_cx, head_cy, hr, skin, ink=4.5)
    # ears
    _lk = pose.get("look", 0.0) * flip
    for sx in (-1, 1):
        # the ear the kid turns away from tucks in and shrinks; the other
        # swings out. Two circles, and the head reads as turning.
        icircle(c, head_cx + sx * hr * 0.96 + _lk * hr * 0.10,
                head_cy + hr * 0.16,
                hr * 0.135 * (1.0 + 0.42 * _lk * sx),
                shade(skin, 0.92), ink=3)
    if pose.get("back", False):
        draw_hair_back_of_head(c, head_cx, head_cy, hr, cfg, hx, hy, hsw)
        for sx in (-1, 1):     # ears sit outside the hair, not under it
            icircle(c, head_cx + sx * hr * 0.94, head_cy + hr * 0.20,
                    hr * 0.145, shade(skin, 0.88), ink=3)
        draw_hat(c, head_cx, head_cy, hr, cfg, pose.get("hat_dx", 0.0),
                 pose.get("hat_dy", 0.0), pose.get("hat_rot", 0.0), back=True)
    else:
        draw_hair_front(c, head_cx, head_cy, hr, cfg, hx, hy)
        draw_face(c, head_cx, head_cy, hr, cfg, pose.get("face", "calm"),
                  pose.get("look", 0.0) * flip, pose.get("look_y", 0.0))
        draw_hat(c, head_cx, head_cy, hr, cfg, pose.get("hat_dx", 0.0),
                 pose.get("hat_dy", 0.0), pose.get("hat_rot", 0.0))

    # ---- held gear, in front of the head: a cocked bat and a raised
    # glove are the whole silhouette and must never hide behind it
    if pose.get("bat") is not None:
        grip = draw_bat(c, hand, pose["bat"] * flip, sc)
        icircle(c, hand[0], hand[1], lw * 0.54, skin, ink=3.5)
        off = ((grip[0] - hand[0]) * 0.42, (grip[1] - hand[1]) * 0.42)
        icircle(c, hand[0] + off[0], hand[1] + off[1], lw * 0.50, skin, ink=3.5)
    if pose.get("glove"):
        icircle(c, hand[0], hand[1], lw * 0.95, CLOTH["chocolate"], ink=4)
        c.arc([hand[0] - lw * 0.7, hand[1] - lw * 0.7,
               hand[0] + lw * 0.7, hand[1] + lw * 0.7], 200, 340,
              shade(CLOTH["chocolate"], 0.7), 3)
    if pose.get("ball"):
        icircle(c, hand[0], hand[1] - lw * 0.2, lw * 0.42, A.PINK, ink=3)

    # ---- kicked-up street dust, last so it drifts in front of the shoes
    dust = pose.get("dust")
    if dust:
        ov = c.overlay()
        for dx_, dy_, rr, al in dust:
            px = cx + dx_
            py = GROUND + pose.get("dy", 0.0) + dy_
            ov.circle(px, py, rr, fill=(206, 196, 178, int(al)))
            ov.circle(px - rr * 0.42, py - rr * 0.34, rr * 0.62,
                      fill=(224, 216, 198, int(al * 0.85)))
        c.merge(ov)


def draw_bat(c, hand, ang, sc=1.0):
    """A broom handle with friction tape at the grip — stickball, not baseball."""
    ln = 100 * sc
    tip = rot(hand, ang, ln)
    grip = rot(hand, ang, -22 * sc)
    wood = (178, 150, 108)
    icapsule(c, grip, tip, 13.5 * sc, 16.0 * sc, wood, ink=4)
    # friction tape wound around the grip
    tape_end = rot(hand, ang, 26 * sc)
    c.capsule(grip, tape_end, 15.0 * sc, 14.2 * sc, (68, 62, 58))
    for i in range(4):
        p0 = rot(hand, ang, -16 * sc + i * 11 * sc)
        p1 = rot(p0, ang + 78, 8.0 * sc)
        c.capsule(p0, p1, 3.2 * sc, 3.2 * sc, (44, 40, 38))
    return grip


# ---------------------------------------------------------------- poses
# Cycles are keyframed, not interpolated. Twelve frames of smooth sine is what
# a mannequin does; six frames of strong, unequal poses is what a cartoon does,
# and the 1926 register wants the snap.
def _k(seq, i):
    """Pick keyframe i, wrapping — lets a table be shorter than the cycle."""
    return seq[i % len(seq)]


def _lerp(a, b, t):
    return a + (b - a) * t


# ------------------------------------------------------------------ idle
# Six frames at ~6fps: a full second of being alive. Every kid gets a
# different tic, and a phase offset so the block never breathes in unison.
_IDLE = {
    # planted: the big kids. Weight never leaves the middle; the motion is a
    # slow chest fill and one shoulder rolling out a crick.
    "planted": dict(
        # weight never leaves the middle, but a big kid still breathes, rolls
        # a shoulder and hitches his belt — hold everything TOO still and the
        # drawing reads as broken rather than as calm
        bob=[-1.5, -4.0, -5.0, -2.6, 0.4, -0.4],
        stretch=[0.008, 0.026, 0.030, 0.010, -0.014, -0.006],
        squat=[0, -1.0, -1.5, 1.5, 4.5, 2.0],
        sh_tilt=[0.0, -2.4, -3.6, -1.2, 2.6, 1.4],
        hip_tilt=[1.4, 2.2, 1.6, 0.0, -1.8, -0.8],
        look=[0.10, 0.14, -0.10, -0.45, -0.42, 0.0],
        head_dx=[0.8, 1.0, -0.2, -2.8, -2.6, -0.4],
        head_dy=[0.0, -1.2, -1.6, 0.4, 1.8, 0.6],
        hat_dy=[0.8, 1.4, 0.8, 0.0, -1.2, -0.6],
        hat_rot=[0.6, 1.4, 1.8, 0.6, -1.8, -1.0],
        hem_dx=[0.4, 0.8, 0.4, -0.8, -1.4, -0.6],
        arm_far=[(105, 10), (107, 13), (108, 15), (104, 9), (101, 5), (103, 7)],
        hand_near=[(0.50, 1.00, -1), (0.50, 0.98, -1), (0.48, 0.96, -1),
                   (0.44, 0.86, -1), (0.42, 0.82, -1), (0.48, 0.94, -1)],
        leg_far=[(100, 5), (100, 3), (100, 2), (101, 6), (102, 9), (101, 7)],
        leg_near=[(80, -5), (80, -3), (80, -2), (79, -6), (78, -9), (79, -7)],
        face=["calm", "calm", "calm", "blink", "calm", "calm"]),
    # bounce: scrappy kids who cannot stand still. Heels never settle.
    "bounce": dict(
        bob=[0.5, -5.5, -9.5, -6.5, -1.0, 2.0],
        stretch=[-0.038, 0.028, 0.058, 0.026, -0.026, -0.058],
        squat=[4.0, 0.0, -2.0, 0.0, 4.5, 8.0],
        hat_dy=[1.8, 1.8, -0.8, -1.8, 0.8, 2.0],
        hat_rot=[-1.0, -2.0, -1.0, 1.5, 2.5, 1.0],
        hair_dy=[1.2, 1.4, -0.8, -1.4, 0.6, 1.4],
        hair_swing=[-3, -5, 2, 6, 3, -2],
        sh_tilt=[1.0, 0.5, -0.5, -1.0, 0.5, 1.5],
        hip_tilt=[-1.0, -0.5, 0.5, 1.0, -0.5, -1.5],
        look=[0.25, 0.30, 0.10, -0.25, -0.30, -0.05],
        head_dx=[0.8, 1.0, 0.2, -0.8, -1.0, -0.2],
        hand_far=[(-0.44, 0.92, 1), (-0.52, 0.80, 1), (-0.58, 0.72, 1),
                  (-0.52, 0.78, 1), (-0.44, 0.94, 1), (-0.38, 1.00, 1)],
        hand_near=[(0.44, 0.92, -1), (0.52, 0.80, -1), (0.58, 0.72, -1),
                   (0.52, 0.78, -1), (0.44, 0.94, -1), (0.38, 1.00, -1)],
        leg_far=[(95, 10), (95, 3), (94, 0), (95, 3), (96, 12), (97, 18)],
        leg_near=[(85, -10), (85, -3), (86, 0), (85, -3), (84, -12), (83, -18)],
        foot_far=[6, -8, -16, -8, 8, 12], foot_near=[5, -7, -14, -7, 7, 11],
        face=["grin", "grin", "grin", "calm", "calm", "grin"]),
    # scan: the lookouts. Sweep the street, then shade the eyes and squint up
    # the block for the cop.
    "scan": dict(
        bob=[-1.0, -2.0, -2.2, -1.2, -2.0, -2.2],
        look=[0.15, 0.75, 0.85, 0.20, -0.80, -0.66],
        head_dx=[1.0, 5.0, 6.0, 1.4, -5.0, -4.0],
        hat_dx=[0.0, -3.0, -1.5, 1.5, 3.0, 1.4],
        hat_rot=[0.0, -5.5, -7.0, -1.5, 6.0, 4.5],
        hair_dx=[0.0, -2.0, -1.0, 1.0, 2.0, 0.8],
        hip_tilt=[1.0, 1.6, 1.6, 0.4, -1.6, -1.6],
        sh_tilt=[-0.6, -1.6, -1.6, 0.0, 1.6, 1.0],
        stretch=[0.0, 0.008, 0.010, 0.0, 0.006, 0.008],
        arm_far=[(98, 10)],
        hand_near=[(0.52, 1.00, -1), (0.98, 0.34, -1), (0.94, -0.50, -1),
                   (0.90, -0.56, -1), (1.00, 0.30, -1), (0.54, 0.98, -1)],
        leg_far=[(96, 4)], leg_near=[(84, -4)],
        face=["calm", "focus", "focus", "calm", "focus", "focus"]),
    # fidget: hands that will not leave the hat alone.
    "fidget": dict(
        bob=[-1.0, -2.0, -1.6, -1.6, -2.0, -1.0],
        squat=[0, 0, 1.5, 1.5, 0, 0],
        head_dy=[0, 0, 1.4, 1.6, 0.4, 0],
        hat_dy=[0.4, 0.2, -2.2, -2.8, -0.6, 0.6],
        hat_rot=[0.0, -1.5, -6.0, -7.0, -2.0, 0.5],
        hat_dx=[0.0, 0.0, -1.4, -1.8, -0.4, 0.0],
        sh_tilt=[0.5, -0.5, -2.0, -2.2, -0.8, 0.6],
        hip_tilt=[-0.5, 0.5, 1.4, 1.6, 0.6, -0.5],
        look=[0.10, 0.20, 0.32, 0.28, 0.06, 0.0],
        arm_far=[(97, 10)],
        hand_near=[(0.52, 1.00, -1), (0.92, 0.40, -1), (0.86, -0.62, -1),
                   (0.80, -0.70, -1), (0.96, 0.36, -1), (0.54, 0.98, -1)],
        leg_far=[(95, 4)], leg_near=[(85, -4)],
        face=["calm", "blink", "sly", "sly", "grin", "calm"]),
    # prim: hands clasped, chin up, a sway you could set a metronome to.
    "prim": dict(
        bob=[-1.0, -2.0, -2.4, -1.6, -0.5, -0.5],
        squat=[0, 0, 0, 0.5, 2.0, 1.0],
        head_dx=[0.6, 1.3, 0.9, -0.6, -1.3, -0.9],
        hat_rot=[-0.6, -1.4, -1.0, 0.6, 1.4, 1.0],
        hem_dx=[-1.2, -2.2, -1.2, 1.2, 2.2, 1.2],
        hair_swing=[2, 4, 2, -2, -4, -2],
        hip_tilt=[0.8, 1.4, 0.8, -0.8, -1.4, -0.8],
        sh_tilt=[-0.4, -0.8, -0.4, 0.4, 0.8, 0.4],
        look=[0.10, 0.26, 0.20, -0.14, -0.30, -0.10],
        hand_far=[(-0.07, 0.80, 1)], hand_near=[(0.07, 0.80, -1)],
        leg_far=[(92, 2)], leg_near=[(88, -2)],
        face=["calm", "grin", "grin", "blink", "calm", "grin"]),
    # sway: rocks on the balls of the feet, skirt a beat behind the hips.
    "sway": dict(
        bob=[-1.2, -2.2, -1.4, -1.2, -2.2, -1.4],
        lean=[-2.0, -3.2, -1.8, 2.0, 3.2, 1.8],
        hip_tilt=[1.6, 2.6, 1.6, -1.6, -2.6, -1.6],
        sh_tilt=[-0.8, -1.4, -0.8, 0.8, 1.4, 0.8],
        hem_dx=[-2.0, -3.6, -2.4, 2.0, 3.6, 2.4],
        hair_swing=[4, 8, 5, -4, -8, -5],
        hat_rot=[-1.5, -3.0, -2.0, 1.5, 3.0, 2.0],
        look=[0.20, 0.30, 0.12, -0.20, -0.30, -0.12],
        head_dx=[0.8, 1.6, 1.0, -0.8, -1.6, -1.0],
        hand_far=[(-0.44, 0.84, 1)], hand_near=[(0.44, 0.84, -1)],
        leg_far=[(93, 3)], leg_near=[(87, -3)],
        face=["calm", "blink", "grin", "grin", "calm", "calm"]),
}


def _idle_pose(i, n, cfg):
    style = _IDLE.get(cfg.get("idle", "planted"), _IDLE["planted"])
    j = (i + cfg.get("phase", 0)) % max(1, n)
    p = {}
    for key, seq in style.items():
        p[key] = _k(seq, j)
    return p


# ------------------------------------------------------------------ run
# Four poses per stride, two strides per cycle: contact, down, passing, push.
# The legs are a table so the drive stays in the pose and not in a sine wave.
_RUN_LEG = [(64, 18), (84, 46), (98, 8), (124, 10)]       # the striking leg
_RUN_LEG_OFF = [(114, 48), (106, 92), (60, 104), (48, 62)]  # the recovering leg
_RUN_FOOT = [-12, 4, -26, -46]
_RUN_FOOT_OFF = [22, 30, 10, -8]
# forward peak, descending, back peak, rising — each arm keeps to its own
# half of the body so the far one never vanishes into the shirt
_RUN_HAND_N = [(0.90, 0.18), (0.64, 0.60), (0.10, 1.00), (0.52, 0.58)]
_RUN_HAND_F = [(-0.22, 0.16), (-0.50, 0.58), (-0.96, 0.94), (-0.56, 0.54)]
_RUN_BOB = [1.0, 4.0, -6.0, -13.0]
_RUN_STRETCH = [-0.02, -0.085, 0.015, 0.075]
_RUN_HAT_DY = [1.6, -1.6, 2.2, 2.6]
_RUN_TILT = [3.0, 2.0, -3.0, -2.0]


def _run_pose(i, n, cfg):
    q = i % 4
    side = 1 if (i % 8) < 4 else -1        # which leg is striking
    a_leg, a_off = _RUN_LEG[q], _RUN_LEG_OFF[q]
    a_ft, a_ft_off = _RUN_FOOT[q], _RUN_FOOT_OFF[q]
    qa, qb = (q + 2) % 4, q
    if side > 0:
        leg_near, leg_far = a_leg, a_off
        foot_near, foot_far = a_ft, a_ft_off
    else:
        leg_near, leg_far = a_off, a_leg
        foot_near, foot_far = a_ft_off, a_ft
        qa, qb = qb, qa
    hand_near = _RUN_HAND_N[qa] + (-1,)
    hand_far = _RUN_HAND_F[qb] + (1,)
    p = dict(bob=_RUN_BOB[q], stretch=_RUN_STRETCH[q], lean=15.0,
             face="focus" if q < 2 else "effort", look=0.34,
             leg_near=leg_near, leg_far=leg_far,
             foot_near=foot_near, foot_far=foot_far,
             hand_near=hand_near, hand_far=hand_far,
             sh_tilt=_RUN_TILT[q] * side, hip_tilt=-_RUN_TILT[q] * side * 0.8,
             hat_dx=-2.2, hat_dy=_RUN_HAT_DY[q], hat_rot=-3.0 - 1.5 * side,
             hair_dx=-1.6, hair_dy=_RUN_HAT_DY[q] * 0.6,
             hair_swing=-9 - 4 * side, hem_dx=-3.5, hem_dy=-1.5,
             head_dx=1.2 * side, dx=2.0 * side)
    if q == 1:                              # the foot that just took the weight
        p["dust"] = [(-14 * side, -2, 9, 78), (-26 * side, -6, 6, 54)]
    return p


# ------------------------------------------------------------------ swing
# Six frames at 14fps. Two of them are spent NOT swinging: the load and the
# extra coil are the anticipation that makes the other four land.
_SWING = [
    #  bat  hand_near      hand_far       squat lean  dx  sh_t stretch face   hat_rot
    (-128, (-0.40, 0.30), (-0.64, 0.34), 12, -16,  10, -3.5, -0.020, "focus",  -2.0),
    (-150, (-0.52, 0.22), (-0.76, 0.26), 17, -22,  14, -5.5, -0.055, "grit",   -5.0),
    (-70, (-0.10, 0.34), (-0.42, 0.40),   8,  -4,  -2,  0.0,  0.020, "effort",  3.5),
    (8, (0.75, 0.34), (0.42, 0.40),       2,  16, -18,  4.5,  0.060, "effort",  9.0),
    (66, (1.00, 0.02), (0.60, 0.14),      4,  24, -27,  5.5,  0.030, "yell",   11.0),
    (142, (0.52, -0.26), (0.14, -0.14),   9,  28, -34,  3.0, -0.020, "yell",    7.0),
]
_SWING_LEG_FAR = [(105, 15), (109, 19), (103, 11), (97, 7), (89, 5), (83, 9)]
_SWING_LEG_NEAR = [(74, -8), (66, -4), (72, -6), (78, -2), (82, 0), (86, 2)]
_SWING_FOOT_FAR = [0, -6, -14, -28, -44, -58]


def _swing_pose(i, n, cfg):
    i = min(i, len(_SWING) - 1)
    bat, hand, hfar, squat, lean, dx, sh_t, st, face, hrot = _SWING[i]
    p = dict(bat=bat, hand_near=(hand[0], hand[1], -1),
             hand_far=(hfar[0], hfar[1], 1),
             squat=squat, lean=lean, dx=dx, sh_tilt=sh_t, hip_tilt=-sh_t * 0.5,
             stretch=st, face=face, hat_rot=hrot,
             hat_dx=-hrot * 0.22, hat_dy=-abs(hrot) * 0.12,
             hair_swing=hrot * 1.5, hem_dx=-hrot * 0.6, hem_dy=-abs(hrot) * 0.10,
             look=_lerp(-0.60, 0.78, i / 5.0),
             leg_far=_SWING_LEG_FAR[i], leg_near=_SWING_LEG_NEAR[i],
             foot_far=_SWING_FOOT_FAR[i], head_dx=-4 + 3.0 * i,
             head_dy=[1.5, 3.0, 0.0, -2.0, -1.0, 1.0][i])
    if i >= 2:
        prev = _SWING[i - 1][0]
        p["smear"] = [("bat", prev, bat, 58, 108, 92 if i == 3 else 66)]
    if i >= 3:
        p["dust"] = [(-26 - 6 * i, -3, 7 + i, 46), (-44 - 8 * i, -7, 5, 30)]
    return p


# ------------------------------------------------------------------ the rest
def pose_for(anim, i, n, cfg):
    if anim in ("bat_back", "swing_back"):
        p = pose_for("bat_stance" if anim == "bat_back" else "swing", i, n, cfg)
        p["back"] = True
        return p
    """Skeleton per frame."""
    p = i / max(1, n)
    tau = math.pi * 2
    k = i / max(1, n - 1)

    if anim == "idle":
        return _idle_pose(i, n, cfg)

    if anim == "run":
        return _run_pose(i, n, cfg)

    if anim == "swing":
        return _swing_pose(i, n, cfg)

    if anim == "bat_stance":
        # two frames of a bat that will not hold still — the waggle is what
        # tells you the kid is waiting on a pitch rather than posing for one
        wag = [0, 1][i % 2]
        return dict(bob=[-1.0, -2.2][wag], squat=[10, 12][wag], lean=[-8, -10][wag],
                    face="focus", look=-0.55,
                    hand_near=[(-0.38, 0.32, -1), (-0.44, 0.26, -1)][wag],
                    hand_far=[(-0.62, 0.36, 1), (-0.68, 0.30, 1)][wag],
                    sh_tilt=[-2.5, -3.5][wag], hip_tilt=[1.0, 1.5][wag],
                    hat_rot=[-1.5, -2.5][wag], hat_dy=[0.0, -0.6][wag],
                    leg_far=[(104, 12), (106, 14)][wag],
                    leg_near=[(74, -10), (72, -9)][wag],
                    bat=[-122, -112][wag])

    if anim == "walk":
        # cop swagger: contact / down / passing / up, with the belly leading
        q = i % 4
        leg_a = [(70, 12), (86, 22), (98, 8), (110, 14)][q]
        leg_b = [(110, 16), (104, 44), (76, 52), (64, 22)][q]
        hand_a = [(0.30, 0.95), (0.46, 0.78), (0.62, 0.55), (0.56, 0.75)][q]
        hand_b = [(-0.66, 0.90), (-0.52, 0.74), (-0.32, 0.52), (-0.44, 0.72)][q]
        return dict(bob=[3.0, 1.0, -3.0, 0.0][q],
                    stretch=[0.0, -0.022, 0.018, 0.006][q],
                    lean=4.0, face="calm", look=[0.3, 0.3, -0.1, -0.1][q],
                    leg_near=leg_a, leg_far=leg_b,
                    foot_near=[-10, 6, -14, -30][q], foot_far=[16, 22, 6, -6][q],
                    hand_near=(hand_a[0], hand_a[1], -1),
                    hand_far=(hand_b[0], hand_b[1], 1),
                    sh_tilt=[1.6, 1.0, -1.6, -1.0][q],
                    hip_tilt=[-1.4, -0.8, 1.4, 0.8][q],
                    hat_dy=[0.8, -0.8, 1.2, 1.0][q],
                    hat_rot=[-1.0, 1.0, 1.5, -0.5][q],
                    head_dx=[0.8, 0.4, -0.8, -0.4][q])

    if anim == "pitch":
        # set, rock, leg lift, break, stride, release, follow, recover.
        # The throwing arm runs on joint angles, not a hand target: the cocked
        # elbow-over-the-ear pose is a rotation, and IK would solve it flat.
        j = min(i, 7)
        q = dict(squat=[4, 5, 0, 2, 9, 8, -4, 6][j],
                 lean=[-6, -11, -15, -18, -21, 6, 22, 6][j],
                 dx=[0, 3, 5, 4, -2, -11, -19, -13][j],
                 head_dx=[0, -2, -3, -3, -2, 3, 6, 2][j],
                 bob=[-1, -2, -6, -4, -1, -2, 0, -1][j],
                 stretch=[0.0, 0.010, 0.052, 0.020, 0.030, 0.050, -0.030, 0.0][j],
                 sh_tilt=[-1, -2, -3, -4, -5, 3, 5, 2][j],
                 hip_tilt=[1, 1, 2, 2, 3, -2, -3, -1][j],
                 face=["focus", "focus", "focus", "focus", "effort", "yell",
                       "effort", "focus"][j],
                 look=[-0.35, -0.40, -0.30, -0.20, 0.10, 0.45, 0.55, 0.30][j],
                 look_y=[0, 0, -0.15, -0.10, 0, 0.10, 0.25, 0.10][j],
                 hat_rot=[-1, -2, -3, -4, -6, 5, 9, 3][j],
                 hat_dy=[0, 0.6, 1.4, 0.6, -0.6, -1.6, -0.8, 0.8][j],
                 hair_swing=[0, -2, -4, -5, -7, 6, 10, 3][j],
                 hem_dx=[0, 1, 2, 2, 3, -3, -5, -2][j],
                 leg_far=[(96, 4), (99, 6), (95, 2), (94, 3), (99, 6),
                          (101, 5), (104, 10), (95, 4)][j],
                 leg_near=[(84, -4), (80, -6), (-40, 120), (-34, 116),
                           (48, 30), (70, 4), (112, 62), (85, -4)][j],
                 foot_near=[0, 0, -30, -34, 14, 0, -34, 0][j],
                 foot_far=[0, 0, 0, -6, -12, -22, -34, 0][j],
                 ball=j <= 4)
        hf = [(-0.10, 0.56, 1), (-0.14, 0.32, 1), (-0.16, 0.38, 1),
              (0.86, 0.06, 1), (0.98, 0.02, 1), (-0.26, 0.78, 1),
              (-0.62, 0.72, 1), (-0.48, 0.46, 1)][j]
        q["hand_far"] = hf
        q["hand_near"] = [(0.14, 0.56, -1), (0.10, 0.30, -1), (0.06, 0.36, -1),
                          (0.36, 0.92, -1), (0.82, -0.74, 1), (1.14, -0.12, -1),
                          (0.16, 0.94, 1), (0.56, 0.72, -1)][j]
        if j in (4, 5, 6):
            a0 = [-118, -96, 24][j - 4]
            a1 = [-96, 40, 100][j - 4]
            q["smear"] = [("arm", a0, a1, 52, 84, 80 if j == 5 else 58)]
        if j in (5, 6):
            q["dust"] = [(18, -2, 8, 52), (34, -6, 5, 34)]
        return q

    if anim == "throw":
        # cock, reach, release, follow — four frames, so every one is a
        # keyframe and none of them is a tween
        j = min(i, 3)
        q = dict(lean=[-13, -20, 16, 23][j], squat=[6, 4, -2, 2][j],
                 dx=[6, 10, -10, -18][j], bob=[-1, -3, -2, 0][j],
                 head_dx=[-2, -4, 3, 6][j], head_dy=[1, -1, -1, 2][j],
                 stretch=[-0.025, 0.040, 0.050, -0.020][j],
                 sh_tilt=[-3, -5, 4, 5][j], hip_tilt=[1.5, 2.5, -2, -2.5][j],
                 face=["focus", "effort", "yell", "grin"][j],
                 look=[0.40, 0.30, 0.55, 0.60][j],
                 hat_rot=[-3, -5.5, 7, 9][j], hat_dy=[0.4, -0.8, -1.6, 0.6][j],
                 hair_swing=[-4, -7, 8, 11][j], hem_dx=[2, 3.5, -4, -6][j],
                 leg_far=[(99, 6), (102, 9), (94, 4), (86, 8)][j],
                 leg_near=[(78, -6), (70, -3), (80, -2), (86, 2)][j],
                 foot_far=[0, -8, -26, -42][j],
                 ball=j <= 1)
        hf = [(0.94, 0.10), (0.98, 0.04), (-0.34, 0.82), (-0.60, 0.72)][j]
        q["hand_far"] = (hf[0], hf[1], 1)
        hn = [(0.86, -0.48, 1), (0.80, -0.80, 1), (1.16, -0.06, -1),
              (0.12, 0.94, 1)][j]
        q["hand_near"] = hn
        if j >= 1:
            a0 = [-124, -100, 26][j - 1]
            a1 = [-100, 44, 104][j - 1]
            q["smear"] = [("arm", a0, a1, 52, 86, 62 if j != 2 else 90)]
        return q

    if anim == "catch":
        # reach on the toes, take the hit, hug it in. Three frames, so the
        # squash on the middle one is doing all the work.
        j = min(i, 2)
        return dict(hand_near=[(1.02, -0.62, -1), (0.76, -0.28, -1),
                               (0.40, 0.26, -1)][j],
                    hand_far=[(-0.76, -0.40, 1), (-0.62, -0.06, 1),
                              (-0.34, 0.46, 1)][j],
                    bob=[-9, 2, 0][j], squat=[-2, 9, 4][j],
                    stretch=[0.062, -0.105, 0.012][j],
                    lean=[-7, 2, 0][j], dx=[2, -1, 0][j],
                    face=["wide", "grit", "grin"][j],
                    look=[0.0, 0.05, 0.15][j], look_y=[-0.45, 0.10, 0.0][j],
                    hat_dy=[1.6, -4.2, 1.4][j], hat_rot=[-2, -8, -3][j],
                    hair_dy=[0.8, -2.4, 0.6][j], hair_swing=[-3, 7, 2][j],
                    sh_tilt=[-2, 2, 1][j], hip_tilt=[1, -1.5, 0][j],
                    leg_far=[(98, 3), (100, 12), (97, 6)][j],
                    leg_near=[(82, -3), (80, -10), (83, -5)][j],
                    foot_far=[-26, 8, -6][j], foot_near=[-22, 6, -4][j],
                    glove=True)

    if anim == "slide":
        j = min(i, 3)
        q = dict(dy=[-6, -18, -26, -28][j], dx=[4, -2, -10, -16][j],
                 lean=[-30, -46, -52, -48][j], squat=[24, 32, 34, 32][j],
                 stretch=[0.045, -0.030, 0.010, 0.0][j],
                 face=["grit", "grit", "grit", "grin"][j],
                 look=[0.45, 0.50, 0.40, 0.30][j], look_y=[-0.1, 0.0, 0.1, 0.1][j],
                 hand_near=[(1.00, 0.10, -1), (1.06, -0.14, -1),
                            (1.02, -0.30, -1), (0.98, -0.16, -1)][j],
                 hand_far=[(-0.40, 0.04, 1), (-0.62, -0.16, 1),
                           (-0.78, -0.06, 1), (-0.70, 0.12, 1)][j],
                 hat_rot=[-5, -11, -15, -13][j], hat_dy=[-1.5, -3.0, -3.4, -2.0][j],
                 hat_dx=[1.5, 3.0, 3.6, 3.0][j],
                 hair_swing=[6, 12, 15, 12][j], hem_dx=[3, 6, 8, 7][j],
                 sh_tilt=[-2, -3, -3, -2][j], hip_tilt=[2, 3, 3, 2][j],
                 head_dy=[4, 7, 8, 8][j],
                 leg_far=[(52, 26), (40, 56), (36, 62), (34, 58)][j],
                 leg_near=[(30, 12), (16, 8), (12, 6), (14, 10)][j],
                 foot_near=[-18, -26, -30, -28][j], foot_far=[-10, -18, -22, -20][j])
        q["dust"] = [[(6, 4, 10, 66), (24, 0, 7, 44)],
                     [(10, 8, 17, 96), (34, 2, 12, 72), (56, -4, 8, 44)],
                     [(14, 10, 21, 98), (44, 4, 16, 80), (74, -4, 11, 54),
                      (100, -10, 7, 30)],
                     [(18, 10, 20, 80), (52, 4, 15, 58), (86, -4, 10, 36)]][j]
        return q

    if anim == "celebrate":
        # crouch, launch, apex, land. It loops, so the landing squash rolls
        # straight into the next crouch and the hop never stops.
        j = min(i, 3)
        return dict(dy=[0, -12, -21, -2][j], squat=[16, -2, 0, 13][j],
                    bob=[2, -2, -4, 1][j],
                    stretch=[-0.080, 0.045, 0.025, -0.100][j],
                    hand_near=[(0.36, 0.96, -1), (1.06, -0.62, -1),
                               (1.16, -0.40, -1), (1.02, 0.16, -1)][j],
                    hand_far=[(-0.44, 0.92, 1), (-1.02, -0.58, 1),
                              (-1.14, -0.36, 1), (-0.98, 0.22, 1)][j],
                    face=["grin", "yell", "yell", "grin"][j],
                    look=[0.0, 0.0, 0.1, 0.0][j],
                    look_y=[0.15, -0.30, -0.35, 0.10][j],
                    hat_dy=[1.6, -4.0, -5.0, 3.2][j],
                    hat_rot=[2, -9, 7, 3][j], hat_dx=[0, 1.5, -2.0, 0.5][j],
                    hair_dy=[1.0, -3.0, -4.5, 1.6][j],
                    hair_swing=[-3, 9, -7, 4][j],
                    hem_dy=[1.5, -5.0, -7.0, 2.5][j], hem_dx=[0, 2, -2, 1][j],
                    sh_tilt=[1.5, -2.0, 2.0, 1.0][j],
                    hip_tilt=[-1.0, 1.5, -1.5, -1.0][j],
                    leg_far=[(106, 20), (98, 6), (46, 96), (104, 22)][j],
                    leg_near=[(76, -16), (84, -2), (62, 88), (78, -18)][j],
                    foot_far=[8, -34, -20, 10][j], foot_near=[6, -30, -16, 8][j],
                    dust=[[], [(-16, -2, 9, 62), (18, -2, 8, 54)], [],
                          [(-20, -1, 11, 74), (22, -1, 10, 66)]][j])

    if anim == "sulk":
        # two frames at 3fps: one long deflating sigh
        j = i % 2
        return dict(squat=[12, 22][j], lean=[7, 11][j], bob=[0, 4][j],
                    head_dy=[8, 16][j], stretch=[-0.010, -0.075][j],
                    face="frown", look=[-0.1, 0.05][j], look_y=[0.35, 0.45][j],
                    hand_near=[(0.34, 0.98, -1), (0.30, 1.02, -1)][j],
                    hand_far=[(-0.36, 0.96, 1), (-0.32, 1.00, 1)][j],
                    hat_rot=[3, 7][j], hat_dy=[0.0, 2.4][j],
                    hair_dy=[0.4, 1.8][j], hem_dx=[1.2, -1.8][j],
                    sh_tilt=[1.0, 3.5][j], hip_tilt=[-0.8, -2.2][j],
                    leg_far=[(93, 3), (94, 5)][j],
                    leg_near=[(87, -3), (86, -5)][j],
                    foot_near=[0, -22][j])

    return dict(face="calm")


# ---------------------------------------------------------------- npcs
COP = dict(body="L", skin="light", hair="brown", hat="none",
           shirt="navy", pants="navy", sock="charcoal", shoe="charcoal",
           cop=True)
ANNOUNCER = dict(body="M", skin="tan", hair="sandy", hat="flat",
                 shirt="oat", pants="chocolate", sock="dust", shoe="chocolate",
                 hatcol="grey", announcer=True)


def _head_at(cfg, pose):
    """Where draw_kid actually put the head this frame."""
    b = BODY[cfg["body"]]
    sc = b["scale"]
    hr = b["hr"] * sc
    hip_y = GROUND + pose.get("dy", 0.0) - 98 * sc + pose.get("squat", 0.0) \
        + pose.get("bob", 0.0)
    sh_y = hip_y - b["th"] * sc + pose.get("bob", 0.0) * 0.2
    head_cy = sh_y - hr * 0.72 + pose.get("head_dy", 0.0) \
        + pose.get("sh_tilt", 0.0) * 0.35
    lean_r = math.radians(pose.get("lean", 0.0))
    cx = c_w_half[0] + pose.get("dx", 0.0)
    head_cx = cx + math.sin(lean_r) * (sh_y - head_cy) * 0.9 + pose.get("head_dx", 0.0)
    return head_cx, head_cy, hr


c_w_half = [128.0]      # set per render so the helmet tracks the head


def draw_cop_extras(c, cfg, pose=None):
    """Custodian helmet, brass buttons, billy club — the beat cop."""
    pose = pose or {}
    cx, head_cy, hr = _head_at(cfg, pose)
    col = CLOTH["navy"]
    hy = head_cy - hr * 0.78 + pose.get("hat_dy", 0.0)
    # tall custodian helmet
    ipoly(c, [(cx - hr * 0.74, hy + hr * 0.42), (cx - hr * 0.56, hy - hr * 0.42),
              (cx, hy - hr * 0.64), (cx + hr * 0.56, hy - hr * 0.42),
              (cx + hr * 0.74, hy + hr * 0.42)], shade(col, 0.86), ink=4)
    c.circle(cx, hy - hr * 0.66, hr * 0.11, fill=A.GOLD)
    c.rrect([cx - hr * 0.86, hy + hr * 0.34, cx + hr * 0.86, hy + hr * 0.56],
            hr * 0.10, fill=INK)
    # badge
    c.circle(cx, hy - hr * 0.10, hr * 0.17, fill=A.GOLD, outline=INK, width=3)


def squash(c, st, dx=0.0):
    """Squash & stretch the whole kid about the spot his feet occupy.

    Doing it to the finished drawing instead of to every joint means the head,
    the cap and the bat all deform together — which is the entire point: a
    landing flattens the KID, not his torso.
    """
    ky = 1.0 + st
    kx = 1.0 - st * 0.52
    w, h = c.img.size
    small = c.img.resize((max(1, int(round(w * kx))), max(1, int(round(h * ky)))),
                         Image.LANCZOS)
    ax = (c.w / 2 + dx) * c.ss
    ay = GROUND * c.ss
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(small, (int(round(ax - ax * kx)), int(round(ay - ay * ky))))
    c.img = out
    c.d = ImageDraw.Draw(c.img)


def render(kid_id, cfg, anim, i, n):
    c = A.Canvas(ANIM_W.get(anim, 256), H, SS)
    pose = pose_for(anim, i, n, cfg)
    if cfg.get("announcer"):
        pose["arm_near"] = (-26, -30)
        pose.pop("hand_near", None)
        pose["face"] = "effort"
    c_w_half[0] = c.w / 2
    draw_kid(c, cfg, pose)
    if cfg.get("cop"):
        draw_cop_extras(c, cfg, pose)
    if cfg.get("announcer"):
        draw_megaphone(c, cfg, i, pose)
    if abs(pose.get("stretch", 0.0)) > 0.004:
        squash(c, pose["stretch"], pose.get("dx", 0.0))
    img = A.finish(c, ink=3.0, light=True, light_strength=0.34, rim=True)
    if cfg.get("lefty"):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img


def draw_megaphone(c, cfg, i, pose=None):
    cx, head_cy, hr = _head_at(cfg, pose or {})
    x0 = cx + hr * 0.70
    y0 = head_cy + hr * 0.30
    flare = 26 + i * 2
    ipoly(c, [(x0, y0 - 12), (x0, y0 + 12), (x0 + 62, y0 + flare),
              (x0 + 62, y0 - flare)], A.GOLD, ink=4)
    c.line([(x0 + 62, y0 - flare), (x0 + 62, y0 + flare)], shade(A.GOLD, 0.7), 4)


def build(outdir):
    import os
    os.makedirs(outdir, exist_ok=True)
    n_written = 0
    for kid_id, cfg in KIDS.items():
        for anim, n in ANIMS.items():
            if anim == "walk":
                continue          # kids never walk; that is the cop's cycle
            for i in range(n):
                img = render(kid_id, cfg, anim, i, n)
                img.save(f"{outdir}/chr_{kid_id}_{anim}_{i}.png")
                n_written += 1
    for kid_id, cfg in KIDS.items():
        for anim, n in BACK_ANIMS.items():
            for i in range(n):
                render(kid_id, cfg, anim, i, n).save(
                    f"{outdir}/chr_{kid_id}_{anim}_{i}.png")
                n_written += 1
    for i in range(ANIMS["walk"]):
        render("cop", COP, "walk", i, ANIMS["walk"]).save(f"{outdir}/npc_cop_walk_{i}.png")
        n_written += 1
    for i in range(2):
        render("announcer", ANNOUNCER, "idle", i, 2).save(
            f"{outdir}/npc_announcer_idle_{i}.png")
        n_written += 1
    return n_written


def portrait(kid_id, size):
    """Bust portrait for the trading cards — head and shoulders, facing front."""
    cfg = KIDS[kid_id]
    c = A.Canvas(256, H, SS)
    pose = dict(bob=-1.5, face="calm", look=0.08,
                arm_far=(98, 10), arm_near=(82, -10),
                leg_far=(93, 2), leg_near=(87, -2))
    pose["face"] = "grin" if kid_id in ("ezra", "nellie", "whistles", "sadie") else "calm"
    draw_kid(c, cfg, pose)
    img = A.finish(c, ink=3.0, light=True, light_strength=0.34, rim=True)
    b = BODY[cfg["body"]]
    hr = b["hr"] * b["scale"]
    head_cy = GROUND - 98 * b["scale"] - b["th"] * b["scale"] - hr * 0.72
    # extra headroom so a cap or bonnet is not clipped by the card's arch
    top = max(0, int(head_cy - hr * 2.35))
    bot = min(H, int(head_cy + hr * 2.05))
    crop = img.crop((int(img.width / 2 - (bot - top) / 2), top,
                     int(img.width / 2 + (bot - top) / 2), bot))
    return crop.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/art_chars"
    print("wrote", build(out), "->", out)

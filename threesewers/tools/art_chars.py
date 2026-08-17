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

from PIL import Image

import artkit as A
from artkit import CLOTH, HAIR, INK, SKIN, shade

SS = 3  # characters carry a lot of frames; 3x is plenty at this size

W, H = 384, 320          # authored size (2x the 192x160 world size);
                         # extra width is headroom for the swung bat
GROUND = 306.0           # every kid's feet land here so the gang shares a floor

ANIMS = {"idle": 4, "bat_stance": 2, "swing": 6, "run": 8, "pitch": 8,
         "throw": 4, "catch": 3, "slide": 4, "celebrate": 4, "sulk": 2,
         "walk": 4}

# The camera stands behind the batter, so the kid at the plate is drawn from
# the back: no face, the hair mass filling the skull, the cap seen from
# behind. Only the batter ever needs these.
BACK_ANIMS = {"bat_back": 2, "swing_back": 6}

# Frames are only as wide as the pose needs — the kid always stands at canvas
# centre, so Godot's centred sprite keeps the feet in the same world spot no
# matter which width an animation uses.
ANIM_W = {"swing": 384, "bat_stance": 320, "slide": 320, "pitch": 288,
          "swing_back": 384, "bat_back": 320,
          "throw": 288, "catch": 288, "celebrate": 288,
          "idle": 256, "run": 256, "walk": 256, "sulk": 256}

# ---------------------------------------------------------------- roster look
# body: S small / M medium / L large. hat: newsboy|flat|bonnet|cap|scarf|none
# extras drive the little storytelling details that sell each archetype.
KIDS = {
    "mabel": dict(body="M", skin="fair", hair="chestnut", hat="bonnet",
                  shirt="rose", pants="cream", sock="cream", shoe="chocolate",
                  dress=True, pinafore=True, longhair=True),
    "ezra": dict(body="S", skin="light", hair="brown", hat="newsboy",
                 shirt="dustblue", pants="charcoal", sock="oat", shoe="chocolate",
                 apron=True, apron_col="oat", satchel=True),
    "patsy": dict(body="S", skin="olive", hair="black", hat="flat",
                  shirt="clay", pants="chocolate", sock="dust", shoe="charcoal",
                  suspenders=True, rolled=True, smudge=True),
    "sadie": dict(body="S", skin="light", hair="auburn", hat="scarf",
                  shirt="sage", pants="clay", sock="cream", shoe="chocolate",
                  apron=True, apron_col="white", dress=True),
    "nellie": dict(body="M", skin="fair", hair="ginger", hat="none",
                   shirt="mustard", pants="steel", sock="oat", shoe="rust",
                   overalls=True, freckles=True, bandage=True, messy=True),
    "sal": dict(body="M", skin="olive", hair="black", hat="newsboy",
                shirt="moss", pants="charcoal", sock="oat", shoe="chocolate",
                suspenders=True, backwards=True),
    "gus": dict(body="L", skin="tan", hair="brown", hat="flat",
                shirt="rust", pants="olive", sock="dust", shoe="chocolate",
                apron=True, apron_col="oat", stocky=True),
    "vito": dict(body="L", skin="olive", hair="black", hat="none",
                 shirt="white", pants="rust", sock="oat", shoe="charcoal",
                 suspenders=True, sleeveless=True, stocky=True, messy=True),
    "pearl": dict(body="S", skin="light", hair="black", hat="none",
                  shirt="patina", pants="cream", sock="cream", shoe="chocolate",
                  braids=True, pinafore=True, dress=True),
    "tommy": dict(body="M", skin="light", hair="black", hat="cap",
                  shirt="steel", pants="navy", sock="oat", shoe="chocolate",
                  lefty=True),
    "corny": dict(body="M", skin="fair", hair="blond", hat="newsboy",
                  shirt="cream", pants="mustard", sock="white", shoe="chocolate",
                  vest=True, vest_col="ochre", bowtie=True, knickers=True),
    "whistles": dict(body="S", skin="brown", hair="black", hat="newsboy",
                     shirt="grey", pants="charcoal", sock="oat", shoe="chocolate",
                     bighat=True, whistle=True, suspenders=True),
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


# ---------------------------------------------------------------- the face
def draw_face(c, cx, cy, r, cfg, emo, look=0.0):
    """Eyes, brows, mouth. This is where the kid gets a personality."""
    skin = SKIN[cfg["skin"]]
    ink = INK
    ex = r * 0.40
    ey = cy + r * 0.10
    er = r * 0.235                      # eye radius — big, Backyard-style
    lx = cx - ex + look * r * 0.09
    rx = cx + ex + look * r * 0.09

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

    for side, x in ((-1, lx), (1, rx)):
        h = er * wide * (1.0 - squint)
        # sclera
        c.ellipse([x - er * 0.92, ey - h, x + er * 0.92, ey + h], fill=(250, 246, 236))
        c.d.ellipse([c._s(x - er * 0.92), c._s(ey - h), c._s(x + er * 0.92), c._s(ey + h)],
                    outline=ink, width=int(3.0 * c.ss))
        # iris + pupil, drifting with the look direction
        px = x + look * er * 0.42
        py = ey + er * 0.10
        pr = er * 0.52
        c.circle(px, py, pr, fill=shade(HAIR[cfg["hair"]], 0.7))
        c.circle(px, py, pr * 0.60, fill=(28, 22, 20))
        c.circle(px - pr * 0.34, py - pr * 0.34, pr * 0.30, fill=(255, 252, 245))

    # brows — the single strongest emotion signal
    bw = er * 1.5
    by = ey - er * (1.5 * wide)
    tilt = {"calm": 0.0, "focus": 0.30, "effort": 0.52, "grit": 0.58,
            "grin": -0.26, "frown": -0.46, "wide": -0.16}.get(emo, 0.0)
    lift = {"wide": -er * 0.30, "frown": er * 0.10}.get(emo, 0.0)
    for side, x in ((-1, lx), (1, rx)):
        y0 = by + lift + tilt * er * 0.62 * side * -1
        y1 = by + lift - tilt * er * 0.62 * side * -1
        c.capsule((x - bw * 0.5, y0), (x + bw * 0.5, y1), r * 0.10, r * 0.10,
                  shade(HAIR[cfg["hair"]], 0.85))

    # nose
    ny = cy + r * 0.40
    c.circle(cx + look * r * 0.06, ny, r * 0.075, fill=shade(skin, 0.84))

    # mouth
    my = cy + r * 0.60
    mw = r * 0.36
    if emo == "grin":
        c.chord([cx - mw, my - mw * 0.75, cx + mw, my + mw * 0.95], 0, 180,
                fill=(96, 52, 48), outline=ink, width=3)
        c.chord([cx - mw * 0.82, my - mw * 0.30, cx + mw * 0.82, my + mw * 0.30],
                180, 360, fill=(250, 246, 236))
    elif emo == "effort":
        c.ellipse([cx - mw * 0.62, my - mw * 0.42, cx + mw * 0.62, my + mw * 0.62],
                  fill=(96, 52, 48), outline=ink, width=3)
    elif emo == "wide":
        c.ellipse([cx - mw * 0.40, my - mw * 0.30, cx + mw * 0.40, my + mw * 0.55],
                  fill=(96, 52, 48), outline=ink, width=3)
    elif emo == "frown":
        c.arc([cx - mw, my + mw * 0.10, cx + mw, my + mw * 1.30], 200, 340, ink, 4)
    elif emo == "grit":
        c.rrect([cx - mw * 0.75, my - mw * 0.22, cx + mw * 0.75, my + mw * 0.30],
                mw * 0.12, fill=(250, 246, 236), outline=ink, width=3)
        c.line([(cx, my - mw * 0.22), (cx, my + mw * 0.30)], ink, 2.5)
    else:  # calm / focus — a small friendly curve
        c.arc([cx - mw * 0.85, my - mw * 0.75, cx + mw * 0.85, my + mw * 0.62],
              20, 160, ink, 4)

    if cfg.get("freckles"):
        fc = shade(skin, 0.80)
        for sx in (-1, 1):
            for i in range(3):
                c.circle(cx + sx * (r * 0.52 + i * r * 0.085),
                         ny + r * 0.02 + (i % 2) * r * 0.07, r * 0.030, fill=fc)
    # blush and grime are translucent, so they go on an overlay — drawing
    # them straight onto the art would punch holes in the face
    ov = c.overlay()
    if cfg.get("smudge"):
        ov.ellipse([cx + r * 0.34, cy + r * 0.30, cx + r * 0.66, cy + r * 0.46],
                   fill=(96, 84, 74, 150))
    for sx in (-1, 1):
        ov.ellipse([cx + sx * r * 0.60 - r * 0.16, cy + r * 0.33,
                    cx + sx * r * 0.60 + r * 0.16, cy + r * 0.49],
                   fill=(206, 138, 128, 92))
    c.merge(ov)


def draw_hair_back(c, cx, cy, r, cfg):
    """Hair mass behind the head (drawn before the face)."""
    hc = HAIR[cfg["hair"]]
    if cfg.get("longhair"):
        c.circle(cx, cy + r * 0.06, r * 1.02, fill=shade(hc, 0.9))
    if cfg.get("braids"):
        for sx in (-1, 1):
            p0 = (cx + sx * r * 0.92, cy + r * 0.10)
            p1 = (cx + sx * r * 1.12, cy + r * 0.92)
            icapsule(c, p0, p1, r * 0.26, r * 0.20, hc, ink=3.5)
            c.circle(p1[0], p1[1] + r * 0.06, r * 0.13, fill=CLOTH["rose"])


def draw_hair_front(c, cx, cy, r, cfg):
    hc = HAIR[cfg["hair"]]
    hat = cfg.get("hat", "none")
    if hat in ("newsboy", "flat", "cap", "bonnet"):
        # just a fringe under the brim
        c.chord([cx - r * 0.98, cy - r * 0.92, cx + r * 0.98, cy - r * 0.10],
                0, 180, fill=hc)
        return
    c.chord([cx - r * 1.0, cy - r * 1.02, cx + r * 1.0, cy + r * 0.10],
            180, 360, fill=hc)
    if cfg.get("messy"):
        for a, sz in ((-142, 0.40), (-96, 0.34), (-50, 0.38)):
            p = rot((cx, cy), a, r * 0.78)
            c.circle(p[0], p[1], r * sz, fill=hc)
        for a, sz in ((-142, 0.40), (-96, 0.34), (-50, 0.38)):
            p = rot((cx, cy), a, r * 0.78)
            c.circle(p[0] - r * sz * 0.22, p[1] - r * sz * 0.22, r * sz * 0.66,
                     fill=shade(hc, 1.10))
    else:
        c.chord([cx - r * 0.5, cy - r * 1.05, cx + r * 0.8, cy - r * 0.32],
                180, 360, fill=shade(hc, 1.12))


def draw_hair_back_of_head(c, cx, cy, r, cfg):
    """The whole skull covered in hair, seen from behind."""
    hc = HAIR[cfg["hair"]]
    c.circle(cx, cy - r * 0.06, r * 0.99, fill=hc)
    c.circle(cx - r * 0.22, cy - r * 0.30, r * 0.62, fill=shade(hc, 1.10))
    if cfg.get("messy"):
        for a, sz in ((-142, 0.40), (-96, 0.34), (-50, 0.38)):
            p = rot((cx, cy), a, r * 0.78)
            c.circle(p[0], p[1], r * sz, fill=hc)
    if cfg.get("braids"):
        for sx in (-1, 1):
            p0 = (cx + sx * r * 0.72, cy + r * 0.30)
            p1 = (cx + sx * r * 0.86, cy + r * 1.04)
            icapsule(c, p0, p1, r * 0.26, r * 0.20, hc, ink=3.5)
            c.circle(p1[0], p1[1] + r * 0.06, r * 0.13, fill=CLOTH["rose"])
    if cfg.get("longhair"):
        c.circle(cx, cy + r * 0.34, r * 0.94, fill=shade(hc, 0.94))


def draw_hat(c, cx, cy, r, cfg, tilt=0.0, back=False):
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
def draw_kid(c, cfg, pose):
    b = BODY[cfg["body"]]
    sc = b["scale"]
    hr = b["hr"] * sc
    tw = b["tw"] * sc
    th = b["th"] * sc
    lw = b["lw"] * sc
    flip = 1

    bob = pose.get("bob", 0.0)
    squat = pose.get("squat", 0.0)
    lean = pose.get("lean", 0.0)
    cx = c.w / 2 + pose.get("dx", 0.0)
    feet_y = GROUND + pose.get("dy", 0.0)

    hip_y = feet_y - 98 * sc + squat + bob
    sh_y = hip_y - th + bob * 0.2
    head_cy = sh_y - hr * 0.72 + pose.get("head_dy", 0.0)
    lean_r = math.radians(lean)
    head_cx = cx + math.sin(lean_r) * (sh_y - head_cy) * 0.9 + pose.get("head_dx", 0.0)

    skin = SKIN[cfg["skin"]]
    shirt = cloth(cfg["shirt"])
    pants = cloth(cfg["pants"])
    sock = cloth(cfg["sock"])
    shoe = cloth(cfg["shoe"])

    hip_l = (cx - tw * 0.26, hip_y)
    hip_r = (cx + tw * 0.26, hip_y)
    sh_l = (cx - tw * 0.46 + math.sin(lean_r) * th * 0.5, sh_y)
    sh_r = (cx + tw * 0.46 + math.sin(lean_r) * th * 0.5, sh_y)

    thigh = 50 * sc
    shin = 48 * sc
    upper = 42 * sc
    fore = 40 * sc

    # Joint angles are RELATIVE: the second value is the bend at knee/elbow
    # measured from the parent segment, so limbs articulate like limbs.
    def leg(hip, angs, near):
        hipa, bend = angs
        kp = rot(hip, hipa, thigh)
        fp = rot(kp, hipa + bend, shin)
        icapsule(c, hip, kp, lw * 1.18, lw * 1.02, pants, ink=4)
        # knee sock below the knickerbocker hem
        icapsule(c, kp, fp, lw * 0.92, lw * 0.78, sock, ink=4)
        if cfg.get("bandage") and near:
            c.capsule((kp[0] - lw * 0.46, kp[1] + lw * 0.1),
                      (kp[0] + lw * 0.46, kp[1] + lw * 0.1),
                      lw * 0.46, lw * 0.46, CLOTH["white"])
            c.line([(kp[0] - lw * 0.34, kp[1] - lw * 0.06),
                    (kp[0] + lw * 0.34, kp[1] + lw * 0.24)],
                   shade(CLOTH["white"], 0.78), 3)
        # shoe — a stubby boot pointing the way the kid faces
        heel = (fp[0] - flip * lw * 0.18, fp[1] + lw * 0.06)
        tip = (fp[0] + flip * lw * 0.92, fp[1] + lw * 0.16)
        icapsule(c, heel, tip, lw * 0.96, lw * 0.66, shoe, ink=4)
        return fp

    def arm(sh, angs, near):
        ua, bend = angs
        el = rot(sh, ua, upper)
        hd = rot(el, ua + bend, fore)
        if cfg.get("sleeveless"):
            icapsule(c, sh, el, lw * 1.02, lw * 0.88, skin, ink=4)
        else:
            cuff = 0.55 if cfg.get("rolled") else 1.0
            mid = (sh[0] + (el[0] - sh[0]) * cuff, sh[1] + (el[1] - sh[1]) * cuff)
            icapsule(c, sh, el, lw * 1.10, lw * 0.94, skin, ink=4)
            icapsule(c, sh, mid, lw * 1.12, lw * 0.98, shirt, ink=4)
        icapsule(c, el, hd, lw * 0.86, lw * 0.74, skin, ink=4)
        icircle(c, hd[0], hd[1], lw * 0.56, skin, ink=3.5)
        return hd

    far_arm = pose.get("arm_far", (100, 95))
    near_arm = pose.get("arm_near", (80, 85))
    far_leg = pose.get("leg_far", (95, 90))
    near_leg = pose.get("leg_near", (85, 90))

    # ---- far side first so overlaps read correctly
    arm(sh_l if flip > 0 else sh_r, far_arm, False)
    leg(hip_l if flip > 0 else hip_r, far_leg, False)
    leg(hip_r if flip > 0 else hip_l, near_leg, True)

    # ---- torso
    tx0, tx1 = cx - tw / 2, cx + tw / 2
    ty0, ty1 = sh_y - hr * 0.10, hip_y + 6
    lean_off = math.sin(lean_r) * th * 0.42
    if cfg.get("dress"):
        ipoly(c, [(tx0 + 6 + lean_off, ty0), (tx1 - 6 + lean_off, ty0),
                  (tx1 + tw * 0.30, ty1 + 26), (tx0 - tw * 0.30, ty1 + 26)],
              shirt, ink=4)
        if cfg.get("pinafore"):
            ipoly(c, [(cx - tw * 0.30 + lean_off, ty0 + 4),
                      (cx + tw * 0.30 + lean_off, ty0 + 4),
                      (cx + tw * 0.40, ty1 + 22), (cx - tw * 0.40, ty1 + 22)],
                  CLOTH["white"], ink=3)
    else:
        irrect(c, [tx0 + lean_off * 0.6, ty0, tx1 + lean_off * 0.6, ty1],
               tw * 0.24, shirt, ink=4)
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
                  (cx + tw * 0.34, ty1 + 14), (cx - tw * 0.34, ty1 + 14)],
              ac, ink=3.5)
        if cfg.get("satchel"):
            irrect(c, [cx + tw * 0.18, ty1 - 16, cx + tw * 0.62, ty1 + 14],
                   8, shade(cloth("chocolate"), 0.94), ink=3)
            c.capsule((cx - tw * 0.18, ty0 + 6), (cx + tw * 0.40, ty1 - 12),
                      lw * 0.28, lw * 0.28, shade(cloth("chocolate"), 0.78))
    if cfg.get("bowtie"):
        ipoly(c, [(cx - 16 + lean_off, ty0 + 2), (cx + lean_off, ty0 + 9),
                  (cx + 16 + lean_off, ty0 + 2), (cx + 16 + lean_off, ty0 + 18),
                  (cx + lean_off, ty0 + 11), (cx - 16 + lean_off, ty0 + 18)],
              CLOTH["rust"], ink=3)
    if cfg.get("whistle"):
        c.line([(cx - 12 + lean_off, ty0 + 4), (cx + 8 + lean_off, ty0 + 30)],
               INK, 3)
        icircle(c, cx + 9 + lean_off, ty0 + 33, 7, A.GOLD, ink=3, sphere=False)

    # collar
    c.capsule((cx - tw * 0.20 + lean_off, ty0 + 2), (cx + tw * 0.20 + lean_off, ty0 + 2),
              lw * 0.5, lw * 0.5, shade(shirt, 1.12))

    # ---- head
    icircle(c, head_cx, head_cy, hr * 0.30, skin, ink=4)     # neck nub
    draw_hair_back(c, head_cx, head_cy, hr, cfg)
    icircle(c, head_cx, head_cy, hr, skin, ink=4.5)
    # ears
    for sx in (-1, 1):
        icircle(c, head_cx + sx * hr * 0.96, head_cy + hr * 0.16, hr * 0.135,
                shade(skin, 0.92), ink=3)
    if pose.get("back", False):
        draw_hair_back_of_head(c, head_cx, head_cy, hr, cfg)
        draw_hat(c, head_cx, head_cy, hr, cfg, back=True)
    else:
        draw_hair_front(c, head_cx, head_cy, hr, cfg)
        draw_face(c, head_cx, head_cy, hr, cfg, pose.get("face", "calm"),
                  pose.get("look", 0.0) * flip)
        draw_hat(c, head_cx, head_cy, hr, cfg)

    # ---- near arm last (in front of the torso)
    hand = arm(sh_r if flip > 0 else sh_l, near_arm, True)

    # ---- held gear
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
def pose_for(anim, i, n, cfg):
    if anim in ("bat_back", "swing_back"):
        p = pose_for(anim.replace("_back", "").replace("bat", "bat_stance")
                     if anim == "bat_back" else "swing", i, n, cfg)
        p["back"] = True
        return p
    """Skeleton per frame. Cycles are built from sin/cos so motion reads."""
    p = i / max(1, n)
    tau = math.pi * 2
    lefty = cfg.get("lefty", False)

    if anim == "idle":
        s = math.sin(tau * p)
        return dict(bob=-2.0 * abs(s), face="calm", look=0.15 * s,
                    arm_far=(97, 6), arm_near=(83, -6),
                    leg_far=(93, 0), leg_near=(87, 0), head_dx=0.8 * s)

    if anim == "bat_stance":
        s = math.sin(math.pi * p)
        return dict(bob=-1.5 * s, squat=9, lean=-7, face="focus", look=-0.55,
                    arm_far=(-58, 48), arm_near=(-44, 42),
                    leg_far=(104, 12), leg_near=(74, -10),
                    bat=-62 - 4 * s)

    if anim == "swing":
        # load (0-1) -> contact (2-3) -> follow-through (4-5)
        k = i / (n - 1)
        ease = k * k * (3 - 2 * k)
        return dict(squat=8 - 3 * ease, lean=-12 + 30 * ease, dx=-26 * ease,
                    face="effort" if 0.15 < k < 0.85 else "focus",
                    look=-0.55 + k * 0.9,
                    arm_far=(-72 + 150 * ease, 46 - 34 * ease),
                    arm_near=(-56 + 144 * ease, 40 - 32 * ease),
                    leg_far=(104 - 10 * ease, 12), leg_near=(74 + 12 * ease, -8),
                    bat=-140 + 196 * ease, head_dx=-3 + 8 * ease)

    if anim == "run":
        a = tau * p
        s, cs = math.sin(a), math.cos(a)
        return dict(bob=-4.5 * abs(s) - 1.5, lean=13, face="focus", look=0.3,
                    arm_far=(86 + 30 * s, -46), arm_near=(86 - 30 * s, -46),
                    leg_far=(90 + 13 * s, 6 + 58 * max(0.0, s)),
                    leg_near=(90 - 13 * s, 6 + 58 * max(0.0, -s)),
                    head_dx=1.5 * cs)

    if anim == "walk":
        a = tau * p
        s = math.sin(a)
        return dict(bob=-2.0 * abs(s), lean=3, face="calm", look=0.25,
                    arm_far=(90 + 22 * s, -12), arm_near=(90 - 22 * s, -12),
                    leg_far=(90 + 10 * s, 4 + 30 * max(0.0, s)),
                    leg_near=(90 - 10 * s, 4 + 30 * max(0.0, -s)))

    if anim == "pitch":
        k = i / (n - 1)
        if k < 0.45:                      # windup: rock back, ball hand behind
            u = k / 0.45
            return dict(squat=7 * u, lean=-15 * u, face="focus", look=-0.4,
                        arm_far=(96 + 26 * u, -10 - 30 * u),
                        arm_near=(92 - 190 * u, -8 + 60 * u),
                        leg_far=(96, 4), leg_near=(84 - 44 * u, 20 + 40 * u),
                        ball=True, head_dx=-2 * u)
        u = (k - 0.45) / 0.55             # stride, release, follow-through
        e = u * u * (3 - 2 * u)
        return dict(squat=7 - 11 * e, lean=-15 + 42 * e,
                    face="effort" if u < 0.75 else "focus", look=0.4,
                    arm_far=(122 - 40 * e, -40 + 30 * e),
                    arm_near=(-98 + 190 * e, 52 - 50 * e),
                    leg_far=(96 + 12 * e, 4), leg_near=(40 + 50 * e, 60 - 54 * e),
                    ball=u < 0.5, head_dx=-2 + 8 * e)

    if anim == "throw":
        k = i / (n - 1)
        e = k * k * (3 - 2 * k)
        return dict(lean=-10 + 30 * e, face="effort", look=0.4, squat=5 - 7 * e,
                    arm_far=(112 - 26 * e, -16),
                    arm_near=(-96 + 190 * e, 50 - 46 * e),
                    leg_far=(98, 4), leg_near=(74 + 16 * e, -6),
                    ball=k < 0.5)

    if anim == "catch":
        k = i / (n - 1)
        return dict(bob=-7 * (1 - k), lean=-4 + 5 * k,
                    face="wide" if k < 0.6 else "grin", look=0.0,
                    arm_far=(-86 + 34 * k, 26), arm_near=(-64 + 22 * k, 20),
                    leg_far=(96, 4), leg_near=(84, -4), glove=True)

    if anim == "slide":
        k = i / (n - 1)
        return dict(dy=-14 - 14 * k, dx=-10 * k, lean=-44 - 12 * k, squat=30,
                    face="grit", look=0.45,
                    arm_far=(-40, 30), arm_near=(-14, 24),
                    leg_far=(34, 14), leg_near=(16, 8), head_dy=8)

    if anim == "celebrate":
        s = math.sin(math.pi * (i / max(1, n - 1)))
        return dict(dy=-18 * s, bob=-4 * s, face="grin", look=0.0,
                    arm_far=(-102 - 14 * s, -20), arm_near=(-78 + 14 * s, 20),
                    leg_far=(102 + 10 * s, 14 * s), leg_near=(78 - 10 * s, -12 * s))

    if anim == "sulk":
        s = math.sin(math.pi * p)
        return dict(bob=2 + 1.2 * s, squat=12, lean=6, head_dy=9 + 1.5 * s,
                    face="frown", look=0.0,
                    arm_far=(100, 10), arm_near=(86, -8),
                    leg_far=(92, 2), leg_near=(88, -2))

    return dict(face="calm")


# ---------------------------------------------------------------- npcs
COP = dict(body="L", skin="light", hair="brown", hat="none",
           shirt="navy", pants="navy", sock="charcoal", shoe="charcoal",
           cop=True)
ANNOUNCER = dict(body="M", skin="tan", hair="sandy", hat="flat",
                 shirt="oat", pants="chocolate", sock="dust", shoe="chocolate",
                 hatcol="grey", announcer=True)


def draw_cop_extras(c, cfg):
    """Custodian helmet, brass buttons, billy club — the beat cop."""
    b = BODY[cfg["body"]]
    hr = b["hr"] * b["scale"]
    cx = c.w / 2
    head_cy = GROUND - 98 * b["scale"] - b["th"] * b["scale"] - hr * 0.72
    col = CLOTH["navy"]
    hy = head_cy - hr * 0.86
    # tall custodian helmet
    ipoly(c, [(cx - hr * 0.74, hy + hr * 0.42), (cx - hr * 0.56, hy - hr * 0.52),
              (cx, hy - hr * 0.78), (cx + hr * 0.56, hy - hr * 0.52),
              (cx + hr * 0.74, hy + hr * 0.42)], shade(col, 0.86), ink=4)
    c.circle(cx, hy - hr * 0.80, hr * 0.13, fill=A.GOLD)
    c.rrect([cx - hr * 0.86, hy + hr * 0.34, cx + hr * 0.86, hy + hr * 0.56],
            hr * 0.10, fill=INK)
    # badge
    c.circle(cx, hy - hr * 0.10, hr * 0.17, fill=A.GOLD, outline=INK, width=3)


def render(kid_id, cfg, anim, i, n):
    c = A.Canvas(ANIM_W.get(anim, 256), H, SS)
    pose = pose_for(anim, i, n, cfg)
    if cfg.get("announcer"):
        pose["arm_near"] = (-26, -30)
        pose["face"] = "effort"
    draw_kid(c, cfg, pose)
    if cfg.get("cop"):
        draw_cop_extras(c, cfg)
    if cfg.get("announcer"):
        draw_megaphone(c, cfg, i)
    img = A.finish(c, ink=3.0, light=True, light_strength=0.34, rim=True)
    if cfg.get("lefty"):
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    return img


def draw_megaphone(c, cfg, i):
    b = BODY[cfg["body"]]
    sc = b["scale"]
    hr = b["hr"] * sc
    cx = c.w / 2
    head_cy = GROUND - 98 * sc - b["th"] * sc - hr * 0.72
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
    pose = pose_for("idle", 0, 4, cfg)
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

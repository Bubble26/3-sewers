#!/usr/bin/env python3
"""THREE SEWERS — the street, baked in perspective.

A tiny software rasteriser: the ground plane and the two tenement walls are
texture-mapped through perspective.View, so the cobbles and brick converge on
the same vanishing point the live sprites are projected to. Then the fixed
scenery — windows, fire escapes, lamps, stoops, the crowd on the kerb — is
composited at its projected position and depth scale.

Night by default: this is a gaslit block, so the plate is lit, the lamps throw
pools, and everything else falls away into blue-black.
"""
import math
import os
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

import artkit as A
import perspective as P
from artkit import shade

# world layout (mirrors Tuning)
WALL_L = 235.0
WALL_R = 1045.0
WALK = 62.0                       # sidewalk width
GROUND_L = WALL_L - WALK
GROUND_R = WALL_R + WALK
WALL_H = 3200.0                   # tenements tower off the top of the frame
SEWERS_Y = [1650.0, 1250.0, 850.0]

# night palette — deeper and cooler than the daytime stock
SKY_TOP = (20, 17, 20)
SKY_HORIZON = (72, 62, 58)
STONE = (96, 80, 62)
STONE_D = (40, 40, 45)
WALK_C = (104, 92, 78)
BRICK_N = (78, 56, 44)
BRICK_ND = (44, 34, 31)
LAMP = (255, 208, 138)

COBBLE_TEXEL = 6.5                # texels per world unit — finer, dirtier
WALK_TEXEL = 3.0
BRICK_TEXEL = 4.0


def _tex(path, fallback):
    if os.path.exists(path):
        return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    a = np.zeros((8, 8, 3), dtype=np.float32)
    a[:, :] = fallback
    return a


def _sample(tex, u, v):
    """Nearest-neighbour tile lookup; u, v are in texture pixels."""
    h, w = tex.shape[0], tex.shape[1]
    iu = np.mod(u.astype(np.int64), w)
    iv = np.mod(v.astype(np.int64), h)
    return tex[iv, iu]


def rasterise(view, props_dir, rs=2):
    """Sky + ground + walls, perspective-correct, as a float RGB array."""
    W = int(view.dw * rs)
    H = int(view.dh * rs)
    px = (np.arange(W, dtype=np.float32) + 0.5) / rs
    py = (np.arange(H, dtype=np.float32) + 0.5) / rs
    X, Y = np.meshgrid(px, py)

    img = np.zeros((H, W, 3), dtype=np.float32)

    # ---- sky: vertical gradient down to the horizon
    t = np.clip(Y / max(view.horizon, 1.0), 0.0, 1.0)[..., None]
    img[:] = np.array(SKY_TOP, np.float32) * (1 - t) + \
        np.array(SKY_HORIZON, np.float32) * t

    cob = _tex(os.path.join(props_dir, "prp_cobble_tile.png"), STONE)
    walk = _tex(os.path.join(props_dir, "prp_sidewalk_tile.png"), WALK_C)
    brick = _tex(os.path.join(props_dir, "prp_brick_tile.png"), BRICK_N)

    # ---- ground plane: depth comes from the screen row
    span = view.near_bottom - view.horizon
    s_g = (Y - view.horizon) / span
    ground_ok = s_g > 1e-3
    s_safe = np.where(ground_ok, s_g, 1.0)
    wx = P.PLATE_X + (X - view.dw * 0.5) / (s_safe * view.xk)
    u_depth = (1.0 / np.clip(s_safe, 1e-3, None) - 1.0) / (view.z_far - 1.0)
    wy = view.near_y - u_depth * (view.near_y - P.STREET_TOP)

    on_street = ground_ok & (wx > GROUND_L) & (wx < GROUND_R) & (u_depth < 1.02)
    on_walk = on_street & ((wx < WALL_L) | (wx > WALL_R))

    # Texture frequency, in texels per world unit. Tuned by eye at the near
    # plane: too low and the setts read as boulders under your feet, too high
    # and they turn to gravel at the far end.
    # A looming foreground batter and a tiny far end cannot both come from
    # one honest pinhole camera — the reference illustration cheats, so this
    # does too. Depth is textured on a log ramp chosen so a texel is the same
    # size across and down the screen at every distance; setts stay round
    # instead of smearing into streaks at your feet.
    ramp = np.log(np.clip(s_safe, 1e-4, None))
    v_ground = ramp * (COBBLE_TEXEL * span / view.xk)
    v_walk = ramp * (WALK_TEXEL * span / view.xk)
    cobble_rgb = _sample(cob, wx * COBBLE_TEXEL, v_ground)
    walk_rgb = _sample(walk, wx * WALK_TEXEL, v_walk)
    ground_rgb = np.where(on_walk[..., None], walk_rgb, cobble_rgb)
    img = np.where(on_street[..., None], ground_rgb, img)

    # ---- the two tenement walls: for a wall at constant world x, the screen
    # column alone fixes the depth
    for wall_x, side in ((WALL_L - WALK, -1), (WALL_R + WALK, 1)):
        denom = (wall_x - P.PLATE_X) * view.xk
        s_w = (X - view.dw * 0.5) / denom
        valid = (s_w > 1e-3) & (s_w <= 1.35)
        s_wc = np.where(valid, s_w, 1.0)
        sy_ground = view.horizon + span * s_wc
        height = (sy_ground - Y) / (s_wc * view.xk)
        on_wall = valid & (height > 0.0) & (height < WALL_H)
        # depth along the wall
        u_w = (1.0 / np.clip(s_wc, 1e-3, None) - 1.0) / (view.z_far - 1.0)
        wy_w = view.near_y - u_w * (view.near_y - P.STREET_TOP)
        on_wall &= (u_w < 1.02)
        u_wall = np.log(np.clip(s_wc, 1e-4, None)) * (BRICK_TEXEL * span / view.xk)
        brick_rgb = _sample(brick, u_wall, (WALL_H - height) * BRICK_TEXEL)
        # far end of the block sinks into haze
        fade = np.clip(1.0 - u_w * 0.55, 0.35, 1.0)[..., None]
        img = np.where(on_wall[..., None], brick_rgb * fade, img)

    # ground haze with distance too
    fade_g = np.clip(1.0 - u_depth * 0.5, 0.35, 1.0)[..., None]
    img = np.where(on_street[..., None], img * fade_g, img)

    return np.clip(img, 0, 255)


def _night_grade(img_f, view, rs):
    """Sink the street into blue-black, then add gaslight back."""
    W, H = img_f.shape[1], img_f.shape[0]
    tint = np.array([0.60, 0.50, 0.38], np.float32)
    out = img_f * tint
    # warm pools, added in linear-ish space
    glow = np.zeros_like(out)
    xs = np.arange(W, dtype=np.float32)[None, :]
    ys = np.arange(H, dtype=np.float32)[:, None]

    def pool(world_x, world_y, radius_world, strength):
        sx, sy, s = view.project(world_x, world_y, 0.0)
        cx, cy = sx * rs, sy * rs
        r = max(radius_world * s * view.xk * rs, 8.0)
        d = np.sqrt((xs - cx) ** 2 + ((ys - cy) * 1.7) ** 2) / r
        f = np.clip(1.0 - d, 0.0, 1.0) ** 2.1
        glow[..., 0] += f * LAMP[0] * strength
        glow[..., 1] += f * LAMP[1] * strength
        glow[..., 2] += f * LAMP[2] * strength

    pool(P.PLATE_X, 2330.0, 560.0, 0.62)      # the plate, so play stays legible
    pool(P.PLATE_X, 1900.0, 520.0, 0.34)
    pool(WALL_L - WALK * 0.5, 1180.0, 300.0, 0.60)
    pool(WALL_R + WALK * 0.5, 1980.0, 300.0, 0.60)
    pool(WALL_L - WALK * 0.4, 2450.0, 240.0, 0.40)
    pool(WALL_R + WALK * 0.4, 2450.0, 240.0, 0.40)
    out = out + glow * 0.85
    return np.clip(out, 0, 255)


def _vignette(img, strength=0.72):
    w, h = img.size
    v = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(v)
    d.ellipse([-w * 0.30, -h * 0.22, w * 1.30, h * 1.22], fill=255)
    v = v.filter(ImageFilter.GaussianBlur(min(w, h) * 0.13))
    dark = Image.new("RGBA", (w, h), (12, 9, 8, 255))
    dark.putalpha(v.point(lambda p: int((255 - p) * strength)))
    out = img.convert("RGBA")
    out.alpha_composite(dark)
    return out


def _paste(base, sprite, sx, sy, scale, anchor="bottom"):
    if scale <= 0.002:
        return
    w = max(1, int(sprite.width * scale))
    h = max(1, int(sprite.height * scale))
    if w < 2 or h < 2 or w > 6000 or h > 6000:
        return
    s = sprite.resize((w, h), Image.LANCZOS)
    x = int(sx - w / 2)
    y = int(sy - h) if anchor == "bottom" else int(sy - h / 2)
    base.alpha_composite(s, (max(-w, x), max(-h, y)))


def _load_prop(props_dir, name):
    p = os.path.join(props_dir, "prp_%s.png" % name)
    if not os.path.exists(p):
        return None
    return Image.open(p).convert("RGBA")


def _far_building(img, view, rs, rnd):
    """A lit tenement across the far end, seen straight on and hazed by
    distance. It gives the canyon a back wall and a warm focal point."""
    _, sy_far, s_far = view.project(P.PLATE_X, P.STREET_TOP, 0.0)
    half = (GROUND_R - GROUND_L) * 0.5 * s_far * view.xk * rs * 1.45
    cx = view.dw * 0.5 * rs
    base_y = sy_far * rs + 2
    top_y = base_y - half * 2.6
    d = ImageDraw.Draw(img)
    body = (56, 45, 38, 255)
    d.rectangle([cx - half, top_y, cx + half, base_y], fill=body)
    d.rectangle([cx - half, top_y, cx + half, top_y + half * 0.10],
                fill=(42, 34, 28, 255))          # cornice
    cols = 5
    rows = 7
    for r in range(rows):
        for cnum in range(cols):
            wx0 = cx - half * 0.80 + (half * 1.60) * (cnum + 0.5) / cols
            wy0 = top_y + half * 0.26 + (base_y - top_y - half * 0.34) * (r + 0.4) / rows
            ww = half * 0.10
            wh = ww * 1.5
            lit = rnd.random() < 0.42
            col = (250, 206, 138, 255) if lit else (32, 26, 23, 255)
            d.rectangle([wx0 - ww, wy0 - wh, wx0 + ww, wy0 + wh], fill=col)
    # haze it back so it reads as distance, not a wall in your face
    haze = Image.new("RGBA", img.size, (0, 0, 0, 0))
    hd = ImageDraw.Draw(haze)
    hd.rectangle([cx - half, top_y, cx + half, base_y],
                 fill=(64, 52, 44, 130))
    img.alpha_composite(haze)


def build_backdrop(view, props_dir, chars_dir=None, rs=2, seed=3):
    rnd = random.Random(seed)
    arr = rasterise(view, props_dir, rs)
    arr = _night_grade(arr, view, rs)
    img = Image.fromarray(arr.astype(np.uint8), "RGB").convert("RGBA")

    # art is authored at 2x world size; a projected sprite scales by s * ART
    ART = 0.5

    def put(name, world_x, world_y, height=0.0, mul=1.0, anchor="bottom",
            tint=None, flat=False):
        spr = _load_prop(props_dir, name)
        if spr is None:
            return
        sx, sy, s = view.project(world_x, world_y, height)
        if tint is not None:
            spr = Image.blend(spr, Image.new("RGBA", spr.size, tint), 0.55)
        if flat:
            # lying on the cobbles, so it is squashed by the grazing angle
            spr = spr.resize((spr.width, max(2, int(spr.height * 0.52))),
                             Image.LANCZOS)
        _paste(img, spr, sx * rs, sy * rs, s * view.xk * ART * mul * rs, anchor)

    night = (52, 42, 38, 255)

    # --- the block that closes the far end of the street. Without it the
    # vanishing point is a bright wedge of sky and the canyon has no end.
    _far_building(img, view, rs, rnd)

    # --- fixed scenery down both walls, far to near so nearer things overlap
    for wy in (2500.0, 2150.0, 1800.0, 1500.0, 1250.0, 1050.0, 900.0):
        for wx in (WALL_L - WALK, WALL_R + WALK):
            lit = rnd.random() < 0.3
            spr = _load_prop(props_dir, "window")
            if spr is None:
                continue
            sx, sy, s = view.project(wx, wy, 470.0)
            if lit:
                spr = Image.blend(spr, Image.new("RGBA", spr.size,
                                                 (255, 206, 140, 255)), 0.55)
            else:
                spr = Image.blend(spr, Image.new("RGBA", spr.size, night), 0.62)
            _paste(img, spr, sx * rs, sy * rs, s * view.xk * ART * rs, "center")
            sx, sy, s = view.project(wx, wy, 760.0)
            spr2 = Image.blend(_load_prop(props_dir, "window"),
                               Image.new("RGBA", spr.size, night), 0.7)
            _paste(img, spr2, sx * rs, sy * rs, s * view.xk * ART * rs, "center")

    # home, and the sewer covers the whole game is counted in
    put("manhole", P.PLATE_X, 2350.0, 0.0, 1.15, "center", flat=True)
    for i, sy_w in enumerate(SEWERS_Y):
        put("sewer", P.PLATE_X, sy_w, 0.0, 1.0, "center", flat=True)
        sxx, syy, ss = view.project(P.PLATE_X + 330.0, sy_w, 0.0)
        fnt = A.font("serif_bold", max(8, int(80 * ss * view.xk * rs)))
        ImageDraw.Draw(img).text((sxx * rs, syy * rs), str(i + 1), font=fnt,
                                 fill=(228, 222, 200, 150), anchor="mm")
    put("fire_escape", WALL_L - WALK, 1430.0, 620.0, tint=night)
    put("fire_escape", WALL_R + WALK, 1430.0, 620.0, tint=night)
    put("awning", WALL_R + WALK, 2300.0, 300.0, tint=(40, 44, 70, 255))
    put("model_t", 930.0, 1560.0)
    put("lamp", WALL_L - WALK * 0.5, 1180.0)
    put("lamp", WALL_R + WALK * 0.5, 1980.0)
    put("trash", WALL_L - WALK * 0.6, 2020.0)
    put("crate", WALL_R + WALK * 0.7, 1620.0)
    put("hydrant", 350.0, 2140.0)
    put("stoop", 930.0, 2140.0)
    put("gutter_grate", WALL_R + WALK * 0.5, 2300.0, 0.0, 1.0, "center")

    # --- the block turns out to watch, perched along both kerbs
    if chars_dir and os.path.isdir(chars_dir):
        ids = ["ezra", "patsy", "sadie", "pearl", "whistles", "corny",
               "tommy", "gus", "nellie", "sal"]
        spots = [(WALL_L - WALK * 0.55, 2280.0), (WALL_L - WALK * 0.72, 2010.0),
                 (WALL_L - WALK * 0.50, 1720.0), (WALL_L - WALK * 0.66, 1430.0),
                 (WALL_R + WALK * 0.58, 2360.0), (WALL_R + WALK * 0.74, 2060.0),
                 (WALL_R + WALK * 0.52, 1760.0), (WALL_R + WALK * 0.68, 1480.0),
                 (WALL_L - WALK * 0.60, 1200.0), (WALL_R + WALK * 0.60, 1240.0)]
        for i, (wx, wy) in enumerate(spots):
            f = os.path.join(chars_dir, "chr_%s_idle_%d.png" % (ids[i % len(ids)],
                                                               i % 4))
            if not os.path.exists(f):
                continue
            spr = Image.open(f).convert("RGBA")
            spr = Image.blend(spr, Image.new("RGBA", spr.size, night), 0.42)
            sx, sy, s = view.project(wx, wy, 0.0)
            _paste(img, spr, sx * rs, sy * rs, s * view.xk * ART * rs, "bottom")

    # --- laundry strung between the buildings, overhead and in perspective
    for wy, sag in ((1980.0, 130.0), (1560.0, 110.0), (1180.0, 90.0)):
        pts = []
        for k in range(21):
            t = k / 20.0
            wx = (WALL_L - WALK) + ((WALL_R + WALK) - (WALL_L - WALK)) * t
            hgt = 900.0 - sag * math.sin(math.pi * t)
            sx, sy, s = view.project(wx, wy, hgt)
            pts.append((sx * rs, sy * rs))
        ImageDraw.Draw(img).line(pts, fill=(18, 20, 28, 220),
                                 width=max(1, int(2 * rs * view.s_of_y(wy))))
        for k in (3, 7, 11, 15):
            t = k / 20.0
            wx = (WALL_L - WALK) + ((WALL_R + WALK) - (WALL_L - WALK)) * t
            hgt = 900.0 - sag * math.sin(math.pi * t)
            g = ["shirt", "union", "dress"][k % 3]
            put(g, wx, wy, hgt, 1.0, "center", night)

    img = _vignette(img)
    return img.convert("RGB")


def build(outdir, props_dir=None, chars_dir=None, rs=2):
    os.makedirs(outdir, exist_ok=True)
    root = os.path.dirname(os.path.abspath(outdir))
    props_dir = props_dir or os.path.join(root, "props")
    chars_dir = chars_dir or os.path.join(root, "characters")
    n = 0
    for key, view in P.VIEWS.items():
        img = build_backdrop(view, props_dir, chars_dir, rs)
        img.save(os.path.join(outdir, "bg_%s.png" % key))
        n += 1
    return n


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/art_backdrop"
    root = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "assets")
    print("wrote", build(out, os.path.join(root, "props"),
                         os.path.join(root, "characters")), "->", out)

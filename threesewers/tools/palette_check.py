#!/usr/bin/env python3
"""THREE SEWERS — art-direction lint.

House rule #2 says the spaldeen's pink is the only saturated thing in the
game. That rule is easy to break one asset at a time and impossible to see
until the screen looks noisy, so this measures it.

    python3 tools/palette_check.py

Reports mean chroma per asset (alpha-weighted, ignoring near-transparent
pixels) and fails if any non-ball asset gets close to the ball's chroma, or
if a large background asset is loud enough to compete with the kids.
"""
import glob
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BALL = "prp_spaldeen"
# Fractions of the ball's own chroma. HSV saturation is the wrong tool here —
# it calls every dark brown and every skin tone "saturated" because it is
# measured relative to brightness. CIELAB chroma is perceptual, so a warm
# skin tone lands where the eye puts it: quiet.
LOUD = 0.72           # ordinary props and kids
BACKDROP_LOUD = 0.52  # tiles and facades cover the whole screen; hold tighter
BACKDROP_HINT = ("tile", "facade", "skyline", "curb", "cornice", "sidewalk")
# Light is not pigment. These are additive glows and atmosphere — a warm lamp
# pool is *supposed* to be the warmest thing where it falls, and it tints the
# street rather than competing with the ball as an object.
EXEMPT = ("lightpool", "steam", "nightsky", "shadow", "bg_")

_SRGB = [((v / 255.0 + 0.055) / 1.055) ** 2.4 if v / 255.0 > 0.04045
         else (v / 255.0) / 12.92 for v in range(256)]


def _lab_chroma(r, g, b):
    """C* in CIELAB — distance from the neutral axis, as the eye sees it."""
    rl, gl, bl = _SRGB[r], _SRGB[g], _SRGB[b]
    x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047
    y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
    z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883
    f = lambda t: t ** (1.0 / 3.0) if t > 0.008856 else (7.787 * t + 16.0 / 116.0)
    fx, fy, fz = f(x), f(y), f(z)
    a_ = 500.0 * (fx - fy)
    b_ = 200.0 * (fy - fz)
    return (a_ * a_ + b_ * b_) ** 0.5


def chroma(path, sample=160):
    im = Image.open(path).convert("RGBA")
    if max(im.size) > sample:
        im.thumbnail((sample, sample), Image.LANCZOS)
    raw = im.tobytes()
    tot = 0.0
    wgt = 0.0
    for i in range(0, len(raw), 4):
        a = raw[i + 3]
        if a < 40:
            continue
        w = a / 255.0
        tot += _lab_chroma(raw[i], raw[i + 1], raw[i + 2]) * w
        wgt += w
    return (tot / wgt) if wgt else 0.0


def main():
    assets = os.path.join(ROOT, "assets")
    rows = []
    for path in sorted(glob.glob(os.path.join(assets, "**", "*.png"),
                                 recursive=True)):
        name = os.path.splitext(os.path.basename(path))[0]
        # character frames are many and consistent; sample the idle pose
        if name.startswith("chr_") and not name.endswith("_idle_0"):
            continue
        rows.append((name, chroma(path), path))

    ball = next((c for n, c, _ in rows if n == BALL), None)
    if ball is None:
        print("no spaldeen found — cannot judge the palette")
        return 1

    print("spaldeen chroma C*: %.1f  (everything else must sit below it)\n" % ball)
    bad = []
    for name, c, path in sorted(rows, key=lambda r: -r[1]):
        if name == BALL or any(e in name for e in EXEMPT):
            continue
        frac = BACKDROP_LOUD if any(h in name for h in BACKDROP_HINT) else LOUD
        limit = ball * frac
        flag = ""
        if c >= ball:
            flag = "LOUDER THAN THE BALL"
        elif c > limit:
            flag = "over limit %.1f (%.0f%% of ball)" % (limit, frac * 100)
        if flag:
            bad.append((name, c, flag))
        if c > ball * 0.34:
            print("  %-26s %5.1f  %s" % (name, c, flag))

    print()
    if bad:
        print("%d asset(s) break the one-saturated-colour rule:" % len(bad))
        for name, c, flag in bad:
            print("  %-26s %5.1f  %s" % (name, c, flag))
        return 1
    print("palette OK — the ball is the loudest thing on the block")
    return 0


if __name__ == "__main__":
    sys.exit(main())

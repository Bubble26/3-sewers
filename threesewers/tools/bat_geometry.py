#!/usr/bin/env python3
"""Measure where each kid's bat actually is, and write it out for the game.

The moment of contact only works if the ball arrives where the barrel is. That
is a fact about the ART, so it is measured from the rendered frames rather than
hardcoded in the view — some kids bat left-handed, and if the swing is redrawn
the numbers move. Re-run this whenever the character art is regenerated.

Writes data/bat_geometry.json:
  { "<kid>": {"frame": 3, "reach": 76.4, "height": 80.0} }
reach is signed world px from the kid's centre to the barrel's sweet spot
(+ = the bat sweeps to screen right), height is world px above the cobbles.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image

ART = 0.5          # art is authored at 2x world size
SWEET = 0.82       # the sweet spot sits this far out along the barrel

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _tip(path):
    """Far end of the bat in one frame, as (reach, height) in world px."""
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im)
    al = a[..., 3]
    H, W = al.shape
    ys, _ = np.nonzero(al > 40)
    if not len(ys):
        return None
    ground = ys.max()
    r, g, b = (a[..., i].astype(int) for i in range(3))
    # bare bat wood: warm, mid-value, never as blue as cloth or as pink as skin
    wood = (al > 200) & (r > 150) & (r - b > 55) & (g > 110) & (g < 200)
    wy, wx = np.nonzero(wood)
    if len(wx) < 30:
        return None
    # the barrel tip is the wood furthest from the body's centre line
    k = int(np.argmax((wx - W / 2.0) ** 2 + (wy - ground * 0.62) ** 2))
    return ((wx[k] - W / 2.0) * ART, (ground - wy[k]) * ART)


def measure(chars_dir):
    out = {}
    for f in sorted(glob.glob(os.path.join(chars_dir, "chr_*_swing_back_0.png"))):
        kid = os.path.basename(f)[4:-len("_swing_back_0.png")]
        best = None
        for i in range(16):
            p = os.path.join(chars_dir, "chr_%s_swing_back_%d.png" % (kid, i))
            if not os.path.exists(p):
                break
            t = _tip(p)
            if t is None:
                continue
            # contact is the frame where the bat is furthest out
            if best is None or abs(t[0]) > abs(best[1][0]):
                best = (i, t)
        if best is None:
            continue
        i, (reach, height) = best
        out[kid] = {"frame": i, "reach": round(reach * SWEET, 1),
                    "height": round(height, 1)}
    return out


def build(chars_dir=None, out_path=None):
    chars_dir = chars_dir or os.path.join(ROOT, "assets", "characters")
    out_path = out_path or os.path.join(ROOT, "data", "bat_geometry.json")
    data = measure(chars_dir)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as fh:
        json.dump(data, fh, indent=1, sort_keys=True)
    return data, out_path


if __name__ == "__main__":
    d, p = build(sys.argv[1] if len(sys.argv) > 1 else None)
    for k, v in sorted(d.items()):
        print("%-10s frame %d  reach %+7.1f  height %5.1f" % (k, v["frame"], v["reach"], v["height"]))
    print("\n%d kids -> %s" % (len(d), p))

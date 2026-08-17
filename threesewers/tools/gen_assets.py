#!/usr/bin/env python3
"""THREE SEWERS — regenerate every sprite in the game.

    python3 tools/gen_assets.py            # write into threesewers/assets
    python3 tools/gen_assets.py /tmp/out   # dry run somewhere else

All art is procedural and shares one style kernel (tools/artkit.py):
Backyard-Baseball construction drawn in a muted 1926 New York palette, with
the spaldeen's pink as the only saturated colour on screen.

  artkit.py     house rules: palette, ink, cel light, supersampled canvas
  art_chars.py  the twelve kids, the cop, the announcer (posed skeletons)
  art_props.py  street furniture, laundry, seamless brick/asphalt tiles
  art_world.py  facades, skyline, chalk scrawls — the street canyon
  art_night.py  cobbles, lamplight pools, night sky — the gaslit mood
  art_cards.py  candy-store trading cards + the app icon
  art_ui.py     title logotype, paper stock, rack header
  art_backdrop.py  the street baked in one-point perspective

Sprites are authored at 2x their world size (Tuning.ART = 0.5 scales them
back down in engine) so they stay crisp on a retina phone.
"""
import glob
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import art_backdrop
import art_cards
import art_chars
import art_night
import art_props
import art_ui

try:
    import art_world
except ImportError:      # optional: backdrop pieces
    art_world = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main(out_root=None):
    out_root = out_root or os.path.join(ROOT, "assets")
    chars = os.path.join(out_root, "characters")
    props = os.path.join(out_root, "props")
    icon = os.path.join(out_root, "icon")
    ui = os.path.join(out_root, "ui")
    bg = os.path.join(out_root, "bg")
    for d in (chars, props, icon, ui, bg):
        os.makedirs(d, exist_ok=True)

    def count(d):
        return len(glob.glob(os.path.join(d, "*.png")))

    # The modules report what they wrote in their own way (some a count, some
    # a list, some a dict), so the tally comes from the directory instead.
    t0 = time.time()
    print("props   ...", flush=True)
    art_props.build(props)
    art_night.build(props)
    if art_world is not None:
        print("world   ...", flush=True)
        art_world.build(props)
    print("ui      ...", flush=True)
    art_ui.build(ui)
    print("kids    ... (this is the slow one)", flush=True)
    art_chars.build(chars)
    print("cards   ...", flush=True)
    art_cards.build(chars, art_chars.portrait)
    print("street  ...", flush=True)
    art_backdrop.build(bg, props, chars)

    print("\n%d props, %d character frames + cards, %d ui, %d backdrops "
          "in %.0fs -> %s"
          % (count(props), count(chars), count(ui), count(bg),
             time.time() - t0, out_root))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)

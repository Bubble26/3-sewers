# THREE SEWERS — art pipeline

Every sprite is generated procedurally from `tools/`. Nothing is hand-painted,
so the whole game can be re-rendered at any resolution with one command:

```
python3 tools/gen_assets.py             # writes into assets/
python3 tools/gen_assets.py /tmp/out    # dry run elsewhere
python3 tools/palette_check.py          # art-direction lint
```

Needs Pillow (`pip install Pillow`). A full run takes ~10 minutes; the twelve
kids' 546 animation frames are nearly all of it.

## The look

Backyard Baseball construction — big heads, stubby tapered limbs, bold ink,
silhouettes that read at 40px — drawn in a muted 1926 New York register:
brownstone, asphalt, chalk, period cloth.

Five house rules live in `tools/artkit.py`, and every module obeys them:

1. **Supersample.** Draw at 3–4x, downsample LANCZOS. Raw PIL edges are what
   made the first pass look like programmer art.
2. **Ink everything.** The outline comes from dilating a sprite's own
   silhouette, so overlapping parts share one confident contour instead of a
   tangle of strokes. Parts also carry a thinner interior line — that weight
   hierarchy is what makes it read as drawn.
3. **Cel shade, one sun.** Upper-left, always: a hard shadow step and a warm
   rim. Rounded forms shade themselves (`sphere`, `form_rrect`) because a
   single global diagonal just slices a shape in half.
4. **One saturated colour.** The spaldeen's pink is the only high-chroma thing
   in the game. `palette_check.py` measures this in CIELAB chroma and fails the
   build if anything creeps up on the ball. (Don't use HSV saturation — it
   calls every dark brown and every skin tone "saturated".)
5. **Big heads, small hands.**

Beware: PIL's `ImageDraw` **replaces** pixels instead of blending, so any fill
with alpha punches a hole straight through the art. Draw translucent marks on
`Canvas.overlay()` and `merge()` them.

## Modules

| file | what it draws |
|---|---|
| `artkit.py` | the house rules: palette, canvas, ink, light, grain |
| `perspective.py` | the projection — **read this first** |
| `art_chars.py` | 12 kids + cop + announcer, 642 frames |
| `art_props.py` | street furniture, laundry, seamless tiles |
| `art_night.py` | cobbles, lamplight pools, night sky |
| `art_world.py` | facades, skyline, chalk scrawls |
| `art_backdrop.py` | the street, baked in perspective |
| `art_cards.py` | T206-style trading cards, app icon |
| `art_ui.py` | title logotype, paper stock, intertitle plate, scoreboard slate |

## The camera

The game is drawn in one-point perspective: the camera stands just behind the
batter and looks up the street, so the block recedes to a vanishing point and
everything scales with depth.

Gameplay still happens in the flat world coordinates `Tuning` defines and that
`match_core` was soak-tested against. The projection only decides where a world
point lands on screen:

```
u = 0 at the camera plane (VIEW_NEAR_Y), 1 at the far end
z = 1 + u * (z_far - 1)
s = 1 / z                     everything scales by this
sy = horizon + (near_bottom - horizon) * s
sx = centre + (world_x - 640) * s * xk
```

The maths lives twice — `tools/perspective.py` and `Tuning` — because the
backdrop is baked in Python and the sprites are projected in GDScript. **If you
change one, change the other**, or the painted street and the live kids will
disagree about where the vanishing point is.

Three things are worth knowing before you retune it:

- **How close the camera sits behind the batter decides everything.** The
  largest depth ratio a view can ever show is `1 / u(batter)`, so a camera
  parked at the far kerb can never make the foreground loom, no matter what you
  do to `z_far`. That is what `VIEW_NEAR_Y` is for.
- **A looming batter, a tiny far end and undistorted ground cannot all come
  from one honest pinhole camera.** The reference illustration cheats and so
  does this: the ground is textured on a log ramp (`v = k·ln(s)`) chosen so a
  texel stays the same size across and down the screen at every distance.
  Setts stay round instead of smearing into streaks at your feet.
- **The catcher is played but never drawn.** He crouches behind the camera; at
  his world position the projection blows him up to fill the frame.

Two presets ship, `PORTRAIT` and `LANDSCAPE`. The backdrop is baked for each,
and `match_view` picks one from the real screen shape and re-picks it when the
phone is turned over.

## Characters

Kids are posed skeletons, not fixed drawings. `KIDS` holds each kid's build,
skin, hair, hat and costume flags; `pose_for(anim, frame)` returns joint angles
and a facial expression; `draw_kid` renders them. Joint angles are **relative**
(the second value is the bend at knee/elbow), and screen-space degrees run
0 = right, 90 = down.

To restyle a kid, edit its `KIDS` entry. To change how a motion reads, edit
`pose_for` — the cycles are built from sin/cos so they stay smooth.

Two conventions the engine depends on:

- Feet sit on `GROUND` at the **bottom centre** of the canvas. `Kid._set_tex`
  in `match_view.gd` derives the sprite offset from texture height, so frames
  may differ in width (only the bat swing needs the wide canvas) without the
  kid drifting.
- Art is authored at **2x world size** for retina; `Tuning.ART = 0.5` scales it
  back in engine. A new prop must be drawn at twice its intended world size.

## Replacing this with hand-drawn art

Drop PNGs with the same names, sizes (2x world) and anchoring into
`assets/characters` and `assets/props`, and the game picks them up — nothing in
the engine knows the art is procedural. `Game.frames()` resolves
`chr_<id>_<anim>_<n>.png` with an `npc_` fallback.

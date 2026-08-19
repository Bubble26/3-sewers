# Porting the Three Sewers rules core

`docs/godot-reference/` holds files from a **separate, more mature stickball project** built in
Godot (repo `Bubble26/3-sewers`, branch `claude/match-view-presentation-4fxd34`). Its rules core
is finished and soak-tested. Ours is not written at all. We port theirs.

**Read `docs/godot-reference/match_core.gd` and `tuning.gd` before writing a line of gameplay.**

## Why this beats inventing our own

That project measured two things we would otherwise have had to discover the hard way, and the
comments in `tuning.gd` record both:

1. **A timing mechanic can be decorative and still feel fine to its author.** A simulated player
   who ignored the ball entirely and tapped a fixed 310ms after every bounce scored **56.6%**
   perfect contact against **71.5%** for reading the pitch properly. Reading the hop — the
   mechanic the game is named after — was buying 2.4 points of whiff rate. The cause: the three
   ideal press times spanned 100ms while the perfect-contact window was 108ms wide, so one blind
   rhythm sat inside all three.
2. **The fix is spacing, not difficulty.** The gaps are now 120ms and 160ms, both wider than the
   contact window, so no single fixed rhythm can be right about more than one pitch.

They also found a swing prompt that stayed lit for 660ms when only ±163ms of it could ever
connect — 51% of the window it invited you to swing in was a guaranteed whiff.

We inherit those findings for free. Do not re-derive them and do not "improve" the numbers
without re-running the measurement that produced them.

## What to port

| From | To | Notes |
|---|---|---|
| `match_core.gd` | `src/game/core.js` | The whole rules engine, faithfully. Pure logic, no rendering, no THREE import. |
| `tuning.gd` constants | `src/core/tuning.js` under `T.play` | Pitch times, bounce times, swing windows, ballistics. Keep their comments — the comments are the evidence. |
| `sim_test.gd` | `tools/soak.mjs` | 40 CPU-vs-CPU games, same seeds, must print the same shape of result. |
| `characters.json` quirks | `src/chars/roster.js` | We already have 16 kids; graft the *quirk mechanics* onto them, keep our names and writing. |
| `announcer.gd` banks | reference only | Our announcer is already written and is ours. Steal structure, not lines. |

## Acceptance — the port is done when

`node tools/soak.mjs` runs 40 games and reports, within tolerance of the Godot baselines:

* **no hangs** (their guard is 3000 pitches per game)
* **13.8 runs per game**, ±2.0
* **~3.6 home runs per game**, ±1.0
* **a smashed window roughly once per 13 games**, ±half

If our numbers differ materially, the port is wrong — not the baseline. Print all three and say
plainly how they compare.

## What NOT to port

* **Their renderer.** They are a 2D Godot game with a baked perspective projection
  (`Tuning.project()`); we are 3D characters on a 2D stage per `DESIGN-BIBLE §17`. Their
  `match_view.gd` is worth reading for staging ideas and worth nothing as code.
* **Their palette.** Ours is in `src/render/palette.js` with the contrast maths behind it.
  Note for interest that they arrived independently at nearly the same three colours — their
  pink `#e4626f`, ink `#2b1f17`, chalk `#fff7e4` against our `#F2828A`, `#2A1D1A`, `#F6F0E2` —
  which is reassurance that the readability call was right, not a reason to change ours.
* **Their roster.** Twelve kids to our sixteen, and ours are better written.
* **Their field layout.** Their coordinates are 2D world pixels on a portrait phone; ours is
  `src/game/layout.js` on a shallow stage. Port the *rules*, not the geometry.

## The mechanic we are missing entirely

Every pitch **bounces once** before the plate. That is real stickball, it is the heart of their
batting game, and we do not have it. `PITCH_TIMES`, `PITCH_TB` (time to bounce), `BOUNCE_REST`
and `SPIN_KICK` in `tuning.gd` are the tuned values, chosen so the three pitch types are
separable after the bounce — 0.76 ball diameters apart at 100ms, 0.98 at 133ms, which they
identify as the threshold where a difference becomes a tell rather than a rounding error.

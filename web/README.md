# THREE SEWERS — the browser game

A 1920s New York street-stickball game in Three.js, built to the standard of Humongous
Entertainment's *Backyard Baseball*. Runs in a browser; `dist/stickball.html` is the whole game
as one self-contained file.

This is the **second** implementation in this repository. `../threesewers/` is the Godot one,
and it got there first on the part that matters most: its rules core is finished and
soak-tested. Rather than invent our own, `src/game/core.js` is a port of
`../threesewers/scripts/match_core.gd`, validated against the same published baselines — see
`docs/PORT-SPEC.md`.

## Run it

    npm install
    node tools/serve.mjs 8123      # then open http://127.0.0.1:8123/
    node tools/bundle.mjs          # dist/stickball.html, one self-contained file

## The tools that make the build honest

Nothing here trusts a builder's description of its own work.

| Tool | What it proves |
|---|---|
| `tools/shoot.mjs` | Renders named deterministic scenarios in headless Chromium. Critics read the PNGs. |
| `tools/film.mjs` | Steps a scenario frame by frame into one numbered contact sheet, so motion can be judged. |
| `tools/measure.mjs` | Fails the build when a frame breaks the stage rules — kid too small, lens too wide or too long, no subject. |
| `tools/audition.mjs` | Renders audio cues offline through the game's own graph and measures attack, decay, crest, centroid, tempo. |
| `tools/soak.mjs` | 40 (and 400) CPU-vs-CPU games against the Godot project's published baselines. |
| `tools/playthrough.mjs` | Drives a whole game and dumps the event stream. |

## The documents that govern it

* `docs/DESIGN-BIBLE.md` — binding art, audio and comedy direction. §17 is the stage model:
  3D characters on a 2D stage, long lens, shallow play plane, the camera cuts and never flies.
* `docs/BYB-REFERENCE.md` — the Backyard Baseball bar, written as things you can check a frame against.
* `docs/PERIOD-REFERENCE.md` — 1925 New York with real dimensions.
* `docs/CONTRACT.md` — architecture, the `__SB` harness API, the hard rules.
* `docs/CRITIC-RUBRIC.md` — how work gets judged.
* `docs/PORT-SPEC.md` — what we took from the Godot build, and what we deliberately did not.

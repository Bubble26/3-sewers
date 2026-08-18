# Stickball — Build Contract (read this first, every agent, every wave)

**The game:** a 1920s New York City stickball game in Three.js, built to the standard of
Humongous Entertainment's *Backyard Baseball* (1997/2001): joyful, characterful, hand-made,
readable, funny, alive. Not a realistic sim. Not a tech demo.

## Ground truth: you look at pixels, never at prose

    node tools/shoot.mjs                    # all scenarios -> shots/*.png + shots/report.json
    node tools/shoot.mjs pitch contact      # a subset
    node tools/shoot.mjs --out shots/x --w 1600 --h 900

`tools/shoot.mjs` boots a real headless Chromium (SwiftShader WebGL2), loads the real game,
jumps to a deterministic scenario, and screenshots it. **Read the PNGs.** Any claim about how
the game looks that is not backed by a screenshot you personally captured is worthless.

Exit code 1 means the page threw. `shots/report.json` carries console errors — a build with
console errors is a failed build, no exceptions.

    node tools/bundle.mjs                   # dist/stickball.html, one self-contained file
    node tools/serve.mjs 8123               # dev server if you want to poke by hand

## Runtime contract — do not break these

* `globalThis.__SB` is the harness API. Never remove a key; only add.
  * `__SB.ready` — truthy once boot finished
  * `__SB.scenario(name)` — jump to a named deterministic setup, settle it, render
  * `__SB.listScenarios()` — every registered scenario name
  * `__SB.advance(seconds)` — deterministic fixed-timestep stepping (no wall clock)
  * `__SB.renderOnce()` — draw one frame
  * `__SB.errors` — array of runtime errors, must stay empty
  * `__SB.input(action)` — inject `'swing' | 'pitch' | 'run' | ...`
* `?harness=1` in the URL means: no rAF loop, no audio autoplay, no timing jitter.
  Everything must be reachable and renderable in that mode.
* Register new scenarios with `registerScenario(name, { seed, setup, settle })` from
  `src/core/scenarios.js`. Every visual feature you build needs a scenario that shows it off,
  or critics cannot judge it and it does not count as done.
* All randomness goes through `src/core/rng.js`. `Math.random()` in game code is a bug —
  it breaks determinism and therefore breaks the whole critique loop.
* All gameplay constants go in `src/core/tuning.js`.
* Gameplay emits on `src/core/bus.js`; audio / fx / ui listen. Rendering never drives rules.

## Hard technical rules

1. **No external network requests at runtime.** No CDNs, no remote fonts, no remote audio.
   Fonts must be embedded (base64 in CSS) or drawn procedurally. `dist/stickball.html` must
   run with the network unplugged, because it gets published as a sandboxed artifact.
2. **Three.js is imported as `'three'`** (importmap in dev, alias at bundle time). Never
   deep-import from `node_modules` or `vendor/` in `src/`.
3. **60 fps at 1600x900** on SwiftShader-class hardware is the target. Watch draw calls;
   instance repeated geometry (windows, bricks, crowd, particles).
4. **Zero console errors and zero console warnings** in `shots/report.json`.
5. **Own your files.** Each piece has a file list. Do not edit files another piece owns; if you
   need a change there, say so in your report instead of reaching in.
6. Assets are generated in code (procedural textures via canvas, geometry in code) unless a
   piece brief says otherwise. Keep the repo self-contained.
7. `node tools/bundle.mjs` must succeed after your change. `node tools/shoot.mjs` must exit 0.

## The bar

Every piece is judged blind against *Backyard Baseball* by a critic with fresh context who
looks only at rendered frames. See `docs/CRITIC-RUBRIC.md` and `docs/BYB-REFERENCE.md`.
"Functional" is not a passing grade. The question is always: **is this as joyful, as polished,
and as alive as Backyard Baseball?**

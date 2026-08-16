# THREE SEWERS — CONTINUE_BUILD.md (handoff to Claude Code)

You are continuing a partially built Godot 4.4 stickball game. The **rules core is complete and validated headless** (40-game soak: no hangs, 13.8 runs/game, ~3.6 HR/game, window-smash ~1 per 13 games — treat these as regression baselines). Your job is the presentation layer, then validation, then iOS export prep.

## Status

| File | State |
|---|---|
| project.godot, scenes/boot.tscn | ✅ done |
| data/characters.json (12-kid roster + quirks) | ✅ done |
| scripts/tuning.gd (all layout/feel constants) | ✅ done |
| scripts/game_state.gd (roster load, texture cache) | ✅ done |
| scripts/announcer.gd (megaphone patter banks) | ✅ done |
| scripts/match_core.gd (rules engine) | ✅ done + soak-tested |
| scripts/title_card.gd (iris/flicker/slam cards) | ✅ done |
| scripts/boot.gd (title + candy-store card select) | ✅ done |
| shaders/film.gdshader, iris.gdshader | ✅ done |
| assets/ (573 placeholder sprites, icon) | ✅ done (tools/gen_assets.py regenerates) |
| tests/sim_test.gd | ✅ done |
| **scripts/match_view.gd** | ❌ **BUILD THIS — full spec below** |
| iOS export | ❌ per IOS_TESTFLIGHT_RUNBOOK.md |

Validation commands (Godot 4.4.1 binary, run from repo parent or adjust --path):
```
godot --headless --path threesewers --import
godot --headless --path threesewers --script res://tests/sim_test.gd   # must print SIM OK
godot --headless --path threesewers -- --smoke                         # must print SMOKE_OK
```

---

## T1 — scripts/match_view.gd (the whole game presentation)

Root `Node2D`. Contract with boot.gd: **must declare `var autopilot := false`** (boot sets it before add_child; smoke mode passes true). Teams arrive via `Game.player_team` / `Game.cpu_team`. Player is HOME (bats bottom): `core.setup(Game.cpu_team, Game.player_team, Game.roster, 1, Tuning.INNINGS)`.

### Node layout (build all in code)
```
MatchView (Node2D)
├─ bg (Node2D)            # street, walls, chalk — non-sorted
├─ stage (Node2D, y_sort_enabled=true)  # kids, ball, ground props
├─ fx (Node2D)            # floating count labels, world-space text
├─ cam (Camera2D)         # zoom Tuning.CAM_ZOOM, enabled
├─ hud (CanvasLayer, layer 10)
├─ cards (TitleCards, layer 20)   # scripts/title_card.gd
└─ flicker (CanvasLayer, layer 30) # film.gdshader ColorRect, mouse_filter IGNORE
```

### World build (all coordinates in Tuning)
Street = big asphalt Polygon2D (x −200..1480, y 600..2600). Brick side walls beyond WALL_L/WALL_R with a few `prp_window` sprites; **one special window sprite at WINDOW_POS — keep the node ref, swap texture to `prp_window_broken` on the window HR**. `prp_fire_escape` at FE_L/FE_R. `prp_model_t` at CAR_POS. `prp_manhole` at PLATE (scale ~1.2), `prp_stoop` at BASE_1, chalk square via Line2D at BASE_2, `prp_hydrant` at BASE_3. Chalk foul lines: dashed Line2D segments from PLATE to (WALL_L, 2110) and (WALL_R, 2110). `prp_sewer` sprites at (640, y) for each Tuning.SEWERS_Y with chalk numeral Labels "1" "2" "3" beside them. `prp_lamp` a couple spots. Laundry Line2D sagging behind plate y≈2560 with `prp_shirt`/`prp_union`/`prp_dress` hanging. Everything muted; **the ball is the only saturated pink on screen**.

### Kid inner class
```gdscript
class Kid extends Node2D:
    # Sprite2D child, offset = Vector2(0, -80) so feet sit at node origin.
    # play(anim: String, fps := 8.0, loop := true) pulls textures via
    # Game.frames(kid_id, anim, ANIM_N[anim]); advance frames in _process.
const ANIM_N := {"idle":4,"bat_stance":2,"swing":6,"run":8,"pitch":8,
    "throw":4,"catch":3,"slide":4,"celebrate":4,"sulk":2}
```
Fielders scale 0.8 at Tuning.FIELD_POS (rebuild each half from `core.positions[core.fielding_side()]`). Batter node at (700, 2350), `bat_stance`. Runner nodes persist in `runner_nodes: Dictionary` keyed by kid id. `npc_cop` and `npc_announcer` load via the same frames() fallback.

### Ball (data-driven, no physics body)
Node2D in stage: pink `prp_spaldeen` sprite child at y = −h (scale ~1.4) + a flattened dark-modulated shadow sprite at origin. Node position = ground pos → y-sort correct. Modes advanced in `_process(delta)` with a local `t` accumulator (respects Engine.time_scale for smoke):

**Pitch timeline** (`_start_pitch(pitch, plan)`):
- Phase A: pitcher hand (FIELD_POS.P + (0,−40), h=70) → bounce point B over `ta = Tuning.PITCH_TIMES[type]`. B = (640 + lane*46, 2278). h = 70(1−u) + 26·sin(πu).
- Phase B: B → plate cross C over `tb = 0.22` (drop: 0.3). C = (640 + lane*55 + spin, PLATE.y), spin = ±Tuning.SPIN_KICK[type] (random sign, spinner only). h = Tuning.BOUNCE_REST[type]·70·sin(πu).
- `cross_t = ta + tb` from launch — **this is the timing truth**. After cross, ball continues 0.12s into catcher's mitt if no contact.

**Swing capture:** window = [cross_t − Tuning.SWING_EARLY, cross_t + Tuning.SWING_LATE]. Human batting: `_unhandled_input` press inside window records `err_ms = (t − cross_t)*1000`, plays batter `swing` immediately, sets committed. CPU batting: plan from `core.cpu_swing(pitch)`; if swing, auto-commit at `cross_t + err/1000`. At `t = cross_t + SWING_LATE`: call `core.resolve_swing(err)` if committed else `core.resolve_no_swing()`, then `emit pitch_resolved(ev)` and freeze ball.

**Hit timeline** (`_launch_hit(play)`): target = WINDOW_POS if `play.window`; else land = (640 + play.lane*300 ± rand20, PLATE.y − clamp(carry,0,1.45)*1400), x clamped inside walls (clamp = wall carom: reflect x, patter "flivver"/"off the bricks" if flagged). Peak h: fly 300, line 130, ground 45 (two decaying bounces). Duration: fly 0.85 + carry·0.5; line 0.5; ground 0.45 + roll. HR: after landing keep rolling up-street decelerating 0.8s. Emit `ball_done` at rest. While mode=="hit" and carry > 0.5: cam.position.y lerps toward ball y − 140, clamped [860, 2130]; **each time ball crosses a SEWERS_Y line spawn a floating fx Label — "ONE SEWER…", "TWO SEWERS…"** (rise + fade tween).

### Match flow (async `run_match()` called from _ready)
```
cards.flash("PLAY BALL!", "", 0.9); ticker(Announcer.line("pregame", batter_name))
while not core.game_over:
    _setup_sides_if_changed()
    var pitch := await _get_pitch()        # human fielding → pitch UI; else core.make_cpu_pitch()
    core.begin_pitch(pitch)
    _pitcher.play("pitch"); await 0.45s; _start_pitch(pitch, plan)
    var ev: Dictionary = await pitch_resolved
    await _choreo(ev)
    var hc := core.check_half()
    if hc.changed and not core.game_over: await _side_away(hc)
_finale()
```

**_choreo(ev)** by kind — every beat updates HUD + fires an Announcer ticker line:
- ball/strike/foul/whiff → small quick card only on foul ("FOUL!" 0.5s, no slam); catcher `catch`.
- strikeout → card "STRUCK OUT!", batter `sulk`, free batter node.
- walk → run batter to 1B, apply moves.
- in_play → `_launch_hit(play)`; after 0.15s start runner tweens from `play.moves` (from −1 = batter node; to 0/1/2 = base pos; to 3 = home → celebrate 0.5s then free; move.out → slide + free). Fielder for `play.fielder` tweens toward landing.
  - `needs_throw` != null → pause runners at 70%, show throw buttons (targets + 1.4s real-time TimerBar); await `throw_choice` or timeout → `core.resolve_throw(choice)` / `core.throw_timeout()` → fielder `throw`, ball quick-tween to base, card "OUT!" or "SAFE!".
  - result out_fly/out_line → fielder `catch` at landing, card "OUT!" (fly) / "SPEARED!" (line).
  - result hr → await ball_done, then `cards.flash("%d SEWER%s!" ...)` — **slam=true**; "THREE SEWERS!" gets subtext with batter name and Announcer "hr3". Window: swap window texture to broken FIRST, card "SMASH!" then slam "GO! GO! GO!", every on-field kid briefly scatter-dashes 30px, Announcer "window".
  - perfect-contact quality > 0.85 → quick "SOCK!" card at contact moment; RBI ≥ 1 on non-HR → "ATTA BOY!".
  - runs scored → scoreboard punch-scale tween.
- Camera returns to default (tween 0.5s) at end of every choreo.

**_side_away(hc):** card "SIDE AWAY", rebuild fielders/batter. If `hc.cheese`: card slam "CHEESE IT!!", Announcer "cheese", cop Kid walks across (WALL_L−120 → WALL_R+120 at y 1800, `walk`), all kids tween to nearest wall and back over `hc.cheese_len`, Announcer "cheese_end".

**_finale():** slam card "THAT'S THE BALL GAME" + `core.winner_text()` subtext (+ final_note), newspaper headline Label ("EXTRA! GANG TAKES IT %d–%d"), button "BACK TO THE BLOCK" → `get_tree().change_scene_to_file("res://scenes/boot.tscn")` (reset Engine.time_scale = 1.0). **If Game.smoke: `print("SMOKE_OK")` then `get_tree().quit(0)`.**

### HUD (CanvasLayer)
- Top-left brick scoreboard PanelContainer (StyleBoxFlat Tuning.BRICKC, chalk border): line 1 `VIS 2 — GANG 3` (chalk, 34px), line 2 `INN 1▼ · OUT ‖ · B2 S1` (outs as chalk tallies).
- Bottom announcer strip: paper panel, `npc_announcer_idle_0` TextureRect left, ticker Label typewriter (`visible_characters` tween).
- Center-bottom prompt VBox: (a) human pitching → "CALL IT" + lane toggles [INSIDE·MIDDLE·OUTSIDE] + type buttons [FAST·SPINNER·DROP] → timing bar (marker ping-pongs via clock; THROW! button captures `quality = 1 − |phase−0.5|·2`) → emit `ui_pitch(dict)`; (b) human batting → hint "TAP ANYWHERE TO SWING" during window; (c) throw prompt buttons.
- Autopilot replaces all three with core CPU calls (tiny awaits so smoke exercises the same paths).

### Signals to declare
`pitch_resolved(ev: Dictionary)`, `ball_done`, `throw_choice(c: String)`, `ui_pitch(p: Dictionary)`.

### Guardrails
- Typed GDScript; constants from Tuning only — no magic numbers.
- Everything must run headless (`--smoke`) with zero input.
- Do not modify match_core.gd resolution logic; if a choreo need arises, add view-side. Re-run sim_test after ANY core touch; scores should stay ~10–16 runs/game.
- 60fps target; textures load once via Game.frames cache.

## T2 — Validate
Run the three commands above until: import clean, `SIM OK`, `SMOKE_OK`. Then run windowed on desktop and play a full game: swing timing must feel readable off the bounce (adjust SWING_EARLY/LATE ±0.05 max).

## T3 — Ship prep
`export_presets.cfg` iOS preset (bundle id placeholder `com.CHANGEME.threesewers`), then follow IOS_TESTFLIGHT_RUNBOOK.md on the Mac. Landscape only; icon already at assets/icon/icon.png.

## Definition of done (vertical slice)
A full 3-inning game vs CPU on an iPhone via TestFlight: bounce-pitch batting and pitching both playable by touch, throw prompts on close grounders, sewer-count camera chase with card slam, window HR with scatter beat, at least one CHEESE IT! witnessed, chalk scoreboard correct, no soft-locks, 60fps.

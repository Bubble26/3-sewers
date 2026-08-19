# AUDIO HOOKS

Everything the game needs to make noise is built and registered. **No gameplay
file has been edited** — `match_view.gd`, `boot.gd` and `title_card.gd` were
owned by other agents while this was written, so this is the patch list for
whoever applies it.

Anchors below are **function names and quoted lines**, never line numbers:
all three files moved by hundreds of lines during this work.

---

## What shipped

| Path | What |
|---|---|
| `tools/gen_audio.py` | The synth. Kernel + every cue + QC + spectrogram plots. |
| `assets/audio/sfx/` | 60 mono one-shots, 16-bit / 44.1 kHz |
| `assets/audio/vox/` | 20 announcer patter takes, mono |
| `assets/audio/music/` | 5 stereo cues — 2 seamless loops, 3 stings |
| `scripts/audio.gd` | `Audio` autoload — pool, panning, variants, ducking |
| `default_bus_layout.tres` | Master · Music (−6) · SFX (−1) · Voice (−2) |
| `tests/audio_test.gd` | headless check → `AUDIO OK` |

Rebuild the audio: `python3 tools/gen_audio.py` (then `godot --headless
--path . --import`). Inspect it: `python3 tools/gen_audio.py --qc`.

## The API

```gdscript
Audio.sfx("bat_crack")                     # one-shot, centred
Audio.sfx_at("ball_bounce", 0.4)           # pan -1 (left kerb) .. +1 (right)
Audio.sfx_at("sewer_ping", 0.0, 0.0, 2)    # 4th arg picks a variant, 0 = random
Audio.sfx_world("ball_bounce", bw.x)       # pan from a world x — use this for the ball
Audio.announce("strikeout")                # megaphone patter; ducks the bed itself
Audio.music("game")                        # cross-fade the bed ("title", "" to stop)
Audio.sting("playball")                    # one-shot OVER the bed
Audio.crowd(true)                          # the kerb murmur bed
Audio.duck(0.6)                            # drop the bed for 0.6 s
Audio.stop_all()
```

Every call is a no-op if the cue is missing, so hooks can go in before or
after the assets do. `sfx*` return the `AudioStreamPlayer` (or `null`).

`Audio.announce(kind)` takes the **same `kind` strings as
`Announcer.line(kind)`** — so every hook is one line next to an existing
`ticker(Announcer.line(...))` call, with the same argument.

---

## `scripts/match_view.gd`

### `run_match()`
| Moment | Add | Where |
|---|---|---|
| The game opens | `Audio.sting("playball")` | immediately **before** `await _card("PLAY BALL!", "", 0.9)` |
| The bed starts | `Audio.music("game")` and `Audio.crowd(true)` | on the next line **after** that same `await _card(...)` |
| Pre-game patter | `Audio.announce("pregame")` | after `ticker(Announcer.line("pregame", ...))` |
| Between-pitch patter | `Audio.announce("pitch")` | inside `if randf() < PITCH_PATTER_CHANCE:`, after its `ticker(...)` |
| The arm comes over | `Audio.sfx("pitch_release")` | after `await _beat(PITCH_WINDUP_T)`, before `_start_pitch(pitch, plan)` |

### `_process_ball()` — **the heartbeat**
Every pitch bounces once on the cobbles, and this is the cue the whole batting
loop is timed against. The latch already exists (`_bounced`), so it is one
line inside the block that already reads `mark("bounce")`:

```gdscript
		elif _bt < _cross_t:
			var tau := _bt - _ta
			if not _bounced:
				_bounced = true
				mark("bounce")
				Audio.sfx_world("ball_bounce", _pB.x)     # <-- add
				_fx_dust(_pB, 9)
				shake(2.0)
```

Second hook, same function, in the `elif _ball_mode == "hit":` branch — the
ball hitting the street on a grounder hop or a landing. Add a member
`var _prev_bh := 0.0` beside `var bh := 0.0`, then at the very end of that
branch, after the final `_apply_ball()`:

```gdscript
		bw = pos
		_apply_ball()
		if _prev_bh > 6.0 and bh <= 6.0:                  # <-- add
			Audio.sfx_world("ball_bounce", bw.x, -5.0)    # <-- add
		_prev_bh = bh                                     # <-- add
		_push_trail()
```

and reset it in `_launch_hit()` next to `_sewer_prev_y = _h_from.y`:
`_prev_bh = 0.0`.

Third: the ball rolling dead. In the same branch, in the `if rt < _h_roll_t:`
arm, guarded by a `var _rolled := false` member reset in `_launch_hit()`:

```gdscript
			if rt < _h_roll_t:
				if not _rolled:                                    # <-- add
					_rolled = true                                 # <-- add
					Audio.sfx_world("ball_roll", _h_land.x, -4.0)  # <-- add
```

### `_process_ball()` — sewer count
Beside the existing `_fx_label(SEWER_TEXTS[i], Vector2(pos.x, sy))`:

```gdscript
					_fx_label(SEWER_TEXTS[i], Vector2(pos.x, sy))
					Audio.sfx_at("sewer_ping", 0.0, 0.0, i + 1)    # <-- add
```

The variant index matters: the three pings rise in pitch, one per manhole.

### `_resolve_pitch()` — **the bat**
This is where contact is decided and it already has the quality number, so the
bat sound belongs here, not in the choreography (which is a frame or two late):

```gdscript
	if String(ev.get("kind", "")) == "in_play":
		var q := float(ev.get("quality", 0.5))
		mark("contact q=%.2f" % q)
		Audio.sfx_world("bat_crack" if q > 0.55 else "bat_thud",
			bw.x, -7.0 + 8.0 * q)                            # <-- add
		_fx_contact(bw, bh, clampf(q, 0.15, 1.0))
		shake(4.0 + 14.0 * q)
	elif String(ev.get("kind", "")) == "foul":
		Audio.sfx_world("bat_thud", bw.x, -4.0)              # <-- add
		_fx_contact(bw, bh, 0.25)
		shake(3.0)
```

### `_catcher_take()` — the cheapest hook in the file
It is a one-line no-op called by *ball*, *strike*, *whiff* and *strikeout*, so
one edit covers all four:

```gdscript
func _catcher_take() -> void:
	Audio.sfx_at("ball_mitt", 0.0, -2.0)   # the catcher is off-camera here
```

### `_choreo(ev)` — one line per case, next to the existing `ticker(...)`
| case | Add after its `ticker(...)` line |
|---|---|
| `"ball"` | `Audio.announce("ball")` |
| `"strike"` | `Audio.announce("strike")` |
| `"foul"` | `Audio.announce("foul")` then `Audio.sfx("crowd_ooh", -4.0)` |
| `"whiff"` | `Audio.sfx("bat_whiff")`, `Audio.announce("whiff")`, `Audio.sfx("crowd_ooh", -6.0)` |
| `"strikeout"` | `Audio.announce("strikeout")` and `Audio.sfx("crowd_groan")` |
| `"walk"` | `Audio.announce("walk")` |

In `"whiff"`, put `Audio.sfx("bat_whiff")` **first**, before `ticker(...)` —
the swing happens before the announcer reacts to it.

### `_choreo_in_play(play)` — one line per branch
| Branch | Add | Where |
|---|---|---|
| `"out_fly"`, `"out_line"` | `Audio.sfx("catch")` | on the line after `_fielder_catch(fpos)` |
| ″ | `Audio.announce("out_fly")` / `Audio.announce("out_line")` | after each `ticker(...)` in that branch |
| ″ | `Audio.sfx("crowd_ooh", -3.0)` | after the announce |
| `"out_ground"` | `Audio.sfx("catch")` | after `await _ball_throw_to(Tuning.BASE_1 + Vector2(0, -8), THROW_T)` |
| ″ | `Audio.announce("out_ground")` | after its `ticker(...)` |
| `"hr"` → window | `Audio.sfx("glass_smash")` | beside `mark("window")`, before `_fx_glass(...)` |
| ″ | `Audio.announce("window")` | after `ticker(Announcer.line("window"))` |
| ″ | `Audio.sfx("scatter")` | on the line after `_scatter_fielders()` |
| ″ | `Audio.sfx("crowd_bigcheer")` | after `_scatter_fielders()` |
| `"hr"` → sewers | `Audio.announce("hr%d" % s)` and `Audio.sfx("crowd_bigcheer")` | after `ticker(Announcer.line("hr%d" % s))` |
| default (single/double) | `Audio.sfx_world("ball_flivver", Tuning.CAR_POS.x)` | inside `if bool(play["flivver"]):`, before its `ticker(...)` |
| ″ | `Audio.sfx_world("ball_brick", ...)` — use `Tuning.FE_L.x` or `Tuning.FE_R.x` per `play["lane"]` | inside `elif bool(play["fire_escape"]):` |
| ″ | `Audio.announce("flivver")` / `("fire_escape")` / `(res)` | after each of the three `ticker(...)` lines |
| ″ | `Audio.sfx("crowd_cheer")` | inside `if int(play["runs"]) >= 1:` |

### `_choreo_throw_play(play, nt)`
| Moment | Add |
|---|---|
| The throw arrives | `Audio.sfx("catch")` after `await _ball_throw_to(target_pos + Vector2(0, -8), THROW_T)` |
| Out / safe | `Audio.announce(res)` after `ticker(Announcer.line(res))`; `Audio.announce("single")` after the `else:` branch's `ticker(...)` |
| A run scores | `Audio.sfx("crowd_cheer")` inside `if int(play["runs"]) >= 1 and res != "hr":` |

### Kids on the cobbles
| Function | Add | Where |
|---|---|---|
| `_move_runner(m)` | `Audio.sfx_world("step", dest.x, -6.0)` | inside the existing per-leg `tw.tween_callback(func() -> void: ...)` that calls `node.face(dx, RUN_LEAN)` |
| ″ | `Audio.sfx_world("slide", _base_pos[mini(to_i, 3)].x)` | in the `if was_out:` callback beside `node.play("slide", 10.0, false)` |
| `_batter_out_at_first()` | `Audio.sfx_world("slide", Tuning.BASE_1.x)` | in the callback beside `node.play("slide", 10.0, false)` |
| `_fielder_chase(fpos)` | `Audio.sfx_world("step", k.wpos.x, -8.0)` and `Audio.sfx("hup")` | after `k.play("run", 11.0)` |
| `_scatter_fielders()` | *(nothing — `Audio.sfx("scatter")` at the call site covers it)* | |

### Cards, cop, finale
| Function | Add | Where |
|---|---|---|
| `_card(...)` | `Audio.sfx("card_slam" if slam else "iris_in")` | immediately after `_card_busy = true` — this covers **every** intertitle in the match |
| `_side_away(hc)` | `Audio.sfx("sting_side")` | before `await _card("SIDE AWAY", "", 0.8)` |
| `_cheese_beat(len)` | `Audio.sfx("cop_whistle")`, then `Audio.sting("cheese")` | before `_card("CHEESE IT!!", ...)` |
| ″ | `Audio.announce("cheese")` | after `ticker(Announcer.line("cheese"))` |
| ″ | `Audio.sfx("scatter")` | after the `for k0 in _field_kids():` loop is set up |
| ″ | `Audio.announce("cheese_end")` | after the closing `ticker(Announcer.line("cheese_end"))` |
| `_finale()` | `Audio.music("")`, `Audio.crowd(false)`, `Audio.sting("gameover")` | after the `if Game.smoke:` early-return block, before `ticker(Announcer.line("final"))` |
| ″ | `Audio.announce("final")` | after that `ticker(...)` |
| ″ | `Audio.sfx("crowd_bigcheer")` | after `await _card("THAT'S THE BALL GAME", ...)` |

### HUD
| Function | Add | Where |
|---|---|---|
| `_update_hud(snap)` | `Audio.sfx("score_bell")` | inside `if _last_runs >= 0 and runs_total != _last_runs:` |
| `_ticket_button(txt, font_size)` | wrap the press: `b.pressed.connect(func() -> void: Audio.sfx("ui_click"))` right after the button is built | covers pitch calls, throw calls and the finale button in one edit |
| `_show_finale_ui()` | `Audio.sfx("ui_confirm")` | in the `back.pressed` lambda, before `change_scene_to_file` |

Deliberately **not** hooked: `_try_swing()`. The swing already gets its sound
from the outcome (`bat_crack` / `bat_thud` / `bat_whiff`), and a click on the
tap as well makes the contact read as double-struck.

---

## `scripts/boot.gd` *(rewritten by another agent while this was written —
these are by intent, against the functions as they currently stand)*

| Moment | Add |
|---|---|
| `_show_title(iris)` | `Audio.music("title")` and `Audio.crowd(true)` at the end |
| `_ticket(...)` | in the button's `pressed` connection, before `cb`: `Audio.sfx("ui_click")` |
| `_toggle(id, animate)` | `Audio.sfx("ui_select")` in the `picked.append(id)` arm, `Audio.sfx("ui_flip")` in the `picked.erase(id)` arm |
| `_confirm_select()` | `Audio.sfx("ui_confirm")` at the top |
| `_start_match(auto)` | `Audio.music("")` — `match_view.run_match()` starts the game bed itself |

## `scripts/title_card.gd`

Only needed if `match_view._card()` is *not* hooked as above — do one or the
other, not both. In `flash(...)`: `Audio.sfx("card_slam")` in the `if slam:`
arm, `Audio.sfx("iris_in")` in the `else:` arm, and `Audio.sfx("iris_out")`
before the closing `tw4` tween.

---

## Notes for whoever applies this

- **Order matters at contact.** `bat_*` fires from `_resolve_pitch()`, the
  crowd reacts from `_choreo`, the announcer from the `ticker(...)` line after
  it. That staggering is the Backyard Baseball feel: hit, crowd, call.
- **`announce()` ducks the music by itself** for the length of the line. Do
  not add `Audio.duck()` next to it.
- **Don't loop `step` per frame.** The cue is a scuff, mixed at −4 dB and
  pitch-randomised ±14 %; one per running leg is the intended density.
- **`--smoke` runs are silent by design** (`audio.gd` checks the flag and
  loads nothing), so hooks cost the soak test nothing.
- **Balance lives in one place**: the `db` values in `BANK` in `audio.gd`, and
  the four bus volumes in `default_bus_layout.tres`. Change those, not the
  wavs.

# THREE SEWERS
Street stickball, New York City, 1926. Godot 4.4 · iOS-first vertical slice.

Manhole for home, stoop for first, hydrant for third. Every pitch bounces once —
read the hop. Break the window and RUN (it's a homer). When the beat cop rounds
the corner: CHEESE IT!

## Run
Open in Godot 4.4.1 and press F5, or headless:
```
godot --headless --path . --import
godot --headless --path . --script res://tests/sim_test.gd   # rules soak: SIM OK
godot --headless --path . -- --smoke                          # full auto game: SMOKE_OK
```

## State
Rules core, roster, announcer, title cards, boot/select flow, shaders, and all
placeholder art are DONE and validated. The match presentation layer
(`scripts/match_view.gd`) is specified in **CONTINUE_BUILD.md** — start there.
iOS: **IOS_TESTFLIGHT_RUNBOOK.md**.

## Controls (slice)
Batting: tap anywhere to swing (watch the bounce, not the hand).
Pitching: pick lane + pitch, tap THROW on the timing bar.
Defense: on close grounders, tap the base to throw to.

Regenerate placeholder art: `python3 tools/gen_assets.py` (from repo parent).

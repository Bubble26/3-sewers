extends SceneTree
# Headless soak test: 40 full CPU-vs-CPU games through the rules core.

func _initialize() -> void:
	var f := FileAccess.open("res://data/characters.json", FileAccess.READ)
	var roster: Dictionary = JSON.parse_string(f.get_as_text())
	var ids: Array = roster.keys()
	ids.sort()
	var fails := 0
	var tot_runs := 0
	var hrs := 0
	var windows := 0
	var lines := []
	for g in range(40):
		var core := MatchCore.new()
		core.setup(ids.slice(0, 6), ids.slice(6, 12), roster, -1, 3, g + 1)
		var guard := 0
		while not core.game_over and guard < 3000:
			guard += 1
			var p := core.make_cpu_pitch()
			core.begin_pitch(p)
			var sw := core.cpu_swing(p)
			var ev: Dictionary
			if sw["swing"]:
				ev = core.resolve_swing(sw["err_ms"])
			else:
				ev = core.resolve_no_swing()
			if ev.get("kind", "") == "in_play":
				if ev.get("result", "") == "hr": hrs += 1
				if ev.get("window", false): windows += 1
			core.check_half()
		if guard >= 3000:
			fails += 1
			print("HANG at seed ", g)
		tot_runs += core.score[0] + core.score[1]
		lines.append("%d-%d" % [core.score[0], core.score[1]])
	print("scores: ", ", ".join(lines))
	print("avg runs/game: %.1f | HRs: %d | windows smashed: %d" % [tot_runs / 40.0, hrs, windows])
	print("SIM " + ("OK" if fails == 0 else "FAIL"))
	quit(0 if fails == 0 else 1)

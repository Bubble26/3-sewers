class_name MatchCore
extends RefCounted
# THREE SEWERS — rules core. No nodes, no rendering. Fully testable headless.

enum Half { TOP, BOT }

const BALLS_WALK := 4
const STRIKES_K := 3
const POS_LIST := ["P", "C", "1B", "SS", "LF", "RF"]

var rng := RandomNumberGenerator.new()
var roster: Dictionary = {}
var lineups := [[], []]          # [away_ids, home_ids]
var positions := [{}, {}]        # side -> {pos: id}
var user_side := 1               # human controls home (bats bottom)
var innings_total := 3

var inning := 1
var half := Half.TOP
var outs := 0
var balls := 0
var strikes := 0
var score := [0, 0]
var bases := ["", "", ""]        # 1B,2B,3B kid ids ("" empty)
var bat_idx := [0, 0]
var game_over := false
var final_note := ""
var faced: Array = [{}, {}]      # pitcher-side -> {batter_id: times}
var pending_pitch: Dictionary = {}
var pending_throw: Dictionary = {}

func setup(away: Array, home: Array, roster_in: Dictionary, user: int, n_inn: int, seed_v: int = 0) -> void:
	roster = roster_in
	lineups = [away.duplicate(), home.duplicate()]
	user_side = user
	innings_total = n_inn
	if seed_v != 0: rng.seed = seed_v
	else: rng.randomize()
	for side in 2:
		positions[side] = _assign_positions(lineups[side])

func _assign_positions(ids: Array) -> Dictionary:
	var pool := ids.duplicate()
	var out := {}
	pool.sort_custom(func(a, b): return _s(a, "ARM") > _s(b, "ARM"))
	out["P"] = pool.pop_front()
	out["C"] = pool.pop_front()
	pool.sort_custom(func(a, b): return _s(a, "GLV") > _s(b, "GLV"))
	out["SS"] = pool.pop_front()
	out["1B"] = pool.pop_front()
	pool.sort_custom(func(a, b): return _s(a, "SPD") > _s(b, "SPD"))
	out["LF"] = pool.pop_front()
	out["RF"] = pool.pop_front()
	return out

func _s(id: String, stat: String) -> int:
	var v: int = int(roster[id][stat])
	if stat == "PWR" and roster[id]["quirk"] == "boughten": v += 1
	return v

# ------------------------------------------------- state helpers
func batting_side() -> int: return 0 if half == Half.TOP else 1
func fielding_side() -> int: return 1 - batting_side()
func human_batting() -> bool: return batting_side() == user_side
func batter_id() -> String:
	var side := batting_side()
	return lineups[side][bat_idx[side] % lineups[side].size()]
func pitcher_id() -> String: return positions[fielding_side()]["P"]
func kid_name(id: String) -> String: return roster[id]["name"] if roster.has(id) else id
func snapshot() -> Dictionary:
	return {"inning": inning, "half": half, "outs": outs, "balls": balls,
		"strikes": strikes, "score": score.duplicate(), "bases": bases.duplicate(),
		"batter": batter_id(), "pitcher": pitcher_id(), "over": game_over,
		"bat_side": batting_side()}

func _con(id: String) -> float:
	var c := float(_s(id, "CON"))
	# Sadie feeds the gang: teammates sharper while she's on base.
	for b in bases:
		if b != "" and b != id and roster[b]["quirk"] == "on_house": c += 1.0
	if roster[id]["quirk"] == "eagle_eye" and strikes == 2: c += 3.0
	return c

func pitch_quality() -> float:
	var p := pitcher_id()
	var q := 0.35 + float(_s(p, "ARM")) * 0.05
	if roster[p]["quirk"] == "spinner": q += 0.08
	if roster[positions[fielding_side()]["C"]]["quirk"] == "rifle": q += 0.05
	if roster[p]["quirk"] == "southpaw":
		var f: Dictionary = faced[fielding_side()]
		if int(f.get(batter_id(), 0)) == 0: q += 0.12
	return clampf(q + rng.randf_range(-0.06, 0.06), 0.2, 0.95)

# ------------------------------------------------- pitching
func make_cpu_pitch() -> Dictionary:
	var types := ["fast", "spinner", "drop"]
	var lane: int = [-1, 0, 1][rng.randi_range(0, 2)]
	var aim_strike := rng.randf() < (0.62 if strikes < 2 else 0.5)
	return {"lane": lane, "type": types[rng.randi_range(0, 2)],
		"quality": pitch_quality(), "aim_strike": aim_strike}

func begin_pitch(p: Dictionary) -> void:
	pending_pitch = p
	var f: Dictionary = faced[fielding_side()]
	f[batter_id()] = int(f.get(batter_id(), 0)) + 1

func cpu_swing(p: Dictionary) -> Dictionary:
	var con := _con(batter_id())
	var swing_prob := 0.82 if p["aim_strike"] else clampf(0.55 - con * 0.03, 0.12, 0.5)
	if not (rng.randf() < swing_prob):
		return {"swing": false}
	var sigma := maxf(36.0, 110.0 - con * 5.0 + p["quality"] * 50.0)
	return {"swing": true, "err_ms": rng.randfn(0.0, sigma)}

func resolve_no_swing() -> Dictionary:
	var is_strike: bool = pending_pitch["aim_strike"] and rng.randf() < 0.9
	var ev := {"kind": "strike" if is_strike else "ball", "swung": false}
	if is_strike: strikes += 1
	else: balls += 1
	return _after_pitch(ev)

func resolve_swing(err_ms: float) -> Dictionary:
	var b := batter_id()
	var con := _con(b)
	var q: float = pending_pitch["quality"]
	var eff := absf(err_ms) * (0.78 + 0.55 * q)
	var perfect_t := 45.0 + con * 2.5
	var good_t := 108.0 + con * 4.0
	var weak_t := 175.0 + con * 4.0
	if eff > weak_t or not pending_pitch["aim_strike"] and eff > good_t:
		strikes += 1
		return _after_pitch({"kind": "whiff", "swung": true})
	var quality := 0.0
	if eff <= perfect_t: quality = rng.randf_range(0.85, 1.0)
	elif eff <= good_t: quality = rng.randf_range(0.5, 0.84)
	else: quality = rng.randf_range(0.15, 0.49)
	# weak contact often fouls off
	if quality < 0.5 and rng.randf() < 0.55:
		if strikes < 2: strikes += 1
		return _after_pitch({"kind": "foul", "swung": true})
	return _after_pitch(_in_play(b, quality, signf(err_ms)))

func _after_pitch(ev: Dictionary) -> Dictionary:
	ev["count"] = {"b": balls, "s": strikes}
	if ev["kind"] == "whiff" or ev["kind"] == "strike":
		if strikes >= STRIKES_K:
			ev["kind"] = "strikeout"
			_out(); _next_batter()
	elif ev["kind"] == "ball":
		if balls >= BALLS_WALK:
			ev["kind"] = "walk"
			ev["moves"] = _walk_moves()
			_next_batter()
	ev["snap"] = snapshot()
	return ev

# ------------------------------------------------- ball in play
func _in_play(b: String, quality: float, pull: float) -> Dictionary:
	var pwr := float(_s(b, "PWR"))
	if roster[b]["quirk"] == "wallop": quality = maxf(quality, 0.45)
	var carry := clampf(quality * (0.26 + pwr * 0.044) + rng.randf_range(-0.05, 0.07), 0.05, 1.45)
	if roster[b]["quirk"] == "three_sewers" and quality > 0.8: carry += 0.22
	var lane := clampf(pull * rng.randf_range(0.2, 1.0) + rng.randf_range(-0.35, 0.35), -1.0, 1.0)
	var loft := "ground"
	if quality > 0.78: loft = "fly" if rng.randf() < 0.6 else "line"
	elif quality > 0.5: loft = "line" if rng.randf() < 0.55 else ("fly" if rng.randf() < 0.5 else "ground")
	var play := {"kind": "in_play", "batter": b, "carry": carry, "lane": lane,
		"loft": loft, "quality": quality, "window": false, "fire_escape": false,
		"flivver": false, "sewers": 0, "result": "", "fielder": "",
		"runs": 0, "moves": [], "needs_throw": null}

	# The broken window: deep pull-side fly smashes glass = HOME RUN you sprint away from.
	if loft == "fly" and carry > 0.75 and lane < -0.55 and rng.randf() < 0.5:
		play["window"] = true
		play["result"] = "hr"; play["sewers"] = 3
		_apply_hit(play, 4)
		return play
	# Over the sewers on the fly = home run, graded in sewers.
	if loft != "ground" and carry >= 0.55:
		var s := 1
		if carry >= 0.9: s = 3
		elif carry >= 0.72: s = 2
		if loft == "fly" and s >= 1 and carry < 0.72 and rng.randf() < _catch_prob("LF" if lane < 0 else "RF"):
			play["result"] = "out_fly"; play["fielder"] = "LF" if lane < 0 else "RF"
			_out(); _next_batter(); return play
		play["result"] = "hr"; play["sewers"] = s
		_apply_hit(play, 4)
		return play
	# Fire escape catch = ground-rule double (ball rattles into the ironwork).
	if loft == "fly" and carry > 0.38 and absf(lane) > 0.7 and rng.randf() < 0.25:
		play["fire_escape"] = true
		play["result"] = "double"
		_apply_hit(play, 2)
		return play
	if absf(lane) > 0.85 and carry > 0.3 and rng.randf() < 0.3:
		play["flivver"] = true  # off Mr. Esposito's flivver — live carom
	# fielded chances
	var fpos := _nearest_fielder(carry, lane, loft)
	play["fielder"] = fpos
	if loft == "fly":
		if rng.randf() < _catch_prob(fpos):
			play["result"] = "out_fly"; _out(); _next_batter(); return play
		play["result"] = "double" if carry > 0.42 else "single"
		_apply_hit(play, 2 if play["result"] == "double" else 1)
		return play
	if loft == "line":
		if rng.randf() < _catch_prob(fpos) * 0.55:
			play["result"] = "out_line"; _out(); _next_batter(); return play
		var bases_n := 2 if carry > 0.44 and rng.randf() < 0.5 else 1
		play["result"] = "double" if bases_n == 2 else "single"
		_apply_hit(play, bases_n)
		return play
	# grounder: race at first
	var spd := float(_s(b, "SPD"))
	var margin := (spd * 0.035) - (carry * 0.32) - _glv_team() * 0.02 + rng.randf_range(-0.12, 0.12)
	if roster[b]["quirk"] == "headfirst": margin += 0.05
	if fielding_side() == user_side and margin > -0.18 and margin < 0.22:
		# human defense gets the call: throw prompt
		pending_throw = {"play": play, "margin": margin}
		play["needs_throw"] = {"targets": _throw_targets(), "best": "1B", "deadline": 1.4}
		return play
	if margin < 0.0:
		play["result"] = "out_ground"; _out(); _next_batter()
	else:
		play["result"] = "single"; _apply_hit(play, 1)
	return play

func resolve_throw(choice: String) -> Dictionary:
	var play: Dictionary = pending_throw["play"]
	var margin: float = pending_throw["margin"]
	pending_throw = {}
	play["needs_throw"] = null
	if choice == "1B" and margin < 0.16:
		play["result"] = "out_ground"; play["thrown"] = "1B"
		_out(); _next_batter()
	elif choice == "home" and bases[2] != "" and margin < 0.1:
		play["result"] = "out_home"; play["thrown"] = "home"
		var runner_out: String = bases[2]
		bases[2] = ""
		_out()
		play["moves"] = [{"id": runner_out, "from": 2, "to": 3, "out": true}]
		if outs < 3:
			_apply_hit(play, 1)
	else:
		play["result"] = "single"; play["thrown"] = choice
		_apply_hit(play, 1)
	play["snap"] = snapshot()
	return play

func throw_timeout() -> Dictionary:
	return resolve_throw("none")

func _throw_targets() -> Array:
	var t := ["1B"]
	if bases[2] != "": t.append("home")
	if bases[0] != "": t.append("2B")
	return t

func _nearest_fielder(carry: float, lane: float, loft: String) -> String:
	if carry > 0.34 or loft == "fly":
		return "LF" if lane < 0 else "RF"
	if lane < -0.2: return "SS"
	if lane > 0.35: return "1B"
	return "P" if carry < 0.14 else "SS"

func _catch_prob(pos: String) -> float:
	var id: String = positions[fielding_side()][pos]
	var p := 0.3 + float(_s(id, "GLV")) * 0.05
	if _team_has_quirk(fielding_side(), "spit_shine"): p += 0.08
	return clampf(p, 0.2, 0.92)

func _glv_team() -> float:
	var t := 0.0
	for pos in ["1B", "SS", "P"]:
		t += float(_s(positions[fielding_side()][pos], "GLV"))
	return t / 3.0

func _team_has_quirk(side: int, q: String) -> bool:
	for id in lineups[side]:
		if roster[id]["quirk"] == q: return true
	return false

# ------------------------------------------------- advancement
func _apply_hit(play: Dictionary, n_bases: int, include_batter := true) -> void:
	# "to": 0/1/2 = bases, 3 = home. Runners first (lead runner outward).
	var moves: Array = play.get("moves", [])
	var runs: int = play.get("runs", 0)
	var side := batting_side()
	var b: String = play["batter"]
	for i in [2, 1, 0]:
		if bases[i] == "": continue
		var rid: String = bases[i]
		bases[i] = ""
		var dest: int = i + n_bases
		if dest < 3 and float(_s(rid, "SPD")) >= 8 and rng.randf() < 0.3:
			dest += 1  # speedsters stretch it
		if dest >= 3:
			runs += 1
			moves.append({"id": rid, "from": i, "to": 3})
		else:
			bases[dest] = rid
			moves.append({"id": rid, "from": i, "to": dest})
	if include_batter:
		var bd := n_bases
		if play.get("result", "") == "hr": bd = 4
		elif roster[b]["quirk"] == "extra" and bd < 3 and rng.randf() < 0.4:
			bd += 1
			play["stretched"] = true
			if bd == 2: play["result"] = "double"
		if bd >= 4:
			runs += 1
			moves.append({"id": b, "from": -1, "to": 3})
		else:
			bases[bd - 1] = b
			moves.append({"id": b, "from": -1, "to": bd - 1})
		_next_batter()
	score[side] += runs
	play["runs"] = runs
	play["moves"] = moves

func _walk_moves() -> Array:
	var moves := []
	var b := batter_id()
	if bases[0] != "":
		if bases[1] != "":
			if bases[2] != "":
				score[batting_side()] += 1
				moves.append({"id": bases[2], "from": 2, "to": 3})
			bases[2] = bases[1]
			moves.append({"id": bases[1], "from": 1, "to": 2})
		bases[1] = bases[0]
		moves.append({"id": bases[0], "from": 0, "to": 1})
	bases[0] = b
	moves.append({"id": b, "from": -1, "to": 0})
	return moves

func _next_batter() -> void:
	balls = 0; strikes = 0
	bat_idx[batting_side()] += 1

func _out() -> void:
	outs += 1
	balls = 0; strikes = 0

# ------------------------------------------------- inning flow
# Call after every resolved event. Returns {changed, cheese, over}
func check_half() -> Dictionary:
	var r := {"changed": false, "cheese": false, "cheese_len": 2.2, "over": false}
	if outs < 3: 
		if _walkoff(): r["over"] = true; game_over = true; final_note = "WALK-OFF!"
		return r
	# side away
	outs = 0; balls = 0; strikes = 0
	bases = ["", "", ""]
	r["changed"] = true
	if half == Half.TOP:
		if inning >= innings_total and score[1] > score[0]:
			game_over = true; r["over"] = true; final_note = "CALLED IT EARLY — GANG AHEAD"
			return r
		half = Half.BOT
	else:
		if inning >= innings_total:
			if score[0] != score[1]:
				game_over = true; r["over"] = true
				return r
			elif inning >= innings_total + 2:
				game_over = true; r["over"] = true; final_note = "CALLED ON ACCOUNT OF SUPPER"
				return r
		half = Half.TOP
		inning += 1
	# CHEESE IT! — the beat cop rounds the corner between halves.
	var chance := 0.16
	if _team_has_quirk(0, "lookout") or _team_has_quirk(1, "lookout"):
		chance = 0.08; r["cheese_len"] = 1.4
	r["cheese"] = rng.randf() < chance
	return r

func _walkoff() -> bool:
	return half == Half.BOT and inning >= innings_total and score[1] > score[0]

func winner_text() -> String:
	if score[0] == score[1]: return "TIE GAME"
	return "GANG WINS!" if score[1] > score[0] else "VISITORS TAKE IT"

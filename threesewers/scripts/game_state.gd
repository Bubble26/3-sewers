extends Node
# Roster loading + texture cache + match handoff.

var roster: Dictionary = {}
var player_team: Array = []
var cpu_team: Array = []
var smoke := false
var _tex_cache := {}

func _ready() -> void:
	var f := FileAccess.open("res://data/characters.json", FileAccess.READ)
	roster = JSON.parse_string(f.get_as_text())
	smoke = "--smoke" in OS.get_cmdline_user_args()

# `count` is a hint, not a contract: the art generators change frame counts
# often, so we walk the numbered files until one is missing. A view that
# under-guesses no longer silently drops the tail of an animation.
const FRAME_CEIL := 64

func frames(id: String, anim: String, count: int = 0) -> Array:
	var key := id + "/" + anim
	if _tex_cache.has(key): return _tex_cache[key]
	var arr := _load_run("chr", id, anim)
	if arr.is_empty(): arr = _load_run("npc", id, anim)
	_tex_cache[key] = arr
	return arr

func _load_run(prefix: String, id: String, anim: String) -> Array:
	var arr := []
	for i in FRAME_CEIL:
		var p := "res://assets/characters/%s_%s_%s_%d.png" % [prefix, id, anim, i]
		if not ResourceLoader.exists(p): break
		arr.append(load(p))
	return arr

func card(id: String) -> Texture2D:
	return load("res://assets/characters/chr_%s_card.png" % id)

func prop(name_s: String) -> Texture2D:
	var p := "res://assets/props/prp_%s.png" % name_s
	if not ResourceLoader.exists(p):
		return null
	if _tex_cache.has(p): return _tex_cache[p]
	var t: Texture2D = load(p)
	_tex_cache[p] = t
	return t

func team_rating(ids: Array) -> float:
	var t := 0.0
	for id in ids:
		var k = roster[id]
		t += k["PWR"] + k["CON"] + k["SPD"] + k["ARM"] + k["GLV"]
	return t

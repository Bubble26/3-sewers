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

func frames(id: String, anim: String, count: int) -> Array:
	var key := id + "/" + anim
	if _tex_cache.has(key): return _tex_cache[key]
	var arr := []
	for i in count:
		var p := "res://assets/characters/chr_%s_%s_%d.png" % [id, anim, i]
		if ResourceLoader.exists(p): arr.append(load(p))
	if arr.is_empty():
		for i in count:
			var p2 := "res://assets/characters/npc_%s_%s_%d.png" % [id, anim, i]
			if ResourceLoader.exists(p2): arr.append(load(p2))
	_tex_cache[key] = arr
	return arr

func card(id: String) -> Texture2D:
	return load("res://assets/characters/chr_%s_card.png" % id)

func prop(name_s: String) -> Texture2D:
	return load("res://assets/props/prp_%s.png" % name_s)

func team_rating(ids: Array) -> float:
	var t := 0.0
	for id in ids:
		var k = roster[id]
		t += k["PWR"] + k["CON"] + k["SPD"] + k["ARM"] + k["GLV"]
	return t

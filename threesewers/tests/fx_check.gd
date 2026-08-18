extends SceneTree
# Every effect sprite the match asks for, loaded the way the game loads it.
#
# The impact effects were wired up and then silently did nothing for a whole
# round: the loader guessed a prp_ prefix, the files were named fx_, and the
# lookup returned null with no error anywhere. Nothing failed — the bursts
# just never appeared. A missing texture must be a loud failure, not a
# quietly empty frame.
const NEEDED := [
	"fx_sock_0", "fx_sock_1", "fx_sock_2",
	"fx_dust_0", "fx_dust_1", "fx_dust_2", "fx_dust_3",
	"fx_scuff", "fx_ring",
	"fx_glass_0", "fx_glass_1", "fx_glass_2",
	"spaldeen", "manhole", "shadow",
]

func _load(name_s: String) -> Texture2D:
	for p in ["res://assets/props/prp_%s.png" % name_s,
			"res://assets/props/%s.png" % name_s]:
		if ResourceLoader.exists(p):
			return load(p)
	return null

# The front end and the HUD load by their own paths, so they need checking too.
const UI := ["ui_pip_ball", "ui_pip_out", "ui_pip_star", "ui_ticket",
	"ui_banner", "ui_plate", "ui_rack_header", "ui_ribbon", "ui_scrim",
	"ui_shelf", "ui_stamp", "ui_card_plate"]

func _check(bad: Array, label: String, t: Texture2D) -> void:
	if t == null:
		bad.append("%s: not found" % label)
	elif t.get_width() < 2 or t.get_height() < 2:
		bad.append("%s: degenerate %dx%d" % [label, t.get_width(), t.get_height()])

func _init() -> void:
	var bad: Array = []
	for n in NEEDED:
		_check(bad, String(n), _load(String(n)))
	for n in UI:
		var p := "res://assets/ui/%s.png" % n
		_check(bad, String(n), load(p) if ResourceLoader.exists(p) else null)
	# every kid's card, and the back-view art the batter actually wears
	var f := FileAccess.open("res://data/characters.json", FileAccess.READ)
	if f != null:
		var roster = JSON.parse_string(f.get_as_text())
		if roster is Dictionary:
			for id in roster.keys():
				for suffix in ["card", "bat_back_0", "swing_back_0"]:
					var p2 := "res://assets/characters/chr_%s_%s.png" % [id, suffix]
					_check(bad, "%s_%s" % [id, suffix],
						load(p2) if ResourceLoader.exists(p2) else null)
	if bad.is_empty():
		print("FX OK  (%d sprites + ui + roster)" % NEEDED.size())
		quit(0)
	for b in bad:
		print("FX FAIL  ", b)
	quit(1)

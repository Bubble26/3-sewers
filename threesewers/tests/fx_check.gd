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

func _init() -> void:
	var bad: Array = []
	for n in NEEDED:
		var t := _load(String(n))
		if t == null:
			bad.append("%s: not found" % n)
		elif t.get_width() < 2 or t.get_height() < 2:
			bad.append("%s: degenerate %dx%d" % [n, t.get_width(), t.get_height()])
	if bad.is_empty():
		print("FX OK  (%d sprites)" % NEEDED.size())
		quit(0)
	for b in bad:
		print("FX FAIL  ", b)
	quit(1)

extends SceneTree
# Headless audio check: every cue named by scripts/audio.gd must exist on disk,
# import as a 44.1 kHz AudioStreamWAV, and actually start playing through the
# real autoload — pool, buses, panners and all.
#
#   godot --headless --path . --script res://tests/audio_test.gd   -> AUDIO OK
#
# It runs the API from _process rather than _initialize because nothing is
# inside the tree yet when _initialize fires, so no autoload has had its
# _ready() called and the player pool does not exist.

const A := preload("res://scripts/audio.gd")

var _frame := 0
var _fails := 0


func _fail(msg: String) -> void:
	print("  FAIL  ", msg)
	_fails += 1


func _initialize() -> void:
	# -- every file the bank promises, and in the shape it promised it
	var want: Array = []
	for name_s in A.BANK:
		for v in range(1, int(A.BANK[name_s]["n"]) + 1):
			want.append([A.SFX_DIR, name_s, v, name_s == "crowd_idle"])
	for name_s in A.VOX:
		for v in range(1, int(A.VOX[name_s]) + 1):
			want.append([A.VOX_DIR, name_s, v, false])
	for name_s in A.MUSIC:
		want.append([A.MUSIC_DIR, name_s, 1, bool(A.MUSIC[name_s]["loop"])])

	var bytes := 0
	var secs := 0.0
	for w in want:
		var path: String = "%s%s_%d.wav" % [w[0], w[1], w[2]]
		var loops: bool = w[3]
		if not ResourceLoader.exists(path):
			_fail("missing " + path)
			continue
		var s = load(path)
		if not (s is AudioStreamWAV):
			_fail("not an AudioStreamWAV: " + path)
			continue
		var wav: AudioStreamWAV = s
		bytes += wav.data.size()
		secs += wav.get_length()
		if wav.mix_rate != 44100:
			_fail("%s is %d Hz" % [path, wav.mix_rate])
		if wav.get_length() <= 0.02:
			_fail("%s is %.3fs long" % [path, wav.get_length()])
		if loops:
			# Beds must loop, and must be raw PCM: a lossy codec decodes in
			# blocks and there is no way to check the join from here.
			if wav.loop_mode == AudioStreamWAV.LOOP_DISABLED:
				_fail(path + " should loop (smpl chunk lost?)")
			if wav.format != AudioStreamWAV.FORMAT_16_BITS:
				_fail(path + " loops but did not import as PCM")
		elif wav.loop_mode != AudioStreamWAV.LOOP_DISABLED:
			_fail(path + " is a one-shot but imports as looping")
	print("%d files, %.1fs of audio, %.2f MB imported" %
		[want.size(), secs, bytes / 1048576.0])

	if AudioServer.get_bus_index("Master") < 0 \
			or AudioServer.get_bus_index("Music") < 0 \
			or AudioServer.get_bus_index("SFX") < 0 \
			or AudioServer.get_bus_index("Voice") < 0:
		_fail("default_bus_layout.tres did not load (Master/Music/SFX/Voice)")


func _process(_delta: float) -> bool:
	_frame += 1
	if _frame < 2:
		return false                      # let the autoloads finish _ready()
	var audio = root.get_node_or_null("Audio")
	if audio == null:
		_fail("Audio autoload is not registered in project.godot")
		print("AUDIO FAIL (%d)" % _fails)
		return true

	if audio._pool.size() != A.POLY:
		_fail("player pool is %d, expected %d" % [audio._pool.size(), A.POLY])
	for i in audio._pool.size():
		if AudioServer.get_bus_index(audio._pool[i].bus) < 0:
			_fail("pool voice %d points at a bus that does not exist" % i)

	# -- every cue really plays, at a real pan, off the real pool
	var pan := -1.0
	for name_s in A.BANK:
		var p = audio.sfx_at(name_s, pan)
		pan = -1.0 if pan >= 1.0 else pan + 0.25
		if p == null:
			_fail("sfx('%s') returned null" % name_s)
		elif p.stream == null:
			_fail("sfx('%s') played nothing" % name_s)
	for kind in A.ANNOUNCE:
		audio.announce(kind)
	for key in A.MUSIC:
		audio.music(key)
		audio.music("")
	audio.crowd(true)
	audio.sfx_world("ball_bounce", 200.0)
	audio.duck(0.2)

	# -- and the graceful paths do not throw
	audio.sfx("does_not_exist")
	audio.announce("no_such_event")
	audio.music("no_such_tune")
	audio.crowd(false)
	audio.stop_all()

	# Tear the autoload down before quitting. A stopped AudioStreamPlayer still
	# holds its playback (the dummy driver never mixes again to release it), so
	# without this the engine reports the whole bank as "resources still in use
	# at exit" and the log reads like a failure when nothing failed.
	audio.forget()
	for t in get_processed_tweens():
		t.kill()
	for c in audio.get_children():
		audio.remove_child(c)
		c.free()
	OS.delay_msec(300)      # let the mixer thread reap the stopped playbacks

	print("AUDIO " + ("OK" if _fails == 0 else "FAIL (%d)" % _fails))
	quit(0 if _fails == 0 else 1)
	return true

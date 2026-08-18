extends Node
# THREE SEWERS — one voice for the whole block.
#
# Everything that makes a noise goes through here. The game never touches
# AudioStreamPlayer, never loads a .wav, and never has to know whether a cue
# has one variant or four:
#
#     Audio.sfx("bat_crack")             one-shot, centred
#     Audio.sfx_at("ball_bounce", 0.4)   one-shot, panned right of centre
#     Audio.music("title")               cross-fade the bed ("game", "" to stop)
#     Audio.sting("playball")            a one-shot over the top of the bed
#     Audio.announce("strikeout")        the kid with the tin megaphone
#     Audio.duck(0.6)                    drop the bed under something loud
#     Audio.crowd(true)                  the kerb murmur, on or off
#     Audio.stop_all()
#
# Three rules it enforces so callers do not have to:
#   1. POLYPHONY IS OWNED HERE. A fixed pool of players; when they are all
#      busy the oldest is stolen. No allocation during play.
#   2. NO TWO IDENTICAL HITS. Every cue picks a random variant (never the same
#      one twice running) and a random pitch inside its own range, so the
#      bounce that fires on every single pitch never fatigues the ear.
#   3. MISSING IS FINE. An unbuilt or misnamed sound is a no-op with one
#      warning, not a crash. The game must run with assets/audio/ deleted.
#
# Assets come from tools/gen_audio.py — BANK below mirrors its MANIFEST().

const BUS_MASTER := "Master"
const BUS_MUSIC := "Music"
const BUS_SFX := "SFX"
const BUS_VOICE := "Voice"

const POLY := 14                    # simultaneous one-shots
const MUSIC_FADE := 0.9             # cross-fade between beds, seconds
const DUCK_DB := -9.0               # how far the bed drops under a duck
const DUCK_HOLD := 0.45
const SFX_DIR := "res://assets/audio/sfx/"
const VOX_DIR := "res://assets/audio/vox/"
const MUSIC_DIR := "res://assets/audio/music/"

# name -> {n: variants, db: gain trim, pitch: [lo, hi]}
# db trims are the mix; they are the one place to tune balance by ear.
const BANK := {
	# -- the bat
	"bat_crack": {"n": 3, "db": 2.0, "pitch": [0.95, 1.06]},
	"bat_thud": {"n": 2, "db": 0.0, "pitch": [0.92, 1.08]},
	"bat_whiff": {"n": 3, "db": -1.0, "pitch": [0.94, 1.10]},
	# -- the spaldeen
	"ball_bounce": {"n": 4, "db": 0.0, "pitch": [0.93, 1.09]},
	"ball_mitt": {"n": 3, "db": -1.0, "pitch": [0.94, 1.07]},
	"ball_brick": {"n": 2, "db": -1.0, "pitch": [0.92, 1.10]},
	"ball_flivver": {"n": 2, "db": 1.0, "pitch": [0.94, 1.06]},
	"ball_roll": {"n": 2, "db": -3.0, "pitch": [0.90, 1.10]},
	"glass_smash": {"n": 2, "db": 1.0, "pitch": [0.96, 1.04]},
	# -- kids
	"step": {"n": 4, "db": -4.0, "pitch": [0.88, 1.14]},
	"slide": {"n": 2, "db": -2.0, "pitch": [0.92, 1.08]},
	"catch": {"n": 2, "db": -1.0, "pitch": [0.94, 1.07]},
	"hup": {"n": 3, "db": -3.0, "pitch": [0.90, 1.12]},
	# -- the gang on the kerb
	"crowd_ooh": {"n": 1, "db": 0.0, "pitch": [0.96, 1.05]},
	"crowd_cheer": {"n": 1, "db": 0.0, "pitch": [0.95, 1.06]},
	"crowd_bigcheer": {"n": 1, "db": 1.0, "pitch": [0.97, 1.03]},
	"crowd_groan": {"n": 1, "db": 0.0, "pitch": [0.94, 1.07]},
	"crowd_laugh": {"n": 1, "db": 0.0, "pitch": [0.95, 1.06]},
	"crowd_idle": {"n": 1, "db": 0.0, "pitch": [1.0, 1.0]},
	# -- events
	"cop_whistle": {"n": 2, "db": 1.0, "pitch": [0.97, 1.04]},
	"scatter": {"n": 1, "db": -1.0, "pitch": [0.95, 1.06]},
	"card_slam": {"n": 1, "db": 0.0, "pitch": [0.93, 1.08]},
	"iris_in": {"n": 1, "db": -3.0, "pitch": [0.95, 1.06]},
	"iris_out": {"n": 1, "db": -3.0, "pitch": [0.95, 1.06]},
	"score_bell": {"n": 1, "db": -1.0, "pitch": [0.98, 1.03]},
	"sewer_ping": {"n": 3, "db": -2.0, "pitch": [1.0, 1.0]},
	"pitch_release": {"n": 2, "db": -2.0, "pitch": [0.92, 1.10]},
	"sting_side": {"n": 1, "db": 0.0, "pitch": [0.99, 1.02]},
	# -- UI
	"ui_flip": {"n": 2, "db": -2.0, "pitch": [0.92, 1.10]},
	"ui_select": {"n": 1, "db": -1.0, "pitch": [0.97, 1.05]},
	"ui_click": {"n": 2, "db": 0.0, "pitch": [0.94, 1.08]},
	"ui_confirm": {"n": 1, "db": -1.0, "pitch": [0.99, 1.02]},
	"ui_back": {"n": 1, "db": -1.0, "pitch": [0.99, 1.02]},
}

# The announcer speaks gibberish, so what matters is picking patter of the
# right LENGTH and TEMPERATURE for the moment — short and flat for a called
# strike, a long shout for three sewers.
const VOX := {
	"patter_short": 4, "patter_call": 4, "patter_long": 3,
	"patter_flat": 4, "patter_shout": 3, "patter_big": 2,
}
const ANNOUNCE := {
	"pregame": "patter_long", "pitch": "patter_flat",
	"strike": "patter_short", "ball": "patter_short", "foul": "patter_short",
	"whiff": "patter_call", "strikeout": "patter_shout",
	"walk": "patter_flat",
	"single": "patter_call", "double": "patter_call",
	"fire_escape": "patter_call", "flivver": "patter_call",
	"out_fly": "patter_call", "out_line": "patter_shout",
	"out_ground": "patter_call", "out_home": "patter_shout",
	"hr1": "patter_shout", "hr2": "patter_shout", "hr3": "patter_big",
	"window": "patter_big", "cheese": "patter_shout",
	"cheese_end": "patter_flat", "final": "patter_long",
}
const MUSIC := {
	"title": {"db": -2.0, "loop": true},
	"game": {"db": 0.0, "loop": true},
	"playball": {"db": -1.0, "loop": false},
	"gameover": {"db": 0.0, "loop": false},
	"cheese": {"db": -1.0, "loop": false},
}

var enabled := true                 # false during --smoke; nothing is loaded
var _pool: Array[AudioStreamPlayer] = []
var _pool_at := 0
var _pan: Array[AudioEffectPanner] = []
var _voice: AudioStreamPlayer
var _bed: AudioStreamPlayer         # crowd murmur
var _music: Array[AudioStreamPlayer] = []
var _sting: AudioStreamPlayer       # one-shots that play over the bed
var _music_at := 0
var _music_key := ""
var _cache := {}                    # path -> AudioStream (null = known missing)
var _last := {}                     # cue name -> last variant played
var _warned := {}
var _duck_tw: Tween
var _music_tw: Tween
var _music_rest_db := 0.0           # Music bus resting level, so duck() returns to it
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_rng.randomize()
	# A smoke run drives a whole game at 10x with no audio device attached;
	# there is nothing to hear and no reason to decode a megabyte of wavs.
	if "--smoke" in OS.get_cmdline_user_args():
		enabled = false
		return
	var music_bus := AudioServer.get_bus_index(BUS_MUSIC)
	if music_bus >= 0:
		_music_rest_db = AudioServer.get_bus_volume_db(music_bus)
	var sfx_bus := _bus_or_master(BUS_SFX)
	for i in POLY:
		var pan := AudioEffectPanner.new()
		pan.pan = 0.0
		var bus_name := "SfxVoice%d" % i
		AudioServer.add_bus()
		var idx := AudioServer.bus_count - 1
		AudioServer.set_bus_name(idx, bus_name)
		AudioServer.set_bus_send(idx, sfx_bus)
		AudioServer.add_bus_effect(idx, pan)
		_pan.append(pan)
		_pool.append(_player(bus_name))
	_voice = _player(_bus_or_master(BUS_VOICE))
	_bed = _player(sfx_bus)
	for i in 2:
		_music.append(_player(_bus_or_master(BUS_MUSIC)))
	# A sting is a sound effect that happens to be musical: it rides the SFX
	# bus so it cuts through, and so ducking the bed never ducks the sting.
	_sting = _player(sfx_bus)


func _player(bus: String) -> AudioStreamPlayer:
	var p := AudioStreamPlayer.new()
	p.bus = bus
	p.process_mode = Node.PROCESS_MODE_ALWAYS
	add_child(p)
	return p


func _bus_or_master(name_s: String) -> String:
	# If default_bus_layout.tres ever fails to load we still make noise.
	return name_s if AudioServer.get_bus_index(name_s) >= 0 else BUS_MASTER


# ---------------------------------------------------------------- streams
func _stream(path: String) -> AudioStream:
	if _cache.has(path):
		return _cache[path]
	var s: AudioStream = null
	if ResourceLoader.exists(path):
		s = load(path)
	if s == null and not _warned.has(path):
		_warned[path] = true
		push_warning("Audio: missing %s (run tools/gen_audio.py)" % path)
	_cache[path] = s
	return s


# Pick a variant, but never the same one twice running: a repeated bounce is
# the single fastest way to make a game sound cheap.
func _pick(name_s: String, n: int) -> int:
	if n <= 1:
		return 1
	var v := _rng.randi_range(1, n)
	if _last.get(name_s, 0) == v:
		v = v % n + 1
	_last[name_s] = v
	return v


func _free_slot() -> int:
	for i in POLY:
		var idx := (_pool_at + i) % POLY
		if not _pool[idx].playing:
			_pool_at = (idx + 1) % POLY
			return idx
	# everything is busy: steal the voice that started longest ago
	var stolen := _pool_at
	_pool_at = (_pool_at + 1) % POLY
	return stolen


# ---------------------------------------------------------------- one-shots
func sfx(name_s: String, db := 0.0) -> AudioStreamPlayer:
	return sfx_at(name_s, 0.0, db)


## pan is -1 (left kerb) .. +1 (right kerb). variant 0 rolls the dice; pass
## 1..n when the game means a specific one (the rising sewer pings).
func sfx_at(name_s: String, pan := 0.0, db := 0.0, variant := 0) -> AudioStreamPlayer:
	if not enabled or not BANK.has(name_s):
		if enabled and not _warned.has(name_s):
			_warned[name_s] = true
			push_warning("Audio: no cue named '%s'" % name_s)
		return null
	var d: Dictionary = BANK[name_s]
	var n := int(d["n"])
	var v := clampi(variant, 1, n) if variant > 0 else _pick(name_s, n)
	var s := _stream("%s%s_%d.wav" % [SFX_DIR, name_s, v])
	if s == null:
		return null
	var idx := _free_slot()
	var p := _pool[idx]
	_pan[idx].pan = clampf(pan, -1.0, 1.0)
	var rng: Array = d["pitch"]
	p.stream = s
	p.pitch_scale = _rng.randf_range(float(rng[0]), float(rng[1]))
	p.volume_db = float(d["db"]) + db
	p.play()
	return p


## Where a sound happens on the street, in world x. Handy for the ball: the
## kerbs are the edges of the stereo field.
func sfx_world(name_s: String, world_x: float, db := 0.0) -> AudioStreamPlayer:
	var half: float = maxf((Tuning.WALL_R - Tuning.WALL_L) * 0.5, 1.0)
	return sfx_at(name_s, clampf((world_x - Tuning.PLATE.x) / half, -1.0, 1.0), db)


# ---------------------------------------------------------------- announcer
## One megaphone, one mouth: a new line cuts the old one off, and the bed
## ducks under it the way a broadcast would.
func announce(kind := "", db := 0.0) -> void:
	if not enabled:
		return
	var pool := String(ANNOUNCE.get(kind, "patter_call"))
	var n := int(VOX.get(pool, 0))
	if n <= 0:
		return
	var s := _stream("%s%s_%d.wav" % [VOX_DIR, pool, _pick(pool, n)])
	if s == null:
		return
	_voice.stream = s
	_voice.pitch_scale = _rng.randf_range(0.96, 1.05)
	_voice.volume_db = db
	_voice.play()
	duck(maxf(s.get_length() - 0.3, DUCK_HOLD), -7.0)


# ---------------------------------------------------------------- music
## The bed: "title", "game", or "" to stop. One-shots ("playball",
## "gameover", "cheese") belong in sting(), which plays over the top instead
## of replacing whatever is running.
func music(key := "") -> void:
	if not enabled or key == _music_key:
		return
	_music_key = key
	if _music_tw != null:
		_music_tw.kill()
	var old := _music[_music_at]
	if old.playing:
		var out_tw := create_tween()
		out_tw.tween_property(old, "volume_db", -40.0, MUSIC_FADE)
		out_tw.tween_callback(old.stop)
	if key == "":
		return
	if not MUSIC.has(key):
		push_warning("Audio: no music named '%s'" % key)
		return
	var d: Dictionary = MUSIC[key]
	var s := _stream("%s%s_1.wav" % [MUSIC_DIR, key])
	if s == null:
		return
	# The wavs carry a `smpl` chunk so Godot imports the beds as looping; set
	# it anyway, so a re-import with different settings cannot silently turn
	# the title music into a one-shot.
	if s is AudioStreamWAV:
		var w: AudioStreamWAV = s
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD if bool(d["loop"]) \
			else AudioStreamWAV.LOOP_DISABLED
	_music_at = 1 - _music_at
	var p := _music[_music_at]
	p.stream = s
	p.volume_db = -40.0
	p.play()
	_music_tw = create_tween()
	_music_tw.tween_property(p, "volume_db", float(d["db"]), MUSIC_FADE * 0.7)


## A stinger: a one-shot off the music bank that plays OVER the bed instead
## of replacing it (PLAY BALL, CHEESE IT, the game-over cadence).
func sting(key: String, db := 0.0) -> void:
	if not enabled or not MUSIC.has(key):
		return
	var s := _stream("%s%s_1.wav" % [MUSIC_DIR, key])
	if s == null:
		return
	if s is AudioStreamWAV:
		(s as AudioStreamWAV).loop_mode = AudioStreamWAV.LOOP_DISABLED
	_sting.stream = s
	_sting.volume_db = float(MUSIC[key]["db"]) + db
	_sting.play()
	duck(maxf(s.get_length() - 0.6, DUCK_HOLD), -6.0)


## Duck the bed for `hold` seconds — used automatically by announce() and
## sting(), and callable directly for anything else that has to be heard.
func duck(hold := DUCK_HOLD, amount_db := DUCK_DB) -> void:
	if not enabled:
		return
	var bus := AudioServer.get_bus_index(BUS_MUSIC)
	if bus < 0:
		return
	if _duck_tw != null:
		_duck_tw.kill()
	var set_db := func(v: float) -> void:
		AudioServer.set_bus_volume_db(bus, _music_rest_db + v)
	_duck_tw = create_tween()
	_duck_tw.tween_method(set_db, 0.0, amount_db, 0.12)
	_duck_tw.tween_interval(hold)
	_duck_tw.tween_method(set_db, amount_db, 0.0, 0.5)


# ---------------------------------------------------------------- beds
## The gang on the kerb, murmuring. Loops until turned off.
func crowd(on: bool, db := -4.0) -> void:
	if not enabled:
		return
	if not on:
		if _bed.playing:
			var tw := create_tween()
			tw.tween_property(_bed, "volume_db", -40.0, 0.8)
			tw.tween_callback(_bed.stop)
		return
	if _bed.playing:
		return
	var s := _stream("%scrowd_idle_1.wav" % SFX_DIR)
	if s == null:
		return
	if s is AudioStreamWAV:
		(s as AudioStreamWAV).loop_mode = AudioStreamWAV.LOOP_FORWARD
	_bed.stream = s
	_bed.volume_db = -40.0
	_bed.play()
	var tw := create_tween()
	tw.tween_property(_bed, "volume_db", db, 1.2)


## Drop every cached stream. The game never needs this — the headless test
## does, so the engine does not report the whole bank as leaked at exit.
func forget() -> void:
	stop_all()
	for p in _pool:
		p.stream = null
	if _voice != null:
		_voice.stream = null
	if _sting != null:
		_sting.stream = null
	if _bed != null:
		_bed.stream = null
	for p in _music:
		p.stream = null
	_cache.clear()


func stop_all() -> void:
	if not enabled:
		return
	for p in _pool:
		p.stop()
	_voice.stop()
	_sting.stop()
	_bed.stop()
	for p in _music:
		p.stop()
	_music_key = ""
	if _duck_tw != null:
		_duck_tw.kill()
	var bus := AudioServer.get_bus_index(BUS_MUSIC)
	if bus >= 0:
		AudioServer.set_bus_volume_db(bus, _music_rest_db)

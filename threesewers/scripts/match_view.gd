extends Node2D
# THREE SEWERS — match presentation layer.
# Data-driven ball, silent-film cards, chalk HUD. Rules live in MatchCore;
# nothing here mutates game state except through core's public calls.

signal pitch_resolved(ev: Dictionary)
signal ball_done
signal throw_choice(c: String)
signal ui_pitch(p: Dictionary)

# ---------------------------------------------------------------- view constants
# (world layout + feel constants come from Tuning; these are presentation-only)
const FIELDER_SCALE := 0.8
const BATTER_POS := Vector2(662, 2352)
const PITCH_HAND_OFF := Vector2(0, -40)     # release point above pitcher origin
const PITCH_BOUNCE_Y := 2278.0              # one-bounce point short of the plate
const PITCH_BOUNCE_LANE_X := 46.0
const PITCH_CROSS_LANE_X := 55.0
const PITCH_TB := 0.22                      # bounce -> plate time
const PITCH_TB_DROP := 0.3                  # the drop dies off the bounce
const PITCH_ARC_H := 70.0
const PITCH_ARC_BOB := 26.0
const MITT_TIME := 0.12                     # past the plate into the mitt
const MITT_OFF := Vector2(0, -30)
const BALL_SCALE := 1.4
const HIT_PEAK := {"fly": 300.0, "line": 130.0, "ground": 45.0}
const HIT_LANE_X := 300.0
const HIT_JITTER := 20.0
const HIT_CARRY_PX := 1400.0
const FLY_T := 0.85
const FLY_T_CARRY := 0.5
const LINE_T := 0.5
const GROUND_T := 0.45
const GROUND_ROLL_T := 0.35
const GROUND_ROLL_PX := 110.0
const HR_ROLL_T := 0.8
const HR_ROLL_PX := 240.0
const WALL_BALL_MARGIN := 18.0
const THROW_ARC_H := 34.0
const THROW_T := 0.28
const RUN_LEG_T := 0.34
const SLIDE_HOLD := 0.4
const CELEBRATE_HOLD := 0.5
const CAM_CHASE_MIN_Y := 860.0
const CAM_CHASE_MAX_Y := 2130.0
const CAM_CHASE_LEAD := 140.0
const CAM_CHASE_LERP := 6.0
const CAM_HOME_T := 0.5
const PITCH_WINDUP_T := 0.45
const BAR_SPEED := 1.5                      # ping-pong sweeps per second
const AIM_Q_MID := 0.35                     # timing needed to find the zone, middle lane
const AIM_Q_EDGE := 0.6                     # corners are riskier
const TICK_CHAR_T := 0.018
const FX_RISE := 64.0
const FX_LIFE := 0.9
const SCATTER_PX := 30.0
const RUN_LEAN := 5.0                       # degrees a running kid leans
const NIGHT_TINT := Color(0.72, 0.63, 0.50)  # warm gothic dusk, amber-lit
const SMOKE_GUARD_REAL_S := 300.0
const SEWER_TEXTS := ["ONE SEWER…", "TWO SEWERS…", "THREE SEWERS…"]
const PITCH_PATTER_CHANCE := 0.3
const CHEESE_CARD_T := 1.2
const SETTLE_PAD := 0.35
const PIP_DIM := Color(0.28, 0.26, 0.27, 0.4)
const SHAKE_DECAY := 0.36
const HITSTOP_MIN := 0.035
const HITSTOP_GAIN := 0.075
const TRAIL_MAX := 16

# ---------------------------------------------------------------- kid sprite node
class Kid extends Node2D:
	# Names only — Game.frames() discovers how many frames each one actually
	# has, so the art generators can re-time an animation without the view
	# needing to know.
	const ANIMS: PackedStringArray = ["idle", "bat_stance", "swing", "run",
		"pitch", "throw", "catch", "slide", "celebrate", "sulk", "walk",
		"bat_back", "swing_back"]

	var kid_id := ""
	var anim := ""
	var rest_anim := "idle"   # one-shots fall back to this
	var spr: Sprite2D
	var shadow: Sprite2D
	var _frames: Array = []
	var _fps := 8.0
	var _loop := true
	var _t := 0.0

	func _init(id: String) -> void:
		kid_id = id
		var shadow_tex: Texture2D = Game.prop("shadow")
		if shadow_tex != null:
			shadow = Sprite2D.new()
			shadow.texture = shadow_tex
			shadow.scale = Vector2(Tuning.ART, Tuning.ART) * 0.78
			shadow.modulate = Color(1, 1, 1, 0.8)
			add_child(shadow)
		spr = Sprite2D.new()
		add_child(spr)

	var wpos := Vector2.ZERO          # world position; screen is derived
	var depth_mul := 1.0              # extra size trim, e.g. background kids
	var _facing := 1.0
	var _lean := 0.0

	# Art is authored at 2x for retina, and animations use different canvas
	# widths, so the offset is derived per texture: bottom edge on the node
	# origin keeps the kid's feet planted and the y-sort honest.
	func _set_tex(t: Texture2D) -> void:
		if t == null or spr.texture == t:
			return
		spr.texture = t
		spr.offset = Vector2(0, -t.get_height() * 0.5)

	# One projection for everything: where the kid stands on the street decides
	# both where it lands on screen and how big it is.
	func _apply_projection() -> void:
		var pr := Tuning.project(wpos, 0.0)
		position = Vector2(pr.x, pr.y)
		var sc := Tuning.sprite_scale(pr.z) * depth_mul
		spr.scale = Vector2(sc * _facing, sc)
		if shadow != null:
			shadow.scale = Vector2(sc, sc) * 0.78
		z_index = int(clampf(pr.z * 4096.0, 0.0, 4000.0))

	# The kids are drawn front-on, so travel direction is sold by mirroring
	# them and leaning them into the run.
	func face(dx: float, lean_deg := 0.0) -> void:
		if absf(dx) > 0.5:
			_facing = signf(dx)
		_lean = lean_deg * (_facing if lean_deg != 0.0 else 1.0)
		spr.rotation_degrees = _lean

	func play(a: String, fps := 8.0, loop := true) -> void:
		if anim == a and _loop and loop:
			return
		anim = a
		_fps = fps
		_loop = loop
		_t = 0.0
		_frames = Game.frames(kid_id, a)
		if not _frames.is_empty():
			_set_tex(_frames[0])

	static var frame_usec := 0

	func _process(delta: float) -> void:
		var _t0 := Time.get_ticks_usec()
		_apply_projection()
		if _frames.is_empty():
			frame_usec += Time.get_ticks_usec() - _t0
			return
		_t += delta
		var idx := int(_t * _fps)
		if _loop:
			idx %= _frames.size()
		elif idx >= _frames.size():
			if rest_anim != "" and anim != rest_anim:
				play(rest_anim)
				return
			idx = _frames.size() - 1
		_set_tex(_frames[idx])
		frame_usec += Time.get_ticks_usec() - _t0

# ---------------------------------------------------------------- members
var autopilot := false
var _perf := false                 # --perf: sample frame times and report

var core := MatchCore.new()
var bg: Node2D
var stage: Node2D
var fx: Node2D
var world_root: Node2D
var hud: CanvasLayer
var cards: TitleCards

var fielders := {}                 # pos -> Kid
var batter_node: Kid = null
var runner_nodes := {}             # kid id -> Kid
var window_spr: Sprite2D = null    # THE window
var _built_field_side := -1
var _base_pos: Array[Vector2] = []

# ball
var ball: Node2D
var ball_spr: Sprite2D
var ball_shadow: Sprite2D
var _ball_mode := ""               # "", "pitch", "hit"
var _bt := 0.0
var _ball_flying := false

# pitch state
var _pd := {}                      # active pitch dict
var _plan := {}                    # cpu swing plan ({} = human batter)
var _pA := Vector2.ZERO
var _pB := Vector2.ZERO
var _pC := Vector2.ZERO
var _ta := 0.6
var _tb := PITCH_TB
var _cross_t := 0.8
var _rest_h := 0.7
var _mitt := Vector2.ZERO
var _v0a := 0.0                    # phase-A launch velocity (up +)
var _v2 := 0.0                     # rebound velocity off the bounce
var _spin_bow := 0.0               # spinner's pre-bounce Magnus drift
var _h_hops: Array[Vector2] = []   # grounder hop chain: (start_u, peak)
var _committed := false            # human tap landed in the window
var _commit_err := 0.0
var _vis_committed := false        # a swing anim has fired (human or cpu)
var _vis_commit_t := -1.0
var _human_bat := false

# hit state
var _h_from := Vector2.ZERO
var _h_land := Vector2.ZERO
var _h_peak := 0.0
var _h_dur := 0.5
var _h_loft := "ground"
var _h_carry := 0.0
var _h_caught := false
var _h_window := false
var _h_roll_t := 0.0
var _h_roll_px := 0.0
var _h_roll_dir := Vector2.ZERO
var _sewer_prev_y := 0.0
var bw := Vector2.ZERO             # ball world position
var bh := 0.0                      # ball height off the cobbles

# hud refs
var score_plate: PanelContainer
var count_plate: PanelContainer
var vis_lbl: Label
var gang_lbl: Label
var inn_lbl: Label
var ball_pips: Array[TextureRect] = []
var strike_pips: Array[TextureRect] = []
var out_pips: Array[TextureRect] = []
var swing_btn: TextureButton
var action_btn: TextureButton
var hud_root: Control
var tick_lbl: Label
var hint_lbl: Label
var pitch_panel: PanelContainer
var pitch_select: VBoxContainer
var pitch_timing: VBoxContainer
var bar_track: Control
var bar_marker: ColorRect
var throw_panel: PanelContainer
var throw_buttons: HBoxContainer
var throw_bar: ColorRect
var _last_runs := -1
var _tick_tw: Tween
var _cam_tw: Tween
var _card_busy := false
# game feel
var _root_home := Vector2.ZERO      # world_root rest position; shake offsets from here
var _shake_amt := 0.0
var _shake_t := 0.0
var _base_scale := 1.0
var trail: Line2D
var _trail: Array[Vector2] = []
var _bounced := false
# perf: sampled every frame during a soak so the 60fps bar is a measurement,
# not a hope
var _ft: Array[float] = []
var _ft_worst := 0.0
var _t_ball := 0
var _t_hud := 0
var _t_kids := 0
var _pitch_lane := 0
var _pitch_type := "fast"
var _bar_clock := 0.0
var _bar_running := false
var _throw_waiting := false
var _throw_left := 0.0
var _throw_total := 1.4

# ---------------------------------------------------------------- setup
func _ready() -> void:
	_perf = "--perf" in OS.get_cmdline_user_args()
	if "--rt" in OS.get_cmdline_user_args():
		# The soak runs at 10x, which packs 10x the choreography into every
		# wall-clock second and makes frame cost look far worse than real play.
		# --rt measures at true speed.
		Engine.time_scale = 1.0
		get_tree().create_timer(45.0, true, false, true).timeout.connect(
			func() -> void:
				_report_perf()
				get_tree().quit(0))
	_base_pos = [Tuning.BASE_1, Tuning.BASE_2, Tuning.BASE_3, Tuning.PLATE]
	core.setup(Game.cpu_team, Game.player_team, Game.roster, 1, Tuning.INNINGS)
	_build_layers()
	_build_world()
	get_viewport().size_changed.connect(_on_resized)
	_build_ball()
	_build_hud()
	_warm_textures()
	if Game.smoke:
		var guard := get_tree().create_timer(SMOKE_GUARD_REAL_S, true, false, true)
		guard.timeout.connect(func() -> void:
			if not core.game_over:
				push_error("SMOKE GUARD TIMEOUT")
				get_tree().quit(1))
	run_match()

# Every animation's frames are pulled through Game.frames() the first time a
# kid plays it — which meant the first slide, the first celebrate and the first
# sulk each paid a disk hit mid-play. Measured as p99 frame spikes. Warming the
# whole roster up front moves that cost to the loading beat, where nobody feels
# it.
func _warm_textures() -> void:
	var ids: Array = []
	for side in 2:
		for id in core.lineups[side]:
			if not (id in ids):
				ids.append(id)
	for id in ids:
		for anim in Kid.ANIMS:
			Game.frames(String(id), anim)
	Game.frames("cop", "walk")
	Game.frames("announcer", "idle")

func _build_layers() -> void:
	# Pick the projection from the real screen shape, then fit the design
	# space to it. Portrait is the reference composition; landscape sits the
	# horizon lower. Both ship, so the same build runs either way on a phone.
	var vp := get_viewport_rect().size
	Tuning.use_view(vp.y > vp.x)
	world_root = Node2D.new()
	world_root.name = "view"
	var k: float = maxf(vp.x / Tuning.vw, vp.y / Tuning.vh)
	world_root.scale = Vector2(k, k)
	world_root.position = vp * 0.5 - Vector2(Tuning.vw, Tuning.vh) * 0.5 * k
	add_child(world_root)
	bg = Node2D.new()
	bg.name = "bg"
	world_root.add_child(bg)
	stage = Node2D.new()
	stage.name = "stage"
	stage.y_sort_enabled = false      # depth is explicit via z_index now
	world_root.add_child(stage)
	fx = Node2D.new()
	fx.name = "fx"
	world_root.add_child(fx)
	_root_home = world_root.position
	_base_scale = k
	# the spaldeen leaves a streak on a hard hit — the eye needs something to
	# follow when the ball is small and the street is long
	trail = Line2D.new()
	trail.width = 7.0
	trail.z_index = 3500
	trail.joint_mode = Line2D.LINE_JOINT_ROUND
	trail.begin_cap_mode = Line2D.LINE_CAP_ROUND
	trail.end_cap_mode = Line2D.LINE_CAP_ROUND
	var grad := Gradient.new()
	grad.set_color(0, Color(Tuning.PINK, 0.0))
	grad.set_color(1, Color(Tuning.PINK, 0.62))
	trail.gradient = grad
	var wcurve := Curve.new()
	wcurve.add_point(Vector2(0.0, 0.15))
	wcurve.add_point(Vector2(1.0, 1.0))
	trail.width_curve = wcurve
	fx.add_child(trail)
	hud = CanvasLayer.new()
	hud.layer = 10
	add_child(hud)
	cards = TitleCards.new()
	add_child(cards)
	var flicker := CanvasLayer.new()
	flicker.layer = 30
	var film := ColorRect.new()
	film.set_anchors_preset(Control.PRESET_FULL_RECT)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/film.gdshader")
	film.material = mat
	film.mouse_filter = Control.MOUSE_FILTER_IGNORE
	flicker.add_child(film)
	add_child(flicker)

# The phone can be turned over mid-game: pick the other projection, refit the
# view and re-lay the baked street. Kids and the ball project every frame, so
# they need no help.
func _on_resized() -> void:
	var vp := get_viewport_rect().size
	if vp.x <= 0.0 or vp.y <= 0.0:
		return
	Tuning.use_view(vp.y > vp.x)
	var k: float = maxf(vp.x / Tuning.vw, vp.y / Tuning.vh)
	world_root.scale = Vector2(k, k)
	world_root.position = vp * 0.5 - Vector2(Tuning.vw, Tuning.vh) * 0.5 * k
	_root_home = world_root.position
	_base_scale = k
	for c in bg.get_children():
		c.queue_free()
	window_spr = null
	_build_world()
	_fit_hud_root()

func _view_punch(amount: float, t := 0.5) -> void:
	if _cam_tw != null:
		_cam_tw.kill()
	var base: float = maxf(get_viewport_rect().size.x / Tuning.vw,
		get_viewport_rect().size.y / Tuning.vh)
	_cam_tw = create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_cam_tw.tween_property(world_root, "scale",
		Vector2(base, base) * (1.0 + amount), t)

# ---------------------------------------------------------------- world
const STREET_TOP := 600.0
const STREET_BOT := 2600.0
const STREET_L := -200.0
const STREET_R := 1480.0
const WALK_W := 62.0                        # sidewalk between curb and building

func _build_world() -> void:
	# The street is baked in perspective by tools/art_backdrop.py through the
	# same projection Tuning uses, so scenery and sprites share one vanishing
	# point. Only things the game has to change at runtime stay live.
	var key := "portrait" if Tuning.v_portrait else "landscape"
	var path := "res://assets/bg/bg_%s.png" % key
	if ResourceLoader.exists(path):
		var back := Sprite2D.new()
		back.texture = load(path)
		back.centered = false
		back.scale = Vector2(Tuning.ART, Tuning.ART)
		bg.add_child(back)
	# THE window, swapped to broken glass on the window home run
	var wtex: Texture2D = Game.prop("window")
	if wtex != null:
		window_spr = Sprite2D.new()
		window_spr.texture = wtex
		var pr := Tuning.project(Tuning.WINDOW_POS, 520.0)
		window_spr.position = Vector2(pr.x, pr.y)
		window_spr.scale = Vector2.ONE * Tuning.sprite_scale(pr.z) * 1.3
		window_spr.z_index = 10
		bg.add_child(window_spr)
	_chalk_lines()

func _chalk_lines() -> void:
	# Chalk is drawn live so it sits on top of the cobbles at the right depth.
	_chalk_run(Tuning.PLATE, Vector2(Tuning.WALL_L, 2110))
	_chalk_run(Tuning.PLATE, Vector2(Tuning.WALL_R, 2110))
	var box := 120.0
	for side in [-1.0, 1.0]:
		var x: float = Tuning.PLATE.x + side * 150.0
		_chalk_run(Vector2(x - box * 0.5, Tuning.PLATE.y + box),
			Vector2(x - box * 0.5, Tuning.PLATE.y - box), 1.0)
		_chalk_run(Vector2(x + box * 0.5, Tuning.PLATE.y + box),
			Vector2(x + box * 0.5, Tuning.PLATE.y - box), 1.0)

func _chalk_run(from: Vector2, to: Vector2, alpha := 0.72) -> void:
	# A straight line in the world is still straight on screen, but its width
	# has to taper with depth, so it is drawn as a run of short segments.
	var steps := 26
	for i in steps:
		if i % 2 == 1:
			continue
		var t0 := float(i) / steps
		var t1 := float(i + 1) / steps
		var a := from.lerp(to, t0)
		var b := from.lerp(to, t1)
		var pa := Tuning.project(a)
		var pb := Tuning.project(b)
		var seg := Line2D.new()
		seg.points = PackedVector2Array([Vector2(pa.x, pa.y), Vector2(pb.x, pb.y)])
		seg.width = maxf(1.0, 9.0 * pa.z * Tuning.v_xk * Tuning.ART)
		seg.default_color = Color(Tuning.CHALK, alpha)
		seg.z_index = 1
		bg.add_child(seg)

# -- prop helpers: art is authored at 2x, Tuning.ART puts it back in world scale
func _spr(tex: Texture2D, world: Vector2, mul := 1.0, height := 0.0) -> Sprite2D:
	var s := Sprite2D.new()
	s.texture = tex
	var pr := Tuning.project(world, height)
	s.position = Vector2(pr.x, pr.y)
	s.scale = Vector2.ONE * Tuning.sprite_scale(pr.z) * mul
	s.z_index = int(clampf(pr.z * 4096.0, 0.0, 4000.0))
	return s

func _build_ball() -> void:
	ball = Node2D.new()
	ball_shadow = Sprite2D.new()
	ball_shadow.texture = Game.prop("spaldeen")
	ball_shadow.modulate = Color(0, 0, 0, 0.3)
	ball.add_child(ball_shadow)
	ball_spr = Sprite2D.new()
	ball_spr.texture = Game.prop("spaldeen")
	ball.add_child(ball_spr)
	ball.visible = false
	stage.add_child(ball)

func _apply_ball() -> void:
	var pr := Tuning.project(bw, bh)
	ball.position = Vector2(pr.x, pr.y)
	var sc := Tuning.sprite_scale(pr.z)
	ball_spr.scale = Vector2(BALL_SCALE, BALL_SCALE) * sc
	ball.z_index = int(clampf(pr.z * 4096.0, 0.0, 4000.0)) + 1
	# the shadow stays on the ground, so it is projected without the height
	var gr := Tuning.project(bw, 0.0)
	ball_shadow.position = Vector2(gr.x, gr.y) - ball.position
	ball_shadow.scale = Vector2(1.3, 0.55) * sc
	ball_shadow.modulate = Color(0, 0, 0, clampf(0.34 - bh * 0.0002, 0.10, 0.34))

# ---------------------------------------------------------------- kids on the field
func _spawn_kid(id: String, pos: Vector2, kid_scale := 1.0) -> Kid:
	var k := Kid.new(id)
	k.wpos = pos
	k.depth_mul = kid_scale
	stage.add_child(k)
	return k

func _setup_sides(force := false) -> void:
	var fs := core.fielding_side()
	if force or fs != _built_field_side:
		_built_field_side = fs
		for pos_key in fielders:
			fielders[pos_key].queue_free()
		fielders.clear()
		var lineup: Dictionary = core.positions[fs]
		var i := 0
		for pos_key in MatchCore.POS_LIST:
			# The catcher crouches behind the camera in this view, so he is
			# played but never drawn — rendering him fills the whole frame.
			if pos_key == "C":
				continue
			var k := _spawn_kid(lineup[pos_key], Tuning.FIELD_POS[pos_key], 1.0)
			k.play("idle", 6.0 + 0.4 * i)
			fielders[pos_key] = k
			i += 1
	_ensure_batter()

func _ensure_batter() -> void:
	if core.game_over:
		return
	var bid := core.batter_id()
	if batter_node != null and is_instance_valid(batter_node) and batter_node.kid_id == bid:
		return
	if batter_node != null and is_instance_valid(batter_node):
		batter_node.queue_free()
	batter_node = _spawn_kid(bid, BATTER_POS)
	# the camera is over his shoulder, so the batter wears the back-view art
	batter_node.rest_anim = "bat_back"
	batter_node.play("bat_back", 4.0)

func _sync_runners() -> void:
	# core.bases is the truth; heal any drift before each pitch
	var want := {}
	for i in 3:
		var id: String = core.bases[i]
		if id != "":
			want[id] = _base_pos[i]
	for id in runner_nodes.keys():
		if not want.has(id) or not is_instance_valid(runner_nodes[id]):
			if is_instance_valid(runner_nodes[id]):
				runner_nodes[id].queue_free()
			runner_nodes.erase(id)
	for id in want:
		if runner_nodes.has(id):
			runner_nodes[id].wpos = want[id]
			runner_nodes[id].play("idle", 6.0)
		else:
			var k := _spawn_kid(id, want[id])
			k.play("idle", 6.0)
			runner_nodes[id] = k

func _free_runner(id: String) -> void:
	if runner_nodes.has(id):
		if is_instance_valid(runner_nodes[id]):
			runner_nodes[id].queue_free()
		runner_nodes.erase(id)

func _field_kids() -> Array:
	var out := []
	for pos_key in fielders:
		if is_instance_valid(fielders[pos_key]):
			out.append(fielders[pos_key])
	for id in runner_nodes:
		if is_instance_valid(runner_nodes[id]):
			out.append(runner_nodes[id])
	if batter_node != null and is_instance_valid(batter_node):
		out.append(batter_node)
	return out

# ---------------------------------------------------------------- match flow
func run_match() -> void:
	_update_hud(core.snapshot())
	await _card("PLAY BALL!", "", 0.9)
	ticker(Announcer.line("pregame", core.kid_name(core.batter_id())))
	while not core.game_over:
		_setup_sides()
		_sync_runners()
		var pitch: Dictionary = await _get_pitch()
		core.begin_pitch(pitch)
		var plan := {}
		if autopilot or not core.human_batting():
			plan = core.cpu_swing(pitch)
		if randf() < PITCH_PATTER_CHANCE:
			ticker(Announcer.line("pitch", core.kid_name(core.pitcher_id())))
		var pk: Kid = fielders.get("P")
		if pk != null and is_instance_valid(pk):
			pk.play("pitch", 10.0, false)
		await _beat(PITCH_WINDUP_T)
		_start_pitch(pitch, plan)
		var ev: Dictionary = await pitch_resolved
		await _choreo(ev)
		var hc := core.check_half()
		if hc["changed"] and not core.game_over:
			await _side_away(hc)
	await _finale()

func _beat(t: float) -> void:
	await get_tree().create_timer(t).timeout

func _get_pitch() -> Dictionary:
	if autopilot:
		await _beat(0.05)
		return core.make_cpu_pitch()
	if core.fielding_side() == core.user_side:
		_show_pitch_ui()
		var p: Dictionary = await ui_pitch
		return p
	return core.make_cpu_pitch()

# ---------------------------------------------------------------- pitch timeline
func _start_pitch(pitch: Dictionary, plan: Dictionary) -> void:
	_pd = pitch
	_plan = plan
	_human_bat = not autopilot and core.human_batting()
	_committed = false
	_commit_err = 0.0
	_vis_committed = false
	_vis_commit_t = -1.0
	var lane := float(pitch["lane"])
	var ptype := String(pitch["type"])
	_ta = float(Tuning.PITCH_TIMES[ptype])
	_tb = PITCH_TB_DROP if ptype == "drop" else PITCH_TB
	_cross_t = _ta + _tb
	_rest_h = float(Tuning.BOUNCE_REST[ptype])
	var pitcher_pos: Vector2 = Tuning.FIELD_POS["P"]
	_pA = pitcher_pos + PITCH_HAND_OFF
	_pB = Vector2(Tuning.PLATE.x + lane * PITCH_BOUNCE_LANE_X, PITCH_BOUNCE_Y)
	var spin := float(Tuning.SPIN_KICK[ptype])
	if ptype == "spinner" and randf() < 0.5:
		spin = -spin
	_pC = Vector2(Tuning.PLATE.x + lane * PITCH_CROSS_LANE_X + spin, Tuning.PLATE.y)
	var cpos: Vector2 = Tuning.FIELD_POS["C"]
	_mitt = cpos + MITT_OFF
	# Ballistics. Phase A: a real toss — launch velocity chosen so the ball
	# leaves the hand at PITCH_ARC_H and meets the cobbles exactly at ta, so
	# the swing clock (cross_t) is untouched. Phase B: the spaldeen rebounds
	# with the pitch's liveliness expressed as a rebound apex; the fast one
	# crosses the plate high on the hop, the drop dies low off the bounce.
	_v0a = (0.5 * Tuning.BALL_G * _ta * _ta - PITCH_ARC_H) / _ta
	_v2 = sqrt(2.0 * Tuning.BALL_G * _rest_h * PITCH_ARC_H)
	# the spinner leans away before the bounce, then takes on it — the kick
	# already lives in _pC.x, so the bow bends opposite for the deception
	_spin_bow = -spin * 0.35
	if not _plan.is_empty() and bool(_plan.get("swing", false)):
		_vis_commit_t = _cross_t + clampf(float(_plan["err_ms"]) / 1000.0,
			-Tuning.SWING_EARLY, Tuning.SWING_LATE - 0.02)
	ball.visible = true
	bw = _pA
	bh = PITCH_ARC_H
	_bt = 0.0
	_bounced = false
	_ball_mode = "pitch"

func _unhandled_input(event: InputEvent) -> void:
	var pressed := false
	if event is InputEventScreenTouch and event.pressed:
		pressed = true
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		pressed = true
	if pressed:
		_try_swing()

func _try_swing() -> void:
	if autopilot or _ball_mode != "pitch" or not _human_bat or _committed:
		return
	if _bt < _cross_t - Tuning.SWING_EARLY or _bt > _cross_t + Tuning.SWING_LATE:
		return
	_committed = true
	_vis_committed = true
	_commit_err = (_bt - _cross_t) * 1000.0
	if batter_node != null and is_instance_valid(batter_node):
		batter_node.play("swing_back", 14.0, false)
	hint_lbl.visible = false
	swing_btn.visible = false

func _process(delta: float) -> void:
	if not _perf:
		_process_ball(delta)
		_process_hud(delta)
		_process_shake(delta)
		return
	var ms := float(Performance.get_monitor(Performance.TIME_PROCESS)) * 1000.0
	_ft.append(ms)
	_ft_worst = maxf(_ft_worst, ms)
	var t0 := Time.get_ticks_usec()
	_process_ball(delta)
	var t1 := Time.get_ticks_usec()
	_process_hud(delta)
	_process_shake(delta)
	var t2 := Time.get_ticks_usec()
	_t_ball += t1 - t0
	_t_hud += t2 - t1
	_t_kids += Kid.frame_usec
	Kid.frame_usec = 0

# ---------------------------------------------------------------- game feel
func _process_shake(delta: float) -> void:
	if _shake_t <= 0.0:
		return
	_shake_t = maxf(0.0, _shake_t - delta)
	var falloff := _shake_t / maxf(SHAKE_DECAY, 0.001)
	var a := _shake_amt * falloff * falloff
	world_root.position = _root_home + Vector2(
		randf_range(-a, a), randf_range(-a, a))
	if _shake_t <= 0.0:
		world_root.position = _root_home

func shake(amount: float) -> void:
	_shake_amt = maxf(_shake_amt, amount)
	_shake_t = SHAKE_DECAY

# A real freeze: everything stops for a beat so the eye registers the hit.
# The timer ignores time_scale so it lasts the same wall-clock time no matter
# what Engine.time_scale is doing (the soak runs at 10x).
func hit_stop(seconds: float) -> void:
	if Game.smoke or seconds <= 0.0:
		return
	var prev := Engine.time_scale
	Engine.time_scale = 0.0001
	await get_tree().create_timer(seconds, true, false, true).timeout
	Engine.time_scale = prev

# One-shot particle burst at a world point, sized by its depth so a puff up
# the street is as small as the kid standing next to it.
func _burst(world: Vector2, height: float, cfg: Dictionary) -> void:
	var pr := Tuning.project(world, height)
	var s: float = Tuning.sprite_scale(pr.z)
	var p := CPUParticles2D.new()
	p.position = Vector2(pr.x, pr.y)
	p.z_index = int(clampf(pr.z * 4096.0, 0.0, 4000.0)) + 2
	p.emitting = true
	p.one_shot = true
	p.explosiveness = float(cfg.get("explosive", 0.95))
	p.amount = int(cfg.get("amount", 12))
	p.lifetime = float(cfg.get("life", 0.5))
	p.direction = cfg.get("dir", Vector2(0, -1))
	p.spread = float(cfg.get("spread", 60.0))
	p.initial_velocity_min = float(cfg.get("vmin", 40.0)) * s
	p.initial_velocity_max = float(cfg.get("vmax", 130.0)) * s
	p.gravity = Vector2(0, float(cfg.get("grav", 520.0)) * s)
	p.scale_amount_min = float(cfg.get("smin", 1.4)) * s
	p.scale_amount_max = float(cfg.get("smax", 3.2)) * s
	p.damping_min = 20.0
	p.damping_max = 90.0
	var g := Gradient.new()
	g.set_color(0, cfg.get("c0", Color(Tuning.CHALK, 0.9)))
	g.set_color(1, cfg.get("c1", Color(Tuning.ASPHALT, 0.0)))
	p.color_ramp = g
	fx.add_child(p)
	var life: float = p.lifetime * 1.6
	get_tree().create_timer(life).timeout.connect(func() -> void:
		if is_instance_valid(p):
			p.queue_free())

func _fx_dust(world: Vector2, amount := 10) -> void:
	_burst(world, 0.0, {"amount": amount, "life": 0.42, "dir": Vector2(0, -1),
		"spread": 78.0, "vmin": 30.0, "vmax": 90.0, "grav": 300.0,
		"smin": 1.2, "smax": 2.8,
		"c0": Color(0.82, 0.72, 0.56, 0.55), "c1": Color(0.6, 0.52, 0.42, 0.0)})

func _fx_contact(world: Vector2, height: float, power: float) -> void:
	# a hard hit throws chalk-bright sparks; a weak one barely puffs
	_burst(world, height, {"amount": int(8 + 20 * power), "life": 0.34,
		"dir": Vector2(0, -1), "spread": 180.0,
		"vmin": 90.0 * power, "vmax": 320.0 * power, "grav": 700.0,
		"smin": 1.0, "smax": 2.6 + 2.0 * power,
		"c0": Color(1.0, 0.94, 0.78, 0.95), "c1": Color(0.95, 0.7, 0.35, 0.0)})
	var pr := Tuning.project(world, height)
	var flash_tex: Texture2D = Game.prop("lightpool")
	if flash_tex == null:
		return
	var fl := Sprite2D.new()
	fl.texture = flash_tex
	fl.position = Vector2(pr.x, pr.y)
	fl.z_index = 3600
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	fl.material = mat
	var s0: float = Tuning.sprite_scale(pr.z) * (0.9 + 1.6 * power)
	fl.scale = Vector2(s0, s0) * 0.35
	fl.modulate = Color(1, 0.92, 0.74, 0.85 * (0.4 + 0.6 * power))
	fx.add_child(fl)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(fl, "scale", Vector2(s0, s0) * 1.5, 0.22)
	tw.tween_property(fl, "modulate:a", 0.0, 0.22)
	tw.chain().tween_callback(fl.queue_free)

func _fx_glass(world: Vector2, height: float) -> void:
	_burst(world, height, {"amount": 30, "life": 0.9, "dir": Vector2(0, 1),
		"spread": 120.0, "vmin": 60.0, "vmax": 260.0, "grav": 900.0,
		"smin": 1.0, "smax": 2.4,
		"c0": Color(0.86, 0.93, 0.98, 0.95), "c1": Color(0.6, 0.72, 0.8, 0.0)})

func _process_ball(delta: float) -> void:
	if _ball_mode == "pitch":
		_bt += delta
		# cpu swing anim at its planned error
		if not _vis_committed and _vis_commit_t >= 0.0 and _bt >= _vis_commit_t:
			_vis_committed = true
			if batter_node != null and is_instance_valid(batter_node):
				batter_node.play("swing_back", 14.0, false)
		# batting hint while the window is open
		if _human_bat:
			var window_open := not _committed \
				and _bt >= _cross_t - Tuning.SWING_EARLY and _bt <= _cross_t + Tuning.SWING_LATE
			hint_lbl.visible = window_open
			swing_btn.visible = not autopilot and not _committed
			swing_btn.modulate = Color(1, 1, 1, 1.0) if window_open else Color(1, 1, 1, 0.55)
		# ball along its timeline
		if _bt < _ta:
			var u := _bt / _ta
			bw = _pA.lerp(_pB, u)
			bw.x += _spin_bow * 4.0 * u * (1.0 - u)
			bh = maxf(0.0, PITCH_ARC_H + _v0a * _bt
				- 0.5 * Tuning.BALL_G * _bt * _bt)
		elif _bt < _cross_t:
			var tau := _bt - _ta
			if not _bounced:
				_bounced = true
				_fx_dust(_pB, 9)
				shake(2.0)
			bw = _pB.lerp(_pC, tau / _tb)
			bh = maxf(0.0, _v2 * tau - 0.5 * Tuning.BALL_G * tau * tau)
		elif not _vis_committed:
			var u := minf((_bt - _cross_t) / MITT_TIME, 1.0)
			bw = _pC.lerp(_mitt, u)
			bh = PITCH_ARC_BOB * (1.0 - u)
		_apply_ball()
		# contact pending: ball holds at the plate until the window closes
		if _bt >= _cross_t + Tuning.SWING_LATE:
			_resolve_pitch()
	elif _ball_mode == "hit":
		_bt += delta
		var pos := bw
		if _bt <= _h_dur:
			var u := _bt / _h_dur
			pos = _h_from.lerp(_h_land, u)
			bh = _hit_height(u)
		else:
			var rt := _bt - _h_dur
			if rt < _h_roll_t:
				var ru := rt / _h_roll_t
				var k := 1.0 - (1.0 - ru) * (1.0 - ru)
				pos = _h_land + _h_roll_dir * _h_roll_px * k
				bh = maxf(0.0, HIT_PEAK["ground"] * 0.3 * sin(PI * ru * 2.0) * (1.0 - ru))
			else:
				bw = _h_land + _h_roll_dir * _h_roll_px
				bh = 0.0
				_apply_ball()
				_clear_trail()
				_ball_mode = ""
				_ball_flying = false
				ball_done.emit()
				return
		if _h_carry > 0.5:
			# sewer-count chase
			for i in Tuning.SEWERS_Y.size():
				var sy: float = Tuning.SEWERS_Y[i]
				if _sewer_prev_y > sy and pos.y <= sy:
					_fx_label(SEWER_TEXTS[i], Vector2(pos.x, sy))
			_sewer_prev_y = pos.y
			pass
		bw = pos
		_apply_ball()
		_push_trail()

# A grounder is a chain of hops, each losing energy to the cobbles:
# apex_k = apex · e^2k, hop time T_k = T · e^k. Returns the total duration.
func _build_hops(first_peak: float) -> float:
	_h_hops.clear()
	var e := Tuning.GROUND_REST
	var t0 := sqrt(8.0 * first_peak / Tuning.BALL_G_CHOP)
	var total := t0 * (1.0 + e + e * e)
	var at := 0.0
	for k in 3:
		var frac := t0 * pow(e, k) / total
		_h_hops.append(Vector2(at, first_peak * pow(e, 2 * k)))
		at += frac
	return total

func _push_trail() -> void:
	if _h_carry < 0.32:
		return
	_trail.append(ball.position)
	while _trail.size() > TRAIL_MAX:
		_trail.remove_at(0)
	trail.points = PackedVector2Array(_trail)
	trail.width = 7.0 * maxf(0.35, Tuning.proj_s(bw.y) * Tuning.v_xk * 0.5)

func _clear_trail() -> void:
	_trail.clear()
	trail.points = PackedVector2Array()

func _hit_height(u: float) -> float:
	if _h_loft == "ground":
		for i in range(_h_hops.size() - 1, -1, -1):
			var start := _h_hops[i].x
			var end := _h_hops[i + 1].x if i + 1 < _h_hops.size() else 1.0
			if u >= start:
				var lu := (u - start) / maxf(end - start, 0.001)
				# each hop is its own parabola: h = 4·apex·u(1−u)
				return 4.0 * _h_hops[i].y * lu * (1.0 - lu)
		return 0.0
	# a ballistic arc IS this parabola — the sin() it replaces hangs wrong
	return 4.0 * _h_peak * u * (1.0 - u)

func _resolve_pitch() -> void:
	_ball_mode = ""
	hint_lbl.visible = false
	swing_btn.visible = false
	var swung := false
	var err := 0.0
	if _plan.is_empty():
		swung = _committed
		err = _commit_err
	else:
		swung = bool(_plan.get("swing", false))
		err = float(_plan.get("err_ms", 0.0))
	var ev: Dictionary = core.resolve_swing(err) if swung else core.resolve_no_swing()
	if String(ev.get("kind", "")) == "in_play":
		var q := float(ev.get("quality", 0.5))
		_fx_contact(bw, bh, clampf(q, 0.15, 1.0))
		shake(4.0 + 14.0 * q)
	elif String(ev.get("kind", "")) == "foul":
		_fx_contact(bw, bh, 0.25)
		shake(3.0)
	pitch_resolved.emit(ev)

# ---------------------------------------------------------------- hit timeline
func _launch_hit(play: Dictionary) -> void:
	_h_from = bw
	_h_carry = float(play["carry"])
	_h_loft = String(play["loft"])
	_h_window = bool(play["window"])
	var res := String(play["result"])
	_h_caught = res == "out_fly" or res == "out_line"
	_h_peak = float(HIT_PEAK.get(_h_loft, 130.0))
	_h_roll_t = 0.0
	_h_roll_px = 0.0
	_h_roll_dir = Vector2.ZERO
	if _h_window:
		_h_land = Tuning.WINDOW_POS
		_h_peak = HIT_PEAK["fly"] * (0.85 + 0.35 * _h_carry)
		_h_dur = sqrt(8.0 * _h_peak / Tuning.BALL_G)
	elif bool(play["fire_escape"]):
		var fe: Vector2 = Tuning.FE_L if float(play["lane"]) < 0.0 else Tuning.FE_R
		var inward := 34.0 if float(play["lane"]) < 0.0 else -34.0
		_h_land = fe + Vector2(inward, 40.0)
		_h_peak = HIT_PEAK["fly"]
		_h_dur = sqrt(8.0 * _h_peak / Tuning.BALL_G)
	else:
		var lx := Tuning.PLATE.x + float(play["lane"]) * HIT_LANE_X \
			+ randf_range(-HIT_JITTER, HIT_JITTER)
		if lx < Tuning.WALL_L + WALL_BALL_MARGIN:
			lx = (Tuning.WALL_L + WALL_BALL_MARGIN) * 2.0 - lx   # wall carom
		elif lx > Tuning.WALL_R - WALL_BALL_MARGIN:
			lx = (Tuning.WALL_R - WALL_BALL_MARGIN) * 2.0 - lx
		var ly := Tuning.PLATE.y - clampf(_h_carry, 0.0, 1.45) * HIT_CARRY_PX
		_h_land = Vector2(lx, ly)
		match _h_loft:
			"fly":
				# deep flies genuinely hang longer: T = sqrt(8·peak/G)
				_h_peak = HIT_PEAK["fly"] * (0.85 + 0.35 * _h_carry)
				_h_dur = sqrt(8.0 * _h_peak / Tuning.BALL_G)
			"line":
				_h_peak = HIT_PEAK["line"]
				_h_dur = sqrt(8.0 * _h_peak / Tuning.BALL_G)
			_:
				_h_dur = _build_hops(HIT_PEAK["ground"])
				if not _h_caught:
					_h_roll_t = GROUND_ROLL_T
					_h_roll_px = GROUND_ROLL_PX
					_h_roll_dir = (_h_land - _h_from).normalized()
	if res == "hr" and not _h_window:
		_h_roll_t = HR_ROLL_T
		_h_roll_px = HR_ROLL_PX
		_h_roll_dir = Vector2(0, -1)
	_sewer_prev_y = _h_from.y
	_clear_trail()
	if _h_carry > 0.5:
		_view_punch(0.06, 0.7)
	_bt = 0.0
	_ball_flying = true
	_ball_mode = "hit"

func _await_ball() -> void:
	if _ball_flying:
		await ball_done

func _ball_throw_to(target: Vector2, dur: float) -> void:
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(self, "bw", target, dur)
	tw.tween_method(func(u: float) -> void:
		bh = THROW_ARC_H * sin(PI * u), 0.0, 1.0, dur)
	await tw.finished

func _ball_to_mitt() -> void:
	var tw := create_tween()
	tw.tween_property(self, "bw", _mitt, MITT_TIME)
	# cosmetic — not awaited

func _foul_pop() -> void:
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(self, "bw",
		bw + Vector2(randf_range(-140.0, 140.0), 70.0), 0.35)
	tw.tween_method(func(u: float) -> void:
		bh = 90.0 * sin(PI * u), 0.0, 1.0, 0.35)

# ---------------------------------------------------------------- choreography
func _choreo(ev: Dictionary) -> void:
	_update_hud(ev["snap"])
	var kind := String(ev["kind"])
	match kind:
		"ball":
			ticker(Announcer.line("ball"))
			_catcher_take()
			await _beat(0.35)
		"strike":
			ticker(Announcer.line("strike"))
			_catcher_take()
			await _beat(0.35)
		"foul":
			_foul_pop()
			ticker(Announcer.line("foul"))
			await _card("FOUL!", "", 0.5)
		"whiff":
			ticker(Announcer.line("whiff"))
			_ball_to_mitt()
			_catcher_take()
			await _beat(0.4)
		"strikeout":
			ticker(Announcer.line("strikeout"))
			_ball_to_mitt()
			_catcher_take()
			await _card("STRUCK OUT!", "", 0.8)
			if batter_node != null and is_instance_valid(batter_node):
				batter_node.rest_anim = "sulk"
				batter_node.play("sulk", 3.0)
				await _beat(0.5)
				batter_node.queue_free()
				batter_node = null
		"walk":
			var walker := _move_id_from(ev.get("moves", []))
			ticker(Announcer.line("walk", core.kid_name(walker)))
			await _beat(_apply_moves(ev.get("moves", [])) + 0.1)
		"in_play":
			await _choreo_in_play(ev)
	_update_hud(ev["snap"])
	_return_fielders()
	_cam_home()

func _move_id_from(moves: Array) -> String:
	for m in moves:
		if int(m["from"]) == -1:
			return String(m["id"])
	return ""

func _choreo_in_play(play: Dictionary) -> void:
	var res := String(play["result"])
	await hit_stop(HITSTOP_MIN + HITSTOP_GAIN * float(play["quality"]))
	if float(play["quality"]) > 0.85:
		_card("SOCK!", "", 0.4)   # contact-moment flash, plays under the ball flight
	_launch_hit(play)
	var fpos := String(play.get("fielder", ""))
	if fpos != "" and fielders.has(fpos):
		_fielder_chase(fpos)
	await _beat(0.15)
	var nt = play.get("needs_throw")
	if nt != null:
		await _choreo_throw_play(play, nt)
		return
	match res:
		"out_fly", "out_line":
			_batter_jog(0.45)
			await _await_ball()
			_fielder_catch(fpos)
			if res == "out_fly":
				ticker(Announcer.line("out_fly", _fielder_name(fpos)))
				await _card("OUT!", "", 0.7)
			else:
				ticker(Announcer.line("out_line"))
				await _card("SPEARED!", "", 0.7)
			await _batter_fizzle()
		"out_ground":
			_batter_jog(0.85)
			await _await_ball()
			_fielder_throw(fpos)
			await _ball_throw_to(Tuning.BASE_1 + Vector2(0, -8), THROW_T)
			ticker(Announcer.line("out_ground"))
			await _card("OUT!", "", 0.7)
			await _batter_out_at_first()
		"hr":
			_apply_moves(play.get("moves", []))
			await _await_ball()
			if bool(play["window"]):
				if Game.smoke:
					print("smoke: window smash")
				_fx_glass(Tuning.WINDOW_POS, 520.0)
				shake(26.0)
				await hit_stop(0.10)
				window_spr.texture = Game.prop("window_broken")
				ticker(Announcer.line("window"))
				_scatter_fielders()
				await _card("SMASH!", "", 0.7)
				await _card("GO! GO! GO!", core.kid_name(play["batter"]), 1.1, true)
			else:
				var s := int(play["sewers"])
				ticker(Announcer.line("hr%d" % s))
				var sub := core.kid_name(play["batter"]) if s >= 3 else ""
				await _card("%d SEWER%s!" % [s, "" if s == 1 else "S"], sub, 1.1, true)
			await _beat(SETTLE_PAD)
		_:
			# single / double, ball live in the street
			_apply_moves(play.get("moves", []))
			await _await_ball()
			if bool(play["flivver"]):
				ticker(Announcer.line("flivver"))
			elif bool(play["fire_escape"]):
				ticker(Announcer.line("fire_escape"))
			else:
				ticker(Announcer.line(res, core.kid_name(play["batter"])))
			if int(play["runs"]) >= 1:
				await _card("ATTA BOY!", "", 0.7)
			await _beat(SETTLE_PAD)

func _choreo_throw_play(play: Dictionary, nt: Dictionary) -> void:
	var fpos := String(play.get("fielder", ""))
	_batter_jog(0.7)
	_lean_runners()
	await _await_ball()
	var choice: String = await _prompt_throw(nt)
	play = core.resolve_throw(choice)
	_update_hud(play["snap"])
	var res := String(play["result"])
	if Game.smoke:
		print("smoke: throw %s -> %s" % [choice, res])
	var target_pos: Vector2 = Tuning.BASE_1
	match choice:
		"home":
			target_pos = Tuning.PLATE
		"2B":
			target_pos = Tuning.BASE_2
	_fielder_throw(fpos)
	await _ball_throw_to(target_pos + Vector2(0, -8), THROW_T)
	var moves: Array = play.get("moves", [])
	var moved := []
	for m in moves:
		moved.append(String(m["id"]))
	if res == "out_ground" or res == "out_home":
		ticker(Announcer.line(res))
		await _card("OUT!", "", 0.7)
	else:
		ticker(Announcer.line("single", core.kid_name(play["batter"])))
		await _card("SAFE!", "", 0.7)
	var mdur := _apply_moves(moves)
	_retreat_runners(moved)
	if res == "out_ground":
		await _batter_out_at_first()
	if int(play["runs"]) >= 1 and res != "hr":
		await _card("ATTA BOY!", "", 0.7)
	await _beat(maxf(mdur, 0.5))
	_return_fielders()
	_cam_home()

# runners -------------------------------------------------------------------
func _apply_moves(moves: Array) -> float:
	var maxd := 0.0
	for m in moves:
		maxd = maxf(maxd, _move_runner(m))
	return maxd

func _move_runner(m: Dictionary) -> float:
	var id := String(m["id"])
	var from_i := int(m["from"])
	var to_i := int(m["to"])
	var node: Kid = null
	if from_i == -1:
		if batter_node != null and is_instance_valid(batter_node):
			node = batter_node
			node.rest_anim = "idle"
		batter_node = null
	elif runner_nodes.has(id) and is_instance_valid(runner_nodes[id]):
		node = runner_nodes[id]
	if node == null:
		node = _spawn_kid(id, _base_pos[maxi(from_i, 0)] if from_i >= 0 else Tuning.PLATE)
	runner_nodes[id] = node
	var was_out := bool(m.get("out", false))
	node.play("run", 11.0)
	var tw := create_tween()
	var legs := 0
	var prev: Vector2 = node.wpos
	for step in range(from_i + 1, to_i + 1):
		var dest: Vector2 = _base_pos[mini(step, 3)]
		var dx := dest.x - prev.x
		tw.tween_callback(func() -> void:
			if is_instance_valid(node):
				node.face(dx, RUN_LEAN))
		tw.tween_property(node, "wpos", dest, RUN_LEG_T)
		prev = dest
		legs += 1
	var total := legs * RUN_LEG_T
	if was_out:
		tw.tween_callback(func() -> void:
			if is_instance_valid(node):
				node.play("slide", 10.0, false))
		tw.tween_interval(SLIDE_HOLD)
		tw.tween_callback(func() -> void: _free_runner(id))
		total += SLIDE_HOLD
	elif to_i == 3:
		tw.tween_callback(func() -> void:
			if is_instance_valid(node):
				node.play("celebrate", 8.0))
		tw.tween_interval(CELEBRATE_HOLD)
		tw.tween_callback(func() -> void: _free_runner(id))
		total += CELEBRATE_HOLD
	else:
		tw.tween_callback(func() -> void:
			if is_instance_valid(node):
				node.face(0.0, 0.0)
				node.play("idle", 6.0))
	return total

func _lean_runners() -> void:
	for i in 3:
		var id: String = core.bases[i]
		if id == "" or not runner_nodes.has(id):
			continue
		var node: Kid = runner_nodes[id]
		if not is_instance_valid(node):
			continue
		node.play("run", 9.0)
		var toward: Vector2 = _base_pos[i].lerp(_base_pos[mini(i + 1, 3)], 0.3)
		var tw := create_tween()
		tw.tween_property(node, "wpos", toward, 0.3)

func _retreat_runners(moved_ids: Array) -> void:
	for id in runner_nodes.keys():
		if id in moved_ids:
			continue
		var i := core.bases.find(id)
		if i < 0:
			continue
		var node: Kid = runner_nodes[id]
		if not is_instance_valid(node):
			continue
		node.play("run", 9.0)
		var tw := create_tween()
		tw.tween_property(node, "wpos", _base_pos[i], 0.25)
		tw.tween_callback(func() -> void:
			if is_instance_valid(node):
				node.play("idle", 6.0))

func _batter_jog(frac: float) -> void:
	if batter_node == null or not is_instance_valid(batter_node):
		return
	batter_node.rest_anim = "idle"
	batter_node.play("run", 11.0)
	batter_node.face(Tuning.BASE_1.x - BATTER_POS.x, RUN_LEAN)
	var tw := create_tween()
	tw.tween_property(batter_node, "wpos",
		BATTER_POS.lerp(Tuning.BASE_1, frac), 0.32)

func _batter_out_at_first() -> void:
	if batter_node == null or not is_instance_valid(batter_node):
		return
	var node := batter_node
	batter_node = null
	var tw := create_tween()
	tw.tween_property(node, "wpos", Tuning.BASE_1, 0.16)
	tw.tween_callback(func() -> void:
		if is_instance_valid(node):
			node.play("slide", 10.0, false))
	tw.tween_interval(SLIDE_HOLD)
	tw.tween_callback(func() -> void:
		if is_instance_valid(node):
			node.queue_free())
	await _beat(0.16 + SLIDE_HOLD)

func _batter_fizzle() -> void:
	if batter_node == null or not is_instance_valid(batter_node):
		return
	batter_node.rest_anim = "sulk"
	batter_node.play("sulk", 3.0)
	await _beat(0.4)
	if batter_node != null and is_instance_valid(batter_node):
		batter_node.queue_free()
	batter_node = null

# fielders ------------------------------------------------------------------
func _fielder_chase(fpos: String) -> void:
	var k: Kid = fielders.get(fpos)
	if k == null or not is_instance_valid(k):
		return
	var to := _h_land + (k.wpos - _h_land).normalized() * 26.0
	var dur := clampf(k.wpos.distance_to(to) / 650.0, 0.2, 0.6)
	k.play("run", 11.0)
	k.face(to.x - k.wpos.x, RUN_LEAN)
	var tw := create_tween()
	tw.tween_property(k, "wpos", to, dur)
	tw.tween_callback(func() -> void:
		if is_instance_valid(k):
			k.face(0.0, 0.0)
			k.play("idle", 6.0))

func _fielder_catch(fpos: String) -> void:
	var k: Kid = fielders.get(fpos)
	if k != null and is_instance_valid(k):
		k.play("catch", 10.0, false)

func _fielder_throw(fpos: String) -> void:
	var k: Kid = fielders.get(fpos)
	if k != null and is_instance_valid(k):
		k.play("throw", 10.0, false)

func _fielder_name(fpos: String) -> String:
	if fpos == "":
		return ""
	return core.kid_name(core.positions[core.fielding_side()][fpos])

func _return_fielders() -> void:
	for pos_key in fielders:
		var k: Kid = fielders[pos_key]
		if not is_instance_valid(k):
			continue
		var home: Vector2 = Tuning.FIELD_POS[pos_key]
		if k.wpos.distance_to(home) < 6.0:
			continue
		k.play("run", 10.0)
		k.face(home.x - k.wpos.x, RUN_LEAN)
		var tw := create_tween()
		tw.tween_property(k, "wpos", home, 0.4)
		tw.tween_callback(func() -> void:
			if is_instance_valid(k):
				k.face(0.0, 0.0)
				k.play("idle", 6.0))

func _catcher_take() -> void:
	pass                                  # the catcher is off-camera here

func _scatter_fielders() -> void:
	for pos_key in fielders:
		var k: Kid = fielders[pos_key]
		if not is_instance_valid(k):
			continue
		var dash := Vector2(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)).normalized() * SCATTER_PX
		k.play("run", 12.0)
		var tw := create_tween()
		tw.tween_property(k, "wpos", k.wpos + dash, 0.12)
		tw.tween_property(k, "wpos", k.wpos, 0.28)
		tw.tween_callback(func() -> void:
			if is_instance_valid(k):
				k.play("idle", 6.0))

# ---------------------------------------------------------------- side change / finale
func _side_away(hc: Dictionary) -> void:
	await _card("SIDE AWAY", "", 0.8)
	for id in runner_nodes.keys():
		if is_instance_valid(runner_nodes[id]):
			runner_nodes[id].queue_free()
	runner_nodes.clear()
	if batter_node != null and is_instance_valid(batter_node):
		batter_node.queue_free()
	batter_node = null
	_setup_sides(true)
	_update_hud(core.snapshot())
	if Game.smoke:
		print("smoke: inning %d half %d  %d-%d" % [core.inning, core.half, core.score[0], core.score[1]])
	if bool(hc["cheese"]):
		await _cheese_beat(float(hc["cheese_len"]))

func _cheese_beat(cheese_len: float) -> void:
	if Game.smoke:
		print("smoke: cheese it")
	_card("CHEESE IT!!", "", CHEESE_CARD_T, true)
	ticker(Announcer.line("cheese"))
	var cop := Kid.new("cop")
	cop.rest_anim = "walk"
	cop.wpos = Vector2(Tuning.WALL_L - 120.0, 1800.0)
	stage.add_child(cop)
	cop.play("walk", 7.0)
	cop.face(1.0, 0.0)
	var cop_tw := create_tween()
	cop_tw.tween_property(cop, "wpos",
		Vector2(Tuning.WALL_R + 120.0, 1800.0), cheese_len + 0.8)
	cop_tw.tween_callback(func() -> void:
		if is_instance_valid(cop):
			cop.queue_free())
	for k0 in _field_kids():
		var k: Kid = k0
		var here := k.wpos
		var wall_x := Tuning.WALL_L + 70.0 if here.x < Tuning.PLATE.x else Tuning.WALL_R - 70.0
		k.play("run", 12.0)
		k.face(wall_x - here.x, RUN_LEAN)
		var tw := create_tween()
		tw.tween_property(k, "wpos", Vector2(wall_x, here.y), cheese_len * 0.45)
		tw.tween_interval(cheese_len * 0.1)
		tw.tween_callback(func() -> void:
			if is_instance_valid(k):
				k.face(here.x - wall_x, RUN_LEAN))
		tw.tween_property(k, "wpos", here, cheese_len * 0.45)
		tw.tween_callback(func() -> void:
			if is_instance_valid(k):
				k.face(0.0, 0.0)
				k.play("idle", 6.0))
	await _beat(cheese_len + 0.9)
	ticker(Announcer.line("cheese_end"))

func _report_perf() -> void:
	if not _perf or _ft.is_empty():
		return
	var sorted_ft := _ft.duplicate()
	sorted_ft.sort()
	var n := sorted_ft.size()
	var sum := 0.0
	for v in sorted_ft:
		sum += v
	var p95: float = sorted_ft[int(n * 0.95)]
	var p99: float = sorted_ft[mini(int(n * 0.99), n - 1)]
	print("PERF frames=%d mean=%.2fms p95=%.2fms p99=%.2fms worst=%.2fms budget=16.67ms"
		% [n, sum / n, p95, p99, _ft_worst])
	print("PERF split/frame: ball=%.3fms hud=%.3fms kids=%.3fms (rest=engine+draw)"
		% [_t_ball / 1000.0 / n, _t_hud / 1000.0 / n, _t_kids / 1000.0 / n])

func _finale() -> void:
	_report_perf()
	_update_hud(core.snapshot())
	if Game.smoke:
		print("SMOKE_OK")
		get_tree().quit(0)
		return
	ticker(Announcer.line("final"))
	var sub := core.winner_text()
	if core.final_note != "":
		sub += " — " + core.final_note
	await _card("THAT'S THE BALL GAME", sub, 1.8, true)
	_show_finale_ui()

func _show_finale_ui() -> void:
	var v := VBoxContainer.new()
	v.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	v.grow_horizontal = Control.GROW_DIRECTION_BOTH
	v.grow_vertical = Control.GROW_DIRECTION_BOTH
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 22)
	var paper := PanelContainer.new()
	paper.add_theme_stylebox_override("panel", _paper_style())
	var headline := Label.new()
	var s0: int = core.score[0]
	var s1: int = core.score[1]
	if s1 > s0:
		headline.text = "EXTRA! GANG TAKES IT %d–%d" % [s1, s0]
	elif s0 > s1:
		headline.text = "EXTRA! VISITORS TAKE IT %d–%d" % [s0, s1]
	else:
		headline.text = "EXTRA! DEAD HEAT AT %d ALL" % s1
	headline.add_theme_font_size_override("font_size", 44)
	headline.add_theme_color_override("font_color", Tuning.INK)
	headline.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	paper.add_child(headline)
	v.add_child(paper)
	var back := _ticket_button("BACK TO THE BLOCK", 34)
	back.pressed.connect(func() -> void:
		Engine.time_scale = 1.0
		get_tree().change_scene_to_file("res://scenes/boot.tscn"))
	var center := HBoxContainer.new()
	center.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(back)
	v.add_child(center)
	hud.add_child(v)

# ---------------------------------------------------------------- cards / camera / fx
func _card(text: String, sub := "", hold := 0.9, slam := false) -> void:
	while _card_busy:
		await _beat(0.05)
	_card_busy = true
	await cards.flash(text, sub, hold, slam)
	_card_busy = false

func _cam_home() -> void:
	_view_punch(0.0, CAM_HOME_T)

func _fx_label(text: String, world_pos: Vector2) -> void:
	var lbl := Label.new()
	lbl.text = text
	lbl.add_theme_font_size_override("font_size", 52)
	lbl.add_theme_color_override("font_color", Tuning.CHALK)
	lbl.add_theme_color_override("font_shadow_color", Color(Tuning.INK, 0.8))
	lbl.add_theme_constant_override("shadow_offset_x", 3)
	lbl.add_theme_constant_override("shadow_offset_y", 3)
	var pr := Tuning.project(world_pos, 120.0)
	var sc: float = clampf(pr.z * Tuning.v_xk * 0.5, 0.30, 1.30)
	lbl.scale = Vector2(sc, sc)
	lbl.position = Vector2(pr.x - 120.0 * sc, pr.y)
	lbl.z_index = 3000
	fx.add_child(lbl)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(lbl, "position", lbl.position + Vector2(0, -FX_RISE), FX_LIFE)
	tw.tween_property(lbl, "modulate", Color(1, 1, 1, 0), FX_LIFE).set_delay(FX_LIFE * 0.35)
	tw.chain().tween_callback(lbl.queue_free)

# ---------------------------------------------------------------- HUD
func _build_hud() -> void:
	# The reference HUD: parchment pill plates with icon pips at the top
	# corners, round parchment touch buttons at the bottom corners, and the
	# announcer floating over the cobbles instead of riding a paper strip.
	# Everything is authored at landscape sizes on one root control; scaling
	# that root fits any screen, so a tall phone gets big thumbable chrome.
	hud_root = Control.new()
	hud_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(hud_root)
	_fit_hud_root()
	count_plate = _pill()
	count_plate.set_anchors_preset(Control.PRESET_TOP_LEFT)
	count_plate.position = Vector2(18, 14)
	var ch := HBoxContainer.new()
	ch.add_theme_constant_override("separation", 7)
	ch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	ball_pips = _pip_row(ch, "ui_pip_ball", 3, 40)
	ch.add_child(_pip_divider())
	strike_pips = _pip_row(ch, "ui_pip_star", 2, 40)
	ch.add_child(_pip_divider())
	out_pips = _pip_row(ch, "ui_pip_out", 2, 34)
	count_plate.add_child(ch)
	hud_root.add_child(count_plate)
	# score plate top-right: VIS | INN | GANG
	score_plate = _pill()
	# right-anchored: the plate's right edge rides the screen edge and the
	# panel grows leftward as the score gets wider
	score_plate.anchor_left = 1.0
	score_plate.anchor_right = 1.0
	score_plate.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	score_plate.offset_right = -18.0
	score_plate.offset_top = 14.0
	var sh := HBoxContainer.new()
	sh.add_theme_constant_override("separation", 14)
	sh.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vis_lbl = _plate_num("0")
	inn_lbl = _plate_num("1▲", 22, Color(Tuning.INK, 0.66))
	gang_lbl = _plate_num("0")
	sh.add_child(_plate_col("VIS", vis_lbl))
	sh.add_child(_plate_col("INN", inn_lbl))
	sh.add_child(_plate_col("GANG", gang_lbl))
	score_plate.add_child(sh)
	hud_root.add_child(score_plate)
	# floating announcer line, bottom-centre between the buttons
	tick_lbl = Label.new()
	tick_lbl.add_theme_font_size_override("font_size", 22)
	tick_lbl.add_theme_color_override("font_color", Tuning.PAPER)
	tick_lbl.add_theme_color_override("font_outline_color", Color(0.06, 0.05, 0.06, 0.9))
	tick_lbl.add_theme_constant_override("outline_size", 10)
	tick_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tick_lbl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tick_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	tick_lbl.anchor_left = 0.14
	tick_lbl.anchor_right = 0.86
	tick_lbl.anchor_top = 1.0
	tick_lbl.anchor_bottom = 1.0
	tick_lbl.offset_top = -74.0
	tick_lbl.offset_bottom = -14.0
	tick_lbl.grow_vertical = Control.GROW_DIRECTION_BEGIN
	hud_root.add_child(tick_lbl)
	# corner touch buttons
	action_btn = _round_btn("ui_btn_run", Control.PRESET_BOTTOM_LEFT, Vector2(20, -20))
	action_btn.pressed.connect(_on_pitch_thrown)
	hud_root.add_child(action_btn)
	swing_btn = _round_btn("ui_btn_hand", Control.PRESET_BOTTOM_RIGHT, Vector2(-20, -20))
	swing_btn.pressed.connect(_try_swing)
	hud_root.add_child(swing_btn)
	# prompt area (pitch call / throw call) — one visible at a time
	var prompt_root := VBoxContainer.new()
	prompt_root.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM,
		Control.PRESET_MODE_MINSIZE, 130)
	prompt_root.grow_horizontal = Control.GROW_DIRECTION_BOTH
	prompt_root.grow_vertical = Control.GROW_DIRECTION_BEGIN
	prompt_root.alignment = BoxContainer.ALIGNMENT_END
	prompt_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud_root.add_child(prompt_root)
	_build_pitch_ui(prompt_root)
	_build_throw_ui(prompt_root)
	hint_lbl = _chalk_label("TAP TO SWING", 26)
	hint_lbl.add_theme_color_override("font_outline_color", Color(0.06, 0.05, 0.06, 0.9))
	hint_lbl.add_theme_constant_override("outline_size", 9)
	hint_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint_lbl.visible = false
	prompt_root.add_child(hint_lbl)
	var pulse := create_tween().set_loops()
	pulse.tween_property(hint_lbl, "modulate", Color(1, 1, 1, 0.45), 0.4)
	pulse.tween_property(hint_lbl, "modulate", Color(1, 1, 1, 1.0), 0.4)

func _fit_hud_root() -> void:
	# In portrait the expand-stretch design space grows very tall, which would
	# shrink everything; boost the root so the chrome stays thumb-sized.
	var vp := get_viewport_rect().size
	var k := maxf(1.0, vp.y / 1300.0)
	hud_root.scale = Vector2(k, k)
	hud_root.size = vp / k
	hud_root.position = Vector2.ZERO

func _pill() -> PanelContainer:
	var pl := PanelContainer.new()
	# horizontal margin clears the pill's ink ring so captions never sit
	# under it; the ring is ~20px of the stretched 9-patch
	var st := _plate_style("ui_pill", 36, 14)
	if st is StyleBoxTexture:
		st.content_margin_left = 27.0
		st.content_margin_right = 27.0
	pl.add_theme_stylebox_override("panel", st)
	pl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return pl

func _pip_row(parent: Control, art: String, n: int, size: int) -> Array[TextureRect]:
	var out: Array[TextureRect] = []
	var tex: Texture2D = load("res://assets/ui/%s.png" % art) \
		if ResourceLoader.exists("res://assets/ui/%s.png" % art) else null
	for i in n:
		var tr := TextureRect.new()
		tr.texture = tex
		tr.custom_minimum_size = Vector2(size, size)
		tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
		tr.modulate = PIP_DIM
		parent.add_child(tr)
		out.append(tr)
	return out

func _pip_divider() -> Control:
	var d := ColorRect.new()
	d.color = Color(Tuning.INK, 0.28)
	d.custom_minimum_size = Vector2(3, 36)
	d.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	d.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return d

func _plate_num(txt: String, size := 32, col := Tuning.INK) -> Label:
	var l := Label.new()
	l.text = txt
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

func _plate_col(caption: String, num: Label) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", -4)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var cap := Label.new()
	cap.text = caption
	cap.add_theme_font_size_override("font_size", 12)
	cap.add_theme_color_override("font_color", Color(Tuning.INK, 0.62))
	cap.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	cap.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(cap)
	v.add_child(num)
	return v

func _round_btn(art: String, preset: int, off: Vector2) -> TextureButton:
	var b := TextureButton.new()
	var path := "res://assets/ui/%s.png" % art
	if ResourceLoader.exists(path):
		b.texture_normal = load(path)
	b.ignore_texture_size = true
	b.stretch_mode = TextureButton.STRETCH_KEEP_ASPECT_CENTERED
	b.custom_minimum_size = Vector2(118, 118)
	b.set_anchors_preset(preset)
	b.grow_horizontal = Control.GROW_DIRECTION_BEGIN if off.x < 0.0 \
		else Control.GROW_DIRECTION_END
	b.grow_vertical = Control.GROW_DIRECTION_BEGIN
	b.position = off + Vector2(0.0 if off.x > 0.0 else -118.0, -118.0)
	b.visible = false
	b.pivot_offset = Vector2(59, 59)
	return b

func _chalk_label(text: String, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", Tuning.CHALK)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

func _paper_style() -> StyleBox:
	return _plate_style("ui_card_plate", 60, 14)

# A 9-patch cut from printed stock, falling back to flat colour if the art
# has not been generated yet.
func _plate_style(art_name: String, tex_margin: int, content: int) -> StyleBox:
	var path := "res://assets/ui/%s.png" % art_name
	if ResourceLoader.exists(path):
		var st := StyleBoxTexture.new()
		st.texture = load(path)
		st.set_texture_margin_all(tex_margin)
		st.set_content_margin_all(content)
		return st
	var sb := StyleBoxFlat.new()
	sb.bg_color = Tuning.PAPER if art_name == "ui_card_plate" else Tuning.BRICKC
	sb.border_color = Tuning.INK
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(8)
	sb.set_content_margin_all(content)
	return sb

func _ticket_button(txt: String, font_size := 26) -> Button:
	var b := Button.new()
	b.text = "  %s  " % txt
	b.add_theme_font_size_override("font_size", font_size)
	b.add_theme_color_override("font_color", Tuning.INK)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Tuning.CHALK
	sb.border_color = Tuning.INK
	sb.set_border_width_all(3)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(10)
	b.add_theme_stylebox_override("normal", sb)
	var sb2: StyleBoxFlat = sb.duplicate()
	sb2.bg_color = Tuning.PINK
	b.add_theme_stylebox_override("pressed", sb2)
	var sb3: StyleBoxFlat = sb.duplicate()
	sb3.bg_color = Color("f6ecd4")
	b.add_theme_stylebox_override("hover", sb3)
	return b

func _build_pitch_ui(parent: Control) -> void:
	pitch_panel = PanelContainer.new()
	pitch_panel.add_theme_stylebox_override("panel", _paper_style())
	pitch_panel.visible = false
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	pitch_panel.add_child(v)
	# stage 1: pick lane + type
	pitch_select = VBoxContainer.new()
	pitch_select.add_theme_constant_override("separation", 8)
	var title := Label.new()
	title.text = "CALL IT"
	title.add_theme_font_size_override("font_size", 28)
	title.add_theme_color_override("font_color", Tuning.INK)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	pitch_select.add_child(title)
	var lanes := HBoxContainer.new()
	lanes.add_theme_constant_override("separation", 8)
	lanes.alignment = BoxContainer.ALIGNMENT_CENTER
	var lane_group := ButtonGroup.new()
	for lane_def in [["INSIDE", 1], ["MIDDLE", 0], ["OUTSIDE", -1]]:
		var lb := _ticket_button(lane_def[0], 22)
		lb.toggle_mode = true
		lb.button_group = lane_group
		lb.button_pressed = int(lane_def[1]) == 0
		var lv := int(lane_def[1])
		lb.toggled.connect(func(on: bool) -> void:
			if on:
				_pitch_lane = lv)
		lanes.add_child(lb)
	pitch_select.add_child(lanes)
	var types := HBoxContainer.new()
	types.add_theme_constant_override("separation", 8)
	types.alignment = BoxContainer.ALIGNMENT_CENTER
	for t in ["fast", "spinner", "drop"]:
		var tv: String = t
		var tb := _ticket_button(tv.to_upper(), 22)
		tb.pressed.connect(func() -> void:
			_pitch_type = tv
			pitch_select.visible = false
			pitch_timing.visible = true
			_bar_clock = 0.0
			_bar_running = true
			action_btn.visible = true)
		types.add_child(tb)
	pitch_select.add_child(types)
	v.add_child(pitch_select)
	# stage 2: timing bar
	pitch_timing = VBoxContainer.new()
	pitch_timing.add_theme_constant_override("separation", 8)
	pitch_timing.visible = false
	bar_track = Control.new()
	bar_track.custom_minimum_size = Vector2(340, 26)
	var track_bgd := ColorRect.new()
	track_bgd.color = Tuning.ASPHALT
	track_bgd.set_anchors_preset(Control.PRESET_FULL_RECT)
	bar_track.add_child(track_bgd)
	var sweet := ColorRect.new()
	sweet.color = Tuning.GOLD
	sweet.position = Vector2(340.0 * 0.5 - 22.0, 0)
	sweet.size = Vector2(44, 26)
	bar_track.add_child(sweet)
	bar_marker = ColorRect.new()
	bar_marker.color = Tuning.PINK
	bar_marker.size = Vector2(10, 26)
	bar_track.add_child(bar_marker)
	pitch_timing.add_child(bar_track)
	var throw_it := _ticket_button("THROW!", 26)
	throw_it.pressed.connect(_on_pitch_thrown)
	var tc := HBoxContainer.new()
	tc.alignment = BoxContainer.ALIGNMENT_CENTER
	tc.add_child(throw_it)
	pitch_timing.add_child(tc)
	v.add_child(pitch_timing)
	parent.add_child(pitch_panel)

func _show_pitch_ui() -> void:
	pitch_select.visible = true
	pitch_timing.visible = false
	_bar_running = false
	pitch_panel.visible = true

func _on_pitch_thrown() -> void:
	if not _bar_running:
		return
	_bar_running = false
	action_btn.visible = false
	var phase := pingpong(_bar_clock * BAR_SPEED, 1.0)
	var quality := clampf(1.0 - absf(phase - 0.5) * 2.0, 0.2, 0.95)
	var need := AIM_Q_MID if _pitch_lane == 0 else AIM_Q_EDGE
	pitch_panel.visible = false
	ui_pitch.emit({"lane": _pitch_lane, "type": _pitch_type,
		"quality": quality, "aim_strike": quality >= need})

func _build_throw_ui(parent: Control) -> void:
	throw_panel = PanelContainer.new()
	throw_panel.add_theme_stylebox_override("panel", _paper_style())
	throw_panel.visible = false
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	var title := Label.new()
	title.text = "THROW IT!"
	title.add_theme_font_size_override("font_size", 28)
	title.add_theme_color_override("font_color", Tuning.INK)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(title)
	throw_buttons = HBoxContainer.new()
	throw_buttons.add_theme_constant_override("separation", 8)
	throw_buttons.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_child(throw_buttons)
	var bar_holder := Control.new()
	bar_holder.custom_minimum_size = Vector2(300, 12)
	var bar_bgd := ColorRect.new()
	bar_bgd.color = Tuning.ASPHALT
	bar_bgd.set_anchors_preset(Control.PRESET_FULL_RECT)
	bar_holder.add_child(bar_bgd)
	throw_bar = ColorRect.new()
	throw_bar.color = Tuning.PINK
	throw_bar.size = Vector2(300, 12)
	bar_holder.add_child(throw_bar)
	v.add_child(bar_holder)
	throw_panel.add_child(v)
	parent.add_child(throw_panel)

func _prompt_throw(nt: Dictionary) -> String:
	if autopilot:
		await _beat(0.05)
		return String(nt["best"])
	for c in throw_buttons.get_children():
		c.queue_free()
	var labels := {"1B": "FIRST", "2B": "SECOND", "home": "HOME"}
	for target0 in nt["targets"]:
		var target := String(target0)
		var b := _ticket_button(String(labels.get(target, target)), 24)
		b.pressed.connect(func() -> void:
			if _throw_waiting:
				_throw_waiting = false
				throw_choice.emit(target))
		throw_buttons.add_child(b)
	_throw_total = float(nt.get("deadline", 1.4))
	_throw_left = _throw_total
	_throw_waiting = true
	throw_panel.visible = true
	var choice: String = await throw_choice
	throw_panel.visible = false
	return choice

func _process_hud(delta: float) -> void:
	if _bar_running:
		_bar_clock += delta
		var phase := pingpong(_bar_clock * BAR_SPEED, 1.0)
		bar_marker.position.x = phase * (bar_track.size.x - bar_marker.size.x)
	if _throw_waiting:
		_throw_left -= delta
		throw_bar.size.x = maxf(0.0, _throw_left / _throw_total) * 300.0
		if _throw_left <= 0.0:
			_throw_waiting = false
			throw_choice.emit("none")

func _update_hud(snap: Dictionary) -> void:
	var sc: Array = snap["score"]
	vis_lbl.text = str(sc[0])
	gang_lbl.text = str(sc[1])
	var arrow := "▲" if int(snap["half"]) == MatchCore.Half.TOP else "▼"
	inn_lbl.text = "%d%s" % [int(snap["inning"]), arrow]
	_set_pips(ball_pips, int(snap["balls"]))
	_set_pips(strike_pips, int(snap["strikes"]))
	_set_pips(out_pips, int(snap["outs"]))
	var runs_total: int = sc[0] + sc[1]
	if _last_runs >= 0 and runs_total != _last_runs:
		score_plate.pivot_offset = score_plate.size / 2.0
		var tw := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		score_plate.scale = Vector2(1.22, 1.22)
		tw.tween_property(score_plate, "scale", Vector2.ONE, 0.3)
	_last_runs = runs_total

func _set_pips(pips: Array[TextureRect], lit: int) -> void:
	for i in pips.size():
		var on := i < lit
		var pip := pips[i]
		if on and pip.modulate != Color.WHITE:
			pip.modulate = Color.WHITE
			pip.pivot_offset = pip.size / 2.0
			pip.scale = Vector2(1.5, 1.5)
			var tw := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
			tw.tween_property(pip, "scale", Vector2.ONE, 0.22)
		elif not on:
			pip.modulate = PIP_DIM
			pip.scale = Vector2.ONE

func ticker(s: String) -> void:
	if s == "":
		return
	tick_lbl.text = s
	tick_lbl.visible_characters = 0
	if _tick_tw != null:
		_tick_tw.kill()
	_tick_tw = create_tween()
	_tick_tw.tween_property(tick_lbl, "visible_characters", s.length(),
		s.length() * TICK_CHAR_T)

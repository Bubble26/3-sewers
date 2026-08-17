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
const BATTER_POS := Vector2(700, 2350)
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
const SMOKE_GUARD_REAL_S := 300.0
const SEWER_TEXTS := ["ONE SEWER…", "TWO SEWERS…", "THREE SEWERS…"]
const PITCH_PATTER_CHANCE := 0.3
const CHEESE_CARD_T := 1.2
const SETTLE_PAD := 0.35

# ---------------------------------------------------------------- kid sprite node
class Kid extends Node2D:
	const ANIM_N := {"idle": 4, "bat_stance": 2, "swing": 6, "run": 8, "pitch": 8,
		"throw": 4, "catch": 3, "slide": 4, "celebrate": 4, "sulk": 2, "walk": 4}

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

	# Art is authored at 2x for retina, and animations use different canvas
	# widths, so the offset is derived per texture: bottom edge on the node
	# origin keeps the kid's feet planted and the y-sort honest.
	func _set_tex(t: Texture2D) -> void:
		if t == null or spr.texture == t:
			return
		spr.texture = t
		spr.scale = Vector2(Tuning.ART, Tuning.ART)
		spr.offset = Vector2(0, -t.get_height() * 0.5)

	func play(a: String, fps := 8.0, loop := true) -> void:
		if anim == a and _loop and loop:
			return
		anim = a
		_fps = fps
		_loop = loop
		_t = 0.0
		_frames = Game.frames(kid_id, a, int(ANIM_N.get(a, 1)))
		if not _frames.is_empty():
			_set_tex(_frames[0])

	func _process(delta: float) -> void:
		if _frames.is_empty():
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

# ---------------------------------------------------------------- members
var autopilot := false

var core := MatchCore.new()
var bg: Node2D
var stage: Node2D
var fx: Node2D
var cam: Camera2D
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

# hud refs
var score_panel: PanelContainer
var score_lbl: Label
var count_lbl: Label
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
var _pitch_lane := 0
var _pitch_type := "fast"
var _bar_clock := 0.0
var _bar_running := false
var _throw_waiting := false
var _throw_left := 0.0
var _throw_total := 1.4

# ---------------------------------------------------------------- setup
func _ready() -> void:
	_base_pos = [Tuning.BASE_1, Tuning.BASE_2, Tuning.BASE_3, Tuning.PLATE]
	core.setup(Game.cpu_team, Game.player_team, Game.roster, 1, Tuning.INNINGS)
	_build_layers()
	_build_world()
	_build_ball()
	_build_hud()
	if Game.smoke:
		var guard := get_tree().create_timer(SMOKE_GUARD_REAL_S, true, false, true)
		guard.timeout.connect(func() -> void:
			if not core.game_over:
				push_error("SMOKE GUARD TIMEOUT")
				get_tree().quit(1))
	run_match()

func _build_layers() -> void:
	bg = Node2D.new()
	bg.name = "bg"
	add_child(bg)
	stage = Node2D.new()
	stage.name = "stage"
	stage.y_sort_enabled = true
	add_child(stage)
	fx = Node2D.new()
	fx.name = "fx"
	add_child(fx)
	cam = Camera2D.new()
	cam.zoom = Vector2(Tuning.CAM_ZOOM, Tuning.CAM_ZOOM)
	cam.position = _cam_default()
	cam.enabled = true
	add_child(cam)
	cam.make_current()
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

func _cam_default() -> Vector2:
	return Vector2(Tuning.PLATE.x, CAM_CHASE_MAX_Y)

# ---------------------------------------------------------------- world
const STREET_TOP := 600.0
const STREET_BOT := 2600.0
const STREET_L := -200.0
const STREET_R := 1480.0
const WALK_W := 62.0                        # sidewalk between curb and building

func _build_world() -> void:
	# asphalt, tiled — a flat fill reads as a grey rectangle, tar and grit
	# read as a street
	_tiled("asphalt_tile", Rect2(STREET_L, STREET_TOP,
		STREET_R - STREET_L, STREET_BOT - STREET_TOP), Tuning.ASPHALT)
	# sidewalks hugging each building line
	_tiled("sidewalk_tile", Rect2(Tuning.WALL_L - WALK_W, STREET_TOP,
		WALK_W, STREET_BOT - STREET_TOP), Tuning.ASPHALT.lightened(0.12))
	_tiled("sidewalk_tile", Rect2(Tuning.WALL_R, STREET_TOP,
		WALK_W, STREET_BOT - STREET_TOP), Tuning.ASPHALT.lightened(0.12))
	# the buildings that make the canyon
	_facade("facade_l", Rect2(STREET_L, STREET_TOP,
		Tuning.WALL_L - WALK_W - STREET_L, STREET_BOT - STREET_TOP))
	_facade("facade_r", Rect2(Tuning.WALL_R + WALK_W, STREET_TOP,
		STREET_R - Tuning.WALL_R - WALK_W, STREET_BOT - STREET_TOP))
	# curb line where sidewalk meets asphalt
	for cx in [Tuning.WALL_L - WALK_W * 0.5, Tuning.WALL_R + WALK_W * 0.5]:
		var curb := Line2D.new()
		curb.points = PackedVector2Array([Vector2(cx, STREET_TOP), Vector2(cx, STREET_BOT)])
		curb.width = 6.0
		curb.default_color = Color(Tuning.INK, 0.45)
		bg.add_child(curb)
	# far rooftops closing the top of the street
	_flat_prop("skyline", Vector2(Tuning.PLATE.x, STREET_TOP + 40.0), bg, 1.0,
		Color(1, 1, 1, 0.85))
	# tenement windows down both walls
	var win_tex: Texture2D = Game.prop("window")
	for wy in [760.0, 1080.0, 1420.0, 1760.0, 2100.0, 2440.0]:
		for wx in [Tuning.WALL_L - WALK_W - 120.0, Tuning.WALL_R + WALK_W + 120.0]:
			if absf(wy - Tuning.WINDOW_POS.y) < 90.0 \
					and absf(wx - Tuning.WINDOW_POS.x) < 160.0:
				continue                     # leave room for THE window
			var w := _spr(win_tex, Vector2(wx, wy), 1.0)
			w.modulate = Color(1, 1, 1, 0.9)
			bg.add_child(w)
	# THE window — swapped to broken glass on the window HR
	window_spr = _spr(win_tex, Tuning.WINDOW_POS, 1.25)
	bg.add_child(window_spr)
	# fire escapes
	for fe_pos in [Tuning.FE_L, Tuning.FE_R]:
		bg.add_child(_spr(Game.prop("fire_escape"), fe_pos, 1.0))
	# flat street furniture painted onto the asphalt
	bg.add_child(_spr(Game.prop("manhole"), Tuning.PLATE, 1.2))
	for i in Tuning.SEWERS_Y.size():
		bg.add_child(_spr(Game.prop("sewer"),
			Vector2(Tuning.PLATE.x, Tuning.SEWERS_Y[i]), 1.0))
		var num := Label.new()
		num.text = str(i + 1)
		num.add_theme_font_size_override("font_size", 44)
		num.add_theme_color_override("font_color", Tuning.CHALK)
		num.position = Vector2(Tuning.PLATE.x + 78, Tuning.SEWERS_Y[i] - 34)
		num.rotation_degrees = -4.0
		num.modulate = Color(1, 1, 1, 0.8)
		bg.add_child(num)
	_flat_prop("chalk_marks", Vector2(Tuning.WALL_L + 190.0, 1760.0), bg, 1.0,
		Color(1, 1, 1, 0.55))
	_flat_prop("gutter_grate", Vector2(Tuning.WALL_R + WALK_W * 0.5, 2300.0), bg, 1.0)
	# chalk second base + foul lines
	_chalk_square(Tuning.BASE_2, 66.0)
	_dashed_chalk(Tuning.PLATE, Vector2(Tuning.WALL_L, 2110))
	_dashed_chalk(Tuning.PLATE, Vector2(Tuning.WALL_R, 2110))
	# standing props live on the stage so kids sort around them
	_standing_prop("stoop", Tuning.BASE_1)
	_standing_prop("hydrant", Tuning.BASE_3)
	_standing_prop("model_t", Tuning.CAR_POS)
	_standing_prop("lamp", Vector2(Tuning.WALL_L - WALK_W * 0.5, 1180))
	_standing_prop("lamp", Vector2(Tuning.WALL_R + WALK_W * 0.5, 1980))
	_standing_prop("trash", Vector2(Tuning.WALL_L - WALK_W * 0.6, 2020))
	_standing_prop("crate", Vector2(Tuning.WALL_R + WALK_W * 0.7, 1620))
	_standing_prop("awning", Vector2(Tuning.WALL_R + WALK_W + 150.0, 2260))
	_standing_prop("pigeon", Vector2(Tuning.WALL_L + 120.0, 1320))
	_standing_prop("pigeon", Vector2(Tuning.WALL_L + 166.0, 1352))
	_build_laundry()

# -- prop helpers: art is authored at 2x, Tuning.ART puts it back in world scale
func _spr(tex: Texture2D, pos: Vector2, mul := 1.0) -> Sprite2D:
	var s := Sprite2D.new()
	s.texture = tex
	s.position = pos
	s.scale = Vector2(Tuning.ART, Tuning.ART) * mul
	return s

func _flat_prop(prop_name: String, pos: Vector2, parent: Node2D, mul := 1.0,
		mod := Color(1, 1, 1, 1)) -> void:
	var tex: Texture2D = Game.prop(prop_name)
	if tex == null:
		return
	var s := _spr(tex, pos, mul)
	s.modulate = mod
	parent.add_child(s)

func _tiled(prop_name: String, area: Rect2, fallback: Color) -> void:
	var tex: Texture2D = Game.prop(prop_name)
	if tex == null:
		var poly := Polygon2D.new()
		poly.polygon = PackedVector2Array([area.position,
			area.position + Vector2(area.size.x, 0), area.end,
			area.position + Vector2(0, area.size.y)])
		poly.color = fallback
		bg.add_child(poly)
		return
	var s := Sprite2D.new()
	s.texture = tex
	s.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	s.region_enabled = true
	s.region_rect = Rect2(Vector2.ZERO, area.size / Tuning.ART)
	s.scale = Vector2(Tuning.ART, Tuning.ART)
	s.position = area.position + area.size * 0.5
	bg.add_child(s)

func _facade(prop_name: String, area: Rect2) -> void:
	var tex: Texture2D = Game.prop(prop_name)
	if tex == null:
		_tiled("brick_tile", area, Tuning.BRICKC)
		return
	# facades repeat vertically up the street canyon
	var s := Sprite2D.new()
	s.texture = tex
	s.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
	s.region_enabled = true
	s.region_rect = Rect2(Vector2.ZERO, area.size / Tuning.ART)
	s.scale = Vector2(Tuning.ART, Tuning.ART)
	s.position = area.position + area.size * 0.5
	bg.add_child(s)

func _standing_prop(prop_name: String, pos: Vector2) -> void:
	var tex: Texture2D = Game.prop(prop_name)
	if tex == null:
		return
	var holder := Node2D.new()
	holder.position = pos
	var spr := _spr(tex, Vector2.ZERO, 1.0)
	spr.offset = Vector2(0, -tex.get_size().y * 0.5)
	holder.add_child(spr)
	stage.add_child(holder)

func _chalk_square(center: Vector2, side_len: float) -> void:
	var half := side_len * 0.5
	var sq := Line2D.new()
	sq.points = PackedVector2Array([center + Vector2(-half, -half),
		center + Vector2(half, -half), center + Vector2(half, half),
		center + Vector2(-half, half)])
	sq.closed = true
	sq.width = 5.0
	sq.default_color = Tuning.CHALK
	bg.add_child(sq)

func _dashed_chalk(from: Vector2, to: Vector2) -> void:
	var total := from.distance_to(to)
	var dir := (to - from).normalized()
	var dash := 34.0
	var gap := 26.0
	var d := 0.0
	while d < total:
		var seg := Line2D.new()
		var e := minf(d + dash, total)
		seg.points = PackedVector2Array([from + dir * d, from + dir * e])
		seg.width = 5.0
		seg.default_color = Tuning.CHALK
		bg.add_child(seg)
		d += dash + gap

func _build_laundry() -> void:
	var holder := Node2D.new()
	holder.position = Vector2(Tuning.PLATE.x, 2560)   # front of stage — drapes the frame
	var span := 420.0
	var sag := 42.0
	var line := Line2D.new()
	var pts := PackedVector2Array()
	for i in 17:
		var u := float(i) / 16.0
		var x := -span + span * 2.0 * u
		pts.append(Vector2(x, sag * sin(PI * u) - sag))
	line.points = pts
	line.width = 4.0
	line.default_color = Color(Tuning.INK, 0.8)
	holder.add_child(line)
	var garments := ["shirt", "union", "dress", "shirt", "union"]
	for i in garments.size():
		var u := 0.14 + 0.18 * i
		var x := -span + span * 2.0 * u
		var tex: Texture2D = Game.prop(garments[i])
		var g := _spr(tex, Vector2(x, sag * sin(PI * u) - sag
			+ tex.get_size().y * Tuning.ART * 0.5 - 4.0), 1.0)
		g.rotation_degrees = randf_range(-4.0, 4.0)
		holder.add_child(g)
	stage.add_child(holder)

func _build_ball() -> void:
	ball = Node2D.new()
	ball_shadow = Sprite2D.new()
	ball_shadow.texture = Game.prop("spaldeen")
	ball_shadow.modulate = Color(0, 0, 0, 0.3)
	ball_shadow.scale = Vector2(1.3, 0.55) * Tuning.ART
	ball.add_child(ball_shadow)
	ball_spr = Sprite2D.new()
	ball_spr.texture = Game.prop("spaldeen")
	ball_spr.scale = Vector2(BALL_SCALE, BALL_SCALE) * Tuning.ART
	ball.add_child(ball_spr)
	ball.visible = false
	stage.add_child(ball)

# ---------------------------------------------------------------- kids on the field
func _spawn_kid(id: String, pos: Vector2, kid_scale := 1.0) -> Kid:
	var k := Kid.new(id)
	k.position = pos
	k.scale = Vector2(kid_scale, kid_scale)
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
			var k := _spawn_kid(lineup[pos_key], Tuning.FIELD_POS[pos_key], FIELDER_SCALE)
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
	batter_node.rest_anim = "bat_stance"
	batter_node.play("bat_stance", 4.0)

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
			runner_nodes[id].position = want[id]
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
	if not _plan.is_empty() and bool(_plan.get("swing", false)):
		_vis_commit_t = _cross_t + clampf(float(_plan["err_ms"]) / 1000.0,
			-Tuning.SWING_EARLY, Tuning.SWING_LATE - 0.02)
	ball.visible = true
	ball.position = _pA
	ball_spr.position = Vector2(0, -PITCH_ARC_H)
	_bt = 0.0
	_ball_mode = "pitch"

func _unhandled_input(event: InputEvent) -> void:
	if autopilot or _ball_mode != "pitch" or not _human_bat or _committed:
		return
	var pressed := false
	if event is InputEventScreenTouch and event.pressed:
		pressed = true
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		pressed = true
	if not pressed:
		return
	if _bt < _cross_t - Tuning.SWING_EARLY or _bt > _cross_t + Tuning.SWING_LATE:
		return
	_committed = true
	_vis_committed = true
	_commit_err = (_bt - _cross_t) * 1000.0
	if batter_node != null and is_instance_valid(batter_node):
		batter_node.play("swing", 14.0, false)
	hint_lbl.visible = false

func _process(delta: float) -> void:
	_process_ball(delta)
	_process_hud(delta)

func _process_ball(delta: float) -> void:
	if _ball_mode == "pitch":
		_bt += delta
		# cpu swing anim at its planned error
		if not _vis_committed and _vis_commit_t >= 0.0 and _bt >= _vis_commit_t:
			_vis_committed = true
			if batter_node != null and is_instance_valid(batter_node):
				batter_node.play("swing", 14.0, false)
		# batting hint while the window is open
		if _human_bat:
			hint_lbl.visible = not _committed \
				and _bt >= _cross_t - Tuning.SWING_EARLY and _bt <= _cross_t + Tuning.SWING_LATE
		# ball along its timeline
		if _bt < _ta:
			var u := _bt / _ta
			ball.position = _pA.lerp(_pB, u)
			ball_spr.position.y = -(PITCH_ARC_H * (1.0 - u) + PITCH_ARC_BOB * sin(PI * u))
		elif _bt < _cross_t:
			var u := (_bt - _ta) / _tb
			ball.position = _pB.lerp(_pC, u)
			ball_spr.position.y = -(_rest_h * PITCH_ARC_H * sin(PI * u))
		elif not _vis_committed:
			var u := minf((_bt - _cross_t) / MITT_TIME, 1.0)
			ball.position = _pC.lerp(_mitt, u)
			ball_spr.position.y = -(PITCH_ARC_BOB * u)
		# contact pending: ball holds at the plate until the window closes
		if _bt >= _cross_t + Tuning.SWING_LATE:
			_resolve_pitch()
	elif _ball_mode == "hit":
		_bt += delta
		var pos := ball.position
		if _bt <= _h_dur:
			var u := _bt / _h_dur
			pos = _h_from.lerp(_h_land, u)
			ball_spr.position.y = -_hit_height(u)
		else:
			var rt := _bt - _h_dur
			if rt < _h_roll_t:
				var ru := rt / _h_roll_t
				var k := 1.0 - (1.0 - ru) * (1.0 - ru)
				pos = _h_land + _h_roll_dir * _h_roll_px * k
				ball_spr.position.y = -maxf(0.0, HIT_PEAK["ground"] * 0.3 * sin(PI * ru * 2.0) * (1.0 - ru))
			else:
				ball.position = _h_land + _h_roll_dir * _h_roll_px
				ball_spr.position.y = 0.0
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
			var target := clampf(pos.y - CAM_CHASE_LEAD, CAM_CHASE_MIN_Y, CAM_CHASE_MAX_Y)
			cam.position.y = lerpf(cam.position.y, target, minf(1.0, CAM_CHASE_LERP * delta))
		ball.position = pos

func _hit_height(u: float) -> float:
	if _h_loft == "ground":
		# two decaying bounces on the cobbles
		if u < 0.5:
			return HIT_PEAK["ground"] * sin(PI * u / 0.5)
		elif u < 0.8:
			return HIT_PEAK["ground"] * 0.4 * sin(PI * (u - 0.5) / 0.3)
		return HIT_PEAK["ground"] * 0.16 * sin(PI * (u - 0.8) / 0.2)
	return _h_peak * sin(PI * u)

func _resolve_pitch() -> void:
	_ball_mode = ""
	hint_lbl.visible = false
	var swung := false
	var err := 0.0
	if _plan.is_empty():
		swung = _committed
		err = _commit_err
	else:
		swung = bool(_plan.get("swing", false))
		err = float(_plan.get("err_ms", 0.0))
	var ev: Dictionary = core.resolve_swing(err) if swung else core.resolve_no_swing()
	pitch_resolved.emit(ev)

# ---------------------------------------------------------------- hit timeline
func _launch_hit(play: Dictionary) -> void:
	_h_from = ball.position
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
		_h_dur = FLY_T + _h_carry * FLY_T_CARRY
	elif bool(play["fire_escape"]):
		var fe: Vector2 = Tuning.FE_L if float(play["lane"]) < 0.0 else Tuning.FE_R
		var inward := 34.0 if float(play["lane"]) < 0.0 else -34.0
		_h_land = fe + Vector2(inward, 40.0)
		_h_dur = FLY_T
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
				_h_dur = FLY_T + _h_carry * FLY_T_CARRY
			"line":
				_h_dur = LINE_T
			_:
				_h_dur = GROUND_T
				if not _h_caught:
					_h_roll_t = GROUND_ROLL_T
					_h_roll_px = GROUND_ROLL_PX
					_h_roll_dir = (_h_land - _h_from).normalized()
	if res == "hr" and not _h_window:
		_h_roll_t = HR_ROLL_T
		_h_roll_px = HR_ROLL_PX
		_h_roll_dir = Vector2(0, -1)
	_sewer_prev_y = _h_from.y
	if _h_carry > 0.5 and _cam_tw != null:
		_cam_tw.kill()
	_bt = 0.0
	_ball_flying = true
	_ball_mode = "hit"

func _await_ball() -> void:
	if _ball_flying:
		await ball_done

func _ball_throw_to(target: Vector2, dur: float) -> void:
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(ball, "position", target, dur)
	tw.tween_method(func(u: float) -> void:
		ball_spr.position.y = -THROW_ARC_H * sin(PI * u), 0.0, 1.0, dur)
	await tw.finished

func _ball_to_mitt() -> void:
	var tw := create_tween()
	tw.tween_property(ball, "position", _mitt, MITT_TIME)
	# cosmetic — not awaited

func _foul_pop() -> void:
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(ball, "position",
		ball.position + Vector2(randf_range(-140.0, 140.0), 70.0), 0.35)
	tw.tween_method(func(u: float) -> void:
		ball_spr.position.y = -90.0 * sin(PI * u), 0.0, 1.0, 0.35)

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
	for step in range(from_i + 1, to_i + 1):
		tw.tween_property(node, "position", _base_pos[mini(step, 3)], RUN_LEG_T)
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
		tw.tween_property(node, "position", toward, 0.3)

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
		tw.tween_property(node, "position", _base_pos[i], 0.25)
		tw.tween_callback(func() -> void:
			if is_instance_valid(node):
				node.play("idle", 6.0))

func _batter_jog(frac: float) -> void:
	if batter_node == null or not is_instance_valid(batter_node):
		return
	batter_node.rest_anim = "idle"
	batter_node.play("run", 11.0)
	var tw := create_tween()
	tw.tween_property(batter_node, "position",
		BATTER_POS.lerp(Tuning.BASE_1, frac), 0.32)

func _batter_out_at_first() -> void:
	if batter_node == null or not is_instance_valid(batter_node):
		return
	var node := batter_node
	batter_node = null
	var tw := create_tween()
	tw.tween_property(node, "position", Tuning.BASE_1, 0.16)
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
	var to := _h_land + (k.position - _h_land).normalized() * 26.0
	var dur := clampf(k.position.distance_to(to) / 650.0, 0.2, 0.6)
	k.play("run", 11.0)
	var tw := create_tween()
	tw.tween_property(k, "position", to, dur)
	tw.tween_callback(func() -> void:
		if is_instance_valid(k):
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
		if k.position.distance_to(home) < 6.0:
			continue
		k.play("run", 10.0)
		var tw := create_tween()
		tw.tween_property(k, "position", home, 0.4)
		tw.tween_callback(func() -> void:
			if is_instance_valid(k):
				k.play("idle", 6.0))

func _catcher_take() -> void:
	_fielder_catch("C")

func _scatter_fielders() -> void:
	for pos_key in fielders:
		var k: Kid = fielders[pos_key]
		if not is_instance_valid(k):
			continue
		var dash := Vector2(randf_range(-1.0, 1.0), randf_range(-1.0, 1.0)).normalized() * SCATTER_PX
		k.play("run", 12.0)
		var tw := create_tween()
		tw.tween_property(k, "position", k.position + dash, 0.12)
		tw.tween_property(k, "position", k.position, 0.28)
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
	cop.position = Vector2(Tuning.WALL_L - 120.0, 1800.0)
	stage.add_child(cop)
	cop.play("walk", 7.0)
	var cop_tw := create_tween()
	cop_tw.tween_property(cop, "position",
		Vector2(Tuning.WALL_R + 120.0, 1800.0), cheese_len + 0.8)
	cop_tw.tween_callback(func() -> void:
		if is_instance_valid(cop):
			cop.queue_free())
	for k0 in _field_kids():
		var k: Kid = k0
		var here := k.position
		var wall_x := Tuning.WALL_L + 70.0 if here.x < Tuning.PLATE.x else Tuning.WALL_R - 70.0
		k.play("run", 12.0)
		var tw := create_tween()
		tw.tween_property(k, "position", Vector2(wall_x, here.y), cheese_len * 0.45)
		tw.tween_interval(cheese_len * 0.1)
		tw.tween_property(k, "position", here, cheese_len * 0.45)
		tw.tween_callback(func() -> void:
			if is_instance_valid(k):
				k.play("idle", 6.0))
	await _beat(cheese_len + 0.9)
	ticker(Announcer.line("cheese_end"))

func _finale() -> void:
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
	if _cam_tw != null:
		_cam_tw.kill()
	_cam_tw = create_tween().set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)
	_cam_tw.tween_property(cam, "position", _cam_default(), CAM_HOME_T)

func _fx_label(text: String, world_pos: Vector2) -> void:
	var lbl := Label.new()
	lbl.text = text
	lbl.add_theme_font_size_override("font_size", 52)
	lbl.add_theme_color_override("font_color", Tuning.CHALK)
	lbl.add_theme_color_override("font_shadow_color", Color(Tuning.INK, 0.8))
	lbl.add_theme_constant_override("shadow_offset_x", 3)
	lbl.add_theme_constant_override("shadow_offset_y", 3)
	lbl.position = world_pos + Vector2(-120.0, -20.0)
	fx.add_child(lbl)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(lbl, "position", lbl.position + Vector2(0, -FX_RISE), FX_LIFE)
	tw.tween_property(lbl, "modulate", Color(1, 1, 1, 0), FX_LIFE).set_delay(FX_LIFE * 0.35)
	tw.chain().tween_callback(lbl.queue_free)

# ---------------------------------------------------------------- HUD
func _build_hud() -> void:
	# brick scoreboard
	score_panel = PanelContainer.new()
	score_panel.add_theme_stylebox_override("panel", _plate_style("ui_board", 60, 22))
	score_panel.position = Vector2(20, 16)
	score_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sv := VBoxContainer.new()
	sv.mouse_filter = Control.MOUSE_FILTER_IGNORE
	score_lbl = _chalk_label("VIS 0 — GANG 0", 26)
	count_lbl = _chalk_label("INN 1▲ · OUT – · B0 S0", 19)
	sv.add_child(score_lbl)
	sv.add_child(count_lbl)
	score_panel.add_child(sv)
	hud.add_child(score_panel)
	# announcer strip
	var strip := PanelContainer.new()
	strip.add_theme_stylebox_override("panel", _paper_style())
	strip.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	strip.offset_left = 14
	strip.offset_right = -14
	strip.offset_top = -86
	strip.offset_bottom = -10
	strip.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := HBoxContainer.new()
	sh.add_theme_constant_override("separation", 14)
	sh.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var face := TextureRect.new()
	var face_frames: Array = Game.frames("announcer", "idle", 2)
	if not face_frames.is_empty():
		face.texture = face_frames[0]
	face.custom_minimum_size = Vector2(60, 68)
	face.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	face.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	face.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sh.add_child(face)
	tick_lbl = Label.new()
	tick_lbl.add_theme_font_size_override("font_size", 21)
	tick_lbl.add_theme_color_override("font_color", Tuning.INK)
	tick_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	tick_lbl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	tick_lbl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	tick_lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sh.add_child(tick_lbl)
	strip.add_child(sh)
	hud.add_child(strip)
	# prompt area (pitch call / bat hint / throw call) — one visible at a time
	var prompt_root := VBoxContainer.new()
	prompt_root.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM,
		Control.PRESET_MODE_MINSIZE, 130)
	prompt_root.grow_horizontal = Control.GROW_DIRECTION_BOTH
	prompt_root.grow_vertical = Control.GROW_DIRECTION_BEGIN
	prompt_root.alignment = BoxContainer.ALIGNMENT_END
	prompt_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(prompt_root)
	_build_pitch_ui(prompt_root)
	_build_throw_ui(prompt_root)
	hint_lbl = _chalk_label("TAP ANYWHERE TO SWING", 26)
	hint_lbl.add_theme_color_override("font_shadow_color", Color(Tuning.INK, 0.9))
	hint_lbl.add_theme_constant_override("shadow_offset_x", 2)
	hint_lbl.add_theme_constant_override("shadow_offset_y", 2)
	hint_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hint_lbl.visible = false
	prompt_root.add_child(hint_lbl)
	var pulse := create_tween().set_loops()
	pulse.tween_property(hint_lbl, "modulate", Color(1, 1, 1, 0.45), 0.4)
	pulse.tween_property(hint_lbl, "modulate", Color(1, 1, 1, 1.0), 0.4)

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
			_bar_running = true)
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
	score_lbl.text = "VIS %d — GANG %d" % [sc[0], sc[1]]
	var arrow := "▲" if int(snap["half"]) == MatchCore.Half.TOP else "▼"
	var outs_n := int(snap["outs"])
	var outs_s := "–" if outs_n == 0 else "|".repeat(outs_n)
	count_lbl.text = "INN %d%s · OUT %s · B%d S%d" % [int(snap["inning"]), arrow,
		outs_s, int(snap["balls"]), int(snap["strikes"])]
	var runs_total: int = sc[0] + sc[1]
	if _last_runs >= 0 and runs_total != _last_runs:
		score_panel.pivot_offset = score_panel.size / 2.0
		var tw := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		score_panel.scale = Vector2(1.22, 1.22)
		tw.tween_property(score_panel, "scale", Vector2.ONE, 0.3)
	_last_runs = runs_total

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

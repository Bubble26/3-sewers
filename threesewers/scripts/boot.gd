extends Control
# Title -> candy-store card rack -> match.
#
# Both front-end screens stand on the same block the match is played on: the
# corner outside Papadakis' candy store, after dark. tools/art_ui.py bakes
# that street once per orientation and everything here is printed chrome laid
# over it, so walking from the menu into the game never changes worlds.
#
# Debug: run with `-- --rack` (or TS_SCREEN=rack) to boot straight into the
# card rack, `-- --title` to force the title. Handy for look-dev captures.

const TEAM_SIZE := 6
const CARD_AR := 840.0 / 600.0                  # the kids' cards are 600x840
const FACE_RECT := Rect2(80, 95, 440, 350)      # portrait window on a card
const RIBBON_AT := 0.720                        # where the quirk band crosses
const RIBBON_H := 0.150
# the band is printed grey so one sprite can carry both states: dark leather
# while a kid is still on the shelf, spaldeen pink once you have taken them
const RIB_COLD := Color(0.30, 0.235, 0.205)
const RIB_HOT := Color(1.086, 0.467, 0.529)
const DRAG_SLOP := 14.0

var picked: Array[String] = []
var cards := {}                                 # id -> card Control
var card_rects := {}                            # id -> Rect2 in rack space
var start_btn: Control
var count_pips: Array[TextureRect] = []
var info_face: TextureRect
var info_name: Label
var info_quirk: Label
var info_text: Label
var rack_view: Control
var rack_content: Control
var rack_scroll := 0.0
var rack_span := 0.0
var iris_mat: ShaderMaterial
var screen := ""
var hovered := ""
var _drag_from := Vector2.ZERO
var _drag_base := 0.0
var _dragging := false
var _switching := false

# ---------------------------------------------------------------- boot
func _ready() -> void:
	_add_flicker()
	if Game.smoke:
		var ids: Array = Game.roster.keys()
		ids.sort()
		Game.player_team = ids.slice(0, 6)
		Game.cpu_team = ids.slice(6, 12)
		Engine.time_scale = 10.0
		var guard := Timer.new()
		guard.wait_time = 30.0
		guard.one_shot = true
		guard.timeout.connect(func():
			push_error("SMOKE TIMEOUT")
			get_tree().quit(1))
		add_child(guard)
		guard.start()
		_start_match(true)
		return
	_add_iris()
	get_viewport().size_changed.connect(_on_resized)
	if _debug_wants("rack"):
		_show_select()
	elif _debug_wants("quick"):
		_go_quick()
	else:
		_show_title()

static func _debug_wants(name_s: String) -> bool:
	if OS.get_environment("TS_SCREEN") == name_s:
		return true
	var flag := "--" + name_s
	return flag in OS.get_cmdline_user_args() or flag in OS.get_cmdline_args()

func _on_resized() -> void:
	# the phone can be turned over on the menu too; both plates are baked.
	# Rebuilding must never strand the iris shut, so it is snapped back open.
	if _switching or screen == "":
		return
	if screen == "title":
		_show_title(false)
	elif screen == "select":
		var keep := picked.duplicate()
		_show_select(false)
		for id in keep:
			_toggle(id, false)
	if iris_mat != null:
		iris_mat.set_shader_parameter("radius", 1.7)
		iris_mat.set_shader_parameter("aspect",
			get_viewport_rect().size.x / maxf(get_viewport_rect().size.y, 1.0))

# ---------------------------------------------------------------- chrome
func _portrait() -> bool:
	var vp := get_viewport_rect().size
	return vp.y > vp.x

func _u() -> float:
	return clampf(get_viewport_rect().size.x / 1280.0, 0.8, 1.6)

func _add_flicker() -> void:
	var cl := CanvasLayer.new()
	cl.layer = 30
	var fx := ColorRect.new()
	fx.set_anchors_preset(Control.PRESET_FULL_RECT)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/film.gdshader")
	fx.material = mat
	fx.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cl.add_child(fx)
	add_child(cl)

func _add_iris() -> void:
	# silent-film grammar: every screen irises open, every exit irises shut
	var cl := CanvasLayer.new()
	cl.layer = 25
	var rect := ColorRect.new()
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	iris_mat = ShaderMaterial.new()
	iris_mat.shader = load("res://shaders/iris.gdshader")
	iris_mat.set_shader_parameter("radius", 0.0)
	var vp := get_viewport_rect().size
	iris_mat.set_shader_parameter("aspect", vp.x / maxf(vp.y, 1.0))
	rect.material = iris_mat
	rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cl.add_child(rect)
	add_child(cl)

func _iris(open_it: bool, t := 0.34) -> Tween:
	if iris_mat == null:
		return null
	var vp := get_viewport_rect().size
	iris_mat.set_shader_parameter("aspect", vp.x / maxf(vp.y, 1.0))
	var from: float = iris_mat.get_shader_parameter("radius")
	var tw := create_tween().set_trans(Tween.TRANS_SINE)
	tw.tween_method(func(v: float) -> void:
		iris_mat.set_shader_parameter("radius", v), from, 1.7 if open_it else 0.0, t)
	return tw

func _street_bg(parent: Control) -> void:
	var key := "p" if _portrait() else "l"
	var path := "res://assets/ui/ui_street_%s.png" % key
	if ResourceLoader.exists(path):
		var tr := TextureRect.new()
		tr.texture = load(path)
		tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		tr.set_anchors_preset(Control.PRESET_FULL_RECT)
		tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
		parent.add_child(tr)
		parent.move_child(tr, 0)
		return
	var bg := ColorRect.new()
	bg.color = Color(0.09, 0.075, 0.08)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	parent.add_child(bg)
	parent.move_child(bg, 0)

func _tex_style(art: String, mx: int, my: int, cx: int, cy: int) -> StyleBox:
	var path := "res://assets/ui/%s.png" % art
	if ResourceLoader.exists(path):
		var st := StyleBoxTexture.new()
		st.texture = load(path)
		st.texture_margin_left = mx
		st.texture_margin_right = mx
		st.texture_margin_top = my
		st.texture_margin_bottom = my
		st.content_margin_left = cx
		st.content_margin_right = cx
		st.content_margin_top = cy
		st.content_margin_bottom = cy
		return st
	var sb := StyleBoxFlat.new()
	sb.bg_color = Tuning.PAPER
	sb.border_color = Tuning.INK
	sb.set_border_width_all(4)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(cx)
	return sb

func _label(text: String, size: int, col: Color, outline := 0) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	if outline > 0:
		l.add_theme_color_override("font_outline_color", Color(0.05, 0.04, 0.04, 0.95))
		l.add_theme_constant_override("outline_size", outline)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l

func _ticket(text: String, sub: String, cb: Callable, w: float, h: float,
		primary := true) -> Control:
	# a printed admission ticket. It sinks a little when you lean on it.
	var root := Control.new()
	root.custom_minimum_size = Vector2(w, h)
	root.size = Vector2(w, h)
	root.pivot_offset = Vector2(w, h) * 0.5
	var b := Button.new()
	b.set_anchors_preset(Control.PRESET_FULL_RECT)
	var st := _tex_style("ui_ticket" if primary else "ui_ticket_dark",
		26, 26, 20, 12)
	for s in ["normal", "hover", "pressed", "disabled"]:
		b.add_theme_stylebox_override(s, st)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	if primary:
		b.self_modulate = Color(0.95, 0.90, 0.81)   # gaslight, not daylight
	b.pressed.connect(cb)
	b.button_down.connect(func() -> void:
		var t := create_tween().set_trans(Tween.TRANS_BACK)
		t.tween_property(root, "scale", Vector2(0.955, 0.955), 0.07))
	b.button_up.connect(func() -> void:
		var t := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		t.tween_property(root, "scale", Vector2.ONE, 0.16))
	root.add_child(b)
	var ink: Color = Tuning.INK if primary else Tuning.GOLD
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = h * 0.11
	v.offset_right = -h * 0.11
	v.offset_top = -h * 0.05          # the plate art carries a drop shadow
	v.offset_bottom = -h * 0.09
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", int(-2 * _u()))
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var big := _label(text, int(h * (0.30 if sub != "" else 0.34)), ink)
	big.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	big.clip_text = true
	v.add_child(big)
	if sub != "":
		var sm := _label(sub, int(h * 0.145), Color(ink, 0.74))
		sm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sm.clip_text = true
		v.add_child(sm)
	root.add_child(v)
	root.set_meta("button", b)
	return root

func _set_enabled(ticket: Control, on: bool) -> void:
	var b: Button = ticket.get_meta("button")
	b.disabled = not on
	ticket.modulate = Color(1, 1, 1, 1.0 if on else 0.42)

func _clear() -> void:
	for c in get_children():
		if not (c is CanvasLayer):
			c.queue_free()

# ---------------------------------------------------------------- title
func _show_title(iris := true) -> void:
	_switching = false
	_clear()
	screen = "title"
	var vp := get_viewport_rect().size
	var u := _u()
	var land := not _portrait()
	_street_bg(self)

	# The hanging banner. The painted board is 1440x650 inside a 1560x920
	# plate; the rest of the plate is rope, which runs off the top of the
	# screen so nothing has to line up when the board bobs.
	var board_w: float
	var board_h: float
	if land:
		board_h = vp.y * 0.370
		board_w = board_h * 1440.0 / 650.0
		if board_w > vp.x * 0.56:
			board_w = vp.x * 0.56
			board_h = board_w * 650.0 / 1440.0
	else:
		board_w = vp.x * 0.90
		board_h = board_w * 650.0 / 1440.0
		if board_h > vp.y * 0.26:
			board_h = vp.y * 0.26
			board_w = board_h * 1440.0 / 650.0
	var plate_w := board_w * 1560.0 / 1440.0
	var plate_h := plate_w * 920.0 / 1560.0
	var board_top: float = vp.y * (0.035 if land else 0.070)
	var banner := TextureRect.new()
	banner.texture = load("res://assets/ui/ui_banner.png")
	banner.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	banner.stretch_mode = TextureRect.STRETCH_SCALE
	banner.size = Vector2(plate_w, plate_h)
	banner.position = Vector2((vp.x - plate_w) * 0.5, board_top - plate_h * 0.270)
	banner.pivot_offset = Vector2(plate_w * 0.5, 0)
	# printed stock hanging in gaslight, not a white rectangle pasted on top
	banner.modulate = Color(0.93, 0.87, 0.77)
	banner.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(banner)
	# it hangs, so it breathes: a slow bob and sway on the ropes
	var bob := create_tween().set_loops().set_trans(Tween.TRANS_SINE)
	bob.tween_property(banner, "position:y", banner.position.y + 7.0 * u, 2.6)
	bob.tween_property(banner, "position:y", banner.position.y, 2.6)
	var sway := create_tween().set_loops().set_trans(Tween.TRANS_SINE)
	sway.tween_property(banner, "rotation_degrees", 0.34, 3.1)
	sway.tween_property(banner, "rotation_degrees", -0.34, 3.1)

	var ty := board_top + board_h + vp.y * (0.018 if land else 0.020)
	var tag_h: float = vp.y * (0.045 if land else 0.022)
	var tag := _label("manhole for home · stoop for first · hydrant for third",
		int(25 * u), Tuning.PAPER, int(9 * u))
	tag.size = Vector2(vp.x, tag_h)
	tag.position = Vector2(0, ty)
	add_child(tag)

	# the buttons stand on the brick, between the banner and the shop sign
	var bh: float = vp.y * (0.135 if land else 0.078)
	var bw: float = minf(bh * 3.35, vp.x * (0.26 if land else 0.60))
	var gap: float = bh * (0.16 if land else 0.34)
	var by: float = ty + tag_h + vp.y * (0.024 if land else 0.075)
	if land:
		var total := bw * 2.0 + gap
		_place_title_buttons((vp.x - total) * 0.5, by, bw, bh, gap, true)
	else:
		_place_title_buttons((vp.x - bw) * 0.5, by, bw, bh, gap, false)
	if iris:
		_iris(true, 0.5)

func _place_title_buttons(bx: float, by: float, bw: float, bh: float,
		gap: float, land: bool) -> void:
	var play := _ticket("PLAY BALL", "pick your six", _go_select, bw, bh, true)
	play.position = Vector2(bx, by)
	add_child(play)
	var quick := _ticket("QUICK GAME", "we'll choose up for you", _go_quick,
		bw, bh * 0.86, false)
	if land:
		quick.position = Vector2(bx + bw + gap, by + bh * 0.07)
	else:
		quick.position = Vector2(bx, by + bh + gap)
	add_child(quick)

func _go_select() -> void:
	_switching = true
	var tw := _iris(false, 0.30)
	if tw != null:
		await tw.finished
	_show_select()

func _go_quick() -> void:
	_switching = true
	var ids: Array = Game.roster.keys()
	ids.shuffle()
	picked.assign(ids.slice(0, TEAM_SIZE))
	var tw := _iris(false, 0.30)
	if tw != null:
		await tw.finished
	_confirm_select()

# ---------------------------------------------------------------- card rack
func _show_select(iris := true) -> void:
	_switching = false
	_clear()
	screen = "select"
	picked = []
	cards = {}
	card_rects = {}
	count_pips = []
	rack_scroll = 0.0
	hovered = ""
	var vp := get_viewport_rect().size
	var u := _u()
	var land := not _portrait()
	_street_bg(self)
	var dim := ColorRect.new()          # push the street back behind the rack
	dim.color = Color(0.05, 0.04, 0.05, 0.46)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(dim)

	var head_h: float = vp.y * (0.125 if land else 0.108)
	var foot_h: float = vp.y * (0.185 if land else 0.160)
	_build_rack_head(vp, u, head_h)
	_build_rack(vp, u, land, head_h, vp.y - head_h - foot_h)
	_build_rack_foot(vp, u, land, foot_h)
	_refresh_pick_ui()
	# look-dev: TS_PICK=4 boots the rack with four kids already taken, so the
	# chosen state can be captured without a hand on the screen
	var pre := OS.get_environment("TS_PICK")
	if pre != "" and pre.is_valid_int():
		var ids2: Array = Game.roster.keys()
		ids2.sort()
		for i in mini(pre.to_int(), ids2.size()):
			_toggle(ids2[i], false)
	if iris:
		_iris(true, 0.45)

func _build_rack_head(vp: Vector2, u: float, head_h: float) -> void:
	# the shop's own enamel sign, and six spaldeens that light as you choose
	var sign_h: float = head_h * 0.56
	var sign_w: float = sign_h * 1400.0 / 250.0
	if sign_w > vp.x * 0.52:
		sign_w = vp.x * 0.52
		sign_h = sign_w * 250.0 / 1400.0
	var head := TextureRect.new()
	head.texture = load("res://assets/ui/ui_rack_header.png")
	head.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	head.stretch_mode = TextureRect.STRETCH_SCALE
	head.size = Vector2(sign_w, sign_h)
	head.position = Vector2((vp.x - sign_w) * 0.5, head_h * 0.06)
	head.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(head)

	var pip: Texture2D = Game.prop("spaldeen")
	var ps: float = head_h * 0.24
	var step := ps * 1.55
	var px := (vp.x - step * (TEAM_SIZE - 1) - ps) * 0.5
	var py := head.position.y + sign_h + head_h * 0.10
	for i in TEAM_SIZE:
		var t := TextureRect.new()
		t.texture = pip
		t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		t.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		t.size = Vector2(ps, ps)
		t.position = Vector2(px + step * i, py)
		t.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(t)
		count_pips.append(t)

	var bb: float = head_h * (0.58 if vp.x > vp.y else 0.42)
	var back := _ticket("BACK", "", _go_title, bb * 2.2, bb, false)
	back.position = Vector2(18.0 * u, maxf(head_h * 0.5 - bb * 0.5, 8.0 * u))
	add_child(back)

func _build_rack(vp: Vector2, u: float, land: bool, top: float, h: float) -> void:
	var ids: Array = Game.roster.keys()
	ids.sort()
	var cols := 6 if land else 3
	var rows := int(ceil(float(ids.size()) / cols))
	var gap: float = (22.0 if land else 18.0) * u
	var shelf_h: float = 22.0 * u
	var card_w: float = (vp.x * 0.955 - gap * (cols - 1)) / cols
	var card_h: float = card_w * CARD_AR
	var row_h: float = card_h + shelf_h + gap * 1.3
	var lift: float = card_h * 0.085          # headroom for a card pulled out
	# a rack taller than the shelf gets scrolled; otherwise the cards come
	# down to fit, and the rail opens up to use the width they gave back
	if row_h * rows + lift > h:
		card_h = (h - lift) / rows - shelf_h - gap * 1.3
		card_w = card_h / CARD_AR
		row_h = card_h + shelf_h + gap * 1.3
		lift = card_h * 0.085
		gap = clampf((vp.x * 0.90 - card_w * cols) / maxf(cols - 1, 1),
			gap, card_w * 0.30)
	var grid_w := card_w * cols + gap * (cols - 1)

	rack_view = Control.new()
	rack_view.position = Vector2(0, top)
	rack_view.size = Vector2(vp.x, h)
	rack_view.clip_contents = true
	rack_view.mouse_filter = Control.MOUSE_FILTER_STOP
	rack_view.gui_input.connect(_on_rack_input)
	add_child(rack_view)
	rack_content = Control.new()
	rack_content.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rack_content.size = Vector2(vp.x, row_h * rows + lift)
	rack_view.add_child(rack_content)
	rack_span = maxf(0.0, row_h * rows + lift - h)
	rack_content.position.y = (h - row_h * rows - lift) * 0.5 if rack_span <= 0.0 \
		else 0.0

	var x0 := (vp.x - grid_w) * 0.5
	for r in rows:
		# the wooden rail the row stands on
		var shelf := NinePatchRect.new()
		shelf.texture = load("res://assets/ui/ui_shelf.png")
		shelf.patch_margin_left = 60
		shelf.patch_margin_right = 60
		shelf.size = Vector2(grid_w + gap * 2.2, shelf_h * 2.0)
		shelf.position = Vector2(x0 - gap * 1.1, lift + r * row_h + card_h - shelf_h * 0.35)
		shelf.mouse_filter = Control.MOUSE_FILTER_IGNORE
		rack_content.add_child(shelf)
		for k in cols:
			var idx := r * cols + k
			if idx >= ids.size():
				break
			var id: String = ids[idx]
			var cell := Rect2(x0 + k * (card_w + gap), lift + r * row_h, card_w, card_h)
			card_rects[id] = cell
			rack_content.add_child(_make_card(id, cell, u, idx))

func _make_card(id: String, cell: Rect2, u: float, idx: int) -> Control:
	# the cell is the layout box; the card inside it is free to lift and tilt
	var slot := Control.new()
	slot.position = cell.position
	slot.size = cell.size
	slot.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var card := Control.new()
	card.size = cell.size
	card.pivot_offset = cell.size * 0.5
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.rotation_degrees = (-1.0 if idx % 2 == 0 else 1.0) * 0.7
	slot.add_child(card)

	var art := TextureRect.new()
	art.texture = Game.card(id)
	art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	art.stretch_mode = TextureRect.STRETCH_SCALE
	art.size = cell.size
	art.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(art)

	# the quirk, pinned across the card where its printed banner sits — this
	# is the whole charm of the roster and it has to read at a glance
	var kid: Dictionary = Game.roster[id]
	var rib := NinePatchRect.new()
	rib.texture = load("res://assets/ui/ui_ribbon.png")
	rib.patch_margin_left = 44
	rib.patch_margin_right = 44
	rib.patch_margin_top = 26
	rib.patch_margin_bottom = 26
	var rib_h: float = cell.size.y * RIBBON_H
	rib.size = Vector2(cell.size.x * 1.10, rib_h)
	rib.position = Vector2(-cell.size.x * 0.05, cell.size.y * RIBBON_AT - rib_h * 0.5)
	rib.modulate = RIB_COLD
	rib.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(rib)
	var qn := _label(String(kid["qname"]).to_upper(),
		int(clampf(rib_h * 0.44, 10, 38)), Tuning.CHALK, int(rib_h * 0.08))
	qn.clip_text = true
	qn.size = Vector2(rib.size.x * 0.90, rib.size.y)
	qn.position = rib.position + Vector2(rib.size.x * 0.05, 0)
	card.add_child(qn)

	var stamp := TextureRect.new()
	stamp.texture = load("res://assets/ui/ui_stamp.png")
	stamp.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	stamp.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	var ss: float = cell.size.x * 0.34
	stamp.size = Vector2(ss, ss)
	stamp.position = Vector2(cell.size.x - ss * 0.94, ss * 0.06)
	stamp.rotation_degrees = 11.0
	stamp.pivot_offset = Vector2(ss, ss) * 0.5
	stamp.visible = false
	stamp.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(stamp)

	var edge := Panel.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0)
	sb.border_color = Color(0, 0, 0, 0)
	sb.set_border_width_all(int(maxf(4.0, cell.size.x * 0.030)))
	sb.set_corner_radius_all(int(cell.size.x * 0.045))
	edge.add_theme_stylebox_override("panel", sb)
	edge.size = cell.size
	edge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(edge)

	card.modulate = Color(0.88, 0.85, 0.84)
	card.set_meta("stamp", stamp)
	card.set_meta("edge", sb)
	card.set_meta("rib", rib)
	cards[id] = card
	return slot

func _build_rack_foot(vp: Vector2, u: float, land: bool, foot_h: float) -> void:
	var top := vp.y - foot_h
	var pad: float = 18.0 * u
	var bw: float = minf(vp.x * (0.28 if land else 0.50), 480 * u)
	var bh: float = minf(bw * 0.30, foot_h * (0.62 if land else 0.44))
	var plate_w: float = (vp.x - bw - pad * 3.0) if land else (vp.x - pad * 2.0)
	var plate_h: float = foot_h * (0.76 if land else 0.50)
	var plate_y: float = (top + (foot_h - plate_h) * 0.5) if land \
		else (top + foot_h * 0.05)

	var plate := NinePatchRect.new()
	plate.texture = load("res://assets/ui/ui_plate.png")
	for m in ["left", "right", "top", "bottom"]:
		plate.set("patch_margin_" + m, 58)
	plate.size = Vector2(plate_w, plate_h)
	plate.position = Vector2(pad, plate_y)
	plate.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(plate)

	var fs: float = plate_h * 0.76
	info_face = TextureRect.new()
	info_face.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	info_face.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	info_face.size = Vector2(fs * 1.18, fs)
	info_face.position = plate.position + Vector2(plate_h * 0.14, plate_h * 0.12)
	info_face.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(info_face)

	var tx := info_face.position.x + info_face.size.x + plate_h * 0.16
	var tw := plate.position.x + plate_w - tx - plate_h * 0.16
	info_name = _label("", int(plate_h * 0.25), Tuning.CHALK)
	info_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	info_name.clip_text = true
	info_name.size = Vector2(tw, plate_h * 0.28)
	info_name.position = Vector2(tx, plate_y + plate_h * 0.09)
	add_child(info_name)
	info_quirk = _label("", int(plate_h * 0.22), Tuning.PINK)
	info_quirk.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	info_quirk.clip_text = true
	info_quirk.size = Vector2(tw, plate_h * 0.24)
	info_quirk.position = Vector2(tx, plate_y + plate_h * 0.38)
	add_child(info_quirk)
	info_text = _label("", int(plate_h * 0.185), Color(Tuning.PAPER, 0.88))
	info_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT
	info_text.vertical_alignment = VERTICAL_ALIGNMENT_TOP
	info_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	info_text.size = Vector2(tw, plate_h * 0.38)
	info_text.position = Vector2(tx, plate_y + plate_h * 0.62)
	add_child(info_text)

	start_btn = _ticket("PLAY BALL", "", _confirm_select, bw, bh, true)
	if land:
		start_btn.position = Vector2(vp.x - bw - pad, top + (foot_h - bh) * 0.5)
	else:
		start_btn.position = Vector2((vp.x - bw) * 0.5,
			plate_y + plate_h + (foot_h - plate_h - bh) * 0.42)
	add_child(start_btn)

func _go_title() -> void:
	_switching = true
	var tw := _iris(false, 0.28)
	if tw != null:
		await tw.finished
	_show_title()

# ---------------------------------------------------------------- picking
func _on_rack_input(ev: InputEvent) -> void:
	# taps pick, drags scroll — the rack has to survive a thumb on a phone
	if ev is InputEventMouseButton:
		var mb := ev as InputEventMouseButton
		if mb.button_index == MOUSE_BUTTON_WHEEL_DOWN and mb.pressed:
			_scroll_to(rack_scroll + 70.0)
			return
		if mb.button_index == MOUSE_BUTTON_WHEEL_UP and mb.pressed:
			_scroll_to(rack_scroll - 70.0)
			return
		if mb.button_index != MOUSE_BUTTON_LEFT:
			return
		if mb.pressed:
			_drag_from = mb.position
			_drag_base = rack_scroll
			_dragging = false
		elif not _dragging:
			var id := _card_at(mb.position)
			if id != "":
				_toggle(id)
	elif ev is InputEventMouseMotion:
		var mm := ev as InputEventMouseMotion
		if mm.button_mask & MOUSE_BUTTON_MASK_LEFT:
			if absf(mm.position.y - _drag_from.y) > DRAG_SLOP:
				_dragging = true
			if _dragging:
				_scroll_to(_drag_base - (mm.position.y - _drag_from.y))
		else:
			_set_hover(_card_at(mm.position))

func _scroll_to(v: float) -> void:
	if rack_span <= 0.0:
		return
	rack_scroll = clampf(v, 0.0, rack_span)
	rack_content.position.y = -rack_scroll

func _card_at(p: Vector2) -> String:
	var q := p - rack_content.position
	for id in card_rects:
		if (card_rects[id] as Rect2).has_point(q):
			return id
	return ""

func _set_hover(id: String) -> void:
	if id == hovered:
		return
	hovered = id
	for k in cards:
		_restyle(k)
	if id != "":
		_show_info(id)

func _toggle(id: String, animate := true) -> void:
	if id in picked:
		picked.erase(id)
	elif picked.size() < TEAM_SIZE:
		picked.append(id)
	else:
		_show_info(id)
		info_text.text = "Six to a side. Tap one of yours to put them back."
		return
	_show_info(id)
	_restyle(id, animate)
	_refresh_pick_ui()

func _restyle(id: String, animate := true) -> void:
	var card: Control = cards.get(id)
	if card == null:
		return
	var on: bool = id in picked
	var hot: bool = id == hovered
	var stamp: TextureRect = card.get_meta("stamp")
	var edge: StyleBoxFlat = card.get_meta("edge")
	stamp.visible = on
	edge.border_color = Tuning.PINK if on else (
		Color(Tuning.GOLD, 0.55) if hot else Color(0, 0, 0, 0))
	var lift: float = -card.size.y * (0.055 if on else (0.028 if hot else 0.0))
	var tilt: float = 0.7 * (-1.0 if card_rects.keys().find(id) % 2 == 0 else 1.0)
	var sc: float = 1.032 if on else (1.022 if hot else 1.0)
	var rib: NinePatchRect = card.get_meta("rib")
	rib.modulate = RIB_HOT if on else RIB_COLD
	var tint := Color(1, 1, 1) if on else (
		Color(0.97, 0.95, 0.94) if hot else Color(0.88, 0.85, 0.84))
	if not animate:
		card.position.y = lift
		card.scale = Vector2(sc, sc)
		card.rotation_degrees = -tilt if on else tilt
		card.modulate = tint
		return
	var tw := create_tween().set_parallel().set_trans(Tween.TRANS_BACK) \
		.set_ease(Tween.EASE_OUT)
	tw.tween_property(card, "position:y", lift, 0.20)
	tw.tween_property(card, "scale", Vector2(sc, sc), 0.20)
	tw.tween_property(card, "rotation_degrees", -tilt if on else tilt, 0.20)
	tw.tween_property(card, "modulate", tint, 0.15)
	if on:
		stamp.scale = Vector2(1.9, 1.9)
		var st := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		st.tween_property(stamp, "scale", Vector2.ONE, 0.24)

func _show_info(id: String) -> void:
	if info_name == null:
		return
	var kid: Dictionary = Game.roster[id]
	var at := AtlasTexture.new()
	at.atlas = Game.card(id)
	at.region = FACE_RECT
	info_face.texture = at
	info_name.text = String(kid["name"]).to_upper()
	info_quirk.text = String(kid["qname"]).to_upper()
	info_text.text = String(kid["qdesc"])

func _refresh_pick_ui() -> void:
	for i in count_pips.size():
		count_pips[i].modulate = Color(1, 1, 1, 1) if i < picked.size() \
			else Color(0.30, 0.26, 0.26, 0.85)
	if start_btn != null:
		_set_enabled(start_btn, picked.size() == TEAM_SIZE)
	if info_name != null and picked.is_empty() and info_name.text == "":
		info_name.text = "CHOOSE UP SIDES"
		info_quirk.text = "SIX KIDS"
		info_text.text = "Tap a card to take that kid. Every one of them has a trick."

# ---------------------------------------------------------------- handoff
func _confirm_select() -> void:
	Game.player_team = picked.duplicate()
	var rest: Array = []
	for id in Game.roster.keys():
		if not (id in picked):
			rest.append(id)
	rest.sort_custom(func(a, b):
		var ra = Game.roster[a]
		var rb = Game.roster[b]
		return ra["PWR"] + ra["CON"] + ra["ARM"] > rb["PWR"] + rb["CON"] + rb["ARM"])
	Game.cpu_team = rest.slice(0, TEAM_SIZE)
	_start_match(false)

func _start_match(auto: bool) -> void:
	var mv := Node2D.new()
	mv.set_script(load("res://scripts/match_view.gd"))
	mv.autopilot = auto
	# deferred: _ready-time add (smoke path) hits the busy root otherwise
	get_tree().root.add_child.call_deferred(mv)
	queue_free()

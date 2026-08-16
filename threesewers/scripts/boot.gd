extends Control
# Title -> candy-store card rack -> match.

var picked: Array = []
var card_nodes := {}
var start_btn: Button

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
	_show_title()

func _paper_bg(parent: Control) -> void:
	var bg := ColorRect.new()
	bg.color = Tuning.PAPER
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	parent.add_child(bg)
	parent.move_child(bg, 0)

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

func _clear() -> void:
	for c in get_children():
		if not (c is CanvasLayer):
			c.queue_free()

func _show_title() -> void:
	_clear()
	_paper_bg(self)
	var v := VBoxContainer.new()
	v.set_anchors_preset(Control.PRESET_CENTER)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 14)
	var eyebrow := Label.new()
	eyebrow.text = "A  STICKBALL  PICTURE  ·  NEW YORK CITY  ·  1926"
	eyebrow.add_theme_font_size_override("font_size", 20)
	eyebrow.add_theme_color_override("font_color", Tuning.BRICKC)
	eyebrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var title := Label.new()
	title.text = "THREE SEWERS"
	title.add_theme_font_size_override("font_size", 120)
	title.add_theme_color_override("font_color", Tuning.INK)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var sub := Label.new()
	sub.text = "manhole for home · stoop for first · hydrant for third"
	sub.add_theme_font_size_override("font_size", 24)
	sub.add_theme_color_override("font_color", Tuning.ASPHALT)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(eyebrow)
	v.add_child(title)
	v.add_child(sub)
	v.add_child(_spacer(26))
	v.add_child(_ticket_button("PLAY BALL", _show_select))
	add_child(v)

func _spacer(h: int) -> Control:
	var s := Control.new()
	s.custom_minimum_size = Vector2(0, h)
	return s

func _ticket_button(txt: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = "  %s  " % txt
	b.add_theme_font_size_override("font_size", 40)
	b.add_theme_color_override("font_color", Tuning.INK)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Tuning.CHALK
	sb.border_color = Tuning.INK
	sb.set_border_width_all(4)
	sb.set_corner_radius_all(12)
	sb.set_content_margin_all(16)
	b.add_theme_stylebox_override("normal", sb)
	var sb2 := sb.duplicate()
	sb2.bg_color = Tuning.PINK
	b.add_theme_stylebox_override("pressed", sb2)
	var sb3 := sb.duplicate()
	sb3.bg_color = Color("f6ecd4")
	b.add_theme_stylebox_override("hover", sb3)
	b.pressed.connect(cb)
	return b

func _show_select() -> void:
	_clear()
	picked = []
	card_nodes = {}
	_paper_bg(self)
	var root := VBoxContainer.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_theme_constant_override("separation", 8)
	var head := Label.new()
	head.text = "THE CANDY-STORE RACK — PICK YOUR SIX"
	head.add_theme_font_size_override("font_size", 34)
	head.add_theme_color_override("font_color", Tuning.INK)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_spacer(8))
	root.add_child(head)
	var grid := GridContainer.new()
	grid.columns = 6
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 12)
	grid.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var ids: Array = Game.roster.keys()
	ids.sort()
	for id in ids:
		var slot := PanelContainer.new()
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0, 0, 0, 0)
		sb.border_color = Color(0, 0, 0, 0)
		sb.set_border_width_all(5)
		sb.set_corner_radius_all(8)
		slot.add_theme_stylebox_override("panel", sb)
		var tr := TextureRect.new()
		tr.texture = Game.card(id)
		tr.custom_minimum_size = Vector2(150, 210)
		tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tr.stretch_mode = TextureRect.STRETCH_SCALE
		slot.add_child(tr)
		slot.gui_input.connect(_on_card_input.bind(id))
		card_nodes[id] = slot
		grid.add_child(slot)
	root.add_child(grid)
	var foot := HBoxContainer.new()
	foot.alignment = BoxContainer.ALIGNMENT_CENTER
	foot.add_theme_constant_override("separation", 30)
	start_btn = _ticket_button("PLAY BALL", func(): _confirm_select())
	start_btn.disabled = true
	foot.add_child(start_btn)
	root.add_child(_spacer(4))
	root.add_child(foot)
	add_child(root)

func _on_card_input(ev: InputEvent, id: String) -> void:
	if ev is InputEventMouseButton and ev.pressed:
		if id in picked:
			picked.erase(id)
		elif picked.size() < 6:
			picked.append(id)
		var sb: StyleBoxFlat = card_nodes[id].get_theme_stylebox("panel")
		sb.border_color = Tuning.PINK if id in picked else Color(0, 0, 0, 0)
		start_btn.disabled = picked.size() != 6
		start_btn.text = "  PLAY BALL (%d/6)  " % picked.size() if picked.size() < 6 else "  PLAY BALL  "

func _confirm_select() -> void:
	Game.player_team = picked.duplicate()
	var rest: Array = []
	for id in Game.roster.keys():
		if not (id in picked): rest.append(id)
	rest.sort_custom(func(a, b):
		var ra = Game.roster[a]; var rb = Game.roster[b]
		return ra["PWR"] + ra["CON"] + ra["ARM"] > rb["PWR"] + rb["CON"] + rb["ARM"])
	Game.cpu_team = rest.slice(0, 6)
	_start_match(false)

func _start_match(auto: bool) -> void:
	var mv := Node2D.new()
	mv.set_script(load("res://scripts/match_view.gd"))
	mv.autopilot = auto
	# deferred: _ready-time add (smoke path) hits the busy root otherwise
	get_tree().root.add_child.call_deferred(mv)
	queue_free()

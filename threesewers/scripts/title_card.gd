class_name TitleCards
extends CanvasLayer
# SOCK! ATTA BOY! THREE SEWERS! — silent-film intertitles with iris + flicker.
#
# One printed plate carries every call in the game, including the last one, so
# it is worth getting right: aged stock with an ink border, letterspaced caps
# cut the way a 1926 title house would cut them, a rule under the headline,
# and a dark scrim so the card reads over a gaslit street.

const RULE_COL := Color(0.30, 0.22, 0.16, 0.75)

var iris: ColorRect
var scrim: TextureRect
var card: PanelContainer
var lbl: Label
var rule: ColorRect
var sub: Label
var _head_font: FontVariation
var _sub_font: FontVariation

func _ready() -> void:
	layer = 20
	iris = ColorRect.new()
	iris.set_anchors_preset(Control.PRESET_FULL_RECT)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/iris.gdshader")
	mat.set_shader_parameter("radius", 1.6)
	var vp := get_viewport().get_visible_rect().size
	mat.set_shader_parameter("aspect", vp.x / maxf(vp.y, 1.0))
	iris.material = mat
	iris.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(iris)

	# a soft pool of dark under the plate, so the ink never sits on a lamp
	if ResourceLoader.exists("res://assets/ui/ui_scrim.png"):
		scrim = TextureRect.new()
		scrim.texture = load("res://assets/ui/ui_scrim.png")
		scrim.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		scrim.stretch_mode = TextureRect.STRETCH_SCALE
		scrim.modulate = Color(1, 1, 1, 0.72)
		scrim.mouse_filter = Control.MOUSE_FILTER_IGNORE
		scrim.visible = false
		add_child(scrim)

	card = PanelContainer.new()
	card.add_theme_stylebox_override("panel", _plate_style())
	# positioned by hand every flash: anchoring to centre would need the
	# viewport size, which is not settled yet at _ready
	card.set_anchors_preset(Control.PRESET_TOP_LEFT)
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE

	# letterspaced caps: the period look, and the reason these read as titles
	# rather than as UI text
	var base: Font = ThemeDB.fallback_font
	var theme_font: Variant = ProjectSettings.get_setting("gui/theme/custom_font")
	if theme_font != null and ResourceLoader.exists(str(theme_font)):
		base = load(str(theme_font))
	_head_font = FontVariation.new()
	_head_font.base_font = base
	_sub_font = FontVariation.new()
	_sub_font.base_font = base

	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	lbl = Label.new()
	lbl.add_theme_font_override("font", _head_font)
	lbl.add_theme_color_override("font_color", Tuning.INK)
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rule = ColorRect.new()
	rule.color = RULE_COL
	rule.custom_minimum_size = Vector2(0, 3)
	rule.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	rule.mouse_filter = Control.MOUSE_FILTER_IGNORE
	sub = Label.new()
	sub.add_theme_font_override("font", _sub_font)
	sub.add_theme_color_override("font_color", Tuning.BRICKC)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.add_child(lbl)
	v.add_child(rule)
	v.add_child(sub)
	card.add_child(v)
	card.visible = false
	card.pivot_offset = Vector2.ZERO
	add_child(card)

func _plate_style() -> StyleBox:
	# printed intertitle stock, stretched as a 9-patch
	var plate := "res://assets/ui/ui_card_plate.png"
	if ResourceLoader.exists(plate):
		var st := StyleBoxTexture.new()
		st.texture = load(plate)
		st.set_texture_margin_all(60)
		st.set_content_margin_all(40)
		return st
	var sb := StyleBoxFlat.new()
	sb.bg_color = Tuning.PAPER
	sb.border_color = Tuning.INK
	sb.set_border_width_all(6)
	sb.set_corner_radius_all(10)
	sb.set_content_margin_all(34)
	return sb

func flash(text: String, subtext := "", hold := 0.9, slam := false) -> void:
	# the cards were tuned for landscape; a tall screen gets a smaller cut
	var vps := get_viewport().get_visible_rect().size
	var land := vps.x >= vps.y
	var head_px := int(clampf(vps.x * (0.058 if land else 0.052), 34.0, 96.0))
	var sub_px := int(maxf(head_px * 0.32, 15.0))
	# letterspacing scales with the type, the way metal type would be leaded
	_head_font.set_spacing(TextServer.SPACING_GLYPH, int(head_px * 0.11))
	_sub_font.set_spacing(TextServer.SPACING_GLYPH, int(sub_px * 0.09))
	var wide := vps.x * 0.82
	# a title card never wraps: if the cut is too long for the frame, the
	# type comes down a size, the way a title house would have reset it
	lbl.text = text
	sub.text = subtext
	while head_px > 20 and _head_font.get_string_size(
			text, HORIZONTAL_ALIGNMENT_LEFT, -1, head_px).x > wide:
		head_px = int(head_px * 0.92)
		_head_font.set_spacing(TextServer.SPACING_GLYPH, int(head_px * 0.11))
	while sub_px > 11 and _sub_font.get_string_size(
			subtext, HORIZONTAL_ALIGNMENT_LEFT, -1, sub_px).x > wide:
		sub_px = int(sub_px * 0.92)
		_sub_font.set_spacing(TextServer.SPACING_GLYPH, int(sub_px * 0.09))
	lbl.add_theme_font_size_override("font_size", head_px)
	sub.add_theme_font_size_override("font_size", sub_px)
	sub.visible = subtext != ""
	rule.visible = subtext != ""
	rule.custom_minimum_size = Vector2(
		_head_font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1,
			head_px).x * 0.82, maxf(2.0, head_px * 0.035))
	card.visible = true
	card.custom_minimum_size = Vector2.ZERO
	card.reset_size()
	card.position = ((vps - card.size) * 0.5).round()
	card.pivot_offset = card.size / 2.0
	if scrim != null:
		scrim.size = card.size * 2.45
		scrim.position = vps * 0.5 - scrim.size * 0.5
		scrim.visible = true
		scrim.modulate.a = 0.0
		create_tween().tween_property(scrim, "modulate:a", 0.72, 0.14)
	var mat: ShaderMaterial = iris.material
	mat.set_shader_parameter("aspect", vps.x / maxf(vps.y, 1.0))
	var tw := create_tween()
	tw.tween_method(func(v): mat.set_shader_parameter("radius", v), 1.6, 0.34, 0.28)
	if slam:
		card.scale = Vector2(2.4, 2.4)
		card.rotation_degrees = -7.0
		var tw2 := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw2.parallel().tween_property(card, "scale", Vector2.ONE, 0.24)
		tw2.parallel().tween_property(card, "rotation_degrees", -2.0, 0.24)
	else:
		card.scale = Vector2(0.85, 0.85)
		card.rotation_degrees = 0.0
		var tw3 := create_tween().set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw3.tween_property(card, "scale", Vector2.ONE, 0.18)
	await get_tree().create_timer(hold).timeout
	var tw4 := create_tween()
	tw4.tween_method(func(v): mat.set_shader_parameter("radius", v), 0.34, 1.6, 0.3)
	tw4.parallel().tween_property(card, "scale", Vector2(0.9, 0.9), 0.24)
	if scrim != null:
		tw4.parallel().tween_property(scrim, "modulate:a", 0.0, 0.24)
	await tw4.finished
	card.visible = false
	if scrim != null:
		scrim.visible = false

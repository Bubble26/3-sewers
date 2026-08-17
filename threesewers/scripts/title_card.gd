class_name TitleCards
extends CanvasLayer
# SOCK! ATTA BOY! THREE SEWERS! — silent-film intertitles with iris + flicker.

var iris: ColorRect
var card: PanelContainer
var lbl: Label
var sub: Label

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

	card = PanelContainer.new()
	# printed intertitle stock, stretched as a 9-patch
	var plate := "res://assets/ui/ui_card_plate.png"
	if ResourceLoader.exists(plate):
		var st := StyleBoxTexture.new()
		st.texture = load(plate)
		st.set_texture_margin_all(60)
		st.set_content_margin_all(40)
		card.add_theme_stylebox_override("panel", st)
	else:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Tuning.PAPER
		sb.border_color = Tuning.CHALK
		sb.set_border_width_all(6)
		sb.set_corner_radius_all(10)
		sb.set_content_margin_all(34)
		card.add_theme_stylebox_override("panel", sb)
	card.set_anchors_preset(Control.PRESET_CENTER)
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var v := VBoxContainer.new()
	lbl = Label.new()
	lbl.add_theme_font_size_override("font_size", 74)
	lbl.add_theme_color_override("font_color", Tuning.INK)
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub = Label.new()
	sub.add_theme_font_size_override("font_size", 23)
	sub.add_theme_color_override("font_color", Tuning.BRICKC)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(lbl)
	v.add_child(sub)
	card.add_child(v)
	card.visible = false
	card.pivot_offset = Vector2.ZERO
	add_child(card)

func flash(text: String, subtext := "", hold := 0.9, slam := false) -> void:
	lbl.text = text
	sub.text = subtext
	sub.visible = subtext != ""
	card.visible = true
	card.reset_size()
	card.pivot_offset = card.size / 2.0
	var mat: ShaderMaterial = iris.material
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
	await tw4.finished
	card.visible = false

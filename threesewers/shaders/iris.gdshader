shader_type canvas_item;
// Silent-film iris wipe. radius 1.5 = open, 0.0 = closed.
uniform float radius : hint_range(0.0, 1.6) = 1.6;
uniform float aspect = 1.7778;

void fragment() {
	vec2 p = UV - vec2(0.5, 0.5);
	p.x *= aspect;
	float d = length(p);
	float edge = smoothstep(radius - 0.015, radius, d);
	COLOR = vec4(0.04, 0.025, 0.02, edge);
}

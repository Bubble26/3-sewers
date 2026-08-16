shader_type canvas_item;
// Hand-cranked flicker + grain + vignette.
uniform float flicker : hint_range(0.0, 1.0) = 0.10;
uniform float grain : hint_range(0.0, 1.0) = 0.10;
uniform float vignette : hint_range(0.0, 1.0) = 0.34;

float rnd(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }

void fragment() {
	float f = rnd(vec2(floor(TIME * 14.0), 1.0)) * flicker;
	float g = (rnd(UV * vec2(640.0, 360.0) + fract(TIME) * 7.0) - 0.5) * grain;
	float d = distance(UV, vec2(0.5, 0.5));
	float v = smoothstep(0.42, 0.85, d) * vignette;
	float dark = clamp(f + v, 0.0, 0.85);
	COLOR = vec4(vec3(0.05, 0.03, 0.02), dark + max(g, 0.0) * 0.5);
}

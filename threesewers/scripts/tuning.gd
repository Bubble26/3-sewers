extends Node
# All feel constants live here. Raise/lower, don't hardcode.

const INNINGS := 3
const PITCH_TIMES := {"fast": 0.62, "spinner": 0.78, "drop": 0.88}
const BOUNCE_REST := {"fast": 0.72, "spinner": 0.7, "drop": 0.5}
const SPIN_KICK := {"fast": 0.0, "spinner": 34.0, "drop": 8.0}
const SWING_EARLY := 0.42   # seconds before plate-cross the tap window opens
const SWING_LATE := 0.24    # seconds after
const CAM_ZOOM := 0.9
# Sprites are authored at 2x world size so they stay crisp on a retina phone.
const ART := 0.5
# world layout (street runs up-screen)
const PLATE := Vector2(640, 2350)
const BASE_1 := Vector2(930, 2140)
const BASE_2 := Vector2(640, 1958)
const BASE_3 := Vector2(350, 2140)
const SEWERS_Y := [1650.0, 1250.0, 850.0]
const WALL_L := 235.0
const WALL_R := 1045.0
const WINDOW_POS := Vector2(190, 900)
const FE_L := Vector2(200, 1430)
const FE_R := Vector2(1080, 1430)
const CAR_POS := Vector2(930, 1560)
const FIELD_POS := {"P": Vector2(640, 2060), "C": Vector2(640, 2452),
	"1B": Vector2(880, 2120), "SS": Vector2(470, 1990),
	"LF": Vector2(430, 1490), "RF": Vector2(850, 1490)}
const PINK := Color("e4626f")
const INK := Color("2b1f17")
const PAPER := Color("efe3c8")
const CHALK := Color("fff7e4")
const ASPHALT := Color("55504a")
const BRICKC := Color("6e4a32")
const GOLD := Color("d9a441")
const PATINA := Color("5e8272")

# ---------------------------------------------------------------- perspective
# The camera stands just behind the batter and looks up the street. Gameplay
# still happens in the flat world coordinates above — this only decides where
# a world point lands on screen and how big it is. Mirrors tools/perspective.py,
# which bakes the backdrop through the same maths, so scenery and live sprites
# agree exactly.
const STREET_TOP := 600.0
const VIEW_NEAR_Y := 2400.0      # the camera plane, just behind the batter

# design-space presets: dw, dh, horizon_f, near_f, z_far, xk
const VIEW_PORTRAIT := {"dw": 720.0, "dh": 1200.0, "horizon_f": 0.250,
	"near_f": 1.88, "z_far": 74.0, "xk": 9.40}
const VIEW_LANDSCAPE := {"dw": 1280.0, "dh": 720.0, "horizon_f": 0.225,
	"near_f": 1.02, "z_far": 10.3, "xk": 1.86}

var vw := 1280.0          # design width
var vh := 720.0           # design height
var v_horizon := 165.6
var v_near_bottom := 1036.8
var v_zfar := 10.3
var v_xk := 1.71
var v_portrait := false

func use_view(portrait: bool) -> void:
	var p: Dictionary = VIEW_PORTRAIT if portrait else VIEW_LANDSCAPE
	v_portrait = portrait
	vw = p["dw"]
	vh = p["dh"]
	v_horizon = vh * float(p["horizon_f"])
	v_near_bottom = vh * float(p["near_f"])
	v_zfar = p["z_far"]
	v_xk = p["xk"]

func proj_u(world_y: float) -> float:
	return clampf((VIEW_NEAR_Y - world_y) / (VIEW_NEAR_Y - STREET_TOP), 0.004, 1.15)

func proj_s(world_y: float) -> float:
	return 1.0 / (1.0 + proj_u(world_y) * (v_zfar - 1.0))

# returns (screen_x, screen_y, scale) in design space
func project(world: Vector2, height := 0.0) -> Vector3:
	var s := proj_s(world.y)
	var sy := v_horizon + (v_near_bottom - v_horizon) * s
	var sx := vw * 0.5 + (world.x - PLATE.x) * s * v_xk
	return Vector3(sx, sy - height * s * v_xk, s)

# sprites are authored at 2x world size, hence ART
func sprite_scale(s: float) -> float:
	return s * v_xk * ART

extends Node
# All feel constants live here. Raise/lower, don't hardcode.

const INNINGS := 3
# The pitch, and the whole batting game with it.
#
# Two separate failures have been measured here and both are addressed by
# these numbers.
#
# The first was that the hop carried no information: fast and spinner
# rebounded 1.4% apart. Retuning moved that defect rather than removing it —
# fast and drop then sat within 0.045-0.14 of a ball diameter of each other
# for the whole 200ms after the bounce, because their rebound speeds had
# ended up nearly identical. These are searched, not guessed: the worst pair
# is now 0.76 ball diameters apart 100ms after the bounce and 0.98 at 133ms,
# which is the threshold at which a difference is a tell rather than a
# rounding error.
#
# The second was worse and less obvious. A player who never looked at the
# ball and simply tapped a fixed 310ms after every bounce scored 56.6%
# perfect contact, against 71.5% for reading the pitch flawlessly. Reading
# the hop bought 2.4 points of whiff rate — the mechanic the game is named
# for was decorative. The cause was that the three ideal presses spanned
# 100ms while the perfect-contact window is 108ms wide, so one fixed delay
# sat inside all three. The gaps are now 120ms and 160ms, both wider than
# that window, so a single blind rhythm cannot be right about more than one
# pitch.
#
#   type     bounce->plate   crosses at   press after bounce   doing
#   fast        300ms           67px           250ms           low, flat, first
#   spinner     420ms           99px           370ms           mid hop + kick
#   drop        580ms          142px           530ms           lobs high, falling
const PITCH_TIMES := {"fast": 0.52, "spinner": 0.58, "drop": 0.62}
const PITCH_TB := {"fast": 0.30, "spinner": 0.42, "drop": 0.58}
const BOUNCE_REST := {"fast": 0.24, "spinner": 0.36, "drop": 0.55}
# The pitcher's hand, in world px off the cobbles. A low release caps every
# rebound, and it is the rebound spread that carries the read.
const PITCH_ARC_H := 280.0
const SPIN_KICK := {"fast": 0.0, "spinner": 34.0, "drop": 8.0}
# ballistics — one gravity for the whole game, in world px/s^2 (a kid is
# ~160 world px ≈ 1.4 m, so ~1500 reads just a touch snappier than earth)
const BALL_G := 1500.0
const BALL_G_CHOP := 3000.0      # grounders are chopped down hard
const GROUND_REST := 0.55        # cobble restitution for grounder hops
# The prompt used to stay lit for 660ms while only ±163ms of that could ever
# connect — 51% of the window it invited you to swing in was a guaranteed
# whiff. The window now matches roughly what contact actually tolerates.
const SWING_EARLY := 0.18   # seconds before the aim point the tap window opens
# 0.13, not 0.18: the ball leaves the bottom of the screen 43ms after it
# crosses the plate, and the window used to stay open 129ms past that — up to
# 100ms per pitch of being invited to swing at a ball that is gone.
const SWING_LATE := 0.13
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
# Same z_far as portrait: it is the same camera looking down the same street.
const VIEW_LANDSCAPE := {"dw": 1280.0, "dh": 720.0, "horizon_f": 0.225,
	"near_f": 2.39, "z_far": 74.0, "xk": 8.50}

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

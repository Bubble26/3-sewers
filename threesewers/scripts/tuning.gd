extends Node
# All feel constants live here. Raise/lower, don't hardcode.

const INNINGS := 3
const PITCH_TIMES := {"fast": 0.62, "spinner": 0.78, "drop": 0.88}
const BOUNCE_REST := {"fast": 0.72, "spinner": 0.7, "drop": 0.5}
const SPIN_KICK := {"fast": 0.0, "spinner": 34.0, "drop": 8.0}
const SWING_EARLY := 0.42   # seconds before plate-cross the tap window opens
const SWING_LATE := 0.24    # seconds after
const CAM_ZOOM := 0.9
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

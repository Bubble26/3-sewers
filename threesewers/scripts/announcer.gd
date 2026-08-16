extends Node
# The kid with the tin megaphone. Graham McNamee patter, original lines.

var rng := RandomNumberGenerator.new()

const BANKS := {
	"pregame": ["Good afternoon, friends of the wireless — %s toes the manhole and the block holds its breath!",
		"From high atop the stoop, this is your announcer — batteries not required!"],
	"pitch": ["Here's the wind-up — watch that hop, folks!", "%s rocks and fires down the cobbles!",
		"The spaldeen is LIVE, ladies and gentlemen!"],
	"strike": ["Cut the plate in two! Strike, says the kid in the tall socks!",
		"Right past him — you could hear it whistle Dixie!"],
	"ball": ["Wide of the manhole — the gang hollers foul play!", "Outside! Even the pigeons ducked!"],
	"foul": ["Skied into Mrs. Costello's geraniums — foul ball!", "Off the stickball, into the awning — no dice!"],
	"whiff": ["Swung on and MISSED — the broom handle met nothing but afternoon!"],
	"strikeout": ["Down he goes! Three strikes and back to the curb!",
		"That's the old dipsy-doodle — struck him out!"],
	"walk": ["Four wide ones and %s ambles to the stoop!"],
	"single": ["A sharp one up the cobbles — %s legs it to the stoop!",
		"Base knock! The hot-dog man never saw it coming!"],
	"double": ["Off the bricks and rolling — %s pulls into second, standing up!"],
	"fire_escape": ["It's IN THE FIRE ESCAPE! Ground rules, folks — two bags and not a step more!"],
	"flivver": ["OFF THE FLIVVER! Mr. Esposito shakes his fist — ball's still live!"],
	"out_fly": ["Hauled in! %s squeezes it like a nickel!"],
	"out_line": ["SPEARED! Right off the shoetops!"],
	"out_ground": ["Scooped and fired — got him by an eyelash at the stoop!"],
	"out_home": ["The throw comes HOME — he's OUT at the manhole! Oh, you kid!"],
	"hr1": ["ONE SEWER, folks — count it off the iron!"],
	"hr2": ["TWO SEWERS! That ball's past the pushcart and still singing!"],
	"hr3": ["THREE SEWERS! THREE! Somebody wire the papers — that's the longest poke this block has EVER seen!"],
	"window": ["OH! RIGHT THROUGH THE GLASS! That's a home run, friends — and every kid on the block is suddenly VERY interested in his shoes! RUN!"],
	"cheese": ["CHEESE IT — THE COP! Stash the broom, act natural, whistle something!"],
	"cheese_end": ["All clear, says the lookout. Play resumes like nothing ever happened."],
	"final": ["That's the ball game, folks! Sun's down, supper's on, and the block belongs to the winners!"],
}

func line(event: String, kid_name: String = "") -> String:
	if not BANKS.has(event): return ""
	var arr: Array = BANKS[event]
	var s: String = arr[rng.randi_range(0, arr.size() - 1)]
	if s.contains("%s"): s = s % kid_name
	return s

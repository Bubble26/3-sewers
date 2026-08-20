// The module manifest. Every feature module gets exactly one line here, in wave order.
// Append-only: never reorder or remove another piece's line.

// --- world -----------------------------------------------------------------
import '../world/street.js';
import '../world/backdrop.js';
import '../world/surface.js';
// --- render ----------------------------------------------------------------
import '../render/lighting.js';
import '../render/postfx.js';   // art direction: palette + materials + output transform
import '../render/cameras.js'; // the stage camera director: two locked framings, hard cuts (§17)
// --- characters ------------------------------------------------------------
import '../game/layout.js'; // the stage plan: every position on the street, and the chalk
import '../chars/players.js';
import '../chars/rig.js';
// --- gameplay --------------------------------------------------------------
import '../game/ballview.js';
import '../game/ballphysics.js';
import '../game/pitching.js';
import '../game/core.js';   // the ported rules core: street rules, quirks, the throw prompt
import '../game/batting.js'; // the hop off the block, the swing window, and what a press means
import '../game/fielding.js'; // the chase, the catch, the dive, the muff, and the throw prompt
import '../game/baserunning.js'; // the runners: the break, the turn at first, the slide, the close play
import '../game/moments.js'; // the street rules the core lacks, and the twelve signature moments staged
// --- fx / ui / audio -------------------------------------------------------
import '../fx/particles.js';
import '../ui/hud.js';
import '../audio/engine.js';
import '../audio/music.js';
import '../ui/teamselect.js';
import '../ui/screens.js';
import '../audio/announcer.js'; // the booth on the block: play-by-play, kid chatter, speech bubbles
// --- scenarios (must stay last: they reference finished systems) ------------
import './scenarios.js';

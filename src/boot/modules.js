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
import '../chars/players.js';
import '../chars/rig.js';
// --- gameplay --------------------------------------------------------------
import '../game/ballview.js';
import '../game/ballphysics.js';
import '../game/pitching.js';
// --- fx / ui / audio -------------------------------------------------------
import '../fx/particles.js';
import '../ui/hud.js';
import '../audio/engine.js';
import '../audio/music.js';
import '../ui/teamselect.js';
// --- scenarios (must stay last: they reference finished systems) ------------
import './scenarios.js';

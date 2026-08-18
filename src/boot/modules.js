// The module manifest. Every feature module gets exactly one line here, in wave order.
// Append-only: never reorder or remove another piece's line.

// --- world -----------------------------------------------------------------
import '../world/street.js';
import '../world/surface.js';
// --- render ----------------------------------------------------------------
import '../render/lighting.js';
import '../render/postfx.js';   // art direction: palette + materials + output transform
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
import '../ui/teamselect.js';
// --- scenarios (must stay last: they reference finished systems) ------------
import './scenarios.js';

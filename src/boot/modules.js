// The module manifest. Every feature module gets exactly one line here, in wave order.
// Append-only: never reorder or remove another piece's line.

// --- world -----------------------------------------------------------------
import '../world/street.js';
import '../world/surface.js';
// --- render ----------------------------------------------------------------
import '../render/lighting.js';
// --- characters ------------------------------------------------------------
import '../chars/players.js';
import '../chars/rig.js';
// --- gameplay --------------------------------------------------------------
import '../game/ballview.js';
// --- fx / ui / audio -------------------------------------------------------
import '../fx/particles.js';
import '../ui/hud.js';
import '../audio/engine.js';
// --- scenarios (must stay last: they reference finished systems) ------------
import './scenarios.js';
